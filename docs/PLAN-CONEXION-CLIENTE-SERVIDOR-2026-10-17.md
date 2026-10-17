# Plan de conexión cliente–servidor por ventanas — 17/10/2026

**Estado:** plan propuesto; no habilita la conexión ni ejecuta migraciones. Parte de `4680937` y de la documentación consolidada del 17/10. H1, H2 y H3 están resueltos. El trabajo principal corresponde al cliente: implementar transporte, composición, sesión y lecturas reales sobre los endpoints existentes.

Referencias: [contrato maestro](../AGENTS.md), [revisión de preparación](REVISION-PREPARACION-INTEGRACION-2026-10-17.md), [API](../server/docs/API.md), [integración](../server/docs/CLIENT-INTEGRATION.md) y [adaptaciones del cliente](../client/docs/ADAPTACIONES-CLIENTE.md).

Cada paso corresponde a una ventana existente: una entrada del menú, una ventana de cuenta o un modo de `AuthPage`. Sus formularios, detalles y diálogos se cierran dentro de ese paso. Son **22 ventanas**; no se agregan pantallas para representar tareas técnicas. El orden responde a dependencias y no al orden visual del menú.

## Preparación del entorno

Antes de comprobar el primer acceso, verificar PostgreSQL, las siete migraciones hasta `20261017010000_summary_limits`, grants runtime y el primer Administrador creado mediante bootstrap. No asumir que la base local tiene las siete migraciones porque existe una evidencia anterior de cinco. Usar una base de integración separada de datos institucionales y del simulador.

Configurar `VITE_API_BASE_URL` y CORS con orígenes exactos. En desarrollo usar el mismo host, por ejemplo cliente `127.0.0.1:5173` y API `127.0.0.1:3000`; no mezclar `localhost` y `127.0.0.1` con cookies SameSite=Strict. Verificar ClamAV/firmas y almacenamiento antes del paso de archivos; SMTP y `RECOVERY_URL` antes de recuperación. La API siempre usa el rol runtime limitado.

No se prevén endpoints nuevos ni migraciones por anticipado. Una diferencia de contrato que aparezca al implementar debe documentarse y resolverse en su dominio antes de cerrar la ventana afectada.

## Reglas para todos los pasos

- Mantener modos `mock` y `api` separados. En modo API no cargar cuentas/muestras, hashes, archivos ni bitácoras del navegador como datos reales, y no volver al simulador cuando falle una solicitud. Durante el desarrollo, las ventanas aún sin conectar quedan indisponibles en modo API; no publicar una entrega parcial como integración completa.
- Reemplazar gradualmente las dependencias de `ViewState` completo por consultas y modelos de lectura de cada ventana. No reconstruir todo el estado privado del mock ni descargar toda la base al iniciar. Invalidar consultas afectadas después de cada cambio y vaciar las cachés al cambiar o cerrar sesión.
- Conservar carga, error, vacío y datos disponibles como estados distintos. Cancelar/descartar respuestas antiguas al cambiar filtros, página o sesión. Omitir filtros vacíos y usar los totales de la API; el tamaño de una página no es el total global.
- Confirmar visualmente las altas. Para PATCH/DELETE, recoger la contraseña actual del actor y enviarla de forma efímera mediante `X-Confirmation-Password` en Base64 de UTF-8. `PATCH /me/password` usa `currentPassword`. No comprobar hashes locales ni guardar la contraseña. Cancelar no envía la escritura.
- Conservar ETag de la precarga y enviar If-Match donde corresponda. Ante 412 mantener el formulario, consultar el registro actual y pedir revisión; nunca sustituir automáticamente el ETag para sobrescribir. Usar los códigos específicos de cada recurso.
- Procesar Problem Details y `invalid_params`. Un 401 de sesión invalida el contexto compartido; `CONFIRMATION_EXPIRED` exige confirmar otra vez y no debe interpretarse automáticamente como cierre de sesión. No repetir mutaciones de resultado incierto ante un fallo de red. Reintentar una lectura tras renovar autorización como máximo una vez.
- El servidor determina permisos, vínculos, duplicados y auditoría. El cliente muestra sus rechazos y actualiza la UI; no escribe una segunda bitácora local para operaciones reales. Ocultar un botón no sustituye la autorización del endpoint.
- Las exportaciones y descargas reciben bytes del servidor. Comprobar Content-Type, Problem Details, 200 JSON vacío y Content-Disposition antes de descargar un Blob; liberar su URL temporal. No generar documentos reales mediante los exportadores del simulador.

