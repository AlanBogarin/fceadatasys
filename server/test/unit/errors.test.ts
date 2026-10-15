import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AppError, installErrorHandler } from '../../src/errors.js';

function fixture(options: { auditFails?: boolean; handled?: boolean } = {}) {
  const events: unknown[] = [];
  const prisma = { auditLog: { create: async (event: unknown) => { events.push(event); if (options.auditFails) throw new Error('private database credential'); return {}; } } } as unknown as PrismaClient;
  const app = Fastify({ logger: false });
  if (options.handled) app.addHook('onRequest', async request => { request.auditHandled = true; });
  installErrorHandler(app, prisma);
  return { app, events };
}

test('Problem Details preserva error de dominio y campos inválidos, sin query sensible', async t => {
  const { app, events } = fixture();
  t.after(() => app.close());
  app.get('/api/v1/usuarios/:id', async () => { throw new AppError(400, 'VALIDATION_ERROR', 'Campo no válido.', [{ name: 'name', reason: 'Requerido.' }]); });
  const response = await app.inject('/api/v1/usuarios/example?token=QUERY_SECRET');
  assert.equal(response.statusCode, 400);
  assert.match(response.headers['content-type']!, /^application\/problem\+json/);
  const body = response.json();
  assert.deepEqual({ ...body, timestamp: 'DATE' }, { type: 'about:blank', status: 400, code: 'VALIDATION_ERROR', title: 'Error de validación de datos', detail: 'Campo no válido.', timestamp: 'DATE', path: '/api/v1/usuarios/:id', invalid_params: [{ name: 'name', reason: 'Requerido.' }] });
  assert.equal(Number.isNaN(Date.parse(body.timestamp)), false);
  assert.equal(JSON.stringify([body, events]).includes('QUERY_SECRET'), false);
  assert.equal(events.length, 1);
});

test('Errores Zod y validación HTTP producen 400 con campos identificables', async t => {
  const { app } = fixture();
  t.after(() => app.close());
  app.post('/api/v1/zod', async request => z.object({ profile: z.object({ name: z.string() }) }).parse(request.body));
  app.post('/api/v1/schema', { schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } } }, async () => ({}));
  const zod = await app.inject({ method: 'POST', url: '/api/v1/zod', payload: { profile: { name: 7 } } });
  assert.equal(zod.statusCode, 400);
  assert.equal(zod.json().code, 'VALIDATION_ERROR');
  assert.equal(zod.json().invalid_params[0].name, 'profile.name');
  const missing = await app.inject({ method: 'POST', url: '/api/v1/schema', payload: {} });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().code, 'VALIDATION_ERROR');
  assert.ok(missing.json().invalid_params.length > 0);
});

test('Prisma P2002 es conflicto y errores inesperados no exponen mensajes privados', async t => {
  const { app, events } = fixture();
  t.after(() => app.close());
  app.get('/api/v1/duplicate', async () => { throw new Prisma.PrismaClientKnownRequestError('PRIVATE_DUPLICATE', { code: 'P2002', clientVersion: 'unit' }); });
  app.get('/api/v1/crash', async () => { throw new Error('PRIVATE_DATABASE_PASSWORD'); });
  const duplicate = await app.inject('/api/v1/duplicate');
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().code, 'DUPLICATE_USER');
  const crash = await app.inject('/api/v1/crash');
  assert.equal(crash.statusCode, 500);
  assert.equal(crash.json().code, 'INTERNAL_ERROR');
  assert.deepEqual(crash.json().invalid_params, []);
  assert.equal(JSON.stringify([duplicate.json(), crash.json(), events]).includes('PRIVATE_'), false);
});

test('JSON malformado y rate limit mantienen Problem Details', async t => {
  const { app } = fixture();
  t.after(() => app.close());
  app.post('/api/v1/json', async request => request.body);
  app.get('/api/v1/limited', async () => { throw Object.assign(new Error('private rate implementation'), { statusCode: 429 }); });
  const malformed = await app.inject({ method: 'POST', url: '/api/v1/json', headers: { 'content-type': 'application/json' }, payload: '{"password":' });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.json().code, 'VALIDATION_ERROR');
  const limited = await app.inject('/api/v1/limited');
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().code, 'RATE_LIMITED');
  assert.equal(limited.body.includes('private rate'), false);
});

test('Rechazo ya auditado no se duplica; caída de auditoría devuelve 503 cerrado', async t => {
  const handled = fixture({ handled: true });
  const failed = fixture({ auditFails: true });
  t.after(async () => { await handled.app.close(); await failed.app.close(); });
  for (const { app } of [handled, failed]) app.get('/api/v1/protected', async () => { throw new AppError(403, 'FORBIDDEN', 'Sin permiso.'); });
  assert.equal((await handled.app.inject('/api/v1/protected')).statusCode, 403);
  assert.equal(handled.events.length, 0);
  const response = await failed.app.inject('/api/v1/protected');
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, 'AUDIT_UNAVAILABLE');
  assert.equal(failed.events.length, 1);
  assert.equal(response.body.includes('private database credential'), false);
});

test('Ruta desconocida es 404 y salud fuera de API no escribe auditoría', async t => {
  const { app, events } = fixture();
  t.after(() => app.close());
  const response = await app.inject('/unknown?token=SECRET_QUERY');
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, 'NOT_FOUND');
  assert.equal(response.json().path, '/unknown');
  assert.equal(response.body.includes('SECRET_QUERY'), false);
  assert.equal(events.length, 0);
});
