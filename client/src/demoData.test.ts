import { saveCatalogSample } from "./testFixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "./model";
import { buildDemoData, demoDocumentPath, demoPublications } from "./demoData";
import {
  CATALOG_KEYS,
  deleteCatalogRecord,
  setCatalogActive,
} from "./catalogs";
import { emptyReportFilters, publicationReport } from "./publications";
import { load } from "./storage";
import type { State } from "./model";
import {
  institutionalSamples,
  legacyInstitutionalNames,
} from "./institutionalDemo";
import { existingChanges } from "./mutationPolicy";

async function previousInstitutionalDemo(): Promise<State> {
  const initial = await seed();
  const current = buildDemoData(
    initial,
    initial.users[0].id,
    "https://demo.example.test/",
  ).state;
  const previous = structuredClone(current);
  for (const catalog of ["carreras", "facultades", "filiales"] as const) {
    const names = legacyInstitutionalNames[catalog];
    previous.catalogs[catalog] = previous.catalogs[catalog]
      .slice(0, names.length)
      .map((record, index) => ({
        ...record,
        name: names[index],
        fields: {
          ...record.fields,
          descripcion:
            "Registro ficticio para la demostración académica del sistema.",
          ...(catalog === "filiales"
            ? { direccion: "Dirección de muestra, sin ubicación real." }
            : {}),
        },
      }));
  }
  previous.catalogs.filiales.push({
    ...previous.catalogs.filiales[1],
    id: crypto.randomUUID(),
    demoKey: "fcea-demo-v1/filiales/3",
    name: legacyInstitutionalNames.filiales[2],
  });
  const oldBranches = [0, 1, 0, 2, 0, 1, 2, 0];
  previous.publications = previous.publications!.map((publication, index) => {
    const career = previous.catalogs.carreras[demoPublications[index].career];
    const branch = previous.catalogs.filiales[oldBranches[index]];
    return {
      ...publication,
      career: { id: career.id, name: career.name },
      branch: { id: branch.id, name: branch.name },
    };
  });
  return previous;
}

test("Los catálogos institucionales usan seis facultades UNC, cuatro carreras FCEA y dos sedes verificadas, siempre como demo", async () => {
  const initial = await seed();
  const result = buildDemoData(
    initial,
    initial.users[0].id,
    "https://demo.example.test/",
  );
  assert.equal(result.state.catalogs.facultades.length, 6);
  assert.deepEqual(
    result.state.catalogs.carreras.map((record) => record.name),
    [
      "Licenciatura en Administración (demo)",
      "Contaduría Pública (demo)",
      "Ingeniería Comercial (demo)",
      "Ingeniería en Informática Empresarial (demo)",
    ],
  );
  assert.deepEqual(
    result.state.catalogs.filiales.map((record) => record.name),
    ["Sede Concepción (demo)", "Filial Horqueta (demo)"],
  );
  for (const catalog of ["carreras", "facultades", "filiales"] as const) {
    assert.deepEqual(
      result.state.catalogs[catalog].map((record) => record.name),
      institutionalSamples[catalog].map((sample) => sample.name),
    );
    assert.ok(
      result.state.catalogs[catalog].every((record) =>
        record.name.endsWith(" (demo)"),
      ),
    );
  }
  assert.ok(
    !result.state.catalogs.facultades.some((record) =>
      record.name.includes("Estudios Sociales"),
    ),
  );
  assert.equal(result.updatedCatalogs, 0);
  assert.equal(result.updatedPublications, 0);
  assert.equal(result.consolidatedBranches, 0);
  assert.ok(
    result.state
      .publications!.filter((publication) =>
        publication.career.name.startsWith("Ingeniería"),
      )
      .every(
        (publication) => publication.branch.name === "Sede Concepción (demo)",
      ),
  );
});

