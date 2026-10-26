# Instalación de producción con el asistente

La base predeterminada es **`fceadatasys`**, en el servicio PostgreSQL que indique el encargado. El valor inicial es `127.0.0.1:5432`. Producción no crea ni inicia un clúster dentro del proyecto; demo conserva su instancia aislada.

## Preparar el equipo

Antes de iniciar, el encargado debe disponer de Node.js 24.11+ de la rama 24, npm, PostgreSQL 18 funcionando, sus herramientas (`psql`, `pg_dump`, `pg_restore`), ClamAV con firmas vigentes y rclone si se usarán copias en Drive. En Linux, cron/crontab debe estar instalado y activo para programarlas. También debe preparar dominio/DNS, acceso de red, certificado y clave TLS PEM válidos y carpetas privadas accesibles por las cuentas de ejecución.

No se debe registrar como conexión permanente de la aplicación la cuenta administrativa `postgres`. El asistente la utiliza para crear o comprobar las cuentas técnicas y después retira esa conexión del archivo de despliegue.

## Ejecutar y responder el cuestionario

Desde la raíz:

```powershell
npm run configure -- --profile production
```

El cuestionario pide:

| Grupo | Opciones |
| --- | --- |
| Web | Dirección pública HTTPS, dirección de escucha y puerto privado de API. |
| PostgreSQL principal | Carpeta de herramientas (o PATH), host, puerto, usuario administrador, contraseña y base de mantenimiento. |
| Base y cuentas técnicas | Nombre de base (`fceadatasys`), cuenta propietaria de migraciones, cuenta limitada de aplicación y sus contraseñas. Enter conserva las generadas o guardadas. |
| Seguridad y archivos | Certificado, clave TLS, secreto JWT, carpeta de adjuntos, ejecutable y firmas ClamAV, timeout, antigüedad de firmas y concurrencia. |
| Administrador inicial | Nombre, CI, usuario, correo y contraseña. Solo se aplica al inicializar una base nueva. |
| Correo | Habilitar SMTP, servidor, puerto, TLS implícito/STARTTLS, remitente y autenticación opcional. |
| Copias | Habilitar/deshabilitar, archivo privado, carpeta local, usuario PostgreSQL de lectura y contraseña, pg_dump, pg_restore, rclone, archivo de credenciales, remoto/carpeta Drive y timeout. |
| Activación de copias | Abrir rclone para autorizar/configurar Drive, probar una primera copia, crear/actualizar la tarea diaria, hora local `HH:MM` o deshabilitar una tarea previa. |
| Reinstalación | Carpeta privada donde guardar la copia obligatoria antes de recrear una base. |

Las contraseñas no se muestran en pantalla. El asistente construye las URLs y guarda `.local/deploy/production.env` y, cuando se habilitan copias, el archivo elegido (predeterminado `.local/backups/production.env`). Los archivos están ignorados por Git. En Linux se escriben con modo 0600; Windows requiere comprobar las ACL para las cuentas institucionales que los utilizarán.

Al terminar las preguntas se puede **guardar solamente** o **aplicar la preparación**. Guardar no inspecciona ni crea la base. Aplicar instala dependencias npm si faltan, compila, valida configuración/TLS/ClamAV y herramientas de copias, conecta al PostgreSQL principal y prepara los componentes elegidos. `--configure --setup-only` aplica después de recopilar las respuestas sin preguntar ese último paso.

También se puede ejecutar `npm run start:production`: una instalación nueva abre el asistente y, después de preparar, inicia la aplicación. Las instalaciones ya configuradas reutilizan el archivo.

## Si ya existe una base

Antes de una posible recreación se comprueba que las credenciales técnicas existentes funcionen. El script muestra base, servidor/puerto, propietario y cantidad de conexiones y ofrece:

- **Conservar**, predeterminado: conserva datos, auditoría, cuentas y contraseñas; aplica migraciones y grants pendientes. El propietario debe coincidir con la configuración. Si no coincide, se detiene para que el encargado revise el destino; no se apropia de una base ajena.
- **Eliminar y recrear**: comprueba las credenciales de la cuenta inicial, genera una copia local custom con pg_dump y verifica su índice con pg_restore. Muestra su ruta y exige escribir exactamente `ELIMINAR fceadatasys` (o el nombre explícitamente elegido). Solo entonces recrea esa base. Si falla la copia, la confirmación, la identidad de la base o existen conexiones activas, no elimina la base. No fuerza desconexiones. La copia conserva la auditoría anterior y el procedimiento se registra en `.local/deploy/production/installation-events.jsonl`.
- **Cancelar**: detiene la preparación conservando la base.

