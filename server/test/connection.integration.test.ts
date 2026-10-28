import test from "node:test";
import { catalogFields } from "./helpers/catalog-fields.js";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { PrismaClient, Role } from "@prisma/client";
import type { InjectOptions } from "fastify";
import ExcelJS from "exceljs";
import { createApp } from "../src/app.js";
import { createPrisma } from "../src/db.js";
import { hashPassword } from "../src/security/crypto.js";
import { createAttachmentStorage } from "../src/attachments/storage.js";

const databaseUrl = process.env.CONNECTION_TEST_DATABASE_URL;
test(
  "conexión real: auditoría, archivos, confirmación, versiones, filtros y navegador compartido",
  { skip: !databaseUrl },
  async (t) => {
    const url = new URL(databaseUrl!);
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
        url.pathname === "/fceadatasys_connection_test",
    );
    const prisma = createPrisma(databaseUrl!);
    const suffix = randomUUID().slice(0, 8);
    const password = "Conexión2026!";
    const encoded = Buffer.from(password).toString("base64");
    let clock = new Date();
    let sequence = 0;
    const directory = await mkdtemp(resolve(".tmp/connection-files-"));
    const config = {
      nodeEnv: "test" as const,
      host: "127.0.0.1",
      port: 3000,
      databaseUrl: databaseUrl!,
      jwtSecret: "connection-test-secret-".repeat(3),
      jwtIssuer: "connection-test",
      jwtAudience: "connection-test",
      allowedOrigins: ["http://localhost:5173"],
      secureCookies: false,
      recoveryUrl: "http://localhost:5173/#reset",
    };
    const app = await createApp(config, prisma, {
      logger: false,
      security: { now: () => new Date(clock) },
      attachments: {
        storage: createAttachmentStorage(directory),
        scanner: { scan: async () => ({ clean: true, engine: "fixture" }) },
      },
    });
    const send = (options: InjectOptions) =>
      app.inject({
        remoteAddress: `192.0.2.${(++sequence % 250) + 1}`,
        ...options,
      });
    const problem = (
      response: { statusCode: number; json(): { code: string }; body: string },
      status: number,
      code: string,
    ) => {
      assert.equal(response.statusCode, status, response.body);
      assert.equal(response.json().code, code);
    };
    const jar = (
      response: { cookies: { name: string; value: string }[] },
      previous = "",
    ) => {
      const entries = new Map(
        previous
          .split("; ")
          .filter(Boolean)
          .map((item) => {
            const [key, ...value] = item.split("=");
            return [key, value.join("=")];
          }),
      );
      for (const cookie of response.cookies)
        entries.set(cookie.name, cookie.value);
      return [...entries].map(([key, value]) => `${key}=${value}`).join("; ");
    };
    const accounts: Record<
      string,
      { id: string; username: string; token: string; cookie: string }
    > = {};
    async function login(role: string, cookie = "") {
      return send({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: config.allowedOrigins[0], cookie },
        payload: { username: accounts[role].username, password },
      });
    }
    const auth = (role = "ADMINISTRADOR") => ({
      authorization: `Bearer ${accounts[role].token}`,
    });
    const confirm = (role = "ADMINISTRADOR") => ({
      ...auth(role),
      "x-confirmation-password": encoded,
    });
    const get = async (path: string, role = "ADMINISTRADOR") =>
      send({ url: path, headers: auth(role) });
    const mutate = async (
      path: string,
      payload: object,
      role = "ADMINISTRADOR",
      etag?: string,
    ) => {
      const current = etag ?? String((await get(path, role)).headers.etag);
      return send({
        method: "PATCH",
        url: path,
        headers: { ...confirm(role), "if-match": current },
        payload,
      });
    };
    const create = async (catalog: string, name: string) => {
      const response = await send({
        method: "POST",
        url: `/api/v1/catalogos/${catalog}`,
        headers: auth(),
        payload: { name, fields: catalogFields(catalog) },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().id as string;
    };
    const settingsPath = "/api/v1/parametros/publicaciones";
    const multipart = async (
      bytes: Buffer,
      name: string,
      role = "ADMINISTRADOR",
    ) => {
      const boundary = `connection-${randomUUID()}`;
      return send({
        method: "POST",
        url: "/api/v1/adjuntos",
        headers: {
          ...auth(role),
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`,
          ),
          bytes,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
    };
    const pdf = (label: string) => Buffer.from(`%PDF-1.4\n${label}\n%%EOF\n`);
    try {
      const hash = await hashPassword(password);
      const ci = randomInt(100000000, 800000000);
      for (const [index, role] of (
        ["ADMINISTRADOR", "DIGITADOR", "PUBLICO"] as Role[]
      ).entries()) {
        const username = `conn.${suffix}.${index}`;
        const user = await prisma.user.create({
          data: {
            name: username,
            ci: String(ci + index),
            email: `${username}@example.test`,
            emailKey: `${username}@example.test`,
            username,
            usernameKey: username,
            role,
            passwordHash: hash,
          },
        });
        accounts[role] = { id: user.id, username, token: "", cookie: "" };
        const context=await send({method:'POST',url:'/api/v1/auth/browser',headers:{origin:config.allowedOrigins[0]}});
        assert.equal(context.statusCode,204,context.body);
        const response = await login(role,jar(context));
        assert.equal(response.statusCode, 200, response.body);
        accounts[role].token = response.json().accessToken;
        accounts[role].cookie = jar(response);
      }
      await t.test(
        "un navegador conserva una sola cuenta y una nueva pestaña recupera la misma sesión",
        async () => {
          const admin = accounts.ADMINISTRADOR;
          const preflight=await send({method:'OPTIONS',url:settingsPath,headers:{origin:config.allowedOrigins[0],'access-control-request-method':'PATCH','access-control-request-headers':'authorization,if-match,x-confirmation-password'}});
          assert.equal(preflight.statusCode,204);assert.match(String(preflight.headers['access-control-allow-headers']),/x-confirmation-password/i);
          problem(await send({url:'/api/v1/auth/session',headers:{cookie:admin.cookie,origin:'http://evil.invalid'}}),403,'ORIGIN_FORBIDDEN');
          problem(
            await login("DIGITADOR", admin.cookie),
            409,
            "BROWSER_SESSION_ACTIVE",
          );
          const before = await prisma.session.count({
            where: { userId: admin.id, revokedAt: null },
          });
          const response = await send({
            url: "/api/v1/auth/session",
            headers: { cookie: admin.cookie, origin: config.allowedOrigins[0] },
          });
          assert.equal(response.statusCode, 200, response.body);
          assert.equal(response.json().user.id, admin.id);
          assert.ok(response.json().accessToken);
          assert.equal(
            await prisma.session.count({
              where: { userId: admin.id, revokedAt: null },
            }),
            before,
          );
          const responses = await Promise.all(
            [1, 2].map(() =>
              send({
                method: "POST",
                url: "/api/v1/auth/refresh",
                headers: {
                  cookie: admin.cookie,
                  origin: config.allowedOrigins[0],
                },
              }),
            ),
          );
          for (const item of responses)
            assert.equal(item.statusCode, 200, item.body);
          assert.equal(
            responses.filter((item) =>
              item.cookies.some((cookie) => cookie.name === "refresh_token"),
            ).length,
            1,
          );
          const winner = responses.find((item) =>
            item.cookies.some((cookie) => cookie.name === "refresh_token"),
          )!;
          admin.cookie = jar(winner, admin.cookie);
          admin.token = winner.json().accessToken;
        },
      );
      const typeId = await create("tipos", `Tipo conexión ${suffix}`);
      const typePath = `/api/v1/catalogos/tipos/${typeId}`;
      await t.test(
        "confirmación obligatoria, contraseña UTF-8, cancelación y versiones de catálogos",
        async () => {
          const original = await get(typePath);
          const etag = String(original.headers.etag);
          problem(await send({method:'PATCH',url:typePath,headers:confirm(),payload:{name:'No guardar'}}),428,'PRECONDITION_REQUIRED');
          problem(
            await send({
              method: "PATCH",
              url: typePath,
              headers: { ...auth(), "if-match": etag },
              payload: { name: "No guardar" },
            }),
            428,
            "CONFIRMATION_REQUIRED",
          );
          problem(
            await send({
              method: "PATCH",
              url: typePath,
              headers: {
                ...auth(),
                "if-match": etag,
                "x-confirmation-password":
                  Buffer.from("incorrecta").toString("base64"),
              },
              payload: { name: "No guardar" },
            }),
            400,
            "INVALID_CONFIRMATION_PASSWORD",
          );
          assert.equal((await get(typePath)).json().name, original.json().name);
          const changed = await mutate(
            typePath,
            { name: `Tipo actualizado ${suffix}` },
            "ADMINISTRADOR",
            etag,
          );
          assert.equal(changed.statusCode, 200, changed.body);
          problem(
            await mutate(
              typePath,
              { name: "Precarga vieja" },
              "ADMINISTRADOR",
              etag,
            ),
            412,
            "RESOURCE_VERSION_CONFLICT",
          );
          const current = String(changed.headers.etag);
          const results = await Promise.all([
            mutate(
              typePath,
              { name: `Concurrente A ${suffix}` },
              "ADMINISTRADOR",
              current,
            ),
            mutate(
              typePath,
              { name: `Concurrente B ${suffix}` },
              "ADMINISTRADOR",
              current,
            ),
          ]);
          assert.deepEqual(
            results.map((item) => item.statusCode).sort(),
            [200, 412],
          );
        },
      );
      await t.test(
        "parámetros persistidos, límites de tamaño y ETag",
        async () => {
          assert.equal(
            (
              await mutate(settingsPath, {
                maxPdfSizeMb: 10,
                summaryWordLimit: 300,
                allowedFormats: ["pdf"],
              })
            ).statusCode,
            200,
          );
          const before = await get(settingsPath);
          assert.equal(before.json().maxPdfSizeMb, 10);
          const changed = await mutate(settingsPath, { maxPdfSizeMb: 12 });
          assert.equal(changed.statusCode, 200, changed.body);
          problem(
            await mutate(
              settingsPath,
              { summaryWordLimit: 200 },
              "ADMINISTRADOR",
              String(before.headers.etag),
            ),
            412,
            "RESOURCE_VERSION_CONFLICT",
          );
          problem(
            await mutate(settingsPath, { maxPdfSizeMb: 26 }),
            400,
            "VALIDATION_ERROR",
          );
        },
      );
      const author = await create("autores", `Ángela ${suffix}`);
      const tutor = await create("tutores", `José ${suffix}`);
      const career = await create("carreras", `Carrera ${suffix}`);
      const level = await create("niveles", `Nivel ${suffix}`);
      const branch = await create("filiales", `Filial ${suffix}`);
      const uploaded = await multipart(
        pdf(`Admin ${suffix}`),
        `Documento ${suffix}.pdf`,
      );
      assert.equal(uploaded.statusCode, 201, uploaded.body);
      const own = await multipart(
        pdf(`Digitador ${suffix}`),
        `Propio ${suffix}.pdf`,
        "DIGITADOR",
      );
      assert.equal(own.statusCode, 201, own.body);
      const publication = await send({
        method: "POST",
        url: "/api/v1/publicaciones",
        headers: auth(),
        payload: {
          title: `Trabajo conexión ${suffix}`,
          authorIds: [author],
          tutorIds: [tutor],
          careerId: career,
          levelId: level,
          typeId,
          branchId: branch,
          summary: `Resumen único ${suffix}`,
          abstract: `Unique abstract ${suffix}`,
          keywords: "conexión",
          year: 2026,
          approved: true,
          source: "LOCAL",
          requiresLibraryCopy: true,
          attachmentId: uploaded.json().id,
        },
      });
      assert.equal(publication.statusCode, 201, publication.body);
      await t.test(
        "listado de adjuntos por propietario, estado y metadatos, sin rutas privadas",
        async () => {
          const list = await get(
            "/api/v1/adjuntos?status=DISPONIBLE",
            "DIGITADOR",
          );
          assert.equal(list.statusCode, 200, list.body);
          assert.ok(
            list
              .json()
              .data.some((row: { id: string }) => row.id === own.json().id),
          );
          assert.ok(
            !list
              .json()
              .data.some(
                (row: { id: string }) => row.id === uploaded.json().id,
              ),
          );
          const linked = await get(
            `/api/v1/adjuntos?status=VINCULADO&search=${encodeURIComponent(`Trabajo conexión ${suffix}`)}`,
            "DIGITADOR",
          );
          assert.equal(
            linked.json().data[0].publication.id,
            publication.json().id,
          );
          assert.ok(linked.json().data[0].createdAt);
          assert.ok(linked.json().data[0].createdBy.id);
          assert.ok(!linked.body.includes("storageKey"));
          problem(await get("/api/v1/adjuntos", "PUBLICO"), 403, "FORBIDDEN");
          const pendingId=randomUUID();
          await prisma.storedAttachment.create({data:{id:pendingId,name:'Pendiente '+suffix+'.pdf',size:1,mime:'application/pdf',sha256:randomUUID().replaceAll('-','').repeat(2),storageKey:pendingId+'.pdf',state:'PENDING',createdById:accounts.ADMINISTRADOR.id}});
          const pending=await get('/api/v1/adjuntos?status=PENDIENTE&search='+suffix);
          assert.ok(pending.json().data.some((row:{id:string})=>row.id===pendingId));
          problem(await get('/api/v1/adjuntos/'+pendingId),409,'ATTACHMENT_NOT_READY');
          const large = Buffer.concat([
            Buffer.from(`%PDF-1.4\n% ${suffix}\n`),
            Buffer.alloc(11 * 1024 * 1024, 32),
            Buffer.from("\n%%EOF\n"),
          ]);
          assert.equal(
            (await multipart(large, `Grande ${suffix}.pdf`)).statusCode,
            201,
          );
          assert.equal(
            (await mutate(settingsPath, { maxPdfSizeMb: 1 })).statusCode,
            200,
          );
          problem(
            await multipart(large, `Exceso ${suffix}.pdf`),
            400,
            "INVALID_ATTACHMENT",
          );
          const old = await get(
            `/api/v1/publicaciones/${publication.json().id}/adjunto`,
          );
          assert.equal(old.statusCode, 200, old.body);
          const replacement = await multipart(
            pdf("reemplazo " + suffix),
            "Nuevo " + suffix + ".pdf",
          );
          assert.equal(replacement.statusCode, 201, replacement.body);
          const updated = await mutate(
            "/api/v1/publicaciones/" + publication.json().id,
            { attachmentId: replacement.json().id },
          );
          assert.equal(updated.statusCode, 200, updated.body);
          const reserved = await get(
            "/api/v1/adjuntos?status=RESERVADO&search=" +
              encodeURIComponent("Documento " + suffix),
          );
          assert.equal(reserved.json().data[0].id, uploaded.json().id);
          const metadata = await get(
            "/api/v1/adjuntos/" + replacement.json().id,
            "DIGITADOR",
          );
          assert.equal(metadata.statusCode, 200, metadata.body);
          assert.ok(metadata.json().createdBy.id);
        },
      );
      await t.test(
        "Público combina nombres de autor y tutor sin acceder a directorios privados",
        async () => {
          const response = await get(
            `/api/v1/publicaciones?author=angela%20${suffix}&tutor=jose%20${suffix}`,
            "PUBLICO",
          );
          assert.equal(response.statusCode, 200, response.body);
          assert.ok(
            response
              .json()
              .data.some(
                (row: { id: string }) => row.id === publication.json().id,
              ),
          );
          assert.ok(!response.body.includes("sha256"));
          const empty = await get(
            `/api/v1/publicaciones?author=angela%20${suffix}&tutor=ausente`,
            "PUBLICO",
          );
          assert.equal(empty.json().pagination.total, 0);
        },
      );
      await t.test(
        "auditoría: roles, filtros, detalle seguro, PDF/Excel, snapshot y vacío",
        async () => {
          problem(
            await get("/api/v1/auditoria", "DIGITADOR"),
            403,
            "FORBIDDEN",
          );
          problem(await get("/api/v1/auditoria", "PUBLICO"), 403, "FORBIDDEN");
          const filter = `operation=CATALOGO_CREADO&actorId=${accounts.ADMINISTRADOR.id}&module=autores`;
          const list = await get(`/api/v1/auditoria?${filter}`);
          assert.equal(list.statusCode, 200, list.body);
          assert.equal(list.json().pagination.total, 1);
          const row = list.json().data[0];
          assert.equal(row.actorRole, "ADMINISTRADOR");
          assert.ok(row.ip);
          assert.equal(
            (await get(`/api/v1/auditoria/${row.id}`)).statusCode,
            200,
          );
          for (const format of ["pdf", "xlsx"]) {
            const response = await get(
              `/api/v1/auditoria/exportar?${filter}&format=${format}&snapshot=${list.json().export.snapshot}`,
            );
            assert.equal(response.statusCode, 200, response.body);
            assert.ok(response.headers["content-disposition"]);
            if (format === "pdf")
              assert.equal(
                response.rawPayload.subarray(0, 5).toString(),
                "%PDF-",
              );
            else {
              const workbook = new ExcelJS.Workbook();
              await workbook.xlsx.load(response.rawPayload as never);
              assert.equal(workbook.getWorksheet("Auditoría")!.rowCount, 2);
            }
          }
          problem(
            await get(
              `/api/v1/auditoria/exportar?${filter}&format=pdf&snapshot=${"a".repeat(64)}`,
            ),
            409,
            "AUDIT_VERSION_CONFLICT",
          );
          const empty = await get(
            `/api/v1/auditoria/exportar?search=${randomUUID()}&format=pdf&snapshot=${"a".repeat(64)}`,
          );
          assert.equal(empty.statusCode, 200);
          assert.deepEqual(empty.json(), { data: [], total: 0 });
          assert.ok(!empty.headers["content-disposition"]);
        },
      );
      await t.test(
        "fallo de auditoría cancela una modificación y no entrega exportaciones",
        async () => {
          const broken = new Proxy(prisma, {
            get(target, key) {
              if (key === "auditLog")
                return {
                  ...target.auditLog,
                  create: async () => {
                    throw Error("fixture");
                  },
                };
              if (key === "$transaction")
                return async (callback: unknown, ...args: unknown[]) =>
                  target.$transaction(
                    async (tx) =>
                      (callback as (value: unknown) => Promise<unknown>)(
                        new Proxy(tx, {
                          get(value, property) {
                            if (property === "auditLog")
                              return {
                                ...value.auditLog,
                                create: async () => {
                                  throw Error("fixture");
                                },
                              };
                            return Reflect.get(value, property);
                          },
                        }),
                      ),
                    ...(args as []),
                  );
              return Reflect.get(target, key);
            },
          }) as PrismaClient;
          const failed = await createApp(config, broken, {
            logger: false,
            security: { now: () => new Date(clock) },
          });
          try {
            const before = await get(typePath);
            const response = await failed.inject({
              method: "PATCH",
              url: typePath,
              headers: {
                ...confirm(),
                "if-match": String(before.headers.etag),
              },
              payload: { name: "No persistir" },
            });
            problem(response, 503, "AUDIT_UNAVAILABLE");
            assert.equal((await get(typePath)).json().name, before.json().name);
            const sessionId = (await get("/api/v1/auth/session")).json().session
              .id;
            const failures = (
              await prisma.session.findUniqueOrThrow({
                where: { id: sessionId },
              })
            ).confirmationFailures;
            const rejected = await failed.inject({
              method: "PATCH",
              url: typePath,
              headers: {
                ...auth(),
                "if-match": String(before.headers.etag),
                "x-confirmation-password":
                  Buffer.from("incorrecta").toString("base64"),
              },
              payload: { name: "No persistir" },
            });
            problem(rejected, 503, "AUDIT_UNAVAILABLE");
            assert.equal(
              (
                await prisma.session.findUniqueOrThrow({
                  where: { id: sessionId },
                })
              ).confirmationFailures,
              failures,
            );
            const filter =
              "operation=CATALOGO_CREADO&actorId=" +
              accounts.ADMINISTRADOR.id +
              "&module=autores";
            const selected = await get("/api/v1/auditoria?" + filter);
            const document = await failed.inject({
              url:
                "/api/v1/auditoria/exportar?" +
                filter +
                "&format=pdf&snapshot=" +
                selected.json().export.snapshot,
              headers: auth(),
            });
            problem(document, 503, "AUDIT_UNAVAILABLE");
            assert.ok(!document.headers["content-disposition"]);
          } finally {
            await failed.close();
          }
        },
      );
      await t.test(
        "tres confirmaciones incorrectas cierran la sesión compartida; otro navegador conserva acceso",
        async () => {
          const separate = await login("ADMINISTRADOR");
          assert.equal(separate.statusCode, 200, separate.body);
          for (let attempt = 0; attempt < 3; attempt++) {
            const response = await send({
              method: "PATCH",
              url: typePath,
              headers: {
                ...auth(),
                "if-match": String((await get(typePath)).headers.etag),
                "x-confirmation-password":
                  Buffer.from("incorrecta").toString("base64"),
              },
              payload: { name: "No guardar" },
            });
            assert.equal(
              response.statusCode,
              attempt === 2 ? 401 : 400,
              response.body,
            );
          }
          problem(await get(typePath), 401, "UNAUTHENTICATED");
          assert.equal(
            (
              await send({
                url: typePath,
                headers: {
                  authorization: `Bearer ${separate.json().accessToken}`,
                },
              })
            ).statusCode,
            200,
          );
          const cookie = jar(separate);
          assert.equal(
            (
              await send({
                method: "POST",
                url: "/api/v1/auth/logout",
                headers: {
                  authorization: `Bearer ${separate.json().accessToken}`,
                  cookie,
                  origin: config.allowedOrigins[0],
                },
              })
            ).statusCode,
            204,
          );
          problem(
            await send({
              url: typePath,
              headers: {
                authorization: `Bearer ${separate.json().accessToken}`,
              },
            }),
            401,
            "UNAUTHENTICATED",
          );
        },
      );
    } finally {
      await app.close();
      await prisma.$disconnect();
      assert.ok(directory.startsWith(resolve(".tmp") + sep));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
