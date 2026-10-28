import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { defaults, writeConfig } from "../deployment/config.mjs";
import {
  databaseClient,
  ensureManagedPostgres,
  prepareDatabase,
} from "../deployment/database.mjs";
import { pgTool, run } from "../deployment/processes.mjs";
import {
  activateRecovered,
  restoreDatabase,
  restoreEnvironment,
  sha256,
} from "./restore.mjs";

const repository = resolve(fileURLToPath(new URL("../../", import.meta.url)));
test(
  "restauración real aislada: integridad, rollback, auditoría, permisos y datos anteriores",
  { skip: !process.env.DEPLOYMENT_PG_BIN_DIRECTORY, timeout: 240000 },
  async (t) => {
    const parent = resolve(repository, ".local/deploy/demo");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(parent, "restore-integration-"));
    // Reuse installed dependencies/migrations; all database files and locks belong to this fixture.
    await symlink(
      resolve(repository, "server"),
      join(root, "server"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const probe = net.createServer();
    await new Promise((done) => probe.listen(0, "127.0.0.1", done));
    const port = String(probe.address().port);
    await new Promise((done) => probe.close(done));
    const config = defaults(root, "demo");
    config.PG_BIN_DIRECTORY = process.env.DEPLOYMENT_PG_BIN_DIRECTORY;
    config.BACKUP_ENABLED = "false";
    config.ATTACHMENT_DIRECTORY = ".local/attachments";
    const name = "fceadatasys_restore_demo_test";
    for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
      const url = new URL(config[key]);
      url.port = port;
      url.pathname = "/" + name;
      config[key] = url.href;
    }
    let stop = async () => {};
    const execute = (program, args, env, label) =>
      run(program, args, {
        cwd: join(repository, "server"),
        env,
        label,
        config,
        quiet: true,
        timeout: 120000,
      });
    async function query(url, sql, params) {
      const client = databaseClient(root, url);
      client.on("error", () => {});
      try {
        await client.connect();
        return await client.query(sql, params);
      } finally {
        await client.end();
      }
    }
    const dbUrl = (database, user = config.MIGRATION_DATABASE_URL) => {
      const url = new URL(user);
      url.pathname = "/" + database;
      return url.href;
    };
    t.after(async () => {
      await stop();
      await unlink(join(root, "server"));
      assert.ok(resolve(root).startsWith(parent + sep));
      assert.ok(root.split(sep).at(-1).startsWith("restore-integration-"));
      await rm(root, { recursive: true, force: true });
    });
    stop = await ensureManagedPostgres(root, config);
    // Exercise restoration as a restricted migration owner, with a separate cluster administrator.
    config.PG_ADMIN_URL = dbUrl("postgres");
    const owner = new URL(config.MIGRATION_DATABASE_URL);
    owner.username = "restore_owner";
    owner.password = randomUUID();
    config.MIGRATION_DATABASE_URL = owner.href;
    config.MANAGE_POSTGRES = "false";
    await prepareDatabase(
      root,
      config,
      {
        databaseName: name,
        owner: new URL(config.MIGRATION_DATABASE_URL),
        runtime: new URL(config.DATABASE_URL),
      },
      execute,
    );
    const adminId = randomUUID(),
      sessionId = randomUUID();
    await query(
      config.MIGRATION_DATABASE_URL,
      `INSERT INTO usuarios (id,nombre,ci,correo,correo_clave,usuario,usuario_clave,rol,contrasena_hash,actualizado_en) VALUES ($1,'Administrador de prueba','1234567','restore@example.invalid','restore@example.invalid','restore','restore','ADMINISTRADOR','fixture-hash',CURRENT_TIMESTAMP)`,
      [adminId],
    );
    await query(
      config.MIGRATION_DATABASE_URL,
      "INSERT INTO sesiones (id,usuario_id,ultima_actividad_en,vence_en) VALUES ($1,$2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+interval '1 hour')",
      [sessionId, adminId],
    );
    const attachment = randomUUID() + ".pdf",
      bytes = Buffer.from("%PDF-1.4\nRestore fixture\n%%EOF");
    await mkdir(resolve(root, config.ATTACHMENT_DIRECTORY), {
      recursive: true,
    });
    const attachmentPath = resolve(
      root,
      config.ATTACHMENT_DIRECTORY,
      attachment,
    );
    await writeFile(attachmentPath, bytes);
    await query(
      config.MIGRATION_DATABASE_URL,
      "INSERT INTO adjuntos (id,nombre,tamano,mime,sha256,almacenamiento_clave,estado,contenido_verificado,analizado_en,creado_por_id) VALUES ($1,'test.pdf',$2,'application/pdf',$3,$4,'CLEAN',true,CURRENT_TIMESTAMP,$5)",
      [
        randomUUID(),
        bytes.length,
        await sha256(attachmentPath),
        attachment,
        adminId,
      ],
    );
    await query(
      config.PG_ADMIN_URL,
      "CREATE ROLE restore_reader LOGIN PASSWORD 'fixture-reader' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION",
    );
    const readerUrl = new URL(config.DATABASE_URL);
    readerUrl.username = "restore_reader";
    readerUrl.password = "fixture-reader";
    writeConfig(resolve(root, config.BACKUP_CONFIG_FILE), {
      BACKUP_DATABASE_URL: readerUrl.href,
      BACKUP_DIRECTORY: ".",
    });
    const file = join(root, "verified.dump");
    await execute(
      pgTool(config, "pg_dump"),
      ["--format=custom", "--no-owner", "--no-acl", "--file", file],
      restoreEnvironment(config.MIGRATION_DATABASE_URL),
      "Copia para ensayo",
    );
    const hash = await sha256(file);
    await query(
      config.MIGRATION_DATABASE_URL,
      `INSERT INTO auditoria (id,operacion,recurso,ip,user_agent,estado,valores_nuevos) VALUES ($1,'RESPALDO_FINALIZADO','respaldos','127.0.0.1','fixture','EXITO',$2::jsonb)`,
      [
        randomUUID(),
        JSON.stringify({
          filename: "verified.dump",
          sha256: hash,
          localSaved: true,
        }),
      ],
    );
    await query(
      config.MIGRATION_DATABASE_URL,
      "UPDATE usuarios SET nombre='Cambio posterior' WHERE id=$1",
      [adminId],
    );
    const messages = [],
      options = {
        file,
        execute,
        log: (message) => messages.push(message),
        confirm: async () => `RESTAURAR ${name}`,
      };

    await t.test(
      "rechaza conexiones activas sin forzarlas a terminar",
      async () => {
        const active = databaseClient(root, config.DATABASE_URL);
        await active.connect();
        try {
          await assert.rejects(
            restoreDatabase(root, config, {
              ...options,
              confirm: async () => assert.fail("Conexión activa"),
            }),
            /conexiones activas/,
          );
          assert.equal((await active.query("SELECT 1 AS ok")).rows[0].ok, 1);
        } finally {
          await active.end();
        }
      },
    );

    await t.test(
      "rechaza hash modificado y no solicita activación",
      async () => {
        await assert.rejects(
          restoreDatabase(root, config, {
            ...options,
            expectedSha256: "0".repeat(64),
            confirm: async () => assert.fail("hash inválido"),
          }),
          /no coincide/,
        );
      },
    );
    await t.test(
      "cancelación conserva datos y no crea una base de recuperación",
      async () => {
        await assert.rejects(
          restoreDatabase(root, config, {
            ...options,
            confirm: async () => "",
          }),
          /cancelada/,
        );
        assert.equal(
          (
            await query(
              config.DATABASE_URL,
              "SELECT nombre FROM usuarios WHERE id=$1",
              [adminId],
            )
          ).rows[0].nombre,
          "Cambio posterior",
        );
      },
    );
    await t.test("falla pg_restore sin sustituir la base", async () => {
      await assert.rejects(
        restoreDatabase(root, config, {
          ...options,
          execute: async (program, args, ...rest) => {
            if (args.includes("--single-transaction"))
              throw Error("restore simulado");
            return execute(program, args, ...rest);
          },
        }),
        /restore simulado/,
      );
      assert.equal(
        (
          await query(
            config.DATABASE_URL,
            "SELECT nombre FROM usuarios WHERE id=$1",
            [adminId],
          )
        ).rows[0].nombre,
        "Cambio posterior",
      );
    });
    await t.test(
      "si falla la auditoría inicial no ejecuta la restauración",
      async () => {
        await query(
          config.MIGRATION_DATABASE_URL,
          `CREATE FUNCTION reject_restore_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operacion='RESTAURACION_INICIADA' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_restore_audit BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION reject_restore_audit()`,
        );
        const commands = [];
        try {
          await assert.rejects(
            restoreDatabase(root, config, {
              ...options,
              execute: async (program, args, ...rest) => {
                commands.push(args);
                return execute(program, args, ...rest);
              },
            }),
            /audit unavailable/,
          );
          assert.ok(
            !commands.some((args) => args.includes("--single-transaction")),
          );
        } finally {
          await query(
            config.MIGRATION_DATABASE_URL,
            "DROP TRIGGER reject_restore_audit ON auditoria; DROP FUNCTION reject_restore_audit()",
          );
        }
      },
    );
    await t.test(
      "si falla la auditoría de validación no activa la base recuperada",
      async () => {
        await assert.rejects(
          restoreDatabase(root, config, {
            ...options,
            execute: async (program, args, ...rest) => {
              const output = await execute(program, args, ...rest);
              if (args.includes("--set=ON_ERROR_STOP=1")) {
                await query(
                  dbUrl(rest[0].PGDATABASE),
                  `CREATE FUNCTION reject_restore_validation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operacion='RESTAURACION_VALIDADA' THEN RAISE EXCEPTION 'validation audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_restore_validation BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION reject_restore_validation()`,
                );
              }
              return output;
            },
          }),
          /validation audit unavailable/,
        );
        assert.equal(
          (
            await query(
              config.DATABASE_URL,
              "SELECT nombre FROM usuarios WHERE id=$1",
              [adminId],
            )
          ).rows[0].nombre,
          "Cambio posterior",
        );
      },
    );
    await t.test(
      "falta un PDF: no activa una recuperación incompleta",
      async () => {
        await unlink(attachmentPath);
        await assert.rejects(
          restoreDatabase(root, config, options),
          /Faltan adjuntos/,
        );
        await writeFile(attachmentPath, bytes);
        assert.equal(
          (
            await query(
              config.DATABASE_URL,
              "SELECT nombre FROM usuarios WHERE id=$1",
              [adminId],
            )
          ).rows[0].nombre,
          "Cambio posterior",
        );
      },
    );
    await t.test(
      "fallo real del segundo renombrado revierte también el primero",
      async () => {
        const admin = databaseClient(root, config.PG_ADMIN_URL);
        await admin.connect();
        try {
          const before = (
            await admin.query(
              "SELECT oid::text AS id FROM pg_database WHERE datname=$1",
              [name],
            )
          ).rows[0];
          await assert.rejects(
            activateRecovered(admin, {
              database: name,
              staging: name,
              previous: "transaction_rollback_probe",
              databaseId: before.id,
              stagingId: before.id,
            }),
          );
          assert.equal(
            (
              await admin.query(
                "SELECT oid::text AS id FROM pg_database WHERE datname=$1",
                [name],
              )
            ).rows[0].id,
            before.id,
          );
        } finally {
          await admin.end();
        }
      },
    );
    await t.test(
      "recupera, conserva la base anterior, invalida sesiones y verifica runtime/lector",
      async () => {
        const result = await restoreDatabase(root, config, options);
        assert.equal(
          (
            await query(
              config.DATABASE_URL,
              "SELECT nombre FROM usuarios WHERE id=$1",
              [adminId],
            )
          ).rows[0].nombre,
          "Administrador de prueba",
        );
        assert.ok(
          (
            await query(
              config.DATABASE_URL,
              "SELECT revocado_en FROM sesiones WHERE id=$1",
              [sessionId],
            )
          ).rows[0].revocado_en,
        );
        assert.equal(
          (
            await query(
              config.DATABASE_URL,
              "SELECT count(*)::int AS n FROM auditoria WHERE operacion='RESTAURACION_VALIDADA'",
            )
          ).rows[0].n,
          1,
        );
        assert.ok(
          (
            await query(
              readerUrl.href,
              "SELECT count(*)::int AS n FROM auditoria",
            )
          ).rows[0].n >= 1,
        );
        await assert.rejects(
          query(config.DATABASE_URL, "DELETE FROM auditoria"),
        );
        const previous = (
          await query(
            dbUrl("postgres"),
            "SELECT datallowconn FROM pg_database WHERE datname=$1",
            [result.previous],
          )
        ).rows[0];
        assert.equal(previous.datallowconn, false);
        await query(
          dbUrl("postgres"),
          `ALTER DATABASE "${result.previous}" ALLOW_CONNECTIONS true`,
        );
        assert.equal(
          (
            await query(
              dbUrl(result.previous),
              "SELECT nombre FROM usuarios WHERE id=$1",
              [adminId],
            )
          ).rows[0].nombre,
          "Cambio posterior",
        );
        assert.ok(
          (
            await query(
              dbUrl(result.previous),
              "SELECT count(*)::int AS n FROM auditoria WHERE operacion='RESTAURACION_INICIADA'",
            )
          ).rows[0].n >= 1,
        );
        const events = await readFile(
          join(result.journalDirectory, "events.jsonl"),
          "utf8",
        );
        assert.match(events, /RESTAURACION_FINALIZADA/);
        assert.ok(
          !events.includes(new URL(config.MIGRATION_DATABASE_URL).password),
        );
        assert.ok(
          messages.some((message) => message.includes("Base restaurada")),
        );
      },
    );
  },
);
