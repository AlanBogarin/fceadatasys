import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../src/errors.js';
import { audit, auditRejection, type AuditEvent } from '../../src/security/audit.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';
const TARGET_SESSION = '44444444-4444-4444-8444-444444444444';
const PASSWORD = 'body-password-must-never-be-collected';
const RAW_TOKEN = 'query-cookie-token-must-never-be-collected';

function request(authenticated = true, routeOptions: { url?: string } = { url: '/api/v1/me' }): FastifyRequest {
  return {
    ip: '192.0.2.10', headers: { 'user-agent': 'unit-test-agent', cookie: `refresh_token=${RAW_TOKEN}`, authorization: `Bearer ${RAW_TOKEN}` },
    url: `/api/v1/me?token=${RAW_TOKEN}`, routeOptions,
    body: { actorId: TARGET, role: 'ADMINISTRADOR', password: PASSWORD, newPassword: PASSWORD, token: RAW_TOKEN },
    params: { id: TARGET }, query: { token: RAW_TOKEN, userId: TARGET },
    ...(authenticated ? { auth: { userId: ACTOR, role: 'DIGITADOR', sessionId: SESSION, user: { passwordHash: 'hash-must-never-be-collected', role: 'DIGITADOR' } } } : {}),
  } as unknown as FastifyRequest;
}

function writer(write?: (data: Prisma.AuditLogCreateInput | Prisma.AuditLogUncheckedCreateInput) => Promise<void>) {
  const calls: Prisma.AuditLogCreateArgs['data'][] = [];
  const tx = { auditLog: { async create(args: Prisma.AuditLogCreateArgs) {
    calls.push(args.data);
    await write?.(args.data);
    return { id: 'inserted-audit-event' };
  } } } as unknown as Prisma.TransactionClient;
  return { tx, prisma: tx as unknown as PrismaClient, calls };
}

const success: AuditEvent = { operation: 'PERFIL_MODIFICADO', resource: 'usuarios', resourceId: ACTOR, status: 'EXITO' };

test('audit inserta mediante el cliente transaccional recibido e identidad confiable, sin recopilar body/cookies/query', async () => {
  const req = request();
  const beforeRequest = structuredClone({ body: req.body, headers: req.headers, auth: req.auth });
  const { tx, calls } = writer();
  const event: AuditEvent = { ...success, before: { name: 'Nombre anterior' }, after: { name: 'Nombre nuevo' } };
  Object.freeze(event);
  await audit(tx, req, event);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { ...event, userId: ACTOR, role: 'DIGITADOR', sessionId: SESSION, ip: '192.0.2.10', userAgent: 'unit-test-agent' });
  assert.deepEqual({ body: req.body, headers: req.headers, auth: req.auth }, beforeRequest);
  const serialized = JSON.stringify(calls);
  for (const forbidden of [PASSWORD, RAW_TOKEN, 'hash-must-never-be-collected', 'authorization', 'cookie', 'actorId']) assert.ok(!serialized.includes(forbidden), forbidden);
  assert.equal(req.auditHandled, undefined, 'escribir éxito no debe ocultar un rechazo posterior al rollback');
});

test('audit permite atribución explícita interna de login sin depender de una sesión autenticada', async () => {
  const req = request(false);
  const { tx, calls } = writer();
  await audit(tx, req, { operation: 'LOGIN', resource: 'sesiones', status: 'FALLIDO', userId: TARGET, role: 'PUBLICO', sessionId: TARGET_SESSION, detail: 'Credenciales inválidas.' });
  assert.equal(calls[0]?.userId, TARGET);
  assert.equal(calls[0]?.role, 'PUBLICO');
  assert.equal(calls[0]?.sessionId, TARGET_SESSION);
  assert.equal(calls[0]?.status, 'FALLIDO');
});

test('audit anónimo no inventa actor a partir de body, params o query', async () => {
  const { tx, calls } = writer();
  await audit(tx, request(false), { operation: 'LOGIN', resource: 'sesiones', status: 'FALLIDO' });
  assert.equal(calls[0]?.userId, undefined);
  assert.equal(calls[0]?.role, undefined);
  assert.equal(calls[0]?.sessionId, undefined);
  assert.ok(!JSON.stringify(calls).includes(TARGET));
});

