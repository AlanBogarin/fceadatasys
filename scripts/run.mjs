#!/usr/bin/env node
import { configureDeployment } from "./deployment/wizard.mjs";
import {
  configuredBackups,
  prepareBackupTools,
  finishBackupSetup,
} from "./deployment/backup-setup.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import net from "node:net";
import {
  defaults,
  readConfig,
  writeConfig,
  validateConfig,
  apiEnvironment,
  redact,
  localPath,
  executionEnvironment,
  assertPrivateLocation,
} from "./deployment/config.mjs";
import { run, npmCommand, pgTool } from "./deployment/processes.mjs";
import {
  ensureManagedPostgres,
  prepareDatabase,
  verifyRuntime,
} from "./deployment/database.mjs";
import { createGateway } from "./deployment/gateway.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const help = `FCEA-Datasys — API real con datos demo o producción
  npm start                         Elegir perfil y preparar/iniciar
  npm run start:demo                Demo completa (PostgreSQL local aislado)
  npm run start:production          Configurar/preparar/iniciar producción HTTPS
  npm run configure -- --profile production
  node scripts/run.mjs --profile demo [opciones]

Opciones:
  --configure       Asistente completo; permite guardar o aplicar la preparación
  --setup-only      Preparar dependencias, base, compilación y datos; salir
  --start-only      Iniciar una instalación ya preparada; no migrar ni cargar datos
  --stop            Solicitar cierre ordenado del perfil en ejecución
  --non-interactive Usar archivo de configuración sin preguntas
  --config RUTA     Archivo .env explícito (por defecto .local/deploy/PERFIL.env)
  --skip-install    Usar dependencias ya instaladas
  --help            Mostrar esta ayuda

