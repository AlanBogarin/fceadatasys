# Contrato para integrar el cliente — 17/10/2026

**Permisos vigentes.** Las referencias a accesos por rol describen los valores iniciales. Las operaciones utilizan permisos efectivos por rol y excepciones por cuenta conforme a AGENTS.md y [PERMISSIONS.md](../../docs/operacion/PERMISSIONS.md); administrar permisos y ejecutar copias conserva la reserva al Administrador con el permiso correspondiente.

El servidor implementa este contrato. El despliegue de `client/` utiliza únicamente el adaptador HTTP: los 22 pasos están conectados y verificados en integración local. Alcance, pruebas y límites en las notas de [conexión 1–10](../../docs/historico/integracion/IMPLEMENTACION-CONEXION-PASOS-1-10-2026-10-18.md), [catálogos 11–15](../../docs/historico/integracion/IMPLEMENTACION-CONEXION-PASOS-11-15-2026-10-18.md) y [cierre 21–22](../../docs/historico/integracion/IMPLEMENTACION-CONEXION-PASOS-21-22-2026-10-18.md); antecedentes del simulador en [ADAPTACIONES-CLIENTE.md](../../docs/historico/cliente/ADAPTACIONES-CLIENTE.md). Este documento forma parte de API.md y sustituye las restricciones anteriores sobre auditoría, adjuntos, confirmación, parámetros y sesión de navegador. No se modificaron los contratos del servidor para conectar estas ventanas.

**Actualización del 18/10/2026:** los pasos 16–20 ya utilizan el adaptador HTTP en modo API: archivos, gestión de publicaciones, consulta bibliográfica, búsqueda y reportes. Contratos y evidencias en [conexión 16–20](../../docs/historico/integracion/IMPLEMENTACION-CONEXION-PASOS-16-20-2026-10-18.md). El simulador fue retirado del despliegue.

## Una sesión por navegador

Todas las pestañas de un mismo navegador/origen comparten una cuenta y un mismo ID de sesión. Otros navegadores/equipos conservan sesiones independientes.

1. Al abrir la aplicación, coordinar las pestañas e inicializar el contexto con `POST /api/v1/auth/browser`, cuerpo ausente o `{}`, `credentials:"include"` y origen permitido. Devuelve 204 y una cookie `browser_token` HttpOnly, SameSite=Strict, Secure en producción. No autentica por sí sola. No volver a inicializar en paralelo un contexto que todavía no recibió cookies.
2. Consultar `GET /api/v1/auth/session` con `credentials:"include"`. Con refresh vigente y origen permitido devuelve identidad/plazos y `{accessToken,tokenType:"Bearer",expiresIn:900}`. No crea otra sesión, no rota la cookie ni renueva actividad. Con Bearer conserva la respuesta anterior, sin accessToken adicional. Un 401 lleva al login.
3. Login utiliza el contexto compartido; un navegador con sesión vigente recibe 409 `BROWSER_SESSION_ACTIVE` al intentar iniciar otra, incluso con otra cuenta. La API no sustituye silenciosamente esa cuenta. Sin cookie de contexto, las herramientas HTTP reciben un contexto nuevo; el cliente web debe cumplir el paso 1 antes de iniciar sesión.
4. Guardar access token solo en memoria. Coordinar renovación entre pestañas. Como defensa adicional, una segunda renovación de un refresh consumido hace hasta **5 segundos**, acompañada del contexto de navegador correcto y una sesión vigente, recibe access token sin `Set-Cookie`. Solo la ganadora rota la cookie. No se renuevan los plazos de actividad. Fuera de esa ventana, con token revocado o sin contexto coincidente, se conserva la detección estricta de reutilización y revocación de sesiones de la cuenta.
5. Logout revoca el ID compartido y sus refresh dentro de una transacción auditada. Todas las pestañas pierden autorización; las demás sesiones de otros navegadores se conservan. El adaptador deberá propagar el cambio visual por BroadcastChannel/eventos de almacenamiento y manejar 401, sin esperar a una próxima interacción para ocultar las pantallas. El servidor no controla el DOM de pestañas desconectadas.

PostgreSQL impide dos sesiones sin revocación para la misma clave de navegador mediante un índice único parcial. Los logins del contexto se serializan. Una sesión vencida se finaliza antes de crear otra. Las cookies son identidad del contexto, no un mecanismo de fingerprinting.

