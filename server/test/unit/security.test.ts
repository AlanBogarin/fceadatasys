import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import type { PrismaClient, Role, Session, User } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../src/errors.js';
import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { authenticate, requireAdmin, requireRoles, validateOrigin } from '../../src/security/index.js';
import { hashPassword, normalizeIdentity, passwordSchema, randomToken, tokenHash, verifyPassword } from '../../src/security/crypto.js';
import { createDeliverySlots } from '../../src/security/delivery-slots.js';
import { normalizeIdentity as normalizeUserIdentity, userInputSchema } from '../../src/users/schemas.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-15T12:00:00.000Z');
const VALID_CLAIMS = { sub: USER_ID, sid: SESSION_ID, iat: Math.floor(NOW.getTime() / 1000) - 60, exp: Math.floor(NOW.getTime() / 1000) + 900 };
const ORIGIN = 'https://catalogo.example.invalid';
type StoredSession = Session & { user: User };

function storedSession(role: Role = 'PUBLICO'): StoredSession {
  return {
    id: SESSION_ID, userId: USER_ID, createdAt: new Date(NOW.getTime() - 120000),
    lastActivityAt: new Date(NOW.getTime() - 60000), expiresAt: new Date(NOW.getTime() + 3600000), revokedAt: null,
    user: { id: USER_ID, name: 'Persona', ci: '123456', email: 'persona@example.invalid', emailKey: 'persona@example.invalid',
      username: 'persona', usernameKey: 'persona', role, active: true, passwordHash: 'never-expose-me', failures: 0,
      lockedUntil: null, createdAt: new Date(NOW.getTime() - 3600000), updatedAt: new Date(NOW.getTime() - 3600000) },
  };
}

/** Only the guard's read and audit contracts; no in-memory implementation of business persistence. */
function guardRequest(options: { session?: StoredSession | null; lockedSession?: StoredSession; claims?: unknown; verifyError?: Error; authorization?: string | null; auditError?: Error } = {}) {
  const session = options.session === undefined ? storedSession() : options.session;
  const calls = { verified: [] as string[], queries: [] as unknown[], audits: [] as unknown[] };
  const writes = { transactions: 0, locks: [] as unknown[], sessions: [] as unknown[], tokens: [] as unknown[] };
  const auditLog = { async create(event: unknown) {
    if (options.auditError) throw options.auditError;
    calls.audits.push(event);
    return { id: 'audit-id' };
  } };
  const current = options.lockedSession ?? session;
  const tx = {
    async $queryRaw(...query: unknown[]) { writes.locks.push(query); return []; },
    user: { async findUnique() { return current?.user; } },
    session: { async findUnique() { return current; }, async update(update: unknown) { writes.sessions.push(update); return current; } },
    refreshToken: { async updateMany(update: unknown) { writes.tokens.push(update); return { count: 1 }; } },
    auditLog,
  };
  const request = {
    headers: options.authorization === null ? {} : { authorization: options.authorization ?? 'Bearer signed-access-token' },
    ip: '192.0.2.1', routeOptions: { url: '/api/v1/me' },
    server: {
      jwt: { verify(token: string) {
        calls.verified.push(token);
        if (options.verifyError) throw options.verifyError;
        return options.claims === undefined ? { ...VALID_CLAIMS, role: 'ADMINISTRADOR' } : options.claims;
      } },
      security: { now: () => new Date(NOW), config: { allowedOrigins: [ORIGIN] }, prisma: {
        session: { async findUnique(query: unknown) { calls.queries.push(query); return session; } },
        auditLog,
        async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) { writes.transactions++; return callback(tx); },
      } },
    },
  } as unknown as FastifyRequest;
  return { request, calls, session, writes };
}

const isProblem = (status: number, code: string) => (error: unknown) => error instanceof AppError && error.status === status && error.code === code;
const runGuard = (guard: ReturnType<typeof requireRoles>, request: FastifyRequest) => (guard as (request: FastifyRequest) => Promise<void>)(request);

test('guard rechaza ausencia de Bearer antes de verificar JWT o consultar usuarios', async t => {
  for (const authorization of [null, '', 'Basic credentials', 'bearer token', 'Bearer']) {
    await t.test(String(authorization), async () => {
      const { request, calls } = guardRequest({ authorization });
      await assert.rejects(authenticate(request), isProblem(401, 'UNAUTHENTICATED'));
      assert.deepEqual(calls, { verified: [], queries: [], audits: [] });
      assert.equal(request.auth, undefined);
    });
  }
});