## Pasos por ventana

### 1. Inicio de sesión y sesión bloqueada

**UI y archivos:** modo login de `client/src/AuthPage.tsx`, navegación/cabecera en `App.tsx`, `useSession.ts`, `data/config.ts`, `data/context.tsx` y servicios de sesión.

**Flujo:** abrir → inicializar navegador → restaurar sesión o ingresar credenciales → mostrar identidad/menú autorizado → registrar actividad humana → renovar autorización → cerrar o reautenticar cuando corresponda.

**Endpoints:** POST `/auth/browser`, GET `/auth/session`, POST `/auth/login`, `/auth/activity`, `/auth/refresh` y `/auth/logout`. Todas las rutas abreviadas de este plan llevan `/api/v1`.

**Implementación:** definir una interfaz de servicios independiente de `ReturnType<typeof createMockClient>`, un adaptador HTTP y selección explícita de modo. Separar capacidades de demo. El primer adaptador implementa autenticación; los demás métodos se agregan en sus ventanas. Desacoplar la sesión de `MockSessionStore`. Usar cookies con `credentials:include`, access token solo en memoria y exclusión entre pestañas para inicialización/refresh/cambio de contraseña. Componer token pair con consulta de sesión; actividad responde 204. Incorporar parser de errores, lectura de encabezados y cancelación. Hasta conectar Inicio, usar la estructura autenticada y una ventana ya conectada como destino, sin indicadores ficticios.

**Cierre:** login real y restauración tras recargar; segunda pestaña comparte cuenta; segundo login recibe `BROWSER_SESSION_ACTIVE`; logout y 401 ocultan las vistas privadas y vacían datos en todas las pestañas. Probar tres fallos/cinco minutos, diez minutos sin actividad y renovación sin prolongar actividad. Repetir por los tres roles cuando estén creados en el paso 3.

### 2. Mi perfil

**UI:** `#perfil`, componente `Profile` en `UserPages.tsx`. **Depende de:** 1.

**Flujo:** consultar identidad → editar campos permitidos → confirmar con contraseña → guardar → actualizar cabecera y formulario.

**Endpoints:** GET/PATCH `/me`.

**Implementación:** construir la confirmación de mutaciones reales que reutilizarán las otras ventanas; no calcular estados privados antes/después. No enviar If-Match en perfil. Conservar la restricción visual vigente del nombre de Digitador/Público y los campos administrativos de solo lectura. Actualizar identidad después del PATCH y mostrar unicidad/errores por campo.

**Cierre:** cancelación sin solicitud, contraseña incorrecta sin cambio, tres errores cierran sesión compartida, cambio correcto persistente tras recarga y rechazo de campos no autorizados. Comprobar que cambiar correo invalida recuperaciones anteriores sin cerrar la sesión vigente.

### 3. Usuarios

**UI:** `#usuarios`, listado, detalle, alta, edición, estado, eliminación y contraseña administrativa en `UserPages.tsx`. **Depende de:** 1–2.

**Endpoints:** GET/POST `/usuarios`, GET/PATCH/DELETE `/usuarios/:id`, PATCH `/usuarios/:id/password`.

**Implementación:** paginación/búsqueda/filtros reales, precarga y ETag para modificar estado/datos o eliminar. La contraseña administrativa exige confirmación del Admin y no usa If-Match. Obtener indicadores globales mediante `pagination.total` de consultas separadas, incluidos activos y administradores activos. Crear cuentas controladas Digitador/Público para las validaciones siguientes.

**Cierre:** CRUD autorizado; protección de cuenta propia/último Admin y nombre Público; 412 conserva formulario. Mostrar `USER_IN_USE` de H2 y las referencias adicionales de sesiones/auditoría que bloquean DELETE. Probar que rol/estado revocados dejan de autorizar otras pestañas. No importar las cuentas demo.

### 4. Roles y permisos

**UI:** `#roles`, `RolesPage` en `CatalogPage.tsx`. **Depende de:** 1 y 3.

**Flujo:** Admin consulta matriz → identifica responsabilidades → asigna un rol desde Usuarios.

