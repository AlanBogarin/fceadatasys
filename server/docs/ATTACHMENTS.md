# Contrato de carga y descarga de adjuntos

Implementación exclusiva de `server/`. El cliente conserva IndexedDB y su simulación independiente. Complementa API.md, PUBLICATIONS.md, PUBLICATION-MANAGEMENT.md y SECURITY.md. Reportes PDF/Excel implementados en REPORTS.md.

## Rutas

| Método/ruta completa | Autorización | Resultado |
| --- | --- | --- |
| POST `/api/v1/adjuntos` | Admin/Digitador | 201, metadatos seguros de un archivo habilitado y analizado |
| GET `/api/v1/adjuntos/:id` | Admin o Digitador creador | 200, metadatos de un adjunto CLEAN; sin bytes ni rutas |
| GET `/api/v1/publicaciones/:id/adjunto` | Admin/Digitador | 200, bytes del archivo vinculado; auditoría confirmada antes de entregar |

Bearer y sesión central vigentes obligatorios. Público y anónimos no pueden operar con estas rutas, aunque puedan consultar metadatos bibliográficos. Digitador solo descarga publicaciones activas; Admin también puede descargar históricas/inactivas. Una publicación sin adjunto, inexistente o no visible devuelve 404. No hay descarga de archivos sueltos, ruta estática, URL pública, Range ni HEAD de descarga.

POST requiere `multipart/form-data`, exactamente un archivo en el campo `file`, sin campos adicionales. No acepta actor, hash, estado, ruta, ID o veredicto construidos por el navegador. Admite el MIME canónico del formato (application/pdf o text/plain) o application/octet-stream y comprueba el contenido independientemente. PDF habilitado por defecto; TXT solo si Admin lo configura. Ambos pasan por ClamAV y máximo 10 MiB. Las tres rutas rechazan query desconocida; UUID inválidos producen 400. No hay If-Match para estas operaciones.

Respuesta de carga/detalle: `{id,name,size,mime,sha256}`, MIME application/pdf o text/plain. Location apunta a `/api/v1/adjuntos/:id`. No incluye creador, almacenamiento, firmas ni rutas internas. El frontend futuro debe conservar el ID y enviarlo como `attachmentId` en POST/PATCH de publicaciones; no enviar el objeto attachment local. La publicación conserva validación de propietario, estado, formato habilitado y hash. El archivo retirado conserva su reserva histórica a la publicación original. Parámetros, TXT UTF-8 y transición de formatos en PUBLICATION-MANAGEMENT.md.

Ejemplo desde server/ (el Bearer se obtiene por login):

```powershell
curl.exe -X POST http://localhost:3000/api/v1/adjuntos -H "Authorization: Bearer <token>" -F "file=@C:/documentos/tesis.pdf;type=application/pdf"
curl.exe http://localhost:3000/api/v1/publicaciones/<uuid>/adjunto -H "Authorization: Bearer <token>" --output tesis.pdf
```

## Validación y ClamAV

PDF de 1 byte a 10 MiB (10485760 bytes), extensión PDF, cabecera PDF 1.0–1.7/2.0 y marcador final EOF. Nombre normalizado NFKC, sin rutas, controles/bidi ni caracteres inseguros, hasta 144 caracteres; clave UUID generada por servidor. Estas comprobaciones equivalen a las de contenido básicas de la demo y no constituyen validación estructural completa de PDF.

TXT opcional: UTF-8 estricto, contenido no vacío y sin controles binarios salvo tabulador, CR y LF, mismo límite de 10 MiB y ClamAV obligatorio. allowedFormats se lee antes de analizar y se revalida bajo lock antes de confirmar la carga; deshabilitar durante el análisis rechaza la carga y compensa el archivo. No se aceptan extensiones arbitrarias. Históricos conservan descarga al deshabilitar su formato. Detalles en PUBLICATION-MANAGEMENT.md.

El adaptador invoca **clamscan**, instalado separadamente, mediante spawn sin shell, ventana oculta en Windows y argumentos fijos. Envía los bytes por stdin; no interpreta nombres enviados por usuarios como comandos. No requiere clamd ni expone sockets de antivirus. Se eligió CLI para utilizar la instalación local existente y evitar administrar un servicio adicional en este hito. Cada análisis carga firmas; su costo se acota mediante concurrencia y timeout.

