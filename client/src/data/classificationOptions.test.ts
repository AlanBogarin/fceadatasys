import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "./apiClient";
import { ApiSession } from "./apiSession";
import { HttpTransport } from "./http";
import { ClientProblem } from "./problems";
import {
  loadClassificationOptions,
  publicationClassificationFields,
} from "./classificationOptions";
import type { CatalogDto } from "./contracts";
import type { DataClient } from "./client";

const keys = [
  "carreras",
  "facultades",
  "filiales",
  "tipos",
  "niveles",
] as const;
const record: CatalogDto = {
  id: "catalog-id",
  name: "Clasificación",
  fields: {},
  active: true,
  createdAt: "2026-10-18T00:00:00Z",
  updatedAt: "2026-10-18T00:00:00Z",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type":
        status >= 400 ? "application/problem+json" : "application/json",
      ETag: '"opaque-catalog-version"',
    },
  });
const lock = async <T>(work: () => Promise<T>) => work();

test("API: los cinco catálogos administrativos usan sus rutas, versiones y confirmación compartidas", async () => {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const http = new HttpTransport(
    "http://api.test/api/v1",
    async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, init });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "GET" && !url.pathname.endsWith(`/${record.id}`)) {
        const total = url.searchParams.has("active") ? 4 : 12;
        return json({
          data: [record],
          pagination: { total, page: 2, pageSize: 1, totalPages: total },
        });
      }
      return json(record, init?.method === "POST" ? 201 : 200);
    },
  );
  http.setToken("test-token");
  const confirmations: boolean[] = [];
  const client = createApiClient(
    new ApiSession(http, lock),
    async (request) => {
      confirmations.push(request.password);
      return request.password ? "Confirmación123" : undefined;
    },
  );
  for (const key of keys) {
    const page = await client.catalogs.list(key, {
      search: "",
      page: 2,
      pageSize: 1,
    });
    assert.deepEqual(page.summary, { total: 12, active: 4 });
    const detail = await client.catalogs.get(key, record.id);
    assert.equal(detail.etag, '"opaque-catalog-version"');
    await client.catalogs.save(key, { name: record.name, fields: {} });
    await client.catalogs.save(
      key,
      { name: record.name, fields: {} },
      record.id,
      { ifMatch: detail.etag },
    );
    await client.catalogs.active(key, record.id, false, {
      ifMatch: detail.etag,
    });
    await client.catalogs.remove(key, record.id, { ifMatch: detail.etag });
    const writes = requests.filter(
      (item) =>
        item.url.pathname.startsWith(`/api/v1/catalogos/${key}`) &&
        item.init?.method !== "GET",
    );
    assert.deepEqual(
      writes.map((item) => item.init?.method),
      ["POST", "PATCH", "PATCH", "DELETE"],
    );
    for (const write of writes.slice(1)) {
      const headers = new Headers(write.init?.headers);
      assert.equal(headers.get("If-Match"), detail.etag);
      assert.equal(
        headers.get("X-Confirmation-Password"),
        Buffer.from("Confirmación123").toString("base64"),
      );
    }
  }
  assert.equal(
    requests.some((item) => item.url.searchParams.get("search") === ""),
    false,
  );
  assert.deepEqual(
    confirmations,
    keys.flatMap(() => [false, true, true, true]),
  );
});

test("Selectores: solo activos por página, referencia histórica conservada y total del servidor", async () => {
  const calls: { key: string; query: unknown; signal?: AbortSignal }[] = [];
  const signal = new AbortController().signal;
  const catalogs: Pick<DataClient["catalogs"], "list"> = {
    async list(key, query, passedSignal) {
      calls.push({ key, query, signal: passedSignal });
      return {
        data: [{ ...record, id: "active", name: "Opción activa" }],
        pagination: { page: 3, pageSize: 1, total: 7, totalPages: 7 },
        summary: { total: 10, active: 7 },
      };
    },
  };
  const selected = { id: "historical", name: "Referencia del DTO histórico" };
  const result = await loadClassificationOptions(
    catalogs,
    "filiales",
    { search: "filtro", page: 3, pageSize: 1 },
    selected,
    signal,
  );
  assert.deepEqual(calls, [
    {
      key: "filiales",
      query: { search: "filtro", page: 3, pageSize: 1, active: "true" },
      signal,
    },
  ]);
  assert.deepEqual(result.selected, selected);
  assert.deepEqual(result.options, [
    selected,
    { id: "active", name: "Opción activa" },
  ]);
  assert.equal(result.pagination.total, 7);
  assert.equal("fields" in result.options[1], false);
  assert.deepEqual(publicationClassificationFields, {
    carreras: "careerId",
    filiales: "branchId",
    tipos: "typeId",
    niveles: "levelId",
  });
  assert.equal("facultades" in publicationClassificationFields, false);
});

test("Selectores: una selección activa no se duplica y usa el nombre vigente", async () => {
  const catalogs = {
    async list() {
      return {
        data: [record],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        summary: { total: 1, active: 1 },
      };
    },
  };
  const result = await loadClassificationOptions(
    catalogs,
    "carreras",
    {},
    { id: record.id, name: "Nombre anterior" },
  );
  assert.deepEqual(result.options, [{ id: record.id, name: record.name }]);
  assert.deepEqual(result.selected, result.options[0]);
});

test("API: un catálogo o UUID inválido conserva Problem Details y nunca se convierte en vacío", async () => {
  const http = new HttpTransport("http://api.test/api/v1", async () =>
    json(
      {
        status: 400,
        code: "VALIDATION_ERROR",
        title: "Datos inválidos",
        detail: "Revisá el tipo o UUID del catálogo.",
        invalid_params: [{ name: "params.id", reason: "UUID inválido" }],
      },
      400,
    ),
  );
  http.setToken("test-token");
  const client = createApiClient(
    new ApiSession(http, lock),
    async () => undefined,
  );
  await assert.rejects(
    client.catalogs.get("filiales", "invalid-id"),
    (error) =>
      error instanceof ClientProblem &&
      error.fields["params.id"] === "UUID inválido",
  );
  await assert.rejects(
    client.catalogs.list("invalid" as never),
    (error) =>
      error instanceof ClientProblem && error.code === "VALIDATION_ERROR",
  );
  await assert.rejects(
    loadClassificationOptions(client.catalogs, "filiales"),
    (error) => error instanceof ClientProblem && error.status === 400,
  );
});
