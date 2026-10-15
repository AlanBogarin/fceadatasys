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
async function clockCrossingFixture() {
  const session = storedSession();
  session.lastActivityAt = new Date(NOW.getTime() - 599999);
  let clock = new Date(NOW);
  let locks = 0;
  const writes = { sessions: [] as unknown[], tokens: [] as unknown[], audits: [] as { data: Record<string, unknown> }[] };
  const auditLog = { async create(event: { data: Record<string, unknown> }) { writes.audits.push(event); return {}; } };
  const tx = {
    async $executeRaw() { return 1; },
    async $queryRaw() { if (++locks === 2) clock = new Date(NOW.getTime() + 2); return []; },
    user: { async findUnique() { return session.user; } },
    session: { async findUnique() { return session; }, async findUniqueOrThrow() { return session; }, async update(event: unknown) { writes.sessions.push(event); return session; } },
    refreshToken: { async updateMany(event: unknown) { writes.tokens.push(event); return { count: 1 }; } }, auditLog,
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
