import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join, sep } from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  defaults,
  apiEnvironment,
  writeConfig,
  readConfig,
  assertPrivateLocation,
} from "./config.mjs";
import { configureDeployment, databaseUrl } from "./wizard.mjs";
import {
  configuredBackups,
  prepareBackupTools,
  finishBackupSetup,
} from "./backup-setup.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
function fixture(t) {
  const parent = resolve(root, ".local");
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(join(parent, "wizard-test-"));
  t.after(() => {
    assert.ok(folder.startsWith(parent + sep));
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}
function terminal(overrides = {}) {
  const calls = [],
    messages = [];
  const values = {
    PUBLIC_URL: "https://catalogo.example.org",
    TLS_CERT_FILE: "private/cert.pem",
    TLS_KEY_FILE: "private/key.pem",
    PG_ADMIN_PASSWORD: "Private@admin:pass",
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.org",
    BOOTSTRAP_ADMIN_PASSWORD: "Segura2026!",
    BACKUP_CONFIGURE_DRIVE: "no",
    ...overrides,
  };
  return {
    calls,
    messages,
    log: (message) => messages.push(message),
    ask: async (label, current, hidden) => {
      if (calls.length > 150) throw Error("Fixture sin respuesta válida.");
      const key = /\(([A-Z_]+)\)$/.exec(label)?.[1];
      calls.push({ key, hidden, current });
      return values[key] ?? current;
    },
  };
}
test("producción usa fceadatasys en el servicio principal y pregunta credenciales y todas las opciones de copias", async (t) => {
  const folder = fixture(t),
    prompt = terminal({
      BACKUP_CONFIG_FILE: join(folder, "backup.env"),
      SMTP_ENABLED: "si",
      SMTP_HOST: "smtp.example.org",
      SMTP_PORT: "465",
      SMTP_FROM: "catalogo@example.org",
      SMTP_AUTH: "si",
      SMTP_USER: "sender",
      SMTP_PASS: "PrivateSMTP",
      BACKUP_TIME: "23:30",
    });
  const result = await configureDeployment(
    root,
    defaults(root, "production"),
    prompt,
  );
  assert.equal(new URL(result.config.DATABASE_URL).pathname, "/fceadatasys");
  assert.equal(new URL(result.config.PG_ADMIN_URL).username, "postgres");
  assert.equal(
    decodeURIComponent(new URL(result.config.PG_ADMIN_URL).password),
    "Private@admin:pass",
  );
  assert.equal(result.config.MANAGE_POSTGRES, "false");
  assert.equal(result.config.PG_DATA_DIRECTORY, undefined);
  assert.equal(result.config.BACKUP_TIME, "23:30");
  assert.equal(result.config.BACKUP_TEST_ON_SETUP, "true");
  assert.equal(result.config.SMTP_SECURE, "true");
  assert.equal(
    new URL(result.backup.BACKUP_DATABASE_URL).pathname,
    "/fceadatasys",
  );
  for (const key of [
    "PG_HOST",
    "PG_PORT",
    "PG_ADMIN_USER",
    "PG_ADMIN_PASSWORD",
    "PG_DATABASE",
    "PG_OWNER_USER",
    "PG_OWNER_PASSWORD",
    "PG_APP_USER",
    "PG_APP_PASSWORD",
    "BACKUP_DIRECTORY",
    "BACKUP_DB_USER",
    "BACKUP_DB_PASSWORD",
    "PG_DUMP_COMMAND",
    "PG_RESTORE_COMMAND",
    "RCLONE_COMMAND",
    "RCLONE_CONFIG",
    "RCLONE_REMOTE",
    "BACKUP_TIMEOUT_MS",
    "BACKUP_CONFIGURE_DRIVE",
    "BACKUP_TEST_ON_SETUP",
    "BACKUP_INSTALL_SCHEDULE",
    "BACKUP_TIME",
    "INSTALL_BACKUP_DIRECTORY",
    "ATTACHMENT_DIRECTORY",
    "API_PORT",
    "SMTP_PASS",
  ])
    assert.ok(
      prompt.calls.some((call) => call.key === key),
      key,
    );
  assert.ok(
    prompt.calls
      .filter((call) => /PASSWORD|SECRET|SMTP_PASS/.test(call.key))
      .every((call) => call.hidden),
  );
  assert.ok(!JSON.stringify(prompt.messages).includes("Private@admin:pass"));
});
test("el asistente actualiza el nombre anterior sin ordenar renombrar ni eliminar la base previa", async (t) => {
  const folder = fixture(t),
    config = defaults(root, "production");
  for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL"])
    config[key] = config[key].replace(
      "/fceadatasys",
      "/fceadatasys_production",
    );
  const prompt = terminal({ BACKUP_ENABLED: "no" });
  const result = await configureDeployment(folder, config, prompt);
  assert.equal(new URL(result.config.DATABASE_URL).pathname, "/fceadatasys");
  assert.equal(result.backup, undefined);
  assert.ok(
    prompt.messages.some((message) =>
      message.includes("no se renombra ni se elimina"),
    ),
  );
  assert.equal(
    apiEnvironment(root, result.config).BACKUP_CONFIG_FILE,
    undefined,
  );
  assert.equal(result.config.BACKUP_DISABLE_SCHEDULE, "true");
  assert.ok(!prompt.calls.some((call) => call.key === "RCLONE_REMOTE"));
});
test("URLs codifican contraseñas con símbolos; identificadores y carpetas públicas se rechazan", () => {
  const url = new URL(
    databaseUrl({
      host: "127.0.0.1",
      port: "5432",
      username: "owner",
      password: "p@ss:'$\\word",
      database: "fceadatasys",
    }),
  );
  assert.equal(decodeURIComponent(url.password), "p@ss:'$\\word");
  assert.equal(
    new URL(
      databaseUrl({
        host: "::1",
        port: "5432",
        username: "owner",
        password: "private",
        database: "fceadatasys",
      }),
    ).hostname,
    "[::1]",
  );
  assert.throws(() =>
    databaseUrl({
      host: "bad/host",
      port: "5432",
      username: "postgres",
      database: "fceadatasys",
      password: "x",
    }),
  );
  assert.throws(() => assertPrivateLocation(root, "client/public/private.env"));
});
test("la configuración privada de copias persiste y se valida contra la base del perfil", (t) => {
  const folder = fixture(t),
    file = join(folder, "backup.env"),
    config = { ...defaults(root, "production"), BACKUP_CONFIG_FILE: file };
  assert.throws(() => configuredBackups(root, config), /Falta configuración/);
  const backup = {
    BACKUP_DATABASE_URL:
      "postgresql://reader:private@127.0.0.1:5432/fceadatasys",
    BACKUP_DIRECTORY: "copies",
    PG_DUMP_COMMAND: "pg_dump",
    PG_RESTORE_COMMAND: "pg_restore",
    RCLONE_COMMAND: "rclone",
    RCLONE_CONFIG: "rclone.conf",
    RCLONE_REMOTE: "drive:copias",
  };
  writeConfig(file, backup);
  assert.deepEqual(readConfig(file), backup);
  assert.equal(
    configuredBackups(root, config).BACKUP_DIRECTORY,
    join(folder, "copies"),
  );
  writeConfig(file, {
    ...backup,
    BACKUP_DATABASE_URL: backup.BACKUP_DATABASE_URL.replace(
      "/fceadatasys",
      "/otra",
    ),
  });
  assert.throws(() => configuredBackups(root, config), /misma base/);
});
test("preparación de copias: autorización explícita, primera prueba y horario elegidos, sin registrar tareas durante el test", async (t) => {
  const folder = fixture(t),
    file = join(folder, "deployment.env"),
    config = {
      ...defaults(root, "production"),
      BACKUP_CONFIGURE_DRIVE: "true",
      BACKUP_CONFIG_FILE: join(folder, "backup.env"),
    };
  const backup = {
    PG_DUMP_COMMAND: "pg_dump",
    PG_RESTORE_COMMAND: "pg_restore",
    RCLONE_COMMAND: "rclone",
    RCLONE_CONFIG: join(folder, "private", "rclone.conf"),
  };
  const commands = [],
    interactive = [];
  let validated = 0;
  const options = {
    configFile: file,
    execute: async (...args) => commands.push(args),
    interactiveExecute: async (...args) => interactive.push(args),
    validateSettings: async () => validated++,
    nonInteractive: false,
    log: () => {},
  };
  await prepareBackupTools(root, config, backup, options);
  assert.equal(config.BACKUP_CONFIGURE_DRIVE, "false");
  assert.equal(validated, 1);
  assert.ok(interactive[0][1].includes("config"));
  await finishBackupSetup(root, config, backup, options);
  assert.ok(commands.some((args) => args[1].includes("scripts/backup.mjs")));
  assert.ok(
    interactive.some(
      (args) =>
        args[1].includes("scripts/configure-backups.mjs") &&
        args[1].includes("02:00"),
    ),
  );
  await assert.rejects(
    prepareBackupTools(
      root,
      { ...config, BACKUP_CONFIGURE_DRIVE: "true" },
      backup,
      { ...options, nonInteractive: true },
    ),
    /interactiva/,
  );
});
