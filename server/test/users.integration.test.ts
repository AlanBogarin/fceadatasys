import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { createPrisma } from '../src/db.js';
import type { AppConfig } from '../src/config.js';
import { hashPassword } from '../src/security/crypto.js';

const databaseUrl = process.env.USERS_TEST_DATABASE_URL;
test('usuarios PostgreSQL: contratos, permisos, concurrencia, unicidad y rollback de auditoría', { skip: !databaseUrl }, async () => {
  const testUrl = new URL(databaseUrl!);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(testUrl.hostname) && /^\/fceadatasys_.*test$/.test(testUrl.pathname), 'Las pruebas requieren PostgreSQL local y una base fceadatasys_*test explícita.');
  const prisma = createPrisma(databaseUrl!);
  const config: AppConfig = { nodeEnv: 'test', host: '127.0.0.1', port: 3000, databaseUrl: databaseUrl!, jwtSecret: 'test-secret-users-'.repeat(4), jwtIssuer: 'test', jwtAudience: 'test', allowedOrigins: ['http://localhost:5173'], secureCookies: false, recoveryUrl: 'http://localhost:5173/reset' };
  const password = 'SecureTest123!';
  const passwordHash = await hashPassword(password);
  // Fixed fixtures allow repeats without deleting immutable historical audit logs.
  const unexpectedAdmin = await prisma.user.count({ where: { role: 'ADMINISTRADOR', usernameKey: { notIn: ['fixture.admin.a', 'fixture.admin.b'] } } });
  assert.equal(unexpectedAdmin, 0, 'Use una base de pruebas exclusiva para usuarios.');
  const admins = [];
  for (let index = 0; index < 2; index++) {
    const username = `fixture.admin.${index === 0 ? 'a' : 'b'}`;
    admins.push(await prisma.user.upsert({ where: { usernameKey: username }, create: { name: `Administrador ${index}`, ci: `10000000${index}`, email: `${username}@example.org`, emailKey: `${username}@example.org`, username, usernameKey: username, role: 'ADMINISTRADOR', active: true, passwordHash }, update: { active: true, role: 'ADMINISTRADOR', passwordHash, failures: 0, lockedUntil: null } }));
  }
  const app = await createApp(config, prisma, { logger: false });
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
    const created = await app.inject({ method: 'POST', url: '/api/v1/usuarios', headers, payload: input });
    assert.equal(created.statusCode, 201, created.body);
    assert.deepEqual(Object.keys(created.json()).sort(), ['id', 'name', 'ci', 'email', 'username', 'role', 'active', 'createdAt'].sort());
    assert.ok(created.headers.location);
    const id = created.json().id;
    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/usuarios', headers, payload: { ...input, username: input.username.toUpperCase(), email: input.email.toUpperCase() } });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().code, 'DUPLICATE_USER');
    const rn01 = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${id}`, headers, payload: { name: 'Cambiado', role: 'DIGITADOR' } });
    assert.equal(rn01.statusCode, 400);
    assert.equal(rn01.json().code, 'PUBLIC_NAME_READONLY');
    const publicHeaders = await login(input.username);
    assert.equal((await app.inject({ url: '/api/v1/status', headers: publicHeaders })).statusCode, 403);
    const forbidden = await app.inject({ url: '/api/v1/usuarios', headers: publicHeaders });
    assert.equal(forbidden.statusCode, 403);
    const spoof = await app.inject({ method: 'PATCH', url: '/api/v1/me', headers: publicHeaders, payload: { role: 'ADMINISTRADOR' } });
    assert.equal(spoof.statusCode, 400);
    const list = await app.inject({ url: `/api/v1/usuarios?page=1&pageSize=1&search=${input.username}`, headers });
    assert.equal(list.statusCode, 200, list.body);
    assert.equal(list.json().pagination.total, 1);
    assert.equal(list.json().data.length, 1);
    const inactive = await app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${id}`, headers, payload: { active: false } });
    assert.equal(inactive.statusCode, 200, inactive.body);
    assert.equal((await app.inject({ url: '/api/v1/me', headers: publicHeaders })).statusCode, 401);
    assert.ok(await prisma.user.findUnique({ where: { id } }), 'Inactivación conserva cuenta.');

    const brokenAudit = prisma.$extends({ query: { auditLog: { create: async ({ args, query }) => { if (args.data.operation === 'USUARIO_CREADO') throw new Error('Simulated audit outage'); return query(args); } } } }) as unknown as PrismaClient;
    const brokenApp = await createApp(config, brokenAudit, { logger: false });
    try {
      const failedInput = { ...input, ci: input.ci.slice(0, -1) + (input.ci.endsWith('9') ? '8' : '9'), username: `failed.${suffix}`, email: `failed.${suffix}@example.org` };
      const failed = await brokenApp.inject({ method: 'POST', url: '/api/v1/usuarios', headers, payload: failedInput });
      assert.equal(failed.statusCode, 503, failed.body);
      assert.equal(await prisma.user.count({ where: { usernameKey: failedInput.username } }), 0, 'Audit failure rolls back creation.');
    } finally { await brokenApp.close(); }

    const secondHeaders = await login(admins[1].username);
    const changes = await Promise.all([
      app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${admins[1].id}`, headers, payload: { active: false } }),
      app.inject({ method: 'PATCH', url: `/api/v1/usuarios/${admins[0].id}`, headers: secondHeaders, payload: { active: false } }),
    ]);
    assert.equal(changes.filter(response => response.statusCode === 200).length, 1, changes.map(response => response.body).join('\n'));
    assert.equal(await prisma.user.count({ where: { role: 'ADMINISTRADOR', active: true } }), 1);
    assert.ok(await prisma.auditLog.count({ where: { operation: 'OPERACION_RECHAZADA', status: 'FALLIDO' } }) > 0);
  } finally { await app.close(); await prisma.$disconnect(); }
});
