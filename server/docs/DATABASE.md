# Persistencia y migraciones

**Actualización del 18/10/2026:** las 22 ventanas del cliente están conectadas y verificadas en integración local. Los [conjuntos de demostración y entrega inicial](INITIAL-DATA.md) usan bases/configuraciones separadas de los fixtures del desarrollador. La entrega inicial contiene solo Admin y los parámetros creados por las migraciones; el historial fechado siguiente conserva sus resultados originales.

Estado consolidado al 17/10/2026: usuarios, sesiones compartidas por navegador, rotación refresh, recuperación, catálogos/personas, publicaciones N:M, parámetros, adjuntos/reservas, FTS y auditoría están implementados. Hay siete migraciones versionadas. La conexión del cliente sigue pendiente; los resultados de pruebas y las actualizaciones locales fechadas más abajo son evidencia de cada fase.

PostgreSQL 18 y Prisma 7 con `@prisma/adapter-pg`. El cliente Prisma usa nombres ingleses; las tablas y columnas PostgreSQL se mapean al español en `prisma/schema.prisma`. Todas las fechas son `timestamptz(3)` y la API las serializa UTC.

| Modelo Prisma | Tabla | Contrato |
| --- | --- | --- |
| User | usuarios | UUID, CI única, email/usuario con claves normalizadas únicas, rol, estado, Argon2id, contador y bloqueo |
| Session | sesiones | Usuario FK RESTRICT, creación, última interacción, vencimiento y revocación |
| RefreshToken | tokens_refresh | SHA-256 único, sesión FK RESTRICT, consumo/revocación y vencimiento |
| RecoveryToken | tokens_recuperacion | SHA-256 único, usuario FK RESTRICT, uso único y vencimiento |
| RecoveryRate | limites_recuperacion | Clave por identidad/IP, inicio de ventana y contador; actualización bajo bloqueo transaccional |
| AuditLog | auditoria | Actor/rol, operación/recurso, IP/User-Agent/sesión, estado/detalle y JSON antes/después |
| Author / Tutor | autores / tutores | Entidades reutilizables, claves normalizadas únicas y estado |
| CatalogRecord | catalogos | Clasificaciones tipadas, unicidad por tipo y estado |
| Publication | publicaciones | Metadatos, FKs tipadas, duplicados únicos, creador, estado y secuencia |
| PublicationAuthor / PublicationTutor | publicacion_autores / publicacion_tutores | N:M, participantes únicos y orden |
| StoredAttachment | adjuntos | Metadatos privados, hash único, verificación y estado de seguridad |
| AttachmentAssignment | asignaciones_adjuntos | Reserva histórica inmutable por archivo/publicación original |
| PublicationSettings | parametros_publicaciones | Singleton: resumen, formatos y tamaño máximo |

`publicationId` es un UUID opcional de contexto en auditoría; el esquema actual no le declara FK a publicaciones. Actor y sesión pueden ser nulos en intentos anónimos y eventos operacionales. No se almacenan contraseñas, tokens ni hashes sensibles en JSON de auditoría. El evento operacional de bootstrap es `USER_BOOTSTRAP`, recurso `usuarios`.

## Preparación y permisos

La aplicación **no** debe usar el usuario propietario/superusuario. El operador crea dos identidades distintas: propietario de migraciones y rol runtime `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` sin pertenencia al propietario. Definir contraseñas con el gestor de secretos o `\password` de psql; no escribirlas en SQL versionado. PostgreSQL debe usar SCRAM y una configuración `pg_hba.conf` restringida; `trust` se reserva para el cluster local efímero de pruebas.

1. Crear base vacía y usuario propietario fuera del proceso de aplicación.
2. Desde `server/`, instalar dependencias y generar el cliente: `npm ci`, `npm run db:generate`.
3. Inyectar `DATABASE_URL` del propietario para `npm run db:migrate`.
4. Con psql como propietario ejecutar `psql -v app_role=fceadatasys_app -f scripts/runtime-grants.sql`. El rol debe existir previamente. Repetir al incorporar tablas nuevas, revisando el alcance de permisos.
5. Cambiar `DATABASE_URL` al rol runtime antes de bootstrap y arranque; retirar credenciales de migraciones del entorno de aplicación.

El rol runtime tiene SELECT/INSERT/UPDATE sobre las cinco tablas operativas de seguridad y SELECT/INSERT sobre auditoría. Tras la ampliación de catálogos recibe también SELECT/INSERT/UPDATE/DELETE sobre `autores`, `tutores`, `catalogos`. Para CU03 recibe DELETE únicamente sobre `usuarios` y `tokens_recuperacion`; las FK RESTRICT conservan las cuentas referenciadas. No recibe DELETE sobre sesiones, refresh, límites ni auditoría, ni TRUNCATE, DDL ni acceso a `_prisma_migrations`. La migración protege `auditoria` mediante triggers contra UPDATE/DELETE/TRUNCATE y revoca permisos públicos. Un superusuario/propietario podría alterar el esquema: restringir esas credenciales operacionalmente es parte del despliegue.

