import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, unlinkSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { readConfig, writeConfig, localPath, redact } from "./config.mjs";
import { run } from "./processes.mjs";
import { databaseClient } from "./database.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
test(
  "Arranque rechaza credenciales de propietario como runtime, incluso con --start-only",
  { skip: !process.env.DEPLOYMENT_PRODUCTION_TEST_CONFIG, timeout: 30000 },
  async (t) => {
    const config = readConfig(
      resolve(root, process.env.DEPLOYMENT_PRODUCTION_TEST_CONFIG),
    );
    assert.match(
      new URL(config.DATABASE_URL).pathname,
      /^\/fceadatasys_launch_delivery_[a-z0-9]+$/,
    );
    [config.DATABASE_URL, config.MIGRATION_DATABASE_URL] = [
      config.MIGRATION_DATABASE_URL,
      config.DATABASE_URL,
    ];
    const file = resolve(root, ".local/deploy/qa-rejected-runtime.env");
    writeConfig(file, config);
    t.after(() => unlinkSync(file));
    const child = spawn(
      process.execPath,
      [
        "scripts/run.mjs",
        "--profile",
        "production",
        "--config",
        file,
        "--start-only",
        "--non-interactive",
        "--skip-install",
      ],
      { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output += redact(chunk, config);
      });
    const [code] = await once(child, "exit");
    assert.equal(code, 1);
    assert.match(output, /Runtime con privilegios de propietario/);
  },
);
for (const [profile, variable] of [
  ["demo", "DEPLOYMENT_DEMO_CONFIG"],
  ["production", "DEPLOYMENT_PRODUCTION_TEST_CONFIG"],
]) {
  test(
    `Lanzador real ${profile}: arranque, cookies, API, archivos privados y cierre`,
    { skip: !process.env[variable], timeout: 180000 },
    async (t) => {
      const configFile = resolve(root, process.env[variable]),
        config = readConfig(configFile),
        url = new URL(config.PUBLIC_URL);
      assert.equal(config.PROFILE, profile);
      assert.equal(url.hostname, "127.0.0.1");
      if (profile === "production")
        assert.match(
          new URL(config.DATABASE_URL).pathname,
          /^\/fceadatasys_launch_delivery_[a-z0-9]+$/,
        );
      else assert.match(new URL(config.DATABASE_URL).pathname, /_demo$/);
      const child = spawn(
        process.execPath,
        [
          "scripts/run.mjs",
          "--profile",
          profile,
          "--config",
          configFile,
          "--start-only",
          "--non-interactive",
          "--skip-install",
        ],
        { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let output = "";
      const collect = (chunk) => {
        output = (output + redact(chunk, config)).slice(-10000);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      const exit = once(child, "exit");
      t.after(async () => {
        await run(
          process.execPath,
          ["scripts/run.mjs", "--profile", profile, "--stop"],
          { cwd: root, config, quiet: true },
        );
        await Promise.race([
          exit,
          delay(40000, undefined, { ref: false }).then(() => {
            if (child.exitCode === null) child.kill();
          }),
        ]);
        assert.equal(child.exitCode, 0, output);
      });
      const cookies = new Map();
      let token = "";
      const ca =
        url.protocol === "https:"
          ? readFileSync(localPath(root, config.TLS_CERT_FILE))
          : undefined;
      function request(path, method = "GET", body, extra = {}) {
        return new Promise((resolve, reject) => {
          const bytes =
            body === undefined ? undefined : Buffer.from(JSON.stringify(body));
          const headers = Object.fromEntries(
            Object.entries({
              origin: url.origin,
              ...(bytes
                ? {
                    "content-type": "application/json",
                    "content-length": bytes.length,
                  }
                : {}),
              ...(token ? { authorization: "Bearer " + token } : {}),
              cookie: [...cookies]
                .map(([key, value]) => key + "=" + value)
                .join("; "),
              ...extra,
            }).filter(([, value]) => value !== undefined),
          );
          const request = (url.protocol === "https:" ? https : http).request(
            new URL(path, url),
            { method, ca, timeout: 5000, headers },
            (response) => {
              for (const value of response.headers["set-cookie"] ?? []) {
                const [pair] = value.split(";"),
                  split = pair.indexOf("=");
                cookies.set(pair.slice(0, split), pair.slice(split + 1));
              }
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
          request.on("error", reject);
          request.on("timeout", () => request.destroy(Error("Timeout")));
          request.end(bytes);
        });
      }
      let running = false;
      for (let attempt = 0; attempt < 150; attempt++) {
        if (child.exitCode !== null) assert.fail(output);
        try {
          if ((await request("/")).status === 200) {
            running = true;
            break;
          }
        } catch {}
        await delay(250);
      }
      assert.ok(running, output);
      assert.match(
        (await request("/runtime-config.js")).body,
        new RegExp('"profile":"' + profile + '"'),
      );
      assert.equal((await request("/demo/investigacion-01.pdf")).status, 404);
      assert.equal((await request("/.env")).status, 404);
      const users =
        profile === "demo"
          ? [
              ["demo.admin", config.DEMO_ADMIN_PASSWORD, "ADMINISTRADOR"],
              ["demo.digitador", config.DEMO_DIGITADOR_PASSWORD, "DIGITADOR"],
              ["demo.publico", config.DEMO_PUBLICO_PASSWORD, "PUBLICO"],
            ]
          : [
              [
                "admin",
                process.env.DEPLOYMENT_TEST_ADMIN_PASSWORD,
                "ADMINISTRADOR",
              ],
            ];
      for (const [username, password, role] of users) {
        assert.ok(password, "Falta contraseña sintética para la prueba");
        cookies.clear();
        token = "";
        assert.equal(
          (await request("/api/v1/auth/browser", "POST", {})).status,
          204,
        );
        const login = await request(
          "/api/v1/auth/login",
          "POST",
          { username, password },
          { "x-forwarded-for": "198.51.100.99" },
        );
        assert.equal(login.status, 200, "Login de " + role);
        const data = JSON.parse(login.body);
        token = data.accessToken;
        assert.equal(data.user.role, role);
        const restored = await request(
          "/api/v1/auth/session",
          "GET",
          undefined,
          {
            origin: undefined,
            authorization: undefined,
            referer: url.origin + "/",
          },
        );
        assert.equal(
          restored.status,
          200,
          "Restauración por cookie con Referer solo de origen",
        );
        const cookie = login.headers["set-cookie"].join(";");
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /SameSite=Strict/i);
        if (profile === "production") assert.match(cookie, /; Secure/);
        const publications = await request("/api/v1/publicaciones?pageSize=1");
        assert.equal(publications.status, 200);
        const page = JSON.parse(publications.body);
        assert.equal(page.pagination.total, profile === "demo" ? 8 : 0);
        if (role === "PUBLICO")
          assert.equal(
            (
              await request(
                "/api/v1/publicaciones/" + page.data[0].id + "/adjunto",
              )
            ).status,
            403,
          );
        const me = await request("/api/v1/me");
        assert.equal(me.status, 200);
        if (profile === "production")
          assert.equal(JSON.parse(me.body).ci, "0000000");
        assert.equal(
          (await request("/api/v1/auth/logout", "POST", {})).status,
          204,
        );
      }
      const connection = databaseClient(root, config.DATABASE_URL);
      try {
        await connection.connect();
        const {
          rows: [row],
        } = await connection.query(
          "SELECT (SELECT count(*)::int FROM usuarios) AS users,(SELECT count(*)::int FROM adjuntos WHERE estado='CLEAN' AND analizado_en IS NOT NULL) AS clean,(SELECT count(*)::int FROM catalogos) AS catalogs",
        );
        assert.equal(row.users, profile === "demo" ? 3 : 1);
        assert.equal(row.clean, profile === "demo" ? 8 : 0);
        assert.equal(row.catalogs, profile === "demo" ? 36 : 0);
        const {
          rows: [spoofed],
        } = await connection.query(
          "SELECT count(*)::int AS total FROM auditoria WHERE ip='198.51.100.99'",
        );
        assert.equal(spoofed.total, 0);
      } finally {
        await connection.end();
      }
    },
  );
}
