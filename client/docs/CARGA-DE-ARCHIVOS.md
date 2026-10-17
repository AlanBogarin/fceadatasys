# Carga de archivos · cliente simulado

Actualizado al 17/10/2026. Guía del simulador; transporte pendiente. Ver [ADAPTACIONES-CLIENTE.md](ADAPTACIONES-CLIENTE.md) y [contrato HTTP de adjuntos](../../server/docs/ATTACHMENTS.md).

## Respaldo del servidor

Esta guía se contrasta con `server/docs/ATTACHMENTS.md`, `server/docs/PUBLICATIONS.md`, las rutas de adjuntos y los validadores de archivos/publicaciones.

El servidor tiene dos operaciones independientes: `POST /api/v1/adjuntos` recibe un único campo multipart `file`, valida PDF o TXT habilitado según el límite configurable de 1–25 MiB (10 iniciales), sanea el nombre, calcula SHA-256 y ejecuta ClamAV antes de almacenar y auditar. Devuelve `{id,name,size,mime,sha256}`. Luego `POST /api/v1/publicaciones` recibe `attachmentId`; valida propiedad, disponibilidad y uso único, y confirma metadatos, relaciones y auditoría. Cancelar el registro no elimina la carga previa. La descarga se realiza por `GET /api/v1/publicaciones/:id/adjunto`; no hay descarga pública ni descarga de adjuntos sueltos.

Admin puede vincular cualquier adjunto disponible; Digitador solo los propios. Ambos pueden descargar adjuntos de publicaciones visibles. Público no puede cargar ni descargar. El servidor también permite trabajos locales con `requiresLibraryCopy:false` sin adjunto; los externos requieren URL y excluyen adjunto/copia de Biblioteca. `PATCH /api/v1/publicaciones/:id` permite añadir, retirar o reemplazar el archivo mediante attachmentId, con If-Match y confirmación del actor. El archivo retirado conserva su reserva y solo puede volver a su publicación original; GET listado/detalle informa reservedPublicationId según visibilidad.

## Pantalla y recorrido

Abrir `http://127.0.0.1:5173/#archivos` con Administrador o Digitador:

1. Seleccionar o arrastrar un archivo habilitado (PDF inicialmente; TXT si Admin lo configura) y pulsar **Cargar archivo**. Se muestra nombre, tamaño, validación/guardado y resultado; no se inventan porcentajes de transferencia ni un veredicto antivirus.
2. El archivo queda **Disponible**. **Registrar publicación** abre el formulario con **Archivo ya cargado** y ese archivo seleccionado. Desde esa modalidad se puede buscar por nombre entre los archivos disponibles; la búsqueda ignora mayúsculas, acentos y diferencias de puntuación/espacios según la normalización del cliente. Muestra el número de coincidencias y un mensaje cuando no encuentra archivos. El archivo seleccionado se conserva al cambiar la búsqueda, aunque no coincida con ella. También se puede elegir cualquier archivo disponible desde el formulario habitual.
3. Completar los datos y guardar. Se comprueban nuevamente permisos, duplicados y la integridad de los bytes locales. El archivo pasa a **Vinculado** y deja de estar disponible para otras publicaciones.
4. Consultar por nombre, código o título, filtrar disponibles, vinculados, reservados, rechazados o pendientes y paginar de ocho en ocho. El detalle del archivo muestra responsable, fecha y SHA-256. Los vinculados usan la descarga auditada. Reservados solo pueden seleccionarse para su publicación original; rechazados/pendientes no se descargan ni vinculan.
5. Cancelar o corregir un formulario no elimina archivos previamente cargados. Se puede preparar un archivo nuevo en el formulario, que el servicio carga antes de enviar los metadatos. El enlace externo es una modalidad separada. La modalidad **Local sin copia digital obligatoria** corresponde exclusivamente a trabajos que no requieren conservación en Biblioteca.

