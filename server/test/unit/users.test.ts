import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient, Role, User } from '@prisma/client';
import { createApp } from '../helpers/unit-app.js';
import type { AppConfig } from '../../src/config.js';
import { enforceUserRules } from '../../src/users/routes.js';
import { defaultPermissions } from '../../src/security/permissions.js';
import { userDto } from '../../src/users/dto.js';
import { requireUserIfMatch, userEtag } from '../../src/users/concurrency.js';
import { enforceUserDeletionRules } from '../../src/users/deletion.js';
import { normalizeIdentity as normalizeLogin } from '../../src/security/crypto.js';
import { createUserSchema, normalizeIdentity, profileSchema, roles, updateUserSchema, userDtoSchema, userInputSchema, userQuerySchema, type UserInput } from '../../src/users/schemas.js';

const input: UserInput = { name: 'Persona', ci: '123456', email: 'persona@example.org', username: 'persona', role: 'PUBLICO', active: true };
const before = { id: 'target', name: input.name, role: input.role, active: true };

for (const originalRole of roles) for (const nextRole of roles) {
  test(`RN-01 ${originalRole} → ${nextRole}: nombre y otros metadatos`, () => {
    const current = Object.freeze({ ...before, role: originalRole });
    const allowed = Object.freeze({ ...input, role: nextRole, email: 'otro@example.org' });
    assert.doesNotThrow(() => enforceUserRules(current, allowed, 'other-admin', 2));
    const renamed = { ...allowed, name: 'Otro nombre' };
    if (originalRole === 'PUBLICO' || nextRole === 'PUBLICO') assert.throws(() => enforceUserRules(current, renamed, 'other-admin', 2), { code: 'PUBLIC_NAME_READONLY' });
    else assert.doesNotThrow(() => enforceUserRules(current, renamed, 'other-admin', 2));
    assert.equal(current.name, input.name);
    assert.equal(allowed.email, 'otro@example.org');
  });
}

test('Administración propia: cambiar datos personales se permite, rol y estado se protegen', () => {
  const admin = { ...before, role: 'ADMINISTRADOR' as const };
  assert.doesNotThrow(() => enforceUserRules(admin, { ...input, role: admin.role, email: 'nuevo@example.org' }, admin.id, 1));
  for (const role of ['DIGITADOR', 'PUBLICO'] as const) assert.throws(() => enforceUserRules(admin, { ...input, role }, admin.id, 2), { code: 'SELF_PRIVILEGE_CHANGE' });
  assert.throws(() => enforceUserRules(admin, { ...input, role: admin.role, active: false }, admin.id, 2), { code: 'SELF_PRIVILEGE_CHANGE' });
});

test('Último Administrador: inactivación y degradación se rechazan, mantenimiento se permite', () => {
  const admin = { ...before, role: 'ADMINISTRADOR' as const };
  for (const change of [{ active: false }, { role: 'DIGITADOR' as const }, { role: 'PUBLICO' as const }]) {
    for (const count of [0, 1]) assert.throws(() => enforceUserRules(admin, { ...input, role: admin.role, ...change }, 'other', count), { code: 'LAST_ADMIN_REQUIRED' });
    assert.doesNotThrow(() => enforceUserRules(admin, { ...input, role: admin.role, ...change }, 'other', 2));
  }
  assert.doesNotThrow(() => enforceUserRules(admin, { ...input, role: admin.role, username: 'actualizado' }, 'other', 1));
  assert.doesNotThrow(() => enforceUserRules({ ...admin, active: false }, { ...input, role: 'DIGITADOR', active: false }, 'other', 1));
  assert.doesNotThrow(() => enforceUserRules(before, { ...input, active: false }, 'other', 1));
});

test('Alta normaliza sin mutar el formulario ni recortar la contraseña', () => {
  const raw = Object.freeze({ ...input, name: ' Persona ', ci: '１２３４５６', username: ' ＰＥＲＳＯＮＡ ', email: ' PERSONA@example.org ', password: ' Password123 ' });
  const parsed = createUserSchema.parse(raw);
  assert.deepEqual(parsed, { ...input, username: 'PERSONA', password: raw.password });
  assert.equal(raw.ci, '１２３４５６');
  assert.equal(raw.name, ' Persona ');
});

