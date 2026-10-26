import type { FastifyRequest } from "fastify";
import { loadConfig } from "../src/config.js";
import { createPrisma } from "../src/db.js";
import { startBackup } from "../src/backups/engine.js";

const config = loadConfig();
const prisma = createPrisma(config.databaseUrl);
try {
  const request = {
    ip: "127.0.0.1",
    headers: { "user-agent": "fceadatasys-backup-scheduler" },
  } as unknown as FastifyRequest;
  const { completion } = await startBackup(
    prisma,
    config,
    request,
    "PROGRAMADO",
  );
  const result = await completion;
  console.log(`Copia ${result.status}: ${result.id}`);
  if (result.status !== "COMPLETO") process.exitCode = 1;
} catch {
  console.error(
    "No se pudo completar la copia. Revisar configuración, herramientas, PostgreSQL, auditoría y Google Drive.",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
