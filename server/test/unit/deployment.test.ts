import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { loadConfig } from "../../src/config.js";
import { createApp } from "../helpers/unit-app.js";

const environment = {
  DATABASE_URL: "postgresql://unit@localhost/unused",
  JWT_SECRET: "unit-deployment-secret-".repeat(3),
  ALLOWED_ORIGINS: "http://localhost:8080",
  RECOVERY_URL: "http://localhost:8080/#reset",
  SECURE_COOKIES: "false",
};
test("Proxy confiable acotado: solo loopback explícito, nunca comodines ni booleanos", () => {
  assert.deepEqual(loadConfig(environment).trustedProxies, []);
  assert.deepEqual(
    loadConfig({ ...environment, TRUSTED_PROXIES: "127.0.0.1,::1" })
      .trustedProxies,
    ["127.0.0.1", "::1"],
  );
  for (const value of [
    "true",
    "*",
    "0.0.0.0/0",
    "127.0.0.1,",
    "attacker.example.org",
  ])
    assert.throws(() => loadConfig({ ...environment, TRUSTED_PROXIES: value }));
});
test("IP auditada solo procede del proxy local autorizado; conexión directa ignora X-Forwarded-For", async (t) => {
  for (const proxies of ["", "127.0.0.1"]) {
    const app = await createApp(
      loadConfig({ ...environment, TRUSTED_PROXIES: proxies }),
      {} as PrismaClient,
      { logger: false },
    );
    app.get("/test-ip", async (request) => ({ ip: request.ip }));
    t.after(() => app.close());
    for (const remoteAddress of ["127.0.0.1", "192.0.2.20"]) {
      const result = await app.inject({
        url: "/test-ip",
        remoteAddress,
        headers: { "x-forwarded-for": "198.51.100.30" },
      });
      assert.equal(
        result.json().ip,
        proxies && remoteAddress === "127.0.0.1"
          ? "198.51.100.30"
          : remoteAddress,
      );
    }
  }
});
