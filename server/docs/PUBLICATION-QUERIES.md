# Contrato API de listado y consulta de publicaciones

Complementa [API.md](API.md) y [PUBLICATIONS.md](PUBLICATIONS.md). Implementación exclusivamente en `server/`; el client sigue usando su simulación. No incorpora edición/inactivación, reportes ni carga/descarga de archivos.

## Rutas y permisos

| Ruta | Respuesta | Acceso |
| --- | --- | --- |
| `GET /api/v1/publicaciones` | 200 `{data:[],pagination:{page,pageSize,total,totalPages}}` | Cualquier sesión vigente |
| `GET /api/v1/publicaciones/:id` | 200 DTO de lectura | Cualquier sesión vigente, según estado |

ADMINISTRADOR puede consultar activas/inactivas; sin filtro de estado recibe ambas. DIGITADOR y PUBLICO reciben solo activas; `active=false` en el listado produce 403 FORBIDDEN. Un detalle inactivo solicitado por esos roles responde 404 NOT_FOUND, igual que un UUID válido inexistente. UUID inválido es 400 VALIDATION_ERROR. No existe acceso anónimo: falta de Bearer/sesión válida produce 401. Una cuenta creada por Admin con rol Público no necesita permisos de mantenimiento para consultar metadatos.

El detalle no acepta query adicional: `?download=true`, actor/rol o flags de ampliación de permisos se rechazan. Las rutas devuelven Cache-Control no-store, no renuevan actividad de sesión y no generan logs de descarga. Las consultas satisfactorias no están entre las operaciones de auditoría obligatorias; los rechazos sí usan OPERACION_RECHAZADA y fallan con 503 AUDIT_UNAVAILABLE si ese log no puede escribirse.

## Filtros y paginación

| Query | Tipo/alcance |
| --- | --- |
| `page` | Entero 1–100000, predeterminado 1 |
| `pageSize` | Entero 1–100, predeterminado 20 |
| `search` | Texto completo, hasta 300 caracteres; se recortan/collapsan espacios y normaliza NFKC |
| `code` | Código exacto INV- seguido de 1–19 dígitos, dentro del bigint positivo/0 de PostgreSQL; case-insensitive |
| `careerId`, `levelId`, `typeId`, `branchId` | UUID de clasificación; no intercambiables entre tipos |
| `authorId`, `tutorId` | UUID de persona relacionada N:M |
| `year` | Año de publicación, entero 1900–9999 |
| `source` | LOCAL o EXTERNA |
| `active` | true/false, sujeto al rol |
| `from`, `to` | Fechas reales YYYY-MM-DD desde 1900, período de registro inclusivo en America/Asuncion |

Todos los filtros se combinan con AND. IDs de clasificación válidos pero inexistentes/equivocados o filtros sin coincidencias producen lista vacía, no 404. Los registros conservan referencias históricas aunque una persona o clasificación esté inactiva; el filtro de visibilidad se aplica a la publicación.

`from`/`to` filtran creación, no `year`. El backend convierte días institucionales a límites timestamp: desde medianoche inclusiva, hasta la medianoche siguiente exclusiva; así conserva el índice de fecha y no depende del huso del navegador. Fechas imposibles o rango invertido son 400 con invalid_params. Se rechazan query desconocida, booleanos no documentados, páginas fuera de límites y códigos fuera de bigint, sin pérdida de precisión por Number.

Orden fijo: `createdAt DESC`, número secuencial DESC para empates, que es único. No hay parámetro de sort ni orden de relevancia. Conteo, IDs paginados y relaciones se leen en un snapshot RepeatableRead; una escritura entre conteo/página no produce totales o nombres contradictorios. Carga de relaciones acotada por página, sin consultas individuales por publicación en el handler.

Sin resultados: HTTP 200 `{"data":[],"pagination":{"page":1,"pageSize":20,"total":0,"totalPages":0}}`. Página posterior al final: `data:[]`, conservando total y totalPages. No se generan archivos para consultas.

Ejemplo:

```text
GET /api/v1/publicaciones?page=1&pageSize=20&search=economia&year=2026&source=EXTERNA&from=2026-01-01&to=2026-12-31
```

## DTO seguro de lectura

Conserva los campos públicos del DTO de alta: id, code, title, authors/tutors ordenados, career/level/type/branch, summary, abstract, keywords, year, source, requiresLibraryCopy, externalUrl, active, createdAt y createdBy. Las personas/clasificaciones se proyectan exclusivamente como `{id,name}`; no se consultan ni devuelven CI, email, ORCID, credenciales, hashes normalizados, estados de seguridad o rutas internas. Los nombres corresponden al snapshot actual de las entidades reutilizables; no se altera su orden de autoría.

