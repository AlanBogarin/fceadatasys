# Cierre de conexión — pasos 21–22 — 18/10/2026

**Registro histórico.** Conserva el alcance y los resultados de su fecha original. Las menciones al simulador, tareas pendientes, ZIP y rutas de versiones anteriores no describen la distribución vigente. Consultar el [índice técnico actual](../../README.md) y el índice Word de Proyecto.

**Estado:** Auditoría e Inicio implementados y verificados contra API/PostgreSQL de integración. Las 22 ventanas del [plan](PLAN-CONEXION-CLIENTE-SERVIDOR-2026-10-17.md) están conectadas en modo API. La regresión completa pasó: 113 pruebas del cliente, 37 de API, tipos y build. Este cierre corresponde a integración local; no incluye publicación, importación del simulador ni operación institucional.

## Alcance e inspección

Se inspeccionaron `AGENTS.md`, el plan, los cambios existentes de los pasos 1–20, navegación/permisos, `AuditPage`, Inicio del simulador, servicios HTTP/sesión, contratos de auditoría y rutas reales del servidor. Se conservaron los cambios anteriores, los dos modos de datos y las siete migraciones. No se modificó código de servidor, dependencias ni esquema.

## Paso 21: Auditoría

- `client/src/data/apiAudit.ts` implementa GET de listado, detalle y exportación. Conserva `username`, recurso/operación canónicos, rol histórico, sesión, IP y snapshots seguros del servidor. No asigna origen «Anterior» por ausencia de campos del mock.
- Total global y fallidos globales proceden de consultas separadas de una fila; la selección utiliza su propio `pagination.total`. Ningún contador depende del tamaño de una página.
- Las opciones globales recorren todas las páginas de 100 eventos y todas las páginas de usuarios autorizados. Se deduplican módulos/operaciones y se unen cuentas actuales con actores históricos de los eventos. No hay límite silencioso ni opciones inferidas solo de los resultados filtrados.
- La caché mantiene únicamente las opciones en memoria. Comparte lecturas concurrentes y se vacía al cerrar/cambiar sesión, invalidar datos por mutaciones o señales entre pestañas y pulsar Actualizar resultados. Cancelar un consumidor no cancela a otro; abandonar la última lectura cancela el recorrido. Una página fallida o un cambio de cardinalidad produce error y exige actualizar, sin devolver opciones incompletas.
- `AuditPage.tsx` admite modo API sin `ViewState` privado. Consulta el detalle por ID, conserva filtros seleccionados mientras carga, distingue error/carga/vacío y presenta guiones cuando los totales no están disponibles. No escribe auditoría local de negocio.
- Exporta los mismos filtros y el snapshot opaco, sin paginación: PDF/Excel del conjunto completo. Snapshot null deshabilita la selección vacía/no exportable; el transporte reconoce HTTP 200 JSON vacío sin descargar. Conflicto, límite, indisponibilidad y fallo de auditoría conservan Problem Details. Tras exportar se invalidan consultas porque el servidor registra la operación.
- Solo Admin tiene navegación y autorización; no hay operaciones de edición/eliminación de logs.

## Paso 22: Inicio

`ApiDashboard.tsx` y `data/dashboard.ts` sustituyen el Inicio del simulador para modo API. Consultan `/me`, el total paginado de publicaciones dentro del alcance del actor y, solo para Admin, los totales de usuarios. Público/Digitador no consultan usuarios ni auditoría para construir Inicio. Las cuentas activas y publicaciones consultables usan totales del servidor, sin descargar esos conjuntos completos.

Se conserva identidad/rol/institución, se añade el indicador de publicaciones consultables y se filtran accesos rápidos con la misma matriz que la navegación directa. Carga, error y cero real son estados distintos; existe actualización explícita y las mutaciones/señales invalidan las consultas. Inicio es el destino posterior al login y el acceso de la marca institucional.

Modo API no instancia el almacén de negocio del simulador ni muestra `DemoDataPanel`, cuentas ficticias o recuperación didáctica. El servicio funciona con los contextos HTTP vacíos del fixture, sin localStorage/IndexedDB de demo. Los tokens permanecen en memoria; las señales entre pestañas no incluyen datos de negocio. El modo mock conserva su regresión independiente.

