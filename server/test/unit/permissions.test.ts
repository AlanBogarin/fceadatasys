import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient, Prisma, User } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import {
  initialPolicy,
  permissionsFor,
  policySchema,
  canonicalPolicy,
  assertPermissionAdministratorRemains,
  protectUserPrivileges,
  assertRequestPermission,
} from "../../src/security/permissions.js";
import { contentEtag } from "../../src/concurrency.js";
import { requirePermission } from "../../src/security/index.js";

const id = "11111111-1111-4111-8111-111111111111";
test("la versión no depende del orden de claves JSONB de las excepciones", () => {
  assert.equal(
    contentEtag(
      canonicalPolicy({
        users: { [id]: { "users.delete": false, "audit.export": false } },
      }),
    ),
    contentEtag(
      canonicalPolicy({
        users: { [id]: { "audit.export": false, "users.delete": false } },
      }),
    ),
  );
});
test("roles iniciales conservan accesos; excepciones permiten y deniegan acciones por cuenta", () => {
  const policy = initialPolicy();
  assert.ok(
    permissionsFor(policy, { id, role: "ADMINISTRADOR" }).includes(
      "audit.export",
    ),
  );
  assert.ok(
    !permissionsFor(policy, { id, role: "DIGITADOR" }).includes("reports.read"),
  );
  policy.roles.DIGITADOR.push("reports.read");
  assert.ok(
    permissionsFor(policy, { id, role: "DIGITADOR" }).includes("reports.read"),
  );
  policy.users[id] = { "audit.export": false, "users.delete": false };
  assert.ok(
    !permissionsFor(policy, { id, role: "ADMINISTRADOR" }).includes(
      "audit.export",
    ),
  );
  assert.ok(
    permissionsFor(policy, { id, role: "ADMINISTRADOR" }).includes(
      "audit.read",
    ),
  );
  assert.ok(
    !policySchema.safeParse({
      ...policy,
      roles: { ...policy.roles, PUBLICO: ["inventado"] },
    }).success,
  );
});
test("el último Administrador con gestión de permisos se protege aunque haya otros administradores restringidos", async () => {
  const policy = initialPolicy();
  policy.users[id] = { "permissions.manage": false };
  const db = {
    accessPolicy: { findUniqueOrThrow: async () => ({ policy }) },
    user: { findMany: async () => [{ id, role: "ADMINISTRADOR" }] },
  } as unknown as PrismaClient;
  await assert.rejects(assertPermissionAdministratorRemains(db), {
    code: "LAST_PERMISSION_ADMIN_REQUIRED",
  });
  delete policy.users[id];
  await assertPermissionAdministratorRemains(db);
});
test("un gestor de usuarios restringido no puede asignarse un rol ni controlar a un administrador superior", async () => {
  const policy = initialPolicy();
  policy.roles.DIGITADOR.push("users.read", "users.manage");
  const db = {
    accessPolicy: { findUniqueOrThrow: async () => ({ policy }) },
  } as unknown as PrismaClient;
  const actor = { id, role: "DIGITADOR" } as User;
  await assert.rejects(
    protectUserPrivileges(db, actor, undefined, "ADMINISTRADOR"),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(
    protectUserPrivileges(db, actor, {
      id: "other",
      role: "ADMINISTRADOR",
    } as User),
    { code: "FORBIDDEN" },
  );
  await protectUserPrivileges(db, actor, undefined, "PUBLICO");
  policy.roles.PUBLICO.push("audit.read");
  await assert.rejects(protectUserPrivileges(db, actor, undefined, "PUBLICO"), {
    code: "FORBIDDEN",
  });
});
test("el guard usa permisos persistidos de la sesión, y la transacción vuelve a comprobar una revocación", async () => {
  const policy = initialPolicy();
  policy.roles.DIGITADOR.push("audit.read");
  const now = new Date();
  const user = { id, role: "DIGITADOR", active: true } as User;
  const session = {
    id,
    userId: id,
    user,
    expiresAt: new Date(now.getTime() + 100000),
    lastActivityAt: now,
    revokedAt: null,
  };
  const db = {
    accessPolicy: { findUniqueOrThrow: async () => ({ policy }) },
    session: { findUnique: async () => session },
    $queryRaw: async () => [],
  } as unknown as PrismaClient;
  const request = {
    headers: { authorization: "Bearer signed" },
    server: {
      jwt: { verify: () => ({ sub: id, sid: id, iat: 1, exp: 9999999999 }) },
      security: { prisma: db, now: () => now },
    },
  } as unknown as FastifyRequest;
  const guard = requirePermission("audit.read") as (
    request: FastifyRequest,
  ) => Promise<void>;
  await guard(request);
  assert.ok(request.auth!.permissions.includes("audit.read"));
  policy.roles.DIGITADOR = policy.roles.DIGITADOR.filter(
    (key) => key !== "audit.read",
  );
  await assert.rejects(
    assertRequestPermission(db as Prisma.TransactionClient, request, user),
    { code: "FORBIDDEN" },
  );
  await assert.rejects(guard(request), { code: "FORBIDDEN" });
});
