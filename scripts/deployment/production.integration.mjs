import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { resolve, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { defaults, readConfig, writeConfig } from "./config.mjs";
import {
  ensureManagedPostgres,
  databaseClient,
  prepareDatabase,
} from "./database.mjs";
import {
  maintenanceEnvironment,
  inspectDatabase,
} from "./production-database.mjs";
import { run, pgTool } from "./processes.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
test(
  "instalación real: fceadatasys, roles, conservación, recreación protegida, restauración y copias",
  { skip: !process.env.DEPLOYMENT_PG_BIN_DIRECTORY, timeout: 240000 },
  async (t) => {
    const parent = resolve(root, ".local/deploy/demo");
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(join(parent, "production-setup-test-"));
    const probe = net.createServer();
    await new Promise((done) => probe.listen(0, "127.0.0.1", done));
    const port = String(probe.address().port);
    await new Promise((done) => probe.close(done));
    assert.notEqual(port, "5432");
    const cluster = defaults(root, "demo");
    for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
      const url = new URL(cluster[key]);
      url.port = port;
      cluster[key] = url.href;
    }
    cluster.PG_BIN_DIRECTORY = process.env.DEPLOYMENT_PG_BIN_DIRECTORY;
    cluster.PG_DATA_DIRECTORY = relative(root, join(folder, "postgres-data"));
    const stop = await ensureManagedPostgres(root, cluster);
    let admin;
    t.after(async () => {
      await admin?.end();
      await stop();
      assert.ok(resolve(folder).startsWith(parent + sep));
      rmSync(folder, { recursive: true, force: true });
    });
    const config = {
      ...defaults(root, "production"),
      PG_BIN_DIRECTORY: cluster.PG_BIN_DIRECTORY,
      BACKUP_ENABLED: "false",
      PUBLIC_URL: "https://127.0.0.1:8449",
      WEB_HOST: "127.0.0.1",
      API_PORT: "3049",
      TLS_CERT_FILE: process.env.DEPLOYMENT_TEST_TLS_CERT_FILE || "",
      TLS_KEY_FILE: process.env.DEPLOYMENT_TEST_TLS_KEY_FILE || "",
      ATTACHMENT_DIRECTORY: join(folder, "attachments"),
      CLAMAV_COMMAND:
        process.env.CLAMAV_TEST_COMMAND ||
        "C:/Program Files/ClamAV/clamscan.exe",
      CLAMAV_DATABASE_DIR: resolve(root, "server/.local/clamav/database"),
      BOOTSTRAP_ADMIN_EMAIL: "install@example.invalid",
      BOOTSTRAP_ADMIN_PASSWORD: "Install2026!",
      INSTALL_BACKUP_DIRECTORY: join(folder, "snapshots"),
    };
    for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
      const url = new URL(config[key]);
      url.port = port;
      config[key] = url.href;
    }
    const adminUrl = new URL(cluster.MIGRATION_DATABASE_URL);
    adminUrl.pathname = "/postgres";
    config.PG_ADMIN_URL = adminUrl.href;
    const target = {
      runtime: new URL(config.DATABASE_URL),
      owner: new URL(config.MIGRATION_DATABASE_URL),
      databaseName: "fceadatasys",
    };
    assert.equal(target.runtime.pathname, "/fceadatasys");
    const execute = (
      command,
      args,
      env,
      label,
      cwd = resolve(root, "server"),
    ) =>
      run(command, args, {
        cwd,
        env,
        config: { ...cluster, ...config },
        label,
        quiet: false,
        timeout: 120000,
      });
    admin = databaseClient(root, adminUrl.href);
    await admin.connect();
    await t.test(
      "el lanzador completo prepara y retira credenciales administrativas",
      { skip: !config.TLS_CERT_FILE || !config.TLS_KEY_FILE },
      async () => {
        const file = join(folder, "production.env");
        writeConfig(file, config);
        await execute(
          process.execPath,
          [
            "scripts/run.mjs",
            "--profile",
            "production",
            "--config",
            file,
            "--setup-only",
            "--non-interactive",
            "--skip-install",
          ],
          {},
          "Preparación completa",
          root,
        );
        const saved = readConfig(file);
        assert.equal(saved.PG_ADMIN_URL, "");
        assert.equal(saved.BOOTSTRAP_ADMIN_PASSWORD, "");
        const owner = databaseClient(root, config.MIGRATION_DATABASE_URL);
        await owner.connect();
        try {
          assert.equal(
            (await owner.query("SELECT count(*)::int AS count FROM usuarios"))
              .rows[0].count,
            1,
          );
          assert.equal(
            (
              await owner.query(
                "SELECT count(*)::int AS count FROM public._prisma_migrations",
              )
            ).rows[0].count,
            9,
          );
        } finally {
          await owner.end();
        }
      },
    );
    const readerUrl = new URL(config.DATABASE_URL);
    readerUrl.username = "fcea_production_backup";
    readerUrl.password = randomBytes(24).toString("base64url");
    const options = {
      backup: { BACKUP_DATABASE_URL: readerUrl.href },
      log: () => {},
      journalDirectory: join(folder, "journal"),
    };
    await t.test(
      "provisiona roles limitados y un lector de copias sin escritura",
      async () => {
        await prepareDatabase(root, config, target, execute, options);
        const roles = (
          await admin.query(
            "SELECT rolname,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname IN ('fcea_production_owner','fcea_production_app','fcea_production_backup')",
          )
        ).rows;
        assert.equal(roles.length, 3);
        assert.ok(
          roles.every(
            (role) =>
              !role.rolsuper && !role.rolcreatedb && !role.rolcreaterole,
          ),
        );
        const owner = databaseClient(root, config.MIGRATION_DATABASE_URL);
        await owner.connect();
        try {
          await owner.query(
            "CREATE TABLE installation_probe(id integer PRIMARY KEY, value text)",
          );
          await owner.query(
            "INSERT INTO installation_probe VALUES(1,'datos a conservar')",
          );
        } finally {
          await owner.end();
        }
        const reader = databaseClient(root, readerUrl.href);
        await reader.connect();
        try {
          assert.equal(
            (
              await reader.query(
                "SELECT value FROM installation_probe WHERE id=1",
              )
            ).rows[0].value,
            "datos a conservar",
          );
          await assert.rejects(
            reader.query(
              "INSERT INTO installation_probe VALUES(2,'no permitido')",
            ),
          );
        } finally {
          await reader.end();
        }
      },
    );
    async function sentinel() {
      const owner = databaseClient(root, config.MIGRATION_DATABASE_URL);
      await owner.connect();
      try {
        return (
          await owner.query("SELECT value FROM installation_probe WHERE id=1")
        ).rows[0].value;
      } finally {
        await owner.end();
      }
    }
    await t.test(
      "sin interacción conserva el identificador de la base y sus datos",
      async () => {
        const before = await inspectDatabase(admin, "fceadatasys");
        await prepareDatabase(root, config, target, execute, options);
        assert.equal(
          (await inspectDatabase(admin, "fceadatasys")).id,
          before.id,
        );
        assert.equal(await sentinel(), "datos a conservar");
      },
    );
    await t.test(
      "credencial incorrecta se rechaza antes de ofrecer eliminación",
      async () => {
        const url = new URL(config.MIGRATION_DATABASE_URL);
        url.password = "incorrecta";
        let asked = false;
        await assert.rejects(
          prepareDatabase(
            root,
            { ...config, MIGRATION_DATABASE_URL: url.href },
            { ...target, owner: url },
            execute,
            {
              ...options,
              chooseExisting: async () => {
                asked = true;
                return "recreate";
              },
              confirmReset: async () => "ELIMINAR fceadatasys",
            },
          ),
          /Se conserva la base/,
        );
        assert.equal(asked, false);
        assert.equal(await sentinel(), "datos a conservar");
      },
    );
    await t.test(
      "copia fallida y confirmación incorrecta conservan la base",
      async () => {
        const decision = {
          ...options,
          chooseExisting: async () => "recreate",
          confirmReset: async () => "ELIMINAR fceadatasys",
        };
        await assert.rejects(
          prepareDatabase(
            root,
            config,
            target,
            async (command, args, ...rest) => {
              if (args.includes("--file")) throw Error("Copia no disponible");
              return execute(command, args, ...rest);
            },
            decision,
          ),
        );
        assert.equal(await sentinel(), "datos a conservar");
        await assert.rejects(
          prepareDatabase(root, config, target, execute, {
            ...decision,
            confirmReset: async () => "si",
          }),
          /Confirmación incorrecta/,
        );
        assert.equal(await sentinel(), "datos a conservar");
      },
    );
    await t.test("no fuerza desconexiones para recrear", async () => {
      const busy = databaseClient(root, config.MIGRATION_DATABASE_URL);
      await busy.connect();
      try {
        await assert.rejects(
          prepareDatabase(root, config, target, execute, {
            ...options,
            chooseExisting: async () => "recreate",
            confirmReset: async () => "ELIMINAR fceadatasys",
          }),
          /conexiones activas/,
        );
        assert.equal((await busy.query("SELECT 1 AS ok")).rows[0].ok, 1);
      } finally {
        await busy.end();
      }
    });
    let snapshot;
    await t.test(
      "la confirmación exacta recrea solo fceadatasys y preserva una copia",
      async () => {
        const before = await inspectDatabase(admin, "fceadatasys");
        await prepareDatabase(root, config, target, execute, {
          ...options,
          chooseExisting: async () => "recreate",
          confirmReset: async (info) => {
            snapshot = info.snapshot;
            return "ELIMINAR fceadatasys";
          },
        });
        assert.notEqual(
          (await inspectDatabase(admin, "fceadatasys")).id,
          before.id,
        );
        const owner = databaseClient(root, config.MIGRATION_DATABASE_URL);
        await owner.connect();
        try {
          assert.equal(
            (
              await owner.query(
                "SELECT to_regclass('installation_probe') AS probe",
              )
            ).rows[0].probe,
            null,
          );
        } finally {
          await owner.end();
        }
        assert.ok(
          snapshot &&
            readdirSync(config.INSTALL_BACKUP_DIRECTORY).some((file) =>
              snapshot.endsWith(file),
            ),
        );
      },
    );
    await t.test(
      "pg_restore recupera los datos previos en otra base aislada",
      async () => {
        const name = "fceadatasys_restore_" + randomBytes(4).toString("hex");
        await admin.query(
          `CREATE DATABASE "${name}" OWNER fcea_production_owner`,
        );
        await execute(
          pgTool(config, "pg_restore"),
          [
            "--exit-on-error",
            "--no-owner",
            "--no-acl",
            "--dbname",
            name,
            snapshot,
          ],
          maintenanceEnvironment(target.owner, name),
          "Restauración de copia previa",
        );
        const url = new URL(config.MIGRATION_DATABASE_URL);
        url.pathname = "/" + name;
        const restored = databaseClient(root, url.href);
        await restored.connect();
        try {
          assert.equal(
            (
              await restored.query(
                "SELECT value FROM installation_probe WHERE id=1",
              )
            ).rows[0].value,
            "datos a conservar",
          );
        } finally {
          await restored.end();
        }
      },
    );
  },
);
