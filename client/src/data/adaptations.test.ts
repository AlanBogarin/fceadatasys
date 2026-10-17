import assert from "node:assert/strict";
import test from "node:test";
import { prepareAttachment } from "../attachments";
import {
  availableAttachments,
  selectableAttachments,
  uploadedAttachmentFromDto,
} from "../attachmentService";
import { appendAudit, auditMutation, emptyAuditFilters } from "../audit";
import { emptyBibliographicFilters } from "../bibliography";
import { buildDemoData } from "../demoData";
import { DEMO_PASSWORD, passwordError, seed, type State } from "../model";
import { verifyConfirmationHeader } from "../mutationPolicy";
import { viewStateOf } from "./view";
import {
  emptyReportFilters,
  inactivatePublication,
  type PublicationInput,
} from "../publications";
import { INACTIVITY_MS } from "../security";
import { settingsOf, updateSettings } from "../settings";
import { assertMockMode, clientConfig } from "./config";
import { createMockClient } from "./mockClient";
import {
  ClientProblem,
  confirmationHeaders,
  errorKind,
  parseProblem,
  problem,
} from "./problems";
import { clientDeadline, LatestQuery, paginate } from "./query";
import {
  ABSOLUTE_SESSION_MS,
  MockSessionStore,
  SHARED_SESSION_KEY,
} from "./session";
import { assertVersion, canonical, etagOf } from "./versions";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
function mutex() {
  let tail = Promise.resolve();
  return async <T>(work: () => Promise<T>) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  };
}
const initial = seed().then(
  (state) =>
    buildDemoData(state, state.users[0].id, "http://localhost:5173").state,
);
async function fixture(role = 0, authenticated = true) {
  let state = structuredClone(await initial);
  const memory = new MemoryStorage();
  const sessions = new MockSessionStore(memory, Date.now, mutex());
  if (authenticated) await sessions.login(state.users[role].id);
  let failAudit = false;
  const binaries = new Map<string, Blob>();
  const context = () => ({
    actorId: sessions.read()?.userId ?? null,
    sessionId: sessions.read()?.id ?? null,
    userAgent: "Pruebas de adaptador simulado",
  });
  function persist(
    next: State,
    before: State,
    intent?: Parameters<typeof auditMutation>[3],
  ) {
    if (failAudit)
      throw problem(
        503,
        "AUDIT_UNAVAILABLE",
        "No se pudo guardar la auditoría; operación cancelada.",
      );
    if (canonical(state) !== canonical(before))
      throw problem(412, "RESOURCE_VERSION_CONFLICT", "Los datos cambiaron.");
    state = auditMutation(before, next, context(), intent);
  }
  const client = createMockClient({
    read: () => state,
    actorId: () => sessions.read()?.userId ?? "",
    assertActive: () => {
      sessions.assert();
    },
    commit: async (next, before) => persist(next, before),
    audit: async (intent) => {
      if (failAudit)
        throw problem(503, "AUDIT_UNAVAILABLE", "Auditoría no disponible.");
      state = appendAudit(state, intent, context());
    },
    authentication: {
      current: () => sessions.read(),
      login: async (id, before) => {
        await sessions.login(id, before);
      },
      logout: async (before) => {
        const current = sessions.read();
        if (current) await sessions.logout(current.id, before);
      },
      activity: async () => {
        await sessions.activity(sessions.assert().id);
      },
      commit: (next, before, intent) => persist(next, before, intent),
    },
    coordinate: mutex(),
    writeBinary: async (id, file) => {
      if (file) binaries.set(id, file);
      else binaries.delete(id);
    },
    readBinary: async (attachment) => {
      const file = binaries.get(attachment.id);
      if (!file) throw Error("No se encontró el binario de prueba.");
      return new Uint8Array(await file.arrayBuffer());
    },
  });
  return {
    client,
    sessions,
    memory,
    binaries,
    get state() {
      return state;
    },
    setState(next: State) {
      state = next;
    },
    failAudit(value = true) {
      failAudit = value;
    },
  };
}
const isProblem = (status: number, code?: string) => (error: unknown) =>
  error instanceof ClientProblem &&
  error.status === status &&
  (!code || error.code === code);
