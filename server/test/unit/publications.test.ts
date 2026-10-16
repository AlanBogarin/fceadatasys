import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cleanText, countWords, institutionYear, publicationHash, registrationSchema, settingsSchema } from '../../src/publications/schemas.js';

const input = { title: 'Trabajo aprobado', authorIds: [randomUUID()], tutorIds: [randomUUID()], careerId: randomUUID(), levelId: randomUUID(), typeId: randomUUID(), branchId: randomUUID(), summary: 'Resumen del trabajo', abstract: 'English abstract', keywords: 'economía, educación', year: 2026, approved: true, externalUrl: 'https://example.org/documento' };
test('Registro normaliza espacios y UUID y deriva modalidad externa sin alterar el formulario', () => {
  const raw = { ...input, title: '  Trabajo　 aprobado ', authorIds: [input.authorIds[0].toUpperCase()] };
  const result = registrationSchema.parse(raw);
  assert.equal(result.title, input.title);
  assert.deepEqual(result.authorIds, input.authorIds);
  assert.equal(result.source, 'EXTERNA');
  assert.equal(result.requiresLibraryCopy, false);
  assert.equal(raw.title, '  Trabajo　 aprobado ');
});
test('Conteo de palabras determinista para los mismos separadores del client, incluido el límite exacto', () => {
  assert.equal(countWords(' \t Uno\n dos\u00a0tres \u2003cuatro '), 4);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('palabra '.repeat(300)), 300);
  assert.equal(countWords(cleanText('palabra '.repeat(301))), 301);
  const compatibilityLigature = '\ufdfa';
  const parsed = registrationSchema.parse({ ...input, summary: ` ${compatibilityLigature} \t palabra ` });
  assert.equal(countWords(parsed.summary), 2, 'El contador no expande ligaduras Unicode a nuevas palabras respecto al client.');
  assert.equal(publicationHash(compatibilityLigature), publicationHash(compatibilityLigature.normalize('NFKC')), 'La comparación sí normaliza representaciones equivalentes.');
});
test('Hashes normalizados equivalentes e independientes de representación, acentos y puntuación', () => {
  const hash = publicationHash('Información — Económica');
  assert.match(hash, /^[a-f0-9]{64}$/);
  for (const value of ['INFORMACION ECONOMICA', 'Informacio\u0301n...Econo\u0301mica', 'ＩＮＦＯＲＭＡＣＩＯＮ　ＥＣＯＮＯＭＩＣＡ']) assert.equal(publicationHash(value), hash);
  assert.notEqual(publicationHash('Otra información'), hash);
});
test('Validación de texto, año, aprobación externa y arrays sin repetidos', () => {
  for (const change of [{ title: '---' }, { title: 'x'.repeat(251) }, { summary: '' }, { summary: 'x'.repeat(5001) }, { abstract: '---' }, { abstract: 'x'.repeat(5001) }, { keywords: 'x'.repeat(301) }, { year: 1899 }, { year: '2026' }, { year: 2026.5 }, { approved: false }, { authorIds: [] }, { tutorIds: [] }, { authorIds: [input.authorIds[0], input.authorIds[0].toUpperCase()] }, { tutorIds: [input.tutorIds[0], input.tutorIds[0]] }, { careerId: 'invalido' }]) assert.equal(registrationSchema.safeParse({ ...input, ...change }).success, false, JSON.stringify(change));
  assert.equal(registrationSchema.safeParse({ ...input, title: 'x'.repeat(250), summary: 'x'.repeat(5000), abstract: 'x'.repeat(5000), keywords: 'x'.repeat(300) }).success, true);
});
test('El navegador no puede enviar actores, adjuntos construidos, hashes, códigos ni auditoría', () => {
  for (const [key, value] of Object.entries({ actorId: randomUUID(), createdBy: { id: randomUUID() }, active: true, titleHash: 'a'.repeat(64), code: 'INV-00001', attachment: { sha256: 'a'.repeat(64) }, publicationAudit: [] })) assert.equal(registrationSchema.safeParse({ ...input, [key]: value }).success, false, key);
});
test('URL externa admite HTTP/HTTPS sin credenciales y rechaza modalidades contradictorias', () => {
  for (const externalUrl of ['', 'javascript:alert(1)', 'file:///tmp/file.pdf', 'ftp://example.org/file', 'https://user:pass@example.org/file', 'url-invalida', 'https://example.org/' + 'a'.repeat(2000)]) assert.equal(registrationSchema.safeParse({ ...input, externalUrl, source: 'EXTERNA' }).success, false, externalUrl);
  assert.equal(registrationSchema.parse({ ...input, externalUrl: 'http://example.org' }).externalUrl, 'http://example.org/');
  assert.equal(registrationSchema.safeParse({ ...input, attachmentId: randomUUID() }).success, false);
  assert.equal(registrationSchema.safeParse({ ...input, requiresLibraryCopy: true }).success, false);
});
test('Local exige archivo cuando corresponde Biblioteca y admite ausencia explícita de esa obligación', () => {
  const local = { ...input, source: 'LOCAL', externalUrl: '' };
  assert.equal(registrationSchema.safeParse(local).success, false);
  assert.equal(registrationSchema.parse({ ...local, attachmentId: randomUUID() }).requiresLibraryCopy, true);
  assert.equal(registrationSchema.parse({ ...local, requiresLibraryCopy: false }).requiresLibraryCopy, false);
  assert.equal(registrationSchema.safeParse({ ...local, externalUrl: input.externalUrl, attachmentId: randomUUID() }).success, false);
});
test('Parámetro de resumen y año respetan los límites documentados y el huso institucional', () => {
  for (const value of [0, -1, 10001, 300.5, '300']) assert.equal(settingsSchema.safeParse({ summaryWordLimit: value }).success, false);
  assert.equal(settingsSchema.safeParse({ summaryWordLimit: 300, actorId: 'x' }).success, false);
  assert.equal(institutionYear(new Date('2027-01-01T01:00:00Z')), 2026);
  assert.equal(institutionYear(new Date('2027-01-01T04:00:00Z')), 2027);
});
