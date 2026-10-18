import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "../security/crypto.js";
import { createUserSchema, normalizeIdentity } from "../users/schemas.js";

export function bootstrapInput(
  environment: NodeJS.ProcessEnv,
  defaults: Record<string, string> = {},
) {
  const required = (key: string) => {
    const value = environment[key] ?? defaults[key];
    if (!value?.trim()) throw Error(`Falta configuración ${key}.`);
    return value;
  };
  const parsed = createUserSchema.safeParse({
    name: required("BOOTSTRAP_ADMIN_NAME"),
    ci: required("BOOTSTRAP_ADMIN_CI"),
    email: required("BOOTSTRAP_ADMIN_EMAIL"),
    username: required("BOOTSTRAP_ADMIN_USERNAME"),
    password: required("BOOTSTRAP_ADMIN_PASSWORD"),
    role: "ADMINISTRADOR",
    active: true,
  });
  if (!parsed.success)
    throw Error(
      "Configuración bootstrap inválida: revisar formatos y política de contraseña documentados.",
    );
  return parsed.data;
}
export type BootstrapInput = ReturnType<typeof bootstrapInput>;

export async function bootstrapAdmin(
  prisma: PrismaClient,
  input: BootstrapInput,
  initialDelivery = false,
) {
  const { name, ci, email, username, password } = createUserSchema.parse(input);
  const usernameKey = normalizeIdentity(username);
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(741901)`;
      if (initialDelivery) {
        const counts = await Promise.all([
          tx.publication.count(),
          tx.storedAttachment.count(),
          tx.author.count(),
          tx.tutor.count(),
          tx.catalogRecord.count(),
          tx.session.count(),
        ]);
        if (counts.some((count) => count !== 0) || (await tx.user.count()) > 1)
          throw Error(
            "Bootstrap rechazado: la entrega inicial requiere una base sin datos de negocio ni sesiones. No se borraron datos.",
          );
        const settings = await tx.publicationSettings.findUnique({
          where: { id: 1 },
        });
        if (
          !settings ||
          settings.summaryWordLimit !== 300 ||
          settings.maxPdfSizeMb !== 10 ||
          settings.allowedFormats.join(",") !== "pdf"
        )
          throw Error(
            "Bootstrap rechazado: los parámetros de la entrega inicial deben ser 300 palabras, 10 MiB y PDF. No se sobrescriben parámetros.",
          );
      }
      const existing = await tx.user.findUnique({ where: { usernameKey } });
      if (existing) {
        if (
          existing.role !== "ADMINISTRADOR" ||
          !existing.active ||
          existing.ci !== ci ||
          existing.emailKey !== email ||
          (initialDelivery && existing.name !== name)
        )
          throw Error(
            "Bootstrap rechazado: la identidad existente no coincide con un administrador activo.",
          );
        return false;
      }
      if ((await tx.user.count()) !== 0)
        throw Error(
          "Bootstrap rechazado: la base ya contiene usuarios; utilizar administración autenticada.",
        );
      const user = await tx.user.create({
        data: {
          name,
          ci,
          email,
          emailKey: email,
          username,
          usernameKey,
          role: "ADMINISTRADOR",
          passwordHash,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          role: user.role,
          operation: "USER_BOOTSTRAP",
          resource: "usuarios",
          resourceId: user.id,
          ip: "127.0.0.1",
          userAgent: "fceadatasys-bootstrap",
          status: "EXITO",
          detail: "Alta inicial mediante bootstrap operacional.",
          after: {
            id: user.id,
            name: user.name,
            ci: user.ci,
            email: user.email,
            username: user.username,
            role: user.role,
            active: user.active,
          },
        },
      });
      return true;
    },
    { maxWait: 10000, timeout: 20000 },
  );
}
