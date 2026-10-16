import test from 'node:test';
import assert from 'node:assert/strict';
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
  await assert.rejects(generateReport({ ...input, rows: [] }, 'pdf'), { code: 'REPORT_LIMIT_EXCEEDED' });
  await assert.rejects(generateReport({ ...input, rows: Array(501).fill(input.rows[0]) }, 'xlsx'), { code: 'REPORT_LIMIT_EXCEEDED' });
  assert.equal(institutionalDate('2026-10-16T02:59:59Z'), '15/10/2026');
  const text = 'x'.repeat(649) + '😀' + 'y'.repeat(700);
  assert.equal(textParts(text, 650).join(''), text);
  assert.ok(textParts(text, 650).every(part => !/[\uD800-\uDBFF]$/u.test(part)));
});
