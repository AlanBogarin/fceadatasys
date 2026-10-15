# Plan de implementación del servidor e integración del frontend

**Revisado:** 2026-10-15. **Estado:** análisis terminado; implementación del servidor pendiente.

## Objetivo y alcance autorizado

Preparar la creación del servidor a partir del producto existente: una demostración frontend con usuarios, catálogos, registro de investigaciones externas y reportes. Convertir progresivamente esos flujos en operaciones persistentes, autorizadas y auditadas en PostgreSQL, conservando la interfaz útil.

La revisión actual permite analizar y actualizar documentación. No incluye escribir código de aplicación, inicializar el servidor, crear migraciones, instalar dependencias ni modificar datos existentes. Las etapas siguientes son trabajo futuro.

`AGENTS.md` prevalece sobre documentos secundarios y comportamientos de la demostración. Las decisiones técnicas previas se conservan en `decisions.md`, con las precisiones de esta revisión. Una entrada de menú no demuestra que el módulo esté implementado.

## Fuentes y evidencia

- `AGENTS.md`, requerimientos de `PROJECT_CONTEXT.md`, README general y del cliente.
- Plan y decisiones anteriores de `.orchestrator/`; ownership y responsabilidades de `.opencode/agents/`.
- `client/docs/TRANSACCION-Y-REPORTE.md`, casos de uso Markdown, Word de usuarios y fuentes PlantUML.
- Texto de `Manual de usuario FCEA Datasys.docx`: describe la demostración de octubre, sus límites y pantallas pendientes. Archivo no versionado preexistente; no modificado.
- `Normas APA 7.docx`: guía de presentación documental, no especificación funcional del servidor. Archivo no versionado preexistente; no modificado.
- Código de `client/src/`, manifiesto/lockfile, configuración Vite, pruebas y estado/historial de Git.
- `server/` existe vacío: sin manifiesto, rutas, esquema Prisma, migraciones, pruebas ni OpenAPI.

La revisión de Word fue textual, sin evaluación de diseño. `.manual-work/` contiene material auxiliar preexistente fuera del alcance. No se leyeron valores de `.env`.

## Estado real al 15 de octubre de 2026

| Área | Evidencia actual | Trabajo pendiente de servidor/integración |
|---|---|---|
| Interfaz | React 19, TypeScript, Vite, CSS propio y lucide-react | Reutilizar pantallas; no migrar estilos como requisito del backend |
| Usuarios | Alta, consulta, edición, perfil, contraseñas, estados y eliminación local condicionada | API, unicidad concurrente, permisos, auditoría y baja compatible con historia |
| Autenticación | PBKDF2/SHA-256 local, tres cuentas demo, bloqueo 3 fallos/5 minutos | Argon2id, sesiones centrales, JWT/refresh, revocación y auditoría |
| Sesión | ID y vencimiento en sessionStorage; bloqueo UI a los 10 minutos | Verificación central y contrato de actividad/reautenticación |
| Recuperación | Token creado/consumido en navegador, 15 minutos, continuación local | Token de servidor, SMTP, límites, respuesta genérica y revocación |
| Catálogos | Autores, tutores, carreras, facultades, filiales, tipos y niveles | Entidades tipadas, FK, consultas autorizadas, restricciones y auditoría |
| Publicaciones | Alta externa, detalle y búsqueda local por código/título/autor | API transaccional, paginación, edición, inactivación, consulta PUBLICO y FTS |
| Reportes | Filtros y PDF/Excel locales con jsPDF/ExcelJS, solo Admin en UI | Consulta/exportación de servidor, consistencia de criterios y vacío HTTP 200 |
| Auditoría | publicationAudit registra únicamente altas con datos mínimos | Auditoría transversal, rechazos, inmutabilidad y cancelación por fallo |
| Archivos/parámetros | En construcción; resumen fijo de 300 palabras | Parámetros persistentes y adjuntos seguros |
| API/BD | Ninguna implementación ni consumo HTTP encontrado | Fastify, PostgreSQL/Prisma, contratos y validación integrada |

