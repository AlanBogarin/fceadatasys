import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { DriveStorage } from "../../src/backups/drive.js";
import type { AppConfig } from "../../src/config.js";
import {
  startBackup,
  dumpEnvironment,
  type Command,
  backupSettings,
} from "../../src/backups/engine.js";

async function fixture(
  t: { after: (work: () => Promise<void>) => void },
  options: {
    cloudFails?: boolean;
    dumpFails?: boolean;
    auditFails?: string;
    checksumFails?: boolean;
    sizeFails?: boolean;
    folderFails?: boolean;
    loseLockAfterDump?: boolean;
    loseLockDuringUpload?: boolean;
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
    client = join(directory, "drive-client.json"),
    token = join(directory, "drive-token.json"),
    configFile = join(directory, "backup.env");
  await writeFile(
    client,
    JSON.stringify({
      installed: {
        client_id: "unit.apps.googleusercontent.com",
        client_secret: "private-client",
      },
    }),
  );
  await writeFile(
    token,
    JSON.stringify({
      client_id: "unit.apps.googleusercontent.com",
      refresh_token: "private-token",
    }),
  );
  await writeFile(
    configFile,
    `BACKUP_DATABASE_URL=postgresql://backup:private@localhost/test\nBACKUP_DIRECTORY="${local.replaceAll("\\", "/")}"\nDRIVE_CLIENT_FILE="${client.replaceAll("\\", "/")}"\nDRIVE_TOKEN_FILE="${token.replaceAll("\\", "/")}"\nDRIVE_FOLDER_ID=unit-folder\n`,
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
    return "";
  };
  const cloud: string[] = [];
  let uploadedName = "";
  const drive: DriveStorage = {
    generateId: async () => "unit-file",
    upload: async (_id, _path, name) => {
      cloud.push("upload");
      uploadedName = name;
      if (options.loseLockDuringUpload) held = false;
      if (options.cloudFails) throw Error("Drive unavailable");
    },
    metadata: async () => ({
      id: "unit-file",
      name: uploadedName,
      parents: [options.folderFails ? "other-folder" : "unit-folder"],
      size: String(options.sizeFails ? 0 : bytes.length),
      md5Checksum: options.checksumFails
        ? "wrong"
        : createHash("md5").update(bytes).digest("hex"),
    }),
    remove: async () => {
      cloud.push("delete");
    },
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
      drive,
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
  return {
    start,
    local,
    events,
    commands,
    cloud,
    configFile,
    jobs,
    released: () => released,
  };
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
for (const failure of [
  "cloudFails",
  "checksumFails",
  "sizeFails",
  "folderFails",
  "loseLockDuringUpload",
] as const)
  test(`fallo ${failure}: conserva copia local y muestra resultado parcial`, async (t) => {
    const f = await fixture(t, { [failure]: true });
    const { completion } = await f.start();
    const result = await completion;
    assert.equal(result.status, "PARCIAL");
    assert.ok(result.localSaved);
    assert.equal(result.cloudSaved, false);
    assert.equal((await readdir(f.local)).length, 1);
    assert.equal(f.released(), 1);
    assert.ok(f.cloud.includes("delete"));
  });
test("fallo pg_dump: elimina archivo parcial y no sube a Drive", async (t) => {
  const f = await fixture(t, { dumpFails: true });
  const { completion } = await f.start();
  const result = await completion;
  assert.equal(result.status, "FALLIDO");
  assert.deepEqual(await readdir(f.local), []);
  assert.ok(!f.cloud.includes("upload"));
});
test("pérdida de la conexión de exclusión: cancela antes de publicar o subir la copia", async (t) => {
  const f = await fixture(t, { loseLockAfterDump: true });
  const { completion } = await f.start();
  const result = await completion;
  assert.equal(result.status, "FALLIDO");
  assert.deepEqual(await readdir(f.local), []);
  assert.ok(!f.cloud.includes("upload"));
  assert.equal(f.released(), 1);
});
test("fallo auditoría inicial: cancela antes de pg_dump", async (t) => {
  const f = await fixture(t, { auditFails: "RESPALDO_INICIADO" });
  await assert.rejects(f.start(), { code: "AUDIT_UNAVAILABLE" });
  assert.deepEqual(f.commands, []);
  assert.equal(f.released(), 1);
});

test("fallo de auditoría de autorización: no sube a Drive y cancela la copia local", async (t) => {
  const f = await fixture(t, { auditFails: "RESPALDO_NUBE_AUTORIZADO" });
  const { completion } = await f.start();
  await assert.rejects(completion, { code: "AUDIT_UNAVAILABLE" });
  assert.deepEqual(f.cloud, []);
  assert.deepEqual(await readdir(f.local), []);
});

test("configuración resuelve rutas relativas y rechaza token ausente y carpeta inválida", async (t) => {
  const f = await fixture(t);
  const content = (await readFile(f.configFile, "utf8"))
    .replace(/^DRIVE_CLIENT_FILE=.*$/m, 'DRIVE_CLIENT_FILE="drive-client.json"')
    .replace(/^DRIVE_TOKEN_FILE=.*$/m, 'DRIVE_TOKEN_FILE="drive-token.json"');
  await writeFile(f.configFile, content);
  const settings = await backupSettings(f.configFile);
  assert.ok(settings.DRIVE_CLIENT_FILE.endsWith("drive-client.json"));
  await writeFile(
    f.configFile,
    content.replace(
      "DRIVE_FOLDER_ID=unit-folder",
      "DRIVE_FOLDER_ID=https://invalid",
    ),
  );
  await assert.rejects(backupSettings(f.configFile), {
    code: "BACKUP_NOT_CONFIGURED",
  });
  await writeFile(f.configFile, content);
  await rm(settings.DRIVE_TOKEN_FILE);
  await assert.rejects(backupSettings(f.configFile), {
    code: "BACKUP_NOT_CONFIGURED",
  });
  assert.ok(
    await backupSettings(f.configFile, { requireAuthorization: false }),
  );
});

test("un token nuevo no puede quedar en el cliente público a través de una unión de directorios", async (t) => {
  const f = await fixture(t);
  const link = join(dirname(f.configFile), "public-link");
  await symlink(
    resolve("../client/public"),
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  const content = (await readFile(f.configFile, "utf8")).replace(
    /^DRIVE_TOKEN_FILE=.*$/m,
    'DRIVE_TOKEN_FILE="public-link/new-token.json"',
  );
  await writeFile(f.configFile, content);
  await assert.rejects(
    backupSettings(f.configFile, { requireAuthorization: false }),
    { code: "BACKUP_NOT_CONFIGURED" },
  );
});
test("fallo auditoría final: cancela copias recién generadas y no anuncia éxito", async (t) => {
  const f = await fixture(t, { auditFails: "RESPALDO_FINALIZADO" });
  const { completion } = await f.start();
  await assert.rejects(completion, { code: "AUDIT_UNAVAILABLE" });
  assert.deepEqual(await readdir(f.local), []);
  assert.ok(f.cloud.includes("delete"));
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
