import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import type { PrismaClient } from "@prisma/client";
import { createPrisma } from "../src/db.js";
import { bootstrapAdmin } from "../src/initialization/bootstrap.js";
import { initializeDemo } from "../src/initialization/demo.js";
import {
  productionInput,
  assertLimitedRuntime,
} from "../src/initialization/profiles.js";
import { verifyPassword } from "../src/security/crypto.js";
import { AppError } from "../src/errors.js";
import type { AppConfig } from "../src/config.js";

const ownerUrl = process.env.INITIAL_DATA_TEST_OWNER_URL;
test(
  "Conjuntos iniciales: producción mínima y demo UNC, aislados, auditados y repetibles",
  { skip: !ownerUrl, timeout: 180000 },
  async (t) => {
    const owner = new URL(ownerUrl!);
    assert.equal(owner.hostname, "127.0.0.1");
    assert.equal(owner.port, "55439");
    assert.equal(owner.pathname, "/postgres");
    const runtimeRole =
      process.env.INITIAL_DATA_TEST_RUNTIME_ROLE ?? "fcea_test_app";
    assert.match(runtimeRole, /^[a-z][a-z0-9_]*$/);
    const run = promisify(execFile);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const root = fileURLToPath(new URL("../", import.meta.url));
    const psql =
      process.platform === "win32"
        ? "C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe"
        : "psql";
    const prismaClients: PrismaClient[] = [];
    t.after(async () => {
      for (const client of prismaClients) await client.$disconnect();
    });
    async function database(name: string) {
      assert.match(name, /^fceadatasys_[a-z0-9_]+$/);
      const connection = new Client({ connectionString: owner.href });
      await connection.connect();
      try {
        await connection.query(`CREATE DATABASE "${name}"`);
      } finally {
        await connection.end();
      }
      const target = new URL(owner);
      target.pathname = "/" + name;
      await run(
        process.execPath,
        ["node_modules/prisma/build/index.js", "migrate", "deploy"],
        {
          cwd: root,
          env: { ...process.env, DATABASE_URL: target.href },
          timeout: 45000,
        },
      );
      await run(
        psql,
        [
          "-h",
          owner.hostname,
          "-p",
          owner.port,
          "-U",
          decodeURIComponent(owner.username),
          "-d",
          name,
          "-v",
          `app_role=${runtimeRole}`,
          "-f",
          "scripts/runtime-grants.sql",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            PGPASSWORD: decodeURIComponent(owner.password),
          },
          timeout: 15000,
        },
      );
      target.username = runtimeRole;
      target.password = "";
      const client = createPrisma(target.href);
      prismaClients.push(client);
      await assertLimitedRuntime(client);
      return { client, url: target.href, name };
    }
    const production = await database(`fceadatasys_${suffix}_delivery_test`);
    const demo = await database(`fceadatasys_${suffix}_demo_test`);
    const productionAdmin = productionInput({
      BOOTSTRAP_ADMIN_EMAIL: "delivery@example.test",
      BOOTSTRAP_ADMIN_PASSWORD: "EntregaTest2026!",
    });

    await t.test(
      "Producción: fallo de auditoría revierte el primer administrador y no crea datos parciales",
      async () => {
        const broken = production.client.$extends({
          query: {
            auditLog: {
              create: async () => {
                throw Error("Auditoría indisponible, fixture explícito.");
              },
            },
          },
        }) as unknown as PrismaClient;
        await assert.rejects(bootstrapAdmin(broken, productionAdmin, true));
        assert.equal(await production.client.user.count(), 0);
        assert.equal(await production.client.auditLog.count(), 0);
      },
    );
    await t.test(
      "Producción: un administrador, parámetros mínimos, cero muestras e idempotencia sin cambiar contraseña",
      async () => {
        assert.equal(
          await bootstrapAdmin(production.client, productionAdmin, true),
          true,
        );
        const admin = await production.client.user.findFirstOrThrow();
        assert.equal(admin.name, "Administrador");
        assert.equal(admin.ci, "0000000");
        assert.equal(admin.username, "admin");
        assert.ok(await verifyPassword(admin.passwordHash, "EntregaTest2026!"));
        assert.equal(
          await bootstrapAdmin(
            production.client,
            { ...productionAdmin, password: "OtraEntrega2026!" },
            true,
          ),
          false,
        );
        assert.equal(
          (await production.client.user.findFirstOrThrow()).passwordHash,
          admin.passwordHash,
        );
        assert.equal(await production.client.user.count(), 1);
        assert.equal(await production.client.auditLog.count(), 1);
        for (const count of await Promise.all([
          production.client.catalogRecord.count(),
          production.client.author.count(),
          production.client.tutor.count(),
          production.client.publication.count(),
          production.client.storedAttachment.count(),
          production.client.session.count(),
        ]))
          assert.equal(count, 0);
        const settings =
          await production.client.publicationSettings.findFirstOrThrow();
        assert.equal(settings.summaryWordLimit, 300);
        assert.equal(settings.maxPdfSizeMb, 10);
        assert.deepEqual(settings.allowedFormats, ["pdf"]);
        assert.equal(
          JSON.stringify(await production.client.auditLog.findMany()).includes(
            "EntregaTest2026!",
          ),
          false,
        );
        await assert.rejects(
          bootstrapAdmin(
            production.client,
            { ...productionAdmin, ci: "1234567" },
            true,
          ),
          /identidad existente/,
        );
      },
    );
    const environment = {
      INITIAL_DATA_PROFILE: "demo",
      INITIAL_DATA_DATABASE_NAME: demo.name,
      DEMO_ADMIN_PASSWORD: "DemoAdmin2026!",
      DEMO_DIGITADOR_PASSWORD: "DemoBiblioteca2026!",
      DEMO_PUBLICO_PASSWORD: "DemoConsulta2026!",
    };
    const config: AppConfig = {
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 3000,
      databaseUrl: demo.url,
      jwtSecret: "initial-data-integration-secret-".repeat(3),
      jwtIssuer: "initial-data-test",
      jwtAudience: "initial-data-test",
      allowedOrigins: ["http://127.0.0.1:5173"],
      secureCookies: false,
      recoveryUrl: "http://127.0.0.1:5173/#reset",
      attachments: {
        directory: fileURLToPath(
          new URL(`../.tmp/initial-data-${suffix}/`, import.meta.url),
        ),
        command: "clamscan",
        timeoutMs: 1000,
        maxSignatureAgeDays: 7,
        concurrency: 2,
      },
    };
    await t.test(
      "Demo: cada alta de catálogo es auditada; un fallo revierte esa alta y permite reanudar",
      async () => {
        const broken = demo.client.$extends({
          query: {
            auditLog: {
              create: ({ args, query }) => {
                if (args.data.operation === "CATALOGO_CREADO")
                  throw Error("Fallo de auditoría de catálogo inyectado.");
                return query(args);
              },
            },
          },
        }) as unknown as PrismaClient;
        await assert.rejects(
          initializeDemo(broken, config, environment, undefined, {
            attachments: {
              scanner: {
                scan: async () => ({ clean: true, engine: "fixture" }),
              },
            },
          }),
          /AUDIT_UNAVAILABLE/,
        );
        assert.equal(await demo.client.catalogRecord.count(), 0);
        assert.equal(await demo.client.user.count(), 3);
      },
    );
    await t.test(
      "Demo: antivirus indisponible no deja archivos habilitados ni publicaciones ficticiamente confirmadas",
      async () => {
        await assert.rejects(
          initializeDemo(demo.client, config, environment, undefined, {
            attachments: {
              scanner: {
                scan: async () => {
                  throw new AppError(
                    503,
                    "ANTIMALWARE_UNAVAILABLE",
                    "Fixture de scanner indisponible.",
                  );
                },
              },
            },
          }),
          /ANTIMALWARE_UNAVAILABLE/,
        );
        assert.equal(await demo.client.storedAttachment.count(), 0);
        assert.equal(await demo.client.publication.count(), 0);
      },
    );
    let scanned = 0;
    const options = {
      attachments: {
        scanner: {
          scan: async (bytes: Buffer) => {
            assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
            scanned++;
            return {
              clean: true,
              engine: "fixture explícito de inicialización",
            };
          },
        },
      },
    };
    await t.test(
      "Demo: completa 3 cuentas, 62 catálogos/personas, 8 publicaciones y 8 PDF mediante API",
      async () => {
        const result = await initializeDemo(
          demo.client,
          config,
          environment,
          undefined,
          options,
        );
        assert.equal(result.publicationsCreated, 8);
        assert.equal(result.attachmentsCreated, 8);
        assert.equal(scanned, 8);
        assert.equal(await demo.client.user.count(), 3);
        assert.equal(await demo.client.catalogRecord.count(), 36);
        assert.equal(await demo.client.author.count(), 14);
        assert.equal(await demo.client.tutor.count(), 12);
        assert.equal(await demo.client.publication.count(), 8);
        assert.equal(
          await demo.client.storedAttachment.count({
            where: { state: "CLEAN" },
          }),
          8,
        );
        const first = await demo.client.publication.findFirstOrThrow({
          orderBy: { number: "asc" },
          include: {
            authors: {
              orderBy: { position: "asc" },
              include: { author: true },
            },
            attachment: true,
          },
        });
        assert.equal(
          first.title,
          "Educación financiera y hábitos de ahorro de estudiantes universitarios",
        );
        assert.deepEqual(
          first.authors.map((item) => item.author.name),
          ["Lucía Benítez", "Mateo Acosta"],
        );
        assert.equal(
          first.attachment?.name,
          "Educacion-financiera-y-ahorro.pdf",
        );
        assert.equal(
          await demo.client.auditLog.count({
            where: { operation: "CATALOGO_CREADO", status: "EXITO" },
          }),
          62,
        );
        assert.equal(
          await demo.client.auditLog.count({
            where: { operation: "REGISTRAR_INVESTIGACION", status: "EXITO" },
          }),
          8,
        );
        assert.equal(
          await demo.client.auditLog.count({
            where: { operation: "ADJUNTO_CARGADO", status: "EXITO" },
          }),
          8,
        );
      },
    );
    await t.test(
      "Demo: segunda ejecución conserva IDs/credenciales, no duplica negocios ni reanaliza archivos",
      async () => {
        const before = await demo.client.publication.findMany({
          select: { id: true },
          orderBy: { number: "asc" },
        });
        const hashes = await demo.client.user.findMany({
          select: { passwordHash: true },
          orderBy: { username: "asc" },
        });
        const result = await initializeDemo(
          demo.client,
          config,
          environment,
          undefined,
          options,
        );
        assert.equal(result.usersCreated, 0);
        assert.equal(result.catalogsCreated, 0);
        assert.equal(result.publicationsCreated, 0);
        assert.equal(result.attachmentsCreated, 0);
        assert.equal(scanned, 8);
        assert.deepEqual(
          await demo.client.publication.findMany({
            select: { id: true },
            orderBy: { number: "asc" },
          }),
          before,
        );
        assert.deepEqual(
          await demo.client.user.findMany({
            select: { passwordHash: true },
            orderBy: { username: "asc" },
          }),
          hashes,
        );
        assert.equal(await production.client.publication.count(), 0);
        assert.equal(await production.client.user.count(), 1);
        const audit = JSON.stringify(await demo.client.auditLog.findMany());
        for (const password of Object.values(environment).filter((value) =>
          value.endsWith("2026!"),
        ))
          assert.equal(audit.includes(password), false);
        await assert.rejects(
          bootstrapAdmin(demo.client, productionAdmin, true),
          /sin datos de negocio/,
        );
      },
    );
  },
);
