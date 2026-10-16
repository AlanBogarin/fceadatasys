# Persistencia inicial

Este hito implementa usuarios, sesiones, rotación refresh, recuperación, límites de recuperación y auditoría. Publicaciones, autores, tutores, catálogos, parámetros, adjuntos y FTS se implementarán en sus migraciones posteriores; no existen tablas ficticias que permitan declararlos completos.

PostgreSQL 18 y Prisma 7 con `@prisma/adapter-pg`. El cliente Prisma usa nombres ingleses; las tablas y columnas PostgreSQL se mapean al español en `prisma/schema.prisma`. Todas las fechas son `timestamptz(3)` y la API las serializa UTC.

| Modelo Prisma | Tabla | Contrato |
| --- | --- | --- |
| User | usuarios | UUID, CI única, email/usuario con claves normalizadas únicas, rol, estado, Argon2id, contador y bloqueo |
| Session | sesiones | Usuario FK RESTRICT, creación, última interacción, vencimiento y revocación |
| RefreshToken | tokens_refresh | SHA-256 único, sesión FK RESTRICT, consumo/revocación y vencimiento |
| RecoveryToken | tokens_recuperacion | SHA-256 único, usuario FK RESTRICT, uso único y vencimiento |
| RecoveryRate | limites_recuperacion | Clave por identidad/IP, inicio de ventana y contador; actualización bajo bloqueo transaccional |
| AuditLog | auditoria | Actor/rol, operación/recurso, IP/User-Agent/sesión, estado/detalle y JSON antes/después |

`publicationId` es un UUID reservado en auditoría, sin FK hasta incorporar el modelo de publicaciones. Actor y sesión pueden ser nulos en intentos anónimos y eventos operacionales. No se almacenan contraseñas, tokens ni hashes sensibles en JSON de auditoría. El evento operacional de bootstrap es `USER_BOOTSTRAP`, recurso `usuarios`.

## Preparación y permisos

La aplicación **no** debe usar el usuario propietario/superusuario. El operador crea dos identidades distintas: propietario de migraciones y rol runtime `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` sin pertenencia al propietario. Definir contraseñas con el gestor de secretos o `\password` de psql; no escribirlas en SQL versionado. PostgreSQL debe usar SCRAM y una configuración `pg_hba.conf` restringida; `trust` se reserva para el cluster local efímero de pruebas.

1. Crear base vacía y usuario propietario fuera del proceso de aplicación.
2. Desde `server/`, instalar dependencias y generar el cliente: `npm ci`, `npm run db:generate`.
3. Inyectar `DATABASE_URL` del propietario para `npm run db:migrate`.
4. Con psql como propietario ejecutar `psql -v app_role=fceadatasys_app -f scripts/runtime-grants.sql`. El rol debe existir previamente. Repetir al incorporar tablas nuevas, revisando el alcance de permisos.
5. Cambiar `DATABASE_URL` al rol runtime antes de bootstrap y arranque; retirar credenciales de migraciones del entorno de aplicación.

El rol runtime tiene SELECT/INSERT/UPDATE sobre las cinco tablas operativas de seguridad y SELECT/INSERT sobre auditoría. Tras la ampliación de catálogos recibe también SELECT/INSERT/UPDATE/DELETE sobre `autores`, `tutores`, `catalogos`. No recibe DELETE sobre usuarios/seguridad/auditoría, ni TRUNCATE, DDL ni acceso a `_prisma_migrations`. Las FK conservan el historial; la API inactiva usuarios en lugar de borrarlos. La migración protege `auditoria` mediante triggers contra UPDATE/DELETE/TRUNCATE y revoca permisos públicos. Un superusuario/propietario podría alterar el esquema: restringir esas credenciales operacionalmente es parte del despliegue.

## Persistencia de catálogos

`20261016000000_catalogs` agrega entidades independientes `autores` y `tutores`, y `catalogos` discriminado por enum `tipo_catalogo` para carreras/facultades/filiales/tipos/niveles. Los nombres y campos se conservan en columnas tipadas. IDs UUID generados por Prisma; nombres normalizados y campos identificadores con UNIQUE. Opcionales vacíos se almacenan NULL. La unicidad del catálogo general incluye el tipo; autor y tutor son independientes. CHECK refuerza nombre, CI, ORCID, campos por tipo y correspondencia NULL de claves opcionales. La normalización textual sigue siendo responsabilidad de la API, igual que las identidades de usuarios.

Índices por tipo/estado/nombre/ID soportan filtros y orden; búsqueda por subcadena sobre una clave normalizada persistida, sin FTS de publicaciones. Conteo/página en RepeatableRead; mutaciones en ReadCommitted con locks usuario → sesión → registro, revalidación del actor tras esperar y UNIQUE para altas concurrentes. ReadCommitted es intencional: la inspección de referencias debe ver inserts FK confirmados durante la espera de FOR UPDATE, sin reutilizar un snapshot anterior.

