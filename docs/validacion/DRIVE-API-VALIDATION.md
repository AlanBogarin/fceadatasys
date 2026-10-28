# Copias con Google Drive API — 27/10/2026

Se inspeccionaron `AGENTS.md`, el estado Git limpio, el motor de copias Fastify/Prisma, el lanzador y asistente de instalación, los contratos de auditoría/API y las pruebas existentes. La integración de nube utiliza directamente Drive API v3 mediante HTTP de Node.js, sin dependencias npm adicionales ni ejecutables externos de transferencia.

## Implementación y contratos

- Autorización OAuth para cliente de escritorio, callback temporal en loopback, `state`, PKCE y alcance `drive.file`. Creación de una carpeta propia, persistencia del ID en configuración y tokens privados mediante sustitución atómica. Los tokens de acceso solo viven en memoria; se renuevan sin interacción.
- Configuración privada: `DRIVE_CLIENT_FILE`, `DRIVE_TOKEN_FILE`, `DRIVE_FOLDER_NAME` y `DRIVE_FOLDER_ID`. Rutas relativas resueltas desde el archivo de copias. Se rechazan clientes web/cuentas de servicio, autorizaciones de otro cliente, archivos superpuestos y secretos dentro del cliente público, también mediante uniones de directorios.
- Subida reanudable en bloques de hasta 8 MiB, tiempo máximo, reintentos limitados y consulta del rango confirmado ante cortes. Se verifica metadata obtenida por ID: nombre, carpeta, tamaño y MD5.
- Se conservan copia local custom, validación de cabecera/índice PostgreSQL, SHA-256 en auditoría, exclusión PostgreSQL, permisos efectivos y estados del historial. Un fallo de nube conserva el respaldo local. Un fallo de auditoría cancela el intento y compensa sus efectos externos cuando los destinos están accesibles.
- Se reserva un ID remoto antes de subir y se registra como `driveFileId` en auditoría. La compensación solo intenta retirar ese ID. `BackupDto` y los endpoints existentes se conservan; no se requieren migraciones.
- Asistente actualizado y comando `npm run backup:authorize -- --profile production`. Plantillas, README, guía de instalación y operación actualizados. Se actualizó también la configuración local de demo, sin exponer secretos y conservando su conexión y carpeta local.

## Validación ejecutada

| Comprobación | Resultado |
| --- | --- |
| Pruebas unitarias del servidor | 245 aprobadas, sin fallos ni omisiones |
| Pruebas del cliente | 115 aprobadas, sin fallos ni omisiones |
| Despliegue y asistente | 21 aprobadas, sin fallos ni omisiones |
| Programación de copias | 3 aprobadas, sin fallos ni omisiones |
| Integración PostgreSQL de permisos y copias | 1 aprobada, sin omisión |
| Compilación servidor/cliente, generación Prisma y tipos de pruebas | Aprobadas |
| Sintaxis de los comandos y revisión del diff | Aprobadas |

Total: **385 pruebas aprobadas**. Las pruebas que utilizan sockets locales se ejecutaron con acceso a loopback; el entorno restringido bloqueaba esas conexiones con `EACCES`.

La integración real creó un clúster PostgreSQL temporal, en un puerto libre y directorio del proyecto. Aplicó migraciones y grants, comprobó controles de permisos, rollback de auditoría, exclusión de copias manuales/programadas y `pg_dump`/`pg_restore --list` reales con transporte Drive sustituido. El clúster se detuvo y su directorio se eliminó. No se modificaron las bases demo/producción existentes.

Las pruebas nuevas de transporte comprueban peticiones Drive, contenido y límites de bloques, renovación OAuth, rotación del refresh token, recuperación de rango, cuotas, 401/503, rechazo de destinos de subida ajenos a Google y ausencia de secretos en errores. El callback OAuth se ejercita realmente en loopback con intercambio de tokens sustituido. También se cubren checksum/tamaño/carpeta incorrectos, pérdida del bloqueo y cancelación por auditoría.

## Validación real posterior del perfil demo

El 27/10/2026 se configuró y autorizó una cuenta personal real de Google con un cliente de escritorio propio, audiencia externa en modo de prueba y alcance `drive.file`. Se habilitó Drive API y se guardaron el JSON, token e ID de carpeta únicamente en la configuración local privada de demo. Se corrigieron sus rutas de Windows y se retiró la solicitud de autorización inicial una vez completada.

La base demo aún no existía: se aplicaron sus migraciones/grants, se preparó la cuenta de lectura y se inicializaron los datos demo (3 usuarios, 62 registros de catálogos, 8 publicaciones y sus 8 PDF con análisis antivirus). Se ejecutó el comando real de copias del perfil demo: terminó **COMPLETO**, con archivo local y remoto confirmados y metadata/checksum verificados por el motor. La carpeta `fceadatasys-demo` y su archivo de respaldo también se comprobaron visualmente en Google Drive. El historial y la auditoría permanecen en la base demo.

Se agregó y ejecutó una regresión del asistente que comprueba que demo puede habilitar Drive con configuración separada, conserva su conexión de base y no exige correo institucional. Las 6 pruebas del archivo del asistente pasaron. No se modificó la configuración de producción ni se registraron tareas reales del sistema operativo.

## Pendiente operativo de producción

La cuenta institucional de producción todavía requiere su propio JSON y consentimiento, y una primera copia real en su servidor destino. La cuenta personal configurada corresponde únicamente a demo. Al usar audiencia externa en modo de prueba, el refresh token de Drive debe renovarse mediante autorización después de siete días.

El estado de publicación de Google es independiente del perfil local. Preparación de Google Cloud y credenciales, diferencia entre Testing y producción, renovación y resolución de errores: [GOOGLE-DRIVE.md](../operacion/GOOGLE-DRIVE.md).

Una sesión de subida interrumpida no se conserva entre procesos. Si falla la compensación por falta de conectividad, TIC debe revisar el ID remoto auditado. Los PDF de publicaciones requieren su propia copia; estos respaldos cubren PostgreSQL. Configuración, consentimiento de producción, equipos sin navegador y restauración: [BACKUPS.md](../operacion/BACKUPS.md).
