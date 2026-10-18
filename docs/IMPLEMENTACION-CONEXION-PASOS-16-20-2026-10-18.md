# Conexión cliente–servidor: pasos 16–20 — 18/10/2026

**Pasos 16–20 conectados y verificados en el entorno de integración.** Se retomó el trabajo después de la pausa solicitada y se completaron las comprobaciones pendientes descritas abajo. Los cambios permanecen en el workspace, sin commit ni despliegue. Se conservaron los cambios anteriores de los pasos 1–15. Las ventanas 21–22 quedan fuera de este alcance.

Se cerraron las sesiones de UI y los servicios temporales API/Vite, y PostgreSQL confirmó un cierre normal del clúster aislado. No quedaron listeners en 3000, 5173 y 55439. Base, archivos y auditoría de prueba se conservan para reproducir los recorridos.

## Implementación disponible

| Paso | Cambios | Evidencia realizada |
| --- | --- | --- |
| 16. Archivos | Multipart con un único `file`, boundary generado por fetch, detalle posterior al POST, listado paginado y contadores globales por estado. Descarga autenticada por publicación. Mantiene reservas históricas y transferencias del ID al registro. Avisos y parámetros según modo API/mock. | PDF y TXT pasan ClamAV real en integración; duplicados, archivo inválido, scanner caído y auditoría fallida se rechazan. PDF sintético cargado desde UI y adjunto descargado desde la ficha, con SHA-256 idéntico al original. |
| 17. Gestión de publicaciones | Alta, edición, detalle e inactivación reales. Selectores paginados, referencias seleccionadas conservadas y autoría ordenada. ETag/If-Match, confirmación efímera y revisión explícita tras 412. Modalidades externa/local/copia de Biblioteca; PATCH sin `approved`, alta sin `attachmentId:null`. | UI creó y editó `INV-00020`, incluyendo PDF. H3 se repitió con reemplazo por TXT, recarga y recuperación del PDF original. Un cambio auditado desde otra sesión produjo 412; la UI conservó el borrador, bloqueó Guardar y requirió comparación/aceptación explícita. Integración cubre modalidades, duplicados, permisos, rollback y contextos de navegador independientes. |
| 18. Catálogo bibliográfico | Listado/detalle API, paginación y totales del servidor; no filtra solo la página visible ni carga directorios personales para Público. | Catálogo básico recargado y ficha persistida consultada por UI; comprobación visual de Admin, Digitador y Público. Público no tiene botón de descarga ni datos del adjunto; Digitador tiene Editar y no Inactivar. La integración valida también la omisión de metadatos privados y la visibilidad de inactivas. |
| 19. Búsqueda avanzada | Filtros AND de clasificación, nombres, código, año, origen y fechas. Opciones históricas para Admin, activas para otros roles. AbortSignal/descarte de consultas anteriores. Muestra tiempo de consulta HTTP y decodificación. | FTS bilingüe/acentos, IDs/nombres, fechas, vacío y paginación aprobados contra PostgreSQL. Cinco consultas de navegador entre 0,025 y 0,091 s en el entorno local pequeño. |
| 20. Reportes | Consulta y exportación PDF/Excel en servidor con los mismos filtros y snapshot opaco nullable. Sin page/pageSize al exportar. Conflicto bloquea exportar hasta actualizar. Entrada `publicationId` desde el detalle y opciones paginadas. | PDF por UI de exactamente `INV-00020`. Se provocó un snapshot conflictivo desde otra sesión; la UI bloqueó exportaciones y exigió Actualizar vista previa. Luego descargó Excel. Digitador/Público tienen acceso restringido por navegación directa. Integración lee Excel y comprueba conjunto completo, PDF, vacío y fallo de auditoría sin bytes. |

Las ventanas 21–22 (Auditoría e Inicio) continúan indisponibles en modo API. Facultades permanece independiente del modelo bibliográfico. No se añadieron endpoints, migraciones, dependencias ni cambios de reglas de servidor.

## Archivos y contratos

