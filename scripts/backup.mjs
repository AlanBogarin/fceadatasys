import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  apiEnvironment,
  readConfig,
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
  if (config.PROFILE !== values.profile) throw Error("El perfil no coincide.");
  const script = resolve(root, "server/dist/scripts/backup.js");
  if (!existsSync(script))
    throw Error("Compilá el servidor antes de ejecutar la copia.");
  const child = spawn(process.execPath, [script], {
    cwd: resolve(root, "server"),
    env: executionEnvironment(apiEnvironment(root, config)),
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  child.on("error", () => {
    console.error("No se pudo iniciar la copia.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} catch {
  console.error(
    "Revisá el perfil y su configuración privada. El servidor debe estar compilado.",
  );
  process.exitCode = 1;
}
