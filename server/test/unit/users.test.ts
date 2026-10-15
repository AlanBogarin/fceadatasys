import test from 'node:test';
import assert from 'node:assert/strict';
import type { User } from '@prisma/client';
import { enforceUserRules } from '../../src/users/routes.js';
import { userDto } from '../../src/users/dto.js';
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
});

test('DTO es una allowlist nueva sin secretos, estado interno ni mutaciones del registro', () => {
  const stored: User = Object.freeze({ id: 'd0347d10-079a-423d-a191-bf55608f1e38', ...input, emailKey: input.email, usernameKey: input.username, passwordHash: 'SECRET_HASH', failures: 3, lockedUntil: new Date('2026-01-01T01:00:00Z'), createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:30:00Z') });
  const dto = userDto(stored);
  assert.deepEqual(Object.keys(dto).sort(), ['id', 'name', 'ci', 'email', 'username', 'role', 'active', 'createdAt'].sort());
  assert.equal(userDtoSchema.safeParse(dto).success, true);
  assert.equal(dto.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(JSON.stringify(dto).includes('SECRET_HASH'), false);
  assert.equal(stored.createdAt instanceof Date, true);
  dto.name = 'Modificado en cliente';
  assert.equal(stored.name, input.name);
});
