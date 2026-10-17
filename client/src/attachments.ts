import type { AttachmentFormat } from "./settings";
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_SUPPORTED_PDF_BYTES = 25 * 1024 * 1024;

export type PublicationAttachment = {
  id: string;
  name: string;
  size: number;
  mime: "application/pdf" | "text/plain";
  sha256: string;
};

export function validateAttachmentMetadata(attachment: PublicationAttachment) {
  // Paso 1: validar los metadatos que acompañan al documento local.
  if (
    !/^[\da-f-]{36}$/i.test(attachment.id) ||
    !/^[\da-f]{64}$/i.test(attachment.sha256) ||
    !(
      (attachment.mime === "application/pdf" &&
        /\.pdf$/i.test(attachment.name)) ||
      (attachment.mime === "text/plain" && /\.txt$/i.test(attachment.name))
    ) ||
    !Number.isInteger(attachment.size) ||
    attachment.size <= 0 ||
    attachment.size > MAX_SUPPORTED_PDF_BYTES ||
    !attachment.name ||
    attachment.name.length > 144 ||
    /[\\/:*?"<>|\p{Cc}\p{Cf}]/u.test(attachment.name) ||
    !/\.(pdf|txt)$/i.test(attachment.name)
  ) {
    throw Error(
      "El adjunto no es un PDF o TXT válido de hasta 25 MiB. Volvé a seleccionarlo.",
    );
  }
}

export async function preparePdf(
  file: File,
  maximumBytes = MAX_PDF_BYTES,
): Promise<PublicationAttachment> {
  return prepareAttachment(file, maximumBytes, ["pdf"]);
}

export function attachmentAccept(formats: AttachmentFormat[]) {
  return formats
    .map((format) =>
      format === "pdf" ? ".pdf,application/pdf" : ".txt,text/plain",
    )
    .join(",");
}

export async function prepareAttachment(
  file: File,
  maximumBytes = MAX_PDF_BYTES,
  allowedFormats: AttachmentFormat[] = ["pdf"],
): Promise<PublicationAttachment> {
  // Paso 1: comprobar tamaño y extensión antes de leer el archivo.
  if (
    !Number.isInteger(maximumBytes) ||
    maximumBytes < 1024 * 1024 ||
    maximumBytes > MAX_SUPPORTED_PDF_BYTES
  ) {
    throw Error("El límite de archivos configurado no es válido.");
  }
  const format = file.name.split(".").at(-1)?.toLowerCase() as AttachmentFormat;
  if (!allowedFormats.includes(format) || !["pdf", "txt"].includes(format))
    throw Error(
      `Formato no habilitado. Formatos admitidos: ${allowedFormats.join(", ").toUpperCase()}.`,
    );
  if (!file.size || file.size > maximumBytes) {
    throw Error(
      `Seleccioná un archivo ${allowedFormats.join(" o ").toUpperCase()} de hasta ${maximumBytes / 1024 / 1024} MiB.`,
    );
  }
  if (
    file.type &&
    ![
      format === "pdf" ? "application/pdf" : "text/plain",
      "application/octet-stream",
    ].includes(file.type)
  ) {
    throw Error(
      `El tipo declarado no coincide con el formato ${format.toUpperCase()} del archivo.`,
    );
  }

  // Paso 2: verificar la firma y el fin de PDF; el MIME declarado no es suficiente.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextDecoder().decode(bytes.subarray(0, 9));
  const tail = new TextDecoder().decode(
    bytes.subarray(Math.max(0, bytes.length - 1024)),
  );
  if (
    format === "pdf" &&
    (!/^%PDF-(1\.[0-7]|2\.0)\s/.test(header) || !/%%EOF\s*$/.test(tail))
  ) {
    throw Error("El contenido del archivo no corresponde a un PDF reconocido.");
  }
  if (format === "txt") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw Error("El TXT debe contener texto UTF-8 válido.");
    }
    if (
      !text.trim() ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)
    )
      throw Error(
        "El TXT no puede estar vacío ni contener controles binarios.",
      );
  }

  // Paso 3: sanear el nombre y calcular la huella para detectar duplicados.
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let baseName = file.name.replace(/\.(pdf|txt)$/i, "").normalize("NFKC");
  baseName = baseName
    .replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu, "_")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 140);
  if (!baseName || /^\.+$/.test(baseName)) baseName = "documento";
  const attachment: PublicationAttachment = {
    id: crypto.randomUUID(),
    name: `${baseName}.${format}`,
    size: file.size,
    mime: format === "pdf" ? "application/pdf" : "text/plain",
    sha256,
  };
  validateAttachmentMetadata(attachment);
  return attachment;
}

async function openAttachments(): Promise<IDBDatabase> {
  // El binario vive en IndexedDB, sin ocupar la cuota pequeña de localStorage.
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("fcea-datasys.attachments", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        Error("No se pudo abrir el almacenamiento de adjuntos del navegador."),
      );
    request.onblocked = () =>
      reject(
        Error(
          "Cerrá otras pestañas del sistema y volvé a intentar guardar el adjunto.",
        ),
      );
  });
}

async function writeAttachment(id: string, file?: Blob): Promise<void> {
  const database = await openAttachments();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("files", "readwrite");
      const store = transaction.objectStore("files");
      if (file) store.add(file, id);
      else store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(
          Error(
            "No se pudo guardar el PDF. Revisá el espacio disponible en el navegador.",
          ),
        );
      transaction.onerror = () => {
        /* El aborto de la transacción informa el error. */
      };
    });
  } finally {
    database.close();
  }
}

export async function commitWithAttachment(
  attachment: PublicationAttachment | undefined,
  file: File | undefined,
  commit: () => void | Promise<void>,
  write = writeAttachment,
): Promise<void> {
  // Paso 1: el registro ya fue validado; persistir primero el binario completo.
  if (attachment && !file) throw Error("Volvé a seleccionar el archivo PDF.");
  if (attachment && file) await write(attachment.id, file);
  try {
    // Paso 2: confirmar metadatos, relaciones y bitácora mediante el guardado habitual.
    await commit();
  } catch (error) {
    // Paso 3: ante rechazo por sesión, concurrencia o cuota, retirar el binario nuevo.
    if (attachment) {
      try {
        await write(attachment.id);
      } catch {
        /* Un huérfano no queda visible ni vinculado. */
      }
    }
    throw error;
  }
}

export async function readAttachment(
  attachment: PublicationAttachment,
): Promise<Uint8Array> {
  validateAttachmentMetadata(attachment);
  const database = await openAttachments();
  let file: Blob | undefined;
  try {
    file = await new Promise<Blob | undefined>((resolve, reject) => {
      const request = database
        .transaction("files", "readonly")
        .objectStore("files")
        .get(attachment.id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(Error("No se pudo recuperar el adjunto."));
    });
  } finally {
    database.close();
  }
  if (!file)
    throw Error(
      "El PDF no está en este navegador. Debe cargarse desde el equipo donde se registró.",
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (hash !== attachment.sha256 || bytes.byteLength !== attachment.size) {
    throw Error(
      "El adjunto no coincide con el archivo registrado. No se descargó.",
    );
  }
  return bytes;
}
