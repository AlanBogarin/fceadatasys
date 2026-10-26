import type { FastifyInstance } from "fastify";
import type { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { userDto } from "../users/dto.js";
import { assertVersion, contentEtag, requireIfMatch } from "../concurrency.js";
import { AppError } from "../errors.js";
import { audit, authenticate, requirePermission } from "./index.js";
import { assertConfirmationCurrent } from "./confirmation.js";
import {
  assertRequestPermission,
  assertPermissionAdministratorRemains,
  canonicalPolicy,
  loadPolicy,
  permissionDefinitions,
  permissionsFor,
  policySchema,
} from "./permissions.js";

export async function registerPermissionRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  app.get(
    "/api/v1/permisos/usuarios",
    { preHandler: requirePermission("permissions.manage") },
    async (request) => {
      const { search, page } = z
        .object({
          search: z.string().max(100).default(""),
          page: z.coerce.number().int().min(1).max(100000).default(1),
        })
        .strict()
        .parse(request.query);
      const literal = search.replace(/[\\%_]/g, "\\$&");
      const where: Prisma.UserWhereInput = search
        ? {
            OR: ["name", "username", "ci"].map((field) => ({
              [field]: { contains: literal, mode: "insensitive" },
            })),
          }
        : {};
      const [total, users] = await prisma.$transaction([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          orderBy: [{ name: "asc" }, { id: "asc" }],
          skip: (page - 1) * 20,
          take: 20,
        }),
      ]);
      return {
        data: users.map(userDto),
        pagination: {
          page,
          pageSize: 20,
          total,
          totalPages: Math.ceil(total / 20),
        },
      };
    },
  );
  app.get(
    "/api/v1/permisos/efectivos",
    { preHandler: authenticate },
    (request) => ({ permissions: request.auth!.permissions }),
  );
  app.get(
    "/api/v1/permisos",
    { preHandler: requirePermission("permissions.manage") },
    async (_request, reply) => {
      const policy = await loadPolicy(prisma);
      return reply
        .header("ETag", contentEtag(canonicalPolicy(policy)))
        .send({ ...policy, definitions: permissionDefinitions });
    },
  );
  app.patch(
    "/api/v1/permisos",
    { preHandler: requirePermission("permissions.manage") },
    async (request, reply) => {
      const input = policySchema.parse(request.body);
      const expected = requireIfMatch(request.headers["if-match"]);
      const result = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(741901)`;
          await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${request.auth!.userId}::uuid FOR UPDATE`;
          const actor = await tx.user.findUniqueOrThrow({
            where: { id: request.auth!.userId },
          });
          const session = await tx.session.findUniqueOrThrow({
            where: { id: request.auth!.sessionId },
          });
          const now = app.security.now();
          if (
            !actor.active ||
            session.revokedAt ||
            session.expiresAt <= now ||
            now.getTime() - session.lastActivityAt.getTime() >= 600000
          )
            throw new AppError(
              401,
              "UNAUTHENTICATED",
              "La sesión no es válida o ha vencido.",
            );
          assertConfirmationCurrent(request, actor);
          await assertRequestPermission(tx, request, actor);
          await tx.$queryRaw`SELECT id FROM permisos_sistema WHERE id = 1 FOR UPDATE`;
          const before = await loadPolicy(tx);
          assertVersion(expected, canonicalPolicy(before));
          const ids = Object.keys(input.users);
          if (
            ids.length &&
            (await tx.user.count({ where: { id: { in: ids } } })) !== ids.length
          )
            throw new AppError(
              400,
              "VALIDATION_ERROR",
              "Una de las cuentas seleccionadas ya no existe.",
            );
          const accounts = ids.length
            ? await tx.user.findMany({
                where: { id: { in: ids }, role: { not: "ADMINISTRADOR" } },
              })
            : [];
          if (
            accounts.some(
              (user) =>
                input.users[user.id]?.["permissions.manage"] === true ||
                input.users[user.id]?.["backups.manage"] === true,
            )
          )
            throw new AppError(
              400,
              "VALIDATION_ERROR",
              "Administrar permisos y copias requiere el rol Administrador.",
            );
          for (const role of ["DIGITADOR", "PUBLICO"] as const)
            if (
              input.roles[role].some((key) =>
                ["permissions.manage", "backups.manage"].includes(key),
              )
            )
              throw new AppError(
                400,
                "VALIDATION_ERROR",
                "Administrar permisos y copias requiere el rol Administrador.",
              );
          await tx.accessPolicy.update({
            where: { id: 1 },
            data: { policy: input as Prisma.InputJsonValue },
          });
          await assertPermissionAdministratorRemains(tx);
          await audit(tx, request, {
            operation: "PERMISOS_MODIFICADOS",
            resource: "permisos_sistema",
            resourceId: "1",
            status: "EXITO",
            before,
            after: input,
          });
          return {
            ...input,
            definitions: permissionDefinitions,
            permissions: permissionsFor(input, actor),
          };
        },
        { isolationLevel: "ReadCommitted" },
      );
      return reply
        .header("ETag", contentEtag(canonicalPolicy(input)))
        .send(result);
    },
  );
}