Catálogo bibliográfico y búsqueda avanzada siguen en construcción incluso para PUBLICO. Ese rol debe consultar metadatos según el contrato maestro; actualmente esa función aún no existe.

## Cómo funciona hoy sin backend

1. `App.tsx` llama a `storage.load()`. Si falta estado local, `model.seed()` crea tres cuentas ficticias; si existe, se migra sin reinicializar usuarios.
2. `storage.ts` guarda `State` completo en localStorage bajo `fcea-datasys.frontend.v1`: usuarios con hashes/sales, recuperaciones, catálogos, publicaciones, vínculos y bitácora.
3. `AuthPage.tsx` y `userService.ts` verifican credenciales/permisos contra ese objeto. La sesión es un ID en sessionStorage; no hay prueba de identidad de servidor.
4. Servicios locales reciben `state` y `actorId`, preparan otro estado y devuelven `{ exito, mensaje, datos }`. `App.commit()` verifica plazo local, compara el estado anterior, guarda todo y actualiza React.
5. Comparar JSON y escuchar `storage` reduce sobrescrituras evidentes entre pestañas; no proporciona aislamiento transaccional, bloqueo ni unicidad concurrente.
6. Usuarios/catálogos se filtran y paginan sobre arrays completos. Investigaciones filtra sin paginar. Sus referencias guardan ID y nombre, incluidos nombres históricos de participantes.
7. `publicationExports.ts` genera archivos en navegador desde datos locales. No existe autorización de servidor ni trazabilidad central de exportación.
8. No se encontró fetch, Axios, cliente HTTP, URL base API, consumo de `/api/v1` ni proxy Vite. Vite sirve la interfaz; no es el backend institucional.

`State` no puede convertirse en payload de API: expondría cuentas, hashes, sales y recuperaciones. El servidor debe devolver DTO por recurso y obtener actor/rol/sesión de autenticación verificada.

## Diferencias documentales y reglas para resolverlas

- Plan y decisiones anteriores afirmaban que no había aplicación; Git ya contiene frontend. Se corrige esa línea base, manteniendo backend como no iniciado.
- Secciones finales de `client/README.md` y casos de uso/Word de usuarios dicen que no hay investigaciones/reportes operativos. Son anteriores a la ampliación del 13/10; el documento de transacción, manual actual y código demuestran que existen localmente. Actualizar esas fuentes al integrar los módulos.
- El stack acordado menciona Tailwind/Shadcn/TanStack Query/Zod para frontend; el cliente usa CSS propio y no instala esas bibliotecas. No reconstruir la UI para iniciar servidor. Incorporaciones posteriores necesitan una finalidad concreta.
- PDFMake sigue siendo la decisión para servidor; jsPDF describe la demo. No confundir ambas ni cambiar dependencias del cliente durante esta revisión.
- `PROJECT_CONTEXT.md` usa ADMIN en algunos textos; roles canónicos de persistencia/API: ADMINISTRADOR, DIGITADOR, PUBLICO.
- Documentos secundarios sugieren inactivar todo catálogo referenciado. El contrato maestro impide inactivarlo si hay publicaciones activas asociadas; conservar referencias históricas.
- Digitador mantiene autores/tutores según contexto y frontend; no ampliar a catálogos generales, usuarios o parámetros. Necesita leer opciones activas de clasificación sin administrarlas.
- Trazar RN-01 (nombre Público solo lectura), RN-02 (baja condicionada por relaciones), RN-03 (inactividad informada tras contraseña válida) y RN-04 (10 minutos) a la API; no quitarlas silenciosamente. La eliminación física local de usuarios no define automáticamente un endpoint: revisar compatibilidad con historia/auditoría y priorizar inactivación.
- `approved` confirma una aprobación académica externa. No implementar evaluación/aprobación de tesis dentro del sistema.

