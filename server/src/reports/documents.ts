import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { AppError } from '../errors.js';
import { MAX_REPORT_CHARACTERS, MAX_REPORT_RECORDS, type ReportFilters, type ReportRecord } from './data.js';

export const MAX_REPORT_BYTES = 20 * 1024 * 1024;
export interface ReportDocument { rows: ReportRecord[]; filters: ReportFilters; generatedAt: Date; generatedBy: string; example?: boolean }
export type ReportGenerator = (input: ReportDocument, format: 'pdf' | 'xlsx') => Promise<Buffer>;
const burgundy = '590D31', gold = 'C99C50', ink = '292633', muted = '665F69', pale = 'F5F0F3';
export const institutionalDate = (value: string | Date) => new Intl.DateTimeFormat('es-PY', { timeZone: 'America/Asuncion', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
const names = (people: { name: string }[]) => people.map(person => person.name).join('; ');
export function filterLabels(filters: ReportFilters, rows: ReportRecord[]) {
  const labels: [string, string][] = [];
  const text: Partial<Record<keyof ReportFilters, string>> = { from: 'Registro desde', to: 'Registro hasta', search: 'Búsqueda', code: 'Código', year: 'Año de publicación', source: 'Origen', active: 'Estado', publicationId: 'Publicación', careerId: 'Carrera', levelId: 'Nivel académico', typeId: 'Tipo', branchId: 'Filial', authorId: 'Autor', tutorId: 'Tutor', author: 'Nombre de autor', tutor: 'Nombre de tutor' };
  const references = { careerId: rows.map(row => row.career), levelId: rows.map(row => row.level), typeId: rows.map(row => row.type), branchId: rows.map(row => row.branch), authorId: rows.flatMap(row => row.authors), tutorId: rows.flatMap(row => row.tutors) };
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    const k = key as keyof ReportFilters;
    let display = String(value);
    if (k in references) display = references[k as keyof typeof references].find(row => row.id === value)?.name ?? display;
    else if (k === 'publicationId') display = rows.find(row => row.id === value)?.code ?? display;
    else if (k === 'active') display = value ? 'Activas' : 'Inactivas';
    else if (k === 'source') display = value === 'LOCAL' ? 'Local' : 'Externa';
    else if (k === 'from' || k === 'to') display = institutionalDate(`${value}T12:00:00Z`);
    labels.push([text[k] ?? k, display]);
  }
  return labels.length ? labels : [['Alcance', 'Todas las publicaciones, activas e inactivas']] as [string, string][];
}
const documentName = (row: ReportRecord) => row.source === 'EXTERNA' ? row.externalUrl : row.attachment?.name ?? (row.hasAttachment ? 'Adjunto no disponible' : 'Sin adjunto');
export const generateReport: ReportGenerator = async (input, format) => {
  if (!input.rows.length) throw new AppError(400, 'REPORT_LIMIT_EXCEEDED', 'No hay registros para generar un archivo.');
  if (input.rows.length > MAX_REPORT_RECORDS || JSON.stringify(input.rows).length > MAX_REPORT_CHARACTERS) throw new AppError(400, 'REPORT_LIMIT_EXCEEDED', 'Reducí los filtros del reporte.');
  return format === 'pdf' ? pdfReport(input) : excelReport(input);
};

async function pdfReport(input: ReportDocument): Promise<Buffer> {
  const relative = '../../assets/fonts/DejaVuSans.ttf';
  const sourceFont = new URL(relative, import.meta.url);
  const font = fileURLToPath(existsSync(sourceFont) ? sourceFont : new URL('../../../assets/fonts/DejaVuSans.ttf', import.meta.url));
  const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margins: { left: 46, right: 46, top: 94, bottom: 60 }, bufferPages: true, info: { Title: 'Reporte de publicaciones · FCEA UNC', Author: 'FCEA · Universidad Nacional de Concepción', CreationDate: input.generatedAt } });
  const chunks: Buffer[] = [];
  let size = 0, pages = 0;
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_REPORT_BYTES) doc.destroy(new AppError(400, 'REPORT_LIMIT_EXCEEDED', 'El reporte supera 20 MiB. Reducí los filtros.')); else chunks.push(chunk); });
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  try {
    doc.font(font);
    doc.on('pageAdded', () => {
      if (++pages > 1000) throw new AppError(400, 'REPORT_LIMIT_EXCEEDED', 'El reporte supera 1000 páginas. Reducí los filtros.');
      doc.rect(0, 0, doc.page.width, 7).fill(`#${burgundy}`);
      doc.fontSize(15).fillColor(`#${burgundy}`).text('FCEA / UNC', 46, 28, { lineBreak: false });
      doc.fontSize(8).fillColor(`#${muted}`).text('Dirección de Investigación', 330, 31, { width: 220, align: 'right', lineBreak: false });
      doc.moveTo(46, 61).lineTo(549, 61).strokeColor(`#${gold}`).lineWidth(1).stroke();
      if (input.example) doc.fontSize(8).fillColor(`#${muted}`).text('EJEMPLO · DATOS FICTICIOS', 46, 71, { lineBreak: false });
      doc.x = 46; doc.y = 96;
    });
    const paragraph = (label: string, value: string, fontSize = 10) => {
      doc.fontSize(8);
      const needed = 18 + Math.min(90, doc.heightOfString(value, { width: 503 }));
      if (doc.y + needed > doc.page.height - 60) doc.addPage();
      doc.fillColor(`#${burgundy}`).text(label.toUpperCase(), { width: 503 });
      doc.moveDown(0.35).fontSize(fontSize).fillColor(`#${ink}`).text(value || '—', { width: 503, lineGap: 3 });
      doc.moveDown(0.8);
    };
    doc.addPage();
    doc.fontSize(28).fillColor(`#${burgundy}`).text('Reporte de\npublicaciones', { width: 503, lineGap: 3 });
    doc.moveDown(0.5).fontSize(11).fillColor(`#${muted}`).text('Catálogo bibliográfico institucional');
    doc.moveDown(1.8);
    paragraph('Resultados', `${input.rows.length} ${input.rows.length === 1 ? 'publicación' : 'publicaciones'}`, 20);
    paragraph('Emisión', `${institutionalDate(input.generatedAt)} · ${input.generatedBy}`);
    paragraph('Institución', 'Facultad de Ciencias Económicas y Administrativas\nUniversidad Nacional de Concepción');
    doc.moveDown(0.6);
    for (const [label, value] of filterLabels(input.filters, input.rows)) paragraph(label, value);
    for (const [index, row] of input.rows.entries()) {
      doc.addPage();
      doc.fontSize(9).fillColor(`#${muted}`).text(`${row.code}  ·  ${index + 1} de ${input.rows.length}  ·  ${row.active ? 'Activa' : 'Inactiva'}`);
      doc.moveDown(0.7).fontSize(19).fillColor(`#${burgundy}`).text(row.title, { width: 503, lineGap: 3 });
      doc.moveDown(0.9);
      paragraph('Autoría', names(row.authors));
      paragraph('Tutores / orientadores', names(row.tutors));
      paragraph('Clasificación', `${row.career.name} · ${row.level.name}\n${row.type.name} · ${row.branch.name} · ${row.year}`);
      paragraph('Registro', `${institutionalDate(row.createdAt)} · ${row.createdBy.name}`);
      paragraph('Palabras clave', row.keywords);
      paragraph('Resumen', row.summary);
      paragraph('Abstract', row.abstract);
      paragraph(row.source === 'EXTERNA' ? 'URL externa' : 'Documento local', documentName(row), 9);
    }
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(8).fillColor(`#${muted}`).text('FCEA · Catálogo de producciones académicas y científicas', 46, 807, { width: 440, lineBreak: false });
      doc.text(`${i + 1} / ${range.count}`, 490, 807, { width: 59, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  } catch (error) { doc.destroy(error as Error); }
  return complete;
}

async function excelReport(input: ReportDocument): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'FCEA · UNC'; book.created = input.generatedAt; book.modified = input.generatedAt;
  const summary = book.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
  summary.columns = [{ width: 25 }, { width: 34 }, { width: 22 }, { width: 18 }, { width: 17 }];
  summary.mergeCells('A1:E2'); summary.getCell('A1').value = 'FCEA / UNC · Reporte de publicaciones';
  summary.getCell('A1').font = { name: 'Calibri', size: 19, bold: true, color: { argb: 'FFFFFFFF' } };
  summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${burgundy}` } };
  summary.getCell('A1').alignment = { vertical: 'middle' }; summary.getRow(1).height = 25; summary.getRow(2).height = 25;
  summary.mergeCells('A4:E4'); summary.getCell('A4').value = input.example ? 'Ejemplo de diseño · Datos ficticios' : 'Facultad de Ciencias Económicas y Administrativas';
  const criteria: [string, string | number | Date][] = [['Publicaciones', input.rows.length], ['Fecha de emisión', excelDate(input.generatedAt)], ['Generado por', input.generatedBy], ...filterLabels(input.filters, input.rows)];
  for (const [i, [label, value]] of criteria.entries()) {
    const n = i + 6; summary.getCell(n, 1).value = label; summary.mergeCells(n, 2, n, 5); summary.getCell(n, 2).value = value;
    summary.getCell(n, 1).font = { bold: true, color: { argb: `FF${burgundy}` } }; summary.getCell(n, 2).alignment = { wrapText: true, vertical: 'middle' };
    summary.getRow(n).height = Math.max(25, Math.ceil(String(value).length / 100) * 16);
    if (value instanceof Date) summary.getCell(n, 2).numFmt = 'dd/mm/yyyy';
  }
  const noteRow = criteria.length + 8;
  summary.mergeCells(noteRow, 1, noteRow + 1, 5);
  summary.getCell(noteRow, 1).value = 'Investigaciones contiene los metadatos y permite ordenar y filtrar. Textos conserva el resumen y el abstract completos, identificados por código. Las fechas de registro corresponden a America/Asuncion.';
  summary.getCell(noteRow, 1).alignment = { wrapText: true, vertical: 'middle' };
  const data = book.addWorksheet('Investigaciones', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2, showGridLines: false }] });
  const headers = ['Código', 'Título', 'Autores', 'Tutores / orientadores', 'Carrera', 'Nivel académico', 'Tipo', 'Filial', 'Año', 'Fecha de registro', 'Registrado por', 'Palabras clave', 'Estado', 'Origen', 'Documento / URL'];
  const widths = [18, 62, 36, 36, 30, 23, 26, 24, 10, 21, 30, 42, 14, 14, 66];
  data.columns = headers.map((header, i) => ({ header, width: widths[i] }));
  for (const row of input.rows) {
    const added = data.addRow([row.code, row.title, names(row.authors), names(row.tutors), row.career.name, row.level.name, row.type.name, row.branch.name, row.year, excelDate(row.createdAt), row.createdBy.name, row.keywords, row.active ? 'Activa' : 'Inactiva', row.source === 'LOCAL' ? 'Local' : 'Externa', documentName(row)]);
    added.getCell(10).numFmt = 'dd/mm/yyyy';
    added.height = Math.min(409, Math.max(40, ...widths.map((width, i) => Math.ceil(String(added.getCell(i + 1).value ?? '').length / Math.max(8, width * 1.2 - 3)) * 16 + 14)));
  }
  const texts = book.addWorksheet('Textos', { views: [{ state: 'frozen', ySplit: 1, xSplit: 2, showGridLines: false }] });
  texts.columns = [{ header: 'Código', width: 18 }, { header: 'Sección', width: 19 }, { header: 'Texto completo', width: 110 }];
  for (const row of input.rows) for (const [label, value] of [['Resumen', row.summary], ['Abstract', row.abstract]]) {
    // Separate long text into bounded cells to avoid Excel's maximum row-height clipping.
    const parts = textParts(value, 650);
    for (const [index, part] of parts.entries()) {
      const added = texts.addRow([row.code, `${label}${parts.length > 1 ? ` (${index + 1}/${parts.length})` : ''}`, part]);
      added.height = Math.max(40, Math.ceil(part.length / 130) * 16 + 16);
    }
  }
  for (const sheet of [data, texts]) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: sheet.columnCount } };
    sheet.getRow(1).height = 32;
    sheet.eachRow((row, index) => row.eachCell(cell => {
      cell.font = { name: 'Calibri', size: 11, ...(index === 1 ? { bold: true, color: { argb: 'FFFFFFFF' } } : { color: { argb: `FF${ink}` } }) };
      cell.alignment = { wrapText: true, vertical: index === 1 || sheet === data ? 'middle' : 'top', horizontal: index === 1 ? 'center' : undefined };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${index === 1 ? burgundy : index % 2 ? pale : 'FFFFFF'}` } };
    }));
    sheet.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' };
  }
  const bytes = Buffer.from(await book.xlsx.writeBuffer());
  if (bytes.length > MAX_REPORT_BYTES) throw new AppError(400, 'REPORT_LIMIT_EXCEEDED', 'El reporte supera 20 MiB. Reducí los filtros.');
  return bytes;
}
function excelDate(value: string | Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Asuncion', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (name: string) => Number(parts.find(item => item.type === name)!.value);
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
}
export function textParts(value: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = value;
  while (rest.length > limit) {
    let end = rest.lastIndexOf(' ', limit);
    if (end < limit / 2) end = limit;
    if (/[\uD800-\uDBFF]/u.test(rest[end - 1])) end--;
    parts.push(rest.slice(0, end)); rest = rest.slice(end);
  }
  parts.push(rest);
  return parts;
}