Opciones: escaneo PDF habilitado, alertas de cifrado y límites, archivo máximo 10 MiB, contenido expandido 50 MiB, hasta 1000 objetos/archivos y profundidad 10. El timeout del motor se desactiva para evitar su comportamiento de omisión asumida como limpia; el proceso tiene un límite externo de 120 s y se termina al excederlo. Firmas con más de siete días se rechazan. Solo se acepta exit 0 con `stdin: OK`, al menos un archivo analizado y ausencia de WARNING/ERROR. Exit 1 con FOUND rechaza el archivo, incluidas alertas por cifrado/límites; cualquier respuesta inesperada, firmas ausentes, binario incompatible o error falla cerrado con 503. La salida interna no se entrega al cliente.

Flujo síncrono: recibir en memoria acotada → validar/calcular SHA-256 → analizar → almacenar privadamente → confirmar fila CLEAN y auditoría. Solo se persisten archivos que pasaron todos los controles. PENDING existe en el modelo, pero no hay trabajos de análisis en segundo plano ni endpoint de aprobación manual. Un error de scanner no crea una fila ni habilita bytes. Un rechazo conserva metadatos REJECTED y auditoría, sin almacenar el binario nuevo. Si el mismo hash ya existía, la detección confirmada pone ese registro en REJECTED, conservando relaciones/historia; el archivo existente queda privado e inaccesible, en cuarentena lógica. No hay borrado automático de archivos históricos ni bypass administrativo.

SHA-256 único y lock por hash coordinan cargas concurrentes y rechazos. Incluso registros REJECTED reservan su hash; duplicados se rechazan con 409. No se permite reutilizar un archivo en dos publicaciones. CLEAN significa análisis sin detecciones con las firmas disponibles, no garantía absoluta de inocuidad.

