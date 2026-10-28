# Conexión cliente–servidor: pasos 11–15 — 18/10/2026

**Registro histórico.** Conserva el alcance y los resultados de su fecha original. Las menciones al simulador, tareas pendientes, ZIP y rutas de versiones anteriores no describen la distribución vigente. Consultar el [índice técnico actual](../../README.md) y el índice Word de Proyecto.

Se conectaron Carreras, Facultades, Sedes y filiales, Tipos de publicación y Niveles académicos sobre el transporte de los [pasos 1–10](IMPLEMENTACION-CONEXION-PASOS-1-10-2026-10-18.md). Los siete catálogos funcionan en modo API; las ventanas 16–22 permanecen pendientes. El simulador se conserva como modo independiente. No se añadieron endpoints ni migraciones y no se importaron muestras del navegador.

## Estado por ventana

| Paso | Estado | Evidencia |
| --- | --- | --- |
| 11. Carreras | Verificado en integración local | Nombre requerido, código/descripción opcionales, código único normalizado; altas, edición, estados y baja. Paginación/totales reales, 412, H1, persistencia consultada desde otra pestaña del fixture y selección histórica. |
| 12. Facultades | Verificado en integración local y navegador | Nombre, sigla/descripción opcionales, unicidad de nombre/sigla. Mantenimiento solo Admin; vacío real sin muestras, alta confirmada por UI y persistencia tras recarga. No se agregó vínculo Facultad–Publicación; una publicación no bloquea una facultad independiente. |
| 13. Sedes y filiales | Verificado en integración local | Campos `direccion`/`descripcion`; lista/precarga/ETag/confirmación/estado/baja. Se comprobó `filiales` → `branchId` y la conservación de la referencia histórica. UUID/tipo inválido sigue siendo un error, sin lista vacía ficticia. |
| 14. Tipos | Verificado en integración local | Nombre/descripción, duplicados normalizados, filtros, confirmación y versión leída. Mapeo `tipos` → `typeId`; H1 y conservación de referencias al inactivar. |
| 15. Niveles | Verificado en integración local | Nombre/descripción, vacío/paginación/ETag/confirmación y H1. Mapeo `niveles` → `levelId`; opciones activas y selección histórica preparada para publicaciones, consulta y reportes. |

Las comprobaciones automatizadas invocan el adaptador HTTP del cliente contra las rutas reales de Fastify mediante `app.inject`, con cookies y PostgreSQL runtime limitado. La revisión de navegador usa HTTP real, CORS y cookies entre `127.0.0.1:5173` y `127.0.0.1:3000`. No se afirma que cada caso automatizado haya sido repetido por UI.

## Cambios y contratos

- `client/src/data/apiClient.ts` permite las cinco claves adicionales en las operaciones compartidas de catálogos. Mantiene GET/lista, GET/detalle, POST, PATCH y DELETE bajo `/api/v1/catalogos/:catalog`, con claves e IDs codificados en la URL. Los errores de tipo/UUID, permisos, duplicados y referencias son los del servidor.
- `client/src/ApiApp.tsx` habilita las rutas y reutiliza `CatalogPage`. La autorización de navegación se comprueba antes de renderizar el mantenimiento: solo Admin abre estos cinco catálogos. Digitador/Público pueden consumir las clasificaciones según el alcance del endpoint; no obtienen permiso de escritura. Público recibe únicamente activas y no puede consultar un detalle inactivo.
- Se conserva el formulario existente por catálogo: `codigo`/`descripcion`, `sigla`/`descripcion`, `direccion`/`descripcion` o solo `descripcion`. No se envían datos de otro catálogo ni se agregan campos de Facultad a publicaciones. En una edición, los opcionales omitidos se conservan según el PATCH del servidor.
- Se reutilizan precarga/ETag, contraseña efímera de confirmación, revisión explícita tras 412, cancelación sin escritura y rechazo seguro de operaciones inciertas. Las mutaciones confirmadas invalidan las consultas y sus indicadores en todas las pestañas; no se registra auditoría local de negocio.
- `client/src/data/classificationOptions.ts` y `useClassificationOptions.ts` preparan la lectura paginada de opciones activas, con búsqueda y AbortSignal. La referencia elegida del DTO bibliográfico se conserva aunque sea histórica, esté fuera de página o no coincida con la búsqueda. No requiere descargar el catálogo completo ni pedir a Público un detalle inactivo. Si la referencia aparece en la página activa, se usa su nombre vigente sin duplicarla.

