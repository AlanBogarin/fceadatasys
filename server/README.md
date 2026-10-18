# Servidor FCEA Datasys

**Actualización 18/10/2026:** el arranque recomendado es el [lanzador de la raíz](../README.md), con perfiles demo/production, web y API reales. El despliegue simulado fue retirado. La configuración local del lanzador es independiente de los archivos manuales descritos debajo.

La [revisión conjunta de preparación para la integración — 17/10/2026](../docs/REVISION-PREPARACION-INTEGRACION-2026-10-17.md) distingue cobertura funcional y trabajo futuro de conexión. Sus tres diferencias de reglas/DTO se corrigieron en la [implementación de H1–H3](../docs/IMPLEMENTACION-H1-H2-H3-2026-10-17.md), sin migraciones ni nuevos grants.

Servidor Fastify/TypeScript, PostgreSQL/Prisma, autenticación, usuarios/perfil, siete catálogos, registro/listado/consulta/edición/inactivación de publicaciones con búsqueda FTS, formatos administrables PDF/TXT con ClamAV y reportes bibliográficos PDF/Excel generados en servidor. Las 22 ventanas del cliente consumen estos endpoints en modo API; el simulador se conserva como modo independiente. Consulta, detalle y exportación de auditoría también están implementados. Contrato HTTP en [docs/API.md](docs/API.md), persistencia/permisos en [docs/DATABASE.md](docs/DATABASE.md).

## Datos por entorno

La [guía de conjuntos iniciales](docs/INITIAL-DATA.md) separa fixtures del desarrollador, demostración UNC legible y producción mínima. Demo: `scripts/prepare-demo.ps1`, `npm run db:init:demo` y `npm run dev:demo`, con base/archivos/configuración propios. Producción: `npm run db:init:production`, un Administrador `admin` / CI `0000000`, correo y contraseña obligatorios configurados localmente, parámetros predeterminados y ningún dato de muestra. Las plantillas `.env.demo.example` y `.env.production.example` no contienen secretos de producción.

## Preparación

Requiere Node.js 24.11+ de la rama 24, npm y PostgreSQL 18 (entorno validado). Desde `server/`:

```powershell
npm ci
Copy-Item .env.example .env
npm run db:generate
```

Configurar `.env` con credenciales propias y un `JWT_SECRET` aleatorio de al menos 32 caracteres. Los valores de ejemplo no sirven como secretos. `.env`, `.env.test`, `.tmp`, node_modules y dist están ignorados; no versionar credenciales. npm conserva la política global `min-release-age=7`; no se desactiva para instalar novedades.

La versión actual requiere las siete migraciones hasta `20261017010000_summary_limits`, no solo las cinco de la preparación histórica de desarrollo.

Crear base vacía y roles separados para migración y aplicación siguiendo [docs/DATABASE.md](docs/DATABASE.md). Inyectar `DATABASE_URL` del propietario para `npm run db:migrate`, aplicar `scripts/runtime-grants.sql` y volver al rol runtime. Las variables ya inyectadas prevalecen sobre `.env`; no ejecutar API con el usuario propietario. No se inicializa ninguna base existente automáticamente.

Antecedente local del 16/10/2026 (no certifica las siete migraciones actuales): en este entorno de desarrollo se preparó `fceadatasys_dev` en 127.0.0.1:5432 con el rol limitado `fceadatasys_dev_app`. El 16/10/2026 se aplicó la quinta migración de mantenimiento y se actualizaron sus grants con el propietario, después de crear un backup custom local y comprobar que pg_restore lee su índice. Se verificaron las cinco migraciones, permisos efectivos, parámetros y readiness 200 usando el rol limitado; base vacía conservada sin crear cuentas/datos demo. `server/.env` conserva su contraseña runtime generada y JWT_SECRET, ignorados por Git; la contraseña administrativa solo se utilizó transitoriamente. La API se inicia desde server/ y permanece independiente del frontend. Otras instalaciones requieren su propia base, identidades, secretos, migraciones y grants; no reutilizar estas credenciales.

