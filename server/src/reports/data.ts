import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { publicationQuerySchema, publicationReadSchema } from '../publications/schemas.js';
import { publicationWhere } from '../publications/query.js';
import { publicationReadDto, readSelect } from '../publications/read.js';

export const MAX_REPORT_RECORDS = 500;
export const MAX_REPORT_CHARACTERS = 2_000_000;
export const reportQuerySchema = publicationQuerySchema.safeExtend({ publicationId: z.uuid().transform(value => value.toLowerCase()).optional() });
const { page: _page, pageSize: _pageSize, ...exportFilters } = reportQuerySchema.shape;
export const exportQuerySchema = z.object({
  ...exportFilters,
  format: z.enum(['pdf', 'xlsx']), snapshot: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(query => !query.from || !query.to || query.from <= query.to, { message: 'La fecha inicial no puede ser posterior a la fecha final.', path: ['to'] });
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportRecord = z.infer<typeof publicationReadSchema>;
export type ReportFilters = Omit<ReportQuery, 'page' | 'pageSize'>;
export function reportFilters(query: ReportQuery): ReportFilters {
  const { page: _page, pageSize: _pageSize, ...filters } = query;
  return filters;
}
export function reportSnapshot(filters: ReportFilters, rows: ReportRecord[]) {
  const canonical = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '').sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(JSON.stringify([canonical, rows])).digest('hex');
}
export async function reportData(prisma: PrismaClient, query: ReportQuery) {
  const where = Prisma.sql`${publicationWhere(query, 'ADMINISTRADOR')} AND ${query.publicationId ? Prisma.sql`p.id = ${query.publicationId}::uuid` : Prisma.sql`TRUE`}`;
  return prisma.$transaction(async tx => {
    const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total FROM public.publicaciones p WHERE ${where}`);
    const total = Number(count.total);
    const bounded = total <= MAX_REPORT_RECORDS;
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT p.id FROM public.publicaciones p WHERE ${where} ORDER BY p.creado_en DESC, p.numero DESC LIMIT ${bounded ? MAX_REPORT_RECORDS : query.pageSize} OFFSET ${bounded ? 0 : (query.page - 1) * query.pageSize}`);
    const records = ids.length ? await tx.publication.findMany({ where: { id: { in: ids.map(row => row.id) } }, select: readSelect('ADMINISTRADOR'), orderBy: [{ createdAt: 'desc' }, { number: 'desc' }] }) : [];
    const rows = records.map(row => publicationReadDto(row, 'ADMINISTRADOR'));
    const exportable = bounded && JSON.stringify(rows).length <= MAX_REPORT_CHARACTERS;
    const snapshot = exportable && total > 0 ? reportSnapshot(reportFilters(query), rows) : null;
    return { rows, total, exportable, snapshot, data: bounded ? rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize) : rows };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
