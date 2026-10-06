# Plan de implementación — primera entrega utilizable

## Objetivo

Entregar una primera versión operativa del sistema que permita autenticarse, recorrer un menú completo por rol, administrar usuarios desde una cuenta ADMINISTRADOR, modificar el perfil y contraseña propios, recuperar contraseña y cerrar sesión. Las opciones aún no implementadas del menú deben aparecer claramente como pendientes/en construcción y no dar la impresión de que ya funcionan.

## Fuentes revisadas y estado inicial

- `AGENTS.md`: contrato maestro de negocio, seguridad, auditoría, API y ownership.
- `.opencode/agents/orchestrator.md`: flujo de orquestación, regla de guardar este plan en `.orchestrator/plan.md`, ownership y definición de terminado.
- `.opencode/agents/sa-security.md`, `sa-backend.md`, `sa-database.md`, `sa-frontend.md`: límites de dominio y criterios de seguridad, API, persistencia y UI.
- `PROJECT_CONTEXT.md` y `README.md`: contexto y requisitos generales del sistema.
- El repositorio no contiene código de aplicación versionado. Se recibieron acuerdos de dirección sobre stack, correo y estructura; se toman como decisiones del proyecto, no como evidencia de que ya existan servicios, credenciales operativas o código implementado.

## Alcance priorizado

1. Login y recuperación de contraseña.
2. Dashboard y menú con todas las áreas autorizadas para el rol, incluyendo accesos pendientes identificados como tales.
3. Mantenimiento de usuarios funcional para ADMINISTRADOR.
4. Edición del perfil y cambio de contraseña propios para todo usuario autenticado, sujeto a reglas seguras.
5. Cierre de sesión real, con invalidación de sesión.

Quedan fuera de esta primera entrega la implementación completa de publicaciones, catálogos, reportes y consulta/exportación de auditoría. Sus entradas aparecen en el menú de acuerdo con rol, pero quedan señalizadas como pendientes hasta que sus módulos existan.

## Contratos e invariantes

- Roles canónicos de `AGENTS.md`: `ADMINISTRADOR`, `DIGITADOR`, `PUBLICO`. La UI y API no deben introducir sinónimos o roles nuevos.
- Solo ADMINISTRADOR lista, crea, edita, busca/filtra e inactiva usuarios, y asigna roles. DIGITADOR y PUBLICO no reciben permisos de administración por tener elementos visibles en una UI.
- No permitir que el usuario cambie su propio rol/estado desde la edición personal; el cambio de contraseña personal exige verificación de la credencial actual o el flujo seguro de recuperación.
- Contraseñas almacenadas como hash seguro; nunca se devuelven en respuestas ni se registran en logs/auditoría.
- Login: tres fallos consecutivos bloquean la cuenta por cinco minutos; bloqueo por usuario, respuesta que no permita enumerar cuentas y registro de intentos exitosos/fallidos.
- Las operaciones sensibles de sesión y usuarios generan auditoría. Si falla la escritura de auditoría obligatoria, se cancela la operación que la requiere.
- Mantener API versionada `/api/v1`, paginación en listados y errores según Problem Details del contrato del proyecto.
- La recuperación sigue el contrato definido en `.orchestrator/decisions.md`: token aleatorio de un solo uso, hash persistido, expiración, respuesta anti-enumeración, canal SMTP institucional y revocación de sesiones. No enviar claves nuevas por correo ni revelar si la cuenta existe.
- El menú debe ocultar acciones prohibidas y mostrar todas las secciones aplicables al rol; módulos incompletos deben llevar estado “En construcción” y no ofrecer una navegación rota.

## Plan por partes

### Parte 0 — Descubrimiento técnico y contratos mínimos

**Estado:** `done` (dirección tecnológica y contratos de seguridad recibidos el 2026-10-06; precisión/verificación en implementación sigue siendo obligatoria)  
**Ownership:** orchestrator coordina; `sa-frontend`, `sa-backend`, `sa-security`, `sa-database` inspeccionan únicamente sus dominios si se inicia implementación.