**Endpoints:** no requiere un CRUD nuevo. Usa identidad/sesión reales y la asignación ya implementada en Usuarios.

**Cierre:** conservar la ventana informativa; acceso directo restringido a Admin y matriz consistente con el contrato maestro. Digitador/Público no acceden a esta ventana, aunque todos puedan consultar su propio rol en el perfil.

### 5. Cambiar contraseña

**UI:** `#password`, `ChangePassword` en `UserPages.tsx`. **Depende de:** 1–2.

**Endpoint:** PATCH `/me/password` con `{currentPassword,newPassword}`.

**Implementación:** sustituir token en memoria y aceptar cookie rotada; coordinar con refresh entre pestañas. No pedir una segunda confirmación adicional ni enviar If-Match. Mantener el ID/plazos de la sesión conservada y actualizar las pestañas para que restauren autorización vigente sin guardar tokens en almacenamiento.

**Cierre:** contraseña actual incorrecta no cambia datos; cambio correcto permite seguir y volver a ingresar con la nueva; otras sesiones quedan revocadas. Probar carrera con refresh y rechazo de la contraseña anterior.

### 6. Recuperar contraseña

**UI:** modo recover de `AuthPage.tsx`. **Depende de:** 1, cuentas de prueba del 3 y SMTP de integración.

**Endpoint:** POST `/auth/recover-password` con `{email}`.

**Implementación:** mostrar la respuesta genérica; retirar del modo API el enlace didáctico, cuentas y tokens del simulador. La UI no conoce si el correo existe ni si llegó a la bandeja. Mantener carga/errores de transporte separados del mensaje público.

**Cierre:** respuesta equivalente para cuenta inexistente/inactiva, límite de solicitudes y SMTP caído; solicitud autorizada a un buzón de pruebas recibe el enlace real. `mail:check` por sí solo no acredita entrega.

### 7. Restablecer contraseña

**UI:** modo reset de `AuthPage.tsx`; extracción de query en `App.tsx`. **Depende de:** 6.

**Endpoint:** POST `/auth/reset-password` con `{token,newPassword}`; éxito 204.

**Implementación:** reutilizar la extracción/eliminación de `token` de la URL visible y enviarlo al servidor. No persistirlo ni mostrarlo en logs. Si el enlace se abre con sesión vigente, permitir el flujo de recuperación sin confundirlo con el cambio personal autenticado.

**Cierre:** abrir enlace real → cambiar → volver al acceso → entrar con contraseña nueva. Rechazar token vencido, consumido o invalidado por cambio de correo; sesiones anteriores dejan de autorizar. El error conserva campos útiles sin fabricar otro token.

### 8. Parámetros generales

**UI:** `#parametros`, `SettingsPage.tsx`. **Depende de:** 1–2.

**Endpoints:** GET/PATCH `/parametros/publicaciones`.

**Implementación:** leer valores y ETag; guardar parcialmente con If-Match y confirmación. Resumen 10–1000 palabras, tamaño 1–25 MiB y formatos PDF/TXT, inicialmente 300/10/PDF. Invalidar las lecturas de parámetros usadas en archivos y publicaciones.

**Cierre:** modificación real y conflicto entre dos pestañas sin sobrescritura. Valores vigentes visibles en futuras cargas/formularios; reducir límites no altera archivos ni publicaciones anteriores. Digitador/Público no abren la ventana administrativa, aunque sus formularios pueden consultar los parámetros autorizados.

### 9. Autores

**UI:** `#autores`, `CatalogPage.tsx`. **Depende de:** 1–2.

**Endpoints:** GET/POST `/catalogos/autores`, GET/PATCH/DELETE `/catalogos/autores/:id`.

**Implementación:** completar el servicio compartido de catálogos, precarga/ETag, confirmación, paginación y totales independientes de la página. Nombre requerido; CI/correo/ORCID opcionales. Selecciones de otras ventanas se invalidan tras cambios.

**Cierre:** Admin/Digitador crean/editan; solo Admin elimina. Duplicados normalizados y 412 visibles. H1: publicación activa bloquea inactivar; exclusivamente inactivas lo permiten; cualquier referencia histórica bloquea DELETE. Público no consulta el directorio personal. Usar fixtures auditados de API para estas relaciones hasta completar la ventana de publicaciones.

