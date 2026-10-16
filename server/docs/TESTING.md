# Pruebas de regresión del servidor

Las pruebas de server/test/unit se ejecutan sin PostgreSQL, SMTP ni servidor HTTP escuchando en un puerto. Usan funciones reales del servidor y sustituyen únicamente dependencias externas. Las comprobaciones del manejador HTTP emplean Fastify inject en memoria; son pruebas de componente dentro de la suite sin servicios.

## Ejecución habitual

Desde server/:

```powershell
npm run test:unit
npm run test:typecheck
npm run build
```

Ejecutar estos comandos después de cambiar autenticación, usuarios, validaciones, configuración, errores o transacciones. No requieren leer .env ni .env.test. No se agregaron bibliotecas de pruebas: se utiliza node:test, assert y tsx ya instalados.

Opcional: `npm run test:unit:coverage` muestra cobertura V8 de los módulos de src importados, excluyendo el punto de arranque. No se impone un porcentaje artificial ni se presenta esa medición como cobertura de todos los flujos del servidor.

## Comportamientos protegidos

| Área | Regresión que debe detectar |
| --- | --- |
| Identidad y validación | Usuario y autenticación normalizan la misma identidad; un PATCH no acepta campos de privilegios o credenciales fuera de su contrato |
| Reglas de usuarios | Nombre Público inmutable aun cambiando rol; protección de cuenta propia y último Admin sin bloquear cambios permitidos |
| DTO | Respuestas y auditoría reciben una proyección segura que excluye credenciales, tokens, claves normalizadas y contadores internos |
| Configuración | Orígenes exactos, HTTPS/cookies Secure en producción y SMTP coherente; errores no revelan valores secretos |
| Sesiones y roles | Una sesión revocada, inactiva o vencida no habilita otras funciones; el rol vigente procede de persistencia |
| Auditoría | Contexto confiable, anonimato cuando corresponde, ausencia de datos del body/cookie y fallo cerrado sin duplicar rechazos |
| Errores HTTP | Problem Details conserva estructura y códigos; errores internos o fallos de auditoría no filtran detalles sensibles |
| Transacciones | Solo conflictos de serialización se reintentan; duplicados y errores de auditoría se propagan sin repetir efectos |
| Recuperación | Política de contraseña, criptografía y límite concurrente de entregas siguen siendo coherentes |

Cada caso debe partir de datos independientes, incluir resultados esperados y rechazos relevantes, y evitar esperas basadas en tiempo real. Las pruebas no deben sustituir reglas del producto por otra implementación de esas mismas reglas.

## Límites de las pruebas unitarias

Los dobles de persistencia verifican cómo se usa una dependencia y cómo se propagan sus fallos. No demuestran transacciones ACID, claves foráneas, índices, grants, triggers ni concurrencia real PostgreSQL. Tampoco demuestran entrega SMTP o funcionamiento del frontend.

Las pruebas de integración previas se conservan separadas y requieren bases locales desechables configuradas según README.md. Si no se habilitan sus URLs se omiten; un skip no acredita su funcionamiento. No se modifica client/ para validar este servidor.

## Ampliación futura

Al añadir catálogos, publicaciones, archivos y reportes, incorporar casos que ejerciten sus contratos y regresiones con autorización/auditoría. Conservar casos de frontera, flujos permitidos y fallidos. Medir cobertura ayuda a encontrar huecos, pero no sustituye comprobar resultados de negocio ni permite garantizar que nunca habrá regresiones.

## Validación del 15 de octubre de 2026

Resultados históricos de la ampliación inicial de pruebas unitarias, anteriores al cierre de login/logout/sesión descrito a continuación.