El resultado del selector contiene `options`, `selected` y la `pagination` original de la API. `options` puede incluir una referencia histórica adicional; su longitud no sustituye el total. Las opciones contienen solo `id`/`name`, sin campos administrativos. El hook utiliza la invalidación y el descarte de respuestas anteriores de `useQuery`. Las ventanas de publicaciones, consulta y reportes aún no conectadas deben consumir esta frontera al implementarse.

Mapeo de publicación preparado:

| Catálogo | Campo del DTO de escritura |
| --- | --- |
| carreras | careerId |
| filiales | branchId |
| tipos | typeId |
| niveles | levelId |

Facultades está excluida de este mapeo y del tipo `PublicationClassification` deliberadamente. El servidor sigue validando que cada UUID pertenezca al tipo solicitado.

## Pruebas y entorno

Se reutilizó exclusivamente `fceadatasys_client_connection_test` en PostgreSQL 18.3, `127.0.0.1:55439`, rol runtime `fcea_test_app`. `test/setup-api.ps1` comprobó las siete migraciones existentes y reaplicó los grants documentados; no había migraciones pendientes. No se modificó una base institucional ni el almacenamiento del mock.

| Validación | Resultado |
| --- | --- |
| `client: npm test` | 102 aprobadas, 0 fallos, 0 omitidas; incluye las 98 del cierre anterior. |
| `client: npm run test:api` | 23 aprobadas, 0 fallos, 0 omitidas: regresión 1–10 y ampliación 11–15 en serie. |
| `client: npx tsc -p tsconfig.api-tests.json` | Correcto, incluidas fuentes y fixtures. |
| `client: npm run build` | TypeScript/Vite correctos. |
| Navegador | Formularios de los cinco catálogos con campos propios; Facultades vacía, alta confirmada y persistencia después de recargar. |
| Revisión final | `git diff --check` correcto y 51 enlaces locales comprobados sin destinos faltantes. |

Los nuevos casos de integración comprueban, para cada catálogo: altas opcionales, conservación de campos omitidos, paginación/total independiente, detalle desde otra pestaña, unicidad de nombre y código/sigla cuando corresponda, 412 sin sobrescritura, inactivación/reactivación, baja sin referencias y errores de UUID/tipo. Digitador/Público tienen lectura autorizada y rechazo de POST/PATCH/estado/DELETE.

H1 se comprueba con una publicación externa creada mediante API auditada, cuatro referencias tipadas, autor y tutor: publicación activa bloquea inactivación y baja; después de inactivar la publicación se permite inactivar las clasificaciones, pero cualquier referencia histórica sigue bloqueando DELETE. Los selectores excluyen esas clasificaciones de nuevas selecciones y conservan las referencias elegidas. Facultad permanece independiente. La auditoría incluye los cinco tipos de cambios y rechazos canónicos, sin credenciales del cliente.

Las primeras ejecuciones corrigieron expectativas de los fixtures, sin cambiar reglas del servidor: el transporte fija explícitamente método GET y la auditoría de rechazos identifica la plantilla de ruta/sesión, mientras que los cambios exitosos identifican catálogo/registro. La corrida final pasó completa.

Evidencias del navegador: [Facultades sin registros](../cliente/evidencias/conexion-pasos-11-15-facultades-vacio.png) y [alta persistida tras recarga](../cliente/evidencias/conexion-pasos-11-15-facultades.png).

## Reproducción y límites

Preparar/iniciar el clúster aislado según la [entrega 1–10](IMPLEMENTACION-CONEXION-PASOS-1-10-2026-10-18.md). Desde `client/`:

```powershell
./test/setup-api.ps1 -Owner fcea_test -Runtime fcea_test_app
$env:CLIENT_API_TEST_DATABASE_URL = 'postgresql://fcea_test_app@127.0.0.1:55439/fceadatasys_client_connection_test'
npm run test:api
```

La suite ahora ejecuta `test/*.integration.test.ts` con concurrencia 1. Conserva usuarios/registros auditados con sufijos únicos y no borra historia para preparar la siguiente corrida. La API y Vite temporales de la inspección manual solo escuchan en loopback. Al finalizar se cerró la sesión del navegador y se detuvieron ambos servicios y el clúster de pruebas; se comprobó que no quedaran listeners en 3000, 5173 y 55439. La cuenta inicial y los comandos de desarrollo de pruebas están documentados en la entrega anterior.

Las relaciones y selectores deben repetirse desde los formularios de publicaciones y reportes al completar sus pasos. Esta entrega prepara sus consultas, pero no conecta esas ventanas ni acredita la búsqueda FTS, los archivos/ClamAV o las exportaciones. Se conservan las advertencias conocidas de chunk de ExcelJS y consultas encoladas de `pg`; no impidieron las validaciones. No se requiere reversión de migraciones nuevas porque no se agregó ninguna.
