# Auditoría, parámetros y confirmaciones

Guía consolidada al 17/10/2026. Las verificaciones de 61/63 pruebas consignadas al final pertenecen al hito del 16/10; el cierre actual registra 87 pruebas y build, documentados en [ADAPTACIONES-CLIENTE.md](ADAPTACIONES-CLIENTE.md).

Los dos módulos del menú que quedaban **En construcción** están disponibles: **Auditoría** y **Parámetros generales**. Se conserva la demostración local, el diseño institucional y las muestras UNC identificadas con (demo). No se modifica ni conecta `server/`.

## Auditoría

Solo un **Administrador activo** puede abrir, consultar, filtrar, ver el detalle y exportar esta bitácora. Digitador y Público reciben Acceso restringido incluso mediante la dirección directa `#auditoria`.

La pantalla permite buscar sin distinguir acentos/mayúsculas y combinar fechas, usuario, **rol registrado en el evento**, módulo, operación y resultado. El rol incluye **Sin identificar** para accesos fallidos sin cuenta reconocida. La búsqueda incluye ID del evento, nombre y usuario actual de la cuenta cuando todavía existe, operación, recurso, publicación, sesión y detalle. Cambiar el rol de una cuenta no cambia el rol histórico de sus eventos.

Lista diez eventos por página inicialmente, con selector de **10, 25 o 50**, contador de resultados y navegación. Los cambios de filtros o tamaño reinician la primera página. Diferencia visualmente operaciones exitosas/fallidas y distingue historial vacío de búsqueda sin coincidencias. El detalle muestra los identificadores de recurso y publicación, sesión, navegador y valores anteriores/nuevos en paralelo, sin acciones de modificación o eliminación.

PDF A4 con membrete FCEA/UNC y Excel exportan la selección completa de los filtros, incluido el rol, no solo la página visible; sin resultados no se genera un archivo. Durante la generación los filtros quedan bloqueados para conservar la selección exportada y se impiden exportaciones simultáneas. Se vuelve a comprobar la sesión y el estado antes de entregar el archivo.

Estos filtros pertenecen a `AuditFilters`; el servidor ya dispone de listado, detalle y exportación de auditoría. El adaptador debe mapearlos a su contrato en [CLIENT-INTEGRATION.md](../../server/docs/CLIENT-INTEGRATION.md). La pantalla está disponible en **Administración → Auditoría** (`#auditoria`) y aplica su propia comprobación de Administrador activo además del control del menú/ruta.

Cada evento nuevo conserva ID, fecha UTC (mostrada en horario de Paraguay), usuario/rol, operación, módulo, recurso y publicación cuando corresponde, resultado, detalle, valores anteriores/nuevos cuando están disponibles, identificador local de sesión y navegador. **La IP se informa como no disponible**: un frontend local no puede obtener de forma fiable la IP de un cliente de servidor y no consulta servicios externos para inventarla. El identificador local no es un token de autenticación.

Se registran los accesos correctos/rechazados, cierre de sesión con duración, bloqueo por inactividad, accesos a páginas sin permiso, altas/cambios/bajas de usuarios y catálogos, cambios de rol o contraseña, publicaciones, cargas/rechazos/descargas de adjuntos, parámetros, exportaciones y rechazos que llegan a los manejadores del cliente. La validación nativa del navegador puede impedir el envío de un formulario incompleto antes de iniciar una operación. Un cierre físico de pestaña no se presenta como un logout confirmado.

Las bitácoras existentes `publicationAudit` y `attachmentAudit` se incorporan a la consulta con origen **Anterior**. No se reconstruyen supuestos inicios de sesión ni valores previos. Los eventos nuevos asociados a esas mismas entradas se identifican por origen para evitar duplicados. Los usuarios eliminados siguen identificados en sus eventos por la instantánea guardada.

Contraseñas, hashes de credenciales, sales y tokens de recuperación no se incluyen en los eventos ni en sus exportaciones. Las instantáneas y los mensajes se depuran. Los datos personales de registros administrados que participan en una modificación siguen siendo visibles únicamente para Administrador dentro de la bitácora local.

## Persistencia y seguridad de la demostración

Los cambios de negocio y sus eventos nuevos se preparan juntos y se guardan mediante una única escritura del estado local. Si esa escritura falla, la pantalla no informa éxito ni guarda el cambio de negocio por separado. El flujo rechaza cambios calculados sobre datos desactualizados. La bitácora es de solo adición en el flujo de la aplicación: el servicio rechaza la sustitución/borrado de eventos y devuelve copias para consultar.

Una contraseña de confirmación incorrecta agrega un evento fallido sin modificar los datos pendientes. Esa escritura de auditoría no invalida por sí sola el formulario de confirmación: se conserva al confirmar después correctamente. Un cambio real de datos en otra operación sí impide confirmar sobre una versión desactualizada.

