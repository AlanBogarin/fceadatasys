# Revisión de preparación para la integración — 17/10/2026

**Registro histórico.** Conserva el alcance y los resultados de su fecha original. Las menciones al simulador, tareas pendientes, ZIP y rutas de versiones anteriores no describen la distribución vigente. Consultar el [índice técnico actual](../../README.md) y el índice Word de Proyecto.

**Estado actualizado:** H1, H2 y H3 están resueltos y validados. Este documento refleja la preparación actual e identifica por separado el trabajo de conexión futura. La [nota de implementación y validación](IMPLEMENTACION-H1-H2-H3-2026-10-17.md) conserva los detalles de los cambios y de sus pruebas.

## Dictamen y criterio aplicado

Los módulos principales del cliente tienen respaldo en endpoints existentes del servidor. Las tres diferencias detectadas en la revisión inicial —inactivación de catálogos históricos, inactivación de usuarios con vínculos y recuperación de adjuntos reservados— **fueron corregidas y tienen pruebas de regresión aprobadas**. No quedan pendientes de implementación correspondientes a H1–H3.

Según el criterio solicitado, las funciones revisadas están preparadas para la conexión futura mediante los endpoints disponibles. El trabajo restante comprende el adaptador HTTP, la composición de la aplicación con datos reales y la validación del recorrido completo desde el navegador. La aplicación todavía utiliza el simulador.

Se aplica el criterio solicitado: una función se considera **preparada** si la interfaz existe y puede funcionar con endpoints existentes, aunque todavía use el simulador. Las traducciones de DTO, composición de consultas, cookies, tokens, multipart y descargas se contabilizan como **conexión futura**, no como módulos funcionales faltantes. Que un endpoint exista no demuestra que sus reglas coincidan con las de la pantalla.

Este documento integra la revisión inicial y el cierre de las correcciones H1–H3. La implementación modificó reglas de negocio y DTO de servidor/cliente, sin habilitar la conexión real. La preparación funcional aquí descrita no acredita por sí sola el despliegue institucional.

Base de la revisión inicial: rama `main`, commit `01d20d7` (`preparar compatibilidad con cliente`), entonces sin cambios rastreados. Las correcciones H1–H3 quedaron incorporadas en `4680937` (`preparar conexion cliente servidor`), base de la consolidación documental del 17/10/2026. Entorno de validación: Node.js `v24.20.0`, npm `11.19.0`.

## Alcance y fuentes

Se contrastaron el [contrato maestro](../../../AGENTS.md), [requerimientos](../../../PROJECT_CONTEXT.md), README de ambos proyectos, [adaptaciones del cliente](../cliente/ADAPTACIONES-CLIENTE.md), [contrato API](../../../server/docs/API.md), [integración del cliente](../../../server/docs/CLIENT-INTEGRATION.md), contratos por dominio y documentación histórica de pruebas/implementación.

En código se inspeccionaron la composición de `App`, autenticación/sesión/confirmación, modelos y servicios del cliente, pantallas de cada dominio, registro de rutas Fastify, esquemas Zod, DTO, persistencia Prisma, restricciones/migraciones, auditoría, archivos y suites disponibles. El `.docx` histórico de usuarios no se renderizó; se utilizó su documentación Markdown de casos de uso junto al código vigente. No se inspeccionaron secretos de `.env`.

## Matriz de cobertura funcional

Todas las rutas siguientes usan el prefijo `/api/v1`.

