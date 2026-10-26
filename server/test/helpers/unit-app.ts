import { createApp as productionApp, type AppOptions } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import type { PrismaClient } from "@prisma/client";
import { initialPolicy } from '../../src/security/permissions.js';
/** Existing component tests isolate their domain from the password confirmation service.
 * The integration suite and confirmation tests use the production verifier. */
export function createApp(
  config: AppConfig,
  prisma: PrismaClient,
  options: AppOptions = {},
) {
  const addPolicy = (db: any) => {
    db.accessPolicy ??= { findUniqueOrThrow: async () => ({ id: 1, policy: initialPolicy() }) };
    return db;
  };
  addPolicy(prisma);
  const transaction = prisma.$transaction?.bind(prisma);
  if (transaction) (prisma as any).$transaction = (work: any, ...args: any[]) =>
    transaction(typeof work === 'function' ? (tx: any) => work(addPolicy(tx)) : work, ...args);
  return productionApp(config, prisma, {
    ...options,
    confirmation: async (request) => {
      request.confirmedPasswordHash = request.auth?.user.passwordHash;
    },
  });
}
