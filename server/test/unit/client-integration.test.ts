import test from "node:test";
import assert from "node:assert/strict";
import type { FastifyRequest } from "fastify";
import ExcelJS from "exceljs";
import {
  auditQuery,
  auditDocument,
  safeAuditValue,
} from "../../src/auditing/routes.js";
import {
  contentEtag,
  requireIfMatch,
  assertVersion,
} from "../../src/concurrency.js";
import { attachmentQuery } from "../../src/attachments/list.js";
import {
  assertConfirmationCurrent,
  needsConfirmation,
} from "../../src/security/confirmation.js";
import { publicationQuerySchema } from "../../src/publications/schemas.js";

test("Versiones de recursos rechazan precargas ausentes, débiles y desactualizadas", () => {
  const before = { name: "Inicial", active: true };
  const tag = contentEtag(before);
  assert.equal(requireIfMatch(tag), tag);
  assert.doesNotThrow(() => assertVersion(tag, before));
  assert.throws(() => requireIfMatch(undefined), {
    code: "PRECONDITION_REQUIRED",
  });
  for (const value of ["*", `W/${tag}`, `${tag},${tag}`])
    assert.throws(() => requireIfMatch(value), { code: "VALIDATION_ERROR" });
  assert.throws(() => assertVersion(tag, { ...before, name: "Nuevo" }), {
    code: "RESOURCE_VERSION_CONFLICT",
  });
});
test("Auditoría valida fechas/rangos, rol histórico y query estricta", () => {
  assert.equal(
    auditQuery.parse({
      role: "SIN_IDENTIFICAR",
      from: "2026-10-01",
      to: "2026-10-17",
    }).role,
    "SIN_IDENTIFICAR",
  );
  for (const query of [
    { from: "2026-02-30" },
    { from: "2026-10-17", to: "2026-10-01" },
    { role: "ROOT" },
    { pageSize: 101 },
    { password: "x" },
  ])
    assert.equal(auditQuery.safeParse(query).success, false);
});
test("Proyección y exportación de auditoría eliminan secretos anidados", () => {
  const value = {
    name: "Persona",
    password: "secret",
    salt: "secret",
    passwordHash: "secret",
    nested: { token: "secret", storageKey: "private", detail: "token=secret" },
    items: [{ contraseña: "secret", name: "Visible" }],
  };
  const result = JSON.stringify(safeAuditValue(value));
  assert.ok(!result.includes("secret"));
  assert.ok(!result.includes("private"));
  assert.ok(result.includes("Visible"));
});
test("Documento de auditoría exporta PDF A4 y Excel literal sin perder textos extensos", async () => {
  const long = "Texto áéíóú ".repeat(4000);
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    createdAt: "2026-10-17T12:00:00Z",
    actorId: null,
    actorName: "=SUM(1,2)",
    username: null,
    actorRole: null,
    operation: "LOGIN",
    module: "sesiones",
    resourceId: null,
    publicationId: null,
    ip: "127.0.0.1",
    userAgent: "Prueba",
    sessionId: null,
    status: "FALLIDO" as const,
    detail: long,
    before: null,
    after: null,
  };
  const bytes = await auditDocument([row], { role: "SIN_IDENTIFICAR" }, "xlsx");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const sheet = workbook.getWorksheet("Auditoría")!;
  assert.equal(sheet.getCell(2, 4).value, "=SUM(1,2)");
  assert.equal(sheet.getCell(2, 4).type, ExcelJS.ValueType.String);
  const detail = workbook.getWorksheet("Detalles")!;
  const parts: string[] = [];
  detail.eachRow((r, index) => {
    if (index > 1) parts.push(String(r.getCell(4).value));
  });
  assert.equal(parts.join(""), long);
  const pdf = await auditDocument(
    [{ ...row, detail: "Acceso rechazado · áéíóú" }],
    {},
    "pdf",
  );
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.includes(Buffer.from("595.28 841.89")));
});
test("Confirmación se exige para mutaciones y detecta cambios concurrentes de credencial", () => {
  const request = {
    method: "PATCH",
    url: "/api/v1/catalogos/autores/id",
    confirmedPasswordHash: "before",
  } as FastifyRequest;
  assert.equal(needsConfirmation(request), true);
  assert.doesNotThrow(() =>
    assertConfirmationCurrent(request, { passwordHash: "before" }),
  );
  assert.throws(
    () => assertConfirmationCurrent(request, { passwordHash: "after" }),
    { code: "CONFIRMATION_EXPIRED" },
  );
  assert.equal(
    needsConfirmation({ method: "POST", url: "/api/v1/publicaciones" }),
    false,
  );
  assert.equal(
    needsConfirmation({ method: "PATCH", url: "/api/v1/me/password" }),
    false,
  );
});
test("Adjuntos y búsqueda por personas admiten filtros acotados sin ampliar directorios", () => {
  assert.equal(
    attachmentQuery.parse({ status: "PENDIENTE" }).status,
    "PENDIENTE",
  );
  for (const query of [
    { status: "CLEAN" },
    { page: 0 },
    { pageSize: 101 },
    { storageKey: "private" },
  ])
    assert.equal(attachmentQuery.safeParse(query).success, false);
  const query = publicationQuerySchema.parse({
    author: "Ángela",
    tutor: "José",
  });
  assert.equal(query.author, "Ángela");
  assert.equal(query.tutor, "José");
  assert.equal(
    publicationQuerySchema.safeParse({ author: "x".repeat(151) }).success,
    false,
  );
});
