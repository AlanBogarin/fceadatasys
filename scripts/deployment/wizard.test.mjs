import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join, sep } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  defaults,
  apiEnvironment,
  writeConfig,
  readConfig,
  assertPrivateLocation,
} from "./config.mjs";
import { configureDeployment, databaseUrl } from "./wizard.mjs";
import { assertDriveClientFile, importDriveClientFile } from "./drive-client.mjs";
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
function desktopClient(folder) {
  const file = join(folder, "downloaded-client.json");
  writeFileSync(file, JSON.stringify({ installed: {
    client_id: "wizard.apps.googleusercontent.com", client_secret: "private-json-secret",
  } }));
  return file;
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
      DRIVE_CLIENT_FILE: join(folder, "private", "drive-client.json"),
      DRIVE_CLIENT_SOURCE: desktopClient(folder),
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
    "DRIVE_CLIENT_FILE",
    "DRIVE_TOKEN_FILE",
    "DRIVE_FOLDER_NAME",
    "DRIVE_FOLDER_ID",
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
  assert.ok(!prompt.calls.some((call) => call.key === "DRIVE_FOLDER_ID"));
});

test("demo habilita Drive personal con configuración propia y conserva la base demo", async (t) => {
  const folder = fixture(t);
  const prompt = terminal({
    PUBLIC_URL: "http://127.0.0.1:8080",
    BACKUP_ENABLED: "si",
    BACKUP_CONFIG_FILE: join(folder, "demo.env"),
    DRIVE_CLIENT_FILE: join(folder, "private", "demo-drive-client.json"),
    DRIVE_CLIENT_SOURCE: '"' + desktopClient(folder) + '"',
    BACKUP_CONFIGURE_DRIVE: "si",
    BACKUP_INSTALL_SCHEDULE: "no",
    SMTP_ENABLED: "no",
  });
  const input = defaults(root, "demo");
  const result = await configureDeployment(root, input, prompt);
  assert.equal(result.config.PROFILE, "demo");
  assert.equal(result.config.BACKUP_ENABLED, "true");
  assert.equal(result.config.BACKUP_CONFIGURE_DRIVE, "true");
  assert.equal(result.config.BACKUP_INSTALL_SCHEDULE, "false");
  assert.equal(result.config.DATABASE_URL, input.DATABASE_URL);
  const runtime = new URL(input.DATABASE_URL);
  const reader = new URL(result.backup.BACKUP_DATABASE_URL);
  assert.equal(reader.host, runtime.host);
  assert.equal(reader.pathname, "/fceadatasys_demo");
  assert.notEqual(reader.username, runtime.username);
  assert.equal(result.backup.DRIVE_FOLDER_NAME, "fceadatasys-demo");
  assert.equal(result.backup.DRIVE_FOLDER_ID, "");
  assert.ok(result.backup.DRIVE_CLIENT_FILE.endsWith("demo-drive-client.json"));
  assert.ok(result.backup.DRIVE_TOKEN_FILE.endsWith("demo-drive-token.json"));
  assertDriveClientFile(result.backup.DRIVE_CLIENT_FILE);
  assert.ok(prompt.calls.some((call) => call.key === "DRIVE_CLIENT_SOURCE"));
  assert.ok(!JSON.stringify(prompt.messages).includes("private-json-secret"));
  assert.ok(!prompt.calls.some((call) => call.key === "BOOTSTRAP_ADMIN_EMAIL"));
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
    DRIVE_CLIENT_FILE: "drive-client.json",
    DRIVE_TOKEN_FILE: "drive-token.json",
    DRIVE_FOLDER_ID: "folder-test",
  };
  writeConfig(file, backup);
  assert.throws(() => configuredBackups(root, config), /No se encontró el JSON OAuth/);
  writeFileSync(join(folder, "drive-client.json"), readFileSync(desktopClient(folder)));
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

test("Importación OAuth rechaza archivos inexistentes, JSON inválido y clientes que no sean de escritorio", (t) => {
  const folder = fixture(t);
  assert.throws(() => assertDriveClientFile(join(folder, "missing.json")), /No se encontró el JSON OAuth/);
  for (const contents of ["private-json-secret", JSON.stringify({ web: {
    client_id: "web.apps.googleusercontent.com", client_secret: "private-json-secret",
  } }), JSON.stringify({ installed: { client_id: "invalid", client_secret: "private-json-secret" } })]) {
    const source = join(folder, "invalid.json"), destination = join(folder, "private", "client.json");
    writeFileSync(source, contents);
    assert.throws(() => importDriveClientFile(source, destination), (error) => {
      assert.ok(!error.message.includes("private-json-secret"));
      return true;
    });
    assert.equal(existsSync(destination), false);
  }
});

test("Importación OAuth conserva bytes, fuente y clientes existentes; rutas relativas siguen el archivo de copias", async (t) => {
  const folder = fixture(t), source = desktopClient(folder);
  const destination = join(folder, "private", "client.json");
  importDriveClientFile(source, destination);
  assert.deepEqual(readFileSync(destination), readFileSync(source));
  assert.throws(() => importDriveClientFile(source, destination), /Ya existe un JSON OAuth/);
  assert.deepEqual(readFileSync(destination), readFileSync(source));
  const prompt = terminal({
    PUBLIC_URL: "http://127.0.0.1:8080",
    BACKUP_ENABLED: "si", BACKUP_CONFIG_FILE: join(folder, "copies.env"),
    DRIVE_CLIENT_FILE: "private/client.json", SMTP_ENABLED: "no",
  });
  await configureDeployment(root, defaults(root, "demo"), prompt);
  assert.ok(!prompt.calls.some((call) => call.key === "DRIVE_CLIENT_SOURCE"));
});

test("El asistente vuelve a pedir el archivo descargado cuando la primera ruta no existe", async (t) => {
  const folder = fixture(t), source = desktopClient(folder);
  const destination = join(folder, "private", "client.json");
  const prompt = terminal({
    PUBLIC_URL: "http://127.0.0.1:8080", SMTP_ENABLED: "no",
    BACKUP_ENABLED: "si", BACKUP_CONFIG_FILE: join(folder, "copies.env"),
    DRIVE_CLIENT_FILE: destination, DRIVE_CLIENT_SOURCE: source,
  });
  const ask = prompt.ask;
  let selections = 0;
  prompt.ask = async (...args) => {
    const value = await ask(...args);
    if (args[0].endsWith("(DRIVE_CLIENT_SOURCE)") && selections++ === 0)
      return join(folder, "missing.json");
    return value;
  };
  await configureDeployment(root, defaults(root, "demo"), prompt);
  assert.equal(selections, 2);
  assert.ok(prompt.messages.some((message) => message.includes("No se encontró el JSON OAuth")));
  assert.deepEqual(readFileSync(destination), readFileSync(source));
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
    DRIVE_CLIENT_FILE: join(folder, "private", "drive-client.json"),
    DRIVE_TOKEN_FILE: join(folder, "private", "drive-token.json"),
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
  assert.ok(interactive[0][1][0].endsWith("authorize-drive.js"));
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
