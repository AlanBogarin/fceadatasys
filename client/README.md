# FCEA-Datasys · Usuarios, catálogos, registro y reporte de investigaciones

## Auditoría y Parámetros generales · 16/10/2026

Se habilitan los **dos módulos que quedaban En construcción** en el menú. Auditoría incluye eventos de operaciones reales, filtros, paginación, detalle y exportación PDF/Excel para Administrador. Parámetros permite cambiar los límites de resumen y PDF; las validaciones y los textos de carga utilizan los valores guardados. Los registros anteriores se conservan.

**Confirmaciones actualizadas por decisión del usuario:** las altas piden un mensaje de confirmación; modificar o eliminar exige la contraseña actual. La escritura de datos y su auditoría es conjunta. No se registran contraseñas ni tokens y no se inventa una IP de cliente. Ver [Auditoría y parámetros](docs/AUDITORIA-Y-PARAMETROS.md) para alcance, pruebas y recorrido. **61 pruebas y compilación**. Continúa siendo un frontend local, sin conectar `server/`.

Las secciones siguientes conservan el historial de entregas; ante una diferencia sobre confirmaciones o módulos disponibles, rige esta actualización.

## Datos institucionales UNC verificados · 16/10/2026

Las muestras incluyen las **seis facultades reales de la UNC**, **cuatro carreras de grado de la FCEA** y **Sede Concepción / Filial Horqueta**, siempre con **(demo)**. Se elimina de la muestra nueva la facultad inexistente «Estudios Sociales». Las personas, investigaciones y códigos siguen siendo ficticios. Fuentes oficiales, nombres y reglas de corrección: [Datos de demostración](docs/DATOS-DE-DEMOSTRACION.md).

Si ya hay datos locales, ingresar como Administrador en **Inicio → Cargar / actualizar datos de prueba** y confirmar con la contraseña actual. Solo se corrigen las denominaciones originales de muestras reconocidas; se conservan registros propios y credenciales. Verificación actual: **52 pruebas** y compilación.

## Revisión del 16/10/2026: catálogo, búsqueda y confirmación

**Catálogo bibliográfico** y **Búsqueda avanzada** ya están disponibles para los tres roles. Incluyen fichas, filtros y paginación; Público consulta metadatos sin descargar adjuntos. Se conserva el avance de Alan de Carga de archivos y creación de publicaciones.

Al **modificar, activar/inactivar o eliminar** registros existentes se exige la contraseña actual antes de guardar. Las altas no piden una segunda contraseña. Cancelar o fallar la verificación conserva los datos; los formularios esperan la confirmación antes de informar éxito. Cerrar sesión se propaga a las otras pestañas de la misma cuenta y origen.

Autores/tutores: nombre, cédula y correo obligatorios; ORCID opcional. Carreras: código obligatorio. Los PDF llevan membrete institucional con ambos escudos. Las reglas anteriores que describen CI/correo opcionales corresponden al historial de la entrega.

Guía y límites: [Revisión posterior al parcial](docs/REVISION-16-OCTUBRE.md). El cliente sigue en modo local; esta revisión no conecta ni modifica `server/`. La reautenticación y los nuevos campos obligatorios deberán exigirse en el servidor al integrar ambos.


## Carga de archivos (16/10/2026)

La pantalla **Carga de archivos** ya permite seleccionar o arrastrar un PDF, guardarlo previamente y usarlo al registrar una publicación. Incluye búsqueda, filtros, paginación, estados disponible/vinculado y descarga de adjuntos vinculados según permisos. Conserva el backend simulado y los datos existentes del navegador; no conecta ni modifica `server/`.

Abrir en el cliente habitual: `http://127.0.0.1:5173/#archivos`. Contrato, comparación con el servidor y recorrido: [Carga de archivos](docs/CARGA-DE-ARCHIVOS.md). Las secciones históricas siguientes describen entregas anteriores. Verificación actual: **43 pruebas**.

## Actualización para la segunda evaluación