| Funcionalidad del cliente | Respaldo del servidor | Evaluación con el criterio solicitado |
| --- | --- | --- |
| Login, bloqueo de 3 fallos/5 minutos y cierre de sesión | `POST /auth/login`, `/auth/logout` | Preparada; falta conexión. |
| Una cuenta compartida entre pestañas, restauración, plazos y actividad | `POST /auth/browser`, `GET /auth/session`, `POST /auth/refresh`, `/auth/activity` | Preparada; falta implementar el transporte y la coordinación real de cookies/tokens. |
| Recuperación y restablecimiento de contraseña | `POST /auth/recover-password`, `/auth/reset-password` | Preparada; la pantalla ya lee `?token=...`. Correo y token efectivos dependerán del servidor. |
| Alta, consulta, edición, roles y estado de usuarios | `GET/POST /usuarios`, `GET/PATCH /usuarios/:id` | Preparada; H2 resuelto: la inactivación comprueba publicaciones, adjuntos y participación histórica en catálogos existentes. |
| Eliminación de usuarios sin vínculos | `DELETE /usuarios/:id` | Preparada; el servidor añade referencias reales de sesiones/auditoría que pueden impedir la baja y se debe mostrar su rechazo. |
| Perfil y contraseñas personal/administrativa | `GET/PATCH /me`, `PATCH /me/password`, `/usuarios/:id/password` | Preparada; el reemplazo del token personal forma parte de la conexión. |
| Autores y tutores reutilizables; otros cinco catálogos | `GET/POST /catalogos/:catalog`, `GET/PATCH/DELETE /catalogos/:catalog/:id` | Preparada; H1 resuelto: permite inactivar con publicaciones únicamente inactivas y conserva el veto de DELETE ante referencias históricas. |
| Registro de publicaciones locales/externas, autores/tutores ordenados N:M | `POST /publicaciones` | Preparada; payload compatible, carga previa por `attachmentId`, aprobación fuera del sistema. |
| Consulta, búsqueda avanzada y filtros por nombres/clasificaciones/fechas | `GET /publicaciones`, `/publicaciones/:id` | Preparada; el servidor usa FTS y el simulador búsquedas de texto, por lo que los resultados de búsquedas parciales pueden variar. |
| Edición e inactivación de publicaciones | `PATCH /publicaciones/:id`, `/publicaciones/:id/estado` | Preparada; H3 resuelto: un adjunto retirado puede seleccionarse nuevamente para su publicación original, con los controles vigentes. No se exige reactivación de publicaciones. |
| Carga, listado y descarga de adjuntos autorizados | `POST/GET /adjuntos`, `GET /adjuntos/:id`, `/publicaciones/:id/adjunto` | Preparada; listado y detalle exponen `reservedPublicationId` según visibilidad. El cliente conserva la reserva al reconstruir sus datos. PDF inicial y TXT opcional con controles y ClamAV. |
| Límite de resumen, formatos y tamaño configurable | `GET/PATCH /parametros/publicaciones` | Preparada; coinciden 10–1000 palabras, 1–25 MiB, PDF/TXT, ETag y confirmación. Límite inicial: 300 palabras inclusive. |
| Reportes bibliográficos filtrados PDF/Excel y selección vacía | `GET /reportes/publicaciones`, `/reportes/publicaciones/exportar` | Preparada; snapshot opaco, máximo 500 registros, exportación del conjunto filtrado y 200 JSON sin archivo si está vacío. |
| Consulta, detalle y exportación de auditoría por Administrador | `GET /auditoria`, `/auditoria/:id`, `/auditoria/exportar` | Preparada; el detalle ya viene en el listado y además existe endpoint específico. Deben adaptarse DTO y opciones globales. |
| Confirmación de cambios/bajas, versiones y Problem Details | `X-Confirmation-Password`, `If-Match`, ETag, errores documentados | Preparada en comportamiento; la confirmación y el ciclo de lectura/escritura reales requieren el trabajo de conexión descrito más abajo. |
| Roles y permisos | Roles canónicos y autorización central por sesión | Preparada; la pantalla es informativa y la asignación se hace desde Usuarios. No se requiere un CRUD de roles arbitrarios. |

El control Público sin descarga, las restricciones por rol, duplicados normalizados, restricciones de integridad y auditoría transaccional tienen implementación en servidor y pruebas. La validación del simulador no sustituye esas garantías.

## Hallazgos resueltos

### H1. Inactivación de catálogos con publicaciones únicamente inactivas — resuelto

**Problema original:** el cliente permitía inactivar un catálogo si no tenía publicaciones activas asociadas, pero el servidor utilizaba la misma comprobación que DELETE y rechazaba también referencias exclusivamente históricas.

**Flujo habilitado:** inactivar la publicación y, cuando no queden publicaciones activas asociadas, inactivar su carrera, autor, tutor u otra clasificación sin perder las relaciones históricas.

**Solución aplicada:** `server/src/catalogs/store.ts` separa `assertCatalogCanDeactivate` de `assertCatalogUnreferenced`; la ruta PATCH usa la primera y DELETE conserva la segunda. Para inactivar, las referencias de publicaciones solo bloquean si están activas, incluidas las relaciones N:M y las referencias compuestas de clasificaciones. Las dependencias de otros dominios conservan su veto preventivo hasta contar con una regla específica.

**Validación aprobada:** pruebas PostgreSQL para autores, tutores, carreras, niveles, tipos y filiales: publicación activa → rechazo; solo publicaciones inactivas → inactivación permitida; DELETE con referencias históricas → rechazo. Se comprobó conservación de relaciones, exclusión de nuevas cargas y una publicación que confirma mientras la inactivación espera el catálogo.

