import { Prisma, type Author, type Tutor, type CatalogRecord } from '@prisma/client';
import { normalizeCatalog, type CatalogDto, type CatalogInput, type CatalogKey, type CatalogQuery } from './schemas.js';
import { AppError } from '../errors.js';

type Tx = Prisma.TransactionClient;
type Stored = Author | Tutor | CatalogRecord;
export function catalogDto(row: Stored, key: CatalogKey): CatalogDto {
  let fields: Record<string, string>;
  if ('orcid' in row) fields = { ci: row.ci ?? '', email: row.email ?? '', orcid: row.orcid ?? '' };
  else if ('specialization' in row) fields = { ci: row.ci ?? '', email: row.email ?? '', especialidad: row.specialization ?? '' };
  else {
    fields = { descripcion: row.description ?? '' };
    if (key === 'carreras') fields.codigo = row.code ?? '';
    if (key === 'facultades') fields.sigla = row.acronym ?? '';
    if (key === 'filiales') fields.direccion = row.address ?? '';
  }
  return { id: row.id, name: row.name, fields, active: row.active, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
const uniqueKey = (value: string | undefined) => value ? normalizeCatalog(value) : null;
function baseData(input: CatalogInput) {
  return { name: input.name, nameKey: normalizeCatalog(input.name), searchKey: normalizeCatalog([input.name, ...Object.values(input.fields)].join(' ')) };
}
function authorData(input: CatalogInput) {
  const { ci, email, orcid } = input.fields;
  return { ...baseData(input), ci: ci || null, email: email || null, orcid: orcid || null, ciKey: uniqueKey(ci), emailKey: uniqueKey(email), orcidKey: uniqueKey(orcid) };
}
function tutorData(input: CatalogInput) {
  const { ci, email, especialidad } = input.fields;
  return { ...baseData(input), ci: ci || null, email: email || null, specialization: especialidad || null, ciKey: uniqueKey(ci), emailKey: uniqueKey(email) };
}
function recordData(input: CatalogInput) {
  const { codigo, sigla, direccion, descripcion } = input.fields;
  return { ...baseData(input), code: codigo || null, acronym: sigla || null, address: direccion || null, description: descripcion || null, codeKey: uniqueKey(codigo), acronymKey: uniqueKey(sigla) };
}
export async function getCatalog(tx: Tx, key: CatalogKey, id: string): Promise<CatalogDto | null> {
  const row = key === 'autores' ? await tx.author.findUnique({ where: { id } }) : key === 'tutores' ? await tx.tutor.findUnique({ where: { id } }) : await tx.catalogRecord.findFirst({ where: { id, kind: key } });
  return row ? catalogDto(row, key) : null;
}
export async function listCatalog(tx: Tx, key: CatalogKey, query: CatalogQuery) {
  const search = query.search === undefined ? undefined : normalizeCatalog(query.search).replace(/[\\%_]/g, '\\$&');
  const where = { ...(query.active === undefined ? {} : { active: query.active }), ...(search ? { searchKey: { contains: search } } : {}) };
  const args = { where, orderBy: [{ nameKey: 'asc' as const }, { id: 'asc' as const }], skip: (query.page - 1) * query.pageSize, take: query.pageSize };
  let rows: Stored[];
  let total: number;
  if (key === 'autores') { total = await tx.author.count({ where }); rows = await tx.author.findMany(args); }
  else if (key === 'tutores') { total = await tx.tutor.count({ where }); rows = await tx.tutor.findMany(args); }
  else { const typedWhere = { ...where, kind: key }; total = await tx.catalogRecord.count({ where: typedWhere }); rows = await tx.catalogRecord.findMany({ ...args, where: typedWhere }); }
  return { data: rows.map(row => catalogDto(row, key)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) } };
}
export async function createCatalog(tx: Tx, key: CatalogKey, input: CatalogInput) {
  const row = key === 'autores' ? await tx.author.create({ data: authorData(input) }) : key === 'tutores' ? await tx.tutor.create({ data: tutorData(input) }) : await tx.catalogRecord.create({ data: { ...recordData(input), kind: key } });
  return catalogDto(row, key);
}
export async function updateCatalog(tx: Tx, key: CatalogKey, id: string, input: CatalogInput, active: boolean) {
  const row = key === 'autores' ? await tx.author.update({ where: { id }, data: { ...authorData(input), active } }) : key === 'tutores' ? await tx.tutor.update({ where: { id }, data: { ...tutorData(input), active } }) : await tx.catalogRecord.update({ where: { id, kind: key }, data: { ...recordData(input), active } });
  return catalogDto(row, key);
}
export async function deleteCatalog(tx: Tx, key: CatalogKey, id: string) {
  if (key === 'autores') await tx.author.delete({ where: { id } });
  else if (key === 'tutores') await tx.tutor.delete({ where: { id } });
  else await tx.catalogRecord.delete({ where: { id, kind: key } });
}

// Whitelisted identifiers only. All catalog mutations lock this row before reading it.
export async function lockCatalog(tx: Tx, key: CatalogKey, id: string) {
  const table = Prisma.raw(key === 'autores' ? 'autores' : key === 'tutores' ? 'tutores' : 'catalogos');
  await tx.$queryRaw(Prisma.sql`SELECT id FROM ${table} WHERE id = ${id}::uuid FOR UPDATE`);
}

/** Caller holds FOR UPDATE on the target. Unknown incoming dependencies stay conservative.
 * Inactivation ignores only references from inactive publications; DELETE retains every FK.
 */
async function assertCatalogReferences(tx: Tx, key: CatalogKey, id: string, inactivating: boolean) {
  const targetTable = key === 'autores' ? 'autores' : key === 'tutores' ? 'tutores' : 'catalogos';
  const references = await tx.$queryRaw<{ schema: string; table: string; sourceColumns: string[]; targetColumns: string[] }[]>(Prisma.sql`
    SELECT ns.nspname AS schema, source.relname AS table,
      array_agg(sa.attname::text ORDER BY columns.ordinality) AS "sourceColumns",
      array_agg(ta.attname::text ORDER BY columns.ordinality) AS "targetColumns"
    FROM pg_catalog.pg_constraint fk
    JOIN pg_catalog.pg_class source ON source.oid = fk.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = source.relnamespace
    CROSS JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY AS columns(source_num, target_num, ordinality)
    JOIN pg_catalog.pg_attribute sa ON sa.attrelid = fk.conrelid AND sa.attnum = columns.source_num
    JOIN pg_catalog.pg_attribute ta ON ta.attrelid = fk.confrelid AND ta.attnum = columns.target_num
    WHERE fk.contype = 'f' AND fk.confrelid = to_regclass(${'public.' + targetTable})
    GROUP BY fk.oid, ns.nspname, source.relname`);
  const identifier = (value: string) => Prisma.raw('"' + value.replace(/"/g, '""') + '"');
  for (const reference of references) {
    const joins = reference.sourceColumns.map((column, index) => Prisma.sql`r.${identifier(column)} = c.${identifier(reference.targetColumns[index])}`);
    let activePublication = Prisma.empty;
    if (inactivating && reference.schema === 'public') {
      if (reference.table === 'publicaciones') activePublication = Prisma.sql`AND r.activo = true`;
      else if (reference.table === 'publicacion_autores' || reference.table === 'publicacion_tutores') {
        activePublication = Prisma.sql`AND EXISTS (SELECT 1 FROM public.publicaciones p WHERE p.id = r.publicacion_id AND p.activo = true)`;
      }
    }
    const [result] = await tx.$queryRaw<{ used: boolean }[]>(Prisma.sql`
      SELECT EXISTS(SELECT 1 FROM ${identifier(reference.schema)}.${identifier(reference.table)} r
        JOIN public.${identifier(targetTable)} c ON ${Prisma.join(joins, ' AND ')}
        WHERE c.id = ${id}::uuid ${activePublication}) AS used`);
    if (result.used) throw new AppError(409, 'CATALOG_IN_USE', 'El registro tiene referencias y debe conservarse.');
  }
}

export const assertCatalogUnreferenced = (tx: Tx, key: CatalogKey, id: string) => assertCatalogReferences(tx, key, id, false);
export const assertCatalogCanDeactivate = (tx: Tx, key: CatalogKey, id: string) => assertCatalogReferences(tx, key, id, true);
