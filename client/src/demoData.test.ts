import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "./model";
import { buildDemoData, demoDocumentPath, demoPublications } from "./demoData";
import {
  CATALOG_KEYS,
  deleteCatalogRecord,
  saveCatalogRecord,
  setCatalogActive,
} from "./catalogs";
import { emptyReportFilters, publicationReport } from "./publications";
import { load } from "./storage";

test("Muestra completa: siete catálogos, personas suficientes para paginar, ocho investigaciones y sus vínculos", async () => {
  const initial = await seed();
  const original = JSON.stringify(initial);
  const administrator = initial.users[0];
  const result = buildDemoData(
    initial,
    administrator.id,
    "http://127.0.0.1:5173/",
  );
  assert.equal(JSON.stringify(initial), original);
  assert.equal(result.addedCatalogs, 42);
  assert.equal(result.addedPublications, 8);
  assert.equal(result.state.catalogs.autores.length, 14);
  assert.equal(
    result.state.catalogs.autores.filter((entry) => entry.active).length,
    13,
  );
  assert.equal(
    result.state.catalogs.tutores.filter((entry) => entry.active).length,
    11,
  );
  assert.ok(
    CATALOG_KEYS.every((catalog) => result.state.catalogs[catalog].length > 0),
  );
  assert.deepEqual(result.state.users, initial.users);
  assert.equal(result.state.publicationAudit?.length, 8);
  assert.equal(result.state.repositoryLinks?.length, 8);
  assert.equal(
    publicationReport(result.state, administrator.id, emptyReportFilters)
      .length,
    8,
  );
  assert.equal(
    new Set(result.state.publications?.map((entry) => entry.createdAt)).size,
    8,
  );
  for (const [index, publication] of result.state.publications!.entries()) {
    assert.ok(publication.title.endsWith("— Demostración"));
    assert.equal(
      publication.externalUrl,
      `http://127.0.0.1:5173/${demoDocumentPath(index)}`,
    );
  }
  const unused = result.state.catalogs.autores[10];
  assert.equal(
    deleteCatalogRecord(result.state, administrator.id, "autores", unused.id)
      .catalogs.autores.length,
    13,
  );
  assert.throws(
    () =>
      deleteCatalogRecord(
        result.state,
        administrator.id,
        "autores",
        result.state.catalogs.autores[0].id,
      ),
    /vinculado/,
  );
});

test("Repetir la carga conserva datos, nombres editados, estados inactivos y credenciales sin duplicar", async () => {
  const initial = await seed();
  const administrator = initial.users[0];
  let existing = saveCatalogRecord(initial, administrator.id, "autores", {
    name: "Registro propio que debe conservarse",
    fields: {},
  });
  const first = buildDemoData(
    existing,
    administrator.id,
    "https://demo.example.test/",
  );
  const sample = first.state.catalogs.autores.find((record) => record.demoKey)!;
  existing = saveCatalogRecord(
    first.state,
    administrator.id,
    "autores",
    { name: "Muestra renombrada por el usuario", fields: sample.fields },
    sample.id,
  );
  const unused = existing.catalogs.autores.find((record) =>
    record.demoKey?.endsWith("/11"),
  )!;
  existing = setCatalogActive(
    existing,
    administrator.id,
    "autores",
    unused.id,
    false,
  );
  const original = JSON.stringify(existing);
  const second = buildDemoData(
    existing,
    administrator.id,
    "https://demo.example.test/",
  );
  assert.equal(second.addedCatalogs, 0);
  assert.equal(second.addedPublications, 0);
  assert.equal(JSON.stringify(second.state), original);
  assert.equal(second.state.catalogs.autores.length, 15);
  assert.deepEqual(second.state.users, initial.users);
});

test("La carga exige Administrador activo y aborta conflictos sin modificar el estado recibido", async () => {
  const initial = await seed();
  for (const account of initial.users.slice(1)) {
    assert.throws(
      () => buildDemoData(initial, account.id, "https://demo.example.test/"),
      /administrador/,
    );
  }
  const inactive = {
    ...initial,
    users: initial.users.map((account) => ({ ...account, active: false })),
  };
  assert.throws(
    () =>
      buildDemoData(
        inactive,
        initial.users[0].id,
        "https://demo.example.test/",
      ),
    /administrador/,
  );
  assert.throws(
    () => buildDemoData(initial, initial.users[0].id, "javascript:alert(1)"),
    /dirección/,
  );
  const prepared = buildDemoData(
    initial,
    initial.users[0].id,
    "https://demo.example.test/",
  );
  const collision = {
    ...initial,
    publications: [
      {
        ...prepared.state.publications![0],
        title: "Un trabajo distinto",
        demoKey: undefined,
      },
    ],
  };
  const original = JSON.stringify(collision);
  assert.throws(
    () =>
      buildDemoData(
        collision,
        initial.users[0].id,
        "https://demo.example.test/",
      ),
    /resumen/,
  );
  assert.equal(JSON.stringify(collision), original);
  assert.equal(demoPublications.length, 8);
});

test("Primera apertura carga muestras; una instalación existente se conserva sin agregar registros automáticamente", async () => {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  try {
    const fresh = await load("https://demo.example.test/");
    assert.equal(fresh.publications?.length, 8);
    assert.equal(
      (await load("https://demo.example.test/")).publications?.length,
      8,
    );
    const existing = await seed();
    storage.set("fcea-datasys.frontend.v1", JSON.stringify(existing));
    const reopened = await load("https://demo.example.test/");
    assert.deepEqual(reopened, existing);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