La baja física de usuarios sin vínculos no cambia el esquema ni requiere migración. Repetir `scripts/runtime-grants.sql` con el propietario antes de usarla. Inspecciona FKs entrantes de `pg_catalog`, exige lectura de tablas referenciantes y elimina explícitamente los tokens de recuperación. Preserva auditoría y sesiones históricas. Para revertir permisos, retirar primero la ruta DELETE y ejecutar como propietario `REVOKE DELETE ON public.usuarios, public.tokens_recuperacion FROM <rol_runtime>`. Un rollback de código no reconstruye cuentas eliminadas: recuperar datos requiere backup.

## Persistencia de catálogos

`20261016000000_catalogs` agrega entidades independientes `autores` y `tutores`, y `catalogos` discriminado por enum `tipo_catalogo` para carreras/facultades/filiales/tipos/niveles. Los nombres y campos se conservan en columnas tipadas. IDs UUID generados por Prisma; nombres normalizados y campos identificadores con UNIQUE. Opcionales vacíos se almacenan NULL. La unicidad del catálogo general incluye el tipo; autor y tutor son independientes. CHECK refuerza nombre, CI, ORCID, campos por tipo y correspondencia NULL de claves opcionales. La normalización textual sigue siendo responsabilidad de la API, igual que las identidades de usuarios.

Índices por tipo/estado/nombre/ID soportan filtros y orden; búsqueda por subcadena sobre una clave normalizada persistida, sin FTS de publicaciones. Conteo/página en RepeatableRead; mutaciones en ReadCommitted con locks usuario → sesión → registro, revalidación del actor tras esperar y UNIQUE para altas concurrentes. ReadCommitted es intencional: la inspección de referencias debe ver inserts FK confirmados durante la espera de FOR UPDATE, sin reutilizar un snapshot anterior.

Inactivación y DELETE comprueban FKs entrantes de `pg_catalog`. H1 distingue las referencias de publicaciones: únicamente las activas bloquean inactivar; todas bloquean DELETE. Las referencias de otros dominios siguen bloqueando ambas operaciones hasta definir su regla particular. Identificadores SQL provienen de metadatos PostgreSQL y se citan; valores UUID son parámetros. Se exige SELECT del runtime sobre tablas referenciantes, sin permisos la operación falla cerrada. DELETE mantiene defensa FK RESTRICT; no usar CASCADE en relaciones bibliográficas. El registro de publicaciones ya bloquea/revalida catálogos activos y aplica sus relaciones N:M/FKs, incluidas referencias compuestas por ID/tipo.

H2 consulta la participación histórica de usuarios en los eventos exitosos e inmutables de catálogos, unidos al registro actual por recurso e ID; incluye catálogos inactivos y omite los eliminados. No crea una copia mutable de participantes ni acepta un contador del cliente. Alta/edición/estado de catálogo y su evento confirman atómicamente bajo el lock del actor; la inactivación del usuario toma ese mismo lock. PATCH de usuarios usa ReadCommitted con el mutex administrativo y los locks de actor/destino, conservando reintentos de conflictos: así observa un evento de participación confirmado mientras esperaba, aunque el escritor no haya actualizado la fila del usuario. Una instantánea Serializable fijada antes de esa espera podía omitirlo. Además comprueba publicaciones creadas y adjuntos propios en cualquier estado. Sesiones y otros eventos no bloquean la inactivación por sí solos. El contrato describe las operaciones de la API auditada; las escrituras/importaciones directas por propietario no deben sustituir ese protocolo de trazabilidad. H1–H3 no cambian el esquema ni los grants, por lo que no requieren migración/reversión SQL; retirar el código revierte el comportamiento, conservando toda la historia.

## Persistencia del registro de publicaciones

`20261016010000_publication_registration` agrega publicaciones, publicacion_autores, publicacion_tutores, parametros_publicaciones y el registro de adjuntos utilizado por el módulo de archivos. FK al creador preserva identidad; autores/tutores N:M con PK publicación/persona, posición positiva y UNIQUE publicación/posición. Triggers diferidos exigen al menos un autor y tutor al confirmar, también al retirar/mover relaciones. No se crea un flujo de aprobación académica.

