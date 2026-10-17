# Datos de demostración · FCEA-Datasys

Las facultades, carreras y sedes usan denominaciones reales de la **Universidad Nacional de Concepción, Paraguay**, verificadas en sus sitios oficiales el **16/10/2026**. Se mantienen identificadas con **(demo)**: los códigos son sintéticos y la aplicación sigue siendo una demostración académica. Las personas, sus contactos y los trabajos son ficticios. No se modifican las cuentas ni las contraseñas existentes.

## Cargar y abrir

- **Navegador/origen nuevo:** al abrir el sistema por primera vez se crean las tres cuentas de demostración y se carga esta muestra automáticamente.
- **Instalación con datos guardados:** ingresar como Administrador y abrir **Inicio → Cargar / actualizar datos de prueba**. Se agregan las muestras faltantes y se corrigen las denominaciones institucionales originales de versiones anteriores. Si hay modificaciones, se exige la contraseña actual antes de guardar. Cancelar conserva todo el estado anterior. Repetir la carga no duplica registros.
- Si existe un conflicto de validación, no se confirma una carga parcial. El mensaje indica el motivo; revisar los catálogos antes de volver a intentar.

Cuentas iniciales: `admin`, `digitador`, `publico`. Contraseña inicial: `Fcea2026!`. Si se cambió antes, se conserva la contraseña cambiada.

## Contenido

| Catálogo o módulo | Cantidad de muestras |
|---|---:|
| Autores | 14: 13 activos y 1 inactivo |
| Tutores | 12: 11 activos y 1 inactivo |
| Carreras | 4 |
| Facultades UNC | 6 |
| Sedes/filiales FCEA | 2 |
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
6. **Reportes:** filtrar por **Licenciatura en Administración (demo)** para obtener tres investigaciones; por **Ingeniería Comercial (demo)** para obtener dos. Exportar PDF o Excel de esa misma selección.
7. **Adjuntos:** los PDF de ejemplo están incluidos en `public/demo/`. Elegir uno desde **Crear publicación → Archivo PDF adjunto**, completar una investigación nueva con título, resumen y abstract diferentes y guardar sin enlace. La carga inicial usa enlaces a esos documentos; la nueva carga permite demostrar el guardado de un adjunto.

Los enlaces a PDF se resuelven dentro de la propia aplicación y no requieren un sitio externo. El documento indica expresamente que es ficticio. Los PDF de muestra no contienen resultados de investigación reales.

## Datos institucionales y fuentes

La [página oficial de la UNC](https://www.unc.edu.py/) enumera seis facultades en su menú Facultades:

- Facultad de Ciencias Económicas y Administrativas.
- Facultad de Humanidades y Ciencias de la Educación.
- Facultad de Ciencias Agrarias.
- Facultad de Ciencias Exactas y Tecnológicas.
- Facultad de Medicina.
- Facultad de Odontología.

La [página oficial de la FCEA](https://fcea-unc.edu.py/) publica cuatro carreras de grado: Licenciatura en Administración, Contaduría Pública, Ingeniería Comercial e Ingeniería en Informática Empresarial. En los datos de muestra se usan esas cuatro carreras de la FCEA, sin atribuirlas a otras facultades. Economía es una mención de Ingeniería Comercial, no se carga como carrera independiente. Los identificadores `DEMO-CAR-*` y `DEMO-FAC-*` son internos de prueba, no códigos ni siglas oficiales.

La misma fuente publica **Sede Concepción**, en Ruta PY-05 «Gral. Bernardino Caballero» Km 210, y **Filial Horqueta**, en Av. Capitán Gumercindo Sosa c/ Ruta V. Ingeniería Comercial e Informática Empresarial se ofrecen en Concepción; Administración y Contaduría también en Horqueta. Las investigaciones de muestra respetan estas ubicaciones. Sus niveles y tipos siguen siendo clasificaciones genéricas de prueba, sin afirmar que cada combinación represente una oferta real de postgrado.

### Corrección de muestras antiguas

Se reconoce cada registro por su marca interna `fcea-demo-v1/...` y su nombre original. Se reemplazan las denominaciones incorrectas de carreras, la facultad inexistente y las antiguas sedes genéricas. Se conservan los IDs de los registros corregidos, las fechas originales, los estados inactivos y los campos personalizados. Los nombres que el usuario haya editado se respetan.

La antigua tercera filial ficticia se consolida en las dos sedes verificadas y se corrigen únicamente los vínculos/etiquetas originales de las investigaciones de muestra. Se conservan sus IDs, códigos, archivos, fechas, autores, tutores y auditorías. No se reescriben las instantáneas históricas de trabajos propios. Si un trabajo propio o editado referencia esa filial sobrante, se rechaza toda la actualización e informa que primero debe corregirse su sede; no se borra la referencia ni se guarda una actualización parcial. Las colisiones con nombres propios también cancelan la preparación.

El estado final de una muestra nueva contiene **45 registros de catálogos y 8 investigaciones**. Una instalación previa con exactamente la muestra antigua agrega cuatro facultades, corrige ocho registros institucionales y ocho fichas de muestra, y consolida la filial sobrante. No se reinicia el almacenamiento.

## Límites

Los datos siguen siendo locales al navegador y dirección utilizada. Catálogo bibliográfico y Búsqueda avanzada están disponibles; los otros módulos conservan su alcance previo. La carga de muestras no implementa backend, migraciones SQL ni sincronización con la universidad.

Implementación: `src/institutionalDemo.ts` contiene los datos institucionales, sus fuentes y la fecha de consulta; `src/demoData.ts` prepara las muestras y correcciones; `src/DemoDataPanel.tsx` permite cargarlas como Administrador; `src/storage.ts` aplica la carga automática únicamente al crear un almacenamiento nuevo. El guardado se realiza en una sola confirmación local. Pruebas de actualización, idempotencia, preservación y conflictos: `src/demoData.test.ts`.
