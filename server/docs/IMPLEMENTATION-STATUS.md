# Estado del primer hito de servidor

Fecha: 15 de octubre de 2026.

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
