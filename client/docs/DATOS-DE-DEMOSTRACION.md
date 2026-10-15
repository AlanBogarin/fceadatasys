# Datos de demostración · FCEA-Datasys

Todos los nombres, contactos y trabajos del conjunto de muestra son ficticios. Las facultades y filiales de muestra no constituyen un directorio oficial. Se identifican con **(demo)** o **Demostración**. No se modifican las cuentas ni las contraseñas existentes.

## Cargar y abrir

- **Navegador/origen nuevo:** al abrir el sistema por primera vez se crean las tres cuentas de demostración y se carga esta muestra automáticamente.
- **Instalación con datos guardados:** ingresar como Administrador y abrir **Inicio → Cargar datos de prueba**. La carga agrega muestras sin reemplazar registros propios. Repetirla no duplica los registros, tampoco revierte las ediciones o estados de las muestras ya cargadas.
- Si existe un conflicto de validación, no se confirma una carga parcial. El mensaje indica el motivo; revisar los catálogos antes de volver a intentar.

Cuentas iniciales: `admin`, `digitador`, `publico`. Contraseña inicial: `Fcea2026!`. Si se cambió antes, se conserva la contraseña cambiada.

## Contenido

| Catálogo o módulo | Cantidad de muestras |
|---|---:|
| Autores | 14: 13 activos y 1 inactivo |
| Tutores | 12: 11 activos y 1 inactivo |
| Carreras | 4 |
| Facultades | 2 |
| Sedes/filiales | 3 |
| Tipos de publicación | 4 |
| Niveles académicos | 3 |
| Investigaciones | 8 |
| Documentos PDF de muestra | 8 |

Las fechas de registro ficticias se distribuyen entre el día de la carga y los 40 días anteriores para practicar filtros. Los años de publicación abarcan el actual y los dos anteriores. Las fechas guardadas no cambian al volver a abrir el sistema.

## Recorrido sugerido

1. **Autores:** buscar `Lucia`, sin tilde. Buscar `autor1@demo.example.test`. Filtrar inactivos para ver a **Agustín Núñez (demo)**.
2. **Crear publicación:** los buscadores tienen suficientes personas activas para mostrar dos páginas. Elegir participantes, cambiar la búsqueda y comprobar que se conservan las etiquetas y el orden de selección.
3. **Eliminación con permiso:** como Administrador, **Emilia Gómez (demo)** o **Tomás Fernández (demo)** no están vinculados a investigaciones iniciales. Se pueden usar para probar la eliminación con confirmación. Como Digitador no aparece Eliminar.
4. **Restricción por integridad:** **Lucía Benítez (demo)** tiene una investigación asociada; su eliminación debe rechazarse conservando el registro.
5. **Publicaciones:** buscar `ahorro`, `comercio` o el nombre de un autor. Abrir el detalle para revisar metadatos y el enlace a su PDF.
6. **Reportes:** filtrar por **Administración de Empresas (demo)** para obtener tres investigaciones; por **Economía (demo)** para obtener dos. Exportar PDF o Excel de esa misma selección.
7. **Adjuntos:** los PDF de ejemplo están incluidos en `public/demo/`. Elegir uno desde **Crear publicación → Archivo PDF adjunto**, completar una investigación nueva con título, resumen y abstract diferentes y guardar sin enlace. La carga inicial usa enlaces a esos documentos; la nueva carga permite demostrar el guardado de un adjunto.

Los enlaces a PDF se resuelven dentro de la propia aplicación y no requieren un sitio externo. El documento indica expresamente que es ficticio. Los PDF de muestra no contienen resultados de investigación reales.

## Límites

Los datos siguen siendo locales al navegador y dirección utilizada. La consulta pública y los otros módulos marcados En construcción mantienen su alcance previo. La carga de muestras no implementa backend ni funciones adicionales del repositorio.

Implementación: `src/demoData.ts` prepara las muestras mediante las validaciones habituales; `src/DemoDataPanel.tsx` permite cargarlas como Administrador; `src/storage.ts` aplica la carga automática únicamente al crear un almacenamiento nuevo. Las marcas internas de muestra se conservan al editar para evitar duplicados. El guardado de la carga se realiza en una sola confirmación del estado local.