Contrato vigente: [CATALOGS.md](../../../server/docs/CATALOGS.md). No requiere migración ni grants nuevos.

### H2. Vínculos de usuarios antes de inactivar — resuelto

**Problema original:** el simulador comprobaba documentos y participantes históricos de catálogos, mientras que el servidor solo consultaba publicaciones creadas por la cuenta. Una cuenta con un adjunto y sin publicaciones podía inactivarse en la API aunque el cliente rechazara ese caso.

**Flujo habilitado:** al solicitar una inactivación, el servidor comprueba los vínculos de negocio y responde `409 USER_IN_USE` si la cuenta tiene publicaciones creadas, adjuntos propios en cualquier estado o participación en catálogos que aún existen, incluidos los inactivos. Las sesiones, accesos, cambios de perfil y operaciones rechazadas no impiden por sí solos la inactivación.

**Solución aplicada:** `server/src/users/dependencies.ts` consulta las dependencias dentro de la transacción. La participación histórica se obtiene de eventos exitosos e inmutables de creación, modificación, activación e inactivación de catálogos, unidos al actor/recurso/registro existente. No se duplica la historia en otra tabla ni se aceptan contadores del navegador. Un catálogo eliminado deja de constituir esa dependencia de inactivación; su auditoría se conserva y puede seguir impidiendo la eliminación física del actor.

La prueba concurrente detectó inicialmente una instantánea Serializable que podía omitir un evento confirmado durante la espera del lock. PATCH de usuarios utiliza ahora ReadCommitted bajo el mutex administrativo y los bloqueos de actor/destino, conservando los reintentos de conflictos. Así relee las dependencias confirmadas después de esperar. Los demás usos de `withTransaction` mantienen Serializable por defecto.

**Validación aprobada:** adjuntos sin publicaciones, creadores y editores de catálogos inactivos, ausencia de veto por sesiones/rechazos, eliminación del catálogo, rollback de participación al fallar auditoría, fallo cerrado de la consulta de dependencias y concurrencia real entre edición e inactivación. Después de corregir la carrera se repitió toda la suite del servidor con éxito.

Contratos vigentes: [API.md](../../../server/docs/API.md) y [DATABASE.md](../../../server/docs/DATABASE.md). El protocolo usa escrituras auditadas de la API; no atribuye participación a importaciones SQL sin trazabilidad. No requiere migración ni grants nuevos.

### H3. Identificación de la publicación de un adjunto reservado — resuelto

**Problema original:** el servidor persistía la reserva, pero listado y detalle no entregaban el ID de su publicación original. El cliente no podía identificar de forma fiable qué archivo retirado ofrecer después de recargar o cambiar de navegador.

**Flujo habilitado:** vincular A a una publicación, reemplazarlo por B, reconstruir los datos sin historial local y seleccionar nuevamente A al editar su publicación original, siempre que cumpla los controles vigentes.

**Solución aplicada:** GET listado y GET detalle de adjuntos incluyen `reservedPublicationId: string | null`. El ID se entrega únicamente si el actor puede ver la publicación original: Administrador puede consultar reservas de inactivas; Digitador solo recibe el ID si la publicación está activa y el archivo pertenece al alcance de su consulta. Si no se entrega el ID, el archivo sigue reservado y no se ofrece como disponible.

El cliente incorpora el campo al DTO y al servicio simulado. `uploadedAttachmentFromDto` conserva la reserva al reconstruir el modelo de lectura y `selectableAttachments` aplica la selección del formulario. El POST real de carga conserva su respuesta básica; la futura conexión completará la fila mediante consultas autorizadas.

**Validación aprobada:** reconstrucción del estado del cliente desde el DTO sin `attachmentHistory`, selección y restablecimiento para la publicación original, rechazo de reutilización en otra publicación y exclusión de archivos rechazados/pendientes. PostgreSQL comprueba listado/detalle, restablecimiento por PATCH, permisos y omisión del ID de publicaciones inactivas para Digitador.

Contratos vigentes: [CLIENT-INTEGRATION.md](../../../server/docs/CLIENT-INTEGRATION.md), [ATTACHMENTS.md](../../../server/docs/ATTACHMENTS.md) y [adaptaciones del cliente](../cliente/ADAPTACIONES-CLIENTE.md). La reserva ya estaba persistida; no requiere migración ni grants nuevos.

