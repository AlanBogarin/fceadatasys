import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { readConfig, assertPrivateLocation } from "./deployment/config.mjs";
import { localCopies, restoreDatabase } from "./backups/restore.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const help = `FCEA-Datasys — restaurar una copia de seguridad

  npm run restore -- --profile demo
  npm run restore -- --profile production --file "C:/copias/copia.dump"
  npm run restore -- --profile production --list

Opciones:
  --profile PERFIL  demo o production (predeterminado: production)
  --file RUTA       Archivo local .dump; sin esta opción permite elegir una copia
  --sha256 HASH     Hash original si ya no está en la auditoría de la base actual
  --config RUTA     Configuración de despliegue alternativa
  --list            Mostrar copias locales sin modificar la base
  --help            Mostrar ayuda

Detené el sistema antes: npm run stop:demo o npm run stop:production.
La restauración pide confirmación, conserva la base anterior y su auditoría,
verifica los adjuntos existentes y mantiene las conexiones del perfil.
Si la copia está en Drive, descargala primero. Los PDF se recuperan aparte.
Producción solicita una cuenta administrativa PostgreSQL si falta PG_ADMIN_URL.
No hay modo automático que omita la confirmación.`;

async function question(label) {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await terminal.question(label + " ")).trim();
  } finally {
    terminal.close();
  }
}
async function password(label) {
  process.stdout.write(label + " ");
  emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((done, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(wasRaw || false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else done(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === "c")
        return finish(Error("Restauración cancelada."));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace") value = value.slice(0, -1);
      else if (text && !key.ctrl && !/[\r\n\0]/.test(text)) value += text;
    };
    process.stdin.on("keypress", onKey);
  });
}

try {
  const { values } = parseArgs({
    options: {
      profile: { type: "string", default: "production" },
      config: { type: "string" },
      file: { type: "string" },
      sha256: { type: "string" },
      list: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) console.log(help);
  else {
    if (!["demo", "production"].includes(values.profile))
      throw Error("Perfil inválido: elegir demo o production.");
    const configFile = assertPrivateLocation(
      root,
      values.config || `.local/deploy/${values.profile}.env`,
    );
    const config = readConfig(configFile);
    if (config.PROFILE !== values.profile)
      throw Error("Perfil inválido: el archivo pertenece a otro entorno.");
    const copies =
      values.list || !values.file ? await localCopies(root, config) : [];
    if (values.list || !values.file) {
      copies.forEach((copy, index) =>
        console.log(
          `${index + 1}. ${copy.modified.toISOString()} — ${(copy.size / 1048576).toFixed(2)} MiB\n   ${copy.path}`,
        ),
      );
      if (!copies.length)
        console.log(
          "No se encontraron copias locales. Usá --file con la ruta del respaldo descargado.",
        );
    }
    if (!values.list) {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw Error(
          "La restauración requiere una terminal interactiva. Usá --help para ver las opciones.",
        );
      let file = values.file;
      if (!file) {
        if (!copies.length) throw Error("Elegí un respaldo con --file RUTA.");
        const choice = await question(
          "Número de la copia a restaurar (vacío cancela):",
        );
        if (!/^\d+$/.test(choice) || !copies[Number(choice) - 1])
          throw Error("Restauración cancelada.");
        file = copies[Number(choice) - 1].path;
      }
      if (config.PROFILE === "production" && !config.PG_ADMIN_URL) {
        const admin = new URL(config.MIGRATION_DATABASE_URL);
        admin.pathname = "/postgres";
        admin.username =
          (await question("Usuario administrador PostgreSQL [postgres]:")) ||
          "postgres";
        admin.password = await password("Contraseña PostgreSQL (oculta):");
        config.PG_ADMIN_URL = admin.href;
      }
      await restoreDatabase(root, config, {
        file,
        expectedSha256: values.sha256,
        confirm: ({ database }) =>
          question(
            `Escribí RESTAURAR ${database} para activar esta copia (vacío cancela):`,
          ),
      });
    }
  }
} catch (error) {
  // Driver/tool messages can contain database content; only print our own actionable errors.
  const message = String(error.message || "");
  const safe =
    /^(Perfil inválido|La restauración |La copia |La base |La conexión |El archivo |El SHA-256 |El SHA|La identidad |Hay |Detené |No se encontró |No se pudo ejecutar |Falló |Nombre PostgreSQL |SHA-256 inválido|Restauración cancelada|Elegí |Faltan adjuntos|Bloqueo de ejecución)/.test(
      message,
    );
  console.error(
    safe
      ? message
      : "No se pudo completar la restauración. Revisá el perfil, archivo, adjuntos, herramientas y permisos administrativos de PostgreSQL. Consultá el registro privado en .local/backups/restores.",
  );
  process.exitCode = 1;
}
