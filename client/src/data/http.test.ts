import test from "node:test";
import assert from "node:assert/strict";
import { HttpTransport, mutationHeaders, queryString } from "./http";
import { ApiSession } from "./apiSession";
import { createApiClient } from "./apiClient";
import { ClientProblem } from "./problems";
import type { SessionDto, UserDto } from "./contracts";

const user: UserDto = {
  id: "user",
  name: "Persona",
  ci: "1234567",
  email: "person@example.test",
  username: "person",
  role: "ADMINISTRADOR",
  active: true,
  createdAt: new Date().toISOString(),
};
const session: SessionDto = {
  user,
  session: {
    id: "session",
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    idleExpiresAt: new Date(Date.now() + 600000).toISOString(),
  },
  serverTime: new Date().toISOString(),
  accessToken: "memory-only",
  expiresIn: 900,
};
const json = (value: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type":
        status >= 400 ? "application/problem+json" : "application/json",
      ...headers,
    },
  });
const failure = (status: number, code: string) =>
  json(
    {
      status,
      code,
      title: "Rechazo",
      detail: code,
      invalid_params: [{ name: "body.email", reason: "Correo repetido" }],
      path: "/api/v1/me",
      timestamp: "2026-10-18T00:00:00Z",
    },
    status,
  );
const directLock = async <T>(work: () => Promise<T>) => work();

test("HTTP: credenciales, filtros vacíos, UTF-8, ETag opaco y Problem Details por campo", async () => {
  assert.equal(
    queryString({ search: "", active: false, page: 2, value: undefined }),
    "?active=false&page=2",
  );
  assert.equal(
    atob(
      mutationHeaders({ confirmationPassword: "señal123" })[
        "X-Confirmation-Password"
      ],
    ),
    String.fromCharCode(...new TextEncoder().encode("señal123")),
  );
  const http = new HttpTransport(
    "http://api.test/api/v1",
    async (url, init) => {
      assert.equal(url, "http://api.test/api/v1/me");
      assert.equal(init?.credentials, "include");
      assert.equal(init?.referrerPolicy, "strict-origin");
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer secret",
      );
      return failure(409, "DUPLICATE_USER");
    },
  );
  http.setToken("secret");
  await assert.rejects(
    http.get("/me"),
    (error) =>
      error instanceof ClientProblem &&
      error.fields["body.email"] === "Correo repetido" &&
      error.problem.path === "/api/v1/me" &&
      !!error.problem.timestamp,
  );
  const version = new HttpTransport("http://api.test", async () =>
    json(user, 200, { ETag: '"opaque-value"' }),
  );
  version.setToken("secret");
  assert.equal((await version.versioned("/user")).etag, '"opaque-value"');
});

test("HTTP: el transporte predeterminado conserva el receptor de fetch del navegador", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async function (this: unknown) {
    assert.equal(this, globalThis);
    return json(user);
  };
  try {
    const http = new HttpTransport("http://api.test");
    http.setToken("secret");
    assert.deepEqual(await http.get("/me"), user);
  } finally {
    globalThis.fetch = original;
  }
});