for (const identity of [' ＡＢＣ ', 'UsUaRio', ' persona@EXAMPLE.ORG ', 'Jose\u0301', 'José', 'İ', 'K']) {
  test(`Normalización coherente entre login y usuarios: ${JSON.stringify(identity)}`, () => {
    assert.equal(normalizeIdentity(identity), normalizeLogin(identity));
    assert.equal(normalizeIdentity(normalizeIdentity(identity)), normalizeIdentity(identity));
  });
}

test('PATCH es parcial, pero vacío y campos ajenos se rechazan', () => {
  assert.deepEqual(updateUserSchema.parse({ active: false }), { active: false });
  assert.deepEqual(profileSchema.parse({ email: ' OTHER@example.org ' }), { email: 'other@example.org' });
  for (const schema of [updateUserSchema, profileSchema]) {
    assert.equal(schema.safeParse({}).success, false);
    for (const key of ['actorId', 'passwordHash', 'salt', 'failures', 'lockedUntil']) assert.equal(schema.safeParse({ email: input.email, [key]: 'spoof' }).success, false);
  }
  for (const key of ['role', 'active', 'ci']) assert.equal(profileSchema.safeParse({ [key]: input[key as keyof UserInput] }).success, false);
  assert.equal(createUserSchema.safeParse({ ...input, password: 'Password123', actorId: 'spoof' }).success, false);
});

test('Validación de usuarios conserva límites y tipos, sin aceptar roles inventados', () => {
  for (const invalid of [{ name: '' }, { name: 'x'.repeat(101) }, { ci: '1234' }, { ci: '1'.repeat(13) }, { ci: '12-345' }, { email: 'bad-email' }, { username: 'ab' }, { username: 'x'.repeat(41) }, { username: 'usuario con espacio' }, { role: 'ADMIN' }, { active: 'true' }]) assert.equal(userInputSchema.safeParse({ ...input, ...invalid }).success, false, JSON.stringify(invalid));
  assert.equal(userInputSchema.safeParse({ ...input, name: 'x'.repeat(100), ci: '1'.repeat(12), username: 'x'.repeat(40) }).success, true);
  assert.equal(createUserSchema.safeParse({ ...input, password: 'weak' }).success, false);
});

test('Paginación distingue false de ausencia y rechaza filtros fuera del contrato', () => {
  assert.deepEqual(userQuerySchema.parse({}), { page: 1, pageSize: 20 });
  assert.deepEqual(userQuerySchema.parse({ page: '2', pageSize: '100', active: 'false', search: ' persona ' }), { page: 2, pageSize: 100, active: false, search: 'persona' });
  for (const query of [{ page: '0' }, { page: '1.5' }, { pageSize: '101' }, { active: '0' }, { active: false }, { sort: 'passwordHash' }]) assert.equal(userQuerySchema.safeParse(query).success, false);
  assert.equal(userQuerySchema.parse({ search: ' ＵＳＵＡＲＩＯ_１２３ ' }).search, 'USUARIO_123');
  assert.equal(userQuerySchema.parse({ search: 'Jose\u0301' }).search, 'José');
});

