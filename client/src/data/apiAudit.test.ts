import test from "node:test";
import assert from "node:assert/strict";
import { emptyAuditFilters } from "../audit";
import { createApiClient } from "./apiClient";
import { ApiSession } from "./apiSession";
import { HttpTransport } from "./http";
import { dashboardLinks, loadDashboard } from "./dashboard";
import type { DataClient } from "./client";

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type":
        status >= 400 ? "application/problem+json" : "application/json",
    },
  });
const metadata = { snapshot: null, exportable: false, maxRecords: 500 };

test("Auditoría HTTP: opciones globales completas, actores históricos, totales separados y caché invalidable", async () => {
  const calls: URL[] = [];
  const http = new HttpTransport("http://api.test", async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const page = Number(url.searchParams.get("page") ?? 1);
    const size = Number(url.searchParams.get("pageSize") ?? 10);
    const audit = url.pathname === "/auditoria";
    const global =
      !url.searchParams.has("search") && !url.searchParams.has("status");
    const total = audit
      ? global
        ? 205
        : url.searchParams.has("status")
          ? 37
          : 2
      : 101;
    const rows = audit
      ? Array.from(
          { length: Math.min(size, Math.max(0, total - (page - 1) * size)) },
          (_, index) => ({
            id: `${page}-${index}`,
            module: page === 3 ? "modulo-ultima-pagina" : "usuarios",
            operation: page === 3 ? "ULTIMA_OPERACION" : "LOGIN_EXITOSO",
            actorId: page === 3 ? "historico" : "actual",
            actorName: "Actor",
            username: "cuenta",
            actorRole: "DIGITADOR",
            before: { name: "Antes" },
          }),
        )
      : [
          {
            id: page === 2 ? "ultimo" : "actual",
            name: "Cuenta vigente",
            username: "actual",
          },
        ];
    return json({
      data: rows,
      pagination: {
        page,
        pageSize: size,
        total,
        totalPages: Math.ceil(total / size),
      },
      export: metadata,
    });
  });
  http.setToken("memory");
  const session = new ApiSession(http);
  const client = createApiClient(session, async () => undefined);
  const [result, concurrent] = await Promise.all([
    client.audit.list({ ...emptyAuditFilters, search: "literal + á" }, 2, 1),
    client.audit.list({ ...emptyAuditFilters }, 1, 10),
  ]);
  assert.equal(result.pagination.total, 2);
  assert.equal(result.summary.total, 205);
  assert.equal(result.summary.failed, 37);
  assert.deepEqual(result.summary.modules, [
    "modulo-ultima-pagina",
    "usuarios",
  ]);
  assert.ok(result.summary.operations.includes("ULTIMA_OPERACION"));
  assert.ok(result.summary.actors.some((actor) => actor.id === "historico"));
  assert.ok(result.summary.actors.some((actor) => actor.id === "ultimo"));
  assert.equal(result.data[0].actorRole, "DIGITADOR");
  assert.equal(result.data[0].origin, undefined);
  assert.equal(result.export.snapshot, null);
  assert.deepEqual(result.summary.modules, concurrent.summary.modules);
  const walks = () =>
    calls.filter((url) => url.searchParams.get("pageSize") === "100").length;
  assert.equal(walks(), 5);
  await client.audit.list({ ...emptyAuditFilters, module: "usuarios" });
  assert.equal(walks(), 5);
  client.audit.invalidateOptions?.();
  await client.audit.list({ ...emptyAuditFilters });
  assert.equal(walks(), 10);
  session.invalidate();
  await client.audit.list({ ...emptyAuditFilters });
  assert.equal(walks(), 15);
  session.clear();
  http.setToken("another-session");
  await client.audit.list({ ...emptyAuditFilters });
  assert.equal(walks(), 20);
  assert.ok(
    calls.some((url) => url.searchParams.get("search") === "literal + á"),
  );
});

test("Auditoría HTTP: error o cambio entre páginas no produce opciones incompletas ni un vacío falso", async () => {
  let broken = true;
  const http = new HttpTransport("http://api.test", async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/usuarios")
      return json({ data: [], pagination: { total: 0, totalPages: 0 } });
    const page = Number(url.searchParams.get("page") ?? 1);
    if (page === 2 && broken)
      return json(
        { status: 503, code: "AUDIT_UNAVAILABLE", detail: "Indisponible" },
        503,
      );
    return json({
      data: [],
      export: metadata,
      pagination: { total: page === 2 ? 102 : 101, totalPages: 2 },
    });
  });
  http.setToken("memory");
  const client = createApiClient(new ApiSession(http), async () => undefined);
  await assert.rejects(client.audit.list({ ...emptyAuditFilters }), {
    code: "AUDIT_UNAVAILABLE",
  });
  broken = false;
  await assert.rejects(
    client.audit.list({ ...emptyAuditFilters }),
    /cambiaron/,
  );
});