- `client/src/data/http.ts`: FormData, respuestas binarias PDF/TXT/XLSX, Content-Disposition UTF-8, JSON vacío y Problem Details. Conserva coordinación de sesión, cancelación y prohibición de repetir escrituras inciertas.
- `client/src/data/apiPublications.ts`: servicios de publicaciones, archivos y reportes; invalidación tras escrituras confirmadas. Si POST de archivo confirma pero falla su detalle, informa la carga confirmada para evitar repetirla automáticamente. `canSelectAttachment` exige estado elegible: `RESERVADO` con reserva null nunca significa disponible.
- `client/src/data/client.ts` y `contracts.ts`: AbortSignal en lecturas, detalle de archivo separado del listado, descarga con ID de publicación, snapshot nullable y duración opcional de consulta. El POST bibliográfico no trae `hasAttachment`; el adaptador lo proyecta desde los metadatos seguros confirmados y los detalles posteriores usan GET real.
- `client/src/ApiPublicationControls.tsx`, `ApiPublicationForm.tsx`, `ApiPublicationPages.tsx` y `ApiBibliographicPages.tsx`: vistas API de las ventanas existentes y controles paginados, sin construir un ViewState privado del simulador. `ApiApp.tsx` habilita las cinco rutas y conserva los IDs de entrada en el fragmento de URL.
- `AttachmentPage.tsx` y los componentes compartidos de `PublicationPages.tsx`: parámetros consultados, mensajes según modo y descarga por publicación. No se genera auditoría local de negocio en modo API. Los archivos aceptados conservan elegibilidad al reducir el tamaño configurado; el servidor revalida formatos y vínculo.
- `mockClient.ts`, filtros bibliográficos/de reportes y guardas de exportación de `AuditPage.tsx`/`PublicationPages.tsx`: compatibilidad de la frontera compartida y snapshot nullable, sin conectar Auditoría anticipadamente.
- `client/test/api-fixture.ts`: multipart/binarios reales en Fastify inject, almacenamiento privado exclusivo, configuración absoluta de ClamAV y fallos de auditoría inyectables solo en tests. El servidor manual de pruebas usa el antivirus real.
- Pruebas nuevas: `client/src/data/apiPublications.test.ts` y `client/test/publications.integration.test.ts`. Ajustes de expectativas existentes: la ventana pendiente ahora es Auditoría; consultar un adjunto ajeno recibe FORBIDDEN según el servidor; snapshots exportables se estrechan explícitamente a string.
- `client/test/publications.qa.ts`: apoyo opcional al recorrido visual. `inspect` consulta identidades/adjuntos sintéticos; `keywords` modifica por API auditada exclusivamente `INV-00020` con el título de prueba esperado para provocar conflictos desde una sesión independiente. Hereda la restricción de base/rol del fixture y no se ejecuta con `npm run test:api`.

## Validaciones ejecutadas

| Validación | Último resultado observado |
| --- | --- |
| `client: npm test` | **108 aprobadas**, 0 fallos/omitidas. |
| `client: npm run test:api` | **32 aprobadas**, 0 fallos/omitidas: regresiones 1–10, 11–15 y 16–20 en serie. |
| `client: npx tsc -p tsconfig.api-tests.json` | Aprobado después de los ajustes finales de tipos/guardas. |
| `client: npm run build` | TypeScript/Vite aprobados, incluidos los ajustes finales de mensajes y guardas nullable. |
| `git diff --check` | Aprobado; 79 enlaces locales de la documentación comprobados sin destinos faltantes. |

Las primeras corridas corrigieron expectativas de tests y un método de limpieza inexistente del fixture. La corrida integrada posterior pasó completa. Las advertencias conocidas de consultas encoladas de `pg` y chunk de ExcelJS no impidieron las validaciones.

La primera repetición al reanudar no pudo abrir PostgreSQL: había un PID persistido, pero el proceso no estaba activo. Se inició el mismo clúster aislado, PostgreSQL completó su recuperación y confirmó disponibilidad; la repetición posterior de las tres suites pasó con 32 pruebas. No se recrearon ni borraron datos.

Solo se usó `fceadatasys_client_connection_test` en `127.0.0.1:55439`, PostgreSQL 18.3 y rol runtime limitado `fcea_test_app`. El setup comprobó las siete migraciones y reaplicó grants; no había migraciones pendientes. Los fixtures, archivos y auditoría se conservan; no se importaron muestras a una base institucional ni se alteró el almacenamiento del mock.