Requisitos: Node 24.11+ (<25), PostgreSQL 18 y ClamAV con firmas.
Producción requiere un servicio PostgreSQL y certificados TLS propios.
Ctrl+C cierra web/API y el clúster demo iniciado por este proceso.
Las bases existentes se conservan salvo recreación interactiva confirmada, con copia previa.
Las contraseñas de roles existentes se conservan.`;

async function ask(label, current = "", hidden = false) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw Error(
      "Completar el archivo de configuración y usar --non-interactive.",
    );
  if (!hidden) {
    const terminal = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      return (
        (
          await terminal.question(`${label}${current ? ` [${current}]` : ""}: `)
        ).trim() || current
      );
    } finally {
      terminal.close();
    }
  }
  process.stdout.write(
    `${label}${current ? " [Enter conserva el valor actual]" : ""}: `,
  );
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value || current);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === "c")
        return finish(Error("Configuración cancelada."));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") value = value.slice(0, -1);
      else if (text && !key.ctrl && !/[\r\n\0]/.test(text)) value += text;
    };
    process.stdin.on("keypress", onKey);
  });
}
async function configure(config, configFile) {
  const result = await configureDeployment(root, config, { ask });
  if (result.backup) {
    const file = assertPrivateLocation(root, result.config.BACKUP_CONFIG_FILE);
    if (file === configFile)
      throw Error(
        "El archivo privado de copias debe ser distinto de la configuración de despliegue.",
      );
    const base = dirname(file);
    for (const key of ["BACKUP_DIRECTORY", "DRIVE_CLIENT_FILE", "DRIVE_TOKEN_FILE"])
      result.backup[key] = assertPrivateLocation(
        root,
        resolve(base, result.backup[key]),
      );
    writeConfig(file, result.backup);
  }
  return result.config;
}
async function interactiveExecute(command, argv, label) {
  await new Promise((resolveCommand, reject) => {
    const child = spawn(command, argv, {
      cwd: root,
      env: executionEnvironment(),
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.once("error", () =>
      reject(
        Error(`No se pudo ejecutar ${label}. Revisar herramientas y permisos.`),
      ),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolveCommand()
        : reject(Error(`Falló ${label}. Revisar configuración y permisos.`)),
    );
  });
}
async function available(port, host) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(Error(`Puerto ${port} no disponible.`)));
    probe.listen(port, host, () => probe.close(resolve));
  });
}
async function main() {
  if (args.includes("--help")) {
    console.log(help);
    return;
  }
  const allowed = new Set([
    "--profile",
    "--configure",
    "--setup-only",
    "--start-only",
    "--stop",
    "--non-interactive",
    "--config",
    "--skip-install",
  ]);
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!allowed.has(key)) throw Error("Opción desconocida. Usar --help.");
    if (key === "--profile" || key === "--config") {
      if (!args[index + 1] || args[index + 1].startsWith("--"))
        throw Error(`Falta valor para ${key}.`);
      options[key] = args[++index];
    } else options[key] = true;
  }
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major !== 24 || minor < 11)
    throw Error("Se requiere Node 24.11 o superior de la rama 24.");
  if (options["--start-only"] && options["--setup-only"])
    throw Error("Elegir --start-only o --setup-only.");
  if (options["--configure"] && (options["--start-only"] || options["--stop"]))
    throw Error("--configure no se combina con --start-only ni --stop.");
  const profile =
    options["--profile"] || (await ask("Perfil: demo o production", "demo"));
  if (!["demo", "production"].includes(profile))
    throw Error("Perfil inválido: elegir demo o production.");
  const local = resolve(root, `.local/deploy/${profile}`);
  const lock = join(local, "run.lock"),
    stopFile = join(local, "stop.request");
  if (options["--stop"]) {
    if (!existsSync(lock)) {
      console.log("No hay un lanzador activo para este perfil.");
      return;
    }
    const previous = JSON.parse(readFileSync(lock, "utf8"));
    try {
      process.kill(previous.pid, 0);
    } catch {
      console.log("No hay un lanzador activo para este perfil.");
      return;
    }
    writeFileSync(stopFile, "stop", { mode: 0o600 });
    console.log("Cierre ordenado solicitado.");
    return;
  }
  const configFile = resolve(
    root,
    options["--config"] || `.local/deploy/${profile}.env`,
  );
  assertPrivateLocation(root, configFile);
  const existed = existsSync(configFile);
  if (options["--start-only"] && !existed)
    throw Error(
      "Falta configuración: ejecutar primero la preparación completa.",
    );
  let config = existed ? readConfig(configFile) : defaults(root, profile);
  if (config.PROFILE !== profile)
    throw Error("Perfil inválido: el archivo pertenece a otro entorno.");
  if (
    (!existed && profile === "production" && !options["--non-interactive"]) ||
    options["--configure"]
  ) {
    if (options["--non-interactive"])
      throw Error("--configure necesita una terminal interactiva.");
    config = await configure(config, configFile);
  }
  if (!existed || options["--configure"]) writeConfig(configFile, config);
  console.log(`Configuración: ${configFile}`);
  if (options["--configure"]) {
    const apply = options["--setup-only"]
      ? "si"
      : await ask(
          "¿Preparar ahora dependencias, base y copias? si/no (no deja la web iniciada)",
          "si",
        );
    if (!/^(si|sí)$/i.test(apply)) {
      console.log(
        "Configuración guardada; la base no se ha inspeccionado ni preparado. Ejecutar la preparación cuando corresponda.",
      );
      return;
    }
    options["--setup-only"] = true;
  }
  const target = validateConfig(root, config, profile);
  assertPrivateLocation(root, config.ATTACHMENT_DIRECTORY);
  const backup = options["--start-only"]
    ? undefined
    : configuredBackups(root, config);
  let gateway;
  try {
    gateway = createGateway(root, config);
  } catch {
    throw Error(
      "Revisar certificado/clave TLS: archivos PEM válidos y correspondientes.",
    );
  }
  mkdirSync(local, { recursive: true });
  if (existsSync(lock)) {
    let live = false;
    try {
      const previous = JSON.parse(readFileSync(lock, "utf8"));
      process.kill(previous.pid, 0);
      live = true;
    } catch (error) {
      if (error.code === "EPERM") live = true;
    }
    if (live)
      throw Error(
        "Ya existe un lanzador activo para este perfil. Detenerlo antes de continuar.",
      );
    unlinkSync(lock);
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid, profile }), {
    flag: "wx",
    mode: 0o600,
  });
  if (existsSync(stopFile)) unlinkSync(stopFile);
  let stopPostgres = async () => {},
    api,
    apiClosed,
    stopping = false;
  let signalStop;
  const stopped = new Promise((resolve) => {
    signalStop = resolve;
  });
  const abort = new AbortController();
  const interrupt = () => {
    stopping = true;
    abort.abort();
    signalStop();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const stopWatcher = setInterval(() => {
    if (existsSync(stopFile)) interrupt();
  }, 500);
  const execute = (command, argv, env, label, cwd = resolve(root, "server")) =>
    run(command, argv, {
      cwd,
      env,
      config,
      label,
      timeout: 600000,
      signal: abort.signal,
    });
  const npm = async (folder, argv, label) => {
    const cmd = npmCommand();
    await execute(
      cmd.command,
      [...cmd.prefix, ...argv],
      {
        NODE_ENV: "development",
        VITE_DATA_MODE: "api",
        VITE_API_BASE_URL: config.PUBLIC_URL + "/api/v1",
      },
      label,
      resolve(root, folder),
    );
  };
  try {
    if (!options["--setup-only"]) {
      await available(+config.API_PORT, "127.0.0.1");
      await available(
        +(
          target.publicUrl.port ||
          (target.publicUrl.protocol === "https:" ? 443 : 80)
        ),
        config.WEB_HOST,
      );
    }
    for (const folder of ["server", "client"]) {
      const marker = resolve(
        root,
        `.local/deploy/${folder}-dependencies.sha256`,
      );
      const fingerprint = createHash("sha256")
        .update(readFileSync(resolve(root, folder, "package-lock.json")))
        .update(process.versions.node)
        .digest("hex");
      const installed = existsSync(resolve(root, folder, "node_modules"));
      if (
        !installed ||
        (!options["--start-only"] &&
          !options["--skip-install"] &&
          (!existsSync(marker) || readFileSync(marker, "utf8") !== fingerprint))
      ) {
        if (options["--start-only"] || options["--skip-install"])
          throw Error("Faltan dependencias. Ejecutar la preparación completa.");
        console.log(`Instalando dependencias de ${folder}…`);
        await npm(folder, ["ci", "--include=dev"], `Dependencias ${folder}`);
        writeFileSync(marker, fingerprint);
      }
    }
    console.log("Comprobando PostgreSQL…");
    if (
      options["--start-only"] &&
      config.MANAGE_POSTGRES === "true" &&
      !existsSync(join(localPath(root, config.PG_DATA_DIRECTORY), "PG_VERSION"))
    )
      throw Error(
        "Falta configuración del clúster: ejecutar primero la preparación completa.",
      );
    stopPostgres = await ensureManagedPostgres(root, config);
    if (options["--start-only"] && !(await verifyRuntime(root, config)))
      throw Error(
        "Falta Administrador inicial: ejecutar primero la preparación completa.",
      );
    const environment = apiEnvironment(root, config);
    if (!options["--start-only"]) {
      console.log("Compilando servidor y cliente conectado…");
      await npm("server", ["run", "build"], "Compilación API");
      await npm("client", ["run", "build"], "Compilación cliente");
      console.log("Preparando base, migraciones y permisos…");
      const { backupSettings } =
        await import("../server/dist/src/backups/engine.js");
      const backupOptions = {
        execute,
        interactiveExecute,
        nonInteractive: Boolean(options["--non-interactive"]),
        configFile,
        validateSettings: backupSettings,
      };
      mkdirSync(target.storage, { recursive: true });
      // Validate actual server configuration before any account/data initialization.
      const { loadConfig } = await import("../server/dist/src/config.js");
      loadConfig(environment);
      console.log("Comprobando firmas y ejecutable ClamAV…");
      await execute(
        config.CLAMAV_COMMAND,
        [
          `--database=${localPath(root, config.CLAMAV_DATABASE_DIR)}`,
          "--version",
        ],
        {},
        "ClamAV",
      );
      const { createClamScanner } =
        await import("../server/dist/src/attachments/scanner.js");
      await createClamScanner(loadConfig(environment).attachments).scan(
        Buffer.from("Comprobación operativa FCEA-Datasys."),
      );
      if (profile === "production" && config.BOOTSTRAP_ADMIN_PASSWORD) {
        const { productionInput } =
          await import("../server/dist/src/initialization/profiles.js");
        productionInput(environment);
      }
      await prepareBackupTools(root, config, backup, backupOptions);
      const users = await prepareDatabase(root, config, target, execute, {
        backup,
        ...(!options["--non-interactive"] && profile === "production"
          ? {
              async chooseExisting(info) {
                console.log(
                  `Existe la base ${info.name} en ${info.host}:${info.port}; propietario ${info.owner}, conexiones activas ${info.connections}.`,
                );
                for (;;) {
                  const choice = await ask(
                    "¿Conservar o eliminar y recrear la base? conservar/eliminar/cancelar",
                    "conservar",
                  );
                  if (choice.toLowerCase() === "conservar") return "keep";
                  if (choice.toLowerCase() === "eliminar") {
                    validateConfig(root, config, profile, { initial: true });
                    const { productionInput } =
                      await import("../server/dist/src/initialization/profiles.js");
                    productionInput(environment);
                    return "recreate";
                  }
                  if (choice.toLowerCase() === "cancelar") return "cancel";
                }
              },
              async confirmReset(info) {
                console.log(
                  `Copia previa verificada: ${info.snapshot}. Recrear eliminará la base ${info.name} y todo su contenido, incluida auditoría, conservado en esa copia. Los adjuntos y otras bases no se eliminan.`,
                );
                return ask(`Para confirmar escribí ELIMINAR ${info.name}`, "");
              },
            }
          : {}),
      });
      if (profile === "demo" || users === 0) {
        validateConfig(root, config, profile, { initial: true });
        console.log(
          profile === "demo"
            ? "Cargando/reanudando datos UNC por la API real…"
            : "Inicializando Administrador de producción…",
        );
        await execute(
          process.execPath,
          ["dist/scripts/initialize-data.js", profile],
          environment,
          "Datos iniciales",
        );
        if (profile === "production") {
          config.BOOTSTRAP_ADMIN_PASSWORD = "";
          writeConfig(configFile, config);
          delete environment.BOOTSTRAP_ADMIN_PASSWORD;
        }
      } else
        console.log(
          "Producción existente: se conservan usuarios, datos y contraseñas.",
        );
      if (profile === "production" && config.BOOTSTRAP_ADMIN_PASSWORD) {
        config.BOOTSTRAP_ADMIN_PASSWORD = "";
        delete environment.BOOTSTRAP_ADMIN_PASSWORD;
        writeConfig(configFile, config);
      }
      if (config.PG_ADMIN_URL) {
        config.PG_ADMIN_URL = "";
        writeConfig(configFile, config);
      }
      await finishBackupSetup(root, config, backup, {
        execute,
        interactiveExecute,
        nonInteractive: Boolean(options["--non-interactive"]),
        configFile,
      });
    }
    if (options["--setup-only"]) {
      console.log(
        "Preparación terminada. Para iniciar: agregar --start-only al mismo comando.",
      );
      return;
    }
    if (
      !existsSync(resolve(root, "client/dist/index.html")) ||
      !existsSync(resolve(root, "server/dist/src/main.js"))
    )
      throw Error("Falta compilación. Ejecutar la preparación completa.");
    const cleanEnvironment = executionEnvironment(environment);
    for (const key of Object.keys(cleanEnvironment))
      if (
        /^(BOOTSTRAP_ADMIN_|DEMO_|PG_ADMIN_URL|MIGRATION_DATABASE_URL|PGPASSWORD)/.test(
          key,
        )
      )
        delete cleanEnvironment[key];
    api = spawn(process.execPath, ["dist/src/main.js"], {
      cwd: resolve(root, "server"),
      env: cleanEnvironment,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    apiClosed = new Promise((resolve) => {
      api.once("error", () => resolve(-1));
      api.once("exit", (code) => resolve(code ?? -1));
    });
    api.stdout.on("data", (chunk) =>
      process.stdout.write(redact(chunk, config)),
    );
    api.stderr.on("data", (chunk) =>
      process.stderr.write(redact(chunk, config)),
    );
    const ready = async () => {
      for (let attempt = 0; attempt < 120; attempt++) {
        if (stopping) return;
        try {
          const response = await fetch(
            `http://127.0.0.1:${config.API_PORT}/health/ready`,
            { signal: AbortSignal.timeout(1000) },
          );
          if (response.ok) return;
        } catch {
          /* Poll only until startup deadline. */
        }
        await delay(250);
      }
      throw Error("La API no alcanzó readiness. Revisar base y permisos.");
    };
    await Promise.race([
      ready(),
      apiClosed.then(() => {
        throw Error("La API terminó durante el arranque.");
      }),
    ]);
    if (stopping) return;
    await new Promise((resolve, reject) => {
      gateway.once("error", () =>
        reject(Error("No se pudo abrir el puerto web.")),
      );
      gateway.listen(
        +(
          target.publicUrl.port ||
          (target.publicUrl.protocol === "https:" ? 443 : 80)
        ),
        config.WEB_HOST,
        resolve,
      );
    });
    console.log(
      `\nSistema iniciado (${profile}): ${config.PUBLIC_URL}\nAPI privada en 127.0.0.1:${config.API_PORT}. Ctrl+C para detener.\n`,
    );
    const end = await Promise.race([
      stopped.then(() => "signal"),
      apiClosed.then(() => "api"),
    ]);
    if (end === "api" && !stopping)
      throw Error(
        "La API se detuvo; el lanzador cerrará el resto de servicios.",
      );
  } finally {
    stopping = true;
    if (gateway.listening) {
      gateway.close();
      gateway.closeAllConnections();
    }
    if (api && api.exitCode === null) {
      if (api.connected) api.send("shutdown");
      await Promise.race([apiClosed, delay(30000, undefined, { ref: false })]);
      if (api.exitCode === null) {
        api.kill();
        await apiClosed;
      }
    }
    try {
      await stopPostgres();
    } finally {
      clearInterval(stopWatcher);
      unlinkSync(lock);
      if (existsSync(stopFile)) unlinkSync(stopFile);
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", interrupt);
    }
    console.log("Servicios del lanzador cerrados. Datos conservados.");
  }
}
main().catch((error) => {
  console.error(
    error?.message &&
      /^(Falta configuración|Perfil inválido|PUBLIC_URL|Producción|Demo|MANAGE_|API_PORT|JWT_SECRET|La API|La base|La entrega|La contraseña o acceso del rol |La conexión de copias |La cuenta de copias |La configuración, adjuntos y copias |La autorización inicial de Google Drive |El |No |Revisar|Un |Runtime|Se requiere|Faltan|Falta compilación|Falló|Puerto |Ya existe|Configuración |Opción |Migraciones|Completar|Elegir|Certificado|Preparación cancelada|Confirmación incorrecta|Destino Google Drive|--configure )/.test(
        error.message,
      )
      ? error.message
      : "No se pudo completar el despliegue. Revisar configuración, permisos y servicios; no se imprimen secretos.",
  );
  process.exitCode = 1;
});
