import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  cronEntry,
  mergeCrontab,
  scheduleName,
  validTime,
  removeCronTask,
  windowsPowerShellEnvironment,
} from "./backups/schedule.mjs";
import { readConfig } from "./deployment/config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const { values } = parseArgs({
    options: {
      profile: { type: "string", default: "production" },
      config: { type: "string" },
      time: { type: "string", default: "02:00" },
      "dry-run": { type: "boolean", default: false },
      "non-interactive": { type: "boolean", default: false },
      disable: { type: "boolean", default: false },
    },
  });
  validTime(values.time);
  const name = scheduleName(root, values.profile);
  const config = resolve(
    root,
    values.config ?? `.local/deploy/${values.profile}.env`,
  );
  const deployment = readConfig(config);
  if (deployment.PROFILE !== values.profile)
    throw Error("El perfil no coincide.");
  if (!["win32", "linux"].includes(process.platform))
    throw Error("SO no compatible.");
  if (values["dry-run"]) {
    console.log(
      `Tarea ${name}: ${values.disable ? "deshabilitar si existe" : `una vez al día a las ${values.time}`}, hora local del servidor (${Intl.DateTimeFormat().resolvedOptions().timeZone}). No se modificó el SO.`,
    );
  } else if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        ...(values["non-interactive"] ? ["-NonInteractive"] : []),
        "-File",
        resolve(root, "scripts/backups/install-windows.ps1"),
        "-Root",
        root,
        "-ConfigFile",
        config,
        "-Profile",
        values.profile,
        "-Time",
        values.time,
        "-NodeCommand",
        process.execPath,
        "-TaskName",
        name,
        ...(values.disable ? ["-Disable"] : []),
        ...(values["non-interactive"] ? ["-NonInteractive"] : []),
      ],
      {
        stdio: "inherit", windowsHide: true, shell: false,
        env: windowsPowerShellEnvironment(),
      },
    );
    if (result.error || result.status !== 0)
      throw Error(
        "No se pudo configurar la tarea de copias. Revisá el error anterior: credenciales de Windows o permisos del Programador de tareas.",
      );
  } else {
    const existing = spawnSync("crontab", ["-l"], { encoding: "utf8" });
    if (
      existing.error ||
      (existing.status !== 0 &&
        !(
          existing.status === 1 &&
          /no crontab|ningún crontab|aucune crontab/i.test(existing.stderr)
        ))
    )
      throw Error(
        "No se pudo consultar crontab. Instalá/activá cron y verificá permisos.",
      );
    const log = resolve(root, `.local/backups/${values.profile}.log`);
    mkdirSync(dirname(log), { recursive: true, mode: 0o700 });
    const entry = cronEntry({
      root,
      node: process.execPath,
      script: resolve(root, "scripts/backup.mjs"),
      config,
      profile: values.profile,
      time: values.time,
      log,
    });
    const installed = spawnSync("crontab", ["-"], {
      input: values.disable
        ? removeCronTask(existing.stdout, name)
        : mergeCrontab(existing.stdout, entry, name),
      encoding: "utf8",
    });
    if (installed.error || installed.status !== 0)
      throw Error("No se pudo escribir crontab.");
    console.log(
      values.disable
        ? `Tarea ${name} deshabilitada si existía.`
        : `Tarea ${name} creada o actualizada: ${values.time}, hora local del servidor.`,
    );
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "No se pudo configurar la tarea.",
  );
  process.exitCode = 1;
}
