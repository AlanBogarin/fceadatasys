# Conexión cliente–servidor: pasos 1–10 — 18/10/2026

**Ampliación posterior:** los [pasos 11–15](IMPLEMENTACION-CONEXION-PASOS-11-15-2026-10-18.md) ya están conectados y cuentan con su propia evidencia. Los estados y conteos siguientes conservan el cierre del alcance inicial 1–10; el estado acumulado vigente es 1–15 implementados y 16–22 pendientes.

El cliente implementa las diez primeras ventanas del [plan](PLAN-CONEXION-CLIENTE-SERVIDOR-2026-10-17.md), conservando un simulador independiente. La selección `VITE_DATA_MODE=api` usa la API y PostgreSQL. No importa cuentas, metadatos, adjuntos ni auditoría del navegador. Las ventanas 11–22 muestran que su conexión está pendiente; Inicio todavía no presenta indicadores reales y el destino después del acceso es Mi perfil. Esta entrega parcial corresponde al alcance solicitado y no representa la conexión completa de las 22 ventanas.

## Estado y evidencia por paso

| Paso | Estado | Comprobación realizada |
| --- | --- | --- |
| 1. Acceso/sesión | Verificado en integración local | Inicialización, cookie, restauración y segunda pestaña, segundo login rechazado con credenciales válidas, refresh sin ampliar actividad, cierre compartido, tres intentos y cinco minutos, diez minutos de inactividad y 401. Navegador real: acceso, recarga, segunda pestaña y cierre de ambas vistas privadas. |
| 2. Mi perfil | Verificado en integración local | GET/PATCH `/me`, contraseña incorrecta sin cambios, confirmación cancelada sin escritura, persistencia y actualización de identidad, tres confirmaciones fallidas revocan sesión; cambiar correo invalida recuperaciones y conserva la sesión. Se mantiene nombre de Digitador/Público de solo lectura. |
| 3. Usuarios | Verificado en integración local | Alta auditada de Digitador/Público, lista con totales globales, detalle/ETag, modificación, estado, eliminación sin vínculos y veto `USER_IN_USE` con historia/sesiones; protección propia/nombre Público, contraseña administrativa y revocación de rol/estado. 412 conserva la versión original hasta revisión. |
| 4. Roles | Verificado | Ventana informativa conservada, matriz con eliminación de personas y parámetros solo Admin; navegación directa aplica `canOpenPage`. Servidor comprueba roles en los recursos; no se añadió un CRUD de roles. |
| 5. Contraseña personal | Verificado en integración local | Contraseña actual errónea, cambio real concurrente con refresh, misma sesión/plazos, revocación de otras sesiones, rechazo de contraseña anterior y login con la nueva. No hay segunda confirmación ni If-Match. |
| 6. Recuperación | Verificado con buzón SMTP local | Respuesta genérica para cuenta inexistente/inactiva, límite de tres entregas por cuenta/hora y SMTP apagado; recuperación de disponibilidad después de reiniciarlo. Envío desde el transportador del servidor hacia un receptor SMTP real en loopback y recepción comprobada del enlace. La UI API no muestra cuentas, tokens ni enlaces didácticos. |
| 7. Restablecimiento | Verificado en integración local | Token recibido por correo, POST real, 204, consumo único, nueva contraseña, vencimiento e invalidación por cambio de correo. El token de query se retira de la URL y no se persiste; el flujo puede abrirse con una sesión vigente. |
| 8. Parámetros | Verificado en integración local | Lectura/ETag y PATCH parcial; persistencia, conflicto 412 y conservación de campos omitidos. Formulario real consultado en navegador. Rangos 10–1000 palabras, 1–25 MiB, PDF/TXT. |
| 9. Autores | Verificado en integración local y navegador | CRUD, opcionales, duplicados, paginación, confirmación y ETag. Navegador: cancelar alta, confirmar alta, conflicto entre dos pestañas, comparar versión A conservando borrador B, revisión explícita, nuevo guardado y persistencia tras recarga. H1/H2 comprobados con fixtures de API auditada. |
| 10. Tutores | Verificado en integración local | Mismo transporte, campos propios (`especialidad`, sin ORCID), creación/edición Digitador, DELETE solo Admin, duplicados/412 y referencias N:M activas/históricas H1. |