## Contratos pendientes antes de integrar pantallas

Este inventario no es una API implementada. Salvo rutas fijadas en decisiones, formalizar nombres, payloads y errores antes de programarlos.

| Consumidor/flujo | Contrato necesario |
|---|---|
| AuthPage/useSession | Login, identidad actual, refresh, logout, solicitud/reset; cookies, expiración y reautenticación |
| Usuarios/perfil | Listado paginado, filtros, detalle, alta, actualización, estado, perfil propio y cambio personal/administrativo de contraseña |
| CatalogPage/selecciones | Recursos tipados, búsqueda/paginación, estado, unicidad, referencias y lectura de opciones activas para Digitador |
| Publicaciones | Alta, detalle, listado paginado, actualización, inactivación Admin, búsqueda/filtros y consulta PUBLICO |
| Parámetros | Lectura del límite/formatos por clientes autorizados; actualización Admin auditada |
| Reportes | Vista previa/exportación con iguales criterios, selección por publicación, zona America/Asuncion, vacío HTTP 200 sin archivo |
| Auditoría | Consulta paginada, filtros, detalle/exportación Admin; sin edición/eliminación |
| Adjuntos | Modalidad local/externa, carga, estado de revisión, metadatos y descarga autorizada; sin URL pública que eluda permisos |

Precisiones transversales:

- `/api/v1`, HTTP estándar, esquemas request/response, paginación estable, ordenamiento, límites y vacíos. Problem Details con campos de `AGENTS.md`; documentar cada código antes de usarlo.
- Mapear `name/email/orcid` locales a `nombre_completo/correo/orc_id` requeridos. DTO tipados; no guardar ciegamente `fields: Record<string,string>` ni usar snapshots como sustituto de FK.
- IDs, código visible INV generado concurrentemente por servidor sin contar arrays, fechas UTC, año de publicación y fecha institucional de registro como conceptos distintos.
- Autores N:M con orden/unicidad, tutores N:M sin repetidos y una filial. Definir nombres actuales frente a snapshots históricos tras editar catálogos.
- Corpus de equivalencias para normalización Unicode, acentos, puntuación y espacios. Conteo determinista compartido; `<= límite configurado`, 300 inicial. Documentar límites de caracteres actuales antes de trasladarlos.
- Política de contraseña, campos del perfil, nombre Público, último Admin y baja con relaciones. Propuesta a formalizar: cambio propio conserva sesión actual y revoca otras; cambio administrativo/reset revoca las de la cuenta afectada, manteniendo la del Admin que opera.
- Inactividad de 10 minutos con tiempo de servidor, actividad permitida y reautenticación definidos. Refresh automático no perpetúa una sesión inactiva; vigencia de refresh de 7 días no equivale a actividad.
- Refresh simultáneo entre pestañas: coordinar solicitudes para evitar revocaciones accidentales por rotación; probar carreras/reutilización sin relajar seguridad.
- Rechazos auditados: el evento de fallo no debe desaparecer con rollback de negocio. Diseñar transacción de rechazo separada cuando corresponda; fallo de auditoría cancela la operación. Login fallido/contador/bloqueo también requieren consistencia.
- SMTP, almacenamiento y bytes ya entregados no participan de una transacción única PostgreSQL. Documentar preparación, auditoría previa, entrega y compensación; no declarar atomicidad distribuida inexistente.

## Etapas y criterios de salida

### Etapa 0 — Línea base y preparación de contratos

**Estado:** análisis `done`; contratos detallados `pending`. **Responsable:** coordinación con backend, security, database y frontend.

Esta revisión cierra el inventario y conserva Node.js 24+/TypeScript, Fastify, PostgreSQL/Prisma, Argon2id y JWT/refresh. No equivale a validar entorno de servidor.

