import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalizeCatalog } from '../catalogs/schemas.js';
import { attachmentMimes, supportedFormats } from '../attachments/formats.js';

// Match the client before counting words; compatibility normalization can expand
// a single character into several words. Unicode normalization belongs to hashes.
export const cleanText = (value: string) => value.trim().replace(/\s+/gu, ' ');
export const countWords = (value: string) => value.trim().split(/\s+/u).filter(Boolean).length;
export const publicationHash = (value: string) => createHash('sha256').update(normalizeCatalog(value), 'utf8').digest('hex');
export const institutionYear = (now: Date) => Number(new Intl.DateTimeFormat('en', { timeZone: 'America/Asuncion', year: 'numeric' }).format(now));
const requiredText = (max: number) => z.string().transform(cleanText).pipe(z.string().max(max)).refine(value => !!normalizeCatalog(value), 'Completá este campo con texto válido.');
const identifiers = z.array(z.uuid()).min(1).max(100).refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length, 'No se permiten identificadores repetidos.').transform(ids => ids.map(id => id.toLowerCase()));
const id = z.uuid().transform(value => value.toLowerCase());
export const registrationSchema = z.object({
  title: requiredText(250), authorIds: identifiers, tutorIds: identifiers,
  careerId: id, levelId: id, typeId: id, branchId: id,
  summary: requiredText(5000), abstract: requiredText(5000), keywords: requiredText(300),
  year: z.number().int().min(1900), approved: z.literal(true, { error: 'Confirmá que el trabajo ya fue aprobado fuera del repositorio.' }),
  source: z.enum(['LOCAL', 'EXTERNA']).optional(),
  externalUrl: z.string().trim().max(2000).default(''),
  requiresLibraryCopy: z.boolean().optional(), attachmentId: id.optional(),
}).strict().superRefine((input, context) => {
  const source = input.source ?? (input.externalUrl ? 'EXTERNA' : 'LOCAL');
  const issue = (field: string, message: string) => context.addIssue({ code: 'custom', path: [field], message });
  if (source === 'EXTERNA') {
    const url = URL.parse(input.externalUrl);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2000) issue('externalUrl', 'Ingresá una URL HTTP/HTTPS válida, sin credenciales y con hasta 2000 caracteres.');
    if (input.attachmentId) issue('attachmentId', 'Una publicación externa no puede incluir un adjunto local.');
    if (input.requiresLibraryCopy) issue('requiresLibraryCopy', 'La copia de Biblioteca corresponde únicamente a publicaciones locales.');
  } else {
    if (input.externalUrl) issue('externalUrl', 'Una publicación local no puede incluir una URL externa.');
    if ((input.requiresLibraryCopy ?? true) && !input.attachmentId) issue('attachmentId', 'La copia digital es obligatoria para este trabajo local de Biblioteca.');
  }
}).transform(input => {
  const source = input.source ?? (input.externalUrl ? 'EXTERNA' as const : 'LOCAL' as const);
  return { ...input, source, requiresLibraryCopy: source === 'LOCAL' ? input.requiresLibraryCopy ?? true : false, externalUrl: source === 'EXTERNA' ? new URL(input.externalUrl).href : '' };
});
export type RegistrationInput = z.infer<typeof registrationSchema>;
const reference = z.object({ id: z.uuid(), name: z.string() }).strict();
export const publicationDtoSchema = z.object({
  id: z.uuid(), code: z.string(), title: z.string(), authors: z.array(reference), tutors: z.array(reference),
  career: reference, level: reference, type: reference, branch: reference,
  summary: z.string(), abstract: z.string(), keywords: z.string(), year: z.number(),
  source: z.enum(['LOCAL', 'EXTERNA']), requiresLibraryCopy: z.boolean(), externalUrl: z.string(),
  attachment: z.object({ id: z.uuid(), name: z.string(), size: z.number(), mime: z.enum(attachmentMimes), sha256: z.string() }).strict().optional(),
  active: z.boolean(), createdAt: z.iso.datetime(), createdBy: reference,
}).strict();
export const settingsSchema = z.object({
  summaryWordLimit: z.number().int().min(10).max(1000),
  maxPdfSizeMb: z.number().int().min(1).max(25),
  allowedFormats: z.array(z.enum(supportedFormats)).min(1).max(supportedFormats.length).refine(values => new Set(values).size === values.length, 'No repitas formatos.').transform(values => [...values].sort()),
}).strict();
export const settingsPatchSchema = settingsSchema.partial().refine(value => Object.keys(value).length > 0, 'Enviá al menos un parámetro.');
export const publicationPatchSchema = z.object({
  title: requiredText(250), authorIds: identifiers, tutorIds: identifiers,
  careerId: id, levelId: id, typeId: id, branchId: id,
  summary: requiredText(5000), abstract: requiredText(5000), keywords: requiredText(300), year: z.number().int().min(1900),
  source: z.enum(['LOCAL', 'EXTERNA']), externalUrl: z.string().trim().max(2000),
  requiresLibraryCopy: z.boolean(), attachmentId: id.nullable(),
}).partial().strict().refine(value => Object.keys(value).length > 0, 'Enviá al menos un campo.');
export const publicationStateSchema = z.object({ active: z.literal(false) }).strict();

const filterDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return value >= '1900-01-01' && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Ingresá una fecha válida YYYY-MM-DD, desde 1900.');
export function publicationNumber(code: string): bigint | undefined {
  const match = /^INV-(\d{1,19})$/i.exec(code.trim());
  if (!match) return undefined;
  const value = BigInt(match[1]);
  return value <= 9223372036854775807n ? value : undefined;
}
export const publicationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().transform(value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ')).pipe(z.string().max(300)).optional(),
  code: z.string().trim().toUpperCase().refine(value => publicationNumber(value) !== undefined, 'Usá INV- seguido de hasta 19 dígitos dentro del rango bigint.').optional(),
  careerId: id.optional(), levelId: id.optional(), typeId: id.optional(), branchId: id.optional(),
  authorId: id.optional(), tutorId: id.optional(),
  author: z.string().trim().max(150).optional(), tutor: z.string().trim().max(150).optional(),
  year: z.coerce.number().int().min(1900).max(9999).optional(),
  source: z.enum(['LOCAL', 'EXTERNA']).optional(),
  active: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  from: filterDate.optional(), to: filterDate.optional(),
}).strict().refine(query => !query.from || !query.to || query.from <= query.to, { message: 'La fecha inicial no puede ser posterior a la fecha final.', path: ['to'] });
export type PublicationQuery = z.infer<typeof publicationQuerySchema>;
export const publicationIdParams = z.object({ id }).strict();
export const publicationDetailQuerySchema = z.object({}).strict();
export const publicationReadSchema = publicationDtoSchema.extend({ hasAttachment: z.boolean() });
export const publicationListSchema = z.object({ data: z.array(publicationReadSchema), pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }).strict() }).strict();
