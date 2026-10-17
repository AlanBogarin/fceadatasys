import { createHash } from 'node:crypto';
import { AppError } from '../errors.js';

export function publicationEtag(dto: unknown) {
  return `"sha256-${createHash('sha256').update(JSON.stringify(dto)).digest('hex')}"`;
}
export function requirePublicationIfMatch(value: string | string[] | undefined) {
  if (value === undefined) throw new AppError(428, 'PRECONDITION_REQUIRED', 'Consultá la publicación y enviá su ETag en If-Match antes de modificarla.');
  if (typeof value !== 'string' || !/^"sha256-[a-f0-9]{64}"$/.test(value.trim())) throw new AppError(400, 'VALIDATION_ERROR', 'If-Match debe contener un único ETag fuerte emitido por esta API.', [{ name: 'header.If-Match', reason: 'No se admiten comodines, listas ni ETags débiles.' }]);
  return value.trim();
}
