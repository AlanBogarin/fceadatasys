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