Esto no constituye auditoría inmutable de PostgreSQL ni protección frente a manipulación de localStorage con herramientas del navegador. El servidor ya implementa autorización, identificación de sesión/IP, controles de auditoría, transacciones y restricciones de base de datos. La integración debe consumir esos servicios y sustituir las escrituras/exports del simulador. No se fabrican esas garantías dentro de una interfaz local.

## Parámetros generales

Solo Administrador puede modificarlos; guardar exige su contraseña actual y genera un evento con valores anteriores/nuevos.

| Parámetro | Inicial | Rango | Aplicación |
|---|---:|---:|---|
| Palabras máximas del resumen | 300 | 10–1000 | Validación del registro de nuevas investigaciones |
| Tamaño máximo de archivos (`maxPdfSizeMb`) | 10 MiB | 1–25 MiB | Nuevas cargas PDF/TXT en Carga de archivos y publicaciones |
| Formatos habilitados | PDF | PDF, TXT; al menos uno | Solo formatos con validador implementado |

Las pantallas muestran el límite vigente. La fachada conserva ETag de parámetros y envía la versión al guardar; un conflicto 412 conserva el formulario para revisión. Los archivos y publicaciones anteriores no se alteran ni se invalidan al reducirlo. **PDF** es el único formato inicial; Admin también puede habilitar **TXT**. Ambos tienen comprobación de contenido, tamaño y huella; el servidor añade ClamAV. No se habilitan formatos que no tengan validador. Se conservan los **10 minutos** de inactividad y el bloqueo de **5 minutos tras 3 intentos** acordados previamente.

Una instalación antigua lee los parámetros iniciales sin reiniciar sus datos ni sus credenciales. Cambiar el host/puerto del navegador mantiene la separación de almacenamientos que ya tenía el prototipo.

## Confirmaciones acordadas por el usuario

- **Altas** de usuarios, catálogos, publicaciones, cargas y muestras nuevas: mensaje con los registros que se crearán, botones **Confirmar registro** y **Cancelar sin guardar**. No requiere segunda contraseña.
- **Modificaciones, activaciones/inactivaciones y eliminaciones** de registros existentes, incluidos parámetros y correcciones de muestras antiguas: contraseña actual de quien realiza la operación.
- Las bitácoras automáticas, consultas y exportaciones no piden confirmación de alta.

Cancelar no aplica los cambios. Si ya se había preparado un archivo nuevo, el mecanismo existente retira el binario que no llegó a confirmarse. Las eliminaciones conservan las restricciones de integridad de cada módulo.

## Recorrido para presentar

1. Entrar como Admin. Una contraseña incorrecta y luego la correcta permiten mostrar ambos eventos de acceso.
2. Abrir Parámetros; cambiar 300 a 200 palabras. Cancelar debe conservar 300. Volver a guardar, probar una contraseña incorrecta y confirmar con la correcta. La misma operación debe poder completarse y conservar ambos eventos.
3. Abrir Auditoría, filtrar Módulo = Parámetros y abrir el detalle para comparar valores.
4. Crear un tipo de publicación de prueba; cancelar primero y confirmar después. Mostrar los eventos correspondientes.
5. Exportar PDF/Excel con un filtro, comprobar su contenido y limpiar filtros. Probar una búsqueda sin coincidencias.
6. Cerrar sesión, entrar como Público o Digitador e intentar abrir `#auditoria` o `#parametros`: debe rechazarse. Volver como Admin y consultar el evento de acceso denegado.

Verificación histórica del 16/10/2026: **61 pruebas automáticas**, revisión de TypeScript y compilación. Pruebas en navegador de acceso fallido/correcto, modificación con contraseña incorrecta/correcta, confirmación/cancelación de alta, filtros, detalle y exportaciones. Se revisó visualmente el PDF A4 generado.

Archivos principales: `audit.ts`, `AuditPage.tsx`, `auditExports.ts`, `auditSignals.ts`, `settings.ts`, `SettingsPage.tsx`, `useMutationConfirmation.tsx`, integración en `App.tsx` y `administration.test.ts`.

### Validación de la ampliación de la ventana

La ampliación del 16/10/2026 cerró con **63 pruebas**. La prueba nueva cubre el rol histórico tras cambiar el rol de una cuenta, accesos sin identificar y búsqueda por ID, usuario actual, publicación y sesión; las exportaciones comprueban la selección por rol y sus criterios. Se mantiene la cobertura de permisos, solo adición, eliminación de credenciales y persistencia conjunta.

En el navegador se comprobaron el login fallido/correcto, el filtro Sin identificar, el detalle de un fallo, búsqueda sin coincidencias con exportación deshabilitada, reinicio de filtros, descargas PDF/Excel con un evento seleccionado, paginación de 13 eventos y cambio de 10 a 25 registros. Digitador y Público no ven el acceso del menú y reciben Acceso restringido al abrir `#auditoria`. Sin errores de consola durante el recorrido. Se guardó una captura de la ventana completa; no se modificó `server/`.
