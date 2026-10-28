import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { userInfo } from "node:os";
import { localPath } from "./config.mjs";
import { run } from "./processes.mjs";

function signatureDatabase(root, config) {
  const database = localPath(root, config.CLAMAV_DATABASE_DIR);
  let present = false;
  try {
    present = readdirSync(database, { withFileTypes: true }).some(
      (entry) => entry.isFile() && /\.(?:cvd|cld)$/i.test(entry.name),
    );
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(error.code))
      throw Error(
        `No se pudo leer CLAMAV_DATABASE_DIR: ${database}. Revisar la ruta y los permisos de lectura.`,
      );
  }
  return { database, present };
}

function quoted(value) {
  if (/["\r\n\0]/.test(value))
    throw Error("No se pudo configurar FreshClam: revisar las comillas y caracteres de las rutas.");
  return `"${value}"`;
}

async function updateSignatures(root, config, { execute, signal, log }) {
  const database = localPath(root, config.CLAMAV_DATABASE_DIR);
  const id = createHash("sha256").update(database).digest("hex").slice(0, 16);
  const state = join(root, ".local/deploy/clamav", id);
  const configuration = join(state, "freshclam.conf");
  const logfile = join(state, "freshclam.log");
  const name = process.platform === "win32" ? "freshclam.exe" : "freshclam";
  const command = /[\\/]/.test(config.CLAMAV_COMMAND)
    ? join(dirname(localPath(root, config.CLAMAV_COMMAND)), name)
    : name;
  const lines = [
    `DatabaseDirectory ${quoted(database)}`,
    "DatabaseMirror database.clamav.net",
    `UpdateLogFile ${quoted(logfile)}`,
    "LogTime yes",
    "ConnectTimeout 15",
    "ReceiveTimeout 120",
    "MaxAttempts 2",
    "TestDatabases yes",
    // Use the installer's account, including when invoked with sudo on Linux.
    ...(process.platform === "win32"
      ? []
      : [`DatabaseOwner ${quoted(userInfo().username)}`]),
  ];
  log("Descargando/actualizando firmas oficiales de ClamAV con FreshClam…");
  try {
    mkdirSync(database, { recursive: true });
    mkdirSync(state, { recursive: true });
    // UTF-8 without BOM: FreshClam rejects the Windows PowerShell UTF-8 BOM.
    writeFileSync(configuration, lines.join("\n") + "\n", { mode: 0o600 });
    await execute(command, ["--quiet", `--config-file=${configuration}`], {
      cwd: root,
      config,
      label: "FreshClam",
      quiet: true,
      timeout: 600000,
      signal,
    });
    if (!signatureDatabase(root, config).present) throw Error("Missing signatures");
  } catch {
    throw Error(
      `No se pudieron actualizar las firmas de ClamAV automáticamente. Revisar FreshClam junto a CLAMAV_COMMAND (o en PATH), Internet/DNS y permisos de escritura en CLAMAV_DATABASE_DIR. Registro: ${logfile}.`,
    );
  }
}

/** Runs before npm/build/PostgreSQL; first installation needs no manual script. */
export async function prepareClamAv(
  root,
  config,
  { execute = run, signal, log = console.log } = {},
) {
  try {
    await execute(config.CLAMAV_COMMAND, ["--version"], {
      cwd: root,
      config,
      label: "ClamAV",
      quiet: true,
      timeout: Number(config.CLAMAV_TIMEOUT_MS),
      signal,
    });
  } catch {
    throw Error(
      "No se pudo ejecutar ClamAV. Revisar la instalación, CLAMAV_COMMAND y los permisos de ejecución.",
    );
  }
  const { present } = signatureDatabase(root, config);
  if (!present) await updateSignatures(root, config, { execute, signal, log });
  return { updated: !present };
}

export async function verifyClamAv(
  root,
  config,
  { execute = run, createScanner, signal, log = console.log, prepared } = {},
) {
  prepared ??= await prepareClamAv(root, config, { execute, signal, log });
  const database = localPath(root, config.CLAMAV_DATABASE_DIR);
  const scannerFactory =
    createScanner ??
    (await import("../../server/dist/src/attachments/scanner.js"))
      .createClamScanner;
  const probe = async () => {
    try {
      return await scannerFactory({
        command: config.CLAMAV_COMMAND,
        database,
        timeoutMs: Number(config.CLAMAV_TIMEOUT_MS),
        maxSignatureAgeDays: Number(config.CLAMAV_MAX_SIGNATURE_AGE_DAYS),
      }).scan(Buffer.from("Comprobación operativa FCEA-Datasys."));
    } catch {
      // Keep internal scanner errors and secrets out of installer output.
      return undefined;
    }
  };
  let result = await probe();
  if (result?.clean === true) return;
  // A detection is never retried as an availability problem. An unavailable
  // scanner may have old/corrupt signatures: update once, then require CLEAN.
  if (result?.clean !== false && !prepared.updated && !signal?.aborted) {
    log("ClamAV no pudo analizar con las firmas actuales; intentando actualizarlas…");
    await updateSignatures(root, config, { execute, signal, log });
    result = await probe();
    if (result?.clean === true) return;
  }
  throw Error(
    `No se pudo aprobar el análisis de prueba de ClamAV. Revisar firmas vigentes (máximo ${config.CLAMAV_MAX_SIGNATURE_AGE_DAYS} días), permisos y CLAMAV_TIMEOUT_MS. La preparación fue cancelada.`,
  );
}
