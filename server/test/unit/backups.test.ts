import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../../src/config.js";
import {
  startBackup,
  dumpEnvironment,
  type Command,
} from "../../src/backups/engine.js";

async function fixture(
  t: { after: (work: () => Promise<void>) => void },
  options: {
    cloudFails?: boolean;
    dumpFails?: boolean;
    auditFails?: string;
    checksumFails?: boolean;
    loseLockAfterDump?: boolean;
  } = {},
) {
  const parent = resolve(".tmp");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "backup-unit-"));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(parent + sep));
    await rm(directory, { recursive: true, force: true });
  });
  const local = join(directory, "copies"),
    rclone = join(directory, "rclone.conf"),
    configFile = join(directory, "backup.env");
  await writeFile(rclone, "[drive]\ntype = drive\n");
  await writeFile(
    configFile,
    `BACKUP_DATABASE_URL=postgresql://backup:private@localhost/test\nBACKUP_DIRECTORY="${local.replaceAll("\\", "/")}"\nRCLONE_CONFIG="${rclone.replaceAll("\\", "/")}"\nRCLONE_REMOTE=drive:copias\n`,
  );
  const jobs: any[] = [],
    events: any[] = [],
    commands: string[][] = [];
  let released = 0;
  let held = true;
  const db: any = {
    backupRun: {
      findMany: async () => [],
      create: async ({ data }: any) => {
        const job = { ...data };
        jobs.push(job);
        return job;
      },
      update: async ({ where, data }: any) => {
        Object.assign(
          jobs.find((job) => job.id === where.id),
          data,
        );
        return jobs.find((job) => job.id === where.id);
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        if (data.operation === options.auditFails)
          throw Error("Audit unavailable");
        events.push(data);
        return data;
      },
    },
  };
  db.$transaction = (work: any) => work(db);
  const bytes = Buffer.from("PGDMPtest archive");
  const command: Command = async (program, args) => {
    commands.push([program, ...args]);
    if (program === "pg_dump") {
      if (options.dumpFails) throw Error("dump");
      await writeFile(args[args.indexOf("--file") + 1], bytes);
      if (options.loseLockAfterDump) held = false;
    }
    if (program === "rclone" && args[0] === "copyto" && options.cloudFails)
      throw Error("Drive unavailable");
    if (program === "rclone" && args[0] === "lsjson")
      return JSON.stringify({
        Size: bytes.length,
        Hashes: {
          MD5: options.checksumFails
            ? "wrong"
            : createHash("md5").update(bytes).digest("hex"),
        },
      });
    return "";
  };
  const config = {
    databaseUrl: "postgresql://runtime@localhost/test",
    backups: { configFile },
  } as AppConfig;
  const request = {
    ip: "127.0.0.1",
    headers: { "user-agent": "scheduler test" },
  } as unknown as FastifyRequest;
  const start = () =>
    startBackup(db as PrismaClient, config, request, "PROGRAMADO", {
      command,
      acquireLock: async () =>
        Object.assign(
          async () => {
            released++;
          },
          {
            assertHeld: () => {
              if (!held) throw Error("Conexión perdida.");
            },
          },
        ),
    });
  return { start, local, events, commands, jobs, released: () => released };
}
test("copia completa verifica formato, índice y checksum remoto; audita antes de efectos y libera exclusión", async (t) => {
  const f = await fixture(t);
  const { completion } = await f.start();
  const result = await completion;
  assert.equal(result.status, "COMPLETO");
  assert.ok(result.localSaved && result.cloudSaved);
  assert.equal(
    (await readdir(f.local)).filter((name) => name.endsWith(".dump")).length,
    1,
  );
  assert.ok(
    f.commands.some((cmd) => cmd[0] === "pg_restore" && cmd[1] === "--list"),
  );
  assert.deepEqual(
    f.events.map((event) => event.operation),
    [
      "RESPALDO_INICIADO",
      "RESPALDO_LOCAL_AUTORIZADO",
      "RESPALDO_NUBE_AUTORIZADO",
      "RESPALDO_FINALIZADO",
    ],
  );
  assert.equal(f.released(), 1);
  assert.ok(!JSON.stringify(f.events).includes("private"));
});
for (const failure of ["cloudFails", "checksumFails"] as const)
  test(`fallo ${failure}: conserva copia local y muestra resultado parcial`, async (t) => {
    const f = await fixture(t, { [failure]: true });
    const { completion } = await f.start();
    const result = await completion;
    assert.equal(result.status, "PARCIAL");
    assert.ok(result.localSaved);
    assert.equal(result.cloudSaved, false);
    assert.equal((await readdir(f.local)).length, 1);
    assert.equal(f.released(), 1);
  });
test("fallo pg_dump: elimina archivo parcial y no sube a Drive", async (t) => {
  const f = await fixture(t, { dumpFails: true });
  const { completion } = await f.start();
  const result = await completion;
  assert.equal(result.status, "FALLIDO");
  assert.deepEqual(await readdir(f.local), []);
  assert.ok(!f.commands.some((cmd) => cmd[0] === "rclone"));
});
test("pérdida de la conexión de exclusión: cancela antes de publicar o subir la copia", async (t) => {
  const f = await fixture(t, { loseLockAfterDump: true });
  const { completion } = await f.start();
  const result = await completion;
  assert.equal(result.status, "FALLIDO");
  assert.deepEqual(await readdir(f.local), []);
  assert.ok(!f.commands.some((command) => command[0] === "rclone"));
  assert.equal(f.released(), 1);
});
test("fallo auditoría inicial: cancela antes de pg_dump", async (t) => {
  const f = await fixture(t, { auditFails: "RESPALDO_INICIADO" });
  await assert.rejects(f.start(), { code: "AUDIT_UNAVAILABLE" });
  assert.deepEqual(f.commands, []);
  assert.equal(f.released(), 1);
});
test("fallo auditoría final: cancela copias recién generadas y no anuncia éxito", async (t) => {
  const f = await fixture(t, { auditFails: "RESPALDO_FINALIZADO" });
  const { completion } = await f.start();
  await assert.rejects(completion, { code: "AUDIT_UNAVAILABLE" });
  assert.deepEqual(await readdir(f.local), []);
  assert.ok(f.commands.some((cmd) => cmd[1] === "deletefile"));
  assert.equal(f.released(), 1);
});
test("pg_dump recibe credenciales solo en entorno y conserva caracteres especiales de la conexión", () => {
  const env = dumpEnvironment(
    "postgresql://copias:p%40ss%3Aword@127.0.0.1:5434/fcea?sslmode=require",
  );
  assert.equal(env.PGPASSWORD, "p@ss:word");
  assert.equal(env.PGSSLMODE, "require");
  assert.equal(env.PGPORT, "5434");
});