- La suite sin servicios creció de seis casos originales a **98 pruebas aprobadas, sin fallos ni omitidas**, incluidos subcasos de permisos y fronteras. Seis casos de Problem Details son de componente en memoria; el resto ejercita funciones unitarias con dependencias aisladas.
- `npm run test:typecheck` aprobó la comprobación estricta de tipos de fuentes y pruebas unitarias.
- `npm run build` terminó correctamente con generación Prisma y compilación TypeScript.
- Las integraciones PostgreSQL anteriores se conservan separadas. No se ejecutaron contra PostgreSQL en esta ampliación de unitarias; su ejecución sigue requiriendo URLs de pruebas explícitas. Se conservaron los doce subcasos de seguridad HTTP.
- Comparación SHA-256 confirmó que client/, server/src/, server/prisma/ y el lockfile mantienen su contenido anterior. Los cambios son pruebas, comandos de ejecución, configuración de tipos de pruebas y documentación bajo server/.

## Regresión del cierre de autenticación y sesión

Esta ampliación agrega el contrato de `GET /api/v1/auth/session` y los casos de cierre/reautenticación, manteniendo las pruebas previas de usuarios, recuperación, autorización y auditoría. Los 98 casos del registro anterior corresponden a su propia entrega y se conservan como evidencia histórica.

| Flujo | Resultado que debe comprobarse |
| --- | --- |
| Consulta de sesión | DTO seguro por rol, fechas UTC y hora del servidor; leer repetidamente no cambia última actividad ni plazos |
| JWT | Firma/emisor/audiencia y claims obligatorios reales; `iat`/`exp` numéricos finitos incluso en logout; expiración no se ignora en consultas ni en operaciones protegidas |
| Login y bloqueo | Tres fallos concurrentes, bloqueo de cinco minutos, reinicio tras éxito y revalidación del username después del bloqueo de fila |
| Reautenticación | Un login correcto crea otro ID; finaliza las sesiones anteriores vencidas y conserva las que siguen activas |
| Logout | Cookie conocida o Bearer firmado permiten cerrar con JWT expirado o sesión inactiva; petición repetida devuelve 204 sin duplicar finalización |
| Conflicto de identidad | Bearer y cookie de distintas sesiones producen 403 sin revocar ninguna ni eliminar la cookie |
| Plazos y concurrencia | Tiempo comprobado después de adquirir los bloqueos; una espera no permite renovar una sesión ya vencida |
| Finalización | Revocación y duración efectiva se persisten junto a un único evento, aun ante solicitudes concurrentes o tardías |
| Fallo de auditoría | Login, actividad y cierre revierten sus mutaciones; no se anuncia éxito ni se limpia una cookie como si el cierre hubiera confirmado |
| Contratos vacíos | Refresh/logout/actividad rechazan campos adicionales; refresh inválido/desconocido limpia su cookie después de auditar el rechazo |

`test/unit/session-contract.test.ts` usa Fastify/JWT reales y persistencia sustituida para comprobar serialización y rechazo de credenciales. No abre puertos ni usa PostgreSQL/SMTP. Los otros dobles unitarios pueden comprobar orden de llamadas y relojes controlados; no prueban bloqueos o rollback reales. La evidencia de concurrencia, consumo/revocación y atomicidad requiere las suites PostgreSQL habilitadas explícitamente en bases aisladas.

La revisión final también debe ejecutar regresiones de usuarios/recuperación existentes y verificar que `client/` conserva sus 49 archivos rastreados. Cambiar las fuentes de sesión en esta fase no altera la evidencia histórica de que permanecieron intactas durante la ampliación anterior, limitada a pruebas.

### Resultados comprobados del cierre de sesión

- `npm run test:unit`: **116 aprobadas, cero fallos y cero omitidas**. Incluye las regresiones que avanzan el reloj durante la adquisición de bloqueos, JWT firmados con claims temporales inválidos, además de usuarios, recuperación, autorización, auditoría y contrato de sesión.
- `npm run test:typecheck`: correcto.
- `npm run build`: correcto, con generación Prisma 7.10.0 y compilación TypeScript.
- El coordinador comprobó que los 49 archivos rastreados de `client/` mantienen su SHA-256 del inicio de esta tarea.
- `npm run test:integration` con ambas URLs PostgreSQL runtime: **25 aprobadas, cero fallos y cero omitidas**. Son 23 subcasos de seguridad, su contenedor y la integración de usuarios. Comprueba bloqueo exacto, logout concurrente e idempotente, cookie/JWT expirado, identidad concurrente de login, expiración efectiva y rollback real de actividad, `LOGOUT` y `SESION_FINALIZADA`, además de usuarios y recuperación existentes.