En desarrollo usar el mismo host para cliente y API, por ejemplo `127.0.0.1:5173` y `127.0.0.1:3000`, con el origen exacto autorizado por CORS. Mezclar `localhost` y `127.0.0.1` impide el flujo esperado de cookies SameSite=Strict; `credentials:"include"` no elimina esa restricción. Producción requiere HTTPS y una configuración compatible de sitio/orígenes.

## Confirmación de modificaciones y bajas

Todas las rutas PATCH/DELETE existentes requieren `X-Confirmation-Password`, con la contraseña **actual del actor codificada en Base64 de UTF-8**. El cambio personal `PATCH /me/password` conserva su campo `currentPassword`, que ya verifica la credencial, y no requiere el encabezado adicional. Altas POST, consultas, exportaciones y bitácoras automáticas no requieren confirmación.

Base64 permite transportar contraseñas Unicode en un encabezado HTTP; no es cifrado. Usar HTTPS en producción. El encabezado está redactado en logs de transporte y nunca se guarda ni exporta. El adaptador mantiene la contraseña únicamente mientras envía la solicitud y la descarta al terminar/cancelar.

La verificación exige usuario/sesión vigentes, registra rechazos y conserva por sesión el contador de confirmaciones incorrectas. Una correcta lo reinicia. El tercer error revoca la sesión compartida y sus refresh; no modifica el bloqueo de login de 3 fallos/5 minutos. Si falla la auditoría, se revierte también ese contador/revocación. Los servicios de escritura vuelven a comprobar la credencial vigente dentro de su transacción para detectar cambios mientras esperan locks.

| HTTP | code | Resultado |
| --- | --- | --- |
| 428 | CONFIRMATION_REQUIRED | Encabezado ausente o codificación inválida; sin mutación |
| 400 | INVALID_CONFIRMATION_PASSWORD | Contraseña incorrecta; operación pendiente sin aplicar |
| 401 | CONFIRMATION_EXPIRED | Credencial cambió durante la operación; confirmar nuevamente |
| 401 | UNAUTHENTICATED | Sesión vencida/revocada o tercer error de confirmación |

La validación del formulario puede rechazar campos antes de pedir la contraseña. Cancelar el diálogo no debe enviar la solicitud. CORS permite `X-Confirmation-Password`. No enviar hashes del navegador ni usar login como sustituto de esta confirmación.

## Versiones de catálogos y parámetros

GET detalle, POST y PATCH de catálogos emiten ETag. PATCH/DELETE de catálogos requieren `If-Match`. GET/PATCH de `/api/v1/parametros/publicaciones` también emiten ETag, y PATCH exige If-Match. Se compara el contenido vigente después de tomar los locks; una precarga desactualizada recibe 412 `RESOURCE_VERSION_CONFLICT`, sin sobrescribir cambios. Ausencia: 428 `PRECONDITION_REQUIRED`; formato no fuerte/único: 400 `VALIDATION_ERROR`.

Mantener el formulario al recibir 412, releer y revisar con el usuario. No reenviar automáticamente contra una versión nueva. Usuarios y publicaciones conservan sus códigos existentes. CORS expone ETag.

## Parámetros y archivos

GET devuelve `{summaryWordLimit:300,allowedFormats:["pdf"],maxPdfSizeMb:10}` inicialmente. PATCH parcial admite:

- `summaryWordLimit`: entero entre 10 y 1000, inclusivo;
- `allowedFormats`: PDF/TXT según los validadores ya implementados;
- `maxPdfSizeMb`: entero entre 1 y 25; MiB binarios, aplicados a **ambos** formatos. Se conserva el nombre del campo del cliente simulado por compatibilidad.

La carga comprueba el límite vigente antes del análisis y nuevamente bajo lock al confirmar. Multipart, validadores, almacenamiento, ClamAV y restricciones DB admiten como máximo absoluto 25 MiB. Reducir el parámetro no invalida archivos anteriores ni impide descargarlos. Los formatos siguen sujetos a ClamAV. El rango del resumen ahora coincide con el cliente; la migración rechaza valores antiguos fuera de 10–1000, sin reescribirlos silenciosamente. Revisarlos antes del despliegue si existen.

