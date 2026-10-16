import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

function testUrl(name: string): string {
  const raw = process.env[name];
  if (!raw || process.env.ALLOW_DATABASE_TESTS !== '1') {
    throw new Error('Se requieren ALLOW_DATABASE_TESTS=1 y ambas URLs de prueba.');
  }
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^\/fceadatasys_[a-z_]*test$/.test(url.pathname)) {
    throw new Error('Pruebas restringidas a PostgreSQL local y bases fceadatasys_*test.');
  }
  return raw;
}

async function main(): Promise<void> {
  const appUrl = testUrl('TEST_DATABASE_URL');
  const ownerUrl = testUrl('TEST_DATABASE_OWNER_URL');
  const appTarget = new URL(appUrl);
  const ownerTarget = new URL(ownerUrl);
  assert.equal(appTarget.host + appTarget.pathname, ownerTarget.host + ownerTarget.pathname,
    'Owner y runtime deben apuntar a la misma base de pruebas.');
  const app = new pg.Pool({ connectionString: appUrl });
  const owner = new pg.Pool({ connectionString: ownerUrl });
  let count = 0;
  const success = (label: string) => { count++; console.log(`OK ${label}`); };
  async function fails(query: () => Promise<unknown>, code: string | string[]): Promise<void> {
    await assert.rejects(query, (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error &&
      (Array.isArray(code) ? code.includes(String(error.code)) : error.code === code));
  }
  try {
    const permissions = (await app.query(`SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole,
      has_table_privilege(current_user, 'auditoria', 'UPDATE') AS audit_update,
      has_table_privilege(current_user, 'auditoria', 'DELETE') AS audit_delete,
      has_table_privilege(current_user, 'auditoria', 'TRUNCATE') AS audit_truncate,
      has_table_privilege(current_user, 'usuarios', 'DELETE') AS user_delete,
      has_table_privilege(current_user, 'auditoria', 'INSERT') AS audit_insert
      FROM pg_roles r WHERE r.rolname = current_user`)).rows[0];
    assert.deepEqual(permissions, { rolsuper: false, rolcreatedb: false, rolcreaterole: false,
      audit_update: false, audit_delete: false, audit_truncate: false, user_delete: true, audit_insert: true });
    success('Permisos runtime mínimos y auditoría solo SELECT/INSERT');

    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const userId = randomUUID();
    const ci = String(Math.floor(Math.random() * 9e10) + 1e10);
    const insertUser = `INSERT INTO usuarios
      (id,nombre,ci,correo,correo_clave,usuario,usuario_clave,rol,contrasena_hash,actualizado_en)
      VALUES ($1,'Fixture persistencia',$2,$3,$3,$4,$4,'ADMINISTRADOR','fixture-no-login',now())`;
    await app.query(insertUser, [userId, ci, `${suffix}@example.test`, `db_${suffix}`]);
    const auditId = randomUUID();
    const insertAudit = `INSERT INTO auditoria
      (id,usuario_id,rol,operacion,recurso,recurso_id,ip,user_agent,estado)
      VALUES ($1,$2::uuid,'ADMINISTRADOR','DATABASE_TEST','usuarios',$2::text,'127.0.0.1','database-smoke','EXITO')`;
    await app.query(insertAudit, [auditId, userId]);
    success('Inserción runtime con referencias de auditoría');

    for (const sql of [
      'UPDATE auditoria SET detalle = \'modificado\' WHERE id = $1',
      'DELETE FROM auditoria WHERE id = $1',
    ]) {
      await fails(() => app.query(sql, [auditId]), '42501');
      await fails(() => owner.query(sql, [auditId]), '55000');
    }
    await fails(() => app.query('TRUNCATE auditoria'), '42501');
    await fails(() => owner.query('TRUNCATE auditoria'), '55000');
    success('Auditoría inmutable por grants runtime y triggers owner (UPDATE/DELETE/TRUNCATE)');

    await fails(() => owner.query('DELETE FROM usuarios WHERE id = $1', [userId]), ['23503', '23001']);
    success('FK RESTRICT conserva usuarios referenciados en auditoría');

    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE usuarios SET nombre = \'Cambio que debe revertirse\' WHERE id = $1', [userId]);
      await fails(() => client.query(`INSERT INTO auditoria
        (id,usuario_id,operacion,recurso,ip,user_agent,estado)
        VALUES ($1,$2,'DATABASE_TEST','usuarios',NULL,'database-smoke','EXITO')`, [randomUUID(), userId]), '23502');
      await client.query('ROLLBACK');
    } finally { await client.query('ROLLBACK'); client.release(); }
    assert.equal((await app.query('SELECT nombre FROM usuarios WHERE id = $1', [userId])).rows[0].nombre,
      'Fixture persistencia');
    success('Fallo de escritura de auditoría revierte la mutación de negocio');

    const collisionEmail = `race_${suffix}@example.test`;
    const attempts = await Promise.allSettled([0, 1].map(index => app.query(insertUser,
      [randomUUID(), String(Number(ci) + index + 1), collisionEmail, `race${index}_${suffix}`])));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    const rejection = attempts.find(result => result.status === 'rejected');
    assert.ok(rejection?.status === 'rejected' && rejection.reason.code === '23505');
    success('Restricción UNIQUE arbitra correos duplicados concurrentes');

    await fails(() => app.query('UPDATE usuarios SET intentos_fallidos = -1 WHERE id = $1', [userId]), '23514');
    success('CHECK impide contador de intentos negativo');
    console.log(`${count} verificaciones PostgreSQL aprobadas; fixtures conservados en base desechable.`);
  } finally {
    await Promise.all([app.end(), owner.end()]);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falló la validación de persistencia.');
  process.exitCode = 1;
});
