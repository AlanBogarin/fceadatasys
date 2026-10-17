# Revisión posterior al segundo parcial · 16/10/2026

Base revisada: `AlanBogarin/fceadatasys`, commit `de0a7c0` (ventana Carga de archivos). Se conserva la carga previa, las modalidades local/externa y la selección de un archivo ya cargado al registrar una publicación.

## Cambios funcionales

- **Catálogo bibliográfico:** disponible para las tres cuentas, con búsqueda por código, título, resumen, abstract, palabras clave, autores y tutores; filtros por carrera/tipo; paginación de 6, 12 o 24 registros; consulta de la ficha completa.
- **Búsqueda avanzada:** combina los criterios anteriores con nivel, filial, autor, tutor, año de publicación, procedencia y período de registro. Los filtros se combinan con AND. El período corresponde a creación del registro en horario de Paraguay, no al año del trabajo.
- La búsqueda local ignora acentos y mayúsculas y admite subcadenas en español/inglés. Es búsqueda local; no se presenta como FTS de PostgreSQL.
- **Rol Público:** consulta los metadatos y sabe si hay adjunto, pero la proyección de lectura y la pantalla no incluyen nombre, identificador, hash ni botón de descarga del adjunto. Admin y Digitador conservan la descarga controlada existente. Los enlaces externos válidos siguen disponibles como metadatos.
- **Personas:** nombre completo, cédula y correo obligatorios al crear/editar autores y tutores. ORCID sigue opcional; si se informa, se valida su formato. La especialidad del tutor también es opcional.
- **Carreras:** nombre y código obligatorios. Se conserva la comprobación de duplicados.
- **Reportes PDF:** membrete FCEA/UNC con ambos escudos en todas las páginas, nombre de la universidad/facultad y Dirección de Investigación. Los recursos se incluyen en la exportación para que el membrete no dependa de conexión externa.

Los nuevos requisitos de cédula/correo obligatorios sustituyen, en el cliente, la regla anterior que permitía dejarlos vacíos. No se inventan datos para personas guardadas en versiones previas: pueden consultarse y deben completarse cuando se editen. Las muestras nuevas sí incluyen cédulas explícitamente ficticias.

## Confirmación por contraseña: decisión del usuario

Se solicita **solo para modificar, activar/inactivar o eliminar registros existentes**. Las altas nuevas no piden una segunda contraseña. Tampoco la pide el guardado automático de bitácoras de acceso/descarga. Login y recuperación conservan sus propios recorridos.

1. El formulario valida datos y permisos y prepara el estado siguiente sin persistirlo.
2. Si modifica/elimina una cuenta, catálogo, investigación o archivo existente, abre **Confirmación de seguridad**, indicando los registros afectados.
3. Se comprueba la contraseña vigente de la persona que inició sesión. Al administrar otra cuenta se usa la contraseña del administrador, no la del usuario editado.
4. Contraseña incorrecta mantiene la operación pendiente sin guardar. Cancelar, cerrar la confirmación o cambiar de página/sesión rechaza el guardado. Tres errores de confirmación cierran la sesión; no reemplazan el bloqueo de login por cinco minutos ya existente.
5. Contraseña correcta vuelve a comprobar sesión y estado actual, persiste y recién después permite informar éxito. Un cambio concurrente invalida la operación pendiente en lugar de sobrescribir datos.

La contraseña ingresada no se guarda en localStorage/sessionStorage ni se incluye en bitácoras. Las operaciones siguen siendo locales y estos controles no constituyen autorización de servidor.

**Contrato de implementación:** los formularios deben esperar `await commit(nuevoEstado)` antes de cerrar o notificar éxito. No deben escribir directamente mediante `save`. La persistencia de adjuntos también espera esa confirmación y retira un binario nuevo si el guardado de metadatos se rechaza, incluso de forma asíncrona.

## Cierre entre pestañas: decisión del usuario

Al pulsar **Cerrar sesión**, se cierran las demás pestañas de **esa misma cuenta, navegador y origen**. Se utiliza una generación persistida de cierre y notificación mediante eventos de almacenamiento/BroadcastChannel. También se comprueba la generación antes de guardar y al recuperar foco, para evitar que una pestaña suspendida continúe una sesión cerrada.

Cerrar físicamente una pestaña no cierra las demás. No se agregan cierres automáticos al recargar o navegar. Cuentas distintas y otros equipos/orígenes conservan sus sesiones independientes. El bloqueo por diez minutos de inactividad permanece vigente.

## Pruebas para presentar

1. Abrir Catálogo bibliográfico como `publico`; buscar `educacion financiera` y abrir Ver ficha.
2. Abrir Búsqueda avanzada y combinar carrera, año o nombre de autor. Probar Limpiar filtros y un término sin coincidencias.
3. Como Admin, crear un autor con nombre/cédula/correo, dejando ORCID vacío. Crear no debe pedir otra contraseña.
4. Editar una facultad sin vínculos. Al guardar debe aparecer la confirmación. Cancelar conserva el valor anterior. Repetir con una contraseña incorrecta y verificar que no cambió. Confirmar con la contraseña correcta y comprobar la actualización.
5. Abrir dos pestañas, iniciar con la misma cuenta y cerrar sesión desde una: ambas deben volver al acceso.
6. Descargar un reporte PDF y revisar el membrete y los escudos. Las muestras y las cuentas previas no se reinician al actualizar archivos.

Cuentas de demostración iniciales: `admin`, `digitador`, `publico`; contraseña inicial `Fcea2026!`, salvo que se haya cambiado en ese navegador.

Verificación: **52 pruebas automáticas** tras agregar las verificaciones de datos institucionales UNC, compilación TypeScript/Vite y pruebas reales de catálogo, paginación, búsqueda avanzada, alta sin ORCID, cancelación, contraseña incorrecta/correcta, cierre simultáneo de dos pestañas y exportación con membrete. Se inspeccionó visualmente el PDF descargado en A4. La revisión de datos institucionales también comprobó las seis facultades, cuatro carreras y dos sedes en la interfaz; los nombres largos se ajustan a su celda.

## Integración pendiente con el servidor de Alan

Esta revisión modifica `client/`, que sigue usando almacenamiento local. `server/` se conserva sin modificaciones y el cliente no lo invoca. No se aplican migraciones ni se altera su base de datos.

Antes de conectar ambos, los nuevos requisitos deben aplicarse también en sus esquemas/endpoints de escritura: cédula/correo obligatorios para personas y código para carreras, y una política de reautenticación de servidor para modificaciones/bajas. El contrato actual del servidor permite CI/correo opcionales; un formulario obligatorio no cambia ese contrato por sí solo. No se afirma que una confirmación local impida solicitudes directas a una API.

La futura adaptación debe mapear las consultas a `/api/v1/publicaciones`; el servidor usa FTS y filtros `authorId`/`tutorId`, mientras esta pantalla local admite búsqueda por nombres. No se debe enviar el State del navegador al servidor ni confiar en su rol, hash o bitácora. Conectar el transporte de descarga debe conservar las restricciones de Público y las verificaciones del servidor.

Archivos principales: `BibliographicPage.tsx`, `bibliography.ts`, `mutationPolicy.ts`, `useMutationConfirmation.tsx`, `useSession.ts`, `sessionSignals.ts`, `catalogs.ts`, `CatalogPage.tsx`, `publicationExports.ts`; adaptación de formularios y del servicio de adjuntos para esperar la confirmación.
