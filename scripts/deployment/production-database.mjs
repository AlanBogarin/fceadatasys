import {
  appendFileSync,
  mkdirSync,
  openSync,
  closeSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { localPath, assertPrivateLocation } from "./config.mjs";
import { pgTool } from "./processes.mjs";

const identifier = (value) => {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(value))
    throw Error("Nombre PostgreSQL inválido.");
  return '"' + value + '"';
};
export async function inspectDatabase(connection, name) {
  const result = await connection.query(
    "SELECT oid::text AS id, datname AS name, pg_get_userbyid(datdba) AS owner, (SELECT count(*)::int FROM pg_stat_activity WHERE datname=$1) AS connections FROM pg_database WHERE datname=$1",
    [name],
  );
  return result.rows[0] ?? null;
}
export function maintenanceEnvironment(url, database) {
  return {
    PGPASSWORD: decodeURIComponent(url.password),
    PGUSER: decodeURIComponent(url.username),
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: "15",
  };
}
/** Only an interactive decision followed by a verified snapshot and an exact typed name can recreate a database. */
export async function resolveExistingDatabase(
  root,
  config,
  target,
  connection,
  adminUrl,
  execute,
  {
    chooseExisting,
    confirmReset,
    journalDirectory: journalOverride,
    log = console.log,
  } = {},
) {
  const before = await inspectDatabase(connection, target.databaseName);
  if (!before || config.PROFILE !== "production") return before;
  const action = chooseExisting
    ? await chooseExisting({
        ...before,
        host: adminUrl.hostname,
        port: adminUrl.port || "5432",
      })
    : "keep";
  if (action === "keep") {
    log(
      `La base ${before.name} se conserva; se aplicarán únicamente las migraciones pendientes.`,
    );
    return before;
  }
  if (action !== "recreate" || !confirmReset)
    throw Error("Preparación cancelada. La base existente se conserva.");
  if (
    ["postgres", "template0", "template1"].includes(before.name) ||
    adminUrl.pathname === "/" + before.name
  )
    throw Error(
      "No se permite recrear una base de sistema o la conexión de mantenimiento.",
    );
  const directory = assertPrivateLocation(
    root,
    config.INSTALL_BACKUP_DIRECTORY || ".local/backups/pre-install",
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = `${before.name}-preinstall-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.dump`;
  const snapshot = join(directory, filename),
    partial = snapshot + ".partial";
  const journalDirectory =
    journalOverride || localPath(root, ".local/deploy/production");
  mkdirSync(journalDirectory, { recursive: true, mode: 0o700 });
  const journal = (event) =>
    appendFileSync(
      join(journalDirectory, "installation-events.jsonl"),
      JSON.stringify({
        at: new Date().toISOString(),
        database: before.name,
        databaseId: before.id,
        host: adminUrl.hostname,
        port: adminUrl.port || "5432",
        ...event,
      }) + "\n",
      { mode: 0o600 },
    );
  try {
    const fd = openSync(partial, "wx", 0o600);
    closeSync(fd);
    await execute(
      pgTool(config, "pg_dump"),
      ["--format=custom", "--no-owner", "--no-acl", "--file", partial],
      maintenanceEnvironment(adminUrl, before.name),
      "Copia previa a recreación",
    );
    await execute(
      pgTool(config, "pg_restore"),
      ["--list", partial],
      {},
      "Verificación de copia previa",
    );
    renameSync(partial, snapshot);
  } finally {
    rmSync(partial, { force: true });
  }
  journal({ operation: "PREINSTALL_BACKUP_VERIFIED", snapshot });
  const confirmation = await confirmReset({
    ...before,
    host: adminUrl.hostname,
    port: adminUrl.port || "5432",
    snapshot,
  });
  if (confirmation !== `ELIMINAR ${before.name}`)
    throw Error(
      "Confirmación incorrecta o cancelada. La base existente se conserva y la copia queda disponible.",
    );
  const current = await inspectDatabase(connection, before.name);
  if (!current || current.id !== before.id || current.owner !== before.owner)
    throw Error("La base cambió durante la confirmación; no se elimina.");
  if (current.connections > 0)
    throw Error(
      "La base tiene conexiones activas. Detener la aplicación antes de recrearla; no se forzaron desconexiones.",
    );
  journal({ operation: "DATABASE_RECREATE_AUTHORIZED", snapshot });
  await connection.query(`DROP DATABASE ${identifier(before.name)}`);
  journal({ operation: "DATABASE_REMOVED_FOR_REINSTALL", snapshot });
  return null;
}

/** A dedicated backup login receives only read access, including future tables from the migration owner. */
export async function provisionBackupReader(
  root,
  config,
  target,
  connection,
  backup,
  execute,
) {
  if (!backup) return;
  const reader = new URL(backup.BACKUP_DATABASE_URL),
    name = decodeURIComponent(reader.username),
    owner = decodeURIComponent(target.owner.username);
  if (
    reader.host !== target.runtime.host ||
    reader.pathname !== target.runtime.pathname ||
    [
      owner,
      decodeURIComponent(target.runtime.username),
      decodeURIComponent(connection.user ?? ""),
    ].includes(name)
  )
    throw Error(
      "Configuración de copias inválida: usar una cuenta de lectura distinta en la misma base.",
    );
  const { rows } = await connection.query(
    "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolcanlogin FROM pg_roles WHERE rolname=$1",
    [name],
  );
  if (!rows.length) {
    const password = decodeURIComponent(reader.password);
    if (!password) throw Error("La cuenta de copias requiere contraseña.");
    await connection.query(
      `CREATE ROLE ${identifier(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${password.replaceAll("'", "''")}'`,
    );
  } else if (
    !rows[0].rolcanlogin ||
    rows[0].rolsuper ||
    rows[0].rolcreatedb ||
    rows[0].rolcreaterole ||
    rows[0].rolreplication
  )
    throw Error(
      "La cuenta de copias existente tiene privilegios incompatibles. No se modificó.",
    );
  if (
    (
      await connection.query(
        "SELECT pg_has_role($1::name,$2::name,'MEMBER') AS owner_access",
        [name, owner],
      )
    ).rows[0].owner_access
  )
    throw Error("La cuenta de copias no puede pertenecer al rol propietario.");
  const sql = [
    `GRANT CONNECT ON DATABASE ${identifier(target.databaseName)} TO ${identifier(name)};`,
    `GRANT USAGE ON SCHEMA public TO ${identifier(name)};`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${identifier(name)};`,
    `GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier(name)};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(owner)} IN SCHEMA public GRANT SELECT ON TABLES TO ${identifier(name)};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(owner)} IN SCHEMA public GRANT SELECT ON SEQUENCES TO ${identifier(name)};`,
  ].join("\n");
  // Execute as the database owner; never provision the reader with application credentials.
  await execute(
    pgTool(config, "psql"),
    ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--command", sql],
    maintenanceEnvironment(target.owner, target.databaseName),
    "Permisos de lectura para copias",
  );
}
