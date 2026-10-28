# Edición, inactivación y formatos de publicaciones

**Permisos vigentes.** Las referencias a accesos por rol describen los valores iniciales. Las operaciones utilizan permisos efectivos por rol y excepciones por cuenta conforme a AGENTS.md y [PERMISSIONS.md](../../docs/operacion/PERMISSIONS.md); administrar permisos y ejecutar copias conserva la reserva al Administrador con el permiso correspondiente.

**Actualización del 18/10/2026:** los pasos 16–20 ya utilizan el adaptador HTTP en modo API: archivos, gestión de publicaciones, consulta bibliográfica, búsqueda y reportes. Contratos y evidencias en [conexión 16–20](../../docs/historico/integracion/IMPLEMENTACION-CONEXION-PASOS-16-20-2026-10-18.md). El simulador fue retirado del despliegue.

Contrato consolidado al 17/10/2026. Complementa API.md, PUBLICATIONS.md, PUBLICATION-QUERIES.md, ATTACHMENTS.md y [CLIENT-INTEGRATION.md](CLIENT-INTEGRATION.md). El cliente tiene transporte HTTP para estas pantallas y conserva el simulador como modo separado. Consulta, detalle y exportación de auditoría ya están implementados para Admin; las escrituras de auditoría siguen siendo obligatorias.

## Rutas y precarga

| Método/ruta completa | Permiso | Resultado |
| --- | --- | --- |
| GET `/api/v1/publicaciones/:id` | Cualquier sesión; inactivas solo Admin | DTO de consulta y encabezado ETag |
| PATCH `/api/v1/publicaciones/:id` | Admin/Digitador | 200, DTO de consulta actualizado y ETag |
| PATCH `/api/v1/publicaciones/:id/estado` | Solo Admin | 200, DTO inactivo y ETag |
| GET `/api/v1/parametros/publicaciones` | Cualquier sesión | Límite de resumen, formatos admitidos, tamaño máximo y ETag |
| PATCH `/api/v1/parametros/publicaciones` | Solo Admin | 200, parámetros completos confirmados y ETag |

Todas las mutaciones PATCH requieren `X-Confirmation-Password`, con la contraseña actual del actor en Base64 de UTF-8. PATCH de parámetros también exige el If-Match obtenido de GET; ausencia 428, formato inválido 400, precarga desactualizada 412 `RESOURCE_VERSION_CONFLICT`.

Las dos mutaciones de publicaciones exigen `If-Match` con el ETag de su detalle. Valor opaco fuerte de formato `"sha256-<64 dígitos hexadecimales>"`, derivado del DTO seguro, incluido estado y adjunto visible. Sin encabezado: 428 `PRECONDITION_REQUIRED`. Valor vacío, débil, lista o comodín: 400 `VALIDATION_ERROR`. Precarga desactualizada: 412 `PRECONDITION_FAILED`, título «La publicación fue modificada». El cliente debe conservar el formulario, volver a consultar y resolver el conflicto; no reintentar automáticamente con un ETag nuevo. CORS ya permite If-Match y expone ETag.

La comparación se realiza bajo bloqueo de publicación y después de revalidar actor/rol/sesión. Dos cambios efectivos con el mismo ETag solo pueden confirmar uno. El tag representa contenido, no un contador: un cambio sin diferencias puede conservarlo. Los renombrados de catálogos también pueden invalidar la precarga. Los errores respetan Problem Details y se auditan. UUID/query desconocidos o cuerpos con campos extra se rechazan.

## Edición parcial

Cuerpo estricto no vacío; campos opcionales: `title`, `summary`, `abstract`, `keywords`, `year`, `authorIds`, `tutorIds`, `careerId`, `levelId`, `typeId`, `branchId`, `source`, `externalUrl`, `requiresLibraryCopy`, `attachmentId`.

```json
{"title":"Título corregido","authorIds":["11111111-1111-4111-8111-111111111111"],"keywords":"economía, región"}
```

Los arrays reemplazan el conjunto completo y conservan el orden enviado, sin repetidos y con mínimo un participante. Los campos ausentes conservan su valor; `attachmentId:null` retira el vínculo actual. El resto de campos no admite null. No se acepta `active`, `approved`, código, creador, fecha, hashes ni veredictos del navegador. Se conserva identidad, código, creador y fecha de registro. Las publicaciones inactivas no se editan: 404; la precarga anterior a su inactivación recibe primero 412.

La validación se aplica al resultado combinado con los datos persistidos: resumen <= límite vigente, año institucional válido, URL externa HTTP/HTTPS sin credenciales, reglas de copia local y duplicados normalizados de título/resumen/abstract/adjunto, incluso históricos. La propia publicación queda excluida de la comparación. Las restricciones UNIQUE resuelven carreras. Una colisión produce 409 `DUPLICATE_PUBLICATION`; la precomprobación identifica campos en invalid_params y una carrera puede devolver ese array vacío.

Las nuevas referencias deben existir, corresponder al catálogo y estar activas. Una referencia histórica inactiva ya vinculada puede conservarse en una corrección. Se bloquean referencias en orden estable y se verifican en la transacción. Un adjunto nuevo debe estar CLEAN, verificado, analizado, tener formato habilitado y pertenecer al Digitador que lo vincula, salvo Admin. Un adjunto retenido no pierde su vínculo por deshabilitar el formato o por cuarentena; la cuarentena sigue impidiendo su descarga y su metadata sensible se omite del DTO.

