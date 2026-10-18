import test from "node:test";
import assert from "node:assert/strict";
import { HttpTransport, downloadFilename } from "./http";
import { ApiSession } from "./apiSession";
import { createApiClient } from "./apiClient";
import { ClientProblem } from "./problems";
import { canSelectAttachment } from "./apiPublications";
import { emptyBibliographicFilters } from "../bibliography";
import { emptyReportFilters } from "../publications";
import type { AttachmentDto } from "./contracts";

const json = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":
        status >= 400 ? "application/problem+json" : "application/json",
      ...headers,
    },
  });
const failure = (code: string, status = 503) =>
  json({ code, status, title: "Rechazo", detail: "No confirmado" }, status);
const binary = (
  mime = "application/pdf",
  filename = 'attachment; filename="reporte.pdf"',
) =>
  new Response(new Uint8Array([37, 80, 68, 70]), {
    headers: { "Content-Type": mime, "Content-Disposition": filename },
  });

test("Archivos HTTP: FormData con file, boundary de fetch, metadatos completados y confirmación antes del POST", async () => {
  const events: string[] = [];
  const http = new HttpTransport("http://api.test", async (url, init) => {
    events.push(`${init?.method} ${url}`);
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer memory",
    );
    if (init?.method === "POST") {
      assert.ok(init.body instanceof FormData);
      assert.deepEqual([...init.body.keys()], ["file"]);
      assert.equal((init.body.get("file") as File).name, "documento.pdf");
      assert.equal(new Headers(init.headers).has("Content-Type"), false);
      return json({ id: "upload" }, 201);
    }
    return json({
      id: "upload",
      name: "documento.pdf",
      createdAt: "2026-10-18T10:00:00Z",
      createdBy: { id: "actor", name: "Actor" },
      reservedPublicationId: null,
    });
  });
  http.setToken("memory");
  const runtime = new ApiSession(http);
  const client = createApiClient(runtime, async () => {
    events.push("confirm");
    return undefined;
  });
  const revision = runtime.getSnapshot().revision;
  const uploaded = await client.attachments.upload(
    new File(["%PDF"], "documento.pdf"),
  );
  assert.deepEqual(events, [
    "confirm",
    "POST http://api.test/adjuntos",
    "GET http://api.test/adjuntos/upload",
  ]);
  assert.equal(uploaded.status, "DISPONIBLE");
  assert.equal(uploaded.createdBy.name, "Actor");
  assert.ok(runtime.getSnapshot().revision > revision);
});

test("Archivos HTTP: cancelar no envía; POST incierto no se repite y detalle fallido informa carga confirmada", async () => {
  let calls = 0;
  const http = new HttpTransport("http://api.test", async (_url, init) => {
    calls++;
    return init?.method === "POST"
      ? json({ id: "persistido" }, 201)
      : failure("AUDIT_UNAVAILABLE");
  });
  http.setToken("memory");
  const runtime = new ApiSession(http);
  const cancelled = createApiClient(runtime, async () => {
    throw new DOMException("Cancelado", "AbortError");
  });
  await assert.rejects(
    cancelled.attachments.upload(new File(["data"], "data.pdf")),
    { name: "AbortError" },
  );
  assert.equal(calls, 0);
  const client = createApiClient(runtime, async () => undefined);
  await assert.rejects(
    client.attachments.upload(new File(["data"], "data.pdf")),
    /confirmó la carga persistido/,
  );
  assert.equal(calls, 2);
  const uncertain = new HttpTransport("http://api.test", async () => {
    calls++;
    throw new TypeError("offline");
  });
  uncertain.setToken("memory");
  await assert.rejects(
    uncertain.request("/adjuntos", { method: "POST", body: new FormData() }),
    /no se reenvía automáticamente/,
  );
  assert.equal(calls, 3);
});

