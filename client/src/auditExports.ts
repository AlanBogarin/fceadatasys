import { roleLabel, type State, type Role } from "./model";
import { queryAudit, type AuditFilters } from "./audit";
import type { ReportFile } from "./publicationExports";
import { registrationDate } from "./publications";

export async function buildAuditReport(
  state: State,
  actorId: string,
  filters: AuditFilters,
  format: "pdf" | "xlsx",
): Promise<ReportFile> {
  // Paso 1: aplicar la misma autorización y selección de la pantalla.
  const records = queryAudit(state, actorId, filters);
  if (!records.length)
    throw Error("No hay eventos para exportar con estos filtros.");
  const generated = new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
  const role =
    filters.role === "SIN_IDENTIFICAR"
      ? "Sin identificar"
      : roleLabel[filters.role as Role] || "todos";
  const criteria = `Desde: ${filters.from || "sin inicio"}. Hasta: ${filters.to || "sin fin"}. Usuario: ${filters.actorId || "todos"}. Rol: ${role}. Módulo: ${filters.module || "todos"}. Operación: ${filters.operation || "todas"}. Resultado: ${filters.status || "todos"}. Búsqueda: ${filters.search || "ninguna"}.`;
  const filename = `FCEA-Auditoria-${registrationDate(new Date().toISOString())}`;
  const rows = records.map((record) => [
    record.id,
    record.createdAt,
    record.actorName,
    record.actorId ?? "No registrado",
    record.actorRole ?? "No identificado",
    record.operation,
    record.module,
    record.resourceId ?? "",
    record.resourceName,
    record.publicationId ?? "",
    record.status,
    record.detail,
    record.sessionId ?? "No registrado",
    record.ip ?? "No disponible en versión local",
    record.userAgent ?? "No registrado",
    record.origin,
    JSON.stringify(record.before),
    JSON.stringify(record.after),
  ]);
  const headers = [
    "ID",
    "Fecha UTC",
    "Usuario",
    "ID usuario",
    "Rol",
    "Operación",
    "Módulo",
    "ID recurso",
    "Recurso",
    "ID publicación",
    "Resultado",
    "Detalle",
    "ID sesión",
    "IP",
    "Navegador",
    "Origen",
    "Valores anteriores",
    "Valores nuevos",
  ];
  // Paso 2: las celdas contienen texto, nunca fórmulas introducidas por registros.
  if (format === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "FCEA-Datasys";
    const cover = workbook.addWorksheet("Criterios");
    cover.columns = [{ width: 25 }, { width: 110 }];
    cover.addRows([
      ["FCEA · UNC", "Auditoría del repositorio"],
      ["Generado (Paraguay)", generated],
      ["Filtros", criteria],
      ["Registros", records.length],
      [
        "Alcance",
        "Eventos locales. Datos desconocidos de versiones anteriores se indican sin inventar sesiones ni IP.",
      ],
    ]);
    cover.eachRow((row) => {
      row.alignment = { wrapText: true, vertical: "top" };
    });
    cover.getRow(3).height = 65;
    const sheet = workbook.addWorksheet("Auditoría");
    sheet.addRow(headers);
    sheet.addRows(rows);
    sheet.columns.forEach((column) => {
      column.width = 32;
    });
    sheet.eachRow((row, index) => {
      row.alignment = { wrapText: true, vertical: "top" };
      if (index === 1) {
        row.font = { bold: true, color: { argb: "FFFFFFFF" } };
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF590D31" },
        };
      }
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = "A1:R1";
    return {
      bytes: new Uint8Array(await workbook.xlsx.writeBuffer()),
      filename: `${filename}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  // Paso 3: generar PDF A4 con membrete en cada página y contenido paginado.
  const [{ jsPDF }, { FCEA_REPORT_LOGO, UNC_REPORT_LOGO }] = await Promise.all([
    import("jspdf"),
    import("./reportBrand"),
  ]);
  const document = new jsPDF();
  let cursor = 53;
  function header() {
    document.addImage(FCEA_REPORT_LOGO, "PNG", 16, 8, 20, 20, "fcea", "FAST");
    document.addImage(UNC_REPORT_LOGO, "PNG", 174, 8, 20, 20, "unc", "FAST");
    document.setTextColor(60, 12, 32);
    document.setFont("helvetica", "bold");
    document.setFontSize(11);
    document.text("Universidad Nacional de Concepción", 105, 15, {
      align: "center",
    });
    document.setFontSize(9);
    document.text(
      "Facultad de Ciencias Económicas y Administrativas",
      105,
      21,
      { align: "center" },
    );
    document.setFontSize(13);
    document.text("Auditoría del repositorio", 105, 35, { align: "center" });
    document.setFont("helvetica", "normal");
    document.setFontSize(8);
    document.text(
      `Generado: ${generated} · ${records.length} evento(s)`,
      18,
      44,
    );
    document.setTextColor(30, 45, 50);
  }
  function text(value: string, bold = false) {
    document.setFont("helvetica", bold ? "bold" : "normal");
    document.setFontSize(9);
    const lines = document.splitTextToSize(value, 174) as string[];
    for (const line of lines) {
      if (cursor > 277) {
        document.addPage();
        header();
        cursor = 53;
        document.setFont("helvetica", bold ? "bold" : "normal");
        document.setFontSize(9);
      }
      document.text(line, 18, cursor);
      cursor += 4.5;
    }
    cursor += 2;
  }
  header();
  text(criteria);
  text("Demostración local. La IP no se obtiene desde servicios externos.");
  for (const [index, record] of records.entries()) {
    text(`${index + 1}. ${record.operation} · ${record.status}`, true);
    for (const [fieldIndex, value] of rows[index].entries())
      text(`${headers[fieldIndex]}: ${value}`);
    cursor += 4;
  }
  const pages = document.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    document.setPage(page);
    document.setFontSize(8);
    document.text(`FCEA-Datasys · ${page} / ${pages}`, 18, 289);
  }
  return {
    bytes: new Uint8Array(document.output("arraybuffer")),
    filename: `${filename}.pdf`,
    mime: "application/pdf",
  };
}
