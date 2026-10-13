import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, changeOwnPassword, changeUserPassword, digest, hashPassword, makeUser, resetPassword, seed, updateUser, validateUser, DEMO_PASSWORD } from './model';
test('login, bloqueo por tres fallos y desbloqueo tras cinco minutos', async () => {
  let state = await seed(); const now = 1000;
  for (let i = 0; i < 3; i++) { const result = await authenticate(state, 'admin', 'Incorrecta1', now); state = result.state; assert.ok(result.error); }
  assert.equal((await authenticate(state, 'admin', DEMO_PASSWORD, now + 1)).userId, undefined);
  assert.ok((await authenticate(state, 'admin', DEMO_PASSWORD, now + 300001)).userId);
});
test('mantenimiento rechaza duplicados y protege cuenta propia y permisos', async () => {
  const state = await seed(); const [admin, digitador] = state.users;
  assert.throws(() => validateUser({ ...digitador, email: ` ${admin.email.toUpperCase()} ` }, state.users, digitador.id), /correo/);
  assert.throws(() => updateUser(state, admin.id, admin.id, { ...admin, active: false }), /propia/);
  assert.throws(() => updateUser(state, digitador.id, admin.id, admin), /administrador/);
  const inactive = updateUser(state, admin.id, digitador.id, { ...digitador, active: false });
  assert.ok((await authenticate(inactive, digitador.username, DEMO_PASSWORD)).error);
});
test('crear y editar una cuenta conserva el hash y admite login', async () => {
  let state = await seed(); const admin = state.users[0];
  const input = validateUser({ name: 'María Demo', ci: '7654321', username: 'maria', email: 'maria@example.test', role: 'PUBLICO', active: true }, state.users);
  const created = await makeUser(input, 'Prueba123!'); state = { ...state, users: [...state.users, created] };
  state = updateUser(state, admin.id, created.id, { ...created, name: created.name, role: 'DIGITADOR' });
  assert.equal(state.users.at(-1)?.passwordHash, created.passwordHash);
  assert.equal((await authenticate(state, 'maria', 'Prueba123!')).userId, created.id);
});
test('recuperación vence, cambia la contraseña y es de un solo uso', async () => {
  const state = await seed(); const user = state.users[0]; const token = 'token-local-de-prueba'; const hash = await digest(token);
  const pending = { ...state, recovery: [{ hash, userId: user.id, expiresAt: 5000 }] };
  await assert.rejects(resetPassword(pending, token, 'Nueva2026!', 5001), /venció/);
  const next = await resetPassword(pending, token, 'Nueva2026!', 1000);
  await assert.rejects(resetPassword(next, token, 'Otra2026!', 1001), /utilizado/);
  assert.ok((await authenticate(next, 'admin', DEMO_PASSWORD)).error);
  assert.equal((await authenticate(next, 'admin', 'Nueva2026!')).userId, user.id);
  assert.notEqual(next.users[0].passwordHash, 'Nueva2026!');
  assert.equal(next.users[0].passwordHash, await hashPassword('Nueva2026!', next.users[0].salt));
});

test('cambio personal verifica contraseña actual y conserva identidad activa de la sesión local', async () => {
  const state = await seed(); const admin = state.users[0];
  await assert.rejects(changeOwnPassword(state, admin.id, 'Incorrecta1', 'Nueva2026!'), /actual es incorrecta/);
  await assert.rejects(changeOwnPassword(state, admin.id, DEMO_PASSWORD, DEMO_PASSWORD), /diferente/);
  const pending = { ...state, recovery: [{ hash: 'pendiente', userId: admin.id, expiresAt: Date.now() + 60000 }] };
  const changed = await changeOwnPassword(pending, admin.id, DEMO_PASSWORD, 'Nueva2026!');
  assert.ok(changed.users.some(u => u.id === admin.id && u.active));
  assert.equal(changed.users[0].role, admin.role);
  assert.equal(changed.recovery.length, 0);
  assert.ok((await authenticate(changed, 'admin', DEMO_PASSWORD)).error);
  assert.equal((await authenticate(changed, 'admin', 'Nueva2026!')).userId, admin.id);
});

test('solo administrador cambia contraseña ajena sin alterar rol, estado ni su propia credencial', async () => {
  const state = await seed(); const [admin, digitador, publico] = state.users;
  await assert.rejects(changeUserPassword(state, digitador.id, publico.id, 'Nueva2026!'), /administrador/);
  await assert.rejects(changeUserPassword(state, admin.id, admin.id, 'Nueva2026!'), /Mi cuenta/);
  await assert.rejects(changeUserPassword(state, admin.id, 'inexistente', 'Nueva2026!'), /No se encontró/);
  await assert.rejects(changeUserPassword(state, admin.id, publico.id, 'corta'), /8 caracteres/);
  const inactive = updateUser(state, admin.id, publico.id, { ...publico, active: false });
  const changed = await changeUserPassword(inactive, admin.id, publico.id, 'Nueva2026!');
  const target = changed.users.find(u => u.id === publico.id)!;
  assert.equal(target.active, false); assert.equal(target.role, publico.role);
  assert.equal(changed.users[0].passwordHash, admin.passwordHash);
  assert.ok((await authenticate(changed, publico.username, 'Nueva2026!')).error);
  const active = updateUser(changed, admin.id, publico.id, { ...target, active: true });
  assert.equal((await authenticate(active, publico.username, 'Nueva2026!')).userId, publico.id);
  assert.ok((await authenticate(active, publico.username, DEMO_PASSWORD)).error);
});
