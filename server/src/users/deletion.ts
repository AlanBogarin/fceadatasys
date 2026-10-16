import { Prisma, type User } from '@prisma/client';
import { AppError } from '../errors.js';

export function enforceUserDeletionRules(user: Pick<User, 'id' | 'role' | 'active'>, actorId: string, activeAdmins: number) {
  if (user.id === actorId) throw new AppError(400, 'SELF_PRIVILEGE_CHANGE', 'No puedes eliminar tu propia cuenta.');
  if (user.active && user.role === 'ADMINISTRADOR' && activeAdmins <= 1) throw new AppError(409, 'LAST_ADMIN_REQUIRED', 'Debe quedar al menos un Administrador activo.');
}

/** Caller holds FOR UPDATE on the user. Preserve every incoming FK, including future domains. */
export async function assertUserUnreferenced(tx: Prisma.TransactionClient, id: string) {
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
    WHERE fk.contype = 'f' AND fk.confrelid = to_regclass('public.usuarios')
      AND NOT (ns.nspname = 'public' AND source.relname = 'tokens_recuperacion')
    GROUP BY fk.oid, ns.nspname, source.relname`);
  const identifier = (value: string) => Prisma.raw('"' + value.replace(/"/g, '""') + '"');
  for (const reference of references) {
    const joins = reference.sourceColumns.map((column, index) => Prisma.sql`r.${identifier(column)} = u.${identifier(reference.targetColumns[index])}`);
    const [result] = await tx.$queryRaw<{ used: boolean }[]>(Prisma.sql`
      SELECT EXISTS(SELECT 1 FROM ${identifier(reference.schema)}.${identifier(reference.table)} r
        JOIN public.usuarios u ON ${Prisma.join(joins, ' AND ')} WHERE u.id = ${id}::uuid) AS used`);
    if (result.used) throw new AppError(409, 'USER_IN_USE', 'No se puede eliminar el usuario: tiene registros, sesiones u operaciones históricas asociadas.');
  }
}
