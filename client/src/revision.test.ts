import { test } from "node:test";
import assert from "node:assert/strict";
import { seed, DEMO_PASSWORD } from "./model";
import { buildDemoData } from "./demoData";
import { saveCatalogRecord } from "./catalogs";
import {
  bibliographyOptions,
  bibliographicRecord,
  emptyBibliographicFilters,
  queryBibliography,
} from "./bibliography";
import { existingChanges, verifyConfirmationPassword } from "./mutationPolicy";
import { logoutKey, sessionGenerationMatches } from "./sessionSignals";

test("Autores y tutores exigen CI/correo; tutor exige especialidad y carrera exige código", async () => {
  const state = await seed();
  const actorId = state.users[0].id;
  for (const catalog of ["autores", "tutores"] as const) {
    for (const fields of [
      {},
      { ci: "1234567" },
      { email: "persona@example.test" },
    ] as Record<string, string>[]) {
      assert.throws(() =>
        saveCatalogRecord(state, actorId, catalog, {
          name: "Persona de prueba",
          fields,
        }),
      );
    }
    for (const orcid of [undefined, ""]) {
      const fields: Record<string, string> = {
        ci: "1234567",
        email: "persona@example.test",
      };
      if (catalog === "tutores") fields.especialidad = "Economía";
      if (orcid !== undefined && catalog === "autores") fields.orcid = orcid;
      assert.equal(
        saveCatalogRecord(state, actorId, catalog, {
          name: "Persona válida",
          fields,
        }).catalogs[catalog].length,
        1,
      );
    }
  }
  assert.throws(() =>
    saveCatalogRecord(state, actorId, "carreras", {
      name: "Carrera",
      fields: {},
    }),
  );
  assert.doesNotThrow(() =>
    saveCatalogRecord(state, actorId, "carreras", {
      name: "Carrera",
      fields: { codigo: "CAR-1" },
    }),
  );
});

test("La política pide contraseña por modificaciones/bajas, pero no por altas ni bitácoras automáticas", async () => {
  const before = await seed();
  const actorId = before.users[0].id;
  const created = saveCatalogRecord(before, actorId, "tipos", {
    name: "Tipo nuevo",
    fields: {},
  });
  assert.deepEqual(existingChanges(before, created), []);
  const edited = saveCatalogRecord(
    created,
    actorId,
    "tipos",
    { name: "Tipo modificado", fields: {} },
    created.catalogs.tipos[0].id,
  );
  assert.equal(existingChanges(created, edited)[0].deleted, false);
  const removed = { ...created, catalogs: { ...created.catalogs, tipos: [] } };
  assert.equal(existingChanges(created, removed)[0].deleted, true);
  assert.deepEqual(
    existingChanges(before, { ...before, publicationAudit: [] }),
    [],
  );
  assert.equal(
    await verifyConfirmationPassword(before, actorId, DEMO_PASSWORD),
    true,
  );
  assert.equal(
    await verifyConfirmationPassword(before, actorId, "incorrecta"),
    false,
  );
  assert.equal(await verifyConfirmationPassword(before, actorId, ""), false);
  assert.throws(
    () =>
      queryBibliography(
        {
          ...before,
          users: before.users.map((user) => ({ ...user, active: false })),
        },
        actorId,
        emptyBibliographicFilters,
      ),
    /sesión/,
  );
});

test("El catálogo busca sin acentos en metadatos bilingües, autores y tutores; pagina y combina filtros", async () => {
  const initial = await seed();
  const state = buildDemoData(
    initial,
    initial.users[0].id,
    "http://localhost:5173",
  ).state;
  const actorId = state.users[2].id;
  const all = queryBibliography(state, actorId, emptyBibliographicFilters);
  assert.equal(all.total, 8);
  assert.equal(all.records.length, 6);
  assert.equal(all.totalPages, 2);
  assert.equal(
    queryBibliography(state, actorId, emptyBibliographicFilters, 2).records
      .length,
    2,
  );
  for (const search of [
    "educacion financiera",
    "saving habits",
    "Lucia Benitez",
    "Laura Martinez",
    "INV-00001",
  ]) {
    assert.equal(
      queryBibliography(state, actorId, {
        ...emptyBibliographicFilters,
        search,
      }).records[0].code,
      "INV-00001",
    );
  }
  const first = state.publications![0];
  assert.equal(
    queryBibliography(state, actorId, {
      ...emptyBibliographicFilters,
      careerId: first.career.id,
      levelId: first.level.id,
    }).total,
    1,
  );
  assert.equal(
    queryBibliography(state, actorId, {
      ...emptyBibliographicFilters,
      author: "sin coincidencia",
    }).total,
    0,
  );
  assert.throws(
    () =>
      queryBibliography(state, actorId, {
        ...emptyBibliographicFilters,
        from: "2026-02-30",
      }),
    /fechas/,
  );
  assert.throws(
    () =>
      queryBibliography(state, actorId, {
        ...emptyBibliographicFilters,
        from: "2026-10-16",
        to: "2026-10-01",
      }),
    /posterior/,
  );
  assert.equal(bibliographyOptions(state, actorId, "career").length, 4);
});

test("Público ve metadatos y disponibilidad, sin nombre/ID/hash de adjuntos; inactivas solo para Admin", async () => {
  const initial = await seed();
  const state = buildDemoData(
    initial,
    initial.users[0].id,
    "http://localhost:5173",
  ).state;
  const publication = state.publications![0];
  const attachment = {
    id: crypto.randomUUID(),
    name: "Documento privado.pdf",
    size: 100,
    mime: "application/pdf" as const,
    sha256: "a".repeat(64),
  };
  const withAttachment = {
    ...state,
    publications: [
      { ...publication, attachment, externalUrl: "javascript:alert(1)" },
    ],
  };
  const reader = bibliographicRecord(
    withAttachment,
    state.users[2].id,
    publication.id,
  );
  assert.equal(reader.hasAttachment, true);
  assert.equal(reader.externalUrl, "");
  assert.equal(Object.hasOwn(reader, "attachment"), false);
  assert.doesNotMatch(JSON.stringify(reader), /Documento privado|sha256/);
  assert.equal(
    bibliographicRecord(withAttachment, state.users[1].id, publication.id)
      .attachment?.name,
    attachment.name,
  );
  const inactive = {
    ...state,
    publications: [{ ...publication, active: false }],
  };
  assert.equal(
    queryBibliography(inactive, state.users[2].id, emptyBibliographicFilters)
      .total,
    0,
  );
  assert.equal(
    queryBibliography(inactive, state.users[0].id, emptyBibliographicFilters)
      .total,
    1,
  );
  assert.throws(
    () => bibliographicRecord(inactive, state.users[2].id, publication.id),
    /No se encontró/,
  );
});

test("El cierre compartido invalida la generación de las pestañas de esa cuenta", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null };
  assert.equal(sessionGenerationMatches("admin", "", storage), true);
  values.set(logoutKey("admin"), "cierre-1");
  assert.equal(sessionGenerationMatches("admin", "", storage), false);
  assert.equal(sessionGenerationMatches("otra-cuenta", "", storage), true);
  assert.equal(sessionGenerationMatches("admin", "cierre-1", storage), true);
});
