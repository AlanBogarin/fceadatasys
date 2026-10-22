# Consultar reportes y exportar PDF/Excel

**Actualización del 18/10/2026:** los pasos 16–20 ya utilizan el adaptador HTTP en modo API: archivos, gestión de publicaciones, consulta bibliográfica, búsqueda y reportes. Contratos y evidencias en [conexión 16–20](../../docs/IMPLEMENTACION-CONEXION-PASOS-16-20-2026-10-18.md). El simulador permanece independiente.

La API consulta PostgreSQL y genera ambos documentos en **server**. El cliente admite API y simulador como modos independientes. Las rutas requieren Bearer y rol ADMINISTRADOR vigente. DIGITADOR/PUBLICO reciben 403 y las solicitudes anónimas 401. Las respuestas tienen `Cache-Control: no-store`.

## Consulta

`GET /api/v1/reportes/publicaciones`

Query estricta: los [filtros de publicaciones](PUBLICATION-QUERIES.md), más `publicationId` UUID opcional para seleccionar un trabajo. Incluye `from`/`to` de registro, `careerId`, `levelId`, `typeId`, `branchId`, `authorId`, `tutorId`, `author`, `tutor`, `year`, `source`, `active`, `code`, `search`. Combina los filtros con AND. Las fechas son días inclusivos de America/Asuncion, independientes del año académico. Sin filtro de estado se incluyen activas e inactivas, como en la demo administrativa. Se conservan referencias históricas.

`page` predeterminado 1; `pageSize` predeterminado 20, máximo 100. Orden: registro descendente y número descendente. Respuesta 200:

```json
{
  "data": [],
  "pagination": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 },
  "report": { "snapshot": null, "exportable": false, "maxRecords": 500 }
}
```

Con resultados, `data` contiene los DTO administrativos seguros documentados en PUBLICATION-QUERIES.md. Para un conjunto exportable, `report.snapshot` es una cadena SHA-256 de 64 caracteres y `exportable=true`. Identifica el contenido y los filtros completos, independientemente de la página consultada. Un cambio de metadatos, nombres relacionados, estado o resultados exige una nueva consulta. No es un token de acceso ni sustituye la autorización. La lectura de conteo, filas y relaciones usa una transacción Repeatable Read.

## Exportación

`GET /api/v1/reportes/publicaciones/exportar?format=pdf&snapshot=...`

Enviar **los mismos filtros** de la consulta, `format=pdf|xlsx` y su `snapshot`. `page`/`pageSize` no se aceptan: se exporta el conjunto filtrado completo. No se envían publicaciones, nombres ni contenido generado desde el navegador. El adaptador usa fetch autenticado, comprobar Content-Type, procesar JSON vacío/Problem Details o descargar el Blob; CORS ya expone Content-Disposition.

