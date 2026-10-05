# Plan de implementación — primera entrega utilizable

## Objetivo

Entregar una primera versión operativa del sistema que permita autenticarse, recorrer un menú completo por rol, administrar usuarios desde una cuenta ADMINISTRADOR, modificar el perfil y contraseña propios, recuperar contraseña y cerrar sesión. Las opciones aún no implementadas del menú deben aparecer claramente como pendientes/en construcción y no dar la impresión de que ya funcionan.

## Fuentes revisadas y estado inicial

- `AGENTS.md`: contrato maestro de negocio, seguridad, auditoría, API y ownership.
- `.opencode/agents/orchestrator.md`: flujo de orquestación, regla de guardar este plan en `.orchestrator/plan.md`, ownership y definición de terminado.
- `.opencode/agents/sa-security.md`, `sa-backend.md`, `sa-database.md`, `sa-frontend.md`: límites de dominio y criterios de seguridad, API, persistencia y UI.
- `PROJECT_CONTEXT.md` y `README.md`: contexto y requisitos generales del sistema.
- El repositorio está limpio en `main`; no hay código de aplicación versionado ni plan/decisiones existentes en `.orchestrator/`. Por tanto, framework, estructura de aplicación, almacenamiento de sesión, persistencia y servicio de correo siguen por descubrir.

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

**Estado:** `ready`  
**Ownership:** orchestrator coordina; `sa-frontend`, `sa-backend`, `sa-security`, `sa-database` inspeccionan únicamente sus dominios si se inicia implementación.

- Confirmar con evidencia el stack y estructura de aplicación, base de datos/migraciones, proveedor de sesiones, pruebas disponibles y entorno de desarrollo.
- Determinar qué servicios de correo/recuperación están disponibles; documentar restricciones operativas antes de escoger proveedor.
- Definir un contrato común de auth, usuarios y navegación por rol: endpoints, payloads, estados, errores, paginación y permisos.
- Acordar persistencia requerida para bloqueo, recuperación y auditoría, reutilizando mecanismos existentes cuando sean adecuados.
- Revisar decisiones existentes y registrar en `.orchestrator/decisions.md` solo las decisiones nuevas que sean necesarias.

**Criterio de salida:** contratos revisados por los dominios consumidores/productores; stack confirmado; dependencias externas conocidas; sin decisiones técnicas inventadas.

### Parte 1 — Fundamento de cuentas, sesión, autorización y auditoría

**Estado:** `pending`; depende de Parte 0.  
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

- Implementación: no iniciada.
- Este artefacto es un plan; no se modificó código ni configuración del producto.
- Próximo paso al iniciar implementación: ejecutar Parte 0 y luego reevaluar dependencias, ownership, estructura, pruebas y cambios existentes antes de delegar modificaciones.
