import { test } from "node:test";
import assert from "node:assert/strict";
import { seed, type State } from "./model";
import { saveCatalogRecord } from "./catalogs";
import { buildDemoData } from "./demoData";
import {
  appendAudit,
  auditMutation,
  auditRecords,
  businessStateKey,
  emptyAuditFilters,
  queryAudit,
  type AuditContext,
} from "./audit";
import { existingChanges, newBusinessRecords } from "./mutationPolicy";
import { defaultSettings, settingsOf, updateSettings } from "./settings";
import { preparePdf, validateAttachmentMetadata } from "./attachments";
import { registerPublication } from "./publications";
import { buildAuditReport } from "./auditExports";
import { save } from "./storage";
import ExcelJS from "exceljs";

function context(state: State): AuditContext {
  return {
    actorId: state.users[0].id,
    sessionId: "sesion-de-prueba",
    userAgent: "Navegador de pruebas",
  };
}

test("Auditoría: altas, modificaciones, bajas y parámetros producen eventos sin alterar el estado original", async () => {
  const before = await seed();
  const original = JSON.stringify(before);
  const created = saveCatalogRecord(before, before.users[0].id, "tipos", {
    name: "Artículo de ejemplo",
    fields: {},
  });
  const recorded = auditMutation(before, created, context(before));
  assert.equal(JSON.stringify(before), original);
  assert.equal(recorded.auditEvents?.length, 1);
  assert.equal(recorded.auditEvents![0].operation, "Crear registro");
  assert.equal(recorded.auditEvents![0].actorName, before.users[0].name);
  assert.equal(recorded.auditEvents![0].sessionId, "sesion-de-prueba");
  assert.equal(recorded.auditEvents![0].ip, null);
  const target = recorded.catalogs.tipos[0];
  const changed = saveCatalogRecord(
    recorded,
    before.users[0].id,
    "tipos",
    { name: "Artículo actualizado", fields: {} },
    target.id,
  );
  const edited = auditMutation(recorded, changed, context(before));
  assert.equal(edited.auditEvents!.at(-1)!.before!.name, "Artículo de ejemplo");
  assert.equal(edited.auditEvents!.at(-1)!.after!.name, "Artículo actualizado");
  assert.deepEqual(edited.auditEvents![0], recorded.auditEvents![0]);
  const deleted = auditMutation(
    edited,
    { ...edited, catalogs: { ...edited.catalogs, tipos: [] } },
    context(before),
  );
  assert.equal(deleted.auditEvents!.at(-1)!.operation, "Eliminar registro");
  const configured = auditMutation(
    deleted,
    updateSettings(deleted, before.users[0].id, {
      summaryWordLimit: 200,
      maxPdfSizeMb: 5,
    }),
    context(before),
  );
  assert.equal(
    configured.auditEvents!.at(-1)!.operation,
    "Modificar parámetros",
  );
  assert.deepEqual(configured.auditEvents!.at(-1)!.before, defaultSettings);
});

test("Auditoría: no guarda contraseñas, sales, hashes de credenciales ni tokens, incluso en errores o instantáneas anidadas", async () => {
  const before = await seed();
  const after = {
    ...before,
    users: before.users.map((account, index) =>
      index
        ? account
        : {
            ...account,
            passwordHash: "HASH_NUEVO_PRIVADO",
            salt: "SAL_PRIVADA",
          },
    ),
  };
  const changed = auditMutation(before, after, context(before));
  assert.equal(changed.auditEvents!.at(-1)!.operation, "Cambiar contraseña");
  const event = appendAudit(
    changed,
    {
      module: "Seguridad",
      operation: "Rechazo",
      status: "FALLIDO",
      detail:
        "password=CLAVE_PRIVADA token=TOKEN_PRIVADO Bearer CREDENCIAL_PRIVADA sk-prueba-api-secreta",
      after: {
        passwordHash: "HASH_PRIVADO",
        nested: {
          salt: "SAL_PRIVADA",
          token: "TOKEN_PRIVADO",
          nombre: "Dato permitido",
        },
      },
    },
    context(before),
  );
  const output = JSON.stringify(event.auditEvents);
  for (const secret of [
    "CLAVE_PRIVADA",
    "TOKEN_PRIVADO",
    "CREDENCIAL_PRIVADA",
    "sk-prueba-api-secreta",
    "HASH_PRIVADO",
    "HASH_NUEVO_PRIVADO",
    "SAL_PRIVADA",
    before.users[0].passwordHash,
    before.users[0].salt,
  ])
    assert.ok(!output.includes(secret), secret);
  assert.ok(output.includes("Dato permitido"));
});