test('guard transforma errores del verificador JWT en 401 sin consultar persistencia', async t => {
  // Signature/issuer/audience/expiry validation belongs to the configured JWT verifier.
  // Real cryptographic verification remains covered by the PostgreSQL HTTP integration suite.
  for (const failure of ['MALFORMED_TOKEN', 'INVALID_SIGNATURE', 'INVALID_ISSUER', 'INVALID_AUDIENCE', 'TOKEN_EXPIRED']) {
    await t.test(failure, async () => {
      const { request, calls } = guardRequest({ verifyError: new Error(failure) });
      await assert.rejects(authenticate(request), isProblem(401, 'UNAUTHENTICATED'));
      assert.deepEqual(calls.verified, ['signed-access-token']);
      assert.equal(calls.queries.length, 0);
      assert.equal(request.auth, undefined);
    });
  }
});

test('guard exige sub y sid UUID y una sesión perteneciente al usuario', async t => {
  for (const claims of [null, {}, { sub: USER_ID }, { sid: SESSION_ID }, { ...VALID_CLAIMS, sub: 'actorId' }, { ...VALID_CLAIMS, sid: 'local-session' },
    { ...VALID_CLAIMS, iat: 'not-a-number' }, { ...VALID_CLAIMS, iat: Infinity }, { ...VALID_CLAIMS, exp: NaN }, { ...VALID_CLAIMS, exp: null }]) {
    await t.test(`claims ${JSON.stringify(claims)}`, async () => {
      const { request, calls } = guardRequest({ claims });
      await assert.rejects(authenticate(request), isProblem(401, 'UNAUTHENTICATED'));
      assert.equal(calls.queries.length, 0);
    });
  }
  for (const session of [null, { ...storedSession(), userId: OTHER_ID }]) {
    const { request, calls } = guardRequest({ session });
    await assert.rejects(authenticate(request), isProblem(401, 'UNAUTHENTICATED'));
    assert.deepEqual(calls.queries, [{ where: { id: SESSION_ID }, include: { user: true } }]);
    assert.equal(calls.audits.length, 0);
  }
});

test('guard rechaza cuenta inactiva, revocación, expiración e inactividad al límite y conserva duración auditada', async t => {
  const cases = [
    { name: 'cuenta inactiva', mutate: (session: StoredSession) => { session.user.active = false; } },
    { name: 'sesión revocada', mutate: (session: StoredSession) => { session.revokedAt = new Date(NOW.getTime() - 1); } },
    { name: 'vencimiento exacto', mutate: (session: StoredSession) => { session.expiresAt = new Date(NOW); } },
    { name: 'vencimiento previo', mutate: (session: StoredSession) => { session.expiresAt = new Date(NOW.getTime() - 1); } },
    { name: 'inactividad exacta 600000 ms', mutate: (session: StoredSession) => { session.lastActivityAt = new Date(NOW.getTime() - 600000); } },
    { name: 'inactividad superior', mutate: (session: StoredSession) => { session.lastActivityAt = new Date(NOW.getTime() - 600001); } },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const session = storedSession(); scenario.mutate(session);
      const before = structuredClone(session);
      const { request, calls, writes } = guardRequest({ session });
      await assert.rejects(authenticate(request), isProblem(401, 'UNAUTHENTICATED'));
      assert.deepEqual(session, before, 'el snapshot leído y la actividad no se mutan directamente');
      assert.equal(request.auth, undefined);
      assert.equal(request.auditHandled, true);
      assert.equal(calls.audits.length, session.revokedAt ? 1 : 2);
      assert.equal(writes.transactions, 1);
      assert.equal(writes.sessions.length, session.revokedAt ? 0 : 1);
      assert.equal(writes.tokens.length, 1);
      const { data } = calls.audits.find(event => (event as { data: { operation: string } }).data.operation === 'SESION_RECHAZADA') as { data: Record<string, unknown> };
      assert.equal(data.operation, 'SESION_RECHAZADA');
      assert.equal(data.status, 'FALLIDO');
      assert.equal(data.userId, USER_ID);
      assert.equal(data.sessionId, SESSION_ID);
      const endedAt = session.revokedAt ?? new Date(Math.min(NOW.getTime(), session.expiresAt.getTime(), session.lastActivityAt.getTime() + 600000));
      assert.deepEqual(data.after, { durationSeconds: Math.max(0, Math.floor((endedAt.getTime() - session.createdAt.getTime()) / 1000)), lastActivityAt: session.lastActivityAt.toISOString() });
    });
  }
});

