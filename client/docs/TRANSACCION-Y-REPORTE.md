# Grupo 2 · Registro de investigaciones y su reporte

Guía de la transacción y su reporte, iniciada el 14/10 y consolidada al 17/10/2026. El cliente conserva el simulador; la evidencia de 37 pruebas corresponde al hito original. El cierre actual registra 87 pruebas y build; ver [ADAPTACIONES-CLIENTE.md](ADAPTACIONES-CLIENTE.md).

## Qué presentar

1. **Mantenimiento:** Usuarios (ya implementado).
2. **Transacción:** registrar una investigación aprobada, relacionándola con uno o varios autores y tutores, carrera, nivel, tipo y sede. Se puede elegir entre enlace externo al documento o archivo habilitado (PDF inicialmente, TXT opcional), con límite configurable de 1–25 MiB, 10 iniciales. También se admite un trabajo local sin copia digital obligatoria cuando no corresponde conservación en Biblioteca.
3. **Reporte de la transacción:** desde el detalle guardado, pulsar **Reporte de esta investigación**. El administrador ve exactamente ese registro y puede descargar PDF o Excel. El menú **Reporte de investigaciones** permite consultar más registros y filtrar.
4. **Seguridad:** roles al abrir páginas y bloqueo por 10 minutos sin actividad.

Actualmente todos los módulos del menú están disponibles, incluida edición/inactivación de investigaciones, búsqueda bibliográfica avanzada, auditoría y parámetros. El servidor implementa los endpoints; falta conectar el transporte y validar el recorrido completo desde el navegador.

## Preparación antes de la exposición

Extraer TODO el ZIP en una carpeta nueva. No mezclar archivos con versiones anteriores. Ejecutar `Iniciar-Frontend.cmd`; necesita Node.js y conexión a Internet para instalar las dependencias la primera vez. Mantener esa ventana abierta y usar la dirección que aparece junto a **Local**. Si un puerto está ocupado, Vite elige otro.

Cuentas ficticias iniciales: `admin`, `digitador` y `publico`, con contraseña `Fcea2026!`. Si ya se cambió una contraseña en ese navegador y dirección, usar la contraseña cambiada. No se reinician los datos anteriores.

Como administrador, crear al menos un registro activo en: **Autores, Tutores y orientadores, Carreras, Niveles académicos, Tipos de publicación y Sedes y filiales**. La versión de demostración carga muestras en la primera apertura; las personas y los trabajos son ficticios, mientras los nombres institucionales UNC se verificaron y se identifican con (demo). Si ya hay datos, el Administrador puede agregarlas o corregir la muestra antigua desde Inicio → Cargar / actualizar datos de prueba. Los cambios existentes requieren contraseña y conservan los registros propios. Ver DATOS-DE-DEMOSTRACION.md. Los catálogos vacíos se indican antes de registrar.

Para ensayar, se pueden usar nombres explícitos como “Autora de prueba” y “Tutor de prueba”, carrera “Administración de Empresas”, nivel “Grado”, tipo “Trabajo de grado” y sede “Concepción”. Para la exposición, usar los datos de ejemplo que acuerde el grupo. El enlace debe apuntar al documento externo elegido por el grupo; el sistema valida su formato, pero no verifica disponibilidad ni permisos del sitio externo.

## Recorrido de demostración (5–7 minutos)

1. Iniciar sesión como **admin** y abrir **Gestión bibliográfica → Publicaciones**.
2. Pulsar **Registrar investigación**. Ingresar título, año, clasificación, autores y tutores. Los buscadores de autores y tutores muestran 10 coincidencias por página y conservan las personas seleccionadas al filtrar. Las etiquetas numeradas indican su orden y permiten quitarlas.
3. Completar resumen (hasta el límite vigente, 300 palabras inicialmente), abstract en inglés, palabras clave. Elegir enlace HTTP/HTTPS, adjunto habilitado o modalidad local sin copia obligatoria cuando corresponda; no se combinan URL externa y archivo local. Marcar que el trabajo ya está aprobado: el repositorio registra, no evalúa ni aprueba trabajos.
4. Pulsar **Guardar investigación**. Se muestra el código `INV-00001` (o el siguiente disponible) y el detalle guardado. Volver al listado o recargar para demostrar que el dato permanece.
5. Desde **Ver detalle**, pulsar **Reporte de esta investigación**. Comprobar que código, título y participantes coinciden con lo recién guardado.
6. Descargar **PDF** y **Excel**. El PDF muestra fichas con paginación. El Excel tiene criterios y una hoja de investigaciones con todos los campos, filtros y encabezado fijo.
7. Probar el filtro por fecha de registro, carrera o nivel. Un período sin resultados deshabilita las descargas. **Limpiar filtros** vuelve a mostrar todos los registros.
8. Si se desea mostrar una validación, intentar registrar otro trabajo con el mismo título: se rechaza y no se guardan registros parciales.

Para demostrar roles: Digitador puede registrar y consultar en Publicaciones, pero no abrir Reportes. Público no puede abrir ninguna de esas dos páginas, incluso escribiendo `#gestion-publicaciones` o `#reportes` en la dirección. Público sí consulta trabajos activos mediante Catálogo bibliográfico/Búsqueda avanzada.

## Explicación para la defensa

