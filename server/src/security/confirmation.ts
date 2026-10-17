import type { PrismaClient, User } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { AppError } from "../errors.js";
import { verifyPassword } from "./crypto.js";
import { audit } from "./audit.js";

declare module "fastify" {
  interface FastifyRequest {
    confirmedPasswordHash?: string;
  }
}
export function needsConfirmation(
  request: Pick<FastifyRequest, "method" | "url">,
) {
  return (
    ["PATCH", "DELETE"].includes(request.method) &&
    request.url.startsWith("/api/v1/") &&
    request.url.split("?")[0] !== "/api/v1/me/password"
  );
}
export function assertConfirmationCurrent(
  request: FastifyRequest,
  user: Pick<User, "passwordHash">,
) {
  if (
    needsConfirmation(request) &&
    request.confirmedPasswordHash !== user.passwordHash
  )
    throw new AppError(
      401,
      "CONFIRMATION_EXPIRED",
      "La credencial cambió. Volvé a confirmar la operación.",
    );
}
export async function confirmMutation(
  prisma: PrismaClient,
  request: FastifyRequest,
) {
  if (!request.auth || !needsConfirmation(request)) return;
  const params = request.params as { catalog?: string };
  if (
    params.catalog &&
    (request.auth.role === "PUBLICO" ||
      (request.auth.role === "DIGITADOR" &&
        (request.method === "DELETE" ||
          !["autores", "tutores"].includes(params.catalog))))
  )
    throw new AppError(
      403,
      "FORBIDDEN",
      "No tenés permiso para modificar este catálogo.",
    );
  const encoded = request.headers["x-confirmation-password"];
  if (
    typeof encoded !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    encoded.length > 688
  )
    throw new AppError(
      428,
      "CONFIRMATION_REQUIRED",
      "Confirmá la operación con tu contraseña actual.",
    );
  const password = Buffer.from(encoded, "base64").toString("utf8");
  if (
    !password ||
    password.length > 128 ||
    Buffer.from(password, "utf8").toString("base64") !== encoded
  )
    throw new AppError(
      428,
      "CONFIRMATION_REQUIRED",
      "Confirmá la operación con tu contraseña actual.",
    );
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${request.auth!.userId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${request.auth!.sessionId}::uuid FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({
      where: { id: request.auth!.userId },
    });
    const session = await tx.session.findUniqueOrThrow({
      where: { id: request.auth!.sessionId },
    });
    const now = request.server.security.now();
    if (
      !user.active ||
      session.revokedAt ||
      session.expiresAt <= now ||
      now.getTime() - session.lastActivityAt.getTime() >= 600000
    )
      throw new AppError(401, "UNAUTHENTICATED", "La sesión no es válida.");
    if (!(await verifyPassword(user.passwordHash, password))) {
      const failures = session.confirmationFailures + 1;
      await tx.session.update({
        where: { id: session.id },
        data: {
          confirmationFailures: failures,
          ...(failures >= 3 ? { revokedAt: now } : {}),
        },
      });
      if (failures >= 3)
        await tx.refreshToken.updateMany({
          where: { sessionId: session.id, revokedAt: null },
          data: { revokedAt: now },
        });
      await audit(tx, request, {
        operation: "CONFIRMACION_RECHAZADA",
        role: user.role,
        resource: "sesiones",
        resourceId: session.id,
        status: "FALLIDO",
        detail:
          failures >= 3
            ? "Tres confirmaciones incorrectas; sesión compartida cerrada."
            : "Contraseña de confirmación incorrecta.",
        ...(failures >= 3
          ? {
              after: {
                durationSeconds: Math.max(
                  0,
                  Math.floor(
                    (now.getTime() - session.createdAt.getTime()) / 1000,
                  ),
                ),
              },
            }
          : {}),
      });
      return { failed: true, closed: failures >= 3, hash: "" };
    }
    if (session.confirmationFailures)
      await tx.session.update({
        where: { id: session.id },
        data: { confirmationFailures: 0 },
      });
    return { failed: false, closed: false, hash: user.passwordHash };
  });
  if (result.failed) {
    request.auditHandled = true;
    throw new AppError(
      result.closed ? 401 : 400,
      result.closed ? "UNAUTHENTICATED" : "INVALID_CONFIRMATION_PASSWORD",
      result.closed
        ? "La sesión se cerró después de tres confirmaciones incorrectas."
        : "La contraseña de confirmación es incorrecta.",
    );
  }
  request.confirmedPasswordHash = result.hash;
}