- Stack decidido: Node.js 24+/TypeScript, Fastify, React/Vite/Tailwind, PostgreSQL/Prisma, Argon2id, JWT/refresh cookie, SMTP institucional, ClamAV/SHA-256, PDFMake/ExcelJS, carpetas `server/` y `client/`.
- Contratos de tokens, cookies, rotación/reutilización, logout atómico, inyección/diagnóstico SMTP, recuperación de 15 minutos, límites/anti-enumeración y revocación de sesiones están registrados en `.orchestrator/decisions.md`.
- El enfoque de FTS PostgreSQL con migración SQL `tsvector` + GIN y consulta parametrizada desde Prisma quedó decidido. La consulta debe buscar español e inglés para satisfacer `PROJECT_CONTEXT.md`, no solamente configurar el parser español.
- Los contratos de API mantienen `/api/v1`, Problem Details, roles de `AGENTS.md` y autorización backend. El contrato compartido debe evitar divergencia entre `server/` y `client/`.
- En implementación se comprobarán entorno, SMTP, compatibilidad de dependencias, esquema real y comandos; el repositorio aún no tiene aplicación versionada y estas decisiones no equivalen a pruebas ejecutadas.

**Criterio de salida:** satisfecho para comenzar desarrollo. La disponibilidad de SMTP y la ejecución/rendimiento de servicios se validan al implementar y desplegar; no bloquean el inicio del esqueleto ni del modelo.

### Parte 1 — Fundamento de cuentas, sesión, autorización y auditoría

**Estado:** `ready`; Parte 0 cerrada.  
**Ownership:** seguridad define/implementa auth, sesión, RBAC y auditoría; base de datos cubre cambios de persistencia; backend integra casos de uso/API.

- Asegurar modelo de usuario compatible con CI, email, nombre, usuario único, hash de contraseña, rol y estado.
- Crear persistencia acordada para `sesiones_usuario` y `tokens_recuperacion` en coordinación `sa-database`/`sa-security`; conservar hashes consumidos para detectar reutilización, expiración y vínculo con el usuario/familia de sesión. Las escrituras sensibles y `audit_logs` deben ser atómicas.
- Proveer cuenta ADMINISTRADOR inicial mediante mecanismo seguro y documentado; nunca incluir contraseña predeterminada fija en código ni habilitar registro público.
- Implementar sesiones y autorización del lado servidor; estados de usuario inactivo no autentican.
- Implementar auditoría de auth y administración, incluyendo actor, rol, operación, recurso, fecha, IP, User-Agent, ID de sesión, resultado y motivo cuando corresponda; no incluir secretos.
- Asegurar atomicidad entre mutación sensible y auditoría obligatoria.

**Criterio de salida:** existe un camino documentado para crear el primer administrador; sesiones y roles se validan en backend; esquema/migraciones aplicables; eventos críticos quedan auditados.

### Parte 2 — Login, bloqueo y recuperación de contraseña

**Estado:** `pending`; depende de Partes 0 y 1.  
**Ownership:** `sa-security` para controles y flujo seguro; `sa-backend` para endpoints/casos de uso; `sa-database` si se requiere persistir tokens/estado; `sa-frontend` para formularios y estados.

- Login con usuario y contraseña obligatorios, mensajes seguros, bloqueo tras 3 intentos consecutivos por 5 minutos, restablecimiento del contador según contrato y auditoría de éxito/fallo.
- Endpoints de sesión: `POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`, solicitud de recuperación y `POST /api/v1/auth/reset-password`; documentar request/response/error Problem Details antes de integrar UI.
- Recuperación con token criptográfico de 32 bytes (64 caracteres hex), almacenar solo SHA-256, válido 15 minutos y de un solo uso; límite 3 solicitudes por correo e IP por hora.
- Responder HTTP 200 con el texto genérico acordado tanto para cuenta activa como desconocida/inactiva; al consumir token, actualizar hash Argon2id y revocar todas las sesiones en una operación consistente.
- Si se reutiliza un refresh token consumido/revocado, generar alerta auditable e invalidar todas las sesiones activas de ese usuario.
- Enviar solo mediante SMTP configurado fuera del código. `transporter.verify()` al arranque: si falla, API sigue activa en modo degradado, envío deshabilitado y respuesta externa sigue genérica; generar señal operacional sin filtrar detalles/secretos.
- No registrar tokens. No enviar contraseñas temporales. Proteger reset frente a abuso y diferencias de enumeración.
- Frontend: login, enlace “Olvidé mi contraseña”, solicitud, confirmación y establecimiento de contraseña nueva; estados de carga/error/éxito accesibles.

**Criterios de aceptación:** login válido/inválido; usuario inexistente sin enumeración; tercer fallo bloquea cinco minutos; cuenta bloqueada no autentica; recuperación válida, vencida, reutilizada y desconocida; respuestas genéricas HTTP 200; límites por correo/IP; SMTP degradado no detiene API ni filtra detalles; refresh rota; reutilización revoca sesiones; al reset la contraseña anterior deja de funcionar, la nueva funciona y todas las sesiones previas quedan revocadas; auditoría no contiene contraseña/token.