test('DTO es una allowlist nueva sin secretos, estado interno ni mutaciones del registro', () => {
  const stored: User = Object.freeze({ id: 'd0347d10-079a-423d-a191-bf55608f1e38', ...input, emailKey: input.email, usernameKey: input.username, passwordHash: 'SECRET_HASH', failures: 3, lockedUntil: new Date('2026-01-01T01:00:00Z'), createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:30:00Z') });
  const dto = userDto(stored);
  const etag = userEtag(stored);
  assert.match(etag, /^"sha256-[a-f0-9]{64}"$/);
  assert.equal(userEtag({ ...stored, passwordHash: 'CHANGED_PRIVATE_HASH', failures: 0, lockedUntil: null, updatedAt: new Date('2026-02-01T00:00:00Z') }), etag, 'Los cambios internos de login/contraseña no invalidan metadatos precargados.');
  for (const changes of [{ name: 'Otra persona' }, { email: 'otro@example.org' }, { ci: '999999' }, { username: 'other' }, { role: 'DIGITADOR' as const }, { active: false }]) assert.notEqual(userEtag({ ...stored, ...changes }), etag);
  assert.deepEqual(Object.keys(dto).sort(), ['id', 'name', 'ci', 'email', 'username', 'role', 'active', 'createdAt'].sort());
  assert.equal(userDtoSchema.safeParse(dto).success, true);
  assert.equal(dto.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(JSON.stringify(dto).includes('SECRET_HASH'), false);
  assert.equal(stored.createdAt instanceof Date, true);
  dto.name = 'Modificado en cliente';
  assert.equal(stored.name, input.name);
});

test('Eliminación protege cuenta propia y último administrador, incluso con cuentas inactivas', () => {
  const target = { id: 'target', role: 'ADMINISTRADOR' as const, active: true };
  assert.throws(() => enforceUserDeletionRules(target, 'target', 2), { status: 400, code: 'SELF_PRIVILEGE_CHANGE' });
  assert.throws(() => enforceUserDeletionRules(target, 'actor', 1), { status: 409, code: 'LAST_ADMIN_REQUIRED' });
  assert.doesNotThrow(() => enforceUserDeletionRules(target, 'actor', 2));
  assert.doesNotThrow(() => enforceUserDeletionRules({ ...target, active: false }, 'actor', 1));
  assert.doesNotThrow(() => enforceUserDeletionRules({ ...target, role: 'PUBLICO' }, 'actor', 1));
});

test('If-Match requiere un único ETag fuerte de la API y conserva el valor opaco', () => {
  const etag = `"sha256-${'a'.repeat(64)}"`;
  assert.equal(requireUserIfMatch(etag), etag);
  assert.equal(requireUserIfMatch(`  ${etag}  `), etag);
  assert.throws(() => requireUserIfMatch(undefined), { status: 428, code: 'PRECONDITION_REQUIRED' });
  for (const header of ['', '*', `W/${etag}`, `${etag}, ${etag}`, 'sha256-' + 'a'.repeat(64), '"other-tag"', [etag, etag]]) assert.throws(() => requireUserIfMatch(header), { status: 400, code: 'VALIDATION_ERROR' });
});

test('Contrato HTTP de usuarios expone ETag y permite If-Match únicamente a orígenes CORS autorizados', async t => {
  const now = new Date('2026-10-15T12:00:00Z');
  const actor: User = { id: '11111111-1111-4111-8111-111111111111', ...input, role: 'ADMINISTRADOR', passwordHash: 'PRIVATE_HASH', emailKey: input.email, usernameKey: input.username, failures: 0, lockedUntil: null, createdAt: now, updatedAt: now };
  const target = { ...actor, id: '22222222-2222-4222-8222-222222222222', role: 'DIGITADOR' as const };
  const session = { id: '33333333-3333-4333-8333-333333333333', userId: actor.id, user: actor, createdAt: now, lastActivityAt: now, expiresAt: new Date(now.getTime() + 3600000), revokedAt: null };
  const prisma = { session: { findUnique: async () => session }, user: { findUnique: async () => target }, auditLog: { create: async () => ({}) }, $transaction: async () => { throw new Error('No mutation is expected for precondition/header contract cases'); } } as unknown as PrismaClient;
  const origin = 'https://catalogo.example.invalid';
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: 'postgresql://unused@127.0.0.1/never_connect', jwtSecret: 'unit-users-header-secret-'.repeat(3), jwtIssuer: 'unit', jwtAudience: 'unit', allowedOrigins: [origin], secureCookies: true, recoveryUrl: `${origin}/reset` };
  const app = await createApp(config, prisma, { logger: false, security: { now: () => now, mailer: { available: false, verify: async () => false, sendRecovery: async () => { throw new Error('SMTP must not run'); } } } });
  t.after(() => app.close());
  const authorization = `Bearer ${app.jwt.sign({ sub: actor.id, sid: session.id }, { expiresIn: 900 })}`;
  const url = `/api/v1/usuarios/${target.id}`;
  await t.test('Preflight autorizado incluye If-Match y no concede origen diferente', async () => {
    const request = { method: 'OPTIONS' as const, url, headers: { origin, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization,content-type,if-match' } };
    const allowed = await app.inject(request);
    assert.equal(allowed.statusCode, 204);
    assert.equal(allowed.headers['access-control-allow-origin'], origin);
    assert.match(String(allowed.headers['access-control-allow-headers']), /if-match/i);
    const denied = await app.inject({ ...request, headers: { ...request.headers, origin: 'https://evil.invalid' } });
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  });
  await t.test('Detalle publica un ETag fuerte de su JSON seguro, accesible desde navegador autorizado', async () => {
    const response = await app.inject({ url, headers: { authorization, origin } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers.etag, `"sha256-${createHash('sha256').update(response.body).digest('hex')}"`);
    assert.match(String(response.headers['access-control-expose-headers']), /etag/i);
    assert.match(String(response.headers['access-control-expose-headers']), /location/i);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.body.includes('PRIVATE_HASH'), false);
  });
  for (const method of ['PATCH', 'DELETE'] as const) await t.test(`${method} sin precarga produce 428; comodín o ETag débil producen 400`, async () => {
    const payload = method === 'PATCH' ? { email: 'new@example.org' } : undefined;
    const missing = await app.inject({ method, url, headers: { authorization }, payload });
    assert.equal(missing.statusCode, 428);
    assert.equal(missing.json().code, 'PRECONDITION_REQUIRED');
    assert.equal(missing.json().title, 'Precondición requerida');
    for (const value of ['*', `W/${userEtag(target)}`]) {
      const invalid = await app.inject({ method, url, headers: { authorization, 'if-match': value }, payload });
      assert.equal(invalid.statusCode, 400);
      assert.equal(invalid.json().code, 'VALIDATION_ERROR');
    }
  });
});

for (const method of ['PATCH', 'DELETE'] as const) test(`${method} revalida el plazo del actor después de esperar el bloqueo del usuario destino`, async t => {
  const start = new Date('2026-10-15T12:00:00Z');
  let time = start;
  const actor: User = { id: '11111111-1111-4111-8111-111111111111', ...input, role: 'ADMINISTRADOR', passwordHash: 'PRIVATE_HASH', emailKey: input.email, usernameKey: input.username, failures: 0, lockedUntil: null, createdAt: start, updatedAt: start };
  const target: User = { ...actor, id: '22222222-2222-4222-8222-222222222222', role: 'DIGITADOR' };
  const session = { id: '33333333-3333-4333-8333-333333333333', userId: actor.id, user: actor, createdAt: new Date(start.getTime() - 599999), lastActivityAt: new Date(start.getTime() - 599999), expiresAt: new Date(start.getTime() + 3600000), revokedAt: null };
  const calls = { updates: 0, revocations: 0, audits: [] as { data: { operation: string; status: string } }[] };
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async (_sql: unknown, id: string) => { if (id === target.id) time = new Date(start.getTime() + 2); return [{ id }]; },
    user: { findUnique: async ({ where }: { where: { id: string } }) => where.id === actor.id ? actor : target, count: async () => 2, update: async () => { calls.updates++; return target; } },
    session: { findUnique: async () => session, updateMany: async () => { calls.revocations++; return { count: 0 }; } },
    refreshToken: { updateMany: async () => { calls.revocations++; return { count: 0 }; } },
    recoveryToken: { updateMany: async () => { calls.revocations++; return { count: 0 }; } },
    auditLog: { create: async (event: { data: { operation: string; status: string } }) => { calls.audits.push(event); return {}; } },
  };
  const prisma = { ...tx, $transaction: async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => callback(tx as unknown as Prisma.TransactionClient) } as unknown as PrismaClient;
  const origin = 'https://catalogo.example.invalid';
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: 'postgresql://unused@127.0.0.1/never_connect', jwtSecret: 'unit-users-clock-secret-'.repeat(3), jwtIssuer: 'unit', jwtAudience: 'unit', allowedOrigins: [origin], secureCookies: true, recoveryUrl: `${origin}/reset` };
  const app = await createApp(config, prisma, { logger: false, security: { now: () => time, mailer: { available: false, verify: async () => false, sendRecovery: async () => { throw new Error('SMTP must not run'); } } } });
  t.after(() => app.close());
  const authorization = `Bearer ${app.jwt.sign({ sub: actor.id, sid: session.id }, { expiresIn: 900 })}`;
  const response = await app.inject({ method, url: `/api/v1/usuarios/${target.id}`, headers: { authorization, 'if-match': userEtag(target) }, payload: method === 'PATCH' ? { active: false } : undefined });
  assert.equal(response.statusCode, 401, response.body);
  assert.equal(response.json().code, 'UNAUTHENTICATED');
  assert.equal(calls.updates, 0);
  assert.equal(calls.revocations, 0);
  assert.deepEqual(calls.audits.map(event => [event.data.operation, event.data.status]), [['OPERACION_RECHAZADA', 'FALLIDO']]);
});

test('Perfil HTTP usa identidad y rol revalidados, campos permitidos y recuperación coherente', async t => {
  async function fixture(role: Role, options: { currentRole?: Role; afterLock?: 'expired' | 'inactive' | 'revoked' } = {}) {
    const start = new Date('2026-10-15T12:00:00Z');
    let time = start;
    const user: User = { id: '11111111-1111-4111-8111-111111111111', ...input, role, passwordHash: 'PRIVATE_HASH', emailKey: input.email, usernameKey: input.username, failures: 0, lockedUntil: null, createdAt: start, updatedAt: start };
    const current = { ...user, role: options.currentRole ?? role, active: options.afterLock !== 'inactive' };
    const session = { id: '33333333-3333-4333-8333-333333333333', userId: user.id, createdAt: start, lastActivityAt: start, expiresAt: new Date(start.getTime() + 3600000), revokedAt: null };
    const calls = { updates: [] as unknown[], recoveries: [] as unknown[], audits: [] as { data: { operation: string; role: Role; status: string } }[] };
    const tx = {
      $executeRaw: async () => 1,
      $queryRaw: async () => { if (options.afterLock === 'expired') time = new Date(start.getTime() + 600000); return [{ id: user.id }]; },
      user: { findUnique: async () => current, update: async ({ data }: { data: Partial<User> }) => { calls.updates.push(data); return { ...current, ...data }; } },
      session: { findUnique: async () => ({ ...session, revokedAt: options.afterLock === 'revoked' ? start : null }), updateMany: async () => { throw new Error('Profile changes must preserve sessions'); } },
      refreshToken: { updateMany: async () => { throw new Error('Profile changes must preserve refresh'); } },
      recoveryToken: { updateMany: async (args: unknown) => { calls.recoveries.push(args); return { count: 2 }; } },
      auditLog: { create: async (event: { data: { operation: string; role: Role; status: string } }) => { calls.audits.push(event); return {}; } },
    };
    const prisma = { ...tx, session: { ...tx.session, findUnique: async () => ({ ...session, user }) }, $transaction: async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => callback(tx as unknown as Prisma.TransactionClient) } as unknown as PrismaClient;
    const origin = 'https://catalogo.example.invalid';
    const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: 'postgresql://unused@127.0.0.1/never_connect', jwtSecret: 'unit-profile-secret-'.repeat(3), jwtIssuer: 'unit', jwtAudience: 'unit', allowedOrigins: [origin], secureCookies: true, recoveryUrl: `${origin}/reset` };
    const app = await createApp(config, prisma, { logger: false, security: { now: () => new Date(time), mailer: { available: false, verify: async () => false, sendRecovery: async () => { throw new Error('SMTP must not run'); } } } });
    const headers = { authorization: `Bearer ${app.jwt.sign({ sub: user.id, sid: session.id }, { expiresIn: 900 })}` };
    return { app, headers, user, calls, start };
  }

  for (const role of roles) await t.test(`GET/PATCH seguro para ${role}, sin If-Match ni renovación de sesión`, async child => {
    const { app, headers, user, calls, start } = await fixture(role);
    child.after(() => app.close());
    const read = await app.inject({ url: '/api/v1/me?actorId=other-user', headers });
    assert.equal(read.statusCode, 200, read.body);
    assert.deepEqual(read.json(), { ...userDto(user), permissions: defaultPermissions[role] });
    assert.equal(read.headers['cache-control'], 'no-store');
    assert.equal(read.body.includes('PRIVATE_HASH'), false);
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers, payload: { email: ' NEW@example.org ', username: ' ＮＥＷ＿ＵＳＥＲ ', ...(role === 'PUBLICO' ? {} : { name: 'Nombre actualizado' }) } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().id, user.id);
    assert.equal(response.json().role, role);
    assert.equal(response.json().ci, user.ci);
    assert.equal(response.json().email, 'new@example.org');
    assert.equal(response.json().username, 'NEW_USER');
    assert.deepEqual(calls.recoveries, [{ where: { userId: user.id, consumedAt: null }, data: { consumedAt: start } }]);
    assert.equal(calls.audits.at(-1)?.data.role, role);
    assert.equal(calls.audits.at(-1)?.data.operation, 'PERFIL_MODIFICADO');
    assert.equal(JSON.stringify(calls.audits).includes('PRIVATE_HASH'), false);
  });

  await t.test('Campos administrativos/credenciales, cuerpo vacío y nombre Público se rechazan', async child => {
    const { app, headers, calls } = await fixture('PUBLICO');
    child.after(() => app.close());
    for (const field of ['id', 'actorId', 'userId', 'ci', 'role', 'active', 'password', 'passwordHash', 'failures', 'createdAt', 'updatedAt']) {
      const response = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers, payload: { email: 'valid@example.org', [field]: 'PRIVATE_ATTACK_VALUE' } });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, 'VALIDATION_ERROR');
      assert.equal(response.body.includes('PRIVATE_ATTACK_VALUE'), false);
    }
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/me', headers, payload: {} })).statusCode, 400);
    const renamed = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers, payload: { name: 'Otro nombre' } });
    assert.equal(renamed.statusCode, 400);
    assert.equal(renamed.json().code, 'PUBLIC_NAME_READONLY');
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.recoveries.length, 0);
  });

  await t.test('Correo equivalente y cambio de username no consumen recuperaciones innecesariamente', async child => {
    const { app, headers, calls } = await fixture('PUBLICO');
    child.after(() => app.close());
    for (const payload of [{ email: ' PERSONA@EXAMPLE.ORG ' }, { username: 'nuevo_usuario' }]) assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/me', headers, payload })).statusCode, 200);
    assert.equal(calls.recoveries.length, 0);
  });

  await t.test('Auditoría usa rol actual de la transacción, aunque difiera del snapshot inicial', async child => {
    const { app, headers, calls } = await fixture('ADMINISTRADOR', { currentRole: 'DIGITADOR' });
    child.after(() => app.close());
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers, payload: { name: 'Nombre permitido' } });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().role, 'DIGITADOR');
    assert.equal(calls.audits.at(-1)?.data.role, 'DIGITADOR');
  });

  for (const afterLock of ['expired', 'inactive', 'revoked'] as const) await t.test(`Perfil rechaza actor ${afterLock} después del bloqueo sin mutaciones`, async child => {
    const { app, headers, calls } = await fixture('DIGITADOR', { afterLock });
    child.after(() => app.close());
    const response = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers, payload: { email: 'changed@example.org' } });
    assert.equal(response.statusCode, 401, response.body);
    assert.equal(response.json().code, 'UNAUTHENTICATED');
    assert.equal(calls.updates.length, 0);
    assert.equal(calls.recoveries.length, 0);
    assert.ok(calls.audits.every(event => event.data.status === 'FALLIDO'));
  });
});
