# Contrato API de registro de publicaciones

Este contrato describe el alta bibliográfica en `server/`; `client/` conserva su simulación independiente. Complementa [API.md](API.md). El listado, búsqueda y detalle se documentan en [PUBLICATION-QUERIES.md](PUBLICATION-QUERIES.md), y la carga/descarga/ClamAV en [ATTACHMENTS.md](ATTACHMENTS.md). Edición/inactivación y reportes continúan pendientes.

## Registrar un trabajo aprobado

`POST /api/v1/publicaciones`, Bearer obligatorio; solo ADMINISTRADOR o DIGITADOR con sesión vigente. HTTP 201 con el DTO del registro confirmado y Location `/api/v1/publicaciones/:id`, apuntando al detalle implementado posteriormente. Usuario creador, rol, fecha, código, estado y hashes se obtienen en servidor.

```json
{
  "title": "Producción económica regional",
  "authorIds": ["11111111-1111-4111-8111-111111111111"],
  "tutorIds": ["22222222-2222-4222-8222-222222222222"],
  "careerId": "33333333-3333-4333-8333-333333333333",
  "levelId": "44444444-4444-4444-8444-444444444444",
  "typeId": "55555555-5555-4555-8555-555555555555",
  "branchId": "66666666-6666-4666-8666-666666666666",
  "summary": "Resumen en español del trabajo académico.",
  "abstract": "English abstract of the academic work.",
  "keywords": "economía, producción, región",
  "year": 2026,
  "approved": true,
  "source": "EXTERNA",
  "externalUrl": "https://example.org/trabajo"
}
```

Los UUID del ejemplo son ilustrativos: deben existir y estar activos en sus catálogos. Se requieren 1–100 autores y 1–100 tutores, sin IDs repetidos (se normaliza el case de UUID). El orden enviado se conserva en ambas relaciones, con orden de autoría explícito y restricciones únicas por publicación/persona y publicación/posición. Personas reutilizables en múltiples trabajos. Facultades no es un campo del formulario actual de publicaciones; no se inventa esa relación.

`approved:true` declara que el trabajo fue aprobado fuera del repositorio; no es una evaluación ni aprobación académica dentro del sistema. La confirmación se registra en la auditoría como `approvedExternally:true`, sin crear un flujo de evaluación.

Campos de texto requeridos: título hasta 250 caracteres, resumen/abstract hasta 5000 cada uno, palabras clave manuales hasta 300. Se recortan extremos y se colapsan espacios como en el client; la normalización Unicode se aplica al comparar hashes, sin expandir ligaduras de compatibilidad a palabras nuevas durante el conteo. Se rechazan textos vacíos o compuestos solo por puntuación/símbolos. El año debe ser entero entre 1900 y el año actual en America/Asuncion, calculado con el reloj del servidor. El idioma no se infiere ni se valida con servicios externos.

Resumen: máximo inclusivo de 300 palabras por defecto, con límite persistido y configurable por Admin. Conteo determinista `trim().split(/\s+/u).filter(Boolean).length`, equivalente al client para sus separadores. La validación usa el parámetro bloqueado durante toda la transacción; no acepta un límite enviado en el cuerpo.

## Modalidad y adjuntos

`source` opcional: se infiere EXTERNA si hay URL no vacía; en otro caso LOCAL. EXTERNA exige URL HTTP/HTTPS de hasta 2000 caracteres, sin credenciales; se guarda la representación canónica de URL. El servidor no descarga ni visita el enlace. No permite `attachmentId` ni `requiresLibraryCopy:true` junto a una URL externa.

LOCAL exige URL ausente/vacía. `requiresLibraryCopy` vale true por defecto: si corresponde conservar físicamente el trabajo en Biblioteca, la copia digital es obligatoria. En ese caso debe enviarse `attachmentId` de un archivo previamente verificado. Para un trabajo local que no requiere esa conservación, enviar explícitamente `requiresLibraryCopy:false`; el adjunto pasa a ser opcional. Esta regla sigue AGENTS.md, aunque el formulario simulado actual siempre pide archivo o enlace.

