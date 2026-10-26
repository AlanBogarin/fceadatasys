import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { Prisma, type PrismaClient, type Role, type User, type Session } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';
import { audit } from './audit.js';
import { hashPassword, normalizeIdentity, passwordSchema, randomToken, tokenHash, verifyPassword } from './crypto.js';
import { createMailer, RECOVERY_TTL_MINUTES, type Mailer } from './mailer.js';
import { createDeliverySlots } from './delivery-slots.js';
import { assertConfirmationCurrent } from './confirmation.js';
import { assertAllowed, assertRequestPermission, protectUserPrivileges, userPermissions } from './permissions.js';

export { audit, auditRejection } from './audit.js';
export { hashPassword, verifyPassword, passwordSchema } from './crypto.js';
export type { Mailer } from './mailer.js';

const ACCESS_SECONDS = 15 * 60;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const INACTIVITY_MS = 10 * 60 * 1000;
const REFRESH_COOKIE = 'refresh_token';
const BROWSER_COOKIE = 'browser_token';
const browserToken = (request: FastifyRequest) => typeof request.cookies[BROWSER_COOKIE] === 'string' && /^[a-f0-9]{64}$/.test(request.cookies[BROWSER_COOKIE]) ? request.cookies[BROWSER_COOKIE] : undefined;
const emptyBody = z.object({}).strict().optional();
const GENERIC_RECOVERY = 'Si la dirección corresponde a una cuenta registrada y activa, recibirás las instrucciones para restablecer tu contraseña.';
type Tx = Prisma.TransactionClient;
interface Claims { sub: string; sid: string; iat: number; exp: number }
export interface AuthContext { userId: string; sessionId: string; role: Role; user: User; session: Session; checkedAt: Date; permissions: string[] }
export interface SecurityOptions { mailer?: Mailer; now?: () => Date }
interface SecurityRuntime { prisma: PrismaClient; config: AppConfig; mailer: Mailer; now: () => Date; dummyHash: string; drainMail: () => Promise<void> }
declare module 'fastify' {
  interface FastifyInstance { security: SecurityRuntime }
  interface FastifyRequest { auth?: AuthContext; auditHandled?: boolean; restoredAccessToken?: string }
}

const safeUser = (user: User) => ({ id: user.id, name: user.name, ci: user.ci, email: user.email, username: user.username, role: user.role, active: user.active, createdAt: user.createdAt.toISOString() });
const unauthorized = () => new AppError(401, 'UNAUTHENTICATED', 'La sesión no es válida o ha vencido. Inicia sesión nuevamente.');
const validSession = (session: Session, user: User, now: Date) => user.active && !session.revokedAt && session.expiresAt > now && now.getTime() - session.lastActivityAt.getTime() < INACTIVITY_MS;
const cookieOptions = (config: AppConfig) => ({ httpOnly: true, sameSite: 'strict' as const, secure: config.secureCookies, path: '/api/v1/auth', maxAge: SESSION_MS / 1000 });
const deadline = (session: Session) => new Date(Math.min(session.expiresAt.getTime(), session.lastActivityAt.getTime() + INACTIVITY_MS));
const duration = (session: Session, endedAt: Date) => Math.max(0, Math.floor((endedAt.getTime() - session.createdAt.getTime()) / 1000));

function verifiedClaims(request: FastifyRequest, allowExpired = false): Claims | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ') || !header.slice(7)) return undefined;
  try {
    const config = request.server.security.config;
    const claims = request.server.jwt.verify<Claims>(header.slice(7), allowExpired ? {
      ignoreExpiration: true, allowedIss: config.jwtIssuer, allowedAud: config.jwtAudience, algorithms: ['HS256'], requiredClaims: ['sub', 'sid', 'iat', 'exp'],
    } : undefined);
    if (!z.string().uuid().safeParse(claims.sub).success || !z.string().uuid().safeParse(claims.sid).success) return undefined;
    if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return undefined;
    return claims;
  } catch { return undefined; }
}

