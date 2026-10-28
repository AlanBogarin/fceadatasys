import test from "node:test";
import { catalogFields } from "../../server/test/helpers/catalog-fields";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { apiFixture, testAdmin, testPassword } from "./api-fixture";
import { ClientProblem } from "../src/data/problems";
import { mutationHeaders } from "../src/data/http";
import {
  loadClassificationOptions,
  publicationClassificationFields,
  type PublicationClassification,
} from "../src/data/classificationOptions";
import type { CatalogDto, Page, UserDto } from "../src/data/contracts";
import type { CatalogInput } from "../src/catalogs";

const keys = [
  "carreras",
  "facultades",
  "filiales",
  "tipos",
  "niveles",
] as const;
const failure = (code: string) => (error: unknown) =>
  error instanceof ClientProblem && error.code === code;

test("Pasos 11–15: catálogos reales, permisos, selectores y referencias históricas", async (t) => {
  const fixture = await apiFixture();
  t.after(() => fixture.close());
  const suffix = randomUUID().slice(0, 8);
  const browser = fixture.browser();
  const admin = browser.tab();
  await admin.client.auth.initializeBrowser();
  const identity = await admin.client.auth.login(testAdmin, testPassword);
  const actorId = identity.user.id;
  const ids: string[] = [];

  for (const key of keys)
    await t.test(
      `${key}: vacío, CRUD persistente, campos propios, paginación, unicidad y 412`,
      async () => {
        const scope = `${key} conexión ${suffix}`;
        const empty = await admin.client.catalogs.list(key, { search: scope });
        assert.deepEqual(empty.data, []);
        assert.equal(empty.pagination.total, 0);
        assert.equal(empty.pagination.totalPages, 0);
        const fields: Record<string, string> = {
          descripcion: "Descripción inicial",
        };
        if (key === "carreras") fields.codigo = `C-${suffix}`;
        if (key === "facultades") fields.sigla = `F-${suffix}`;
        if (key === "filiales")
          fields.direccion = "Dirección de la sede de prueba";
        const rows = [];
        for (let n = 1; n <= 3; n++) {
          const input: CatalogInput = {
            name: `${scope} ${n}`,
            fields: catalogFields(key, n === 1 ? fields : {}),
          };
          const row = await admin.client.catalogs.save(key, input);
          rows.push(row);
          ids.push(row.data.id);
          assert.equal(row.data.active, true);
          assert.equal("demoKey" in row.data, false);
          assert.deepEqual(
            (await admin.client.catalogs.get(key, row.data.id)).data,
            row.data,
          );
        }
        const filtered = await admin.client.catalogs.list(key, {
          search: scope,
          page: 2,
          pageSize: 1,
        });
        assert.equal(filtered.data.length, 1);
        assert.equal(filtered.pagination.total, 3);
        assert.equal(filtered.pagination.totalPages, 3);
        const global = await admin.runtime.http.get<Page<CatalogDto>>(
          `/catalogos/${key}?pageSize=1`,
        );
        assert.equal(filtered.summary.total, global.pagination.total);
        assert.ok(filtered.summary.total >= 3);
        const otherTab = browser.tab();
        await otherTab.runtime.restore();
        const stale = await otherTab.client.catalogs.get(key, rows[0].data.id);
        const changed = await admin.client.catalogs.save(
          key,
          {
            name: `${scope} actualizada`,
            fields: { descripcion: "Descripción modificada" },
          },
          rows[0].data.id,
          { ifMatch: rows[0].etag },
        );
        for (const [name, value] of Object.entries(fields))
          if (name !== "descripcion")
            assert.equal(changed.data.fields[name], value);
        const beforeConflict = otherTab.runtime.getSnapshot().revision;
        await assert.rejects(
          otherTab.client.catalogs.save(
            key,
            { name: "No sobrescribir", fields: {} },
            changed.data.id,
            { ifMatch: stale.etag },
          ),
          failure("RESOURCE_VERSION_CONFLICT"),
        );
        assert.equal(otherTab.runtime.getSnapshot().revision, beforeConflict);
        assert.equal(
          (await otherTab.client.catalogs.get(key, changed.data.id)).data.name,
          changed.data.name,
        );
        await assert.rejects(
          admin.client.catalogs.save(key, {
            name: `  ${changed.data.name.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase()}  `,
            fields: catalogFields(key),
          }),
          failure("DUPLICATE_CATALOG"),
        );
        if (key === "carreras" || key === "facultades") {
          const unique = key === "carreras" ? "codigo" : "sigla";
          await assert.rejects(
            admin.client.catalogs.save(key, {
              name: `${scope} identificador repetido`,
              fields: { [unique]: fields[unique].toLowerCase() },
            }),
            failure("DUPLICATE_CATALOG"),
          );
        }
        const otherKey = key === "carreras" ? "niveles" : "carreras";
        await assert.rejects(
          admin.client.catalogs.get(otherKey, changed.data.id),
          failure("NOT_FOUND"),
        );
        await assert.rejects(
          admin.client.catalogs.get(key, "no-es-uuid"),
          failure("VALIDATION_ERROR"),
        );
        await assert.rejects(
          admin.client.catalogs.list("catalogo-invalido" as never),
          failure("VALIDATION_ERROR"),
        );
        const inactive = await admin.client.catalogs.active(
          key,
          changed.data.id,
          false,
          { ifMatch: changed.etag },
        );
        assert.equal(inactive.data.active, false);
        await assert.rejects(
          admin.client.catalogs.save(key, {
            name: inactive.data.name,
            fields: catalogFields(key),
          }),
          failure("DUPLICATE_CATALOG"),
        );
        const activePage = await admin.client.catalogs.list(key, {
          search: scope,
          active: "true",
        });
        assert.equal(activePage.pagination.total, 2);
        assert.equal(
          activePage.data.some((row) => row.id === inactive.data.id),
          false,
        );
        const restored = await admin.client.catalogs.active(
          key,
          inactive.data.id,
          true,
          { ifMatch: inactive.etag },
        );
        assert.equal(
          (await otherTab.client.catalogs.get(key, restored.data.id)).data
            .active,
          true,
        );
        for (const row of [restored, rows[1], rows[2]]) {
          await admin.client.catalogs.remove(key, row.data.id, {
            ifMatch: row.etag,
          });
          await assert.rejects(
            admin.client.catalogs.get(key, row.data.id),
            failure("NOT_FOUND"),
          );
        }
        assert.equal(
          (await admin.client.catalogs.list(key, { search: scope })).pagination
            .total,
          0,
        );
      },
    );

  const accounts: { user: UserDto; tab: typeof admin }[] = [];
  for (const role of ["DIGITADOR", "PUBLICO"] as const) {
    const user = await admin.client.users.create(
      {
        name: `${role} catálogos`,
        ci: fixture.ci(),
        username: `catalog-${role.toLowerCase()}-${suffix}`,
        email: `${role.toLowerCase()}-${suffix}@example.test`,
        role,
        active: true,
      },
      testPassword,
    );
    const tab = fixture.browser().tab();
    await tab.client.auth.initializeBrowser();
    await tab.client.auth.login(user.username, testPassword);
    accounts.push({ user, tab });
  }

  await t.test(
    "Digitador/Público consultan clasificaciones autorizadas y el servidor rechaza su mantenimiento",
    async () => {
      for (const key of keys) {
        const row = await admin.client.catalogs.save(key, {
          name: `${key} permisos ${suffix}`,
          fields: catalogFields(key),
        });
        ids.push(row.data.id);
        for (const { tab } of accounts) {
          assert.equal(
            (await tab.client.catalogs.get(key, row.data.id)).data.id,
            row.data.id,
          );
          assert.ok(
            (await tab.client.catalogs.list(key, { search: suffix })).data.some(
              (item) => item.id === row.data.id,
            ),
          );
          await assert.rejects(
            tab.client.catalogs.save(key, {
              name: `${key} alta prohibida ${suffix}`,
              fields: {},
            }),
            failure("FORBIDDEN"),
          );
          await assert.rejects(
            tab.client.catalogs.save(
              key,
              { name: "Edición prohibida", fields: {} },
              row.data.id,
              { ifMatch: row.etag },
            ),
            failure("FORBIDDEN"),
          );
          await assert.rejects(
            tab.client.catalogs.active(key, row.data.id, false, {
              ifMatch: row.etag,
            }),
            failure("FORBIDDEN"),
          );
          await assert.rejects(
            tab.client.catalogs.remove(key, row.data.id, { ifMatch: row.etag }),
            failure("FORBIDDEN"),
          );
        }
        const inactive = await admin.client.catalogs.active(
          key,
          row.data.id,
          false,
          { ifMatch: row.etag },
        );
        const reader = accounts.find(
          (account) => account.user.role === "PUBLICO",
        )!.tab;
        assert.equal(
          (
            await reader.client.catalogs.list(key, {
              search: row.data.name,
              active: "false",
            })
          ).pagination.total,
          0,
        );
        await assert.rejects(
          reader.client.catalogs.get(key, row.data.id),
          failure("NOT_FOUND"),
        );
        const manager = accounts.find(
          (account) => account.user.role === "DIGITADOR",
        )!.tab;
        assert.equal(
          (await manager.client.catalogs.get(key, row.data.id)).data.active,
          false,
        );
        await admin.client.catalogs.remove(key, row.data.id, {
          ifMatch: inactive.etag,
        });
      }
    },
  );

  await t.test(
    "H1: referencias tipadas conservadas, selectores activos e históricos; Facultad no se vincula",
    async () => {
      const author = await admin.client.catalogs.save("autores", {
        name: `Autor clasificaciones ${suffix}`,
        fields: catalogFields("autores"),
      });
      const tutor = await admin.client.catalogs.save("tutores", {
        name: `Tutor clasificaciones ${suffix}`,
        fields: catalogFields("tutores"),
      });
      const refs = {} as Record<
        PublicationClassification,
        Awaited<ReturnType<typeof admin.client.catalogs.save>>
      >;
      for (const key of Object.keys(
        publicationClassificationFields,
      ) as PublicationClassification[]) {
        refs[key] = await admin.client.catalogs.save(key, {
          name: `${key} publicación ${suffix}`,
          fields: catalogFields(key),
        });
        ids.push(refs[key].data.id);
      }
      const faculty = await admin.client.catalogs.save("facultades", {
        name: `Facultad independiente ${suffix}`,
        fields: catalogFields("facultades"),
      });
      ids.push(faculty.data.id);
      const body = {
        title: `Publicación clasificaciones cliente ${suffix}`,
        authorIds: [author.data.id],
        tutorIds: [tutor.data.id],
        ...Object.fromEntries(
          Object.entries(publicationClassificationFields).map(
            ([key, field]) => [
              field,
              refs[key as PublicationClassification].data.id,
            ],
          ),
        ),
        summary: `Resumen de clasificaciones históricas ${suffix}`,
        abstract: `Historical classification integration abstract ${suffix}`,
        keywords: "catálogos",
        year: 2026,
        source: "EXTERNA",
        externalUrl: "https://example.test/classification",
        requiresLibraryCopy: false,
        approved: true,
      };
      const created = (
        await admin.runtime.http.request<{ id: string }>("/publicaciones", {
          method: "POST",
          body,
        })
      ).data;
      const publication = await admin.runtime.http.versioned<{
        id: string;
        career: { id: string; name: string };
        level: { id: string; name: string };
        type: { id: string; name: string };
        branch: { id: string; name: string };
      }>(`/publicaciones/${created.id}`);
      assert.equal("faculty" in publication.data, false);
      assert.equal(publication.data.branch.id, refs.filiales.data.id);
      assert.equal(publication.data.career.id, refs.carreras.data.id);
      assert.equal(publication.data.type.id, refs.tipos.data.id);
      assert.equal(publication.data.level.id, refs.niveles.data.id);
      for (const key of Object.keys(refs) as PublicationClassification[]) {
        const row = refs[key];
        await assert.rejects(
          admin.client.catalogs.active(key, row.data.id, false, {
            ifMatch: row.etag,
          }),
          failure("CATALOG_IN_USE"),
        );
        await assert.rejects(
          admin.client.catalogs.remove(key, row.data.id, { ifMatch: row.etag }),
          failure("CATALOG_IN_USE"),
        );
      }
      const facultyInactive = await admin.client.catalogs.active(
        "facultades",
        faculty.data.id,
        false,
        { ifMatch: faculty.etag },
      );
      await admin.client.catalogs.remove("facultades", faculty.data.id, {
        ifMatch: facultyInactive.etag,
      });
      await admin.runtime.http.request(`/publicaciones/${created.id}/estado`, {
        method: "PATCH",
        body: { active: false },
        headers: mutationHeaders({
          ifMatch: publication.etag,
          confirmationPassword: testPassword,
        }),
      });
      for (const key of Object.keys(refs) as PublicationClassification[]) {
        const row = refs[key];
        const inactive = await admin.client.catalogs.active(
          key,
          row.data.id,
          false,
          { ifMatch: row.etag },
        );
        await assert.rejects(
          admin.client.catalogs.remove(key, row.data.id, {
            ifMatch: inactive.etag,
          }),
          failure("CATALOG_IN_USE"),
        );
        const query = { search: row.data.name, pageSize: 1 };
        const available = await loadClassificationOptions(
          admin.client.catalogs,
          key,
          query,
        );
        assert.equal(available.pagination.total, 0);
        assert.deepEqual(available.options, []);
        for (const tab of [admin, ...accounts.map((account) => account.tab)]) {
          const selected = { id: row.data.id, name: row.data.name };
          const options = await loadClassificationOptions(
            tab.client.catalogs,
            key,
            query,
            selected,
          );
          assert.deepEqual(options.selected, selected);
          assert.deepEqual(options.options, [selected]);
          assert.equal(options.pagination.total, 0);
        }
      }
      const historical = await admin.runtime.http.get<typeof publication.data>(
        `/publicaciones/${created.id}`,
      );
      assert.equal(historical.career.id, refs.carreras.data.id);
      assert.equal(historical.branch.id, refs.filiales.data.id);
      assert.equal(historical.type.id, refs.tipos.data.id);
      assert.equal(historical.level.id, refs.niveles.data.id);
    },
  );

  await t.test(
    "Los cinco catálogos conservan auditoría de altas/cambios/estados/bajas y rechazos sin credenciales",
    async () => {
      const events = await fixture.prisma.auditLog.findMany({
        where: { resourceId: { in: ids } },
      });
      for (const key of keys) {
        const own = events.filter(
          (event) => event.resource === key && event.userId === actorId,
        );
        for (const operation of [
          "CATALOGO_CREADO",
          "CATALOGO_MODIFICADO",
          "CATALOGO_INACTIVADO",
          "CATALOGO_ACTIVADO",
          "CATALOGO_ELIMINADO",
        ])
          assert.ok(
            own.some((event) => event.operation === operation),
            `${key}: falta ${operation}`,
          );
      }
      assert.equal(JSON.stringify(events).includes(testPassword), false);
      // Los rechazos usan la plantilla de ruta y sesión, sin resourceId del cuerpo.
      const sessionIds = [admin, ...accounts.map((account) => account.tab)].map(
        (tab) => tab.runtime.getSnapshot().session!.session.id,
      );
      const rejections = await fixture.prisma.auditLog.findMany({
        where: {
          sessionId: { in: sessionIds },
          resource: {
            in: [
              "/api/v1/catalogos/:catalog",
              "/api/v1/catalogos/:catalog/:id",
            ],
          },
          status: "FALLIDO",
        },
      });
      for (const code of [
        "FORBIDDEN",
        "CATALOG_IN_USE",
        "RESOURCE_VERSION_CONFLICT",
      ])
        assert.ok(
          rejections.some((event) => event.detail?.includes(code)),
          `Falta rechazo auditado ${code}`,
        );
      assert.equal(JSON.stringify(rejections).includes(testPassword), false);
    },
  );
});
