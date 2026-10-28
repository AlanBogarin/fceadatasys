import test from 'node:test';
import { catalogFields } from './helpers/catalog-fields.js';
import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Client } from 'pg';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { InjectOptions } from 'fastify';
import { createApp } from './helpers/integration-app.js';
import { createPrisma } from '../src/db.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword } from '../src/security/crypto.js';
import type { CatalogKey } from '../src/catalogs/schemas.js';
import { publicationWhere } from '../src/publications/query.js';
import { publicationQuerySchema } from '../src/publications/schemas.js';

const databaseUrl = process.env.PUBLICATION_QUERIES_TEST_DATABASE_URL;
test('consulta de publicaciones PostgreSQL: permisos, DTO, filtros, FTS, snapshot y rendimiento', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  const ownerUrl = new URL(process.env.PUBLICATION_QUERIES_TEST_OWNER_URL ?? 'http://missing');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && /^\/fceadatasys_.*test$/.test(url.pathname) && !/users|catalogs/.test(url.pathname), 'Se requiere base local aislada distinta de usuarios/catálogos.');
  assert.equal(ownerUrl.host, url.host, 'Se requiere PUBLICATION_QUERIES_TEST_OWNER_URL hacia la misma base.');
  assert.equal(ownerUrl.pathname, url.pathname);
  const prisma = createPrisma(databaseUrl!);
  const owner = new Client({ connectionString: ownerUrl.href });
  await owner.connect();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const clock = new Date('2026-10-16T15:00:00Z');
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: databaseUrl!, jwtSecret: 'publication-query-secret-'.repeat(4), jwtIssuer: 'test', jwtAudience: 'test', allowedOrigins: ['http://localhost:5173'], secureCookies: false, recoveryUrl: 'http://localhost:5173/reset' };
  const app = await createApp(config, prisma, { logger: false, security: { now: () => new Date(clock) } });
  const password = 'QueryTest123!';
  const passwordHash = await hashPassword(password);
  const ciBase = randomInt(100000000000, 800000000000);
  const headers: Record<string, { authorization: string }> = {};
  const actorIds: Record<string, string> = {};
  let sequence = 0;
  const send = (options: InjectOptions) => app.inject({ remoteAddress: `203.0.113.${1 + sequence++ % 250}`, ...options });
  const list = (query: Record<string, string> = {}, actor = 'ADMINISTRADOR') => send({ url: `/api/v1/publicaciones?${new URLSearchParams(query)}`, headers: headers[actor] });
  const detail = (id: string, actor = 'ADMINISTRADOR') => send({ url: `/api/v1/publicaciones/${id}`, headers: headers[actor] });
  const problem = (response: { statusCode: number; body: string; json(): { code: string; invalid_params: unknown[] } }, status: number, code: string) => { assert.equal(response.statusCode, status, response.body); assert.equal(response.json().code, code); assert.ok(Array.isArray(response.json().invalid_params)); };
  const catalog = async (key: CatalogKey, name?: string) => {
    const response = await send({ method: 'POST', url: `/api/v1/catalogos/${key}`, headers: headers.ADMINISTRADOR, payload: { name: `${name ?? key} ${suffix} ${sequence}`, fields: catalogFields(key) } });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<{ id: string; name: string }>();
  };
  const refs = async () => ({ authors: [await catalog('autores', 'José Núñez'), await catalog('autores', 'María Gómez')], tutors: [await catalog('tutores', 'Érica López'), await catalog('tutores', 'Raúl Méndez')], career: await catalog('carreras'), level: await catalog('niveles'), type: await catalog('tipos'), branch: await catalog('filiales') });
  type Refs = Awaited<ReturnType<typeof refs>>;
  let firstRefs: Refs;
  const input = (using = firstRefs) => ({ title: `Economía institucional ${suffix} ${++sequence}`, summary: `La investigación regional del proyecto ${suffix} ${sequence}`, abstract: `The growing companies improved research ${suffix} ${sequence}`, keywords: `estadística, economía, ${suffix}`,
    year: 2026, approved: true, externalUrl: `https://example.org/${suffix}/${sequence}`,
    authorIds: using.authors.map(row => row.id).reverse(), tutorIds: using.tutors.map(row => row.id).reverse(), careerId: using.career.id, levelId: using.level.id, typeId: using.type.id, branchId: using.branch.id });
  const publish = async (payload: object) => {
    const response = await send({ method: 'POST', url: '/api/v1/publicaciones', headers: headers.DIGITADOR, payload });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(response.headers.location, `/api/v1/publicaciones/${response.json().id}`);
    return response.json<{ id: string; code: string; title: string }>();
  };
  const file = async () => {
    const id = randomUUID();
    await owner.query('INSERT INTO adjuntos(id,nombre,tamano,mime,sha256,almacenamiento_clave,estado,contenido_verificado,analizado_en,creado_por_id) VALUES($1,$2,1024,$3,$4,$5,$6,true,$7,$8)', [id, 'trabajo.pdf', 'application/pdf', createHash('sha256').update(id).digest('hex'), `private/${id}.pdf`, 'CLEAN', clock, actorIds.DIGITADOR]);
    return id;
  };
  try {
    for (const [index, role] of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO'].entries()) {
      const username = `qry.${suffix}.${index}`;
      const user = await prisma.user.create({ data: { name: `Actor consulta ${index}`, ci: String(ciBase + index), email: `${username}@example.org`, emailKey: `${username}@example.org`, username, usernameKey: username, role: role as 'ADMINISTRADOR' | 'DIGITADOR' | 'PUBLICO', passwordHash } });
      actorIds[role] = user.id;
      const login = await send({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.allowedOrigins[0] }, payload: { username, password } });
      assert.equal(login.statusCode, 200, login.body);
      headers[role] = { authorization: `Bearer ${login.json().accessToken}` };
    }
    firstRefs = await refs();
    const secondRefs = await refs();
    const aInput = input();
    const a = await publish(aInput);
    const b = await publish({ ...input(secondRefs), year: 2025, source: 'LOCAL', externalUrl: '', requiresLibraryCopy: false });
    const attachedId = await file();
    const c = await publish({ ...input(), source: 'LOCAL', externalUrl: '', attachmentId: attachedId });
    const inactive = await publish(input());
    await owner.query('UPDATE publicaciones SET activo=false WHERE id=$1', [inactive.id]);

    await t.test('los tres roles consultan metadatos activos con referencias ordenadas y sin datos privados', async () => {
      for (const role of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO']) {
        const response = await detail(a.id, role);
        assert.equal(response.statusCode, 200, response.body);
        const dto = response.json();
        assert.deepEqual(dto.authors.map((row: { id: string }) => row.id), aInput.authorIds);
        assert.deepEqual(dto.tutors.map((row: { id: string }) => row.id), aInput.tutorIds);
        assert.equal(dto.hasAttachment, false);
        assert.equal(dto.externalUrl, aInput.externalUrl);
        assert.equal(dto.code, a.code);
        for (const person of [...dto.authors, ...dto.tutors, dto.createdBy]) assert.deepEqual(Object.keys(person).sort(), ['id', 'name']);
        for (const secret of ['passwordHash', 'salt', 'titleHash', 'summaryHash', 'abstractHash', 'attachmentId', 'attachmentHash', 'storageKey', 'number']) assert.equal(secret in dto, false, secret);
        assert.equal(response.headers['cache-control'], 'no-store');
        const rows = await list({ search: suffix }, role);
        assert.equal(rows.statusCode, 200, rows.body);
        assert.ok(rows.json().data.some((row: { id: string }) => row.id === a.id));
      }
    });
    await t.test('solo Admin ve inactivas; intentos de ampliar el alcance, anónimo y UUID desconocidos fallan', async () => {
      assert.equal((await detail(inactive.id)).statusCode, 200);
      assert.ok((await list({ search: suffix, active: 'false' })).json().data.some((row: { id: string }) => row.id === inactive.id));
      for (const role of ['DIGITADOR', 'PUBLICO']) {
        problem(await detail(inactive.id, role), 404, 'NOT_FOUND');
        problem(await list({ active: 'false' }, role), 403, 'FORBIDDEN');
        assert.ok((await list({ search: suffix }, role)).json().data.every((row: { active: boolean }) => row.active));
      }
      problem(await send({ url: '/api/v1/publicaciones' }), 401, 'UNAUTHENTICATED');
      problem(await send({ url: `/api/v1/publicaciones/${a.id}` }), 401, 'UNAUTHENTICATED');
      problem(await detail(randomUUID()), 404, 'NOT_FOUND');
      problem(await detail('invalid'), 400, 'VALIDATION_ERROR');
      problem(await send({ url: `/api/v1/publicaciones/${a.id}?download=true`, headers: headers.PUBLICO }), 400, 'VALIDATION_ERROR');
    });
    await t.test('filtros combinados, orden estable, paginación, códigos y resultados vacíos', async () => {
      const filters = { careerId: firstRefs.career.id, levelId: firstRefs.level.id, typeId: firstRefs.type.id, branchId: firstRefs.branch.id, authorId: firstRefs.authors[0].id, tutorId: firstRefs.tutors[1].id, year: '2026', source: 'EXTERNA', active: 'true' };
      const match = await list(filters);
      assert.deepEqual(match.json().data.map((row: { id: string }) => row.id), [a.id]);
      const first = await list({ search: suffix, pageSize: '2' });
      const second = await list({ search: suffix, pageSize: '2', page: '2' });
      assert.deepEqual([...first.json().data, ...second.json().data].map((row: { id: string }) => row.id), [inactive.id, c.id, b.id, a.id]);
      assert.deepEqual(first.json().pagination, { page: 1, pageSize: 2, total: 4, totalPages: 2 });
      const past = await list({ search: suffix, page: '99' });
      assert.deepEqual(past.json().data, []);
      assert.equal(past.json().pagination.total, 4);
      assert.deepEqual((await list({ code: a.code.toLowerCase() })).json().data.map((row: { id: string }) => row.id), [a.id]);
      assert.deepEqual((await list({ code: 'INV-9223372036854775807' })).json(), { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
      assert.deepEqual((await list({ careerId: randomUUID() })).json().data, []);
      assert.deepEqual((await list({ careerId: firstRefs.level.id })).json().data, []);
      assert.deepEqual((await list({ authorId: secondRefs.authors[0].id, source: 'LOCAL' })).json().data.map((row: { id: string }) => row.id), [b.id]);
    });
    await t.test('rango de registro usa días inclusivos de America/Asuncion, independiente del año de publicación', async () => {
      await owner.query('UPDATE publicaciones SET creado_en=$1 WHERE id=$2', ['2026-10-16T02:59:59.999Z', a.id]);
      await owner.query('UPDATE publicaciones SET creado_en=$1 WHERE id=$2', ['2026-10-16T03:00:00.000Z', b.id]);
      await owner.query('UPDATE publicaciones SET creado_en=$1 WHERE id=$2', ['2026-10-17T02:59:59.999Z', c.id]);
      await owner.query('UPDATE publicaciones SET creado_en=$1 WHERE id=$2', ['2026-10-17T03:00:00.000Z', inactive.id]);
      const result = await list({ search: suffix, from: '2026-10-16', to: '2026-10-16' });
      assert.deepEqual(result.json().data.map((row: { id: string }) => row.id), [c.id, b.id]);
      assert.deepEqual((await list({ code: a.code, to: '2026-10-15' })).json().data.map((row: { id: string }) => row.id), [a.id]);
      await owner.query('UPDATE publicaciones SET creado_en=$1 WHERE id=ANY($2::uuid[])', [clock, [a.id, b.id, c.id, inactive.id]]);
    });
    await t.test('FTS española/inglesa, bilingüe literal, nombres, código y entradas tratadas como datos', async () => {
      for (const search of [`ECONOMIAS ${suffix}`, `investigaciones ${suffix}`, `company ${suffix}`, `economía growing ${suffix}`, `jose nunez ${suffix}`, `erica lopez ${suffix}`, `ＥＣＯＮＯＭＩＡ ${suffix}`, `Economi\u0301a ${suffix}`, a.code]) {
        const result = await list({ search, careerId: firstRefs.career.id });
        assert.equal(result.statusCode, 200, result.body);
        assert.ok(result.json().data.some((row: { id: string }) => row.id === a.id), search);
      }
      for (const search of ["' OR 1=1 --", "' UNION SELECT * FROM usuarios --", 'zzzausente' + suffix, '!!!']) {
        // Scope to this run: FTS legitimately treats "1=1" as the numeric
        // lexeme 1, which can occur in older performance fixtures.
        const result = await list({ search, careerId: firstRefs.career.id });
        assert.equal(result.statusCode, 200, result.body);
        assert.deepEqual(result.json().data, []);
      }
      const renamed = `Lucía Fernández ${suffix}`;
      await owner.query('UPDATE autores SET nombre_completo=$1 WHERE id=$2', [renamed, firstRefs.authors[0].id]);
      assert.ok((await list({ search: `lucia fernandez ${suffix}` })).json().data.some((row: { id: string }) => row.id === a.id));
      assert.equal((await detail(a.id, 'PUBLICO')).json().authors[1].name, renamed);
    });
    await t.test('metadata conserva referencias históricas inactivas y protege adjuntos por rol/estado', async () => {
      for (const role of ['ADMINISTRADOR', 'DIGITADOR']) assert.equal((await detail(c.id, role)).json().attachment.id, attachedId);
      const publicDto = (await detail(c.id, 'PUBLICO')).json();
      assert.equal(publicDto.hasAttachment, true);
      assert.equal(publicDto.attachment, undefined);
      assert.equal(JSON.stringify(publicDto).includes('private/'), false);
      await owner.query("UPDATE adjuntos SET estado='REJECTED' WHERE id=$1", [attachedId]);
      for (const role of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO']) {
        const result = await detail(c.id, role);
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(result.json().hasAttachment, true);
        assert.equal(result.json().attachment, undefined);
      }
      await owner.query('UPDATE autores SET activo=false WHERE id=$1', [firstRefs.authors[0].id]);
      await owner.query('UPDATE catalogos SET activo=false WHERE id=$1', [firstRefs.career.id]);
      assert.equal((await detail(a.id, 'PUBLICO')).statusCode, 200);
      assert.ok((await list({ careerId: firstRefs.career.id }, 'PUBLICO')).json().data.some((row: { id: string }) => row.id === a.id));
      await owner.query('UPDATE autores SET activo=true WHERE id=$1', [firstRefs.authors[0].id]);
      await owner.query('UPDATE catalogos SET activo=true WHERE id=$1', [firstRefs.career.id]);
    });
    await t.test('consultas no renuevan sesión ni escriben éxito de descarga; validaciones/rechazos sí se auditan', async () => {
      const sessions = await prisma.session.findMany({ where: { userId: actorIds.PUBLICO } });
      const beforeLogs = await prisma.auditLog.count({ where: { userId: actorIds.PUBLICO } });
      await list({ code: a.code }, 'PUBLICO'); await detail(a.id, 'PUBLICO');
      assert.deepEqual(await prisma.session.findMany({ where: { userId: actorIds.PUBLICO } }), sessions);
      assert.equal(await prisma.auditLog.count({ where: { userId: actorIds.PUBLICO } }), beforeLogs);
      const invalidQueries: Record<string, string>[] = [{ page: '0' }, { pageSize: '101' }, { source: 'unknown' }, { year: '1899' }, { active: 'all' }, { from: '2026-02-30' }, { from: '2026-10-17', to: '2026-10-16' }, { careerId: 'invalid' }, { code: 'INV-9223372036854775808' }, { sort: 'passwordHash' }];
      for (const query of invalidQueries) problem(await list(query), 400, 'VALIDATION_ERROR');
      await list({ active: 'false' }, 'PUBLICO');
      assert.ok(await prisma.auditLog.count({ where: { userId: actorIds.PUBLICO, status: 'FALLIDO', operation: 'OPERACION_RECHAZADA' } }) > beforeLogs - 1);
      const broken = prisma.$extends({ query: { auditLog: { create: async () => { throw Error('Audit outage'); } } } }) as unknown as PrismaClient;
      const brokenApp = await createApp(config, broken, { logger: false, security: { now: () => clock } });
      try { problem(await brokenApp.inject({ url: '/api/v1/publicaciones?active=false', headers: headers.PUBLICO }), 503, 'AUDIT_UNAVAILABLE'); }
      finally { await brokenApp.close(); }
    });
    await t.test('conteo, IDs y relaciones comparten snapshot frente a una escritura concurrente', async () => {
      let intercept = true;
      const wrapped = prisma.$extends({ query: { $queryRaw: async ({ args, query }) => {
        const result = await query(args);
        const statement = (args as unknown as { sql?: string }).sql ?? '';
        if (intercept && statement.includes('count(*)')) {
          intercept = false;
          await owner.query('UPDATE publicaciones SET activo=false WHERE id=$1', [a.id]);
          await owner.query('UPDATE autores SET nombre_completo=$1 WHERE id=$2', [`Cambió ${suffix}`, firstRefs.authors[0].id]);
        }
        return result;
      } } }) as unknown as PrismaClient;
      const snapshotApp = await createApp(config, wrapped, { logger: false, security: { now: () => clock } });
      const originalName = (await detail(a.id)).json().authors[1].name;
      try {
        const result = await snapshotApp.inject({ url: `/api/v1/publicaciones?code=${a.code}`, headers: headers.PUBLICO });
        assert.equal(result.statusCode, 200, result.body);
        assert.equal(intercept, false, 'Debe interceptarse el conteo real.');
        assert.equal(result.json().pagination.total, 1);
        assert.equal(result.json().data[0].active, true);
        assert.equal(result.json().data[0].authors[1].name, originalName);
        assert.equal((await detail(a.id, 'PUBLICO')).statusCode, 404);
      } finally { await snapshotApp.close(); await owner.query('UPDATE publicaciones SET activo=true WHERE id=$1', [a.id]); }
    });
    await t.test('índices FTS reales y consulta HTTP de búsqueda dentro de 1,5 segundos en 2000 registros adicionales', async () => {
      // SQL fixtures exercise realistic persisted search documents/joins without
      // benchmarking 2000 unrelated password hashes and HTTP creations.
      await owner.query('BEGIN');
      try {
        await owner.query(`INSERT INTO publicaciones(id,titulo,titulo_hash,resumen,resumen_hash,abstract,abstract_hash,palabras_clave,anio,origen,requiere_copia_biblioteca,url_externa,carrera_id,nivel_id,tipo_id,filial_id,creado_por_id)
          SELECT gen_random_uuid(), 'Medición ' || $1 || ' ' || n, md5($1 || 't' || n) || md5('t' || $1 || n),
            'Texto regional ' || $1 || ' ' || n, md5($1 || 's' || n) || md5('s' || $1 || n),
            'English research ' || $1 || ' ' || n, md5($1 || 'a' || n) || md5('a' || $1 || n),
            CASE WHEN n % 200 = 0 THEN 'econometriaunica' ELSE 'regional' END, 2026, 'EXTERNA', false, 'https://example.org/perf', $2,$3,$4,$5,$6 FROM generate_series(1,2000) n`, [suffix, secondRefs.career.id, secondRefs.level.id, secondRefs.type.id, secondRefs.branch.id, actorIds.DIGITADOR]);
        await owner.query(`INSERT INTO publicacion_autores(publicacion_id,autor_id,orden) SELECT id,$1,1 FROM publicaciones WHERE titulo LIKE $2`, [secondRefs.authors[0].id, `Medición ${suffix} %`]);
        await owner.query(`INSERT INTO publicacion_tutores(publicacion_id,tutor_id,orden) SELECT id,$1,1 FROM publicaciones WHERE titulo LIKE $2`, [secondRefs.tutors[0].id, `Medición ${suffix} %`]);
        await owner.query('COMMIT');
      } catch (error) { await owner.query('ROLLBACK'); throw error; }
      await owner.query('ANALYZE publicaciones'); await owner.query('ANALYZE publicacion_autores'); await owner.query('ANALYZE publicacion_tutores');
      const where = publicationWhere(publicationQuerySchema.parse({ search: 'econometriaunica', careerId: secondRefs.career.id }), 'PUBLICO');
      const statement = Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) SELECT p.id FROM public.publicaciones p WHERE ${where} ORDER BY p.creado_en DESC, p.numero DESC LIMIT 20`;
      const plan = await owner.query(statement.text, statement.values);
      assert.ok(JSON.stringify(plan.rows).includes('publicaciones_busqueda_gin'), 'El plan debe usar el índice FTS, sin forzar enable_seqscan.');
      const measurements: number[] = [];
      for (let index = 0; index < 5; index++) {
        const start = performance.now();
        const result = await list({ search: 'econometriaunica', careerId: secondRefs.career.id, pageSize: '20' }, 'PUBLICO');
        measurements.push(performance.now() - start);
        assert.equal(result.statusCode, 200, result.body);
        assert.ok(result.json().pagination.total >= 10);
      }
      assert.ok(measurements.every(ms => ms <= 1500), `Mediciones HTTP: ${measurements.join(', ')} ms`);
      t.diagnostic(`FTS HTTP 2000 registros adicionales, 5 muestras (ms): ${measurements.map(ms => ms.toFixed(1)).join(', ')}; índice GIN verificado en EXPLAIN ANALYZE.`);
    });
  } finally { await app.close(); await prisma.$disconnect(); await owner.end(); }
});
