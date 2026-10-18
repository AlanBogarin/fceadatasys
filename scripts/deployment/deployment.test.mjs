import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { once } from "node:events";
import {
  defaults,
  validateConfig,
  writeConfig,
  readConfig,
  apiEnvironment,
  redact,
  executionEnvironment,
} from "./config.mjs";
import { createGateway } from "./gateway.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
function workspace(t) {
  const parent = resolve(root, ".local");
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(join(parent, "deployment-test-"));
  t.after(() => {
    if (!folder.startsWith(parent + "\\") && !folder.startsWith(parent + "/"))
      throw Error("Ruta de prueba inválida");
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}
test("Configuración local conserva secretos, comillas y rutas sin interpolación de shell", (t) => {
  const folder = workspace(t),
    file = join(folder, "private.env");
  const input = {
    ...defaults(root, "demo"),
    SMTP_PASS: 'p$()!#"\\windows',
    CLAMAV_COMMAND: "C:\\Program Files\\ClamAV\\clamscan.exe",
  };
  writeConfig(file, input);
  assert.deepEqual(readConfig(file), input);
  assert.throws(() =>
    writeConfig(file, { ...input, SMTP_PASS: "first\nDATABASE_URL=changed" }),
  );
});
test("Perfiles separados: demo local, producción HTTPS, roles distintos y adjuntos privados", () => {
  const demo = defaults(root, "demo");
  assert.equal(
    validateConfig(root, demo, "demo").databaseName,
    "fceadatasys_demo",
  );
  for (const change of [
    { PROFILE: "mock" },
    { DATABASE_URL: demo.MIGRATION_DATABASE_URL },
    { PUBLIC_URL: "http://example.org/path" },
    {
      DATABASE_URL: demo.DATABASE_URL.replace(
        "127.0.0.1",
        "external.example.org",
      ),
    },
    { ATTACHMENT_DIRECTORY: "client/public/uploads" },
    { API_PORT: "8080" },
  ])
    assert.throws(() => validateConfig(root, { ...demo, ...change }, "demo"));
  const production = defaults(root, "production");
  assert.throws(
    () =>
      validateConfig(
        root,
        { ...production, PUBLIC_URL: "http://catalogo.example.org" },
        "production",
      ),
    /HTTPS/,
  );
  assert.throws(() =>
    validateConfig(
      root,
      { ...production, MANAGE_POSTGRES: "true" },
      "production",
    ),
  );
  assert.throws(() =>
    validateConfig(root, { ...demo, PROFILE: "production" }, "production"),
  );
});
test("La API solo recibe configuración de ejecución; URL pública no expone claves privadas", () => {
  const config = defaults(root, "demo"),
    environment = apiEnvironment(root, config);
  assert.equal(environment.HOST, "127.0.0.1");
  assert.equal(environment.TRUSTED_PROXIES, "127.0.0.1");
  assert.equal(environment.ALLOWED_ORIGINS, config.PUBLIC_URL);
  assert.equal(environment.MIGRATION_DATABASE_URL, undefined);
  assert.equal(environment.PG_ADMIN_URL, undefined);
  assert.equal(environment.SECURE_COOKIES, "false");
  const output = redact(
    [
      config.DATABASE_URL,
      decodeURIComponent(new URL(config.DATABASE_URL).password),
      config.JWT_SECRET,
    ].join(" "),
    config,
  );
  assert.doesNotMatch(output, new RegExp(config.JWT_SECRET));
  assert.equal(output, "[privado] [privado] [privado]");
});
test("Un entorno heredado de producción no contamina configuración, SMTP ni bootstrap de demo", () => {
  const inherited = {
    PATH: "tools",
    SMTP_HOST: "institution.example.org",
    SMTP_PASS: "external-secret",
    BOOTSTRAP_ADMIN_PASSWORD: "external-password",
    DATABASE_URL: "external-db",
    VITE_DATA_MODE: "mock",
    JWT_SECRET: "external-jwt",
    MIGRATION_DATABASE_URL: "owner-db",
    PG_ADMIN_URL: "admin-db",
  };
  const result = executionEnvironment(
    { DATABASE_URL: "demo-db", NODE_ENV: "development" },
    inherited,
  );
  assert.deepEqual(result, {
    PATH: "tools",
    DATABASE_URL: "demo-db",
    NODE_ENV: "development",
  });
  assert.equal(inherited.SMTP_PASS, "external-secret");
});
async function gateway(t) {
  const folder = workspace(t);
  mkdirSync(join(folder, "client/dist/assets"), { recursive: true });
  writeFileSync(
    join(folder, "client/dist/index.html"),
    "<html>Cliente API</html>",
  );
  writeFileSync(
    join(folder, "client/dist/assets/app.js"),
    'console.log("API");',
  );
  writeFileSync(join(folder, ".env"), "SENSITIVE_TEST_SECRET");
  const upstream = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      response.writeHead(201, {
        "content-type": "application/json",
        "set-cookie": ["refresh_token=opaque; HttpOnly; Path=/api/v1/auth"],
      });
      response.end(
        JSON.stringify({
          path: request.url,
          headers: request.headers,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const config = {
    ...defaults(folder, "demo"),
    PUBLIC_URL: "http://catalogo.example.test",
    API_PORT: String(upstream.address().port),
  };
  const web = createGateway(folder, config);
  web.listen(0, "127.0.0.1");
  await once(web, "listening");
  t.after(async () => {
    web.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => web.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
  });
  function request(path, options = {}) {
    return new Promise((resolve, reject) => {
      const connection = http.request(
        {
          hostname: "127.0.0.1",
          port: web.address().port,
          path,
          method: options.method || "GET",
          headers: { host: "catalogo.example.test", ...options.headers },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      connection.on("error", reject);
      connection.end(options.body);
    });
  }
  return { request, config, upstream };
}
test("Gateway entrega cliente/configuración pública y bloquea secretos, traversal y PDF estáticos", async (t) => {
  const { request, config } = await gateway(t);
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.body, /Cliente API/);
  const runtime = await request("/runtime-config.js");
  assert.equal(runtime.status, 200);
  assert.equal(runtime.headers["cache-control"], "no-store");
  assert.match(runtime.body, /catalogo.example.test\/api\/v1/);
  assert.match(runtime.body, /"profile":"demo"/);
  assert.equal(runtime.body.includes(config.JWT_SECRET), false);
  for (const path of [
    "/.env",
    "/%2e%2e/.env",
    "/demo/investigacion-01.pdf",
    "/server/.env",
    "/assets/missing.js",
    "/%ZZ",
  ]) {
    const result = await request(path);
    assert.ok([400, 404].includes(result.status), path);
    assert.doesNotMatch(result.body, /SENSITIVE_TEST_SECRET/);
  }
  assert.equal(
    (await request("/", { headers: { host: "attacker.example.org" } })).status,
    421,
  );
  const head = await request("/", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal((await request("/", { method: "POST" })).status, 405);
});
test("Gateway conserva cookies, query, multipart/bytes y sustituye encabezados de proxy falsificados", async (t) => {
  const { request } = await gateway(t);
  const result = await request("/api/v1/adjuntos?x=1", {
    method: "POST",
    body: "binary-like-body",
    headers: {
      "content-type": "multipart/form-data; boundary=test",
      cookie: "browser_token=opaque",
      authorization: "Bearer opaque",
      "x-forwarded-for": "forged",
      "x-forwarded-host": "attacker.example.org",
      "x-forwarded-proto": "https",
      forwarded: "for=forged",
    },
  });
  assert.equal(result.status, 201);
  assert.match(result.headers["set-cookie"][0], /HttpOnly/);
  const data = JSON.parse(result.body);
  assert.equal(data.path, "/api/v1/adjuntos?x=1");
  assert.equal(data.body, "binary-like-body");
  assert.equal(data.headers["x-forwarded-for"], "127.0.0.1");
  assert.equal(data.headers["x-forwarded-proto"], "http");
  assert.equal(data.headers["x-forwarded-host"], "catalogo.example.test");
  assert.equal(data.headers.forwarded, undefined);
  assert.equal(data.headers.cookie, "browser_token=opaque");
  assert.equal(data.headers.authorization, "Bearer opaque");
});
test("El paquete público y el punto de entrada ya no incluyen el despliegue simulado", () => {
  const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
  assert.doesNotMatch(app, /MockApp|mockClient/);
  const auth = readFileSync(join(root, "client/src/AuthPage.tsx"), "utf8");
  assert.doesNotMatch(
    auth,
    /DEMO_PASSWORD|client\.demo|recovery-demo|demo-accounts/,
  );
});
test("Gateway informa indisponibilidad de API con Problem Details y sin query sensible", async (t) => {
  const { request, upstream } = await gateway(t);
  await new Promise((resolve) => upstream.close(resolve));
  const response = await request("/api/v1/publicaciones?token=PRIVATE_QUERY");
  assert.equal(response.status, 502);
  assert.equal(response.headers["content-type"], "application/problem+json");
  const body = JSON.parse(response.body);
  assert.equal(body.code, "GATEWAY_ERROR");
  assert.equal(body.path, "/api/v1/publicaciones");
  assert.equal(body.status, 502);
  assert.ok(body.timestamp);
  assert.doesNotMatch(response.body, /PRIVATE_QUERY/);
});
