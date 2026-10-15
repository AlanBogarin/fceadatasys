import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import type { PrismaClient, Role } from '@prisma/client';
import type { InjectOptions } from 'fastify';
import { createApp } from '../src/app.js';
import { createPrisma } from '../src/db.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword, randomToken, tokenHash, verifyPassword } from '../src/security/crypto.js';
import { userDto } from '../src/users/dto.js';

const databaseUrl = process.env.PROFILE_TEST_DATABASE_URL;
test('perfil HTTP con PostgreSQL: identidad, actualización, unicidad y recuperación', { skip: !databaseUrl }, async t => {
  const testUrl = new URL(databaseUrl!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(testUrl.hostname) && /^\/fceadatasys_.*test$/.test(testUrl.pathname), 'Use una base local fceadatasys_*test.');
  assert.ok(!testUrl.pathname.includes('users_test'), 'El perfil comparte la base de seguridad; no añadir Admins a la base exclusiva de usuarios.');
  const prisma = createPrisma(databaseUrl!);
  const clock = new Date();
  const password = 'ProfileTest2026!';
  const passwordHash = await hashPassword(password);
  const prefix = `profile.${randomUUID().slice(0, 8)}`;
  const ciBase = randomInt(100000000000, 800000000000);
  let counter = 0;
  let caseIndex = 1;
  const origin = 'http://localhost:5173';
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: databaseUrl!, jwtSecret: 'profile-test-secret-'.repeat(4), jwtIssuer: 'profile-test', jwtAudience: 'profile-test', allowedOrigins: [origin], secureCookies: false, recoveryUrl: `${origin}/reset` };
  const app = await createApp(config, prisma, { logger: false, security: { now: () => new Date(clock) } });
  const send = (options: InjectOptions) => app.inject({ remoteAddress: `192.0.2.${caseIndex}`, ...options });
  const scenario = async (name: string, run: () => Promise<void>) => { caseIndex++; await t.test(name, run); };
  const account = async (role: Role = 'PUBLICO') => {
    const index = ++counter;
    const key = `${prefix}.${index}`;
    return prisma.user.create({ data: { name: `Perfil ${index}`, ci: String(ciBase + index), email: `${key}@example.invalid`, emailKey: `${key}@example.invalid`, username: key, usernameKey: key, role, active: true, passwordHash, createdAt: clock, updatedAt: clock } });
  };
  const login = async (username: string) => {
    const response = await send({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username, password } });
    assert.equal(response.statusCode, 200, response.json().code);
    return { headers: { authorization: `Bearer ${response.json().accessToken}` }, cookie: String(response.headers['set-cookie']).split(';')[0]! };
  };
  const patch = (headers: Record<string, string>, payload: unknown) => send({ method: 'PATCH', url: '/api/v1/me', headers, payload });
  const recovery = async (userId: string) => {
    const raw = randomToken(32);
    const token = await prisma.recoveryToken.create({ data: { userId, hash: tokenHash(raw), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
    return { raw, token };
  };
  const problem = (response: { statusCode: number; json(): { code: string } }, status: number, code: string) => { assert.equal(response.statusCode, status); assert.equal(response.json().code, code); };
  try {
    await scenario('GET/PATCH por cada rol, campos propios normalizados y sesión conservada', async () => {
      for (const role of ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO'] as const) {
        const user = await account(role);
        const active = await login(user.username);
        const sid = app.jwt.decode<{ sid: string }>(active.headers.authorization.slice(7)).sid;
        const beforeSession = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
        const read = await send({ url: '/api/v1/me?actorId=other-user', headers: active.headers });
        assert.equal(read.statusCode, 200);
        assert.deepEqual(read.json(), userDto(user));
        assert.equal(read.headers['cache-control'], 'no-store');
        const username = `${prefix}.renamed.${++counter}`;
        const response = await patch(active.headers, { email: ` NEW.${username}@EXAMPLE.INVALID `, username: ` ${username} `, ...(role === 'PUBLICO' ? { name: ` ${user.name} ` } : { name: `Actualizado ${role}` }) });
        assert.equal(response.statusCode, 200, response.json().code);
        assert.equal(response.json().id, user.id);
        assert.equal(response.json().ci, user.ci);
        assert.equal(response.json().role, role);
        assert.equal(response.json().active, true);
        assert.equal(response.json().email, `new.${username}@example.invalid`);
        assert.equal(response.json().username, username);
        assert.equal((await send({ url: '/api/v1/me', headers: active.headers })).statusCode, 200);
        const afterSession = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
        assert.equal(afterSession.revokedAt, null);
        assert.equal(afterSession.lastActivityAt.getTime(), beforeSession.lastActivityAt.getTime());
        const audit = await prisma.auditLog.findFirstOrThrow({ where: { operation: 'PERFIL_MODIFICADO', resourceId: user.id } });
        assert.equal(audit.userId, user.id);
        assert.equal(audit.role, role);
        assert.equal(audit.sessionId, sid);
        assert.deepEqual(audit.before, userDto(user));
        assert.deepEqual(audit.after, response.json());
        const oldLogin = await send({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { username: user.username, password } });
        problem(oldLogin, 401, 'INVALID_CREDENTIALS');
        await login(username);
      }
    });

    await scenario('rechaza anónimo, campos prohibidos, inválidos, cuerpo vacío y nombre Público', async () => {
      const user = await account();
      const active = await login(user.username);
      problem(await send({ url: '/api/v1/me' }), 401, 'UNAUTHENTICATED');
      problem(await patch({}, { email: 'valid@example.invalid' }), 401, 'UNAUTHENTICATED');
      for (const field of ['id', 'actorId', 'userId', 'ci', 'role', 'active', 'password', 'passwordHash', 'failures', 'createdAt', 'updatedAt']) problem(await patch(active.headers, { email: 'valid@example.invalid', [field]: 'ATTACK_VALUE' }), 400, 'VALIDATION_ERROR');
      for (const payload of [{}, { email: 'bad-email' }, { username: 'with space' }, { name: 'x'.repeat(101) }]) problem(await patch(active.headers, payload), 400, 'VALIDATION_ERROR');
      problem(await patch(active.headers, { name: 'Nombre cambiado' }), 400, 'PUBLIC_NAME_READONLY');
      assert.deepEqual(userDto(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })), userDto(user));
    });

    await scenario('unicidad normalizada de email/username en edición y peticiones concurrentes', async () => {
      const first = await account();
      const second = await account();
      const secondSession = await login(second.username);
      problem(await patch(secondSession.headers, { email: first.email.toUpperCase() }), 409, 'DUPLICATE_USER');
      problem(await patch(secondSession.headers, { username: first.username.toUpperCase() }), 409, 'DUPLICATE_USER');
      for (const field of ['email', 'username'] as const) {
        const left = await account();
        const right = await account();
        const leftSession = await login(left.username);
        const rightSession = await login(right.username);
        const key = `${prefix}.shared.${++counter}`;
        const value = field === 'email' ? `${key}@example.invalid` : key;
        const responses = await Promise.all([patch(leftSession.headers, { [field]: value }), patch(rightSession.headers, { [field]: value.toUpperCase() })]);
        assert.deepEqual(responses.map(response => response.statusCode).sort(), [200, 409]);
        assert.equal(responses.find(response => response.statusCode === 409)!.json().code, 'DUPLICATE_USER');
        assert.equal(await prisma.user.count({ where: field === 'email' ? { emailKey: value } : { usernameKey: value } }), 1);
      }
    });

    await scenario('cambiar correo invalida enlaces antiguos; cambiar username/correo equivalente los conserva', async () => {
      const user = await account();
      const active = await login(user.username);
      const old = await recovery(user.id);
      assert.equal((await patch(active.headers, { email: ` ${user.email.toUpperCase()} ` })).statusCode, 200);
      assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: old.token.id } })).consumedAt, null);
      const newUsername = `${prefix}.equivalent.${++counter}`;
      assert.equal((await patch(active.headers, { username: newUsername })).statusCode, 200);
      assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: old.token.id } })).consumedAt, null);
      const second = await recovery(user.id);
      const response = await patch(active.headers, { email: `changed.${newUsername}@example.invalid` });
      assert.equal(response.statusCode, 200);
      for (const token of [old.token, second.token]) assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: token.id } })).consumedAt?.getTime(), clock.getTime());
      problem(await send({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token: old.raw, newPassword: 'Different2026!' } }), 400, 'INVALID_RECOVERY_TOKEN');
      assert.equal(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, password), true);
      assert.equal((await send({ url: '/api/v1/me', headers: active.headers })).statusCode, 200);
      assert.equal((await send({ method: 'POST', url: '/api/v1/auth/refresh', headers: { origin, cookie: active.cookie } })).statusCode, 200);
    });

    await scenario('correo administrativo consume recuperación y conserva sesiones; perfil vuelve stale su ETag', async () => {
      const admin = await account('ADMINISTRADOR');
      const adminSession = await login(admin.username);
      const target = await account();
      const active = await login(target.username);
      const old = await recovery(target.id);
      const url = `/api/v1/usuarios/${target.id}`;
      const first = await send({ url, headers: adminSession.headers });
      assert.equal(first.statusCode, 200);
      const edit = await send({ method: 'PATCH', url, headers: { ...adminSession.headers, 'if-match': String(first.headers.etag) }, payload: { email: `admin.changed.${prefix}@example.invalid` } });
      assert.equal(edit.statusCode, 200, edit.json().code);
      assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: old.token.id } })).consumedAt?.getTime(), clock.getTime());
      assert.equal((await send({ url: '/api/v1/me', headers: active.headers })).statusCode, 200);
      problem(await send({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token: old.raw, newPassword: 'Different2026!' } }), 400, 'INVALID_RECOVERY_TOKEN');
      const precarga = await send({ url, headers: adminSession.headers });
      assert.equal((await patch(active.headers, { username: `${prefix}.profile.changed.${++counter}` })).statusCode, 200);
      problem(await send({ method: 'PATCH', url, headers: { ...adminSession.headers, 'if-match': String(precarga.headers.etag) }, payload: { active: false } }), 412, 'USER_VERSION_CONFLICT');
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).active, true);
    });

    await scenario('auditoría fallida revierte perfil, correo y recuperación pendiente', async () => {
      const user = await account('DIGITADOR');
      const active = await login(user.username);
      const old = await recovery(user.id);
      const blocked = prisma.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.operation === 'PERFIL_MODIFICADO') throw new Error('Simulated audit outage'); return query(args); } } } }) as unknown as PrismaClient;
      const failing = await createApp(config, blocked, { logger: false, security: { now: () => new Date(clock) } });
      try {
        const response = await failing.inject({ method: 'PATCH', url: '/api/v1/me', headers: active.headers, payload: { name: 'Nuevo nombre', email: `rollback.${prefix}@example.invalid`, username: `${prefix}.rollback` } });
        problem(response, 503, 'AUDIT_UNAVAILABLE');
        assert.deepEqual(userDto(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })), userDto(user));
        assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: old.token.id } })).consumedAt, null);
        assert.equal(await prisma.auditLog.count({ where: { operation: 'PERFIL_MODIFICADO', resourceId: user.id, status: 'EXITO' } }), 0);
        assert.equal((await send({ url: '/api/v1/me', headers: active.headers })).statusCode, 200);
      } finally { await failing.close(); }
    });
  } finally { await app.close(); await prisma.$disconnect(); }
});