El registro acepta únicamente un UUID de adjunto existente en la base, con estado CLEAN, verificación de contenido y fecha de análisis, PDF válido en sus metadatos, nombre seguro, hash SHA-256 y tamaño de 1 byte a 10 MiB. Digitador solo puede vincular sus adjuntos; Admin puede vincular cualquier adjunto verificado. Se bloquea el registro del archivo y se rechazan PENDING/REJECTED, archivos ajenos y reutilización. La FK compuesta `(attachmentId,attachmentHash)` asegura que el hash de publicación corresponda al registro del archivo.

**Carga previa del archivo:** `POST /api/v1/adjuntos` recibe el PDF, verifica su contenido básico y lo analiza con ClamAV antes de confirmar CLEAN y auditoría. El consumidor utiliza el ID devuelto como attachmentId; la descarga auditada es `GET /api/v1/publicaciones/:id/adjunto`. El registro sigue sin aceptar `attachment:{name,size,mime,sha256,...}`, hashes, rutas o estados construidos por el navegador. Las pruebas históricas de registro usan fixtures; la nueva suite de adjuntos valida almacenamiento/descarga y el motor real por separado. Contrato y operación en ATTACHMENTS.md.

## DTO y concurrencia

DTO basado en Publication del client, con campos adicionales `source`, `requiresLibraryCopy` y `active`:

```json
{
  "id": "77777777-7777-4777-8777-777777777777",
  "code": "INV-00001",
  "title": "Producción económica regional",
  "authors": [{"id":"11111111-1111-4111-8111-111111111111","name":"Persona autora"}],
  "tutors": [{"id":"22222222-2222-4222-8222-222222222222","name":"Persona tutora"}],
  "career": {"id":"33333333-3333-4333-8333-333333333333","name":"Economía"},
  "level": {"id":"44444444-4444-4444-8444-444444444444","name":"Grado"},
  "type": {"id":"55555555-5555-4555-8555-555555555555","name":"Tesis"},
  "branch": {"id":"66666666-6666-4666-8666-666666666666","name":"Concepción"},
  "summary":"Resumen en español del trabajo académico.",
  "abstract":"English abstract of the academic work.",
  "keywords":"economía, producción, región",
  "year":2026,
  "source":"EXTERNA",
  "requiresLibraryCopy":false,
  "externalUrl":"https://example.org/trabajo",
  "active":true,
  "createdAt":"2026-10-16T15:00:00.000Z",
  "createdBy":{"id":"88888888-8888-4888-8888-888888888888","name":"Digitador"}
}
```

Si hay adjunto, añade `attachment:{id,name,size,mime:"application/pdf",sha256}`. No expone almacenamiento, resultados internos del scanner, claves normalizadas ni credenciales. `externalUrl` es `""` para locales. Código `INV-` más el número secuencial PostgreSQL con un mínimo de cinco dígitos; continúa correctamente después de 99999. Secuencias pueden dejar huecos por transacciones canceladas; el código no depende del conteo ni se reutiliza.

Duplicidad: normalización equivalente a catálogos/client (NFKD, sin diacríticos, minúsculas españolas, puntuación/símbolos como espacios y espacios colapsados); se calculan hashes SHA-256 de título, resumen y abstract normalizados. UNIQUE individuales conservan la regla incluso en registros inactivos y arbitran altas concurrentes. Los hashes evitan índices B-tree sobre textos largos. Adjunto ID/hash también son únicos; un mismo archivo no se reutiliza.

Transacción ReadCommitted: locks usuario → sesión → parámetros → catálogos en orden estable → adjunto. Se comprueba el actor otra vez tras esperar referencias y se releen catálogos activos bajo bloqueo. Conteos y precomprobaciones no sustituyen UNIQUE/FK. Las FKs tipadas impiden carrera/nivel/tipo/filial equivocadas. Triggers diferidos impiden confirmar una publicación sin autores o tutores. La publicación, relaciones N:M y auditoría confirman juntas; si falla el log se revierte toda el alta y el uso del adjunto.