test("La actualización corrige la demo antigua conservando IDs, credenciales, fechas, auditorías y registros propios; repetir no cambia nada", async () => {
  let previous = await previousInstitutionalDemo();
  const actorId = previous.users[0].id;
  previous = saveCatalogSample(previous, actorId, "facultades", {
    name: "Unidad propia del usuario",
    fields: { descripcion: "Conservar sin alterar" },
  });
  // Un trabajo propio conserva su instantánea histórica aunque cambie el catálogo.
  previous.publications!.push({
    ...previous.publications![0],
    id: crypto.randomUUID(),
    demoKey: undefined,
    title: "Trabajo propio",
  });
  const original = JSON.stringify(previous);
  const result = buildDemoData(previous, actorId, "https://demo.example.test/");
  assert.equal(JSON.stringify(previous), original);
  assert.equal(result.addedCatalogs, 4);
  assert.equal(result.addedPublications, 0);
  assert.equal(result.updatedCatalogs, 8);
  assert.equal(result.updatedPublications, 8);
  assert.equal(result.consolidatedBranches, 1);
  assert.deepEqual(result.state.users, previous.users);
  assert.deepEqual(result.state.recovery, previous.recovery);
  assert.deepEqual(result.state.repositoryLinks, previous.repositoryLinks);
  assert.deepEqual(result.state.publicationAudit, previous.publicationAudit);
  assert.deepEqual(result.state.catalogs.autores, previous.catalogs.autores);
  assert.deepEqual(result.state.catalogs.tutores, previous.catalogs.tutores);
  assert.deepEqual(
    result.state.catalogs.facultades.at(2),
    previous.catalogs.facultades.at(2),
  );
  for (const catalog of ["carreras", "facultades", "filiales"] as const) {
    for (const record of previous.catalogs[catalog].filter(
      (record) => !record.demoKey?.endsWith("filiales/3"),
    )) {
      const updated = result.state.catalogs[catalog].find(
        (candidate) => candidate.id === record.id,
      )!;
      assert.ok(updated);
      assert.equal(updated.createdAt, record.createdAt);
      assert.equal(updated.active, record.active);
    }
  }
  for (const publication of result.state.publications!.filter(
    (publication) => publication.demoKey,
  )) {
    assert.equal(
      publication.career.name,
      result.state.catalogs.carreras.find(
        (record) => record.id === publication.career.id,
      )!.name,
    );
    assert.equal(
      publication.branch.name,
      result.state.catalogs.filiales.find(
        (record) => record.id === publication.branch.id,
      )!.name,
    );
    const originalPublication = previous.publications!.find(
      (record) => record.id === publication.id,
    )!;
    assert.equal(publication.createdAt, originalPublication.createdAt);
    assert.equal(publication.code, originalPublication.code);
    assert.equal(publication.externalUrl, originalPublication.externalUrl);
  }
  assert.deepEqual(
    result.state.publications!.at(-1),
    previous.publications!.at(-1),
  );
  assert.ok(
    existingChanges(previous, result.state).length > 0,
    "La confirmación habitual debe pedir la contraseña",
  );
  const repeated = buildDemoData(
    result.state,
    actorId,
    "https://demo.example.test/",
  );
  assert.equal(
    repeated.updatedCatalogs +
      repeated.updatedPublications +
      repeated.addedCatalogs +
      repeated.addedPublications +
      repeated.consolidatedBranches,
    0,
  );
  assert.deepEqual(repeated.state, result.state);
});

test("La corrección conserva nombres y campos personalizados y aborta colisiones o referencias propias a la filial ficticia", async () => {
  const previous = await previousInstitutionalDemo();
  const actorId = previous.users[0].id;
  const customized = structuredClone(previous);
  customized.catalogs.facultades[1].name =
    "Facultad renombrada por el usuario (demo)";
  customized.catalogs.carreras[0].fields.descripcion = "Descripción propia";
  const result = buildDemoData(
    customized,
    actorId,
    "https://demo.example.test/",
  );
  assert.deepEqual(
    result.state.catalogs.facultades[1],
    customized.catalogs.facultades[1],
  );
  assert.equal(
    result.state.catalogs.carreras[0].fields.descripcion,
    "Descripción propia",
  );

  const collision = saveCatalogSample(previous, actorId, "facultades", {
    name: institutionalSamples.facultades[1].name,
    fields: {},
  });
  const collisionBefore = JSON.stringify(collision);
  assert.throws(
    () => buildDemoData(collision, actorId, "https://demo.example.test/"),
    /Ya existe/,
  );
  assert.equal(JSON.stringify(collision), collisionBefore);

  const referenced = structuredClone(previous);
  referenced.publications!.push({
    ...referenced.publications![3],
    id: crypto.randomUUID(),
    demoKey: undefined,
    title: "Investigación propia vinculada",
  });
  const referencedBefore = JSON.stringify(referenced);
  assert.throws(
    () => buildDemoData(referenced, actorId, "https://demo.example.test/"),
    /investigaciones propias.*no se guardó/,
  );
  assert.equal(JSON.stringify(referenced), referencedBefore);
});

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
  assert.equal(result.addedCatalogs, 45);
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
  let existing = saveCatalogSample(initial, administrator.id, "autores", {
    name: "Registro propio que debe conservarse",
    fields: {},
  });
  const first = buildDemoData(
    existing,
    administrator.id,
    "https://demo.example.test/",
  );
  const sample = first.state.catalogs.autores.find((record) => record.demoKey)!;
  existing = saveCatalogSample(
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