Inyectar `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_CI`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD`; ejecutar `npm run db:bootstrap` con el rol runtime. Solo crea la primera cuenta en una base vacía y registra auditoría; no hay credenciales de demostración. Retirar las variables de bootstrap después.

```powershell
npm run build
npm start
# Durante desarrollo:
npm run dev
```

`HOST=127.0.0.1`, `PORT=3000` de forma predeterminada. `/health` comprueba proceso, `/health/ready` conexión PostgreSQL. CORS exige orígenes exactos separados por comas. Producción requiere HTTPS en orígenes/RECOVERY_URL y cookies Secure. `SECURE_COOKIES=false` solo para desarrollo HTTP explícito. El servicio no confía en encabezados de proxy por defecto.

Variables SMTP opcionales: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`. Gmail usa `smtp.gmail.com:465`, `SMTP_SECURE=true` y una contraseña de aplicación en `.env`. Sin SMTP verificado, la recuperación devuelve el mismo mensaje público y no entrega correos; los otros endpoints continúan disponibles. El servicio comprueba SMTP al arrancar, cada cinco minutos mientras está disponible y cada minuto durante una caída. `npm run mail:check` comprueba conexión TLS/autenticación sin enviar correos ni acceder a PostgreSQL. Configuración, límites y diagnóstico en [docs/EMAIL.md](docs/EMAIL.md).

## Login y ciclo de sesión

El backend admite login, consulta de identidad/plazos mediante `GET /api/v1/auth/session`, actividad explícita, refresh rotatorio y logout idempotente. Tres contraseñas incorrectas consecutivas bloquean la cuenta cinco minutos; la respuesta pública conserva el error genérico. Access token de quince minutos, sesión con máximo de siete días e inactividad de diez minutos. Los plazos se comprueban en PostgreSQL; consultar o refrescar no renueva actividad.

Primero inicializar `POST /api/v1/auth/browser` con cookies y origen permitido; el contexto admite una sesión compartida entre pestañas y `GET /auth/session` puede restaurarla mediante refresh. Coordinar las pestañas antes de login/refresh; ver [docs/CLIENT-INTEGRATION.md](docs/CLIENT-INTEGRATION.md).

El adaptador HTTP del cliente guarda el access token solo en memoria, envía Bearer en operaciones protegidas y `credentials:"include"` para transportar el refresh HttpOnly. Login/refresh/logout necesitan origen permitido. El logout puede cerrar con la cookie aun con JWT expirado o sesión inactiva; credenciales que identifican sesiones distintas se rechazan. Reautenticar usa el mismo login y crea una sesión nueva. El contrato completo, incluidos errores y finalización auditada, está en [docs/API.md](docs/API.md).

`client/` selecciona explícitamente modo API o simulador. La demostración nueva usa el modo API y su base propia; la entrega inicial de producción no importa muestras de ninguno de los otros entornos.

## Mantenimiento de usuarios

Todas las rutas PATCH/DELETE requieren `X-Confirmation-Password`, contraseña actual del actor en Base64 de UTF-8, además del ETag cuando corresponda. Solo `PATCH /me/password` usa su campo `currentPassword` en lugar de ese encabezado. Catálogos y parámetros también exigen If-Match; tres errores de confirmación revocan la sesión compartida.

