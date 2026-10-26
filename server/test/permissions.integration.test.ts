import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readdir,
  readFile,
  rm,
} from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { createApp } from "../src/app.js";
import { createPrisma } from "../src/db.js";
import { hashPassword } from "../src/security/crypto.js";
import { initialPolicy } from "../src/security/permissions.js";
import { execute, startBackup, type Command } from "../src/backups/engine.js";

const databaseUrl = process.env.PERMISSIONS_TEST_DATABASE_URL;
test(
  "PostgreSQL: permisos por rol/cuenta, revocación, último gestor, rollback de auditoría y copias reales con nube sustituida",
  { skip: !databaseUrl, timeout: 90000 },
  async (t) => {
    const url = new URL(databaseUrl!);
    assert.ok(
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
        url.pathname === "/fceadatasys_permissions_demo_test",
    );
    const prisma = createPrisma(databaseUrl!),
      owner = createPrisma(process.env.PERMISSIONS_TEST_OWNER_URL!);
    await mkdir(".tmp", { recursive: true });
    const folder = await mkdtemp(resolve(".tmp/permissions-integration-"));
    const local = join(folder, "copies"),
      configFile = join(folder, "backup.env"),
      remote = join(folder, "rclone.conf");
    const password = "Permissions2026!",
      suffix = randomUUID().slice(0, 8),
      now = new Date();
    const passwordHash = await hashPassword(password);
    const people = [];
    for (const [index, role] of (
      ["ADMINISTRADOR", "ADMINISTRADOR", "DIGITADOR", "PUBLICO"] as const
    ).entries()) {
      const user = await prisma.user.create({
        data: {
          name: `Prueba permisos ${index}`,
          ci: String(Date.now()).slice(-9) + index,
          email: `${suffix}-${index}@example.invalid`,
          emailKey: `${suffix}-${index}@example.invalid`,
          username: `${suffix}_${index}`,
          usernameKey: `${suffix}_${index}`,
          passwordHash,
          role,
        },
      });
      const session = await prisma.session.create({
        data: {
          userId: user.id,
          lastActivityAt: now,
          expiresAt: new Date(now.getTime() + 3600000),
        },
      });
      people.push({ user, session });
    }
    await writeFile(remote, "[drive]\ntype = drive\n");
    await writeFile(
      configFile,
      `BACKUP_DATABASE_URL="${process.env.PERMISSIONS_TEST_OWNER_URL}"\nBACKUP_DIRECTORY="${local.replaceAll("\\", "/")}"\nRCLONE_CONFIG="${remote.replaceAll("\\", "/")}"\nRCLONE_REMOTE=drive:integration\nPG_DUMP_COMMAND="${process.env.TEST_PG_DUMP!.replaceAll("\\", "/")}"\nPG_RESTORE_COMMAND="${process.env.TEST_PG_RESTORE!.replaceAll("\\", "/")}"\n`,
    );
    let cloudFile = "",
      releaseDump: (() => void) | undefined;
    const dumpGate = new Promise<void>((resolveGate) => {
      releaseDump = resolveGate;
    });
    const command: Command = async (program, args, env, timeout) => {
      if (program === "rclone") {
        if (args[0] === "copyto") cloudFile = args[1];
        if (args[0] === "lsjson") {
          const bytes = await readFile(cloudFile);
          return JSON.stringify({
            Size: bytes.length,
            Hashes: { MD5: createHash("md5").update(bytes).digest("hex") },
          });
        }
        return "";
      }
      if (args.includes("--format=custom")) await dumpGate;
      return execute(program, args, env, timeout);
    };
    const config = {
      nodeEnv: "test" as const,
      host: "127.0.0.1",
      port: 3000,
      databaseUrl: databaseUrl!,
      jwtSecret: "permissions-integration-secret-".repeat(3),
      jwtIssuer: "test",
      jwtAudience: "test",
      allowedOrigins: ["http://localhost"],
      secureCookies: false,
      recoveryUrl: "http://localhost/reset",
      backups: { configFile },
    };
    const app = await createApp(config, prisma, {
      logger: false,
      backups: { command },
      security: {
        mailer: {
          available: false,
          verify: async () => false,
          sendRecovery: async () => {},
        },
      },
    });
    const headers = people.map(({ user, session }) => ({
      authorization: `Bearer ${app.jwt.sign({ sub: user.id, sid: session.id }, { expiresIn: 900 })}`,
      "x-confirmation-password": Buffer.from(password).toString("base64"),
    }));
    t.after(async () => {
      releaseDump?.();
      await app.close();
      await prisma.$disconnect();
      await owner.$disconnect();
      assert.ok(resolve(folder).startsWith(resolve(".tmp") + sep));
      await rm(folder, { recursive: true, force: true });
    });
    const policyRead = () =>
      app.inject({ url: "/api/v1/permisos", headers: headers[0] });
    const original = await policyRead();
    assert.equal(original.statusCode, 200, original.body);
    const policy = initialPolicy();
    policy.roles.DIGITADOR.push(
      "reports.read",
      "audit.read",
      "catalogs.facultades.manage",
    );
    policy.users[people[1].user.id] = {
      "permissions.manage": false,
      "users.delete": false,
      "audit.export": false,
    };
    const save = await app.inject({
      method: "PATCH",
      url: "/api/v1/permisos",
      headers: { ...headers[0], "if-match": original.headers.etag! },
      payload: policy,
    });
    assert.equal(save.statusCode, 200, save.body);
    const session = await app.inject({
      url: "/api/v1/auth/session",
      headers: headers[2],
    });
    assert.ok(session.json().user.permissions.includes("reports.read"));
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/catalogos/facultades",
      headers: headers[2],
      payload: { name: `Facultad ${suffix}`, fields: {} },
    });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(
      (await app.inject({ url: "/api/v1/permisos", headers: headers[1] }))
        .statusCode,
      403,
    );
    const target = await app.inject({
      url: `/api/v1/usuarios/${people[0].user.id}`,
      headers: headers[1],
    });
    const escalation = await app.inject({
      method: "PATCH",
      url: `/api/v1/usuarios/${people[0].user.id}`,
      headers: { ...headers[1], "if-match": target.headers.etag! },
      payload: { username: "escalation" },
    });
    assert.equal(escalation.statusCode, 403, escalation.body);
    const noManager = structuredClone(policy);
    noManager.roles.ADMINISTRADOR = noManager.roles.ADMINISTRADOR.filter(
      (key) => key !== "permissions.manage",
    );
    const lockout = await app.inject({
      method: "PATCH",
      url: "/api/v1/permisos",
      headers: { ...headers[0], "if-match": save.headers.etag! },
      payload: noManager,
    });
    assert.equal(lockout.statusCode, 409, lockout.body);
    assert.equal(lockout.json().code, "LAST_PERMISSION_ADMIN_REQUIRED");
    assert.equal((await policyRead()).headers.etag, save.headers.etag);
    const revocation = structuredClone(policy);
    revocation.roles.DIGITADOR = revocation.roles.DIGITADOR.filter(
      (key) => key !== "catalogs.facultades.manage",
    );
    const revoked = await app.inject({
      method: "PATCH",
      url: "/api/v1/permisos",
      headers: { ...headers[0], "if-match": save.headers.etag! },
      payload: revocation,
    });
    assert.equal(revoked.statusCode, 200, revoked.body);
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/catalogos/facultades",
      headers: headers[2],
      payload: { name: `Rechazado ${suffix}`, fields: {} },
    });
    assert.equal(denied.statusCode, 403, denied.body);
    const stale = await app.inject({
      method: "PATCH",
      url: "/api/v1/permisos",
      headers: { ...headers[0], "if-match": save.headers.etag! },
      payload: policy,
    });
    assert.equal(stale.statusCode, 412, stale.body);
    await owner.$executeRawUnsafe(
      "CREATE FUNCTION test_permissions_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operacion='PERMISOS_MODIFICADOS' THEN RAISE EXCEPTION 'test audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.$executeRawUnsafe(
      "CREATE TRIGGER test_permissions_audit_failure BEFORE INSERT ON auditoria FOR EACH ROW EXECUTE FUNCTION test_permissions_audit_failure()",
    );
    try {
      const failed = await app.inject({
        method: "PATCH",
        url: "/api/v1/permisos",
        headers: { ...headers[0], "if-match": revoked.headers.etag! },
        payload: policy,
      });
      assert.equal(failed.statusCode, 503, failed.body);
      assert.equal(failed.json().code, "AUDIT_UNAVAILABLE");
      assert.equal((await policyRead()).headers.etag, revoked.headers.etag);
    } finally {
      await owner.$executeRawUnsafe(
        "DROP TRIGGER test_permissions_audit_failure ON auditoria",
      );
      await owner.$executeRawUnsafe(
        "DROP FUNCTION test_permissions_audit_failure()",
      );
    }
    const started = await app.inject({
      method: "POST",
      url: "/api/v1/respaldos",
      headers: headers[0],
      payload: {},
    });
    assert.equal(started.statusCode, 202, started.body);
    const overlapping = await app.inject({
      method: "POST",
      url: "/api/v1/respaldos",
      headers: headers[0],
      payload: {},
    });
    assert.equal(overlapping.statusCode, 409, overlapping.body);
    releaseDump!();
    let job;
    for (let attempt = 0; attempt < 150; attempt++) {
      job = await prisma.backupRun.findUniqueOrThrow({
        where: { id: started.json().id },
      });
      if (job.status !== "EN_CURSO") break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    assert.equal(
      job!.status,
      "COMPLETO",
      job!.detail ?? "Backup no finalizado",
    );
    assert.ok(job!.localSaved && job!.cloudSaved);
    assert.equal((await readdir(local)).length, 1);
    const scheduled = await startBackup(
      prisma,
      config,
      { ip: "127.0.0.1", headers: { "user-agent": "test-scheduler" } } as any,
      "PROGRAMADO",
      { command },
    );
    assert.equal((await scheduled.completion).status, "COMPLETO");
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/respaldos",
          headers: headers[2],
          payload: {},
        })
      ).statusCode,
      403,
    );
    const restored = await app.inject({
      method: "PATCH",
      url: "/api/v1/permisos",
      headers: { ...headers[0], "if-match": revoked.headers.etag! },
      payload: initialPolicy(),
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.ok(
      (await prisma.auditLog.count({
        where: { operation: "PERMISOS_MODIFICADOS" },
      })) >= 3,
    );
  },
);
