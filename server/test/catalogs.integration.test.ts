import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import type { PrismaClient } from '@prisma/client';
import type { InjectOptions } from 'fastify';
import { createApp } from '../src/app.js';
import { createPrisma } from '../src/db.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword } from '../src/security/crypto.js';
import { catalogKeys, normalizeCatalog, type CatalogDto, type CatalogKey } from '../src/catalogs/schemas.js';

const databaseUrl = process.env.CATALOGS_TEST_DATABASE_URL;
test('catálogos PostgreSQL: contratos, permisos, unicidad, referencias y auditoría', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  const ownerUrl = new URL(process.env.CATALOGS_TEST_OWNER_URL ?? 'http://missing');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && /^\/fceadatasys_.*test$/.test(url.pathname) && !url.pathname.includes('users'), 'Use una base local de pruebas distinta de usuarios.');
  assert.equal(ownerUrl.host, url.host, 'Se requiere CATALOGS_TEST_OWNER_URL para fixtures FK en la misma base aislada.');
  assert.equal(ownerUrl.pathname, url.pathname);
  const prisma = createPrisma(databaseUrl!);
  const owner = new Client({ connectionString: ownerUrl.href });
  await owner.connect();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const orcidDigits = String(randomInt(100000000000, 800000000000));
  const orcid = `${orcidDigits.slice(0, 4)}-${orcidDigits.slice(4, 8)}-${orcidDigits.slice(8, 12)}-000X`;
  const otherOrcid = orcid.slice(0, -4) + '001X';
  const fixtureTable = `catalog_test_refs_${suffix}`;
  const password = 'CatalogTest123!';
  const passwordHash = await hashPassword(password);
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: databaseUrl!, jwtSecret: 'catalog-test-secret-'.repeat(4), jwtIssuer: 'test', jwtAudience: 'test', allowedOrigins: ['http://localhost:5173'], secureCookies: false, recoveryUrl: 'http://localhost:5173/reset' };
  const app = await createApp(config, prisma, { logger: false });
  let sequence = 0;
  const send = (options: InjectOptions) => app.inject({ remoteAddress: `192.0.2.${1 + sequence++ % 250}`, ...options });
  const headers: Record<string, { authorization: string }> = {};
  const base = (key: CatalogKey) => `/api/v1/catalogos/${key}`;
  const create = async (key: CatalogKey, fields: Record<string, string> = {}, name = `Registro ${suffix} ${sequence}`) => {
    const response = await send({ method: 'POST', url: base(key), headers: headers.ADMINISTRADOR, payload: { name, fields } });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.headers.location, `${base(key)}/${response.json().id}`);
    return response.json<CatalogDto>();
  };
  const patch = (key: CatalogKey, id: string, payload: object, actor = 'ADMINISTRADOR') => send({ method: 'PATCH', url: `${base(key)}/${id}`, headers: headers[actor], payload });
  const waitForLock = async (table: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      await owner.query('SELECT pg_stat_clear_snapshot()');
      const activity = await owner.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1", [`%${table}%FOR UPDATE%`]);
      if (activity.rowCount) return;
      await delay(10);
    }
    assert.fail(`No se observó el bloqueo esperado sobre ${table}.`);
  };
  const problem = (response: { statusCode: number; body: string; json(): { code: string; invalid_params: unknown[] } }, status: number, code: string) => { assert.equal(response.statusCode, status, response.body); assert.equal(response.json().code, code); assert.ok(Array.isArray(response.json().invalid_params)); };
  try {
    const roleName = url.username.replace(/"/g, '""');
    await owner.query(`CREATE TABLE public.${fixtureTable} (id uuid PRIMARY KEY, author_id uuid REFERENCES public.autores(id) ON DELETE RESTRICT, tutor_id uuid REFERENCES public.tutores(id) ON DELETE RESTRICT, catalog_id uuid REFERENCES public.catalogos(id) ON DELETE RESTRICT)`);
    await owner.query(`GRANT SELECT, INSERT, DELETE ON public.${fixtureTable} TO "${roleName}"`);
    const ciBase = randomInt(100000000000, 800000000000);
    for (const [index, role] of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO'].entries()) {
      const username = `cat.${suffix}.${index}`;
      await prisma.user.create({ data: { name: `Actor ${index}`, ci: String(ciBase + index), username, usernameKey: username, email: `${username}@example.org`, emailKey: `${username}@example.org`, role: role as 'ADMINISTRADOR' | 'DIGITADOR' | 'PUBLICO', passwordHash } });
      const response = await send({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.allowedOrigins[0] }, payload: { username, password } });
      assert.equal(response.statusCode, 200, response.body);
      headers[role] = { authorization: `Bearer ${response.json().accessToken}` };
    }
    await t.test('runtime conserva mínimos privilegios y CORS admite DELETE', async () => {
      const result = await prisma.$queryRaw<{ auditDelete: boolean; authorDelete: boolean; catalogTruncate: boolean; isSuper: boolean }[]>`SELECT has_table_privilege(current_user, 'auditoria', 'DELETE') AS "auditDelete", has_table_privilege(current_user, 'autores', 'DELETE') AS "authorDelete", has_table_privilege(current_user, 'catalogos', 'TRUNCATE') AS "catalogTruncate", rolsuper AS "isSuper" FROM pg_roles WHERE rolname = current_user`;
      assert.deepEqual(result[0], { auditDelete: false, authorDelete: true, catalogTruncate: false, isSuper: false });
      const cors = await send({ method: 'OPTIONS', url: base('autores'), headers: { origin: config.allowedOrigins[0], 'access-control-request-method': 'DELETE' } });
      assert.equal(cors.statusCode, 204);
      assert.match(String(cors.headers['access-control-allow-methods']), /DELETE/);
    });
    await t.test('CRUD de los siete catálogos, estados, DTO y auditoría', async () => {
      const fields: Record<CatalogKey, Record<string, string>> = { autores: { ci: String(ciBase + 10), email: `${suffix}@example.org`, orcid }, tutores: { ci: String(ciBase + 10), email: `${suffix}@example.org`, especialidad: 'Economía' }, carreras: { codigo: suffix, descripcion: 'Carrera' }, facultades: { sigla: suffix, descripcion: 'Facultad' }, filiales: { direccion: 'Concepción', descripcion: 'Filial' }, tipos: { descripcion: 'Tipo' }, niveles: { descripcion: 'Nivel' } };
      for (const key of catalogKeys) {
        const row = await create(key, fields[key]);
        assert.deepEqual(Object.keys(row).sort(), ['id', 'name', 'fields', 'active', 'createdAt', 'updatedAt'].sort());
        assert.deepEqual(row.fields, fields[key]);
        assert.equal((await send({ url: `${base(key)}/${row.id}`, headers: headers.ADMINISTRADOR })).json().id, row.id);
        const changed = await patch(key, row.id, { name: `Editado ${row.id}` });
        assert.equal(changed.statusCode, 200, changed.body);
        assert.deepEqual(changed.json().fields, fields[key]);
        assert.equal((await patch(key, row.id, { active: false })).json().active, false);
        assert.equal((await patch(key, row.id, { active: true })).json().active, true);
        const removed = await send({ method: 'DELETE', url: `${base(key)}/${row.id}`, headers: headers.ADMINISTRADOR });
        assert.equal(removed.statusCode, 204, removed.body);
        assert.equal(removed.body, '');
        problem(await send({ url: `${base(key)}/${row.id}`, headers: headers.ADMINISTRADOR }), 404, 'NOT_FOUND');
        const logs = await prisma.auditLog.findMany({ where: { resource: key, resourceId: row.id }, orderBy: { createdAt: 'asc' } });
        assert.deepEqual(logs.map(log => log.operation).sort(), ['CATALOGO_CREADO', 'CATALOGO_MODIFICADO', 'CATALOGO_INACTIVADO', 'CATALOGO_ACTIVADO', 'CATALOGO_ELIMINADO'].sort());
        assert.ok(logs.every(log => log.status === 'EXITO' && log.sessionId && log.userId && log.role === 'ADMINISTRADOR'));
        assert.ok(logs.find(log => log.operation === 'CATALOGO_ELIMINADO')!.before);
      }
    });
    await t.test('permisos de Digitador, Público y solicitudes sin sesión', async () => {
      for (const key of catalogKeys) {
        const row = await create(key);
        for (const role of ['DIGITADOR', 'PUBLICO']) {
          const manage = role === 'DIGITADOR' && (key === 'autores' || key === 'tutores');
          const created = await send({ method: 'POST', url: base(key), headers: headers[role], payload: { name: `${role} ${suffix} ${sequence}` } });
          assert.equal(created.statusCode, manage ? 201 : 403, created.body);
          assert.equal((await patch(key, row.id, { name: `Permiso ${row.id}` }, role)).statusCode, manage ? 200 : 403);
          assert.equal((await patch(key, row.id, { active: false }, role)).statusCode, manage ? 200 : 403);
          assert.equal((await send({ method: 'DELETE', url: `${base(key)}/${row.id}`, headers: headers[role] })).statusCode, 403);
          assert.equal((await send({ url: base(key), headers: headers[role] })).statusCode, role === 'PUBLICO' && (key === 'autores' || key === 'tutores') ? 403 : 200);
        }
        for (const method of ['GET', 'POST', 'PATCH', 'DELETE'] as const) {
          const response = await send({ method, url: method === 'PATCH' || method === 'DELETE' ? `${base(key)}/${row.id}` : base(key), ...(method === 'POST' ? { payload: { name: 'Sin sesión' } } : method === 'PATCH' ? { payload: { active: false } } : {}) });
          problem(response, 401, 'UNAUTHENTICATED');
        }
      }
    });
    await t.test('búsqueda normalizada por nombre/campos, filtros, paginación y vacíos', async () => {
      const a = await create('carreras', { descripcion: 'Economía institucional' }, `Álgebra ${suffix}`);
      const b = await create('carreras', {}, `Beta ${suffix}`);
      await patch('carreras', b.id, { active: false });
      const list = (query: Record<string, string>) => send({ url: `${base('carreras')}?${new URLSearchParams(query)}`, headers: headers.ADMINISTRADOR });
      const first = await list({ search: suffix, pageSize: '1' });
      const second = await list({ search: suffix, pageSize: '1', page: '2' });
      assert.equal(first.json().data.length, 1);
      assert.ok(first.json().pagination.total >= 2);
      assert.notEqual(first.json().data[0].id, second.json().data[0].id);
      assert.ok((await list({ search: `ALGEBRA...${suffix}`, active: 'true' })).json().data.some((row: CatalogDto) => row.id === a.id));
      assert.ok((await list({ search: 'ECONOMIA INSTITUCIONAL' })).json().data.some((row: CatalogDto) => row.id === a.id));
      assert.ok((await list({ search: suffix, active: 'false' })).json().data.some((row: CatalogDto) => row.id === b.id));
      assert.deepEqual((await list({ search: `ausente ${randomUUID()}` })).json(), { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
      const publicList = await send({ url: `${base('carreras')}?active=false&search=${suffix}`, headers: headers.PUBLICO });
      assert.ok(publicList.json().data.every((row: CatalogDto) => row.active));
      problem(await send({ url: `${base('carreras')}/${b.id}`, headers: headers.PUBLICO }), 404, 'NOT_FOUND');
    });
    await t.test('duplicados normalizados incluso inactivos, campos únicos y carreras concurrentes', async () => {
      const row = await create('tipos', {}, `Único: ${suffix}`);
      await patch('tipos', row.id, { active: false });
      problem(await send({ method: 'POST', url: base('tipos'), headers: headers.ADMINISTRADOR, payload: { name: `UNICO...${suffix}` } }), 409, 'DUPLICATE_CATALOG');
      for (const [key, field, value] of [['autores', 'ci', String(ciBase + 30)], ['autores', 'email', `unique.${suffix}@example.org`], ['autores', 'orcid', otherOrcid], ['tutores', 'ci', String(ciBase + 40)], ['tutores', 'email', `tutor.${suffix}@example.org`], ['carreras', 'codigo', `C-${suffix}`], ['facultades', 'sigla', `F-${suffix}`]] as const) {
        const results = await Promise.all([0, 1].map(index => send({ method: 'POST', url: base(key), headers: headers.ADMINISTRADOR, payload: { name: `Concurrente ${key} ${field} ${suffix} ${index}`, fields: { [field]: value } } })));
        assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409], results.map(result => result.body).join('\n'));
      }
      const key = `db unico ${suffix}`;
      const direct = await Promise.allSettled([0, 1].map(() => prisma.author.create({ data: { name: key, nameKey: key, searchKey: key } })));
      assert.equal(direct.filter(result => result.status === 'fulfilled').length, 1, 'UNIQUE también arbitra escrituras fuera de la API.');
      const other = await create('tipos');
      problem(await patch('tipos', other.id, { name: row.name }), 409, 'DUPLICATE_CATALOG');
    });
    await t.test('validaciones estrictas, catálogo/UUID inexistente y campos ajenos', async () => {
      const row = await create('autores');
      for (const payload of [{ name: '---' }, { name: 'x'.repeat(151) }, { name: 'Nombre', fields: { ci: '1234' } }, { name: 'Nombre', fields: { email: 'invalido' } }, { name: 'Nombre', fields: { orcid: 'x' } }, { name: 'Nombre', fields: { descripcion: 'ajeno' } }, { name: 'Nombre', actorId: row.id }, { name: 'Nombre', active: false }]) problem(await send({ method: 'POST', url: base('autores'), headers: headers.ADMINISTRADOR, payload }), 400, 'VALIDATION_ERROR');
      for (const payload of [{}, { active: 'false' }, { fields: { sigla: 'ajeno' } }, { participantIds: [] }]) problem(await patch('autores', row.id, payload), 400, 'VALIDATION_ERROR');
      for (const query of ['page=0', 'pageSize=101', 'active=all', 'unknown=1']) problem(await send({ url: `${base('autores')}?${query}`, headers: headers.ADMINISTRADOR }), 400, 'VALIDATION_ERROR');
      problem(await send({ url: '/api/v1/catalogos/desconocido', headers: headers.ADMINISTRADOR }), 400, 'VALIDATION_ERROR');
      problem(await send({ url: `${base('autores')}/invalid`, headers: headers.ADMINISTRADOR }), 400, 'VALIDATION_ERROR');
      problem(await patch('autores', randomUUID(), { active: false }), 404, 'NOT_FOUND');
      const career = await create('carreras');
      problem(await patch('facultades', career.id, { name: 'Otro tipo' }), 404, 'NOT_FOUND');
      problem(await send({ method: 'DELETE', url: `${base('facultades')}/${career.id}`, headers: headers.ADMINISTRADOR }), 404, 'NOT_FOUND');
      const failures = await prisma.auditLog.count({ where: { status: 'FALLIDO', operation: 'OPERACION_RECHAZADA', sessionId: { not: null }, detail: { startsWith: 'VALIDATION_ERROR:' } } });
      assert.ok(failures > 0);
    });
    await t.test('referencias FK reales impiden inactivar y eliminar sin perder historia', async () => {
      for (const [key, column] of [['autores', 'author_id'], ['tutores', 'tutor_id'], ['carreras', 'catalog_id']] as const) {
        const row = await create(key);
        const referenceId = randomUUID();
        await owner.query(`INSERT INTO public.${fixtureTable}(id, ${column}) VALUES ($1, $2)`, [referenceId, row.id]);
        problem(await patch(key, row.id, { active: false }), 409, 'CATALOG_IN_USE');
        problem(await send({ method: 'DELETE', url: `${base(key)}/${row.id}`, headers: headers.ADMINISTRADOR }), 409, 'CATALOG_IN_USE');
        assert.equal((await send({ url: `${base(key)}/${row.id}`, headers: headers.ADMINISTRADOR })).json().active, true);
        assert.equal((await patch(key, row.id, { name: `Con historia ${row.id}` })).statusCode, 200);
        await owner.query(`DELETE FROM public.${fixtureTable} WHERE id = $1`, [referenceId]);
        assert.equal((await patch(key, row.id, { active: false })).statusCode, 200);
      }
    });
    await t.test('inactivación espera una referencia concurrente y la vuelve a consultar tras el bloqueo', async () => {
      const row = await create('autores');
      const refId = randomUUID();
      await owner.query('BEGIN');
      let pending: ReturnType<typeof patch> | undefined;
      try {
        await owner.query(`INSERT INTO public.${fixtureTable}(id, author_id) VALUES ($1, $2)`, [refId, row.id]);
        pending = patch('autores', row.id, { active: false });
        await waitForLock('autores');
        await owner.query('COMMIT');
        problem(await pending, 409, 'CATALOG_IN_USE');
      } finally {
        await owner.query('ROLLBACK');
        if (pending) await pending;
        await owner.query(`DELETE FROM public.${fixtureTable} WHERE id = $1`, [refId]);
      }
    });
    await t.test('rol y vencimiento se revalidan después de esperar locks', async () => {
      const row = await create('autores');
      const admin = await prisma.user.findUniqueOrThrow({ where: { usernameKey: `cat.${suffix}.0` } });
      await owner.query('BEGIN');
      let pending: ReturnType<typeof patch> | undefined;
      try {
        await owner.query("UPDATE usuarios SET rol = 'PUBLICO' WHERE id = $1", [admin.id]);
        pending = patch('autores', row.id, { name: 'Rol revocado' });
        await waitForLock('usuarios');
        await owner.query('COMMIT');
        problem(await pending, 403, 'FORBIDDEN');
      } finally {
        await owner.query('ROLLBACK');
        if (pending) await pending;
        await owner.query("UPDATE usuarios SET rol = 'ADMINISTRADOR' WHERE id = $1", [admin.id]);
      }
      let clock = new Date();
      const timedApp = await createApp(config, prisma, { logger: false, security: { now: () => new Date(clock) } });
      await owner.query('BEGIN');
      let timedPending: ReturnType<typeof patch> | undefined;
      try {
        await owner.query('SELECT id FROM autores WHERE id = $1 FOR UPDATE', [row.id]);
        timedPending = timedApp.inject({ method: 'PATCH', url: `${base('autores')}/${row.id}`, headers: headers.ADMINISTRADOR, payload: { name: 'Sesión vencida' } });
        await waitForLock('autores');
        clock = new Date(clock.getTime() + 600000);
        await owner.query('COMMIT');
        problem(await timedPending, 401, 'UNAUTHENTICATED');
      } finally {
        await owner.query('ROLLBACK');
        if (timedPending) await timedPending;
        await timedApp.close();
      }
      assert.deepEqual((await send({ url: `${base('autores')}/${row.id}`, headers: headers.ADMINISTRADOR })).json(), row);
    });
    await t.test('PATCH concurrentes preservan campos distintos', async () => {
      const row = await create('autores');
      const results = await Promise.all([patch('autores', row.id, { fields: { ci: String(ciBase + 50) } }), patch('autores', row.id, { fields: { email: `merged.${suffix}@example.org` } })]);
      assert.ok(results.every(result => result.statusCode === 200), results.map(result => result.body).join('\n'));
      const detail = await send({ url: `${base('autores')}/${row.id}`, headers: headers.ADMINISTRADOR });
      assert.equal(detail.json().fields.ci, String(ciBase + 50));
      assert.equal(detail.json().fields.email, `merged.${suffix}@example.org`);
      assert.equal(detail.json().fields.orcid, '');
      const cleared = await patch('autores', row.id, { fields: { ci: '', email: '' } });
      assert.equal(cleared.statusCode, 200, cleared.body);
      assert.deepEqual(cleared.json().fields, { ci: '', email: '', orcid: '' });
      const stored = await prisma.author.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(stored.ciKey, null);
      assert.equal(stored.emailKey, null);
    });
    await t.test('fallo de auditoría revierte alta, edición, estados y eliminación', async () => {
      let failing = '';
      const broken = prisma.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.operation === failing) throw Error('Audit unavailable'); return query(args); } } } }) as unknown as PrismaClient;
      const brokenApp = await createApp(config, broken, { logger: false });
      try {
        const name = `Fallido ${suffix}`;
        failing = 'CATALOGO_CREADO';
        problem(await brokenApp.inject({ method: 'POST', url: base('autores'), headers: headers.ADMINISTRADOR, payload: { name } }), 503, 'AUDIT_UNAVAILABLE');
        assert.equal(await prisma.author.count({ where: { nameKey: normalizeCatalog(name) } }), 0);
        const row = await create('autores');
        for (const [operation, method, payload] of [['CATALOGO_MODIFICADO', 'PATCH', { name: 'Cambio fallido' }], ['CATALOGO_INACTIVADO', 'PATCH', { active: false }], ['CATALOGO_ELIMINADO', 'DELETE', undefined]] as const) {
          failing = operation;
          problem(await brokenApp.inject({ method, url: `${base('autores')}/${row.id}`, headers: headers.ADMINISTRADOR, payload }), 503, 'AUDIT_UNAVAILABLE');
          assert.deepEqual((await send({ url: `${base('autores')}/${row.id}`, headers: headers.ADMINISTRADOR })).json(), row);
        }
        await patch('autores', row.id, { active: false });
        failing = 'CATALOGO_ACTIVADO';
        problem(await brokenApp.inject({ method: 'PATCH', url: `${base('autores')}/${row.id}`, headers: headers.ADMINISTRADOR, payload: { active: true } }), 503, 'AUDIT_UNAVAILABLE');
        assert.equal((await prisma.author.findUniqueOrThrow({ where: { id: row.id } })).active, false);
      } finally { await brokenApp.close(); }
    });
  } finally {
    await owner.query(`DROP TABLE IF EXISTS public.${fixtureTable}`);
    await app.close();
    await prisma.$disconnect();
    await owner.end();
  }
});
