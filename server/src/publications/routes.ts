import { Prisma, type PrismaClient, type StoredAttachment } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AppError } from '../errors.js';
import { audit, authenticate, requireAdmin, requireRoles } from '../security/index.js';
import { getCatalog, lockCatalog } from '../catalogs/store.js';
import type { CatalogKey } from '../catalogs/schemas.js';
import { countWords, institutionYear, publicationDetailQuerySchema, publicationDtoSchema, publicationHash, publicationIdParams, publicationListSchema, publicationQuerySchema, publicationReadSchema, registrationSchema, settingsSchema, type RegistrationInput } from './schemas.js';
import { listPublications, readPublication } from './read.js';

async function lockedActor(tx: Prisma.TransactionClient, request: FastifyRequest, admin = false) {
  const auth = request.auth!;
  await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${auth.userId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${auth.sessionId}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: auth.userId } });
  const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
  const now = request.server.security.now();
  if (!user?.active || !session || session.userId !== user.id || session.revokedAt || session.expiresAt <= now || now.getTime() - session.lastActivityAt.getTime() >= 600000) throw new AppError(401, 'UNAUTHENTICATED', 'La sesión no es válida o ha vencido.');
  if (admin ? user.role !== 'ADMINISTRADOR' : user.role === 'PUBLICO') throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta operación.');
  return user;
}
const reference = (row: { id: string; name: string }) => ({ id: row.id, name: row.name });
const hashes = (input: RegistrationInput) => ({ titleHash: publicationHash(input.title), summaryHash: publicationHash(input.summary), abstractHash: publicationHash(input.abstract) });
export function validateStoredAttachment(file: StoredAttachment) {
  if (file.state !== 'CLEAN' || !file.contentVerified || !file.scannedAt) throw new AppError(409, 'ATTACHMENT_NOT_READY', 'El adjunto todavía no cuenta con una verificación de contenido y análisis de seguridad satisfactorios.');
  if (file.mime !== 'application/pdf' || file.size <= 0 || file.size > 10 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(file.sha256) || !file.name || file.name.length > 150 || !/\.pdf$/i.test(file.name) || /[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(file.name)) throw new AppError(400, 'INVALID_ATTACHMENT', 'El registro del adjunto no contiene un PDF válido de hasta 10 MB con nombre seguro.');
}
function duplicateError(fields: string[]) {
  return new AppError(409, 'DUPLICATE_PUBLICATION', 'La publicación duplica un título, resumen, abstract o adjunto ya registrado.', fields.map(field => ({ name: `body.${field}`, reason: 'Este valor ya está registrado en otra publicación.' })));
}
async function checkDuplicates(tx: Prisma.TransactionClient, input: RegistrationInput, attachmentHash?: string) {
  const keys = hashes(input);
  const existing = await tx.publication.findMany({ where: { OR: [{ titleHash: keys.titleHash }, { summaryHash: keys.summaryHash }, { abstractHash: keys.abstractHash }, ...(attachmentHash ? [{ attachmentHash }] : [])] }, select: { titleHash: true, summaryHash: true, abstractHash: true, attachmentHash: true } });
  const fields = new Set<string>();
  for (const row of existing) {
    if (row.titleHash === keys.titleHash) fields.add('title');
    if (row.summaryHash === keys.summaryHash) fields.add('summary');
    if (row.abstractHash === keys.abstractHash) fields.add('abstract');
    if (attachmentHash && row.attachmentHash === attachmentHash) fields.add('attachmentId');
  }
  if (fields.size) throw duplicateError([...fields]);
}
export async function registerPublicationRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get('/api/v1/publicaciones', { preHandler: authenticate, schema: { querystring: publicationQuerySchema, response: { 200: publicationListSchema } } }, async request => listPublications(prisma, request.query, request.auth!.role));
  api.get('/api/v1/publicaciones/:id', { preHandler: authenticate, schema: { params: publicationIdParams, querystring: publicationDetailQuerySchema, response: { 200: publicationReadSchema } } }, async request => readPublication(prisma, request.params.id, request.auth!.role));
  const settingsPath = '/api/v1/parametros/publicaciones';
  api.get(settingsPath, { preHandler: authenticate, schema: { response: { 200: settingsSchema } } }, async () => {
    const settings = await prisma.publicationSettings.findUniqueOrThrow({ where: { id: 1 } });
    return { summaryWordLimit: settings.summaryWordLimit };
  });
  api.patch(settingsPath, { preHandler: requireAdmin, schema: { body: settingsSchema, response: { 200: settingsSchema } } }, async request => prisma.$transaction(async tx => {
    await lockedActor(tx, request, true);
    await tx.$queryRaw`SELECT id FROM parametros_publicaciones WHERE id = 1 FOR UPDATE`;
    const actor = await lockedActor(tx, request, true);
    const before = await tx.publicationSettings.findUniqueOrThrow({ where: { id: 1 } });
    const after = await tx.publicationSettings.update({ where: { id: 1 }, data: request.body });
    await audit(tx, request, { operation: 'PARAMETROS_PUBLICACIONES_MODIFICADOS', resource: 'parametros_publicaciones', resourceId: '1', role: actor.role, status: 'EXITO', before: { summaryWordLimit: before.summaryWordLimit }, after: { summaryWordLimit: after.summaryWordLimit } });
    return { summaryWordLimit: after.summaryWordLimit };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }));

  api.post('/api/v1/publicaciones', { preHandler: requireRoles('ADMINISTRADOR', 'DIGITADOR'), schema: { body: registrationSchema, response: { 201: publicationDtoSchema } } }, async (request, reply) => {
    const input = request.body;
    try {
      const dto = await prisma.$transaction(async tx => {
        await lockedActor(tx, request);
        await tx.$queryRaw`SELECT id FROM parametros_publicaciones WHERE id = 1 FOR SHARE`;
        const settings = await tx.publicationSettings.findUniqueOrThrow({ where: { id: 1 } });
        if (countWords(input.summary) > settings.summaryWordLimit) throw new AppError(400, 'VALIDATION_ERROR', 'El resumen excede el límite configurado.', [{ name: 'body.summary', reason: `El resumen admite hasta ${settings.summaryWordLimit} palabras.` }]);
        if (input.year > institutionYear(request.server.security.now())) throw new AppError(400, 'VALIDATION_ERROR', 'El año de publicación no puede ser futuro.', [{ name: 'body.year', reason: 'El año debe estar entre 1900 y el año institucional actual.' }]);
        const targets: { key: CatalogKey; id: string; field: string }[] = [
          ...input.authorIds.map(id => ({ key: 'autores' as const, id, field: 'authorIds' })),
          ...input.tutorIds.map(id => ({ key: 'tutores' as const, id, field: 'tutorIds' })),
          { key: 'carreras', id: input.careerId, field: 'careerId' }, { key: 'niveles', id: input.levelId, field: 'levelId' },
          { key: 'tipos', id: input.typeId, field: 'typeId' }, { key: 'filiales', id: input.branchId, field: 'branchId' },
        ];
        // Stable order across actors prevents deadlocks when publications share catalogs.
        targets.sort((a, b) => a.key.localeCompare(b.key) || a.id.localeCompare(b.id));
        const refs = new Map<string, { id: string; name: string }>();
        for (const target of targets) {
          await lockCatalog(tx, target.key, target.id);
          const row = await getCatalog(tx, target.key, target.id);
          if (!row?.active) throw new AppError(400, 'INVALID_PUBLICATION_REFERENCE', 'Seleccioná registros existentes y activos del catálogo correcto.', [{ name: `body.${target.field}`, reason: `El registro ${target.id} no existe, está inactivo o pertenece a otro catálogo.` }]);
          refs.set(`${target.key}:${target.id}`, reference(row));
        }
        let file: StoredAttachment | null = null;
        if (input.attachmentId) {
          await tx.$queryRaw`SELECT id FROM adjuntos WHERE id = ${input.attachmentId}::uuid FOR UPDATE`;
          file = await tx.storedAttachment.findUnique({ where: { id: input.attachmentId } });
          if (!file) throw new AppError(404, 'NOT_FOUND', 'El adjunto no existe.');
          validateStoredAttachment(file);
        }
        const actor = await lockedActor(tx, request);
        if (file && actor.role !== 'ADMINISTRADOR' && file.createdById !== actor.id) throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para vincular este adjunto.');
        await checkDuplicates(tx, input, file?.sha256);
        const created = await tx.publication.create({ data: {
          title: input.title, summary: input.summary, abstract: input.abstract, keywords: input.keywords, ...hashes(input),
          year: input.year, source: input.source, requiresLibraryCopy: input.requiresLibraryCopy,
          externalUrl: input.externalUrl || null, attachmentId: file?.id, attachmentHash: file?.sha256,
          careerId: input.careerId, levelId: input.levelId, typeId: input.typeId, branchId: input.branchId,
          createdById: actor.id, createdAt: request.server.security.now(),
          authors: { create: input.authorIds.map((authorId, index) => ({ authorId, position: index + 1 })) },
          tutors: { create: input.tutorIds.map((tutorId, index) => ({ tutorId, position: index + 1 })) },
        } });
        const ref = (key: CatalogKey, id: string) => refs.get(`${key}:${id}`)!;
        const result = {
          id: created.id, code: `INV-${created.number.toString().padStart(5, '0')}`, title: created.title,
          authors: input.authorIds.map(id => ref('autores', id)), tutors: input.tutorIds.map(id => ref('tutores', id)),
          career: ref('carreras', input.careerId), level: ref('niveles', input.levelId), type: ref('tipos', input.typeId), branch: ref('filiales', input.branchId),
          summary: created.summary, abstract: created.abstract, keywords: created.keywords, year: created.year,
          source: created.source, requiresLibraryCopy: created.requiresLibraryCopy, externalUrl: created.externalUrl ?? '',
          ...(file ? { attachment: { id: file.id, name: file.name, size: file.size, mime: 'application/pdf' as const, sha256: file.sha256 } } : {}),
          active: created.active, createdAt: created.createdAt.toISOString(), createdBy: reference(actor),
        };
        await audit(tx, request, { operation: 'REGISTRAR_INVESTIGACION', resource: 'publicaciones', resourceId: created.id, publicationId: created.id, role: actor.role, status: 'EXITO', after: { ...result, approvedExternally: true } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
      return reply.code(201).header('Location', `/api/v1/publicaciones/${dto.id}`).send(dto);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // The winner is now committed: provide the same field-specific conflict as the precheck.
        const file = input.attachmentId ? await prisma.storedAttachment.findUnique({ where: { id: input.attachmentId } }) : null;
        await checkDuplicates(prisma, input, file?.sha256);
        throw duplicateError([]);
      }
      throw error;
    }
  });
}
