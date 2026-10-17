# Estado actual e historial de implementación

## Estado consolidado — 17/10/2026

Los dominios de autenticación/sesión, usuarios, catálogos, publicaciones, adjuntos/ClamAV, parámetros, reportes y consulta/exportación de auditoría están implementados. H1–H3 están resueltos; falta el transporte HTTP del cliente y su validación completa desde navegador. El cliente ya cuenta con las adaptaciones de servicios/DTO descritas en [ADAPTACIONES-CLIENTE.md](../../client/docs/ADAPTACIONES-CLIENTE.md).

Último cierre integrado: **348 pruebas de servidor** (212 sin servicios y 136 PostgreSQL), **87 de cliente**, builds y tipos correctos. La [nota H1–H3](../../docs/IMPLEMENTACION-H1-H2-H3-2026-10-17.md) y [TESTING.md](TESTING.md) conservan evidencia y límites; este ajuste documental no vuelve a ejecutar las suites. Hay siete migraciones hasta summary_limits; el registro de desarrollo del 16/10 acredita solo las cinco comprobadas entonces.

## Archivo de hitos

Los apartados siguientes conservan el alcance, pendientes y resultados que tenía cada entrega en su fecha. Las afirmaciones de cliente intacto, funciones futuras y conteos menores pertenecen a esos hitos; el estado vigente es el resumen anterior y los contratos API actuales.

### Hito inicial — 15 de octubre de 2026

Este desarrollo se limita a server/. client/ se utilizó únicamente como referencia de lectura. Sus pantallas todavía funcionan con persistencia local: no se conectaron al servidor ni se modificaron para esta entrega.

## Alcance

El primer hito implementa fundamentos Fastify/TypeScript y PostgreSQL/Prisma, autenticación y sesiones centrales, recuperación de contraseña, usuarios/perfil, bootstrap seguro y auditoría transaccional e inmutable. Las rutas y payloads se documentan en API.md; configuración/ejecución en ../README.md; persistencia y operación en DATABASE.md; seguridad en SECURITY.md.

La separación entre servidor e interfaz es intencional. Las pruebas HTTP ejercitan API real mediante Fastify inject y PostgreSQL aislado; no demuestran integración del navegador existente.

## Correspondencia con el frontend consultado

| Acción local observada | Responsabilidad HTTP del hito |
| --- | --- |
| AuthPage/loginUser | Login con credenciales verificadas en servidor, JWT y cookie de refresh |
| useSession | Verificación central, actividad explícita, refresh y logout |
| Recuperación local y botón Continuar | Solicitud genérica y reset con token de servidor enviado por SMTP; sin devolver token por API |
| Usuarios/crear, precargar, editar, buscar y filtrar | Recursos paginados, detalle, alta y PATCH de usuarios |
| Activar/inactivar | PATCH administrativo que conserva identidad e invalida sesiones cuando corresponde |
| Eliminar usuario | Sin endpoint de eliminación física; conservar referencias e historia |
| Perfil | GET/PATCH de identidad propia; campos administrativos no aceptados |
| Contraseña propia/administrativa | Verificación de contraseña actual en cambio propio, revocación y auditoría según contrato |

No se acepta State, actorId, role de sesión, passwordHash, salt ni bitácora construida por el navegador como prueba de identidad o autorización. El rol del payload de alta/edición es un dato administrativo reservado a ADMINISTRADOR, distinto del rol autenticado derivado de la base.

## Pendientes posteriores

- Integración del frontend mediante cliente HTTP y estados de carga/error; permanece fuera del alcance autorizado.
- Catálogos, autores/tutores, parámetros, publicaciones con N:M, consulta de metadatos PUBLICO, búsqueda FTS y sus métricas, reportes y adjuntos/antimalware.
- Consulta/exportación de auditoría exclusivamente Admin. La escritura/protección de auditoría sí forma parte de este hito.
- Al incorporar referencias bibliográficas, ampliar la comprobación de baja de usuarios (RN-02) y restricciones de catálogos; no afirmar cobertura de relaciones que todavía no existen en el esquema.
- Despliegue institucional, SMTP real, calibración de Argon2id, backup/restauración y políticas de retención.

La cola de recuperación conserva el token sin hash únicamente en memoria mientras se entrega por SMTP, para que la latencia del correo no revele si existe una cuenta. El hash y los eventos se persisten. Un reinicio abrupto puede perder una entrega pendiente; revisar SECURITY.md antes de despliegue institucional.

## Evidencia de revisión

Esta evidencia corresponde a la entrega inicial del servidor. Se conserva como registro de ese hito; los resultados del cierre de autenticación/sesión se consignan por separado al final.

- `npm run build`: generación Prisma 7.10.0 y compilación TypeScript correctas.
- `npm test` con ambas URLs de prueba habilitadas: **20 pruebas aprobadas, cero fallos y cero omitidas**. Incluye PostgreSQL real con rol runtime limitado, concurrencia de bloqueo/refresh/reset/último Admin, permisos, DTO, revocación, recuperación y rollback al fallar auditoría.
- Validación de persistencia: **7 comprobaciones aprobadas** sobre PostgreSQL 18.3, incluyendo permisos, UNIQUE concurrente, FK, inmutabilidad UPDATE/DELETE/TRUNCATE y reversión por fallo de auditoría. Bootstrap idempotente y rollback/reaplicación de migración también comprobados en bases desechables.
- `prisma migrate status`: una migración y esquema actualizado en base de pruebas. Las sustituciones de dependencias transitivas también permiten generar cliente y ejecutar Prisma CLI.
- Prueba adicional con `listen()` y fetch por TCP local: salud, disponibilidad PostgreSQL, Problem Details, login, perfil, logout y rechazo inmediato del JWT revocado correctos.
- `npm audit` completo, incluidas dependencias de desarrollo: **cero vulnerabilidades reportadas**. Se corrigieron las dependencias detectadas conservando la política npm de siete días; no se desactivó esa política.
- Comparación SHA-256 de los archivos versionados de client/ antes/después: idénticos. Se corrige el inventario anterior de 50: la cifra comprobada es de 49 archivos rastreados. No se ejecutaron instalaciones, builds ni pruebas dentro de client/ durante esta implementación.
- No se probaron SMTP real, despliegue institucional, archivos, búsqueda FTS ni integración de navegador, que permanecen pendientes.

