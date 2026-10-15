import { Prisma, type PrismaClient, type User } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { withTransaction } from '../db.js';
import { AppError } from '../errors.js';
import { audit, authenticate, hashPassword, requireAdmin, revokeUserSessions } from '../security/index.js';
import { userDto } from './dto.js';
import { requireUserIfMatch, userEtag } from './concurrency.js';
import { createUserSchema, idParamsSchema, normalizeIdentity, profileSchema, updateUserSchema, userDtoSchema, userQuerySchema, type UserInput } from './schemas.js';

/** Locks the same account/session used by auth, then rechecks after entering mutation transaction. */
async function actorInTransaction(tx: Prisma.TransactionClient, request: FastifyRequest, admin: boolean) {
  const auth = request.auth!;
  await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${auth.userId}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: auth.userId } });
  const session = await tx.session.findUnique({ where: { id: auth.sessionId } });
  const now = request.server.security.now();
  if (!user?.active || !session || session.userId !== user.id || session.revokedAt || session.expiresAt <= now || now.getTime() - session.lastActivityAt.getTime() >= 600000) throw new AppError(401, 'UNAUTHENTICATED', 'La sesión no es válida o ha vencido.');
  if (admin && user.role !== 'ADMINISTRADOR') throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta operación.');
  return user;
}

function normalizedFields(input: UserInput) {
  return { ...input, emailKey: normalizeIdentity(input.email), usernameKey: normalizeIdentity(input.username) };
}

export function enforceUserRules(before: Pick<User, 'id' | 'name' | 'role' | 'active'>, after: UserInput, actorId: string, activeAdminCount: number) {
  if ((before.role === 'PUBLICO' || after.role === 'PUBLICO') && before.name !== after.name) throw new AppError(400, 'PUBLIC_NAME_READONLY', 'El nombre completo de una cuenta Público es de solo lectura.');
  if (before.id === actorId && (before.role !== after.role || before.active !== after.active)) throw new AppError(400, 'SELF_PRIVILEGE_CHANGE', 'No puedes modificar tu propio rol o estado.');
  if (before.active && before.role === 'ADMINISTRADOR' && (!after.active || after.role !== 'ADMINISTRADOR') && activeAdminCount <= 1) throw new AppError(409, 'LAST_ADMIN_REQUIRED', 'Debe quedar al menos un Administrador activo.');
}