Próxima tarea: documentar API inicial auth/usuarios/perfil y matriz por operación; acordar esquema usuarios/sesiones/rotaciones/recuperación/auditoría; formalizar RN-01 a RN-04, revocaciones y errores. Preparar inventario de configuración sin secretos y comandos previstos de desarrollo/pruebas/migración.

**Salida:** DTO/errores revisables, contratos entre dominios y estrategia de integración definidos. SMTP operativo no es prerrequisito para diseñar servidor.

### Etapa 1 — Esqueleto de servidor y persistencia de seguridad

**Estado:** `pending`; depende de contratos iniciales de Etapa 0.

**Ownership:** backend para arranque/API; database para Prisma/migraciones/constraints; security para configuración, auth, autorización/auditoría. Coordinar archivos compartidos antes de modificar.

- Inicializar Fastify/TypeScript, configuración validada, Problem Details central y pruebas de integración. Verificar versiones compatibles al instalar.
- PostgreSQL/Prisma: usuarios, unicidad normalizada, sesiones, historial de hashes refresh, tokens de recuperación y auditoría completa. Proteger audit_logs contra UPDATE/DELETE; separar permisos de aplicación y migración.
- Mutación/auditoría transaccionales y auditoría de rechazos; secretos fuera de respuestas/logs.
- Bootstrap Admin idempotente con credenciales inyectadas, sin contraseña demo; diagnóstico operacional sin secretos.
- Migraciones probadas en base limpia, con recuperación/reversibilidad documentada y preservación de datos.

**Salida:** servidor ejecutable/probado, conexión real a BD de pruebas, bootstrap seguro y prueba de que fallo de auditoría impide cambios. Arranque HTTP solo no cierra etapa.

### Etapa 2 — Autenticación, sesión y recuperación reales

**Estado:** `pending`; depende de Etapa 1. **Ownership:** security/backend, database para persistencia, frontend al disponer de contratos.

- Argon2id; login con bloqueo concurrente 3 fallos/5 minutos, cuenta activa, auditoría y anti-enumeración conforme a RN-03.
- JWT 15 minutos solo en memoria; refresh 64 bytes aleatorios, SHA-256 persistido, 7 días, cookie HttpOnly/SameSite Strict/Path `/api/v1/auth`, Secure en producción y controles Origin/CSRF.
- Refresh rotatorio, detección de reutilización y revocación; comprobar sesión/usuario vigentes en cada operación para invalidar acceso antes de expirar JWT tras logout, baja o cambio de rol.
- Logout con revocación/duración auditadas atómicamente y Set-Cookie expirado. Inactividad central de 10 minutos y reautenticación coherente con UI.
- Recuperación: token 32 bytes, SHA-256, 15 minutos, uso único, límites por correo/IP, SMTP por secretos y modo degradado. Resolver precisión de mensaje genérico de decisiones.
- Sustituir recuperación local, cuentas demo y autenticación contra State en modo integrado. Fallo HTTP no habilita demo automáticamente.

**Salida:** pruebas de credenciales, bloqueo/concurrencia, expiración, reautenticación, rotación multiventana, reutilización, logout, SMTP degradado y reset. Revocación efectiva; consultas no devuelven hashes ni tokens de recuperación.

### Etapa 3 — Usuarios y perfil conectados

**Estado:** `pending`; depende de autorización/auditoría de Etapas 1–2.

**Ownership:** backend reglas/DTO, database integridad, security RBAC/revocación/auditoría, frontend servicios/páginas.

- API paginada con filtros, detalle, alta, edición, roles/estado; perfil propio y cambios de contraseña personal/administrativo.
- Conservar RN-01/RN-02 y protecciones Admin; evitar carreras que dejen cero Admin activos. Baja sin destruir referencias/auditoría; no copiar deleteUser sin revisión.
- Unicidad en aplicación/BD; actor de sesión, nunca actorId confiado al cliente. Auditar antes/después sin credenciales.
- Sustituir State/commit por HTTP, carga/error/vacío, actualización de consultas y errores por campo. No descargar todos los usuarios para validar duplicados o dashboard.