test("HTTP: una lectura no cruza el cierre o cambio de sesión durante la reautorización", async () => {
  let calls = 0;
  const http = new HttpTransport("http://api.test", async () => {
    calls++;
    return failure(401, "UNAUTHENTICATED");
  });
  http.setToken("old");
  http.recover = async () => {
    http.clear();
    http.setToken("another-account");
  };
  await assert.rejects(http.get("/me"), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("API: fallo de auditoría se propaga sin éxito, reintento ni invalidación local", async () => {
  let calls = 0;
  const http = new HttpTransport("http://api.test", async () => {
    calls++;
    return failure(503, "AUDIT_UNAVAILABLE");
  });
  http.setToken("secret");
  const runtime = new ApiSession(http, directLock);
  const client = createApiClient(runtime, async () => "secret");
  await assert.rejects(
    client.users.profile({
      name: user.name,
      email: user.email,
      username: user.username,
    }),
    (error) =>
      error instanceof ClientProblem && error.code === "AUDIT_UNAVAILABLE",
  );
  assert.equal(calls, 1);
  assert.equal(runtime.getSnapshot().revision, 0);
});

test("HTTP: reautoriza una lectura una vez; no repite escrituras ni fallos de red", async () => {
  let calls = 0,
    recoveries = 0,
    closures = 0;
  const http = new HttpTransport("http://api.test", async () => {
    calls++;
    return failure(401, "UNAUTHENTICATED");
  });
  http.setToken("secret");
  http.recover = async () => {
    recoveries++;
    http.setToken("renewed");
  };
  http.unauthorized = () => {
    closures++;
  };
  await assert.rejects(http.get("/me"));
  assert.deepEqual([calls, recoveries, closures], [2, 1, 1]);
  calls = recoveries = closures = 0;
  await assert.rejects(
    http.request("/me", { method: "PATCH", body: { name: "nuevo" } }),
  );
  assert.deepEqual([calls, recoveries, closures], [1, 0, 1]);
  let attempts = 0;
  const network = new HttpTransport("http://api.test", async () => {
    attempts++;
    throw new TypeError("network");
  });
  network.setToken("secret");
  await assert.rejects(
    network.request("/usuarios", { method: "POST", body: {} }),
    /no se reenvía/,
  );
  assert.equal(attempts, 1);
});

test("HTTP: CONFIRMATION_EXPIRED conserva sesión; invalidación descarta una respuesta vieja", async () => {
  const http = new HttpTransport("http://api.test", async () =>
    failure(401, "CONFIRMATION_EXPIRED"),
  );
  http.setToken("secret");
  let closed = false;
  http.unauthorized = () => {
    closed = true;
  };
  await assert.rejects(
    http.request("/me", { method: "PATCH" }),
    (error) =>
      error instanceof ClientProblem && error.code === "CONFIRMATION_EXPIRED",
  );
  assert.equal(closed, false);
  let finish!: (value: Response) => void;
  const delayed = new HttpTransport(
    "http://api.test",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  delayed.setToken("secret");
  const request = delayed.get("/me");
  delayed.clear();
  finish(json(user));
  await assert.rejects(request, { name: "AbortError" });
});

test("API: confirmación cancelada no escribe; PATCH conserva If-Match y no reintenta 412", async () => {
  const requests: { path: string; init?: RequestInit }[] = [];
  const http = new HttpTransport("http://api.test", async (path, init) => {
    requests.push({ path: String(path), init });
    return failure(412, "RESOURCE_VERSION_CONFLICT");
  });
  http.setToken("secret");
  const runtime = new ApiSession(http, directLock);
  const canceled = createApiClient(runtime, async () => {
    throw new DOMException("cancel", "AbortError");
  });
  await assert.rejects(
    canceled.users.profile({
      name: user.name,
      email: user.email,
      username: user.username,
    }),
    { name: "AbortError" },
  );
  await assert.rejects(canceled.users.create({ ...user }, "Password123"), {
    name: "AbortError",
  });
  assert.equal(requests.length, 0);
  const client = createApiClient(runtime, async () => "Conexión123");
  await assert.rejects(
    client.catalogs.active("autores", "a", false, { ifMatch: '"original"' }),
    (error) =>
      error instanceof ClientProblem &&
      error.code === "RESOURCE_VERSION_CONFLICT",
  );
  assert.equal(requests.length, 1);
  const headers = new Headers(requests[0].init?.headers);
  assert.equal(headers.get("If-Match"), '"original"');
  assert.equal(
    headers.get("X-Confirmation-Password"),
    Buffer.from("Conexión123").toString("base64"),
  );
  assert.equal(runtime.getSnapshot().revision, 0);
});

test("API: los indicadores usan totales globales y las consultas propagan AbortSignal", async () => {
  const urls: URL[] = [];
  const http = new HttpTransport("http://api.test", async (path, init) => {
    const url = new URL(String(path));
    urls.push(url);
    assert.ok(init?.signal);
    const total = url.searchParams.get("role")
      ? 3
      : url.searchParams.get("active")
        ? 12
        : 45;
    return json({
      data: [user],
      pagination: { page: 2, pageSize: 1, total, totalPages: total },
    });
  });
  http.setToken("secret");
  const client = createApiClient(
    new ApiSession(http, directLock),
    async () => undefined,
  );
  const page = await client.users.list(
    { search: "", role: "", page: 2, pageSize: 1 },
    new AbortController().signal,
  );
  assert.deepEqual(page.summary, { total: 45, active: 12, administrators: 3 });
  assert.equal(urls.length, 4);
  assert.equal(
    urls.some((url) => url.searchParams.has("search")),
    false,
  );
  assert.equal(client.demo, undefined);
  await client.audit.get("evento", new AbortController().signal);
  assert.equal(urls.at(-1)?.pathname, "/auditoria/evento");
});

test("Sesión API: compone token/identidad, actividad 204, recuperación y rotación sin ampliar plazos", async () => {
  let token = "initial";
  const bodies: { path: string; body: unknown; headers: Headers }[] = [];
  const http = new HttpTransport("http://api.test", async (path, init) => {
    const url = new URL(String(path)).pathname;
    bodies.push({
      path: url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: new Headers(init?.headers),
    });
    if (
      url === "/auth/browser" ||
      url === "/auth/activity" ||
      url === "/auth/logout" ||
      url === "/auth/reset-password"
    )
      return new Response(null, { status: 204 });
    if (url === "/auth/session")
      return json({ ...session, accessToken: token });
    if (url === "/auth/recover-password")
      return json({ message: "Respuesta genérica" });
    token = "rotated";
    return json({ accessToken: token, expiresIn: 900, user });
  });
  const runtime = new ApiSession(http, directLock);
  const client = createApiClient(runtime, async () => "secret");
  await client.auth.initializeBrowser();
  const restored = await runtime.restore();
  assert.equal(restored.accessToken, undefined);
  await client.auth.activity();
  const deadline = runtime.getSnapshot().session!.session.idleExpiresAt;
  await client.users.password("old12345", "new12345");
  assert.equal(runtime.getSnapshot().session!.session.idleExpiresAt, deadline);
  const password = bodies.find((item) => item.path === "/me/password")!;
  assert.deepEqual(password.body, {
    currentPassword: "old12345",
    newPassword: "new12345",
  });
  assert.equal(password.headers.has("If-Match"), false);
  assert.equal(password.headers.has("X-Confirmation-Password"), false);
  assert.deepEqual(await client.auth.requestRecovery("person@example.test"), {
    message: "Respuesta genérica",
  });
  await client.auth.logout();
  assert.equal(runtime.getSnapshot().session, null);
});

test("API: no duplica escrituras mientras una confirmación sigue pendiente", async () => {
  let confirmed!: (password: string) => void;
  let calls = 0;
  const http = new HttpTransport("http://api.test", async () => {
    calls++;
    return json(user);
  });
  http.setToken("secret");
  const client = createApiClient(
    new ApiSession(http, directLock),
    () =>
      new Promise((resolve) => {
        confirmed = resolve;
      }),
  );
  const first = client.users.profile({
    name: user.name,
    email: user.email,
    username: user.username,
  });
  await assert.rejects(
    client.users.profile({
      name: user.name,
      email: user.email,
      username: user.username,
    }),
    /otra operación pendiente/,
  );
  confirmed("secret");
  await first;
  assert.equal(calls, 1);
});
