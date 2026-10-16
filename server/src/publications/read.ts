import { Prisma, type PrismaClient, type Role } from '@prisma/client';
import { AppError } from '../errors.js';
import { publicationWhere } from './query.js';
import type { PublicationQuery } from './schemas.js';

// Explicit allowlists: no CI/email/ORCID, password data, hashes of normalized text
// or storage keys are fetched. Public readers do not fetch attachment metadata.
const person = { id: true, name: true } as const;
export const readSelect = (role: Role) => ({
  id: true, number: true, title: true, summary: true, abstract: true, keywords: true, year: true,
  source: true, requiresLibraryCopy: true, externalUrl: true, attachmentId: true,
  active: true, createdAt: true, createdBy: { select: person },
  authors: { orderBy: { position: 'asc' }, select: { author: { select: person } } },
  tutors: { orderBy: { position: 'asc' }, select: { tutor: { select: person } } },
  career: { select: person }, level: { select: person }, type: { select: person }, branch: { select: person },
  attachment: role === 'PUBLICO' ? false : { select: { id: true, name: true, size: true, mime: true, sha256: true, state: true, contentVerified: true, scannedAt: true } },
}) satisfies Prisma.PublicationSelect;
type ReadRow = Prisma.PublicationGetPayload<{ select: ReturnType<typeof readSelect> }>;
export function publicationReadDto(row: ReadRow, role: Role) {
  const file = row.attachment;
  const safeFile = role !== 'PUBLICO' && file?.state === 'CLEAN' && file.contentVerified && file.scannedAt && file.mime === 'application/pdf';
  return {
    id: row.id, code: `INV-${row.number.toString().padStart(5, '0')}`, title: row.title,
    authors: row.authors.map(link => link.author), tutors: row.tutors.map(link => link.tutor),
    career: row.career, level: row.level, type: row.type, branch: row.branch,
    summary: row.summary, abstract: row.abstract, keywords: row.keywords, year: row.year,
    source: row.source, requiresLibraryCopy: row.requiresLibraryCopy, externalUrl: row.externalUrl ?? '',
    hasAttachment: !!row.attachmentId,
    ...(safeFile ? { attachment: { id: file.id, name: file.name, size: file.size, mime: 'application/pdf' as const, sha256: file.sha256 } } : {}),
    active: row.active, createdAt: row.createdAt.toISOString(), createdBy: row.createdBy,
  };
}
export async function listPublications(prisma: PrismaClient, query: PublicationQuery, role: Role) {
  const where = publicationWhere(query, role);
  return prisma.$transaction(async tx => {
    const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total FROM public.publicaciones p WHERE ${where}`);
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT p.id FROM public.publicaciones p WHERE ${where} ORDER BY p.creado_en DESC, p.numero DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`);
    const rows = ids.length ? await tx.publication.findMany({ where: { id: { in: ids.map(row => row.id) } }, select: readSelect(role), orderBy: [{ createdAt: 'desc' }, { number: 'desc' }] }) : [];
    const total = Number(count.total);
    return { data: rows.map(row => publicationReadDto(row, role)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export async function readPublication(prisma: PrismaClient, id: string, role: Role) {
  // Relations and publication must share one snapshot even if names change during a read.
  return prisma.$transaction(async tx => {
    const row = await tx.publication.findFirst({ where: { id, ...(role === 'ADMINISTRADOR' ? {} : { active: true }) }, select: readSelect(role) });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'La publicación no existe o no está disponible.');
    return publicationReadDto(row, role);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
