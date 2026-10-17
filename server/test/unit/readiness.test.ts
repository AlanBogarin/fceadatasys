import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { assertUserCanDeactivate } from '../../src/users/dependencies.js';
import { visibleReservation } from '../../src/attachments/list.js';

test('H2: no permite inactivar si no puede comprobar los vínculos de negocio', async () => {
  const base = { publication: { count: async () => 0 }, storedAttachment: { count: async () => 0 } };
  const unavailable = { ...base, $queryRaw: async () => { throw Error('Persistencia no disponible'); } } as unknown as Prisma.TransactionClient;
  await assert.rejects(assertUserCanDeactivate(unavailable, 'actor'), /Persistencia no disponible/);
  const incomplete = { ...base, $queryRaw: async () => [] } as unknown as Prisma.TransactionClient;
  await assert.rejects(assertUserCanDeactivate(incomplete, 'actor'), /No se pudieron comprobar/);
});

test('H3: una reserva de publicación inactiva no identifica su publicación al Digitador', () => {
  const assignment = { publicationId: 'original', publication: { active: false } };
  assert.equal(visibleReservation(assignment, 'ADMINISTRADOR'), 'original');
  assert.equal(visibleReservation(assignment, 'DIGITADOR'), null);
  assert.equal(visibleReservation({ ...assignment, publication: { active: true } }, 'DIGITADOR'), 'original');
  assert.equal(visibleReservation(null, 'ADMINISTRADOR'), null);
});
