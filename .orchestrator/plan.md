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
- La política de recuperar contraseña no está especificada en las fuentes revisadas. Antes de construirla, cerrar contrato de token de un solo uso, expiración, invalidación, respuesta genérica y canal de entrega. No enviar claves nuevas por correo ni revelar si la cuenta existe. Seleccionar mecanismo/canal según el entorno real descubierto.
- El menú debe ocultar acciones prohibidas y mostrar todas las secciones aplicables al rol; módulos incompletos deben llevar estado “En construcción” y no ofrecer una navegación rota.

## Plan por partes

### Parte 0 — Descubrimiento técnico y contratos mínimos

**Estado:** `done_with_gates` (acuerdos de dirección recibidos; hay decisiones puntuales que deben cerrarse antes de implementar sus componentes)  
**Ownership:** orchestrator coordina; `sa-frontend`, `sa-backend`, `sa-security`, `sa-database` inspeccionan únicamente sus dominios si se inicia implementación.

- Dirección recibida: Node.js 24+ y TypeScript; React/Vite/Tailwind; PostgreSQL/Prisma; Argon2id; JWT con refresh cookie HttpOnly; ClamAV y SHA-256 para PDF; PDFMake/ExcelJS; carpetas `server/` y `client/`; `/api/v1` y Problem Details.
- Dirección recibida de SMTP institucional y bootstrap ADMINISTRADOR desde secretos de entorno, sin credenciales por defecto en código.
- Cerrar Express **o** Fastify antes de iniciar rutas/backend: el mensaje enumera ambos y no elige uno.
- Antes de implementar auth, fijar en contratos: access/refresh TTL, rotación/reutilización, revocación y almacenamiento de refresh, protección CSRF para cookies, expiración de recuperación, rate limits y política de sesiones tras reset/cambio de contraseña.
- Confirmar operativamente que SMTP está disponible en el entorno de ejecución. SMTP solo se configura con secretos fuera del repositorio (variables de entorno/gestor de secretos); nunca valores reales en archivos versionados o código.
- Definir contratos de auth/usuarios/auditoría consumidos por frontend y backend, con formato Problem Details, permisos y paginación donde aplique. La estructura independiente `server/`/`client/` no debe producir contratos duplicados incompatibles.
- Prisma/PostgreSQL FTS requiere validar versión/funcionalidad elegida. No asumir soporte nativo completo de `tsvector` ni de índices funcionales: si se usa Prisma, cubrir índices/consultas necesarias con migraciones SQL/TypedSQL y pruebas, o registrar alternativa.
- Validar en implementación el entorno y comandos de ejecución; no hay aplicación versionada que permita probar ya el stack.

**Criterio de salida para cerrar las compuertas:** framework backend elegido; contrato de sesión/cookies y recuperación documentado; mecanismo seguro de secretos y disponibilidad SMTP confirmados; enfoque de Prisma/FTS documentado. La estructura y librerías de frontend se pueden comenzar a preparar mientras se cierran los contratos que las afectan.

### Parte 1 — Fundamento de cuentas, sesión, autorización y auditoría

**Estado:** `ready_with_gates`; depende de Parte 0. Se puede iniciar modelado de usuarios/auditoría y el esqueleto de client/server; endpoints y sesión quedan sujetos al cierre de contratos listados en Parte 0.  
**Ownership:** seguridad define/implementa auth, sesión, RBAC y auditoría; base de datos cubre cambios de persistencia; backend integra casos de uso/API.

- Asegurar modelo de usuario compatible con CI, email, nombre, usuario único, hash de contraseña, rol y estado.
- Proveer cuenta ADMINISTRADOR inicial mediante mecanismo seguro y documentado; nunca incluir contraseña predeterminada fija en código ni habilitar registro público.
- Implementar sesiones y autorización del lado servidor; estados de usuario inactivo no autentican.
- Implementar auditoría de auth y administración, incluyendo actor, rol, operación, recurso, fecha, IP, User-Agent, ID de sesión, resultado y motivo cuando corresponda; no incluir secretos.
- Asegurar atomicidad entre mutación sensible y auditoría obligatoria.

**Criterio de salida:** existe un camino documentado para crear el primer administrador; sesiones y roles se validan en backend; esquema/migraciones aplicables; eventos críticos quedan auditados.

### Parte 2 — Login, bloqueo y recuperación de contraseña

**Estado:** `pending`; depende de Partes 0 y 1.  
**Ownership:** `sa-security` para controles y flujo seguro; `sa-backend` para endpoints/casos de uso; `sa-database` si se requiere persistir tokens/estado; `sa-frontend` para formularios y estados.

- Login con usuario y contraseña obligatorios, mensajes seguros, bloqueo tras 3 intentos consecutivos por 5 minutos, restablecimiento del contador según contrato y auditoría de éxito/fallo.
- Recuperación por solicitud y consumo de token aleatorio, de un solo uso, con vencimiento e invalidación tras cambio. Persistir solo hash del token cuando la arquitectura lo permita.
- Responder igual ante cuenta existente/inexistente; aplicar límites de solicitudes y no revelar secretos. No registrar tokens.
- No permitir el cambio de contraseña hasta validar el token; al completarlo invalidar el token y las sesiones según política acordada.
- Frontend: login, enlace “Olvidé mi contraseña”, solicitud, confirmación y establecimiento de contraseña nueva; estados de carga/error/éxito accesibles.