## Archivos y contratos del cliente

- Nuevos: `client/src/data/apiAudit.ts`, `client/src/data/dashboard.ts`, `client/src/ApiDashboard.tsx`, `client/src/data/apiAudit.test.ts` y `client/test/audit-dashboard.integration.test.ts`.
- Actualizados: `ApiApp.tsx`, `AuditPage.tsx`, `audit.ts`, `data/client.ts`, `data/apiClient.ts` y la expectativa anterior de auditoría pendiente en `data/http.test.ts`.
- `AuditEvent` admite `username`; `origin` y `resourceName` son opcionales porque el DTO HTTP no los ofrece. No se fabrican esos valores. Lecturas de auditoría admiten AbortSignal y `invalidateOptions` es una operación local de caché, sin endpoint nuevo.
- README raíz/cliente, `.env.example`, adaptaciones, plan y `server/docs/CLIENT-INTEGRATION.md` registran el estado final. Las entregas anteriores conservan sus evidencias fechadas.

## Validaciones ejecutadas

| Validación | Resultado |
| --- | --- |
| `client: npm test` | **113 aprobadas**, 0 fallos/omitidas; incluye mock y HTTP. |
| `client: npm run test:api` | **37 aprobadas**, 0 fallos/omitidas; cuatro suites en serie, duración observada 270,5 s. |
| `client: npx tsc -p tsconfig.api-tests.json` | Aprobado, incluidos fixtures. |
| `client: npm run build` | TypeScript/Vite aprobados después del ajuste final de filtros seleccionados. |
| Migraciones/grants/bootstrap | Siete migraciones presentes, ninguna pendiente; runtime limitado. |
| `git diff --check` y enlaces | Sin errores de espacios; 70 enlaces locales de las guías actualizadas, sin destinos faltantes. |

La suite nueva verifica paginación/totales, username, rol histórico distinto del actual, SIN_IDENTIFICAR, sanitización anidada, PDF/Excel completos, snapshot entre páginas/conflictivo, vacío, límite de 501 eventos y cancelación de entrega si falla auditoría. Verifica también Inicio por tres roles y sesiones/cookies independientes. Los casos de históricos y límite insertan fixtures sintéticos inmutables exclusivamente en la base aislada; nunca actualizan ni eliminan logs. Las otras suites generan eventos mediante operaciones reales auditadas.

La regresión 1–22 repitió sesión/401/refresh/pestañas, confirmación, ETags/412, H1/H2/H3, restricciones Público, catálogos/selecciones históricas, modalidades bibliográficas, archivos, ClamAV y exportaciones con snapshot/vacío. PDF y TXT pasaron el ClamAV instalado; los fallos deterministas de scanner/auditoría usan sustituciones explícitas del fixture, sin desactivar controles del servidor manual.

Se corrigió una expectativa anterior que aún consideraba Auditoría desconectada. La suite completa posterior pasó. Persisten advertencias conocidas de consultas encoladas de `pg` y chunk de ExcelJS mayor de 500 kB; no son fallos de las pruebas/build.

## Recorrido visual

IAB, Vite `127.0.0.1:5173`, API `127.0.0.1:3000` y PostgreSQL 18.3 `127.0.0.1:55439/fceadatasys_client_connection_test`, con runtime `fcea_test_app`. Se conservaron datos sintéticos de entregas anteriores y no se usaron credenciales institucionales.

- Login Admin llega a Inicio y muestra totales reales. Otra pestaña restaura la misma identidad y totales; logout desde la primera oculta las vistas privadas de la segunda.
- H1: inactivar el tutor de `INV-00020` recibe rechazo por referencias y conserva el registro. H2: la cuenta Digitador con publicaciones registradas no se inactiva. Se verificaron desde los diálogos reales con confirmación del actor.
- H3: `INV-00020` cambia PDF A por TXT B ya reservado, se recarga, y se recupera A desde las reservas de esa publicación; el detalle vuelve a mostrar el PDF original, código, fecha, autoría y metadatos conservados. Uso indebido/reserva ajena también se repitió en la regresión integrada.
- Auditoría mostró **3809 eventos globales**, **2402 fallidos** y **24** modificaciones bibliográficas filtradas, con 10 visibles por página. Detalle muestra username, rol, contexto y antes/después reales, incluidos A/B del recorrido. Se generaron PDF y Excel de los 24 eventos desde la UI. SIN_IDENTIFICAR y vacío se comprobaron; vacío mantiene ambas exportaciones deshabilitadas.
- Público llega a Inicio con cuenta activa y publicaciones activas; Auditoría directa queda restringida y la ficha bibliográfica no ofrece descarga. Digitador recibe los accesos bibliográficos autorizados y mantiene el veto administrativo. Los dos contextos HTTP independientes del fixture corroboran mismos datos y sesiones distintas.