### Parte 3 — Dashboard y menú completo por rol

**Estado:** `pending`; depende del contrato de sesión/roles de Parte 1 y navegación API/UI descubierta en Parte 0. Puede desarrollarse en paralelo con pruebas de mantenimiento una vez fijado el contrato de permisos.

**Ownership:** `sa-frontend`; backend/security solo si se detecta falta de datos o autorización en el contrato.

- Construir shell autenticado con dashboard, usuario/rol actual y rutas protegidas.
- Mostrar inventario de módulos alineado a `AGENTS.md` y las definiciones del agente frontend: publicaciones/búsqueda, usuarios, catálogos y parámetros, reportes, auditoría; añadir autores/tutores según el rol y funcionalidades establecidas.
- Respetar permisos: PUBLICO consulta metadatos; DIGITADOR gestiona publicaciones y descarga autorizada; ADMINISTRADOR ve administración, reportes y auditoría. No mostrar descarga para PUBLICO.
- Incluir todas las secciones relevantes aunque aún no tengan módulo funcional, con indicador “En construcción”, sin simular datos ni enlazar a pantallas rotas.
- Incluir enlaces a “Mi perfil”, “Cambiar contraseña” y “Cerrar sesión” en el área de cuenta.

**Criterios de aceptación:** menú estable al recargar; navegación y rutas directas protegidas; opciones visibles según rol; áreas pendientes se distinguen y no prometen acciones inexistentes; dashboard maneja estado vacío.

### Parte 4 — Mantenimiento de usuarios (ADMINISTRADOR)

**Estado:** `pending`; depende de contratos de Partes 0–1; UI integrada después de Parte 3.  
**Ownership:** `sa-backend` para API/reglas, `sa-database` para constraints/migración, `sa-security` para RBAC/auditoría, `sa-frontend` para pantallas. Orchestrator fija contrato antes de ejecución cruzada.

- Listar con paginación; buscar/filtrar; ver detalle; crear usuario; modificar datos/rol/estado; inactivar preservando historia.
- Validar unicidad de CI, email y usuario de acuerdo con modelo, tanto en aplicación como mediante garantías persistentes contra concurrencia.
- Asignar solo roles canónicos. Público no puede auto-registrarse.
- Definir flujo de credenciales iniciales que no exponga contraseñas; preferir invitación/activación o establecimiento por recuperación conforme al canal disponible.
- Proteger toda ruta/operación exclusivamente en backend y auditar altas, modificaciones, cambios de rol e inactivaciones con valores antes/después sin secretos.

**Criterios de aceptación:** ADMIN puede completar operaciones permitidas y recibe errores claros de duplicidad; DIGITADOR/PUBLICO reciben rechazo del servidor incluso invocando endpoints directamente; inactivación conserva el registro y revoca acceso; fallo de auditoría cancela la mutación.

### Parte 5 — Perfil propio y cambio de contraseña

**Estado:** `pending`; depende de sesión de Parte 1 y endpoints/contratos de Parte 0.  
**Ownership:** backend para reglas/API; security para reautenticación, política de contraseña, invalidación de sesiones y auditoría; frontend para formularios; database si requiere cambios persistentes.

- Consultar y modificar únicamente campos personales permitidos definidos por el modelo (no rol, estado o identidad administrativa).
- Cambiar contraseña con contraseña actual, nueva y confirmación; aplicar política acordada, guardar hash, evitar secretos en errores/logs y definir invalidación de otras sesiones.
- Auditar cambio de perfil y contraseña sin guardar valores secretos.

**Criterios de aceptación:** un usuario no puede leer/editar perfil ajeno ni elevar permisos; contraseña actual errónea rechazada; éxito invalida la credencial anterior; sesión continúa o se revoca según contrato explícito; auditoría segura.

### Parte 6 — Cierre de sesión e integración de flujos

**Estado:** `pending`; depende de Parte 1 (puede integrarse al terminar Parte 2 mientras continúan las Partes 3–5).  
**Ownership:** security/backend para invalidar sesión y registrar logout; frontend para acción y navegación.