**Criterios de aceptación:** login válido/inválido; usuario inexistente sin enumeración; tercer fallo bloquea cinco minutos; cuenta bloqueada no autentica; recuperación válida, vencida, reutilizada y desconocida; contraseña anterior deja de funcionar y nueva contraseña funciona; auditoría no contiene contraseña/token.

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

**Estado:** `pending`; depende de Partes 1–5 (puede integrarse al terminar Parte 2 si las demás continúan).  
**Ownership:** security/backend para invalidar sesión y registrar logout; frontend para acción y navegación.

- Invalidar en servidor la sesión/token según mecanismo real; limpiar estado local; navegar a login y bloquear back/direct URLs sin sesión.
- Registrar logout y tiempo de sesión conforme al mecanismo de auditoría.
- Asegurar logout por expiración/revocación donde corresponda y no confiar solo en ocultar el menú.

**Criterios de aceptación:** la sesión deja de servir tras logout; rutas autenticadas exigen volver a iniciar sesión; evento auditado con duración cuando corresponda; fallo o repetición no crea sesión residual.

### Parte 7 — Validación integrada y entrega de primera versión

**Estado:** `pending`; depende de Partes 2–6.

- Validar flujos completos por rol: login → dashboard/menú → acción autorizada → perfil/cambio de contraseña → logout; recuperación completa.
- Revisar matriz de permisos en UI y backend, Problem Details, paginación, auditoría y secretos.
- Ejecutar pruebas existentes y nuevas apropiadas en cada dominio; revisar migraciones en base limpia y regresión integrada.
- Resolver hallazgos bloqueantes y dejar riesgos conocidos explícitos. No declarar alcance completo si falla un criterio.

## Contrato de recuperación a resolver antes de implementar

Las fuentes actuales no definen canal de entrega, duración del token ni políticas de sesiones tras recuperar contraseña. Parte 0 debe verificar el entorno y acordar valores/operación. Requisitos no negociables del plan: token aleatorio, de un solo uso, con vencimiento; persistencia protegida; respuesta anti-enumeración; no enviar contraseña temporal; invalidación después del uso; auditoría sin token/clave. Si no hay canal verificable disponible, exponer una experiencia honesta de recuperación no operativa solo si el usuario aprueba un alcance alternativo; no afirmar que recuperar contraseña funciona.

La actualización propone SMTP institucional; esto cubre una opción de canal, pero no confirma por sí solo que las credenciales estén instaladas/disponibles en los entornos. El backend debe leerlas de configuración secreta inyectada y fallar de forma segura si no están configuradas, sin exponerlas en logs ni respuestas.

## Evaluación del estado técnico recibido

- **Correcto como línea base:** stack y separación `server/`/`client/` dan dirección para iniciar; seed por secretos de entorno evita una contraseña fija; `/api/v1` y Problem Details coinciden con el contrato maestro.
- **Debe precisarse antes de implementación dependiente:** Fastify o Express; semántica completa JWT/refresh/logout y protección CSRF; parámetros del token de recuperación y disponibilidad real del SMTP.
- **Corrección de seguridad:** no configurar credenciales SMTP literalmente “directamente en backend”. El código lee nombres de variables; valores reales van en `.env` local ignorado o en el gestor de secretos del entorno, nunca en Git, `.env.example`, imagen o logs.
- **Matiz de persistencia:** Prisma no elimina la necesidad de SQL/migraciones especiales para índices y consultas `tsvector`. El contrato maestro exige FTS PostgreSQL medible y apropiado para español/inglés; el equipo de base de datos debe verificarlo, no asumir que la elección del ORM lo resuelve.
- **Resultado:** las definiciones son suficientes para iniciar tareas preparatorias de Parte 1 (estructura/modelado y contratos), pero no para terminar ni integrar auth ni declarar Parte 0 completamente cerrada. No existe aplicación en Git sobre la cual comprobar estas selecciones.

## Paralelismo y dependencias

- Parte 0 precede cualquier implementación.
- Parte 1 establece sesión, modelo y permisos comunes antes de integrar login, menú y operaciones de usuario.
- Una vez fijados contratos, backend/API y UI pueden avanzar en paralelo cuando consuman el mismo contrato; seguridad y persistencia deben preceder los flujos que dependan de sus garantías.
- El menú puede maquetarse con el catálogo de roles mientras se construye API, pero su integración/aceptación espera a la fuente efectiva de permisos.
- El mantenimiento de usuarios necesita coordinación de los cuatro dominios; no delegar a frontend/backend cambios de ownership ajeno.
- Logout puede implementarse antes de que termine el mantenimiento de usuarios si la sesión ya está disponible.

## Riesgos y pendientes iniciales

- No hay código fuente del producto en Git: primero se necesita confirmar si la implementación aún no comenzó o vive fuera de este repositorio.
- Stack y comandos de validación desconocidos; no elegir tecnologías ni comandos hasta inspeccionar el entorno real.
- Recuperación requiere canal real (por ejemplo, servicio de correo institucional) y decisión de expiración/sesiones, actualmente no documentados.
- El alta inicial de ADMINISTRADOR y la entrega segura de credenciales son prerrequisitos operativos.
- “Menú completo” requiere inventario por rol del alcance maestro; opciones aún pendientes deben ser visibles sin presentarse como operativas.

## Estado del plan

- Implementación: no iniciada en este repositorio.
- Parte 0: decisiones de dirección recibidas; quedan compuertas explícitas antes de completar la implementación de auth y persistencia FTS.
- Próximo paso: iniciar Parte 1 en tareas preparatorias tras confirmar el estado real del repositorio; cerrar framework y contratos de sesión/secretos antes de implementar rutas de autenticación.
