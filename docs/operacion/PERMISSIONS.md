# Permisos configurables

Ampliación solicitada el 26/10/2026. Los tres roles se conservan como perfiles iniciales. **Roles y permisos** permite cambiar las acciones de cada rol y definir excepciones por cuenta: **heredar**, **permitir** o **denegar**. Las excepciones prevalecen sobre el rol. La consulta del catálogo, perfil, contraseña propia y cierre de sesión siguen disponibles a toda cuenta activa autenticada.

Los permisos efectivos se incluyen en `GET /api/v1/auth/session` y `GET /api/v1/me`. Se consultan desde PostgreSQL en cada solicitud; la API comprueba nuevamente los permisos antes de confirmar escrituras/exportaciones/descargas. Una revocación no depende del vencimiento del JWT. La interfaz actualiza navegación y botones con los permisos de sesión; la lectura periódica de sesión y coordinación entre pestañas reflejan los cambios.

Por defecto, Administrador tiene todos los permisos, Digitador conserva carga/edición de publicaciones, archivos y autores/tutores, y Público consulta metadatos. Pueden delegarse reportes, auditoría y catálogos. `permissions.manage` y `backups.manage` requieren siempre Administrador. La última cuenta Administrador activa con `permissions.manage` no se puede deshabilitar ni privar de ese permiso. Tener acceso a Usuarios no permite modificar cuentas superiores ni asignar roles diferentes sin `permissions.manage`; tampoco mediante la asignación de contraseñas.

Cada cambio de permisos exige contraseña actual e `If-Match` y registra valores anteriores/nuevos. Los cambios de usuarios, roles y política comparten la exclusión administrativa para proteger el último gestor ante concurrencia. Un conflicto de versión exige recargar y revisar la política antes de guardar.

La lista de permisos y sus nombres se entrega desde `GET /api/v1/permisos` (`definitions`); el servidor rechaza claves desconocidas y duplicadas. Catálogos diferencia gestión/eliminación; usuarios diferencia consulta, mantenimiento, eliminación y contraseñas; publicaciones diferencia alta, edición, inactivación e historia; reportes/auditoría diferencian consulta/exportación. Archivos diferencia carga/consulta, descarga y uso de archivos de otras cuentas.

`20261026000000_permissions` inicia la política conservando los accesos previos. `20261026010000_backups` añade el historial de copias. Aplicar los grants actualizados. Hay SQL de reversión en `server/prisma/rollback`; usarlo junto con la versión anterior de la aplicación y después de preservar la historia de respaldos.
