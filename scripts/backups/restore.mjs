import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { userInfo } from "node:os";
import {
  assertPrivateLocation,
  localPath,
  readConfig,
  validateConfig,
} from "../deployment/config.mjs";
import {
  databaseClient,
  ensureManagedPostgres,
  verifyRuntime,
} from "../deployment/database.mjs";
import { inspectDatabase } from "../deployment/production-database.mjs";
import { pgTool, run } from "../deployment/processes.mjs";

const identifier = (name) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name))
    throw Error("Nombre PostgreSQL inválido.");
  return `"${name}"`;
};
const withDatabase = (value, name) => {
  const url = new URL(value);
  url.pathname = "/" + name;
  return url.href;
};
export function restoreEnvironment(value) {
  const url = new URL(value);
  // Discard inherited libpq service/database/role options, including PGSERVICE.
  const cleared = Object.fromEntries(
    Object.keys(process.env)
      .filter(
        (key) =>
          key.startsWith("PG") &&
          !["PGSSLROOTCERT", "PGSSLCERT", "PGSSLKEY", "PGSSLCRL"].includes(key),
      )
      .map((key) => [key, undefined]),
  );
  return {
    ...cleared,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get("sslmode") || "prefer",
    PGCONNECT_TIMEOUT: "15",
  };
}
export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function localCopies(root, config) {
  const file = localPath(
    root,
    config.BACKUP_CONFIG_FILE || `.local/backups/${config.PROFILE}.env`,
  );
  let backup;
  try {
    backup = readConfig(file);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (!backup.BACKUP_DIRECTORY) return [];
  const directory = resolve(dirname(file), backup.BACKUP_DIRECTORY);
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".dump"))
        .map(async (entry) => {
          const path = join(directory, entry.name),
            info = await stat(path);
          return {
            path,
            name: entry.name,
            size: info.size,
            modified: info.mtime,
          };
        }),
    )
  ).sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
}