ADMINISTRADOR puede crear, consultar, buscar/filtrar, editar y activar/inactivar usuarios. El listado es paginado y combina texto, rol y estado. El texto se normaliza NFKC y busca subcadenas literales; no interpreta `%`, `_` o `\` como patrones. La inactivación conserva datos e invalida sesiones; reactivar permite un login nuevo y conserva la historia.

Antes de editar o alternar estado, consultar `GET /api/v1/usuarios/:id` y conservar su encabezado `ETag`. `PATCH /api/v1/usuarios/:id` exige ese tag fuerte en `If-Match`: sin precarga responde 428, con formato inválido 400 y con datos cambiados desde la consulta 412. No repetir una modificación conflictiva sin revisión. La API expone ETag/Location mediante CORS para el adaptador futuro. El DTO no añade campos de versión ni credenciales; los cambios internos de autenticación no alteran el tag de metadatos. Detalles en [docs/API.md](docs/API.md).

Nombre Público de solo lectura, protección de cuenta propia/último Admin, unicidad y cambios con auditoría se verifican en servidor. DELETE de usuarios exige If-Match y conserva cuentas con referencias bibliográficas, sesiones o auditoría histórica.

## Perfil y contraseña

Cada rol consulta su identidad mediante `GET /api/v1/me` y modifica únicamente nombre, correo y username con PATCH, sin If-Match. CI, rol, estado y credenciales no se aceptan en ese cuerpo; el nombre Público conserva su restricción. Un cambio efectivo de correo consume los enlaces de recuperación pendientes en la misma transacción, tanto desde perfil como desde administración. Correo equivalente normalizado no los consume. Editar perfil mantiene contraseña, sesiones y plazos; la auditoría usa el rol revalidado.

`PATCH /api/v1/me/password` verifica la contraseña actual y devuelve un token nuevo y una cookie refresh rotada. Usar Bearer y `credentials:"include"`, reemplazar el access token en memoria y coordinar esta operación con refresh entre pestañas. Conserva el mismo ID/plazos de sesión, revoca otras sesiones y los refresh anteriores; el access token anterior sigue válido mientras la sesión siga vigente, hasta el vencimiento del token. `PATCH /api/v1/usuarios/:id/password` exige Admin, rechaza la propia cuenta, revoca las sesiones del destino y responde 204 sin cookie; conserva la sesión del actor. Estas rutas no usan If-Match. Detalles y errores en [docs/API.md](docs/API.md).

## Validación

Cierre integrado H1–H3 del 17/10/2026: **348 pruebas aprobadas** (212 sin servicios y 136 PostgreSQL), ClamAV real habilitado para su suite, build y tipos correctos; cliente: **87 pruebas** y build correctos. Evidencia y límites en [docs/TESTING.md](docs/TESTING.md). Los conteos menores fechados que aparecen más abajo pertenecen a hitos anteriores.

La ampliación de catálogos requiere aplicar `20261016000000_catalogs` con `npm run db:migrate` usando el propietario y volver a ejecutar `scripts/runtime-grants.sql`. El runtime recibe DELETE exclusivamente sobre autores/tutores/catálogos, manteniendo la auditoría inmutable y la inactivación de usuarios.

Rutas `/api/v1/catalogos/{autores|tutores|carreras|facultades|filiales|tipos|niveles}` con listado paginado/búsqueda/filtro, detalle, alta, PATCH de metadatos/estado y DELETE sin referencias. Admin gestiona todos; Digitador gestiona autores/tutores y consulta los demás; Público consulta solo clasificaciones activas. Usar `active=true` en los selectores de nuevas cargas. Todos los cambios se auditan transaccionalmente. Ver [contrato de catálogos](docs/CATALOGS.md).

`POST /api/v1/publicaciones` registra trabajos ya aprobados para Admin/Digitador, con autores/tutores N:M ordenados, referencias activas y tipadas, duplicados normalizados, código secuencial y auditoría atómica. `GET/PATCH /api/v1/parametros/publicaciones` consulta el límite de resumen y permite a Admin cambiarlo (300 palabras por defecto). Aplicar `20261016010000_publication_registration` y repetir grants antes de usarlo. Ver [contrato de registro](docs/PUBLICATIONS.md).

Admite enlaces externos y trabajos locales sin obligación de copia; los locales que requieren copia vinculan un adjunto previamente verificado mediante `attachmentId`. Cargar primero con `POST /api/v1/adjuntos` (multipart, campo file): el servidor valida el formato habilitado (PDF/TXT), calcula hash y ejecuta ClamAV instalado antes de confirmar archivo y auditoría. El registro bibliográfico no acepta bytes, hashes ni estados del navegador. Descargar mediante `GET /api/v1/publicaciones/:id/adjunto`, solo Admin/Digitador y con auditoría previa. Contrato completo en [ATTACHMENTS.md](docs/ATTACHMENTS.md).

Desde server/, preparar firmas oficiales con `./scripts/update-clamav.ps1` en Windows (FreshClam instalado). Las variables de .env.example apuntan a `.local/clamav/database` y almacenamiento privado `.local/attachments`; esos datos están ignorados por Git. Configurar CLAMAV_COMMAND según plataforma y arquitectura. Mantener las firmas actualizadas periódicamente: sin firmas vigentes o scanner operativo, la carga falla cerrada. No requiere clamd. Reaplicar `scripts/runtime-grants.sql` con el propietario para habilitar los permisos del nuevo módulo; no cambia el esquema ni conecta client/.

`GET /api/v1/publicaciones` y `GET /api/v1/publicaciones/:id` permiten consultar metadatos con sesión vigente. Incluyen paginación, filtros de clasificación/personas/año/modalidad/fechas, búsqueda FTS español/inglés y DTO seguro. Admin puede consultar inactivas; Digitador/Público solo activas. Público no recibe metadatos del adjunto ni URLs de descarga. Aplicar `20261016020000_publication_queries` para funciones/índices FTS; ver [contrato de listado y consulta](docs/PUBLICATION-QUERIES.md).

```powershell
npm run build
npm run test:typecheck
npm run test:unit
npm test
```

`test:unit` ejecuta `test/unit/` sin PostgreSQL, servidor HTTP escuchando, SMTP ni lectura de `.env`/`.env.test`. Cubre reglas de usuarios, esquemas/DTO, configuración inyectada, reintentos transaccionales y seguridad/auditoría. Los casos de Problem Details y contrato de consulta de sesión usan Fastify `inject` y un stub de persistencia: son pruebas de componente en memoria, sin DB ni red; el contrato de sesión usa el verificador JWT real. Los reintentos usan errores Prisma reales y transacciones simuladas; no prueban aislamiento PostgreSQL.

`test:typecheck` comprueba tipos de fuentes, tests unitarios y las suites de integración de catálogos/registro/consulta de publicaciones sin emitir archivos. `test:unit:coverage` añade cobertura V8 experimental de Node 24, sin dependencias adicionales ni umbral artificial. El reporte incluye módulos importados: una cobertura baja en handlers/SMTP no implica que las unitarias validen sus flujos completos, que corresponden a integración. La matriz de regresión y límites están en [docs/TESTING.md](docs/TESTING.md).

`npm test` ejecuta unitarias y luego `test:integration`. Las suites de integración se omiten cuando no se inyecta su URL; no confundir un skip con una integración aprobada. `test:integration` permite ejecutarlas sin repetir unitarias y carga `.env.test` si existe. Preparar bases locales separadas, migradas y con rol runtime limitado, cuyos nombres coincidan con `fceadatasys_*test`:

```powershell
$env:USERS_TEST_DATABASE_URL='postgresql://ROL_RUNTIME@127.0.0.1:PUERTO/fceadatasys_users_test'
$env:USERS_TEST_OWNER_URL='postgresql://ROL_PROPIETARIO@127.0.0.1:PUERTO/fceadatasys_users_test'
$env:TEST_DATABASE_URL='postgresql://ROL_RUNTIME@127.0.0.1:PUERTO/fceadatasys_security_test'
$env:PROFILE_TEST_DATABASE_URL=$env:TEST_DATABASE_URL
$env:CATALOGS_TEST_DATABASE_URL='postgresql://ROL_RUNTIME@127.0.0.1:PUERTO/fceadatasys_catalogs_test'
$env:CATALOGS_TEST_OWNER_URL='postgresql://ROL_PROPIETARIO@127.0.0.1:PUERTO/fceadatasys_catalogs_test'
$env:PUBLICATIONS_TEST_DATABASE_URL='postgresql://ROL_RUNTIME@127.0.0.1:PUERTO/fceadatasys_publications_test'
$env:PUBLICATIONS_TEST_OWNER_URL='postgresql://ROL_PROPIETARIO@127.0.0.1:PUERTO/fceadatasys_publications_test'
$env:PUBLICATION_QUERIES_TEST_DATABASE_URL='postgresql://ROL_RUNTIME@127.0.0.1:PUERTO/fceadatasys_publication_queries_test'
$env:PUBLICATION_QUERIES_TEST_OWNER_URL='postgresql://ROL_PROPIETARIO@127.0.0.1:PUERTO/fceadatasys_publication_queries_test'
$env:ATTACHMENTS_TEST_DATABASE_URL='postgresql://ROL_RUNTIME@127.0.0.1:PUERTO/fceadatasys_attachments_test'
$env:REPORTS_TEST_DATABASE_URL='postgresql://ROL_RUNTIME@127.0.0.1:PUERTO/fceadatasys_reports_test'
$env:REPORTS_TEST_OWNER_URL='postgresql://ROL_PROPIETARIO@127.0.0.1:PUERTO/fceadatasys_reports_test'
$env:CONNECTION_TEST_DATABASE_URL='postgresql://ROL_RUNTIME@127.0.0.1:PUERTO/fceadatasys_connection_test'
$env:CLAMAV_TEST_ENABLED='1'
$env:CLAMAV_TEST_COMMAND='C:\Program Files\ClamAV\clamscan.exe'
$env:CLAMAV_TEST_DATABASE_DIR='.local/clamav/database'
npm run test:integration
```

La suite usuarios reserva las identidades `fixture.admin.a` y `fixture.admin.b` dentro de su base exclusiva, las reactiva al preparar cada ejecución y verifica que no existan otros administradores. Requiere también `USERS_TEST_OWNER_URL` hacia esa misma base para preparar referencias bibliográficas y observar bloqueos de la baja física; la API sigue usando exclusivamente el runtime limitado. Conserva fixtures y auditoría. Valida permisos, DTO, unicidad, RN-01, revocación, concurrencia y rollback. DELETE permite cuentas sin vínculos, exige If-Match y conserva las referenciadas, incluso por sesiones o auditoría histórica.

Catálogos requiere ambas URLs, runtime y propietario, hacia la misma base local de pruebas distinta de usuarios. El propietario se usa únicamente para fixtures FK y observación de locks; la API siempre recibe el runtime limitado. La suite retira sus tablas auxiliares y conserva las cuentas y audit logs. No ejecutar contra una base institucional.

Publicaciones también requiere ambas URLs en una base exclusiva, distinta de usuarios/catálogos. Los fixtures de adjuntos son metadatos preparados por el propietario para comprobar autorización, estado y hash; no implican carga binaria ni antimalware. Todas las rutas se ejercitan con runtime limitado. La suite conserva los registros y la auditoría y restablece el límite de resumen al finalizar.

Consulta de publicaciones usa otra base aislada con sus dos URLs, para no interferir con conteos/fixtures de registro. Incluye snapshot concurrente, FTS con EXPLAIN ANALYZE de la consulta real y cinco muestras HTTP <=1,5 segundos tras agregar 2000 registros por ejecución. Conserva fixtures y audit logs; los tiempos locales no acreditan navegador/red o carga institucional.

Perfil comparte explícitamente la base de seguridad mediante `PROFILE_TEST_DATABASE_URL`, con prefijos únicos `profile.<id>`. No necesita una tercera base ni debe apuntar a la base exclusiva de usuarios. Su suite comprueba edición por rol, unicidad concurrente, preservación de sesión, invalidación de recuperación y rollback real; seguridad cubre los cambios personal/administrativo de contraseña y sus carreras.

Validación histórica de la fase de perfil/contraseñas: build/tipos correctos y **198 pruebas aprobadas: 150 sin servicios y 48 PostgreSQL (31 seguridad, 10 usuarios y 7 perfil)**, cero fallos y cero omitidas. La primera ejecución integrada de esta fase pasó sin reparaciones; el cluster aislado quedó detenido, con datos conservados.

El cierre anterior de usuarios conserva su evidencia histórica de 156 aprobadas: allí se corrigieron fechas de tres fixtures y se repitió solo usuarios, sin afirmar que el primer `npm test` completo hubiera aprobado. Los 49 archivos rastreados de `client/` conservaron su SHA-256 en aquella revisión. Evidencia y límites por fase en [docs/TESTING.md](docs/TESTING.md).

Pruebas de DB/roles, migración y recuperación del esquema se describen en DATABASE.md. La base temporal del desarrollo se crea aparte bajo `.tmp/`; no es parte del despliegue ni una base institucional.

## Dependencias y alcance

Prisma 7.10, Fastify 5, Zod 4/type provider 6, pg/adapter-pg, Argon2id y JWT. Lockfile versionado para `npm ci`. Se fijan overrides de `deepmerge-ts=8.0.2` y `mysql2=3.24.5` por vulnerabilidades transitivas de Prisma; `nodemailer=10.0.16` es una versión corregida elegible bajo la política temporal npm. Validar generación/migración/build/pruebas al actualizar Prisma u overrides.

`GET /api/v1/status` permite al Administrador consultar disponibilidad SMTP sin revelar configuración. Pendientes de operación: validación del despliegue institucional, retención de tokens/logs, backups operacionales y alertas externas. La comprobación SMTP se recupera automáticamente; no existe entrega durable de correos (ver EMAIL.md). Los siete catálogos, registro N:M/FKs, listado/consulta, búsqueda FTS y carga/descarga PDF/TXT con ClamAV están implementados. Adjuntos requiere su base exclusiva de pruebas y CLAMAV_TEST_ENABLED=1 para validar el motor real; la prueba positiva usa una firma propia inocua en una copia temporal de las firmas oficiales, sin modificar Defender ni generar EICAR.

## Reportes PDF/Excel

ADMINISTRADOR consulta `/api/v1/reportes/publicaciones` y exporta `/api/v1/reportes/publicaciones/exportar` con los mismos filtros, `format=pdf|xlsx` y el snapshot recibido. Generación en server, control de versión de resultados, auditoría previa a entrega y 200 JSON sin archivo si está vacío. Hasta 500 registros por exportación. Contrato y errores en [docs/REPORTS.md](docs/REPORTS.md).

`npm run reports:examples` genera PDF y Excel de muestra con datos ficticios en `.local/report-examples/`, sin tocar PostgreSQL ni conectar el frontend. El despliegue debe conservar `assets/fonts/` junto a dist y dependencias. No se requieren migraciones/grants adicionales para esta ampliación.

## Edición, inactivación y formatos admitidos

Admin/Digitador editan con `PATCH /api/v1/publicaciones/:id`; Admin inactiva con `PATCH /api/v1/publicaciones/:id/estado` y `{"active":false}`. Ambas rutas requieren el ETag del detalle en If-Match. Conservan historia, participantes y reservas de archivos retirados; rechazos y mutaciones tienen auditoría transaccional. `GET/PATCH /api/v1/parametros/publicaciones` admite límite de resumen y `allowedFormats`: PDF inicial, TXT UTF-8 opcional, ambos con ClamAV. No se aceptan formatos sin validador implementado. Contrato completo: [docs/PUBLICATION-MANAGEMENT.md](docs/PUBLICATION-MANAGEMENT.md).

Aplicar `20261016030000_publication_management` con propietario, repetir runtime-grants.sql y regenerar/compilar. Reversión protegida en prisma/rollback-publication-management.sql. Consulta, detalle y exportación PDF/Excel de auditoría ya disponibles exclusivamente para Admin. El listado de adjuntos incluye reservas históricas; los parámetros incluyen resumen 10–1000, formatos y tamaño 1–25 MiB (300/PDF/10 iniciales). Contratos y migraciones posteriores en [docs/CLIENT-INTEGRATION.md](docs/CLIENT-INTEGRATION.md).


## Integración del cliente · 17/10/2026

El contrato vigente de auditoría consultable/exportable, listado de adjuntos, confirmación por contraseña, ETags de catálogos/parámetros, tamaño configurable, filtros por nombres y sesión compartida de navegador está en [CLIENT-INTEGRATION.md](docs/CLIENT-INTEGRATION.md). Sustituye los pendientes históricos de esos módulos. El cliente conserva su simulación y no se conecta en este hito.
