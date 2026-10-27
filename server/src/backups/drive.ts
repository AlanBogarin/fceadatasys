import {
  mkdir,
  readFile,
  open,
  rename,
  rm,
  chmod,
  stat,
} from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
export const driveId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]+$/.test(value);

export interface DriveSettings {
  DRIVE_CLIENT_FILE: string;
  DRIVE_TOKEN_FILE: string;
  DRIVE_FOLDER_ID?: string;
  BACKUP_TIMEOUT_MS: number;
}
export interface DriveClientCredentials {
  client_id: string;
  client_secret: string;
}
export interface DriveToken {
  client_id: string;
  refresh_token: string;
}
export async function readDriveClient(
  file: string,
): Promise<DriveClientCredentials> {
  const value = JSON.parse(await readFile(file, "utf8"))?.installed;
  if (
    !value ||
    typeof value.client_id !== "string" ||
    !value.client_id.endsWith(".apps.googleusercontent.com") ||
    typeof value.client_secret !== "string" ||
    !value.client_secret
  )
    throw Error(
      "Importá el JSON de un cliente OAuth de tipo aplicación de escritorio de Google.",
    );
  return { client_id: value.client_id, client_secret: value.client_secret };
}
export async function readDriveToken(
  file: string,
  clientId: string,
): Promise<DriveToken> {
  const value = JSON.parse(await readFile(file, "utf8"));
  if (
    value?.client_id !== clientId ||
    typeof value.refresh_token !== "string" ||
    !value.refresh_token
  )
    throw Error("Autorizá Google Drive con el cliente OAuth configurado.");
  return { client_id: clientId, refresh_token: value.refresh_token };
}
export async function saveDriveToken(file: string, token: DriveToken) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(token) + "\n");
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
    await chmod(file, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
export interface DriveMetadata {
  id: string;
  name?: string;
  size?: string;
  md5Checksum?: string;
  mimeType?: string;
  trashed?: boolean;
  parents?: string[];
  capabilities?: { canAddChildren?: boolean };
}
export interface DriveStorage {
  generateId(): Promise<string>;
  upload(id: string, path: string, name: string): Promise<void>;
  metadata(id: string): Promise<DriveMetadata>;
  remove(id: string): Promise<void>;
}

/** Direct Drive v3 transport. Secrets and provider error bodies never enter logs. */
export class GoogleDrive implements DriveStorage {
  private accessToken = "";
  private expiresAt = 0;
  constructor(
    private settings: DriveSettings,
    private http: typeof fetch = fetch,
    private pause: (ms: number) => Promise<unknown> = delay,
  ) {}

  private async token(force = false) {
    if (!force && this.accessToken && Date.now() < this.expiresAt)
      return this.accessToken;
    const client = await readDriveClient(this.settings.DRIVE_CLIENT_FILE);
    const saved = await readDriveToken(
      this.settings.DRIVE_TOKEN_FILE,
      client.client_id,
    );
    const response = await this.http(TOKEN_URL, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(
        Math.min(30000, this.settings.BACKUP_TIMEOUT_MS),
      ),
      body: new URLSearchParams({
        ...client,
        refresh_token: saved.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok)
      throw Error(
        "No se pudo renovar la autorización de Google Drive. Volvé a autorizar la cuenta.",
      );
    const value = (await response.json()) as Record<string, unknown>;
    if (
      typeof value.access_token !== "string" ||
      !value.access_token ||
      typeof value.expires_in !== "number" ||
      value.expires_in <= 0
    )
      throw Error("Respuesta OAuth inválida.");
    if (
      typeof value.refresh_token === "string" &&
      value.refresh_token !== saved.refresh_token
    )
      await saveDriveToken(this.settings.DRIVE_TOKEN_FILE, {
        ...saved,
        refresh_token: value.refresh_token,
      });
    this.accessToken = value.access_token;
    this.expiresAt = Date.now() + Math.max(0, value.expires_in - 60) * 1000;
    return this.accessToken;
  }
  private async request(
    url: string,
    init: RequestInit = {},
    signal?: AbortSignal,
    attempts = 4,
  ) {
    const deadline =
      signal ?? AbortSignal.timeout(this.settings.BACKUP_TIMEOUT_MS);
    for (let attempt = 0; attempt < attempts; attempt++) {
      deadline.throwIfAborted();
      const token = await this.token();
      let response: Response;
      try {
        response = await this.http(url, {
          ...init,
          redirect: "error",
          signal: deadline,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
        });
      } catch {
        if (attempt + 1 === attempts || deadline.aborted)
          throw Error("No se pudo conectar con Google Drive.");
        await this.pause(250 * 2 ** attempt);
        continue;
      }
      if (response.status === 401 && attempt + 1 < attempts) {
        await response.body?.cancel();
        await this.token(true);
        continue;
      }
      const quota =
        response.status === 403 &&
        (await response
          .clone()
          .json()
          .then(
            (body) =>
              body?.error?.errors?.some((entry: { reason?: string }) =>
                ["rateLimitExceeded", "userRateLimitExceeded"].includes(
                  entry.reason ?? "",
                ),
              ),
            () => false,
          ));
      if (
        (quota || [429, 500, 502, 503, 504].includes(response.status)) &&
        attempt + 1 < attempts
      ) {
        await response.body?.cancel();
        await this.pause(250 * 2 ** attempt);
        continue;
      }
      return response;
    }
    throw Error("Google Drive no respondió.");
  }
  private async json(url: string, init?: RequestInit) {
    const response = await this.request(url, init);
    if (!response.ok)
      throw Error(
        "Google Drive rechazó la operación. Revisá autorización, carpeta y espacio.",
      );
    return (await response.json()) as Record<string, unknown>;
  }
  async generateId() {
    const value = await this.json(
      `${API}/generateIds?count=1&space=drive&type=files`,
    );
    const id = Array.isArray(value.ids) ? value.ids[0] : undefined;
    if (!driveId(id)) throw Error("Identificador de Drive inválido.");
    return id;
  }
  async metadata(id: string): Promise<DriveMetadata> {
    if (!driveId(id)) throw Error("Identificador de Drive inválido.");
    return (await this.json(
      `${API}/${id}?supportsAllDrives=true&fields=id,name,size,md5Checksum,mimeType,trashed,parents,capabilities(canAddChildren)`,
    )) as unknown as DriveMetadata;
  }
  async createFolder(name: string) {
    const id = await this.generateId();
    await this.json(`${API}?fields=id&supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });
    return id;
  }
  async remove(id: string) {
    if (!driveId(id)) throw Error("Identificador de Drive inválido.");
    const response = await this.request(`${API}/${id}?supportsAllDrives=true`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404)
      throw Error("No se pudo retirar el archivo del intento en Drive.");
  }
  async upload(id: string, path: string, name: string) {
    if (!driveId(id) || !driveId(this.settings.DRIVE_FOLDER_ID))
      throw Error("Carpeta de Drive inválida.");
    const size = (await stat(path)).size;
    if (!size) throw Error("El respaldo está vacío.");
    const deadline = AbortSignal.timeout(this.settings.BACKUP_TIMEOUT_MS);
    const start = await this.request(
      `${UPLOAD}?uploadType=resumable&supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "application/octet-stream",
          "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify({
          id,
          name,
          parents: [this.settings.DRIVE_FOLDER_ID],
          mimeType: "application/octet-stream",
        }),
      },
      deadline,
    );
    const location = start.headers.get("location");
    if (!start.ok || !location)
      throw Error("No se pudo iniciar la subida a Drive.");
    const session = new URL(location);
    if (
      session.origin !== "https://www.googleapis.com" ||
      session.pathname !== "/upload/drive/v3/files" ||
      session.username ||
      session.password
    )
      throw Error("Sesión de subida inválida.");
    const handle = await open(path, "r");
    try {
      let offset = 0,
        failures = 0;
      while (offset < size) {
        deadline.throwIfAborted();
        const buffer = Buffer.alloc(Math.min(8 * 1024 * 1024, size - offset));
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          offset,
        );
        if (bytesRead !== buffer.length)
          throw Error("El archivo de copia cambió durante la subida.");
        let response: Response;
        try {
          response = await this.request(
            location,
            {
              method: "PUT",
              body: buffer,
              headers: {
                "Content-Length": String(buffer.length),
                "Content-Range": `bytes ${offset}-${offset + buffer.length - 1}/${size}`,
              },
            },
            deadline,
            1,
          );
          if (!response.ok && response.status !== 308)
            throw Error("Subida interrumpida.");
        } catch {
          if (++failures > 3 || deadline.aborted)
            throw Error("No se pudo completar la subida a Drive.");
          // Ask the server how many bytes it committed before resending anything.
          response = await this.request(
            location,
            {
              method: "PUT",
              headers: {
                "Content-Length": "0",
                "Content-Range": `bytes */${size}`,
              },
            },
            deadline,
          );
        }
        if (response.ok) return;
        if (response.status !== 308)
          throw Error("La sesión de subida no está disponible.");
        const range = response.headers.get("range");
        const match = range?.match(/^bytes=0-(\d+)$/);
        if (range && !match) throw Error("Confirmación de subida inválida.");
        const next = match ? Number(match[1]) + 1 : 0;
        if (
          !Number.isSafeInteger(next) ||
          next < offset ||
          next >= size ||
          next > offset + buffer.length
        )
          throw Error("Confirmación de subida inválida.");
        if (next === offset) {
          if (++failures > 3) throw Error("La subida a Drive no progresa.");
        } else failures = 0;
        offset = next;
      }
    } finally {
      await handle.close();
    }
  }
}
