import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type StoredAttachment } from '@prisma/client';
import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import { listAttachments, attachmentQuery } from './list.js';
import { audit, requireRoles } from '../security/index.js';
import { createClamScanner, type Scanner } from './scanner.js';
import { createAttachmentStorage, MAX_PDF_BYTES, sha256, type AttachmentStorage } from './storage.js';
import { assertFormatEnabled, attachmentFormat, attachmentName, formatMime, isSupportedFile, validateAttachment } from './formats.js';

export interface AttachmentOptions { scanner?: Scanner; storage?: AttachmentStorage }
const dto = (file: StoredAttachment) => ({ id: file.id, name: file.name, size: file.size, mime: file.mime, sha256: file.sha256 });
const emptyQuery = z.object({}).strict();
const idParams = z.object({ id: z.uuid().transform(id => id.toLowerCase()) }).strict();

async function actorInTransaction(tx: Prisma.TransactionClient, request: FastifyRequest) {
  const auth = request.auth!;
  await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${auth.userId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${auth.sessionId}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: auth.userId } });
  const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
  const now = request.server.security.now();
  if (!user?.active || !session || session.userId !== user.id || session.revokedAt || session.expiresAt <= now || now.getTime() - session.lastActivityAt.getTime() >= 600000) throw new AppError(401, 'UNAUTHENTICATED', 'La sesión no es válida o ha vencido.');
  if (user.role === 'PUBLICO') throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para operar con adjuntos.');
  return user;
}