Las pruebas con PostgreSQL deben habilitarse con las variables documentadas en README.md y SECURITY.md; omitirlas no certifica persistencia. Se utilizaron bases independientes en un cluster local temporal bajo server/.tmp/, sin leer ni modificar la base institucional o credenciales de la raíz. El cluster temporal quedó detenido después de validar, con datos conservados. Los datos de pruebas y artefactos compilados están ignorados por Git.

## Cierre de autenticación y sesión — validación integrada

La ampliación posterior se limita al servidor y completa los contratos necesarios para integrar login, bloqueo, consulta de sesión, actividad, refresh, logout y reautenticación. No modifica la interfaz ni sus servicios locales; el navegador existente todavía necesita un adaptador HTTP. No añade dependencias, tablas ni migraciones para este ciclo.

- `GET /api/v1/auth/session` devuelve usuario/rol vigentes, ID de sesión, creación, última actividad, vencimiento absoluto, plazo de inactividad y hora del servidor. La consulta no renueva actividad ni entrega secretos.
- Los JWT requieren firma HS256, emisor/audiencia configurados y claims `sub`, `sid`, `iat`, `exp`; los dos últimos deben ser números finitos incluso en logout. Solo logout admite la expiración del JWT para identificar una sesión que deba cerrarse.
- Logout permite Bearer verificado o refresh conocido, incluso con sesión vencida/inactiva; es idempotente y elimina la cookie tras la auditoría. Credenciales de sesiones distintas producen `403 SESSION_MISMATCH`, sin cerrar ninguna.
- El cierre por vencimiento/inactividad se persiste bajo bloqueos con revocación de refresh y evento `SESION_FINALIZADA`; el instante/duración efectivos se limitan al plazo de sesión. El rechazo posterior se audita sin duplicar la finalización.
- Login comprueba nuevamente la identidad bajo bloqueo, aplica tres intentos fallidos/cinco minutos y crea un ID nuevo tras autenticar. Conserva las otras sesiones activas y finaliza las de la cuenta que ya vencieron. Reautenticar utiliza el mismo endpoint de login.
- Refresh malformado/desconocido se rechaza y limpia su cookie. Refresh, logout y actividad admiten cuerpo ausente o vacío, rechazando campos adicionales.
- Se corrigió la lectura anticipada del reloj: actividad valida la sesión después de adquirir bloqueos y releerla; logout calcula su cierre en ese mismo punto. Las regresiones avanzan el reloj durante la espera para impedir renovar una sesión vencida o subcontar la duración.

Validación de esta ampliación:

- `npm run build`: generación Prisma 7.10.0 y compilación TypeScript correctas con las fuentes estables.
- `npm run test:typecheck`: correcto.
- `npm run test:unit`: **116 pruebas aprobadas, cero fallos y cero omitidas**, incluidas las regresiones del reloj, claims JWT numéricos finitos y el contrato de consulta de sesión con JWT real, sin PostgreSQL ni SMTP.
- Los **49 archivos rastreados de client/** conservan su comparación SHA-256 con el inicio de esta tarea, según la comprobación del coordinador.
- `npm run test:integration` contra ambas bases de prueba con rol runtime limitado: **25 pruebas aprobadas, cero fallos y cero omitidas**. Incluye 23 subcasos de seguridad, su caso contenedor y la integración de usuarios. Se comprobaron bloqueo exacto, logout concurrente, cierre por cookie/JWT expirado, identidad cambiada durante login, duración efectiva y rollback de actividad, `LOGOUT` y `SESION_FINALIZADA`; las regresiones anteriores de usuarios y recuperación también pasaron.

La validación actual reúne **141 pruebas aprobadas: 116 sin servicios y 25 con PostgreSQL real**. El primer intento de conexión desde el sandbox falló con `EACCES`; la ejecución autorizada posterior resolvió esa restricción del entorno y produjo los resultados anteriores. El error inicial no se atribuye a la API ni se presenta como rechazo automático de la solicitud. Esta evidencia se añade a los registros históricos; no los reemplaza.

Los datos de integración pertenecen a bases locales aisladas. El cluster temporal quedó detenido y sus datos se conservaron bajo `server/.tmp/`: `pg_ctl` confirmó `server stopped` y luego `no server running`. El código de salida 1 de la consulta de estado corresponde al servidor detenido, no a un fallo del cierre.

Límites: el cierre por abandono se detecta de forma diferida al volver a operar o autenticar; no existe un proceso programado que cierre sesiones sin solicitudes. El cliente deberá comunicar interacción real, coordinar refresh entre pestañas, manejar 401 y descartar access tokens locales. Continúan pendientes SMTP/despliegue institucional y los dominios bibliográficos indicados anteriormente. La ampliación de sesión no acredita esos módulos ni una integración de navegador.

## Cierre del mantenimiento de usuarios

La inspección de CU02 y del formulario existente confirmó el rechazo de precargas desactualizadas como comportamiento documentado. La API incorpora ETags fuertes sobre el DTO seguro y exige If-Match en `PATCH /usuarios/:id`, incluidos cambios de estado. GET detalle, POST y PATCH emiten el tag; se documentan 428 por ausencia, 400 por formato no admitido y 412 por conflicto. La comparación se hace bajo bloqueo; no se añade un contador de versión ni se cambia el esquema. CORS permite el encabezado y expone ETag/Location para una integración futura.

También se normaliza la búsqueda con NFKC y se escapan metacaracteres de ILIKE para coincidir con la búsqueda literal de la interfaz. Las revocaciones de sesión/recuperación por rol/estado usan el reloj inyectado. La sesión del actor se comprueba nuevamente después de esperar el bloqueo del destino, cubriendo el cruce de inactividad durante esa espera.

Crear, consultar, editar, filtrar y activar/inactivar conservan las restricciones de rol, RN-01, cuenta propia/último Admin, unicidad, historia y auditoría. Reactivar no restaura sesiones revocadas. No hay DELETE ni reglas bibliográficas ficticias; RN-02 sobre esos vínculos sigue dependiendo de sus modelos. `client/` continúa sin cambios y necesita adaptar la precarga HTTP y los errores antes de conectarse.

Validación final de esta fase: build y tipos correctos, **122 pruebas sin servicios aprobadas** y **34 pruebas PostgreSQL aprobadas: 24 de seguridad y 10 de usuarios**, para **156 aprobadas** en el conjunto vigente, sin fallos ni omitidas pendientes. Las cifras históricas de las fases anteriores se conservan separadas.

La primera ejecución integrada aprobó las unitarias y seguridad, pero encontró tres fixtures de recuperación con `createdAt` del reloj real y `expiresAt` del reloj de pruebas. Se alinearon ambas fechas en los tres fixtures y se repitió únicamente usuarios: nueve subcasos y su contenedor aprobados. No se modificó fuente, esquema ni constraint para resolver esas fechas, ni se afirma que el primer `npm test` completo hubiera aprobado.

La revisión final confirmó `git diff --check`, esquema/dependencias/lockfile intactos y SHA-256 idéntico de los 49 archivos rastreados de `client/`. El cluster aislado quedó detenido en el mismo contexto autorizado, con los datos conservados. Las acciones de mantenimiento de usuarios y sus regresiones quedan validadas en este alcance de servidor; la adaptación del cliente y los futuros modelos bibliográficos conservan su alcance separado.

## Ampliación de perfil y cambio de contraseña

La inspección del perfil y sus requisitos mantuvo `GET/PATCH /me` sin If-Match: solo nombre, email y username son editables, con RN-01 para Público. CI, rol, estado y credenciales permanecen fuera de ese cuerpo. Las restricciones de unicidad y la revalidación del actor se aplican bajo transacción; la auditoría de perfil registra explícitamente el rol vigente releído bajo bloqueo.

Se cerró una brecha de recuperación: cambiar el email normalizado, por perfil o administración, consume los enlaces pendientes en la misma transacción que el cambio y su auditoría. Una representación equivalente del email no los consume. La edición de perfil mantiene contraseña, sesiones y plazos. Un fallo de auditoría revierte también email y consumo; un enlace enviado previamente al correo anterior no puede restablecer después del cambio confirmado.

El cambio administrativo de contraseña revalida sesión/rol después de esperar el bloqueo del destino. El cambio personal conserva el mismo ID y plazos de sesión, revoca las otras y rota el refresh. Su respuesta requiere `credentials:"include"` para aceptar la cookie desde el futuro navegador; reemplazar el access token y coordinar refresh entre pestañas. El access token anterior sigue válido mientras la sesión siga vigente, hasta el vencimiento del token. Cambio administrativo responde 204 sin cookie y conserva la sesión del actor. Ninguna ruta de contraseña exige el ETag de metadatos.

Se añadieron regresiones de componente y una suite PostgreSQL específica de perfil, compartiendo explícitamente la base aislada de seguridad mediante `PROFILE_TEST_DATABASE_URL`; los fixtures usan prefijos únicos y no agregan administradores a la base exclusiva de usuarios. No se añaden dependencias, tablas ni migraciones; `client/` continúa como referencia de lectura y necesita su adaptador HTTP futuro.

Validación final de esta fase: build y tipos correctos con las fuentes estables; **198 pruebas aprobadas: 150 sin servicios y 48 PostgreSQL (31 seguridad, 10 usuarios y 7 perfil)**, cero fallos y cero omitidas. La primera ejecución integrada de esta ampliación pasó sin reparaciones. Se validaron los nuevos cambios concurrentes, refresh/reset, invalidación por correo y rollback real de perfil/contraseñas, además de las regresiones de mantenimiento de usuarios. Las 156 pruebas de la fase previa conservan su registro histórico independiente.

El runner coordinado terminó con `tests_exit=0`, `stop_exit=0` y salida final cero. Confirmó el cluster aislado detenido (`server stopped`, `no server running`) en el mismo contexto autorizado, con datos conservados. No quedan fallos conocidos de este alcance de perfil/contraseñas; SMTP real, despliegue institucional, integración del frontend y los dominios bibliográficos siguen fuera de esta validación.

## Ampliación de los siete catálogos

Se implementaron autores, tutores, carreras, facultades, filiales, tipos y niveles exclusivamente en `server/`. Entidades propias Author/Tutor y CatalogRecord discriminado para las otras cinco clasificaciones; migración `20261016000000_catalogs`, reversión protegida y grants runtime específicos. No se añadieron dependencias ni se modificó `client/`.

API `/api/v1/catalogos/:catalog`: listado paginado, búsqueda normalizada por nombre/campos, filtro de estado, detalle, alta, PATCH parcial de metadatos/estado y eliminación física sin referencias. Permisos equivalentes a las operaciones locales: Admin gestiona todos y elimina; Digitador gestiona autores/tutores. Público consulta clasificaciones activas, sin exponer el directorio personal de autores/tutores. Contrato completo, DTO, campos y errores nuevos en [CATALOGS.md](CATALOGS.md).

Unicidad normalizada incluso en inactivos, con restricciones PostgreSQL para nombres/identificadores y carreras concurrentes. Las mutaciones usan locks y revalidación del actor, inspeccionan FKs reales para impedir inactivación/eliminación referenciada y confirman auditoría en su misma transacción. Un fallo del log revierte también la eliminación. Se conserva cualquier referencia histórica como en el client; no se inventaron tablas bibliográficas. El módulo futuro de publicaciones deberá añadir FKs RESTRICT, relaciones N:M y validación bloqueada de catálogos activos.

Validación vigente: build y tipos correctos; **221 pruebas aprobadas: 161 sin servicios y 60 PostgreSQL (12 catálogos, 31 seguridad, 10 usuarios, 7 perfil)**. La última ejecución completa aprobó unitarias y las tres suites anteriores, pero el nuevo caso de observación de locks de catálogos falló al reutilizar estadísticas PostgreSQL dentro de una transacción. Se refrescó ese snapshot en el fixture y se repitió únicamente catálogos: 12 aprobadas, cero fallos y cero omitidas. Las fuentes del servidor no cambiaron por ese ajuste. No se presenta la primera ejecución completa como aprobada.

También se comprobó alta/reversión/reaplicación de ambas migraciones SQL en una base desechable, con preservación de un usuario y su auditoría y rechazo de rollback con datos o dependencias. Las migraciones se desplegaron con Prisma en las bases locales de pruebas y se aplicaron grants; no se modificó una base institucional. El sandbox bloqueó inicialmente la conexión TCP; la ejecución autorizada permitió validar con el runtime limitado. El cluster temporal quedó detenido y los datos se conservaron. `git diff --check` correcto y `client/` sin diferencias contra HEAD.

Pendientes fuera de este alcance: conectar el frontend, publicaciones/FTS/relaciones bibliográficas, archivos/antimalware, parámetros generales, reportes, consulta/exportación de auditoría y despliegue institucional. La migración y grants deben aplicarse en la base de desarrollo correspondiente antes de usar las nuevas rutas allí.

## Registro de publicaciones

Ampliación limitada a `server/`: `POST /api/v1/publicaciones` para Admin/Digitador registra metadatos de trabajos aprobados externamente, autores/tutores reutilizables N:M ordenados, cuatro clasificaciones tipadas y activas, código secuencial y auditoría transaccional. El frontend conserva su demostración local. Se añadieron esquema/migración/reversión/grants, schemas/rutas de publicaciones, pruebas y [contrato API](PUBLICATIONS.md), sin dependencias nuevas.

Se rechazan duplicados normalizados de título/resumen/abstract/adjunto incluso inactivos; UNIQUE arbitra concurrencia y hashes evitan índices de texto largo. FKs compuestas y CHECK protegen tipos; triggers diferidos exigen autores/tutores al confirmar. El registro y la inactivación de catálogos coordinan locks y referencias reales. RN02 impide inactivar creadores de publicaciones desde la API de usuarios. La auditoría registra identidad/rol revalidados y revierte el alta y sus joins ante fallos.

El límite del resumen es persistido y administrable con `GET/PATCH /api/v1/parametros/publicaciones`: 300 palabras por defecto, comparación inclusiva. Se preserva el mismo conteo del client, incluso ante ligaduras Unicode; la normalización de compatibilidad se usa para hashes, no para expandir palabras durante el conteo.

Modalidad externa funcional y local sin obligación de copia funcional. Local con copia obligatoria requiere UUID de un adjunto previamente verificado, de su actor salvo Admin. Se agregó el registro privado de metadatos/estado, pero carga binaria, almacenamiento y antimalware siguen como operación separada pendiente. Los fixtures de archivos no acreditan esos servicios; no se acepta seguridad declarada por el navegador. No se implementaron consulta/búsqueda/edición/inactivación de publicaciones, reportes ni descarga.

Validación: build y tipos correctos; **243 pruebas aprobadas: 169 sin servicios y 74 PostgreSQL (14 registro de publicaciones, 12 catálogos, 31 seguridad, 10 usuarios, 7 perfil)**. La corrida integrada de esta ampliación pasó completa; después del ajuste final de conteo Unicode se repitieron las 169 sin servicios y las 14 PostgreSQL de publicaciones, también aprobadas. Las otras fuentes no cambiaron por ese ajuste.

También se comprobó aplicación/down/reaplicación de la migración nueva, conservación de usuarios/catálogos/auditoría y rechazo del down con adjuntos o parámetro modificado en una base desechable. Se aplicaron migraciones/grants solo en bases locales aisladas. El sandbox bloqueó la primera conexión TCP; la ejecución autorizada permitió validar con runtime limitado. Cluster temporal detenido, con datos conservados. No se modificó una base institucional ni `client/`.

Para usarlo en desarrollo, aplicar `20261016010000_publication_registration` con propietario y repetir grants; no se inicia ni conecta automáticamente el frontend. SMTP real, despliegue institucional y los módulos expresamente pendientes conservan su alcance separado.

## Listar y consultar publicaciones

Implementados exclusivamente en `server/`: `GET /api/v1/publicaciones` y `GET /api/v1/publicaciones/:id`, con paginación, clasificación/personas/año/modalidad/estado/fechas, búsqueda FTS español/inglés y DTO seguro. Los tres roles consultan activas; Admin también inactivas. Público recibe nombres bibliográficos y hasAttachment, sin datos privados de directorios ni metadatos/rutas del adjunto. Un archivo no verificado/rechazado queda omitido sin perder la consulta bibliográfica. POST añade Location del nuevo detalle.

Conteo, página y relaciones comparten snapshot RepeatableRead; el orden mantiene fecha descendente y número secuencial como desempate. Consultas no renuevan sesión ni generan logs de descarga. Rechazos mantienen auditoría fail-closed. La búsqueda usa funciones SQL inmutables, GIN de documentos/personas y ramas UNION para que la consulta completa use los índices. Los renombrados se reflejan mediante índices de expresión, sin copias manuales de nombres. Contrato y diferencias respecto a las subcadenas del client en [PUBLICATION-QUERIES.md](PUBLICATION-QUERIES.md).

Migración `20261016020000_publication_queries` y reversión protegida de índices/funciones, sin pérdida de datos ni ampliación de grants de escritura. Se comprobaron aplicación/down/reaplicación y conservación de usuarios/catálogos/auditoría en base desechable. Solo se aplicó a bases locales aisladas; `client/` conserva sus archivos y simulación.

Validación final: build y tipos correctos; **259 pruebas aprobadas: 175 sin servicios y 84 PostgreSQL (31 seguridad, 10 usuarios, 7 perfil, 12 catálogos, 14 registro, 10 consulta)**, cero fallos y cero omitidas en la corrida integrada. La suite de consulta prueba DTO, alcance de roles, estado histórico, filtros/fechas, FTS y datos adversarios, snapshot concurrente, ausencia de actividad/descarga implícita y fallo de auditoría en rechazos.

Rendimiento: después de agregar 2000 publicaciones por ejecución, EXPLAIN ANALYZE de la consulta completa usa el GIN sin forzar el plan. Las cinco muestras de la ejecución específica optimizada fueron **32,8 / 15,0 / 14,9 / 14,2 / 13,2 ms**; también pasó el umbral <=1500 ms en la corrida integrada posterior. La base conserva fixtures de ejecuciones anteriores. Esa evidencia local no acredita navegador/red, carga concurrente o volúmenes institucionales no definidos.

Se corrigió un fixture que esperaba vacío global al buscar literalmente "1=1": FTS puede legítimamente coincidir con el lexema numérico 1 de registros previos. El caso quedó limitado a las clasificaciones de su ejecución. Un intento de capturar todo el runner con redirección se interrumpió tras bloquear el arranque en Windows; la repetición sin redirección completó las pruebas y confirmó cluster detenido (`server stopped`, `no server running`). El driver pg emitió una advertencia de deprecación de consultas encoladas, sin fallos funcionales en las versiones instaladas; revisar compatibilidad al actualizar el driver/adapter.

Pendientes: conexión real del client, edición/inactivación, carga/descarga/antimalware, formatos administrables, reportes, consulta/exportación de auditoría y despliegue institucional. Aplicar la nueva migración en desarrollo antes de usar search; no se modificó la base institucional.

## Eliminación física de usuarios sin vínculos — 16/10/2026

Se incorpora CU03 mediante `DELETE /api/v1/usuarios/:id`, exclusivo Admin, con ETag/If-Match obligatorio y 204 sin cuerpo. Protege cuenta propia y último Admin. Comprueba FKs entrantes reales, incluidos futuros dominios, bajo FOR UPDATE; conserva publicaciones, adjuntos, sesiones y auditoría propia incluso históricos. Solo elimina los tokens de recuperación junto con una cuenta sin referencias. Los eventos administrativos de otro actor mantienen resourceId y DTO histórico sin modificarse. `USUARIO_ELIMINADO` y la baja confirman juntos; un fallo de auditoría revierte cuenta y tokens. Contrato y particularidades frente a la simulación documentados en API.md.

ReadCommitted más el lock administrativo compartido con altas/PATCH y el lock del destino permite releer después de esperar y conservar integridad ante FKs concurrentes. No se modificaron esquema, migraciones ni dependencias. Se amplían grants DELETE exclusivamente a usuarios/recuperaciones; repetir `scripts/runtime-grants.sql` con propietario en desarrollo antes de utilizar la ruta. Las bases institucionales no se tocaron. `client/` sigue idéntico a HEAD y desconectado.

Validación final: build y tipos correctos; **267 pruebas aprobadas: 178 sin servicios y 89 PostgreSQL**, cero fallos/omitidas. Incluye 15 de usuarios, con permisos, precarga, UUID/404, cuerpo/query estrictos, cuenta propia, sesiones revocadas, auditoría atribuida, publicación inactiva y adjunto pendiente como dependencias, FK confirmada mientras la baja espera, rollback de cuenta/tokens y dos bajas simultáneas. Se ejecutaron también **7 comprobaciones de persistencia/permisos/inmutabilidad** del smoke actualizado. Se incluyó la suite de usuarios en la comprobación de tipos.

El primer intento integrado detectó una expectativa antigua de DELETE inexistente y un error de serialización al ejecutar dos bajas. Se actualizó el contrato esperado y se cambió únicamente la transacción de baja a ReadCommitted con locks; la repetición completa pasó. El sandbox bloqueó TCP inicialmente, por lo que PostgreSQL se validó en el contexto autorizado. La captura del arranque en Windows dejó runners esperando el árbol del proceso; se corrigió el helper temporal para esperar solo pg_ctl. El runner final terminó con exit 0 y confirmó `server stopped`/`no server running`, conservando los datos aislados.

Límites: no se conectó navegador, no se aplicaron grants de desarrollo/producción y un rollback de código no recupera cuentas borradas; el procedimiento de reversión de permisos y recuperación por backup está documentado en DATABASE.md. Los demás módulos pendientes conservan el alcance anterior.

## Carga y descarga de PDF con ClamAV — 16/10/2026

Implementación exclusiva en server: POST /api/v1/adjuntos multipart (file único), GET /api/v1/adjuntos/:id seguro y GET /api/v1/publicaciones/:id/adjunto. Admin/Digitador; metadata propia para Digitador, descarga de publicaciones activas según rol y rechazo de Público. PDF hasta 10 MiB, nombres seguros, SHA-256 único, scanner confiable, almacenamiento privado y bytes verificados antes de confirmar auditoría/entrega. Revalida sesión tras análisis/locks y acota concurrencia/timeout. Un fallo de carga revierte fila y compensa archivo; archivos sin registro confirmado son inaccesibles. Scanner caído/incompleto no habilita archivos; detecciones persisten REJECTED con auditoría y fuera de circulación. No hay borrado físico automático de historia.

ClamAV 1.5.4 x64 instalado por el usuario, invocado sin shell vía stdin; FreshClam descargó y validó firmas oficiales en server/.local/clamav/database. Se proporciona scripts/update-clamav.ps1 y variables de operación; no hay actualización automática. Se añadió @fastify/multipart 10.1.3, compatible con Fastify 5 y elegible bajo la política npm de siete días. La instalación informó cero vulnerabilidades. No se modificaron esquema/migraciones; los grants añaden INSERT en adjuntos, UPDATE estado/analizado_en y UPDATE activo de publicaciones para locks. Se actualizaron el fixture de permisos anterior y contratos API/seguridad/persistencia.

Validación: build/tipos correctos; **281 casos aprobados: 183 sin servicios, 89 PostgreSQL anteriores y 9 de adjuntos**. Los anteriores pasaron integrados; tras corregir solo fixtures de adjuntos se repitieron sus 9 casos, todos aprobados sin omisiones. Se validaron PDF limpio con firmas oficiales y detección por firma propia inocua con motor real. También pasaron las 7 comprobaciones de permisos/FK/inmutabilidad/rollback. El runner final terminó con exit 0 y confirmó cluster temporal detenido; no se tocó la base institucional ni client/.

Durante la prueba inicial Defender interceptó la muestra estándar EICAR extraída por ClamAV en Temp; la API falló cerrada con 503 y no habilitó el PDF. Se sustituyó por marcador aleatorio/firma propia en copia temporal de las bases, manteniendo Defender activo y sin modificar las firmas oficiales. Las pruebas vigentes no generan EICAR; el fallo inicial y la repetición se conservan como evidencia, sin presentar aquella corrida como aprobada.

Límites documentados en ATTACHMENTS.md: validación PDF básica más antivirus, sin garantía absoluta ni reanálisis programado; FreshClam/ACL/backup requieren operación institucional; filesystem/DB no comparten transacción distribuida y una caída puede dejar huérfanos privados para mantenimiento. Reaplicar runtime-grants.sql en desarrollo antes de usar las rutas. No se conectó el frontend ni se implementaron reportes, edición/inactivación, formatos adicionales o consulta/exportación de auditoría.

## Preparación de PostgreSQL de desarrollo — 16/10/2026

Ante la ausencia de una base/configuración del proyecto, el usuario eligió crear una base local independiente. Se preparó `fceadatasys_dev` en 127.0.0.1:5432, propietario administrativo postgres, y el rol LOGIN `fceadatasys_dev_app` sin superusuario, creación de bases/roles, replicación, bypass RLS ni membresía del propietario. Se aplicaron las cuatro migraciones con la identidad administrativa y runtime-grants.sql al rol limitado. No se modificaron las bases postgres/vanguardia/bdhr ni las bases aisladas de pruebas durante esta preparación.

Se creó server/.env privado e ignorado por Git con URL runtime, contraseña generada y JWT_SECRET aleatorio, sin guardar la contraseña administrativa. Se comprobaron conexión runtime y permisos efectivos: INSERT adjuntos, UPDATE acotado a estado/fecha de análisis, lock de publicación, INSERT auditoría y DELETE de usuarios sin vínculos; sin UPDATE/DELETE/TRUNCATE de auditoría, DELETE de publicaciones/adjuntos, UPDATE de título ni lectura de historial de migraciones. No se crearon cuentas de aplicación, datos demo ni conexión del client. Producción requiere identidades/secretos/configuración independientes; esta preparación no acredita despliegue institucional.

La API cargó server/.env y respondió HTTP 200 `{status:"ready"}` en GET /health/ready mediante Fastify inject con PostgreSQL de desarrollo real y el rol limitado. No se abrió un puerto HTTP ni se conectó el navegador. Git confirmó que server/.env está ignorado y client/ conserva sus archivos sin diferencias.

## Consulta y exportación de reportes PDF/Excel en server — 16/10/2026

Se implementó el reporte bibliográfico de la demo: consulta paginada exclusiva de ADMINISTRADOR, todos los filtros de publicaciones más publicationId, PDF/Excel generados en servidor y 200 vacío sin archivo. Consulta y exportación usan DTO seguro y orden determinista. La exportación exige snapshot del conjunto consultado, captura consistente, límites de 500 registros/2 millones de caracteres/20 MiB/1000 páginas y un cupo por proceso. Se revalidan usuario/rol/sesión después de renderizar y se confirma REPORTE_EXPORTADO antes de entregar; auditoría caída cancela el documento. Contrato completo y nuevos errores en REPORTS.md, enlazado desde API.md.

PDFKit incorpora fuente DejaVu Sans con licencia y diseño institucional A4 con portada/fichas/paginación. ExcelJS produce Resumen, Investigaciones filtrable con fechas tipadas y Textos completos fragmentados sin pérdida. Los ejemplos ficticios y el comando reports:examples reutilizan los generadores reales sin tocar DB. Se añadieron dependencias fijadas y override UUID seguro para ExcelJS; npm audit cero vulnerabilidades. El despliegue conserva assets/fonts/ junto a dist. No se requiere migración ni reaplicar grants para reportes: usa los permisos existentes.

Validación final: build/tipos correctos, **297 pruebas aprobadas en una corrida integrada (187 sin servicios + 110 PostgreSQL)**, cero fallos/omitidas, y **7 verificaciones de persistencia/permisos**. PDF/Excel de ejemplo revisados visualmente y PDF de dist validado. La prueba inicial de reportes detectó un dato CI de fixture inválido y se corrigió únicamente ese fixture. Cluster aislado detenido al terminar, con datos conservados. Client idéntico a HEAD y sin conexión. No se modificó fceadatasys_dev ni se crearon cuentas de aplicación allí.

Esta fase cierra reportes bibliográficos y generación PDF/Excel. Los apartados anteriores describen estados históricos. Permanecen separados la integración del frontend, edición/inactivación de publicaciones, formatos administrables adicionales, consulta/exportación de auditoría y preparación operativa de producción. Las exportaciones masivas/colas distribuidas no pertenecen a esta implementación síncrona acotada.

## Edición/inactivación de publicaciones y formatos — 16/10/2026

Implementados en server: PATCH parcial de publicaciones para Admin/Digitador y PATCH de estado para inactivación exclusiva Admin. GET detalle entrega ETag; ambas mutaciones exigen If-Match y revalidan actor/rol/sesión después de esperar locks. Conservan identidad/código/creación, validan el resultado combinado, orden N:M, referencias activas nuevas, límite vigente y duplicados normalizados incluso históricos. Inactivación conserva datos, archivos y relaciones; Público/Digitador pierden consulta y Digitador pierde descarga, Admin mantiene acceso histórico. No se añade reactivación ni eliminación física.

GET/PATCH de parámetros incluye allowedFormats: PDF predeterminado y TXT UTF-8 opcional, solo habilitable por Admin. Ambos formatos pasan validación de contenido, tamaño, nombres, hash, ClamAV y almacenamiento privado. Formatos sin validador no se habilitan. Deshabilitar afecta nuevas cargas/vínculos, no descargas históricas; carga revalida configuración tras scanner y compensa si cambió. DTO y Content-Type reflejan MIME real.

Quinta migración 20261016030000_publication_management, down protegido y grants runtime actualizados. Asignaciones históricas de adjuntos se rellenan al migrar, se reservan mediante trigger e impiden reutilizar archivos retirados en otra publicación. Reservas/auditoría protegidas contra UPDATE/DELETE/TRUNCATE; no DELETE de publicaciones/adjuntos. UPDATE de publicaciones limitado a campos editables y estado; DELETE de participantes permite reemplazo transaccional. Las mutaciones, reservas y snapshots de auditoría confirman juntos o se revierten.

Validación funcional final: **311 aprobadas en npm test (191 sin servicios + 120 PostgreSQL)**, cero fallos/omitidas. Incluye diez nuevos casos integrados de mantenimiento y cuatro pruebas unitarias, PDF/TXT con ClamAV real y marcador inocuo, concurrencia, rollback, reservas, parámetros y descarga/inactivación. Build/tipos correctos; siete comprobaciones de persistencia/permisos y smoke de aplicación/down/reaplicación con datos/backfill y rechazos protegidos correctos. El primer intento funcional detectó un cambio de texto 412 en usuarios: se conservó su contrato y se repitió todo npm test. Después, el smoke separado detectó tipado ambiguo de un parámetro de fixture SQL; se corrigió solo el fixture y se repitió ese smoke y permisos, con salida cero. No se presenta aquel runner fallido como aprobado.

Cluster de pruebas detenido al finalizar; datos aislados conservados. Bases de desarrollo/institucionales sin cambios y client idéntico a HEAD. Para usar esta versión en desarrollo, aplicar quinta migración con propietario y repetir runtime-grants.sql. Contratos en PUBLICATION-MANAGEMENT.md y documentos relacionados. Consulta/exportación de auditoría explícitamente pospuesta hasta la futura ventana en client; las nuevas operaciones sí escriben auditoría obligatoria. Permanecen pendientes la integración del frontend y la preparación operativa institucional.

## Aplicación de mantenimiento en desarrollo — 16/10/2026

Con autorización explícita del usuario se actualizó únicamente fceadatasys_dev en 127.0.0.1:5432 usando el propietario postgres y contraseña transitoria, sin guardarla en archivos ni cambiar la URL runtime de server/.env. Backup previo custom en server/.local/backups/dev-before-publication-management-2026-10-16T20-24-52-441Z.dump; pg_restore --list comprobó archivo legible y presencia de publicaciones/auditoría. Esto verifica el archivo, no acredita un ensayo de restauración institucional.

Prisma migrate deploy aplicó 20261016030000_publication_management y runtime-grants.sql se reaplicó a fceadatasys_dev_app. Confirmadas cinco migraciones, sin alterar las cuatro previas; backfill consistente. Verificados permisos de edición/estado, reemplazo de participantes, lectura/alta de reservas y modificación de parámetros; sin superusuario, membresía del propietario, modificación de código/creador, DELETE de publicaciones/adjuntos ni UPDATE/DELETE/TRUNCATE de auditoría/reservas.

Lectura Prisma runtime confirmó summaryWordLimit=300 y allowedFormats=[pdf], más acceso a reservas; createApp/Fastify inject respondió 200 ready en /health/ready con PostgreSQL real. Conteos antes/después de usuarios, publicaciones, adjuntos, auditoría y sesiones idénticos, todos cero. No se crearon cuentas, datos demo ni puerto HTTP; client y otras bases intactos. La migración y grants de desarrollo ya no están pendientes. La API sigue requiriendo bootstrap del primer administrador cuando se decida habilitar usuarios.


## Integración del cliente · 17/10/2026

El contrato vigente de auditoría consultable/exportable, listado de adjuntos, confirmación por contraseña, ETags de catálogos/parámetros, tamaño configurable, filtros por nombres y sesión compartida de navegador está en [CLIENT-INTEGRATION.md](CLIENT-INTEGRATION.md). Sustituye los pendientes históricos de esos módulos. El cliente conserva su simulación y no se conecta en este hito.


Validación final del 17/10/2026: **329 pruebas aprobadas (200 sin servicios + 129 PostgreSQL)**, cero fallos, cero omitidas. La corrida completa usa las fuentes definitivas y ClamAV real habilitado. También pasaron build, test:typecheck, git diff --check, 7 comprobaciones de permisos/persistencia/inmutabilidad y scripts/connection-smoke.ts (aplicación/down/up con historia, guardas de reversión, límites y sesión única). El clúster aislado quedó detenido con datos conservados. client/ no tiene diferencias contra HEAD; no se modificaron credenciales ni se migró desarrollo.

Las corridas iniciales detectaron fixtures que tomaban la primera cookie como refresh, expectativas previas de parámetros/versiones, un PDF de volumen idéntico entre ejecuciones y saturación de conexiones al ejecutar todos los archivos en paralelo. Se corrigieron y se repitió el conjunto completo. El runner integrado ahora ejecuta archivos secuencialmente; cada prueba de concurrencia mantiene sus solicitudes paralelas. Se amplió el reintento transaccional para conflictos SQL 40001/40P01 de FOR UPDATE representados por Prisma P2010; nunca reintenta validaciones, unicidad ni errores de auditoría. Las unitarias de dominio aíslan la confirmación con un stub explícito; las integradas envían contraseña real y ETags como un adaptador, y connection.integration.test.ts utiliza directamente la aplicación de producción para comprobar los rechazos y rollback.

Límite conocido: persiste la advertencia de pg sobre consultas encoladas ya documentada en fases anteriores, sin fallos. SMTP/despliegue y conexión del cliente requieren la configuración operativa descrita en CLIENT-INTEGRATION.md.

## Correo de recuperación · 17/10/2026

Se configuró Gmail SMTP con TLS implícito en puerto 465 usando exclusivamente `server/.env`, ignorado por Git. `npm run mail:check` verificó conexión TLS y autenticación reales con resultado correcto; no se enviaron mensajes ni se configuró POP. Los secretos están ausentes de los archivos versionados/versionables.

El transportador incorpora comprobación automática y compartida (cinco minutos disponible, un minuto caído), validación TLS/STARTTLS obligatoria, timeouts acotados, diagnóstico seguro, validación de destinatario aceptado y cierre después de drenar entregas. La plantilla en texto/HTML usa la misma constante de quince minutos que el token. Un destinatario rechazado no degrada SMTP para todos. Contrato público de recuperación/status sin cambios; no se conectó ni modificó el cliente. Operación y límites en [EMAIL.md](EMAIL.md).

Validación: **341 pruebas aprobadas: 210 sin servicios y 131 PostgreSQL**, cero fallos/omitidas, con ClamAV real habilitado; build y test:typecheck correctos. Se añadieron nueve unitarias del transportador, una de configuración y dos integradas para impedir correos si falla auditoría y comprobar el cierre ordenado. Pasaron además las siete comprobaciones de persistencia/permisos y aplicación/down/up de migraciones. El clúster aislado quedó detenido. Se conserva el aviso conocido de pg sobre consultas encoladas.

La verificación real acredita conexión/autenticación, no entrega en bandeja de entrada. La pantalla de recuperación ya interpreta el token; siguen pendientes el transporte HTTP del cliente y el despliegue institucional. La cola de correo permanece en memoria: un cierre abrupto puede perder entregas; no se reenvían mensajes de aceptación incierta ni se persisten tokens crudos.
