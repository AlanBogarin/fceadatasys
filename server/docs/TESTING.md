# Pruebas de regresión del servidor

Las pruebas de server/test/unit se ejecutan sin PostgreSQL, SMTP ni servidor HTTP escuchando en un puerto. Usan funciones reales del servidor y sustituyen únicamente dependencias externas. Las comprobaciones del manejador HTTP emplean Fastify inject en memoria; son pruebas de componente dentro de la suite sin servicios.

## Ejecución habitual

Desde server/:

```powershell
npm run test:unit
npm run test:typecheck
npm run build
```

Ejecutar estos comandos después de cambiar autenticación, usuarios, validaciones, configuración, errores o transacciones. No requieren leer .env ni .env.test. No se agregaron bibliotecas de pruebas: se utiliza node:test, assert y tsx ya instalados.

Opcional: `npm run test:unit:coverage` muestra cobertura V8 de los módulos de src importados, excluyendo el punto de arranque. No se impone un porcentaje artificial ni se presenta esa medición como cobertura de todos los flujos del servidor.

## Comportamientos protegidos

| Área | Regresión que debe detectar |
| --- | --- |
| Identidad y validación | Usuario y autenticación normalizan la misma identidad; un PATCH no acepta campos de privilegios o credenciales fuera de su contrato |
| Reglas de usuarios | Nombre Público inmutable aun cambiando rol; protección de cuenta propia y último Admin sin bloquear cambios permitidos |
| DTO | Respuestas y auditoría reciben una proyección segura que excluye credenciales, tokens, claves normalizadas y contadores internos |
| Configuración | Orígenes exactos, HTTPS/cookies Secure en producción y SMTP coherente; errores no revelan valores secretos |
| Sesiones y roles | Una sesión revocada, inactiva o vencida no habilita otras funciones; el rol vigente procede de persistencia |
| Auditoría | Contexto confiable, anonimato cuando corresponde, ausencia de datos del body/cookie y fallo cerrado sin duplicar rechazos |
| Errores HTTP | Problem Details conserva estructura y códigos; errores internos o fallos de auditoría no filtran detalles sensibles |
| Transacciones | Solo conflictos de serialización se reintentan; duplicados y errores de auditoría se propagan sin repetir efectos |
| Recuperación | Política de contraseña, criptografía y límite concurrente de entregas siguen siendo coherentes |

Cada caso debe partir de datos independientes, incluir resultados esperados y rechazos relevantes, y evitar esperas basadas en tiempo real. Las pruebas no deben sustituir reglas del producto por otra implementación de esas mismas reglas.

## Límites de las pruebas unitarias

Los dobles de persistencia verifican cómo se usa una dependencia y cómo se propagan sus fallos. No demuestran transacciones ACID, claves foráneas, índices, grants, triggers ni concurrencia real PostgreSQL. Tampoco demuestran entrega SMTP o funcionamiento del frontend.

Las pruebas de integración previas se conservan separadas y requieren bases locales desechables configuradas según README.md. Si no se habilitan sus URLs se omiten; un skip no acredita su funcionamiento. No se modifica client/ para validar este servidor.

## Ampliación futura

Al añadir catálogos, publicaciones, archivos y reportes, incorporar casos que ejerciten sus contratos y regresiones con autorización/auditoría. Conservar casos de frontera, flujos permitidos y fallidos. Medir cobertura ayuda a encontrar huecos, pero no sustituye comprobar resultados de negocio ni permite garantizar que nunca habrá regresiones.

## Validación del 15 de octubre de 2026

Resultados históricos de la ampliación inicial de pruebas unitarias, anteriores al cierre de login/logout/sesión descrito a continuación.

- La suite sin servicios creció de seis casos originales a **98 pruebas aprobadas, sin fallos ni omitidas**, incluidos subcasos de permisos y fronteras. Seis casos de Problem Details son de componente en memoria; el resto ejercita funciones unitarias con dependencias aisladas.
- `npm run test:typecheck` aprobó la comprobación estricta de tipos de fuentes y pruebas unitarias.
- `npm run build` terminó correctamente con generación Prisma y compilación TypeScript.
- Las integraciones PostgreSQL anteriores se conservan separadas. No se ejecutaron contra PostgreSQL en esta ampliación de unitarias; su ejecución sigue requiriendo URLs de pruebas explícitas. Se conservaron los doce subcasos de seguridad HTTP.
- Comparación SHA-256 confirmó que client/, server/src/, server/prisma/ y el lockfile mantienen su contenido anterior. Los cambios son pruebas, comandos de ejecución, configuración de tipos de pruebas y documentación bajo server/.

