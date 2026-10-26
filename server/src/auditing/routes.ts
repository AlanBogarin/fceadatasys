import { assertRequestPermission } from '../security/permissions.js';
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { AppError } from "../errors.js";
import { normalizeCatalog } from "../catalogs/schemas.js";
import { audit, requirePermission } from "../security/index.js";
import { publicationQuerySchema } from "../publications/schemas.js";

export const auditQuery = z
  .object({
    page: publicationQuerySchema.shape.page,
    pageSize: publicationQuerySchema.shape.pageSize,
    search: publicationQuerySchema.shape.search,
    from: publicationQuerySchema.shape.from,
    to: publicationQuerySchema.shape.to,
    actorId: z.uuid().optional(),
    role: z
      .enum(["ADMINISTRADOR", "DIGITADOR", "PUBLICO", "SIN_IDENTIFICAR"])
      .optional(),
    module: z.string().trim().max(80).optional(),
    operation: z.string().trim().max(80).optional(),
    status: z.enum(["EXITO", "FALLIDO"]).optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "El período es inválido.",
    path: ["to"],
  });
const exportQuery = auditQuery.safeExtend({
  format: z.enum(["pdf", "xlsx"]),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/),
});
type Filters = z.infer<typeof auditQuery>;
export function safeAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeAuditValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/password|contrase|token|secret|salt|hash|recovery|storageKey|navegador_clave/i.test(
              key,
            ),
        )
        .map(([key, item]) => [key, safeAuditValue(item)]),
    );
  if (typeof value === "string")
    return value
      .replace(/Bearer\s+\S+|sk-[\w-]+/gi, "[omitido]")
      .replace(
        /((?:password|contraseña|token|secret|salt|hash)\s*[:=]\s*)[^\s,;]+/gi,
        "$1[omitido]",
      );
  return value;
}
const select = {
  id: true,
  createdAt: true,
  userId: true,
  role: true,
  operation: true,
  resource: true,
  resourceId: true,
  publicationId: true,
  ip: true,
  userAgent: true,
  sessionId: true,
  status: true,
  detail: true,
  before: true,
  after: true,
  user: { select: { name: true, username: true } },
} satisfies Prisma.AuditLogSelect;
type Row = Prisma.AuditLogGetPayload<{ select: typeof select }>;
export const auditDto = (row: Row) => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  actorId: row.userId,
  actorName: row.user?.name ?? "Sin identificar",
  username: row.user?.username ?? null,
  actorRole: row.role,
  operation: row.operation,
  module: row.resource,
  resourceId: row.resourceId,
  publicationId: row.publicationId,
  ip: row.ip,
  userAgent: row.userAgent,
  sessionId: row.sessionId,
  status: row.status,
  detail: safeAuditValue(row.detail),
  before: safeAuditValue(row.before),
  after: safeAuditValue(row.after),
});
function auditSql(filters: Filters) {
  const conditions: Prisma.Sql[] = [];
  if (filters.from)
    conditions.push(
      Prisma.sql`a.creado_en >= (${filters.from}::date::timestamp AT TIME ZONE 'America/Asuncion')`,
    );
  if (filters.to)
    conditions.push(
      Prisma.sql`a.creado_en < ((${filters.to}::date + 1)::timestamp AT TIME ZONE 'America/Asuncion')`,
    );
  if (filters.actorId)
    conditions.push(Prisma.sql`a.usuario_id=${filters.actorId}::uuid`);
  if (filters.role)
    conditions.push(
      filters.role === "SIN_IDENTIFICAR"
        ? Prisma.sql`a.rol IS NULL`
        : Prisma.sql`a.rol=${filters.role}::public.rol_usuario`,
    );
  if (filters.status)
    conditions.push(
      Prisma.sql`a.estado=${filters.status}::public.estado_auditoria`,
    );
  if (filters.module) conditions.push(Prisma.sql`a.recurso=${filters.module}`);
  if (filters.operation)
    conditions.push(Prisma.sql`a.operacion=${filters.operation}`);
  if (filters.search) {
    const term =
      "%" + normalizeCatalog(filters.search).replace(/[\\%_]/g, "\\$&") + "%";
    conditions.push(
      Prisma.sql`lower(regexp_replace(public.publication_search_text(concat_ws(' ',a.id::text,u.nombre,u.usuario,a.operacion,a.recurso,a.recurso_id,a.publicacion_id::text,a.sesion_id::text,a.detalle,a.valores_anteriores::text,a.valores_nuevos::text)),'[[:punct:][:space:]]+',' ','g')) LIKE ${term}`,
    );
  }
  return Prisma.sql`FROM public.auditoria a LEFT JOIN public.usuarios u ON u.id=a.usuario_id WHERE ${conditions.length ? Prisma.join(conditions, " AND ") : Prisma.sql`true`}`;
}
async function data(prisma: PrismaClient, filters: Filters) {
  return prisma.$transaction(
    async (tx) => {
      const from = auditSql(filters);
      const [count] = await tx.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total ${from}`,
      );
      const total = Number(count.total);
      const ids = await tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT a.id ${from} ORDER BY a.creado_en DESC,a.id DESC LIMIT ${total <= 500 ? 500 : filters.pageSize} OFFSET ${total <= 500 ? 0 : (filters.page - 1) * filters.pageSize}`,
      );
      const rows = await tx.auditLog.findMany({
        where: { id: { in: ids.map((row) => row.id) } },
        select,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      const all = rows.map(auditDto);
      const { page: _page, pageSize: _size, ...criteria } = filters;
      const exportable =
        total > 0 && total <= 500 && JSON.stringify(all).length <= 2_000_000;
      const snapshot = exportable
        ? createHash("sha256")
            .update(JSON.stringify([Object.entries(criteria).sort(), all]))
            .digest("hex")
        : null;
      return {
        all,
        total,
        exportable,
        snapshot,
        visible:
          total <= 500
            ? all.slice(
                (filters.page - 1) * filters.pageSize,
                filters.page * filters.pageSize,
              )
            : all,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
async function assertAdmin(
  tx: Prisma.TransactionClient,
  request: FastifyRequest,
) {
  await tx.$queryRaw`SELECT id FROM usuarios WHERE id=${request.auth!.userId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sesiones WHERE id=${request.auth!.sessionId}::uuid FOR UPDATE`;
  const user = await tx.user.findUniqueOrThrow({
    where: { id: request.auth!.userId },
  });
  const session = await tx.session.findUniqueOrThrow({
    where: { id: request.auth!.sessionId },
  });
  const now = request.server.security.now();
  if (
    !user.active ||
    session.revokedAt ||
    session.expiresAt <= now ||
    now.getTime() - session.lastActivityAt.getTime() >= 600000
  )
    throw new AppError(401, "UNAUTHENTICATED", "La sesión venció.");
  await assertRequestPermission(tx, request, user);
}
export async function auditDocument(
  rows: ReturnType<typeof auditDto>[],
  criteria: object,
  format: "pdf" | "xlsx",
): Promise<Buffer> {
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Auditoría");
    const details = workbook.addWorksheet("Detalles");
    sheet.addRow(Object.keys(rows[0]));
    details.addRow(["Evento", "Campo", "Parte", "Contenido"]);
    const filterSheet = workbook.addWorksheet("Criterios");
    filterSheet.addRow(["Criterio", "Valor"]);
    for (const [key, value] of Object.entries(criteria))
      filterSheet.addRow([key, String(value)]);
    for (const row of rows)
      sheet.addRow(
        Object.entries(row).map(([key, value]) => {
          const text =
            typeof value === "object" && value !== null
              ? JSON.stringify(value)
              : String(value ?? "");
          if (text.length <= 30000) return text;
          for (let offset = 0; offset < text.length; offset += 30000)
            details.addRow([
              row.id,
              key,
              offset / 30000 + 1,
              text.slice(offset, offset + 30000),
            ]);
          return "Ver hoja Detalles";
        }),
      );
    for (const tab of workbook.worksheets) {
      tab.views = [{ state: "frozen", ySplit: 1 }];
      tab.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      tab.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF590D31" },
      };
      tab.columns.forEach((column) => {
        column.width = 28;
        column.alignment = { wrapText: true, vertical: "top" };
      });
      tab.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: tab.rowCount, column: tab.columnCount },
      };
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  const source = new URL("../../assets/fonts/DejaVuSans.ttf", import.meta.url);
  const font = fileURLToPath(
    existsSync(source)
      ? source
      : new URL("../../../assets/fonts/DejaVuSans.ttf", import.meta.url),
  );
  const doc = new PDFDocument({
    autoFirstPage: false,
    size: "A4",
    margins: { left: 44, right: 44, top: 80, bottom: 55 },
  });
  const chunks: Buffer[] = [];
  let size = 0;
  const complete = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (part: Buffer) => {
      size += part.length;
      if (size > 20 * 1024 * 1024)
        doc.destroy(
          new AppError(
            400,
            "AUDIT_EXPORT_LIMIT",
            "Reducí los filtros de auditoría.",
          ),
        );
      else chunks.push(part);
    });
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.font(font);
  doc.on("pageAdded", () => {
    doc
      .fontSize(13)
      .fillColor("#590D31")
      .text("FCEA / UNC · Auditoría", 44, 30, { lineBreak: false });
    doc
      .fontSize(8)
      .text("Dirección de Investigación", 44, 50, { lineBreak: false });
    doc.y = 80;
  });
  doc.addPage();
  doc.fontSize(12).text(`${rows.length} eventos · fechas UTC`);
  doc.fontSize(9).text(JSON.stringify(criteria));
  for (const row of rows) {
    doc.addPage();
    for (const [key, value] of Object.entries(row))
      doc
        .fontSize(9)
        .fillColor("#292633")
        .text(
          `${key}: ${typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "—")}`,
          { width: 507, lineGap: 3 },
        )
        .moveDown(0.4);
  }
  doc.end();
  return complete;
}
export async function registerAuditRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  let busy = false;
  app.get(
    "/api/v1/auditoria",
    { preHandler: requirePermission('audit.read') },
    async (request) => {
      const filters = auditQuery.parse(request.query);
      const result = await data(prisma, filters);
      return {
        data: result.visible,
        pagination: {
          page: filters.page,
          pageSize: filters.pageSize,
          total: result.total,
          totalPages: Math.ceil(result.total / filters.pageSize),
        },
        export: {
          snapshot: result.snapshot,
          exportable: result.exportable,
          maxRecords: 500,
        },
      };
    },
  );
  app.get(
    "/api/v1/auditoria/:id",
    { preHandler: requirePermission('audit.read') },
    async (request) => {
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      z.object({}).strict().parse(request.query);
      const row = await prisma.auditLog.findUnique({ where: { id }, select });
      if (!row) throw new AppError(404, "NOT_FOUND", "El evento no existe.");
      return auditDto(row);
    },
  );
  app.get(
    "/api/v1/auditoria/exportar",
    { preHandler: requirePermission('audit.read', 'audit.export'), exposeHeadRoute: false },
    async (request, reply) => {
      const { format, snapshot, ...filters } = exportQuery.parse(request.query);
      if (busy)
        throw new AppError(
          503,
          "AUDIT_EXPORT_BUSY",
          "Hay una exportación de auditoría en curso.",
        );
      busy = true;
      try {
        const result = await data(prisma, filters);
        if (!result.total) return { data: [], total: 0 };
        if (!result.exportable)
          throw new AppError(
            400,
            "AUDIT_EXPORT_LIMIT",
            "Seleccioná hasta 500 eventos y reducí los filtros.",
          );
        if (snapshot !== result.snapshot)
          throw new AppError(
            409,
            "AUDIT_VERSION_CONFLICT",
            "La auditoría cambió. Volvé a consultar.",
          );
        const bytes = await auditDocument(result.all, filters, format);
        if (reply.raw.destroyed)
          throw new AppError(
            400,
            "VALIDATION_ERROR",
            "La exportación fue cancelada.",
          );
        await prisma.$transaction(async (tx) => {
          await assertAdmin(tx, request);
          await audit(tx, request, {
            operation: "AUDITORIA_EXPORTADA",
            resource: "auditoria",
            status: "EXITO",
            after: { format, total: result.total, filters, snapshot },
          });
        });
        return reply
          .type(
            format === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          )
          .header(
            "Content-Disposition",
            `attachment; filename="auditoria.${format}"`,
          )
          .header("X-Content-Type-Options", "nosniff")
          .send(bytes);
      } finally {
        busy = false;
      }
    },
  );
}
