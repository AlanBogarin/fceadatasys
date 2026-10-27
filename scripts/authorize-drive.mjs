import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import {
  readConfig,
  localPath,
  executionEnvironment,
} from "./deployment/config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const { values } = parseArgs({
    options: {
      profile: { type: "string", default: "production" },
      config: { type: "string" },
    },
  });
  if (!["demo", "production"].includes(values.profile))
    throw Error("Perfil inválido.");
  const config = readConfig(
    resolve(root, values.config ?? `.local/deploy/${values.profile}.env`),
  );
  if (config.PROFILE !== values.profile || config.BACKUP_ENABLED !== "true")
    throw Error("Revisá el perfil y habilitá las copias.");
  const script = resolve(root, "server/dist/scripts/authorize-drive.js");
  if (!existsSync(script)) throw Error("Compilá el servidor primero.");
  const child = spawn(
    process.execPath,
    [
      script,
      "--config",
      localPath(
        root,
        config.BACKUP_CONFIG_FILE || `.local/backups/${values.profile}.env`,
      ),
    ],
    {
      cwd: root,
      env: executionEnvironment(),
      stdio: "inherit",
      windowsHide: true,
      shell: false,
    },
  );
  child.on("error", () => {
    console.error("No se pudo iniciar la autorización de Drive.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch {
  console.error(
    "Revisá el perfil, la configuración privada de copias y la compilación del servidor.",
  );
  process.exitCode = 1;
}
