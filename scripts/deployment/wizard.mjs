import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { localPath, readConfig, secret, assertPrivateLocation } from "./config.mjs";
import { validTime } from "../backups/schedule.mjs";
import { assertDriveClientFile, importDriveClientFile } from "./drive-client.mjs";

export const productionDatabaseName = "fceadatasys";
export const validIdentifier = (value) => /^[a-z][a-z0-9_]{0,62}$/.test(value);
const reservedDatabases = new Set(["postgres", "template0", "template1"]);
export function databaseUrl({ host, port, username, password, database }) {
  if (
    !host ||
    /[\s/@?#]/.test(host) ||
    !/^\d+$/.test(port) ||
    +port < 1 ||
    +port > 65535 ||
    !validIdentifier(username) ||
    !validIdentifier(database)
  )
    throw Error("Configuración PostgreSQL inválida.");
  const hostname =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostname}:${port}/${database}`;
}
export function dataDefaults(root, profile, platform = process.platform) {
  if (profile !== "production")
    return {
      attachments: resolve(root, `server/.local/${profile}/attachments`),
      backups: resolve(root, `.local/backups/${profile}`),
      driveClient: resolve(root, `.local/backups/${profile}-drive-client.json`),
      driveToken: resolve(root, `.local/backups/${profile}-drive-token.json`),
    };
  const base =
    platform === "win32"
      ? resolve(process.env.ProgramData || "C:/ProgramData", "FCEA-Datasys")
      : "/var/lib/fceadatasys";
  return {
    attachments: join(base, "attachments"),
    backups: join(base, "backups"),
    driveClient: join(base, "private", "drive-client.json"),
    driveToken: join(base, "private", "drive-token.json"),
  };
}

/** Receives the terminal functions so the whole questionnaire can be tested without credentials or OS changes. */
export async function configureDeployment(
  root,
  input,
  { ask, log = console.log },
) {
  const config = { ...input },
    profile = config.PROFILE;
  config.BACKUP_DISABLE_SCHEDULE = "false";
  const paths = dataDefaults(root, profile);
  async function field(
    key,
    label,
    current,
    validate = (value) => Boolean(value.trim()),
    hidden = false,
  ) {
    for (;;) {
      const value = await ask(
        `${label} (${key})`,
        String(current ?? ""),
        hidden,
      );
      if (validate(value)) return value;
      log(`Valor inválido para ${key}. Volvé a ingresarlo.`);
    }
  }
  const number = (key, label, current, min, max) =>
    field(
      key,
      label,
      current,
      (value) => /^\d+$/.test(value) && +value >= min && +value <= max,
    );
  const yes = async (key, label, current) =>
    (
      await field(key, `${label}: si/no`, current ? "si" : "no", (value) =>
        /^(si|sí|no)$/i.test(value),
      )
    ).toLowerCase() !== "no";
  config.PUBLIC_URL = await field(
    "PUBLIC_URL",
    "Dirección pública sin barra final",
    config.PUBLIC_URL,
    (value) => {
      try {
        const url = new URL(value);
        return (
          url.origin === value &&
          !url.username &&
          !url.password &&
          !/CAMBIAR/.test(value) &&
          (profile === "production"
            ? url.protocol === "https:"
            : ["http:", "https:"].includes(url.protocol))
        );
      } catch {
        return false;
      }
    },
  );
  config.WEB_HOST = await field(
    "WEB_HOST",
    "Dirección de escucha de la web",
    config.WEB_HOST,
  );
  config.API_PORT = await number(
    "API_PORT",
    "Puerto privado de la API",
    config.API_PORT,
    1,
    65535,
  );
  config.PG_BIN_DIRECTORY = await field(
    "PG_BIN_DIRECTORY",
    "Carpeta de herramientas PostgreSQL; usar - para PATH",
    config.PG_BIN_DIRECTORY || "-",
    () => true,
  );
  if (config.PG_BIN_DIRECTORY === "-") config.PG_BIN_DIRECTORY = "";
  if (profile === "production") {
    const previous = new URL(config.DATABASE_URL),
      owner = new URL(config.MIGRATION_DATABASE_URL);
    const admin = config.PG_ADMIN_URL ? new URL(config.PG_ADMIN_URL) : null;
    const host = await field(
      "PG_HOST",
      "Host del PostgreSQL principal",
      previous.hostname,
      (value) => Boolean(value) && !/[\s/@?#]/.test(value),
    );
    const port = await number(
      "PG_PORT",
      "Puerto del PostgreSQL principal",
      previous.port || "5432",
      1,
      65535,
    );
    const username = await field(
      "PG_ADMIN_USER",
      "Usuario administrador de PostgreSQL",
      admin ? decodeURIComponent(admin.username) : "postgres",
      validIdentifier,
    );
    const password = await field(
      "PG_ADMIN_PASSWORD",
      "Contraseña de ese administrador",
      admin ? decodeURIComponent(admin.password) : "",
      (value) => Boolean(value),
      true,
    );
    const maintenance = await field(
      "PG_MAINTENANCE_DATABASE",
      "Base de mantenimiento para la conexión administrativa",
      admin?.pathname.slice(1) || "postgres",
      validIdentifier,
    );
    const oldName = previous.pathname.slice(1);
    const database = await field(
      "PG_DATABASE",
      "Nombre de la base de producción",
      oldName === "fceadatasys_production" ? productionDatabaseName : oldName,
      (value) =>
        validIdentifier(value) &&
        value !== maintenance &&
        !reservedDatabases.has(value) &&
        !/(?:^|_)(?:demo|test)(?:_|$)/.test(value),
    );
    if (oldName !== database)
      log(
        `Se usará ${database}. La base anterior ${oldName} no se renombra ni se elimina automáticamente.`,
      );
    const ownerName = await field(
      "PG_OWNER_USER",
      "Cuenta propietaria para migraciones",
      decodeURIComponent(owner.username),
      (value) => validIdentifier(value) && value !== username,
    );
    const ownerPassword = await field(
      "PG_OWNER_PASSWORD",
      "Contraseña del propietario; Enter conserva la guardada o generada",
      decodeURIComponent(owner.password) || secret(),
      (value) => Boolean(value),
      true,
    );
    const runtimeName = await field(
      "PG_APP_USER",
      "Cuenta limitada de la aplicación",
      decodeURIComponent(previous.username),
      (value) =>
        validIdentifier(value) && ![username, ownerName].includes(value),
    );
    const runtimePassword = await field(
      "PG_APP_PASSWORD",
      "Contraseña de aplicación; Enter conserva la guardada o generada",
      decodeURIComponent(previous.password) || secret(),
      (value) => Boolean(value),
      true,
    );
    config.PG_ADMIN_URL = databaseUrl({
      host,
      port,
      username,
      password,
      database: maintenance,
    });
    config.MIGRATION_DATABASE_URL = databaseUrl({
      host,
      port,
      username: ownerName,
      password: ownerPassword,
      database,
    });
    config.DATABASE_URL = databaseUrl({
      host,
      port,
      username: runtimeName,
      password: runtimePassword,
      database,
    });
    config.MANAGE_POSTGRES = "false";
    delete config.PG_DATA_DIRECTORY;
    log(
      "Los roles existentes se conservan: sus contraseñas deben coincidir con las ingresadas. La decisión sobre conservar/recrear la base se solicita antes de aplicar la preparación.",
    );
  }
  if (config.PUBLIC_URL.startsWith("https:")) {
    config.TLS_CERT_FILE = await field(
      "TLS_CERT_FILE",
      "Certificado PEM/fullchain",
      config.TLS_CERT_FILE,
    );
    config.TLS_KEY_FILE = await field(
      "TLS_KEY_FILE",
      "Clave privada PEM",
      config.TLS_KEY_FILE,
    );
  }
  config.JWT_SECRET = await field(
    "JWT_SECRET",
    "Secreto de sesión; Enter conserva el generado",
    config.JWT_SECRET || secret(),
    (value) => value.length >= 32 && !/CHANGE_ME|replace-with/.test(value),
    true,
  );
  config.ATTACHMENT_DIRECTORY = await field(
    "ATTACHMENT_DIRECTORY",
    "Carpeta privada persistente para PDF y adjuntos",
    config.ATTACHMENT_DIRECTORY === "server/.local/production/attachments"
      ? paths.attachments
      : config.ATTACHMENT_DIRECTORY || paths.attachments,
  );
  config.CLAMAV_COMMAND = await field(
    "CLAMAV_COMMAND",
    "Ejecutable clamscan",
    config.CLAMAV_COMMAND,
  );
  config.CLAMAV_DATABASE_DIR = await field(
    "CLAMAV_DATABASE_DIR",
    "Directorio de firmas ClamAV",
    config.CLAMAV_DATABASE_DIR,
  );
  config.CLAMAV_TIMEOUT_MS = await number(
    "CLAMAV_TIMEOUT_MS",
    "Tiempo máximo de análisis en milisegundos",
    config.CLAMAV_TIMEOUT_MS,
    1000,
    300000,
  );
  config.CLAMAV_MAX_SIGNATURE_AGE_DAYS = await number(
    "CLAMAV_MAX_SIGNATURE_AGE_DAYS",
    "Antigüedad máxima de firmas en días",
    config.CLAMAV_MAX_SIGNATURE_AGE_DAYS,
    1,
    30,
  );
  config.ATTACHMENT_CONCURRENCY = await number(
    "ATTACHMENT_CONCURRENCY",
    "Análisis simultáneos permitidos",
    config.ATTACHMENT_CONCURRENCY,
    1,
    8,
  );
  if (profile === "production") {
    config.BOOTSTRAP_ADMIN_NAME = await field(
      "BOOTSTRAP_ADMIN_NAME",
      "Nombre del Administrador inicial",
      config.BOOTSTRAP_ADMIN_NAME,
      (value) => Boolean(value.trim()) && value.length <= 100,
    );
    config.BOOTSTRAP_ADMIN_CI = await field(
      "BOOTSTRAP_ADMIN_CI",
      "CI del Administrador inicial",
      config.BOOTSTRAP_ADMIN_CI,
      (value) => /^\d{5,12}$/.test(value),
    );
    config.BOOTSTRAP_ADMIN_USERNAME = await field(
      "BOOTSTRAP_ADMIN_USERNAME",
      "Usuario del Administrador inicial",
      config.BOOTSTRAP_ADMIN_USERNAME,
      (value) => /^[A-Za-z0-9._-]{3,40}$/.test(value),
    );
    config.BOOTSTRAP_ADMIN_EMAIL = await field(
      "BOOTSTRAP_ADMIN_EMAIL",
      "Correo del Administrador inicial",
      config.BOOTSTRAP_ADMIN_EMAIL,
      (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    );
    config.BOOTSTRAP_ADMIN_PASSWORD = await field(
      "BOOTSTRAP_ADMIN_PASSWORD",
      "Contraseña del Administrador inicial; solo se aplica a una base nueva",
      config.BOOTSTRAP_ADMIN_PASSWORD,
      (value) =>
        value.length >= 8 &&
        value.length <= 128 &&
        /[A-Za-z]/.test(value) &&
        /\d/.test(value),
      true,
    );
  }
  const smtp = await yes(
    "SMTP_ENABLED",
    "Habilitar envío de correos de recuperación",
    Boolean(config.SMTP_HOST),
  );
  if (smtp) {
    config.SMTP_HOST = await field(
      "SMTP_HOST",
      "Servidor SMTP",
      config.SMTP_HOST,
    );
    config.SMTP_PORT = await number(
      "SMTP_PORT",
      "Puerto SMTP",
      config.SMTP_PORT,
      1,
      65535,
    );
    config.SMTP_SECURE = String(
      await yes(
        "SMTP_SECURE",
        "Usar TLS implícito: si para 465, no para STARTTLS",
        config.SMTP_PORT === "465" || config.SMTP_SECURE === "true",
      ),
    );
    config.SMTP_FROM = await field(
      "SMTP_FROM",
      "Correo remitente",
      config.SMTP_FROM,
      (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    );
    const authenticate = await yes(
      "SMTP_AUTH",
      "El SMTP requiere usuario y contraseña",
      Boolean(config.SMTP_USER),
    );
    config.SMTP_USER = authenticate
      ? await field("SMTP_USER", "Usuario SMTP", config.SMTP_USER)
      : "";
    config.SMTP_PASS = authenticate
      ? await field(
          "SMTP_PASS",
          "Contraseña SMTP",
          config.SMTP_PASS,
          (value) => Boolean(value),
          true,
        )
      : "";
  } else
    for (const key of ["SMTP_HOST", "SMTP_FROM", "SMTP_USER", "SMTP_PASS"])
      config[key] = "";
  config.BACKUP_ENABLED = String(
    await yes(
      "BACKUP_ENABLED",
      "Habilitar copias locales y en Google Drive",
      config.BACKUP_ENABLED
        ? config.BACKUP_ENABLED === "true"
        : profile === "production",
    ),
  );
  let backup;
  if (config.BACKUP_ENABLED === "true") {
    config.BACKUP_CONFIG_FILE = await field(
      "BACKUP_CONFIG_FILE",
      "Archivo privado de configuración de copias",
      config.BACKUP_CONFIG_FILE || `.local/backups/${profile}.env`,
    );
    const file = localPath(root, config.BACKUP_CONFIG_FILE);
    const previousBackup = existsSync(file) ? readConfig(file) : {};
    backup = Object.fromEntries(
      Object.entries(previousBackup).filter(([key]) =>
        [
          "BACKUP_DATABASE_URL",
          "BACKUP_DIRECTORY",
          "PG_DUMP_COMMAND",
          "PG_RESTORE_COMMAND",
          "BACKUP_TIMEOUT_MS",
          "DRIVE_CLIENT_FILE",
          "DRIVE_TOKEN_FILE",
          "DRIVE_FOLDER_ID",
          "DRIVE_FOLDER_NAME",
        ].includes(key),
      ),
    );
    backup.BACKUP_DIRECTORY = await field(
      "BACKUP_DIRECTORY",
      "Carpeta privada para copias de la base",
      backup.BACKUP_DIRECTORY || paths.backups,
    );
    const runtime = new URL(config.DATABASE_URL),
      reader = backup.BACKUP_DATABASE_URL
        ? new URL(backup.BACKUP_DATABASE_URL)
        : null;
    const readerName = await field(
      "BACKUP_DB_USER",
      "Usuario PostgreSQL de solo lectura para copias",
      reader ? decodeURIComponent(reader.username) : `fcea_${profile}_backup`,
      (value) =>
        validIdentifier(value) &&
        ![
          decodeURIComponent(runtime.username),
          decodeURIComponent(new URL(config.MIGRATION_DATABASE_URL).username),
          ...(config.PG_ADMIN_URL
            ? [decodeURIComponent(new URL(config.PG_ADMIN_URL).username)]
            : []),
        ].includes(value),
    );
    const readerPassword = await field(
      "BACKUP_DB_PASSWORD",
      "Contraseña de copias; Enter conserva la guardada o generada",
      reader ? decodeURIComponent(reader.password) : secret(),
      (value) => Boolean(value),
      true,
    );
    backup.BACKUP_DATABASE_URL = databaseUrl({
      host: runtime.hostname,
      port: runtime.port || "5432",
      username: readerName,
      password: readerPassword,
      database: runtime.pathname.slice(1),
    });
    const tool = (name) =>
      config.PG_BIN_DIRECTORY
        ? join(
            config.PG_BIN_DIRECTORY,
            name + (process.platform === "win32" ? ".exe" : ""),
          )
        : name;
    backup.PG_DUMP_COMMAND = await field(
      "PG_DUMP_COMMAND",
      "Ejecutable pg_dump",
      backup.PG_DUMP_COMMAND || tool("pg_dump"),
    );
    backup.PG_RESTORE_COMMAND = await field(
      "PG_RESTORE_COMMAND",
      "Ejecutable pg_restore",
      backup.PG_RESTORE_COMMAND || tool("pg_restore"),
    );
    log(
      "Google Drive requiere un JSON OAuth de aplicación de escritorio descargado de Google Cloud. No se genera automáticamente. Si aún no lo tenés, seguí docs/operacion/GOOGLE-DRIVE.md (proyecto, Drive API, consentimiento y cliente de escritorio). El asistente pedirá el archivo descargado y lo copiará al destino privado; Google solicitará después el consentimiento de la cuenta.",
    );
    for (;;) {
      backup.DRIVE_CLIENT_FILE = await field(
        "DRIVE_CLIENT_FILE",
        "Destino privado para el JSON OAuth de Google",
        backup.DRIVE_CLIENT_FILE || paths.driveClient,
      );
      const destination = assertPrivateLocation(
        root, resolve(dirname(file), backup.DRIVE_CLIENT_FILE),
      );
      try {
        assertDriveClientFile(destination);
        break;
      } catch (error) {
        log(error.message);
        if (existsSync(destination)) {
          log("El archivo existente se conserva. Elegí otro destino o la ruta de un JSON de escritorio válido.");
          continue;
        }
      }
      const source = await field(
        "DRIVE_CLIENT_SOURCE",
        "Ruta del JSON de escritorio ya descargado (admite comillas)",
        "",
        (value) => {
          try {
            assertDriveClientFile(localPath(root, value.replace(/^(["'])(.*)\1$/, "$2")));
            return true;
          } catch (error) {
            log(error.message);
            return false;
          }
        },
      );
      importDriveClientFile(
        localPath(root, source.replace(/^(["'])(.*)\1$/, "$2")), destination,
      );
      log("JSON OAuth de escritorio validado e importado al destino privado.");
      break;
    }
    backup.DRIVE_TOKEN_FILE = await field(
      "DRIVE_TOKEN_FILE",
      "Archivo privado para guardar la autorización de Google",
      backup.DRIVE_TOKEN_FILE || paths.driveToken,
    );
    backup.DRIVE_FOLDER_NAME = await field(
      "DRIVE_FOLDER_NAME",
      "Nombre de la carpeta que se creará en Drive",
      backup.DRIVE_FOLDER_NAME || `fceadatasys-${profile}`,
      (value) => Boolean(value.trim()) && value.length <= 200,
    );
    backup.DRIVE_FOLDER_ID = await field(
      "DRIVE_FOLDER_ID",
      "ID de carpeta ya autorizada; vacío crea una carpeta propia",
      backup.DRIVE_FOLDER_ID || "",
      (value) => /^[a-zA-Z0-9_-]*$/.test(value),
    );
    backup.BACKUP_TIMEOUT_MS = await number(
      "BACKUP_TIMEOUT_MS",
      "Tiempo máximo de cada etapa de copias en milisegundos",
      backup.BACKUP_TIMEOUT_MS || "1800000",
      1000,
      7200000,
    );
    config.BACKUP_CONFIGURE_DRIVE = String(
      await yes(
        "BACKUP_CONFIGURE_DRIVE",
        "Abrir el navegador para autorizar Google Drive durante la preparación",
        !existsSync(resolve(dirname(file), backup.DRIVE_TOKEN_FILE)) ||
          !backup.DRIVE_FOLDER_ID,
      ),
    );
    config.BACKUP_TEST_ON_SETUP = String(
      await yes(
        "BACKUP_TEST_ON_SETUP",
        "Realizar una primera copia para comprobar disco y Google Drive",
        true,
      ),
    );
    config.BACKUP_INSTALL_SCHEDULE = String(
      await yes(
        "BACKUP_INSTALL_SCHEDULE",
        "Crear o actualizar la tarea diaria del sistema operativo",
        config.BACKUP_INSTALL_SCHEDULE !== "false",
      ),
    );
    if (config.BACKUP_INSTALL_SCHEDULE === "true")
      config.BACKUP_TIME = await field(
        "BACKUP_TIME",
        "Hora diaria de las copias, hora local del servidor, HH:MM",
        config.BACKUP_TIME || "02:00",
        (value) => {
          try {
            validTime(value);
            return true;
          } catch {
            return false;
          }
        },
      );
    else
      config.BACKUP_DISABLE_SCHEDULE = String(
        await yes(
          "BACKUP_DISABLE_SCHEDULE",
          "Deshabilitar una tarea diaria previa de este perfil si existe",
          true,
        ),
      );
  } else {
    config.BACKUP_CONFIGURE_DRIVE = "false";
    config.BACKUP_TEST_ON_SETUP = "false";
    config.BACKUP_INSTALL_SCHEDULE = "false";
    config.BACKUP_DISABLE_SCHEDULE = String(
      await yes(
        "BACKUP_DISABLE_SCHEDULE",
        "Deshabilitar una tarea diaria previa de este perfil si existe",
        true,
      ),
    );
  }
  config.INSTALL_BACKUP_DIRECTORY = await field(
    "INSTALL_BACKUP_DIRECTORY",
    "Carpeta para la copia obligatoria antes de recrear una base existente",
    config.INSTALL_BACKUP_DIRECTORY ||
      backup?.BACKUP_DIRECTORY ||
      paths.backups,
  );
  return { config, backup };
}
