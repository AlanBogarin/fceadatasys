import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { canOpenPage } from "./security";
import { hasPermission } from "./permissions";
import { AuditChanges } from "./AuditChanges";

test("navegación y acciones usan permisos efectivos y permiten ampliar el rol Digitador", () => {
  const digitador = {
    role: "DIGITADOR" as const,
    permissions: ["reports.read"],
  };
  assert.ok(canOpenPage(digitador, "reportes"));
  assert.ok(!canOpenPage(digitador, "archivos"));
  const admin = { role: "ADMINISTRADOR" as const, permissions: ["audit.read"] };
  assert.ok(canOpenPage(admin, "auditoria"));
  assert.ok(!hasPermission(admin, "audit.export"));
  assert.ok(!canOpenPage(admin, "roles"));
  assert.ok(canOpenPage(admin, "perfil"));
  assert.ok(!canOpenPage(admin, "desconocido"));
});
test("auditoría presenta nombres legibles, colecciones y booleanos y escapa HTML", () => {
  const html = renderToStaticMarkup(
    createElement(AuditChanges, {
      before: { name: "<script>alert(1)</script>", active: false },
      after: {
        authors: [{ name: "Ana" }],
        summaryWordLimit: 300,
        active: true,
      },
    }),
  );
  assert.ok(html.includes("Nombre completo"));
  assert.ok(html.includes("Límite de palabras"));
  assert.ok(html.includes("Sí"));
  assert.ok(html.includes("No"));
  assert.ok(html.includes("Ana"));
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<pre>"));
  assert.ok(html.includes("JSON (técnico)"));
  assert.ok(html.includes("Raw (técnico)"));
});