“Verificado en integración local” se limita a la evidencia indicada. Las pruebas automatizadas usan el adaptador real, los manejadores HTTP de Fastify y PostgreSQL; las llamadas del fixture pasan por `app.inject` y un jar de cookies que respeta el path de autenticación. La inspección de navegador usa HTTP real en `127.0.0.1:5173` → `127.0.0.1:3000`, con cookies, CORS y ETag expuesto. No se afirma que cada caso automatizado se haya repetido manualmente por UI.

## Composición y contratos

- `client/src/App.tsx` selecciona de forma explícita y diferida `ApiApp` o `MockApp`. Solo el simulador instancia `MockSessionStore`, carga `State`, genera muestras o persiste auditoría local. `navigation.ts` y `AccountMenu.tsx` conservan el menú común.
- `data/client.ts` define `DataClient` sin depender de `ReturnType<typeof createMockClient>`. `demo` es una capacidad opcional ausente en API. Los métodos de ventanas pendientes fallan explícitamente y no usan fallback.
- `data/http.ts` envía cookies con `credentials:include`, token Bearer de memoria y cuerpos JSON; omite filtros vacíos, propaga AbortSignal, preserva encabezados opacos y Problem Details/`invalid_params`. Una lectura puede reautorizarse una sola vez. Las mutaciones no se repiten por 401, 412, fallo de red o auditoría.
- `data/apiSession.ts` compone token pair y GET `/auth/session`, acepta actividad 204 y coordina inicialización/restauración/login/refresh/logout/contraseña mediante el mismo mutex entre pestañas. Conserva plazos del servidor; solo eventos humanos confiables envían actividad, con separación mínima de 15 segundos. Las señales de actividad actualizan las otras pestañas. Una consulta cada 30 segundos/foco detecta cambios sin renovar inactividad. Al alcanzar un plazo local se comprueba la sesión antes de asumir que otra pestaña no comunicó actividad.
- Access token, contraseñas y token de recuperación no se guardan en localStorage, sessionStorage ni IndexedDB. BroadcastChannel distribuye señales sin credenciales; su fallback en localStorage contiene únicamente tipo de señal/nonce. El fallback de exclusión de Web Locks usa IndexedDB sin datos de negocio.
- `useApiConfirmation.tsx` recoge efímeramente la contraseña del actor para PATCH/DELETE y la fachada la codifica en Base64 de UTF-8. Cancelar rechaza la operación antes de HTTP y conserva el formulario. Las altas piden confirmación visual. Perfil y contraseñas no envían If-Match; contraseña personal usa `currentPassword`.
- `useQuery` descarta respuestas anteriores e invalida lecturas después de mutaciones/cambios de sesión. Usuarios y catálogos obtienen sus indicadores mediante `pagination.total` de consultas independientes; no son un snapshot atómico conjunto. Carga/error/vacío son estados distintos y la ausencia de respuesta no se presenta como cero.
- Los formularios conservan su ETag inicial y los datos ingresados ante 412. Consultan el DTO vigente, permiten compararlo y solo adoptan la versión que el usuario efectivamente revisó. Estado y eliminación aplican el mismo criterio. `CONFIRMATION_EXPIRED` requiere confirmar otra vez y no cierra por sí solo la sesión compartida.
- No se modificaron endpoints, cuerpos, códigos del servidor ni migraciones. Las reglas de unicidad, vínculos, permisos y auditoría siguen en el servidor. Los archivos de contrato API permanecen vigentes.

## Preparación y reproducción

Se utilizó PostgreSQL **18.3**, clúster aislado del proyecto en `127.0.0.1:55439`, base **`fceadatasys_client_connection_test`**, rol runtime limitado **`fcea_test_app`** y bootstrap auditado. Se aplicaron y verificaron las siete migraciones existentes hasta `20261017010000_summary_limits`, además de `server/scripts/runtime-grants.sql`. No se migró desarrollo, una base institucional ni el almacenamiento del simulador.

Con el clúster aislado iniciado y roles existentes, desde `client/`:

```powershell
./test/setup-api.ps1 -Owner fcea_test -Runtime fcea_test_app
$env:CLIENT_API_TEST_DATABASE_URL = 'postgresql://fcea_test_app@127.0.0.1:55439/fceadatasys_client_connection_test'
npm run test:api
```

El script fija host, puerto y nombre de base, no lee `.env` del servidor, aplica migraciones/grants y crea el primer Admin con el bootstrap existente únicamente si no hay usuarios. No borra historia ni reemplaza credenciales. La suite rechaza otras bases o un rol privilegiado; cada ejecución crea identidades con sufijos únicos. Conserva los datos de prueba y su auditoría inmutable.

Para inspección manual en dos terminales, conservando esa variable de entorno:

```powershell
npm run dev:api:test
```

```powershell
$env:VITE_DATA_MODE = 'api'
$env:VITE_API_BASE_URL = 'http://127.0.0.1:3000/api/v1'
npm run dev -- --port 5173 --strictPort
```

La cuenta inicial **exclusiva de esta base de pruebas** es `integration-admin` / `ConexionCliente2026!`. No se utiliza como cuenta de producción ni pertenece al simulador. `test/serve-api.ts` expone únicamente la API existente en loopback. `test/api-fixture.ts` ejecuta un receptor SMTP local que no entrega mensajes a servicios externos. Solo ese fixture permite SMTP en texto plano sobre loopback; el transportador normal del servidor conserva su requisito TLS. El cliente no contiene configuración SMTP.

## Validaciones

| Comando/recorrido | Resultado al 18/10/2026 |
| --- | --- |
| `client: npm test` | 98 aprobadas, 0 fallos, 0 omitidas; incluye las 87 anteriores. |
| `client: npm run test:api` | 14 aprobadas, 0 fallos, 0 omitidas, PostgreSQL real y recepción SMTP local. |
| `client: npx tsc -p tsconfig.api-tests.json` | Correcto; incluye fuentes del cliente y fixtures de integración. |
| `client: npm run build` | TypeScript/Vite correctos. |
| Navegador HTTP/CORS | Acceso, restauración, dos pestañas, confirmación/cancelación, alta, edición/412/revisión, persistencia y logout compartido comprobados. |
| Documentación y diff | 38 enlaces locales comprobados, sin destinos faltantes; `git diff --check` correcto. |

Las corridas iniciales detectaron dos errores de expectativas en fixtures (segundo login con credenciales inválidas y exigencia de ETag en POST de publicaciones, que requiere GET detalle), reutilización de IP de recuperación entre ejecuciones y un receptor incorrecto de `fetch` en navegador. Se corrigieron sin alterar las protecciones del servidor: cada ejecución ahora tiene direcciones de fixture independientes y se conserva una prueba del receptor de fetch. La corrida final pasó completa. No se presentan las corridas fallidas como aprobadas.

Evidencias: [registro persistente](../client/docs/evidencias/conexion-pasos-1-10-autores.png) y [comparación ante 412](../client/docs/evidencias/conexion-pasos-1-10-conflicto.png).

## Límites y trabajo posterior

Las ventanas 11–22, archivos/ClamAV, publicaciones por UI, catálogo bibliográfico, búsqueda/medición de 1,5 segundos, reportes, auditoría consultable e Inicio permanecen pendientes en modo API. Las relaciones de catálogos se comprobaron mediante fixtures creados por endpoints auditados; deben repetirse por UI al conectar publicaciones, como exige el plan.

El SMTP local acredita generación, recepción, uso del enlace, límite y respuesta durante caída/recuperación en integración, no entrega a un proveedor institucional ni disponibilidad de su TLS/credenciales. No se certifican backups, retención, despliegue, almacenamiento o infraestructura institucional. No se publicaron cambios.

Se conservan las advertencias conocidas: bundle de ExcelJS del simulador mayor de 500 kB y deprecación de consultas encoladas de `pg` durante integración. No impidieron las pruebas. No se requiere reversión de migraciones nuevas porque esta entrega no añade ninguna.

Al finalizar se cerraron los procesos temporales de API/Vite y se detuvo ordenadamente el clúster de pruebas. La base y sus registros auditados se conservan para nuevas comprobaciones.