export async function registerUserRoutes(app: FastifyInstance, prisma: PrismaClient) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  api.get('/api/v1/usuarios', { preHandler: requireAdmin, schema: { querystring: userQuerySchema, response: { 200: z.object({ data: z.array(userDtoSchema), pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }) }) } } }, async request => {
    const { page, pageSize, search, role, active } = request.query;
    // Prisma contains uses ILIKE; escape PostgreSQL pattern syntax for literal UI searches.
    const literalSearch = search?.replace(/[\\%_]/g, '\\$&');
    const where: Prisma.UserWhereInput = { ...(role ? { role } : {}), ...(active === undefined ? {} : { active }), ...(literalSearch ? { OR: ['name', 'email', 'username', 'ci'].map(field => ({ [field]: { contains: literalSearch, mode: 'insensitive' } })) } : {}) };
    const [total, users] = await prisma.$transaction([prisma.user.count({ where }), prisma.user.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { data: users.map(userDto), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  });
  api.get('/api/v1/usuarios/:id', { preHandler: requireAdmin, schema: { params: idParamsSchema, response: { 200: userDtoSchema } } }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.params.id } });
    if (!user) throw new AppError(404, 'NOT_FOUND', 'El usuario no existe.');
    return reply.header('ETag', userEtag(user)).send(userDto(user));
  });
  api.post('/api/v1/usuarios', { preHandler: requireAdmin, schema: { body: createUserSchema, response: { 201: userDtoSchema } } }, async (request, reply) => {
    const { password, ...input } = request.body;
    const passwordHash = await hashPassword(password);
    const created = await withTransaction(prisma, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(741901)`;
      await actorInTransaction(tx, request, true);
      const user = await tx.user.create({ data: { ...normalizedFields(input), passwordHash } });
      await audit(tx, request, { operation: 'USUARIO_CREADO', resource: 'usuarios', resourceId: user.id, status: 'EXITO', after: userDto(user) });
      return user;
    });
    return reply.code(201).header('Location', `/api/v1/usuarios/${created.id}`).header('ETag', userEtag(created)).send(userDto(created));
  });
  api.patch('/api/v1/usuarios/:id', { preHandler: requireAdmin, schema: { params: idParamsSchema, body: updateUserSchema, response: { 200: userDtoSchema } } }, async (request, reply) => {
    const expectedEtag = requireUserIfMatch(request.headers['if-match']);
    const updated = await withTransaction(prisma, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(741901)`;
      await actorInTransaction(tx, request, true);
      await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${request.params.id}::uuid FOR UPDATE`;
      const before = await tx.user.findUnique({ where: { id: request.params.id } });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'El usuario no existe.');
      // Waiting for the target account must not authorize a mutation after the actor timed out.
      await actorInTransaction(tx, request, true);
      if (expectedEtag !== userEtag(before)) throw new AppError(412, 'USER_VERSION_CONFLICT', 'La cuenta cambió desde que consultaste sus datos. Vuelve a consultarla antes de editar.');
      const input: UserInput = { name: before.name, ci: before.ci, email: before.email, username: before.username, role: before.role, active: before.active, ...request.body };
      const adminCount = await tx.user.count({ where: { role: 'ADMINISTRADOR', active: true } });
      enforceUserRules(before, input, request.auth!.userId, adminCount);
      const user = await tx.user.update({ where: { id: before.id }, data: normalizedFields(input) });
      const roleOrStateChanged = before.role !== user.role || before.active !== user.active;
      if (roleOrStateChanged || before.emailKey !== user.emailKey) {
        const now = request.server.security.now();
        if (roleOrStateChanged) await revokeUserSessions(tx, user.id, undefined, now);
        await tx.recoveryToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
      }
      await audit(tx, request, { operation: before.active && !user.active ? 'USUARIO_INACTIVADO' : 'USUARIO_MODIFICADO', resource: 'usuarios', resourceId: user.id, status: 'EXITO', before: userDto(before), after: userDto(user) });
      if (before.role !== user.role) await audit(tx, request, { operation: 'ROL_ASIGNADO', resource: 'usuarios', resourceId: user.id, status: 'EXITO', before: { role: before.role }, after: { role: user.role } });
      return user;
    });
    return reply.header('ETag', userEtag(updated)).send(userDto(updated));
  });
  api.get('/api/v1/me', { preHandler: authenticate, schema: { response: { 200: userDtoSchema } } }, async request => userDto(request.auth!.user));
  api.patch('/api/v1/me', { preHandler: authenticate, schema: { body: profileSchema, response: { 200: userDtoSchema } } }, async request => {
    const user = await withTransaction(prisma, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(741901)`;
      const before = await actorInTransaction(tx, request, false);
      const input = { name: before.name, ci: before.ci, email: before.email, username: before.username, role: before.role, active: before.active, ...request.body };
      enforceUserRules(before, input, before.id, 1);
      const after = await tx.user.update({ where: { id: before.id }, data: normalizedFields(input) });
      if (before.emailKey !== after.emailKey) await tx.recoveryToken.updateMany({ where: { userId: after.id, consumedAt: null }, data: { consumedAt: request.server.security.now() } });
      await audit(tx, request, { operation: 'PERFIL_MODIFICADO', resource: 'usuarios', resourceId: after.id, role: before.role, status: 'EXITO', before: userDto(before), after: userDto(after) });
      return after;
    });
    return userDto(user);
  });
}