function input(state: State, suffix = "adaptación"): PublicationInput {
  const sample = state.publications![0];
  return {
    title: `Investigación nueva ${suffix}`,
    summary: `Resumen original para la investigación ${suffix}.`,
    abstract: `Original abstract for research ${suffix}.`,
    keywords: "catálogo, prueba",
    authorIds: sample.authors.map((person) => person.id),
    tutorIds: sample.tutors.map((person) => person.id),
    careerId: sample.career.id,
    levelId: sample.level.id,
    typeId: sample.type.id,
    branchId: sample.branch.id,
    externalUrl: "https://example.org/prueba",
    source: "EXTERNA",
    year: 2026,
    approved: true,
  };
}

test("Configuración: mock por defecto, URL base validada y API bloqueada sin transporte", () => {
  assert.equal(clientConfig().mode, "mock");
  assert.doesNotThrow(() => assertMockMode(clientConfig()));
  assert.throws(
    () => assertMockMode(clientConfig({ VITE_DATA_MODE: "api" })),
    /no está habilitado/,
  );
  for (const url of [
    "javascript:alert(1)",
    "https://user:secret@example.org/api/v1",
    "http://localhost/api/v1?secret=1",
  ])
    assert.throws(() => clientConfig({ VITE_API_BASE_URL: url }));
});

test("DTO: usuarios seguros, sin hashes/sales/contadores y totales independientes de la página", async () => {
  const f = await fixture();
  const page = await f.client.users.list({ pageSize: 1, page: 2 });
  assert.equal(page.data.length, 1);
  assert.equal(page.pagination.total, 3);
  assert.equal(page.summary.total, 3);
  const text = JSON.stringify(page);
  for (const key of [
    "passwordHash",
    "salt",
    "lockedUntil",
    "failures",
    DEMO_PASSWORD,
  ])
    assert.equal(text.includes(key), false);
  const item = await f.client.users.get(page.data[0].id);
  assert.match(item.etag, /^"sha256-[a-f0-9]{64}"$/);
});

test("Pantallas: modelo de lectura sin secretos, recuperaciones, auditoría privada ni usuarios ajenos", async () => {
  const f = await fixture();
  f.state.recovery.push({
    userId: f.state.users[0].id,
    hash: "recuperacion-privada",
    expiresAt: Date.now() + 60000,
  });
  for (const user of f.state.users) {
    const view = viewStateOf(f.state, user.id);
    const text = JSON.stringify(view);
    for (const secret of [
      "passwordHash",
      "salt",
      "lockedUntil",
      "failures",
      "recovery",
      "auditEvents",
      "participantIds",
      "demoKey",
      "recuperacion-privada",
    ])
      assert.equal(text.includes(secret), false, secret);
    assert.equal(view.users.length, user.role === "ADMINISTRADOR" ? 3 : 1);
    if (user.role === "PUBLICO") {
      assert.deepEqual(view.catalogs.autores, []);
      assert.deepEqual(view.catalogs.tutores, []);
      assert.deepEqual(view.uploadedAttachments, []);
    }
  }
  assert.throws(() => viewStateOf(f.state, "inexistente"));
});

test("Versión canónica: JSON válido y estable para objetos anidados", () => {
  const value = {
    z: [{ b: true, a: "á" }],
    a: { x: null },
    omitted: undefined,
  };
  assert.deepEqual(JSON.parse(canonical(value)), {
    a: { x: null },
    z: [{ a: "á", b: true }],
  });
});

test("Datos de demostración: servicio devuelve solamente conteos sin exponer el estado privado", async () => {
  const f = await fixture();
  const result = await f.client.demo.load("http://localhost:5173");
  assert.equal("state" in result, false);
  assert.equal(result.addedPublications, 0);
  const publicFixture = await fixture(2);
  await assert.rejects(
    publicFixture.client.demo.load("http://localhost:5173"),
    isProblem(403),
  );
});

