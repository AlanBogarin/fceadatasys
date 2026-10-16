import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAttachmentStorage, MAX_PDF_BYTES, pdfName, sha256, validatePdf } from '../../src/attachments/storage.js';
import { createClamScanner, parseClamResult } from '../../src/attachments/scanner.js';

test('PDF: contenido, tamaño y nombre seguro no dependen del MIME declarado', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.from('not a PDF'), Buffer.from('%PDF-1.7\nmissing EOF'), Buffer.alloc(MAX_PDF_BYTES + 1)]) assert.throws(() => validatePdf(bytes), { code: 'INVALID_ATTACHMENT' });
  assert.doesNotThrow(() => validatePdf(Buffer.from('%PDF-1.7\n%%EOF\n')));
  assert.equal(pdfName('../tesis: "final"\u0000.pdf'), '_tesis_ _final__.pdf');
  assert.equal(pdfName('.pdf'), 'documento.pdf');
  assert.ok(pdfName('a'.repeat(200) + '.pdf').length <= 150);
  assert.throws(() => pdfName('tesis.exe'), { code: 'INVALID_ATTACHMENT' });
});

test('ClamAV exige análisis completo; alertas, errores, límites y archivos omitidos no son CLEAN', () => {
  const ok = 'stdin: OK\nEngine version: 1.5.4\nScanned files: 1\n';
  assert.deepEqual(parseClamResult(0, ok, ''), { clean: true, engine: '1.5.4' });
  for (const [code, output, errors] of [[2, ok, ''], [null, ok, ''], [0, '', ''], [0, ok.replace('files: 1', 'files: 0'), ''], [0, ok, 'WARNING: ignored'], [0, 'WARNING: skipped\n' + ok, '']] as const) assert.equal(parseClamResult(code, output, errors), undefined);
  for (const signature of ['Win.Test.EICAR', 'Heuristics.Encrypted.PDF', 'Heuristics.Limits.Exceeded']) assert.deepEqual(parseClamResult(1, `stdin: ${signature} FOUND\n`, ''), { clean: false, engine: 'ClamAV', signature });
});

test('ClamAV inexistente falla cerrado sin exponer rutas del servidor', async () => {
  const scanner = createClamScanner({ command: '/nonexistent/private/scanner', timeoutMs: 1000, maxSignatureAgeDays: 7 });
  await assert.rejects(scanner.scan(Buffer.from('test')), { status: 503, code: 'ANTIMALWARE_UNAVAILABLE' });
});

test('Almacenamiento privado: hash/tamaño, ausencia, claves seguras y escritura exclusiva', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fcea-attachment-unit-'));
  const storage = createAttachmentStorage(root);
  const key = `${randomUUID()}.pdf`;
  const bytes = Buffer.from('%PDF-1.7\nfixture\n%%EOF\n');
  try {
    await storage.write(key, bytes);
    assert.deepEqual(await storage.read(key, bytes.length, sha256(bytes)), bytes);
    await assert.rejects(storage.write(key, Buffer.from('replacement')), { code: 'EEXIST' });
    assert.deepEqual(await storage.read(key, bytes.length, sha256(bytes)), bytes);
    await assert.rejects(storage.read(key, bytes.length + 1, sha256(bytes)), { code: 'ATTACHMENT_UNAVAILABLE' });
    await writeFile(join(root, key), Buffer.alloc(bytes.length, 65));
    await assert.rejects(storage.read(key, bytes.length, sha256(bytes)), { code: 'ATTACHMENT_UNAVAILABLE' });
    for (const unsafe of ['../secret.pdf', '/etc/passwd', 'other.pdf', '']) await assert.rejects(storage.read(unsafe, 1, ''), { code: 'ATTACHMENT_UNAVAILABLE' });
    await storage.remove(key);
    await storage.remove(key);
    await assert.rejects(storage.read(key, bytes.length, sha256(bytes)), { code: 'ATTACHMENT_UNAVAILABLE' });
  } finally { for (const file of await readdir(root)) await unlink(join(root, file)); await rmdir(root); }
});
