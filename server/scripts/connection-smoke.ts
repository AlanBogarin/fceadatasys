import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

if (process.env.ALLOW_DATABASE_TESTS !== "1")
  throw Error("Requiere ALLOW_DATABASE_TESTS=1.");
const origin = new URL(
  process.env.CONNECTION_TEST_OWNER_URL ?? "http://missing",
);
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) &&
    origin.pathname === "/fceadatasys_connection_test",
  "Use la base local exclusiva de conexión.",
);
const name = `fceadatasys_connection_smoke_${Date.now()}`;
const owner = new Client({ connectionString: origin.href });
await owner.connect();
await owner.query(`CREATE DATABASE "${name}"`);
await owner.end();
origin.pathname = "/" + name;
const db = new Client({ connectionString: origin.href });
await db.connect();
try {
  const folders = (await readdir("prisma/migrations"))
    .filter((name) => /^\d/.test(name))
    .sort();
  for (const folder of folders.slice(0, 5))
    await db.query(
      await readFile(`prisma/migrations/${folder}/migration.sql`, "utf8"),
    );
  const id = randomUUID();
  await db.query(
    `INSERT INTO usuarios(id,nombre,ci,correo,correo_clave,usuario,usuario_clave,rol,contrasena_hash,actualizado_en) VALUES($1,'Fixture legado','999999','smoke@example.test','smoke@example.test','smoke','smoke','ADMINISTRADOR','fixture',now())`,
    [id],
  );
  await db.query(
    `INSERT INTO auditoria(id,usuario_id,rol,operacion,recurso,ip,user_agent,estado) VALUES($1,$2,'ADMINISTRADOR','FIXTURE','smoke','127.0.0.1','smoke','EXITO')`,
    [randomUUID(), id],
  );
  for (const folder of folders.slice(5))
    await db.query(
      await readFile(`prisma/migrations/${folder}/migration.sql`, "utf8"),
    );
  assert.equal(
    (await db.query("SELECT tamano_maximo_mb FROM parametros_publicaciones"))
      .rows[0].tamano_maximo_mb,
    10,
  );
  await assert.rejects(
    db.query("UPDATE parametros_publicaciones SET limite_palabras_resumen=2"),
    { code: "23514" },
  );
  await db.query(await readFile("prisma/rollback-summary-limits.sql", "utf8"));
  await db.query(
    await readFile("prisma/rollback-client-integration.sql", "utf8"),
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM usuarios")).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM auditoria")).rows[0].n,
    1,
  );
  for (const folder of folders.slice(5))
    await db.query(
      await readFile(`prisma/migrations/${folder}/migration.sql`, "utf8"),
    );
  await db.query("UPDATE parametros_publicaciones SET tamano_maximo_mb=12");
  await assert.rejects(
    db.query(await readFile("prisma/rollback-client-integration.sql", "utf8")),
  );
  await db.query("ROLLBACK");
  assert.equal(
    (await db.query("SELECT tamano_maximo_mb FROM parametros_publicaciones"))
      .rows[0].tamano_maximo_mb,
    12,
  );
  const session = randomUUID();
  const key = "a".repeat(64);
  await db.query(
    `INSERT INTO sesiones(id,usuario_id,creado_en,ultima_actividad_en,vence_en,navegador_clave) VALUES($1,$2,now(),now(),now()+interval '1 day',$3)`,
    [session, id, key],
  );
  await assert.rejects(
    db.query(
      `INSERT INTO sesiones(id,usuario_id,creado_en,ultima_actividad_en,vence_en,navegador_clave) VALUES($1,$2,now(),now(),now()+interval '1 day',$3)`,
      [randomUUID(), id, key],
    ),
    { code: "23505" },
  );
  await assert.rejects(db.query("UPDATE auditoria SET detalle='alterado'"), {
    code: "55000",
  });
  console.log(
    "Integración: aplicación, down/up con historia, rollback protegido, límites, sesión única e inmutabilidad correctos.",
  );
} finally {
  await db.end();
}
