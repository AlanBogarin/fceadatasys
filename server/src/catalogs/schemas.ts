import { z } from 'zod';
import type { Role } from '@prisma/client';
import { AppError } from '../errors.js';

export const catalogKeys = ['autores', 'tutores', 'carreras', 'facultades', 'filiales', 'tipos', 'niveles'] as const;
export type CatalogKey = typeof catalogKeys[number];
export const catalogParams = z.object({ catalog: z.enum(catalogKeys) }).strict();
export const catalogIdParams = catalogParams.extend({ id: z.uuid() });
export const normalizeCatalog = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').replace(/[\p{P}\p{S}]/gu, ' ').replace(/\s+/gu, ' ').trim();
const text = (max: number) => z.string().transform(value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ')).pipe(z.string().max(max));
const name = text(150).refine(value => !!normalizeCatalog(value), 'Ingresá un nombre de hasta 150 caracteres.');
const optionalText = (max: number) => text(max).optional().default('');
const ci = optionalText(12).refine(value => !value || /^\d{5,12}$/.test(value), 'La CI debe contener entre 5 y 12 dígitos.');
const email = optionalText(150).transform(value => value.toLocaleLowerCase('es')).refine(value => !value || z.email().safeParse(value).success, 'Ingresá un correo electrónico válido.');
const fieldsByCatalog = {
  autores: z.object({ ci, email, orcid: optionalText(19).transform(value => value.toUpperCase()).refine(value => !value || /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(value), 'El formato de ORCID no es válido.') }).strict(),
  tutores: z.object({ ci, email, especialidad: optionalText(150) }).strict(),
  carreras: z.object({ codigo: optionalText(30), descripcion: optionalText(300) }).strict(),
  facultades: z.object({ sigla: optionalText(30), descripcion: optionalText(300) }).strict(),
  filiales: z.object({ direccion: optionalText(200), descripcion: optionalText(300) }).strict(),
  tipos: z.object({ descripcion: optionalText(300) }).strict(),
  niveles: z.object({ descripcion: optionalText(300) }).strict(),
};
export const createCatalogSchema = z.object({ name, fields: z.record(z.string(), z.string()).default({}) }).strict();
export const patchCatalogSchema = z.object({ name: name.optional(), fields: z.record(z.string(), z.string()).optional(), active: z.boolean().optional() }).strict().refine(input => Object.keys(input).length > 0, 'Debe enviar al menos un campo.');
export const catalogQuerySchema = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20), search: text(300).optional(), active: z.enum(['true', 'false']).transform(value => value === 'true').optional() }).strict();
export type CatalogQuery = z.infer<typeof catalogQuerySchema>;
export interface CatalogInput { name: string; fields: Record<string, string> }
export function validateCatalogInput(key: CatalogKey, input: CatalogInput): CatalogInput {
  const parsedName = name.safeParse(input.name);
  const parsedFields = fieldsByCatalog[key].safeParse(input.fields);
  if (!parsedName.success || !parsedFields.success) {
    const invalid = [
      ...(!parsedName.success ? parsedName.error.issues.map(issue => ({ name: 'body.name', reason: issue.message })) : []),
      ...(!parsedFields.success ? parsedFields.error.issues.map(issue => ({ name: ['body', 'fields', ...issue.path].join('.'), reason: issue.message })) : []),
    ];
    throw new AppError(400, 'VALIDATION_ERROR', 'Los datos del catálogo no son válidos.', invalid);
  }
  return { name: parsedName.data, fields: parsedFields.data };
}
export function canManageCatalog(role: Role, key: CatalogKey): boolean {
  return role === 'ADMINISTRADOR' || (role === 'DIGITADOR' && (key === 'autores' || key === 'tutores'));
}
export const catalogDtoSchema = z.object({ id: z.uuid(), name: z.string(), fields: z.record(z.string(), z.string()), active: z.boolean(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
export type CatalogDto = z.infer<typeof catalogDtoSchema>;
