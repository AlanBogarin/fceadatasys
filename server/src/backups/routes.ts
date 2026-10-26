import { access } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { requirePermission } from "../security/index.js";
import type { AppConfig } from "../config.js";
import { startBackup, type BackupOptions } from "./engine.js";

export async function registerBackupRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: AppConfig,
  options: BackupOptions = {},
) {
  const pending = new Set<Promise<unknown>>();
  app.addHook("onClose", async () => {
    await Promise.allSettled(pending);
  });
  app.get(
    "/api/v1/respaldos",
    { preHandler: requirePermission("backups.manage") },
    async (request) => {
      const { page, pageSize } = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
        })
        .strict()
        .parse(request.query);
      const [total, data] = await prisma.$transaction([
        prisma.backupRun.count(),
        prisma.backupRun.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      const configured = config.backups
        ? await access(config.backups.configFile).then(
            () => true,
            () => false,
          )
        : false;
      return {
        data,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
        configured,
      };
    },
  );
  app.post(
    "/api/v1/respaldos",
    { preHandler: requirePermission("backups.manage") },
    async (request, reply) => {
      z.object({})
        .strict()
        .parse(request.body ?? {});
      const { job, completion } = await startBackup(
        prisma,
        config,
        request,
        "MANUAL",
        options,
      );
      pending.add(completion);
      void completion
        .catch(() => {
          app.log.error(
            "No se pudo cerrar el respaldo; revisar auditoría y almacenamiento.",
          );
        })
        .finally(() => pending.delete(completion));
      return reply.code(202).header("Location", `/api/v1/respaldos`).send(job);
    },
  );
}
