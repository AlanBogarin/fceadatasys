import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { apiFixture, testAdmin, testPassword } from "./api-fixture";
import { emptyAuditFilters } from "../src/audit";
import { loadDashboard } from "../src/data/dashboard";
import { ClientProblem } from "../src/data/problems";

const failure = (code: string) => (error: unknown) =>
  error instanceof ClientProblem && error.code === code;

test("Pasos 21–22: auditoría e Inicio con API/PostgreSQL", async (t) => {
  const fixture = await apiFixture();
  t.after(() => fixture.close());
  const browser = fixture.browser();
  const admin = browser.tab();
  await admin.client.auth.initializeBrowser();
  const identity = await admin.client.auth.login(testAdmin, testPassword);
  const suffix = randomUUID().replaceAll("-", "");
  const filters = { ...emptyAuditFilters, search: suffix, module: "auditoria" };
  // Fixtures inmutables para históricos, contenido extenso y límite. Solo INSERT en la base aislada.
  const event = (detail: string, role: "DIGITADOR" | null = "DIGITADOR") => ({
    operation: "OPERACION_RECHAZADA",
    resource: "auditoria",
    status: "FALLIDO" as const,
    detail,
    userId: role ? identity.user.id : null,
    role,
    sessionId: role ? identity.session.id : null,
    ip: "127.0.0.1",
    userAgent: "Fixture integración 21–22",
    before: { name: "Antes", nested: { password: "no divulgar" } },
    after: { name: "Después", nested: { token: "no divulgar" } },
  });
  await fixture.prisma.auditLog.createMany({
    data: [
      event(`${suffix} primero`),
      event(`${suffix} segundo`),
      event(`${suffix} sin identificar`, null),
    ],
  });
  let snapshot = "";

  await t.test(
    "Paginación, totales independientes, username, rol histórico y detalle seguro",
    async () => {
      const list = await admin.client.audit.list(filters, 2, 1);
      assert.equal(list.data.length, 1);
      assert.equal(list.pagination.total, 3);
      assert.equal(list.export.exportable, true);
      assert.ok(list.export.snapshot);
      snapshot = list.export.snapshot;
      assert.equal(list.summary.total, await fixture.prisma.auditLog.count());
      assert.equal(
        list.summary.failed,
        await fixture.prisma.auditLog.count({ where: { status: "FALLIDO" } }),
      );
      assert.ok(list.summary.modules.includes("auditoria"));
      assert.ok(
        list.summary.actors.some(
          (actor) =>
            actor.id === identity.user.id && actor.username === testAdmin,
        ),
      );
      const identified = await admin.client.audit.list({
        ...filters,
        role: "DIGITADOR",
      });
      assert.equal(identified.pagination.total, 2);
      const row = await admin.client.audit.get(identified.data[0].id);
      assert.equal(row.actorRole, "DIGITADOR");
      assert.equal(row.username, testAdmin);
      assert.equal(row.origin, undefined);
      assert.deepEqual(row.before, { name: "Antes", nested: {} });
      assert.deepEqual(row.after, { name: "Después", nested: {} });
      const unidentified = await admin.client.audit.list({
        ...filters,
        role: "SIN_IDENTIFICAR",
      });
      assert.equal(unidentified.pagination.total, 1);
      assert.equal(unidentified.data[0].actorRole, null);
      assert.equal(unidentified.data[0].username, null);
      assert.equal(
        (await admin.client.audit.list(filters, 1, 1)).export.snapshot,
        snapshot,
      );
    },
  );

  await t.test(
    "PDF/Excel incluyen toda la selección, respetan snapshot y auditan antes de entregar bytes",
    async () => {
      for (const format of ["pdf", "xlsx"] as const) {
        const list = await admin.client.audit.list(filters, 1, 1);
        const before = await fixture.prisma.auditLog.count({
          where: { operation: "AUDITORIA_EXPORTADA" },
        });
        const file = await admin.client.audit.export(
          filters,
          format,
          list.export.snapshot!,
        );
        assert.ok("bytes" in file);
        assert.equal(file.filename, `auditoria.${format}`);
        assert.equal(
          await fixture.prisma.auditLog.count({
            where: { operation: "AUDITORIA_EXPORTADA" },
          }),
          before + 1,
        );
        if (format === "pdf")
          assert.equal(
            Buffer.from(file.bytes).subarray(0, 4).toString(),
            "%PDF",
          );
        else {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(file.bytes as unknown as ExcelJS.Buffer);
          assert.deepEqual(
            workbook.worksheets.map((sheet) => sheet.name),
            ["Auditoría", "Detalles", "Criterios"],
          );
          assert.equal(
            workbook.getWorksheet("Auditoría")!.rowCount - 1,
            list.pagination.total,
          );
          assert.ok(list.pagination.total > list.data.length);
        }
      }
      await assert.rejects(
        admin.client.audit.export(filters, "pdf", snapshot),
        failure("AUDIT_VERSION_CONFLICT"),
      );
      const current = await admin.client.audit.list(filters);
      fixture.failingAudit.add("AUDITORIA_EXPORTADA");
      try {
        const before = await fixture.prisma.auditLog.count({
          where: { operation: "AUDITORIA_EXPORTADA" },
        });
        await assert.rejects(
          admin.client.audit.export(filters, "xlsx", current.export.snapshot!),
          failure("AUDIT_UNAVAILABLE"),
        );
        assert.equal(
          await fixture.prisma.auditLog.count({
            where: { operation: "AUDITORIA_EXPORTADA" },
          }),
          before,
        );
      } finally {
        fixture.failingAudit.clear();
      }
    },
  );

  await t.test(
    "Vacío y límite no fabrican archivos; filtros inválidos preservan Problem Details",
    async () => {
      const emptyFilters = {
        ...filters,
        search: `inexistente${randomUUID().replaceAll("-", "")}`,
      };
      const empty = await admin.client.audit.list(emptyFilters);
      assert.equal(empty.pagination.total, 0);
      assert.equal(empty.export.snapshot, null);
      assert.equal(empty.export.exportable, false);
      assert.deepEqual(
        await admin.client.audit.export(emptyFilters, "pdf", snapshot),
        { data: [], total: 0 },
      );
      const limit = `limite${suffix}`;
      await fixture.prisma.auditLog.createMany({
        data: Array.from({ length: 501 }, () => event(limit)),
      });
      admin.client.audit.invalidateOptions?.();
      const tooMany = await admin.client.audit.list(
        { ...filters, search: limit },
        1,
        10,
      );
      assert.equal(tooMany.pagination.total, 501);
      assert.equal(tooMany.data.length, 10);
      assert.equal(tooMany.export.snapshot, null);
      assert.equal(tooMany.export.exportable, false);
      await assert.rejects(
        admin.client.audit.export(
          { ...filters, search: limit },
          "pdf",
          snapshot,
        ),
        failure("AUDIT_EXPORT_LIMIT"),
      );
      await assert.rejects(
        admin.client.audit.list({
          ...filters,
          from: "2026-10-19",
          to: "2026-10-18",
        }),
        failure("VALIDATION_ERROR"),
      );
    },
  );

  await t.test(
    "Inicio usa totales reales y los tres roles conservan permisos y sesiones independientes",
    async () => {
      const home = await loadDashboard(admin.client);
      assert.equal(home.user.id, identity.user.id);
      assert.equal(home.users?.total, await fixture.prisma.user.count());
      assert.equal(home.publications, await fixture.prisma.publication.count());
      for (const role of ["DIGITADOR", "PUBLICO"] as const) {
        const username = `cierre.${role.toLowerCase()}.${suffix.slice(0, 8)}`;
        const account = await admin.client.users.create(
          {
            name: `Cierre ${role}`,
            ci: fixture.ci(),
            email: `${username}@example.test`,
            username,
            role,
            active: true,
          },
          testPassword,
        );
        const otherBrowser = fixture.browser();
        const tab = otherBrowser.tab();
        await tab.client.auth.initializeBrowser();
        await tab.client.auth.login(username, testPassword);
        const data = await loadDashboard(tab.client);
        assert.equal(data.user.id, account.id);
        assert.equal(data.users, undefined);
        assert.equal(
          data.publications,
          await fixture.prisma.publication.count({ where: { active: true } }),
        );
        await assert.rejects(
          tab.client.audit.list({ ...emptyAuditFilters }),
          failure("FORBIDDEN"),
        );
        await assert.rejects(
          tab.client.audit.get(
            (await fixture.prisma.auditLog.findFirstOrThrow()).id,
          ),
          failure("FORBIDDEN"),
        );
        await assert.rejects(
          tab.client.audit.export(filters, "pdf", snapshot),
          failure("FORBIDDEN"),
        );
        await tab.client.auth.logout();
        assert.equal(
          (await loadDashboard(admin.client)).user.id,
          identity.user.id,
        );
      }
      const before = (await loadDashboard(admin.client)).users!.total;
      assert.equal(before, await fixture.prisma.user.count());
      const another = browser.tab();
      await another.runtime.restore();
      assert.equal((await loadDashboard(another.client)).users!.total, before);
      const readonly = await fixture.app.inject({
        method: "PATCH",
        url: "/api/v1/auditoria/00000000-0000-4000-8000-000000000000",
        payload: {},
      });
      assert.equal(readonly.statusCode, 404);
    },
  );
});