Añade `hasAttachment:boolean`. PUBLICO recibe solo esa indicación del archivo, sin `attachment`, ID/hash/nombre del adjunto, URL de descarga ni almacenamiento. Admin/Digitador pueden recibir `attachment:{id,name,size,mime,sha256}` como metadatos si el registro está CLEAN, con verificación y análisis satisfactorios. Si está PENDING/REJECTED o no está verificado, se conserva la consulta bibliográfica, pero se omiten sus metadatos de archivo para todos. `hasAttachment` indica una referencia persistida, sin afirmar que el transporte de archivos esté disponible.

Los enlaces externos se conservan como metadatos institucionales; el servidor no los visita ni entrega bytes. Estas rutas nunca descargan un adjunto. El módulo de transporte/antivirus continúa pendiente; las pruebas usan fixtures de archivo, no un scanner ni almacenamiento real. Tras esta ampliación, POST de publicaciones añade Location apuntando al detalle implementado, sin cambiar el cuerpo de alta.

## Búsqueda FTS

La búsqueda usa PostgreSQL nativo, sin servicios externos ni extensiones. Se aplica normalización Unicode NFKD y eliminación de bloques de marcas diacríticas usados en español/inglés a documentos y consulta. Se combinan configuraciones spanish/english (raíces y stop words) y simple (términos literales bilingües). La base debe ser UTF-8.

Se busca en título, resumen, abstract y palabras clave como documento bibliográfico, o en nombres de autores, o en nombres de tutores. Los términos deben coincidir dentro de uno de esos grupos; no se construye una frase cruzando título con un nombre de persona. La configuración simple permite, por ejemplo, términos españoles del título e ingleses del abstract en una consulta cuando aparecen literalmente en el documento. No constituye traducción automática ni equivalencia semántica entre idiomas.

Usa plainto_tsquery: interpreta texto como datos y combina términos por AND dentro de cada configuración, sin aceptar operadores SQL/tsquery del usuario. Las configuraciones se combinan por OR. Puntuación o stop words pueden desaparecer; por ejemplo, "1=1" es una búsqueda del lexema numérico 1, no una instrucción. Una consulta sin lexemas devuelve vacío; search vacío omite la búsqueda. Código completo INV-00001 enviado en search también consulta el número exacto.

La simulación del client filtraba subcadenas de código/título/autores. Este contrato usa términos completos/raíces FTS y amplía campos: no garantiza subcadenas arbitrarias como "eco" ni códigos parciales. El adaptador futuro debe usar estos parámetros sin enviar el State local; `code` cubre el código exacto y authorId/tutorId filtran por identidad.

Índices GIN sobre documento bibliográfico y nombres de autores/tutores; ramas UNION de IDs independientes permiten usarlos y deduplican publicaciones con varios participantes. Los índices de expresión reflejan renombrados sin mantener copias manuales de nombres. Índice adicional estado/fecha/número y los índices de relaciones existentes soportan filtros y orden. El plan de la consulta completa se comprueba mediante EXPLAIN ANALYZE sin forzar enable_seqscan.

## Migración y validación

Aplicar `20261016020000_publication_queries` con el propietario antes de usar search. Añade tres funciones inmutables y cuatro índices; no cambia datos ni agrega permisos de escritura al runtime. Los índices FTS de expresión están en SQL versionado; no usar db push para sustituir ese historial. Si se modifican funciones/configuraciones de búsqueda, la migración correspondiente debe reconstruir sus índices.

`prisma/rollback-publication-queries.sql` elimina solo los índices/funciones de esta ampliación, preservando metadatos y auditoría. Requiere mantenimiento y backup; no altera historial Prisma. Se comprobó aplicación/down/reaplicación en una base desechable.

Las pruebas HTTP usan Fastify inject y PostgreSQL real con rol runtime limitado. Incluyen roles/visibilidad, DTO, orden/paginación, filtros combinados, fechas institucionales, FTS bilingüe/acentos/nombres/códigos, consultas no mutantes, rechazos auditados, snapshot concurrente y rendimiento. La prueba de rendimiento agrega 2000 publicaciones por ejecución, valida el índice de la consulta completa y exige cinco respuestas HTTP de búsqueda <=1500 ms. Esa medición local no acredita tiempos de navegador/red, concurrencia de producción ni volúmenes institucionales aún no definidos.