test('guard válido toma rol actual de BD y no renueva actividad ni modifica usuarios', async () => {
  const session = storedSession('DIGITADOR');
  session.lastActivityAt = new Date(NOW.getTime() - 599999);
  const before = structuredClone(session);
  Object.freeze(session.user); Object.freeze(session);
  const { request, calls, writes } = guardRequest({ session, claims: { ...VALID_CLAIMS, role: 'ADMINISTRADOR', active: true } });
  await authenticate(request);
  assert.equal(request.auth?.role, 'DIGITADOR');
  assert.equal(request.auth?.userId, USER_ID);
  assert.equal(request.auth?.sessionId, SESSION_ID);
  assert.equal(request.auth?.user, session.user);
  assert.deepEqual(session, before);
  assert.deepEqual(calls.queries, [{ where: { id: SESSION_ID }, include: { user: true } }]);
  assert.equal(calls.audits.length, 0, 'lectura autorizada no debe escribir sesión ni auditoría de mutación');
  assert.equal(writes.transactions, 0);
  assert.deepEqual(writes.sessions, []);
  assert.deepEqual(writes.tokens, []);
});

test('guard relee bajo locks y permite actividad legítima que ganó la carrera sin finalizar sesión', async () => {
  const expiredSnapshot = storedSession(); expiredSnapshot.lastActivityAt = new Date(NOW.getTime() - 600000);
  const refreshed = storedSession('DIGITADOR'); refreshed.lastActivityAt = new Date(NOW.getTime() - 1);
  const { request, calls, writes } = guardRequest({ session: expiredSnapshot, lockedSession: refreshed });
  await authenticate(request);
  assert.equal(request.auth?.role, 'DIGITADOR');
  assert.equal(request.auth?.session.lastActivityAt, refreshed.lastActivityAt);
  assert.equal(writes.transactions, 1);
  assert.equal(writes.locks.length, 2);
  assert.deepEqual(writes.sessions, []);
  assert.deepEqual(writes.tokens, []);
  assert.deepEqual(calls.audits, []);
});

test('finalización tardía registra duración efectiva del límite y revoca todos los refresh de la sesión', async () => {
  const session = storedSession();
  session.createdAt = new Date(NOW.getTime() - 3600000);
  session.lastActivityAt = new Date(NOW.getTime() - 1800000);
  const { request, calls, writes } = guardRequest({ session });
  await assert.rejects(authenticate(request), isProblem(401, 'UNAUTHENTICATED'));
  const endedAt = new Date(session.lastActivityAt.getTime() + 600000);
  assert.deepEqual(writes.sessions, [{ where: { id: SESSION_ID }, data: { revokedAt: endedAt } }]);
  assert.deepEqual(writes.tokens, [{ where: { sessionId: SESSION_ID, revokedAt: null }, data: { revokedAt: endedAt } }]);
  const closure = calls.audits.find(event => (event as { data: { operation: string } }).data.operation === 'SESION_FINALIZADA') as { data: Record<string, unknown> };
  assert.deepEqual(closure.data.after, { reason: 'INACTIVITY', endedAt: endedAt.toISOString(), durationSeconds: 2400, lastActivityAt: session.lastActivityAt.toISOString() });
});

/** Simulates only time elapsing during locks; writes are captured, not applied in a fake database. */
async function clockCrossingFixture(adminTarget = false) {
  const session = storedSession(adminTarget ? 'ADMINISTRADOR' : 'PUBLICO');
  const target = { ...session.user, id: OTHER_ID, role: 'PUBLICO' };
  session.lastActivityAt = new Date(NOW.getTime() - 599999);
  let clock = new Date(NOW);
  let locks = 0;
  const writes = { users: [] as unknown[], sessions: [] as unknown[], tokens: [] as unknown[], recoveries: [] as unknown[], audits: [] as { data: Record<string, unknown> }[] };
  const auditLog = { async create(event: { data: Record<string, unknown> }) { writes.audits.push(event); return {}; } };
  const tx = {
    async $executeRaw() { return 1; },
    async $queryRaw(_sql: unknown, id: string) { if (adminTarget ? id === OTHER_ID : ++locks === 2) clock = new Date(NOW.getTime() + 2); return []; },
    user: { async findUnique({ where }: { where: { id: string } }) { return where.id === OTHER_ID ? target : session.user; }, async update(event: unknown) { writes.users.push(event); return target; } },
    session: { async findUnique() { return session; }, async findUniqueOrThrow() { return session; }, async update(event: unknown) { writes.sessions.push(event); return session; }, async updateMany(event: unknown) { writes.sessions.push(event); return { count: 1 }; } },
    refreshToken: { async updateMany(event: unknown) { writes.tokens.push(event); return { count: 1 }; } }, auditLog,
    recoveryToken: { async updateMany(event: unknown) { writes.recoveries.push(event); return { count: 1 }; } },
  };
  const prisma = { session: { async findUnique() { return session; } }, auditLog,
    async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) { return callback(tx); },
  } as unknown as PrismaClient;
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: 'postgresql://unused@127.0.0.1/never_connect',
    jwtSecret: 'unit-clock-regression-secret-'.repeat(3), jwtIssuer: 'unit-issuer', jwtAudience: 'unit-audience', allowedOrigins: [ORIGIN], secureCookies: true, recoveryUrl: `${ORIGIN}/reset` };
  const app = await createApp(config, prisma, { logger: false, security: { now: () => new Date(clock),
    mailer: { available: false, verify: async () => false, sendRecovery: async () => { throw new Error('SMTP no debe ejecutarse'); } },
  } });
  const token = app.jwt.sign({ sub: USER_ID, sid: SESSION_ID }, { expiresIn: 900 });
  return { app, session, writes, jwtSecret: config.jwtSecret, headers: { origin: ORIGIN, authorization: `Bearer ${token}` } };
}