/** Caller holds user then session row locks. Closure and its duration event commit together. */
async function finalizeSession(tx: Tx, request: FastifyRequest, user: User, session: Session, now: Date, logout = false): Promise<Date> {
  const endedAt = session.revokedAt ?? (deadline(session) <= now ? deadline(session) : now);
  await tx.refreshToken.updateMany({ where: { sessionId: session.id, revokedAt: null }, data: { revokedAt: endedAt } });
  if (!session.revokedAt) {
    await tx.session.update({ where: { id: session.id }, data: { revokedAt: endedAt } });
    const reason = deadline(session) <= now ? (session.expiresAt <= new Date(session.lastActivityAt.getTime() + INACTIVITY_MS) ? 'ABSOLUTE_EXPIRATION' : 'INACTIVITY') : !user.active ? 'USER_INACTIVE' : logout ? 'LOGOUT' : 'REVOKED';
    await audit(tx, request, { operation: 'SESION_FINALIZADA', resource: 'sesiones', resourceId: session.id,
      userId: user.id, role: user.role, sessionId: session.id, status: 'EXITO', after: {
        reason, endedAt: endedAt.toISOString(), durationSeconds: duration(session, endedAt), lastActivityAt: session.lastActivityAt.toISOString(),
      } });
  }
  return endedAt;
}

export async function revokeUserSessions(tx: Tx, userId: string, exceptSessionId?: string, now = new Date()): Promise<void> {
  const where = { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) };
  await tx.refreshToken.updateMany({ where: { session: where, revokedAt: null }, data: { revokedAt: now } });
  await tx.session.updateMany({ where, data: { revokedAt: now } });
}

async function lockUser(tx: Tx, id: string): Promise<User> {
  await tx.$queryRaw`SELECT id FROM usuarios WHERE id = ${id}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id } });
  if (!user) throw unauthorized();
  return user;
}

async function lockedSession(tx: Tx, userId: string, sessionId: string, now: () => Date, requestForConfirmation?: FastifyRequest) {
  const user = await lockUser(tx, userId);
  await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${sessionId}::uuid FOR UPDATE`;
  const session = await tx.session.findUnique({ where: { id: sessionId } });
  const time = now();
  if (!session || session.userId !== userId || !validSession(session, user, time)) throw unauthorized();
  if (requestForConfirmation) assertConfirmationCurrent(requestForConfirmation, user);
  return { user, session, time };
}

