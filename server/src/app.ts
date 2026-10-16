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

export interface AppOptions { logger?: boolean; security?: SecurityOptions }
export async function createApp(config: AppConfig, prisma: PrismaClient, options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger === false ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'], serializers: { req: request => ({ method: request.method, id: request.id }) } }, logController: new LogController({ disableRequestLogging: true }), trustProxy: false, bodyLimit: 64 * 1024 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  installErrorHandler(app, prisma);
  await app.register(cors, { origin: (origin, callback) => callback(null, !origin || config.allowedOrigins.includes(origin)), credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'If-Match'], exposedHeaders: ['ETag', 'Location'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute', errorResponseBuilder: () => new AppError(429, 'RATE_LIMITED', 'Se excedió el límite de solicitudes.') });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    try { await prisma.$queryRaw`SELECT 1`; return { status: 'ready' }; }
    catch { return reply.code(503).send({ status: 'unavailable' }); }
  });
  await registerSecurity(app, { prisma, config, ...options.security });
  app.get('/api/v1/status', { preHandler: requireAdmin }, async () => ({ status: app.security.mailer.available ? 'ready' : 'degraded', smtp: app.security.mailer.available ? 'ready' : 'unavailable' }));
  await registerUserRoutes(app, prisma);
  await registerCatalogRoutes(app, prisma);
  await registerPublicationRoutes(app, prisma);
  return app;
}