test('actividad y contraseña personal no aceptan el reloj previo si la sesión vence mientras esperan locks', async t => {
  for (const endpoint of ['/api/v1/auth/activity', '/api/v1/me/password']) await t.test(endpoint, async child => {
    const { app, session, writes, headers } = await clockCrossingFixture();
    child.after(() => app.close());
    const response = await app.inject({ method: endpoint.endsWith('/activity') ? 'POST' : 'PATCH', url: endpoint, headers,
      ...(endpoint.endsWith('/password') ? { payload: { currentPassword: 'Anterior2026!', newPassword: 'Nueva2026!' } } : {}),
    });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().code, 'UNAUTHENTICATED');
    assert.deepEqual(writes.sessions, [], 'no renovar lastActivityAt con tiempo capturado antes de los locks');
    assert.deepEqual(writes.tokens, []);
    assert.equal(session.lastActivityAt.toISOString(), new Date(NOW.getTime() - 599999).toISOString());
  });
});

test('logout evalúa el deadline después de esperar locks y conserva la duración efectiva de inactividad', async t => {
  const { app, session, writes, headers } = await clockCrossingFixture();
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers });
  assert.equal(response.statusCode, 204, response.body);
  const endedAt = new Date(NOW.getTime() + 1);
  assert.deepEqual(writes.sessions, [{ where: { id: SESSION_ID }, data: { revokedAt: endedAt } }]);
  const event = writes.audits.find(event => event.data.operation === 'SESION_FINALIZADA');
  assert.deepEqual(event?.data.after, { reason: 'INACTIVITY', endedAt: endedAt.toISOString(), durationSeconds: 120, lastActivityAt: session.lastActivityAt.toISOString() });
});