Inactivación y DELETE comprueban FKs entrantes de `pg_catalog` y preservan todo registro referenciado. Identificadores SQL provienen de metadatos PostgreSQL y se citan; valores UUID son parámetros. Se exige SELECT del runtime sobre tablas referenciantes, sin permisos la operación falla cerrada. DELETE mantiene defensa FK RESTRICT; no usar CASCADE en relaciones bibliográficas. El registro de publicaciones ya bloquea/revalida catálogos activos y aplica sus relaciones N:M/FKs, incluidas referencias compuestas por ID/tipo.

## Persistencia del registro de publicaciones

`20261016010000_publication_registration` agrega publicaciones, publicacion_autores, publicacion_tutores, parametros_publicaciones y el registro de adjuntos que consumirá el futuro módulo de archivos. FK al creador preserva identidad; autores/tutores N:M con PK publicación/persona, posición positiva y UNIQUE publicación/posición. Triggers diferidos exigen al menos un autor y tutor al confirmar, también al retirar/mover relaciones. No se crea un flujo de aprobación académica.

Cuatro FKs compuestas hacia `catalogos(id,tipo)` y CHECK de tipos fijos impiden clasificar por un catálogo equivocado. Índices de las FKs y fecha/ID preparados para la consulta futura; esta ampliación no acredita búsqueda FTS. El código visible se deriva de `numero BIGSERIAL UNIQUE` (`INV-` y mínimo cinco dígitos), sin usar conteos; los huecos por rollback son normales. Grants USAGE de esa secuencia, sin permiso de modificarla.

Título/resumen/abstract normalizados en servidor se comparan por SHA-256 con UNIQUE independientes, también cuando están inactivos. Los textos originales se conservan con limpieza de espacios equivalente al client; hashes usan NFKD, eliminación de marcas/puntuación/símbolos y minúsculas españolas. No se indexan directamente resúmenes largos. Adjunto ID y hash son únicos en publicaciones, con FK compuesta al archivo para impedir discrepancias/reutilización; CHECK exige ambos presentes o ambos ausentes. Modalidad externa requiere URL y excluye archivo/copia; modalidad local exige copia si corresponde Biblioteca.

La fila singleton de parámetros inicia con límite 300; CHECK id=1 y límite 1–10000. El alta toma FOR SHARE sobre ella; PATCH Admin toma FOR UPDATE y audita antes/después. El alta bloquea usuario/sesión y catálogos en orden estable, después archivo; usa ReadCommitted y vuelve a comprobar actor/rol/plazos después de esperar. La publicación, joins y log comparten transacción. RN02 consulta publicaciones del usuario bajo el mismo lock de cuenta usado por el registro, para impedir inactivaciones concurrentes que pierdan referencias.

`adjuntos` no es un servicio de almacenamiento/antivirus: guarda metadatos privados y estado de verificación que el procesador futuro debe provisionar. CLEAN exige contenido verificado y análisis fechado; CHECK refuerza PDF/tamaño/nombre/hash. Runtime solo SELECT y UPDATE de la columna estado para poder bloquear filas, sin INSERT ni acceso por HTTP a cambios de estado. El registro no recibe bytes/rutas/hashes del navegador. Publicaciones/N:M solo SELECT/INSERT; parámetros SELECT/UPDATE; auditoría mantiene SELECT/INSERT y protección inmutable. Más detalles en [PUBLICATIONS.md](PUBLICATIONS.md).

`prisma/rollback-publications.sql` revierte únicamente esta ampliación, conservando usuarios/catálogos/auditoría; rechaza publicaciones, adjuntos o parámetros modificados y dependencias posteriores. Requiere mantenimiento/backup y no cambia el historial Prisma. Se validó aplicación/down/reaplicación en una base desechable; no se aplicó a la base institucional.

## Listado, consulta y FTS

`20261016020000_publication_queries` incorpora funciones SQL inmutables de normalización/documento/persona y tres índices GIN de expresión (publicaciones, autores, tutores), además del índice de estado/fecha/número. No crea nuevas entidades ni modifica datos bibliográficos. Los índices GIN se mantienen en SQL versionado, pues Prisma no representa esos índices de expresión en schema.prisma. El índice normal de estado/fecha/número sí está declarado en Prisma. No usar db push ni regenerar esta migración desde el schema descartando su SQL manual.

Normalización UTF-8 NFKD y eliminación de bloques de diacríticos para español/inglés; configs spanish/english/simple explícitas hacen indexable el documento. Las ramas de IDs UNION evitan un OR correlacionado que fuerce recorrer los documentos completos, deduplican participantes y permiten usar índices GIN. No se necesita un servicio externo ni extensión unaccent. Cambiar funciones/diccionarios exige reconstruir sus índices mediante migración.

Filtros son parámetros SQL, con identificadores de columna tomados de un mapa fijo. Código exacto se convierte a bigint sin pasar por Number; fechas de registro usan límites timestamp institucionales para conservar el índice temporal. Conteo, IDs y relaciones comparten RepeatableRead; el detalle también carga sus relaciones en un snapshot. Selects explícitos excluyen datos personales de directorios, credenciales y rutas de almacenamiento; Público ni siquiera consulta las columnas del adjunto.

