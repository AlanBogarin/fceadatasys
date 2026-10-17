import { Prisma } from '@prisma/client';
import { AppError } from '../errors.js';

/** Caller holds the destination user lock. Writers of publications, files and catalog
 * events acquire that same user lock, so participation cannot appear behind this check.
 * Successful catalog events are immutable and commit with the corresponding mutation.
 */
export async function assertUserCanDeactivate(tx: Prisma.TransactionClient, id: string) {
  if (await tx.publication.count({ where: { createdById: id } })) {
    throw new AppError(409, 'USER_IN_USE', 'No se puede inactivar el usuario: tiene publicaciones registradas.');
  }
  if (await tx.storedAttachment.count({ where: { createdById: id } })) {
    throw new AppError(409, 'USER_IN_USE', 'No se puede inactivar el usuario: tiene archivos registrados.');
  }
  // Match the simulator's participants of existing records, including inactive ones.
  // Login, session, failed changes and unrelated audit events are not business links.
  const [result] = await tx.$queryRaw<{ used: boolean }[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM public.auditoria a
      WHERE a.usuario_id = ${id}::uuid AND a.estado = 'EXITO'
        AND a.operacion IN ('CATALOGO_CREADO', 'CATALOGO_MODIFICADO', 'CATALOGO_ACTIVADO', 'CATALOGO_INACTIVADO')
        AND (
          (a.recurso = 'autores' AND EXISTS (SELECT 1 FROM public.autores c WHERE c.id::text = a.recurso_id))
          OR (a.recurso = 'tutores' AND EXISTS (SELECT 1 FROM public.tutores c WHERE c.id::text = a.recurso_id))
          OR (a.recurso IN ('carreras', 'facultades', 'filiales', 'tipos', 'niveles') AND EXISTS (
            SELECT 1 FROM public.catalogos c WHERE c.id::text = a.recurso_id AND c.tipo::text = a.recurso
          ))
        )
    ) AS used`);
  if (typeof result?.used !== 'boolean') throw new Error('No se pudieron comprobar los vínculos del usuario.');
  if (result.used) throw new AppError(409, 'USER_IN_USE', 'No se puede inactivar el usuario: participó en registros de catálogos que se conservan.');
}