test('cambio administrativo revalida actor tras esperar target y no revoca ni cambia contraseña si venció', async t => {
  const { app, writes, headers } = await clockCrossingFixture(true);
  t.after(() => app.close());
  const response = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${OTHER_ID}/password`, headers, payload: { newPassword: 'Nueva2026!' } });
  assert.equal(response.statusCode, 401, response.body);
  assert.equal(response.json().code, 'UNAUTHENTICATED');
  assert.equal(response.headers['set-cookie'], undefined);
  assert.deepEqual(writes.users, []);
  assert.deepEqual(writes.sessions, []);
  assert.deepEqual(writes.tokens, []);
  assert.deepEqual(writes.recoveries, []);
  assert.deepEqual(writes.audits.map(event => [event.data.operation, event.data.status]), [['OPERACION_RECHAZADA', 'FALLIDO']]);
});

/** Endpoint contracts with read snapshots and write spies; SQL rollback is tested separately in PostgreSQL. */
async function passwordFixture(options: { role?: Role; missingTarget?: boolean; targetInactive?: boolean; blockedAudit?: string; actorRoleAfterTarget?: Role } = {}) {
  const previousPassword = 'Anterior2026!';
  const session = storedSession(options.role ?? 'PUBLICO');
  session.user.passwordHash = await hashPassword(previousPassword);
  const target: User = { ...session.user, id: OTHER_ID, name: 'Otra persona', username: 'otra.persona', usernameKey: 'otra.persona', role: 'PUBLICO', active: !options.targetInactive };
  let targetLocked = false;
  const calls = { transactions: 0, users: [] as { where: { id: string }; data: Partial<User> }[],
    sessions: [] as unknown[], refreshUpdates: [] as unknown[], refreshCreates: [] as { data: { sessionId: string; hash: string; expiresAt: Date; createdAt: Date } }[],
    recoveries: [] as unknown[], audits: [] as { data: Record<string, unknown> }[] };
  const auditLog = { async create(event: { data: Record<string, unknown> }) {
    calls.audits.push(event);
    if (event.data.operation === options.blockedAudit) throw new Error('PRIVATE_AUDIT_ERROR');
    return {};
  } };
  const tx = {
    async $executeRaw() { return 1; },
    async $queryRaw(_sql: unknown, id: string) { if (id === OTHER_ID) targetLocked = true; return []; },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        if (where.id === OTHER_ID) return options.missingTarget ? null : target;
        return targetLocked && options.actorRoleAfterTarget ? { ...session.user, role: options.actorRoleAfterTarget } : session.user;
      },
      async update(event: { where: { id: string }; data: Partial<User> }) { calls.users.push(event); return { ...(event.where.id === OTHER_ID ? target : session.user), ...event.data }; },
    },
    session: { async findUnique() { return session; }, async updateMany(event: unknown) { calls.sessions.push(event); return { count: 1 }; } },
    refreshToken: { async updateMany(event: unknown) { calls.refreshUpdates.push(event); return { count: 1 }; },
      async create(event: typeof calls.refreshCreates[number]) { calls.refreshCreates.push(event); return {}; } },
    recoveryToken: { async updateMany(event: unknown) { calls.recoveries.push(event); return { count: 1 }; } }, auditLog,
  };
  const prisma = { session: { async findUnique() { return session; } }, auditLog,
    async $transaction(callback: (transaction: typeof tx) => Promise<unknown>) { calls.transactions++; return callback(tx); },
  } as unknown as PrismaClient;
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: 'postgresql://unused@127.0.0.1/never_connect',
    jwtSecret: 'unit-password-contract-secret-'.repeat(3), jwtIssuer: 'unit-issuer', jwtAudience: 'unit-audience', allowedOrigins: [ORIGIN], secureCookies: true, recoveryUrl: `${ORIGIN}/reset` };
  const app = await createApp(config, prisma, { logger: false, security: { now: () => new Date(NOW),
    mailer: { available: false, verify: async () => false, sendRecovery: async () => { throw new Error('SMTP must not run'); } },
  } });
  const token = app.jwt.sign({ sub: USER_ID, sid: SESSION_ID, role: 'ADMINISTRADOR' }, { expiresIn: 900 });
  return { app, calls, session, target, previousPassword, headers: { authorization: `Bearer ${token}` } };
}

test('cambio personal permite todos los roles, conserva sid, revoca otras sesiones y rota refresh sin exponer secretos', async t => {
  for (const role of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO'] as const) await t.test(role, async child => {
    const { app, calls, session, headers, previousPassword } = await passwordFixture({ role });
    child.after(() => app.close());
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/me/password', headers, payload: { currentPassword: previousPassword, newPassword: 'Nueva2026!' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().user.role, role);
    const claims = app.jwt.decode<{ sid: string }>(response.json().accessToken);
    assert.ok(claims);
    assert.equal(claims.sid, SESSION_ID);
    assert.equal(response.json().user.passwordHash, undefined);
    assert.ok(!response.body.includes('Nueva2026!'));
    assert.ok(!response.body.includes('$argon2'));
    assert.equal(calls.users.length, 1);
    assert.deepEqual(Object.keys(calls.users[0]!.data).sort(), ['failures', 'lockedUntil', 'passwordHash']);
    assert.equal(await verifyPassword(calls.users[0]!.data.passwordHash!, 'Nueva2026!'), true);
    assert.equal(await verifyPassword(calls.users[0]!.data.passwordHash!, previousPassword), false);
    assert.deepEqual(calls.sessions, [{ where: { userId: USER_ID, revokedAt: null, id: { not: SESSION_ID } }, data: { revokedAt: NOW } }]);
    assert.deepEqual(calls.recoveries, [{ where: { userId: USER_ID, consumedAt: null }, data: { consumedAt: NOW } }]);
    assert.deepEqual(calls.refreshUpdates.at(-1), { where: { sessionId: SESSION_ID, revokedAt: null }, data: { revokedAt: NOW } });
    assert.equal(calls.refreshCreates.length, 1);
    const refresh = String(response.headers['set-cookie']).split(';')[0]!.split('=')[1]!;
    assert.match(refresh, /^[a-f0-9]{128}$/);
    assert.equal(calls.refreshCreates[0]!.data.hash, tokenHash(refresh));
    assert.equal(calls.refreshCreates[0]!.data.expiresAt, session.expiresAt);
    assert.equal(session.user.passwordHash.startsWith('$argon2id$'), true);
    assert.equal(calls.audits.filter(event => event.data.operation === 'CONTRASENA_PERSONAL_MODIFICADA').length, 1);
    assert.ok(!JSON.stringify(calls.audits).includes(previousPassword));
    assert.ok(!JSON.stringify(calls.audits).includes(refresh));
  });
});

test('cambio personal rechaza actual incorrecta, contraseña igual y payload fuera del contrato sin escrituras', async t => {
  const { app, calls, headers, previousPassword } = await passwordFixture();
  t.after(() => app.close());
  const cases = [
    { payload: { currentPassword: 'Incorrecta2026!', newPassword: 'Nueva2026!' }, code: 'INVALID_CURRENT_PASSWORD' },
    { payload: { currentPassword: previousPassword, newPassword: previousPassword }, code: 'PASSWORD_UNCHANGED' },
    { payload: { newPassword: 'Nueva2026!' }, code: 'VALIDATION_ERROR' },
    { payload: { currentPassword: previousPassword, newPassword: 'weak' }, code: 'VALIDATION_ERROR' },
    { payload: { currentPassword: previousPassword, newPassword: 'Nueva2026!', actorId: OTHER_ID }, code: 'VALIDATION_ERROR' },
  ];
  for (const scenario of cases) {
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/me/password', headers, payload: scenario.payload });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, scenario.code);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  assert.deepEqual(calls.users, []);
  assert.deepEqual(calls.sessions, []);
  assert.deepEqual(calls.refreshUpdates, []);
  assert.deepEqual(calls.refreshCreates, []);
  assert.deepEqual(calls.recoveries, []);
});

test('solo Admin puede asignar contraseña ajena y el rol se revalida tras esperar al destinatario', async t => {
  for (const role of ['PUBLICO', 'DIGITADOR'] as const) await t.test(role, async child => {
    const { app, calls, headers } = await passwordFixture({ role }); child.after(() => app.close());
    const response = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${OTHER_ID}/password`, headers, payload: { newPassword: 'Nueva2026!' } });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(calls.users, []);
    assert.equal(calls.transactions, 0);
  });
  const { app, calls, headers } = await passwordFixture({ role: 'ADMINISTRADOR', actorRoleAfterTarget: 'PUBLICO' });
  t.after(() => app.close());
  const response = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${OTHER_ID}/password`, headers, payload: { newPassword: 'Nueva2026!' } });
  assert.equal(response.statusCode, 403, response.body);
  assert.deepEqual(calls.users, []);
  assert.deepEqual(calls.sessions, []);
});

test('Admin modifica contraseña de cuenta inactiva sin activarla, cambiar rol ni afectar su sesión de actor', async t => {
  const { app, calls, headers, target } = await passwordFixture({ role: 'ADMINISTRADOR', targetInactive: true });
  t.after(() => app.close());
  const response = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${OTHER_ID}/password`, headers, payload: { newPassword: 'Nueva2026!' } });
  assert.equal(response.statusCode, 204, response.body);
  assert.equal(response.headers['set-cookie'], undefined);
  assert.deepEqual(Object.keys(calls.users[0]!.data).sort(), ['failures', 'lockedUntil', 'passwordHash']);
  assert.equal(calls.users[0]!.where.id, OTHER_ID);
  assert.equal(target.active, false);
  assert.equal(target.role, 'PUBLICO');
  assert.deepEqual(calls.sessions, [{ where: { userId: OTHER_ID, revokedAt: null }, data: { revokedAt: NOW } }]);
  assert.deepEqual(calls.recoveries, [{ where: { userId: OTHER_ID, consumedAt: null }, data: { consumedAt: NOW } }]);
  assert.deepEqual(calls.refreshCreates, []);
});

