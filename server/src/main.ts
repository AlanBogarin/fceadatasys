import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';

const config = loadConfig();
const prisma = createPrisma(config.databaseUrl);
const app = await createApp(config, prisma);
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, async () => {
  if (closing) return;
  closing = true;
  await app.close();
  await prisma.$disconnect();
});
try {
  await prisma.$connect();
  await app.listen({ host: config.host, port: config.port });
} catch {
  app.log.error('No se pudo iniciar el servidor; verificar configuración y servicios.');
  await app.close();
  await prisma.$disconnect();
  process.exitCode = 1;
}
