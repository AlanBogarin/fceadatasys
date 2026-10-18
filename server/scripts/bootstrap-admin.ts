import { createPrisma } from '../src/db.js';
import { bootstrapAdmin, bootstrapInput } from '../src/initialization/bootstrap.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Falta configuración ${name}.`);
  return value;
}

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const input = bootstrapInput(process.env);
  const prisma = createPrisma(databaseUrl);
  try {
    const created = await bootstrapAdmin(prisma, input);
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
