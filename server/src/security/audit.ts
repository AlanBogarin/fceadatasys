import type { Prisma, PrismaClient, Role, AuditStatus } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { isTransactionConflict } from '../db.js';

export interface AuditEvent {
  operation: string; resource: string; resourceId?: string; publicationId?: string;
  status: AuditStatus; detail?: string;
  before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue;
  userId?: string; role?: Role; sessionId?: string;
}

/** Caller must use the SAME transaction as the protected mutation. Never pass secrets. */
export async function audit(tx: Prisma.TransactionClient | PrismaClient, request: FastifyRequest, event: AuditEvent): Promise<void> {
  try {
    await tx.auditLog.create({ data: {
      ...event,
      userId: event.userId ?? request.auth?.userId,
      role: event.role ?? request.auth?.role,
      sessionId: event.sessionId ?? request.auth?.sessionId,
      ip: request.ip.slice(0, 64),
      userAgent: (request.headers['user-agent'] ?? '').slice(0, 1024),
    } });
  } catch (error) {
    if (isTransactionConflict(error)) throw error;
    throw new AppError(503, 'AUDIT_UNAVAILABLE', 'No se pudo registrar la auditoría; la operación fue cancelada.');
  }
}

/** Independent rejection write: survives rollback of the failed business transaction. */
export async function auditRejection(prisma: PrismaClient, request: FastifyRequest, detail: string, operation = 'OPERACION_RECHAZADA'): Promise<void> {
  if (request.auditHandled) return;
  request.auditHandled = true;
  await audit(prisma, request, { operation, resource: (request.routeOptions.url ?? 'http').slice(0, 80), status: 'FALLIDO', detail });
}