**¿Por qué es una transacción?** Es una operación del proceso principal del repositorio: incorpora un trabajo académico y vincula varias entidades reutilizables. El sistema valida toda la entrada y prepara investigación, relación con el usuario y bitácora local; luego guarda el estado en una escritura. En modalidad PDF, guarda primero el binario en IndexedDB y confirma los metadatos después; si falla la confirmación intenta retirar el archivo nuevo. Un cierre abrupto puede dejar un binario huérfano, sin investigación visible; la garantía transaccional entre ambos almacenes requiere backend. No informa éxito si falla el almacenamiento.

**¿Por qué es el reporte de la misma transacción?** No es un listado ficticio ni un reporte de usuarios: consulta las investigaciones efectivamente guardadas. El botón del detalle selecciona su identificador. Vista previa, PDF y Excel usan la misma función de selección y filtros.

**¿Qué garantiza esta entrega?** Demuestra el comportamiento funcional en un navegador. La escritura conjunta en localStorage NO es una transacción ACID de PostgreSQL. Los datos no se comparten entre equipos ni entre distintas direcciones/puertos. Si el navegador borra el almacenamiento, se pierden los registros. El ZIP contiene código, no los registros ingresados en otro equipo.

**¿Qué falta conectar?** El servidor ya implementa autorización, claves foráneas, restricciones únicas, transacciones, concurrencia, auditoría inmutable y almacenamiento privado con ClamAV. Falta consumir sus endpoints desde el cliente y validar el recorrido real por rol. La bitácora local no sustituye la auditoría del servidor.

## Reglas implementadas

- Admin y Digitador activos pueden registrar. Reportes exclusivos de Admin activo.
- Los metadatos funcionales son obligatorios; enlace externo o archivo habilitado según modalidad, con excepción local sin copia obligatoria cuando corresponda. Año entre 1900 y el año actual.
- Un mismo autor/tutor no puede repetirse en una investigación; referencias existentes y activas.
- Resumen <= límite configurable de 10–1000 palabras; 300 iniciales. Parámetros también administra formatos y tamaño de nuevas cargas.
- Título, resumen y abstract no pueden duplicarse, ignorando mayúsculas, acentos, puntuación y espacios redundantes.
- Se rechazan enlaces con protocolos ejecutables o credenciales incrustadas. No se descargan ni analizan documentos remotos.
- La investigación conserva una copia de los nombres de las referencias al registrarse. Renombrar un catálogo no cambia el reporte histórico.
- Un catálogo con publicaciones activas no puede inactivarse. Con referencias únicamente inactivas puede inactivarse conservando historia; cualquier referencia impide eliminarlo físicamente. Solo Administrador puede eliminar registros sin vínculos, previa confirmación. El usuario que registró queda relacionado con la investigación para impedir su baja.
- Las fechas del reporte son fechas de registro en `America/Asuncion`, inclusivas en ambos extremos; no se confunden con el año de publicación.
- Sin resultados, no se genera PDF ni Excel. Las exportaciones comprueban sesión antes y después de preparar el archivo.

## Archivos principales y comprobaciones

- `src/publications.ts`: tipos, registro, validaciones, relaciones y selección del reporte.
- `src/PublicationPages.tsx` y `src/publications.css`: formulario, listado, detalle, filtros y vista previa.
- `src/publicationExports.ts`: PDF y Excel de los datos guardados.
- Integración en `App.tsx`, `model.ts`, `catalogs.ts`, `storage.ts` e `Iniciar-Frontend.cmd`.
- `src/publications.test.ts`, `src/attachments.test.ts` y pruebas de catálogos: validan modalidades, huellas duplicadas, reversión de guardado fallido y eliminación restringida. 37 pruebas totales en el hito original del 14/10, incluyendo usuarios y seguridad; no es el conteo actual.

Verificar con `npm test` y `npm run build`. Se probó también en navegador el registro, su persistencia al recargar, el filtro sin resultados y las descargas de ambos formatos.

Las librerías de exportación se cargan al solicitarlas. Referencias oficiales: [jsPDF](https://github.com/parallax/jsPDF) y [ExcelJS](https://github.com/exceljs/exceljs).

La documentación anterior en `docs/usuarios-seguridad` describe aquel avance. Este documento actualiza el alcance respecto de la transacción y el reporte, que ahora sí están implementados en el frontend.

## Adjuntos y límites de esta ampliación

Los PDF se guardan en IndexedDB, no dentro del ZIP. Después de recargar, abrir el detalle y pulsar **Descargar adjunto PDF**. Administrador y Digitador pueden descargar; Público no. El reporte muestra el nombre del archivo, sin incrustar el documento adjunto.

Se verifican extensión, tamaño, firma, final de PDF y huella SHA-256. Esto no sustituye antivirus ni validación estructural completa. Los nombres se sanean antes de descargar. La bitácora local incluye el intento de descarga entregado por el sistema, sin garantizar que el usuario haya abierto el archivo. Los enlaces anteriores conservan compatibilidad.

Los controles y el almacenamiento de servidor y la auditoría inmutable ya existen; sigue pendiente consumirlos mediante el adaptador HTTP. Para borrar completamente los datos de ensayo también debe eliminarse IndexedDB `fcea-datasys.attachments` desde las herramientas del navegador.
