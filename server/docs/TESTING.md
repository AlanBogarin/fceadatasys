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