test("Auditoría: solo administrador activo consulta, filtra y exporta; no admite sustitución o eliminación del historial", async () => {
  const initial = await seed();
  const recorded = appendAudit(
    initial,
    { module: "Sesiones", operation: "Iniciar sesión", status: "EXITO" },
    context(initial),
  );
  for (const actor of initial.users.slice(1)) {
    assert.throws(() => auditRecords(recorded, actor.id), /administrador/);
    assert.throws(
      () => queryAudit(recorded, actor.id, emptyAuditFilters),
      /administrador/,
    );
    await assert.rejects(
      () => buildAuditReport(recorded, actor.id, emptyAuditFilters, "pdf"),
      /administrador/,
    );
  }
  const inactive = {
    ...recorded,
    users: recorded.users.map((account) => ({ ...account, active: false })),
  };
  assert.throws(
    () => auditRecords(inactive, initial.users[0].id),
    /administrador/,
  );
  assert.throws(
    () =>
      auditMutation(
        recorded,
        { ...recorded, auditEvents: [] },
        context(initial),
      ),
    /No se permite/,
  );
  const altered = structuredClone(recorded);
  altered.auditEvents![0].detail = "Reescrito";
  assert.throws(
    () => auditMutation(recorded, altered, context(initial)),
    /No se permite/,
  );
  const consulted = auditRecords(recorded, initial.users[0].id);
  consulted[0].detail = "No debe modificar el guardado";
  assert.notEqual(recorded.auditEvents![0].detail, consulted[0].detail);
});

test("Auditoría: filtros combinados, fechas de Paraguay, búsqueda sin tilde y datos previos sin inventar sesiones", async () => {
  const initial = await seed();
  let state = appendAudit(
    initial,
    {
      module: "Catálogos",
      operation: "Modificar registro",
      status: "EXITO",
      resourceName: "Educación",
    },
    context(initial),
  );
  state.auditEvents![0].createdAt = "2026-10-17T02:30:00.000Z"; // Todavía 16/10 en Paraguay.
  state = appendAudit(
    state,
    { module: "Seguridad", operation: "Acceso denegado", status: "FALLIDO" },
    context(initial),
  );
  const matches = queryAudit(state, initial.users[0].id, {
    ...emptyAuditFilters,
    from: "2026-10-16",
    to: "2026-10-16",
    actorId: initial.users[0].id,
    module: "Catálogos",
    operation: "Modificar registro",
    status: "EXITO",
    search: "educacion",
  });
  assert.equal(matches.length, 1);
  assert.equal(
    queryAudit(state, initial.users[0].id, {
      ...emptyAuditFilters,
      status: "FALLIDO",
    }).length,
    1,
  );
  assert.throws(
    () =>
      queryAudit(state, initial.users[0].id, {
        ...emptyAuditFilters,
        from: "2026-02-30",
      }),
    /fechas/,
  );
  assert.throws(
    () =>
      queryAudit(state, initial.users[0].id, {
        ...emptyAuditFilters,
        from: "2026-10-17",
        to: "2026-10-16",
      }),
    /posterior/,
  );
  const demo = buildDemoData(
    initial,
    initial.users[0].id,
    "http://localhost:5173/",
  ).state;
  assert.equal(auditRecords(demo, initial.users[0].id).length, 8);
  assert.ok(
    auditRecords(demo, initial.users[0].id).every(
      (event) =>
        event.origin === "ANTERIOR" &&
        event.sessionId === null &&
        event.ip === null &&
        event.userAgent === null,
    ),
  );
  const canonical = auditMutation(initial, demo, context(initial));
  assert.equal(
    auditRecords(canonical, initial.users[0].id).filter(
      (event) => event.operation === "Registrar publicación",
    ).length,
    8,
    "No duplicar eventos antiguos y nuevos",
  );
});