**Salida:** recorridos por rol desde dos clientes, persistencia tras reinicio, API directa rechazada sin permiso, revocación y rollback de auditoría probados.

### Etapa 4 — Catálogos y parámetros

**Estado:** `pending`; depende de seguridad/persistencia; puede avanzar junto a Etapa 3 tras cerrar DTO.

- Autores/tutores independientes; carreras, filiales, tipos y niveles. Facultades existe en UI sin vínculo a publicaciones: documentar finalidad, sin inventar FK obligatoria.
- Opcionales CI/correo/orc_id, mapeo, nombres únicos normalizados y reglas adicionales documentadas. No cambiar unilateralmente homónimos.
- Lectura de opciones activas para carga; Digitador mantiene autores/tutores, Admin generales; PUBLICO solo datos necesarios para consultar metadatos.
- Inactivación según referencias activas, historia conservada; eliminación física solo sin referencias y cuando se habilite explícitamente.
- Límite configurable (300 inicial), formatos (PDF inicial), cambios Admin auditados. Formato adicional solo con controles de seguridad compatibles.

**Salida:** frontend consume parámetros/catálogos por API, vacíos reales, permisos e integridad/concurrencia probados.

### Etapa 5 — Publicaciones externas y consulta bibliográfica

**Estado:** `pending`; depende de catálogos/parámetros y auditoría. **Ownership:** backend casos de uso/API, database modelo/FTS, security controles/auditoría, frontend pantallas/consumo.

- Alta externa con FK, N:M, orden, URL, código único y auditoría transaccional. IDs/fechas/creador del servidor; no aceptar State/bitácora del cliente.
- Duplicados normalizados de título/resumen/abstract protegidos contra carreras y sin permitir coexistencia al inactivar. Unicidad hash al incorporar adjuntos.
- Listado/detalle paginados, filtros, edición y control de referencias; solo Admin inactiva. Sin DELETE genérico de publicaciones.
- Consulta de metadatos PUBLICO; FTS español/inglés con GIN y consultas parametrizadas. Sin acceso indirecto a adjuntos.
- Corpus/condiciones de rendimiento explícitos; medir <=1,5 s y analizar SQL. Crear índice no demuestra cumplimiento.

**Salida:** alta → consulta desde otro cliente → edición → inactivación con historia; integridad/duplicados concurrentes; PUBLICO consulta sin mutar ni descargar.

### Etapa 6 — Reportes y consulta de auditoría

**Estado:** `pending`; reportes dependen de Etapa 5; consulta de auditoría puede adelantarse desde Etapas 1–2. **Ownership:** backend funcionalidad, security autorización/auditoría, database consultas/índices, frontend integración.

- Reportes Admin: fechas de registro inclusivas en America/Asuncion, nivel, carrera, publicación y criterios adicionales documentados como tipo/año.
- Vista previa/exportación con iguales criterios y datos autorizados; límites y consistencia definida si hay cambios entre consultas. PDFMake/ExcelJS servidor según decisión previa, conservando contenido útil actual.
- Vacío: HTTP 200 y payload definido sin archivo. Cliente distingue JSON vacío de respuesta binaria y no anuncia descarga inexistente.
- Auditoría: listado, filtros, detalle/exportación Admin; sin editar/borrar. Documentar trazabilidad aplicable a consultas/exportaciones.

**Salida:** API directa por rol, filtros/fechas, contenido PDF/Excel, vacío y trazabilidad comprobados; audit_logs no mutable con permisos de aplicación.

### Etapa 7 — Archivos locales seguros

**Estado:** `pending`; depende de publicaciones/parámetros/seguridad. No bloquea primer recorrido externo. **Ownership:** security validación/antimalware, backend flujo/API, database metadatos/hash, frontend carga/estados.

