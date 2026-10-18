import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPrisma } from './db.js';

const config = loadConfig();
const prisma = createPrisma(config.databaseUrl);
const app = await createApp(config, prisma);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
  await prisma.$disconnect();
  if (process.connected) process.disconnect();
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, shutdown);
process.on('message', message => { if (message === 'shutdown') void shutdown(); });
if (process.send) process.once('disconnect', () => { void shutdown(); });
try {
  await prisma.$connect();
  await app.listen({ host: config.host, port: config.port });
} catch {
  app.log.error('No se pudo iniciar el servidor; verificar configuración y servicios.');
  await app.close();
  await prisma.$disconnect();
  process.exitCode = 1;
}
