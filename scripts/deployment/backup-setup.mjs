import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  readConfig,
  localPath,
  writeConfig,
  assertPrivateLocation,
} from "./config.mjs";
import { validTime } from "../backups/schedule.mjs";

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
    "RCLONE_COMMAND",
    "RCLONE_CONFIG",
    "RCLONE_REMOTE",
  ])
    if (!backup[key]?.trim())
      throw Error(`Falta configuración de copias: ${key}.`);
  if (!/^[a-zA-Z0-9_-]+:[^\r\n]*$/.test(backup.RCLONE_REMOTE))
    throw Error("Destino rclone inválido.");
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
    RCLONE_CONFIG: resolve(dirname(file), backup.RCLONE_CONFIG),
  };
  assertPrivateLocation(root, result.BACKUP_DIRECTORY);
  assertPrivateLocation(root, result.RCLONE_CONFIG);
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
    ["RCLONE_COMMAND", ["version"]],
  ])
    await execute(backup[key], argv, {}, key);
  if (config.BACKUP_CONFIGURE_DRIVE === "true") {
    if (nonInteractive)
      throw Error(
        "La autorización inicial de Google Drive requiere una ejecución interactiva de configuración.",
      );
    mkdirSync(dirname(backup.RCLONE_CONFIG), { recursive: true, mode: 0o700 });
    await interactiveExecute(
      backup.RCLONE_COMMAND,
      ["config", "--config", backup.RCLONE_CONFIG],
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
