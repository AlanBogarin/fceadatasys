import { TextDecoder } from 'node:util';
import { AppError } from '../errors.js';
import { MAX_PDF_BYTES, validatePdf } from './storage.js';

export const supportedFormats = ['pdf', 'txt'] as const;
export type AttachmentFormat = typeof supportedFormats[number];
export const attachmentMimes = ['application/pdf', 'text/plain'] as const;
export const formatMime = { pdf: 'application/pdf', txt: 'text/plain' } as const;
export function attachmentFormat(name: string): AttachmentFormat {
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (extension !== 'pdf' && extension !== 'txt') throw new AppError(400, 'INVALID_ATTACHMENT', 'El formato no tiene un validador de contenido disponible.');
  return extension;
}
export function attachmentName(name: string) {
  const extension = attachmentFormat(name);
  const base = name.slice(0, -4).normalize('NFKC').replace(/[\\/:*?"<>|\p{Cc}\p{Cf}]/gu, '_').trim().replace(/^\.+/, '').slice(0, 140) || 'documento';
  return `${base}.${extension}`;
}
export function assertFormatEnabled(format: AttachmentFormat, allowed: string[]) {
  if (!allowed.includes(format)) throw new AppError(400, 'INVALID_ATTACHMENT', 'Este formato no está habilitado por el Administrador.', [{ name: 'file', reason: `Formatos admitidos: ${allowed.join(', ')}.` }]);
}
export function validateAttachment(bytes: Buffer, format: AttachmentFormat) {
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new AppError(400, 'INVALID_ATTACHMENT', 'El archivo debe contener entre 1 byte y 25 MiB.');
  if (format === 'pdf') return validatePdf(bytes);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new AppError(400, 'INVALID_ATTACHMENT', 'El TXT debe contener texto UTF-8 válido.'); }
  if (!text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text)) throw new AppError(400, 'INVALID_ATTACHMENT', 'El TXT no puede estar vacío ni contener controles binarios.');
}
export function isSupportedFile(file: { name: string; mime: string }) {
  return supportedFormats.some(format => file.name.toLowerCase().endsWith(`.${format}`) && file.mime === formatMime[format]);
}