La recreación elimina todo el contenido de esa base, incluida auditoría e identidades de usuarios, y crea nuevamente el Administrador inicial. Las cuentas técnicas PostgreSQL existentes conservan sus contraseñas; los archivos adjuntos, otras bases y el servicio principal no se eliminan. La copia previa de reinstalación es local y adicional a las copias ordinarias locales/Drive. Debe conservarse hasta comprobar la instalación y la recuperación de cualquier dato necesario.

No existe una opción de borrado sin interacción: `--non-interactive` siempre conserva. Las contraseñas de roles existentes se deben proporcionar correctamente; no se renuevan silenciosamente usando la cuenta administrativa. Cambiar el nombre sugerido de `fceadatasys_production` a `fceadatasys` no renombra, copia ni elimina automáticamente una instalación anterior. La migración de datos entre nombres debe planificarse mediante respaldo y restauración.

## Copias integradas

Si se habilitan, el asistente crea o verifica un usuario dedicado de lectura (predeterminado `fcea_production_backup`), otorga lectura de tablas y secuencias actuales y futuras del propietario y comprueba su acceso. No utiliza para los respaldos las credenciales administrativas permanentes.

La opción de abrir rclone inicia su asistente oficial. El encargado debe seleccionar/crear el remoto indicado, iniciar sesión en Google y autorizar la cuenta. El remoto debe ser de tipo Google Drive y coincidir con el nombre elegido. Si ya existe una configuración autorizada, puede omitir esta apertura e indicar su archivo. La configuración se valida antes de modificar la base.

La primera copia, si se solicita, debe completar disco y Drive para que esa etapa se apruebe. Si se omite, el instalador informa que la comprobación real de nube está pendiente. La tarea diaria se crea o actualiza si se eligió; no duplica la del mismo perfil/directorio. Windows puede solicitar las credenciales de la cuenta del sistema operativo que ejecutará las copias sin sesión iniciada. Esa cuenta es independiente de `postgres` y debe tener permisos sobre archivos privados y herramientas. En modo sin interacción, esa autorización inicial debe estar resuelta antes.

Las copias cubren la base de datos. La carpeta de PDF/adjuntos requiere su propio respaldo para recuperación integral. Retención y revisión de resultados siguen a cargo de la institución. Más detalles: [BACKUPS.md](BACKUPS.md).

## Arranque y mantenimiento

Tras una preparación sin iniciar la web:

```powershell
npm run start:production -- --start-only --non-interactive
```

Para configurar inicio automático del servicio de la aplicación, el encargado debe registrar `node scripts/run.mjs --profile production --start-only --non-interactive` con el gestor de servicios de Windows/Linux, usando el directorio del proyecto y una cuenta autorizada. El asistente configura la tarea de copias, pero no registra ese servicio de la web/API.

| Se automatiza al aplicar | Sigue a cargo del encargado |
| --- | --- |
| Archivos privados, generación de secretos y URLs. | Datos reales de instalación, contraseñas administrativas y permisos/ACL del sistema operativo. |
| Dependencias npm y compilación de cliente/API. | Instalar Node, PostgreSQL, ClamAV, rclone y cron; mantener sus actualizaciones. |
| Base, roles técnicos, migraciones, grants y primer Administrador. | Proporcionar acceso administrativo válido; decidir conservar/recrear y revisar el destino. |
| Configuración de origen web, API privada, cookies y uso de TLS. | Dominio/DNS, firewall, acceso al puerto web, obtención y renovación del certificado. |
| Configuración SMTP y comprobación del transporte al iniciar la API. | Proporcionar cuenta/remitente SMTP y comprobar entrega real a los destinatarios. |
| Lector de copias, prueba inicial y programación diaria si se eligen. | Autorizar Google Drive, proporcionar cuenta de ejecución Windows, escoger rutas/horario, capacidad y retención. |
| Arranque manual y cierre ordenado de web/API. | Instalar el servicio de aplicación con inicio automático y supervisión. |
| Registro de resultados de copias y rechazo de fallos de seguridad. | Revisar fallos, mantener firmas ClamAV, respaldar adjuntos y ensayar restauraciones. |

## Validación

Las pruebas de `scripts/deployment/*.test.mjs` ejercitan el cuestionario, secretos, URLs, opciones de copias y recreación protegida. `scripts/deployment/production.integration.mjs` utiliza exclusivamente un clúster temporal y otro puerto para comprobar instalación completa, creación de `fceadatasys`, roles limitados, lector de copias, conservación, rechazos, recreación y restauración real. No utiliza el servicio principal ni una cuenta real de Drive.
