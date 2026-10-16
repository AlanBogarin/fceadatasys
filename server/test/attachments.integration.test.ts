import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { InjectOptions } from 'fastify';
import { createApp } from '../src/app.js';
import { createPrisma } from '../src/db.js';
import type { AppConfig } from '../src/config.js';
import { AppError } from '../src/errors.js';
import { hashPassword } from '../src/security/crypto.js';
import { createClamScanner, type ScanResult } from '../src/attachments/scanner.js';
import { createAttachmentStorage, MAX_PDF_BYTES, sha256 } from '../src/attachments/storage.js';

const databaseUrl = process.env.ATTACHMENTS_TEST_DATABASE_URL;
test('Adjuntos PostgreSQL: carga, descarga, seguridad de archivos, permisos y auditoría', { skip: !databaseUrl }, async t => {
  const url = new URL(databaseUrl!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname === '/fceadatasys_attachments_test', 'Base local exclusiva de adjuntos requerida.');
  const prisma = createPrisma(databaseUrl!);
  const root = await mkdtemp(resolve('.tmp/attachments-'));
  const storage = createAttachmentStorage(root);
  const suffix = randomUUID().slice(0, 8);
  let time = new Date('2026-10-16T15:00:00Z');
  let scan: (bytes: Buffer) => Promise<ScanResult> = async () => ({ clean: true, engine: 'test-double' });
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: databaseUrl!, jwtSecret: 'attachments-test-secret-'.repeat(3), jwtIssuer: 'test', jwtAudience: 'test', allowedOrigins: ['http://localhost:5173'], secureCookies: false, recoveryUrl: 'http://localhost:5173/reset', attachments: { directory: root, command: process.env.CLAMAV_TEST_COMMAND ?? 'C:\\Program Files\\ClamAV\\clamscan.exe', database: process.env.CLAMAV_TEST_DATABASE_DIR ?? '.local/clamav/database', timeoutMs: 120000, maxSignatureAgeDays: 7, concurrency: 2 } };
  const options = { logger: false, security: { now: () => new Date(time) }, attachments: { scanner: { scan: (bytes: Buffer) => scan(bytes) }, storage } };
  const app = await createApp(config, prisma, options);
  const headers: Record<string, { authorization: string }> = {};
  const userIds: Record<string, string> = {};
  let sequence = 0;
  const send = (input: InjectOptions) => app.inject({ remoteAddress: `192.0.2.${1 + sequence++ % 250}`, ...input });
  const base = await readFile('../client/public/demo/investigacion-01.pdf');
  const pdf = (label: string = randomUUID()) => Buffer.from(base.toString('latin1').replace('%%EOF', `% ${label}\n%%EOF`), 'latin1');
  const form = (bytes: Buffer, filename = 'tesis.pdf', field = 'file', extra = '') => {
    const boundary = 'boundary-fcea-test';
    return { body: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`), bytes, Buffer.from(`\r\n${extra}--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
  };
  const upload = (bytes: Buffer, actor = 'ADMINISTRADOR', filename?: string, target = app) => {
    const payload = form(bytes, filename);
    return target.inject({ method: 'POST', url: '/api/v1/adjuntos', headers: { ...headers[actor], 'content-type': payload.contentType }, payload: payload.body, remoteAddress: `192.0.2.${1 + sequence++ % 250}` });
  };
  const problem = (response: { statusCode: number; body: string; json(): { code: string } }, status: number, code: string) => { assert.equal(response.statusCode, status, response.body); assert.equal(response.json().code, code); };
  const publish = async (attachmentId: string, actor = 'ADMINISTRADOR') => {
    const refs: Record<string, string> = {};
    for (const key of ['autores', 'tutores', 'carreras', 'niveles', 'tipos', 'filiales']) {
      const response = await send({ method: 'POST', url: `/api/v1/catalogos/${key}`, headers: headers.ADMINISTRADOR, payload: { name: `Adjuntos ${key} ${suffix} ${sequence}` } });
      assert.equal(response.statusCode, 201, response.body);
      refs[key] = response.json().id;
    }
    const text = `Investigación de adjuntos ${suffix} ${sequence}`;
    const response = await send({ method: 'POST', url: '/api/v1/publicaciones', headers: headers[actor], payload: { title: text, summary: text, abstract: text, keywords: 'investigación', authorIds: [refs.autores], tutorIds: [refs.tutores], careerId: refs.carreras, levelId: refs.niveles, typeId: refs.tipos, branchId: refs.filiales, year: 2026, approved: true, source: 'LOCAL', requiresLibraryCopy: true, attachmentId } });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<{ id: string }>();
  };
  try {
    const ciBase = randomInt(100000000000, 800000000000);
    const password = 'AttachmentTest123!';
    const passwordHash = await hashPassword(password);
    for (const [index, actor] of ['ADMINISTRADOR', 'DIGITADOR', 'OTHER', 'PUBLICO'].entries()) {
      const username = `file.${suffix}.${index}`;
      const user = await prisma.user.create({ data: { name: `Actor ${actor}`, ci: String(ciBase + index), email: `${username}@example.org`, emailKey: `${username}@example.org`, username, usernameKey: username, role: actor === 'OTHER' ? 'DIGITADOR' : actor as 'ADMINISTRADOR' | 'DIGITADOR' | 'PUBLICO', passwordHash } });
      userIds[actor] = user.id;
      const login = await send({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.allowedOrigins[0] }, payload: { username, password } });
      assert.equal(login.statusCode, 200, login.body);
      headers[actor] = { authorization: `Bearer ${login.json().accessToken}` };
    }

    await t.test('Carga y vinculación reales; descarga exacta y auditada para Admin/Digitador, nunca Público', async () => {
      const bytes = pdf();
      const created = await upload(bytes, 'DIGITADOR', 'Tesis final.pdf');
      assert.equal(created.statusCode, 201, created.body);
      const file = created.json<{ id: string; sha256: string; size: number }>();
      assert.equal(file.sha256, sha256(bytes));
      assert.equal(file.size, bytes.length);
      assert.deepEqual(Object.keys(file).sort(), ['id', 'name', 'size', 'mime', 'sha256'].sort());
      assert.equal(created.headers.location, `/api/v1/adjuntos/${file.id}`);
      assert.equal((await send({ url: created.headers.location as string, headers: headers.DIGITADOR })).statusCode, 200);
      problem(await send({ url: created.headers.location as string, headers: headers.OTHER }), 403, 'FORBIDDEN');
      const publication = await publish(file.id, 'DIGITADOR');
      const downloadUrl = `/api/v1/publicaciones/${publication.id}/adjunto`;
      for (const role of ['ADMINISTRADOR', 'DIGITADOR']) {
        const response = await send({ url: downloadUrl, headers: headers[role] });
        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(response.rawPayload, bytes);
        assert.equal(response.headers['content-type'], 'application/pdf');
        assert.equal(Number(response.headers['content-length']), bytes.length);
        assert.match(String(response.headers['content-disposition']), /attachment;.*filename\*=UTF-8''Tesis%20final.pdf/);
        assert.equal(response.headers['cache-control'], 'no-store');
        assert.equal(response.headers['x-content-type-options'], 'nosniff');
      }
      const downloads = await prisma.auditLog.count({ where: { operation: 'DESCARGAR_ADJUNTO', publicationId: publication.id } });
      for (const role of ['PUBLICO', 'anonymous']) {
        const actorHeaders = headers[role] ?? {};
        problem(await send({ url: downloadUrl, headers: actorHeaders }), role === 'PUBLICO' ? 403 : 401, role === 'PUBLICO' ? 'FORBIDDEN' : 'UNAUTHENTICATED');
        problem(await upload(pdf(), role), role === 'PUBLICO' ? 403 : 401, role === 'PUBLICO' ? 'FORBIDDEN' : 'UNAUTHENTICATED');
        problem(await send({ url: `/api/v1/adjuntos/${file.id}`, headers: actorHeaders }), role === 'PUBLICO' ? 403 : 401, role === 'PUBLICO' ? 'FORBIDDEN' : 'UNAUTHENTICATED');
      }
      assert.equal(await prisma.auditLog.count({ where: { operation: 'DESCARGAR_ADJUNTO', publicationId: publication.id } }), downloads);
      assert.equal((await send({ method: 'HEAD', url: downloadUrl, headers: headers.ADMINISTRADOR })).statusCode, 404);
      problem(await send({ url: `${downloadUrl}?force=true`, headers: headers.ADMINISTRADOR }), 400, 'VALIDATION_ERROR');
      problem(await upload(bytes), 409, 'DUPLICATE_ATTACHMENT');
      assert.equal(await prisma.storedAttachment.count({ where: { sha256: sha256(bytes) } }), 1);
      const publicDetail = await send({ url: `/api/v1/publicaciones/${publication.id}`, headers: headers.PUBLICO });
      assert.equal(publicDetail.json().hasAttachment, true);
      assert.equal(publicDetail.json().attachment, undefined);
    });

    await t.test('Formato, contenido, tamaño y contrato multipart rechazados sin persistir archivos', async () => {
      const before = (await readdir(root)).length;
      for (const [bytes, name] of [[Buffer.alloc(0), 'empty.pdf'], [Buffer.from('not-pdf'), 'false.pdf'], [pdf(), 'false.exe']] as const) problem(await upload(bytes, 'ADMINISTRADOR', name), 400, 'INVALID_ATTACHMENT');
      const oversized = await upload(Buffer.alloc(MAX_PDF_BYTES + 1));
      assert.equal(oversized.statusCode, 413, oversized.body);
      const wrong = form(pdf(), 'tesis.pdf', 'attachment');
      problem(await send({ method: 'POST', url: '/api/v1/adjuntos', headers: { ...headers.ADMINISTRADOR, 'content-type': wrong.contentType }, payload: wrong.body }), 400, 'INVALID_ATTACHMENT');
      problem(await send({ method: 'POST', url: '/api/v1/adjuntos', headers: headers.ADMINISTRADOR, payload: { file: 'fake', state: 'CLEAN' } }), 400, 'INVALID_ATTACHMENT');
      const extra = form(pdf(), 'tesis.pdf', 'file', '--boundary-fcea-test\r\nContent-Disposition: form-data; name="actorId"\r\n\r\nspoof\r\n');
      assert.ok((await send({ method: 'POST', url: '/api/v1/adjuntos', headers: { ...headers.ADMINISTRADOR, 'content-type': extra.contentType }, payload: extra.body })).statusCode >= 400);
      assert.equal((await readdir(root)).length, before);
      problem(await send({ url: '/api/v1/publicaciones/not-uuid/adjunto', headers: headers.ADMINISTRADOR }), 400, 'VALIDATION_ERROR');
      problem(await send({ url: `/api/v1/publicaciones/${randomUUID()}/adjunto`, headers: headers.ADMINISTRADOR }), 404, 'NOT_FOUND');
    });

    await t.test('ClamAV rechazado y caído nunca habilitan bytes; rechazos quedan auditados', async () => {
      const bytes = pdf();
      scan = async () => ({ clean: false, engine: 'test-double', signature: 'Win.Test.EICAR' });
      problem(await upload(bytes), 400, 'ATTACHMENT_REJECTED');
      const file = await prisma.storedAttachment.findUniqueOrThrow({ where: { sha256: sha256(bytes) } });
      assert.equal(file.state, 'REJECTED');
      assert.equal((await readdir(root)).includes(file.storageKey), false);
      assert.equal(await prisma.auditLog.count({ where: { resourceId: file.id, operation: 'ADJUNTO_RECHAZADO', status: 'FALLIDO' } }), 1);
      problem(await send({ url: `/api/v1/adjuntos/${file.id}`, headers: headers.ADMINISTRADOR }), 409, 'ATTACHMENT_NOT_READY');
      scan = async () => { throw new AppError(503, 'ANTIMALWARE_UNAVAILABLE', 'Scanner unavailable'); };
      const unavailable = pdf();
      problem(await upload(unavailable), 503, 'ANTIMALWARE_UNAVAILABLE');
      assert.equal(await prisma.storedAttachment.count({ where: { sha256: sha256(unavailable) } }), 0);
      scan = async () => ({ clean: true, engine: 'test-double' });
    });

    await t.test('Hash UNIQUE y compensación de archivos ante dos cargas simultáneas', async () => {
      const bytes = pdf();
      const before = (await readdir(root)).length;
      const responses = await Promise.all([upload(bytes), upload(bytes, 'DIGITADOR')]);
      assert.deepEqual(responses.map(response => response.statusCode).sort(), [201, 409], responses.map(response => response.body).join('\n'));
      assert.equal(await prisma.storedAttachment.count({ where: { sha256: sha256(bytes) } }), 1);
      assert.equal((await readdir(root)).length, before + 1);
    });

    await t.test('Fallo de auditoría revierte alta y archivo, y no entrega PDF en descarga', async () => {
      const faulty = prisma.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (['ADJUNTO_CARGADO', 'DESCARGAR_ADJUNTO', 'ADJUNTO_RECHAZADO'].includes(args.data.operation)) throw new Error('Audit unavailable'); return query(args); } } } }) as unknown as PrismaClient;
      const failing = await createApp(config, faulty, options);
      try {
        const bytes = pdf();
        const before = (await readdir(root)).length;
        problem(await upload(bytes, 'ADMINISTRADOR', undefined, failing), 503, 'AUDIT_UNAVAILABLE');
        assert.equal(await prisma.storedAttachment.count({ where: { sha256: sha256(bytes) } }), 0);
        assert.equal((await readdir(root)).length, before);
        const good = await upload(pdf());
        const publication = await publish(good.json().id);
        const response = await failing.inject({ url: `/api/v1/publicaciones/${publication.id}/adjunto`, headers: headers.ADMINISTRADOR });
        problem(response, 503, 'AUDIT_UNAVAILABLE');
        assert.match(String(response.headers['content-type']), /^application\/problem\+json(?:;|$)/);
        assert.equal(await prisma.auditLog.count({ where: { operation: 'DESCARGAR_ADJUNTO', publicationId: publication.id } }), 0);
        scan = async () => ({ clean: false, engine: 'test-double', signature: 'test' });
        const infected = pdf();
        problem(await upload(infected, 'ADMINISTRADOR', undefined, failing), 503, 'AUDIT_UNAVAILABLE');
        assert.equal(await prisma.storedAttachment.count({ where: { sha256: sha256(infected) } }), 0);
      } finally { scan = async () => ({ clean: true, engine: 'test-double' }); await failing.close(); }
    });

    await t.test('Descarga rechaza archivo alterado/faltante y publicación inactiva según rol', async () => {
      const bytes = pdf();
      const created = await upload(bytes);
      const file = await prisma.storedAttachment.findUniqueOrThrow({ where: { id: created.json().id } });
      const publication = await publish(file.id);
      const downloadUrl = `/api/v1/publicaciones/${publication.id}/adjunto`;
      await writeFile(join(root, file.storageKey), Buffer.alloc(bytes.length, 65));
      problem(await send({ url: downloadUrl, headers: headers.ADMINISTRADOR }), 503, 'ATTACHMENT_UNAVAILABLE');
      await unlink(join(root, file.storageKey));
      problem(await send({ url: downloadUrl, headers: headers.ADMINISTRADOR }), 503, 'ATTACHMENT_UNAVAILABLE');
      await storage.write(file.storageKey, bytes);
      await prisma.publication.update({ where: { id: publication.id }, data: { active: false } });
      problem(await send({ url: downloadUrl, headers: headers.DIGITADOR }), 404, 'NOT_FOUND');
      assert.equal((await send({ url: downloadUrl, headers: headers.ADMINISTRADOR })).statusCode, 200);
      await prisma.storedAttachment.update({ where: { id: file.id }, data: { state: 'REJECTED' } });
      problem(await send({ url: downloadUrl, headers: headers.ADMINISTRADOR }), 409, 'ATTACHMENT_NOT_READY');
    });

    await t.test('Revalida sesión después del análisis y limita cargas en curso sin cola ilimitada', async () => {
      const start = time;
      scan = async () => { time = new Date(start.getTime() + 600000); return { clean: true, engine: 'test-double' }; };
      const bytes = pdf();
      problem(await upload(bytes), 401, 'UNAUTHENTICATED');
      assert.equal(await prisma.storedAttachment.count({ where: { sha256: sha256(bytes) } }), 0);
      time = start;
      const pending: (() => void)[] = [];
      scan = () => new Promise(resolve => pending.push(() => resolve({ clean: true, engine: 'test-double' })));
      const first = Promise.resolve(upload(pdf()));
      const second = Promise.resolve(upload(pdf(), 'DIGITADOR'));
      try {
        for (let tries = 0; tries < 100 && pending.length < 2; tries++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(pending.length, 2);
        problem(await upload(pdf(), 'OTHER'), 503, 'ATTACHMENT_SERVICE_BUSY');
      } finally { pending.forEach(release => release()); await Promise.all([first, second]); scan = async () => ({ clean: true, engine: 'test-double' }); }
    });

    await t.test('ClamAV real: PDF limpio y firma propia inocua con Defender activo', { skip: process.env.CLAMAV_TEST_ENABLED !== '1' }, async () => {
      const real = await createApp(config, prisma, { logger: false, security: options.security, attachments: { storage, scanner: createClamScanner(config.attachments!) } });
      try {
        const clean = await upload(pdf(), 'DIGITADOR', 'Real ClamAV.pdf', real);
        assert.equal(clean.statusCode, 201, clean.body);
        const publication = await publish(clean.json().id, 'DIGITADOR');
        assert.equal((await real.inject({ url: `/api/v1/publicaciones/${publication.id}/adjunto`, headers: headers.DIGITADOR })).statusCode, 200);
        // A private signature for a random benign marker exercises the real
        // engine without triggering endpoint protection or modifying official DBs.
        const testDatabase = await mkdtemp(resolve('.tmp/clam-signature-test-'));
        let detecting: Awaited<ReturnType<typeof createApp>> | undefined;
        try {
          for (const name of await readdir(config.attachments!.database!)) if (/\.(?:cvd|cld)$/i.test(name)) await copyFile(join(config.attachments!.database!, name), join(testDatabase, name));
          const marker = `FCEA_BENIGN_ANTIMALWARE_TEST_${randomUUID()}`;
          await writeFile(join(testDatabase, 'fcea-test.ndb'), `FCEA.Test.Attachment:0:*:${Buffer.from(marker).toString('hex')}\n`);
          detecting = await createApp(config, prisma, { logger: false, security: options.security, attachments: { storage, scanner: createClamScanner({ ...config.attachments!, database: testDatabase }) } });
          const rejected = await upload(pdf(marker), 'ADMINISTRADOR', 'Prueba inocua.pdf', detecting);
          problem(rejected, 400, 'ATTACHMENT_REJECTED');
          const event = await prisma.auditLog.findFirstOrThrow({ where: { operation: 'ADJUNTO_RECHAZADO', after: { path: ['signature'], string_contains: 'FCEA.Test.Attachment' } }, orderBy: { createdAt: 'desc' } });
          assert.equal(event.status, 'FALLIDO');
        } finally {
          await detecting?.close();
          for (const name of await readdir(testDatabase)) await unlink(join(testDatabase, name));
          await rmdir(testDatabase);
        }
      } finally { await real.close(); }
    });
  } finally {
    await app.close();
    await prisma.$disconnect();
    for (const file of await readdir(root)) await unlink(join(root, file));
    await rmdir(root);
  }
});
