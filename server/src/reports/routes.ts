import { assertRequestPermission } from '../security/permissions.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { audit, requirePermission } from '../security/index.js';
import { exportQuerySchema, MAX_REPORT_RECORDS, reportData, reportFilters, reportQuerySchema } from './data.js';
import { generateReport, MAX_REPORT_BYTES, type ReportGenerator } from './documents.js';

export interface ReportOptions { generate?: ReportGenerator }
async function validateActor(tx: Prisma.TransactionClient, request: FastifyRequest) {
  const auth = request.auth!;
  await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${auth.userId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${auth.sessionId}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: auth.userId } });
  const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
  const now = request.server.security.now();
  if (!user?.active || !session || session.userId !== user.id || session.revokedAt || session.expiresAt <= now || now.getTime() - session.lastActivityAt.getTime() >= 600000) throw new AppError(401, 'UNAUTHENTICATED', 'La sesión no es válida o ha vencido.');
  await assertRequestPermission(tx, request, user);
  return user;
}
export async function registerReportRoutes(app: FastifyInstance, prisma: PrismaClient, options: ReportOptions = {}) {
  const generate = options.generate ?? generateReport;
  let busy = false;
  app.get('/api/v1/reportes/publicaciones', { preHandler: requirePermission('reports.read') }, async request => {
    const query = reportQuerySchema.parse(request.query);
    const result = await reportData(prisma, query);
    return { data: result.data, pagination: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) }, report: { snapshot: result.snapshot, exportable: result.total > 0 && result.exportable, maxRecords: MAX_REPORT_RECORDS } };
  });
  app.get('/api/v1/reportes/publicaciones/exportar', { preHandler: requirePermission('reports.read', 'reports.export'), exposeHeadRoute: false }, async (request, reply) => {
    const { format, snapshot, ...filtersInput } = exportQuerySchema.parse(request.query);
    if (busy) throw new AppError(503, 'REPORT_SERVICE_BUSY', 'Hay una exportación en curso. Volvé a intentar.');
    busy = true;
    let delivering = false;
    let released = false;
    const release = () => { if (!released) { released = true; busy = false; } };
    try {
      const query = { ...filtersInput, page: 1, pageSize: 100 };
      const result = await reportData(prisma, query);
      if (!result.total) return { data: [], total: 0 };
      if (!result.exportable) throw new AppError(400, 'REPORT_LIMIT_EXCEEDED', 'El reporte supera 500 registros o el límite de texto. Reducí los filtros.');
      if (snapshot !== result.snapshot) throw new AppError(409, 'REPORT_VERSION_CONFLICT', 'Los resultados cambiaron. Consultá el reporte nuevamente antes de exportar.');
      const filters = reportFilters(query);
      let bytes: Buffer;
      try { bytes = await generate({ rows: result.rows, filters, generatedAt: app.security.now(), generatedBy: request.auth!.user.name }, format); }
      catch (error) { if (error instanceof AppError) throw error; throw new AppError(503, 'REPORT_GENERATION_FAILED', 'No se pudo generar el reporte. Volvé a intentar.'); }
      if (!bytes.length || bytes.length > MAX_REPORT_BYTES) throw new AppError(400, 'REPORT_LIMIT_EXCEEDED', 'El archivo supera el tamaño permitido. Reducí los filtros.');
      if (reply.raw.destroyed) throw new AppError(400, 'VALIDATION_ERROR', 'La exportación fue cancelada.');
      // Render outside the transaction, then recheck live permissions before auditing/delivery.
      await prisma.$transaction(async tx => {
        const actor = await validateActor(tx, request);
        await audit(tx, request, { operation: 'REPORTE_EXPORTADO', resource: 'reportes', ...(query.publicationId ? { publicationId: query.publicationId } : {}), role: actor.role, status: 'EXITO', after: { format, filters, total: result.total, snapshot, bytes: bytes.length } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      const mime = format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      reply.header('Content-Type', mime).header('Content-Disposition', `attachment; filename="reporte-publicaciones.${format}"`).header('Content-Length', bytes.length);
      reply.raw.once('finish', release);
      reply.raw.once('close', release);
      delivering = true;
      return reply.send(bytes);
    } finally { if (!delivering) release(); }
  });
}