- **RN-01:** el nombre de Público se precarga como solo lectura en edición y Mi perfil; la lógica de negocio también rechaza cambios. Cambiar el rol en el mismo guardado no permite modificar ese nombre.
- **RN-02:** eliminar o inactivar exige ausencia de relaciones. Se consultan `repositoryLinks` y los participantes de los catálogos, incluso inactivos. Un catálogo antiguo sin trazabilidad bloquea la baja cautelarmente; no se inventan propietarios ni se borran datos.
- **RN-03:** la contraseña correcta de una cuenta inactiva produce un mensaje específico. Las credenciales incorrectas mantienen el mensaje genérico.
- **RN-04:** las rutas directas verifican permisos. Tras **10 minutos** sin actividad se oculta la zona privada y se exige reautenticación. El plazo se configura en `src/security.ts`; recargar no lo reinicia. El bloqueo de 5 minutos por tres intentos fallidos sigue siendo independiente.

Documentación: [fichas y reglas](docs/usuarios-seguridad/Casos-de-uso-y-reglas.md). Incluye cuatro casos de uso con espacio para capturas y su diagrama de clases inmediato, dos diagramas de actividades, fuentes PlantUML y diagramas SVG. La edición consulta y precarga los datos antes de mostrar el formulario.

El código se organiza en `UserPages.tsx`, `AuthPage.tsx`, `userService.ts`, `model.ts`, `relations.ts`, `security.ts` y `useSession.ts`. Los servicios devuelven `{ exito, mensaje, datos }`; los errores se muestran sin informar éxito si la persistencia falla.

El control estricto de integridad en PostgreSQL y los permisos de servidor siguen pendientes de la implementación del backend. Esta entrega cubre las reglas en la demostración local. La ampliación del 13/10/2026 agrega el registro de investigaciones con enlace externo o PDF adjunto y su reporte PDF/Excel. Ver docs/TRANSACCION-Y-REPORTE.md para el recorrido de presentación.

Interfaz React y TypeScript inspirada en las referencias de Stitch. Alcance solicitado: login, recuperación, menú completo según rol, mantenimiento de usuarios, perfil personal, cambio de contraseña y cierre de sesión. Incluye mantenimiento local de autores, tutores, carreras, facultades, sedes/filiales, tipos de publicación y niveles académicos. Se agrega el registro de publicaciones con enlace o adjunto y su reporte; no se implementa backend ni otros procesos de publicaciones.

## Abrir

Desde esta carpeta:

```powershell
npm install --include=dev --bin-links=true
npm run dev
```

