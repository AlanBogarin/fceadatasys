# API inicial — autenticación, usuarios y perfil

Contrato implementado en este hito. Base `/api/v1`; JSON UTF-8; UUID; fechas ISO 8601 UTC. Los cuerpos de datos y filtros definidos rechazan propiedades desconocidas. Refresh, logout y actividad admiten cuerpo ausente o `{}`, sin campos adicionales. El cliente actual sigue usando almacenamiento local: este trabajo no cambia `client/` ni conecta sus pantallas.

## Identidad y transporte

Roles canónicos: `ADMINISTRADOR`, `DIGITADOR`, `PUBLICO`. Actor, rol y sesión se obtienen exclusivamente del JWT validado y PostgreSQL; nunca se acepta `actorId`, hash ni bitácora del navegador.

DTO User, usado por autenticación, usuarios y perfil:

```json
{"id":"d0347d10-079a-423d-a191-bf55608f1e38","name":"Persona","ci":"1234567","email":"persona@example.org","username":"persona","role":"PUBLICO","active":true,"createdAt":"2026-10-15T00:00:00.000Z"}
```

No se incluyen hashes, sal, contadores de intentos, bloqueos, tokens de recuperación ni claves normalizadas. Las respuestas llevan `Cache-Control: no-store`.

El acceso usa `Authorization: Bearer <accessToken>`, con vigencia 900 segundos, algoritmo HS256 y emisor/audiencia configurados. Los claims `sub`, `sid`, `iat` y `exp` son obligatorios; usuario y sesión deben ser UUID válidos, e `iat`/`exp` deben ser números finitos, también al cerrar sesión con un JWT expirado. Esta validación de tipos no añade una política de antigüedad máxima distinta de los plazos documentados. Guardarlo solo en memoria al integrar el cliente. Cada operación protegida comprueba cuenta activa, rol actual y sesión no revocada/vencida. La sesión tiene vencimiento absoluto de siete días e inactividad de diez minutos. Consultas y refresh no reinician inactividad; el cliente comunica interacción mediante `POST /auth/activity`. No debe enviar actividad desde un temporizador sin interacción humana.

