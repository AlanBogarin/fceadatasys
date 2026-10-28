import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  readConfig,
  localPath,
  writeConfig,
  assertPrivateLocation,
} from "./config.mjs";
import { validTime } from "../backups/schedule.mjs";
import { assertDriveClientFile } from "./drive-client.mjs";

export function configuredBackups(root, config) {
  if (config.BACKUP_ENABLED !== "true") return undefined;
  const file = localPath(
    root,
    config.BACKUP_CONFIG_FILE || `.local/backups/${config.PROFILE}.env`,
  );
  assertPrivateLocation(root, file);
  if (!existsSync(file))
    throw Error(
      "Falta configuración de copias. Ejecutar el asistente de configuración o deshabilitarlas explícitamente.",
    );
  const backup = readConfig(file);
  for (const key of [
    "BACKUP_DATABASE_URL",
    "BACKUP_DIRECTORY",
    "PG_DUMP_COMMAND",
    "PG_RESTORE_COMMAND",
    "DRIVE_CLIENT_FILE",
    "DRIVE_TOKEN_FILE",
  ])
    if (!backup[key]?.trim())
      throw Error(`Falta configuración de copias: ${key}.`);
  if (
    backup.DRIVE_FOLDER_ID &&
    !/^[a-zA-Z0-9_-]+$/.test(backup.DRIVE_FOLDER_ID)
  )
    throw Error("Destino Google Drive inválido.");
  const target = new URL(config.DATABASE_URL),
    reader = new URL(backup.BACKUP_DATABASE_URL);
  if (reader.host !== target.host || reader.pathname !== target.pathname)
    throw Error(
      "La conexión de copias debe apuntar a la misma base del perfil.",
    );
  if (config.BACKUP_INSTALL_SCHEDULE === "true") validTime(config.BACKUP_TIME);
  const result = {
    ...backup,
    BACKUP_DIRECTORY: resolve(dirname(file), backup.BACKUP_DIRECTORY),
    DRIVE_CLIENT_FILE: resolve(dirname(file), backup.DRIVE_CLIENT_FILE),
    DRIVE_TOKEN_FILE: resolve(dirname(file), backup.DRIVE_TOKEN_FILE),
  };
  assertPrivateLocation(root, result.BACKUP_DIRECTORY);
  assertPrivateLocation(root, result.DRIVE_CLIENT_FILE);
  assertPrivateLocation(root, result.DRIVE_TOKEN_FILE);
  assertDriveClientFile(result.DRIVE_CLIENT_FILE);
  return result;
}
export async function prepareBackupTools(
  root,
  config,
  backup,
  { execute, interactiveExecute, nonInteractive, configFile, validateSettings },
) {
  if (!backup) return;
  for (const [key, argv] of [
    ["PG_DUMP_COMMAND", ["--version"]],
    ["PG_RESTORE_COMMAND", ["--version"]],
  ])
    await execute(backup[key], argv, {}, key);
  if (config.BACKUP_CONFIGURE_DRIVE === "true") {
    if (nonInteractive)
      throw Error(
        "La autorización inicial de Google Drive requiere una ejecución interactiva de configuración.",
      );
    await interactiveExecute(
      process.execPath,
      [
        resolve(root, "server/dist/scripts/authorize-drive.js"),
        "--config",
        localPath(
          root,
          config.BACKUP_CONFIG_FILE || `.local/backups/${config.PROFILE}.env`,
        ),
      ],
      "Autorización de Google Drive",
    );
    config.BACKUP_CONFIGURE_DRIVE = "false";
    writeConfig(configFile, config);
  }
  await validateSettings(
    localPath(
      root,
      config.BACKUP_CONFIG_FILE || `.local/backups/${config.PROFILE}.env`,
    ),
  );
}
export async function finishBackupSetup(
  root,
  config,
  backup,
  {
    execute,
    interactiveExecute,
    nonInteractive,
    configFile,
    log = console.log,
  },
) {
  if (config.BACKUP_DISABLE_SCHEDULE === "true") {
    await interactiveExecute(
      process.execPath,
      [
        "scripts/configure-backups.mjs",
        "--profile",
        config.PROFILE,
        "--config",
        configFile,
        "--disable",
        ...(nonInteractive ? ["--non-interactive"] : []),
      ],
      "Deshabilitar tarea previa de copias",
    );
    config.BACKUP_DISABLE_SCHEDULE = "false";
    writeConfig(configFile, config);
  }
  if (!backup) {
    log(
      config.BACKUP_ENABLED === "false"
        ? "Copias deshabilitadas por configuración."
        : "Se conserva la configuración previa de copias; este archivo no solicita prepararlas.",
    );
    return;
  }
  if (config.BACKUP_TEST_ON_SETUP === "true")
    await execute(
      process.execPath,
      [
        "scripts/backup.mjs",
        "--profile",
        config.PROFILE,
        "--config",
        configFile,
      ],
      {},
      "Primera copia local y en Google Drive",
      root,
    );
  else
    log(
      "Primera copia omitida por elección del instalador: la conexión real con Google Drive queda pendiente de comprobar.",
    );
  if (config.BACKUP_INSTALL_SCHEDULE === "true") {
    await interactiveExecute(
      process.execPath,
      [
        "scripts/configure-backups.mjs",
        "--profile",
        config.PROFILE,
        "--config",
        configFile,
        "--time",
        config.BACKUP_TIME,
        ...(nonInteractive ? ["--non-interactive"] : []),
      ],
      "Programación diaria de copias",
    );
    log(
      `Copias diarias configuradas a las ${config.BACKUP_TIME}, hora local del servidor.`,
    );
  } else
    log(
      "Programación diaria omitida por elección del instalador; la copia manual queda disponible.",
    );
}
