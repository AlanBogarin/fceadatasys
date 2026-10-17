import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { assertConfirmationCurrent } from '../security/confirmation.js';
import { contentEtag, requireIfMatch, assertVersion } from '../concurrency.js';
import { audit, authenticate } from '../security/index.js';
import { canManageCatalog, catalogDtoSchema, catalogIdParams, catalogParams, catalogQuerySchema, createCatalogSchema, patchCatalogSchema, validateCatalogInput, type CatalogKey } from './schemas.js';
import { assertCatalogCanDeactivate, assertCatalogUnreferenced, createCatalog, deleteCatalog, getCatalog, listCatalog, lockCatalog, updateCatalog } from './store.js';

function authorize(request: FastifyRequest, key: CatalogKey, deleting = false) {
  if (!request.auth || (deleting ? request.auth.role !== 'ADMINISTRADOR' : !canManageCatalog(request.auth.role, key))) throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para modificar este catálogo.');
}
async function lockedActor(tx: Prisma.TransactionClient, request: FastifyRequest, key: CatalogKey, deleting = false) {
  const auth = request.auth!;
  await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${auth.userId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${auth.sessionId}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: auth.userId } });
  const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
  const now = request.server.security.now();
  if (!user?.active || !session || session.userId !== user.id || session.revokedAt || session.expiresAt <= now || now.getTime() - session.lastActivityAt.getTime() >= 600000) throw new AppError(401, 'UNAUTHENTICATED', 'La sesión no es válida o ha vencido.');
  if (deleting ? user.role !== 'ADMINISTRADOR' : !canManageCatalog(user.role, key)) throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para modificar este catálogo.');
  assertConfirmationCurrent(request, user);
  return user;
}
async function mutation<T>(prisma: PrismaClient, callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  // Row locks serialize edits; READ COMMITTED sees FK inserts committed while waiting
  // for the target lock. UNIQUE constraints arbitrate concurrent creations.
  try { return await prisma.$transaction(callback, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new AppError(409, 'DUPLICATE_CATALOG', 'Ya existe un registro con ese nombre o identificador en este catálogo, incluso si está inactivo.');
      if (error.code === 'P2003') throw new AppError(409, 'CATALOG_IN_USE', 'El registro tiene referencias y debe conservarse.');
    }
    throw error;
  }
}
export async function registerCatalogRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const base = '/api/v1/catalogos/:catalog';
  api.get(base, { preHandler: authenticate, schema: { params: catalogParams, querystring: catalogQuerySchema, response: { 200: z.object({ data: z.array(catalogDtoSchema), pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }) }) } } }, async request => {
    const query = { ...request.query };
    // Público only needs active classification labels, never the personal directory.
    if (request.auth!.role === 'PUBLICO') {
      if (request.params.catalog === 'autores' || request.params.catalog === 'tutores') throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para consultar este directorio.');
      query.active = true;
    }
    return prisma.$transaction(tx => listCatalog(tx, request.params.catalog, query), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  });
  api.get(`${base}/:id`, { preHandler: authenticate, schema: { params: catalogIdParams, response: { 200: catalogDtoSchema } } }, async (request, reply) => {
    const { catalog, id } = request.params;
    if (request.auth!.role === 'PUBLICO' && (catalog === 'autores' || catalog === 'tutores')) throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para consultar este directorio.');
    const row = await getCatalog(prisma, catalog, id);
    if (!row || (request.auth!.role === 'PUBLICO' && !row.active)) throw new AppError(404, 'NOT_FOUND', 'El registro del catálogo no existe.');
    return reply.header('ETag', contentEtag(row)).send(row);
  });
  api.post(base, { preHandler: authenticate, schema: { params: catalogParams, body: createCatalogSchema, response: { 201: catalogDtoSchema } } }, async (request, reply) => {
    const { catalog } = request.params;
    authorize(request, catalog);
    const input = validateCatalogInput(catalog, request.body);
    const row = await mutation(prisma, async tx => {
      const actor = await lockedActor(tx, request, catalog);
      const after = await createCatalog(tx, catalog, input);
      await audit(tx, request, { operation: 'CATALOGO_CREADO', resource: catalog, resourceId: after.id, role: actor.role, status: 'EXITO', after });
      return after;
    });
    return reply.code(201).header('Location', `/api/v1/catalogos/${catalog}/${row.id}`).header('ETag', contentEtag(row)).send(row);
  });
  api.patch(`${base}/:id`, { preHandler: authenticate, schema: { params: catalogIdParams, body: patchCatalogSchema, response: { 200: catalogDtoSchema } } }, async (request, reply) => {
    const { catalog, id } = request.params;
    authorize(request, catalog);
    const expected = requireIfMatch(request.headers['if-match']);
    const result = await mutation(prisma, async tx => {
      await lockedActor(tx, request, catalog);
      await lockCatalog(tx, catalog, id);
      const actor = await lockedActor(tx, request, catalog);
      const before = await getCatalog(tx, catalog, id);
      if (!before) throw new AppError(404, 'NOT_FOUND', 'El registro del catálogo no existe.');
      assertVersion(expected, before);
      const input = validateCatalogInput(catalog, { name: request.body.name ?? before.name, fields: { ...before.fields, ...request.body.fields } });
      if (before.active && request.body.active === false) await assertCatalogCanDeactivate(tx, catalog, id);
      const after = await updateCatalog(tx, catalog, id, input, request.body.active ?? before.active);
      await audit(tx, request, { operation: before.active !== after.active ? after.active ? 'CATALOGO_ACTIVADO' : 'CATALOGO_INACTIVADO' : 'CATALOGO_MODIFICADO', resource: catalog, resourceId: id, role: actor.role, status: 'EXITO', before, after });
      return after;
    });
    return reply.header('ETag', contentEtag(result)).send(result);
  });
  api.delete(`${base}/:id`, { preHandler: authenticate, schema: { params: catalogIdParams, body: z.object({}).strict().nullish() } }, async (request, reply) => {
    const { catalog, id } = request.params;
    authorize(request, catalog, true);
    const expected = requireIfMatch(request.headers['if-match']);
    await mutation(prisma, async tx => {
      await lockedActor(tx, request, catalog, true);
      await lockCatalog(tx, catalog, id);
      const actor = await lockedActor(tx, request, catalog, true);
      const before = await getCatalog(tx, catalog, id);
      if (!before) throw new AppError(404, 'NOT_FOUND', 'El registro del catálogo no existe.');
      assertVersion(expected, before);
      await assertCatalogUnreferenced(tx, catalog, id);
      await deleteCatalog(tx, catalog, id);
      await audit(tx, request, { operation: 'CATALOGO_ELIMINADO', resource: catalog, resourceId: id, role: actor.role, status: 'EXITO', before });
    });
    return reply.code(204).send();
  });
}