Una publicación referenciada protege los catálogos contra inactivación/eliminación usando el guard FK existente. RN02 también impide inactivar a un usuario que creó publicaciones, incluso históricas, con `409 USER_IN_USE`; otros cambios permitidos y el ETag de usuarios conservan su contrato.

## Parámetro de resumen

`GET /api/v1/parametros/publicaciones`, cualquier sesión: 200 `{ "summaryWordLimit": 300 }`.

`PATCH /api/v1/parametros/publicaciones`, solo Admin: cuerpo estricto `{ "summaryWordLimit": 300 }`, entero 1–10000; respuesta 200 con el valor confirmado. Actualiza una fila singleton con bloqueo y auditoría transaccional. No revalida retroactivamente resúmenes históricos; los próximos registros usan el valor vigente. El límite de caracteres del resumen permanece en 5000. No implementa todavía los parámetros de formatos/extensiones.

## Errores y auditoría

Formato Problem Details definido en API.md. Cuerpos estrictos: se rechazan actorId, createdBy, code, active, hashes, bitácoras y campos desconocidos.

| HTTP | code | Significado |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | Campos, aprobación declarada, modalidades, URL, año o límite de resumen inválidos |
| 400 | INVALID_PUBLICATION_REFERENCE | ID inexistente, inactivo o del catálogo equivocado; campo identificado en invalid_params |
| 400 | INVALID_ATTACHMENT | Metadatos persistidos de archivo incompatibles con PDF/tamaño/nombre seguros |
| 409 | ATTACHMENT_NOT_READY | Falta verificación de contenido o análisis satisfactorio |
| 409 | DUPLICATE_PUBLICATION | Título/resumen/abstract/adjunto duplicado; invalid_params identifica los campos |
| 409 | USER_IN_USE | Inactivación de creador de publicaciones rechazada por RN02 |

Reutiliza 401 UNAUTHENTICATED, 403 FORBIDDEN, 404 NOT_FOUND para adjunto ausente y 503 AUDIT_UNAVAILABLE. Campos de error usan `body.title`, `body.summary`, `body.abstract`, `body.attachmentId` y los IDs del formulario. También se aplican rate limit y límite de cuerpo global existentes.

Eventos `REGISTRAR_INVESTIGACION` (recurso publicaciones, UUID de recurso/publicación, DTO seguro y confirmación de aprobación externa) y `PARAMETROS_PUBLICACIONES_MODIFICADOS` (antes/después del límite). Conservan actor/rol revalidados, sesión, fecha, IP, User-Agent y ÉXITO. Rechazos se registran como OPERACION_RECHAZADA/FALLIDO por separado del rollback. Auditoría sigue inmutable.

## Instalación y límites

Aplicar `20261016010000_publication_registration` con propietario y repetir `scripts/runtime-grants.sql`. Runtime tiene SELECT/INSERT en publicaciones/N:M, USAGE de la secuencia y SELECT/UPDATE de parámetros. El módulo posterior de adjuntos añade INSERT en archivos, UPDATE de estado/analizado_en y UPDATE activo en publicaciones para locks de descarga; no DELETE de publicaciones/adjuntos, TRUNCATE ni modificación de auditoría. No hay cambio de esquema para incorporar transporte; los grants vigentes y su reversión se documentan en ATTACHMENTS.md.

`prisma/rollback-publications.sql` revierte esta ampliación únicamente si no hay publicaciones/adjuntos ni parámetros modificados; preserva usuarios, catálogos y auditoría. Mantenimiento y backup verificado requeridos. No modifica el historial Prisma; restaurar un backup coherente o aplicar reparación hacia adelante tras un down manual. Relaciones N:M y códigos quedan validados en pruebas aisladas; no se modificó una base institucional ni se conectó el frontend.