No se amplían grants de escritura ni se modifica la inmutabilidad de auditoría. `prisma/rollback-publication-queries.sql` retira solo índices/funciones, sin borrar registros; requiere mantenimiento/backup y conserva historia Prisma. Se comprobó aplicación/down/reaplicación con usuarios/catálogos/auditoría intactos en una base desechable. Plan real y medición HTTP documentados en TESTING.md; consulta/búsqueda no acredita el transporte de adjuntos.

Aplicar la migración y repetir grants con el propietario antes de iniciar el runtime. No hay precarga automática ni datos demo: un catálogo vacío devuelve lista vacía. `prisma/rollback-catalogs.sql` revierte solo esta ampliación, preserva usuarios/auditoría y rechaza tablas con datos o dependencias. Requiere mantenimiento y backup; no altera `_prisma_migrations`. Tras un down manual sobre una base rastreada, restaurar un backup coherente o usar una reparación hacia adelante; migrate deploy no reaplica una migración marcada como aplicada.

Las claves `emailKey` y `usernameKey` son NFKC, trim y minúsculas; la API y bootstrap las producen antes de insertar y son los únicos escritores autorizados funcionalmente. La base protege su unicidad, pero no recalcula esas claves: cualquier importación futura deberá reutilizar el mismo normalizador y validar su equivalencia antes de escribir. No sustituirlo por `lower()` de una base con locale diferente sin probar equivalencias Unicode. La CI admite 5–12 dígitos normalizados y es única. Las restricciones UNIQUE de PostgreSQL arbitran carreras. Los cambios que podrían dejar cero administradores activos comparten `pg_advisory_xact_lock(741901)` mediante `$executeRaw` (el retorno PostgreSQL `void` no puede deserializarse con `$queryRaw` del adaptador); login/refresh/reset aplican bloqueos de filas y actualizaciones condicionales para evitar consumo o incrementos dobles.

## Bootstrap

Inyectar `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_CI`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` y `DATABASE_URL`; ejecutar `npm run db:bootstrap`. No hay cuentas ni contraseña predeterminadas. Se usa la misma política de API: nombre hasta 100 caracteres, CI 5–12 dígitos, usuario ASCII 3–40 caracteres, email válido, contraseña 8–128 caracteres con letra y número.

Solo crea el primer usuario en una base vacía. Inserción y evento de auditoría ocurren en una transacción; fallo de auditoría revierte el alta. Una segunda ejecución con identidad idéntica y cuenta administradora activa no modifica contraseña/estado. Una identidad incompatible o base con otras cuentas se rechaza. Retirar las variables `BOOTSTRAP_ADMIN_*` después del alta. El script no imprime secretos, URLs ni objetos de error Prisma.

## Migraciones y recuperación

`prisma/migrations/` es el historial versionado. Usar `prisma migrate deploy` en despliegue; nunca `db push` contra datos institucionales. Tomar y verificar backup antes de cambios de esquema. La migración inicial prepara el schema `public` si falta y crea tipos, tablas, índices, constraints y triggers en una transacción; no depende de extensiones: Prisma genera UUID desde cliente.

`prisma/rollback-initial.sql` permite revertir el primer esquema únicamente en una base desechable o bajo una recuperación autorizada con backup verificado. Destruye datos; no es un procedimiento de operación habitual ni altera automáticamente `_prisma_migrations`. Para producción se restaura el backup o se crea una migración correctiva; para pruebas se recrea una base vacía. No borrar historia de auditoría para limpiar fixtures: ejecutar cada suite en base aislada y descartarla después.

Los tokens consumidos/revocados no se eliminan desde las rutas para conservar detección de reutilización. Queda pendiente definir retención institucional, limpieza operacional y copia/restauración programadas antes del despliegue de producción.

## Validación

`scripts/database-smoke.ts` valida en una base de pruebas ya migrada: permisos runtime, unicidad concurrente, inmutabilidad de auditoría, FK y rollback al fallar la escritura del audit log. Requiere `TEST_DATABASE_URL` runtime y `TEST_DATABASE_OWNER_URL` propietario apuntando a la misma base **de pruebas** y `ALLOW_DATABASE_TESTS=1`. No modifica bases existentes de la instalación PostgreSQL. Ver resultados efectivos en la entrega; la presencia del script no demuestra que haya pasado.

Ejecutar desde `server/` con esas variables inyectadas: `node --import tsx scripts/database-smoke.ts`. Por seguridad el script acepta únicamente host local y nombres `fceadatasys_*test`. Conserva fixtures para inspección y nunca borra auditoría.

Validación realizada el 15/10/2026: PostgreSQL 18.3, Prisma 7.10.0 y rol runtime limitado en cluster efímero con puerto propio. Schema Prisma válido, migración aplicada y estado al día, siete verificaciones del script aprobadas. Bootstrap produjo un usuario/un evento tras dos ejecuciones; al revocar INSERT de auditoría revirtió el alta y conservó cero usuarios/cero eventos. Rollback inicial sobre base desechable produjo cero tablas operativas y la reaplicación restauró el esquema y sus protecciones. Estas pruebas no validan backup institucional, retención ni infraestructura de producción.
