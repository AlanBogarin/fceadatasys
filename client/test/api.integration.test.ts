import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { apiFixture, testAdmin, testPassword } from "./api-fixture";
import { ClientProblem } from "../src/data/problems";
import { mutationHeaders } from "../src/data/http";
import type { CatalogInput } from "../src/catalogs";
import type { CatalogDto } from "../src/data/contracts";

test("Pasos 1–10: adaptador del cliente contra API, PostgreSQL runtime y SMTP local", async (t) => {
  const f = await apiFixture();
  t.after(() => f.close());
  const suffix = randomUUID().slice(0, 8);
  const adminBrowser = f.browser();
  const a = adminBrowser.tab();
  const code = (expected: string) => (error: unknown) =>
    error instanceof ClientProblem && error.code === expected;
  await a.client.auth.initializeBrowser();
  const logged = await a.client.auth.login(testAdmin, testPassword);
  const actor = logged.user;
  let digitador!: Awaited<ReturnType<typeof a.client.users.create>>;
  let publico!: typeof digitador;

  await t.test(
    "1: restauración, segunda pestaña, segundo login y refresh sin renovar actividad",
    async () => {
      const b = adminBrowser.tab();
      assert.equal((await b.runtime.restore()).user.id, actor.id);
      await assert.rejects(
        b.client.auth.login(testAdmin, testPassword),
        code("BROWSER_SESSION_ACTIVE"),
      );
      const before = await a.client.auth.session();
      const after = await a.client.auth.refresh();
      assert.equal(before.session.id, after.session.id);
      assert.equal(before.session.idleExpiresAt, after.session.idleExpiresAt);
      assert.equal(
        (await a.client.auth.activity()).session.id,
        before.session.id,
      );
    },
  );
  await t.test(
    "2: perfil, contraseña incorrecta, duplicados y persistencia",
    async () => {
      await assert.rejects(
        a.client.users.profile(
          { name: actor.name, email: actor.email, username: actor.username },
          { confirmationPassword: "incorrecta123" },
        ),
        code("INVALID_CONFIRMATION_PASSWORD"),
      );
      const email = `admin-${suffix}@example.test`;
      const updated = await a.client.users.profile({
        name: actor.name,
        username: actor.username,
        email,
      });
      assert.equal(a.runtime.getSnapshot().session!.user.email, email);
      assert.equal(
        (await adminBrowser.tab().runtime.restore()).user.email,
        updated.email,
      );
    },
  );
  await t.test(
    "3: altas por API, paginación, protección propia, edición, 412 y baja sin vínculos",
    async () => {
      digitador = await a.client.users.create(
        {
          name: "Digitador integración",
          ci: f.ci(),
          email: `digitador-${suffix}@example.test`,
          username: `digitador-${suffix}`,
          role: "DIGITADOR",
          active: true,
        },
        testPassword,
      );
      publico = await a.client.users.create(
        {
          name: "Público integración",
          ci: f.ci(),
          email: `publico-${suffix}@example.test`,
          username: `publico-${suffix}`,
          role: "PUBLICO",
          active: true,
        },
        testPassword,
      );
      const first = await a.client.users.list({ page: 1, pageSize: 1 });
      assert.equal(first.data.length, 1);
      assert.ok(first.summary.total >= 3);
      const own = await a.client.users.get(actor.id);
      await assert.rejects(
        a.client.users.update(
          actor.id,
          { active: false },
          { ifMatch: own.etag },
        ),
        code("SELF_PRIVILEGE_CHANGE"),
      );
      const version = await a.client.users.get(digitador.id);
      await a.client.users.update(
        digitador.id,
        { name: "Digitador actualizado" },
        { ifMatch: version.etag },
      );
      await assert.rejects(
        a.client.users.update(
          digitador.id,
          { name: "No sobrescribir" },
          { ifMatch: version.etag },
        ),
        code("USER_VERSION_CONFLICT"),
      );
      assert.equal(
        (await a.client.users.get(digitador.id)).data.name,
        "Digitador actualizado",
      );
      const unused = await a.client.users.create(
        {
          name: "Sin vínculos",
          ci: f.ci(),
          email: `unused-${suffix}@example.test`,
          username: `unused-${suffix}`,
          role: "PUBLICO",
          active: true,
        },
        testPassword,
      );
      await a.client.users.remove(unused.id, {
        ifMatch: (await a.client.users.get(unused.id)).etag,
      });
      await assert.rejects(
        a.client.users.get(unused.id),
        (error) => error instanceof ClientProblem && error.status === 404,
      );
    },
  );
  await t.test(
    "4: autorización por rol, directorios privados y parámetros administrativos",
    async () => {
      for (const user of [digitador, publico]) {
        const b = f.browser().tab();
        await b.client.auth.initializeBrowser();
        await b.client.auth.login(user.username, testPassword);
        await assert.rejects(b.client.users.list(), code("FORBIDDEN"));
        const settings = await b.client.settings.get();
        await assert.rejects(
          b.client.settings.update(
            { summaryWordLimit: 301 },
            { ifMatch: settings.etag },
          ),
          code("FORBIDDEN"),
        );
        if (user.role === "PUBLICO")
          await assert.rejects(
            b.client.catalogs.list("autores"),
            code("FORBIDDEN"),
          );
        else assert.ok((await b.client.catalogs.list("autores")).pagination);
        await b.client.auth.logout();
      }
    },
  );
  await t.test(
    "5: cambio personal concurrente con refresh conserva sesión y revoca otras",
    async () => {
      const other = f.browser().tab();
      await other.client.auth.initializeBrowser();
      await other.client.auth.login(digitador.username, testPassword);
      const browser = f.browser((request) =>
        Promise.resolve(request.password ? testPassword : undefined),
      );
      const d = browser.tab();
      await d.client.auth.initializeBrowser();
      const before = await d.client.auth.login(
        digitador.username,
        testPassword,
      );
      await assert.rejects(
        d.client.users.password("Incorrecta123", "NuevaClave2026!"),
        code("INVALID_CURRENT_PASSWORD"),
      );
      await Promise.all([
        d.client.users.password(testPassword, "NuevaClave2026!"),
        d.client.auth.refresh(),
      ]);
      const refreshed = await d.client.auth.session();
      assert.equal(refreshed.session.id, before.session.id);
      assert.equal(
        refreshed.session.idleExpiresAt,
        before.session.idleExpiresAt,
      );
      await assert.rejects(other.client.users.me(), code("UNAUTHENTICATED"));
      await d.client.auth.logout();
      await assert.rejects(
        d.client.auth.login(digitador.username, testPassword),
        code("INVALID_CREDENTIALS"),
      );
      await d.client.auth.login(digitador.username, "NuevaClave2026!");
      await d.client.auth.logout();
    },
  );
  await t.test(
    "6–7: entrega SMTP real local, enlace, reset de un uso y nueva contraseña",
    async () => {
      const b = f.browser().tab();
      const generic = await b.client.auth.requestRecovery(
        "no-existe@example.test",
      );
      assert.deepEqual(
        await b.client.auth.requestRecovery(publico.email),
        generic,
      );
      await f.app.security.drainMail();
      const received = f.mailbox.find(
        (item) => item.recipient === publico.email,
      );
      assert.ok(
        received,
        "El buzón SMTP local debe recibir el enlace, no basta verify().",
      );
      await b.client.auth.resetPassword(received.token, "Recuperada2026!");
      await assert.rejects(
        b.client.auth.resetPassword(received.token, "OtraClave2026!"),
        code("INVALID_RECOVERY_TOKEN"),
      );
      await b.client.auth.initializeBrowser();
      await b.client.auth.login(publico.username, "Recuperada2026!");
      await b.client.auth.logout();
      for (let attempt = 0; attempt < 4; attempt++)
        assert.deepEqual(
          await b.client.auth.requestRecovery(publico.email),
          generic,
        );
      await f.app.security.drainMail();
      assert.equal(
        f.mailbox.filter((item) => item.recipient === publico.email).length,
        3,
        "Solo se entregan tres recuperaciones por cuenta/hora; la respuesta del límite sigue siendo genérica.",
      );
      const inactive = await a.client.users.create(
        {
          name: "Correo inactivo",
          ci: f.ci(),
          username: `inactive-${suffix}`,
          email: `inactive-${suffix}@example.test`,
          role: "PUBLICO",
          active: false,
        },
        testPassword,
      );
      assert.deepEqual(
        await b.client.auth.requestRecovery(inactive.email),
        generic,
      );
      await f.app.security.drainMail();
      assert.equal(
        f.mailbox.some((item) => item.recipient === inactive.email),
        false,
      );
      const delivered = f.mailbox.length;
      await f.smtpOffline();
      try {
        assert.deepEqual(
          await b.client.auth.requestRecovery(digitador.email),
          generic,
        );
      } finally {
        await f.smtpOnline();
      }
      await f.app.security.drainMail();
      assert.equal(f.mailbox.length, delivered);
    },
  );
  await t.test(
    "8: parámetros parciales, ETag, conflicto sin sobrescribir y persistencia",
    async () => {
      const original = await a.client.settings.get();
      const target = original.data.summaryWordLimit === 301 ? 302 : 301;
      const saved = await a.client.settings.update(
        { summaryWordLimit: target },
        { ifMatch: original.etag },
      );
      assert.equal(saved.data.maxPdfSizeMb, original.data.maxPdfSizeMb);
      await assert.rejects(
        a.client.settings.update(
          { summaryWordLimit: 400 },
          { ifMatch: original.etag },
        ),
        code("RESOURCE_VERSION_CONFLICT"),
      );
      assert.equal(
        (await a.client.settings.get()).data.summaryWordLimit,
        target,
      );
      await a.client.settings.update(original.data, { ifMatch: saved.etag });
    },
  );
  await t.test(
    "9–10: autores/tutores, opcionales propios, duplicados, ETag y DELETE administrativo",
    async () => {
      const d = f.browser().tab();
      await d.client.auth.initializeBrowser();
      await d.client.auth.login(digitador.username, "NuevaClave2026!");
      // La confirmación usa la contraseña vigente del actor.
      const password = { confirmationPassword: "NuevaClave2026!" };
      for (const key of ["autores", "tutores"] as const) {
        const input: CatalogInput = {
          name: `Persona ${key} ${suffix}`,
          fields:
            key === "autores"
              ? { orcid: "", email: "", ci: "" }
              : { especialidad: "Economía", email: "", ci: "" },
        };
        const created = await d.client.catalogs.save(key, input);
        await assert.rejects(
          d.client.catalogs.save(key, {
            ...input,
            name: `  ${input.name.toUpperCase()}  `,
          }),
          code("DUPLICATE_CATALOG"),
        );
        const saved = await d.client.catalogs.save(
          key,
          { ...input, name: `${input.name} editada` },
          created.data.id,
          { ...password, ifMatch: created.etag },
        );
        await assert.rejects(
          d.client.catalogs.active(key, saved.data.id, false, {
            ...password,
            ifMatch: created.etag,
          }),
          code("RESOURCE_VERSION_CONFLICT"),
        );
        await assert.rejects(
          d.client.catalogs.remove(key, saved.data.id, {
            ...password,
            ifMatch: saved.etag,
          }),
          code("FORBIDDEN"),
        );
        const inactive = await a.client.catalogs.active(
          key,
          saved.data.id,
          false,
          { ifMatch: saved.etag },
        );
        await a.client.catalogs.remove(key, saved.data.id, {
          ifMatch: inactive.etag,
        });
      }
      await d.client.catalogs.save("autores", {
        name: `Referencia histórica ${suffix}`,
        fields: {},
      });
      const account = await a.client.users.get(digitador.id);
      await assert.rejects(
        a.client.users.update(
          digitador.id,
          { active: false },
          { ifMatch: account.etag },
        ),
        code("USER_IN_USE"),
      );
      await assert.rejects(
        a.client.users.remove(digitador.id, { ifMatch: account.etag }),
        code("USER_IN_USE"),
      );
    },
  );
  await t.test(
    "9–10 H1: N:M activa impide inactivar; histórica permite inactivar y bloquea DELETE",
    async () => {
      const author = await a.client.catalogs.save("autores", {
        name: `Autor vinculado ${suffix}`,
        fields: {},
      });
      const tutor = await a.client.catalogs.save("tutores", {
        name: `Tutor vinculado ${suffix}`,
        fields: {},
      });
      const refs: string[] = [];
      for (const key of ["carreras", "niveles", "tipos", "filiales"]) {
        const created = await a.runtime.http.request<CatalogDto>(
          `/catalogos/${key}`,
          {
            method: "POST",
            body: { name: `${key} fixture ${suffix}`, fields: {} },
          },
        );
        refs.push(created.data.id);
      }
      const registered = await a.runtime.http.request<{ id: string }>(
        "/publicaciones",
        {
          method: "POST",
          body: {
            title: `Investigación fixture cliente ${suffix}`,
            authorIds: [author.data.id],
            tutorIds: [tutor.data.id],
            careerId: refs[0],
            levelId: refs[1],
            typeId: refs[2],
            branchId: refs[3],
            summary: `Resumen único de integración ${suffix}`,
            abstract: `Unique integration abstract ${suffix}`,
            keywords: "integración",
            year: 2026,
            source: "EXTERNA",
            externalUrl: "https://example.test/research",
            requiresLibraryCopy: false,
            approved: true,
          },
        },
      );
      const publication = await a.runtime.http.versioned<{ id: string }>(
        `/publicaciones/${registered.data.id}`,
      );
      for (const [key, row] of [
        ["autores", author],
        ["tutores", tutor],
      ] as const)
        await assert.rejects(
          a.client.catalogs.active(key, row.data.id, false, {
            ifMatch: row.etag,
          }),
          code("CATALOG_IN_USE"),
        );
      await a.runtime.http.request(
        `/publicaciones/${publication.data.id}/estado`,
        {
          method: "PATCH",
          body: { active: false },
          headers: mutationHeaders({
            ifMatch: publication.etag,
            confirmationPassword: testPassword,
          }),
        },
      );
      for (const [key, row] of [
        ["autores", author],
        ["tutores", tutor],
      ] as const) {
        const inactive = await a.client.catalogs.active(
          key,
          row.data.id,
          false,
          { ifMatch: row.etag },
        );
        assert.equal(inactive.data.active, false);
        await assert.rejects(
          a.client.catalogs.remove(key, row.data.id, {
            ifMatch: inactive.etag,
          }),
          code("CATALOG_IN_USE"),
        );
        assert.equal(
          (await a.client.catalogs.get(key, row.data.id)).data.active,
          false,
        );
      }
    },
  );
  await t.test(
    "3: contraseña administrativa, revocación de rol/estado y nombre Público protegido",
    async () => {
      const target = await a.client.users.create(
        {
          name: "Cambio administrativo",
          ci: f.ci(),
          username: `managed-${suffix}`,
          email: `managed-${suffix}@example.test`,
          role: "DIGITADOR",
          active: true,
        },
        testPassword,
      );
      const b = f.browser().tab();
      await b.client.auth.initializeBrowser();
      await b.client.auth.login(target.username, testPassword);
      await a.client.users.managedPassword(target.id, "Administrada2026!");
      await assert.rejects(b.client.users.me(), code("UNAUTHENTICATED"));
      await b.client.auth.login(target.username, "Administrada2026!");
      await a.client.users.update(
        target.id,
        { role: "PUBLICO" },
        { ifMatch: (await a.client.users.get(target.id)).etag },
      );
      await assert.rejects(
        b.client.catalogs.list("autores"),
        code("UNAUTHENTICATED"),
      );
      await b.client.auth.login(target.username, "Administrada2026!");
      await assert.rejects(
        a.client.users.update(
          target.id,
          { name: "No permitido" },
          { ifMatch: (await a.client.users.get(target.id)).etag },
        ),
        code("PUBLIC_NAME_READONLY"),
      );
      await a.client.users.update(
        target.id,
        { active: false },
        { ifMatch: (await a.client.users.get(target.id)).etag },
      );
      await assert.rejects(b.client.users.me(), code("UNAUTHENTICATED"));
    },
  );
  await t.test(
    "2,6–7: cambio de correo invalida recuperación y tokens vencidos no se consumen",
    async () => {
      const target = await a.client.users.create(
        {
          name: "Recuperación correo",
          ci: f.ci(),
          username: `mail-${suffix}`,
          email: `mail-${suffix}@example.test`,
          role: "DIGITADOR",
          active: true,
        },
        testPassword,
      );
      const b = f.browser().tab();
      await b.client.auth.initializeBrowser();
      await b.client.auth.login(target.username, testPassword);
      await b.client.auth.requestRecovery(target.email);
      await f.app.security.drainMail();
      const first = f.mailbox.find((item) => item.recipient === target.email)!;
      assert.ok(first);
      const newEmail = `changed-${suffix}@example.test`;
      await b.client.users.profile({
        name: target.name,
        username: target.username,
        email: newEmail,
      });
      assert.equal((await b.client.auth.session()).user.email, newEmail);
      await assert.rejects(
        b.client.auth.resetPassword(first.token, "CorreoNueva2026!"),
        code("INVALID_RECOVERY_TOKEN"),
      );
      await b.client.auth.requestRecovery(newEmail);
      await f.app.security.drainMail();
      const second = f.mailbox.find((item) => item.recipient === newEmail)!;
      assert.ok(second);
      f.advance(15 * 60000 + 1);
      await assert.rejects(
        b.client.auth.resetPassword(second.token, "CorreoNueva2026!"),
        code("INVALID_RECOVERY_TOKEN"),
      );
      // Restaurar al administrador después del salto de reloj sin simular actividad.
      await a.client.auth.initializeBrowser();
      await a.client.auth.login(testAdmin, testPassword);
    },
  );
  await t.test(
    "1–2: tres confirmaciones erróneas revocan sesión y tres logins bloquean cinco minutos",
    async () => {
      const b = f.browser().tab();
      await b.client.auth.initializeBrowser();
      await b.client.auth.login(publico.username, "Recuperada2026!");
      for (let n = 0; n < 3; n++)
        await assert.rejects(
          b.client.users.profile(
            {
              name: publico.name,
              email: publico.email,
              username: publico.username,
            },
            { confirmationPassword: "Incorrecta123" },
          ),
        );
      assert.equal(b.runtime.getSnapshot().session, null);
      for (let n = 0; n < 3; n++)
        await assert.rejects(
          b.client.auth.login(publico.username, "Incorrecta123"),
          code("INVALID_CREDENTIALS"),
        );
      await assert.rejects(
        b.client.auth.login(publico.username, "Recuperada2026!"),
        code("INVALID_CREDENTIALS"),
      );
      f.advance(300001);
      await b.client.auth.login(publico.username, "Recuperada2026!");
      f.advance(600001);
      await assert.rejects(b.client.auth.refresh(), code("UNAUTHENTICATED"));
      assert.equal(b.runtime.getSnapshot().session, null);
    },
  );
  await t.test(
    "auditoría transaccional existe y no contiene credenciales del cliente",
    async () => {
      const events = await f.prisma.auditLog.findMany({
        where: { userId: actor.id },
      });
      assert.ok(
        events.some(
          (event) =>
            event.operation === "PARAMETROS_MODIFICADOS" ||
            event.operation.startsWith("PARAMETRO"),
        ),
      );
      assert.ok(
        events.some((event) => event.operation === "CATALOGO_ELIMINADO"),
      );
      assert.equal(JSON.stringify(events).includes(testPassword), false);
    },
  );
});
