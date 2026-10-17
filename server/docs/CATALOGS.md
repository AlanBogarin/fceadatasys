# Contrato API de catálogos

Base `/api/v1/catalogos/:catalog`. Valores de `catalog`: `autores`, `tutores`, `carreras`, `facultades`, `filiales`, `tipos`, `niveles`. Todos los endpoints exigen Bearer y sesión vigente. Complementa [API.md](API.md), incluidos transporte, paginación y Problem Details. `client/` conserva su persistencia local; esta entrega no conecta sus pantallas.

| Método y ruta relativa | Respuesta | Permiso |
| --- | --- | --- |
| `GET /:catalog` | 200 `{data:[],pagination:{page,pageSize,total,totalPages}}` | Admin/Digitador; Público solo clasificaciones activas |
| `GET /:catalog/:id` | 200 DTO; 404 si no existe en ese catálogo | Mismo alcance de lectura |
| `POST /:catalog` | 201 DTO y `Location` | Admin; Digitador solo autores/tutores |
| `PATCH /:catalog/:id` | 200 DTO | Admin; Digitador solo autores/tutores |
| `DELETE /:catalog/:id` | 204 sin cuerpo | Solo Admin, sin referencias |

DTO compatible con la forma pública de `CatalogRecord` del client:

```json
{"id":"d0347d10-079a-423d-a191-bf55608f1e38","name":"María Pérez","fields":{"ci":"1234567","email":"maria@example.org","orcid":"0000-0000-0000-000X"},"active":true,"createdAt":"2026-10-15T12:00:00.000Z","updatedAt":"2026-10-15T12:00:00.000Z"}
```

No expone claves normalizadas, `participantIds` ni `demoKey`. La autoría de los cambios se conserva en auditoría, derivada de la sesión. Autor es una entidad propia (`autores`), con `name` mapeado a `nombre_completo`, `fields.email` a `correo` y `fields.orcid` a `orc_id`. Tutor también es una entidad propia; los otros cinco catálogos se almacenan en `catalogos` con tipo discriminado. Los UUID no son intercambiables entre tipos.

## Escrituras y campos

Alta: `{ "name": "Nombre", "fields": {} }`; `name` obligatorio hasta 150 caracteres, no vacío después de normalizar. `fields` puede omitirse. Se crea activo. PATCH acepta `name`, `fields` y/o `active`; exige al menos uno. Los campos omitidos se conservan; `fields` se combina por clave con los campos actuales bajo bloqueo. Enviar `""` limpia un campo opcional; `null` no es válido para estos campos. No exige If-Match: cambios al mismo campo siguen el orden de adquisición del bloqueo; no ofrece detección de precarga desactualizada. DELETE no requiere cuerpo; admite `{}` o `null` como vacío, rechaza propiedades adicionales.

| Catálogo | Claves admitidas dentro de `fields` (todas opcionales) |
| --- | --- |
| autores | `ci` (5–12 dígitos), `email` (150), `orcid` (19, `0000-0000-0000-0000`, admite X final) |
| tutores | `ci` (5–12 dígitos), `email` (150), `especialidad` (150) |
| carreras | `codigo` (30), `descripcion` (300) |
| facultades | `sigla` (30), `descripcion` (300) |
| filiales | `direccion` (200), `descripcion` (300) |
| tipos, niveles | `descripcion` (300) |

Se normaliza Unicode NFKC y espacios para guardar; correo en minúsculas y ORCID en mayúsculas. Las respuestas incluyen las claves opcionales de su catálogo con `""` si no tienen valor. Se rechazan campos desconocidos, incluso metadatos pertenecientes a otro catálogo, identidad del actor y bitácoras del navegador.

## Listados y búsqueda

Query: `page` (1–100000, predeterminado 1), `pageSize` (1–100, predeterminado 20), `search` (hasta 300 caracteres), `active` (`true`/`false`). Sin `active`, Admin/Digitador reciben ambos estados; para nuevas cargas usar `active=true`. Público recibe únicamente clasificaciones activas, también si envía `active=false`; no tiene acceso a los directorios de autores/tutores, que contienen datos personales. Las referencias públicas de autores/tutores deberán devolverse como metadatos por las futuras rutas de publicaciones. Un detalle inactivo solicitado por Público responde 404.

Búsqueda por subcadena sobre nombre y todos los campos, con la normalización del client: NFKD, eliminación de marcas diacríticas, minúsculas españolas, puntuación/símbolos convertidos a espacios y espacios colapsados. No interpreta patrones SQL. Orden ascendente por nombre normalizado y UUID; conteo y página comparten snapshot. Vacío: HTTP 200 con `data:[]`, `total:0`, `totalPages:0`; una página fuera del rango devuelve `data:[]` conservando el total. Esta búsqueda de catálogos no acredita la futura búsqueda FTS de publicaciones.

## Integridad, concurrencia y auditoría

Unicidad normalizada por catálogo, incluso en registros inactivos: nombre; además CI/email/ORCID en autores, CI/email en tutores, código en carreras y sigla en facultades. Campos opcionales vacíos se almacenan como NULL y no colisionan. Un mismo identificador puede existir en autor y tutor, entidades independientes. PostgreSQL arbitra duplicados concurrentes mediante UNIQUE; no basta comprobar en memoria.

Inactivación conserva el registro y sus referencias históricas. Desde la corrección H1 del 17/10/2026, las referencias de publicaciones solo bloquean la inactivación cuando la publicación está activa; se contemplan autores/tutores N:M y las claves compuestas ID/tipo de clasificaciones. DELETE sigue rechazando cualquier referencia, aunque sea histórica. Las FKs de otros dominios conservan el veto preventivo hasta contar con una regla específica. La comprobación inspecciona FKs entrantes bajo bloqueo; una referencia que confirma mientras la operación espera se vuelve a consultar antes de modificar. El registro usa FKs RESTRICT y bloquea/revalida que el catálogo esté activo antes de asociarlo. Otros modelos bibliográficos deberán conservar ese protocolo. No admite referencias guardadas solo como JSON o IDs sueltos sin FK.

Operaciones de auditoría: `CATALOGO_CREADO`, `CATALOGO_MODIFICADO`, `CATALOGO_ACTIVADO`, `CATALOGO_INACTIVADO`, `CATALOGO_ELIMINADO`; recurso = clave de catálogo, recurso ID = UUID. Conserva DTO antes/después según corresponda, actor/rol revalidados, sesión, IP y User-Agent. Mutación y auditoría confirman juntas; fallo de auditoría revierte incluso DELETE. Los rechazos usan `OPERACION_RECHAZADA` separado del rollback. No existen endpoints para modificar auditoría.

## Errores

| HTTP | code | Significado |
| --- | --- | --- |
| 409 | DUPLICATE_CATALOG | Nombre o identificador normalizado duplicado en su catálogo |
| 409 | CATALOG_IN_USE | Inactivación con publicaciones activas u otra dependencia bloqueante; eliminación con cualquier referencia |

Reutiliza 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED`, 403 `FORBIDDEN`, 404 `NOT_FOUND` y 503 `AUDIT_UNAVAILABLE` de API.md. Catálogo fuera del enum/UUID inválido es 400; UUID válido inexistente o de otro catálogo es 404. Las validaciones de campos identifican `body.name` o `body.fields.<campo>` en `invalid_params`.
