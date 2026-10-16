import test from 'node:test';
import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import type { PrismaClient, User } from '@prisma/client';
import type { InjectOptions } from 'fastify';
import { createApp } from '../src/app.js';
import { createPrisma } from '../src/db.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword, randomToken, tokenHash, verifyPassword } from '../src/security/crypto.js';
import { userDto } from '../src/users/dto.js';
import type { UserInput } from '../src/users/schemas.js';

const databaseUrl = process.env.USERS_TEST_DATABASE_URL;
test('usuarios PostgreSQL: contratos, permisos, concurrencia, unicidad y rollback de auditoría', { skip: !databaseUrl }, async t => {
  const testUrl = new URL(databaseUrl!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(testUrl.hostname) && /^\/fceadatasys_.*test$/.test(testUrl.pathname), 'Las pruebas requieren PostgreSQL local y una base fceadatasys_*test explícita.');
  const prisma = createPrisma(databaseUrl!);
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: databaseUrl!, jwtSecret: 'test-secret-users-'.repeat(4), jwtIssuer: 'test', jwtAudience: 'test', allowedOrigins: ['http://localhost:5173'], secureCookies: false, recoveryUrl: 'http://localhost:5173/reset' };
  const password = 'SecureTest123!';
  const passwordHash = await hashPassword(password);
  // Fixed fixtures allow repeats without deleting immutable historical audit logs.
  const unexpectedAdmin = await prisma.user.count({ where: { role: 'ADMINISTRADOR', usernameKey: { notIn: ['fixture.admin.a', 'fixture.admin.b'] } } });
  assert.equal(unexpectedAdmin, 0, 'Use una base de pruebas exclusiva para usuarios.');
  const admins: User[] = [];
  for (let index = 0; index < 2; index++) {
    const username = `fixture.admin.${index === 0 ? 'a' : 'b'}`;
    admins.push(await prisma.user.upsert({ where: { usernameKey: username }, create: { name: `Administrador ${index}`, ci: `10000000${index}`, email: `${username}@example.org`, emailKey: `${username}@example.org`, username, usernameKey: username, role: 'ADMINISTRADOR', active: true, passwordHash }, update: { active: true, role: 'ADMINISTRADOR', passwordHash, failures: 0, lockedUntil: null } }));
  }
  let clock = new Date('2026-10-15T12:00:00Z');
  const app = await createApp(config, prisma, { logger: false, security: { now: () => new Date(clock) } });
  const login = async (username: string) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.allowedOrigins[0] }, payload: { username, password } });
    assert.equal(response.statusCode, 200, response.body);
    return { authorization: `Bearer ${response.json().accessToken}` };
  };
  try {
    const headers = await login(admins[0].username);
    const status = await app.inject({ url: '/api/v1/status', headers });
    assert.equal(status.statusCode, 200);
    assert.deepEqual(status.json(), { status: 'degraded', smtp: 'unavailable' });
    const suffix = randomUUID().slice(0, 8);
    const input = { name: 'Cuenta Pública', ci: String(Math.floor(100000000000 + Math.random() * 800000000000)), email: `public.${suffix}@example.org`, username: `public.${suffix}`, role: 'PUBLICO', active: true, password };
    let caseIndex = 1;
    let accountIndex = 0;
    const ciBase = randomInt(100000000000, 800000000000);
    const send = (options: InjectOptions) => app.inject({ remoteAddress: `192.0.2.${caseIndex}`, ...options });
    const version = async (userId: string) => {
      const response = await send({ url: `/api/v1/usuarios/${userId}`, headers });
      assert.equal(response.statusCode, 200, response.body);
      assert.match(String(response.headers.etag), /^"sha256-[a-f0-9]{64}"$/);
      return String(response.headers.etag);
    };
    const patch = async (userId: string, payload: Partial<UserInput>, tag?: string, actorHeaders = headers) => send({ method: 'PATCH', url: `/api/v1/usuarios/${userId}`, headers: { ...actorHeaders, 'if-match': tag ?? await version(userId) }, payload });
    const nextInput = (overrides: Partial<UserInput> = {}) => {
      const index = ++accountIndex;
      const key = `usr.${suffix}.${index}`;
      return { name: `Persona ${suffix} ${index}`, ci: String(ciBase + index), email: `${key}@example.org`, username: key, role: 'PUBLICO' as const, active: true, password, ...overrides };
    };
    const create = async (overrides: Partial<UserInput> = {}) => {
      const payload = nextInput(overrides);
      const response = await send({ method: 'POST', url: '/api/v1/usuarios', headers, payload });
      assert.equal(response.statusCode, 201, response.body);
      return response.json<ReturnType<typeof userDto>>();
    };
    const detail = (userId: string) => send({ url: `/api/v1/usuarios/${userId}`, headers });
    const list = (query: Record<string, string | undefined>) => send({ url: `/api/v1/usuarios?${new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined))}`, headers });
    const problem = (response: { statusCode: number; body: string; json(): { code: string } }, status: number, code: string) => { assert.equal(response.statusCode, status, response.body); assert.equal(response.json().code, code); };
    const scenario = async (name: string, run: () => Promise<void>) => { caseIndex++; await t.test(name, run); };
    const created = await app.inject({ method: 'POST', url: '/api/v1/usuarios', headers, payload: input });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(Object.keys(created.json()).sort(), ['id', 'name', 'ci', 'email', 'username', 'role', 'active', 'createdAt'].sort());
    assert.ok(created.headers.location);
    assert.equal(created.headers.etag, await version(created.json().id));
    assert.equal(await verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id: created.json().id } })).passwordHash, password), true);
    const id = created.json().id;
    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/usuarios', headers, payload: { ...input, username: input.username.toUpperCase(), email: input.email.toUpperCase() } });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().code, 'DUPLICATE_USER');
    const rn01 = await patch(id, { name: 'Cambiado', role: 'DIGITADOR' });
    assert.equal(rn01.statusCode, 400);
    assert.equal(rn01.json().code, 'PUBLIC_NAME_READONLY');
    const publicHeaders = await login(input.username);
    assert.equal((await app.inject({ url: '/api/v1/status', headers: publicHeaders })).statusCode, 403);
    const forbidden = await app.inject({ url: '/api/v1/usuarios', headers: publicHeaders });
    assert.equal(forbidden.statusCode, 403);
    const spoof = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: publicHeaders, payload: { role: 'ADMINISTRADOR' } });
    assert.equal(spoof.statusCode, 400);
    const listResponse = await app.inject({ url: `/api/v1/usuarios?page=1&pageSize=1&search=${input.username}`, headers });
    assert.equal(listResponse.statusCode, 200, listResponse.body);
    assert.equal(listResponse.json().pagination.total, 1);
    assert.equal(listResponse.json().data.length, 1);
    const inactive = await patch(id, { active: false });
    assert.equal(inactive.statusCode, 200, inactive.body);
    assert.equal((await app.inject({ url: '/api/v1/me', headers: publicHeaders })).statusCode, 401);
    assert.ok(await prisma.user.findUnique({ where: { id } }), 'Inactivación conserva cuenta.');

    const brokenAudit = prisma.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.operation === 'USUARIO_CREADO') throw new Error('Simulated audit outage'); return query(args); } } } }) as unknown as PrismaClient;
    const brokenApp = await createApp(config, brokenAudit, { logger: false, security: { now: () => new Date(clock) } });
    try {
      const failedInput = { ...input, ci: input.ci.slice(0, -1) + (input.ci.endsWith('9') ? '8' : '9'), username: `failed.${suffix}`, email: `failed.${suffix}@example.org` };
      const failed = await brokenApp.inject({ method: 'POST', url: '/api/v1/usuarios', headers, payload: failedInput });
      assert.equal(failed.statusCode, 503, failed.body);
      assert.equal(await prisma.user.count({ where: { usernameKey: failedInput.username } }), 0, 'Audit failure rolls back creation.');
    } finally { await brokenApp.close(); }

    await scenario('permisos HTTP de alta, detalle, listado, edición y estado; datos inválidos y 404', async () => {
      const target = await create();
      for (const role of [undefined, 'PUBLICO', 'DIGITADOR'] as const) {
        const actorHeaders = role ? await login((await create({ role })).username) : {};
        for (const request of [
          { url: '/api/v1/usuarios' }, { url: `/api/v1/usuarios/${target.id}` },
          { method: 'POST' as const, url: '/api/v1/usuarios', payload: nextInput() },
          { method: 'PATCH' as const, url: `/api/v1/usuarios/${target.id}`, payload: { email: 'spoof@example.org' } },
          { method: 'PATCH' as const, url: `/api/v1/usuarios/${target.id}`, payload: { active: false } },
          { method: 'DELETE' as const, url: `/api/v1/usuarios/${target.id}` },
        ]) assert.equal((await send({ ...request, headers: { ...actorHeaders, 'if-match': await version(target.id) } })).statusCode, role ? 403 : 401);
      }
      for (const invalid of [{ ci: '12.345' }, { name: '' }, { active: 'true' }, { role: 'ADMIN' }, { password: 'weak' }, { actorId: admins[0].id }]) problem(await send({ method: 'POST', url: '/api/v1/usuarios', headers, payload: { ...nextInput(), ...invalid } }), 400, 'VALIDATION_ERROR');
      const absent = randomUUID();
      problem(await detail(absent), 404, 'NOT_FOUND');
      problem(await detail('invalid-id'), 400, 'VALIDATION_ERROR');
      problem(await patch(absent, { active: false }, `"sha256-${'0'.repeat(64)}"`), 404, 'NOT_FOUND');
      problem(await send({ method: 'DELETE', url: `/api/v1/usuarios/${target.id}`, headers }), 428, 'PRECONDITION_REQUIRED');
      assert.equal((await detail(target.id)).json().active, true);
    });

    await scenario('filtros combinados, orden estable, paginación y resultados vacíos', async () => {
      const group = `grp.${suffix}`;
      const accounts = [];
      for (const [index, role, active] of [[1, 'PUBLICO', true], [2, 'DIGITADOR', true], [3, 'DIGITADOR', false]] as const) accounts.push(await create({ username: `${group}.${index}`, role, active }));
      await prisma.user.updateMany({ where: { id: { in: accounts.map(user => user.id) } }, data: { createdAt: clock } });
      const first = await list({ search: group.toUpperCase(), page: '1', pageSize: '2' });
      const second = await list({ search: group, page: '2', pageSize: '2' });
      assert.equal(first.statusCode, 200, first.body);
      assert.deepEqual(first.json().pagination, { page: 1, pageSize: 2, total: 3, totalPages: 2 });
      assert.deepEqual([...first.json().data, ...second.json().data].map(user => user.id), accounts.map(user => user.id).sort());
      assert.deepEqual((await list({ search: group, page: '9', pageSize: '2' })).json().data, []);
      assert.deepEqual((await list({ search: group, role: 'DIGITADOR', active: 'false' })).json<{ data: User[] }>().data.map(user => user.id), [accounts[2].id]);
      assert.deepEqual((await list({ search: `no-match-${suffix}` })).json(), { data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
      for (const query of [{ page: '0' }, { pageSize: '101' }, { active: '0' }, { role: 'ADMIN' }, { sort: 'passwordHash' }]) problem(await list(query), 400, 'VALIDATION_ERROR');
    });

    await scenario('NFKC y búsqueda literal de guion bajo, porcentaje y barra inversa', async () => {
      const literal = await create({ username: `match_${suffix}` });
      await create({ username: `matchX${suffix}` });
      assert.deepEqual((await list({ search: `ｍａｔｃｈ＿${suffix}` })).json<{ data: User[] }>().data.map(user => user.id), [literal.id]);
      const percent = await create({ name: `Descuento % ${suffix}` });
      const percentResults = await list({ search: '%', pageSize: '100' });
      assert.ok(percentResults.json<{ data: User[] }>().data.some(user => user.id === percent.id));
      assert.ok(percentResults.json<{ data: User[] }>().data.every(user => (['name', 'ci', 'email', 'username'] as const).some(field => user[field].includes('%'))));
      const slash = await create({ name: `Ruta\\Local${suffix}` });
      await create({ name: `RutaXLocal${suffix}` });
      assert.deepEqual((await list({ search: `Ruta\\Local${suffix}` })).json<{ data: User[] }>().data.map(user => user.id), [slash.id]);
    });

    await scenario('edición permitida, RN01 y protección de cuenta propia', async () => {
      const target = await create();
      const originalVersion = await version(target.id);
      const changed = await patch(target.id, { email: `edit.${suffix}@example.org`, username: `edit.${suffix}`, ci: String(ciBase + ++accountIndex) });
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(changed.json().name, target.name);
      assert.notEqual(changed.headers.etag, originalVersion);
      for (const role of ['PUBLICO', 'DIGITADOR'] as const) problem(await patch(target.id, { name: 'Cambiado', role }), 400, 'PUBLIC_NAME_READONLY');
      const digitador = await create({ role: 'DIGITADOR' });
      problem(await patch(digitador.id, { name: 'Cambiado', role: 'PUBLICO' }), 400, 'PUBLIC_NAME_READONLY');
      for (const change of [{ active: false }, { role: 'DIGITADOR' as const }]) problem(await patch(admins[0].id, change), 400, 'SELF_PRIVILEGE_CHANGE');
    });

    await scenario('If-Match obligatorio, precarga desactualizada y login sin falso conflicto', async () => {
      const target = await create();
      const original = await version(target.id);
      problem(await send({ method: 'PATCH', url: `/api/v1/usuarios/${target.id}`, headers, payload: { active: false } }), 428, 'PRECONDITION_REQUIRED');
      for (const tag of ['*', `W/${original}`, `${original}, ${original}`]) problem(await patch(target.id, { active: false }, tag), 400, 'VALIDATION_ERROR');
      await login(target.username);
      const wrong = await send({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: config.allowedOrigins[0] }, payload: { username: target.username, password: 'incorrecta' } });
      assert.equal(wrong.statusCode, 401);
      assert.equal(await version(target.id), original);
      const accepted = await patch(target.id, { email: `version.${suffix}@example.org` }, original);
      assert.equal(accepted.statusCode, 200, accepted.body);
      const stale = await patch(target.id, { email: target.email }, original);
      problem(stale, 412, 'USER_VERSION_CONFLICT');
      assert.equal(stale.json().title, 'La cuenta fue modificada');
      assert.equal((await detail(target.id)).json().email, accepted.json().email);
      const other = await create();
      const tag = await version(other.id);
      const results = await Promise.all([patch(other.id, { email: `race.a.${suffix}@example.org` }, tag), patch(other.id, { email: `race.b.${suffix}@example.org` }, tag)]);
      assert.deepEqual(results.map(response => response.statusCode).sort(), [200, 412], results.map(response => response.body).join('\n'));
      assert.equal((await detail(other.id)).json().email, results.find(response => response.statusCode === 200)!.json().email);
    });

    await scenario('unicidad concurrente por CI, correo y username y rechazo al editar', async () => {
      for (const key of ['ci', 'email', 'username'] as const) {
        const first = nextInput();
        const second = nextInput({ [key]: key === 'ci' ? first[key] : first[key].toUpperCase() });
        const results = await Promise.all([first, second].map(payload => send({ method: 'POST', url: '/api/v1/usuarios', headers, payload })));
        assert.deepEqual(results.map(response => response.statusCode).sort(), [201, 409]);
        assert.equal(results.find(response => response.statusCode === 409)!.json().code, 'DUPLICATE_USER');
      }
      const first = await create();
      const second = await create();
      for (const key of ['ci', 'email', 'username'] as const) problem(await patch(second.id, { [key]: first[key] }), 409, 'DUPLICATE_USER');
    });

    await scenario('inactivar y reactivar conserva historia y no revive las sesiones anteriores', async () => {
      const target = await create();
      const oldHeaders = await login(target.username);
      await login(target.username);
      const recovery = await prisma.recoveryToken.create({ data: { userId: target.id, hash: tokenHash(randomToken(32)), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
      clock = new Date(clock.getTime() + 12345);
      const inactive = await patch(target.id, { active: false });
      assert.equal(inactive.statusCode, 200, inactive.body);
      assert.equal(inactive.json().createdAt, target.createdAt);
      const sessions = await prisma.session.findMany({ where: { userId: target.id } });
      assert.ok(sessions.length >= 2 && sessions.every(session => session.revokedAt?.getTime() === clock.getTime()));
      assert.ok((await prisma.refreshToken.findMany({ where: { session: { userId: target.id } } })).every(token => token.revokedAt?.getTime() === clock.getTime()));
      assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: recovery.id } })).consumedAt?.getTime(), clock.getTime());
      assert.equal((await send({ url: '/api/v1/me', headers: oldHeaders })).statusCode, 401);
      assert.equal((await patch(target.id, { active: true })).statusCode, 200);
      assert.equal((await send({ url: '/api/v1/me', headers: oldHeaders })).statusCode, 401);
      await login(target.username);
      assert.ok(await prisma.auditLog.findFirst({ where: { resourceId: target.id, operation: 'USUARIO_INACTIVADO', status: 'EXITO' } }));
    });

    await scenario('cambio de rol revoca sesiones/recuperación y registra antes/después', async () => {
      const target = await create({ role: 'DIGITADOR' });
      const oldHeaders = await login(target.username);
      const recovery = await prisma.recoveryToken.create({ data: { userId: target.id, hash: tokenHash(randomToken(32)), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
      assert.equal((await patch(target.id, { role: 'PUBLICO' })).statusCode, 200);
      assert.equal((await send({ url: '/api/v1/me', headers: oldHeaders })).statusCode, 401);
      assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: recovery.id } })).consumedAt?.getTime(), clock.getTime());
      const event = await prisma.auditLog.findFirstOrThrow({ where: { operation: 'ROL_ASIGNADO', resourceId: target.id } });
      assert.deepEqual(event.before, { role: 'DIGITADOR' });
      assert.deepEqual(event.after, { role: 'PUBLICO' });
      await login(target.username);
    });

    await scenario('fallo de auditoría revierte editar, inactivar, activar y asignar rol con sus revocaciones', async () => {
      let blockedOperation = '';
      const failingPrisma = prisma.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.operation === blockedOperation) throw new Error('Simulated audit outage'); return query(args); } } } }) as unknown as PrismaClient;
      const failing = await createApp(config, failingPrisma, { logger: false, security: { now: () => new Date(clock) } });
      try {
        for (const change of [
          { operation: 'USUARIO_MODIFICADO', payload: { email: `rollback.${suffix}@example.org` }, initialActive: true },
          { operation: 'USUARIO_INACTIVADO', payload: { active: false }, initialActive: true },
          { operation: 'ROL_ASIGNADO', payload: { role: 'PUBLICO' as const }, initialActive: true },
          { operation: 'USUARIO_MODIFICADO', payload: { active: true }, initialActive: false },
        ]) {
          const target = await create({ role: 'DIGITADOR', active: change.initialActive });
          if (change.initialActive) await login(target.username);
          const before = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
          const beforeSessions = await prisma.session.findMany({ where: { userId: target.id }, orderBy: { id: 'asc' } });
          const beforeTokens = await prisma.refreshToken.findMany({ where: { session: { userId: target.id } }, orderBy: { id: 'asc' } });
          const beforeAudit = await prisma.auditLog.count({ where: { resourceId: target.id, status: 'EXITO' } });
          const recovery = await prisma.recoveryToken.create({ data: { userId: target.id, hash: tokenHash(randomToken(32)), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
          blockedOperation = change.operation;
          const response = await failing.inject({ method: 'PATCH', url: `/api/v1/usuarios/${target.id}`, headers: { ...headers, 'if-match': await version(target.id) }, payload: change.payload });
          problem(response, 503, 'AUDIT_UNAVAILABLE');
          const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
          assert.deepEqual(userDto(after), userDto(before));
          assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
          assert.ok(after.passwordHash === before.passwordHash);
          assert.ok(JSON.stringify(await prisma.session.findMany({ where: { userId: target.id }, orderBy: { id: 'asc' } })) === JSON.stringify(beforeSessions));
          assert.ok(JSON.stringify(await prisma.refreshToken.findMany({ where: { session: { userId: target.id } }, orderBy: { id: 'asc' } })) === JSON.stringify(beforeTokens));
          assert.equal((await prisma.recoveryToken.findUniqueOrThrow({ where: { id: recovery.id } })).consumedAt, null);
          assert.equal(await prisma.auditLog.count({ where: { resourceId: target.id, status: 'EXITO' } }), beforeAudit);
        }
      } finally { await failing.close(); }
    });

    await scenario('DELETE sin vínculos conserva auditoría y elimina recuperaciones en una transacción', async () => {
      const target = await create();
      const recovery = await prisma.recoveryToken.create({ data: { userId: target.id, hash: tokenHash(randomToken(32)), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
      const creationLog = await prisma.auditLog.findFirstOrThrow({ where: { resourceId: target.id, operation: 'USUARIO_CREADO' } });
      const response = await send({ method: 'DELETE', url: `/api/v1/usuarios/${target.id}`, headers: { ...headers, 'if-match': await version(target.id) } });
      assert.equal(response.statusCode, 204, response.body);
      assert.equal(response.body, '');
      assert.equal(await prisma.user.findUnique({ where: { id: target.id } }), null);
      assert.equal(await prisma.recoveryToken.findUnique({ where: { id: recovery.id } }), null);
      assert.deepEqual(await prisma.auditLog.findUnique({ where: { id: creationLog.id } }), creationLog);
      const event = await prisma.auditLog.findFirstOrThrow({ where: { operation: 'USUARIO_ELIMINADO', resourceId: target.id } });
      assert.equal(event.userId, admins[0].id);
      assert.deepEqual(event.before, target);
      assert.equal(JSON.stringify(event).includes(passwordHash), false);
      problem(await detail(target.id), 404, 'NOT_FOUND');
    });

    await scenario('DELETE exige precarga vigente, cuerpo vacío y no permite eliminar cuenta propia', async () => {
      const target = await create();
      const url = `/api/v1/usuarios/${target.id}`;
      const tag = await version(target.id);
      problem(await send({ method: 'DELETE', url, headers }), 428, 'PRECONDITION_REQUIRED');
      problem(await send({ method: 'DELETE', url, headers: { ...headers, 'if-match': '*' } }), 400, 'VALIDATION_ERROR');
      problem(await send({ method: 'DELETE', url, headers: { ...headers, 'if-match': tag }, payload: { actorId: admins[0].id } }), 400, 'VALIDATION_ERROR');
      problem(await send({ method: 'DELETE', url: `${url}?force=true`, headers: { ...headers, 'if-match': tag } }), 400, 'VALIDATION_ERROR');
      assert.equal((await patch(target.id, { email: `delete.changed.${suffix}@example.org` }, tag)).statusCode, 200);
      problem(await send({ method: 'DELETE', url, headers: { ...headers, 'if-match': tag } }), 412, 'USER_VERSION_CONFLICT');
      problem(await send({ method: 'DELETE', url: '/api/v1/usuarios/not-a-uuid', headers: { ...headers, 'if-match': tag } }), 400, 'VALIDATION_ERROR');
      problem(await send({ method: 'DELETE', url: `/api/v1/usuarios/${randomUUID()}`, headers: { ...headers, 'if-match': tag } }), 404, 'NOT_FOUND');
      problem(await send({ method: 'DELETE', url: `/api/v1/usuarios/${admins[0].id}`, headers: { ...headers, 'if-match': await version(admins[0].id) } }), 400, 'SELF_PRIVILEGE_CHANGE');
      assert.ok(await prisma.user.findUnique({ where: { id: target.id } }));
    });

    await scenario('DELETE conserva cuentas con sesiones históricas, auditoría propia, publicaciones o adjuntos', async () => {
      for (const relation of ['session', 'audit', 'attachment', 'publication'] as const) {
        const target = await create();
        if (relation === 'session') await prisma.session.create({ data: { userId: target.id, createdAt: clock, lastActivityAt: clock, expiresAt: new Date(clock.getTime() + 3600000), revokedAt: clock } });
        if (relation === 'audit') await prisma.auditLog.create({ data: { userId: target.id, role: target.role, operation: 'FIXTURE_HISTORY', resource: 'usuarios', resourceId: target.id, ip: '127.0.0.1', userAgent: 'users-test', status: 'EXITO' } });
        if (relation === 'attachment' || relation === 'publication') {
          // Runtime intentionally cannot provision files. Use a session-free creator
          // through the owner connection when explicitly supplied by the test runner.
          const ownerUrl = process.env.USERS_TEST_OWNER_URL;
          assert.ok(ownerUrl, 'USERS_TEST_OWNER_URL es necesaria para validar las FKs reales bibliográficas.');
          const ownerTarget = new URL(ownerUrl);
          assert.equal(ownerTarget.host + ownerTarget.pathname, testUrl.host + testUrl.pathname);
          const owner = createPrisma(ownerUrl);
          try {
            if (relation === 'attachment') await owner.storedAttachment.create({ data: { createdById: target.id, name: 'fixture.pdf', size: 100, mime: 'application/pdf', sha256: tokenHash(randomToken(32)), storageKey: `users-test/${randomUUID()}` } });
            else await owner.$transaction(async tx => {
              const name = `Dependencia ${target.id}`;
              const author = await tx.author.create({ data: { name, nameKey: name, searchKey: name } });
              const tutor = await tx.tutor.create({ data: { name, nameKey: name, searchKey: name } });
              const catalogs = [];
              for (const kind of ['carreras', 'niveles', 'tipos', 'filiales'] as const) catalogs.push(await tx.catalogRecord.create({ data: { kind, name, nameKey: name, searchKey: name } }));
              await tx.publication.create({ data: { title: name, titleHash: tokenHash(name), summary: name, summaryHash: tokenHash(name), abstract: name, abstractHash: tokenHash(name), keywords: 'prueba', year: 2026, source: 'EXTERNA', requiresLibraryCopy: false, externalUrl: 'https://example.org/fixture', active: false, createdById: target.id, careerId: catalogs[0].id, levelId: catalogs[1].id, typeId: catalogs[2].id, branchId: catalogs[3].id, authors: { create: { authorId: author.id, position: 1 } }, tutors: { create: { tutorId: tutor.id, position: 1 } } } });
            });
          }
          finally { await owner.$disconnect(); }
        }
        problem(await send({ method: 'DELETE', url: `/api/v1/usuarios/${target.id}`, headers: { ...headers, 'if-match': await version(target.id) } }), 409, 'USER_IN_USE');
        assert.ok(await prisma.user.findUnique({ where: { id: target.id } }));
      }
    });

    await scenario('DELETE no elimina una referencia de sesión confirmada mientras espera el bloqueo', async () => {
      const target = await create();
      const tag = await version(target.id);
      const ownerUrl = new URL(process.env.USERS_TEST_OWNER_URL ?? 'http://missing');
      assert.equal(ownerUrl.host + ownerUrl.pathname, testUrl.host + testUrl.pathname);
      const owner = new Client({ connectionString: ownerUrl.href });
      await owner.connect();
      let pending: ReturnType<typeof send> | undefined;
      try {
        await owner.query('BEGIN');
        await owner.query('INSERT INTO sesiones (id,usuario_id,creado_en,ultima_actividad_en,vence_en) VALUES ($1,$2,$3,$3,$4)', [randomUUID(), target.id, clock, new Date(clock.getTime() + 3600000)]);
        pending = send({ method: 'DELETE', url: `/api/v1/usuarios/${target.id}`, headers: { ...headers, 'if-match': tag } });
        // Start inject's thenable before inspecting the actual PostgreSQL wait.
        const responsePromise = Promise.resolve(pending);
        let waiting = false;
        for (let attempt = 0; attempt < 150 && !waiting; attempt++) {
          await owner.query('SELECT pg_stat_clear_snapshot()');
          waiting = !!(await owner.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%SELECT id FROM usuarios%FOR UPDATE%'")).rowCount;
          if (!waiting) await delay(10);
        }
        assert.ok(waiting, 'La baja debe esperar la FK aún sin confirmar.');
        await owner.query('COMMIT');
        problem(await responsePromise, 409, 'USER_IN_USE');
        assert.ok(await prisma.user.findUnique({ where: { id: target.id } }));
        assert.equal(await prisma.session.count({ where: { userId: target.id } }), 1);
      } finally { await owner.query('ROLLBACK'); if (pending) await pending; await owner.end(); }
    });

    await scenario('DELETE revierte cuenta y recuperaciones si falla auditoría; dos bajas no duplican éxito', async () => {
      const target = await create({ active: false });
      const recovery = await prisma.recoveryToken.create({ data: { userId: target.id, hash: tokenHash(randomToken(32)), createdAt: clock, expiresAt: new Date(clock.getTime() + 900000) } });
      const tag = await version(target.id);
      const faulty = prisma.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.operation === 'USUARIO_ELIMINADO') throw new Error('Simulated audit outage'); return query(args); } } } }) as unknown as PrismaClient;
      const failing = await createApp(config, faulty, { logger: false, security: { now: () => new Date(clock) } });
      try {
        problem(await failing.inject({ method: 'DELETE', url: `/api/v1/usuarios/${target.id}`, headers: { ...headers, 'if-match': tag } }), 503, 'AUDIT_UNAVAILABLE');
        assert.ok(await prisma.user.findUnique({ where: { id: target.id } }));
        assert.deepEqual(await prisma.recoveryToken.findUnique({ where: { id: recovery.id } }), recovery);
        assert.equal(await prisma.auditLog.count({ where: { operation: 'USUARIO_ELIMINADO', resourceId: target.id } }), 0);
      } finally { await failing.close(); }
      const responses = await Promise.all([1, 2].map(() => send({ method: 'DELETE', url: `/api/v1/usuarios/${target.id}`, headers: { ...headers, 'if-match': tag } })));
      assert.deepEqual(responses.map(response => response.statusCode).sort(), [204, 404], responses.map(response => response.body).join('\n'));
      assert.equal(await prisma.auditLog.count({ where: { operation: 'USUARIO_ELIMINADO', resourceId: target.id } }), 1);
    });

    const secondHeaders = await login(admins[1].username);
    const adminVersions = await Promise.all(admins.map(admin => version(admin.id)));
    const changes = await Promise.all([
      patch(admins[1].id, { active: false }, adminVersions[1]),
      patch(admins[0].id, { active: false }, adminVersions[0], secondHeaders),
    ]);
    assert.equal(changes.filter(response => response.statusCode === 200).length, 1, changes.map(response => response.body).join('\n'));
    assert.equal(await prisma.user.count({ where: { role: 'ADMINISTRADOR', active: true } }), 1);
    assert.ok(await prisma.auditLog.count({ where: { operation: 'OPERACION_RECHAZADA', status: 'FALLIDO' } }) > 0);
  } finally { await app.close(); await prisma.$disconnect(); }
});