### 10. Tutores y orientadores

**UI:** `#tutores`, `CatalogPage.tsx`. **Depende de:** 9 para reutilizar su transporte.

**Endpoints:** las mismas operaciones bajo `/catalogos/tutores`.

**Implementación:** nombre requerido; CI/correo/especialidad opcionales; respetar el esquema propio, sin enviar ORCID de Autor. Mantener paginación, estado, ETag y confirmación.

**Cierre:** permisos Admin/Digitador y DELETE solo Admin; unicidad, estados, conflictos y relaciones N:M/históricas con la misma regla H1, sin duplicar validación del servidor.

### 11. Carreras

**UI:** `#carreras`, `CatalogPage.tsx`. **Depende de:** 9.

**Endpoints:** operaciones de catálogo bajo `/catalogos/carreras`.

**Implementación:** nombre requerido, código/descripcion opcionales; conservar unicidad del código cuando se informa. Mantenimiento solo Admin. Preparar selector activo para nuevas publicaciones y conservar referencias históricas seleccionadas al editar.

**Cierre:** CRUD real, vacío correcto, 412 y H1; datos permanecen después de recargar. Digitador/Público pueden consumir clasificaciones según el alcance API, sin obtener mantenimiento administrativo.

### 12. Facultades

**UI:** `#facultades`, `CatalogPage.tsx`. **Depende de:** 9.

**Endpoints:** operaciones de catálogo bajo `/catalogos/facultades`.

**Implementación:** nombre, sigla/descripcion opcionales, estados y unicidad. No agregar una relación Facultad–Publicación ni un campo de formulario que no existe en el contrato actual.

**Cierre:** mantenimiento solo Admin, paginación/ETag/confirmación y restricciones de referencias reales. La ventana vacía no se rellena automáticamente con muestras UNC del navegador.

### 13. Sedes y filiales

**UI:** `#filiales`, `CatalogPage.tsx`. **Depende de:** 9.

**Endpoints:** operaciones de catálogo bajo `/catalogos/filiales`.

**Implementación:** nombre, direccion/descripcion opcionales; mantener la correspondencia entre clave `filiales` y `branchId` de publicaciones.

**Cierre:** mantenimiento Admin, clasificaciones activas en nuevas cargas, preservación histórica y veto de DELETE con referencias. Error por tipo/UUID incorrecto no se convierte en lista vacía ficticia.

### 14. Tipos de publicación

**UI:** `#tipos`, `CatalogPage.tsx`. **Depende de:** 9.

**Endpoints:** operaciones de catálogo bajo `/catalogos/tipos`.

**Implementación:** nombre y descripcion opcional; mapear el selector a `typeId`; confirmar cambios/estados/bajas y conservar versión leída.

**Cierre:** mantenimiento Admin, unicidad, filtros y reglas H1. Una inactivación actualiza selectores sin perder la referencia de publicaciones históricas.

### 15. Niveles académicos

**UI:** `#niveles`, `CatalogPage.tsx`. **Depende de:** 9.

**Endpoints:** operaciones de catálogo bajo `/catalogos/niveles`.

**Implementación:** nombre y descripcion opcional; mapear a `levelId`. Reutilizar el servicio común sin mezclar IDs/tipos de catálogo.

**Cierre:** mantenimiento Admin, vacío/paginación/ETag/confirmación y H1. Los niveles quedan disponibles en nuevas publicaciones y filtros de consulta/reportes según estado y rol.

### 16. Carga de archivos

**UI:** `#archivos`, `AttachmentPage.tsx` y `attachmentService.ts`. **Depende de:** 1, 8 y ClamAV operativo.

**Endpoints:** GET/POST `/adjuntos`, GET `/adjuntos/:id`, GET `/publicaciones/:id/adjunto`.

**Implementación:** multipart con campo `file`, sin fijar manualmente su boundary; completar metadatos del POST mediante detalle/listado. Paginar/filtrar y obtener contadores por estado mediante totales de consultas. Conservar `reservedPublicationId` con el mapper H3; null no convierte un RESERVADO en disponible. Resolver la descarga por publicación, no mediante una URL pública del archivo. Transferir el ID al acceso Registrar publicación.

