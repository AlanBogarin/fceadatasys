import { saveCatalogSample } from "./testFixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { State, User, Role } from "./model";
import {
  CATALOG_KEYS,
  deleteCatalogRecord,
  emptyCatalogs,
  filterCatalog,
  migrateCatalogs,
  setCatalogActive,
} from "./catalogs";

const actor = (id: string, role: Role): User => ({
  id,
  role,
  active: true,
  name: id,
  username: id,
  ci: "",
  email: "",
  passwordHash: "hash-preservado",
  salt: "sal-preservada",
  failures: 0,
  lockedUntil: 0,
  createdAt: "2026-10-01T00:00:00Z",
});
const initial = (): State => ({
  version: 1,
  users: [
    actor("admin", "ADMINISTRADOR"),
    actor("digitador", "DIGITADOR"),
    actor("publico", "PUBLICO"),
  ],
  recovery: [],
  catalogs: emptyCatalogs(),
});

test("solo Administrador activo puede eliminar registros sin vínculos en los siete catálogos", () => {
  for (const catalog of CATALOG_KEYS) {
    const state = saveCatalogSample(initial(), "admin", catalog, {
      name: `Eliminar prueba ${catalog}`,
      fields: {},
    });
    const target = state.catalogs[catalog][0];
    for (const actorId of ["digitador", "publico", "inexistente"]) {
      assert.throws(
        () => deleteCatalogRecord(state, actorId, catalog, target.id),
        /permiso/,
      );
    }
    const inactive = {
      ...state,
      users: state.users.map((account) => ({ ...account, active: false })),
    };
    assert.throws(
      () => deleteCatalogRecord(inactive, "admin", catalog, target.id),
      /permiso/,
    );
    assert.throws(
      () => deleteCatalogRecord(state, "admin", catalog, "inexistente"),
      /No se encontró/,
    );
    const updated = deleteCatalogRecord(state, "admin", catalog, target.id);
    assert.equal(updated.catalogs[catalog].length, 0);
    assert.equal(state.catalogs[catalog].length, 1);
    assert.deepEqual(updated.users, state.users);
  }
});

test("crear, editar, inactivar y reactivar conserva ID, fechas y datos en los siete catálogos", () => {
  let state = initial();
  for (const key of CATALOG_KEYS) {
    state = saveCatalogSample(state, "admin", key, {
      name: `  Registro ${key}  `,
      fields: {},
    });
    const original = state.catalogs[key][0];
    state = saveCatalogSample(
      state,
      "admin",
      key,
      { name: `Nombre actualizado ${key}`, fields: {} },
      original.id,
    );
    state = setCatalogActive(state, "admin", key, original.id, false);
    const edited = state.catalogs[key][0];
    assert.equal(edited.id, original.id);
    assert.equal(edited.createdAt, original.createdAt);
    assert.equal(edited.active, false);
    state = saveCatalogSample(
      state,
      "admin",
      key,
      { name: edited.name, fields: {} },
      original.id,
    );
    assert.equal(
      state.catalogs[key][0].active,
      false,
      "editar no debe reactivar",
    );
    state = setCatalogActive(state, "admin", key, original.id, true);
    assert.equal(state.catalogs[key][0].active, true);
    assert.equal(state.catalogs[key].length, 1);
  }
  assert.equal(state.users[0].passwordHash, "hash-preservado");
});

test("unicidad ignora acentos, puntuación, mayúsculas y espacios y abarca inactivos", () => {
  let state = saveCatalogSample(initial(), "admin", "carreras", {
    name: "Administración   de Empresas",
    fields: { codigo: "ADM" },
  });
  assert.throws(
    () =>
      saveCatalogSample(state, "admin", "carreras", {
        name: " ADMINISTRACION-de empresas ",
        fields: {},
      }),
    /ese nombre/,
  );
  assert.throws(
    () =>
      saveCatalogSample(state, "admin", "carreras", {
        name: "Otra carrera",
        fields: { codigo: "adm" },
      }),
    /Código/,
  );
  state = setCatalogActive(
    state,
    "admin",
    "carreras",
    state.catalogs.carreras[0].id,
    false,
  );
  assert.throws(
    () =>
      saveCatalogSample(state, "admin", "carreras", {
        name: "Administracion de Empresas",
        fields: {},
      }),
    /inactivo/,
  );
  assert.throws(
    () =>
      saveCatalogSample(state, "admin", "carreras", {
        name: "---",
        fields: {},
      }),
    /nombre/,
  );
});