export async function authenticate(request: FastifyRequest): Promise<void> {
  const claims = verifiedClaims(request);
  if (!claims) throw unauthorized();
  const { prisma, now } = request.server.security;
  let session = await prisma.session.findUnique({ where: { id: claims.sid }, include: { user: true } });
  if (!session || session.userId !== claims.sub) throw unauthorized();
  const time = now();
  let checkedAt = time;
  if (!validSession(session, session.user, time)) {
    const refreshed = await prisma.$transaction(async tx => {
      const user = await lockUser(tx, claims.sub);
      await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${claims.sid}::uuid FOR UPDATE`;
      const current = await tx.session.findUnique({ where: { id: claims.sid } });
      if (!current || current.userId !== user.id) throw unauthorized();
      const checkedAt = now();
      // An interaction may have won the lock after our first snapshot.
      if (validSession(current, user, checkedAt)) return { session: { ...current, user }, checkedAt };
      const endedAt = await finalizeSession(tx, request, user, current, checkedAt);
      await audit(tx, request, { operation: 'SESION_RECHAZADA', resource: 'sesiones', resourceId: current.id,
        userId: user.id, role: user.role, sessionId: current.id, status: 'FALLIDO',
        detail: 'Sesión inactiva, vencida, revocada o usuario inactivo.', after: {
          durationSeconds: duration(current, endedAt), lastActivityAt: current.lastActivityAt.toISOString(),
        } });
      return undefined;
    });
    if (!refreshed) { request.auditHandled = true; throw unauthorized(); }
    session = refreshed.session;
    checkedAt = refreshed.checkedAt;
  }
  request.auth = { userId: session.userId, sessionId: session.id, role: session.user.role, user: session.user, session, checkedAt, permissions: await userPermissions(prisma, session.user) };
}

export function requirePermission(...keys: string[]): preHandlerHookHandler {
  return async request => {
    await authenticate(request);
    request.requiredPermissions = keys;
    for (const key of keys) assertAllowed(request.auth!.permissions, key);
  };
}

export function requireRoles(...roles: Role[]): preHandlerHookHandler {
  return async request => {
    await authenticate(request);
    if (!request.auth || !roles.includes(request.auth.role)) throw new AppError(403, 'FORBIDDEN', 'No tienes permiso para realizar esta operación.');
  };
}
export const requireAuth = authenticate;
export const requireAdmin = requireRoles('ADMINISTRADOR');

export async function validateOrigin(request: FastifyRequest): Promise<void> {
  let origin = request.headers.origin;
  if (!origin && request.headers.referer) {
    try { origin = new URL(request.headers.referer).origin; } catch { /* invalid referer */ }
  }
  if (!origin || !request.server.security.config.allowedOrigins.includes(origin)) {
    throw new AppError(403, 'ORIGIN_FORBIDDEN', 'El origen de la solicitud no está permitido.');
  }
}

async function issue(tx: Tx, request: FastifyRequest, user: User, session: Session, now: Date) {
  const refresh = randomToken(64);
  await tx.refreshToken.create({ data: { sessionId: session.id, hash: tokenHash(refresh), expiresAt: session.expiresAt, createdAt: now } });
  const accessToken = request.server.jwt.sign({ sub: user.id, sid: session.id }, { expiresIn: ACCESS_SECONDS });
  return { refresh, accessToken, expiresIn: ACCESS_SECONDS, user: safeUser(user) };
}
function sendTokens(reply: FastifyReply, config: AppConfig, tokens: Omit<Awaited<ReturnType<typeof issue>>, 'refresh'> & { refresh?: string }) {
  if (tokens.refresh) reply.setCookie(REFRESH_COOKIE, tokens.refresh, cookieOptions(config));
  return reply.send({ accessToken: tokens.accessToken, tokenType: 'Bearer', expiresIn: tokens.expiresIn, user: tokens.user });
}

export async function registerSecurity(app: FastifyInstance, deps: { prisma: PrismaClient; config: AppConfig } & SecurityOptions): Promise<void>;
export async function registerSecurity(app: FastifyInstance, prisma: PrismaClient, config: AppConfig, options?: SecurityOptions): Promise<void>;
export async function registerSecurity(app: FastifyInstance, input: PrismaClient | ({ prisma: PrismaClient; config: AppConfig } & SecurityOptions), suppliedConfig?: AppConfig, options: SecurityOptions = {}): Promise<void> {
  const deps = suppliedConfig ? { prisma: input as PrismaClient, config: suppliedConfig, ...options } : input as { prisma: PrismaClient; config: AppConfig } & SecurityOptions;
  const { prisma, config } = deps;
  const mailer = deps.mailer ?? createMailer(config);
  const now = deps.now ?? (() => new Date());
  // Raw recovery secrets live only in process memory while delivery is pending.
  // Sending never delays the public response (otherwise SMTP latency reveals accounts).
  const pendingMail = new Set<Promise<void>>();
  const reserveMailSlot = createDeliverySlots();
  const drainMail = async () => { await Promise.allSettled([...pendingMail]); };
  app.decorate('security', { prisma, config, mailer, now, dummyHash: await hashPassword(randomToken(24)), drainMail });
  app.addHook('onClose', async () => { await drainMail(); await mailer.close?.(); });
  await app.register(cookie);
  await app.register(jwt, { secret: config.jwtSecret, sign: { iss: config.jwtIssuer, aud: config.jwtAudience }, verify: { allowedIss: config.jwtIssuer, allowedAud: config.jwtAudience, algorithms: ['HS256'], requiredClaims: ['sub', 'sid', 'iat', 'exp'] } });
  if (!await mailer.verify()) app.log.warn('SMTP no disponible; recuperación de contraseña degradada.');
  app.addHook('onSend', async (_request, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });

  app.post('/api/v1/auth/browser', { preHandler: validateOrigin }, async (request, reply) => {
    emptyBody.parse(request.body);
    if (!browserToken(request)) reply.setCookie(BROWSER_COOKIE, randomToken(32), cookieOptions(config));
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/login', { preHandler: validateOrigin }, async (request, reply) => {
    const browser = browserToken(request) ?? randomToken(32);
    const browserKey = tokenHash(browser);
    const body = z.object({ username: z.string().trim().min(1).max(80), password: z.string().min(1).max(128) }).strict().parse(request.body);
    const candidate = await prisma.user.findUnique({ where: { usernameKey: normalizeIdentity(body.username) } });
    if (!candidate) {
      await verifyPassword(app.security.dummyHash, body.password);
      await audit(prisma, request, { operation: 'LOGIN', resource: 'sesiones', status: 'FALLIDO', detail: 'Credenciales inválidas.' });
      request.auditHandled = true;
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.');
    }
    const result = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${browserKey}, 0))`;
      const previousBrowserSession = await tx.session.findFirst({ where: { browserKey, revokedAt: null }, include: { user: true } });
      for (const accountId of [...new Set([candidate.id, ...(previousBrowserSession ? [previousBrowserSession.userId] : [])])].sort()) await lockUser(tx, accountId);
      if (previousBrowserSession) {
        await tx.$queryRaw`SELECT id FROM sesiones WHERE id=${previousBrowserSession.id}::uuid FOR UPDATE`;
        const current = await tx.session.findUniqueOrThrow({where:{id:previousBrowserSession.id},include:{user:true}});
        if (validSession(current, current.user, now())) throw new AppError(409, 'BROWSER_SESSION_ACTIVE', 'El navegador ya tiene una sesión activa. Recuperala o cerrala antes de iniciar otra.');
        await finalizeSession(tx, request, current.user, current, now());
      }
      const user = await lockUser(tx, candidate.id);
      const time = now();
      const event = { operation: 'LOGIN', resource: 'sesiones', userId: user.id, role: user.role };
      // Verify inside the row lock: failures and credential changes are serialized per account.
      const correct = await verifyPassword(user.passwordHash, body.password);
      if (user.usernameKey !== normalizeIdentity(body.username)) {
        await audit(tx, request, { ...event, status: 'FALLIDO', detail: 'Credenciales inválidas.' });
        return { error: new AppError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.') };
      }
      if (user.lockedUntil && user.lockedUntil > time) {
        await audit(tx, request, { ...event, status: 'FALLIDO', detail: 'Cuenta bloqueada temporalmente.' });
        return { error: new AppError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.') };
      }
      if (!correct) {
        const failures = user.lockedUntil && user.lockedUntil <= time ? 1 : user.failures + 1;
        await tx.user.update({ where: { id: user.id }, data: { failures, lockedUntil: failures >= 3 ? new Date(time.getTime() + 300000) : null } });
        await audit(tx, request, { ...event, status: 'FALLIDO', detail: failures >= 3 ? 'Credenciales inválidas; bloqueo por cinco minutos.' : 'Credenciales inválidas.' });
        return { error: new AppError(401, 'INVALID_CREDENTIALS', 'Usuario o contraseña incorrectos.') };
      }
      if (!user.active) {
        await audit(tx, request, { ...event, status: 'FALLIDO', detail: 'Cuenta inactiva; contraseña verificada.' });
        return { error: new AppError(403, 'ACCOUNT_INACTIVE', 'La cuenta está inactiva. Contacta al Administrador.') };
      }
      await tx.user.update({ where: { id: user.id }, data: { failures: 0, lockedUntil: null } });
      const expired = await tx.session.findMany({ where: { userId: user.id, revokedAt: null, OR: [
        { expiresAt: { lte: time } }, { lastActivityAt: { lte: new Date(time.getTime() - INACTIVITY_MS) } },
      ] }, orderBy: { id: 'asc' } });
      for (const previous of expired) {
        await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${previous.id}::uuid FOR UPDATE`;
        const current = await tx.session.findUniqueOrThrow({ where: { id: previous.id } });
        if (!current.revokedAt && !validSession(current, user, time)) await finalizeSession(tx, request, user, current, time);
      }
      const session = await tx.session.create({ data: { userId: user.id, browserKey, createdAt: time, lastActivityAt: time, expiresAt: new Date(time.getTime() + SESSION_MS) } });
      const tokens = await issue(tx, request, user, session, time);
      await audit(tx, request, { ...event, resourceId: session.id, sessionId: session.id, status: 'EXITO', detail: 'Sesión iniciada.' });
      return { tokens };
    });
    if (result.error) { request.auditHandled = true; throw result.error; }
    reply.setCookie(BROWSER_COOKIE, browser, cookieOptions(config));
    return sendTokens(reply, config, result.tokens!);
  });

  app.post('/api/v1/auth/refresh', { preHandler: validateOrigin }, async (request, reply) => {
    emptyBody.parse(request.body);
    const raw = request.cookies[REFRESH_COOKIE];
    const rejectUnknown = async () => {
      await audit(prisma, request, { operation: 'REFRESH', resource: 'sesiones', status: 'FALLIDO', detail: 'Refresh no válido o desconocido.' });
      request.auditHandled = true;
      reply.clearCookie(REFRESH_COOKIE, cookieOptions(config));
      throw unauthorized();
    };
    if (!raw || !/^[a-f0-9]{128}$/.test(raw)) return rejectUnknown();
    const candidate = await prisma.refreshToken.findUnique({ where: { hash: tokenHash(raw) }, include: { session: true } });
    if (!candidate) return rejectUnknown();
    const result = await prisma.$transaction(async tx => {
      const user = await lockUser(tx, candidate.session.userId);
      await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${candidate.sessionId}::uuid FOR UPDATE`;
      const time = now();
      const token = await tx.refreshToken.findUniqueOrThrow({ where: { id: candidate.id } });
      const session = await tx.session.findUniqueOrThrow({ where: { id: candidate.sessionId } });
      const event = { resource: 'sesiones', resourceId: session.id, userId: user.id, role: user.role, sessionId: session.id };
      if (token.consumedAt && !token.revokedAt && time.getTime() - token.consumedAt.getTime() <= 5000 && time >= token.consumedAt && browserToken(request) && session.browserKey === tokenHash(browserToken(request)!) && validSession(session, user, time)) {
        // A concurrent tab receives access only; it must not overwrite the winning cookie.
        await audit(tx, request, { ...event, operation: 'REFRESH_CONCURRENTE', status: 'EXITO', detail: 'Renovación concurrente del mismo navegador; sin nueva rotación.' });
        return { tokens: { accessToken: app.jwt.sign({ sub: user.id, sid: session.id }, { expiresIn: ACCESS_SECONDS }), expiresIn: ACCESS_SECONDS, user: safeUser(user) } };
      }
      if (token.consumedAt || token.revokedAt) {
        await revokeUserSessions(tx, user.id, undefined, time);
        await audit(tx, request, { ...event, operation: 'REFRESH_REUTILIZADO', status: 'FALLIDO', detail: 'Reutilización detectada; todas las sesiones revocadas.' });
        return { error: unauthorized() };
      }
      if (token.expiresAt <= time || !validSession(session, user, time)) {
        await finalizeSession(tx, request, user, session, time);
        await audit(tx, request, { ...event, operation: 'REFRESH', status: 'FALLIDO', detail: 'Sesión vencida, inactiva o revocada.' });
        return { error: unauthorized() };
      }
      await tx.refreshToken.update({ where: { id: token.id }, data: { consumedAt: time } });
      const tokens = await issue(tx, request, user, session, time);
      await audit(tx, request, { ...event, operation: 'REFRESH', status: 'EXITO' });
      return { tokens };
    });
    if (result.error) { request.auditHandled = true; reply.clearCookie(REFRESH_COOKIE, cookieOptions(config)); throw result.error; }
    return sendTokens(reply, config, result.tokens!);
  });

  app.get('/api/v1/auth/session', { preHandler: async request => {
    if (request.headers.authorization) return authenticate(request);
    const raw=request.cookies[REFRESH_COOKIE];
    if (!raw || !/^[a-f0-9]{128}$/.test(raw)) throw unauthorized();
    await validateOrigin(request);
    const token=await prisma.refreshToken.findUnique({where:{hash:tokenHash(raw)},include:{session:{include:{user:true}}}});
    const time=now();
    if (!token || token.consumedAt || token.revokedAt || token.expiresAt<=time || !validSession(token.session,token.session.user,time)) throw unauthorized();
    const session=token.session;
    request.auth={userId:session.userId,sessionId:session.id,role:session.user.role,user:session.user,session,checkedAt:time,permissions:await userPermissions(prisma,session.user)};
    request.restoredAccessToken=app.jwt.sign({sub:session.userId,sid:session.id},{expiresIn:ACCESS_SECONDS});
  } }, async request => {
    const { user, session, checkedAt } = request.auth!;
    return { ...(request.restoredAccessToken ? { accessToken: request.restoredAccessToken, tokenType: 'Bearer', expiresIn: ACCESS_SECONDS } : {}), user: { ...safeUser(user), permissions: await userPermissions(prisma, user) }, session: { id: session.id, createdAt: session.createdAt.toISOString(), lastActivityAt: session.lastActivityAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(), idleExpiresAt: new Date(session.lastActivityAt.getTime() + INACTIVITY_MS).toISOString() }, serverTime: checkedAt.toISOString() };
  });

  app.post('/api/v1/auth/logout', { preHandler: validateOrigin }, async (request, reply) => {
    emptyBody.parse(request.body);
    const claims = verifiedClaims(request, true);
    const bearerSession = claims ? await prisma.session.findUnique({ where: { id: claims.sid } }) : null;
    const bearerIdentity = bearerSession && bearerSession.userId === claims?.sub ? bearerSession : null;
    const raw = request.cookies[REFRESH_COOKIE];
    const cookieToken = raw && /^[a-f0-9]{128}$/.test(raw) ? await prisma.refreshToken.findUnique({ where: { hash: tokenHash(raw) }, include: { session: true } }) : null;
    const cookieIdentity = cookieToken?.session;
    if (bearerIdentity && cookieIdentity && bearerIdentity.id !== cookieIdentity.id) throw new AppError(403, 'SESSION_MISMATCH', 'Las credenciales corresponden a sesiones diferentes.');
    const identity = bearerIdentity ?? cookieIdentity;
    if (!identity) {
      await audit(prisma, request, { operation: 'LOGOUT', resource: 'sesiones', status: 'EXITO', detail: 'Cierre idempotente sin sesión identificable.' });
      reply.clearCookie(REFRESH_COOKIE, cookieOptions(config));
      return reply.code(204).send();
    }
    await prisma.$transaction(async tx => {
      const user = await lockUser(tx, identity.userId);
      await tx.$queryRaw`SELECT id FROM sesiones WHERE id = ${identity.id}::uuid FOR UPDATE`;
      const session = await tx.session.findUniqueOrThrow({ where: { id: identity.id } });
      const time = now();
      const endedAt = await finalizeSession(tx, request, user, session, time, true);
      await audit(tx, request, { operation: 'LOGOUT', resource: 'sesiones', resourceId: session.id, userId: user.id, role: user.role, sessionId: session.id,
        status: 'EXITO', detail: session.revokedAt ? 'Sesión ya finalizada; cierre idempotente.' : 'Cierre de sesión solicitado.', after: { durationSeconds: duration(session, endedAt) } });
    });
    reply.clearCookie(REFRESH_COOKIE, cookieOptions(config));
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/activity', { preHandler: authenticate }, async (request, reply) => {
    emptyBody.parse(request.body);
    await prisma.$transaction(async tx => {
      const { session, time } = await lockedSession(tx, request.auth!.userId, request.auth!.sessionId, now, request);
      await tx.session.update({ where: { id: session.id }, data: { lastActivityAt: time } });
      await audit(tx, request, { operation: 'ACTIVIDAD_SESION', resource: 'sesiones', resourceId: session.id, status: 'EXITO' });
    });
    return reply.code(204).send();
  });

  app.post('/api/v1/auth/recover-password', async request => {
    const body = z.object({ email: z.string().transform(normalizeIdentity).pipe(z.email().max(254)) }).strict().parse(request.body);
    const emailKey = normalizeIdentity(body.email);
    const keys = [`email:${tokenHash(emailKey)}`, `ip:${tokenHash(request.ip)}`].sort();
    const releaseMailSlot = mailer.available ? reserveMailSlot() : undefined;
    let queued = false;
    try {
    const result = await prisma.$transaction(async tx => {
      for (const key of keys) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const time = now();
      let limited = false;
      for (const key of keys) {
        const rate = await tx.recoveryRate.findUnique({ where: { key } });
        const current = rate && time.getTime() - rate.windowStart.getTime() < 3600000;
        if (current && rate.count >= 3) limited = true;
      }
      if (!limited) {
        for (const key of keys) {
          const rate = await tx.recoveryRate.findUnique({ where: { key } });
          const current = rate && time.getTime() - rate.windowStart.getTime() < 3600000;
          await tx.recoveryRate.upsert({ where: { key }, create: { key, windowStart: time, count: 1 }, update: current ? { count: { increment: 1 } } : { windowStart: time, count: 1 } });
        }
      }
      let user = await tx.user.findUnique({ where: { emailKey } });
      if (user) user = await lockUser(tx, user.id);
      const eligible = !limited && !!user?.active && user.emailKey === emailKey && mailer.available && !!releaseMailSlot;
      let raw: string | undefined;
      let id: string | undefined;
      if (eligible && user) {
        raw = randomToken(32);
        const recovery = await tx.recoveryToken.create({ data: { userId: user.id, hash: tokenHash(raw), createdAt: time, expiresAt: new Date(time.getTime() + RECOVERY_TTL_MINUTES * 60000) } });
        id = recovery.id;
      }
      await audit(tx, request, { operation: 'RECUPERACION_SOLICITADA', resource: 'usuarios', ...(user ? { userId: user.id, role: user.role, resourceId: user.id } : {}), status: eligible ? 'EXITO' : 'FALLIDO', detail: limited ? 'Límite de solicitudes alcanzado.' : !mailer.available ? 'SMTP no disponible.' : 'Solicitud procesada.' });
      return eligible && user && raw && id ? { email: user.email, userId: user.id, role: user.role, raw, id } : undefined;
    });
    if (result) {
      const task = Promise.resolve().then(async () => {
        const url = new URL(config.recoveryUrl);
        url.searchParams.set('token', result.raw);
        try { await mailer.sendRecovery(result.email, url.toString()); } catch {
          await prisma.$transaction(async tx => {
            await tx.recoveryToken.update({ where: { id: result.id }, data: { consumedAt: now() } });
            await audit(tx, request, { operation: 'RECUPERACION_ENVIO_FALLIDO', resource: 'usuarios', resourceId: result.userId, userId: result.userId, role: result.role, status: 'FALLIDO', detail: 'No se pudo entregar el correo; token invalidado.' });
          });
          app.log.warn('Entrega de recuperación no disponible.');
        }
      }).catch(() => { app.log.error('No se pudo compensar y auditar la entrega de recuperación.'); });
      pendingMail.add(task);
      queued = true;
      void task.finally(() => { pendingMail.delete(task); releaseMailSlot?.(); });
    }
    return { message: GENERIC_RECOVERY };
    } finally {
      if (!queued) releaseMailSlot?.();
    }
  });

  app.post('/api/v1/auth/reset-password', async (request, reply) => {
    const body = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), newPassword: passwordSchema }).strict().parse(request.body);
    const candidate = await prisma.recoveryToken.findUnique({ where: { hash: tokenHash(body.token) } });
    if (!candidate) throw new AppError(400, 'INVALID_RECOVERY_TOKEN', 'El enlace de recuperación no es válido o ha vencido.');
    const passwordHash = await hashPassword(body.newPassword);
    await prisma.$transaction(async tx => {
      const user = await lockUser(tx, candidate.userId);
      const time = now();
      const token = await tx.recoveryToken.findUniqueOrThrow({ where: { id: candidate.id } });
      if (!user.active || token.consumedAt || token.expiresAt <= time) throw new AppError(400, 'INVALID_RECOVERY_TOKEN', 'El enlace de recuperación no es válido o ha vencido.');
      if (await verifyPassword(user.passwordHash, body.newPassword)) throw new AppError(400, 'PASSWORD_UNCHANGED', 'La nueva contraseña debe ser diferente de la actual.');
      await tx.recoveryToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: time } });
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, failures: 0, lockedUntil: null } });
      await revokeUserSessions(tx, user.id, undefined, time);
      await audit(tx, request, { operation: 'CONTRASENA_RESTABLECIDA', resource: 'usuarios', resourceId: user.id, userId: user.id, role: user.role, status: 'EXITO' });
    });
    reply.clearCookie(REFRESH_COOKIE, cookieOptions(config));
    return reply.code(204).send();
  });

  app.patch('/api/v1/me/password', { preHandler: authenticate }, async (request, reply) => {
    const body = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict().parse(request.body);
    const passwordHash = await hashPassword(body.newPassword);
    const tokens = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(741901)`;
      const { user, session, time } = await lockedSession(tx, request.auth!.userId, request.auth!.sessionId, now, request);
      if (!await verifyPassword(user.passwordHash, body.currentPassword)) throw new AppError(400, 'INVALID_CURRENT_PASSWORD', 'La contraseña actual es incorrecta.');
      if (await verifyPassword(user.passwordHash, body.newPassword)) throw new AppError(400, 'PASSWORD_UNCHANGED', 'La nueva contraseña debe ser diferente de la actual.');
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, failures: 0, lockedUntil: null } });
      await tx.recoveryToken.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: time } });
      await revokeUserSessions(tx, user.id, session.id, time);
      await tx.refreshToken.updateMany({ where: { sessionId: session.id, revokedAt: null }, data: { revokedAt: time } });
      const next = await issue(tx, request, user, session, time);
      await audit(tx, request, { operation: 'CONTRASENA_PERSONAL_MODIFICADA', resource: 'usuarios', resourceId: user.id, status: 'EXITO' });
      return next;
    });
    return sendTokens(reply, config, tokens);
  });

  app.patch('/api/v1/usuarios/:id/password', { preHandler: requirePermission('users.password') }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ newPassword: passwordSchema }).strict().parse(request.body);
    if (id === request.auth!.userId) throw new AppError(400, 'SELF_ADMIN_PASSWORD_CHANGE', 'Usa el cambio de contraseña personal para tu propia cuenta.');
    const passwordHash = await hashPassword(body.newPassword);
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(741901)`;
      const initialActor = await lockedSession(tx, request.auth!.userId, request.auth!.sessionId, now, request);
      await assertRequestPermission(tx, request, initialActor.user);
      const exists = await tx.user.findUnique({ where: { id } });
      if (!exists) throw new AppError(404, 'NOT_FOUND', 'El usuario no existe.');
      const target = await lockUser(tx, id);
      await protectUserPrivileges(tx, initialActor.user, target);
      // The target lock can outlive the actor's session deadline.
      const actor = await lockedSession(tx, request.auth!.userId, request.auth!.sessionId, now, request);
      const time = actor.time;
      await assertRequestPermission(tx, request, actor.user);
      if (await verifyPassword(target.passwordHash, body.newPassword)) throw new AppError(400, 'PASSWORD_UNCHANGED', 'La nueva contraseña debe ser diferente de la actual.');
      await tx.user.update({ where: { id }, data: { passwordHash, failures: 0, lockedUntil: null } });
      await tx.recoveryToken.updateMany({ where: { userId: id, consumedAt: null }, data: { consumedAt: time } });
      await revokeUserSessions(tx, id, undefined, time);
      await audit(tx, request, { operation: 'CONTRASENA_ADMIN_MODIFICADA', resource: 'usuarios', resourceId: id, status: 'EXITO' });
    });
    return reply.code(204).send();
  });
}
