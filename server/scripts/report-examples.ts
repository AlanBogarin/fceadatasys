import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateReport } from '../src/reports/documents.js';
import { reportExample } from './report-example-data.js';
const directory = resolve(process.argv[2] ?? '.local/report-examples');
await mkdir(directory, { recursive: true });
const input = reportExample();
for (const format of ['pdf', 'xlsx'] as const) {
  const filename = join(directory, `reporte-publicaciones-ejemplo.${format}`);
  await writeFile(filename, await generateReport(input, format));
  console.log(filename);
}