Ejemplo de cambio local a externo: `{"source":"EXTERNA","externalUrl":"https://example.org/trabajo","requiresLibraryCopy":false,"attachmentId":null}`. Para volver a local, enviar `source:"LOCAL"`, `externalUrl:""` y las condiciones de copia/adjunto correspondientes. Las combinaciones contradictorias se rechazan.

El reemplazo/retirada conserva el archivo y su reserva histórica en `asignaciones_adjuntos`: un archivo utilizado no puede vincularse a otra publicación, aunque ya no sea su adjunto actual. Puede volver a vincularse a su publicación original si pasa los controles vigentes. La tabla se rellena con vínculos existentes al migrar y un trigger reserva cada nuevo vínculo; no permite UPDATE/DELETE/TRUNCATE. No hay eliminación física de publicaciones ni archivos por estas rutas.

## Inactivación

Cuerpo exacto `{"active":false}`. Solo Admin; no hay reactivación en este contrato. Conserva metadatos, participantes, archivos, reservas y auditoría. Público/Digitador dejan de obtener la publicación en detalle/listado y Digitador deja de descargar su archivo. Admin mantiene consulta, filtros/reportes históricos y descarga de archivos CLEAN. Un archivo rechazado nunca se descarga, tampoco por Admin. Repetir con el ETag inactivo actual devuelve el mismo DTO sin duplicar el evento de transición.

## Formatos administrables

Respuesta de parámetros:

```json
{"summaryWordLimit":300,"allowedFormats":["pdf"],"maxPdfSizeMb":10}
```

PATCH parcial no vacío: `{"allowedFormats":["pdf","txt"]}`, `{"summaryWordLimit":250}` o `{"maxPdfSizeMb":15}`. El límite de resumen es entero de 10 a 1000, inclusive; el tamaño es entero de 1 a 25 MiB y se aplica a PDF/TXT. Formatos en minúsculas, sin punto ni repetidos, al menos uno; respuesta ordenada. Solo se admite el registro de validadores implementados: `pdf` y `txt`. Se puede habilitar solo TXT. Formatos arbitrarios, DOC/DOCX/ZIP/ejecutables y arrays vacíos se rechazan; para ampliarlos se debe implementar y validar su control de contenido antes de agregarlos. No hay bypass de seguridad por un parámetro administrativo.

| Formato | MIME canónico | Control de contenido |
| --- | --- | --- |
| pdf | application/pdf | Cabecera PDF reconocida y marcador final EOF, más ClamAV |
| txt | text/plain | UTF-8 estricto, texto no vacío y sin controles binarios salvo tabulador/CR/LF, más ClamAV |

Predeterminado únicamente PDF, tamaño inicial 10 MiB para ambos, configurable entre 1 y 25 MiB mediante `maxPdfSizeMb`. El upload acepta MIME canónico o application/octet-stream; comprueba extensión y contenido independientemente. Nombres sanitizados y claves UUID con extensión controlada. Ambos pasan por el mismo antivirus, hash único, almacenamiento privado, límites, compensación y auditoría. No se entrega contenido inline: Content-Disposition attachment y nosniff. MIME de DTO/descarga refleja el archivo real; `attachment.mime` en DTO bibliográfico admite `application/pdf|text/plain`. Público continúa sin recibir metadata de descarga.

Deshabilitar un formato afecta nuevas cargas y nuevos vínculos, conserva archivos y descargas históricas. La carga revalida formatos y tamaño configurado después del análisis bajo bloqueo compartido de parámetros antes de confirmar; si se deshabilitó durante el scanner, rechaza y retira el archivo nuevo. Parámetros y su evento se confirman juntos, sin sobrescribir campos ausentes.

## Auditoría, migración y reversión

Eventos nuevos: `PUBLICACION_MODIFICADA` y `PUBLICACION_INACTIVADA`, recurso/publicación, actor y rol revalidados, sesión, IP/User-Agent y snapshots antes/después. `PARAMETROS_PUBLICACIONES_MODIFICADOS` incluye límite de resumen, formatos y tamaño. Si falla auditoría se revierte edición, relaciones N:M, reserva de archivo, estado o parámetros. La consulta, detalle y exportación de logs están disponibles para Admin; ver CLIENT-INTEGRATION.md.

Esta ampliación usa `20261016030000_publication_management`; la instalación vigente también requiere las dos migraciones del 17/10 detalladas en CLIENT-INTEGRATION.md. Aplicar todas con el propietario y repetir `scripts/runtime-grants.sql` para el rol limitado; luego regenerar Prisma/compilar. La API no debe ejecutarse con propietario. No se necesita ampliar permisos de auditoría ni conceder DELETE de publicaciones/adjuntos. UPDATE de publicación queda acotado a campos editables y estado; se permite DELETE/INSERT de participantes para reemplazo transaccional y SELECT/INSERT de reservas.

`prisma/rollback-publication-management.sql` requiere mantenimiento y backup verificado. Conserva publicaciones/archivos/auditoría; rechaza reversión si existe TXT, formatos distintos de PDF o reserva de archivo retirado que se perdería. Revertir código no deshace ediciones/inactivaciones ya confirmadas. El down no altera `_prisma_migrations`; restaurar backup consistente o reparar hacia adelante. Reaplicar los grants de la versión que se despliega. Las bases de desarrollo/producción deben actualizarse explícitamente; los tests solo migran bases aisladas.