Evidencias: [Inicio](../cliente/evidencias/pasos-21-22-inicio.png), [Auditoría/exportación](../cliente/evidencias/pasos-21-22-auditoria.png), [Digitador](../cliente/evidencias/pasos-21-22-digitador.png) y [mediciones](../cliente/evidencias/pasos-21-22-busqueda.json).

## Búsqueda y límites operativos

Cinco mediciones desde la UI con rol Público, 28 publicaciones totales/10 activas consultables en el entorno de cierre:

| Consulta | Segundos | Resultados |
| --- | --- | --- |
| economia savings | 0,373 | 9 |
| ahorro | 0,076 | 1 |
| financial | 0,075 | 8 |
| regional | 0,072 | 9 |
| economía savings | 0,070 | 9 |

Tiempo desde `performance.now()` antes del fetch del cliente hasta después de decodificar JSON. No incluye el pintado completo de React. El objetivo de 1,5 s se cumple en estas condiciones locales pequeñas; no acredita volumen, concurrencia ni red institucional. Conservar las [mediciones anteriores](IMPLEMENTACION-CONEXION-PASOS-16-20-2026-10-18.md) como antecedentes independientes.

La UI automatizada disponible es IAB. Los contextos independientes se probaron por HTTP/cookies reales del fixture; no se afirma haber ejecutado visualmente dos motores ni dos equipos. Repetir los recorridos en los navegadores institucionales y con el volumen/red acordados al preparar el despliegue.

El recorrido global de filtros de auditoría crece con el historial. La caché evita repetirlo al cambiar filtros/página, pero no sustituye una futura medición institucional: la API conserva su límite de 120 solicitudes/minuto por IP. Si se alcanza, el error es visible y exige reintentar; nunca se presenta un catálogo parcial como completo. Actualizar manualmente permite incorporar operaciones realizadas desde otros equipos que no comparten señales del navegador.

SMTP institucional, TLS/orígenes HTTPS y cookies seguras, firmas vigentes de ClamAV, almacenamiento privado con permisos/cuota, copias de seguridad y restauración de PostgreSQL + adjuntos y el despliegue son condiciones operativas externas. Se conservan las guías de [correo](../../../server/docs/EMAIL.md), [archivos](../../../server/docs/ATTACHMENTS.md) y [servidor](../../../server/README.md). El fixture utiliza SMTP local y almacenamiento privado de pruebas, sin verificar ni alterar el correo institucional.

## Reproducción

Iniciar el clúster aislado existente; no apuntar el fixture a una base institucional. Ejecutar `client/test/setup-api.ps1 -Owner fcea_test -Runtime fcea_test_app` y, desde `client/`:

```powershell
$env:CLIENT_API_TEST_DATABASE_URL = 'postgresql://fcea_test_app@127.0.0.1:55439/fceadatasys_client_connection_test'
npm test
npm run test:api
npx tsc -p tsconfig.api-tests.json
npm run build
```

ClamAV: `C:\Program Files\ClamAV\clamscan.exe`, firmas vigentes en `server/.local/clamav/database`. Adjuntos del fixture: `server/.local/client-connection-attachments`. Preparación y cuenta sintética en la [nota 1–10](IMPLEMENTACION-CONEXION-PASOS-1-10-2026-10-18.md). Para UI, `npm run dev:api:test` y Vite con `VITE_DATA_MODE=api`, base `http://127.0.0.1:3000/api/v1` y puerto 5173. Los datos, archivos y logs de las pruebas se conservan.

Al finalizar se cerró la sesión de UI, se detuvieron Vite/API y se apagó ordenadamente el clúster aislado. No quedaron listeners de prueba en los puertos 3000, 5173 o 55439.
