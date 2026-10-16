import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import type { PrismaClient } from '@prisma/client';
import type { InjectOptions } from 'fastify';
import { createApp } from '../src/app.js';
import { createPrisma } from '../src/db.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword } from '../src/security/crypto.js';
import { publicationHash } from '../src/publications/schemas.js';
import type { CatalogKey } from '../src/catalogs/schemas.js';

const databaseUrl = process.env.PUBLICATIONS_TEST_DATABASE_URL;
test('registro de publicaciones PostgreSQL: relaciones, permisos, duplicados, adjuntos y auditoría', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  const ownerUrl = new URL(process.env.PUBLICATIONS_TEST_OWNER_URL ?? 'http://missing');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && /^\/fceadatasys_.*test$/.test(url.pathname) && !/users|catalogs/.test(url.pathname), 'Use una base local de pruebas exclusiva para publicaciones.');
  assert.equal(ownerUrl.host, url.host, 'Se requiere PUBLICATIONS_TEST_OWNER_URL hacia la misma base aislada.');
  assert.equal(ownerUrl.pathname, url.pathname);
  const prisma = createPrisma(databaseUrl!);
  const owner = new Client({ connectionString: ownerUrl.href });
  await owner.connect();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = 'PublicationTest123!';
  const passwordHash = await hashPassword(password);
  const ciBase = randomInt(100000000000, 800000000000);
  let clock = new Date('2026-10-16T15:00:00Z');
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: databaseUrl!, jwtSecret: 'publication-test-secret-'.repeat(4), jwtIssuer: 'test', jwtAudience: 'test', allowedOrigins: ['http://localhost:5173'], secureCookies: false, recoveryUrl: 'http://localhost:5173/reset' };
  const app = await createApp(config, prisma, { logger: false, security: { now: () => new Date(clock) } });
  let sequence = 0;
  const headers: Record<string, { authorization: string }> = {};
  const actorIds: Record<string, string> = {};
  const send = (options: InjectOptions) => app.inject({ remoteAddress: `198.51.100.${1 + sequence++ % 250}`, ...options });
  const problem = (response: { statusCode: number; body: string; json(): { code: string; invalid_params: { name: string }[] } }, status: number, code: string) => { assert.equal(response.statusCode, status, response.body); assert.equal(response.json().code, code); assert.ok(Array.isArray(response.json().invalid_params)); };
  const catalog = async (key: CatalogKey) => {
    const response = await send({ method: 'POST', url: `/api/v1/catalogos/${key}`, headers: headers.ADMINISTRADOR, payload: { name: `${key} ${suffix} ${sequence}` } });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<{ id: string; name: string }>();
  };
  const catalogSet = async () => ({ authors: [await catalog('autores'), await catalog('autores')], tutors: [await catalog('tutores'), await catalog('tutores')], career: await catalog('carreras'), level: await catalog('niveles'), type: await catalog('tipos'), branch: await catalog('filiales') });
  type Refs = Awaited<ReturnType<typeof catalogSet>>;
  let refs: Refs;
  const nextInput = (using = refs) => {
    const key = `${suffix} ${++sequence}`;
    return { title: `Análisis económico ${key}`, summary: `Resumen de investigación ${key}`, abstract: `English research abstract ${key}`, keywords: 'economía, universidad',
      authorIds: using.authors.map(row => row.id).reverse(), tutorIds: using.tutors.map(row => row.id).reverse(), careerId: using.career.id, levelId: using.level.id, typeId: using.type.id, branchId: using.branch.id,
      year: 2026, approved: true, externalUrl: `https://example.org/research/${suffix}/${sequence}` };
  };
  const publish = (payload: object, actor = 'ADMINISTRADOR') => send({ method: 'POST', url: '/api/v1/publicaciones', headers: headers[actor], payload });
  const patchCatalog = (key: CatalogKey, id: string, payload: object) => send({ method: 'PATCH', url: `/api/v1/catalogos/${key}/${id}`, headers: headers.ADMINISTRADOR, payload });
  const waitForLock = async (table: string) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      await owner.query('SELECT pg_stat_clear_snapshot()');
      if ((await owner.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1", [`%${table}%FOR UPDATE%`])).rowCount) return;
      await delay(10);
    }
    assert.fail(`No se observó el bloqueo sobre ${table}.`);
  };
  const attachment = async (state = 'CLEAN', createdById = actorIds.DIGITADOR) => {
    const id = randomUUID();
    const sha256 = createHash('sha256').update(id).digest('hex');
    await owner.query('INSERT INTO adjuntos(id,nombre,tamano,mime,sha256,almacenamiento_clave,estado,contenido_verificado,analizado_en,creado_por_id) VALUES($1,$2,1024,$3,$4,$5,$6,$7,$8,$9)', [id, 'trabajo.pdf', 'application/pdf', sha256, `${id}.pdf`, state, state === 'CLEAN', state === 'CLEAN' ? clock : null, createdById]);
    return { id, sha256 };
  };
  try {
    for (const [index, role] of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO', 'DIGITADOR_2'].entries()) {
      const username = `pub.${suffix}.${index}`;
      const user = await prisma.user.create({ data: { name: `Actor publicaciones ${index}`, ci: String(ciBase + index), email: `${username}@example.org`, emailKey: `${username}@example.org`, username, usernameKey: username, role: role === 'DIGITADOR_2' ? 'DIGITADOR' : role as 'ADMINISTRADOR' | 'DIGITADOR' | 'PUBLICO', passwordHash } });
      actorIds[role] = user.id;
      const response = await send({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.allowedOrigins[0] }, payload: { username, password } });
      assert.equal(response.statusCode, 200, response.body);
      headers[role] = { authorization: `Bearer ${response.json().accessToken}` };
    }
    refs = await catalogSet();
    await owner.query('UPDATE parametros_publicaciones SET limite_palabras_resumen = 300 WHERE id = 1');
    await t.test('alta externa de Admin/Digitador devuelve DTO seguro, orden N:M y auditoría completa', async () => {
      for (const actor of ['ADMINISTRADOR', 'DIGITADOR']) {
        const input = nextInput();
        const response = await publish(input, actor);
        assert.equal(response.statusCode, 201, response.body);
        const dto = response.json();
        assert.match(dto.code, /^INV-\d{5,}$/);
        assert.deepEqual(dto.authors.map((row: { id: string }) => row.id), input.authorIds);
        assert.deepEqual(dto.tutors.map((row: { id: string }) => row.id), input.tutorIds);
        assert.equal(dto.source, 'EXTERNA');
        assert.equal(dto.requiresLibraryCopy, false);
        assert.equal(dto.active, true);
        assert.equal(dto.createdBy.id, actorIds[actor]);
        assert.equal(dto.createdAt, clock.toISOString());
        assert.equal(response.headers['cache-control'], 'no-store');
        for (const secret of ['passwordHash', 'titleHash', 'summaryHash', 'abstractHash', 'storageKey', 'approved']) assert.equal(secret in dto, false, secret);
        const stored = await prisma.publication.findUniqueOrThrow({ where: { id: dto.id }, include: { authors: { orderBy: { position: 'asc' } }, tutors: { orderBy: { position: 'asc' } } } });
        assert.deepEqual(stored.authors.map(row => row.authorId), input.authorIds);
        assert.deepEqual(stored.authors.map(row => row.position), [1, 2]);
        assert.deepEqual(stored.tutors.map(row => row.tutorId), input.tutorIds);
        assert.equal(stored.titleHash, publicationHash(input.title));
        const log = await prisma.auditLog.findFirstOrThrow({ where: { publicationId: dto.id, operation: 'REGISTRAR_INVESTIGACION' } });
        assert.equal(log.resourceId, dto.id);
        assert.equal(log.userId, actorIds[actor]);
        assert.equal(log.role, actor === 'ADMINISTRADOR' ? 'ADMINISTRADOR' : 'DIGITADOR');
        assert.ok(log.ip && log.sessionId && log.status === 'EXITO');
        assert.equal((log.after as { approvedExternally: boolean }).approvedExternally, true);
      }
    });
    await t.test('roles, identidad derivada de sesión y cuerpos estrictos', async () => {
      problem(await publish(nextInput(), 'PUBLICO'), 403, 'FORBIDDEN');
      problem(await send({ method: 'POST', url: '/api/v1/publicaciones', payload: nextInput() }), 401, 'UNAUTHENTICATED');
      for (const change of [{ approved: false }, { title: '---' }, { year: 2027 }, { authorIds: [] }, { tutorIds: [] }, { authorIds: [refs.authors[0].id, refs.authors[0].id.toUpperCase()] }, { actorId: actorIds.ADMINISTRADOR }, { attachment: { id: randomUUID(), sha256: 'a'.repeat(64) } }, { code: 'INV-00001' }]) problem(await publish({ ...nextInput(), ...change }), 400, 'VALIDATION_ERROR');
    });
    await t.test('límite exacto de 300 palabras y parámetro administrable con permisos/auditoría', async () => {
      const path = '/api/v1/parametros/publicaciones';
      const summary = ['limite' + suffix, ...Array<string>(299).fill('palabra')].join(' ');
      assert.equal((await publish({ ...nextInput(), summary })).statusCode, 201);
      const tooLong = await publish({ ...nextInput(), summary: summary + ' extra' });
      problem(tooLong, 400, 'VALIDATION_ERROR');
      assert.ok(tooLong.json().invalid_params.some((param: { name: string }) => param.name === 'body.summary'));
      for (const actor of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO']) assert.deepEqual((await send({ url: path, headers: headers[actor] })).json(), { summaryWordLimit: 300 });
      for (const actor of ['DIGITADOR', 'PUBLICO']) problem(await send({ method: 'PATCH', url: path, headers: headers[actor], payload: { summaryWordLimit: 2 } }), 403, 'FORBIDDEN');
      assert.equal((await send({ method: 'PATCH', url: path, headers: headers.ADMINISTRADOR, payload: { summaryWordLimit: 2 } })).statusCode, 200);
      assert.equal((await publish({ ...nextInput(), summary: `${suffix}${sequence} dos` })).statusCode, 201);
      problem(await publish({ ...nextInput(), summary: `${suffix} tres palabras` }), 400, 'VALIDATION_ERROR');
      const log = await prisma.auditLog.findFirstOrThrow({ where: { operation: 'PARAMETROS_PUBLICACIONES_MODIFICADOS', userId: actorIds.ADMINISTRADOR }, orderBy: { createdAt: 'desc' } });
      assert.deepEqual(log.before, { summaryWordLimit: 300 });
      assert.deepEqual(log.after, { summaryWordLimit: 2 });
      await send({ method: 'PATCH', url: path, headers: headers.ADMINISTRADOR, payload: { summaryWordLimit: 300 } });
    });
    await t.test('referencias inexistentes, inactivas, del tipo equivocado y arrays inválidos no generan publicaciones', async () => {
      const fresh = await catalogSet();
      const before = await prisma.publication.count();
      for (const [key, field, row] of [['autores', 'authorIds', fresh.authors[0]], ['tutores', 'tutorIds', fresh.tutors[0]], ['carreras', 'careerId', fresh.career], ['niveles', 'levelId', fresh.level], ['tipos', 'typeId', fresh.type], ['filiales', 'branchId', fresh.branch]] as const) {
        assert.equal((await patchCatalog(key, row.id, { active: false })).statusCode, 200);
        const value = field.endsWith('Ids') ? [row.id] : row.id;
        problem(await publish({ ...nextInput(fresh), [field]: value }), 400, 'INVALID_PUBLICATION_REFERENCE');
        await patchCatalog(key, row.id, { active: true });
        problem(await publish({ ...nextInput(fresh), [field]: field.endsWith('Ids') ? [randomUUID()] : randomUUID() }), 400, 'INVALID_PUBLICATION_REFERENCE');
      }
      problem(await publish({ ...nextInput(fresh), careerId: fresh.level.id }), 400, 'INVALID_PUBLICATION_REFERENCE');
      assert.equal(await prisma.publication.count(), before);
    });
    await t.test('duplicados de título/resumen/abstract normalizados se rechazan incluso inactivos', async () => {
      const input = nextInput();
      const first = await publish(input);
      assert.equal(first.statusCode, 201, first.body);
      for (const field of ['title', 'summary', 'abstract'] as const) {
        const transformed = input[field].normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replaceAll(' ', ' ... ');
        const duplicate = await publish({ ...nextInput(), [field]: transformed });
        problem(duplicate, 409, 'DUPLICATE_PUBLICATION');
        assert.ok(duplicate.json().invalid_params.some((param: { name: string }) => param.name === `body.${field}`));
      }
      await owner.query('UPDATE publicaciones SET activo = false WHERE id = $1', [first.json().id]);
      problem(await publish({ ...nextInput(), title: input.title }), 409, 'DUPLICATE_PUBLICATION');
    });
    await t.test('duplicado concurrente en referencias distintas es arbitrado por UNIQUE y devuelve el campo', async () => {
      const otherRefs = await catalogSet();
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const gated = prisma.$extends({ query: { publication: { findMany: async ({ args, query }) => {
        const rows = await query(args);
        if (++arrived === 2) release();
        await gate;
        return rows;
      } } } }) as unknown as PrismaClient;
      const gatedApp = await createApp(config, gated, { logger: false, security: { now: () => new Date(clock) } });
      try {
        const title = `Carrera única ${suffix} ${sequence}`;
        const inputs = [{ ...nextInput(), title }, { ...nextInput(otherRefs), title }];
        const results = await Promise.all(inputs.map((payload, index) => gatedApp.inject({ method: 'POST', url: '/api/v1/publicaciones', headers: headers[index ? 'DIGITADOR' : 'ADMINISTRADOR'], payload })));
        assert.deepEqual(results.map(result => result.statusCode).sort(), [201, 409], results.map(result => result.body).join('\n'));
        const conflict = results.find(result => result.statusCode === 409)!;
        assert.equal(conflict.json().code, 'DUPLICATE_PUBLICATION');
        assert.ok(conflict.json().invalid_params.some((param: { name: string }) => param.name === 'body.title'));
        assert.equal(await prisma.publication.count({ where: { titleHash: publicationHash(title) } }), 1);
      } finally { release(); await gatedApp.close(); }
    });
    await t.test('modalidad local, URL externa y copia obligatoria; no se acepta seguridad declarada por el cliente', async () => {
      for (const externalUrl of ['javascript:alert(1)', 'https://user:pass@example.org/doc', 'archivo.pdf']) problem(await publish({ ...nextInput(), externalUrl }), 400, 'VALIDATION_ERROR');
      problem(await publish({ ...nextInput(), source: 'LOCAL' }), 400, 'VALIDATION_ERROR');
      problem(await publish({ ...nextInput(), source: 'LOCAL', externalUrl: '' }), 400, 'VALIDATION_ERROR');
      const local = await publish({ ...nextInput(), source: 'LOCAL', externalUrl: '', requiresLibraryCopy: false });
      assert.equal(local.statusCode, 201, local.body);
      assert.equal(local.json().attachment, undefined);
      assert.equal(local.json().source, 'LOCAL');
      for (const state of ['PENDING', 'REJECTED']) {
        const file = await attachment(state);
        problem(await publish({ ...nextInput(), source: 'LOCAL', externalUrl: '', attachmentId: file.id }, 'DIGITADOR'), 409, 'ATTACHMENT_NOT_READY');
      }
      problem(await publish({ ...nextInput(), source: 'LOCAL', externalUrl: '', attachmentId: randomUUID() }), 404, 'NOT_FOUND');
      const file = await attachment();
      problem(await publish({ ...nextInput(), source: 'LOCAL', externalUrl: '', attachmentId: file.id }, 'DIGITADOR_2'), 403, 'FORBIDDEN');
      const input = { ...nextInput(), source: 'LOCAL', externalUrl: '', attachmentId: file.id };
      const good = await publish(input, 'DIGITADOR');
      assert.equal(good.statusCode, 201, good.body);
      assert.equal(good.json().attachment.sha256, file.sha256);
      assert.equal(good.json().requiresLibraryCopy, true);
      assert.equal('storageKey' in good.json().attachment, false);
      problem(await publish({ ...nextInput(), source: 'LOCAL', externalUrl: '', attachmentId: file.id }), 409, 'DUPLICATE_PUBLICATION');
      await assert.rejects(owner.query('INSERT INTO adjuntos SELECT $1,nombre,tamano,mime,sha256,$2,estado,contenido_verificado,analizado_en,creado_en,creado_por_id FROM adjuntos WHERE id = $3', [randomUUID(), randomUUID(), file.id]), error => typeof error === 'object' && error !== null && 'code' in error && error.code === '23505');
    });
    await t.test('FK reales conservan catálogos y RN02 protege al creador de publicaciones', async () => {
      for (const [key, id] of [['autores', refs.authors[0].id], ['tutores', refs.tutors[0].id], ['carreras', refs.career.id], ['niveles', refs.level.id], ['tipos', refs.type.id], ['filiales', refs.branch.id]] as const) {
        problem(await patchCatalog(key, id, { active: false }), 409, 'CATALOG_IN_USE');
        problem(await send({ method: 'DELETE', url: `/api/v1/catalogos/${key}/${id}`, headers: headers.ADMINISTRADOR }), 409, 'CATALOG_IN_USE');
      }
      const userPath = `/api/v1/usuarios/${actorIds.DIGITADOR}`;
      const detail = await send({ url: userPath, headers: headers.ADMINISTRADOR });
      problem(await send({ method: 'PATCH', url: userPath, headers: { ...headers.ADMINISTRADOR, 'if-match': String(detail.headers.etag) }, payload: { active: false } }), 409, 'USER_IN_USE');
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: actorIds.DIGITADOR } })).active, true);
    });
    await t.test('restricciones DB de tipos, participantes, orden, archivo y privilegios', async () => {
      const source = await prisma.publication.findFirstOrThrow({ where: { source: 'EXTERNA', active: true } });
      const fails = (sql: string, args: unknown[], code: string) => assert.rejects(owner.query(sql, args), error => typeof error === 'object' && error !== null && 'code' in error && error.code === code);
      await fails('UPDATE publicaciones SET carrera_tipo = $1 WHERE id = $2', ['niveles', source.id], '23514');
      await fails('UPDATE publicaciones SET carrera_id = $1 WHERE id = $2', [refs.level.id, source.id], '23503');
      await fails('INSERT INTO publicacion_autores(publicacion_id,autor_id,orden) VALUES($1,$2,0)', [source.id, randomUUID()], '23514');
      await fails('INSERT INTO publicacion_autores(publicacion_id,autor_id,orden) SELECT publicacion_id,autor_id,99 FROM publicacion_autores WHERE publicacion_id = $1 LIMIT 1', [source.id], '23505');
      await fails('DELETE FROM publicacion_autores WHERE publicacion_id = $1', [source.id], '23514');
      assert.equal(await prisma.publicationAuthor.count({ where: { publicationId: source.id } }), 2);
      const data = { title: `Directo ${suffix}`, titleHash: publicationHash(`Directo ${suffix}`), summary: `Direct summary ${suffix}`, summaryHash: publicationHash(`Direct summary ${suffix}`), abstract: `Direct abstract ${suffix}`, abstractHash: publicationHash(`Direct abstract ${suffix}`), keywords: 'económica', year: 2026, source: 'EXTERNA' as const, requiresLibraryCopy: false, externalUrl: 'https://example.org/doc', careerId: refs.career.id, levelId: refs.level.id, typeId: refs.type.id, branchId: refs.branch.id, createdById: actorIds.ADMINISTRADOR };
      await assert.rejects(prisma.publication.create({ data }), 'El trigger diferido rechaza una publicación sin autores/tutores.');
      assert.equal(await prisma.publication.count({ where: { titleHash: data.titleHash } }), 0);
      const local = await publish({ ...nextInput(), source: 'LOCAL', externalUrl: '', requiresLibraryCopy: false });
      const file = await attachment();
      await fails('UPDATE publicaciones SET adjunto_id = $1, adjunto_hash = $2 WHERE id = $3', [file.id, 'a'.repeat(64), local.json().id], '23503');
      const privileges = await prisma.$queryRaw<{ publicationDelete: boolean; attachmentInsert: boolean; auditUpdate: boolean }[]>`SELECT has_table_privilege(current_user, 'publicaciones', 'DELETE') AS "publicationDelete", has_table_privilege(current_user, 'adjuntos', 'INSERT') AS "attachmentInsert", has_table_privilege(current_user, 'auditoria', 'UPDATE') AS "auditUpdate"`;
      assert.deepEqual(privileges[0], { publicationDelete: false, attachmentInsert: false, auditUpdate: false });
    });
    await t.test('códigos únicos superan cinco dígitos y no dependen del conteo', async () => {
      await owner.query("SELECT setval('publicaciones_numero_seq', (SELECT COALESCE(max(numero), 0) + 100000 FROM publicaciones), false)");
      const responses = await Promise.all([publish(nextInput(), 'ADMINISTRADOR'), publish(nextInput(), 'DIGITADOR')]);
      assert.ok(responses.every(response => response.statusCode === 201), responses.map(response => response.body).join('\n'));
      assert.notEqual(responses[0].json().code, responses[1].json().code);
      assert.ok(responses.every(response => /^INV-\d{6,}$/.test(response.json().code)));
    });
    await t.test('rol, sesión y estado del catálogo se releen tras esperar bloqueos', async () => {
      const fresh = await catalogSet();
      const before = await prisma.publication.count();
      for (const scenario of ['role', 'inactive', 'timeout']) {
        await owner.query('BEGIN');
        let pending: ReturnType<typeof publish> | undefined;
        const savedClock = new Date(clock);
        try {
          if (scenario === 'role') await owner.query("UPDATE usuarios SET rol = 'PUBLICO' WHERE id = $1", [actorIds.DIGITADOR]);
          else if (scenario === 'inactive') await owner.query('UPDATE autores SET activo = false WHERE id = $1', [fresh.authors[0].id]);
          else await owner.query('SELECT id FROM autores WHERE id = $1 FOR UPDATE', [fresh.authors[0].id]);
          pending = publish(nextInput(fresh), 'DIGITADOR');
          await waitForLock(scenario === 'role' ? 'usuarios' : 'autores');
          if (scenario === 'timeout') clock = new Date(clock.getTime() + 600000);
          await owner.query('COMMIT');
          problem(await pending, scenario === 'role' ? 403 : scenario === 'timeout' ? 401 : 400, scenario === 'role' ? 'FORBIDDEN' : scenario === 'timeout' ? 'UNAUTHENTICATED' : 'INVALID_PUBLICATION_REFERENCE');
        } finally {
          await owner.query('ROLLBACK');
          if (pending) await pending;
          clock = savedClock;
          await owner.query("UPDATE usuarios SET rol = 'DIGITADOR' WHERE id = $1", [actorIds.DIGITADOR]);
          await owner.query('UPDATE autores SET activo = true WHERE id = $1', [fresh.authors[0].id]);
        }
      }
      assert.equal(await prisma.publication.count(), before);
    });
    await t.test('registro confirmado frente a inactivación concurrente conserva la referencia activa', async () => {
      const fresh = await catalogSet();
      let inserted!: () => void;
      let release!: () => void;
      const reached = new Promise<void>(resolve => { inserted = resolve; });
      const gate = new Promise<void>(resolve => { release = resolve; });
      const gated = prisma.$extends({ query: { publication: { create: async ({ args, query }) => { const row = await query(args); inserted(); await gate; return row; } } } }) as unknown as PrismaClient;
      const gatedApp = await createApp(config, gated, { logger: false, security: { now: () => new Date(clock) } });
      const registration = gatedApp.inject({ method: 'POST', url: '/api/v1/publicaciones', headers: headers.DIGITADOR, payload: nextInput(fresh) });
      let inactivation: ReturnType<typeof patchCatalog> | undefined;
      try {
        await reached;
        inactivation = patchCatalog('autores', fresh.authors[0].id, { active: false });
        await waitForLock('autores');
        release();
        const created = await registration;
        assert.equal(created.statusCode, 201, created.body);
        problem(await inactivation, 409, 'CATALOG_IN_USE');
      } finally { release(); await registration; if (inactivation) await inactivation; await gatedApp.close(); }
    });
    await t.test('fallo de auditoría revierte publicación, N:M, uso del adjunto y cambios de parámetros', async () => {
      let operation = 'REGISTRAR_INVESTIGACION';
      const broken = prisma.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.operation === operation) throw Error('Audit outage'); return query(args); } } } }) as unknown as PrismaClient;
      const brokenApp = await createApp(config, broken, { logger: false, security: { now: () => new Date(clock) } });
      try {
        const file = await attachment();
        const input = { ...nextInput(), source: 'LOCAL', externalUrl: '', attachmentId: file.id };
        const counts = [await prisma.publication.count(), await prisma.publicationAuthor.count(), await prisma.publicationTutor.count()];
        problem(await brokenApp.inject({ method: 'POST', url: '/api/v1/publicaciones', headers: headers.DIGITADOR, payload: input }), 503, 'AUDIT_UNAVAILABLE');
        assert.deepEqual([await prisma.publication.count(), await prisma.publicationAuthor.count(), await prisma.publicationTutor.count()], counts);
        assert.equal(await prisma.publication.count({ where: { attachmentId: file.id } }), 0);
        assert.equal((await publish(input, 'DIGITADOR')).statusCode, 201);
        operation = 'PARAMETROS_PUBLICACIONES_MODIFICADOS';
        problem(await brokenApp.inject({ method: 'PATCH', url: '/api/v1/parametros/publicaciones', headers: headers.ADMINISTRADOR, payload: { summaryWordLimit: 50 } }), 503, 'AUDIT_UNAVAILABLE');
        assert.equal((await prisma.publicationSettings.findUniqueOrThrow({ where: { id: 1 } })).summaryWordLimit, 300);
        const failures = await prisma.auditLog.count({ where: { status: 'FALLIDO', operation: 'OPERACION_RECHAZADA', userId: actorIds.DIGITADOR } });
        assert.ok(failures > 0);
      } finally { await brokenApp.close(); }
    });
  } finally {
    await owner.query('ROLLBACK');
    await owner.query('UPDATE parametros_publicaciones SET limite_palabras_resumen = 300 WHERE id = 1');
    await app.close(); await prisma.$disconnect(); await owner.end();
  }
});
