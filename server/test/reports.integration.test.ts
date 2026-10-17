import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import ExcelJS from 'exceljs';
import type { InjectOptions } from 'fastify';
import { createApp } from './helpers/integration-app.js';
import { createPrisma } from '../src/db.js';
import { hashPassword } from '../src/security/crypto.js';
import { generateReport, MAX_REPORT_BYTES } from '../src/reports/documents.js';
import { reportExample } from '../scripts/report-example-data.js';
import type { AppConfig } from '../src/config.js';

const databaseUrl = process.env.REPORTS_TEST_DATABASE_URL;
test('reportes PostgreSQL: permisos, filtros, exportadores reales, concurrencia y auditoría', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  const ownerUrl = new URL(process.env.REPORTS_TEST_OWNER_URL ?? 'http://missing');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname === '/fceadatasys_reports_test');
  assert.equal(ownerUrl.host, url.host); assert.equal(ownerUrl.pathname, url.pathname);
  const owner = new Client({ connectionString: ownerUrl.href }); await owner.connect();
  const prisma = createPrisma(databaseUrl!);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const ciBase = randomInt(100000000000, 800000000000);
  const clock = new Date('2026-10-16T15:00:00Z');
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: databaseUrl!, jwtSecret: 'reports-test-secret-'.repeat(5), jwtIssuer: 'test', jwtAudience: 'test', allowedOrigins: ['http://localhost:5173'], secureCookies: false, recoveryUrl: 'http://localhost:5173/reset' };
  let hook: (() => Promise<void>) | undefined;
  let oversize = false;
  const app = await createApp(config, prisma, { logger: false, security: { now: () => new Date(clock) }, reports: { generate: async (input, format) => {
    const bytes = await generateReport(input, format);
    await hook?.();
    return oversize ? Buffer.alloc(MAX_REPORT_BYTES + 1) : bytes;
  } } });
  let sequence = 0;
  const send = (options: InjectOptions) => app.inject({ remoteAddress: `203.0.113.${++sequence % 250 + 1}`, ...options });
  const headers: Record<string, { authorization: string }> = {};
  const ids: Record<string, string> = {};
  const base = '/api/v1/reportes/publicaciones';
  const preview = (filters: Record<string, string> = {}, role = 'ADMINISTRADOR') => send({ url: `${base}?${new URLSearchParams(filters)}`, headers: headers[role] });
  const exportFile = (snapshot: string, format = 'pdf', filters: Record<string, string> = {}, role = 'ADMINISTRADOR') => send({ url: `${base}/exportar?${new URLSearchParams({ ...filters, snapshot, format })}`, headers: headers[role] });
  const problem = (response: { statusCode: number; body: string; json(): { code: string } }, status: number, code: string) => { assert.equal(response.statusCode, status, response.body); assert.equal(response.json().code, code); };
  try {
    const password = 'ReportsTest123!'; const passwordHash = await hashPassword(password);
    for (const [i, role] of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO'].entries()) {
      const username = `rpt.${suffix}.${i}`;
      const actor = await prisma.user.create({ data: { name: `Reportes ${i}`, ci: String(ciBase + i), email: `${username}@example.org`, emailKey: `${username}@example.org`, username, usernameKey: username, passwordHash, role: role as 'ADMINISTRADOR' | 'DIGITADOR' | 'PUBLICO' } }); ids[role] = actor.id;
      const login = await send({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.allowedOrigins[0] }, payload: { username, password } });
      assert.equal(login.statusCode, 200, login.body); headers[role] = { authorization: `Bearer ${login.json().accessToken}` };
    }
    const catalog = async (key: string) => {
      const result = await send({ method: 'POST', url: `/api/v1/catalogos/${key}`, headers: headers.ADMINISTRADOR, payload: { name: `${key} ${suffix}` } });
      assert.equal(result.statusCode, 201, result.body); return result.json().id as string;
    };
    const careerId = await catalog('carreras'), levelId = await catalog('niveles'), typeId = await catalog('tipos'), branchId = await catalog('filiales');
    const authorId = await catalog('autores'), tutorId = await catalog('tutores');
    const publicationIds: string[] = [];
    for (const [i, row] of reportExample().rows.entries()) {
      const result = await send({ method: 'POST', url: '/api/v1/publicaciones', headers: headers.DIGITADOR, payload: { title: `${row.title} ${suffix}`, summary: `${row.summary} ${suffix}`, abstract: `${row.abstract} ${suffix}`, keywords: row.keywords, year: i === 1 ? 2025 : 2026, approved: true, externalUrl: `https://example.org/${suffix}/${i}`, authorIds: [authorId], tutorIds: [tutorId], careerId, levelId, typeId, branchId } });
      assert.equal(result.statusCode, 201, result.body); publicationIds.push(result.json().id);
    }
    await owner.query('UPDATE publicaciones SET creado_en=$1 WHERE id=$2', ['2026-10-16T02:59:59Z', publicationIds[2]]);
    await owner.query('UPDATE publicaciones SET activo=false WHERE id=$1', [publicationIds[2]]);
    const scoped = { careerId };
    await t.test('solo Administrador; rechazos auditados y cache no-store', async () => {
      problem(await send({ url: base }), 401, 'UNAUTHENTICATED');
      for (const role of ['DIGITADOR', 'PUBLICO']) {
        problem(await preview({}, role), 403, 'FORBIDDEN');
        problem(await exportFile('a'.repeat(64), 'xlsx', scoped, role), 403, 'FORBIDDEN');
      }
      assert.ok(await prisma.auditLog.count({ where: { userId: ids.PUBLICO, status: 'FALLIDO' } }) >= 2);
      assert.equal((await preview(scoped)).headers['cache-control'], 'no-store');
    });
    await t.test('paginación y filtros combinados: fechas Asunción, nivel, carrera, tipo, publicación y estado', async () => {
      const response = await preview({ ...scoped, pageSize: '1' });
      assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().data.length, 1); assert.equal(response.json().pagination.total, 3);
      assert.equal(response.json().report.snapshot.length, 64);
      const filtered = await preview({ careerId, levelId, typeId, branchId, authorId, tutorId, from: '2026-10-16', to: '2026-10-16', year: '2025', active: 'true', publicationId: publicationIds[1] });
      assert.deepEqual(filtered.json().data.map((row: { id: string }) => row.id), [publicationIds[1]]);
      assert.deepEqual((await preview({ ...scoped, active: 'false' })).json().data.map((row: { id: string }) => row.id), [publicationIds[2]]);
      assert.equal(JSON.stringify(response.json()).includes('storageKey'), false);
    });
    await t.test('validación estricta, no CSV ni exportación paginada', async () => {
      const invalid: Record<string, string>[] = [{ from: '2026-02-30' }, { from: '2026-03-01', to: '2026-01-01' }, { invalid: 'x' }];
      for (const query of invalid) problem(await preview(query), 400, 'VALIDATION_ERROR');
      problem(await exportFile('a'.repeat(64), 'csv'), 400, 'VALIDATION_ERROR');
      problem(await exportFile('a'.repeat(64), 'pdf', { page: '2' }), 400, 'VALIDATION_ERROR');
    });
    await t.test('sin resultados: 200 vacío, sin archivo ni evento de exportación', async () => {
      const filter = { publicationId: randomUUID() };
      const before = await prisma.auditLog.count({ where: { operation: 'REPORTE_EXPORTADO' } });
      const result = await preview(filter); assert.equal(result.json().report.exportable, false); assert.equal(result.json().report.snapshot, null);
      const response = await exportFile('a'.repeat(64), 'pdf', filter);
      assert.equal(response.statusCode, 200, response.body); assert.deepEqual(response.json(), { data: [], total: 0 }); assert.equal(response.headers['content-disposition'], undefined);
      assert.equal(await prisma.auditLog.count({ where: { operation: 'REPORTE_EXPORTADO' } }), before);
    });
    await t.test('PDF/Excel reales incluyen todos los filtrados aunque la consulta muestre una página', async () => {
      const snapshot = (await preview({ ...scoped, pageSize: '1' })).json().report.snapshot;
      const pdf = await exportFile(snapshot, 'pdf', scoped); assert.equal(pdf.statusCode, 200, pdf.body); assert.equal(pdf.rawPayload.subarray(0, 5).toString(), '%PDF-'); assert.match(String(pdf.headers['content-disposition']), /\.pdf/);
      const excel = await exportFile(snapshot, 'xlsx', scoped); assert.equal(excel.statusCode, 200, excel.body);
      const book = new ExcelJS.Workbook(); await book.xlsx.load(excel.rawPayload as unknown as ExcelJS.Buffer);
      assert.equal(book.getWorksheet('Investigaciones')!.rowCount, 4);
      assert.equal(book.getWorksheet('Textos')!.rowCount, 7);
      const logs = await prisma.auditLog.findMany({ where: { userId: ids.ADMINISTRADOR, operation: 'REPORTE_EXPORTADO' } });
      assert.equal(logs.length, 2); assert.ok(logs.every(log => log.status === 'EXITO' && log.sessionId && log.ip && log.after));
    });
    await t.test('snapshot antiguo se rechaza tras cambiar metadatos', async () => {
      const snapshot = (await preview(scoped)).json().report.snapshot;
      await owner.query('UPDATE autores SET nombre_completo=$1 WHERE id=$2', [`Autor actualizado ${suffix}`, authorId]);
      problem(await exportFile(snapshot, 'pdf', scoped), 409, 'REPORT_VERSION_CONFLICT');
    });
    await t.test('fallo del generador libera el cupo; tamaño excesivo falla sin archivo', async () => {
      const snapshot = (await preview(scoped)).json().report.snapshot;
      hook = async () => { throw new Error('private diagnostic'); };
      const failure = await exportFile(snapshot, 'pdf', scoped); problem(failure, 503, 'REPORT_GENERATION_FAILED'); assert.equal(failure.body.includes('private diagnostic'), false); hook = undefined;
      oversize = true; problem(await exportFile(snapshot, 'pdf', scoped), 400, 'REPORT_LIMIT_EXCEEDED'); oversize = false;
      assert.equal((await exportFile(snapshot, 'pdf', scoped)).statusCode, 200);
    });
    await t.test('concurrencia acotada; rol revalidado al terminar el generador', async () => {
      const snapshot = (await preview(scoped)).json().report.snapshot;
      let entered!: () => void, finish!: () => void;
      const waiting = new Promise<void>(resolve => { entered = resolve; });
      const unblock = new Promise<void>(resolve => { finish = resolve; });
      hook = async () => { entered(); await unblock; };
      const running = exportFile(snapshot, 'pdf', scoped); await waiting;
      problem(await exportFile(snapshot, 'xlsx', scoped), 503, 'REPORT_SERVICE_BUSY');
      await owner.query("UPDATE usuarios SET rol='PUBLICO' WHERE id=$1", [ids.ADMINISTRADOR]); finish();
      problem(await running, 403, 'FORBIDDEN'); hook = undefined;
      await owner.query("UPDATE usuarios SET rol='ADMINISTRADOR' WHERE id=$1", [ids.ADMINISTRADOR]);
      assert.equal((await exportFile(snapshot, 'pdf', scoped)).statusCode, 200);
    });
    await t.test('si auditoría no puede insertarse, se cancela entrega', async () => {
      const snapshot = (await preview(scoped)).json().report.snapshot;
      const role = decodeURIComponent(url.username); assert.match(role, /^[a-zA-Z0-9_]+$/);
      await owner.query(`REVOKE INSERT ON auditoria FROM "${role}"`);
      try { const response = await exportFile(snapshot, 'xlsx', scoped); problem(response, 503, 'AUDIT_UNAVAILABLE'); assert.equal(response.headers['content-disposition'], undefined); }
      finally { await owner.query(`GRANT INSERT ON auditoria TO "${role}"`); }
    });
    await t.test('más de 500 resultados permite consultar pero bloquea exportar', async () => {
      // Volume fixture keeps real foreign keys and participant cardinality.
      await owner.query('BEGIN');
      try {
        await owner.query(`WITH inserted AS (
          INSERT INTO publicaciones(id,titulo,titulo_hash,resumen,resumen_hash,abstract,abstract_hash,palabras_clave,anio,origen,requiere_copia_biblioteca,url_externa,carrera_id,nivel_id,tipo_id,filial_id,creado_por_id)
          SELECT gen_random_uuid(), $1 || n, encode(sha256(($1 || 'title' || n)::bytea),'hex'), $1 || n, encode(sha256(($1 || 'summary' || n)::bytea),'hex'), $1 || n, encode(sha256(($1 || 'abstract' || n)::bytea),'hex'), 'volumen',2026,'EXTERNA',false,'https://example.org/volume',$2,$3,$4,$5,$6 FROM generate_series(1,498) n RETURNING id
        ), authors AS (INSERT INTO publicacion_autores(publicacion_id,autor_id,orden) SELECT id,$7,1 FROM inserted)
        INSERT INTO publicacion_tutores(publicacion_id,tutor_id,orden) SELECT id,$8,1 FROM inserted`, [suffix, careerId, levelId, typeId, branchId, ids.DIGITADOR, authorId, tutorId]);
        await owner.query('COMMIT');
      } catch (error) { await owner.query('ROLLBACK'); throw error; }
      const result = await preview(scoped);
      assert.equal(result.json().pagination.total, 501); assert.equal(result.json().data.length, 20);
      assert.equal(result.json().report.exportable, false); assert.equal(result.json().report.snapshot, null);
      problem(await exportFile('a'.repeat(64), 'pdf', scoped), 400, 'REPORT_LIMIT_EXCEEDED');
    });
    await t.test('sesión vencida durante generación cancela entrega', async () => {
      const single = { publicationId: publicationIds[0] };
      const snapshot = (await preview(single)).json().report.snapshot;
      hook = async () => { clock.setTime(clock.getTime() + 600000); };
      problem(await exportFile(snapshot, 'pdf', single), 401, 'UNAUTHENTICATED'); hook = undefined;
    });
  } finally { await app.close(); await prisma.$disconnect(); await owner.end(); }
});