Referencias oficiales: [ClamScan y actualización](https://docs.clamav.net/manual/Usage/Scanning.html), [opciones y códigos de salida](https://github.com/Cisco-Talos/clamav/blob/main/docs/man/clamscan.1.in).

## Almacenamiento y consistencia

Directorio privado configurable, por defecto `.local/attachments` respecto del cwd server. Nunca colocarlo dentro de client/public ni servirlo con un servidor estático. Directorio 0700/archivos 0600 donde el sistema soporte modos POSIX; en Windows restringir sus ACL al servicio y operadores. El directorio y sus ancestros deben estar administrados por operadores confiables. Claves internas acotadas impiden traversal; las lecturas rechazan enlaces simbólicos.

Escritura exclusiva, sin sobrescribir archivos existentes. La transacción revalida usuario/rol/sesión después del scanner y de adquirir locks. Si falla la base, se detecta duplicado o falla auditoría, se revierte la fila y se retira el archivo nuevo. Un fallo de limpieza se registra sin rutas sensibles; cualquier huérfano queda privado y no es descargable porque carece de publicación/registro confirmado. PostgreSQL y filesystem no comparten transacción distribuida: una caída entre escritura y commit puede dejar un archivo huérfano. No se eliminan automáticamente; revisar los no referenciados y logs de limpieza durante mantenimiento. Los adjuntos CLEAN cargados pero aún no vinculados se conservan privadamente; no existe borrado de usuario ni carga inicial automática.

Descarga: locks actor/sesión → publicación FOR SHARE → adjunto FOR UPDATE; comprobar estado → leer como máximo tamaño esperado + 1 → verificar tamaño/hash → revalidar actor → auditar → confirmar → enviar los mismos bytes verificados. Una ausencia/alteración produce 503 sin entregar el archivo. No se vuelve a analizar en cada descarga; la descarga requiere el veredicto persistido vigente. Un mecanismo programado de reanálisis no forma parte de este hito.

Entrega Content-Type canónico (application/pdf o text/plain), `Content-Disposition: attachment` con filename* UTF-8 seguro, Content-Length, Cache-Control no-store y X-Content-Type-Options nosniff. Deshabilitar un formato no cancela descargas históricas. CORS expone Content-Disposition. Un cupo compartido acota análisis/cargas y descargas, sin cola ilimitada; la descarga libera el cupo al finalizar/cerrar la respuesta. El log acredita entrega iniciada tras autorización, no que el receptor haya guardado o leído el archivo.

## Auditoría y errores

ADJUNTO_CARGADO/EXITO, ADJUNTO_RECHAZADO/FALLIDO y DESCARGAR_ADJUNTO/EXITO conservan contexto confiable, ID de recurso/publicación cuando corresponde y metadatos seguros. La carga incluye engine/fecha de análisis; el rechazo conserva firma acotada sin rutas ni bytes. Las mutaciones y su auditoría confirman juntas. Fallo del log cancela operación con AUDIT_UNAVAILABLE; rechazos de validación/seguridad se registran aparte. Nunca se devuelven bytes si falla la auditoría de descarga.

| HTTP/code | Motivo |
| --- | --- |
| 400 INVALID_ATTACHMENT | Archivo ausente/vacío, nombre/extensión, MIME o contenido básico inválido |
| 400 ATTACHMENT_REJECTED | ClamAV detectó malware, cifrado o exceso de límites |
| 400 VALIDATION_ERROR | UUID/query o contrato multipart inválidos |
| 413 VALIDATION_ERROR | Tamaño máximo excedido |
| 409 DUPLICATE_ATTACHMENT | Hash previamente registrado, también rechazado |
| 409 ATTACHMENT_NOT_READY | PENDING/REJECTED o verificación incompleta |
| 503 ANTIMALWARE_UNAVAILABLE | Scanner, firmas, timeout o análisis incompleto |
| 503 ATTACHMENT_UNAVAILABLE | Archivo ausente, alterado o almacenamiento inválido |
| 503 ATTACHMENT_SERVICE_BUSY | Concurrencia máxima alcanzada |

Reutiliza 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND, 429 RATE_LIMITED, 503 AUDIT_UNAVAILABLE y Problem Details. Algunos límites multipart usan VALIDATION_ERROR con 400/413 según el límite. Un fallo inesperado de escritura de filesystem se informa sin detalles como INTERNAL_ERROR; el archivo incompleto se retira cuando sea posible.

## Configuración, operación y pruebas

Variables en .env.example: ATTACHMENT_DIRECTORY, CLAMAV_COMMAND, CLAMAV_DATABASE_DIR, CLAMAV_TIMEOUT_MS, CLAMAV_MAX_SIGNATURE_AGE_DAYS y ATTACHMENT_CONCURRENCY (2 por defecto, 1–8). Usar ClamAV compatible con la arquitectura del host. En Windows, `scripts/update-clamav.ps1` utiliza FreshClam instalado y descarga/valida firmas oficiales en `.local/clamav/database`; repetir periódicamente mediante operación institucional. Linux puede utilizar FreshClam de su distribución y apuntar CLAMAV_DATABASE_DIR a ese directorio. El servidor no actualiza firmas automáticamente ni requiere enviar documentos fuera de la institución.

No cambia el esquema ni requiere migración. Reaplicar runtime-grants.sql: INSERT en adjuntos, UPDATE solo estado/analizado_en para cuarentena, UPDATE activo en publicaciones exclusivamente necesario para el lock FOR SHARE. No se habilitan endpoints de edición/inactivación ni DELETE físico de publicaciones/adjuntos/auditoría. Para retirar el módulo, deshabilitar rutas y revocar estos grants de columnas/INSERT sin borrar archivos ni historia; revisar dependencias de locks antes de revocar UPDATE estado previamente existente.

Pruebas unitarias: formato/nombres, respuesta segura del proceso, scanner inexistente y almacenamiento/integridad. Integración requiere ATTACHMENTS_TEST_DATABASE_URL hacia la base local exclusiva fceadatasys_attachments_test, migrada y con runtime limitado. CLAMAV_TEST_ENABLED=1 habilita el análisis real con CLAMAV_TEST_COMMAND y CLAMAV_TEST_DATABASE_DIR. El resto usa un scanner inyectado explícitamente para ejercitar fallos/concurrencia sin depender de firmas. La prueba positiva del motor utiliza un marcador aleatorio inocuo y una firma propia en una copia temporal de las bases oficiales; no modifica firmas de producción ni desactiva Defender. No se genera EICAR en las pruebas vigentes. Los resultados efectivos se registran en TESTING.md/IMPLEMENTATION-STATUS.md.
