import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogKeys, canManageCatalog, catalogQuerySchema, createCatalogSchema, patchCatalogSchema, normalizeCatalog, validateCatalogInput } from '../../src/catalogs/schemas.js';

test('Catálogos: Unicode, acentos, puntuación y espacios se comparan de forma equivalente', () => {
  for (const value of [' Ingeniería — Económica ', 'INGENIERIA ECONOMICA', 'Ingenieri\u0301a... Econo\u0301mica', 'ＩＮＧＥＮＩＥＲＩＡ　ＥＣＯＮＯＭＩＣＡ']) assert.equal(normalizeCatalog(value), 'ingenieria economica');
  assert.equal(normalizeCatalog(normalizeCatalog('Título: A/B')), 'titulo a b');
});
for (const key of catalogKeys) test(`Catálogo ${key}: permisos y validación de campos específicos`, () => {
  assert.equal(canManageCatalog('ADMINISTRADOR', key), true);
  assert.equal(canManageCatalog('PUBLICO', key), false);
  assert.equal(canManageCatalog('DIGITADOR', key), key === 'autores' || key === 'tutores');
  assert.equal(validateCatalogInput(key, { name: '  Nombre   completo ', fields: {} }).name, 'Nombre completo');
  for (const name of ['', '---', 'x'.repeat(151)]) assert.throws(() => validateCatalogInput(key, { name, fields: {} }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => validateCatalogInput(key, { name: 'Nombre', fields: { actorId: 'spoof' } }), { code: 'VALIDATION_ERROR' });
});
test('Autores y tutores: identidad opcional, normalización y límites de sus metadatos', () => {
  assert.deepEqual(validateCatalogInput('autores', { name: 'José', fields: { ci: '１２３４５', email: ' PERSONA@EXAMPLE.ORG ', orcid: '0000-0000-0000-000x' } }), { name: 'José', fields: { ci: '12345', email: 'persona@example.org', orcid: '0000-0000-0000-000X' } });
  const invalidFields: Record<string, string>[] = [{ ci: '1234' }, { ci: '1234567890123' }, { email: 'invalido' }, { orcid: '0000' }, { especialidad: 'ajeno' }];
  for (const fields of invalidFields) assert.throws(() => validateCatalogInput('autores', { name: 'Nombre', fields }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => validateCatalogInput('tutores', { name: 'Nombre', fields: { especialidad: 'x'.repeat(151) } }), { code: 'VALIDATION_ERROR' });
  assert.throws(() => validateCatalogInput('autores', { name: 'Nombre', fields: { email: 'x'.repeat(140) + '@example.org' } }), { code: 'VALIDATION_ERROR' });
});
test('Clasificaciones: límites y campos de cada catálogo', () => {
  for (const [key, field, max] of [['carreras', 'codigo', 30], ['facultades', 'sigla', 30], ['filiales', 'direccion', 200], ['tipos', 'descripcion', 300], ['niveles', 'descripcion', 300]] as const) {
    assert.equal(validateCatalogInput(key, { name: 'Nombre', fields: { [field]: 'x'.repeat(max) } }).fields[field].length, max);
    assert.throws(() => validateCatalogInput(key, { name: 'Nombre', fields: { [field]: 'x'.repeat(max + 1) } }), { code: 'VALIDATION_ERROR' });
  }
  assert.throws(() => validateCatalogInput('tipos', { name: 'Nombre', fields: { codigo: '123' } }), { code: 'VALIDATION_ERROR' });
});
test('Contratos estrictos, PATCH parcial y filtros paginados', () => {
  assert.deepEqual(createCatalogSchema.parse({ name: 'Nombre' }), { name: 'Nombre', fields: {} });
  assert.deepEqual(patchCatalogSchema.parse({ active: false }), { active: false });
  for (const body of [{}, { active: 'true' }, { participantIds: [] }, { actorId: 'x' }]) assert.equal(patchCatalogSchema.safeParse(body).success, false);
  for (const body of [{ name: 'Nombre', active: false }, { name: 'Nombre', fields: { codigo: 1 } }]) assert.equal(createCatalogSchema.safeParse(body).success, false);
  assert.deepEqual(catalogQuerySchema.parse({}), { page: 1, pageSize: 20 });
  assert.deepEqual(catalogQuerySchema.parse({ active: 'false', page: '2', search: ' José ' }), { active: false, page: 2, pageSize: 20, search: 'José' });
  for (const query of [{ page: '0' }, { pageSize: '101' }, { active: 'all' }, { sort: 'nameKey' }, { search: 'x'.repeat(301) }]) assert.equal(catalogQuerySchema.safeParse(query).success, false);
});
