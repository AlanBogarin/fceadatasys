import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { publicationPatchSchema, publicationStateSchema, settingsPatchSchema } from '../../src/publications/schemas.js';
import { publicationEtag, requirePublicationIfMatch } from '../../src/publications/concurrency.js';
import { assertFormatEnabled, attachmentName, validateAttachment, isSupportedFile } from '../../src/attachments/formats.js';

test('PATCH parcial conserva ausencia, permite retirar adjunto y rechaza identidad/estado del cliente', () => {
  assert.deepEqual(publicationPatchSchema.parse({ title: '  Título   nuevo  ' }), { title: 'Título nuevo' });
  assert.deepEqual(publicationPatchSchema.parse({ attachmentId: null }), { attachmentId: null });
  for (const input of [{}, { approved: true }, { active: false }, { id: randomUUID() }, { createdById: randomUUID() }, { summary: '' }, { tutorIds: [] }, { authorIds: [randomUUID(), 'bad'] }]) assert.equal(publicationPatchSchema.safeParse(input).success, false);
  assert.deepEqual(publicationStateSchema.parse({ active: false }), { active: false });
  for (const input of [{}, { active: true }, { active: false, title: 'Otro' }]) assert.equal(publicationStateSchema.safeParse(input).success, false);
});
test('ETag detecta cambios y exige una única precarga fuerte', () => {
  const value = publicationEtag({ title: 'A', active: true });
  assert.equal(requirePublicationIfMatch(value), value);
  assert.equal(requirePublicationIfMatch(` ${value} `), value);
  assert.notEqual(value, publicationEtag({ title: 'A', active: false }));
  assert.throws(() => requirePublicationIfMatch(undefined), { status: 428 });
  for (const input of ['', '*', `W/${value}`, `${value},${value}`, [value]]) assert.throws(() => requirePublicationIfMatch(input), { status: 400 });
});
test('Parámetros parciales solo habilitan formatos con validador y sin duplicados', () => {
  assert.deepEqual(settingsPatchSchema.parse({ summaryWordLimit: 300 }), { summaryWordLimit: 300 });
  assert.deepEqual(settingsPatchSchema.parse({ allowedFormats: ['txt', 'pdf'] }), { allowedFormats: ['pdf', 'txt'] });
  for (const input of [{}, { allowedFormats: [] }, { allowedFormats: ['pdf', 'pdf'] }, { allowedFormats: ['exe'] }, { allowedFormats: ['PDF'] }, { allowedFormats: [null] }]) assert.equal(settingsPatchSchema.safeParse(input).success, false);
});
test('TXT UTF-8 valida contenido, rechaza binarios, controles, tamaño y formatos no habilitados', () => {
  validateAttachment(Buffer.from('Resumen español\nAbstract English\t2026'), 'txt');
  for (const bytes of [Buffer.alloc(0), Buffer.from(' \n'), Buffer.from([0xff, 0xfe, 0x61]), Buffer.from('a\0b'), Buffer.from('a\u0085b'), Buffer.alloc(10 * 1024 * 1024 + 1, 65)]) assert.throws(() => validateAttachment(bytes, 'txt'), { code: 'INVALID_ATTACHMENT' });
  assert.throws(() => validateAttachment(Buffer.from('texto'), 'pdf'), { code: 'INVALID_ATTACHMENT' });
  assert.throws(() => assertFormatEnabled('txt', ['pdf']), { code: 'INVALID_ATTACHMENT' });
  assertFormatEnabled('txt', ['pdf', 'txt']);
  assert.equal(attachmentName('../Resumen:final.TXT'), '_Resumen_final.txt');
  assert.throws(() => attachmentName('documento.exe'), { code: 'INVALID_ATTACHMENT' });
  assert.equal(isSupportedFile({ name: 'Tesis.txt', mime: 'application/pdf' }), false);
  assert.equal(isSupportedFile({ name: 'Tesis.txt', mime: 'text/plain' }), true);
});
