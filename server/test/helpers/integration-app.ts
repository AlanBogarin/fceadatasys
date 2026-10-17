import { createApp as productionApp, type AppOptions } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import type { PrismaClient } from "@prisma/client";
import type { InjectOptions } from "fastify";
import { verifyPassword } from "../../src/security/crypto.js";

const passwords = new Map<string, string>();
const fixtures = [
  "CatalogTest123!",
  "PublicationTest123!",
  "SecureTest123!",
  "QueryTest123!",
  "ReportsTest123!",
  "AttachmentTest123!",
  "ProfileTest2026!",
  "Segura2026!",
];
/** Behaves as a real client: submits actor password and fetches catalog/settings ETags.
 * Explicit headers are never replaced, allowing negative and stale-version cases. */
export async function createApp(
  config: AppConfig,
  prisma: PrismaClient,
  options: AppOptions = {},
) {
  const app = await productionApp(config, prisma, options);
  const inject = app.inject.bind(app);
  app.inject = (async (input: InjectOptions | string) => {
    if (typeof input === "string") return inject(input);
    const request = {
      ...input,
      headers: { ...input.headers } as Record<
        string,
        string | string[] | number | undefined
      >,
    };
    const method = String(request.method ?? "GET").toUpperCase();
    const url = String(request.url);
    const authorization = request.headers.authorization;
    let actorId: string | undefined;
    if (typeof authorization === "string") {
      try {
        actorId = app.jwt.decode<{ sub: string }>(authorization.slice(7))?.sub;
      } catch {}
    }
    if (
      ["PATCH", "DELETE"].includes(method) &&
      url.startsWith("/api/v1/") &&
      url !== "/api/v1/me/password" &&
      actorId
    ) {
      if (request.headers["x-confirmation-password"] === undefined) {
        let password = passwords.get(actorId);
        if (!password) {
          const actor = await prisma.user.findUnique({
            where: { id: actorId },
          });
          if (actor)
            for (const value of fixtures)
              if (await verifyPassword(actor.passwordHash, value)) {
                password = value;
                break;
              }
        }
        if (password)
          request.headers["x-confirmation-password"] =
            Buffer.from(password).toString("base64");
      }
      if (
        request.headers["if-match"] === undefined &&
        (/^\/api\/v1\/catalogos\/[^/]+\/[^/]+$/.test(url) ||
          url === "/api/v1/parametros/publicaciones")
      ) {
        const current = await inject({
          url,
          headers: { authorization: String(authorization) },
        });
        if (current.headers.etag)
          request.headers["if-match"] = current.headers.etag;
        else if (current.statusCode === 404)
          request.headers["if-match"] = '"sha256-' + "0".repeat(64) + '"';
      }
    }
    const response = await inject(request);
    if (
      url === "/api/v1/auth/login" &&
      response.statusCode === 200 &&
      input.payload &&
      typeof input.payload === "object"
    )
      passwords.set(
        response.json().user.id,
        (input.payload as { password: string }).password,
      );
    if (url === "/api/v1/me/password" && response.statusCode === 200 && actorId)
      passwords.set(
        actorId,
        (input.payload as { newPassword: string }).newPassword,
      );
    return response;
  }) as typeof app.inject;
  return app;
}
