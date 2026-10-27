import { readFile, writeFile, chmod, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { backupSettings } from "../src/backups/engine.js";
import { authorizeDrive } from "../src/backups/drive-auth.js";
import { GoogleDrive } from "../src/backups/drive.js";

try {
  const { values } = parseArgs({ options: { config: { type: "string" } } });
  if (!values.config || !process.stdin.isTTY)
    throw Error(
      "Se requiere una terminal interactiva y --config ARCHIVO_PRIVADO.",
    );
  const file = resolve(values.config);
  const previous = await readFile(file, "utf8");
  const settings = await backupSettings(file, { requireAuthorization: false });
  await authorizeDrive(settings);
  const drive = new GoogleDrive(settings);
  const folder =
    settings.DRIVE_FOLDER_ID ||
    (await drive.createFolder(settings.DRIVE_FOLDER_NAME));
  const metadata = await drive.metadata(folder);
  if (
    metadata.id !== folder ||
    metadata.trashed ||
    metadata.mimeType !== "application/vnd.google-apps.folder" ||
    !metadata.capabilities?.canAddChildren
  )
    throw Error(
      "La carpeta no está disponible para este cliente OAuth. Dejá DRIVE_FOLDER_ID vacío para crear una carpeta propia.",
    );
  // The generated ID has a restricted alphabet, so it can be stored without quoting.
  const next =
    previous.replace(/^DRIVE_FOLDER_ID\s*=.*(?:\r?\n|$)/gm, "") +
    `\nDRIVE_FOLDER_ID=${folder}\n`;
  // Avoid overwriting a configuration changed by another installer while Google was open.
  if ((await readFile(file, "utf8")) !== previous)
    throw Error(
      "La configuración cambió durante la autorización. Volvé a ejecutarla.",
    );
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, next, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
    await chmod(file, 0o600);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
  console.log(
    `Google Drive autorizado. Carpeta: ${folder}. Ejecutá una primera copia para comprobarla.`,
  );
} catch {
  console.error(
    "No se pudo autorizar Drive. Revisá el JSON de aplicación de escritorio, consentimiento de Google, permisos de archivos y carpeta. La autorización requiere navegador en el equipo del instalador o un túnel hacia su puerto local.",
  );
  process.exitCode = 1;
}