test('audit mantiene overrides explícitos de evento y transporte proviene exclusivamente del request', async () => {
  const req = request();
  const { tx, calls } = writer();
  const event = { ...success, userId: TARGET, role: 'PUBLICO', sessionId: TARGET_SESSION,
    before: { active: true, role: 'PUBLICO' }, after: { active: false, role: 'PUBLICO' },
    ip: 'spoofed-event-ip', userAgent: 'spoofed-event-agent' } as AuditEvent;
  await audit(tx, req, event);
  assert.equal(calls[0]?.userId, TARGET);
  assert.equal(calls[0]?.role, 'PUBLICO');
  assert.equal(calls[0]?.sessionId, TARGET_SESSION);
  assert.deepEqual(calls[0]?.before, { active: true, role: 'PUBLICO' });
  assert.deepEqual(calls[0]?.after, { active: false, role: 'PUBLICO' });
  assert.equal(calls[0]?.ip, req.ip);
  assert.equal(calls[0]?.userAgent, req.headers['user-agent']);
});

test('audit limita IP y User-Agent a tamaños del contrato y admite User-Agent ausente', async () => {
  const req = request(false);
  Object.defineProperty(req, 'ip', { value: 'i'.repeat(90) });
  req.headers['user-agent'] = 'u'.repeat(2048);
  const { tx, calls } = writer();
  await audit(tx, req, success);
  assert.equal(calls[0]?.ip, 'i'.repeat(64));
  assert.equal(calls[0]?.userAgent, 'u'.repeat(1024));
  delete req.headers['user-agent'];
  await audit(tx, req, success);
  assert.equal(calls[1]?.userAgent, '');
});

test('audit falla cerrado con 503 y no filtra detalles de almacenamiento', async () => {
  const { tx, calls } = writer(async () => { throw new Error(`connection failed: ${PASSWORD} ${RAW_TOKEN}`); });
  const req = request();
  await assert.rejects(audit(tx, req, success), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 503);
    assert.equal(error.code, 'AUDIT_UNAVAILABLE');
    assert.ok(!error.detail.includes(PASSWORD));
    assert.ok(!error.detail.includes(RAW_TOKEN));
    return true;
  });
  assert.equal(calls.length, 1);
  assert.equal(req.auditHandled, undefined);
});

test('auditRejection conserva evento separado de rechazo y marca handled para evitar duplicados', async () => {
  const { prisma, calls } = writer();
  const req = request();
  await auditRejection(prisma, req, 'FORBIDDEN: rol insuficiente');
  await auditRejection(prisma, req, 'No debe duplicarse');
  assert.equal(calls.length, 1);
  assert.equal(req.auditHandled, true);
  assert.equal(calls[0]?.operation, 'OPERACION_RECHAZADA');
  assert.equal(calls[0]?.resource, '/api/v1/me');
  assert.equal(calls[0]?.status, 'FALLIDO');
  assert.equal(calls[0]?.detail, 'FORBIDDEN: rol insuficiente');
  assert.equal(calls[0]?.userId, ACTOR);
  assert.ok(!JSON.stringify(calls).includes(RAW_TOKEN));
});

test('auditRejection concurrente escribe una vez incluso mientras la primera inserción está pendiente', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const { prisma, calls } = writer(async () => pending);
  const req = request();
  const first = auditRejection(prisma, req, 'rechazo inicial');
  await auditRejection(prisma, req, 'rechazo duplicado');
  assert.equal(calls.length, 1);
  assert.equal(req.auditHandled, true);
  release(); await first;
});

test('auditRejection respeta handled previo sin consultar almacenamiento', async () => {
  const { prisma, calls } = writer(async () => { throw new Error('No debería alcanzarse'); });
  const req = request(); req.auditHandled = true;
  await auditRejection(prisma, req, 'Ya auditado por login');
  assert.deepEqual(calls, []);
});

test('auditRejection usa plantilla truncada o recurso http, nunca URL desconocida con token', async () => {
  const { prisma, calls } = writer();
  const unknown = request(false, {});
  await auditRejection(prisma, unknown, 'Ruta inexistente');
  assert.equal(calls[0]?.resource, 'http');
  assert.ok(!JSON.stringify(calls).includes(RAW_TOKEN));
  const registered = request(false, { url: `/api/v1/${'r'.repeat(150)}/:id` });
  await auditRejection(prisma, registered, 'Validación', 'VALIDACION_RECHAZADA');
  assert.equal(calls[1]?.resource.length, 80);
  assert.equal(calls[1]?.operation, 'VALIDACION_RECHAZADA');
});

test('auditRejection propaga fallo como 503 sin reintento duplicado ni éxito silencioso', async () => {
  const { prisma, calls } = writer(async () => { throw new Error('Insert rejected'); });
  const req = request();
  await assert.rejects(auditRejection(prisma, req, 'Operación rechazada'), { status: 503, code: 'AUDIT_UNAVAILABLE' });
  assert.equal(req.auditHandled, true);
  await auditRejection(prisma, req, 'No volver a insertar desde otro handler');
  assert.equal(calls.length, 1);
});
