import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { redact, executionEnvironment } from "./config.mjs";

export function run(
  command,
  args,
  {
    cwd,
    env = {},
    config = {},
    label = command,
    quiet = false,
    timeout = 180000,
    signal,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: executionEnvironment(env),
      windowsHide: true,
      shell: false,
      signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-20000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill(), timeout);
    child.once("error", () => {
      clearTimeout(timer);
      reject(
        Error(`No se pudo ejecutar ${label}. Revisar instalación y rutas.`),
      );
    });
    // pg_ctl on Windows may leave inherited pipe handles in postgres after exiting.
    // Completion follows the command process, not those daemon-owned handles.
    child.once("exit", (code) => {
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      if (code !== 0) {
        if (!quiet && output) console.error(redact(output, config));
        reject(
          Error(
            `Falló ${label}. No se modificaron contraseñas ni se borraron datos existentes.`,
          ),
        );
      } else resolve(output);
    });
  });
}
export function npmCommand() {
  const cli = process.env.npm_execpath?.endsWith("npm-cli.js")
    ? process.env.npm_execpath
    : join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  if (existsSync(cli)) return { command: process.execPath, prefix: [cli] };
  if (process.platform !== "win32") return { command: "npm", prefix: [] };
  throw Error(
    "No se encontró npm. Instalar Node con npm o ejecutar mediante npm start.",
  );
}
export const pgTool = (config, name) =>
  config.PG_BIN_DIRECTORY
    ? join(
        config.PG_BIN_DIRECTORY,
        name + (process.platform === "win32" ? ".exe" : ""),
      )
    : name;
