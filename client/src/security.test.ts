import { saveCatalogSample } from "./testFixtures";
import { test } from "node:test";
import assert from "node:assert/strict";
import { seed, DEMO_PASSWORD, authenticate, type State } from "./model";
import {
  createUser,
  deleteUser,
  editUser,
  editProfile,
  loadUserForEdit,
  loginUser,
  requireResult,
} from "./userService";
import { setCatalogActive, migrateCatalogs } from "./catalogs";
import {
  canOpenPage,
  INACTIVITY_MS,
  renewActivity,
  sessionExpired,
} from "./security";

test("RN-01: precarga una copia actual y bloquea nombre Público en edición y perfil", async () => {
  const state = await seed();
  const [administrator, editor, reader] = state.users;
  const loaded = requireResult(
    loadUserForEdit(state, administrator.id, reader.id),
  );
  assert.deepEqual(loaded, reader);
  assert.notEqual(loaded, reader);
  assert.equal(loadUserForEdit(state, editor.id, reader.id).exito, false);
  assert.equal(
    loadUserForEdit(state, administrator.id, "missing").exito,
    false,
  );
  assert.equal(
    editUser(state, administrator.id, reader.id, {
      ...reader,
      name: "Alterado",
    }).exito,
    false,
  );
  assert.equal(
    editUser(state, administrator.id, reader.id, {
      ...reader,
      name: "Alterado",
      role: "DIGITADOR",
    }).exito,
    false,
  );
  assert.equal(
    editUser(state, administrator.id, editor.id, {
      ...editor,
      name: "Alterado",
      role: "PUBLICO",
    }).exito,
    false,
  );
  assert.equal(
    editProfile(state, reader.id, { ...reader, name: "Alterado" }).exito,
    false,
  );
  const edited = requireResult(
    editProfile(state, reader.id, { ...reader, email: "nuevo@example.test" }),
  );
  assert.equal(edited.users[2].name, reader.name);
  assert.equal(edited.users[2].email, "nuevo@example.test");
  assert.equal(
    requireResult(
      editUser(state, administrator.id, editor.id, {
        ...editor,
        name: "Nombre actualizado",
      }),
    ).users[1].name,
    "Nombre actualizado",
  );
});

test("Mi perfil: Digitador no puede cambiar su nombre, conserva edición de contacto y Admin puede cambiar el propio", async () => {
  const state = await seed();
  const [administrator, editor] = state.users;
  const original = JSON.stringify(state);
  const rejected = editProfile(state, editor.id, {
    ...editor,
    name: "Nombre alterado",
    email: "alterado@example.test",
  });
  assert.equal(rejected.exito, false);
  assert.match(rejected.mensaje, /Digitador.*solo lectura/);
  assert.equal(JSON.stringify(state), original);

  const edited = requireResult(
    editProfile(state, editor.id, {
      ...editor,
      email: "contacto@example.test",
      username: "digitador.actualizado",
    }),
  );
  assert.equal(edited.users[1].name, editor.name);
  assert.equal(edited.users[1].email, "contacto@example.test");
  assert.equal(edited.users[1].username, "digitador.actualizado");
  assert.equal(JSON.stringify(state), original);

  const adminEdited = requireResult(
    editProfile(state, administrator.id, {
      ...administrator,
      name: "Administrador actualizado",
    }),
  );
  assert.equal(adminEdited.users[0].name, "Administrador actualizado");
});

test("Crear usuario: permiso, campos únicos, contraseña y respuesta estructurada", async () => {
  const state = await seed();
  const [administrator, editor] = state.users;
  const input = {
    ...editor,
    ci: "8888888",
    email: "nueva@example.test",
    username: "nueva",
  };
  assert.equal(
    (await createUser(state, editor.id, input, DEMO_PASSWORD)).exito,
    false,
  );
  assert.equal(
    (await createUser(state, administrator.id, editor, DEMO_PASSWORD)).exito,
    false,
  );
  assert.equal(
    (await createUser(state, administrator.id, input, "corta")).exito,
    false,
  );
  const result = await createUser(
    state,
    administrator.id,
    input,
    DEMO_PASSWORD,
  );
  assert.equal(result.exito, true);
  assert.equal(requireResult(result).users.length, 4);
  assert.equal(state.users.length, 3);
});

test("RN-02: cuenta sin dependencias se elimina con sus tokens; propia y sin permiso se rechazan", async () => {
  const state = await seed();
  const [administrator, editor, reader] = state.users;
  state.recovery.push({
    userId: reader.id,
    hash: "pending",
    expiresAt: 999999,
  });
  assert.equal(
    deleteUser(state, administrator.id, administrator.id).exito,
    false,
  );
  assert.equal(deleteUser(state, editor.id, reader.id).exito, false);
  assert.equal(deleteUser(state, administrator.id, "missing").exito, false);
  const deleted = requireResult(deleteUser(state, administrator.id, reader.id));
  assert.equal(
    deleted.users.some((account) => account.id === reader.id),
    false,
  );
  assert.equal(deleted.recovery.length, 0);
  assert.equal(state.users.length, 3, "no modifica el estado original");
  assert.equal(
    (await authenticate(deleted, reader.username, DEMO_PASSWORD)).userId,
    undefined,
  );
});

