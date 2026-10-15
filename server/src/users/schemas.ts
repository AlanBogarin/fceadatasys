import { z } from 'zod';
import { passwordSchema } from '../security/crypto.js';

export const roles = ['ADMINISTRADOR', 'DIGITADOR', 'PUBLICO'] as const;
export function normalizeIdentity(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('es'); }
const trimmed = z.string().transform(value => value.normalize('NFKC').trim());
export const userInputSchema = z.object({
  name: trimmed.pipe(z.string().min(1).max(100)),
  ci: trimmed.pipe(z.string().regex(/^\d{5,12}$/, 'La CI debe contener entre 5 y 12 dígitos.')),
  email: trimmed.transform(normalizeIdentity).pipe(z.email().max(254)),
  username: trimmed.pipe(z.string().regex(/^[A-Za-z0-9._-]{3,40}$/, 'El usuario debe tener entre 3 y 40 letras, números, puntos o guiones.')),
  role: z.enum(roles),
  active: z.boolean(),
}).strict();
export const createUserSchema = userInputSchema.extend({ password: passwordSchema });
export const updateUserSchema = userInputSchema.partial().refine(input => Object.keys(input).length > 0, 'Debe enviar al menos un campo.');
export const profileSchema = userInputSchema.pick({ name: true, email: true, username: true }).partial().refine(input => Object.keys(input).length > 0, 'Debe enviar al menos un campo.');
export const userDtoSchema = z.object({ id: z.uuid(), name: z.string(), ci: z.string(), email: z.string(), username: z.string(), role: z.enum(roles), active: z.boolean(), createdAt: z.iso.datetime() }).strict();
export const userQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: trimmed.pipe(z.string().max(100)).optional(), role: z.enum(roles).optional(), active: z.enum(['true', 'false']).transform(value => value === 'true').optional() }).strict();
export const idParamsSchema = z.object({ id: z.uuid() }).strict();
export type UserInput = z.infer<typeof userInputSchema>;
