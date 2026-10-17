import { Prisma, type PrismaClient, type Role } from "@prisma/client";
import { z } from "zod";
import { normalizeCatalog } from "../catalogs/schemas.js";

export const attachmentQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(300).optional(),
    status: z
      .enum(["DISPONIBLE", "VINCULADO", "RESERVADO", "RECHAZADO", "PENDIENTE"])
      .optional(),
    id: z.uuid().optional(),
  })
  .strict();
const selected = {
  id: true,
  name: true,
  size: true,
  mime: true,
  sha256: true,
  state: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true } },
  publication: {
    select: { id: true, number: true, title: true, active: true },
  },
  assignment: { select: { publicationId: true } },
} satisfies Prisma.StoredAttachmentSelect;
export async function listAttachments(
  prisma: PrismaClient,
  actor: { userId: string; role: Role },
  query: z.infer<typeof attachmentQuery>,
) {
  const status = Prisma.sql`CASE WHEN a.estado = 'PENDING' THEN 'PENDIENTE' WHEN a.estado <> 'CLEAN' THEN 'RECHAZADO' WHEN p.id IS NOT NULL THEN 'VINCULADO' WHEN h.adjunto_id IS NOT NULL THEN 'RESERVADO' ELSE 'DISPONIBLE' END`;
  const conditions: Prisma.Sql[] = [];
  if (actor.role !== "ADMINISTRADOR")
    conditions.push(
      Prisma.sql`(a.creado_por_id=${actor.userId}::uuid OR p.activo=true)`,
    );
  if (query.id) conditions.push(Prisma.sql`a.id=${query.id}::uuid`);
  if (query.status) conditions.push(Prisma.sql`${status}=${query.status}`);
  if (query.search) {
    const term =
      "%" + normalizeCatalog(query.search).replace(/[\\%_]/g, "\\$&") + "%";
    conditions.push(
      Prisma.sql`(lower(regexp_replace(public.publication_search_text(a.nombre),'[[:punct:][:space:]]+',' ','g')) LIKE ${term} OR lower(regexp_replace(public.publication_search_text(COALESCE(p.titulo,'')),'[[:punct:][:space:]]+',' ','g')) LIKE ${term} OR ('inv '||CASE WHEN length(p.numero::text)<5 THEN lpad(p.numero::text,5,'0') ELSE p.numero::text END) LIKE ${term})`,
    );
  }
  const from = Prisma.sql`FROM public.adjuntos a LEFT JOIN public.publicaciones p ON p.adjunto_id=a.id LEFT JOIN public.asignaciones_adjuntos h ON h.adjunto_id=a.id WHERE ${conditions.length ? Prisma.join(conditions, " AND ") : Prisma.sql`true`}`;
  return prisma.$transaction(
    async (tx) => {
      const [count] = await tx.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total ${from}`,
      );
      const ids = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT a.id ${from} ORDER BY a.creado_en DESC,a.id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      );
      const rows = await tx.storedAttachment.findMany({
        where: { id: { in: ids.map((row) => row.id) } },
        select: selected,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const data = rows.map((row) => ({
        id: row.id,
        name: row.name,
        size: row.size,
        mime: row.mime,
        sha256: row.sha256,
        createdAt: row.createdAt.toISOString(),
        createdBy: row.createdBy,
        status:
          row.state !== "CLEAN"
            ? row.state === "PENDING"
              ? "PENDIENTE"
              : "RECHAZADO"
            : row.publication
              ? "VINCULADO"
              : row.assignment
                ? "RESERVADO"
                : "DISPONIBLE",
        publication:
          row.publication &&
          (actor.role === "ADMINISTRADOR" || row.publication.active)
            ? {
                id: row.publication.id,
                code: `INV-${row.publication.number.toString().padStart(5, "0")}`,
                title: row.publication.title,
                active: row.publication.active,
              }
            : null,
      }));
      const total = Number(count.total);
      return {
        data,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
