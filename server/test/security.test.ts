import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { PrismaClient, Role } from '@prisma/client';
import { createApp } from './helpers/integration-app.js';
import type { AppConfig } from '../src/config.js';
import { createPrisma } from '../src/db.js';
import { hashPassword, randomToken, tokenHash, verifyPassword } from '../src/security/crypto.js';
import type { Mailer } from '../src/security/mailer.js';

test('Seguridad HTTP con PostgreSQL real', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const dbUrl = new URL(process.env.TEST_DATABASE_URL!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(dbUrl.hostname) && /_test$/.test(dbUrl.pathname), 'Usa una base local aislada terminada en _test.');
  const prisma = createPrisma(process.env.TEST_DATABASE_URL!);
  let clock = new Date();
  const captured: { email: string; url: string }[] = [];
  let holdDelivery: Promise<void> | undefined;
  let failDelivery = false;
  const mailer: Mailer = {
    available: true,
    async verify() { return this.available; },
    async sendRecovery(email, url) {
      if (holdDelivery) await holdDelivery;
      if (failDelivery) throw new Error('SMTP simulado fuera de servicio');
      captured.push({ email, url });
    },
  };
  const origin = 'http://localhost:5173';
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: process.env.TEST_DATABASE_URL!,
    jwtSecret: 'test-secret-only-not-for-production-64-characters-0123456789', jwtIssuer: 'test-fcea', jwtAudience: 'test-client',
    allowedOrigins: [origin], secureCookies: false, recoveryUrl: `${origin}/reset-password` };
  const app = await createApp(config, prisma, { logger: false, security: { mailer, now: () => new Date(clock) } });
  const password = 'Segura2026!';
  const prefix = `sec_${randomUUID().slice(0, 8)}`;
  const ip = (index: number) => `2001:db8:${prefix.slice(4, 8)}:${prefix.slice(8, 12)}::${index.toString(16)}`;
  const ciPrefix = Number.parseInt(prefix.slice(4), 16).toString().padStart(10, '0');
  let counter = 0;
  const account = async (role: Role = 'PUBLICO', active = true) => {
    const ci = `${ciPrefix}${String(counter).padStart(2, '0')}`;
    const key = `${prefix}_${counter++}`;
    return prisma.user.create({ data: { name: key, ci, email: `${key}@example.invalid`, emailKey: `${key}@example.invalid`, username: key, usernameKey: key, role, active, passwordHash: await hashPassword(password) } });
  };
  const login = (username: string, secret = password) => app.inject({ method: 'POST', url: '/api/v1/auth/login', remoteAddress: `198.18.0.${Number.parseInt(tokenHash(username).slice(0, 2), 16) % 254 + 1}`, headers: { origin }, payload: { username, password: secret } });
  const bearer = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });
  const refreshCookie = (response: { headers: Record<string, unknown> }) => [response.headers['set-cookie']].flat().map(String).find(value => value.startsWith('refresh_token='))!.split(';')[0]!;
  const refresh = (cookie: string) => app.inject({ method: 'POST', url: '/api/v1/auth/refresh', remoteAddress: '198.19.0.1', headers: { origin, cookie } });
  const me = (accessToken: string) => app.inject({ method: 'GET', url: '/api/v1/me', remoteAddress: '198.19.0.2', headers: bearer(accessToken) });
  const changeOwn = (accessToken: string, currentPassword: string, newPassword: string) => app.inject({ method: 'PATCH', url: '/api/v1/me/password', remoteAddress: '198.19.0.3', headers: bearer(accessToken), payload: { currentPassword, newPassword } });
  const changeManaged = (accessToken: string, userId: string, newPassword: string) => app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${userId}/password`, remoteAddress: '198.19.0.4', headers: bearer(accessToken), payload: { newPassword } });
  const advance = (milliseconds: number) => { clock = new Date(clock.getTime() + milliseconds); };
  const recovery = (email: string, ip: string) => app.inject({ method: 'POST', url: '/api/v1/auth/recover-password', remoteAddress: ip, payload: { email } });
  try {
    await t.test('bloqueo de tres fallos concurrentes, cinco minutos y RN03', async () => {
      const user = await account();
      const attempts = await Promise.all([login(user.username, 'mal1'), login(user.username, 'mal2'), login(user.username, 'mal3')]);
      assert.deepEqual(attempts.map(result => result.statusCode), [401, 401, 401]);
      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(persisted.failures, 3);
      assert.equal(persisted.lockedUntil!.getTime() - clock.getTime(), 300000);
      assert.equal((await login(user.username)).statusCode, 401);
      advance(300001);
      assert.equal((await login(user.username)).statusCode, 200);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failures, 0);
      const inactive = await account('PUBLICO', false);
      assert.equal((await login(inactive.username, 'incorrecta')).statusCode, 401);
      const response = await login(inactive.username);
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().code, 'ACCOUNT_INACTIVE');
      const audits = await prisma.auditLog.findMany({ where: { userId: user.id, operation: 'LOGIN', status: 'FALLIDO' } });
      assert.equal(audits.length, 4);
    });

    await t.test('bloqueo no se prolonga por intentos y al quinto minuto exacto el siguiente fallo reinicia contador', async () => {
      const user = await account();
      for (let index = 0; index < 3; index++) assert.equal((await login(user.username, 'incorrecta')).statusCode, 401);
      const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      advance(299999);
      assert.equal((await login(user.username)).statusCode, 401);
      assert.equal((await login(user.username, 'incorrecta')).statusCode, 401);
      const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(unchanged.failures, 3);
      assert.equal(unchanged.lockedUntil!.toISOString(), locked.lockedUntil!.toISOString());
      advance(1);
      assert.equal((await login(user.username, 'incorrecta')).statusCode, 401);
      const restarted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(restarted.failures, 1);
      assert.equal(restarted.lockedUntil, null);
      assert.equal((await login(user.username)).statusCode, 200);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failures, 0);
    });

    await t.test('CSRF, DTO, cookie, firma JWT, issuer y revocación de usuario', async () => {
      const user = await account();
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: user.username, password } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: 'https://evil.invalid' }, payload: { username: user.username, password } })).statusCode, 403);
      const response = await login(user.username);
      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.expiresIn, 900);
      assert.equal(body.user.passwordHash, undefined);
      assert.equal(body.user.failures, undefined);
      assert.match(String(response.headers['set-cookie']), /HttpOnly/);
      assert.match(String(response.headers['set-cookie']), /SameSite=Strict/);
      assert.match(String(response.headers['set-cookie']), /Path=\/api\/v1\/auth/);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal((await me(body.accessToken)).statusCode, 200);
      assert.equal((await me(`${body.accessToken}tampered`)).statusCode, 401);
      const wrongIssuer = app.jwt.sign({ sub: user.id, sid: app.jwt.decode<{ sid: string }>(body.accessToken).sid }, { iss: 'wrong-issuer', expiresIn: 900 });
      assert.equal((await me(wrongIssuer)).statusCode, 401);
      const wrongAudience = app.jwt.sign({ sub: user.id, sid: app.jwt.decode<{ sid: string }>(body.accessToken).sid }, { aud: 'wrong-audience', expiresIn: 900 });
      assert.equal((await me(wrongAudience)).statusCode, 401);
      const expiredAccess = app.jwt.sign({ sub: user.id, sid: app.jwt.decode<{ sid: string }>(body.accessToken).sid, iat: Math.floor(Date.now() / 1000) - 1000, exp: Math.floor(Date.now() / 1000) - 1 });
      assert.equal((await me(expiredAccess)).statusCode, 401);
      const roleDenied = await app.inject({ method: 'GET', url: '/api/v1/usuarios', headers: bearer(body.accessToken) });
      assert.equal(roleDenied.statusCode, 403);
      const admin = await account('ADMINISTRADOR');
      const adminLogin = await login(admin.username);
      const adminHeaders = bearer(adminLogin.json().accessToken);
      const detail = await app.inject({ url: `/api/v1/usuarios/${user.id}`, headers: adminHeaders });
      assert.equal(detail.statusCode, 200, detail.body);
      const etag = detail.headers.etag;
      assert.equal(typeof etag, 'string', 'el detalle debe emitir un ETag para editar/inactivar');
      assert.ok(!String(etag).startsWith('W/'), 'la precondición requiere un ETag fuerte');
      const inactivated = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${user.id}`,
        headers: { ...adminHeaders, 'if-match': String(etag) }, payload: { active: false } });
      assert.equal(inactivated.statusCode, 200, inactivated.body);
      assert.equal((await me(body.accessToken)).statusCode, 401);
    });

    await t.test('rotación atómica, historial y reutilización revocan todas las sesiones', async () => {
      const user = await account();
      const first = await login(user.username);
      const another = await login(user.username);
      const cookie = refreshCookie(first);
      const rotated = await refresh(cookie);
      assert.equal(rotated.statusCode, 200);
      assert.notEqual(refreshCookie(rotated), cookie);
      const persisted = await prisma.refreshToken.findUniqueOrThrow({ where: { hash: tokenHash(cookie.split('=')[1]!) } });
      assert.ok(persisted.consumedAt);
      assert.notEqual(persisted.hash, cookie.split('=')[1]);
      assert.equal((await refresh(cookie)).statusCode, 401);
      assert.equal((await me(rotated.json().accessToken)).statusCode, 401);
      assert.equal((await me(another.json().accessToken)).statusCode, 401);
      assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { userId: user.id, operation: 'REFRESH_REUTILIZADO' } }), 1);
    });

    await t.test('refresh concurrente aplica rotación estricta y exige single-flight del cliente', async () => {
      const user = await account();
      const first = await login(user.username);
      const results = await Promise.all([refresh(refreshCookie(first)), refresh(refreshCookie(first))]);
      assert.deepEqual(results.map(result => result.statusCode).sort(), [200, 401]);
      assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 0);
    });

    await t.test('inactividad diez minutos, refresh no extiende actividad y evento explícito sí', async () => {
      const user = await account();
      const first = await login(user.username);
      advance(9 * 60000);
      const next = await refresh(refreshCookie(first));
      assert.equal(next.statusCode, 200);
      advance(60000);
      assert.equal((await refresh(refreshCookie(next))).statusCode, 401);
      const second = await login(user.username);
      advance(9 * 60000);
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/activity', headers: bearer(second.json().accessToken) })).statusCode, 204);
      advance(9 * 60000);
      assert.equal((await me(second.json().accessToken)).statusCode, 200);
      advance(60000);
      assert.equal((await me(second.json().accessToken)).statusCode, 401);
    });

    await t.test('logout revoca JWT inmediatamente, expira cookie y registra duración', async () => {
      const user = await account();
      const response = await login(user.username);
      advance(10000);
      const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { ...bearer(response.json().accessToken), origin } });
      assert.equal(logout.statusCode, 204);
      assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
      assert.equal((await me(response.json().accessToken)).statusCode, 401);
      const event = await prisma.auditLog.findFirstOrThrow({ where: { userId: user.id, operation: 'LOGOUT' } });
      assert.deepEqual(event.after, { durationSeconds: 10 });
    });

    await t.test('consulta de sesión conserva plazos y no renueva actividad ni escribe auditoría', async () => {
      const user = await account();
      const response = await login(user.username);
      const token = response.json().accessToken;
      const sid = app.jwt.decode<{ sid: string }>(token).sid;
      const before = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
      const auditCount = await prisma.auditLog.count({ where: { sessionId: sid } });
      for (let index = 0; index < 2; index++) {
        const snapshot = await app.inject({ url: '/api/v1/auth/session', headers: bearer(token) });
        assert.equal(snapshot.statusCode, 200, snapshot.body);
        assert.deepEqual(snapshot.json().session, { id: sid, createdAt: before.createdAt.toISOString(), lastActivityAt: before.lastActivityAt.toISOString(),
          expiresAt: before.expiresAt.toISOString(), idleExpiresAt: new Date(before.lastActivityAt.getTime() + 600000).toISOString() });
        assert.equal(snapshot.json().serverTime, clock.toISOString());
        assert.equal(snapshot.json().user.passwordHash, undefined);
        advance(1000);
      }
      assert.deepEqual(await prisma.session.findUniqueOrThrow({ where: { id: sid } }), before);
      assert.equal(await prisma.auditLog.count({ where: { sessionId: sid } }), auditCount);
    });

    await t.test('logout acepta JWT expirado solo para cerrar; credenciales inválidas no son autoridad', async () => {
      const user = await account();
      const response = await login(user.username);
      const sid = app.jwt.decode<{ sid: string }>(response.json().accessToken).sid;
      const expired = app.jwt.sign({ sub: user.id, sid, iat: Math.floor(Date.now() / 1000) - 1000, exp: Math.floor(Date.now() / 1000) - 1 });
      assert.equal((await me(expired)).statusCode, 401);
      assert.equal((await app.inject({ url: '/api/v1/auth/session', headers: bearer(expired) })).statusCode, 401);
      const wrongIssuer = app.jwt.sign({ sub: user.id, sid }, { iss: 'wrong-issuer', expiresIn: 900 });
      const wrongAlgorithm = app.jwt.sign({ sub: user.id, sid }, { algorithm: 'HS384', expiresIn: 900 });
      const missingExpiration = app.jwt.sign({ sub: user.id, sid });
      for (const invalid of [wrongIssuer, wrongAlgorithm, missingExpiration, `${response.json().accessToken}tampered`]) {
        const anonymous = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin, ...bearer(invalid) } });
        assert.equal(anonymous.statusCode, 204);
        assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sid } })).revokedAt, null);
      }
      const closed = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin, ...bearer(expired) } });
      assert.equal(closed.statusCode, 204, closed.body);
      assert.ok((await prisma.session.findUniqueOrThrow({ where: { id: sid } })).revokedAt);
    });

    await t.test('logout cookie permite cierre sin Bearer, repetición idempotente y no confunde identidades', async () => {
      const user = await account();
      const first = await login(user.username);
      const second = await login(user.username);
      const firstSid = app.jwt.decode<{ sid: string }>(first.json().accessToken).sid;
      const secondSid = app.jwt.decode<{ sid: string }>(second.json().accessToken).sid;
      const mismatch = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin, ...bearer(first.json().accessToken), cookie: refreshCookie(second) } });
      assert.equal(mismatch.statusCode, 403);
      assert.equal(mismatch.json().code, 'SESSION_MISMATCH');
      assert.equal(mismatch.headers['set-cookie'], undefined);
      assert.equal(await prisma.session.count({ where: { id: { in: [firstSid, secondSid] }, revokedAt: null } }), 2);
      advance(10000);
      const cookieHeaders = { origin, cookie: refreshCookie(first), authorization: 'Bearer invalid-signature' };
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: cookieHeaders })).statusCode, 204);
      const endedAt = (await prisma.session.findUniqueOrThrow({ where: { id: firstSid } })).revokedAt!;
      advance(30000);
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: cookieHeaders })).statusCode, 204);
      assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: firstSid } })).revokedAt!.toISOString(), endedAt.toISOString());
      assert.equal(await prisma.auditLog.count({ where: { sessionId: firstSid, operation: 'SESION_FINALIZADA' } }), 1);
      const events = await prisma.auditLog.findMany({ where: { sessionId: firstSid, operation: 'LOGOUT' } });
      assert.equal(events.length, 2);
      assert.ok(events.every(event => JSON.stringify(event.after) === JSON.stringify({ durationSeconds: 10 })));
      assert.equal((await me(second.json().accessToken)).statusCode, 200);
      const noOrigin = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie: refreshCookie(second) } });
      assert.equal(noOrigin.statusCode, 403);
      assert.equal(noOrigin.headers['set-cookie'], undefined);
    });

    await t.test('logout de cookie consumida cierra solo su sesión y no dispara reutilización total', async () => {
      const user = await account();
      const first = await login(user.username);
      const other = await login(user.username);
      const rotated = await refresh(refreshCookie(first));
      assert.equal(rotated.statusCode, 200);
      const closed = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin, cookie: refreshCookie(first) } });
      assert.equal(closed.statusCode, 204);
      assert.equal((await me(rotated.json().accessToken)).statusCode, 401);
      assert.equal((await me(other.json().accessToken)).statusCode, 200);
      assert.equal(await prisma.auditLog.count({ where: { userId: user.id, operation: 'REFRESH_REUTILIZADO' } }), 0);
    });

    await t.test('dos logout concurrentes responden 204 con un solo cierre y dos intentos auditados', async () => {
      const user = await account();
      const first = await login(user.username);
      const sid = app.jwt.decode<{ sid: string }>(first.json().accessToken).sid;
      advance(10000);
      const logout = () => app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin, cookie: refreshCookie(first) } });
      const responses = await Promise.all([logout(), logout()]);
      assert.deepEqual(responses.map(response => response.statusCode), [204, 204]);
      const ended = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
      assert.equal(ended.revokedAt!.toISOString(), clock.toISOString());
      assert.equal(await prisma.refreshToken.count({ where: { sessionId: sid, revokedAt: null } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { sessionId: sid, operation: 'SESION_FINALIZADA' } }), 1);
      const attempts = await prisma.auditLog.findMany({ where: { sessionId: sid, operation: 'LOGOUT' } });
      assert.equal(attempts.length, 2);
      assert.ok(attempts.every(event => JSON.stringify(event.after) === JSON.stringify({ durationSeconds: 10 })));
    });

    await t.test('inactividad finaliza una vez al plazo efectivo, revoca todos los refresh y reautenticar genera nuevo sid', async () => {
      const user = await account();
      const first = await login(user.username);
      const firstSid = app.jwt.decode<{ sid: string }>(first.json().accessToken).sid;
      const initial = await prisma.session.findUniqueOrThrow({ where: { id: firstSid } });
      advance(600000 + 120000);
      const reauthenticated = await login(user.username);
      assert.equal(reauthenticated.statusCode, 200);
      assert.notEqual(app.jwt.decode<{ sid: string }>(reauthenticated.json().accessToken).sid, firstSid);
      const closed = await prisma.session.findUniqueOrThrow({ where: { id: firstSid } });
      assert.equal(closed.revokedAt!.getTime(), initial.lastActivityAt.getTime() + 600000);
      assert.equal(await prisma.refreshToken.count({ where: { sessionId: firstSid, revokedAt: null } }), 0);
      assert.equal((await me(first.json().accessToken)).statusCode, 401);
      assert.equal((await me(first.json().accessToken)).statusCode, 401);
      assert.equal(await prisma.auditLog.count({ where: { sessionId: firstSid, operation: 'SESION_FINALIZADA' } }), 1);
      const event = await prisma.auditLog.findFirstOrThrow({ where: { sessionId: firstSid, operation: 'SESION_FINALIZADA' } });
      assert.equal((event.after as { durationSeconds: number }).durationSeconds, 600);
      assert.equal((await me(reauthenticated.json().accessToken)).statusCode, 200);
      const independent = await login(user.username);
      advance(599999);
      assert.equal((await login(user.username)).statusCode, 200);
      assert.equal((await me(independent.json().accessToken)).statusCode, 200, 'login no debe cerrar otra sesión aún activa');
    });

    await t.test('guard y logout tardíos finalizan por inactividad o vencimiento absoluto con duración efectiva', async () => {
      const user = await account();
      const first = await login(user.username);
      const sid = app.jwt.decode<{ sid: string }>(first.json().accessToken).sid;
      const initial = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
      advance(600000 + 5000);
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin, cookie: refreshCookie(first) } })).statusCode, 204);
      assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: sid } })).revokedAt!.getTime(), initial.createdAt.getTime() + 600000);
      const another = await login(user.username);
      const absoluteSid = app.jwt.decode<{ sid: string }>(another.json().accessToken).sid;
      await prisma.session.update({ where: { id: absoluteSid }, data: { expiresAt: new Date(clock.getTime() + 1000) } });
      advance(2000);
      assert.equal((await me(another.json().accessToken)).statusCode, 401);
      assert.equal(await prisma.refreshToken.count({ where: { sessionId: absoluteSid, revokedAt: null } }), 0);
      const final = await prisma.auditLog.findFirstOrThrow({ where: { sessionId: absoluteSid, operation: 'SESION_FINALIZADA' } });
      assert.equal((final.after as { reason: string }).reason, 'ABSOLUTE_EXPIRATION');
      assert.equal((final.after as { durationSeconds: number }).durationSeconds, 1);
    });

    await t.test('refresh desconocido limpia cookie y endpoints sin cuerpo rechazan propiedades extra', async () => {
      for (const cookie of ['refresh_token=bad-value', `refresh_token=${'a'.repeat(128)}`]) {
        const response = await refresh(cookie);
        assert.equal(response.statusCode, 401);
        assert.match(String(response.headers['set-cookie']), /Max-Age=0/);
      }
      const user = await account();
      const first = await login(user.username);
      for (const url of ['/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/auth/activity']) {
        const response = await app.inject({ method: 'POST', url, headers: { origin, cookie: refreshCookie(first), ...bearer(first.json().accessToken) }, payload: { actorId: user.id } });
        assert.equal(response.statusCode, 400, response.body);
        assert.equal(response.headers['set-cookie'], undefined);
      }
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/auth/activity', headers: bearer(first.json().accessToken), payload: {} })).statusCode, 204);
    });

    await t.test('login revalida username después del lock si cambió tras buscar candidato', async () => {
      const user = await account();
      let renamed = false;
      const racingPrisma = prisma.$extends({ query: { user: { async findUnique({ args, query }) {
        const found = await query(args);
        if (!renamed && args.where.usernameKey === user.usernameKey) {
          renamed = true;
          await prisma.user.update({ where: { id: user.id }, data: { username: `${user.username}_new`, usernameKey: `${user.usernameKey}_new` } });
        }
        return found;
      } } } }) as unknown as PrismaClient;
      const racing = await createApp(config, racingPrisma, { logger: false, security: { mailer, now: () => new Date(clock) } });
      try {
        const stale = await racing.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username: user.username, password } });
        assert.equal(stale.statusCode, 401, stale.body);
        assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failures, 0);
        assert.equal((await login(`${user.username}_new`)).statusCode, 200);
      } finally { await racing.close(); }
    });

    await t.test('fallo de auditoría revierte actividad y finalización en logout, guard inactivo y barrido de login', async () => {
      let blockedOperation = 'SESION_FINALIZADA';
      const failingPrisma = prisma.$extends({ query: { auditLog: { async create({ args, query }) {
        if (args.data.operation === blockedOperation) throw new Error('Fallo de auditoría simulado');
        return query(args);
      } } } }) as unknown as PrismaClient;
      const failing = await createApp(config, failingPrisma, { logger: false, security: { mailer, now: () => new Date(clock) } });
      try {
        for (const action of ['logout', 'guard', 'login', 'logout-log-event', 'activity'] as const) {
          const user = await account();
          const first = await login(user.username);
          const sid = app.jwt.decode<{ sid: string }>(first.json().accessToken).sid;
          const before = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
          blockedOperation = action === 'logout-log-event' ? 'LOGOUT' : action === 'activity' ? 'ACTIVIDAD_SESION' : 'SESION_FINALIZADA';
          if (action === 'guard' || action === 'login') advance(600000);
          if (action === 'activity') advance(1000);
          const response = action === 'guard' ? await failing.inject({ url: '/api/v1/me', headers: bearer(first.json().accessToken) }) : action === 'login'
            ? await failing.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username: user.username, password } })
            : action === 'activity' ? await failing.inject({ method: 'POST', url: '/api/v1/auth/activity', headers: bearer(first.json().accessToken) })
            : await failing.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin, cookie: refreshCookie(first) } });
          assert.equal(response.statusCode, 503, `${action}: ${response.body}`);
          assert.equal(response.headers['set-cookie'], undefined, 'no expirar cookie si la transacción se revirtió');
          assert.deepEqual(await prisma.session.findUniqueOrThrow({ where: { id: sid } }), before);
          assert.equal(await prisma.refreshToken.count({ where: { sessionId: sid, revokedAt: null } }), 1);
          assert.equal(await prisma.session.count({ where: { userId: user.id } }), 1);
          assert.equal(await prisma.auditLog.count({ where: { sessionId: sid, operation: 'SESION_FINALIZADA' } }), 0);
          assert.equal(await prisma.auditLog.count({ where: { sessionId: sid, operation: 'LOGOUT' } }), 0);
          assert.equal(await prisma.auditLog.count({ where: { sessionId: sid, operation: 'ACTIVIDAD_SESION' } }), 0);
        }
      } finally { await failing.close(); }
    });

    await t.test('cambio personal conserva sesión actual y rota refresh; administrativo conserva actor', async () => {
      const user = await account();
      const first = await login(user.username);
      const second = await login(user.username);
      const headers = bearer(first.json().accessToken);
      const unchanged = await app.inject({ method: 'PATCH', url: '/api/v1/me/password', headers, payload: { currentPassword: password, newPassword: password } });
      assert.equal(unchanged.json().code, 'PASSWORD_UNCHANGED');
      const incorrect = await app.inject({ method: 'PATCH', url: '/api/v1/me/password', headers, payload: { currentPassword: 'incorrecta', newPassword: 'Nueva2026!' } });
      assert.equal(incorrect.json().code, 'INVALID_CURRENT_PASSWORD');
      const changed = await app.inject({ method: 'PATCH', url: '/api/v1/me/password', headers, payload: { currentPassword: password, newPassword: 'Nueva2026!' } });
      assert.equal(changed.statusCode, 200);
      assert.equal((await me(changed.json().accessToken)).statusCode, 200);
      assert.equal((await me(second.json().accessToken)).statusCode, 401);
      assert.equal((await refresh(refreshCookie(changed))).statusCode, 200);
      assert.equal((await login(user.username)).statusCode, 401);
      assert.equal((await login(user.username, 'Nueva2026!')).statusCode, 200);
      const admin = await account('ADMINISTRADOR');
      const adminLogin = await login(admin.username);
      const adminChanged = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${user.id}/password`, headers: bearer(adminLogin.json().accessToken), payload: { newPassword: 'Otra2026!' } });
      assert.equal(adminChanged.statusCode, 204);
      assert.equal((await me(adminLogin.json().accessToken)).statusCode, 200);
      assert.equal((await me(changed.json().accessToken)).statusCode, 401);
      assert.equal((await login(user.username, 'Otra2026!')).statusCode, 200);
    });

    await t.test('contraseña personal por cada rol conserva plazos/sid, invalida recuperaciones y desbloquea credencial', async () => {
      for (const role of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO'] as const) {
        const user = await account(role);
        const current = await login(user.username);
        const other = await login(user.username);
        const sid = app.jwt.decode<{ sid: string }>(current.json().accessToken).sid;
        const sessionBefore = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
        await prisma.user.update({ where: { id: user.id }, data: { failures: 3, lockedUntil: new Date(clock.getTime() + 300000) } });
        const recovery = await prisma.recoveryToken.create({ data: { userId: user.id, hash: tokenHash(randomToken(32)), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
        const response = await changeOwn(current.json().accessToken, password, 'NuevaPersonal2026!');
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(app.jwt.decode<{ sid: string }>(response.json().accessToken).sid, sid);
        assert.deepEqual(await prisma.session.findUniqueOrThrow({ where: { id: sid } }), sessionBefore);
        assert.equal((await me(current.json().accessToken)).statusCode, 200, 'JWT anterior de la sesión conservada sigue autorizado');
        assert.equal((await me(other.json().accessToken)).statusCode, 401);
        assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 1);
        assert.equal(await prisma.refreshToken.count({ where: { sessionId: sid, revokedAt: null } }), 1);
        assert.ok((await prisma.refreshToken.findUniqueOrThrow({ where: { hash: tokenHash(refreshCookie(current).split('=')[1]!) } })).revokedAt);
        assert.ok((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: recovery.id } })).consumedAt);
        const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        assert.equal(saved.failures, 0);
        assert.equal(saved.lockedUntil, null);
        assert.equal(saved.role, role);
        assert.equal(saved.active, true);
        assert.equal(await verifyPassword(saved.passwordHash, 'NuevaPersonal2026!'), true);
        assert.equal(await verifyPassword(saved.passwordHash, password), false);
      }
    });

    await t.test('dos cambios personales simultáneos con contraseña actual vieja no pueden sobrescribirse', async () => {
      const user = await account();
      const current = await login(user.username);
      const next = ['Primera2026!', 'Segunda2026!'];
      const responses = await Promise.all(next.map(secret => changeOwn(current.json().accessToken, password, secret)));
      assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 400]);
      const winner = responses.findIndex(response => response.statusCode === 200);
      assert.equal(responses[1 - winner]!.json().code, 'INVALID_CURRENT_PASSWORD');
      assert.equal(responses[1 - winner]!.headers['set-cookie'], undefined);
      const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(await verifyPassword(saved.passwordHash, next[winner]!), true);
      assert.equal(await verifyPassword(saved.passwordHash, next[1 - winner]!), false);
      assert.equal((await me(current.json().accessToken)).statusCode, 200);
      assert.equal(await prisma.auditLog.count({ where: { userId: user.id, operation: 'CONTRASENA_PERSONAL_MODIFICADA' } }), 1);
    });

    await t.test('dos sesiones que cambian contraseña simultáneamente dejan vigente solo la ganadora', async () => {
      const user = await account();
      const first = await login(user.username);
      const second = await login(user.username);
      const responses = await Promise.all([changeOwn(first.json().accessToken, password, 'Primera2026!'), changeOwn(second.json().accessToken, password, 'Segunda2026!')]);
      assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 401]);
      const winner = responses.find(response => response.statusCode === 200)!;
      assert.equal((await me(winner.json().accessToken)).statusCode, 200);
      assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 1);
      assert.equal(responses.find(response => response.statusCode === 401)!.headers['set-cookie'], undefined);
    });

    await t.test('cambio personal frente a refresh conserva rotación estricta y detecta la credencial histórica', async () => {
      const user = await account();
      const current = await login(user.username);
      const [changed, refreshed] = await Promise.all([changeOwn(current.json().accessToken, password, 'NuevaConcurrente2026!'), refresh(refreshCookie(current))]);
      assert.equal(changed.statusCode, 200, changed.body);
      assert.ok([200, 401].includes(refreshed.statusCode), refreshed.body);
      const historicalCookie = refreshed.statusCode === 200 ? refreshCookie(refreshed) : refreshCookie(current);
      if (refreshed.statusCode === 200) assert.equal((await me(changed.json().accessToken)).statusCode, 200);
      assert.equal((await refresh(historicalCookie)).statusCode, 401, 'refresh invalidado por el cambio se considera reutilización');
      assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 0);
      assert.equal((await me(changed.json().accessToken)).statusCode, 401);
      assert.equal(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, 'NuevaConcurrente2026!'), true);
      assert.ok(await prisma.auditLog.count({ where: { userId: user.id, operation: 'REFRESH_REUTILIZADO' } }) >= 1);
    });

    await t.test('cambio personal frente a reset serializa credenciales sin revivir token ni sesión perdedora', async () => {
      const user = await account();
      const current = await login(user.username);
      const raw = randomToken(32);
      const recovery = await prisma.recoveryToken.create({ data: { userId: user.id, hash: tokenHash(raw), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
      const [changed, reset] = await Promise.all([
        changeOwn(current.json().accessToken, password, 'Cambio2026!'),
        app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', remoteAddress: '198.19.0.5', payload: { token: raw, newPassword: 'Reset2026!' } }),
      ]);
      assert.ok((changed.statusCode === 200 && reset.statusCode === 400) || (changed.statusCode === 401 && reset.statusCode === 204), `${changed.statusCode}/${reset.statusCode}: ${changed.body} ${reset.body}`);
      const winnerPassword = changed.statusCode === 200 ? 'Cambio2026!' : 'Reset2026!';
      assert.equal(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, winnerPassword), true);
      assert.ok((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: recovery.id } })).consumedAt);
      assert.equal((await me(current.json().accessToken)).statusCode, changed.statusCode === 200 ? 200 : 401);
    });

    await t.test('contraseña administrativa de cuenta inactiva conserva actor/estado/rol y rechaza contraseña anterior', async () => {
      const admin = await account('ADMINISTRADOR');
      const actor = await login(admin.username);
      const target = await account('PUBLICO', false);
      const response = await changeManaged(actor.json().accessToken, target.id, 'Administrada2026!');
      assert.equal(response.statusCode, 204, response.body);
      assert.equal(response.headers['set-cookie'], undefined);
      const saved = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(saved.active, false);
      assert.equal(saved.role, 'PUBLICO');
      assert.equal(await verifyPassword(saved.passwordHash, 'Administrada2026!'), true);
      assert.equal((await login(target.username)).statusCode, 401);
      const inactive = await login(target.username, 'Administrada2026!');
      assert.equal(inactive.statusCode, 403);
      assert.equal(inactive.json().code, 'ACCOUNT_INACTIVE');
      assert.equal((await me(actor.json().accessToken)).statusCode, 200);
    });

    await t.test('fallo de auditoría de cambio propio/administrativo revierte hash, bloqueo, sesiones, refresh y recuperación', async () => {
      const admin = await account('ADMINISTRADOR');
      const actor = await login(admin.username);
      let blockedOperation = '';
      const failingPrisma = prisma.$extends({ query: { auditLog: { async create({ args, query }) {
        if (args.data.operation === blockedOperation) throw new Error('Fallo de auditoría simulado');
        return query(args);
      } } } }) as unknown as PrismaClient;
      const failing = await createApp(config, failingPrisma, { logger: false, security: { mailer, now: () => new Date(clock) } });
      try {
        for (const own of [true, false]) {
          const target = await account();
          const current = await login(target.username);
          await login(target.username);
          await prisma.user.update({ where: { id: target.id }, data: { failures: 2 } });
          await prisma.recoveryToken.create({ data: { userId: target.id, hash: tokenHash(randomToken(32)), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
          const beforeUser = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
          const beforeSessions = await prisma.session.findMany({ where: { userId: target.id }, orderBy: { id: 'asc' } });
          const beforeRefresh = await prisma.refreshToken.findMany({ where: { session: { userId: target.id } }, orderBy: { id: 'asc' } });
          const beforeRecovery = await prisma.recoveryToken.findMany({ where: { userId: target.id }, orderBy: { id: 'asc' } });
          blockedOperation = own ? 'CONTRASENA_PERSONAL_MODIFICADA' : 'CONTRASENA_ADMIN_MODIFICADA';
          const response = await failing.inject({ method: 'PATCH', url: own ? '/api/v1/me/password' : `/api/v1/usuarios/${target.id}/password`,
            headers: bearer(own ? current.json().accessToken : actor.json().accessToken),
            payload: own ? { currentPassword: password, newPassword: 'Cancelada2026!' } : { newPassword: 'Cancelada2026!' } });
          assert.equal(response.statusCode, 503, response.body);
          assert.equal(response.headers['set-cookie'], undefined);
          assert.equal(response.json().accessToken, undefined);
          assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: target.id } }), beforeUser);
          assert.deepEqual(await prisma.session.findMany({ where: { userId: target.id }, orderBy: { id: 'asc' } }), beforeSessions);
          assert.deepEqual(await prisma.refreshToken.findMany({ where: { session: { userId: target.id } }, orderBy: { id: 'asc' } }), beforeRefresh);
          assert.deepEqual(await prisma.recoveryToken.findMany({ where: { userId: target.id }, orderBy: { id: 'asc' } }), beforeRecovery);
          assert.equal((await me(current.json().accessToken)).statusCode, 200);
          assert.equal((await me(actor.json().accessToken)).statusCode, 200);
        }
      } finally { await failing.close(); }
    });

    await t.test('recuperación neutral con SMTP degradado y cola desacoplada', async () => {
      const user = await account();
      mailer.available = false;
      const unavailable = await recovery(user.email, ip(1));
      const unknown = await recovery(`${prefix}_unknown@example.invalid`, ip(2));
      assert.equal(unavailable.statusCode, 200);
      assert.deepEqual(unavailable.json(), unknown.json());
      assert.equal(await prisma.recoveryToken.count({ where: { userId: user.id } }), 0);
      mailer.available = true;
      let release!: () => void;
      holdDelivery = new Promise<void>(resolve => { release = resolve; });
      const pendingResponse = recovery(user.email, ip(3));
      const timer = setTimeout(() => release(), 2000);
      const started = Date.now();
      const accepted = await pendingResponse;
      assert.ok(Date.now() - started < 1500, 'respuesta no debe esperar la entrega SMTP bloqueada');
      assert.deepEqual(accepted.json(), unknown.json());
      release(); clearTimeout(timer); holdDelivery = undefined;
      await app.security.drainMail();
      assert.ok(captured.some(item => item.email === user.email));
      failDelivery = true;
      const failed = await recovery(user.email, ip(4));
      assert.deepEqual(failed.json(), unknown.json());
      await app.security.drainMail();
      assert.equal(await prisma.auditLog.count({ where: { userId: user.id, operation: 'RECUPERACION_ENVIO_FALLIDO' } }), 1);
      failDelivery = false;
    });

    await t.test('fallo de auditoría de solicitud revierte token/límites y evita enviar correo', async () => {
      const user = await account();
      const before = captured.length;
      const failingPrisma = prisma.$extends({ query: { auditLog: { async create({ args, query }) {
        if (args.data.operation === 'RECUPERACION_SOLICITADA') throw new Error('Fallo de auditoría simulado');
        return query(args);
      } } } }) as unknown as PrismaClient;
      const failing = await createApp(config, failingPrisma, { logger: false, security: { mailer, now: () => new Date(clock) } });
      try {
        const response = await failing.inject({ method: 'POST', url: '/api/v1/auth/recover-password', remoteAddress: ip(5), payload: { email: user.email } });
        assert.equal(response.statusCode, 503, response.body);
        await failing.security.drainMail();
        assert.equal(captured.length, before);
        assert.equal(await prisma.recoveryToken.count({ where: { userId: user.id } }), 0);
        assert.equal(await prisma.recoveryRate.count({ where: { key: `email:${tokenHash(user.email)}` } }), 0);
      } finally { await failing.close(); }
    });

    await t.test('cierre ordenado espera entrega pendiente antes de cerrar SMTP', async () => {
      const user = await account();
      let release!: () => void;
      const waiting = new Promise<void>(resolve => { release = resolve; });
      const events: string[] = [];
      const closingMailer: Mailer = {
        available: true, async verify() { return true; },
        async sendRecovery() { events.push('sending'); await waiting; events.push('sent'); },
        async close() { events.push('closed'); },
      };
      const closing = await createApp(config, prisma, { logger: false, security: { mailer: closingMailer, now: () => new Date(clock) } });
      try {
        const response = await closing.inject({ method: 'POST', url: '/api/v1/auth/recover-password', remoteAddress: ip(6), payload: { email: user.email } });
        assert.equal(response.statusCode, 200, response.body);
        assert.deepEqual(events, ['sending']);
        const stopped = closing.close();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(events, ['sending']);
        release();
        await stopped;
        assert.deepEqual(events, ['sending', 'sent', 'closed']);
      } finally { release(); await closing.close(); }
    });

    await t.test('recuperación limita por correo e IP; reset es concurrente de uso único', async () => {
      const user = await account();
      const active = await login(user.username);
      const responses = [];
      for (let index = 0; index < 4; index++) responses.push(await recovery(user.email, ip(10 + index)));
      await app.security.drainMail();
      for (const response of responses) { assert.equal(response.statusCode, 200); assert.deepEqual(response.json(), responses[0]!.json()); }
      assert.equal(await prisma.recoveryToken.count({ where: { userId: user.id } }), 3);
      const link = captured.filter(item => item.email === user.email).at(-1)!;
      const raw = new URL(link.url).searchParams.get('token')!;
      assert.equal(raw.length, 64);
      const stored = await prisma.recoveryToken.findUniqueOrThrow({ where: { hash: tokenHash(raw) } });
      assert.equal(stored.expiresAt.getTime() - stored.createdAt.getTime(), 900000);
      const reset = () => app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token: raw, newPassword: 'Restablecida2026!' } });
      const results = await Promise.all([reset(), reset()]);
      assert.deepEqual(results.map(result => result.statusCode).sort(), [204, 400]);
      assert.equal((await me(active.json().accessToken)).statusCode, 401);
      assert.equal((await login(user.username, 'Restablecida2026!')).statusCode, 200);
      const other = await account();
      for (let index = 0; index < 3; index++) await recovery(`${prefix}_missing${index}@example.invalid`, ip(50));
      await recovery(other.email, ip(50));
      await app.security.drainMail();
      assert.equal(await prisma.recoveryToken.count({ where: { userId: other.id } }), 0);
      const concurrentUser = await account();
      const concurrent = await Promise.all([0, 1, 2, 3].map(index => recovery(concurrentUser.email, ip(60 + index))));
      await app.security.drainMail();
      assert.ok(concurrent.every(response => response.statusCode === 200));
      assert.equal(await prisma.recoveryToken.count({ where: { userId: concurrentUser.id } }), 3);
    });

    await t.test('reset rechaza token vencido y contraseña sin cambios sin consumir el válido', async () => {
      const user = await account();
      const expired = randomToken(32);
      await prisma.recoveryToken.create({ data: { userId: user.id, hash: tokenHash(expired), createdAt: new Date(clock.getTime() - 900000), expiresAt: clock } });
      const expiredResponse = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token: expired, newPassword: 'Otra2026!' } });
      assert.equal(expiredResponse.statusCode, 400);
      assert.equal(expiredResponse.json().code, 'INVALID_RECOVERY_TOKEN');
      const raw = randomToken(32);
      const stored = await prisma.recoveryToken.create({ data: { userId: user.id, hash: tokenHash(raw), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
      const unchanged = await app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token: raw, newPassword: password } });
      assert.equal(unchanged.statusCode, 400);
      assert.equal(unchanged.json().code, 'PASSWORD_UNCHANGED');
      assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: stored.id } })).consumedAt, null);
    });

    await t.test('fallo de auditoría revierte sesión, contador, consumo refresh y reset en PostgreSQL', async () => {
      const user = await account();
      let blockedOperation: string | undefined;
      const failingPrisma = prisma.$extends({ query: { auditLog: { async create({ args, query }) {
        if (args.data.operation === blockedOperation) throw new Error('Fallo de auditoría simulado');
        return query(args);
      } } } }) as unknown as PrismaClient;
      const failing = await createApp(config, failingPrisma, { logger: false, security: { mailer, now: () => new Date(clock) } });
      try {
        const attempt = (secret: string) => failing.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username: user.username, password: secret } });
        blockedOperation = 'LOGIN';
        assert.equal((await attempt(password)).statusCode, 503);
        assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
        assert.equal((await attempt('incorrecta')).statusCode, 503);
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failures, 0);
        blockedOperation = undefined;
        const accepted = await attempt(password);
        assert.equal(accepted.statusCode, 200);
        const cookie = refreshCookie(accepted);
        blockedOperation = 'REFRESH';
        assert.equal((await failing.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: { origin, cookie } })).statusCode, 503);
        assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { hash: tokenHash(cookie.split('=')[1]!) } })).consumedAt, null);
        const raw = randomToken(32);
        const stored = await prisma.recoveryToken.create({ data: { userId: user.id, hash: tokenHash(raw), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
        blockedOperation = 'CONTRASENA_RESTABLECIDA';
        assert.equal((await failing.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token: raw, newPassword: 'Otra2026!' } })).statusCode, 503);
        assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: stored.id } })).consumedAt, null);
        assert.equal(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, password), true);
        assert.equal(await prisma.session.count({ where: { userId: user.id, revokedAt: null } }), 1);
      } finally { await failing.close(); }
    });

    await t.test('respuestas y auditoría no exponen contraseñas ni tokens', async () => {
      const events = await prisma.auditLog.findMany({ where: { user: { username: { startsWith: prefix } } } });
      const serialized = JSON.stringify(events);
      assert.ok(!serialized.includes(password));
      assert.ok(!serialized.includes('$argon2'));
      for (const item of captured) assert.ok(!serialized.includes(new URL(item.url).searchParams.get('token')!));
      assert.ok(events.every(event => event.ip && event.operation && event.resource && event.status));
    });
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
});