test("Auditoría HTTP: cancelar un lector no cancela al otro; una lectura nueva no reutiliza una caché abortada", async () => {
  let release!: () => void;
  let barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const http = new HttpTransport("http://api.test", async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get("pageSize") === "100") await barrier;
    return json({
      data: [],
      pagination: { total: 0, totalPages: 0 },
      export: metadata,
    });
  });
  http.setToken("memory");
  const client = createApiClient(new ApiSession(http), async () => undefined);
  const controller = new AbortController();
  const first = client.audit.list(
    { ...emptyAuditFilters },
    1,
    10,
    controller.signal,
  );
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = client.audit.list({ ...emptyAuditFilters });
  controller.abort();
  release();
  await rejected;
  assert.equal((await second).summary.total, 0);
  client.audit.invalidateOptions?.();
  barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const only = new AbortController();
  const abandoned = assert.rejects(
    client.audit.list({ ...emptyAuditFilters }, 1, 10, only.signal),
    { name: "AbortError" },
  );
  only.abort();
  const fresh = client.audit.list({ ...emptyAuditFilters });
  release();
  await abandoned;
  assert.equal((await fresh).summary.total, 0);
});

test("Auditoría HTTP: exportar conserva filtros/snapshot opaco, omite paginación y nunca devuelve bytes ante Problem Details", async () => {
  let fail = false;
  const http = new HttpTransport("http://api.test", async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/auditoria/exportar");
    assert.equal(init?.method, "GET");
    assert.equal(url.searchParams.get("snapshot"), "valor opaco");
    assert.equal(url.searchParams.get("role"), "SIN_IDENTIFICAR");
    assert.equal(url.searchParams.has("pageSize"), false);
    assert.equal(url.searchParams.has("search"), false);
    return fail
      ? json(
          {
            code: "AUDIT_VERSION_CONFLICT",
            status: 409,
            detail: "Volvé a consultar",
          },
          409,
        )
      : json({ data: [], total: 0 });
  });
  http.setToken("memory");
  const session = new ApiSession(http);
  const client = createApiClient(session, async () => {
    throw Error("No corresponde contraseña");
  });
  assert.deepEqual(
    await client.audit.export(
      { ...emptyAuditFilters, role: "SIN_IDENTIFICAR" },
      "pdf",
      "valor opaco",
    ),
    { data: [], total: 0 },
  );
  assert.equal(session.getSnapshot().revision, 1);
  fail = true;
  await assert.rejects(
    client.audit.export(
      { ...emptyAuditFilters, role: "SIN_IDENTIFICAR" },
      "xlsx",
      "valor opaco",
    ),
    { code: "AUDIT_VERSION_CONFLICT" },
  );
});

test("Inicio: consulta identidad y totales, evita recursos privados en otros roles, propaga fallos y conserva cero real", async () => {
  for (const role of ["ADMINISTRADOR", "DIGITADOR", "PUBLICO"] as const) {
    let reads = 0;
    const client = {
      users: {
        me: async () => ({ role }),
        list: async (query: object) => {
          assert.equal(role, "ADMINISTRADOR");
          assert.deepEqual(query, { pageSize: 1 });
          reads++;
          return { data: [{}], summary: { total: 155, active: 111 } };
        },
      },
      publications: {
        list: async (_filters: object, page: number, size: number) => {
          assert.equal(page, 1);
          assert.equal(size, 1);
          return { data: [], pagination: { total: 0 } };
        },
      },
    } as unknown as DataClient;
    const data = await loadDashboard(client);
    assert.equal(data.publications, 0);
    assert.equal(data.users?.total, role === "ADMINISTRADOR" ? 155 : undefined);
    assert.equal(reads, role === "ADMINISTRADOR" ? 1 : 0);
    const links = dashboardLinks(role).map((item) => item.id);
    assert.equal(links.includes("auditoria"), role === "ADMINISTRADOR");
    assert.equal(links.includes("gestion-publicaciones"), role !== "PUBLICO");
    assert.ok(links.includes("publicaciones"));
    client.publications.list = async () => {
      throw Error("Servicio caído");
    };
    await assert.rejects(loadDashboard(client), /Servicio caído/);
  }
});