## Regresión del cierre de autenticación y sesión

Esta ampliación agrega el contrato de `GET /api/v1/auth/session` y los casos de cierre/reautenticación, manteniendo las pruebas previas de usuarios, recuperación, autorización y auditoría. Los 98 casos del registro anterior corresponden a su propia entrega y se conservan como evidencia histórica.

| Flujo | Resultado que debe comprobarse |
| --- | --- |
| Consulta de sesión | DTO seguro por rol, fechas UTC y hora del servidor; leer repetidamente no cambia última actividad ni plazos |
| JWT | Firma/emisor/audiencia y claims obligatorios reales; `iat`/`exp` numéricos finitos incluso en logout; expiración no se ignora en consultas ni en operaciones protegidas |
| Login y bloqueo | Tres fallos concurrentes, bloqueo de cinco minutos, reinicio tras éxito y revalidación del username después del bloqueo de fila |
| Reautenticación | Un login correcto crea otro ID; finaliza las sesiones anteriores vencidas y conserva las que siguen activas |
| Logout | Cookie conocida o Bearer firmado permiten cerrar con JWT expirado o sesión inactiva; petición repetida devuelve 204 sin duplicar finalización |
| Conflicto de identidad | Bearer y cookie de distintas sesiones producen 403 sin revocar ninguna ni eliminar la cookie |
| Plazos y concurrencia | Tiempo comprobado después de adquirir los bloqueos; una espera no permite renovar una sesión ya vencida |
| Finalización | Revocación y duración efectiva se persisten junto a un único evento, aun ante solicitudes concurrentes o tardías |
| Fallo de auditoría | Login, actividad y cierre revierten sus mutaciones; no se anuncia éxito ni se limpia una cookie como si el cierre hubiera confirmado |
| Contratos vacíos | Refresh/logout/actividad rechazan campos adicionales; refresh inválido/desconocido limpia su cookie después de auditar el rechazo |

`test/unit/session-contract.test.ts` usa Fastify/JWT reales y persistencia sustituida para comprobar serialización y rechazo de credenciales. No abre puertos ni usa PostgreSQL/SMTP. Los otros dobles unitarios pueden comprobar orden de llamadas y relojes controlados; no prueban bloqueos o rollback reales. La evidencia de concurrencia, consumo/revocación y atomicidad requiere las suites PostgreSQL habilitadas explícitamente en bases aisladas.

La revisión final también debe ejecutar regresiones de usuarios/recuperación existentes y verificar que `client/` conserva sus 49 archivos rastreados. Cambiar las fuentes de sesión en esta fase no altera la evidencia histórica de que permanecieron intactas durante la ampliación anterior, limitada a pruebas.

### Resultados comprobados del cierre de sesión

- `npm run test:unit`: **116 aprobadas, cero fallos y cero omitidas**. Incluye las regresiones que avanzan el reloj durante la adquisición de bloqueos, JWT firmados con claims temporales inválidos, además de usuarios, recuperación, autorización, auditoría y contrato de sesión.
- `npm run test:typecheck`: correcto.
- `npm run build`: correcto, con generación Prisma 7.10.0 y compilación TypeScript.
- El coordinador comprobó que los 49 archivos rastreados de `client/` mantienen su SHA-256 del inicio de esta tarea.
- `npm run test:integration` con ambas URLs PostgreSQL runtime: **25 aprobadas, cero fallos y cero omitidas**. Son 23 subcasos de seguridad, su contenedor y la integración de usuarios. Comprueba bloqueo exacto, logout concurrente e idempotente, cookie/JWT expirado, identidad concurrente de login, expiración efectiva y rollback real de actividad, `LOGOUT` y `SESION_FINALIZADA`, además de usuarios y recuperación existentes.

La fase suma **141 aprobadas: 116 sin servicios y 25 con PostgreSQL real**, junto a build y comprobación de tipos correctos. El intento inicial bajo sandbox devolvió `EACCES` al conectar; se repitió mediante ejecución autorizada y las suites pasaron. Se distingue esa restricción del entorno de un fallo funcional o un rechazo automático. Los resultados anteriores se conservan como evidencia histórica independiente.

El cluster temporal quedó detenido, confirmado mediante `pg_ctl` (`server stopped` y `no server running`); el código 1 de la consulta de estado es el resultado esperado al estar detenido. Se conservaron sus datos bajo `server/.tmp/`. SMTP real, despliegue institucional e integración de navegador siguen fuera de esta evidencia.
