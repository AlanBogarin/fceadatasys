import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

// Explicit opt-in, local test owner only. Creates and retains its own database;
// never runs a down against an existing project or institutional database.
const target = new URL(process.env.PUBLICATIONS_TEST_OWNER_URL ?? 'http://missing');
assert.equal(process.env.ALLOW_DATABASE_TESTS, '1');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
assert.match(target.pathname, /^\/fceadatasys_.*test$/);
const admin = new Client({ connectionString: target.href });
await admin.connect();
const database = `fceadatasys_management_${randomUUID().replaceAll('-', '').slice(0, 12)}test`;
await admin.query(`CREATE DATABASE ${database}`); // generated identifier only
const url = new URL(target); url.pathname = `/${database}`;
const db = new Client({ connectionString: url.href });
await db.connect();
try {
  for (const name of ['20261015000000_security_foundation', '20261016000000_catalogs', '20261016010000_publication_registration', '20261016020000_publication_queries']) await db.query(await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'));
  const user = randomUUID();
  const publication = randomUUID();
  const file = randomUUID();
  const fileHash = createHash('sha256').update(file).digest('hex');
  await db.query("INSERT INTO usuarios(id,nombre,ci,correo,correo_clave,usuario,usuario_clave,rol,contrasena_hash,actualizado_en) VALUES($1,'Smoke','1234567','smoke@example.org','smoke@example.org','smoke','smoke','ADMINISTRADOR','test-only',now())", [user]);
  await db.query("INSERT INTO auditoria(id,usuario_id,rol,operacion,recurso,ip,user_agent,estado) VALUES($1,$2,'ADMINISTRADOR','MIGRATION_SMOKE','test','127.0.0.1','smoke','EXITO')", [randomUUID(), user]);
  const catalogs: string[] = [];
  for (const kind of ['carreras', 'niveles', 'tipos', 'filiales']) {
    const id = randomUUID(); catalogs.push(id);
    await db.query('INSERT INTO catalogos(id,tipo,nombre,nombre_clave,busqueda_clave,actualizado_en) VALUES($1,$2::text::tipo_catalogo,$2::text,$2::text,$2::text,now())', [id, kind]);
  }
  const author = randomUUID(), tutor = randomUUID();
  await db.query("INSERT INTO autores(id,nombre_completo,nombre_clave,busqueda_clave,actualizado_en) VALUES($1,'Autor','autor','autor',now())", [author]);
  await db.query("INSERT INTO tutores(id,nombre_completo,nombre_clave,busqueda_clave,actualizado_en) VALUES($1,'Tutor','tutor','tutor',now())", [tutor]);
  await db.query("INSERT INTO adjuntos(id,nombre,tamano,mime,sha256,almacenamiento_clave,estado,contenido_verificado,analizado_en,creado_por_id) VALUES($1,'tesis.pdf',100,'application/pdf',$2,$3,'CLEAN',true,now(),$4)", [file, fileHash, `${file}.pdf`, user]);
  await db.query('BEGIN');
  await db.query("INSERT INTO publicaciones(id,titulo,titulo_hash,resumen,resumen_hash,abstract,abstract_hash,palabras_clave,anio,origen,requiere_copia_biblioteca,adjunto_id,adjunto_hash,carrera_id,nivel_id,tipo_id,filial_id,creado_por_id) VALUES($1,'Smoke',repeat('a',64),'Resumen',repeat('b',64),'Abstract',repeat('c',64),'smoke',2026,'LOCAL',true,$2,$3,$4,$5,$6,$7,$8)", [publication, file, fileHash, ...catalogs, user]);
  await db.query('INSERT INTO publicacion_autores(publicacion_id,autor_id,orden) VALUES($1,$2,1)', [publication, author]);
  await db.query('INSERT INTO publicacion_tutores(publicacion_id,tutor_id,orden) VALUES($1,$2,1)', [publication, tutor]);
  await db.query('COMMIT');
  const up = await readFile('prisma/migrations/20261016030000_publication_management/migration.sql', 'utf8');
  const down = await readFile('prisma/rollback-publication-management.sql', 'utf8');
  await db.query(up);
  assert.equal((await db.query('SELECT publicacion_id FROM asignaciones_adjuntos WHERE adjunto_id=$1', [file])).rows[0].publicacion_id, publication);
  assert.deepEqual((await db.query('SELECT formatos_admitidos FROM parametros_publicaciones')).rows[0].formatos_admitidos, ['pdf']);
  await db.query(down);
  for (const table of ['usuarios', 'auditoria', 'publicaciones', 'adjuntos', 'publicacion_autores', 'publicacion_tutores']) assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 1);
  await db.query(up);
  for (const formats of [[], ['exe'], ['pdf', 'pdf']]) await assert.rejects(db.query('UPDATE parametros_publicaciones SET formatos_admitidos=$1', [formats]), { code: '23514' });
  await db.query("UPDATE parametros_publicaciones SET formatos_admitidos=ARRAY['pdf','txt']::text[]");
  await assert.rejects(db.query(down), /La reversión perdería/);
  await db.query('ROLLBACK');
  await db.query("UPDATE parametros_publicaciones SET formatos_admitidos=ARRAY['pdf']::text[]");
  await db.query('UPDATE publicaciones SET adjunto_id=NULL,adjunto_hash=NULL,requiere_copia_biblioteca=false WHERE id=$1', [publication]);
  await assert.rejects(db.query(down), /La reversión perdería/);
  await db.query('ROLLBACK');
  await db.query('UPDATE publicaciones SET adjunto_id=$1,adjunto_hash=$2,requiere_copia_biblioteca=true WHERE id=$3', [file, fileHash, publication]);
  const txt = randomUUID();
  await db.query("INSERT INTO adjuntos(id,nombre,tamano,mime,sha256,almacenamiento_clave,estado,contenido_verificado,analizado_en,creado_por_id) VALUES($1,'tesis.txt',100,'text/plain',$2,$3,'CLEAN',true,now(),$4)", [txt, createHash('sha256').update(txt).digest('hex'), `${txt}.txt`, user]);
  await assert.rejects(db.query(down), /La reversión perdería/);
  await db.query('ROLLBACK');
  // Non-PDF row remains history; verify attachment history cannot be removed.
  await assert.rejects(db.query('DELETE FROM asignaciones_adjuntos WHERE adjunto_id=$1', [file]), { code: '55000' });
  await assert.rejects(db.query('UPDATE asignaciones_adjuntos SET publicacion_id=publicacion_id WHERE adjunto_id=$1', [file]), { code: '55000' });
  await assert.rejects(db.query('TRUNCATE asignaciones_adjuntos'), { code: '55000' });
  await db.query('UPDATE publicaciones SET adjunto_id=NULL,adjunto_hash=NULL,requiere_copia_biblioteca=false WHERE id=$1', [publication]);
  assert.equal((await db.query('SELECT publicacion_id FROM asignaciones_adjuntos WHERE adjunto_id=$1', [file])).rows[0].publicacion_id, publication);
  console.log('PUBLICATION_MANAGEMENT_SMOKE_OK: up/down/up con datos, backfill, formatos/constraints, down protegido e historia inmutable.');
  console.log(`Base desechable conservada: ${database}`);
} finally { await db.query('ROLLBACK'); await db.end(); await admin.end(); }