test("Descargas HTTP: PDF/Excel/TXT, filename UTF-8, vacío y Problem Details sin bytes", async () => {
  let response = binary();
  const http = new HttpTransport("http://api.test", async () => response);
  http.setToken("memory");
  for (const mime of [
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ]) {
    response = binary(
      mime,
      "attachment; filename*=UTF-8''Investigaci%C3%B3n.pdf",
    );
    const result = await http.download("/exportar");
    assert.ok("bytes" in result);
    assert.equal(result.filename, "Investigación.pdf");
    assert.equal(result.mime, mime);
  }
  response = json({ data: [], total: 0 });
  assert.deepEqual(await http.download("/exportar"), { data: [], total: 0 });
  response = failure("AUDIT_UNAVAILABLE");
  await assert.rejects(
    http.download("/exportar"),
    (error) =>
      error instanceof ClientProblem && error.code === "AUDIT_UNAVAILABLE",
  );
  response = binary("text/html");
  await assert.rejects(
    http.download("/exportar"),
    /formato de descarga inesperado/,
  );
  assert.throws(
    () => downloadFilename('attachment; filename="../../unsafe.pdf"'),
    /no es válido/,
  );
  assert.throws(() => downloadFilename(null), /Content-Disposition/);
});

test("Descargas HTTP: respuesta tardía se descarta al cerrar sesión, incluso con bytes recibidos", async () => {
  let release!: () => void;
  const response = binary();
  const original = response.arrayBuffer.bind(response);
  response.arrayBuffer = async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return original();
  };
  const http = new HttpTransport("http://api.test", async () => response);
  http.setToken("memory");
  const pending = http.download("/exportar");
  await new Promise((resolve) => setImmediate(resolve));
  http.clear();
  release();
  await assert.rejects(pending, { name: "AbortError" });
});

test("Publicaciones/reportes HTTP: filtros paginados, ETag opaco, exportación completa y snapshot nullable", async () => {
  const urls: URL[] = [];
  const http = new HttpTransport("http://api.test", async (url, init) => {
    urls.push(new URL(String(url)));
    if (String(url).includes("exportar")) return binary();
    if (String(url).endsWith("/estado")) {
      assert.deepEqual(JSON.parse(String(init?.body)), { active: false });
      assert.equal(new Headers(init?.headers).get("If-Match"), '"opaque"');
      return json({ id: "publication" });
    }
    return json({
      data: [],
      pagination: { page: 2, pageSize: 1, total: 0, totalPages: 0 },
      report: { snapshot: null, exportable: false, maxRecords: 500 },
    });
  });
  http.setToken("memory");
  const client = createApiClient(new ApiSession(http), async () => "password");
  await client.publications.list(
    {
      ...emptyBibliographicFilters,
      search: "educación savings",
      from: "2026-10-01",
      to: "2026-10-18",
      authorId: "a",
      tutorId: "b",
    },
    2,
    1,
  );
  assert.equal(urls[0].searchParams.get("search"), "educación savings");
  assert.equal(urls[0].searchParams.get("authorId"), "a");
  assert.equal(urls[0].searchParams.has("careerId"), false);
  const report = await client.reports.list(
    { ...emptyReportFilters, publicationId: "publication" },
    2,
    1,
  );
  assert.equal(report.report.snapshot, null);
  await client.reports.export(
    { ...emptyReportFilters, publicationId: "publication" },
    "xlsx",
    "opaque-snapshot",
  );
  assert.equal(urls[2].searchParams.has("page"), false);
  assert.equal(urls[2].searchParams.has("pageSize"), false);
  assert.equal(urls[2].searchParams.get("snapshot"), "opaque-snapshot");
  assert.equal(urls[2].searchParams.get("publicationId"), "publication");
  await client.publications.inactivate("publication", { ifMatch: '"opaque"' });
  assert.equal(urls[3].pathname, "/publicaciones/publication/estado");
  await assert.rejects(
    client.attachments.download("file"),
    /requiere una publicación/,
  );
});

test("H3: RESERVADO con reserva null nunca se ofrece como disponible", () => {
  const file = {
    status: "RESERVADO",
    reservedPublicationId: null,
    publication: null,
  } as AttachmentDto;
  assert.equal(canSelectAttachment(file), false);
  assert.equal(canSelectAttachment(file, "original"), false);
  assert.equal(
    canSelectAttachment(
      { ...file, reservedPublicationId: "original" },
      "original",
    ),
    true,
  );
  assert.equal(
    canSelectAttachment({ ...file, reservedPublicationId: "original" }, "otra"),
    false,
  );
  assert.equal(canSelectAttachment({ ...file, status: "DISPONIBLE" }), true);
  assert.equal(
    canSelectAttachment(
      { ...file, status: "RECHAZADO", reservedPublicationId: "original" },
      "original",
    ),
    false,
  );
});
