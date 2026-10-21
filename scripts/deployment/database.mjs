import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { localPath } from "./config.mjs";
import { run, pgTool } from "./processes.mjs";

const identifier = (value) => {
  if (!/^[a-z][a-z0-9_]*$/.test(value))
    throw Error("Identificador PostgreSQL inválido.");
  return '"' + value + '"';
};
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
export function databaseClient(root, url) {
  const require = createRequire(resolve(root, "server/package.json"));
  const { Client } = require("pg");
  return new Client({ connectionString: url, connectionTimeoutMillis: 10000 });
}
export async function ensureManagedPostgres(root, config) {
  if (config.MANAGE_POSTGRES !== "true") return async () => {};
  const directory = localPath(root, config.PG_DATA_DIRECTORY);
  const owner = new URL(config.MIGRATION_DATABASE_URL);
  const settings = {
    config,
    label: "PostgreSQL local",
    quiet: true,
    timeout: 60000,
  };
  mkdirSync(directory, { recursive: true });
  if (!existsSync(join(directory, "PG_VERSION"))) {
    if (readdirSync(directory).length)
      throw Error(
        "El directorio del clúster no está vacío y no es un clúster válido.",
      );
    const passwordFile = join(resolve(directory, ".."), "initdb-password.tmp");
    writeFileSync(passwordFile, decodeURIComponent(owner.password) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    try {
      await run(
        pgTool(config, "initdb"),
        [
          "-D",
          directory,
          "--username",
          decodeURIComponent(owner.username),
          "--auth",
          "scram-sha-256",
          "--encoding",
          "UTF8",
          "--locale",
          "C",
          "--pwfile",
          passwordFile,
        ],
        { ...settings, label: "Creación del clúster demo" },
      );
    } finally {
      unlinkSync(passwordFile);
    }
  }
  let running = false;
  try {
    await run(pgTool(config, "pg_ctl"), ["status", "-D", directory], settings);
    running = true;
  } catch {
    /* Start only this configured demo cluster. */
  }
  let started = false;
  if (!running) {
    await run(
      pgTool(config, "pg_ctl"),
      [
        "start",
        "-D",
        directory,
        "-l",
        join(resolve(directory, ".."), "postgres.log"),
        "-o",
        `-h 127.0.0.1 -p ${owner.port || "5432"}`,
        "-w",
      ],
      { ...settings, label: "Inicio de PostgreSQL demo" },
    );
    started = true;
  }
  const admin = new URL(owner);
  admin.pathname = "/postgres";
  const connection = databaseClient(root, admin.href);
  let verificationError;
  connection.on("error", (error) => {
    verificationError ??= error;
  });
  try {
    await connection.connect();
    // Windows can report non-ASCII data_directory paths in the system code page.
    // Compare cluster identifiers instead of decoding that path as UTF-8.
    const control = await run(
      pgTool(config, "pg_controldata"),
      ["-D", directory],
      { ...settings, env: { LC_ALL: "C" }, label: "Identidad de PostgreSQL demo" },
    );
    const systemIdentifier = control.match(
      /^Database system identifier:\s*(\d+)\s*$/m,
    )?.[1];
    if (!systemIdentifier)
      throw Error("No se pudo leer la identidad del clúster PostgreSQL demo.");
    const { rows } = await connection.query(
      "SELECT system_identifier::text AS system_identifier FROM pg_control_system()",
    );
    if (rows[0]?.system_identifier !== systemIdentifier)
      throw Error(
        "El puerto PostgreSQL no pertenece al clúster demo configurado.",
      );
  } catch (error) {
    verificationError ??= error;
  } finally {
    // Disconnect before stopping the server, preserving the original failure.
    try {
      await connection.end();
    } catch (error) {
      verificationError ??= error;
    }
  }
  if (verificationError) {
    if (started)
      await run(
        pgTool(config, "pg_ctl"),
        ["stop", "-D", directory, "-m", "fast", "-w"],
        settings,
      );
    throw verificationError;
  }
  return async () => {
    if (started)
      await run(
        pgTool(config, "pg_ctl"),
        ["stop", "-D", directory, "-m", "fast", "-w"],
        settings,
      );
  };
}
export async function prepareDatabase(root, config, target, execute) {
  const adminUrl = new URL(
    config.PG_ADMIN_URL || config.MIGRATION_DATABASE_URL,
  );
  if (!config.PG_ADMIN_URL) adminUrl.pathname = "/postgres";
  const connection = databaseClient(root, adminUrl.href);
  try {
    await connection.connect();
    for (const [url, limited] of [
      [target.owner, false],
      [target.runtime, true],
    ]) {
      const name = decodeURIComponent(url.username);
      const { rows } = await connection.query(
        "SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolcanlogin FROM pg_roles WHERE rolname=$1",
        [name],
      );
      if (!rows.length) {
        const password = decodeURIComponent(url.password);
        if (!password)
          throw Error("Un rol nuevo requiere contraseña en su URL.");
        await connection.query(
          `CREATE ROLE ${identifier(name)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(password)}`,
        );
      } else if (
        !rows[0].rolcanlogin ||
        (limited &&
          (rows[0].rolsuper ||
            rows[0].rolcreatedb ||
            rows[0].rolcreaterole ||
            rows[0].rolreplication))
      )
        throw Error("El runtime existente tiene privilegios incompatibles.");
    }
    const { rows } = await connection.query(
      "SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1",
      [target.databaseName],
    );
    if (!rows.length)
      await connection.query(
        `CREATE DATABASE ${identifier(target.databaseName)} OWNER ${identifier(decodeURIComponent(target.owner.username))}`,
      );
    else if (rows[0].owner !== decodeURIComponent(target.owner.username))
      throw Error(
        "La base existente pertenece a otro propietario. No se modificó.",
      );
  } finally {
    await connection.end();
  }
  await execute(
    process.execPath,
    ["node_modules/prisma/build/index.js", "migrate", "deploy"],
    { DATABASE_URL: config.MIGRATION_DATABASE_URL },
    "Migraciones",
  );
  await execute(
    pgTool(config, "psql"),
    [
      "--no-psqlrc",
      "-h",
      target.owner.hostname,
      "-p",
      target.owner.port || "5432",
      "-U",
      decodeURIComponent(target.owner.username),
      "-d",
      target.databaseName,
      "-v",
      `app_role=${decodeURIComponent(target.runtime.username)}`,
      "-f",
      "scripts/runtime-grants.sql",
    ],
    {
      PGPASSWORD: decodeURIComponent(target.owner.password),
      PGSSLMODE: process.env.PGSSLMODE || "prefer",
    },
    "Permisos runtime",
  );
  return verifyRuntime(root, config);
}
export async function verifyRuntime(root, config) {
  // Authenticate the actual runtime. Existing role passwords are never reset.
  const runtime = databaseClient(root, config.DATABASE_URL);
  try {
    await runtime.connect();
    const {
      rows: [role],
    } = await runtime.query(
      `SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolreplication, (pg_has_role(r.oid,c.relowner,'MEMBER') OR pg_has_role(r.oid,d.datdba,'MEMBER')) AS owner_access FROM pg_roles r JOIN pg_class c ON c.oid='public.usuarios'::regclass JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`,
    );
    if (
      !role ||
      role.rolsuper ||
      role.rolcreatedb ||
      role.rolcreaterole ||
      role.rolreplication ||
      role.owner_access
    )
      throw Error("Runtime con privilegios de propietario.");
    const {
      rows: [users],
    } = await runtime.query(
      "SELECT count(*)::int AS total,count(*) FILTER(WHERE rol='ADMINISTRADOR' AND activo)::int AS admins FROM usuarios",
    );
    if (users.total && !users.admins)
      throw Error(
        "La base no tiene un Administrador activo; requiere recuperación administrada.",
      );
    return users.total;
  } finally {
    await runtime.end();
  }
}