test('Admin rechaza cambio propio, usuario inexistente y contraseña sin cambios sin mutaciones', async t => {
  for (const scenario of [
    { id: USER_ID, missingTarget: false, next: 'Nueva2026!', code: 'SELF_ADMIN_PASSWORD_CHANGE', status: 400 },
    { id: OTHER_ID, missingTarget: true, next: 'Nueva2026!', code: 'NOT_FOUND', status: 404 },
    { id: OTHER_ID, missingTarget: false, next: 'Anterior2026!', code: 'PASSWORD_UNCHANGED', status: 400 },
  ]) await t.test(scenario.code, async child => {
    const { app, calls, headers } = await passwordFixture({ role: 'ADMINISTRADOR', missingTarget: scenario.missingTarget });
    child.after(() => app.close());
    const response = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${scenario.id}/password`, headers, payload: { newPassword: scenario.next } });
    assert.equal(response.statusCode, scenario.status, response.body);
    assert.equal(response.json().code, scenario.code);
    assert.deepEqual(calls.users, []);
    assert.deepEqual(calls.refreshUpdates, []);
  });
});

test('cambio administrativo rechaza payload incompleto, débil o con campos ajenos sin emitir cookie', async t => {
  const { app, calls, headers } = await passwordFixture({ role: 'ADMINISTRADOR' });
  t.after(() => app.close());
  for (const payload of [{}, { newPassword: 'weak' }, { newPassword: 'Nueva2026!', role: 'ADMINISTRADOR' }, { newPassword: 'Nueva2026!', confirm: 'Nueva2026!' }]) {
    const response = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${OTHER_ID}/password`, headers, payload });
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, 'VALIDATION_ERROR');
    assert.equal(response.headers['set-cookie'], undefined);
  }
  assert.equal(calls.transactions, 0);
  assert.deepEqual(calls.users, []);
});