Abrir la dirección indicada por Vite junto a Local (normalmente http://localhost:5173; si está ocupado, usa el siguiente puerto libre). También se puede ejecutar `Iniciar-Frontend.cmd` desde esta carpeta. Mantener la terminal abierta.

## Cuentas de demostración

| Usuario | Contraseña inicial | Rol |
|---|---|---|
| admin | Fcea2026! | Administrador |
| digitador | Fcea2026! | Digitador |
| publico | Fcea2026! | Público |

Son cuentas ficticias, inicializadas en el navegador. La contraseña inicial deja de servir si se modifica. Una cuenta creada desde Usuarios puede iniciar sesión con su contraseña asignada.

## Recorrido para presentar

1. Iniciar como admin y recorrer el menú. Los módulos fuera de alcance indican En construcción y no inventan publicaciones ni reportes.
2. Abrir Usuarios, crear una cuenta, buscarla, filtrar, consultar su detalle y editarla. La baja comprueba dependencias. Inactivar conserva los datos; Eliminar solicita confirmación y elimina únicamente cuentas sin vínculos. No se permite eliminar, inactivar ni degradar al administrador propio ni dejar el sistema sin un administrador activo.
3. Actualizar Mi perfil. CI y rol no son editables desde el perfil personal.
4. Cambiar contraseña verificando la actual; la sesión actual permanece activa. El próximo inicio de sesión requiere la nueva contraseña.
5. Cerrar sesión y probar el acceso de la cuenta creada. Los menús disponibles se corresponden con el rol.
6. Desde login, recuperar la contraseña con el correo de una cuenta local. El botón Continuar con la recuperación representa el enlace del correo y permite probar un cambio de contraseña de un solo uso con vencimiento a los 15 minutos. No envía correos. Se trata expresamente de un recorrido local, no de verificación de identidad.
7. Como administrador, abrir Usuarios y pulsar el candado en Acciones para cambiar la contraseña de otra cuenta. Completar nueva contraseña y confirmación; no se solicita la contraseña anterior del usuario. Rol y estado se conservan, los enlaces de recuperación anteriores se invalidan y la sesión del administrador permanece abierta. El candado de la cuenta propia abre el cambio personal, que exige la contraseña actual.

La tarjeta del dashboard muestra Institución, FCEA · UNC y Universidad Nacional de Concepción. La entrega continúa siendo un frontend local. Mantener la sesión tras el cambio personal no implica emitir o renovar tokens: los contratos de sesión del backend siguen pendientes.

## Persistencia y límites

Los usuarios se conservan en localStorage y la sesión en sessionStorage (por pestaña). Las contraseñas se guardan mediante PBKDF2/SHA-256 con sal aleatoria, nunca en texto plano. El frontend refleja roles y bloqueo de cinco minutos tras tres fallos; estos controles son manipulables desde el navegador y **no sustituyen autenticación/autorización en backend**. No usar datos personales ni contraseñas reales. Sin SMTP, JWT, API, base de datos, antimalware, auditoría persistente de servidor ni sincronización entre equipos. Al resetear contraseña se invalida el acceso anterior; no se simula revocación segura entre pestañas.

La fuente Inter se carga de Google Fonts; si no hay internet se usa Segoe UI. Iconos y estilos están empaquetados localmente. Se usa React/Vite/TypeScript y CSS propio para reproducir el diseño sin depender de Tailwind por CDN.

Para reiniciar la demostración, eliminar en las herramientas del navegador la entrada localStorage `fcea-datasys.frontend.v1` y sessionStorage `fcea-datasys.session`, y recargar. Esto elimina las cuentas, catálogos e investigaciones locales de esta demostración.

## Verificación

```powershell
npm test
npm run build
```

La fase funcional backend del plan maestro sigue pendiente. Esta entrega cubre exclusivamente la demostración frontend autorizada por el usuario.


## Catálogos (segunda entrega)

- Autores: nombre completo obligatorio; CI, correo y ORCID opcionales.
- Tutores: nombre completo obligatorio; CI, correo y especialidad opcionales.
- Carreras: nombre obligatorio; código y descripción opcionales.
- Facultades: nombre obligatorio; sigla y descripción opcionales.
- Sedes/filiales: nombre obligatorio; dirección y descripción opcionales.
- Tipos de publicación y niveles académicos: nombre obligatorio y descripción opcional.

Cada pantalla permite crear, consultar detalle, editar, buscar, filtrar por estado, paginar, inactivar y reactivar. La versión de demostración incorpora muestras ficticias identificadas, con 14 autores, 12 tutores, los siete catálogos y 8 investigaciones. En instalaciones existentes se agregan desde Inicio como Administrador; no se reemplazan datos propios. Los registros se conservan en el mismo almacenamiento local que las cuentas. Al abrir una copia actualizada en el mismo navegador y origen, la migración agrega los catálogos vacíos sin borrar usuarios ni contraseñas. Una sesión antigua sin plazo de inactividad requiere reautenticación. Cambiar puerto u host crea un almacenamiento independiente del navegador.

Nombres únicos por catálogo, normalizados por mayúsculas, acentos, puntuación y espacios. CI, correo, ORCID, código o sigla también se comparan cuando se informan. La regla de nombre único sigue el contrato de catálogos; antes de integrar personas reales deberá acordarse el tratamiento de homónimos. ORCID se valida por formato, sin consulta al registro oficial. Administrador puede eliminar registros sin vínculos, previa confirmación. Los catálogos relacionados con investigaciones no pueden eliminarse ni inactivarse. Digitador no puede eliminar. Editar un registro inactivo no lo reactiva.

Administrador: mantiene los siete catálogos. Digitador: mantiene autores y tutores. Público: sin acceso a estos mantenimientos. Roles y permisos muestra la matriz fija de los tres roles, sin cambiar sus definiciones. La asignación de roles continúa en Usuarios.

### Recorrido de comprobación

1. Ingresar como admin, abrir Autores y crear un registro de prueba.
2. Editarlo, buscar por nombre o correo, ver su detalle e inactivarlo desde Acciones.
3. Filtrar Inactivos y reactivarlo. Recargar para verificar persistencia.
4. Repetir la carga en los otros catálogos. Un nombre duplicado debe mostrar un error incluso si el original está inactivo.
5. Ingresar como digitador: debe disponer de autores y tutores, sin administración de carreras u otros catálogos. Una ruta directa a un catálogo restringido muestra Acceso restringido.

### Exportaciones acordes a los requisitos

Los requisitos del proyecto ubican PDF y Excel en Reportes (Administrador) y la exportación de registros en Auditoría (Administrador). No se agregan exportaciones a cada mantenimiento. Reportes de investigaciones permite descargar PDF y Excel de las transacciones guardadas; la consulta y exportación de Auditoría de servidor siguen pendientes. Si luego se solicita exportar un catálogo, se deberá definir su finalidad, columnas y permisos, aplicar los filtros activos y evitar generar archivos vacíos.

### Integración posterior

Estos registros son exclusivamente locales. El backend deberá establecer el contrato de cada entidad, replicar permisos y unicidad, auditar cambios y controlar referencias antes de inactivar registros vinculados a publicaciones activas. No existen todavía publicaciones ni relaciones N:M en esta demostración. Las pantallas de publicaciones, parámetros generales, reportes y auditoría siguen pendientes. La matriz de roles describe también permisos de módulos futuros y los identifica como pendientes.


## Buscadores, adjuntos y eliminación (14/10/2026)

- Autores y tutores: búsqueda por nombre, CI, correo u otros campos; hasta 10 coincidencias por página. Las personas elegidas permanecen visibles y conservan el orden al buscar o paginar. Se retiran con la X de su etiqueta.
- Documento: elegir **Enlace externo** o **Archivo PDF adjunto**. Se exige una modalidad, no ambas. PDF hasta 10 MB, firma y final de archivo comprobados, nombre saneado y huella SHA-256 para rechazar adjuntos duplicados. Estas verificaciones no equivalen a un análisis antivirus ni a un validador completo de PDF.
- Los PDF se conservan en IndexedDB (`fcea-datasys.attachments`), mientras los metadatos siguen en localStorage. La descarga de adjuntos exige Administrador o Digitador activo y registra una entrada en la bitácora local. El reporte identifica el nombre del adjunto sin incrustar sus páginas.
- Si falla el guardado del PDF, no se confirma la investigación. Si se rechaza la confirmación de metadatos, se intenta retirar el binario nuevo. Son dos almacenes locales: ante un cierre abrupto puede quedar un binario huérfano, sin registro visible. No se simula una transacción de servidor.
- Usar el mismo navegador, host y puerto para recuperar los registros y archivos. El ZIP no contiene los datos ingresados. Para reiniciar por completo la demostración, borrar además la base IndexedDB indicada. El almacenamiento compartido, las garantías transaccionales y el análisis antimalware requieren backend.
- Eliminar: botón de papelera en los siete catálogos para Administrador. Se solicita confirmación y se rechaza si hay investigaciones vinculadas; las validaciones no dependen solamente de ocultar el botón.
- La pestaña del navegador utiliza el escudo FCEA como ícono.

El manual de usuario anterior describe la versión previa; para estos cambios consultar esta sección y `docs/TRANSACCION-Y-REPORTE.md`.

## Datos listos para la demostración

En una primera apertura se cargan automáticamente **45 registros de catálogos y 8 investigaciones**, con **8 PDF ficticios** incluidos en `public/demo/`. Las tres cuentas iniciales y sus contraseñas se conservan.

Si ya tenés datos en el navegador, ingresá como Administrador y usá **Inicio → Cargar / actualizar datos de prueba**. No es un reinicio: conserva registros propios, corrige las denominaciones institucionales originales de la muestra antigua y no duplica las muestras al repetirla. Incluye personas sin vínculos y personas vinculadas para mostrar las dos respuestas de Eliminar, además de autores y tutores inactivos.

Guía de exposición: [Datos de demostración](docs/DATOS-DE-DEMOSTRACION.md). Las fechas de muestra abarcan los últimos 40 días respecto de la carga inicial; los reportes usan esos mismos registros. Los PDF se abren desde los enlaces del detalle y pueden usarse para ensayar un nuevo adjunto.

Verificación actual: **37 pruebas**, incluyendo permisos, conservación de datos anteriores, carga inicial e idempotencia de la muestra.
