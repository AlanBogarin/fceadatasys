import { createServer } from "node:net";
import { createRequire } from "node:module";
import { randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Scanner } from "../../server/src/attachments/scanner.js";
import { createApp } from "../../server/src/app.js";
import { createPrisma } from "../../server/src/db.js";
import { createMailer } from "../../server/src/security/mailer.js";
import { HttpTransport } from "../src/data/http";
import { ApiSession, type SessionBus } from "../src/data/apiSession";
import { createApiClient, type ConfirmMutation } from "../src/data/apiClient";

export const testPassword = "ConexionCliente2026!";
export const testAdmin = "integration-admin";
export async function apiFixture(options: { scanner?: Scanner } = {}) {
  const databaseUrl = process.env.CLIENT_API_TEST_DATABASE_URL;
  if (!databaseUrl)
    throw Error(
      "Falta CLIENT_API_TEST_DATABASE_URL (base exclusiva de integración del cliente).",
    );
  const url = new URL(databaseUrl);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55439" ||
    url.pathname !== "/fceadatasys_client_connection_test"
  )
    throw Error(
      "La prueba solo admite la base aislada del cliente en 127.0.0.1:55439.",
    );
  const prisma = createPrisma(databaseUrl);
  const role = await prisma.$queryRaw<
    { rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean }[]
  >`SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user`;
  if (role[0]?.rolsuper || role[0]?.rolcreatedb || role[0]?.rolcreaterole)
    throw Error("Las pruebas deben usar el rol runtime limitado.");
  let offset = 0;
  const mailbox: { recipient: string; token: string; url: string }[] = [];
  const sockets = new Set<import("node:net").Socket>();
  const smtp = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write("220 localhost SMTP integration\r\n");
    let input = "",
      data = false,
      message = "",
      recipient = "";
    socket.on("data", (chunk) => {
      input += chunk.toString();
      while (input.includes("\r\n")) {
        const end = input.indexOf("\r\n");
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        if (data) {
          if (line === ".") {
            const decoded = message.replace(/=\r\n/g, "").replace(/=3D/gi, "=");
            const link = decoded.match(
              /http:\/\/127\.0\.0\.1:5173\/\?token=([a-f0-9]{64})/,
            );
            if (link) mailbox.push({ recipient, token: link[1], url: link[0] });
            socket.write("250 Message accepted\r\n");
            data = false;
          } else message += line + "\r\n";
        } else if (/^EHLO|^HELO/i.test(line))
          socket.write("250-localhost\r\n250 PIPELINING\r\n");
        else if (/^DATA/i.test(line)) {
          data = true;
          message = "";
          socket.write("354 End with dot\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 Bye\r\n");
        else {
          if (/^RCPT TO:/i.test(line))
            recipient = line.slice(8).replace(/[<>]/g, "").trim();
          socket.write("250 OK\r\n");
        }
      }
    });
  });
  await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
  const smtpPort = (smtp.address() as import("node:net").AddressInfo).port;
  const config = {
    nodeEnv: "test" as const,
    host: "127.0.0.1",
    port: 0,
    databaseUrl,
    jwtSecret: "client-integration-test-secret-".repeat(3),
    jwtIssuer: "client-integration",
    jwtAudience: "client-integration",
    allowedOrigins: ["http://127.0.0.1:5173"],
    secureCookies: false,
    recoveryUrl: "http://127.0.0.1:5173/",
    attachments: {
      directory: fileURLToPath(
        new URL(
          "../../server/.local/client-connection-attachments/",
          import.meta.url,
        ),
      ),
      command: "C:\\Program Files\\ClamAV\\clamscan.exe",
      database: fileURLToPath(
        new URL("../../server/.local/clamav/database/", import.meta.url),
      ),
      timeoutMs: 120000,
      maxSignatureAgeDays: 7,
      concurrency: 2,
    },
    smtp: {
      host: "127.0.0.1",
      port: smtpPort,
      from: "repository@example.test",
      secure: false,
    },
  };
  const nodemailer = createRequire(
    new URL("../../server/package.json", import.meta.url),
  )("nodemailer");
  // Transporte SMTP real hacia un buzón local desechable. Solo este fixture permite texto plano.
  const mailer = createMailer(config, {
    createTransport: (options) =>
      nodemailer.createTransport({ ...options, requireTLS: false }),
  });
  await mailer.verify();
  const failingAudit = new Set<string>();
  const audited = prisma.$extends({
    query: {
      auditLog: {
        create: ({ args, query }) => {
          if (failingAudit.has(args.data.operation))
            throw Error("Fallo de auditoría inyectado por el fixture.");
          return query(args);
        },
      },
    },
  }) as unknown as typeof prisma;
  const app = await createApp(config, audited, {
    logger: false,
    security: { mailer, now: () => new Date(Date.now() + offset) },
    attachments: { scanner: options.scanner },
  });
  let sequence = 0;
  const ipSeed = randomInt(1, 16_000_000);
  function browser(
    confirm: ConfirmMutation = async (request) =>
      request.password ? testPassword : undefined,
  ) {
    let tail = Promise.resolve();
    const sharedLock = async <T>(work: () => Promise<T>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await work();
      } finally {
        release();
      }
    };
    const cookies = new Map<string, string>();
    const listeners = new Set<
      (value: "closed" | "session" | "data" | "activity") => void
    >();
    const bus: SessionBus = {
      send(value) {
        for (const listener of listeners) listener(value);
      },
      listen(callback) {
        listeners.add(callback);
        return () => {
          listeners.delete(callback);
        };
      },
    };
    const fetcher: typeof fetch = async (input, init) => {
      const path =
        new URL(String(input)).pathname + new URL(String(input)).search;
      const headers = Object.fromEntries(new Headers(init?.headers));
      headers.origin = config.allowedOrigins[0];
      if (path.startsWith("/api/v1/auth"))
        headers.cookie = [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; ");
      init?.signal?.throwIfAborted();
      let payload: string | Buffer | undefined;
      if (init?.body instanceof FormData) {
        const encoded = new Request("http://127.0.0.1/multipart", {
          method: "POST",
          body: init.body,
        });
        headers["content-type"] = encoded.headers.get("content-type")!;
        payload = Buffer.from(await encoded.arrayBuffer());
      } else payload = init?.body ? String(init.body) : undefined;
      const address = (ipSeed + ++sequence) % 16_777_216;
      const response = await app.inject({
        method: (init?.method ?? "GET") as "GET",
        url: path,
        headers,
        payload,
        remoteAddress: `10.${address >>> 16}.${(address >>> 8) & 255}.${address & 255}`,
      });
      for (const cookie of response.cookies)
        if (!cookie.value) cookies.delete(cookie.name);
        else cookies.set(cookie.name, cookie.value);
      return new Response(
        response.statusCode === 204
          ? null
          : new Uint8Array(response.rawPayload),
        {
          status: response.statusCode,
          headers: Object.fromEntries(
            Object.entries(response.headers)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(",") : String(value),
              ]),
          ),
        },
      );
    };
    function tab() {
      const runtime = new ApiSession(
        new HttpTransport(
          "http://127.0.0.1:3000/api/v1",
          fetcher,
          () => Date.now() + offset,
        ),
        sharedLock,
        bus,
        () => Date.now() + offset,
      );
      return { runtime, client: createApiClient(runtime, confirm) };
    }
    return { tab, cookies };
  }
  return {
    app,
    prisma,
    mailbox,
    config,
    failingAudit,
    browser,
    async smtpOffline() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
      await mailer.verify();
      if (mailer.available)
        throw Error("El SMTP de pruebas debía quedar indisponible.");
    },
    async smtpOnline() {
      await new Promise<void>((resolve) =>
        smtp.listen(smtpPort, "127.0.0.1", resolve),
      );
      await mailer.verify();
      if (!mailer.available) throw Error("El SMTP de pruebas no se recuperó.");
    },
    advance(ms: number) {
      offset += ms;
    },
    ci: () => String(randomInt(10000000, 99999999)),
    async close() {
      await app.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => smtp.close(() => resolve()));
      await prisma.$disconnect();
    },
  };
}
