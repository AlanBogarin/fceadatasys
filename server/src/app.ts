import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config.js';
import { AppError, installErrorHandler } from './errors.js';
import { registerSecurity, requireAdmin, type SecurityOptions } from './security/index.js';
import { registerUserRoutes } from './users/routes.js';
import { registerCatalogRoutes } from './catalogs/routes.js';
import { registerPublicationRoutes } from './publications/routes.js';
import { registerAttachmentRoutes, type AttachmentOptions } from './attachments/routes.js';
import { registerReportRoutes, type ReportOptions } from './reports/routes.js';
import { confirmMutation } from './security/confirmation.js';
import { registerAuditRoutes } from './auditing/routes.js';
import { registerPermissionRoutes } from './security/permission-routes.js';
import { registerBackupRoutes } from './backups/routes.js';
import type { BackupOptions } from './backups/engine.js';

export interface AppOptions { logger?: boolean; security?: SecurityOptions; attachments?: AttachmentOptions; reports?: ReportOptions; backups?: BackupOptions; confirmation?: (request: import('fastify').FastifyRequest) => Promise<void> }
export async function createApp(config: AppConfig, prisma: PrismaClient, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger === false ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-confirmation-password', 'res.headers.set-cookie'], serializers: { req: request => ({ method: request.method, id: request.id }) } }, logController: new LogController({ disableRequestLogging: true }), trustProxy: config.trustedProxies?.length ? config.trustedProxies : false, bodyLimit: 64 * 1024 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  installErrorHandler(app, prisma);
  await app.register(cors, { origin: (origin, callback) => callback(null, !origin || config.allowedOrigins.includes(origin)), credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'X-Confirmation-Password'], exposedHeaders: ['ETag', 'Location', 'Content-Disposition'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute', errorResponseBuilder: () => new AppError(429, 'RATE_LIMITED', 'Se excedió el límite de solicitudes.') });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await prisma.$queryRaw`SELECT 1`; return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  app.addHook('onRoute', route => {
    if ([route.method].flat().some(method => method === 'PATCH' || method === 'DELETE')) {
      route.preHandler = [...(route.preHandler ? [route.preHandler].flat() : []), async request => { await (options.confirmation ? options.confirmation(request) : confirmMutation(prisma, request)); }];
    }
  });
  await registerSecurity(app, { prisma, config, ...options.security });
  await registerPermissionRoutes(app, prisma);
  await registerBackupRoutes(app, prisma, config, options.backups);
  app.get('/api/v1/status', { preHandler: requireAdmin }, async () => ({ status: app.security.mailer.available ? 'ready' : 'degraded', smtp: app.security.mailer.available ? 'ready' : 'unavailable' }));
  await registerUserRoutes(app, prisma);
  await registerCatalogRoutes(app, prisma);
  await registerPublicationRoutes(app, prisma);
  await registerAttachmentRoutes(app, prisma, config, options.attachments);
  await registerReportRoutes(app, prisma, options.reports);
  await registerAuditRoutes(app, prisma);
  return app;
}