## Trabajo que corresponde a la conexión futura

Estos puntos requieren implementación cuando se conecte el cliente, pero **no se cuentan como funciones de negocio faltantes** bajo el criterio solicitado.

### Composición de la aplicación y confirmaciones

`DataProvider`, servicios asíncronos, DTO seguros, errores y versiones proporcionan una base útil. Aun así, `App.tsx` instancia directamente `createMockClient`, carga `State` desde `localStorage`, obtiene la identidad desde `useSession`/`MockSessionStore` y construye `ViewState` a partir del estado completo. `VITE_DATA_MODE=api` está bloqueado explícitamente. No basta cambiar la URL ni reemplazar algunas llamadas por `fetch`.

Al integrar será necesario seleccionar el adaptador, cargar identidad y datos seguros desde la API, actualizar/invalidar las lecturas tras mutaciones y conflictos, y preservar los formularios ante 412. Las pantallas aún usan datos de `ViewState` para selectores, requisitos de catálogos, archivos, referencias históricas, comparaciones de versión e indicadores de Inicio.

`useMutationConfirmation.tsx` funciona mediante estados locales antes/después y verificación de credenciales del simulador. Las pantallas no suministran hoy `confirmationPassword` al servicio. La conexión tendrá que recoger la contraseña de forma efímera antes de enviar PATCH/DELETE, transmitirla con `confirmationHeaders` y procesar los rechazos del servidor. No debe trasladarse al cliente real la comprobación de hashes locales. Las altas conservarán su confirmación visual y el cambio personal usará su campo `currentPassword`.

Conviene expresar la interfaz `DataClient` independientemente de `ReturnType<typeof createMockClient>` al implementar el adaptador, para evitar exigir operaciones exclusivas de la demo. Es una mejora de la frontera de integración, no un módulo nuevo obligatorio antes de este hito.

### Resúmenes globales, opciones y paginación

Las respuestas `summary` de usuarios/catálogos/adjuntos/auditoría existen en el simulador y son consumidas por las pantallas. La API normalmente devuelve `data`/`pagination` y metadatos de exportación, sin esos `summary` adicionales.

| Dato utilizado por el cliente | Cómo puede obtenerse con endpoints actuales |
| --- | --- |
| Total de usuarios, activos y administradores activos | `pagination.total` de consultas sin filtros y con `active=true`, `role=ADMINISTRADOR&active=true`. |
| Total/activos de un catálogo | Totales de las consultas del mismo catálogo sin filtros y con `active=true`. |
| Cantidad de adjuntos por estado | Totales de `GET /adjuntos` filtrados por cada estado, bajo el alcance del actor. |
| Total global y fallidos de auditoría | Consultas separadas para total global y para los filtros actuales con `status=FALLIDO`. |
| Opciones de actores, módulos y operaciones de auditoría | Usuarios autorizados y páginas de auditoría; conservar el valor canónico del servidor al mostrar etiquetas. No deducir las opciones globales de una sola página filtrada. |
| Opciones históricas de búsqueda/reportes y documentos seleccionables | Catálogos, publicaciones y adjuntos paginados, conservando las referencias seleccionadas y los nombres del DTO. |

Esto es resoluble por composición y por ello se considera preparado. Puede resultar costoso recorrer toda la auditoría/publicaciones para construir opciones; un agregado/facetas sería una mejora posterior del servidor, no un endpoint ausente imprescindible para el flujo principal. Los conteos obtenidos en varias peticiones no forman un snapshot atómico común. Nunca sustituirlos por el tamaño de la página visible ni presentar ceros ficticios.

### Adaptación de solicitudes y respuestas