test('fallo auditado de cambio propio/administrativo nunca emite éxito, access token ni Set-Cookie', async t => {
  for (const own of [true, false]) await t.test(own ? 'personal' : 'administrativo', async child => {
    const operation = own ? 'CONTRASENA_PERSONAL_MODIFICADA' : 'CONTRASENA_ADMIN_MODIFICADA';
    const { app, headers, previousPassword } = await passwordFixture({ role: 'ADMINISTRADOR', blockedAudit: operation });
    child.after(() => app.close());
    const response = await app.inject({ method: 'PATCH', url: own ? '/api/v1/me/password' : `/api/v1/usuarios/${OTHER_ID}/password`, headers,
      payload: own ? { currentPassword: previousPassword, newPassword: 'Nueva2026!' } : { newPassword: 'Nueva2026!' } });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().code, 'AUDIT_UNAVAILABLE');
    assert.equal(response.json().accessToken, undefined);
    assert.equal(response.headers['set-cookie'], undefined);
    assert.ok(!response.body.includes('PRIVATE_AUDIT_ERROR'));
  });
});

test('JWT firmado con iat/exp malformados no autentica ni tiene autoridad para cerrar sesión', async t => {
  const { app, writes, jwtSecret } = await clockCrossingFixture();
  t.after(() => app.close());
  const seconds = Math.floor(Date.now() / 1000);
  const payload = { sub: USER_ID, sid: SESSION_ID, iss: 'unit-issuer', aud: 'unit-audience', iat: seconds, exp: seconds + 900 };
  const cases = [{ ...payload, iat: '123' }, { ...payload, iat: null }, { ...payload, exp: '123' }, { ...payload, exp: null },
    { ...payload, nbf: seconds + 3600 }];
  for (const claims of cases) {
    // Signer libraries reject malformed input. A real HMAC checks the verifier boundary itself.
    const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const material = `${encodedHeader}.${encodedPayload}`;
    const token = `${material}.${createHmac('sha256', jwtSecret).update(material).digest('base64url')}`;
    const headers = { origin: ORIGIN, authorization: `Bearer ${token}` };
    const session = await app.inject({ url: '/api/v1/auth/session', headers });
    assert.equal(session.statusCode, 401, session.body);
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers });
    assert.equal(logout.statusCode, 204, logout.body);
    assert.deepEqual(writes.sessions, [], 'JWT inválido no debe identificar sesión a revocar');
    assert.deepEqual(writes.tokens, []);
  }
});

test('guard falla cerrado si no puede auditar una sesión rechazada', async () => {
  const session = storedSession(); session.revokedAt = new Date(NOW);
  const { request } = guardRequest({ session, auditError: new Error('storage credentials must stay private') });
  await assert.rejects(authenticate(request), error => isProblem(503, 'AUDIT_UNAVAILABLE')(error) && !(error as Error).message.includes('credentials'));
  assert.equal(request.auth, undefined);
});

test('RBAC admite Admin real y rechaza privilegios provenientes solo del token', async () => {
  const admin = guardRequest({ session: storedSession('ADMINISTRADOR'), claims: { ...VALID_CLAIMS, role: 'PUBLICO' } });
  await runGuard(requireAdmin, admin.request);
  for (const role of ['PUBLICO', 'DIGITADOR'] as const) {
    const { request } = guardRequest({ session: storedSession(role), claims: { ...VALID_CLAIMS, role: 'ADMINISTRADOR' } });
    await assert.rejects(runGuard(requireAdmin, request), isProblem(403, 'FORBIDDEN'));
    assert.equal(request.auth?.role, role);
  }
  await runGuard(requireRoles('ADMINISTRADOR', 'DIGITADOR'), guardRequest({ session: storedSession('DIGITADOR') }).request);
  await assert.rejects(runGuard(requireRoles(), guardRequest().request), isProblem(403, 'FORBIDDEN'));
});

