# Auditoría, parámetros y confirmaciones · 16/10/2026

Los dos módulos del menú que quedaban **En construcción** están disponibles: **Auditoría** y **Parámetros generales**. Se conserva la demostración local, el diseño institucional y las muestras UNC identificadas con (demo). No se modifica ni conecta `server/`.

## Auditoría

Solo un **Administrador activo** puede abrir, consultar, filtrar, ver el detalle y exportar esta bitácora. Digitador y Público reciben Acceso restringido incluso mediante la dirección directa `#auditoria`.

La pantalla permite buscar sin distinguir acentos/mayúsculas y combinar fechas, usuario, módulo, operación y resultado. Lista diez eventos por página y ofrece un detalle de cada entrada, sin acciones de modificación o eliminación. PDF A4 con membrete FCEA/UNC y Excel exportan la selección completa de los filtros, no solo la página visible; sin resultados no se genera un archivo.

Cada evento nuevo conserva ID, fecha UTC (mostrada en horario de Paraguay), usuario/rol, operación, módulo, recurso y publicación cuando corresponde, resultado, detalle, valores anteriores/nuevos cuando están disponibles, identificador local de sesión y navegador. **La IP se informa como no disponible**: un frontend local no puede obtener de forma fiable la IP de un cliente de servidor y no consulta servicios externos para inventarla. El identificador local no es un token de autenticación.

Se registran los accesos correctos/rechazados, cierre de sesión con duración, bloqueo por inactividad, accesos a páginas sin permiso, altas/cambios/bajas de usuarios y catálogos, cambios de rol o contraseña, publicaciones, cargas/rechazos/descargas de adjuntos, parámetros, exportaciones y rechazos que llegan a los manejadores del cliente. La validación nativa del navegador puede impedir el envío de un formulario incompleto antes de iniciar una operación. Un cierre físico de pestaña no se presenta como un logout confirmado.

Las bitácoras existentes `publicationAudit` y `attachmentAudit` se incorporan a la consulta con origen **Anterior**. No se reconstruyen supuestos inicios de sesión ni valores previos. Los eventos nuevos asociados a esas mismas entradas se identifican por origen para evitar duplicados. Los usuarios eliminados siguen identificados en sus eventos por la instantánea guardada.

Contraseñas, hashes de credenciales, sales y tokens de recuperación no se incluyen en los eventos ni en sus exportaciones. Las instantáneas y los mensajes se depuran. Los datos personales de registros administrados que participan en una modificación siguen siendo visibles únicamente para Administrador dentro de la bitácora local.

## Persistencia y seguridad de la demostración

Los cambios de negocio y sus eventos nuevos se preparan juntos y se guardan mediante una única escritura del estado local. Si esa escritura falla, la pantalla no informa éxito ni guarda el cambio de negocio por separado. El flujo rechaza cambios calculados sobre datos desactualizados. La bitácora es de solo adición en el flujo de la aplicación: el servicio rechaza la sustitución/borrado de eventos y devuelve copias para consultar.

Una contraseña de confirmación incorrecta agrega un evento fallido sin modificar los datos pendientes. Esa escritura de auditoría no invalida por sí sola el formulario de confirmación: se conserva al confirmar después correctamente. Un cambio real de datos en otra operación sí impide confirmar sobre una versión desactualizada.

Esto no constituye auditoría inmutable de PostgreSQL ni protección frente a manipulación de localStorage con herramientas del navegador. Al integrar el servidor se deberán aplicar autorización, identificación de sesión/IP, controles de auditoría, transacciones y restricciones de base de datos en el servidor. No se fabrican esas garantías dentro de una interfaz local.

## Parámetros generales

Solo Administrador puede modificarlos; guardar exige su contraseña actual y genera un evento con valores anteriores/nuevos.

| Parámetro | Inicial | Rango | Aplicación |
|---|---:|---:|---|
| Palabras máximas del resumen | 300 | 10–1000 | Validación del registro de nuevas investigaciones |
| Tamaño máximo de PDF | 10 MB | 1–25 MB | Preparación de nuevas cargas en Carga de archivos y Crear publicación |

Las pantallas muestran el límite vigente. Los archivos y publicaciones anteriores no se alteran ni se invalidan al reducirlo. El formato habilitado continúa siendo **PDF**, con comprobación de contenido, tamaño y huella; no se habilitan formatos que no tengan validador. Se conservan los **10 minutos** de inactividad y el bloqueo de **5 minutos tras 3 intentos** acordados previamente.

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

Verificación: **61 pruebas automáticas**, revisión de TypeScript y compilación. Pruebas en navegador de acceso fallido/correcto, modificación con contraseña incorrecta/correcta, confirmación/cancelación de alta, filtros, detalle y exportaciones. Se revisó visualmente el PDF A4 generado.

Archivos principales: `audit.ts`, `AuditPage.tsx`, `auditExports.ts`, `auditSignals.ts`, `settings.ts`, `SettingsPage.tsx`, `useMutationConfirmation.tsx`, integración en `App.tsx` y `administration.test.ts`.
