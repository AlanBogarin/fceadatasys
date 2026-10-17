import { test } from "node:test";
import assert from "node:assert/strict";
import { jsPDF } from "jspdf";
import { commitWithAttachment, MAX_PDF_BYTES, preparePdf } from "./attachments";

test("Persistencia: también revierte el binario cuando el guardado asíncrono de metadatos se rechaza", async () => {
  const document = new jsPDF();
  document.text("Rollback de confirmación asíncrona", 15, 20);
  const file = new File([document.output("arraybuffer")], "Confirmacion.pdf");
  const attachment = await preparePdf(file);
  const operations: string[] = [];
  await assert.rejects(
    () =>
      commitWithAttachment(
        attachment,
        file,
        async () => {
          await Promise.resolve();
          throw Error("La sesión dejó de ser válida");
        },
        async (_identifier, content) => {
          operations.push(content ? "guardar" : "retirar");
        },
      ),
    /sesión/,
  );
  assert.deepEqual(operations, ["guardar", "retirar"]);
});

function pdfFile(name = "Investigación.pdf") {
  const document = new jsPDF();
  document.text("Documento de prueba de adjuntos FCEA", 20, 20);
  return new File([document.output("arraybuffer")], name, {
    type: "application/pdf",
  });
}

test("PDF: verifica contenido, sanea nombres y calcula la misma huella para copias idénticas", async () => {
  const file = pdfFile("../Investigación: prueba.pdf");
  const first = await preparePdf(file);
  const renamed = new File([await file.arrayBuffer()], "Otra copia.pdf", {
    type: "application/octet-stream",
  });
  const second = await preparePdf(renamed);
  assert.equal(first.sha256, second.sha256);
  assert.notEqual(first.id, second.id);
  assert.equal(first.size, file.size);
  assert.match(first.name, /\.pdf$/);
  assert.doesNotMatch(first.name, /[\\/:]/);
});

test("PDF: rechaza archivos vacíos, extensión falsa, contenido falso, truncamiento y exceso de tamaño", async () => {
  const real = pdfFile();
  for (const file of [
    new File([], "vacio.pdf"),
    new File([await real.arrayBuffer()], "archivo.exe"),
    new File(["Este no es un PDF"], "archivo.pdf", { type: "application/pdf" }),
    new File([await real.arrayBuffer()], "archivo.pdf", { type: "text/plain" }),
    new File(["%PDF-1.70\n%%EOF"], "cabecera.pdf"),
    new File(["%PDF-1.7\nDocumento sin final"], "incompleto.pdf"),
    new File([new Uint8Array(MAX_PDF_BYTES + 1)], "grande.pdf"),
  ]) {
    await assert.rejects(() => preparePdf(file), /PDF/);
  }
});

test("Persistencia: no guarda metadatos si falla el binario y retira el adjunto si falla la confirmación", async () => {
  const file = pdfFile();
  const attachment = await preparePdf(file);
  const operations: string[] = [];
  const write = async (identifier: string, content?: Blob) => {
    operations.push(`${identifier}:${content ? "guardar" : "retirar"}`);
  };
  await assert.rejects(
    () =>
      commitWithAttachment(
        attachment,
        file,
        () => {
          operations.push("confirmar");
          throw Error("Sesión vencida o almacenamiento lleno");
        },
        write,
      ),
    /Sesión vencida/,
  );
  assert.deepEqual(operations, [
    `${attachment.id}:guardar`,
    "confirmar",
    `${attachment.id}:retirar`,
  ]);
  let committed = false;
  await assert.rejects(
    () =>
      commitWithAttachment(
        attachment,
        file,
        () => {
          committed = true;
        },
        async () => {
          throw Error("Sin espacio");
        },
      ),
    /Sin espacio/,
  );
  assert.equal(committed, false);
  await assert.rejects(
    () =>
      commitWithAttachment(
        attachment,
        undefined,
        () => {
          committed = true;
        },
        write,
      ),
    /seleccionar/,
  );
  assert.equal(committed, false);
});

test("Persistencia: confirma una vez después del binario; un enlace no escribe archivos", async () => {
  const file = pdfFile();
  const attachment = await preparePdf(file);
  const operations: string[] = [];
  await commitWithAttachment(
    attachment,
    file,
    () => {
      operations.push("confirmar");
    },
    async () => {
      operations.push("guardar");
    },
  );
  assert.deepEqual(operations, ["guardar", "confirmar"]);
  operations.length = 0;
  await commitWithAttachment(
    undefined,
    undefined,
    () => {
      operations.push("confirmar");
    },
    async () => {
      operations.push("guardar");
    },
  );
  assert.deepEqual(operations, ["confirmar"]);
});