- `POST /api/v1/auth/logout` revoca la sesión en PostgreSQL y registra logout/duración en `audit_logs` de forma atómica; ante fallo de audit, no reportar operación exitosa.
- Expirar cookie con `Set-Cookie` y atributos coincidentes (no existe encabezado estándar `Clear-Cookie`); limpiar estado local, navegar a login y bloquear rutas sin sesión.
- Rechazar access token ligado a sesión revocada; limitar vida máxima del access token a 15 minutos.
- Asegurar logout por expiración/revocación donde corresponda y no confiar solo en ocultar el menú.

**Criterios de aceptación:** la sesión deja de servir tras logout; rutas autenticadas exigen volver a iniciar sesión; evento auditado con duración cuando corresponda; fallo o repetición no crea sesión residual.

### Parte 7 — Validación integrada y entrega de primera versión

**Estado:** `pending`; depende de Partes 2–6.

- Validar flujos completos por rol: login → dashboard/menú → acción autorizada → perfil/cambio de contraseña → logout; recuperación completa.
- Revisar matriz de permisos en UI y backend, Problem Details, paginación, auditoría y secretos.
- Ejecutar pruebas existentes y nuevas apropiadas en cada dominio; revisar migraciones en base limpia y regresión integrada.
- Resolver hallazgos bloqueantes y dejar riesgos conocidos explícitos. No declarar alcance completo si falla un criterio.

## Contrato de recuperación definido

El canal es SMTP institucional y se utilizará el contrato de `.orchestrator/decisions.md`: token de un solo uso con vencimiento de 15 minutos y almacenamiento por hash; HTTP 200 genérico; rate limit por correo/IP; cambio de hash Argon2id y revocación de sesiones.

La disponibilidad y credenciales SMTP son una verificación operacional de despliegue, no una decisión de diseño pendiente. El backend lee secretos inyectados, y si SMTP no está disponible mantiene la API activa en modo degradado sin revelar el estado a usuarios externos.

## Evaluación del estado técnico recibido

- **Correcto como línea base:** stack y separación `server/`/`client/` dan dirección para iniciar; seed por secretos de entorno evita una contraseña fija; `/api/v1` y Problem Details coinciden con el contrato maestro.
- **Cerrado:** Fastify, contrato de access/refresh, recuperación, SMTP por secretos y camino de FTS están definidos en `.orchestrator/decisions.md`.
- **Precisiones de implementación ya incorporadas:** CSRF/origin para endpoints con cookie, Set-Cookie expirado para logout, retención de hashes refresh consumidos para detección de reutilización y consulta FTS bilingüe real. No cambian la selección tecnológica.
- **Resultado:** suficiente para iniciar desarrollo. La verificación de SMTP, compatibilidad de versiones, esquema, integración y métricas queda como validación de implementación; no puede marcarse como hecha antes de existir código.

## Paralelismo y dependencias

- Parte 0 precede cualquier implementación.
- Parte 1 establece sesión, modelo y permisos comunes antes de integrar login, menú y operaciones de usuario.
- Una vez fijados contratos, backend/API y UI pueden avanzar en paralelo cuando consuman el mismo contrato; seguridad y persistencia deben preceder los flujos que dependan de sus garantías.
- El menú puede maquetarse con el catálogo de roles mientras se construye API, pero su integración/aceptación espera a la fuente efectiva de permisos.
- El mantenimiento de usuarios necesita coordinación de los cuatro dominios; no delegar a frontend/backend cambios de ownership ajeno.
- Logout puede implementarse antes de que termine el mantenimiento de usuarios si la sesión ya está disponible.

## Riesgos y pendientes iniciales

- No hay código fuente del producto en Git; confirmar al iniciar si la implementación aún no comenzó o vive fuera de este repositorio.
- Versiones y comandos ejecutables deben confirmarse al inicializar server/client; FTS y seguridad aún no tienen validaciones reales.
- Credenciales/disponibilidad SMTP deben confirmarse en cada entorno, sin bloquear el diseño ni exponer el estado a usuarios externos.
- El alta inicial de ADMINISTRADOR y la entrega segura de credenciales son prerrequisitos operativos.
- “Menú completo” requiere inventario por rol del alcance maestro; opciones aún pendientes deben ser visibles sin presentarse como operativas.

## Estado del plan

- Implementación: no iniciada en este repositorio; las decisiones técnicas iniciales ya están definidas.
- Parte 0: `done`; Parte 1: `ready`.
- Próximo paso: iniciar Parte 1, inspeccionando nuevamente el estado real del repositorio y respetando ownership antes de modificar archivos de dominio.
