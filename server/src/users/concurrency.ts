import { createHash } from 'node:crypto';
import type { User } from '@prisma/client';
import { AppError } from '../errors.js';
import { userDto } from './dto.js';

/** Version of the public metadata representation, independent from login/password counters. */
export function userEtag(user: User): string {
  return `"sha256-${createHash('sha256').update(JSON.stringify(userDto(user))).digest('hex')}"`;
}

export function requireUserIfMatch(value: string | string[] | undefined): string {
  if (value === undefined) throw new AppError(428, 'PRECONDITION_REQUIRED', 'Debes consultar el usuario y enviar su ETag en If-Match antes de modificarlo.');
  if (typeof value !== 'string' || !/^"sha256-[a-f0-9]{64}"$/.test(value.trim())) throw new AppError(400, 'VALIDATION_ERROR', 'If-Match debe contener un único ETag fuerte emitido por esta API.', [{ name: 'header.If-Match', reason: 'No se admiten valores vacíos, comodines, listas ni ETags débiles.' }]);
  return value.trim();
}