Con resultados: 200 binario, Content-Length y Content-Disposition attachment con nombre fijo seguro `reporte-publicaciones.pdf` o `.xlsx`. MIME PDF `application/pdf`; Excel `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

Sin resultados: **200 `application/json` con `{ "data": [], "total": 0 }`**, sin Content-Disposition ni documento, incluso si el snapshot enviado ya quedó desactualizado. El parámetro snapshot debe conservar el formato válido; la consulta vacía devuelve null y la interfaz debe deshabilitar exportar.

El servidor captura el conjunto, valida su snapshot y renderiza fuera de la transacción. Antes de entregar, vuelve a comprobar usuario activo, rol, sesión, revocación y vencimiento bajo bloqueo; confirma la auditoría. Si cambia la base después de capturar el conjunto, el documento conserva exactamente esa captura validada; no combina versiones durante la generación. La auditoría registra `REPORTE_EXPORTADO`, recurso reportes, formato, filtros, total, snapshot, tamaño, usuario/rol, sesión, IP y User-Agent; publicationId cuando se filtró un trabajo concreto. Un fallo de auditoría cancela la entrega. Consultas exitosas no simulan una descarga ni renuevan actividad. Los rechazos se auditan mediante el circuito existente.

## Diseño y contenido

- PDF: A4, portada con institución, cantidad, emisor y criterios; fichas por publicación, membrete con logo UNC a la izquierda y FCEA a la derecha en todas las páginas, nombres institucionales centrados y paginación repetida. Continúa automáticamente en otra página si un texto lo exige, reservando espacio para el membrete. DejaVu Sans embebida para acentos/Unicode, con licencia en assets/fonts/.
- Excel: **Resumen** con membrete institucional, ambos logos embebidos, cantidad y criterios, configurada para impresión A4 horizontal en una página; **Investigaciones** con metadatos, autofiltro y paneles inmovilizados; **Textos** con resumen/abstract completos por código. Los textos largos se dividen en fragmentos consecutivos para caber en las filas, sin perder caracteres. Fechas tipadas y ordenables según día institucional; año numérico. Entradas que empiezan por =/+/−/@ se guardan como texto literal, nunca como fórmula.
- Los logos PNG optimizados se conservan en `assets/branding/logo-unc.png` (300 × 300 px) y `assets/branding/logo-fcea.png` (375 × 384 px). FCEA se recortó al contenido visible de su canal alfa (779 × 798 px dentro del original de 1000 × 1000) antes de reducirlo, sin márgenes transparentes añadidos. Se aplica compresión PNG y se conservan transparencia, colores y proporciones; los originales de la raíz no se modifican. El generador lee las dimensiones del PNG y ajusta ambos logos dentro del mismo cuadro, sin estirarlos ni descargar recursos externos. Se resuelven respecto del módulo, tanto al ejecutar TypeScript como desde `dist/`. El contrato HTTP, los filtros, permisos y la auditoría no cambian.
- Incluye código, título, autoría ordenada, tutores, carrera, nivel, tipo, filial, año, fecha de registro, usuario registrador, palabras clave, estado, origen y nombre de archivo o URL externa. No incluye bytes de adjuntos, rutas de almacenamiento, datos personales de autores ni credenciales.

## Límites y errores

Exportación síncrona: hasta **500 registros**, **2.000.000 caracteres de JSON de registros**, **20 MiB de archivo** y **1000 páginas PDF**. Una exportación simultánea por proceso de API, conservando el cupo durante la entrega. La consulta continúa paginada si se supera el límite; exportable=false y snapshot=null. Reducir filtros para exportar. Son protecciones documentadas de esta versión; no hay exportación masiva asincrónica ni cola distribuida. En producción, el número de procesos multiplica los cupos y requiere dimensionamiento.

Errores adicionales, todos con el Problem Details habitual:

| HTTP | code | Significado |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Query desconocida, UUID/fecha/rango/formato/snapshot inválido o paginación en exportación |
| 400 | REPORT_LIMIT_EXCEEDED | Demasiados resultados, texto, páginas o tamaño |
| 409 | REPORT_VERSION_CONFLICT | Los resultados/filtros no coinciden con la consulta previa |
| 503 | REPORT_SERVICE_BUSY | Ya hay una exportación en curso en ese proceso |
| 503 | REPORT_GENERATION_FAILED | El generador no pudo completar el archivo |
| 503 | AUDIT_UNAVAILABLE | No se confirmó auditoría; no se entrega archivo |

## Instalación y ejemplos

PDFKit y ExcelJS están fijados en package-lock.json; UUID transitivo de ExcelJS se fija a 11.1.1 para corregir su aviso de seguridad. `npm ci`, build y start desde server/. El despliegue incluye **assets/fonts/** y **assets/branding/** además de dist/, dependencias y configuración. No requiere Office, navegador, servicio PDF, migración adicional ni nuevos grants: reutiliza SELECT de bibliografía e INSERT de auditoría del runtime limitado ya preparado.

`npm run reports:examples` genera `.local/report-examples/reporte-publicaciones-ejemplo.pdf` y `.xlsx`, usando el mismo generador de la API. Admite directorio alternativo: `npm run reports:examples -- <directorio>`. Tres trabajos ficticios, claramente marcados; no lee ni modifica bases, no crea cuentas ni requiere ClamAV. La fecha fija permite comparar el diseño. `.local` está ignorado. En producción los datos provienen exclusivamente del servidor y no se activa la marca de ejemplo.

La exportación de **auditoría** también está implementada como caso de uso separado en `/api/v1/auditoria/exportar`, con permisos, filtros y snapshot documentados en [CLIENT-INTEGRATION.md](CLIENT-INTEGRATION.md). Este documento describe exclusivamente el reporte bibliográfico de publicaciones.
