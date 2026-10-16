import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppError } from '../errors.js';

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function pdfName(name: string) {
  if (!/\.pdf$/i.test(name)) throw new AppError(400, 'INVALID_ATTACHMENT', 'Seleccioná un archivo con extensión PDF.');
  const base = name.slice(0, -4).normalize('NFKC').replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu, '_').trim().replace(/^\.+/, '').slice(0, 140) || 'documento';
  return `${base}.pdf`;
}
export function validatePdf(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new AppError(400, 'INVALID_ATTACHMENT', 'El PDF debe contener entre 1 byte y 10 MiB.');
  if (!/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n|\s)/.test(bytes.subarray(0, 9).toString('ascii')) || !/%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1'))) throw new AppError(400, 'INVALID_ATTACHMENT', 'El contenido no corresponde a un PDF reconocido.');
}

export interface AttachmentStorage { write(key: string, bytes: Buffer): Promise<void>; read(key: string, size: number, hash: string): Promise<Buffer>; remove(key: string): Promise<void> }
export function createAttachmentStorage(directory: string): AttachmentStorage {
  const root = resolve(directory);
  const path = (key: string) => {
    if (!/^[a-f0-9-]{36}\.pdf$/.test(key)) throw new AppError(503, 'ATTACHMENT_UNAVAILABLE', 'El adjunto no está disponible.');
    return resolve(root, key);
  };
  return {
    async write(key, bytes) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const file = await open(path(key), 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); }
      catch (error) { await file.close(); await unlink(path(key)); throw error; }
      finally { await file.close(); }
    },
    async read(key, size, hash) {
      try {
        if (size < 1 || size > MAX_PDF_BYTES || (await lstat(path(key))).isSymbolicLink()) throw new Error('Invalid storage');
        const file = await open(path(key), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size !== size) throw new Error('Invalid size');
          const bytes = Buffer.alloc(size + 1);
          let read = 0;
          while (read <= size) {
            const result = await file.read(bytes, read, bytes.length - read, null);
            if (!result.bytesRead) break;
            read += result.bytesRead;
          }
          if (read !== size || sha256(bytes.subarray(0, read)) !== hash) throw new Error('Invalid hash');
          return bytes.subarray(0, read);
        } finally { await file.close(); }
      } catch { throw new AppError(503, 'ATTACHMENT_UNAVAILABLE', 'El adjunto no está disponible o no coincide con su registro.'); }
    },
    async remove(key) { await unlink(path(key)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); },
  };
}
