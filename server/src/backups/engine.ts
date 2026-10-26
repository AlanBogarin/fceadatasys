import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, relative } from "node:path";
import { parseEnv } from "node:util";
import { Client } from "pg";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";
import { audit } from "../security/audit.js";
import { assertRequestPermission } from "../security/permissions.js";

const schema = z.object({
  BACKUP_DATABASE_URL: z.url().refine((value) => /^postgres(ql)?:/.test(value)),
  BACKUP_DIRECTORY: z.string().min(1),
  PG_DUMP_COMMAND: z.string().min(1).default("pg_dump"),
  PG_RESTORE_COMMAND: z.string().min(1).default("pg_restore"),
  RCLONE_COMMAND: z.string().min(1).default("rclone"),
  RCLONE_CONFIG: z.string().min(1),
  RCLONE_REMOTE: z.string().regex(/^[a-zA-Z0-9_-]+:[^\r\n]*$/),
  BACKUP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(7200000)
    .default(1800000),
});
export type BackupSettings = z.infer<typeof schema>;
export async function backupSettings(
  configFile: string,
): Promise<BackupSettings> {
  let settings: BackupSettings;
  try {
    settings = schema.parse(parseEnv(await readFile(configFile, "utf8")));
  } catch {
    throw new AppError(
      503,
      "BACKUP_NOT_CONFIGURED",
      "Configurá las copias locales y Google Drive en el servidor.",
    );
  }
  for (const key of ["BACKUP_DIRECTORY", "RCLONE_CONFIG"] as const) {
    if (!isAbsolute(settings[key]))
      settings[key] = resolve(dirname(configFile), settings[key]);
  }
  // Only a Google Drive remote is accepted. Tokens never leave this server.
  let remoteConfig: string;
  try {
    remoteConfig = await readFile(settings.RCLONE_CONFIG, "utf8");
  } catch {
    throw new AppError(
      503,
      "BACKUP_NOT_CONFIGURED",
      "No se pudo leer la configuración privada de Google Drive.",
    );
  }
  const name = settings.RCLONE_REMOTE.split(":")[0];
  const section = remoteConfig
    .split(/(?=^\[)/m)
    .find((part) => part.startsWith(`[${name}]`));
  if (!section || !/^type\s*=\s*drive\s*$/m.test(section))
    throw new AppError(
      503,
      "BACKUP_NOT_CONFIGURED",
      "El destino debe ser un remoto de Google Drive de rclone.",
    );
  return settings;
}
export type Command = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout: number,
) => Promise<string>;
export const execute: Command = (command, args, env, timeout) =>
  new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      if (output.length < 65536)
        output += chunk.toString().slice(0, 65536 - output.length);
    });
    const timer = setTimeout(() => child.kill(), timeout);
    child.on("error", () => {
      clearTimeout(timer);
      reject(Error("Herramienta de copias no disponible."));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveCommand(output);
      else reject(Error("Falló una herramienta de copias."));
    });
  });
export function dumpEnvironment(databaseUrl: string): NodeJS.ProcessEnv {
  const url = new URL(databaseUrl);
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (
      key.startsWith("PG") &&
      !["PGSSLROOTCERT", "PGSSLCERT", "PGSSLKEY", "PGSSLCRL"].includes(key)
    )
      delete env[key];
  return {
    ...env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") ?? "prefer",
    PGCONNECT_TIMEOUT: "15",
  };
}
type BackupLease = (() => Promise<void>) & { assertHeld?: () => void };
export async function acquireBackupLock(
  databaseUrl: string,
): Promise<BackupLease> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10000,
  });
  let lost = false;
  client.on("error", () => {
    lost = true;
  });
  client.on("end", () => {
    lost = true;
  });
  try {
    await client.connect();
    const result = await client.query(
      "SELECT pg_try_advisory_lock(741902) AS acquired",
    );
    if (!result.rows[0].acquired)
      throw new AppError(
        409,
        "BACKUP_BUSY",
        "Ya hay una copia de seguridad en curso.",
      );
    const release: BackupLease = async () => {
      await client.end();
    };
    release.assertHeld = () => {
      if (lost) throw Error("Se perdió la exclusión de copias.");
    };
    return release;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}
