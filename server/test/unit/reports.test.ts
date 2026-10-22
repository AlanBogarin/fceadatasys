import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { reportExample } from '../../scripts/report-example-data.js';
import { exportQuerySchema, reportQuerySchema, reportSnapshot } from '../../src/reports/data.js';
import { generateReport, institutionalDate, textParts } from '../../src/reports/documents.js';

test('reportes: valida rango real, campos estrictos, formatos y exportación sin paginación', () => {
  const snapshot = 'a'.repeat(64);
  assert.equal(reportQuerySchema.parse({ publicationId: reportExample().rows[0].id }).page, 1);
  for (const input of [{ from: '2026-02-30' }, { from: '2026-03-01', to: '2026-02-01' }, { admin: true }]) assert.equal(reportQuerySchema.safeParse(input).success, false);
  for (const input of [{ format: 'csv', snapshot }, { format: 'pdf' }, { format: 'xlsx', snapshot, page: 2 }, { format: 'pdf', snapshot, from: '2026-03-01', to: '2026-01-01' }]) assert.equal(exportQuerySchema.safeParse(input).success, false);
  assert.equal(exportQuerySchema.safeParse({ format: 'pdf', snapshot }).success, true);
});
test('reportes: snapshot ignora orden de filtros, detecta contenido y conserva orden de autores', () => {
  const input = reportExample();
  const before = reportSnapshot({ year: 2026, active: true }, input.rows);
  assert.equal(before, reportSnapshot({ active: true, year: 2026 }, input.rows));
  input.rows[0].authors.reverse();
  assert.notEqual(before, reportSnapshot({ year: 2026, active: true }, input.rows));
});
test('Excel: texto literal sin fórmulas, fechas tipadas, todos los textos y panes/filtros', async () => {
  const input = reportExample();
  input.rows[0].title = '=HYPERLINK("https://example.org","dato")';
  input.rows[0].abstract = 'Texto con acentos: Ñandutí. '.repeat(190);
  const bytes = await generateReport(input, 'xlsx');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  assert.deepEqual(book.worksheets.map(sheet => sheet.name), ['Resumen', 'Investigaciones', 'Textos']);
  const summary = book.getWorksheet('Resumen')!;
  assert.equal(summary.getCell('B1').value, 'Universidad Nacional de Concepción');
  assert.equal(summary.getCell('B2').value, 'Facultad de Ciencias Económicas y Administrativas');
  assert.equal(summary.getCell('B11').value, input.rows.length);
  assert.equal(summary.getCell('A6').value, 'FCEA / UNC · Reporte de publicaciones');
  assert.equal(summary.pageSetup.fitToWidth, 1);
  assert.equal(summary.pageSetup.fitToHeight, 1);
  const images = summary.getImages();
  assert.equal(images.length, 2, 'ambos logos deben persistir dentro del XLSX');
  for (const [index, filename] of ['logo-unc.png', 'logo-fcea.png'].entries()) {
    const image = book.getImage(Number(images[index].imageId));
    const original = readFileSync(new URL(`../../assets/branding/${filename}`, import.meta.url));
    assert.deepEqual(image.buffer, original);
    assert.equal(image.extension, 'png');
    assert.ok(images[index].range.tl.row < 3, 'los logos pertenecen al membrete, antes del título');
    const { tl, br } = images[index].range;
    assert.ok(br, 'anclaje de dos celdas compatible con lectores XLSX');
    const width = br.nativeColOff - tl.nativeColOff;
    let height = br.nativeRowOff - tl.nativeRowOff;
    for (let row = tl.nativeRow; row < br.nativeRow; row++) height += summary.getRow(row + 1).height * 12700;
    assert.ok(Math.abs(width / height - original.readUInt32BE(16) / original.readUInt32BE(20)) < 0.001, 'conserva la proporción original');
    assert.ok(Math.max(width, height) / 9525 <= 80.001, 'ambos logos caben en el mismo cuadro de 80 px');
  }
  const data = book.getWorksheet('Investigaciones')!;
  assert.equal(data.getCell('B2').value, input.rows[0].title);
  assert.equal(data.getCell('B2').type, ExcelJS.ValueType.String);
  assert.ok(data.getCell('J2').value instanceof Date);
  assert.equal(data.getCell('J2').numFmt, 'dd/mm/yyyy');
  assert.ok(data.autoFilter);
  assert.equal(data.views[0].state, 'frozen');
  const texts = book.getWorksheet('Textos')!;
  const reconstructed: string[] = [];
  texts.eachRow((row, i) => { if (i > 1 && row.getCell(1).value === input.rows[0].code && String(row.getCell(2).value).startsWith('Abstract')) reconstructed.push(String(row.getCell(3).value)); });
  assert.equal(reconstructed.join(''), input.rows[0].abstract);
  for (const sheet of book.worksheets) sheet.eachRow(row => row.eachCell(cell => assert.equal(cell.formula, undefined)));
});
test('PDF real: documento multipágina con fuente Unicode y texto largo; rechaza vacío y exceso', async () => {
  const input = reportExample();
  input.rows[0].abstract = 'Research in Concepción. '.repeat(200);
  const bytes = await generateReport(input, 'pdf');
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.includes(Buffer.from('/FontFile2')));
  assert.ok(bytes.length > 10000);
  const pdf = bytes.toString('latin1');
  for (const name of ['unc', 'fcea']) {
    const png = readFileSync(new URL(`../../assets/branding/logo-${name}.png`, import.meta.url));
    const size = new RegExp(`/Subtype /Image\\b[^>]*?/Width ${png.readUInt32BE(16)}\\s+/Height ${png.readUInt32BE(20)}`);
    assert.ok(size.test(pdf), `logo ${name} PNG embebido con su resolución actual`);
  }
  const pages = [...pdf.matchAll(/\/Type \/Page\b/g)];
  const resources = [...pdf.matchAll(/\/XObject\s*<<([^>]+)>>/g)];
  assert.ok(pages.length > input.rows.length + 1, 'incluye páginas de continuación por texto extenso');
  assert.equal(resources.length, pages.length);
  for (const [, objects] of resources) {
    assert.match(objects, /\/I1 \d+ 0 R/);
    assert.match(objects, /\/I2 \d+ 0 R/, 'todas las páginas incluyen ambos logos');
  }
  await assert.rejects(generateReport({ ...input, rows: [] }, 'pdf'), { code: 'REPORT_LIMIT_EXCEEDED' });
  await assert.rejects(generateReport({ ...input, rows: Array(501).fill(input.rows[0]) }, 'xlsx'), { code: 'REPORT_LIMIT_EXCEEDED' });
  assert.equal(institutionalDate('2026-10-16T02:59:59Z'), '15/10/2026');
  const text = 'x'.repeat(649) + '😀' + 'y'.repeat(700);
  assert.equal(textParts(text, 650).join(''), text);
  assert.ok(textParts(text, 650).every(part => !/[\uD800-\uDBFF]$/u.test(part)));
});