export async function registerAttachmentRoutes(app: FastifyInstance, prisma: PrismaClient, config: AppConfig, options: AttachmentOptions = {}) {
  const settings = config.attachments ?? { directory: '.local/attachments', command: process.platform === 'win32' ? 'C:\\Program Files\\ClamAV\\clamscan.exe' : 'clamscan', database: '.local/clamav/database', timeoutMs: 120000, maxSignatureAgeDays: 7, concurrency: 2 };
  const scanner = options.scanner ?? createClamScanner(settings);
  const storage = options.storage ?? createAttachmentStorage(settings.directory);
  await app.register(multipart, { limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 20, headerPairs: 20 }, throwFileSizeLimit: true });
  let active = 0;
  const acquire = () => {
    if (active >= settings.concurrency) throw new AppError(503, 'ATTACHMENT_SERVICE_BUSY', 'El servicio de archivos está ocupado. Volvé a intentar.');
    active++;
    let released = false;
    return () => { if (!released) { released = true; active--; } };
  };
  const writers = requireRoles('ADMINISTRADOR', 'DIGITADOR');

  app.get('/api/v1/adjuntos', { preHandler: writers }, async request => listAttachments(prisma, request.auth!, attachmentQuery.omit({id:true}).parse(request.query)));
  app.post('/api/v1/adjuntos', { preHandler: writers, bodyLimit: MAX_PDF_BYTES + 8192 }, async (request, reply) => {
    emptyQuery.parse(request.query);
    const release = acquire();
    let writtenKey: string | undefined;
    let committed = false;
    try {
      if (!request.isMultipart()) throw new AppError(400, 'INVALID_ATTACHMENT', 'Enviá multipart/form-data con un único archivo en el campo file.');
      let bytes: Buffer | undefined;
      let name = '';
      for await (const part of request.parts()) {
        if (part.type !== 'file' || part.fieldname !== 'file' || !part.filename) throw new AppError(400, 'INVALID_ATTACHMENT', 'Enviá un único archivo en el campo file, sin campos adicionales.');
        name = attachmentName(part.filename);
        const format = attachmentFormat(name);
        if (![formatMime[format], 'application/octet-stream'].includes(part.mimetype)) throw new AppError(400, 'INVALID_ATTACHMENT', 'El MIME declarado no corresponde al formato.');
        assertFormatEnabled(format, (await prisma.publicationSettings.findUniqueOrThrow({ where: { id: 1 } })).allowedFormats);
        bytes = await part.toBuffer();
        const limits = await prisma.publicationSettings.findUniqueOrThrow({ where: { id: 1 } });
        if (bytes.length > limits.maxPdfSizeMb * 1024 * 1024) throw new AppError(400, 'INVALID_ATTACHMENT', 'El archivo supera el tamaño configurado.');
      }
      if (!bytes) throw new AppError(400, 'INVALID_ATTACHMENT', 'Falta el archivo.');
      const format = attachmentFormat(name);
      const mime = formatMime[format];
      validateAttachment(bytes, format);
      const id = randomUUID();
      const key = `${id}.${format}`;
      const hash = sha256(bytes);
      const result = await scanner.scan(bytes);
      if (reply.raw.destroyed) throw new AppError(400, 'VALIDATION_ERROR', 'La carga fue cancelada antes de confirmar el archivo.');
      if (!result.clean) {
        await prisma.$transaction(async tx => {
          let actor = await actorInTransaction(tx, request);
          // Serialize both clean and rejected uploads of identical bytes.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash}, 0))`;
          const existing = await tx.storedAttachment.findUnique({ where: { sha256: hash } });
          if (existing) await tx.$queryRaw`SELECT id FROM adjuntos WHERE id = ${existing.id}::uuid FOR UPDATE`;
          actor = await actorInTransaction(tx, request);
          const scannedAt = app.security.now();
          const file = existing ? await tx.storedAttachment.update({ where: { id: existing.id }, data: { state: 'REJECTED', scannedAt } }) : await tx.storedAttachment.create({ data: { id, name, size: bytes!.length, mime, sha256: hash, storageKey: key, state: 'REJECTED', contentVerified: true, scannedAt, createdById: actor.id, createdAt: scannedAt } });
          await audit(tx, request, { operation: 'ADJUNTO_RECHAZADO', resource: 'adjuntos', resourceId: file.id, role: actor.role, status: 'FALLIDO', detail: 'ClamAV detectó malware o contenido que no pudo inspeccionar completamente.', ...(existing ? { before: { ...dto(existing), state: existing.state } } : {}), after: { ...dto(file), state: file.state, scanner: 'ClamAV', engine: result.engine, signature: result.signature ?? 'detección' } });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
        request.auditHandled = true;
        throw new AppError(400, 'ATTACHMENT_REJECTED', 'El análisis de seguridad rechazó el archivo. No está disponible para publicación ni descarga.');
      }
      await storage.write(key, bytes);
      writtenKey = key;
      const file = await prisma.$transaction(async tx => {
        await actorInTransaction(tx, request);
        await tx.$queryRaw`SELECT id FROM parametros_publicaciones WHERE id = 1 FOR SHARE`;
        const limits = await tx.publicationSettings.findUniqueOrThrow({ where: { id: 1 } });
        assertFormatEnabled(format, limits.allowedFormats);
        if (bytes!.length > limits.maxPdfSizeMb * 1024 * 1024) throw new AppError(400, 'INVALID_ATTACHMENT', 'El tamaño permitido cambió durante el análisis.');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hash}, 0))`;
        if (await tx.storedAttachment.findUnique({ where: { sha256: hash } })) throw new AppError(409, 'DUPLICATE_ATTACHMENT', 'El mismo archivo ya fue registrado.');
        const actor = await actorInTransaction(tx, request);
        const scannedAt = app.security.now();
        const created = await tx.storedAttachment.create({ data: { id, name, size: bytes!.length, mime, sha256: hash, storageKey: key, state: 'CLEAN', contentVerified: true, scannedAt, createdById: actor.id, createdAt: scannedAt } });
        await audit(tx, request, { operation: 'ADJUNTO_CARGADO', resource: 'adjuntos', resourceId: created.id, role: actor.role, status: 'EXITO', after: { ...dto(created), scanner: 'ClamAV', engine: result.engine, scannedAt: scannedAt.toISOString() } });
        return created;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      committed = true;
      return reply.code(201).header('Location', `/api/v1/adjuntos/${file.id}`).send(dto(file));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'DUPLICATE_ATTACHMENT', 'El mismo archivo ya fue registrado.');
      throw error;
    } finally {
      try {
        if (writtenKey && !committed) await storage.remove(writtenKey);
      } catch { request.log.error({ operation: 'attachment_cleanup' }, 'No se pudo retirar un archivo privado sin registro confirmado.'); }
      release();
    }
  });

  app.get('/api/v1/adjuntos/:id', { preHandler: writers }, async request => {
    const { id } = idParams.parse(request.params);
    emptyQuery.parse(request.query);
    const file = await prisma.storedAttachment.findUnique({ where: { id } });
    if (!file) throw new AppError(404, 'NOT_FOUND', 'El adjunto no existe.');
    const visibleLink = request.auth!.role === 'ADMINISTRADOR' || file.createdById === request.auth!.userId || await prisma.publication.findFirst({ where: { attachmentId: id, active: true } });
    if (!visibleLink) throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para consultar este adjunto.');
    if (file.state !== 'CLEAN' || !file.contentVerified || !file.scannedAt) throw new AppError(409, 'ATTACHMENT_NOT_READY', 'El adjunto no está habilitado.');
    const creator = await prisma.user.findUniqueOrThrow({ where: { id: file.createdById }, select: { id: true, name: true } });
    return { ...dto(file), createdAt: file.createdAt.toISOString(), createdBy: creator };
  });

  app.get('/api/v1/publicaciones/:id/adjunto', { preHandler: writers, exposeHeadRoute: false }, async (request, reply) => {
    const { id } = idParams.parse(request.params);
    emptyQuery.parse(request.query);
    const release = acquire();
    let delivering = false;
    try {
      const result = await prisma.$transaction(async tx => {
        const initialActor = await actorInTransaction(tx, request);
        await tx.$queryRaw`SELECT id FROM publicaciones WHERE id = ${id}::uuid FOR SHARE`;
        const publication = await tx.publication.findUnique({ where: { id } });
        if (!publication || (initialActor.role !== 'ADMINISTRADOR' && !publication.active) || !publication.attachmentId) throw new AppError(404, 'NOT_FOUND', 'La publicación no tiene un adjunto disponible.');
        await tx.$queryRaw`SELECT id FROM adjuntos WHERE id = ${publication.attachmentId}::uuid FOR UPDATE`;
        const file = await tx.storedAttachment.findUniqueOrThrow({ where: { id: publication.attachmentId } });
        if (file.state !== 'CLEAN' || !file.contentVerified || !file.scannedAt || !isSupportedFile(file)) throw new AppError(409, 'ATTACHMENT_NOT_READY', 'El adjunto no está habilitado para descarga.');
        const bytes = await storage.read(file.storageKey, file.size, file.sha256);
        const actor = await actorInTransaction(tx, request);
        await audit(tx, request, { operation: 'DESCARGAR_ADJUNTO', resource: 'adjuntos', resourceId: file.id, publicationId: publication.id, role: actor.role, status: 'EXITO', after: dto(file) });
        return { bytes, name: file.name, mime: file.mime };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      const encodedName = encodeURIComponent(result.name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
      reply.raw.once('finish', release);
      reply.raw.once('close', release);
      delivering = true;
      return reply.type(result.mime).header('Content-Disposition', `attachment; filename="documento.${attachmentFormat(result.name)}"; filename*=UTF-8''${encodedName}`).header('Content-Length', result.bytes.length).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'no-store').send(result.bytes);
    } finally { if (!delivering) release(); }
  });
}