**Cierre:** PDF inicial y TXT habilitado, duplicados, archivo inválido y fallo de ClamAV con rechazo seguro. Digitador ve su alcance; Público no carga/descarga. Cancelar el formulario posterior conserva la carga confirmada. Descargar un archivo vinculado se valida con fixtures y se repite desde UI después del paso 17.

### 17. Publicaciones — gestión bibliográfica

**UI:** `#gestion-publicaciones`, listado, registro, detalle, edición e inactivación en `PublicationPages.tsx`. **Depende de:** 8–11 y 13–16; Facultades no es una dependencia del formulario.

**Endpoints:** GET/POST `/publicaciones`, GET/PATCH `/publicaciones/:id`, PATCH `/publicaciones/:id/estado`; consultas autorizadas de catálogos, parámetros y adjuntos.

**Implementación:** obtener selectores activos por página/búsqueda y conservar autores/tutores seleccionados en orden, incluidas referencias históricas permitidas en edición. Subir primero y enviar `attachmentId`; en alta omitir un ID ausente en lugar de enviar null, y en edición usar null solo para retirar vínculo. No enviar campos de lectura ni `approved` en PATCH. Mantener modalidades externa/local/copia obligatoria. Usar ETag real del detalle, confirmación y refresco tras mutación; conservar ID/código/creador/fecha. Eliminar las comparaciones contra State y versiones recalculadas del simulador.

**Cierre:** registro y edición completos, duplicados normalizados, conflictos 412 y error de auditoría sin falso éxito. Solo Admin inactiva. H3: A → B → recargar en otro navegador → recuperar A para su publicación original, sin uso en otra ni acceso indebido. La inactivación conserva historia y restringe consulta/descarga de otros roles. Validar el acceso a Reporte cuando el paso 20 esté conectado.

### 18. Catálogo bibliográfico

**UI:** `#publicaciones`, modo básico de `BibliographicPage.tsx`. **Depende de:** 1 y 17 para probar datos creados desde UI.

**Endpoints:** GET `/publicaciones`, GET `/publicaciones/:id` y descarga autorizada de adjunto cuando corresponda.

**Implementación:** enviar filtros/paginación al servidor; mantener resultados del FTS como fuente de verdad. Mostrar estados vacíos y detalle real, sin volver a filtrar únicamente la página recibida. Mostrar nombres bibliográficos sin cargar directorios privados para Público.

**Cierre:** los tres roles consultan; Público no recibe metadatos/descarga del adjunto. Admin puede consultar históricas; Digitador/Público solo activas. Recargar/detallar funciona sin haber abierto Gestión y sin datos locales previos.

### 19. Búsqueda avanzada

**UI:** `#busqueda`, modo avanzado de `BibliographicPage.tsx`. **Depende de:** 18.

**Endpoints:** GET `/publicaciones` con filtros documentados; catálogos autorizados para opciones.

**Implementación:** mapear clasificaciones, `author`/`tutor` por nombre, IDs cuando se seleccionen, año, origen y fechas de registro; omitir vacíos. No pedir directorios de autores/tutores a Público. Conservar selección histórica y descartar respuestas fuera de orden. No prometer coincidencias parciales de texto que FTS no soporta.

**Cierre:** filtros combinados con AND, fechas inclusivas de America/Asuncion, paginación y limpieza. Probar español/inglés y medir búsqueda desde navegador bajo las condiciones del proyecto; registrar resultados sin extender a producción las mediciones locales anteriores.

### 20. Reporte de investigaciones

**UI:** `#reportes`, `PublicationReportsPage` en `PublicationPages.tsx`. **Depende de:** 17 y 19.

**Endpoints:** GET `/reportes/publicaciones` y `/reportes/publicaciones/exportar`.

**Implementación:** filtros reales y entrada `publicationId` desde el detalle. Conservar snapshot opaco y permitir null en metadatos no exportables; exportar los mismos filtros, sin page/pageSize. Recibir PDF/Excel del servidor, no generarlos con datos de la página visible. Resolver opciones históricas mediante consultas paginadas y conservar seleccionadas las referencias del DTO.

**Cierre:** Admin exporta todo el conjunto filtrado hasta los límites documentados; vacío no descarga; conflicto exige consultar otra vez. Falla de auditoría no entrega bytes. Digitador/Público no consultan ni exportan. El botón Reporte del paso 17 abre y exporta exactamente la publicación elegida.