test("Sesión única: dos pestañas comparten identidad, rechazan otro login y cierran juntas", async () => {
  const memory = new MemoryStorage();
  const coordinate = mutex();
  let now = Date.now();
  const a = new MockSessionStore(memory, () => now, coordinate);
  const b = new MockSessionStore(memory, () => now, coordinate);
  const results = await Promise.allSettled([
    a.login("primera"),
    b.login("segunda"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter(
      (result) =>
        result.status === "rejected" &&
        isProblem(409, "BROWSER_SESSION_ACTIVE")(result.reason),
    ).length,
    1,
  );
  assert.equal(a.read()?.id, b.read()?.id);
  assert.equal(a.read()?.userId, b.read()?.userId);
  const id = a.assert().id;
  await b.logout(id);
  assert.equal(a.read(), null);
  assert.throws(() => a.assert(id), isProblem(401));
  assert.equal(memory.getItem(SHARED_SESSION_KEY), null);
});

test("Actividad: plazos compartidos, frecuencia limitada, vencimiento exacto y máximo absoluto", async () => {
  let now = Date.now();
  const memory = new MemoryStorage();
  const coordinate = mutex();
  const a = new MockSessionStore(memory, () => now, coordinate);
  const b = new MockSessionStore(memory, () => now, coordinate);
  const first = await a.login("persona");
  now += 14000;
  await a.activity(first.id);
  assert.equal(a.read()?.lastActivityAt, first.createdAt);
  now += 1000;
  await a.activity(first.id);
  assert.equal(b.read()?.lastActivityAt, now);
  now += INACTIVITY_MS;
  assert.equal(b.active(), false);
  await assert.rejects(b.activity(first.id), isProblem(401));
  const next = await b.login("persona");
  assert.notEqual(next.id, first.id);
  now = next.createdAt + ABSOLUTE_SESSION_MS;
  memory.setItem(
    SHARED_SESSION_KEY,
    JSON.stringify({ ...next, lastActivityAt: now - 1000 }),
  );
  assert.equal(a.active(), false);
});

test("Auditoría fallida impide login/logout y conserva contador y sesión de confirmación", async () => {
  const memory = new MemoryStorage();
  const store = new MockSessionStore(memory, Date.now, mutex());
  const broken = async () => {
    throw Error("Fallo de auditoría");
  };
  await assert.rejects(store.login("persona", broken));
  assert.equal(store.read(), null);
  const current = await store.login("persona");
  await assert.rejects(store.logout(current.id, broken));
  assert.equal(store.read()?.id, current.id);
  await assert.rejects(store.confirmation(current.id, false, broken));
  assert.equal(store.read()?.confirmationFailures, 0);
  await store.confirmation(current.id, false);
  await store.confirmation(current.id, false);
  await assert.rejects(store.confirmation(current.id, false, broken));
  assert.equal(store.read()?.confirmationFailures, 2);
  await store.confirmation(current.id, true);
  assert.equal(store.read()?.confirmationFailures, 0);
  await store.confirmation(current.id, false);
  await store.confirmation(current.id, false);
  assert.equal(await store.confirmation(current.id, false), 3);
  assert.equal(store.read(), null);
});

test("Contratos de sesión: restaurar/renovar no crea sesión ni renueva actividad; credenciales no se persisten", async () => {
  const f = await fixture(0, false);
  const first = await f.client.auth.login("admin", DEMO_PASSWORD);
  const restored = await f.client.auth.session();
  const refreshed = await f.client.auth.refresh();
  assert.equal(first.session.id, restored.session.id);
  assert.equal(restored.session.id, refreshed.session.id);
  assert.equal(first.session.lastActivityAt, refreshed.session.lastActivityAt);
  assert.equal(first.accessToken, undefined);
  assert.equal(
    JSON.stringify([...f.memory.values]).includes(DEMO_PASSWORD),
    false,
  );
  assert.equal(JSON.stringify(first).includes("passwordHash"), false);
});

test("Reloj del cliente: usa serverTime y el menor vencimiento; datos inválidos vencen inmediatamente", () => {
  assert.equal(
    clientDeadline(
      "2026-01-01T10:00:00Z",
      "2026-01-08T10:00:00Z",
      "2026-01-01T10:05:00Z",
      1000,
    ),
    301000,
  );
  assert.equal(clientDeadline("bad", "bad", "bad", 1000), 1000);
  assert.equal(
    clientDeadline(
      "2026-01-01T10:00:00Z",
      "2026-01-01T09:00:00Z",
      "2026-01-01T10:05:00Z",
      1000,
    ),
    1000,
  );
});

test("Confirmación: Base64 UTF-8 conserva contraseñas Unicode y rechaza encabezados inválidos", async () => {
  const f = await fixture();
  const password = "Fçeá-🔐-2026!";
  const header = confirmationHeaders(password)["X-Confirmation-Password"];
  assert.equal(
    new TextDecoder().decode(
      Uint8Array.from(atob(header), (character) => character.charCodeAt(0)),
    ),
    password,
  );
  assert.equal(
    await verifyConfirmationHeader(
      f.state,
      f.state.users[0].id,
      confirmationHeaders(DEMO_PASSWORD)["X-Confirmation-Password"],
    ),
    true,
  );
  assert.equal(
    await verifyConfirmationHeader(
      f.state,
      f.state.users[0].id,
      confirmationHeaders("Incorrecta2026!")["X-Confirmation-Password"],
    ),
    false,
  );
  await assert.rejects(
    verifyConfirmationHeader(f.state, f.state.users[0].id, "%%%"),
    isProblem(428),
  );
  assert.equal(passwordError("A1" + "x".repeat(126)), "");
  assert.notEqual(passwordError("A1" + "x".repeat(127)), "");
});

test("Problem Details: conserva errores por campo y distingue sesión, permiso, duplicado, versión y auditoría", () => {
  const parsed = parseProblem({
    status: 400,
    code: "VALIDATION_ERROR",
    title: "Campos inválidos",
    detail: "Revisá el formulario.",
    invalid_params: [
      { name: "body.fields.email", reason: "Correo inválido" },
      { name: 4, reason: null },
    ],
  });
  assert.deepEqual(parsed.fields, { "body.fields.email": "Correo inválido" });
  for (const [status, code, kind] of [
    [401, "UNAUTHENTICATED", "session"],
    [403, "FORBIDDEN", "permission"],
    [409, "DUPLICATE_USER", "duplicate"],
    [412, "RESOURCE_VERSION_CONFLICT", "version"],
    [503, "AUDIT_UNAVAILABLE", "audit"],
    [400, "INVALID_CONFIRMATION_PASSWORD", "confirmation"],
    [401, "CONFIRMATION_EXPIRED", "credential_changed"],
  ] as const)
    assert.equal(errorKind(problem(status, code, "Detalle")), kind);
  assert.equal(
    parseProblem({ detail: "PASSWORD_PRIVADO" }).message.includes(
      "PASSWORD_PRIVADO",
    ),
    false,
  );
});

test("Versiones: valores opacos, contenido estable y conflicto que no sobrescribe registros", async () => {
  const f = await fixture();
  const id = f.state.catalogs.tipos[0].id;
  const first = await f.client.catalogs.get("tipos", id);
  await assert.rejects(
    f.client.catalogs.save(
      "tipos",
      { name: "Cambio sin versión", fields: first.data.fields },
      id,
    ),
    isProblem(428),
  );
  const saved = await f.client.catalogs.save(
    "tipos",
    { name: "Tipo corregido", fields: first.data.fields },
    id,
    { ifMatch: first.etag },
  );
  await assert.rejects(
    f.client.catalogs.save(
      "tipos",
      { name: "Sobrescritura vieja", fields: first.data.fields },
      id,
      { ifMatch: first.etag },
    ),
    isProblem(412),
  );
  assert.equal(
    (await f.client.catalogs.get("tipos", id)).data.name,
    "Tipo corregido",
  );
  assert.notEqual(first.etag, saved.etag);
  assert.equal(await etagOf({ a: 1, b: 2 }), await etagOf({ b: 2, a: 1 }));
  await assert.rejects(assertVersion({}, 'W/"x"'), isProblem(400));
});

test("Escrituras concurrentes con la misma versión solo confirman una", async () => {
  const f = await fixture();
  const current = await f.client.settings.get();
  const results = await Promise.allSettled([
    f.client.settings.update(
      { ...current.data, summaryWordLimit: 200 },
      { ifMatch: current.etag },
    ),
    f.client.settings.update(
      { ...current.data, summaryWordLimit: 250 },
      { ifMatch: current.etag },
    ),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    results.filter(
      (result) => result.status === "rejected" && isProblem(412)(result.reason),
    ).length,
    1,
  );
});

test("Paginación: total global y consultas fuera de orden/canceladas no reemplazan resultados recientes", async () => {
  const rows = Array.from({ length: 42 }, (_, i) => i);
  assert.equal(paginate(rows, 3, 10).pagination.total, 42);
  assert.equal(paginate(rows, 3, 10).data[0], 20);
  let first!: (value: string) => void;
  const published: string[] = [];
  const query = new LatestQuery();
  const old = query.run(
    () =>
      new Promise((resolve) => {
        first = resolve;
      }),
    (value) => published.push(String(value)),
  );
  await query.run(
    async () => "nueva",
    (value) => published.push(value),
  );
  first("vieja");
  await old;
  assert.deepEqual(published, ["nueva"]);
  let finish!: (value: string) => void;
  const cancelled = query.run(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    (value) => published.push(String(value)),
  );
  query.cancel();
  finish("cerrada");
  await cancelled;
  assert.deepEqual(published, ["nueva"]);
});

test("Publicaciones: editar conserva código/creador/fecha y valida duplicados contra la propia publicación", async () => {
  const f = await fixture(1);
  const sample = f.state.publications![0];
  const before = await f.client.publications.get(sample.id);
  const updated = await f.client.publications.update(
    sample.id,
    {
      title: "Título corregido por Digitador",
      authorIds: [...sample.authors].reverse().map((person) => person.id),
    },
    { ifMatch: before.etag },
  );
  assert.equal(updated.code, sample.code);
  assert.deepEqual(updated.createdBy, sample.createdBy);
  assert.equal(updated.createdAt, sample.createdAt);
  assert.equal(updated.title, "Título corregido por Digitador");
  assert.deepEqual(
    updated.authors.map((person) => person.id),
    [...sample.authors].reverse().map((person) => person.id),
  );
  const current = await f.client.publications.get(sample.id);
  await assert.rejects(
    f.client.publications.update(
      sample.id,
      { title: f.state.publications![1].title },
      { ifMatch: current.etag },
    ),
    isProblem(409),
  );
  await assert.rejects(
    f.client.publications.inactivate(sample.id, { ifMatch: current.etag }),
    isProblem(403),
  );
});

test("Inactivación: Admin conserva historia; Público/Digitador no consultan ni descargan inactivas", async () => {
  const f = await fixture();
  const id = f.state.publications![0].id;
  const current = await f.client.publications.get(id);
  await f.client.publications.inactivate(id, { ifMatch: current.etag });
  assert.equal((await f.client.publications.get(id)).data.active, false);
  assert.equal(f.state.publications!.length, 8);
  await f.client.auth.logout();
  await f.client.auth.login("publico", DEMO_PASSWORD);
  await assert.rejects(f.client.publications.get(id), isProblem(404));
  assert.equal(
    (await f.client.publications.list(emptyBibliographicFilters)).pagination
      .total,
    7,
  );
  await assert.rejects(f.client.audit.list(emptyAuditFilters), isProblem(403));
});

test("Formatos: TXT exige habilitación, UTF-8, contenido no vacío y ausencia de controles binarios", async () => {
  const valid = new File(
    ["Texto académico con ñ y acentos.\n"],
    "  trabajo.txt",
    { type: "text/plain" },
  );
  await assert.rejects(prepareAttachment(valid), /no habilitado/);
  const prepared = await prepareAttachment(valid, 1024 * 1024, ["txt"]);
  assert.equal(prepared.mime, "text/plain");
  assert.equal(prepared.name, "trabajo.txt");
  for (const bytes of [
    new Uint8Array([0xff, 0xfe]),
    new TextEncoder().encode("a\0b"),
    new TextEncoder().encode("  \n"),
  ])
    await assert.rejects(
      prepareAttachment(new File([bytes], "malo.txt"), 1024 * 1024, ["txt"]),
    );
  const f = await fixture();
  assert.throws(() =>
    updateSettings(f.state, f.state.users[0].id, {
      ...settingsOf(f.state),
      allowedFormats: [],
    }),
  );
});

test("Adjuntos: carga por ID, uso histórico reservado y estados rechazado/pendiente nunca descargables", async () => {
  const f = await fixture();
  const settings = await f.client.settings.get();
  await f.client.settings.update(
    { ...settings.data, allowedFormats: ["pdf", "txt"] },
    { ifMatch: settings.etag },
  );
  const file = await f.client.attachments.upload(
    new File(["Copia de texto institucional, versión original."], "tesis.txt", {
      type: "text/plain",
    }),
  );
  const created = await f.client.publications.create({
    ...input(f.state, "archivo"),
    source: "LOCAL",
    externalUrl: "",
    requiresLibraryCopy: true,
    attachmentId: file.id,
  });
  assert.equal(created.attachment?.id, file.id);
  const download = await f.client.attachments.download(file.id);
  assert.ok("bytes" in download);
  const current = await f.client.publications.get(created.id);
  await f.client.publications.update(
    created.id,
    {
      source: "EXTERNA",
      externalUrl: "https://example.org/reemplazo",
      requiresLibraryCopy: false,
      attachmentId: null,
    },
    { ifMatch: current.etag },
  );
  const reserved = (
    await f.client.attachments.list({ status: "RESERVADO" })
  ).data.find((row) => row.id === file.id)!;
  assert.equal(reserved.reservedPublicationId, created.id);
  // Rebuild the read model using only API metadata, without the local attachment history.
  const reloaded = JSON.parse(JSON.stringify(f.state)) as State;
  reloaded.publications = reloaded.publications!.map((publication) => ({
    ...publication,
    attachmentHistory: undefined,
  }));
  reloaded.uploadedAttachments = [uploadedAttachmentFromDto(reserved)];
  f.setState(reloaded);
  assert.equal(
    selectableAttachments(f.state, f.state.users[0].id, created.id).some(
      (row) => row.attachment.id === file.id,
    ),
    true,
  );
  assert.equal(
    selectableAttachments(
      f.state,
      f.state.users[0].id,
      "another-publication",
    ).some((row) => row.attachment.id === file.id),
    false,
  );
  assert.equal(
    availableAttachments(f.state, f.state.users[0].id).some(
      (row) => row.attachment.id === file.id,
    ),
    false,
  );
  await assert.rejects(
    f.client.publications.create({
      ...input(f.state, "otra"),
      source: "LOCAL",
      externalUrl: "",
      requiresLibraryCopy: true,
      attachmentId: file.id,
    }),
    isProblem(409),
  );
  const latest = await f.client.publications.get(created.id);
  const restored = await f.client.publications.update(
    created.id,
    {
      source: "LOCAL",
      externalUrl: "",
      requiresLibraryCopy: true,
      attachmentId: file.id,
    },
    { ifMatch: latest.etag },
  );
  assert.equal(restored.attachment?.id, file.id);
  for (const status of ["RECHAZADO", "PENDIENTE"] as const) {
    f.setState({
      ...f.state,
      uploadedAttachments: f.state.uploadedAttachments!.map((upload) =>
        upload.attachment.id === file.id ? { ...upload, status } : upload,
      ),
    });
    assert.equal(
      selectableAttachments(f.state, f.state.users[0].id, created.id).some(
        (row) => row.attachment.id === file.id,
      ),
      false,
    );
    await assert.rejects(
      f.client.attachments.download(file.id),
      isProblem(404),
    );
  }
});

test("Reportes: filtros por año/tipo/nombres y snapshot; vacío no genera archivo y límites no dependen de la página", async () => {
  const f = await fixture();
  const first = f.state.publications![0];
  const filters = {
    ...emptyReportFilters,
    typeId: first.type.id,
    year: String(first.year),
    author: first.authors[0].name,
  };
  const result = await f.client.reports.list(filters, 1, 1);
  assert.ok(result.pagination.total > 0);
  assert.equal(result.data.length, 1);
  assert.equal(result.report.exportable, true);
  assert.equal(
    result.data.every(
      (record) =>
        record.year === first.year && record.type.id === first.type.id,
    ),
    true,
  );
  const noRows = { ...filters, year: "1900" };
  assert.deepEqual(
    await f.client.reports.export(noRows, "pdf", "sin-registros"),
    { data: [], total: 0 },
  );
  f.setState(inactivatePublication(f.state, f.state.users[0].id, first.id));
  await assert.rejects(
    f.client.reports.export(filters, "pdf", result.report.snapshot),
    isProblem(409, "REPORT_VERSION_CONFLICT"),
  );
  const current = await f.client.reports.list(emptyReportFilters);
  f.setState({
    ...f.state,
    publications: Array.from({ length: 501 }, (_, index) => ({
      ...first,
      id: crypto.randomUUID(),
      code: `INV-${index}`,
    })),
  });
  const large = await f.client.reports.list(emptyReportFilters, 1, 1);
  assert.equal(large.data.length, 1);
  assert.equal(large.pagination.total, 501);
  assert.equal(large.report.exportable, false);
  await assert.rejects(
    f.client.reports.export(emptyReportFilters, "pdf", current.report.snapshot),
    isProblem(400, "REPORT_LIMIT_EXCEEDED"),
  );
});

test("Exportación auditada: PDF/Excel reales, selección completa y cancelación si falla la auditoría", async () => {
  const f = await fixture();
  const query = await f.client.reports.list(emptyReportFilters, 1, 1);
  const xlsx = await f.client.reports.export(
    emptyReportFilters,
    "xlsx",
    query.report.snapshot,
  );
  assert.ok("bytes" in xlsx);
  if ("bytes" in xlsx)
    assert.equal(new TextDecoder().decode(xlsx.bytes.slice(0, 2)), "PK");
  const audit = await f.client.audit.list(emptyAuditFilters, 1, 1);
  assert.equal(audit.data.length, 1);
  assert.ok(audit.pagination.total > audit.data.length);
  const pdf = await f.client.audit.export(
    emptyAuditFilters,
    "pdf",
    audit.export.snapshot,
  );
  assert.ok("bytes" in pdf);
  if ("bytes" in pdf)
    assert.equal(new TextDecoder().decode(pdf.bytes.slice(0, 4)), "%PDF");
  const latest = await f.client.reports.list(emptyReportFilters);
  f.failAudit();
  await assert.rejects(
    f.client.reports.export(emptyReportFilters, "pdf", latest.report.snapshot),
    isProblem(503, "AUDIT_UNAVAILABLE"),
  );
});

test("Recuperación: mensaje genérico, token solo en memoria, consumo único y cierre de la sesión compartida", async () => {
  const f = await fixture(0, false);
  const unknown = await f.client.auth.requestRecovery(
    "desconocido@example.test",
  );
  const known = await f.client.auth.requestRecovery(f.state.users[0].email);
  assert.deepEqual(unknown, known);
  const token = f.client.auth.demoRecoveryToken(f.state.users[0].email);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(f.state).includes(token), false);
  await f.client.auth.login("admin", DEMO_PASSWORD);
  await assert.rejects(
    f.client.auth.resetPassword(token, DEMO_PASSWORD),
    isProblem(400, "PASSWORD_UNCHANGED"),
  );
  await f.client.auth.resetPassword(token, "NuevaRecuperada2026!");
  assert.equal(f.sessions.read(), null);
  await assert.rejects(
    f.client.auth.resetPassword(token, "OtraNueva2026!"),
    isProblem(400, "INVALID_RECOVERY_TOKEN"),
  );
  await f.client.auth.login("admin", "NuevaRecuperada2026!");
});

test("Recuperación limita solicitudes y un fallo de auditoría no crea tokens ni cambia contraseñas", async () => {
  const f = await fixture(0, false);
  const email = f.state.users[0].email;
  f.failAudit();
  const before = canonical(f.state);
  await assert.rejects(f.client.auth.requestRecovery(email), isProblem(503));
  assert.equal(canonical(f.state), before);
  f.failAudit(false);
  for (let count = 0; count < 4; count++)
    await f.client.auth.requestRecovery(email);
  assert.equal(f.state.recovery.length, 3);
  assert.equal(f.client.auth.demoRecoveryToken(email), "");
});

test("Cambiar correo invalida recuperaciones pendientes; Público conserva restricciones de lectura", async () => {
  const f = await fixture(0, false);
  const email = f.state.users[0].email;
  await f.client.auth.requestRecovery(email);
  const token = f.client.auth.demoRecoveryToken(email);
  await f.client.auth.login("admin", DEMO_PASSWORD);
  await f.client.users.profile({
    name: f.state.users[0].name,
    username: "admin",
    email: "actualizado@example.test",
  });
  await assert.rejects(
    f.client.auth.resetPassword(token, "Otra2026!"),
    isProblem(400, "INVALID_RECOVERY_TOKEN"),
  );
  const settings = await f.client.settings.get();
  await f.client.settings.update(
    { ...settings.data, allowedFormats: ["pdf", "txt"] },
    { ifMatch: settings.etag },
  );
  const attachment = await f.client.attachments.upload(
    new File(
      ["Texto de una publicación para consulta pública."],
      "publicacion.txt",
      { type: "text/plain" },
    ),
  );
  const created = await f.client.publications.create({
    ...input(f.state, "consulta pública"),
    source: "LOCAL",
    externalUrl: "",
    requiresLibraryCopy: true,
    attachmentId: attachment.id,
  });
  await f.client.auth.logout();
  await f.client.auth.login("publico", DEMO_PASSWORD);
  const data = await f.client.publications.get(created.id);
  assert.equal(data.data.hasAttachment, true);
  assert.equal(data.data.attachment, undefined);
  await assert.rejects(f.client.attachments.list(), isProblem(403));
  await assert.rejects(f.client.users.list(), isProblem(403));
});