La fase suma **141 aprobadas: 116 sin servicios y 25 con PostgreSQL real**, junto a build y comprobación de tipos correctos. El intento inicial bajo sandbox devolvió `EACCES` al conectar; se repitió mediante ejecución autorizada y las suites pasaron. Se distingue esa restricción del entorno de un fallo funcional o un rechazo automático. Los resultados anteriores se conservan como evidencia histórica independiente.

El cluster temporal quedó detenido, confirmado mediante `pg_ctl` (`server stopped` y `no server running`); el código 1 de la consulta de estado es el resultado esperado al estar detenido. Se conservaron sus datos bajo `server/.tmp/`. SMTP real, despliegue institucional e integración de navegador siguen fuera de esta evidencia.

## Ampliación del mantenimiento de usuarios

Esta fase conserva la evidencia anterior de autenticación y amplía la protección de precarga de CU02 mediante ETag/If-Match, los filtros literales NFKC y la gestión de estados. `test/unit/users.test.ts` comprueba versiones de metadatos independientes de secretos/contadores, formato obligatorio, CORS para If-Match y ETag y un reloj que cruza el límite de sesión mientras espera el bloqueo del destino. Los componentes HTTP usan Fastify/JWT reales y persistencia sustituida; no acreditan PostgreSQL.