test("Auditoría: filtra por el rol registrado y busca usuario, evento, publicación y sesión sin alterar el historial", async () => {
  const initial = await seed();
  const [admin, editor, reader] = initial.users;
  let state = initial;
  for (const actor of [admin, editor, reader]) {
    state = appendAudit(
      state,
      {
        module: "Publicaciones",
        operation: "Consultar publicación",
        status: "EXITO",
        publicationId: `publicacion-${actor.role}`,
      },
      { ...context(initial), actorId: actor.id },
    );
  }
  state = appendAudit(
    state,
    {
      module: "Sesiones",
      operation: "Iniciar sesión",
      status: "FALLIDO",
      actorId: null,
    },
    { ...context(initial), actorId: null, sessionId: null },
  );
  // El rol del evento debe conservarse aunque cambie el rol actual de la cuenta.
  state = {
    ...state,
    users: state.users.map((account) =>
      account.id === editor.id
        ? { ...account, role: "PUBLICO" as const, username: "carga.biblioteca" }
        : account,
    ),
  };
  const original = JSON.stringify(state);
  const matches = queryAudit(state, admin.id, {
    ...emptyAuditFilters,
    role: "DIGITADOR",
    module: "Publicaciones",
    search: "DIGITADOR",
  });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].actorId, editor.id);
  assert.equal(matches[0].actorRole, "DIGITADOR");
  for (const search of [
    matches[0].id,
    "publicacion-DIGITADOR",
    state.users[1].username,
  ]) {
    assert.ok(
      queryAudit(state, admin.id, {
        ...emptyAuditFilters,
        search,
      }).some((event) => event.id === matches[0].id),
    );
  }
  assert.equal(
    queryAudit(state, admin.id, {
      ...emptyAuditFilters,
      search: "sesion-de-prueba",
    }).length,
    3,
  );
  assert.equal(
    queryAudit(state, admin.id, {
      ...emptyAuditFilters,
      role: "SIN_IDENTIFICAR",
    }).length,
    1,
  );
  assert.equal(
    queryAudit(state, admin.id, {
      ...emptyAuditFilters,
      role: "DIGITADOR",
      actorId: reader.id,
    }).length,
    0,
  );
  assert.equal(JSON.stringify(state), original);
});

test("Confirmación: altas identificadas; parámetros requieren contraseña y los eventos no invalidan el estado de negocio pendiente", async () => {
  const initial = await seed();
  const created = saveCatalogRecord(initial, initial.users[0].id, "tipos", {
    name: "Alta para confirmar",
    fields: {},
  });
  assert.deepEqual(newBusinessRecords(initial, created), [
    "Alta para confirmar",
  ]);
  assert.equal(existingChanges(initial, created).length, 0);
  const configured = updateSettings(initial, initial.users[0].id, {
    summaryWordLimit: 200,
    maxPdfSizeMb: 2,
  });
  assert.equal(
    existingChanges(initial, configured)[0].name,
    "Parámetros generales",
  );
  const rejected = appendAudit(
    initial,
    {
      module: "Seguridad",
      operation: "Confirmación rechazada",
      status: "FALLIDO",
    },
    context(initial),
  );
  assert.equal(businessStateKey(initial), businessStateKey(rejected));
  assert.notEqual(businessStateKey(initial), businessStateKey(configured));
  const merged = auditMutation(
    rejected,
    { ...configured, auditEvents: rejected.auditEvents },
    context(initial),
  );
  assert.equal(merged.auditEvents!.length, 2);
  assert.equal(merged.auditEvents![0].status, "FALLIDO");
});

