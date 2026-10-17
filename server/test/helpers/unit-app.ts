import { createApp as productionApp, type AppOptions } from "../../src/app.js";
import type { AppConfig } from "../../src/config.js";
import type { PrismaClient } from "@prisma/client";
/** Existing component tests isolate their domain from the password confirmation service.
 * The integration suite and confirmation tests use the production verifier. */
export function createApp(
  config: AppConfig,
  prisma: PrismaClient,
  options: AppOptions = {},
) {
  return productionApp(config, prisma, {
    ...options,
    confirmation: async (request) => {
      request.confirmedPasswordHash = request.auth?.user.passwordHash;
    },
  });
}
