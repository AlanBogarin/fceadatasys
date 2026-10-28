# Guía para configurar y autorizar Google Drive

Revisada el **28/10/2026**. Dirigida al encargado de instalación o a TIC. Los nombres de las pantallas pueden variar según el idioma de Google Cloud.

Esta guía conecta las copias de PostgreSQL de fceadatasys con una cuenta de Drive mediante su API. Al terminar, el perfil elegido tendrá una carpeta propia en Drive y una primera copia **COMPLETO**. El sistema conserva además el archivo local. La operación diaria, programación y restauración están en [BACKUPS.md](BACKUPS.md).

Accesos rápidos: [descargar el JSON](#5-crear-el-cliente-de-escritorio-y-descargar-su-json), [autorizar la cuenta](#7-autorizar-la-cuenta-de-drive), [caducidad y producción](#10-caducidad-y-uso-en-producción) y [resolver problemas](#11-problemas-frecuentes).

## 1. Elegir el entorno y la cuenta

Hay dos configuraciones independientes:

| Configuración                | Dónde se elige                                | Qué determina                                                                    |
| ---------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| Perfil `demo` o `production` | Comandos y archivos locales del proyecto      | Base de datos, rutas, credenciales y programación utilizadas.                    |
| Audiencia y estado OAuth     | Google Cloud → Google Auth Platform → Público | Cuentas que pueden autorizar la aplicación y condiciones de caducidad de Google. |

**Elegir `--profile production` no publica la aplicación en Google ni elimina por sí solo la caducidad de siete días.**

Demo puede utilizar una cuenta personal. Para la entrega institucional, definir una cuenta bajo responsabilidad de la institución y mantener separados los proyectos de Google, clientes OAuth, tokens y carpetas de demo y producción. Google establece la separación de proyectos de pruebas y producción en sus [requisitos de preparación para producción](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance#use-separate-projects-for-testing-and-production).

La cuenta administradora del proyecto de Google Cloud y la que conservará las copias en Drive pueden ser distintas: la segunda es la que se debe seleccionar al autorizar. En modo de prueba debe estar agregada a los usuarios de prueba. El usuario Administrador de fceadatasys es una identidad separada.

## 2. Reunir lo necesario

- Cuenta de Google con Drive habilitado y espacio para conservar respaldos.
- Acceso para administrar el proyecto correspondiente en [Google Cloud Console](https://console.cloud.google.com/).
- Proyecto fceadatasys instalado, Node.js de la versión requerida y herramientas PostgreSQL `pg_dump` y `pg_restore` compatibles con el servidor.
- Terminal interactiva y navegador. Para un servidor sin navegador, consultar el apartado 9.
- Carpetas privadas accesibles por la cuenta del servicio y la cuenta que ejecutará las copias.

La implementación admite **cliente OAuth de aplicación de escritorio**. Una clave de API, un cliente web o un JSON de cuenta de servicio no reemplazan ese archivo en el flujo actual.

## 3. Crear o seleccionar el proyecto y habilitar Drive API

1. Entrar en Google Cloud con la cuenta que administrará la integración.
2. Abrir el selector de proyectos y crear o seleccionar el proyecto del entorno elegido. Por ejemplo, `fceadatasys-demo` o `fceadatasys-produccion`.
3. En **APIs y servicios → Biblioteca**, buscar **Google Drive API** y habilitarla.
4. Comprobar que el servicio quedó habilitado en el proyecto correcto.

Este paso habilita el servicio; la autorización de la cuenta de Drive se realiza más adelante. Referencia: [habilitación de las APIs de Google Workspace](https://developers.google.com/workspace/guides/enable-apis).

## 4. Configurar la identidad y el consentimiento

En **Google Auth Platform → Información de la marca**, usar **Comenzar** si falta la configuración. Definir nombre, correo de asistencia y contacto; revisar la política de datos que presenta Google antes de aceptar y guardar.

En **Público / Audience**, elegir según el caso:

| Uso                                                   | Audiencia y estado                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo con cuenta personal                              | **Usuarios externos**, estado **Prueba / Testing**. Agregar la cuenta que guardará las copias en **Usuarios de prueba → Agregar usuarios → Guardar**. |
| Producción con cuentas externas, incluidas personales | **Usuarios externos**, completar los requisitos de Google y pasar a **En producción / In production**.                                                |
| Uso exclusivo dentro de una organización Workspace    | **Interno**, cuando esté disponible y las cuentas autorizadas pertenezcan a esa organización.                                                         |

Si Google solicita página de inicio, política de privacidad, dominio u otra comprobación para publicar, completar datos reales del responsable del sistema. Publicar y verificar la aplicación son trámites diferentes; cumplir las revisiones que Google indique para esa configuración.

La disponibilidad de cuentas y los estados de publicación se explican en [Administrar el público de la aplicación](https://support.google.com/cloud/answer/15549945?hl=es).

En **Acceso a los datos → Agregar o quitar permisos**, declarar únicamente:

```text
https://www.googleapis.com/auth/drive.file
```

Ese alcance permite trabajar con archivos utilizados con la aplicación. Google lo clasifica como no sensible. fceadatasys lo solicita también durante la autorización y crea su carpeta propia; indicar el ID de cualquier carpeta existente no le concede acceso automáticamente. Referencias: [configuración del consentimiento](https://developers.google.com/workspace/guides/configure-oauth-consent) y [alcances de Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## 5. Crear el cliente de escritorio y descargar su JSON

1. Abrir **Google Auth Platform → Clientes → Crear cliente**.
2. Seleccionar **App de escritorio / Desktop app**.
3. Asignar un nombre identificable, por ejemplo `FCEA Datasys Demo - Copias` o `FCEA Datasys Producción - Copias`.
4. Crear el cliente y usar **Descargar JSON**. Esta integración es una tarea de respaldo convencional; no necesita la opción de cliente para agentes de IA.
5. Localizar el archivo descargado. El asistente de instalación pedirá su ruta y lo copiará al destino privado del entorno si falta; también se puede trasladar previamente a ese destino. Cambiar su nombre es válido; conservar su contenido original.

El archivo suele llamarse `client_secret_…apps.googleusercontent.com.json`. Su configuración debe contener el objeto `installed`, con el identificador y secreto del cliente. fceadatasys lo valida durante el cuestionario y antes de preparar la instalación. Este archivo requiere crear el cliente en Google Cloud: el sistema no lo genera ni lo recupera automáticamente al borrar `.local/`. No transcribir credenciales a mano ni pegar el contenido en chats o documentación. Referencia: [creación de credenciales de escritorio](https://developers.google.com/workspace/guides/create-credentials#desktop-app).

Ejemplos de ubicación, que se deben adaptar al equipo:

| Archivo                              | Demo                                    | Producción                                                                                                   |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Configuración del despliegue         | `.local/deploy/demo.env`                | `.local/deploy/production.env`                                                                               |
| Configuración de las copias          | `.local/backups/demo.env`               | `.local/backups/production.env`                                                                              |
| JSON descargado                      | `.local/backups/demo-drive-client.json` | `C:/FCEA/private/production-drive-client.json` o `/var/lib/fceadatasys/private/production-drive-client.json` |
| Autorización generada por el sistema | `.local/backups/demo-drive-token.json`  | `C:/FCEA/private/production-drive-token.json` o `/var/lib/fceadatasys/private/production-drive-token.json`   |

El JSON del cliente identifica la aplicación. El archivo de autorización contiene el refresh token de la cuenta que acepta el permiso. **Son archivos distintos**: el sistema genera el segundo al completar el consentimiento. No usar para ellos la misma ruta ni la del archivo `.env`.

En Linux, usar directorios privados `0700` y archivos `0600`. En Windows, revisar las ACL para limitar el acceso a las cuentas del servicio y administradores autorizados. La carpeta del token necesita escritura para sustituirlo de forma atómica si Google lo renueva. Conservar estos archivos fuera del cliente web y de Git; eliminar copias temporales del JSON cuando ya no sean necesarias.

## 6. Configurar el perfil en fceadatasys

Todos los comandos siguientes se ejecutan **desde la raíz del repositorio**.

### Opción recomendada: asistente integrado

Elegir un único perfil:

```sh
# Demostración
npm run configure -- --profile demo

# Instalación definitiva
npm run configure -- --profile production
```

En el cuestionario:

1. Habilitar las copias locales y en Google Drive.
2. Confirmar el archivo privado de copias y la carpeta local.
3. Indicar las herramientas PostgreSQL y una cuenta dedicada de lectura para la base de ese perfil.
4. En `DRIVE_CLIENT_FILE`, elegir el destino privado del JSON. Si allí falta el archivo, el asistente pide `DRIVE_CLIENT_SOURCE`: la ruta del JSON de escritorio ya descargado de Google Cloud, por ejemplo en Escritorio o Descargas. Admite comillas alrededor de la ruta, valida su contenido y copia los bytes al destino privado conservando el original. Un archivo existente se valida y se conserva; si es inválido, se pide otro destino o la ruta de un JSON válido. No hace falta copiarlo mediante otro comando.
5. En `DRIVE_TOKEN_FILE`, elegir una ruta privada para la autorización que se generará.
6. Usar un nombre de carpeta, por ejemplo `fceadatasys-demo` o `fceadatasys-production`. Dejar `DRIVE_FOLDER_ID` vacío en la primera conexión.
7. Elegir autorizar Drive durante la preparación y realizar una primera copia. La programación diaria se decide aparte; para una demostración puede bastar la ejecución manual.
8. Aplicar la preparación. Guardar solamente no crea la base, la cuenta de lectura ni la autorización.

El asistente compila y comprueba las herramientas, solicita el consentimiento, prepara la base y el lector cuando corresponde y ejecuta la primera copia si se eligió. Los pasos de Google Cloud deben estar listos antes de llegar a la autorización, cuyo plazo es de cinco minutos. Producción requiere además los datos de instalación de [INSTALLATION-PRODUCTION.md](INSTALLATION-PRODUCTION.md).

### Opción manual: instalación ya preparada

En el archivo de despliegue del perfil deben estar habilitadas las copias y seleccionado su archivo privado. Ejemplo para demo:

```dotenv
BACKUP_ENABLED=true
BACKUP_CONFIG_FILE=.local/backups/demo.env
```

El archivo de copias debe contener la conexión de lectura, carpeta local, herramientas y configuración de Drive. Usar [la plantilla](../../deployment/.env.backup.example); no reemplazar un archivo existente con credenciales de ejemplo.

Ejemplo de la parte de Drive en `.local/backups/demo.env`:

```dotenv
DRIVE_CLIENT_FILE=demo-drive-client.json
DRIVE_TOKEN_FILE=demo-drive-token.json
DRIVE_FOLDER_NAME=fceadatasys-demo
DRIVE_FOLDER_ID=
```

Las rutas relativas de ese archivo parten de **su propia carpeta**: `demo-drive-client.json` se resuelve como `.local/backups/demo-drive-client.json`. Las rutas `BACKUP_CONFIG_FILE` relativas del despliegue parten de la raíz del proyecto. En Windows se pueden usar `/`, también con espacios, sin duplicar barras.

La conexión `BACKUP_DATABASE_URL` debe tener el mismo servidor, puerto y base que la conexión de la aplicación. El comando de autorización no crea la base ni el lector: si faltan, completar la preparación con el asistente. Para una instalación manual, seguir la cuenta de lectura de [BACKUPS.md](BACKUPS.md#cuenta-de-lectura-para-postgresql).

## 7. Autorizar la cuenta de Drive

Si se eligió autorizar durante la preparación, completar ese flujo; no hace falta ejecutar otro en paralelo. Para una instalación ya configurada, compilar el servidor si aún falta su salida y ejecutar el comando del perfil elegido:

```sh
npm run build --prefix server

# Elegir uno
npm run backup:authorize -- --profile demo
npm run backup:authorize -- --profile production
```

El servidor debe tener sus dependencias instaladas antes de compilar. `--config RUTA` permite seleccionar otro **archivo de despliegue**; no apunta directamente al JSON OAuth ni al archivo de copias.

Durante la autorización:

1. Mantener abierta la terminal. El sistema abre el navegador e imprime un enlace de respaldo.
2. Elegir la cuenta que conservará las copias. Si hay varias sesiones de Google, comprobar el correo antes de continuar.
3. En una aplicación propia en modo de prueba puede aparecer el aviso de app no verificada. Comprobar que el nombre y la cuenta correspondan a la configuración preparada antes de decidir continuar. Ante un error de certificado o una aplicación desconocida, revisar el problema.
4. Revisar el consentimiento de archivos de Drive usados con esta aplicación y completarlo.
5. Esperar el resultado **en la terminal**, no solo en el navegador. La pantalla local “Respuesta recibida” confirma el callback, pero todavía falta intercambiar el código y preparar la carpeta.

El resultado esperado es un mensaje como:

```text
Google Drive autorizado. Carpeta: ID_GENERADO. Ejecutá una primera copia para comprobarla.
```

El sistema guarda `DRIVE_TOKEN_FILE` y completa `DRIVE_FOLDER_ID` en el archivo de copias. Conservar ese ID en futuras autorizaciones del mismo cliente y cuenta. Dejarlo vacío crea otra carpeta; no elimina la anterior. Cambiar de cliente o cuenta puede requerir una carpeta propia nueva.

El callback escucha temporalmente en `127.0.0.1`, en un puerto libre. Usa `state` y PKCE y cierra al terminar o vencer. No requiere una URL pública de retorno ni abrir ese puerto a Internet. Referencia del mecanismo: [OAuth de escritorio](https://developers.google.com/identity/protocols/oauth2/native-app).

Si la autorización se hizo mediante este comando independiente y `BACKUP_CONFIGURE_DRIVE` estaba en `true`, dejarlo en `false` en el archivo de despliegue para que la próxima preparación no vuelva a abrir el consentimiento. El asistente integrado lo hace al finalizar su propia etapa de autorización.

## 8. Ejecutar y comprobar la primera copia

Con la base y su lector disponibles, elegir el perfil correspondiente:

```sh
npm run backup -- --profile demo
# O bien
npm run backup -- --profile production
```

La web/API no tiene que estar iniciada para este comando; PostgreSQL sí. En demo, el clúster que inicia el lanzador se detiene al cerrar ese proceso. Una alternativa es ejecutar la copia desde **Administración → Copias de seguridad** con demo iniciado y una cuenta Administrador con `backups.manage`.

Comprobar el estado **COMPLETO**, el `.dump` local y el archivo dentro de la carpeta de Drive. El motor comprueba cabecera e índice PostgreSQL, calcula SHA-256 y confirma nombre, carpeta, tamaño y MD5 mediante metadata de Drive. **PARCIAL** significa que quedó la copia local pero no se confirmó el destino en línea.

Programar la ejecución diaria solo después de esa comprobación, siguiendo [BACKUPS.md](BACKUPS.md#ejecución-y-horario). La autorización de Google no instala por sí sola una tarea del sistema operativo.

## 9. Servidor sin navegador

La autorización necesita una terminal interactiva; no se resuelve con el modo de despliegue `--non-interactive`. Las copias posteriores utilizan el token guardado y funcionan sin navegador.

Se puede completar el consentimiento de dos maneras:

- Ejecutar el autorizador en el servidor por una terminal SSH interactiva. Desde el equipo con navegador, crear un túnel al puerto de `127.0.0.1` indicado en el parámetro `redirect_uri` del enlace impreso. Abrir ese enlace y terminar el consentimiento dentro de los cinco minutos. El puerto cambia en cada intento.
- Autorizar en un equipo de confianza usando el mismo JSON OAuth y un archivo de copias con rutas válidas en ese equipo. Transferir por un canal seguro el token generado y el ID de carpeta al servidor; configurar sus rutas locales y permisos. Esta operación no necesita que la base del servidor esté accesible desde ese equipo.

En ambos casos, comprobar una copia real desde la cuenta del sistema operativo que ejecutará la tarea. No abrir el callback en todas las interfaces ni enviar credenciales por chat o correo.

## 10. Caducidad y uso en producción

Google documenta la diferencia entre los estados de publicación en [Administrar el público de la aplicación](https://support.google.com/cloud/answer/15549945?hl=es).

| Configuración OAuth en Google        | Consecuencia para esta integración                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Usuarios externos + Prueba / Testing | El refresh token emitido para Drive caduca a los siete días. Ejecutar otra vez la autorización cuando venza.                                 |
| Usuarios externos + En producción    | No se aplica la caducidad semanal de Testing. El código obtiene nuevos access tokens sin intervención mientras el refresh token siga válido. |
| Audiencia interna de Workspace       | La regla de siete días de aplicaciones externas en Testing no corresponde; siguen aplicando las restricciones de la organización.            |

Los siete días no dependen de usar una cuenta personal o institucional, ni del nombre del perfil local. Para producción, completar los requisitos de Google y generar una nueva autorización para ese entorno; no depender del token emitido durante las pruebas.

Una autorización puede dejar de funcionar por revocación del usuario, seis meses sin uso, límites de tokens o decisiones administrativas aplicables. No se garantiza validez permanente. Estas condiciones están en la [documentación de caducidad de Google](https://developers.google.com/identity/protocols/oauth2#expiration).

Para renovar el acceso, usar el comando `backup:authorize` del perfil afectado con su mismo cliente y cuenta, conservar el ID de carpeta cuando siga accesible y ejecutar una copia de comprobación. Autorizar Google no cambia la contraseña del usuario del catálogo ni las credenciales de PostgreSQL.

## 11. Problemas frecuentes

| Síntoma                                            | Comprobación y acción                                                                                                                                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Falta JSON o no se puede leer                      | El asistente solicita el archivo descargado y lo importa al destino privado. Enter en un destino ausente no genera credenciales. Para una instalación existente, el mensaje indica la ruta que falta. Las rutas relativas del destino parten del archivo de copias; las de origen, de la raíz del proyecto. |
| Se rechaza el JSON                                 | Confirmar que es un cliente de **escritorio** con objeto `installed`, no un cliente web, clave de API o cuenta de servicio.                                                                              |
| El comando no inicia                               | Ejecutar desde la raíz, elegir el perfil correcto, habilitar sus copias, compilar el servidor y usar una terminal interactiva.                                                                           |
| Google no permite el acceso de la cuenta           | En Testing, agregar el correo seleccionado como usuario de prueba. En audiencia interna, comprobar que pertenece a la organización.                                                                      |
| No se encuentra la descarga                        | Buscar el JSON en la ubicación elegida por el navegador y proporcionar esa ruta en `DRIVE_CLIENT_SOURCE`. El asistente lo copia al destino privado; no busca automáticamente en Escritorio o Descargas. |
| Se cierra la terminal o vence el plazo             | Ejecutar nuevamente el autorizador y utilizar el enlace nuevo. La pestaña anterior corresponde a otro callback.                                                                                          |
| `127.0.0.1` rechaza la conexión                    | Comprobar que el proceso siga esperando y que el navegador llegue al mismo equipo o al túnel correcto. Un proceso vencido ya cerró el puerto; repetir el flujo.                                          |
| El navegador confirma pero la terminal falla       | Revisar configuración, autorización y conectividad con Google. El acceso solo queda preparado cuando la terminal confirma la carpeta y el archivo privado contiene su ID.                                |
| Token ausente, revocado o vinculado a otro cliente | Reautorizar con el JSON y cuenta correctos. No sustituir el JSON conservando sin revisión una autorización de otro cliente.                                                                              |
| Carpeta inaccesible                                | Comprobar cliente, cuenta, ID y permisos. Un enlace de Drive no concede acceso al alcance `drive.file`. Crear una carpeta propia si la anterior ya no es accesible y conservar los respaldos históricos. |
| Copia **PARCIAL**                                  | Conservar el `.dump` local; revisar red, cuota, token y carpeta, y ejecutar una nueva copia al corregir el problema.                                                                                     |
| Copia **FALLIDO** por PostgreSQL                   | Confirmar que la base esté iniciada y el lector pueda conectarse y leerla; comprobar herramientas, permisos y espacio local.                                                                             |
| Pide autorización en cada preparación              | Si ya se completó la autorización independiente, revisar `BACKUP_CONFIGURE_DRIVE` y dejarlo en `false`. No borrar el token ni el ID para una ejecución ordinaria.                                        |

## 12. Alcance del respaldo y entrega

Este respaldo contiene **la base PostgreSQL**. Los PDF de `ATTACHMENT_DIRECTORY`, la configuración privada y los roles técnicos de PostgreSQL necesitan conservación por separado para una recuperación integral. El sistema genera copias; la restauración se hace con herramientas administrativas según [BACKUPS.md](BACKUPS.md#restauración-de-una-copia).

La entrega debe dejar identificado el responsable del proyecto de Google, la cuenta de Drive elegida, el perfil, las ubicaciones privadas, el ID de carpeta, el resultado de la primera copia y la persona que revisará los fallos. Registrar referencias operativas sin incluir contraseñas, secretos ni tokens en documentos versionados.