Cuatro FKs compuestas hacia `catalogos(id,tipo)` y CHECK de tipos fijos impiden clasificar por un catálogo equivocado. Índices de las FKs y fecha/ID soportan las consultas. La búsqueda FTS se incorpora en `20261016020000_publication_queries`, descrita más abajo. El código visible se deriva de `numero BIGSERIAL UNIQUE` (`INV-` y mínimo cinco dígitos), sin usar conteos; los huecos por rollback son normales. Grants USAGE de esa secuencia, sin permiso de modificarla.

Título/resumen/abstract normalizados en servidor se comparan por SHA-256 con UNIQUE independientes, también cuando están inactivos. Los textos originales se conservan con limpieza de espacios equivalente al client; hashes usan NFKD, eliminación de marcas/puntuación/símbolos y minúsculas españolas. No se indexan directamente resúmenes largos. Adjunto ID y hash son únicos en publicaciones, con FK compuesta al archivo para impedir discrepancias/reutilización; CHECK exige ambos presentes o ambos ausentes. Modalidad externa requiere URL y excluye archivo/copia; modalidad local exige copia si corresponde Biblioteca.

La fila singleton de parámetros inicia con resumen 300, PDF y tamaño 10 MiB. Las migraciones vigentes exigen id=1, resumen 10–1000 y tamaño 1–25 MiB; el rango inicial 1–10000 fue sustituido por `20261017010000_summary_limits`. El alta toma FOR SHARE sobre ella; PATCH Admin toma FOR UPDATE y audita antes/después. El alta bloquea usuario/sesión y catálogos en orden estable, después archivo; usa ReadCommitted y vuelve a comprobar actor/rol/plazos después de esperar. La publicación, joins y log comparten transacción. RN02 consulta publicaciones del usuario bajo el mismo lock de cuenta usado por el registro, para impedir inactivaciones concurrentes que pierdan referencias.

`adjuntos` guarda metadatos privados y verificación; los bytes viven fuera de PostgreSQL en almacenamiento privado. El módulo de [adjuntos](ATTACHMENTS.md) ejecuta ClamAV y provisiona los registros, sin aceptar estados/rutas/hashes del navegador. CLEAN exige contenido verificado y análisis fechado; CHECK refuerza formatos PDF/TXT, tamaño absoluto de 25 MiB, nombre y hash. Runtime recibe SELECT/INSERT y UPDATE únicamente de estado/analizado_en para cuarentena y locks. Los grants vigentes permiten SELECT/INSERT y UPDATE acotado de publicaciones para edición/inactivación y locks; las relaciones N:M tienen SELECT/INSERT/DELETE para reemplazo transaccional. Las reservas tienen SELECT/INSERT y protección inmutable. Parámetros SELECT/UPDATE; auditoría mantiene SELECT/INSERT y protección inmutable. No se añadió migración para transporte: reaplicar grants y respaldar DB más archivos de forma coherente. Compensación de archivos, huérfanos privados y reversión de permisos documentados en ATTACHMENTS.md.

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

Orden vigente: `20261015000000_security_foundation`, `20261016000000_catalogs`, `20261016010000_publication_registration`, `20261016020000_publication_queries`, `20261016030000_publication_management`, `20261017000000_client_integration` y `20261017010000_summary_limits`. Aplicar todas y luego los grants. Las dos últimas agregan contexto de navegador/contador de confirmación, tamaño configurable y límites de resumen compatibles con el cliente; reversión en orden inverso y guardas en [CLIENT-INTEGRATION.md](CLIENT-INTEGRATION.md). H1–H3 no agregan migraciones.

`prisma/migrations/` es el historial versionado. Usar `prisma migrate deploy` en despliegue; nunca `db push` contra datos institucionales. Tomar y verificar backup antes de cambios de esquema. La migración inicial prepara el schema `public` si falta y crea tipos, tablas, índices, constraints y triggers en una transacción; no depende de extensiones: Prisma genera UUID desde cliente.

`prisma/rollback-initial.sql` permite revertir el primer esquema únicamente en una base desechable o bajo una recuperación autorizada con backup verificado. Destruye datos; no es un procedimiento de operación habitual ni altera automáticamente `_prisma_migrations`. Para producción se restaura el backup o se crea una migración correctiva; para pruebas se recrea una base vacía. No borrar historia de auditoría para limpiar fixtures: ejecutar cada suite en base aislada y descartarla después.

Los tokens consumidos/revocados no se eliminan desde las rutas para conservar detección de reutilización. Queda pendiente definir retención institucional, limpieza operacional y copia/restauración programadas antes del despliegue de producción.

## Validación