## Listado de adjuntos

`GET /api/v1/adjuntos`, solo Admin/Digitador. Query estricta: `page` (1 inicial), `pageSize` (20 inicial, máximo 100), `search` (hasta 300), `status=DISPONIBLE|VINCULADO|RESERVADO|RECHAZADO|PENDIENTE` opcional. Respuesta `{data,pagination:{page,pageSize,total,totalPages}}`.

Cada fila contiene `{id,name,size,mime,sha256,createdAt,createdBy:{id,name},status,publication,reservedPublicationId}`. La publicación vinculada visible contiene `{id,code,title,active}`; en otro caso es null. `reservedPublicationId` contiene el UUID de la publicación original de una reserva histórica visible, también cuando ya no está vinculada; sin reserva o sin permiso para ver esa publicación, es null. Administrador puede ver la reserva histórica de una publicación inactiva; Digitador solo recibe el identificador si la publicación está activa. Nunca incluye storageKey, paths ni credenciales.

Administrador ve todos. Digitador ve sus propias cargas y los adjuntos vinculados a publicaciones activas consultables. Un archivo reservado no se ofrece como disponible para una publicación nueva. Puede seleccionarse nuevamente al editar su publicación original, conservando propiedad/rol, estado de seguridad y formato habilitado; el servidor revalida las condiciones al guardar. Rechazados y pendientes de verificación no se descargan ni vinculan. Buscar nombre/título/código ignora acentos y mayúsculas; no se interpretan comodines del usuario. `GET /adjuntos/:id` agrega fecha/responsable y `reservedPublicationId`, con la misma omisión por visibilidad, y permite consultar un adjunto propio o de una publicación activa visible. El POST sigue devolviendo metadatos básicos sin reserva: completar la fila mediante detalle/listado. El flujo sigue siendo subir, guardar ID y luego registrar publicación con `attachmentId`.

## Reglas de inactivación corregidas — H1 y H2

Inactivar un catálogo con referencias de publicaciones únicamente inactivas está permitido, conservando dichas relaciones; las publicaciones activas y otras dependencias bloqueantes producen `409 CATALOG_IN_USE`. DELETE de catálogos sigue rechazando cualquier FK histórica. Ver [CATALOGS.md](CATALOGS.md).

La inactivación de usuarios comprueba publicaciones creadas, adjuntos propios en cualquier estado y participación histórica en catálogos existentes mediante eventos exitosos de auditoría inmutable. Los registros de acceso/sesiones y los rechazos no bloquean por sí solos una inactivación. Ver RN-02 en [API.md](API.md). No se crean tablas ni se requieren migraciones o grants adicionales para H1–H3.

## Búsqueda por nombres

Listado de publicaciones y reportes aceptan `author` y `tutor` de hasta 150 caracteres, normalizados y combinados con AND con los demás filtros. Son subcadenas literales de nombres bibliográficos, independientes de `authorId`/`tutorId`. Público puede utilizarlos sin consultar directorios ni recibir CI, correo u ORCID. La búsqueda general FTS conserva su contrato.

## Auditoría administrativa

Exclusivamente Administrador:

- `GET /api/v1/auditoria`: listado paginado.
- `GET /api/v1/auditoria/:id`: detalle inmutable.
- `GET /api/v1/auditoria/exportar`: PDF/Excel generados en servidor.

Filtros: `from`, `to` (días inclusivos de America/Asuncion), `actorId`, `role=ADMINISTRADOR|DIGITADOR|PUBLICO|SIN_IDENTIFICAR`, `module` (recurso del servidor), `operation`, `status=EXITO|FALLIDO`, `search`, `page`, `pageSize`. Se rechazan fechas/rangos inválidos. Búsqueda literal normalizada por ID, actor actual, operación, recurso, publicación, sesión y detalle/valores registrados. El rol es el histórico del evento.

DTO: `{id,createdAt,actorId,actorName,username,actorRole,operation,module,resourceId,publicationId,ip,userAgent,sessionId,status,detail,before,after}`. Omite credenciales, tokens, hashes y rutas privadas, también en JSON anidado. No existen PATCH/DELETE de auditoría.