- Omitir filtros vacíos antes de construir query strings: los esquemas del servidor rechazan `year=`, UUID vacíos, estados inválidos y propiedades desconocidas. Respetar máximos y paginación; no enviar `State`, actor ni auditoría del navegador.
- Tratar ETags y snapshots como opacos. Los snapshots de reportes/auditoría pueden ser `null` cuando no hay resultados exportables; `ExportMetadata` del cliente hoy los declara siempre `string`. Modelar ese caso o traducirlo de forma explícita sin habilitar exportación.
- Login/refresh/cambio personal devuelven un par de tokens; `SessionDto` se obtiene de `/auth/session`. Actividad responde 204. La fachada puede componer ambas respuestas; no falta otro endpoint de sesión.
- Coordinar inicialización de `/auth/browser`, restauración, refresh y cambio personal entre pestañas. Mantener cookies HttpOnly con `credentials:include`, access token en memoria, actividad humana y propagación del cierre/401.
- `POST /adjuntos` devuelve metadatos básicos. Para completar la fila esperada por el cliente, obtener detalle/listado autorizados. La descarga recibe un ID de adjunto en la fachada del cliente y una publicación en la ruta HTTP; resolver ese vínculo con los datos de la API.
- Subir multipart con el campo `file`; descargar bytes mediante Blob y `Content-Disposition`. La generación PDF/Excel será la del servidor. Manejar el 200 JSON vacío antes de intentar descargar.
- Adaptar auditoría: el servidor devuelve `username` y valores canónicos de recurso/operación, mientras el modelo local incluye `resourceName` y `origin`. Evitar etiquetar eventos reales como provenientes de una versión anterior por faltar un campo exclusivo del simulador.
- En el modo real, componer la aplicación sin generadores de datos/cuentas de demo, enlace didáctico de recuperación ni escritura local de bitácoras como fuente de verdad. `DemoDataPanel` y `demoRecoveryToken` son capacidades del simulador; no requieren endpoints productivos.

El nombre de Digitador en Mi perfil es de solo lectura en el cliente y editable en la API. La documentación de usuarios identifica expresamente esa restricción adicional como **local al frontend**; no se contabiliza como endpoint faltante ni como falla del permiso actual del servidor.

## Estado de la documentación

Consolidación del 17/10/2026: se corrigieron las afirmaciones superadas en las guías actuales y se identificó expresamente la evidencia histórica. Los contratos de API, catálogos, publicaciones, archivos, parámetros y seguridad describen ahora el código vigente; los README enlazan las guías de ejecución e integración.

| Área corregida | Documentación vigente |
| --- | --- |
| Auditoría: listado, detalle y exportación ya disponibles | API.md, SECURITY.md, REPORTS.md, PUBLICATION-MANAGEMENT.md y CLIENT-INTEGRATION.md. |
| Adjuntos: listado, visibilidad del detalle, reservas H3 y reemplazo mediante PATCH | ATTACHMENTS.md, PUBLICATIONS.md, CLIENT-INTEGRATION.md y CARGA-DE-ARCHIVOS.md. |
| Parámetros: resumen 10–1000, tamaño 1–25 MiB y formatos PDF/TXT | Contratos de publicaciones, persistencia y guías de parámetros/carga/transacción del cliente. Valores iniciales 300/PDF/10 MiB. |
| Sesión compartida, restauración por cookie, concurrencia de refresh y confirmación del actor | API.md, SECURITY.md, CLIENT-INTEGRATION.md y documentación de usuarios del cliente. |
| CI/correo de personas y código de carrera opcionales; filtros author/tutor disponibles | CATALOGS.md, PUBLICATION-QUERIES.md, REPORTS.md y revisión del cliente del 16/10 con aclaración de la regla vigente. |
| Recuperación: el cliente ya interpreta y retira token de la URL | EMAIL.md y CLIENT-INTEGRATION.md; enviar la petición real sigue siendo trabajo del adaptador. |
| Siete migraciones y permisos actuales; registro local de cinco migraciones identificado por fecha | DATABASE.md y README del servidor. No se declara actualizada una instalación sin verificarla. |
| H1/H2: inactivación de catálogos y usuarios con reglas históricas | CATALOGS.md, API.md, DATABASE.md y CLIENT-INTEGRATION.md. |
| Conteos anteriores y material de usuarios del 8/10 | IMPLEMENTATION-STATUS.md y TESTING.md distinguen el último cierre de los antecedentes. El DOCX y los diagramas originales se conservan como archivo histórico, identificado en su README. |

PROJECT_CONTEXT.md conserva los requisitos y remite a las decisiones técnicas ya implementadas; no presenta como indefinidos el stack, las sesiones o ClamAV. No queda pendiente la consolidación de las guías señaladas en la revisión inicial. El material histórico conserva su fecha y alcance, sin convertir resultados antiguos en pruebas de esta actualización documental.

## Validaciones de cierre y límites

Los resultados siguientes corresponden al cierre de la implementación H1–H3, documentado en [TESTING.md](../../../server/docs/TESTING.md) y en la [nota de implementación](IMPLEMENTACION-H1-H2-H3-2026-10-17.md). La consolidación documental no vuelve a ejecutar las suites. Se comprobaron 131 enlaces locales sin destinos inexistentes, coherencia con rutas/validadores y las siete migraciones, y `git diff --check` sin errores.