/** Uses the launcher's own lock: the web cannot start during the final database switch. */
export async function claimRestoreSlot(root, profile) {
  const directory = resolve(root, `.local/deploy/${profile}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "run.lock");
  try {
    const previous = JSON.parse(await readFile(path, "utf8"));
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0)
      throw Error("Bloqueo de ejecución inválido; revisar run.lock.");
    let live = true;
    try {
      process.kill(previous.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") live = false;
      else throw error;
    }
    if (live)
      throw Error(
        `Detené el sistema con npm run stop:${profile} y esperá su cierre antes de restaurar.`,
      );
    await unlink(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const handle = await open(path, "wx", 0o600);
  await handle.writeFile(
    JSON.stringify({ pid: process.pid, profile, operation: "restore" }),
  );
  await handle.close();
  return async () => unlink(path);
}

async function connected(root, url, work) {
  const client = databaseClient(root, url);
  let lost;
  client.on("error", (error) => {
    lost = error;
  });
  try {
    await client.connect();
    const result = await work(client);
    if (lost) throw lost;
    return result;
  } finally {
    await client.end();
  }
}
async function record(client, operation, status, data) {
  await client.query(
    `INSERT INTO public.auditoria (id,operacion,recurso,recurso_id,ip,user_agent,estado,detalle,valores_nuevos)
     VALUES ($1,$2,'restauraciones',$3,'127.0.0.1','fceadatasys-restore',$4,$5,$6::jsonb)`,
    [
      randomUUID(),
      operation,
      data.id,
      status,
      `Mantenimiento local por ${userInfo().username}.`,
      JSON.stringify(data),
    ],
  );
}
export async function validateRecovered(root, config, url) {
  return connected(root, url, async (client) => {
    const directory = resolve(root, "server/prisma/migrations");
    const migrations = (await readdir(directory, { withFileTypes: true }))
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .sort();
    const { rows } = await client.query(
      "SELECT migration_name,checksum FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
    );
    if (
      JSON.stringify(rows.map((row) => row.migration_name)) !==
      JSON.stringify(migrations)
    )
      throw Error(
        "La copia corresponde a otra versión del sistema; usá la versión que creó el respaldo.",
      );
    for (const row of rows) {
      if (
        (await sha256(join(directory, row.migration_name, "migration.sql"))) !==
        row.checksum
      )
        throw Error(
          "La copia tiene migraciones incompatibles con esta versión del sistema.",
        );
    }
    const policy = (
      await client.query(
        "SELECT politica FROM public.permisos_sistema WHERE id=1",
      )
    ).rows[0]?.politica;
    const admins = (
      await client.query(
        "SELECT id FROM public.usuarios WHERE rol='ADMINISTRADOR' AND activo",
      )
    ).rows;
    if (
      !admins.some(
        ({ id }) =>
          policy?.users?.[id]?.["permissions.manage"] ??
          policy?.roles?.ADMINISTRADOR?.includes("permissions.manage"),
      )
    )
      throw Error(
        "La copia no conserva un Administrador activo con permissions.manage.",
      );
    const files = (
      await client.query(
        "SELECT almacenamiento_clave,sha256 FROM public.adjuntos WHERE estado='CLEAN'",
      )
    ).rows;
    if (files.length) {
      try {
        const base = await realpath(
          localPath(root, config.ATTACHMENT_DIRECTORY),
        );
        for (const file of files) {
          const path = await realpath(resolve(base, file.almacenamiento_clave));
          const fromBase = relative(base, path);
          if (
            !fromBase ||
            fromBase.startsWith("..") ||
            isAbsolute(fromBase) ||
            (await sha256(path)) !== file.sha256
          )
            throw Error("Adjunto inválido.");
        }
      } catch {
        throw Error(
          "Faltan adjuntos de la copia o su contenido no coincide; recuperá ATTACHMENT_DIRECTORY antes de activar la base.",
        );
      }
    }
  });
}

/** Both renames commit together. No database or historical audit rows are deleted. */
export async function activateRecovered(
  client,
  { database, staging, previous, databaseId, stagingId },
) {
  await client.query("BEGIN");
  try {
    const old = await inspectDatabase(client, database),
      next = await inspectDatabase(client, staging);
    if (old?.id !== databaseId || next?.id !== stagingId)
      throw Error(
        "La identidad de las bases cambió; se canceló la activación.",
      );
    if (old.connections || next.connections)
      throw Error(
        "Hay conexiones activas. Detené API, copias y herramientas de consulta; no se forzaron desconexiones.",
      );
    await client.query(
      `ALTER DATABASE ${identifier(database)} ALLOW_CONNECTIONS false`,
    );
    await client.query(
      `ALTER DATABASE ${identifier(staging)} ALLOW_CONNECTIONS false`,
    );
    await client.query(
      `ALTER DATABASE ${identifier(database)} RENAME TO ${identifier(previous)}`,
    );
    await client.query(
      `ALTER DATABASE ${identifier(staging)} RENAME TO ${identifier(database)}`,
    );
    await client.query(
      `ALTER DATABASE ${identifier(database)} ALLOW_CONNECTIONS true`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

export async function restoreDatabase(
  root,
  config,
  {
    file,
    expectedSha256,
    confirm,
    log = console.log,
    execute,
    journalRoot,
  } = {},
) {
  const target = validateConfig(root, config, config.PROFILE);
  if (typeof confirm !== "function")
    throw Error("La restauración requiere confirmación interactiva.");
  if (expectedSha256 && !/^[a-f0-9]{64}$/i.test(expectedSha256))
    throw Error("SHA-256 inválido: debe tener 64 caracteres hexadecimales.");
  const release = await claimRestoreSlot(root, config.PROFILE);
  let stop = async () => {},
    activated = false,
    auditReady = false,
    data,
    journal;
  const command =
    execute ||
    ((program, args, env, label) =>
      run(program, args, {
        cwd: root,
        env,
        config,
        label,
        quiet: true,
        timeout: 1800000,
      }));
  try {
    const id = randomUUID(),
      suffix = id.replaceAll("-", "").slice(0, 12);
    const database = target.databaseName,
      prefix = database.slice(0, 35);
    const staging = `${prefix}_restore_${suffix}`,
      previous = `${prefix}_previous_${suffix}`;
    const directory = assertPrivateLocation(
      root,
      journalRoot || `.local/backups/restores/${config.PROFILE}/${id}`,
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const actual = await realpath(directory);
    assertPrivateLocation(await realpath(root), actual);
    const clientDirectory = await realpath(resolve(root, "client")).catch(() =>
      resolve(root, "client"),
    );
    const fromClient = relative(clientDirectory, actual);
    if (
      !fromClient ||
      (!fromClient.startsWith("..") && !isAbsolute(fromClient))
    )
      throw Error(
        "La restauración requiere una carpeta privada fuera del cliente web.",
      );
    const input = join(actual, "input.dump");
    journal = async (operation, status = "EXITO") =>
      appendFile(
        join(actual, "events.jsonl"),
        JSON.stringify({
          at: new Date().toISOString(),
          operation,
          status,
          ...data,
        }) + "\n",
        { mode: 0o600 },
      );
    data = {
      id,
      database,
      staging,
      previous,
      filename: basename(file),
      journalDirectory: actual,
    };
    await journal("RESTAURACION_SOLICITADA");
    await copyFile(resolve(file), input, constants.COPYFILE_EXCL);
    await chmod(input, 0o600);
    const handle = await open(input, "r");
    try {
      const header = Buffer.alloc(5);
      await handle.read(header, 0, 5, 0);
      if (header.toString() !== "PGDMP")
        throw Error("El archivo no es una copia custom de PostgreSQL (.dump).");
    } finally {
      await handle.close();
    }
    const hash = await sha256(input);
    data = {
      id,
      database,
      staging,
      previous,
      filename: basename(file),
      sha256: hash,
      journalDirectory: actual,
    };
    await journal("RESTAURACION_ARCHIVO_VERIFICADO");
    await command(
      pgTool(config, "pg_restore"),
      ["--list", input],
      {},
      "Verificación del índice de la copia",
    );
    stop = await ensureManagedPostgres(root, config);
    const adminUrl = new URL(
      config.PG_ADMIN_URL || config.MIGRATION_DATABASE_URL,
    );
    adminUrl.pathname = "/postgres";
    await connected(root, adminUrl.href, async (maintenance) => {
      const lock = await maintenance.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1,741903)) AS acquired",
        [database],
      );
      if (!lock.rows[0]?.acquired)
        throw Error(
          "Hay otra preparación o restauración de esta base en curso.",
        );
      const before = await inspectDatabase(maintenance, database);
      if (!before || before.owner !== decodeURIComponent(target.owner.username))
        throw Error("La base actual no existe o tiene otro propietario.");
      if (before.connections)
        throw Error(
          "La base tiene conexiones activas. Detené API, copias y herramientas de consulta antes de restaurar.",
        );
      const privilege = (
        await maintenance.query(
          "SELECT rolsuper OR rolcreatedb AS allowed FROM pg_roles WHERE rolname=current_user",
        )
      ).rows[0];
      if (!privilege?.allowed)
        throw Error(
          "La restauración necesita una cuenta administrativa PostgreSQL con permiso para crear y renombrar bases.",
        );
      const recorded = await connected(
        root,
        config.MIGRATION_DATABASE_URL,
        async (source) =>
          (
            await source.query(
              "SELECT valores_nuevos->>'sha256' AS sha256 FROM public.auditoria WHERE operacion='RESPALDO_FINALIZADO' AND valores_nuevos->>'filename'=$1 AND valores_nuevos->>'localSaved'='true' ORDER BY creado_en DESC LIMIT 1",
              [basename(file)],
            )
          ).rows[0]?.sha256,
      );
      auditReady = true;
      if (
        recorded &&
        expectedSha256 &&
        recorded.toLowerCase() !== expectedSha256.toLowerCase()
      )
        throw Error(
          "El SHA-256 indicado no coincide con la auditoría del respaldo.",
        );
      const expected = recorded || expectedSha256;
      if (!expected)
        throw Error(
          "No se encontró el hash en la auditoría. Indicá --sha256 con el SHA-256 original del respaldo.",
        );
      if (expected.toLowerCase() !== hash)
        throw Error(
          "El SHA-256 no coincide; la copia fue alterada o está incompleta.",
        );
      log(
        `Copia verificada: ${basename(file)}\nBase: ${database} (${target.runtime.hostname}:${target.runtime.port || "5432"})\nSHA-256: ${hash}\nLa base actual se conservará como ${previous}.`,
      );
      if ((await confirm({ ...data })) !== `RESTAURAR ${database}`)
        throw Error("Restauración cancelada; la base actual se conserva.");
      await connected(root, config.MIGRATION_DATABASE_URL, (source) =>
        record(source, "RESTAURACION_INICIADA", "EXITO", data),
      );
      await journal("RESTAURACION_INICIADA");
      log("Restaurando en una base nueva…");
      await maintenance.query(
        `CREATE DATABASE ${identifier(staging)} OWNER ${identifier(decodeURIComponent(target.owner.username))} TEMPLATE template0`,
      );
      const stagingId = (await inspectDatabase(maintenance, staging)).id;
      const stagingOwner = withDatabase(config.MIGRATION_DATABASE_URL, staging);
      await command(
        pgTool(config, "pg_restore"),
        [
          "--no-password",
          "--dbname",
          staging,
          "--no-owner",
          "--no-acl",
          "--no-tablespaces",
          "--single-transaction",
          "--exit-on-error",
          input,
        ],
        restoreEnvironment(stagingOwner),
        "Restauración de PostgreSQL",
      );
      await validateRecovered(root, config, stagingOwner);
      await command(
        pgTool(config, "psql"),
        [
          "--no-password",
          "--no-psqlrc",
          "--set=ON_ERROR_STOP=1",
          `--set=app_role=${decodeURIComponent(target.runtime.username)}`,
          "--file",
          resolve(root, "server/scripts/runtime-grants.sql"),
        ],
        restoreEnvironment(stagingOwner),
        "Permisos de la aplicación recuperada",
      );
      const backupFile = localPath(
        root,
        config.BACKUP_CONFIG_FILE || `.local/backups/${config.PROFILE}.env`,
      );
      let backup;
      try {
        backup = readConfig(backupFile);
      } catch (error) {
        if (error.code !== "ENOENT" || config.BACKUP_ENABLED === "true")
          throw error;
      }
      if (backup?.BACKUP_DATABASE_URL) {
        const reader = new URL(backup.BACKUP_DATABASE_URL);
        if (
          reader.host !== target.runtime.host ||
          reader.pathname !== target.runtime.pathname
        )
          throw Error(
            "La conexión de copias no coincide con la base del perfil.",
          );
        const name = identifier(decodeURIComponent(reader.username)),
          owner = identifier(decodeURIComponent(target.owner.username));
        const readerRole = (
          await maintenance.query(
            "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolcanlogin,pg_has_role(rolname,$2::name,'MEMBER') AS owner_access FROM pg_roles WHERE rolname=$1",
            [
              decodeURIComponent(reader.username),
              decodeURIComponent(target.owner.username),
            ],
          )
        ).rows[0];
        if (
          !readerRole?.rolcanlogin ||
          readerRole.rolsuper ||
          readerRole.rolcreatedb ||
          readerRole.rolcreaterole ||
          readerRole.rolreplication ||
          readerRole.owner_access ||
          reader.username === target.runtime.username
        )
          throw Error(
            "La conexión de copias requiere una cuenta de lectura separada y sin permisos de propietario.",
          );
        await connected(root, stagingOwner, async (recovered) => {
          await recovered.query(
            `GRANT CONNECT ON DATABASE ${identifier(staging)} TO ${name}`,
          );
          await recovered.query(`GRANT USAGE ON SCHEMA public TO ${name}`);
          await recovered.query(
            `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${name}`,
          );
          await recovered.query(
            `GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${name}`,
          );
          await recovered.query(
            `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT ON TABLES TO ${name}`,
          );
          await recovered.query(
            `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${name}`,
          );
        });
        await connected(
          root,
          withDatabase(backup.BACKUP_DATABASE_URL, staging),
          (readerClient) =>
            readerClient.query("SELECT count(*) FROM public.auditoria"),
        );
      }
      await verifyRuntime(root, {
        ...config,
        DATABASE_URL: withDatabase(config.DATABASE_URL, staging),
      });
      await connected(root, stagingOwner, async (recovered) => {
        await recovered.query("BEGIN");
        try {
          await recovered.query(
            "UPDATE public.sesiones SET revocado_en=CURRENT_TIMESTAMP WHERE revocado_en IS NULL",
          );
          await recovered.query(
            "UPDATE public.tokens_refresh SET revocado_en=CURRENT_TIMESTAMP WHERE revocado_en IS NULL",
          );
          await recovered.query("DELETE FROM public.tokens_recuperacion");
          await recovered.query(
            "UPDATE public.respaldos SET estado='FALLIDO',finalizado_en=CURRENT_TIMESTAMP,detalle='Ejecución interrumpida por restauración de la base.' WHERE estado='EN_CURSO'",
          );
          await record(recovered, "RESTAURACION_VALIDADA", "EXITO", data);
          await recovered.query("COMMIT");
        } catch (error) {
          await recovered.query("ROLLBACK");
          throw error;
        }
      });
      await journal("RESTAURACION_ACTIVACION_AUTORIZADA");
      await activateRecovered(maintenance, {
        database,
        staging,
        previous,
        databaseId: before.id,
        stagingId,
      });
      activated = true;
      // The committed database carries its mandatory audit; the journal is supplementary here.
      await journal("RESTAURACION_FINALIZADA").catch(() =>
        log(
          "Base activada; no se pudo completar el registro local. Revisá la auditoría de la base recuperada.",
        ),
      );
      await rm(input, { force: true }).catch(() =>
        log(
          "Base activada; revisá la copia temporal input.dump que no pudo retirarse.",
        ),
      );
      log(
        `Base restaurada: ${database}. Base anterior conservada: ${previous}.\nRegistro: ${join(actual, "events.jsonl")}\nIniciá el sistema con npm run start:${config.PROFILE}. Se requiere iniciar sesión nuevamente.`,
      );
    });
    return data;
  } catch (error) {
    if (!activated) {
      if (journal) await journal("RESTAURACION_FALLIDA", "FALLIDO");
      if (auditReady)
        await connected(root, config.MIGRATION_DATABASE_URL, (source) =>
          record(source, "RESTAURACION_FALLIDA", "FALLIDO", data),
        );
    }
    throw error;
  } finally {
    try {
      await stop();
    } finally {
      await release();
    }
  }
}
