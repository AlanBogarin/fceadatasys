import test from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient, Role, Session, User } from '@prisma/client';
import { createApp } from '../helpers/unit-app.js';
import type { AppConfig } from '../../src/config.js';
import { defaultPermissions } from '../../src/security/permissions.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://catalogo.example.invalid';
const NOW = new Date('2026-10-15T12:00:00.000Z');

/** Actual Fastify/JWT/route serialization; persistence is a read-only stub, never a DB emulator. */
async function fixture(role: Role = 'PUBLICO') {
  const user: User = Object.freeze({ id: USER_ID, name: 'Persona', ci: '123456', email: 'persona@example.invalid', emailKey: 'PRIVATE_EMAIL_KEY', username: 'persona', usernameKey: 'PRIVATE_USERNAME_KEY', role, active: true, passwordHash: 'PRIVATE_PASSWORD_HASH', failures: 2, lockedUntil: null, createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-14T00:00:00Z') });
  const session: Session & { user: User } = Object.freeze({ id: SESSION_ID, userId: USER_ID, createdAt: new Date('2026-10-15T11:59:00Z'), lastActivityAt: new Date('2026-10-15T11:59:30Z'), expiresAt: new Date('2026-10-22T11:59:00Z'), revokedAt: null, browserKey: null, confirmationFailures: 0, user });
  const calls = { reads: 0, audits: [] as unknown[] };
  const prisma = { session: { findUnique: async () => { calls.reads++; return session; } }, auditLog: { create: async (event: unknown) => { calls.audits.push(event); return {}; } } } as unknown as PrismaClient;
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: 'postgresql://unused@127.0.0.1/never_connect', jwtSecret: 'unit-session-contract-secret-'.repeat(3), jwtIssuer: 'unit-issuer', jwtAudience: 'unit-audience', allowedOrigins: [ORIGIN], secureCookies: true, recoveryUrl: `${ORIGIN}/reset` };
  let time = new Date(NOW);
  const app = await createApp(config, prisma, { logger: false, security: { now: () => new Date(time), mailer: { available: false, verify: async () => false, sendRecovery: async () => { throw new Error('SMTP must not run in session contract tests'); } } } });
  const token = app.jwt.sign({ sub: USER_ID, sid: SESSION_ID, role: 'ADMINISTRADOR' }, { expiresIn: 900 });
  return { app, session, user, calls, headers: { authorization: `Bearer ${token}` }, setNow: (value: Date) => { time = value; } };
}

test('GET sesión devuelve contrato seguro con fechas UTC y rol actual para cada rol institucional', async t => {
  for (const role of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO'] as const) await t.test(role, async child => {
    const { app, session, user, calls, headers } = await fixture(role);
    child.after(() => app.close());
    const response = await app.inject({ url: '/api/v1/auth/session', headers });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), {
      user: { id: USER_ID, name: user.name, ci: user.ci, email: user.email, username: user.username, role, active: true, createdAt: user.createdAt.toISOString(), permissions: defaultPermissions[role] },
      session: { id: SESSION_ID, createdAt: session.createdAt.toISOString(), lastActivityAt: session.lastActivityAt.toISOString(), expiresAt: session.expiresAt.toISOString(), idleExpiresAt: '2026-10-15T12:09:30.000Z' },
      serverTime: NOW.toISOString(),
    });
    assert.equal(response.body.includes('PRIVATE_'), false);
    assert.deepEqual(calls.audits, []);
    assert.equal(session.lastActivityAt.toISOString(), '2026-10-15T11:59:30.000Z');
  });
});

test('Consultar sesión repetidamente no renueva plazo de inactividad ni modifica el registro', async t => {
  const { app, headers, setNow } = await fixture();
  t.after(() => app.close());
  const first = await app.inject({ url: '/api/v1/auth/session', headers });
  setNow(new Date(NOW.getTime() + 30000));
  const second = await app.inject({ url: '/api/v1/auth/session', headers });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 200, second.body);
  assert.deepEqual(second.json().session, first.json().session);
  assert.equal(second.json().serverTime, '2026-10-15T12:00:30.000Z');
});

test('Cookie refresh sin origen permitido no autoriza consulta de sesión; errores no incluyen valores enviados', async t => {
  const { app, calls } = await fixture();
  t.after(() => app.close());
  const response = await app.inject({ url: '/api/v1/auth/session?token=PRIVATE_QUERY', headers: { cookie: `refresh_token=${'f'.repeat(128)}` } });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().code, 'ORIGIN_FORBIDDEN');
  assert.equal(response.json().path, '/api/v1/auth/session');
  assert.equal(response.body.includes('PRIVATE_QUERY'), false);
  assert.equal(calls.reads, 0);
  assert.equal(calls.audits.length, 1);
});

test('JWT expirado, sin vencimiento o de otro emisor/audiencia no autoriza sesión aunque la cookie exista', async t => {
  const { app, calls } = await fixture();
  t.after(() => app.close());
  const invalidTokens = [app.jwt.sign({ sub: USER_ID, sid: SESSION_ID, exp: 1 }), app.jwt.sign({ sub: USER_ID, sid: SESSION_ID }), app.jwt.sign({ sub: USER_ID, sid: SESSION_ID }, { iss: 'other-issuer', expiresIn: 900 }), app.jwt.sign({ sub: USER_ID, sid: SESSION_ID }, { aud: 'other-audience', expiresIn: 900 })];
  for (const token of invalidTokens) {
    const response = await app.inject({ url: '/api/v1/auth/session', headers: { authorization: `Bearer ${token}`, cookie: `refresh_token=${'f'.repeat(128)}` } });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().code, 'UNAUTHENTICATED');
  }
  assert.equal(calls.reads, 0);
  assert.equal(calls.audits.length, 4);
});