`users.integration.test.ts` conserva su recorrido original y añade subcasos de permisos por rol y endpoint, validación/404, filtros combinados y paginación/vacíos, coincidencias literales de `%`/`_`/`\`, edición permitida/RN-01, precarga stale y dos PATCH concurrentes, unicidad concurrente por cada clave, reactivación/roles y rollback de auditoría para editar/inactivar/activar/asignar rol. Solo prepara los dos administradores reservados; las otras cuentas no se promueven a Admin y los listados/conteos de fixtures usan un prefijo único por ejecución para permitir repetir sin borrar auditoría.

Resultados finales de esta fase:

- Build y comprobación de tipos correctos; no hubo cambios posteriores en las fuentes que requirieran repetirlos.
- **122 pruebas sin servicios aprobadas**, cero fallos y cero omitidas.
- **24 pruebas PostgreSQL de seguridad aprobadas** —23 subcasos y su contenedor— en la primera ejecución integrada.
- La primera ejecución de usuarios encontró tres fixtures de recuperación con fechas incompatibles: `expiresAt` usaba el reloj inyectado y `createdAt` el reloj real de PostgreSQL. Se fijó `createdAt: clock` en esos tres fixtures, conservando fuentes, esquema y constraints.
- Se repitió **solo la integración de usuarios** después de esa corrección: **10 aprobadas —nueve subcasos y su contenedor—, cero fallos y cero omitidas**. Reactivación, roles y rollback de edición/inactivación/activación/asignación de rol quedaron comprobados en PostgreSQL real.

El conjunto vigente suma **156 aprobadas: 122 sin servicios y 34 PostgreSQL (24 seguridad + 10 usuarios)**. Esto combina las ejecuciones indicadas; no significa que el primer `npm test` completo hubiera aprobado. La revisión final confirmó `git diff --check` y SHA-256 idéntico de los 49 archivos rastreados de `client/`; esquema, dependencias y lockfile conservan su contenido. El runner confirmó el cluster aislado detenido en el mismo contexto autorizado, con datos de pruebas conservados.

## Ampliación de perfil y cambio de contraseña

La fase siguiente conserva el registro de 156 pruebas anterior. Añade componentes HTTP de perfil con Fastify/JWT reales y persistencia sustituida: los tres roles, campos prohibidos, normalización, identidad propia, rol revalidado para auditoría, actor vencido/inactivo/revocado después del bloqueo y conservación de sesiones. Estos casos no requieren PostgreSQL ni prueban rollback real.

`test/profile.integration.test.ts` usa `PROFILE_TEST_DATABASE_URL`, que debe apuntar explícitamente a la misma base local aislada de seguridad (`TEST_DATABASE_URL`), nunca a `fceadatasys_users_test`. Sus fixtures `profile.<id>` no interfieren con los administradores reservados de usuarios; conserva cuentas y auditoría, sin requerir una tercera base. Comprueba GET/PATCH por rol, campos de solo lectura/RN-01, unicidad normalizada concurrente, conservación de contraseña/sesiones/plazos, consumo de recuperaciones al cambiar correo, rechazo del enlace antiguo y rollback de perfil/correo/recuperación si falla su auditoría. Una edición personal también vuelve desactualizado el ETag administrativo anterior.

La suite PostgreSQL de seguridad amplía cambio personal/administrativo: contraseña actual y nueva, payload estricto, permisos, rotación de refresh, preservación de la sesión actual y revocación de otras, reutilización estricta, recuperaciones pendientes, cambios concurrentes y rollback. Incluye revalidación del administrador después de bloquear el destino, con reloj que cruza el límite mientras espera. El cambio personal conserva el access token anterior de la misma sesión hasta su vencimiento; las pruebas no prometen una versión de access token inexistente.

El script `test:integration` incluye seguridad, usuarios y perfil. Sin las tres URLs, las suites correspondientes se omiten; ejecutar con URLs ausentes comprueba carga/sintaxis, no persistencia. Antes de habilitar PostgreSQL, los tres archivos de integración cargaron correctamente con sus URLs ausentes: tres suites omitidas, sin presentarlas como integración aprobada.

Resultados finales de esta ampliación:

- `npm run build`: generación Prisma 7.10.0 y compilación correctas con las fuentes estables.
- `npm run test:typecheck`: correcto con los fixtures finales.
- `npm test`, en la primera ejecución integrada de esta fase, sin reparaciones: **150 pruebas sin servicios aprobadas y 48 PostgreSQL aprobadas**, cero fallos y cero omitidas.
- Las 48 pruebas PostgreSQL se reparten en **31 de seguridad (30 subcasos y su contenedor), 10 de usuarios y 7 de perfil (seis subcasos y su contenedor)**. Se comprobaron concurrencia, refresh/reset, rollback de contraseña/perfil/cambio de correo y las regresiones anteriores de usuarios.

La fase reúne **198 pruebas aprobadas**. El runner coordinado confirmó `tests_exit=0`, `stop_exit=0` y salida final cero; PostgreSQL quedó detenido en el mismo contexto autorizado (`server stopped`, `no server running`), con los datos aislados conservados bajo `server/.tmp/`. Estos resultados añaden evidencia a la fase anterior de 156, sin sustituir su historial de corrección de fixtures. SMTP real e integración del navegador continúan fuera de esta evidencia.

## Ampliación de catálogos

`test/unit/catalogs.test.ts` añade 11 pruebas sin servicios: permisos, normalización Unicode/acentos/puntuación, nombres, campos específicos de los siete catálogos, CI/email/ORCID opcionales, límites, cuerpos estrictos, PATCH parcial y filtros.

`test/catalogs.integration.test.ts` requiere `CATALOGS_TEST_DATABASE_URL` runtime y `CATALOGS_TEST_OWNER_URL` propietario sobre la misma base local `fceadatasys_*test`, distinta de usuarios. Sin la primera URL se omite la suite; con ella pero sin propietario válido falla. La API siempre usa runtime limitado; el propietario prepara/retira tablas FK auxiliares y consulta locks, nunca se pasa a createApp. Se conservan cuentas y audit logs; IDs únicos permiten repetir sin borrar historia.

Sus 12 pruebas (11 subcasos y contenedor) comprueban:

- CRUD/estados de los siete catálogos, DTO y auditoría antes/después.
- Permisos por rol y endpoint, anónimo, clasificaciones activas de Público y protección de directorios personales.
- Búsqueda por nombre/campos, normalización, paginación, filtros y resultados vacíos.
- Unicidad concurrente de nombres/identificadores, incluso inactivos; comprobación adicional directa de UNIQUE.
- Payload estricto, claves ajenas, UUID/catálogos inválidos y rechazo de IDs de otro catálogo.
- Referencias FK reales que impiden inactivar/eliminar y se preservan al editar metadatos.
- Una inserción FK concurrente bloquea la mutación; tras confirmar, el estado no se cambia porque el guard relee referencias.
- Revalidación de rol y vencimiento mientras se esperan locks, sin aplicar cambios.
- PATCH concurrentes conservan campos distintos; limpiar opcionales persiste NULL y libera su clave única.
- Fallo de auditoría revierte alta, edición, activación, inactivación y DELETE.
- Privilegios runtime mínimos y preflight CORS de DELETE.

Build y tipos correctos. Conjunto vigente: **221 aprobadas (161 sin servicios + 60 PostgreSQL)**. La última ejecución completa aprobó unitarias, seguridad (31), usuarios (10) y perfil (7), pero el nuevo fixture de observación de locks falló por reutilizar estadísticas dentro de su transacción. Se añadió `pg_stat_clear_snapshot()` a esa observación y se repitió solo catálogos: **12 aprobadas, cero fallos y cero omitidas**, sin cambios en fuentes del server. La cifra conjunta combina esas ejecuciones, no afirma que la ejecución completa fallida pasara.

Antes, la suite detectó que Fastify representa como null el cuerpo ausente de DELETE; se corrigió la validación del endpoint y se comprobó el recorrido completo. No quedan fallos conocidos de este alcance. Migraciones Prisma y grants se aplicaron únicamente a bases aisladas. Un smoke SQL adicional en una base desechable comprobó alta/down/reaplicación, conservación de usuarios/auditoría y rechazo del down con registros o dependencias. La reversión versionada es `prisma/rollback-catalogs.sql`; su validación no borra historial Prisma ni habilita usar down sobre producción sin mantenimiento/backup.

El cluster temporal quedó detenido (`server stopped`, `no server running`); `git diff --check` correcto y `client/` sin diferencias contra HEAD. Publicaciones/N:M/FTS, adjuntos, parámetros, reportes, consulta/exportación de auditoría y conexión de navegador siguen fuera de estas pruebas. Las futuras publicaciones deben implementar las FKs y validación bloqueada de referencias activas documentadas en CATALOGS.md.

## Registro de publicaciones

`test/unit/publications.test.ts` añade ocho pruebas sin servicios de limpieza de textos, hashes normalizados, conteo de palabras (incluidas ligaduras Unicode), año institucional, IDs/arrays, modalidades/URL, confirmación externa, payload estricto y parámetro del resumen.

`test/publications.integration.test.ts` requiere `PUBLICATIONS_TEST_DATABASE_URL` y `PUBLICATIONS_TEST_OWNER_URL` hacia la misma base local `fceadatasys_*test`, exclusiva y distinta de usuarios/catálogos. Sin URL runtime se omite; con ella pero sin propietario válido falla. API siempre con runtime limitado; propietario solo para fixtures, restricciones DB y observación de locks. No se borran audit logs, usuarios o publicaciones entre ejecuciones; IDs únicos y secuencia creciente permiten repetir. Se restablece el límite a 300 al terminar.

14 pruebas (13 subcasos y contenedor) comprueban alta Admin/Digitador, DTO seguro, aprobación externa declarada, orden N:M, rol/actor, texto/año/referencias, límite exacto y configurable con permisos, unicidad normalizada incluso histórica, un conflicto concurrente que fuerza a ambas precomprobaciones a terminar antes del INSERT para ejercitar realmente UNIQUE, modalidades locales/externas y adjuntos CLEAN/PENDING/REJECTED/ajenos/reutilizados. Los archivos son fixtures de metadatos: no se ejecuta un scanner ni se crea/descarga un PDF real.

También comprueban los guards FK de catálogos con relaciones compuestas/N:M reales, RN02 de usuarios creadores, CHECK/FK/cardinalidad diferida/orden, permisos mínimos, códigos después de cinco dígitos, rol/plazo/estado releídos después de esperar, registro frente a inactivación concurrente y rollback de publicación/N:M/uso de adjunto/parámetros si falla auditoría. Estos casos complementan las regresiones anteriores.

Build y tipos correctos. Corrida integrada: **169 sin servicios + 74 PostgreSQL = 243 aprobadas**, cero fallos y cero omitidas. Tras ajustar la limpieza del texto para conservar el conteo del client frente a ligaduras Unicode, se repitieron las 169 sin servicios y las 14 de publicaciones: correctas; las otras fuentes permanecieron iguales. Reparto PostgreSQL: 31 seguridad, 10 usuarios, 7 perfil, 12 catálogos, 14 publicaciones.

Prisma desplegó tres migraciones y grants en bases de pruebas. Smoke SQL en base desechable validó aplicación/down/reaplicación de la nueva migración con conservación de usuarios/catálogos/auditoría; down rechazó adjuntos o límite alterado. `prisma/rollback-publications.sql` queda versionado y no modifica `_prisma_migrations`. Cluster local detenido al terminar, con datos conservados; conexión de navegador y base institucional intactas. Consulta/FTS/edición/inactivación de publicaciones, carga/descarga/antimalware, formatos administrables, reportes y consulta/exportación de auditoría siguen fuera de esta evidencia.

## Listado y consulta de publicaciones

`test/unit/publication-queries.test.ts` añade seis pruebas sin servicios: filtros/paginación tipados, Unicode/UUID, código bigint, fechas reales, permisos de estado y parametrización SQL. `test/publication-queries.integration.test.ts` requiere PUBLICATION_QUERIES_TEST_DATABASE_URL y PUBLICATION_QUERIES_TEST_OWNER_URL hacia una base local exclusiva distinta de las otras suites. Se ejercita siempre la API con runtime limitado; el propietario prepara fixtures y escrituras concurrentes, sin usar datos institucionales ni borrar auditoría.

Diez pruebas (nueve subcasos y contenedor) verifican:

- Los tres roles leen metadatos activos; solo Admin obtiene inactivas; anónimo y flags de ampliación fallan.
- DTO basado en selects seguros, nombres sin CI/email/ORCID, orden N:M y metadatos de archivo condicionados a rol/estado.
- Filtros combinados, orden determinista, páginas/vacíos, código exacto sin pérdida bigint y referencias históricas.
- Rango inclusivo en fechas institucionales, probado en los milisegundos anteriores/posteriores a medianoche.
- FTS española/inglesa, combinación literal bilingüe, acentos/Unicode, nombres renombrados y código; strings adversarios siguen siendo datos.
- Consultas no modifican sesión ni anuncian descarga; rechazos auditados y 503 si el log falla.
- Conteo, IDs y nombres mantienen snapshot frente a una modificación confirmada entre esas lecturas.
- EXPLAIN ANALYZE del predicado completo con ramas UNION usa GIN, sin forzar enable_seqscan; cinco búsquedas HTTP <=1500 ms tras agregar 2000 publicaciones.

Los registros de rendimiento conservan N:M/FKs/cardinalidad; sus hashes sintéticos solo preparan fixtures de volumen, no pasan por la API como datos confiables. Las repeticiones conservan fixtures, por lo que cada ejecución agrega 2000 y no afirma comenzar en una base vacía. El caso de strings adversarios se limita a clasificaciones de la ejecución: "1=1" puede legítimamente buscar el lexema 1 presente en datos anteriores. Las cinco muestras específicas con el predicado optimizado fueron 32,8 / 15,0 / 14,9 / 14,2 / 13,2 ms. La corrida integrada volvió a cumplir el umbral. Son tiempos de Fastify inject + PostgreSQL local, no de navegador/red/producción.

Build y tipos correctos; **259 aprobadas en la corrida integrada: 175 sin servicios + 84 PostgreSQL**, cero fallos/omitidas. PostgreSQL: 31 seguridad, 10 usuarios, 7 perfil, 12 catálogos, 14 registro y 10 consulta. Un smoke adicional comprobó aplicación/down/reaplicación de la cuarta migración, funciones/índices y conservación de usuarios/catálogos/auditoría. La reversión SQL versionada no modifica historia Prisma.

La primera redirección global del runner bloqueó el arranque en Windows; se interrumpió y se completó sin redirección. El cluster quedó detenido en el contexto autorizado y se conservaron los datos. El driver pg emitió una advertencia de deprecación de consultas encoladas; no se cambiaron dependencias y las pruebas pasaron con el runtime instalado. `client/` sin cambios; archivos/antivirus, edición/inactivación, reportes y consulta/exportación de auditoría permanecen fuera de estas pruebas.

## Regresión de eliminación física de usuarios

`users.test.ts` añade protección propia/último Admin y contratos HTTP de If-Match y vencimiento del actor durante la espera para DELETE. `users.integration.test.ts` incorpora permisos por rol, baja con/sin referencias reales, conservación de eventos administrativos, eliminación de recuperaciones, conflicto de versión, rechazo de cuerpo/query extra, FK concurrente y rollback al fallar `USUARIO_ELIMINADO`. El caso de concurrencia confirma una sesión mientras DELETE espera su lock y exige conservar ambas filas; dos bajas simultáneas deben producir exactamente un 204, un 404 y un único evento exitoso.

Requiere `USERS_TEST_DATABASE_URL` runtime y `USERS_TEST_OWNER_URL` propietario hacia la misma base local exclusiva. El propietario prepara adjuntos/publicaciones sin historial de sesión para aislar sus FKs; la API utiliza runtime limitado. No se elimina auditoría para limpiar fixtures. Se incluyó la suite de usuarios en `test:typecheck` y se ajustaron anotaciones previas que esa inclusión expuso.

Resultado final: **178 pruebas sin servicios y 89 PostgreSQL aprobadas**, cero fallos/omitidas; build y tipos correctos. PostgreSQL: 31 seguridad, 15 usuarios, 7 perfil, 12 catálogos, 14 registro y 10 consulta. El smoke actualizado pasó sus 7 comprobaciones, incluidos grants DELETE de usuarios y protección de auditoría. La primera ejecución integrada detectó una expectativa anterior de ruta inexistente y un conflicto Serializable en dos bajas; se corrigieron y se repitió todo el conjunto. El cierre correcto, la limitación TCP del sandbox y los problemas del helper temporal de arranque se registran en IMPLEMENTATION-STATUS.md. El clúster final quedó detenido y `client/` sin cambios ni conexión.

## Carga y descarga de PDF con ClamAV — 16/10/2026

Las pruebas sin servicios suman **183 aprobadas**: formato/tamaño/nombres, respuestas del proceso, fail-closed de scanner ausente, almacenamiento exclusivo, claves seguras y verificación de tamaño/hash, más configuración de concurrencia/firmas. La comprobación de tipos incluye la nueva suite de adjuntos; build y tipos pasaron.

`attachments.integration.test.ts` requiere ATTACHMENTS_TEST_DATABASE_URL apuntando a la base local exclusiva fceadatasys_attachments_test. El resto de suites mantiene sus bases separadas. Prueba multipart real, archivos/persistencia, subida y descarga por rol, metadatos seguros/propiedad, límites, duplicados concurrentes, scanner rechazado/caído, rollback de archivo/fila y rechazo de descarga al fallar auditoría, integridad/ausencia, estado histórico, vencimiento durante el análisis y cupos de concurrencia. Los casos deterministas inyectan scanner; las rutas siempre usan Fastify, PostgreSQL runtime y almacenamiento real.

CLAMAV_TEST_ENABLED=1 habilita el motor real configurado por CLAMAV_TEST_COMMAND y CLAMAV_TEST_DATABASE_DIR. Valida un PDF con firmas oficiales y un rechazo mediante marcador aleatorio inocuo/firma .ndb propia en una copia temporal de las firmas. Se retira esa copia al finalizar y no se modifican las firmas de operación ni Defender. La prueba positiva demuestra la integración del motor y el circuito de rechazo; no acredita detectar todo malware ni sustituye mantener firmas vigentes.

Resultado: **183 sin servicios + 89 PostgreSQL anteriores + 9 de adjuntos = 281 aprobadas**. Los 89 casos anteriores pasaron en las ejecuciones integradas; la última corrección se limitó a fixtures del test de adjuntos y se repitió únicamente esa suite: 9 aprobadas, cero fallos/omitidas. También pasaron las 7 comprobaciones de persistencia/permisos. No se afirma que la primera corrida completa hubiera pasado: inicialmente se ajustó la expectativa de charset de Problem Details y se reemplazó la muestra EICAR, interceptada por Defender al extraerla ClamAV. Ese caso produjo correctamente 503 ANTIMALWARE_UNAVAILABLE sin habilitar el archivo. Las pruebas vigentes no generan EICAR. El runner final terminó con exit 0, PostgreSQL detenido y datos aislados conservados. Client permaneció idéntico a HEAD.

## Reportes y exportaciones en servidor — 16/10/2026

`test/unit/reports.test.ts` valida query estricta/rangos, snapshot estable, PDF real con fuente embebida y textos largos, rechazo de límites, Excel real reabierto con ExcelJS, cadenas como texto literal sin fórmulas, fechas tipadas, autofiltros/paneles y reconstrucción íntegra de textos fragmentados. Las pruebas sin servicios suman **187 aprobadas**.

`test/reports.integration.test.ts` requiere REPORTS_TEST_DATABASE_URL runtime y REPORTS_TEST_OWNER_URL propietario, ambos en la base local exclusiva **fceadatasys_reports_test**. Aplicar las cuatro migraciones existentes y runtime-grants.sql con app_role del runtime. No hay migración/grant nuevo. El test comprueba el nombre exclusivo y el mismo host/base para propietario. No usar fceadatasys_dev ni datos institucionales. Fixtures nuevos por ejecución y auditoría conservada. La API siempre opera con runtime limitado.

Los **12 casos de reportes** (11 subcasos y contenedor) cubren roles/anónimo, rechazos auditados, filtros combinados y días Asunción, paginación, estado histórico, validaciones, 200 vacío sin documento, PDF/Excel reales de todo el conjunto, snapshot desactualizado, error del generador/cupo liberado, límite de archivo, concurrencia, rol y sesión revalidados tras generar, cancelación si falla auditoría, y 501 resultados consultables pero no exportables. El fixture de volumen conserva FKs y mínimo autor/tutor.

Corrida integrada final `npm test`: **187 sin servicios + 110 PostgreSQL = 297 aprobadas**, cero fallos y cero omitidas. PostgreSQL incluye los 98 anteriores y los 12 de reportes. Se habilitó ClamAV real con marcador inocuo, sin EICAR. Pasaron además **7 comprobaciones de persistencia/permisos**, `npm run build`, `npm run test:typecheck`, `git diff --check` y generación PDF desde dist con fuente portable. `npm audit` tras la corrección transitiva UUID informó cero vulnerabilidades. PostgreSQL aislado quedó detenido; desarrollo no se modificó. El primer intento de reportes detectó una CI de fixture demasiado larga; se ajustó el fixture al contrato sin alterar restricciones.

Ejemplos `.local/report-examples/` generados por `npm run reports:examples`, sin acceso DB. PDF de cuatro páginas renderizado con Poppler y revisado íntegramente; pypdf confirmó códigos, acentos, marca ficticia y paginación. Excel reabierto con ExcelJS en las pruebas e importado/renderizado con Artifact Tool para revisar las tres hojas (Investigaciones en dos tramos horizontales); sin errores de fórmulas y textos legibles. Los artefactos de QA permanecen ignorados. La fuente de los ejemplos está versionada en scripts/report-example-data.ts y usa el generador de producción, no un diseño separado.