El refresh aleatorio de 64 bytes se transporta exclusivamente en cookie `refresh_token`, `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, `Secure` en producción. PostgreSQL conserva solo SHA-256. Login, refresh y logout requieren `Origin` permitido o `Referer` cuyo origen sea permitido. CORS solo devuelve autorización a los orígenes configurados. Solicitudes de herramientas HTTP deben enviar el origen permitido.

## Autenticación

| Método/ruta | Cuerpo/autorización | Respuesta |
| --- | --- | --- |
| POST `/auth/login` | `{username,password}`, origen permitido | 200, token pair + User; Set-Cookie refresh |
| POST `/auth/refresh` | Cookie refresh y origen permitido | 200, nuevo token pair + User; Set-Cookie rotada |
| GET `/auth/session` | Bearer vigente | 200, identidad y plazos de la sesión, sin renovar actividad |
| POST `/auth/logout` | Origen permitido; Bearer firmado o cookie refresh conocida | 204, cierre idempotente y cookie expirada |
| POST `/auth/activity` | Bearer | 204, actualiza interacción si sesión sigue vigente |
| POST `/auth/recover-password` | `{email}` | 200, `{message}` genérico |
| POST `/auth/reset-password` | `{token,newPassword}` | 204, consumo único y revocación total |
| PATCH `/me/password` | Bearer; `{currentPassword,newPassword}` | 200, nuevo token pair + User |
| PATCH `/usuarios/:id/password` | Admin; `{newPassword}` | 204, revoca sesiones de cuenta afectada |

Token pair: `{accessToken,tokenType:"Bearer",expiresIn:900,user:User}`. Refresh consume el token anterior de forma atómica. Reutilizar uno consumido/revocado revoca todas las sesiones de la cuenta y se audita; un token desconocido simplemente se rechaza. Coordinar refresh entre pestañas: dos llamadas con la misma cookie cuentan como reutilización, incluso si provienen del mismo navegador.

`GET /auth/session` devuelve el rol actual de PostgreSQL y este contrato seguro:

```json
{"user":{"id":"d0347d10-079a-423d-a191-bf55608f1e38","name":"Persona","ci":"1234567","email":"persona@example.org","username":"persona","role":"PUBLICO","active":true,"createdAt":"2026-10-15T00:00:00.000Z"},"session":{"id":"e2c71b98-2253-40aa-a2f4-97b2e4f7cb91","createdAt":"2026-10-15T12:00:00.000Z","lastActivityAt":"2026-10-15T12:01:00.000Z","expiresAt":"2026-10-22T12:00:00.000Z","idleExpiresAt":"2026-10-15T12:11:00.000Z"},"serverTime":"2026-10-15T12:02:00.000Z"}
```

`idleExpiresAt` es la última actividad más diez minutos; el límite efectivo es el menor entre ese plazo y `expiresAt`. `serverTime` permite presentar los plazos sin confiar en el reloj del navegador. Consultar sesión no altera ninguno de esos plazos. Una cookie sola no autoriza esta consulta; usar refresh para obtener un nuevo access token cuando la sesión siga activa.

Logout admite JWT expirado únicamente para identificar y cerrar su sesión: siguen siendo obligatorias firma, algoritmo, emisor y audiencia válidos. También puede identificarla mediante el refresh conocido, incluso si ya se consumió/revocó o venció; no lo consume como refresh ni revoca las otras sesiones por reutilización. Si ambas credenciales identifican sesiones distintas, devuelve `403 SESSION_MISMATCH` sin cerrar ninguna ni eliminar la cookie. Corregir el estado local antes de repetir.

Logout sin credenciales conocidas, o repetido tras cerrar la sesión, devuelve 204 y expira la cookie tras registrar auditoría. No confirma existencia de una sesión. Repetir no modifica el instante de cierre ni duplica su finalización. Un fallo de auditoría cancela el cierre y se responde 503. Origen no permitido se rechaza antes de estas operaciones. Se puede cerrar una sesión inactiva o vencida aunque otros endpoints ya la rechacen.

Al detectar inactividad o vencimiento, el servidor finaliza la sesión de manera transaccional, revoca sus refresh y registra una sola `SESION_FINALIZADA`. El instante efectivo es el menor entre vencimiento absoluto y última actividad más diez minutos; una solicitud tardía no infla su duración. El cierre es diferido hasta detectar el vencimiento en una operación, sin un proceso programado adicional. Los intentos posteriores siguen rechazándose y pueden producir eventos de rechazo.

Reautenticación usa nuevamente `POST /auth/login` con usuario y contraseña; crea un ID de sesión nuevo. Refresh no recupera una sesión inactiva/vencida. Login conserva las otras sesiones que siguen activas y finaliza las de esa cuenta que ya alcanzaron su plazo de vencimiento o inactividad. El cliente debe descartar su access token al recibir 401, mostrar el formulario correspondiente y conservar las credenciales fuera de almacenamiento persistente. Ante un refresh malformado o desconocido, la API también expira su cookie.

Tres contraseñas incorrectas consecutivas bloquean la cuenta cinco minutos. Usuario inexistente, contraseña errónea y bloqueo responden `401 INVALID_CREDENTIALS`, evitando informar existencia/bloqueo. Una cuenta inactiva responde `403 ACCOUNT_INACTIVE` solamente después de verificar la contraseña (RN-03). Login exitoso reinicia contador/bloqueo.

Contraseñas nuevas: 8–128 caracteres, al menos una letra ASCII y un número; no se recortan. Argon2id, memoria 19 MiB (19456 KiB), costo temporal 2 y paralelismo 1; calibrar en despliegue. Cambio personal verifica contraseña actual, conserva el mismo ID y plazos de la sesión actual, revoca las demás y rota su refresh, invalidando los refresh anteriores. Responde 200 con un nuevo access token y Set-Cookie: el adaptador debe sustituir su token en memoria y usar `credentials:"include"` también en `PATCH /me/password`. Serializar este cambio y los refresh entre pestañas; reutilizar un refresh anterior activa la protección de reutilización. El access token anterior de la sesión conservada sigue válido hasta expirar, sujeto a las comprobaciones centrales de sesión; no existe una versión independiente por access token.

Cambio administrativo no permite la propia cuenta: usar cambio personal. Revalida sesión/rol del administrador después de bloquear el destino, responde 204 sin Set-Cookie y conserva la sesión del actor. Cambio administrativo/reset invalidan recuperaciones pendientes y sesiones de la cuenta afectada. Las rutas de contraseña no exigen If-Match: los ETags de usuarios representan metadatos seguros, no credenciales. Ningún cambio de contraseña renueva el plazo de inactividad por sí mismo.

Recuperación: token de 32 bytes en hexadecimal, SHA-256 persistido, quince minutos y un uso. Límite compartido en BD de tres solicitudes por email normalizado y por IP cada hora; el límite, cuenta inexistente/inactiva y SMTP indisponible devuelven el mismo HTTP 200 y mensaje. Mensaje exacto: “Si la dirección corresponde a una cuenta registrada y activa, recibirás las instrucciones para restablecer tu contraseña.” No confirma entrega. El token se añade como query `token` a `RECOVERY_URL`; al integrar frontend, elegir una URL que la pantalla pueda interpretar. Los tokens nunca se registran en logs.

SMTP se comprueba al arrancar. Sin SMTP o ante fallo continúa la API en modo degradado. Después de confirmar la transacción, el correo se procesa en segundo plano mediante una cola en memoria de hasta 100 tareas; la respuesta HTTP no espera a SMTP. Fallo de envío invalida el token y registra el fallo en otra transacción. El cierre ordenado espera tareas pendientes; una caída del proceso puede perder envíos encolados. No existe cola durable ni atomicidad distribuida PostgreSQL/SMTP. Recuperar disponibilidad del transportador requiere reiniciar la API en este hito.

## Usuarios y perfil

| Método/ruta | Permiso | Cuerpo/respuesta |
| --- | --- | --- |
| GET `/usuarios` | Admin | 200 `{data:User[],pagination:{page,pageSize,total,totalPages}}` |
| GET `/usuarios/:id` | Admin | 200 User y ETag fuerte, o 404 |
| POST `/usuarios` | Admin | Todos los campos editables + `password`; 201 User, Location y ETag |
| PATCH `/usuarios/:id` | Admin | Uno o más campos editables e If-Match obligatorio; 200 User y ETag actual |
| DELETE `/usuarios/:id` | Admin | If-Match obligatorio, sin campos de cuerpo/query; 204 si la cuenta no tiene vínculos |
| GET `/me` | Autenticado | 200 User de sesión |
| PATCH `/me` | Autenticado | Uno o más de `name,email,username`; 200 User |

Campos editables: `name,ci,email,username,role,active`. En alta todos son obligatorios; PATCH es parcial. Nombre 1–100 caracteres tras NFKC/trim; CI 5–12 dígitos tras NFKC/trim; email válido hasta 254 caracteres, NFKC/trim/minúsculas; username 3–40 caracteres ASCII (`A–Z a–z 0–9 . _ -`) tras NFKC/trim. Unicidad de CI y claves de email/username en PostgreSQL; no se limita la comprobación a un listado previamente descargado.

Filtros GET `/usuarios`: `page` entero 1–100000 (predeterminado 1), `pageSize` entero 1–100 (predeterminado 20), `search` hasta 100 caracteres después de NFKC/trim sobre nombre/email/usuario/CI, `role`, `active=true|false`. La búsqueda ignora mayúsculas/minúsculas y compara subcadenas literales: `%`, `_` y `\` no son comodines. No elimina acentos. Los filtros se combinan con AND; los cuatro campos buscados se combinan con OR. Orden estable `createdAt DESC,id ASC`. Listado vacío: `data:[]`, total y totalPages cero. Una página fuera de rango devuelve `data:[]` conservando el total real. Conteo y página se consultan con un mismo snapshot.

CU02 exige revalidar la precarga antes de guardar. Para editar o activar/inactivar, el futuro adaptador debe consultar `GET /usuarios/:id`, conservar el encabezado `ETag` y enviarlo como `If-Match` en PATCH, también cuando solo cambia `active`:

```http
PATCH /api/v1/usuarios/d0347d10-079a-423d-a191-bf55608f1e38
Authorization: Bearer <accessToken>
If-Match: "sha256-<64 caracteres hexadecimales minúsculos emitidos por la API>"
Content-Type: application/json

