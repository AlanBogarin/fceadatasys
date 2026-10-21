import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { defaults, localPath } from "./config.mjs";
import { databaseClient, ensureManagedPostgres } from "./database.mjs";
import { run, pgTool } from "./processes.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const controlQuery =
  "SELECT system_identifier::text AS system_identifier FROM pg_control_system()";

async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test(
  "Clúster demo real: rutas Unicode, identidad y cierre ante errores",
  { skip: !process.env.DEPLOYMENT_PG_BIN_DIRECTORY, timeout: 180000 },
  async (t) => {
    const parent = resolve(root, ".local/deploy/demo");
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(join(parent, "database-regression-"));
    const configs = [];
    async function config(name) {
      const value = defaults(root, "demo");
      const port = String(await unusedPort());
      for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
        const url = new URL(value[key]);
        url.port = port;
        value[key] = url.href;
      }
      value.PG_BIN_DIRECTORY = process.env.DEPLOYMENT_PG_BIN_DIRECTORY;
      value.PG_DATA_DIRECTORY = relative(
        root,
        join(folder, name, "postgres-data"),
      );
      configs.push(value);
      return value;
    }
    async function pgctl(value, action) {
      return run(
        pgTool(value, "pg_ctl"),
        [
          action,
          "-D",
          localPath(root, value.PG_DATA_DIRECTORY),
          ...(action === "stop" ? ["-m", "fast", "-w"] : []),
        ],
        { config: value, quiet: true, timeout: 30000 },
      );
    }
    async function connect(value) {
      const url = new URL(value.MIGRATION_DATABASE_URL);
      url.pathname = "/postgres";
      const client = databaseClient(root, url.href);
      client.on("error", () => {});
      try {
        await client.connect();
        return await client.query("SELECT 1 AS ready");
      } finally {
        await client.end();
      }
    }
    t.after(async () => {
      for (const value of configs) {
        let running = false;
        try {
          await pgctl(value, "status");
          running = true;
        } catch {
          /* A stopped or not yet created fixture needs no shutdown. */
        }
        if (running) await pgctl(value, "stop");
      }
      const target = resolve(folder);
      assert.ok(target.startsWith(parent + sep));
      assert.ok(target.split(sep).at(-1).startsWith("database-regression-"));
      rmSync(target, { recursive: true, force: true });
    });

    const first = await config("Equipo año 2026 con espacios");
    let stopFirst;
    await t.test(
      "Acepta su propio clúster en una ruta con ñ y espacios",
      async () => {
        stopFirst = await ensureManagedPostgres(root, first);
        assert.equal((await connect(first)).rows[0].ready, 1);
      },
    );

    const second = await config("Otro equipo");
    await t.test(
      "Rechaza otro clúster sin detener ninguno que ya estaba activo",
      async () => {
        await ensureManagedPostgres(root, second);
        await assert.rejects(
          ensureManagedPostgres(root, {
            ...first,
            MIGRATION_DATABASE_URL: second.MIGRATION_DATABASE_URL,
          }),
          /El puerto PostgreSQL no pertenece al clúster demo configurado/,
        );
        assert.equal((await connect(first)).rows[0].ready, 1);
        assert.equal((await connect(second)).rows[0].ready, 1);
      },
    );
    await stopFirst();

    const sample = databaseClient(root, first.MIGRATION_DATABASE_URL);
    const prototype = Object.getPrototypeOf(sample);
    const query = prototype.query;
    await sample.end();
    for (const backgroundEvent of [false, true]) {
      await t.test(
        backgroundEvent
          ? "Maneja el evento error del cliente y conserva su causa"
          : "Cierra la conexión antes de detener PostgreSQL tras un fallo",
        async (scenario) => {
          const failure = Object.assign(Error("Fallo de conexión simulado"), {
            code: "57P01",
          });
          scenario.mock.method(prototype, "query", function (text, ...args) {
            if (text === controlQuery) {
              if (!backgroundEvent) return Promise.reject(failure);
              this.emit("error", failure);
            }
            return query.call(this, text, ...args);
          });
          await assert.rejects(
            ensureManagedPostgres(root, first),
            (error) => error === failure,
          );
          await assert.rejects(pgctl(first, "status"));
          const log = readFileSync(
            join(
              localPath(root, first.PG_DATA_DIRECTORY),
              "..",
              "postgres.log",
            ),
            "utf8",
          );
          assert.doesNotMatch(
            log,
            /terminating connection due to administrator command/,
          );
        },
      );
    }
  },
);
