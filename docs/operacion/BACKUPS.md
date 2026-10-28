# Copias diarias y manuales

La aplicación incorpora **Administración → Copias de seguridad**. Requiere Administrador y `backups.manage`. **Crear copia ahora** responde HTTP 202 y permite seguir el resultado en el historial. La programación usa el Programador de tareas de Windows o el crontab de la cuenta en Linux; funciona sin la web/API iniciada, siempre que PostgreSQL esté disponible.

Para preparar Google Cloud, descargar el JSON y obtener acceso, seguir la [guía de Google Drive](GOOGLE-DRIVE.md). Esta página describe la configuración del servidor, ejecución, programación y recuperación.

## Preparación del servidor

**Asistente integrado:** `npm run configure -- --profile production` pregunta los campos de esta guía, crea el archivo privado y ofrece aplicar la preparación. Si se habilita la función, crea/verifica la cuenta de lectura, comprueba herramientas y configuración Drive, ofrece autorizar la API de Google Drive en el navegador, ejecutar una primera copia y crear/actualizar la tarea diaria. La autorización OAuth y, en Windows, la cuenta del Programador de tareas requieren intervención del encargado. La configuración manual siguiente sigue disponible.

1. Actualizar con el lanzador normal (compila, aplica las migraciones y los grants). Para instalación manual: compilar servidor/cliente, aplicar `prisma migrate deploy` con el propietario y `server/scripts/runtime-grants.sql` con `app_role`.
2. Instalar herramientas PostgreSQL compatibles con la versión del servidor: `pg_dump` y `pg_restore`. La API de Drive se consume con Node.js, sin herramientas adicionales.
3. Crear una carpeta privada para los archivos y un archivo de configuración privado. Copiar `deployment/.env.backup.example` a `.local/backups/production.env` o `.local/backups/demo.env` y completar las rutas y conexión. El lanzador resuelve ese archivo por perfil; para otra ruta, definir `BACKUP_CONFIG_FILE` en `.local/deploy/PERFIL.env`. El servidor arrancado directamente también acepta `BACKUP_CONFIG_FILE` en su entorno.
4. Preparar el JSON OAuth de tipo **aplicación de escritorio**, indicar `DRIVE_CLIENT_FILE` y `DRIVE_TOKEN_FILE`, y autorizar con el asistente o `npm run backup:authorize -- --profile production`. La autorización crea la carpeta `DRIVE_FOLDER_NAME` y guarda su ID en `DRIVE_FOLDER_ID`. No se admiten claves de cuenta de servicio ni clientes web en este flujo.
5. Ejecutar una primera copia y comprobar el estado **COMPLETO** antes de registrar la tarea diaria.

La cuenta que ejecuta la API y la tarea necesita acceso al archivo privado, JSON OAuth, archivo de autorización, carpeta local y herramientas. El archivo de autorización debe permitir la actualización atómica del refresh token si Google lo renueva (escritura en su directorio). En Linux: directorios privados `0700` y archivos de secretos `0600`; en Windows: ACL que autorice solamente a las cuentas del servicio y administradores institucionales. Evitar carpetas compartidas o servidas por HTTP. No incluir configuración ni copias en Git.

Ejemplo de rutas Windows en el archivo privado (adaptar conexión y destino):

```dotenv
BACKUP_DATABASE_URL=postgresql://fcea_production_backup:CLAVE_PROPIA@127.0.0.1:5432/fceadatasys
BACKUP_DIRECTORY=C:/FCEA/private/backups
PG_DUMP_COMMAND=C:/Program Files/PostgreSQL/18/bin/pg_dump.exe
PG_RESTORE_COMMAND=C:/Program Files/PostgreSQL/18/bin/pg_restore.exe
DRIVE_CLIENT_FILE=C:/FCEA/private/drive-client.json
DRIVE_TOKEN_FILE=C:/FCEA/private/drive-token.json
DRIVE_FOLDER_NAME=fceadatasys-production
DRIVE_FOLDER_ID=
```

En Linux usar, por ejemplo, `/var/lib/fceadatasys/backups`, `/var/lib/fceadatasys/private/drive-client.json`, `/var/lib/fceadatasys/private/drive-token.json`, `/usr/bin/pg_dump` y `/usr/bin/pg_restore`. Las rutas relativas del archivo de copias parten de su propia carpeta. La conexión de copias debe tener el mismo host, puerto y base que `DATABASE_URL`, con un usuario diferente si se desea. `sslmode` se conserva al ejecutar pg_dump; para certificados libpq adicionales configurar el entorno del servicio.