{"active":false}
```

El ETag fuerte tiene formato exacto `"sha256-<digest>"`, donde digest es SHA-256 del JSON del DTO seguro. Tratarlo como valor opaco y devolverlo literalmente, incluidas las comillas; no calcularlo desde un objeto del navegador. Solo se admite un tag fuerte: sin comodín, lista ni prefijo `W/`. Ausente: `428 PRECONDITION_REQUIRED`; formato inválido: `400 VALIDATION_ERROR`; tag válido que ya no coincide: `412 USER_VERSION_CONFLICT`. Ante 412, conservar el formulario, informar el conflicto y volver a consultar/reabrir; no sobrescribir ni reintentar automáticamente con la nueva versión.

La comparación ocurre después de bloquear y releer el destino y revalidar al actor. Dos PATCH que parten de la misma representación y cambian sus metadatos no pueden sobrescribirse silenciosamente: el segundo recibe 412. La versión representa contenido, no un contador; el mismo DTO produce el mismo tag. Cambios internos de login, contadores o contraseña no generan falsos conflictos. Este contrato corresponde a `PATCH /usuarios/:id`; las rutas de perfil/contraseña mantienen sus contratos existentes. CORS permite `If-Match` y expone `ETag`/`Location` a los orígenes autorizados.

RN-01: el nombre Público es de solo lectura, también si el PATCH convierte desde/hacia Público. Un administrador no puede cambiar su propio rol/estado. Los cambios se serializan y revalidan actor/sesión después de esperar el bloqueo del destino; debe quedar al menos un administrador activo. Cambio de rol o estado revoca sesiones y recuperaciones pendientes de la cuenta afectada usando el mismo reloj del servidor. Reactivar conserva identidad e historia y permite un login nuevo con la contraseña vigente; no revive JWT ni sesiones revocados. Alta, modificación, inactivación/reactivación y asignación de rol se auditan transaccionalmente sin credenciales.

Perfil usa exclusivamente la identidad autenticada: `GET /me` no acepta otro usuario y `PATCH /me` solo permite `name,email,username`. CI, rol, estado, fechas y credenciales son de solo lectura. El cuerpo debe incluir al menos un campo; propiedades desconocidas producen 400 y duplicados normalizados producen 409, también ante peticiones concurrentes. Nombre Público mantiene RN-01. La sesión y el rol se releen bajo bloqueo antes de modificar y `PERFIL_MODIFICADO` conserva el rol revalidado. Este contrato no exige If-Match en `/me`; la serialización evita mutaciones simultáneas sin aislamiento, pero no añade rechazo de precarga a formularios personales. Un cambio de perfil sí modifica el ETag de metadatos obtenido previamente por un administrador.

Cambiar el correo efectivo normalizado, mediante perfil o edición administrativa, consume las recuperaciones pendientes en la misma transacción que los datos y su auditoría. Cambios equivalentes de mayúsculas/Unicode/espacios no invalidan enlaces innecesariamente. La edición de correo o username conserva contraseña, sesiones y plazos; no requiere contraseña actual ni verifica entrega al correo nuevo. Un mensaje ya encolado al correo anterior puede llegar, pero su enlace consumido no permite restablecer la contraseña. Si falla la auditoría, también se revierten el correo y el consumo de recuperaciones.

La inactivación es `PATCH {active:false}`, conserva cuenta y auditoría. RN02 impide inactivar a sus creadores con `409 USER_IN_USE`, conservando el historial bibliográfico.

### Eliminación física de cuentas sin vínculos

`DELETE /usuarios/:id` implementa CU03 del frontend: solo Admin, cuenta distinta de la propia y conservación de al menos un Admin activo. Consultar primero `GET /usuarios/:id` y enviar literalmente su ETag como `If-Match`. Admite cuerpo ausente, null o `{}`; rechaza campos y query adicional, incluido cualquier indicador para forzar la baja. Éxito: 204 sin cuerpo. UUID inválido: 400; inexistente o segunda baja: 404. Falta de versión: 428; formato inválido: 400; precarga cambiada: 412. No reintentar automáticamente tras un conflicto de versión.

Inspecciona todas las FKs entrantes reales de usuarios bajo bloqueo, incluyendo futuros dominios. Publicaciones (también inactivas), adjuntos (cualquier estado), sesiones (también vencidas/revocadas) y eventos de auditoría atribuidos a la cuenta impiden eliminarla con `409 USER_IN_USE`. No hay CASCADE ni borrado de historia. Los tokens de recuperación son la única excepción: se eliminan dentro de la misma transacción. Si no puede comprobar una dependencia, falla cerrado.

Los eventos administrativos cuyo recurso es la cuenta destino, como su creación por otro Admin, se conservan íntegros por `resourceId` y DTO histórico; no bloquean por sí solos. `userId` de auditoría identifica al actor y sus referencias sí bloquean. Esto añade a la simulación las referencias de seguridad propias del servidor; no se suprimen ni reescriben logs para permitir la baja.

ETag, protecciones, referencias, eliminación y evento `USUARIO_ELIMINADO` confirman en una transacción ReadCommitted con el mismo lock administrativo que PATCH, más FOR UPDATE sobre la cuenta destino. El lock administrativo serializa altas/cambios/bajas; el de fila impide nuevas FKs mientras se comprueban las referencias. ReadCommitted relee datos confirmados tras cada espera: dos bajas simultáneas producen 204 y 404. Revalida el actor tras esperar el destino y antes de mutar. Las FK RESTRICT conservan la defensa final; un conflicto FK se devuelve como `USER_IN_USE`. La auditoría registra actor/rol/sesión y DTO anterior seguro, sin credenciales ni tokens. Si falla, cuenta y recuperaciones se restauran por rollback con 503 `AUDIT_UNAVAILABLE`; el rechazo se audita por separado.

Reutiliza `SELF_PRIVILEGE_CHANGE` para eliminar la cuenta propia y `LAST_ADMIN_REQUIRED` para el último Admin. CI/email/username quedan disponibles para una cuenta nueva con otro UUID; la historia mantiene el ID anterior. Antes de usar la ruta, repetir los grants documentados en DATABASE.md. No cambia datos del navegador ni activa conexión: el futuro adaptador debe consultar la versión y llamar DELETE.

El cierre previo de mantenimiento de usuarios conserva su evidencia histórica de 156 aprobadas. La ampliación de perfil/contraseñas fue validada con build/tipos correctos y **198 pruebas aprobadas: 150 sin servicios y 48 PostgreSQL (31 seguridad, 10 usuarios y 7 perfil)**, cero fallos y cero omitidas. Evidencia y límites de cada fase en [TESTING.md](TESTING.md).

## Errores

`Content-Type: application/problem+json`, formato RFC 7807 con extensiones documentadas:

```json
{"type":"about:blank","status":400,"code":"VALIDATION_ERROR","title":"Error de validación de datos","detail":"Los datos enviados no son válidos.","timestamp":"2026-10-15T00:00:00.000Z","path":"/api/v1/usuarios/:id","invalid_params":[{"name":"body.ci","reason":"La CI debe contener entre 5 y 12 dígitos."}]}
```

`path` es la plantilla de la ruta identificada por Fastify (incluye `:id`), o el pathname sin query si la ruta no existe. No incluye tokens de query. `invalid_params` siempre es un arreglo; puede estar vacío. JSON malformado, campos desconocidos y formatos inválidos son 400. Límite de cuerpo: 64 KiB (413). Rate limit global por proceso/IP: 120/minuto; recuperación tiene además límites persistidos indicados antes. Despliegues con varias instancias requieren store compartido para el límite general. `trustProxy=false`: configurar un proxy requiere revisión explícita de IP confiables.

| HTTP | code | Significado |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Cuerpo/query/params o solicitud inválidos |
| 400 | PUBLIC_NAME_READONLY | RN-01 |
| 400 | SELF_PRIVILEGE_CHANGE | Cambio propio de rol/estado o eliminación propia |
| 400 | SELF_ADMIN_PASSWORD_CHANGE | Cambio administrativo contra sí mismo |
| 400 | INVALID_CURRENT_PASSWORD | Contraseña personal actual incorrecta |
| 400 | PASSWORD_UNCHANGED | La contraseña nueva coincide con la actual |
| 400 | INVALID_RECOVERY_TOKEN | Token inválido, consumido o vencido |
| 401 | UNAUTHENTICATED | Falta acceso válido o sesión revocada/vencida/inactiva |
| 401 | INVALID_CREDENTIALS | Credenciales inválidas o bloqueo |
| 403 | FORBIDDEN | Rol insuficiente |
| 403 | ORIGIN_FORBIDDEN | Origen no permitido en operación con cookie |
| 403 | ACCOUNT_INACTIVE | Cuenta inactiva con contraseña verificada |
| 403 | SESSION_MISMATCH | Bearer y cookie identifican distintas sesiones al cerrar |
| 404 | NOT_FOUND | Recurso/ruta inexistente |
| 409 | DUPLICATE_USER | CI/email/username duplicados |
| 409 | LAST_ADMIN_REQUIRED | Se requiere un Administrador activo |
| 409 | USER_IN_USE | Cuenta con referencias que impiden la baja solicitada |
| 412 | USER_VERSION_CONFLICT | El usuario cambió desde la precarga identificada por If-Match |
| 413 | VALIDATION_ERROR | Cuerpo demasiado grande |
| 428 | PRECONDITION_REQUIRED | Falta If-Match al editar/activar/inactivar/eliminar un usuario |
| 429 | RATE_LIMITED | Límite general excedido |
| 500 | INTERNAL_ERROR | Fallo interno sin exponer detalles sensibles |
| 503 | AUDIT_UNAVAILABLE | Auditoría falló; mutación cancelada |

Rechazos se auditan separadamente para sobrevivir al rollback. Si falla esa escritura se responde 503. Éxito de mutaciones y su audit log comparten transacción. Ningún endpoint permite UPDATE/DELETE de auditoría.

Operaciones de auditoría de este hito: `USER_BOOTSTRAP`, `LOGIN`, `LOGOUT`, `REFRESH`, `REFRESH_REUTILIZADO`, `ACTIVIDAD_SESION`, `SESION_FINALIZADA`, `SESION_RECHAZADA`, `RECUPERACION_SOLICITADA`, `RECUPERACION_ENVIO_FALLIDO`, `CONTRASENA_RESTABLECIDA`, `CONTRASENA_PERSONAL_MODIFICADA`, `CONTRASENA_ADMIN_MODIFICADA`, `USUARIO_CREADO`, `USUARIO_MODIFICADO`, `USUARIO_INACTIVADO`, `ROL_ASIGNADO`, `PERFIL_MODIFICADO`, `OPERACION_RECHAZADA`. `SESION_FINALIZADA` conserva motivo, instante efectivo, duración y última actividad, sin tokens. Antes/después contienen DTO seguros; no credenciales. Consultar/exportar auditoría pertenece a un hito posterior.

## Salud

`GET /health`: 200 `{status:"ok"}` sin acceso DB. `GET /health/ready`: 200 `{status:"ready"}` si PostgreSQL responde, 503 `{status:"unavailable"}` de otro modo. No revelan configuración/credenciales; readiness actual comprueba BD, no disponibilidad SMTP. No sustituyen monitoreo administrativo.

`GET /api/v1/status`, solo ADMINISTRADOR: 200 `{status:"ready",smtp:"ready"}` si el transportador está disponible, o `{status:"degraded",smtp:"unavailable"}` en modo degradado. No revela host, credenciales ni errores SMTP. Para usar cookies desde navegador al integrar frontend, enviar `credentials:"include"` en login/refresh/logout y cambio personal de contraseña; el access token se envía por Bearer.

Los siete catálogos tienen rutas de listado/detalle/alta/edición/estado/eliminación en `/api/v1/catalogos/:catalog`, con campos, permisos, auditoría y errores `DUPLICATE_CATALOG`/`CATALOG_IN_USE` documentados en el [contrato de catálogos](CATALOGS.md), parte de este contrato API.

El [contrato de registro de publicaciones](PUBLICATIONS.md), también parte de esta API, documenta `POST /api/v1/publicaciones`, relaciones N:M, DTO, límite configurable de resumen (`GET/PATCH /api/v1/parametros/publicaciones`), modalidades y errores adicionales. El [contrato de listado/consulta](PUBLICATION-QUERIES.md) incorpora `GET /api/v1/publicaciones` y `GET /api/v1/publicaciones/:id`, con paginación, filtros, búsqueda FTS y DTO seguro según rol. POST emite Location del detalle.

El [contrato de adjuntos](ATTACHMENTS.md), parte de esta API, incorpora `POST /api/v1/adjuntos` multipart, `GET /api/v1/adjuntos/:id` de metadatos y `GET /api/v1/publicaciones/:id/adjunto` para descarga auditada. Admin/Digitador exclusivamente; formatos habilitados hasta 10 MiB analizados por ClamAV instalado, almacenamiento privado, hash/estado confiables y fallos cerrados. CORS expone Content-Disposition para la integración futura. El frontend sigue independiente.

El [contrato de mantenimiento de publicaciones](PUBLICATION-MANAGEMENT.md), parte de esta API, añade `PATCH /api/v1/publicaciones/:id`, inactivación Admin con `PATCH /api/v1/publicaciones/:id/estado`, ETag/If-Match, 412 `PRECONDITION_FAILED` y eventos `PUBLICACION_MODIFICADA`/`PUBLICACION_INACTIVADA`. `GET/PATCH /api/v1/parametros/publicaciones` incluye `allowedFormats` además de `summaryWordLimit`; PATCH parcial. PDF por defecto y TXT opcional bajo controles de contenido y ClamAV. Los DTO de archivo admiten MIME application/pdf o text/plain. Consulta/exportación de auditoría pospuesta hasta su futura ventana en client.

El [contrato de reportes](REPORTS.md), parte de esta API, incorpora `GET /api/v1/reportes/publicaciones` paginado y `GET /api/v1/reportes/publicaciones/exportar` con `format=pdf|xlsx`, mismos filtros y snapshot de la consulta. Exclusivo de ADMINISTRADOR; los documentos se generan en server. Vacío: 200 JSON sin archivo. Documenta diseño, límites, errores `REPORT_LIMIT_EXCEEDED`, `REPORT_VERSION_CONFLICT`, `REPORT_SERVICE_BUSY`, `REPORT_GENERATION_FAILED` y evento `REPORTE_EXPORTADO`, confirmado antes de entregar el archivo. No requiere nuevos grants ni migraciones.