test("RN-02: investigaciones, revisiones, documentos y transacciones impiden eliminación", async () => {
  const state = await seed();
  const [administrator, editor] = state.users;
  for (const kind of [
    "investigación",
    "revisión",
    "documento",
    "transacción",
  ] as const) {
    const linked: State = {
      ...state,
      repositoryLinks: [{ userId: editor.id, recordId: "registro-42", kind }],
    };
    const before = JSON.stringify(linked);
    const result = deleteUser(linked, administrator.id, editor.id);
    assert.equal(result.exito, false);
    assert.match(result.mensaje, /registros o transacciones asociados/);
    assert.match(result.mensaje, /registro-42/);
    assert.equal(JSON.stringify(linked), before);
  }
});

test("RN-02: operaciones reales de catálogo conservan participantes y bloquean baja incluso inactivo", async () => {
  let state = await seed();
  const [administrator, editor] = state.users;
  state = saveCatalogSample(state, editor.id, "autores", {
    name: "Autora de prueba",
    fields: {},
  });
  const recordId = state.catalogs.autores[0].id;
  state = saveCatalogSample(
    state,
    administrator.id,
    "autores",
    { name: "Autora actualizada", fields: {} },
    recordId,
  );
  state = setCatalogActive(state, administrator.id, "autores", recordId, false);
  assert.deepEqual(state.catalogs.autores[0].participantIds, [
    editor.id,
    administrator.id,
  ]);
  assert.equal(deleteUser(state, administrator.id, editor.id).exito, false);
  const inactive = editUser(state, administrator.id, editor.id, {
    ...editor,
    active: false,
  });
  assert.equal(inactive.exito, false);
  assert.match(inactive.mensaje, /No se puede dar de baja/);
});

test("Migración: registros anteriores sin trazabilidad conservan datos y bloquean eliminación cautelar", async () => {
  let state = await seed();
  const [administrator, editor] = state.users;
  state = saveCatalogSample(state, administrator.id, "autores", {
    name: "Registro anterior",
    fields: {},
  });
  delete state.catalogs.autores[0].participantIds;
  const migrated = migrateCatalogs(state);
  assert.deepEqual(migrated.users, state.users);
  assert.match(
    deleteUser(migrated, administrator.id, editor.id).mensaje,
    /sin trazabilidad/,
  );
});

test("RN-03: cuenta inactiva solo se revela con contraseña válida", async () => {
  const state = await seed();
  state.users[1].active = false;
  const incorrect = await loginUser(state, "digitador", "Incorrecta1");
  assert.equal(incorrect.exito, false);
  assert.equal(incorrect.mensaje, "Usuario o contraseña incorrectos.");
  const inactive = await loginUser(state, "digitador", DEMO_PASSWORD);
  assert.equal(inactive.exito, false);
  assert.equal(
    inactive.mensaje,
    "Tu cuenta se encuentra inactiva. Contacta con el administrador",
  );
  assert.equal(inactive.datos?.userId, undefined);
  assert.equal((await loginUser(state, "", "")).exito, false);
});

test("RN-04: rutas directas aplican matriz de permisos y deniegan desconocidas", () => {
  assert.equal(canOpenPage("PUBLICO", "usuarios"), false);
  assert.equal(canOpenPage("DIGITADOR", "usuarios"), false);
  assert.equal(canOpenPage("DIGITADOR", "autores"), true);
  assert.equal(canOpenPage("PUBLICO", "autores"), false);
  assert.equal(canOpenPage("ADMINISTRADOR", "usuarios"), true);
  assert.equal(canOpenPage("PUBLICO", "perfil"), true);
  assert.equal(canOpenPage("ADMINISTRADOR", "pagina-inventada"), false);
});

test("RN-04: 10 minutos, límite exacto, recarga, suspensión y reloj atrasado", () => {
  const startedAt = 1000000;
  const deadline = startedAt + INACTIVITY_MS;
  assert.equal(INACTIVITY_MS, 600000);
  assert.equal(sessionExpired(deadline, deadline - 1), false);
  assert.equal(sessionExpired(deadline, deadline), true);
  assert.equal(renewActivity(deadline, deadline), null);
  assert.equal(renewActivity(deadline, deadline + 3600000), null);
  assert.equal(
    renewActivity(deadline, startedAt + 10000),
    startedAt + 10000 + INACTIVITY_MS,
  );
  assert.equal(sessionExpired(Number(String(deadline)), deadline + 1), true);
  assert.equal(sessionExpired(0, startedAt), true);
  assert.equal(sessionExpired(Number.NaN, startedAt), true);
  assert.equal(sessionExpired(deadline, startedAt - 1), true);
});