El adaptador del cliente conserva este DTO sin inventar `origin`/`resourceName` del simulador. Obtiene total global y fallidos con consultas independientes (`pageSize=1`, segunda con `status=FALLIDO`). Las opciones globales recorren todas las páginas de auditoría y usuarios, con caché compartida solo en memoria y conservación de actores de eventos históricos; se invalida por sesión, mutaciones, señales entre pestañas y actualización manual. Si la cardinalidad cambia durante el recorrido, informa que es necesario actualizar en lugar de presentar opciones parciales. Inicio consulta `/me`, un total de publicaciones dentro del alcance del actor y, exclusivamente Admin, los totales de usuarios. No existe un endpoint Dashboard.

El listado agrega `export:{snapshot,exportable,maxRecords:500}`. Exportar requiere los mismos filtros, `format=pdf|xlsx` y ese snapshot. El archivo incluye todos los resultados, no solo la página; máximo 500 eventos/2 millones de caracteres, PDF de hasta 20 MiB. Excel conserva textos extensos en segmentos en la hoja Detalles. Sin resultados: 200 `{data:[],total:0}`, sin archivo. Los exportadores no registran credenciales. Se revalida sesión/rol y se confirma `AUDITORIA_EXPORTADA` antes de entregar bytes; si falla auditoría no se entrega el documento.

| HTTP | code | Significado |
| --- | --- | --- |
| 400 | AUDIT_EXPORT_LIMIT | Reducir la selección/tamaño |
| 409 | AUDIT_VERSION_CONFLICT | Consultar nuevamente antes de exportar |
| 503 | AUDIT_EXPORT_BUSY | Hay una exportación en curso |
| 503 | AUDIT_UNAVAILABLE | Falló auditoría; operación cancelada |
| 409 | BROWSER_SESSION_ACTIVE | El contexto del navegador ya está autenticado |

Eventos nuevos: `CONFIRMACION_RECHAZADA`, `REFRESH_CONCURRENTE`, `AUDITORIA_EXPORTADA`. Las demás operaciones conservan sus nombres previos.

## Aplicación y validación

Aplicar `20261017000000_client_integration` y luego `20261017010000_summary_limits` con propietario; regenerar Prisma/compilar y repetir runtime-grants.sql. No usar propietario como runtime. No se aplican automáticamente a una base de desarrollo/institucional desde las pruebas.

Reversión en orden inverso: `rollback-summary-limits.sql`, `rollback-client-integration.sql`. La segunda se niega a retirar datos nuevos de navegador/confirmación, archivos mayores de 10 MiB o un parámetro de tamaño modificado. No borra historial Prisma. Los smoke prueban SQL en bases desechables; no constituyen instrucciones de rollback de producción.

`CONNECTION_TEST_DATABASE_URL` debe apuntar exclusivamente a la base local `fceadatasys_connection_test`, migrada y con runtime limitado. La suite nueva usa servicios reales de PostgreSQL, Fastify, almacenamiento y documentos; sustituye el scanner para escenarios deterministas. La suite de adjuntos mantiene la validación de ClamAV real. `ALLOW_DATABASE_TESTS=1` y `CONNECTION_TEST_OWNER_URL` habilitan `scripts/connection-smoke.ts` para aplicación/down/up, historia, límites, sesión única e inmutabilidad en una base desechable propia.

El despliegue todavía necesita PostgreSQL activo, cuentas iniciales mediante bootstrap, firmas de ClamAV vigentes y SMTP configurado si se requiere recuperación por correo. Son condiciones de operación; esta entrega no instala credenciales, no inicia servicios permanentes ni conecta el cliente.

Actualización de correo del 17/10/2026: SMTP Gmail quedó configurado localmente en el archivo ignorado de server y su conexión/autenticación pasó `npm run mail:check`. El transportador se recupera automáticamente de caídas temporales. No cambia ningún payload de cliente: la integración futura debe extraer `token` de la query de `RECOVERY_URL` (incluso si tiene fragmento) y enviarlo con `newPassword` a `/api/v1/auth/reset-password`; el cliente ya extrae el token de la query al abrir, muestra recuperación y lo retira de la URL visible. Lo pendiente es enviarlo al endpoint mediante el adaptador HTTP. Ver [EMAIL.md](EMAIL.md) para operación y límites de entrega.