test('Origin/Referer exigen origen exacto y Origin no permitido no cae al Referer', async t => {
  for (const headers of [{ origin: ORIGIN }, { referer: `${ORIGIN}/reset?token=secret` }, { origin: ORIGIN, referer: 'https://evil.invalid/' }]) {
    const { request } = guardRequest(); request.headers = headers;
    await validateOrigin(request);
  }
  const denied = [ {}, { origin: 'null' }, { origin: `${ORIGIN}.evil.invalid` }, { origin: `${ORIGIN}/` },
    { origin: 'http://catalogo.example.invalid' }, { origin: `${ORIGIN}:8443` }, { referer: 'not-a-url' },
    { referer: 'https://catalogo.example.invalid.evil.invalid/' }, { origin: 'https://evil.invalid', referer: `${ORIGIN}/allowed` } ];
  for (const headers of denied) {
    await t.test(JSON.stringify(headers), async () => {
      const { request } = guardRequest(); request.headers = headers;
      await assert.rejects(validateOrigin(request), isProblem(403, 'ORIGIN_FORBIDDEN'));
    });
  }
});

test('política de contraseña conserva espacios y valida límites 8 y 128 sin aceptar solo letras/números', () => {
  for (const password of ['Abcdefg1', `A1${'x'.repeat(126)}`, ' A1     ']) assert.equal(passwordSchema.parse(password), password);
  for (const password of ['', 'Abcdef1', `A1${'x'.repeat(127)}`, 'abcdefgh', '12345678', '        ', 'Ａ１２３４５６７']) assert.equal(passwordSchema.safeParse(password).success, false);
});

test('Argon2id real usa sales distintas y verifica contraseñas exactas sin recortar', async () => {
  const secret = ' Segura2026! ';
  const [first, second] = await Promise.all([hashPassword(secret), hashPassword(secret)]);
  assert.match(first, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.notEqual(first, second, 'el mismo password no debe generar hashes deterministas');
  assert.notEqual(first.split('$')[4], second.split('$')[4]);
  assert.equal(await verifyPassword(first, secret), true);
  assert.equal(await verifyPassword(first, secret.trim()), false);
  assert.equal(await verifyPassword(first, 'Incorrecta2026!'), false);
  assert.equal(await verifyPassword('invalid-hash', secret), false);
});

test('normalización auth coincide con usuarios y payload validado para identidades Unicode', () => {
  for (const identity of ['  ＡDMIN  ', 'PERSONA@EXAMPLE.ORG', '  Iİiı  ', 'U\u0308SER', '  ÁÉÑ  ']) {
    assert.equal(normalizeIdentity(identity), normalizeUserIdentity(identity));
  }
  const input = userInputSchema.parse({ name: 'Persona', ci: '１２３４５６', email: ' ＡDMIN@EXAMPLE.ORG ', username: ' ＡDMIN ', role: 'PUBLICO', active: true });
  assert.equal(normalizeIdentity(' ＡDMIN@EXAMPLE.ORG '), input.email);
  assert.equal(normalizeIdentity(' ＡDMIN '), normalizeUserIdentity(input.username));
});

test('SHA-256 coincide con vectores conocidos; secretos refresh/reset tienen tamaño y aleatoriedad acordados', () => {
  assert.equal(tokenHash(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(tokenHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const bytes of [32, 64]) {
    const values = Array.from({ length: 8 }, () => randomToken(bytes));
    assert.equal(new Set(values).size, values.length);
    for (const value of values) { assert.equal(value.length, bytes * 2); assert.match(value, /^[a-f0-9]+$/); assert.equal(tokenHash(value).length, 64); }
  }
});

test('reservas síncronas limitan entregas concurrentes antes de esperar SQL/SMTP y se liberan una vez', async () => {
  const reserve = createDeliverySlots(2);
  let resume!: () => void;
  const smtp = new Promise<void>(resolve => { resume = resolve; });
  const jobs = [0, 1, 2].map(async () => {
    const release = reserve();
    if (!release) return false;
    try { await smtp; return true; } finally { release(); release(); }
  });
  assert.equal(await jobs[2], false);
  assert.equal(reserve(), undefined);
  resume();
  assert.deepEqual(await Promise.all(jobs), [true, true, false]);
  const first = reserve(); const second = reserve();
  assert.ok(first && second);
  assert.equal(reserve(), undefined, 'liberación duplicada no debe habilitar capacidad adicional');
  first(); second();
  const afterFailure = reserve();
  assert.throws(() => { try { throw new Error('SQL falló'); } finally { afterFailure?.(); } });
  const available = reserve(); assert.ok(available); available();
  for (const capacity of [0, -1, 1.5, Infinity, NaN]) assert.throws(() => createDeliverySlots(capacity));
});