test("Persistencia: los cambios de negocio y su auditoría se guardan juntos; si falla la escritura, no cambia el almacenamiento", async () => {
  const initial = await seed();
  const prepared = auditMutation(
    initial,
    updateSettings(initial, initial.users[0].id, {
      summaryWordLimit: 100,
      maxPdfSizeMb: 2,
    }),
    context(initial),
  );
  let stored = JSON.stringify(initial);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem: () => {
        throw Error("Cuota llena");
      },
    },
  });
  try {
    assert.throws(() => save(prepared), /Cuota/);
    assert.deepEqual(JSON.parse(stored), initial);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        setItem: (_key: string, content: string) => {
          stored = content;
        },
      },
    });
    save(prepared);
    assert.equal(JSON.parse(stored).settings.summaryWordLimit, 100);
    assert.equal(JSON.parse(stored).auditEvents.length, 1);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("Parámetros: valores iniciales compatibles, rangos estrictos, permisos y validación efectiva del resumen", async () => {
  const initial = await seed();
  assert.deepEqual(settingsOf(initial), {
    summaryWordLimit: 300,
    maxPdfSizeMb: 10,
    allowedFormats: ["pdf"],
  });
  for (const account of initial.users.slice(1))
    assert.throws(
      () => updateSettings(initial, account.id, defaultSettings),
      /administrador/,
    );
  for (const input of [
    { summaryWordLimit: 9, maxPdfSizeMb: 10 },
    { summaryWordLimit: 1001, maxPdfSizeMb: 10 },
    { summaryWordLimit: 10.5, maxPdfSizeMb: 10 },
    { summaryWordLimit: 300, maxPdfSizeMb: 0 },
    { summaryWordLimit: 300, maxPdfSizeMb: 26 },
  ])
    assert.throws(() => updateSettings(initial, initial.users[0].id, input));
  const demo = buildDemoData(
    initial,
    initial.users[0].id,
    "http://localhost:5173/",
  ).state;
  const configured = updateSettings(demo, initial.users[0].id, {
    summaryWordLimit: 10,
    maxPdfSizeMb: 1,
  });
  const sample = configured.publications![0];
  const result = registerPublication(configured, initial.users[0].id, {
    title: "Un título nuevo",
    authorIds: sample.authors.map((author) => author.id),
    tutorIds: sample.tutors.map((tutor) => tutor.id),
    careerId: sample.career.id,
    levelId: sample.level.id,
    typeId: sample.type.id,
    branchId: sample.branch.id,
    summary: "palabra ".repeat(11),
    abstract: "A different abstract for validation",
    keywords: "prueba",
    year: 2026,
    approved: true,
    externalUrl: "https://example.test/documento.pdf",
  });
  assert.equal(result.exito, false);
  assert.match(result.mensaje, /10 palabras/);
  assert.deepEqual(configured.publications, demo.publications);
});

test("Parámetros: PDF respeta el tamaño configurado y los archivos anteriores siguen siendo legibles por metadatos", async () => {
  const file = new File(
    ["%PDF-1.7\n", new Uint8Array(1100000), "\n%%EOF"],
    "limite.pdf",
    { type: "application/pdf" },
  );
  await assert.rejects(() => preparePdf(file, 1024 * 1024), /1 MiB/);
  const attachment = await preparePdf(file, 2 * 1024 * 1024);
  assert.equal(attachment.size, file.size);
  assert.doesNotThrow(() => validateAttachmentMetadata(attachment));
  await assert.rejects(() => preparePdf(file, 26 * 1024 * 1024), /límite/);
});

test("Exportación de auditoría: mismos filtros, Excel de texto, PDF A4 con membrete y sin archivo cuando no hay resultados", async () => {
  const initial = await seed();
  let state = appendAudit(
    initial,
    {
      module: "Catálogos",
      operation: "Crear registro",
      status: "EXITO",
      resourceName: '=HYPERLINK("example.test")',
    },
    context(initial),
  );
  state = appendAudit(
    state,
    {
      module: "Catálogos",
      operation: "Crear registro",
      status: "EXITO",
    },
    { ...context(initial), actorId: initial.users[1].id },
  );
  const filters = {
    ...emptyAuditFilters,
    module: "Catálogos",
    role: "ADMINISTRADOR",
  };
  const spreadsheet = await buildAuditReport(
    state,
    initial.users[0].id,
    filters,
    "xlsx",
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(spreadsheet.bytes) as never);
  assert.equal(workbook.getWorksheet("Auditoría")!.rowCount, 2);
  assert.match(
    String(workbook.getWorksheet("Criterios")!.getCell("B3").value),
    /Rol: Administrador/,
  );
  assert.equal(
    workbook.getWorksheet("Auditoría")!.getCell("E2").value,
    "ADMINISTRADOR",
  );
  assert.equal(
    workbook.getWorksheet("Auditoría")!.getCell("I2").type,
    ExcelJS.ValueType.String,
  );
  const pdf = await buildAuditReport(
    state,
    initial.users[0].id,
    filters,
    "pdf",
  );
  const content = new TextDecoder("latin1").decode(pdf.bytes);
  assert.ok(content.startsWith("%PDF"));
  const dimensions = content.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(dimensions);
  assert.ok(Math.abs(Number(dimensions[1]) - 595.28) < 0.01);
  assert.ok(Math.abs(Number(dimensions[2]) - 841.89) < 0.01);
  assert.match(content, /Auditor/);
  assert.match(content, /\/Subtype \/Image/);
  await assert.rejects(
    () =>
      buildAuditReport(
        state,
        initial.users[0].id,
        { ...filters, search: "sin resultados" },
        "pdf",
      ),
    /No hay eventos/,
  );
});