- Modalidad local/externa; archivo obligatorio cuando deba conservarse copia digital. Tamaño, extensión, MIME/contenido, nombre sanitizado, SHA-256 y unicidad concurrente.
- ClamAV según decisión previa: escaneo antes de circulación, indisponibilidad, cuarentena/limpieza y evidencia mínima auditada.
- Almacenamiento fuera de árbol público, descarga Admin/Digitador auditada antes de entrega; persistencia/almacenamiento con compensación de fallos.
- Infectado fuera de circulación; eliminación física excepcional conforme a seguridad/auditoría. Inactivar no borra historia.

**Salida:** PDF válido, extensión/MIME falsos, malware, scanner caído, hash repetido, permisos y fallos de auditoría/almacenamiento probados.

### Etapa 8 — Validación institucional y entrega

**Estado:** `pending`; depende de flujos incluidos en cada hito. **Responsable:** coordinación y validación por dominio.

- Pruebas integradas por rol, concurrencia PostgreSQL, rollback/migraciones, rendimiento FTS y frontend con servidor disponible/no disponible.
- Instalación, configuración sin secretos, backup/restauración, bootstrap, SMTP/antimalware degradados y recuperación operacional documentados.
- README, casos de uso/manual actualizados a funciones integradas. Preservar materiales preexistentes; revisión textual no equivale a QA visual Word.
- Modo integrado sin dependencia funcional de localStorage, credenciales demo, fallback, hashes ni permisos confiados al cliente.

**Salida:** Definition of Done global para alcance entregado, pendientes explícitos. Auth/usuarios integrados no equivalen al catálogo institucional completo.

## Transición de datos y frontend

- Conservar componentes, navegación, formularios/estilos. Cambiar solo puntos necesarios de servicios/estado/consultas en cada integración.
- No subir automáticamente localStorage ni importar cuentas demo, PBKDF2, sesiones, recuperaciones o bitácoras manipulables.
- Datos locales intactos. Si se requiere rescatar metadatos, importación separada, explícita, validada/auditada, con mapeo de IDs, duplicados y referencias.
- Cliente integrado recibe usuario actual y DTO autorizados; State global no será repositorio ni contrato HTTP.
- Si se mantiene demo para exposición, modo explícitamente separado, sin mezclar datos ni fallback ante errores de red.
- Validar navegador A/B: alta visible en ambos, recarga sin seed demo, revocación central y fallo HTTP que conserva formulario sin anunciar éxito.

## Validaciones de esta revisión

- `npm test` en client: **26 pruebas aprobadas, 0 fallos**; lógica local de usuarios, catálogos, sesión, registro/exportaciones. No prueba servidor ni recorridos completos de navegador.
- `npm run build` en client: **correcto**, TypeScript y Vite. Advertencia de chunks mayores de 500 kB, especialmente ExcelJS; evaluar al integrar exportación, sin refactor durante análisis.
- Entorno: Node v24.20.0, npm 11.19.0, CLI psql PostgreSQL 18.3 y ejecutable Docker disponibles. No se verificaron conexión/BD, versión real del servidor PostgreSQL, daemon Docker, SMTP ni ClamAV. Consulta de servicios Windows no accesible con permisos actuales; no demuestra servicios caídos.
- Sin migraciones, pruebas backend, antivirus, correo ni benchmarks FTS: no hay implementación que validar.
- Cambios limitados a `.orchestrator/plan.md` y `.orchestrator/decisions.md`, sin modificación de código de aplicación.

## Próximo hito y pendientes

Siguiente hito implementable: servidor + PostgreSQL + auditoría + autenticación + usuarios/perfil conectados (Etapas 0–3). Luego catálogos/parámetros, publicaciones y reportes. Diseñar relaciones bibliográficas al preparar Etapa 4, antes de sus migraciones.

Faltan contratos detallados, entorno operacional comprobado, esquema y código del servidor. Se puede comenzar diseño/esqueleto cuando se solicite implementación. SMTP/ClamAV condicionan aceptación de sus funciones, sin bloquear módulos independientes.