## Autorización directa de Google Drive

La preparación de Google Cloud se realiza según [GOOGLE-DRIVE.md](GOOGLE-DRIVE.md): habilitar Drive API, configurar el consentimiento, crear el cliente de escritorio y guardar su JSON en `DRIVE_CLIENT_FILE`. El instalador no crea proyectos ni publica aplicaciones en Google. El archivo `DRIVE_TOKEN_FILE` es distinto del JSON descargado; se genera al autorizar la cuenta.

El flujo solicita únicamente `https://www.googleapis.com/auth/drive.file`: accede a archivos/carpetas creados o autorizados para esa aplicación. Un enlace o ID no concede acceso por sí solo. Dejar `DRIVE_FOLDER_ID` vacío crea una carpeta propia con `DRIVE_FOLDER_NAME`; el comando de autorización persiste su ID. Conservar el ID al reautorizar el mismo cliente y cuenta si la carpeta sigue accesible.

Después de compilar el servidor, ejecutar desde la raíz:

```sh
npm run backup:authorize -- --profile production
```

El navegador se abre automáticamente y el enlace también se muestra en la terminal. El callback escucha temporalmente **solo en 127.0.0.1**, en un puerto libre, valida `state` y usa PKCE; vence después de cinco minutos. Se guarda únicamente el refresh token vinculado al cliente, en `DRIVE_TOKEN_FILE`, con escritura atómica. Los access tokens se renuevan en memoria. Ningún token se devuelve por la API del sistema ni se escribe en auditoría o argumentos de procesos. Esperar que la terminal confirme la carpeta: recibir el callback todavía no confirma toda la preparación.

