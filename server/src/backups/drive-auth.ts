import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import {
  DRIVE_SCOPE,
  TOKEN_URL,
  readDriveClient,
  saveDriveToken,
  type DriveSettings,
} from "./drive.js";

function openBrowser(url: string) {
  const [command, args] =
    process.platform === "win32"
      ? (["rundll32.exe", ["url.dll,FileProtocolHandler", url]] as const)
      : process.platform === "darwin"
        ? (["open", [url]] as const)
        : (["xdg-open", [url]] as const);
  const child = spawn(command, [...args], {
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", () => {}); // The same URL is printed for manual opening.
  child.unref();
}

export async function authorizeDrive(
  settings: DriveSettings,
  options: {
    log?: (message: string) => void;
    openBrowser?: (url: string) => void;
    http?: typeof fetch;
    timeoutMs?: number;
  } = {},
) {
  const client = await readDriveClient(settings.DRIVE_CLIENT_FILE);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let callback!: (url: URL) => void;
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    const received = Buffer.from(url.searchParams.get("state") || "");
    const valid =
      request.method === "GET" &&
      url.pathname === "/oauth2/callback" &&
      received.length === state.length &&
      timingSafeEqual(received, Buffer.from(state));
    response.writeHead(valid ? 200 : 400, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'",
    });
    response.end(
      valid
        ? "Respuesta recibida. Podés cerrar esta ventana y volver al instalador."
        : "Solicitud de autorización inválida.",
    );
    if (valid) callback(url);
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("No se pudo iniciar la autorización local.");
    const redirect = `http://127.0.0.1:${address.port}/oauth2/callback`;
    const code = await new Promise<string>((resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            Error(
              "La autorización de Google Drive venció. Volvé a ejecutarla.",
            ),
          ),
        options.timeoutMs ?? 300000,
      );
      callback = (url) => {
        if (url.searchParams.has("error") || !url.searchParams.get("code"))
          reject(Error("La autorización de Google Drive fue rechazada."));
        else resolve(url.searchParams.get("code")!);
      };
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: redirect,
        response_type: "code",
        scope: DRIVE_SCOPE,
        access_type: "offline",
        prompt: "consent",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      (options.log ?? console.log)(
        `Abrí este enlace en el navegador del equipo que ejecuta el instalador:\n${url}`,
      );
      (options.openBrowser ?? openBrowser)(url.toString());
    });
    clearTimeout(timer);
    const response = await (options.http ?? fetch)(TOKEN_URL, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
      body: new URLSearchParams({
        ...client,
        code,
        redirect_uri: redirect,
        code_verifier: verifier,
        grant_type: "authorization_code",
      }),
    });
    if (!response.ok)
      throw Error("No se pudo completar la autorización de Google Drive.");
    const token = (await response.json()) as Record<string, unknown>;
    if (typeof token.refresh_token !== "string" || !token.refresh_token)
      throw Error(
        "Google no otorgó acceso sin conexión. Revocá el acceso previo y volvé a autorizar.",
      );
    if (
      typeof token.scope !== "string" ||
      !token.scope.split(" ").includes(DRIVE_SCOPE)
    )
      throw Error("Google no otorgó el permiso de archivos requerido.");
    await saveDriveToken(settings.DRIVE_TOKEN_FILE, {
      client_id: client.client_id,
      refresh_token: token.refresh_token,
    });
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