El listado se deriva de las cargas locales y los adjuntos de publicaciones existentes; los enlaces externos de las muestras no se inventan como archivos subidos. Digitador ve sus cargas pendientes y los adjuntos ya vinculados consultables; Admin ve todas las cargas. Las rutas directas mantienen el control de acceso existente.

## Contrato local y persistencia

- `State.uploadedAttachments?`: `{attachment: {id,name,size,mime,sha256}, createdAt, createdBy}`. No incluye `CLEAN`: el navegador no dispone de ClamAV.
- `State.attachmentAudit?`: ID, recurso cuando existe, actor/rol, fecha, operación `ADJUNTO_CARGADO` o `ADJUNTO_RECHAZADO`, estado `EXITO`/`FALLIDO` y motivo. Son tipos internos de la simulación, no códigos nuevos de la API.
- `PublicationInput.attachmentId?` resuelve una carga existente y comprueba propietario y uso único. El DTO de lectura conserva reservedPublicationId y el selector de edición puede recuperar la reserva de la publicación original. Las escrituras de publicaciones utilizan attachmentId; no envían el objeto attachment ni bytes.
- `source` y `requiresLibraryCopy` se agregan de forma compatible a las nuevas publicaciones. Los registros anteriores siguen siendo consultables sin migración destructiva.
- Los bytes siguen en IndexedDB `fcea-datasys.attachments/files`; cargas, publicaciones y bitácoras permanecen en la misma entrada localStorage existente. Los campos nuevos ausentes equivalen a listas vacías.
- Primero se guarda el binario; después se confirma el estado con metadatos, relación del usuario y bitácora juntos. Un fallo de la confirmación intenta retirar exclusivamente el binario nuevo. No se confirma éxito si falla el almacenamiento o la bitácora. Las cargas previas no se borran si falla una publicación.
- El hash es único entre cargas pendientes y adjuntos existentes, incluso si cambia el nombre. Se comprueban extensión, MIME declarado cuando se informa, cabecera y fin de PDF o UTF-8 de TXT, tamaño y caracteres de control del nombre. Estas comprobaciones básicas no prueban integridad estructural completa ni ausencia de malware.

La simulación no llama al servidor, no aporta locks de PostgreSQL, auditoría inmutable ni contexto confiable de IP/sesión. Mantiene la protección local contra estado desactualizado y revalida sesión antes de confirmar; localStorage e IndexedDB no comparten transacción y no garantizan atomicidad entre pestañas o ante cierre abrupto. El formulario usa el límite de resumen administrable (300 iniciales, rango 10–1000), formatos y tamaño vigentes. Los mismos parámetros existen en el servidor.

Para integrar la API, implementar el transporte de `uploadAttachment` por multipart, conservar el ID devuelto, enviar solo `attachmentId` junto a los metadatos y descargar mediante la publicación autorizada. `GET /api/v1/adjuntos` ya ofrece listado paginado, búsqueda y estados; GET detalle completa fecha/responsable y reserva. La fachada debe conservar esas reservas al reconstruir los datos, sin depender de attachmentHistory del navegador.

## Validación

Cierre actual H1–H3: **87 pruebas de cliente** y build correctos; evidencia en [la nota de implementación](../../docs/IMPLEMENTACION-H1-H2-H3-2026-10-17.md). El recorrido manual siguiente pertenece al hito original y no acredita conexión HTTP real.

Evidencia histórica de la carga previa: `npm test`, 43 pruebas, incluyendo carga previa, permisos por propietario, duplicados pendientes/vinculados, compatibilidad de datos, vinculación única, modalidades, fallo de auditoría/almacenamiento y vencimiento de sesión durante el guardado. `npm run build`: TypeScript y Vite. La advertencia de tamaño del chunk de ExcelJS corresponde a la biblioteca de reportes existente.

Prueba manual en `127.0.0.1:5173`: cargar un PDF ficticio de `public/demo`, registrar una investigación con el ID seleccionado, descargarlo, recargar y comprobar que sigue vinculado, rechazar una segunda carga del mismo PDF y revisar filtros/estado vacío. Las pruebas usan cuentas y documentos de demostración.
