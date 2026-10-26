# Copias diarias y manuales

La aplicación incorpora **Administración → Copias de seguridad**. Requiere Administrador y `backups.manage`. **Crear copia ahora** responde HTTP 202 y permite seguir el resultado en el historial. La programación usa el Programador de tareas de Windows o el crontab de la cuenta en Linux; funciona sin la web/API iniciada, siempre que PostgreSQL esté disponible.

## Preparación del servidor

**Asistente integrado:** `npm run configure -- --profile production` pregunta los campos de esta guía, crea el archivo privado y ofrece aplicar la preparación. Si se habilita la función, crea/verifica la cuenta de lectura, comprueba herramientas y configuración Drive, ofrece abrir rclone para autorizar la cuenta, ejecutar una primera copia y crear/actualizar la tarea diaria. La autorización OAuth y, en Windows, la cuenta del Programador de tareas requieren intervención del encargado. La configuración manual siguiente sigue disponible.

1. Actualizar con el lanzador normal (compila, aplica las migraciones y los grants). Para instalación manual: compilar servidor/cliente, aplicar `prisma migrate deploy` con el propietario y `server/scripts/runtime-grants.sql` con `app_role`.
2. Instalar herramientas PostgreSQL compatibles con la versión del servidor: `pg_dump` y `pg_restore`. Instalar [rclone](https://rclone.org/install/).
3. Crear una carpeta privada para los archivos y un archivo de configuración privado. Copiar `deployment/.env.backup.example` a `.local/backups/production.env` o `.local/backups/demo.env` y completar las rutas y conexión. El lanzador resuelve ese archivo por perfil; para otra ruta, definir `BACKUP_CONFIG_FILE` en `.local/deploy/PERFIL.env`. El servidor arrancado directamente también acepta `BACKUP_CONFIG_FILE` en su entorno.
4. Autorizar una cuenta institucional de Google Drive con `rclone config --config RUTA_PRIVADA/rclone.conf`: crear un remoto `drive` de tipo **Google Drive**, completar OAuth en el navegador y, si corresponde, elegir una carpeta raíz. Configurar `RCLONE_REMOTE=drive:fceadatasys/production`. Las cuentas de servicio requieren una unidad compartida adecuada; para Drive personal usar OAuth. Seguir la [guía oficial de Drive](https://rclone.org/drive/).
5. Ejecutar una primera copia y comprobar el estado **COMPLETO** antes de registrar la tarea diaria.

La cuenta que ejecuta la API y la tarea necesita acceso al archivo privado, credenciales rclone, carpeta local y herramientas. rclone puede actualizar su token OAuth: su configuración debe permitir esa actualización. En Linux: directorios privados `0700` y archivos de secretos `0600`; en Windows: ACL que autorice solamente a las cuentas del servicio y administradores institucionales. Evitar carpetas compartidas o servidas por HTTP. No incluir configuración ni copias en Git.

Ejemplo de rutas Windows en el archivo privado (adaptar conexión y destino):

```dotenv
BACKUP_DATABASE_URL=postgresql://fcea_production_backup:CLAVE_PROPIA@127.0.0.1:5432/fceadatasys
BACKUP_DIRECTORY=C:/FCEA/private/backups
PG_DUMP_COMMAND=C:/Program Files/PostgreSQL/18/bin/pg_dump.exe
PG_RESTORE_COMMAND=C:/Program Files/PostgreSQL/18/bin/pg_restore.exe
RCLONE_COMMAND=C:/Tools/rclone/rclone.exe
RCLONE_CONFIG=C:/FCEA/private/rclone.conf
RCLONE_REMOTE=drive:fceadatasys/production
```

En Linux usar, por ejemplo, `/var/lib/fceadatasys/backups`, `/var/lib/fceadatasys/private/rclone.conf`, `/usr/bin/pg_dump`, `/usr/bin/pg_restore` y la ruta absoluta de rclone. Las rutas relativas del archivo de copias parten de su propia carpeta. La conexión de copias debe tener el mismo host, puerto y base que `DATABASE_URL`, con un usuario diferente si se desea. `sslmode` se conserva al ejecutar pg_dump; para certificados libpq adicionales configurar el entorno del servicio.

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

El nombre estable incluye perfil e identificador del directorio. Si la tarea existe se actualizan acción y horario; si falta se crea. Otras tareas y el otro perfil se conservan. Windows solicita las credenciales de la cuenta de ejecución al crear la tarea, permite ejecución sin sesión iniciada y recupera una ejecución perdida con `StartWhenAvailable`. Puede requerir una terminal con permisos administrativos. Al cambiar hora conserva la cuenta registrada. Linux requiere cron/crontab instalado y activo; modifica el crontab de la cuenta que ejecuta el script, sin exigir root. Cron no recupera ejecuciones perdidas durante un apagado. El log Linux queda en `.local/backups/PERFIL.log`; Windows informa el código de salida en el Programador de tareas.

La institución debe autorizar su cuenta y comprobar el primer respaldo completo. No se registra una tarea con credenciales de ejemplo.

## Resultados y recuperación

- **COMPLETO**: archivo custom de PostgreSQL (`.dump`), cabecera e índice comprobados; copia en Drive con tamaño y MD5 coincidentes. Se registra SHA-256 en auditoría. Ver [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).
- **PARCIAL**: archivo local verificado, subida/verificación de Drive fallida. Se conserva la copia local y se informa que debe corregirse la conexión y ejecutarse otra copia.
- **FALLIDO**: no se confirmó un archivo local o se interrumpió un proceso anterior. Los `.partial` del intento actual se eliminan. Tras un cierre abrupto pueden quedar parciales que TIC debe revisar.
- Una exclusión PostgreSQL impide solapar copias manuales y programadas. Si el proceso termina, PostgreSQL libera el bloqueo; el siguiente intento marca los registros interrumpidos como fallidos antes de continuar.
- Auditoría previa y final obligatoria. Si falla la auditoría inicial, no se ejecuta pg_dump. Si falla la confirmación final, se intenta retirar exclusivamente los archivos del intento, incluidos los remotos ya confirmados. Si el proveedor está inaccesible durante la compensación, TIC debe revisar el archivo remoto identificado en la auditoría inicial. No hay transacción distribuida entre PostgreSQL, disco y Drive.
- No hay borrado automático ni retención impuesta. Definir capacidad/retención institucional y revisar resultados. Las copias contienen datos sensibles: proteger disco y cuenta de Drive.

Restaurar primero en una base nueva y aislada con el propietario autorizado:

```sh
pg_restore --list /ruta/copia.dump
pg_restore --no-owner --no-acl --dbname=CONEXION_BASE_NUEVA /ruta/copia.dump
```

Aplicar los grants de runtime y verificar integridad/readiness. Nunca ensayar sobre producción. El respaldo solicitado cubre la base; los PDF están en `ATTACHMENT_DIRECTORY` y requieren su propia copia para una recuperación integral.

## Validación reproducible

`npm run test:backups`, `npm run test:unit --prefix server` y `server/test/permissions.integration.test.ts` comprueban horarios/idempotencia, permisos, auditoría, exclusión, pg_dump/pg_restore reales y fallos de nube con rclone sustituido. La integración exige la base desechable `fceadatasys_permissions_demo_test`, `PERMISSIONS_TEST_DATABASE_URL`, `PERMISSIONS_TEST_OWNER_URL`, `TEST_PG_DUMP` y `TEST_PG_RESTORE`. La variable de propietario solo debe apuntar al entorno de pruebas.