La autorización inicial necesita una terminal interactiva y no requiere conexión PostgreSQL. Para equipos sin navegador, usar el túnel o transferencia privada descritos en [GOOGLE-DRIVE.md](GOOGLE-DRIVE.md#9-servidor-sin-navegador). Las copias posteriores funcionan sin navegador mientras el token siga válido.

La caducidad depende de Google Cloud: **Usuarios externos + Prueba/Testing** emite tokens de Drive que vencen a los siete días. En **En producción**, no se aplica esa regla semanal; el acceso se renueva automáticamente mientras el refresh token siga válido. Elegir el perfil local `production` no cambia el estado de Google. Audiencia interna de Workspace, publicación y otras causas de revocación: [GOOGLE-DRIVE.md](GOOGLE-DRIVE.md#10-caducidad-y-uso-en-producción). El modo de despliegue `--non-interactive` requiere JSON, token e ID ya preparados.

Cuando se usa `backup:authorize` de forma independiente, revisar que `BACKUP_CONFIGURE_DRIVE` quede en `false` en el archivo de despliegue si ya no se necesita abrir la autorización durante la siguiente preparación. El asistente integrado actualiza esa bandera al completar su propia etapa.

La subida usa [sesiones reanudables de Drive v3](https://developers.google.com/workspace/drive/api/guides/manage-uploads), bloques de hasta 8 MiB, reintentos limitados ante cuotas/errores temporales y consulta del rango confirmado tras una interrupción. No carga el respaldo completo en memoria. Una sesión no se conserva entre ejecuciones: si el intento falla, queda **PARCIAL** y se debe ejecutar una nueva copia. Se consulta metadata por ID y se compara nombre, carpeta, tamaño y MD5 antes de confirmar **COMPLETO**.

Al actualizar una instalación existente, ejecutar otra vez el asistente para generar el nuevo archivo privado e importar/autorizar el JSON OAuth. Los respaldos y el historial existentes se conservan. Comprobar una primera copia completa antes de dejar activa la programación.

## Demo con una cuenta personal de Google

El perfil `demo` admite cuentas personales y cuentas de Workspace con el mismo flujo OAuth. No exige correo institucional. La [guía de Google Drive](GOOGLE-DRIVE.md) incluye los pasos de Google, rutas de demo, usuarios de prueba, comandos y comprobación final. Sus archivos, tokens, proyecto de Google y carpeta deben estar separados de los de producción.

La base habitual de demo es `127.0.0.1:55440/fceadatasys_demo`. El lanzador debe preparar su cuenta de lectura antes de respaldar. Para una presentación se puede usar la copia manual con demo iniciado. Al cerrar el lanzador se detiene el clúster que ese proceso haya iniciado; una tarea programada necesita PostgreSQL disponible a su hora. Los siete días corresponden al estado OAuth externo de prueba, también si se utilizara desde otro perfil local.

## Cuenta de lectura para PostgreSQL

El asistente crea la cuenta dedicada de lectura (por defecto `fcea_production_backup`). Si se prepara manualmente, crear una cuenta como en el ejemplo y asignar su contraseña con `\password fcea_backup`. Adaptar nombres y base:

```sql
CREATE ROLE fcea_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE fceadatasys TO fcea_backup;
GRANT USAGE ON SCHEMA public TO fcea_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fcea_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO fcea_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE fcea_production_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO fcea_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE fcea_production_owner IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO fcea_backup;
```

Se requiere lectura de todas las tablas, incluida `_prisma_migrations` y auditoría. El rol runtime conserva permisos restringidos y registra los eventos. Las credenciales de lectura viajan a pg_dump por su entorno, sin contraseña en argumentos ni logs.

## Ejecución y horario

Desde la raíz, después de preparar el archivo privado:

```powershell
npm run backup -- --profile production
npm run backup:schedule -- --profile production --time 02:00 --dry-run
npm run backup:schedule -- --profile production --time 02:00
# Deshabilitar la tarea de este perfil si existe
npm run backup:schedule -- --profile production --disable
```

Para cambiar el horario, ejecutar `npm run backup:schedule -- --profile production --time 23:30`. Formato `HH:MM`, **hora local del servidor**. `--config RUTA` selecciona un archivo de despliegue alternativo; la ruta del archivo de copias se establece con `BACKUP_CONFIG_FILE`.

El nombre estable incluye perfil e identificador del directorio. Si la tarea existe se actualizan acción y horario; si falta se crea. Otras tareas y el otro perfil se conservan. Windows solicita las credenciales de la cuenta de ejecución al crear la tarea, permite ejecución sin sesión iniciada y recupera una ejecución perdida con `StartWhenAvailable`. Puede requerir una terminal con permisos administrativos. Al cambiar hora conserva la cuenta registrada; si Windows devuelve `0x8007052e` al actualizar una tarea con inicio por contraseña, el instalador solicita nuevamente las credenciales de esa cuenta y reintenta una sola vez. La contraseña se entrega al Programador de tareas, sin guardarla en archivos del proyecto. Otros errores se propagan sin pedir credenciales. Con `--non-interactive`, si se requieren credenciales se informa que debe repetirse la programación desde una terminal interactiva.

El lanzador utiliza los módulos nativos de Windows PowerShell 5.1 para registrar la tarea, incluso cuando npm se ejecuta desde PowerShell 7. Esto evita que `Get-Credential` falle por mezclar módulos de ambas versiones; no modifica el entorno de la terminal del instalador.

El arranque normal vuelve a ejecutar la programación cuando `BACKUP_INSTALL_SCHEDULE=true`. Para iniciar una instalación ya preparada sin repetir compilación, migraciones, carga de ejemplos ni preparación de copias, usar `npm run start:demo -- --start-only` o `npm run start:production -- --start-only`. Ese modo conserva la tarea diaria existente.

Linux requiere cron/crontab instalado y activo; modifica el crontab de la cuenta que ejecuta el script, sin exigir root. Cron no recupera ejecuciones perdidas durante un apagado. El log Linux queda en `.local/backups/PERFIL.log`; Windows informa el código de salida en el Programador de tareas.

La institución debe autorizar su cuenta y comprobar el primer respaldo completo. No se registra una tarea con credenciales de ejemplo.

## Resultados y recuperación

- **COMPLETO**: archivo custom de PostgreSQL (`.dump`), cabecera e índice comprobados; copia en Drive con tamaño y MD5 coincidentes. Se registra SHA-256 en auditoría. Ver [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).
- **PARCIAL**: archivo local verificado, subida/verificación de Drive fallida. Se conserva la copia local y se informa que debe corregirse la conexión y ejecutarse otra copia.
- **FALLIDO**: no se confirmó un archivo local o se interrumpió un proceso anterior. Los `.partial` del intento actual se eliminan. Tras un cierre abrupto pueden quedar parciales que TIC debe revisar.
- Una exclusión PostgreSQL impide solapar copias manuales y programadas. Si el proceso termina, PostgreSQL libera el bloqueo; el siguiente intento marca los registros interrumpidos como fallidos antes de continuar.
- Auditoría previa y final obligatoria. Si falla la auditoría inicial, no se ejecuta pg_dump. Si falla la confirmación final, se intenta retirar exclusivamente los archivos del intento, incluido el archivo remoto del intento aunque su subida no se haya confirmado. El ID de Drive se genera antes de subir y se registra en `RESPALDO_NUBE_AUTORIZADO`; la compensación usa exclusivamente ese ID. Si el proveedor está inaccesible durante la compensación, TIC debe revisar el archivo remoto identificado en la auditoría inicial. No hay transacción distribuida entre PostgreSQL, disco y Drive.
- No hay borrado automático ni retención impuesta. Definir capacidad/retención institucional y revisar resultados. Las copias contienen datos sensibles: proteger disco y cuenta de Drive.

## Restauración de una copia

El `.dump` permite reconstruir la estructura y los datos al momento de la copia. No incluye cambios posteriores ni permite elegir un instante intermedio entre respaldos.

### Restauración rápida de una instalación existente

Desde una terminal en la raíz del proyecto:

```powershell
npm run stop:production
# Esperar a que la terminal del lanzador confirme el cierre.
npm run restore -- --profile production
npm run start:production
```

Para demo, reemplazar `production` por `demo`. El asistente muestra las copias locales, de más reciente a más antigua, y permite elegir por número. Para una copia descargada de Google Drive o ubicada en otra carpeta:

```powershell
npm run restore -- --profile production --file "C:/FCEA/copias/copia.dump"
```

`--list` solo muestra las copias disponibles y no modifica PostgreSQL. `--config RUTA` permite usar un archivo de despliegue alternativo. `npm run restore -- --help` muestra las opciones. La restauración requiere una terminal interactiva y escribir `RESTAURAR nombre_de_la_base` después de revisar archivo, destino y hash; no admite omitir esa confirmación.

El procedimiento:

1. Reserva el bloqueo del lanzador para impedir un arranque concurrente. Rechaza la operación si el sistema sigue iniciado o la base tiene conexiones activas; no fuerza desconexiones. El clúster demo se inicia y se cierra automáticamente cuando corresponde. Los servicios PostgreSQL de producción se conservan en ejecución.
2. Prepara una copia privada del archivo de entrada y comprueba cabecera, índice y SHA-256. Obtiene el hash original de la auditoría del respaldo; si el archivo fue renombrado o ese evento ya no existe, exige `--sha256 HASH_ORIGINAL`. No usar como referencia un hash calculado únicamente a partir de un archivo de procedencia desconocida.
3. Restaura en una **base nueva** con `pg_restore --single-transaction`, usando al propietario de migraciones. Compara las migraciones y sus checksums con la versión instalada; no migra automáticamente respaldos de otras versiones. Verifica que exista un Administrador activo con `permissions.manage` y comprueba el contenido de los adjuntos marcados `CLEAN` contra su hash. Si faltan documentos, recuperar primero la carpeta de adjuntos compatible con el respaldo.
4. Restablece los grants del runtime y del lector de copias, y prueba ambas conexiones. Revoca las sesiones y tokens refresh recuperados, retira los enlaces de recuperación de contraseña anteriores y marca como fallidas las copias que figuran en curso dentro del respaldo.
5. Registra la validación y activa la base mediante dos renombrados en una misma transacción. La base recuperada toma el nombre configurado; **no hay que cambiar URLs, credenciales ni la tarea diaria**. La base anterior queda completa con el sufijo `_previous_IDENTIFICADOR`, incluida su auditoría posterior al respaldo, y con nuevas conexiones deshabilitadas. Si la activación falla, se revierten ambos renombrados.

El operador necesita acceso autorizado a la configuración privada del servidor, herramientas PostgreSQL y una cuenta técnica con permisos para crear bases y renombrar las del propietario. En producción, si `PG_ADMIN_URL` no está configurado, el asistente solicita usuario y contraseña PostgreSQL, con contraseña oculta; se utilizan en memoria y no se guardan. El acceso del propietario/runtime/lector existente no se modifica. Es un procedimiento de mantenimiento local de TIC; no añade permisos ni endpoints HTTP a la aplicación.

Se insertan eventos `RESTAURACION_INICIADA`, `RESTAURACION_VALIDADA` y, ante un rechazo o fallo después de consultar la auditoría de origen, `RESTAURACION_FALLIDA`; los registros identifican la cuenta del sistema operativo, sin simular un usuario o una sesión web. Las validaciones locales anteriores a la conexión quedan en el registro de mantenimiento. No se modifican ni eliminan logs. Si falla la auditoría obligatoria, no se activa la recuperación. El registro local está en `.local/backups/restores/PERFIL/ID/events.jsonl`; incluye los nombres de las bases y el hash, sin contraseñas. Una recuperación fallida puede conservar su base temporal `_restore_IDENTIFICADOR` y `input.dump` para revisión por TIC; no hay eliminación automática de bases. Tras el éxito se retira únicamente esa copia temporal del archivo de entrada; el respaldo seleccionado se conserva.

Para volver a la base anterior, detener nuevamente la aplicación y conectar un administrador a `postgres`. A partir de los nombres exactos indicados por el asistente, ejecutar los siguientes pasos en **una misma transacción**, sin conexiones activas: deshabilitar conexiones a la base actual, renombrarla a un nombre libre, renombrar la base `_previous_...` a su nombre original y habilitar conexiones a esa base. Conservar también la base que se retira y comprobar los adjuntos antes de reiniciar. No borrar ninguna de las dos bases como parte de la recuperación.

Esta vía exige que la base actual y sus roles sigan accesibles. Para pérdida total de la base, otro servidor o una versión diferente de la aplicación, utilizar el procedimiento administrado siguiente.

### Recuperación administrada en una base vacía

1. Antes de sustituir una instalación activa, entrar en mantenimiento y conservar una copia del estado actual, incluida su auditoría. Mantener un registro del procedimiento.
2. Descargar el respaldo elegido desde Drive o usar su copia local. Si se descargó, comprobar su SHA-256 contra el registrado en la auditoría del respaldo.
3. Crear una **base nueva y vacía**, por ejemplo `fceadatasys_recuperada`, con un propietario autorizado. En un servidor nuevo, preparar también los roles técnicos: el respaldo de una sola base no crea los roles globales PostgreSQL.
4. Restaurar con ese propietario, comprobar los datos y aplicar los grants del runtime. La cuenta de lectura de copias no es la cuenta de restauración.
5. Verificar usuarios, permisos, catálogos y publicaciones, usar una versión compatible de la aplicación y recuperar los adjuntos correspondientes. Cambiar el destino de la aplicación solo cuando se haya validado la recuperación.

Ejemplo, desde la raíz y con herramientas en PATH; adaptar host, puerto, roles, nombre de base y ruta:

```sh
pg_restore --list "/ruta/copia.dump"
pg_restore --host=127.0.0.1 --port=5432 --username=fcea_production_owner --dbname=fceadatasys_recuperada --no-owner --no-acl --single-transaction "/ruta/copia.dump"
psql --host=127.0.0.1 --port=5432 --username=fcea_production_owner --dbname=fceadatasys_recuperada -v app_role=fcea_production_app -f server/scripts/runtime-grants.sql
```

`--single-transaction` confirma toda la restauración o revierte sus efectos si falla. Las credenciales se proporcionan mediante los mecanismos seguros de PostgreSQL, sin escribir contraseñas en comandos. Ver [pg_restore de PostgreSQL 18](https://www.postgresql.org/docs/18/app-pgrestore.html). Validar readiness/integridad y preparar de nuevo el acceso del lector de copias cuando corresponda.

Si la instalación pasa a usar la base recuperada, actualizar de forma coherente `DATABASE_URL`, `MIGRATION_DATABASE_URL` y `BACKUP_DATABASE_URL`, conservando el usuario técnico correspondiente en cada una. Sus tres conexiones deben apuntar a la misma base del perfil. La base anterior se conserva durante la comprobación.

El respaldo actual cubre PostgreSQL. Los PDF están en `ATTACHMENT_DIRECTORY` y necesitan una copia compatible con ese estado; el JSON OAuth, token, archivos privados y roles PostgreSQL también se conservan por separado. El estado **COMPLETO** verifica archivo local y remoto, cabecera e índice; no sustituye un ensayo de restauración integral.

## Validación reproducible

`npm run test:backups`, `npm run test:unit --prefix server` y `server/test/permissions.integration.test.ts` comprueban horarios/idempotencia, permisos, auditoría, exclusión, pg_dump/pg_restore reales y fallos de nube con la API de Drive sustituida. La integración de permisos exige la base desechable `fceadatasys_permissions_demo_test`, `PERMISSIONS_TEST_DATABASE_URL`, `PERMISSIONS_TEST_OWNER_URL`, `TEST_PG_DUMP` y `TEST_PG_RESTORE`. La variable de propietario solo debe apuntar al entorno de pruebas.

`npm run test:restore:integration` ensaya el asistente contra un clúster PostgreSQL temporal con puerto libre, base exclusiva y datos desechables. Definir `DEPLOYMENT_PG_BIN_DIRECTORY` con la carpeta de binarios PostgreSQL 18; sin esa variable se omite. Comprueba hash, cancelación, fallo del motor, documentos faltantes, rollback real del cambio de nombres, auditoría, sesiones, grants del runtime/lector y conservación de los datos anteriores.
