import http from "node:http";
import https from "node:https";
import { readFileSync, createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve, relative, extname } from "node:path";
import { Transform } from "node:stream";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { isIP } from "node:net";
import { localPath } from "./config.mjs";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};
const hopHeaders = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];
function cleanHeaders(headers) {
  const result = { ...headers };
  const named = String(headers.connection ?? "")
    .toLowerCase()
    .split(",")
    .map((value) => value.trim());
  for (const key of [
    ...hopHeaders,
    ...named,
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
  ])
    delete result[key];
  return result;
}
export function createGateway(root, config) {
  const origin = new URL(config.PUBLIC_URL);
  const directory = resolve(root, "client/dist");
  const fail = (response, status, message) => {
    const path = (response.req.url ?? "/").split("?")[0];
    const api = path === "/api/v1" || path.startsWith("/api/v1/");
    if (response.headersSent) return response.destroy();
    response.writeHead(status, {
      "content-type": api
        ? "application/problem+json"
        : "text/plain; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(
      api
        ? JSON.stringify({
            status,
            code: "GATEWAY_ERROR",
            title: "Error de acceso al servicio",
            detail: message,
            timestamp: new Date().toISOString(),
            path,
          })
        : message,
    );
  };
  async function handle(request, response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    if (origin.protocol === "https:")
      response.setHeader("Strict-Transport-Security", "max-age=31536000");
    if (request.headers.host !== origin.host)
      return fail(response, 421, "Dominio no configurado.");
    const raw = (request.url ?? "/").split("?")[0];
    let pathname;
    try {
      pathname = decodeURIComponent(raw);
    } catch {
      return fail(response, 400, "Ruta inválida.");
    }
    if (
      !pathname.startsWith("/") ||
      /[\\\0:]/.test(pathname) ||
      pathname.split("/").some((part) => part === ".." || part.startsWith("."))
    )
      return fail(response, 404, "No encontrado.");
    if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
      const limit = 26 * 1024 * 1024;
      if (+request.headers["content-length"] > limit)
        return fail(response, 413, "Solicitud demasiado grande.");
      const headers = cleanHeaders(request.headers);
      headers.host = origin.host;
      headers["x-forwarded-for"] = request.socket.remoteAddress;
      headers["x-forwarded-host"] = origin.host;
      headers["x-forwarded-proto"] = origin.protocol.slice(0, -1);
      const upstream = http.request(
        {
          hostname: "127.0.0.1",
          port: +config.API_PORT,
          path: request.url,
          method: request.method,
          headers,
          timeout: 180000,
          agent: false,
        },
        (incoming) => {
          if (response.destroyed) return incoming.destroy();
          response.writeHead(incoming.statusCode ?? 502, {
            ...cleanHeaders(incoming.headers),
            "cache-control": "no-store",
          });
          incoming.on("error", () => response.destroy());
          incoming.pipe(response);
        },
      );
      upstream.on("timeout", () => upstream.destroy());
      upstream.on("error", () =>
        fail(response, 502, "La API no está disponible."),
      );
      let received = 0;
      const bounded = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > limit) {
            fail(response, 413, "Solicitud demasiado grande.");
            callback(Error("Límite de cuerpo"));
          } else callback(null, chunk);
        },
      });
      bounded.on("error", () => upstream.destroy());
      request.on("error", () => upstream.destroy());
      request.on("aborted", () => upstream.destroy());
      response.on("close", () => {
        if (!response.writableFinished) upstream.destroy();
      });
      request.pipe(bounded).pipe(upstream);
      return;
    }
    if (!["GET", "HEAD"].includes(request.method))
      return fail(response, 405, "Método no permitido.");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (pathname === "/runtime-config.js") {
      const body =
        "window.__FCEA_CONFIG__=" +
        JSON.stringify({
          apiBaseUrl: origin.origin + "/api/v1",
          profile: config.PROFILE,
        }) +
        ";\n";
      response.writeHead(200, {
        "content-type": mime[".js"],
        "cache-control": "no-store",
      });
      return response.end(request.method === "HEAD" ? undefined : body);
    }
    const asset = pathname === "/" ? "/index.html" : pathname;
    if (!mime[extname(asset)] || asset.startsWith("/demo/"))
      return fail(response, 404, "No encontrado.");
    try {
      const [base, file] = await Promise.all([
        realpath(directory),
        realpath(resolve(directory, "." + asset)),
      ]);
      const rel = relative(base, file);
      if (rel.startsWith("..") || !rel || !(await stat(file)).isFile())
        return fail(response, 404, "No encontrado.");
      const metadata = await stat(file);
      response.writeHead(200, {
        "content-type": mime[extname(file)],
        "content-length": metadata.size,
        "cache-control": asset.startsWith("/assets/")
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      if (request.method === "HEAD") return response.end();
      const stream = createReadStream(file);
      stream.on("error", () => response.destroy());
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch {
      fail(response, 404, "No encontrado.");
    }
  }
  const listener = (request, response) => {
    handle(request, response).catch(() =>
      fail(response, 500, "No se pudo atender la solicitud."),
    );
  };
  let credentials;
  if (origin.protocol === "https:") {
    const cert = readFileSync(localPath(root, config.TLS_CERT_FILE)),
      key = readFileSync(localPath(root, config.TLS_KEY_FILE));
    const certificate = new X509Certificate(cert),
      hostname = origin.hostname.replace(/^\[|\]$/g, "");
    if (
      Date.now() < Date.parse(certificate.validFrom) ||
      Date.now() >= Date.parse(certificate.validTo) ||
      !certificate.checkPrivateKey(createPrivateKey(key)) ||
      !(isIP(hostname)
        ? certificate.checkIP(hostname)
        : certificate.checkHost(hostname))
    )
      throw Error(
        "Certificado TLS vencido, de otro dominio o con clave incorrecta.",
      );
    credentials = { cert, key, minVersion: "TLSv1.2" };
  }
  const server = credentials
    ? https.createServer(credentials, listener)
    : http.createServer(listener);
  server.requestTimeout = 180000;
  server.headersTimeout = 15000;
  server.maxHeadersCount = 100;
  return server;
}
