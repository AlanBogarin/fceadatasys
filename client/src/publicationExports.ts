import type { State } from "./model";
import {
  publicationReport,
  registrationDate,
  type Publication,
  type ReportFilters,
} from "./publications";

export type ReportFile = { bytes: Uint8Array; filename: string; mime: string };

function reportFields(publication: Publication): [string, string][] {
  return [
    ["Código", publication.code],
    ["Título", publication.title],
    [
      "Autores (orden de autoría)",
      publication.authors.map((entry) => entry.name).join("; "),
    ],
    [
      "Tutores / orientadores",
      publication.tutors.map((entry) => entry.name).join("; "),
    ],
    ["Carrera", publication.career.name],
    ["Nivel académico", publication.level.name],
    ["Tipo de publicación", publication.type.name],
    ["Sede / filial", publication.branch.name],
    ["Año de publicación", String(publication.year)],
    ["Fecha de registro (Paraguay)", registrationDate(publication.createdAt)],
    ["Registrado por", publication.createdBy.name],
    ["Palabras clave", publication.keywords],
    ["Resumen", publication.summary],
    ["Abstract", publication.abstract],
    [
      "Documento (enlace o archivo PDF)",
      publication.attachment?.name ?? publication.externalUrl,
    ],
  ];
}

export function describeFilters(state: State, filters: ReportFilters): string {
  const publications = state.publications ?? [];
  const career =
    publications.find((entry) => entry.career.id === filters.careerId)?.career
      .name ?? "Todas";
  const level =
    publications.find((entry) => entry.level.id === filters.levelId)?.level
      .name ?? "Todos";
  const record =
    publications.find((entry) => entry.id === filters.publicationId)?.code ??
    "Todas";
  return `Fecha de registro: ${filters.from || "Sin inicio"} a ${filters.to || "Sin fin"}. Carrera: ${career}. Nivel: ${level}. Investigación: ${record}.`;
}

export async function buildPublicationReport(
  state: State,
  actorId: string,
  filters: ReportFilters,
  format: "pdf" | "xlsx",
): Promise<ReportFile> {
  // Paso 1: validar permisos y filtros antes de cargar las librerías de exportación.
  const publications = publicationReport(state, actorId, filters);

  // Paso 2: no generar archivos si no hay transacciones que cumplan los filtros.
  if (!publications.length) {
    throw Error("No hay investigaciones para exportar con estos filtros.");
  }
  const generatedAt = new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
  const criteria = describeFilters(state, filters);
  const filename = `FCEA-Investigaciones-${registrationDate(new Date().toISOString())}`;

  // Paso 3: generar el reporte a partir de los mismos registros de la vista previa.
  if (format === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FCEA-Datasys";
    const cover = workbook.addWorksheet("Criterios");
    cover.columns = [{ width: 28 }, { width: 100 }];
    cover.addRows([
      ["FCEA · UNC", "Reporte de investigaciones registradas"],
      ["Generado (Paraguay)", generatedAt],
      ["Filtros", criteria],
      ["Cantidad de registros", publications.length],
      [
        "Alcance",
        "Publicaciones con enlace externo o PDF adjunto. Datos guardados en este navegador; el reporte identifica el adjunto, sin incluir su contenido.",
      ],
    ]);
    cover.getRow(3).height = 60;
    cover.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
    const sheet = workbook.addWorksheet("Investigaciones");
    sheet.addRow(reportFields(publications[0]).map(([label]) => label));
    for (const publication of publications) {
      // Las celdas reciben texto, nunca fórmulas procedentes de campos del usuario.
      sheet.addRow(reportFields(publication).map(([, value]) => value));
    }
    sheet.columns.forEach((column, index) => {
      column.width = index === 0 ? 16 : 35;
    });
    sheet.eachRow((row, rowNumber) => {
      row.alignment = { vertical: "top", wrapText: true };
      if (rowNumber === 1) {
        row.font = { color: { argb: "FFFFFFFF" }, bold: true };
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF590D31" },
        };
        row.height = 34;
      }
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = "A1:O1";
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      bytes: new Uint8Array(buffer),
      filename: `${filename}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  const [{ jsPDF }, { FCEA_REPORT_LOGO, UNC_REPORT_LOGO }] = await Promise.all([
    import("jspdf"),
    import("./reportBrand"),
  ]);
  const document = new jsPDF();
  let cursor = 66;
  function header() {
    document.addImage(
      FCEA_REPORT_LOGO,
      "PNG",
      16,
      8,
      22,
      22,
      "fcea-logo",
      "FAST",
    );
    document.addImage(
      UNC_REPORT_LOGO,
      "PNG",
      173,
      8,
      22,
      22,
      "unc-logo",
      "FAST",
    );
    document.setTextColor(89, 13, 49);
    document.setFont("helvetica", "bold");
    document.setFontSize(12);
    document.text("Universidad Nacional de Concepción", 105, 13, {
      align: "center",
    });
    document.setFontSize(9.5);
    document.text(
      "Facultad de Ciencias Económicas y Administrativas",
      105,
      20,
      { align: "center" },
    );
    document.setFont("helvetica", "normal");
    document.setFontSize(9);
    document.text(
      "Dirección de Investigación · Repositorio institucional",
      105,
      27,
      { align: "center" },
    );
    document.setDrawColor(89, 13, 49);
    document.line(16, 35, 194, 35);
    document.setFont("helvetica", "bold");
    document.setFontSize(14);
    document.text("Reporte de investigaciones registradas", 18, 45);
    document.setTextColor(35, 48, 55);
    document.setFont("helvetica", "normal");
    document.setFontSize(9);
    document.text(
      `Generado: ${generatedAt} · Total: ${publications.length}`,
      18,
      55,
    );
  }
  function textBlock(text: string, bold = false) {
    document.setFont("helvetica", bold ? "bold" : "normal");
    document.setFontSize(10);
    const lines: string[] = document.splitTextToSize(text, 174);
    for (const line of lines) {
      if (cursor > 274) {
        document.addPage();
        header();
        cursor = 66;
      }
      document.text(line, 18, cursor);
      cursor += 5;
    }
    cursor += 2;
  }
  header();
  textBlock(criteria);
  for (const [index, publication] of publications.entries()) {
    if (index > 0) {
      document.addPage();
      header();
      cursor = 66;
    }
    textBlock(`${publication.code} · ${publication.title}`, true);
    for (const [label, value] of reportFields(publication).slice(2)) {
      textBlock(`${label}: ${value}`);
    }
  }
  const pageCount = document.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    document.setPage(pageNumber);
    document.setFontSize(8);
    document.text(`FCEA-Datasys · ${pageNumber} / ${pageCount}`, 18, 288);
  }
  return {
    bytes: new Uint8Array(document.output("arraybuffer")),
    filename: `${filename}.pdf`,
    mime: "application/pdf",
  };
}

export function downloadReport(file: ReportFile): void {
  const buffer = new Uint8Array(file.bytes).buffer;
  const url = URL.createObjectURL(new Blob([buffer], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