ClamAV real analizó PDF y TXT. Los escenarios deterministas de scanner caído/detección usan una sustitución explícita del scanner dentro del fixture; no representan malware real ni un bypass del servidor de desarrollo. Los fallos de auditoría son inyectados exclusivamente por el fixture.

## Navegador y rendimiento

Se usó IAB contra Vite/API en loopback, con cookies reales y CORS. El recorrido creó `INV-00020`, editó palabras clave con contraseña actual y conservó el PDF. El reporte PDF descargado desde su detalle contiene una sola investigación. La descarga del adjunto desde la ficha produjo el mismo SHA-256 que el archivo sintético cargado.

En la reanudación se completaron catálogo básico/recarga/detalle, H3 tras recarga, UI de 412 y revisión del borrador, conflicto/actualización/Excel de reportes y la consulta con restricciones de Digitador/Público. Se retiró un aviso duplicado de acceso restringido en la ficha de Público y se evitó mostrar cero archivos mientras la consulta carga o falla. Evidencias adicionales: [412](../client/docs/evidencias/conexion-pasos-16-20-conflicto-412.png), [snapshot conflictivo](../client/docs/evidencias/conexion-pasos-16-20-conflicto-reporte.png), [reporte actualizado](../client/docs/evidencias/conexion-pasos-16-20-reporte-actualizado.png), [Público](../client/docs/evidencias/conexion-pasos-16-20-publico.png) y [Digitador](../client/docs/evidencias/conexion-pasos-16-20-digitador.png).

La automatización de UI dispone de IAB; Chrome no estaba disponible. La independencia entre navegadores se comprueba mediante dos contextos HTTP/cookies del fixture contra PostgreSQL. El recorrido visual H3 utiliza recarga real de IAB; no se presenta como una ejecución visual en dos motores de navegador. Repetir esa combinación en los navegadores institucionales durante la validación de despliegue y el cierre global 21–22.

Evidencias: [archivo confirmado](../client/docs/evidencias/conexion-pasos-16-20-archivo.png), [publicación guardada](../client/docs/evidencias/conexion-pasos-16-20-publicacion.png), [reporte](../client/docs/evidencias/conexion-pasos-16-20-reporte.png), [búsqueda](../client/docs/evidencias/conexion-pasos-16-20-busqueda.png) y [mediciones JSON](../client/docs/evidencias/conexion-pasos-16-20-busqueda.json).

| Consulta | Segundos | Resultados |
| --- | --- | --- |
| economia savings | 0,091 | 7 |
| ahorro | 0,025 | 1 |
| financial | 0,026 | 6 |
| regional | 0,027 | 7 |
| economía savings | 0,026 | 7 |

Medición desde `performance.now()` antes de la solicitud del cliente hasta después de decodificar JSON. No incluye el pintado completo de React. Entorno local pequeño: el selector de reportes mostraba 18 publicaciones; no constituye un benchmark de volumen institucional, concurrencia, red de producción ni la carga de 2000 publicaciones de las pruebas históricas del servidor. El objetivo de 1,5 s se cumplió en estas cinco consultas locales.

## Reproducción y alcance siguiente

Auditoría e Inicio corresponden a los pasos 21–22. Su cierre incluye la regresión global, otros navegadores institucionales y mediciones bajo las condiciones de volumen/red acordadas. SMTP institucional, firmas/almacenamiento, backups y despliegue siguen siendo condiciones operativas externas a esta conexión local.

Para reproducir, iniciar el clúster aislado existente, preparar con `client/test/setup-api.ps1 -Owner fcea_test -Runtime fcea_test_app` y usar:

```powershell
$env:CLIENT_API_TEST_DATABASE_URL = 'postgresql://fcea_test_app@127.0.0.1:55439/fceadatasys_client_connection_test'
cd client
npm run test:api
```

La prueba actual requiere `C:\Program Files\ClamAV\clamscan.exe` y firmas vigentes en `server/.local/clamav/database`; no carga `.env` institucional. El almacenamiento del fixture es `server/.local/client-connection-attachments`. Para la inspección manual: `npm run dev:api:test`, y Vite con `VITE_DATA_MODE=api` y base `http://127.0.0.1:3000/api/v1`. La cuenta de prueba y preparación están en la [entrega 1–10](IMPLEMENTACION-CONEXION-PASOS-1-10-2026-10-18.md).
