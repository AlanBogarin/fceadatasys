import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/security/crypto.js';
import { createUserSchema, normalizeIdentity } from '../src/users/schemas.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Falta configuración ${name}.`);
  return value;
}

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const parsed = createUserSchema.safeParse({
    name: required('BOOTSTRAP_ADMIN_NAME'), ci: required('BOOTSTRAP_ADMIN_CI'),
    email: required('BOOTSTRAP_ADMIN_EMAIL'), username: required('BOOTSTRAP_ADMIN_USERNAME'),
    password: required('BOOTSTRAP_ADMIN_PASSWORD'), role: 'ADMINISTRADOR', active: true,
  });
  if (!parsed.success) {
    throw new Error('Configuración bootstrap inválida: revisar formatos y política de contraseña documentados.');
  }
  const { name, ci, email, username, password } = parsed.data;
  const usernameKey = normalizeIdentity(username);
  const passwordHash = await hashPassword(password);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const created = await prisma.$transaction(async (tx) => {
      // The same lock serializes API changes protecting the last active administrator.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(741901)`;
      const existing = await tx.user.findUnique({ where: { usernameKey } });
      if (existing) {
        if (existing.role !== 'ADMINISTRADOR' || !existing.active ||
            existing.ci !== ci || existing.emailKey !== email) {
          throw new Error('Bootstrap rechazado: la identidad existente no coincide con un administrador activo.');
        }
        return false;
      }
      if (await tx.user.count() !== 0) {
        throw new Error('Bootstrap rechazado: la base ya contiene usuarios; utilizar administración autenticada.');
      }
      const user = await tx.user.create({
        data: { name, ci, email, emailKey: email, username, usernameKey,
          role: 'ADMINISTRADOR', passwordHash },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id, role: user.role, operation: 'USER_BOOTSTRAP', resource: 'usuarios',
          resourceId: user.id, ip: '127.0.0.1', userAgent: 'fceadatasys-bootstrap', status: 'EXITO',
          detail: 'Alta inicial mediante bootstrap operacional.',
          after: { id: user.id, name: user.name, ci: user.ci, email: user.email,
            username: user.username, role: user.role, active: user.active },
        },
      });
      return true;
    }, { maxWait: 10000, timeout: 20000 });
    console.log(created ? 'Administrador inicial creado y auditado.' : 'Administrador inicial existente; no se modificaron credenciales.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Prisma errors may contain database connection details; never dump error objects or env values.
  const message = error instanceof Error &&
    /^(Falta configuración|Configuración bootstrap|Bootstrap rechazado)/.test(error.message)
    ? error.message : 'Bootstrap falló; revisar conectividad, migraciones, permisos y disponibilidad de auditoría.';
  console.error(message);
  process.exitCode = 1;
});
