import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { publicationDetailQuerySchema, publicationIdParams, publicationNumber, publicationQuerySchema } from '../../src/publications/schemas.js';
import { publicationWhere } from '../../src/publications/query.js';

test('Listado: filtros tipados, predeterminados y normalización de UUID/texto', () => {
  assert.deepEqual(publicationQuerySchema.parse({}), { page: 1, pageSize: 20 });
  const id = randomUUID();
  const result = publicationQuerySchema.parse({ page: '2', pageSize: '100', year: '2026', active: 'false', authorId: id.toUpperCase(), source: 'LOCAL', search: '  Ｅｃｏｎｏｍíａ　 crecimiento ', code: ' inv-00123 ' });
  assert.deepEqual(result, { page: 2, pageSize: 100, year: 2026, active: false, authorId: id, source: 'LOCAL', search: 'Economía crecimiento', code: 'INV-00123' });
});
test('Listado: propiedades desconocidas, tipos, límites y filtros inválidos se rechazan', () => {
  for (const query of [{ page: '0' }, { page: '1.5' }, { pageSize: '101' }, { page: '100001' }, { active: 'all' }, { source: 'externa' }, { year: '1899' }, { year: '10000' }, { authorId: 'invalid' }, { careerId: 'invalid' }, { search: 'x'.repeat(301) }, { sort: 'storageKey' }, { actorId: randomUUID() }, { includeInactive: 'true' }]) assert.equal(publicationQuerySchema.safeParse(query).success, false, JSON.stringify(query));
});
test('Fechas del listado validan calendario real y rango inclusivo', () => {
  assert.equal(publicationQuerySchema.safeParse({ from: '2024-02-29', to: '2024-02-29' }).success, true);
  for (const query of [{ from: '2026-02-29' }, { from: '2026-04-31' }, { to: '2026-13-01' }, { from: '0000-01-01' }, { to: '2026-1-1' }, { from: '2026-10-17', to: '2026-10-16' }]) assert.equal(publicationQuerySchema.safeParse(query).success, false, JSON.stringify(query));
});
test('Código de publicación conserva precisión bigint y rechaza entradas fuera de contrato', () => {
  assert.equal(publicationNumber('INV-00001'), 1n);
  assert.equal(publicationNumber(' inv-100000 '), 100000n);
  assert.equal(publicationNumber('INV-9223372036854775807'), 9223372036854775807n);
  for (const code of ['INV-9223372036854775808', 'INV-12345678901234567890', 'INV--1', 'INV-1.5', '1', 'INV-%']) {
    assert.equal(publicationNumber(code), undefined);
    assert.equal(publicationQuerySchema.safeParse({ code }).success, false);
  }
});
test('SQL de filtros/FTS parametriza entradas y aplica el alcance del rol', () => {
  const search = "' OR 1=1 --";
  const query = publicationQuerySchema.parse({ search, source: 'EXTERNA', from: '2026-10-16', code: 'INV-00010' });
  const statement = publicationWhere(query, 'PUBLICO');
  assert.ok(statement.sql.includes('p.activo = true'));
  assert.equal(statement.sql.includes(search), false);
  assert.ok(statement.values.includes(search));
  assert.ok(statement.values.includes(10n));
  assert.ok(statement.values.includes('2026-10-16'));
  assert.equal(publicationWhere(publicationQuerySchema.parse({}), 'ADMINISTRADOR').sql, 'true');
  for (const role of ['DIGITADOR', 'PUBLICO'] as const) assert.throws(() => publicationWhere(publicationQuerySchema.parse({ active: 'false' }), role), { code: 'FORBIDDEN' });
});
test('Detalle: UUID obligatorio, query vacía y campos ajenos rechazados', () => {
  const id = randomUUID();
  assert.deepEqual(publicationIdParams.parse({ id: id.toUpperCase() }), { id });
  assert.equal(publicationIdParams.safeParse({ id: 'invalid' }).success, false);
  assert.deepEqual(publicationDetailQuerySchema.parse({}), {});
  assert.equal(publicationDetailQuerySchema.safeParse({ download: 'true' }).success, false);
});