`scripts/database-smoke.ts` valida en una base de pruebas ya migrada: permisos runtime, unicidad concurrente, inmutabilidad de auditoría, FK y rollback al fallar la escritura del audit log. Requiere `TEST_DATABASE_URL` runtime y `TEST_DATABASE_OWNER_URL` propietario apuntando a la misma base **de pruebas** y `ALLOW_DATABASE_TESTS=1`. No modifica bases existentes de la instalación PostgreSQL. Ver resultados efectivos en la entrega; la presencia del script no demuestra que haya pasado.

Ejecutar desde `server/` con esas variables inyectadas: `node --import tsx scripts/database-smoke.ts`. Por seguridad el script acepta únicamente host local y nombres `fceadatasys_*test`. Conserva fixtures para inspección y nunca borra auditoría.

Validación realizada el 15/10/2026: PostgreSQL 18.3, Prisma 7.10.0 y rol runtime limitado en cluster efímero con puerto propio. Schema Prisma válido, migración aplicada y estado al día, siete verificaciones del script aprobadas. Bootstrap produjo un usuario/un evento tras dos ejecuciones; al revocar INSERT de auditoría revirtió el alta y conservó cero usuarios/cero eventos. Rollback inicial sobre base desechable produjo cero tablas operativas y la reaplicación restauró el esquema y sus protecciones. Estas pruebas no validan backup institucional, retención ni infraestructura de producción.

## Mantenimiento de publicaciones y formatos

La quinta migración `20261016030000_publication_management` agrega formatos_admitidos (array no vacío/único/subconjunto PDF-TXT, PDF por defecto), amplía CHECK de archivos y crea asignaciones_adjuntos con FKs RESTRICT e índice de publicación. Backfill de vínculos actuales y trigger de reserva en INSERT/UPDATE de adjunto; asignación histórica inmutable mediante trigger UPDATE/DELETE/TRUNCATE. La unicidad de archivo vigente y reserva histórica impide reuso después de reemplazo/retirada. Se conservan publicaciones y archivos al inactivar.

Reaplicar runtime-grants.sql después de migrar: UPDATE acotado de campos editables/estado de publicaciones, DELETE/INSERT de participantes y SELECT/INSERT de reservas; se conservan los límites de auditoría y la prohibición de DELETE de publicaciones/adjuntos. `prisma/rollback-publication-management.sql` revierte sin borrar historia operativa, pero rechaza TXT, formatos configurados distintos de PDF o reservas retiradas que se perderían. Mantenimiento/backup y gestión explícita de historia Prisma según procedimientos anteriores.

Smoke reusable: `ALLOW_DATABASE_TESTS=1`, `PUBLICATIONS_TEST_OWNER_URL` propietario de una base local fceadatasys_*test y `node --import tsx scripts/publication-management-smoke.ts`. Crea una base desechable propia y la conserva; jamás ejecuta down contra la base indicada ni desarrollo. Comprueba up/down/up con publicaciones/archivos/participantes/auditoría conservados, backfill, parámetros inválidos, guardas de reversión e inmutabilidad. La validación de esta fase aplicó migración/grants solo a bases aisladas. Cada instalación requiere verificar explícitamente su historial de migraciones y grants antes de ejecutar el código vigente. El registro local siguiente acredita únicamente las cinco migraciones comprobadas el 16/10; no certifica que desarrollo tenga las siete actuales.

Actualización posterior autorizada, 16/10/2026: quinta migración y grants aplicados a fceadatasys_dev, rol runtime fceadatasys_dev_app. Backup custom previo bajo .local/backups/, índice legible con pg_restore. Confirmadas cinco migraciones, permisos mínimos efectivos, parámetros 300/PDF y readiness HTTP 200 mediante inject con la base real. Conteos operativos antes/después iguales (base vacía); sin bootstrap ni datos demo. Contraseña administrativa transitoria, no guardada en .env. Esta actualización no afecta otras bases ni acredita restauración/despliegue institucional.
# Ampliación de persistencia — 26/10/2026

Aplicar `20261026000000_permissions` y `20261026010000_backups`, y actualizar `scripts/runtime-grants.sql`. `permisos_sistema` contiene una única política JSONB (roles y excepciones por UUID), inicializada con los permisos anteriores; runtime solo puede SELECT/UPDATE. `respaldos` guarda historial y resultados de trabajos; runtime tiene SELECT/INSERT/UPDATE, sin eliminación. La auditoría sigue siendo inmutable.

Los cambios de política y de roles/estados de cuentas usan el bloqueo administrativo 741901, bloquean la cuenta y después la política. Las operaciones de negocio retienen un bloqueo compartido de la política hasta el commit; las revocaciones se serializan con esos commits. El bloqueo de sesión PostgreSQL 741902 excluye copias simultáneas y se libera al cerrar la conexión del proceso. Los SQL de reversión están en `prisma/rollback`; ejecutarlos solo con la aplicación anterior y después de preservar la historia necesaria.