test("autor valida ORCID opcional y duplicados por identidad con sus datos obligatorios", () => {
  let state = saveCatalogSample(initial(), "digitador", "autores", {
    name: "Persona de prueba",
    fields: {
      ci: "1234567",
      email: "PERSONA@EXAMPLE.TEST",
      orcid: "0000-0002-1825-0097",
    },
  });
  assert.equal(state.catalogs.autores[0].fields.email, "persona@example.test");
  for (const fields of [
    { ci: "1234567" },
    { email: "persona@example.test" },
    { orcid: "0000-0002-1825-0097" },
  ] as Record<string, string>[]) {
    assert.throws(
      () =>
        saveCatalogSample(state, "admin", "autores", {
          name: "Otro nombre",
          fields,
        }),
      /Ya existe/,
    );
  }
  for (const fields of [
    { ci: "12a" },
    { email: "invalido" },
    { orcid: "123" },
  ] as Record<string, string>[]) {
    assert.throws(() =>
      saveCatalogSample(state, "admin", "autores", {
        name: "Otro nombre",
        fields,
      }),
    );
  }
  state = saveCatalogSample(state, "digitador", "tutores", {
    name: "Tutor sin contacto",
    fields: {},
  });
  assert.equal(state.catalogs.tutores.length, 1);
});

test("permisos impiden modificaciones a público, actores inactivos y digitador fuera de autores/tutores", () => {
  const state = initial();
  const input = { name: "Registro", fields: {} };
  for (const key of CATALOG_KEYS) {
    assert.throws(
      () => saveCatalogSample(state, "publico", key, input),
      /permiso/,
    );
    if (key !== "autores" && key !== "tutores")
      assert.throws(
        () => saveCatalogSample(state, "digitador", key, input),
        /permiso/,
      );
  }
  const saved = saveCatalogSample(state, "admin", "tipos", input);
  assert.throws(
    () =>
      setCatalogActive(
        saved,
        "digitador",
        "tipos",
        saved.catalogs.tipos[0].id,
        false,
      ),
    /permiso/,
  );
  assert.throws(
    () => setCatalogActive(saved, "admin", "tipos", "inexistente", false),
    /No se encontró/,
  );
  const inactive = {
    ...state,
    users: state.users.map((u) => ({ ...u, active: false })),
  };
  assert.throws(
    () => saveCatalogSample(inactive, "admin", "autores", input),
    /permiso/,
  );
});

test("filtros buscan campos de contacto, admiten acentos y separan activos de inactivos", () => {
  let state = saveCatalogSample(initial(), "admin", "autores", {
    name: "María Prueba",
    fields: { email: "maria@example.test" },
  });
  state = saveCatalogSample(state, "admin", "autores", {
    name: "Ana Prueba",
    fields: {},
  });
  const maria = state.catalogs.autores[0];
  state = setCatalogActive(state, "admin", "autores", maria.id, false);
  assert.equal(
    filterCatalog(state.catalogs.autores, "MARIA", "inactive")[0].id,
    maria.id,
  );
  assert.equal(
    filterCatalog(state.catalogs.autores, "maria@example.test", "").length,
    1,
  );
  assert.equal(
    filterCatalog(state.catalogs.autores, "maria", "active").length,
    0,
  );
  assert.equal(
    filterCatalog(state.catalogs.autores, "", "")[0].name,
    "Ana Prueba",
  );
});

test("migración de primera entrega conserva cuentas, hashes y recuperación; persistencia admite registros nuevos", () => {
  const legacy = {
    version: 1,
    users: initial().users,
    recovery: [
      { hash: "pendiente", userId: "admin", expiresAt: 9999999999999 },
    ],
  };
  const upgraded = migrateCatalogs(legacy as State);
  assert.deepEqual(upgraded.users, legacy.users);
  assert.deepEqual(upgraded.recovery, legacy.recovery);
  assert.ok(CATALOG_KEYS.every((k) => upgraded.catalogs[k].length === 0));
  const saved = saveCatalogSample(upgraded, "admin", "filiales", {
    name: "Sede de prueba",
    fields: { direccion: "Calle de prueba" },
  });
  assert.deepEqual(migrateCatalogs(JSON.parse(JSON.stringify(saved))), saved);
  assert.throws(
    () =>
      migrateCatalogs({
        ...upgraded,
        catalogs: { ...upgraded.catalogs, autores: null },
      } as unknown as State),
    /no son compatibles/,
  );
});
