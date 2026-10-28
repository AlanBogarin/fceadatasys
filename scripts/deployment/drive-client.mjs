import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class DriveClientFileError extends Error {}

function readDesktopClient(file) {
  let contents;
  try {
    contents = readFileSync(file);
  } catch (error) {
    throw new DriveClientFileError(
      error.code === "ENOENT"
        ? `No se encontró el JSON OAuth de Google en ${file}. Indicá el archivo de aplicación de escritorio descargado de Google Cloud; la ruta de destino no lo crea.`
        : `No se pudo leer el JSON OAuth de Google en ${file}. Revisar la ruta y los permisos.`,
    );
  }
  let installed;
  try {
    installed = JSON.parse(contents.toString("utf8"))?.installed;
  } catch {
    throw new DriveClientFileError("El archivo OAuth no contiene JSON válido. Seleccioná el JSON original descargado de Google Cloud.");
  }
  if (
    !installed || typeof installed.client_id !== "string" ||
    !installed.client_id.endsWith(".apps.googleusercontent.com") ||
    typeof installed.client_secret !== "string" || !installed.client_secret
  )
    throw new DriveClientFileError("El JSON OAuth debe ser de una aplicación de escritorio de Google Cloud (objeto installed, client_id y client_secret). Un cliente web o una cuenta de servicio no sirven para este flujo.");
  return contents;
}

export function assertDriveClientFile(file) {
  readDesktopClient(file);
}

/** Import exactly the validated bytes; never replace an existing client. */
export function importDriveClientFile(source, destination) {
  const contents = readDesktopClient(source);
  try {
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    writeFileSync(destination, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    throw new DriveClientFileError(
      error.code === "EEXIST"
        ? "Ya existe un JSON OAuth en el destino. Se conserva; elegí otra ruta para importar un cliente diferente."
        : "No se pudo importar el JSON OAuth. Revisar la ruta privada y los permisos de escritura del destino.",
    );
  }
}
