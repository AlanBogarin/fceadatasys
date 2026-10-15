import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyError } from 'fastify';
import { ZodError } from 'zod';
import { auditRejection } from './security/audit.js';
import type { PrismaClient } from '@prisma/client';

export interface InvalidParam { name: string; reason: string }
export class AppError extends Error {
  constructor(public status: number, public code: string, public detail: string, public invalidParams: InvalidParam[] = []) { super(detail); }
}
export { AppError as ProblemError };

const titles: Record<number, string> = { 400: 'Error de validación de datos', 401: 'Autenticación requerida', 403: 'Operación no permitida', 404: 'Recurso no encontrado', 409: 'Conflicto de datos', 423: 'Cuenta bloqueada', 429: 'Demasiadas solicitudes', 500: 'Error interno del servidor', 503: 'Servicio no disponible' };

export function installErrorHandler(app: FastifyInstance, prisma: PrismaClient) {
  app.setNotFoundHandler(async request => { throw new AppError(404, 'NOT_FOUND', 'El recurso solicitado no existe.'); });
  app.setErrorHandler(async (error, request, reply) => {
    const fastifyError = error as FastifyError;
    let problem: AppError;
    if (error instanceof AppError) problem = error;
    else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') problem = new AppError(409, 'DUPLICATE_USER', 'Ya existe una cuenta con esa CI, correo o usuario.');
    else if (error instanceof ZodError) problem = new AppError(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos.', error.issues.map(issue => ({ name: issue.path.join('.'), reason: issue.message })));
    else if (fastifyError.validation) problem = new AppError(400, 'VALIDATION_ERROR', 'Los datos enviados no son válidos.', fastifyError.validation.map(issue => ({ name: [fastifyError.validationContext, issue.instancePath.replace(/^\//, '')].filter(Boolean).join('.'), reason: issue.message ?? 'Valor inválido.' })));
    else if (fastifyError.statusCode && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) problem = new AppError(fastifyError.statusCode, fastifyError.statusCode === 429 ? 'RATE_LIMITED' : 'VALIDATION_ERROR', fastifyError.statusCode === 429 ? 'Se excedió el límite de solicitudes.' : 'La solicitud no es válida.');
    else problem = new AppError(500, 'INTERNAL_ERROR', 'No se pudo completar la operación.');
    try {
      if (!request.auditHandled && request.url.startsWith('/api/')) await auditRejection(prisma, request, `${problem.code}: ${problem.detail}`);
    } catch {
      problem = new AppError(503, 'AUDIT_UNAVAILABLE', 'No se pudo registrar la auditoría. La operación fue cancelada.');
    }
    if (problem.status >= 500) request.log.error({ code: problem.code, route: request.routeOptions.url }, 'Falló una operación de servidor');
    return reply.code(problem.status).type('application/problem+json').send({ type: 'about:blank', status: problem.status, code: problem.code, title: titles[problem.status] ?? 'Error de solicitud', detail: problem.detail, timestamp: new Date().toISOString(), path: request.routeOptions.url ?? request.url.split('?')[0], invalid_params: problem.invalidParams });
  });
}
