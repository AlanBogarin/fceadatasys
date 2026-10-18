import { confirmationHeaders, parseProblem } from "./problems";
import type { ExportResult, MutationOptions, Versioned } from "./contracts";

export function queryString(query: object = {}) {
  const values = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== null && value !== "")
      values.set(key, String(value));
  const encoded = values.toString();
  return encoded ? `?${encoded}` : "";
}
export function mutationHeaders(
  options: MutationOptions = {},
): Record<string, string> {
  return {
    ...(options.ifMatch ? { "If-Match": options.ifMatch } : {}),
    ...(options.confirmationPassword !== undefined
      ? confirmationHeaders(options.confirmationPassword)
      : {}),
  };
}
type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  public?: boolean;
  renew?: boolean;
  download?: boolean;
};
export class HttpTransport {
  private token = "";
  private tokenDeadline = 0;
  private generation = 0;
  private requests = new Set<AbortController>();
  recover: () => Promise<unknown> = async () => {};
  unauthorized: () => void = () => {};
  constructor(
    readonly baseUrl: string,
    private fetcher: typeof fetch = (input, init) =>
      globalThis.fetch(input, init),
    private now = Date.now,
  ) {}
  setToken(token: string, expiresIn = 900) {
    this.token = token;
    this.tokenDeadline = this.now() + expiresIn * 1000;
  }
  get renewalDue() {
    return !!this.token && this.tokenDeadline - this.now() < 60_000;
  }
  clear() {
    this.token = "";
    this.tokenDeadline = 0;
    this.generation++;
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }
  async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ data: T; headers: Headers }> {
    if (
      !options.public &&
      options.renew !== false &&
      (!this.token || this.tokenDeadline <= this.now())
    )
      await this.recover();
    return this.send<T>(path, options, true);
  }
  private async send<T>(
    path: string,
    options: RequestOptions,
    retry: boolean,
  ): Promise<{ data: T; headers: Headers }> {
    const generation = this.generation;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener("abort", cancel, { once: true });
    this.requests.add(controller);
    try {
      const headers = new Headers({
        Accept: options.download
          ? "application/pdf, text/plain, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json"
          : "application/json",
        ...options.headers,
      });
      if (!options.public && this.token)
        headers.set("Authorization", `Bearer ${this.token}`);
      const multipart = options.body instanceof FormData;
      if (options.body !== undefined && !multipart)
        headers.set("Content-Type", "application/json");
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: options.method ?? "GET",
        credentials: "include",
        // Same-origin GET does not carry Origin. Send only the origin as Referer
        // so cookie-session restoration keeps its origin check without URL tokens.
        referrerPolicy: "strict-origin",
        cache: "no-store",
        headers,
        body:
          options.body === undefined
            ? undefined
            : multipart
              ? (options.body as FormData)
              : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const mime = response.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      let data: unknown =
        response.status === 204
          ? undefined
          : mime?.endsWith("json")
            ? await response.json()
            : undefined;
      if (response.ok && options.download && !mime?.endsWith("json")) {
        if (
          !mime ||
          ![
            "application/pdf",
            "text/plain",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ].includes(mime)
        )
          throw Error("La API devolvió un formato de descarga inesperado.");
        const filename = downloadFilename(
          response.headers.get("Content-Disposition"),
        );
        data = {
          bytes: new Uint8Array(await response.arrayBuffer()),
          filename,
          mime,
        };
      }
      if (generation !== this.generation || controller.signal.aborted)
        throw new DOMException("Consulta cancelada", "AbortError");
      if (!response.ok) {
        const error = parseProblem(data, response.status);
        if (
          !options.public &&
          error.status === 401 &&
          error.code !== "CONFIRMATION_EXPIRED"
        ) {
          // Solo una lectura puede repetirse. Nunca se repite una escritura incierta.
          if (retry && (options.method ?? "GET") === "GET") {
            await this.recover();
            if (controller.signal.aborted || generation !== this.generation)
              throw new DOMException("Sesión reemplazada", "AbortError");
            options.signal?.throwIfAborted();
            return this.send<T>(path, options, false);
          }
          this.unauthorized();
        }
        throw error;
      }
      if (
        response.status !== 204 &&
        ((!mime?.endsWith("json") && !options.download) || data === undefined)
      )
        throw Error("La API devolvió una respuesta inesperada.");
      return { data: data as T, headers: response.headers };
    } catch (error) {
      if (error instanceof TypeError)
        throw Error(
          "No se pudo conectar con el servidor. Verificá la conexión antes de consultar nuevamente; una escritura no se reenvía automáticamente.",
        );
      throw error;
    } finally {
      this.requests.delete(controller);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
  async get<T>(path: string, signal?: AbortSignal) {
    return (await this.request<T>(path, { signal })).data;
  }
  async download(path: string, signal?: AbortSignal): Promise<ExportResult> {
    const { data } = await this.request<ExportResult>(path, {
      download: true,
      signal,
    });
    if (data && "bytes" in data) return data;
    if (
      data &&
      "data" in data &&
      Array.isArray(data.data) &&
      data.data.length === 0 &&
      data.total === 0
    )
      return data;
    throw Error("La API devolvió una descarga inesperada.");
  }
  async versioned<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<Versioned<T>> {
    const result = await this.request<T>(path, options);
    const etag = result.headers.get("ETag");
    if (!etag)
      throw Error(
        "La API no entregó la versión del registro. Revisá la exposición de ETag en CORS.",
      );
    return { data: result.data, etag };
  }
}

export function downloadFilename(disposition: string | null): string {
  if (!disposition || !/^attachment(?:;|$)/i.test(disposition))
    throw Error(
      "La API no entregó un nombre de archivo. Revisá Content-Disposition en CORS.",
    );
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename="([^"]+)"/i)?.[1];
  let filename: string;
  try {
    filename = encoded ? decodeURIComponent(encoded) : (plain ?? "");
  } catch {
    throw Error("El nombre del archivo recibido no es válido.");
  }
  if (
    !filename ||
    filename.length > 200 ||
    /[\\/\p{Cc}\p{Cf}]/u.test(filename) ||
    filename === "." ||
    filename === ".."
  )
    throw Error("El nombre del archivo recibido no es válido.");
  return filename;
}

export function unavailable(): never {
  throw Error("Esta ventana todavía no está conectada a la API.");
}