### 21. Auditoría

**UI:** `#auditoria`, `AuditPage.tsx`. **Depende de:** 3–20 para verificar eventos de los recorridos reales.

**Endpoints:** GET `/auditoria`, `/auditoria/:id` y `/auditoria/exportar`; GET `/usuarios` para opciones autorizadas de actores.

**Implementación:** mapear `username`, recursos/operaciones canónicos y snapshots antes/después sin asignar origen Anterior por ausencia de campos exclusivos del mock. Obtener total global y fallidos mediante consultas separadas. Construir opciones globales de módulos/operaciones recorriendo las páginas necesarias con caché e invalidación; no deducirlas de una sola página filtrada ni truncarlas silenciosamente. Conservar actores históricos de los eventos. Exportar selección completa con snapshot, incluido su caso null/vacío.

**Cierre:** Admin consulta, filtra, detalla y exporta; rol histórico y SIN_IDENTIFICAR se respetan. Eventos de acceso, cambios, rechazos, archivos y reportes aparecen con contexto del servidor y sin duplicación local. Probar snapshot conflictivo, límite, vacío y fallo de auditoría. Nunca añadir PATCH/DELETE de logs.

### 22. Inicio

**UI:** `#dashboard`, `Dashboard` en `App.tsx`. **Depende de:** todas las ventanas de destino.

**Endpoints:** GET `/auth/session` o `/me`, totales de `/usuarios` para Admin, consultas autorizadas de catálogos y otros recursos que alimenten los indicadores existentes. No se necesita inventar un endpoint Dashboard.

**Implementación:** reemplazar conteos basados en longitudes de ViewState por totales reales y consultas permitidas para cada rol. No presentar fallos de carga como cero ni como catálogo vacío. Omitir de modo API `DemoDataPanel`, cuentas de muestra y persistencia local de negocio. Revisar accesos rápidos, navegación directa y actualización tras mutaciones; completar el destino posterior al login.

**Cierre:** abrir una instalación sin localStorage/IndexedDB de demo y completar los recorridos enlazados por rol. Un equipo/navegador distinto consulta los mismos datos de servidor; sus sesiones siguen siendo independientes. Inicio refleja los cambios confirmados sin descargar toda la base ni consultar recursos prohibidos.

## Criterio de entrega de cada ventana

Cada paso se registra como pendiente, en implementación o verificado. Verificado significa que el flujo usa API/PostgreSQL reales, sus permisos y errores se comprobaron, los datos sobreviven a recarga y no hay fallback ni auditoría de negocio del simulador. Las relaciones que dependen de ventanas posteriores pueden comprobarse primero con fixtures creados por la API auditada en la base de integración; al cerrar Inicio deben repetirse por UI. No declarar validado un escenario solo porque se escribió su prueba.

Ejecutar build y las pruebas del cliente afectadas por transporte, sesión, confirmación, DTO o consultas. Mantener la regresión del mock como modo independiente. Si cambia código de servidor, ejecutar sus tipos/build y pruebas de dominio con PostgreSQL cuando corresponda. Los resultados anteriores de 87/348 pruebas son la línea base histórica, no un resultado garantizado de la conexión.

El cierre del paso 22 incluye la regresión integrada de todas las ventanas: sesión/401 entre pestañas, confirmación, ETags/412, H1, H2, H3, permisos Público, modalidades de publicaciones, archivos/ClamAV, exportaciones con snapshot/vacío y auditoría. Registrar la medición de búsqueda <=1,5 s en las condiciones acordadas. Mantener documentados los límites operativos de SMTP, almacenamiento, backups y despliegue.

## Alcance de archivos previsto

La implementación se concentra en `client/src/data/`, `App.tsx`, `useSession.ts`, `useMutationConfirmation.tsx` y la ventana correspondiente a cada paso. Añadir los módulos HTTP/sesión real necesarios sin refactors ajenos a la conexión. Los cambios de contratos deben reflejarse en la documentación de cliente/servidor; modificar servidor o migraciones solo si aparece una necesidad concreta y comprobada.

Este plan no incluye publicar el sistema ni importar automáticamente datos del simulador a PostgreSQL. Esas decisiones requieren un alcance propio. La entrega de conexión queda preparada cuando las 22 ventanas y la regresión integrada estén verificadas.