export interface BackupOptions {
  command?: Command;
  acquireLock?: typeof acquireBackupLock;
}
export async function startBackup(
  prisma: PrismaClient,
  config: AppConfig,
  request: FastifyRequest,
  source: "MANUAL" | "PROGRAMADO",
  options: BackupOptions = {},
) {
  if (!config.backups)
    throw new AppError(
      503,
      "BACKUP_NOT_CONFIGURED",
      "Las copias de seguridad no están configuradas.",
    );
  const settings = await backupSettings(config.backups.configFile);
  const target = new URL(config.databaseUrl),
    backup = new URL(settings.BACKUP_DATABASE_URL);
  if (
    target.hostname !== backup.hostname ||
    (target.port || "5432") !== (backup.port || "5432") ||
    target.pathname !== backup.pathname
  )
    throw new AppError(
      503,
      "BACKUP_NOT_CONFIGURED",
      "La conexión de copias debe apuntar a la misma base de datos del sistema.",
    );
  const release = await (options.acquireLock ?? acquireBackupLock)(
    config.databaseUrl,
  );
  const id = randomUUID();
  let job;
  try {
    job = await prisma.$transaction(async (tx) => {
      if (source === "MANUAL") {
        await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${request.auth!.userId}::uuid FOR UPDATE`;
        const actor = await tx.user.findUniqueOrThrow({
          where: { id: request.auth!.userId },
        });
        const session = await tx.session.findUniqueOrThrow({
          where: { id: request.auth!.sessionId },
        });
        const now = request.server.security.now();
        if (
          !actor.active ||
          session.revokedAt ||
          session.expiresAt <= now ||
          now.getTime() - session.lastActivityAt.getTime() >= 600000
        )
          throw new AppError(401, "UNAUTHENTICATED", "La sesión venció.");
        await assertRequestPermission(tx, request, actor);
      }
      // The database lock is released automatically if a worker dies.
      const interrupted = await tx.backupRun.findMany({
        where: { status: "EN_CURSO" },
      });
      for (const previous of interrupted) {
        await audit(tx, request, {
          operation: "RESPALDO_INTERRUMPIDO",
          resource: "respaldos",
          resourceId: previous.id,
          status: "FALLIDO",
          detail:
            "El proceso anterior terminó antes de confirmar el resultado; revisar archivos parciales.",
        });
        await tx.backupRun.update({
          where: { id: previous.id },
          data: {
            status: "FALLIDO",
            finishedAt: new Date(),
            detail: "Proceso interrumpido. Revisar el directorio de copias.",
          },
        });
      }
      const created = await tx.backupRun.create({
        data: { id, source, status: "EN_CURSO" },
      });
      await audit(tx, request, {
        operation: "RESPALDO_INICIADO",
        resource: "respaldos",
        resourceId: id,
        status: "EXITO",
        after: { source },
      });
      return created;
    });
  } catch (error) {
    await release();
    throw error;
  }
  const completion = performBackup(
    prisma,
    settings,
    request,
    id,
    async (...args) => {
      release.assertHeld?.();
      const output = await (options.command ?? execute)(...args);
      release.assertHeld?.();
      return output;
    },
  ).finally(release);
  return { job, completion };
}
async function fileHashes(path: string) {
  const md5 = createHash("md5"),
    sha256 = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    md5.update(chunk);
    sha256.update(chunk);
  }
  return { md5: md5.digest("hex"), sha256: sha256.digest("hex") };
}
async function performBackup(
  prisma: PrismaClient,
  settings: BackupSettings,
  request: FastifyRequest,
  id: string,
  command: Command,
) {
  const filename = `fceadatasys-${new Date().toISOString().replace(/[:.]/g, "-")}-${id}.dump`;
  const local = join(settings.BACKUP_DIRECTORY, filename),
    partial = local + ".partial";
  const remote = settings.RCLONE_REMOTE.replace(/\/$/, "") + "/" + filename;
  const rcloneArgs = [
    "--config",
    settings.RCLONE_CONFIG,
    "--retries",
    "3",
    "--low-level-retries",
    "3",
    "--stats",
    "0",
    "--contimeout",
    "30s",
    "--timeout",
    "2m",
  ];
  let localSaved = false,
    cloudSaved = false,
    detail = "",
    hashes: { md5: string; sha256: string } | undefined;
  try {
    await mkdir(settings.BACKUP_DIRECTORY, { recursive: true, mode: 0o700 });
    const actualDirectory = await realpath(settings.BACKUP_DIRECTORY);
    for (const candidate of [
      resolve(process.cwd(), "client"),
      resolve(process.cwd(), "../client"),
    ]) {
      const publicDirectory = await realpath(candidate).catch(() => candidate);
      const fromPublic = relative(publicDirectory, actualDirectory);
      if (
        !fromPublic ||
        (!fromPublic.startsWith("..") && !isAbsolute(fromPublic))
      )
        throw Error(
          "El directorio de copias debe estar fuera del cliente web.",
        );
    }
    const handle = await open(partial, "wx", 0o600);
    await handle.close();
    await command(
      settings.PG_DUMP_COMMAND,
      ["--format=custom", "--no-owner", "--no-acl", "--file", partial],
      dumpEnvironment(settings.BACKUP_DATABASE_URL),
      settings.BACKUP_TIMEOUT_MS,
    );
    const handleRead = await open(partial, "r");
    try {
      const header = Buffer.alloc(5);
      await handleRead.read(header, 0, 5, 0);
      if (header.toString() !== "PGDMP") throw Error("Formato inválido.");
    } finally {
      await handleRead.close();
    }
    await command(
      settings.PG_RESTORE_COMMAND,
      ["--list", partial],
      process.env,
      settings.BACKUP_TIMEOUT_MS,
    );
    hashes = await fileHashes(partial);
    await audit(prisma, request, {
      operation: "RESPALDO_LOCAL_AUTORIZADO",
      resource: "respaldos",
      resourceId: id,
      status: "EXITO",
      after: { filename, sha256: hashes.sha256 },
    });
    await rename(partial, local);
    localSaved = true;
    await chmod(local, 0o600);
    await audit(prisma, request, {
      operation: "RESPALDO_NUBE_AUTORIZADO",
      resource: "respaldos",
      resourceId: id,
      status: "EXITO",
      after: { filename },
    });
    await command(
      settings.RCLONE_COMMAND,
      ["copyto", local, remote, "--checksum", ...rcloneArgs],
      process.env,
      settings.BACKUP_TIMEOUT_MS,
    );
    const uploaded = JSON.parse(
      await command(
        settings.RCLONE_COMMAND,
        ["lsjson", remote, "--stat", "--hash", ...rcloneArgs],
        process.env,
        settings.BACKUP_TIMEOUT_MS,
      ),
    );
    if (
      uploaded.Size !== (await stat(local)).size ||
      uploaded.Hashes?.MD5?.toLowerCase() !== hashes.md5
    )
      throw Error("No se pudo verificar Google Drive.");
    cloudSaved = true;
  } catch (error) {
    detail = localSaved
      ? "La copia local está disponible. No se confirmó la copia en Google Drive; revisá la conexión y las credenciales y ejecutá una nueva copia."
      : "No se pudo crear o verificar la copia local. Revisá PostgreSQL, permisos, herramientas y espacio disponible.";
    if (error instanceof AppError && error.code === "AUDIT_UNAVAILABLE") {
      await rm(partial, { force: true }).catch(() => {});
      if (localSaved) await rm(local, { force: true }).catch(() => {});
      throw error;
    }
  } finally {
    await rm(partial, { force: true }).catch(() => {});
  }
  const status = cloudSaved ? "COMPLETO" : localSaved ? "PARCIAL" : "FALLIDO";
  try {
    return await prisma.$transaction(async (tx) => {
      await audit(tx, request, {
        operation: "RESPALDO_FINALIZADO",
        resource: "respaldos",
        resourceId: id,
        status: cloudSaved ? "EXITO" : "FALLIDO",
        detail: detail || "Copia local y en Google Drive verificadas.",
        after: {
          filename,
          localSaved,
          cloudSaved,
          ...(hashes ? { sha256: hashes.sha256 } : {}),
        },
      });
      return tx.backupRun.update({
        where: { id },
        data: {
          status,
          filename: localSaved ? filename : null,
          localSaved,
          cloudSaved,
          detail: detail || null,
          finishedAt: new Date(),
        },
      });
    });
  } catch (error) {
    // Cancel newly generated copies if the mandatory final audit cannot commit.
    if (cloudSaved)
      await command(
        settings.RCLONE_COMMAND,
        ["deletefile", remote, ...rcloneArgs],
        process.env,
        settings.BACKUP_TIMEOUT_MS,
      ).catch(() => {});
    if (localSaved) await rm(local, { force: true }).catch(() => {});
    throw error;
  }
}