| Validación de cierre | Resultado |
| --- | --- |
| `client`: `npm test` | **87 aprobadas**, 0 fallos, 0 omitidas. |
| `client`: `npm run build` | Correcto, TypeScript y Vite. Advertencia de chunks de más de 500 kB; el mayor es ExcelJS. No impide compilar ni identifica una función faltante. |
| `server`: `npm run test:unit` | **212 aprobadas**, 0 fallos, 0 omitidas. Incluye pruebas de componente en memoria y fallo cerrado de dependencias/visibilidad de reservas. |
| `server`: `npm run test:integration` | **136 aprobadas con PostgreSQL**, 0 fallos, 0 omitidas; ClamAV real habilitado para su suite. |
| `server`: `npm test` | **348 aprobadas en total**: 212 sin servicios y 136 PostgreSQL. La corrida completa se repitió tras corregir la carrera H2. |
| `server`: `npm run test:typecheck` | Correcto. |
| `server`: `npm run build` | Correcto, generación de Prisma Client 7.10.0 y compilación TypeScript. |
| Comprobaciones PostgreSQL de persistencia y permisos | **7 aprobadas**: permisos, FKs, unicidad, auditoría inmutable y rollback. |
| `scripts/connection-smoke.ts` | Aplicación/down/up de migraciones existentes, conservación de historia, guardas de reversión, límites, sesión única e inmutabilidad: aprobado. |
| Regresiones H1–H3 | Pruebas permanentes de historia, vínculos, reservas, permisos, rollback y concurrencia; reconstrucción del modelo del cliente sin historial local. |

La corrida integrada utilizó el clúster aislado de pruebas `127.0.0.1:55439`, rol runtime limitado y bases exclusivas. Quedó detenido al finalizar, con datos conservados. H1–H3 no añaden migraciones ni grants; las pruebas de aplicación/reversión corresponden a las migraciones existentes. No se migró desarrollo ni una base institucional y no se enviaron correos reales.

El nuevo recorrido del cliente se comprobó mediante servicios/modelos. No se ejecutó una nueva inspección visual del navegador ni la conexión real cliente-servidor. Se conserva la advertencia conocida de consultas encoladas de `pg`. La primera corrida que detectó la carrera H2 se conserva como antecedente fallido y no se presenta como aprobada.

Las mediciones históricas de FTS son locales al servidor. La conexión futura necesitará comprobar el recorrido navegador/API/base y la búsqueda bajo las condiciones definidas para el proyecto; no se acredita aquí el objetivo de 1,5 segundos en un despliegue institucional.

## Pendientes para la conexión futura

La ejecución por ventanas está detallada en el [plan de conexión cliente–servidor](PLAN-CONEXION-CLIENTE-SERVIDOR-2026-10-17.md). Es un plan de implementación; los pendientes siguientes aún no se consideran realizados.

1. Implementar el adaptador HTTP y la composición real del cliente con los endpoints y contratos disponibles, incluidas identidad, sesión compartida y confirmaciones.
2. Traducir DTO, errores, versiones, filtros y respuestas vacías; obtener conteos y opciones globales sin tratar una página como si fuera todo el catálogo. Conservar `reservedPublicationId` al reconstruir los datos reales.
3. Sustituir cargas, descargas y exportaciones simuladas por los servicios reales, con multipart, autorización y snapshots opacos.
4. Validar el recorrido completo desde el navegador por rol: sesión entre pestañas, 401, concurrencia/412, confirmaciones, reservas tras recarga, carga/descarga y exportación con snapshot/vacío. Medir búsqueda en las condiciones definidas para el proyecto.

PostgreSQL, migraciones/grants, bootstrap administrativo, orígenes/cookies/HTTPS, almacenamiento privado, firmas de ClamAV y SMTP/URL de recuperación son condiciones de operación. Su disponibilidad no se deduce de que las pruebas sin servicios pasen. Backups, retención, monitoreo y la cola de correo en memoria conservan los límites operacionales ya documentados; no constituyen módulos faltantes de interfaz para este análisis.

**Estado de entrega:** H1, H2 y H3 cerrados con cambios de servidor/cliente, contratos actualizados y regresiones aprobadas. No requieren cambios de esquema ni grants adicionales. El trabajo pendiente es la conexión real y su validación completa desde el navegador, además de las condiciones operacionales descritas. La consolidación documental actualiza las guías de cliente/servidor y este informe; no cambia código, configuración ni bases de datos.
