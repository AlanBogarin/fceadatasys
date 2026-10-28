# FCEA-Datasys · Catálogo bibliográfico UNC

Aplicación React/TypeScript y API Fastify/PostgreSQL. Registra y permite consultar producciones académicas ya aprobadas fuera del sistema.

**El despliegue utiliza exclusivamente la API real.** Los perfiles disponibles son **demo** y **production**. El backend simulado y sus cuentas locales ya no son una opción de ejecución.

## Inicio rápido

Desde la raíz del repositorio, con Node.js **24.11 o superior de la rama 24**:

```powershell
npm start
```

El asistente permite elegir perfil. También se puede seleccionar directamente:

```powershell
npm run start:demo
```

```powershell
npm run start:production
```

El lanzador instala dependencias cuando es necesario, compila cliente/API, prepara roles y base de datos, aplica las migraciones/permisos pendientes, carga el conjunto elegido y arranca el sistema bajo una única dirección. Los comandos funcionan desde PowerShell en Windows y desde una terminal en Linux con las herramientas requeridas.

## Requisitos

- Node.js 24.11+ (<25), con npm y acceso al registro de dependencias en la primera instalación.
- PostgreSQL 18 instalado, incluyendo `initdb`, `pg_ctl`, `pg_controldata` y `psql`.
- ClamAV instalado y firmas vigentes. En Windows, desde la raíz: `./server/scripts/update-clamav.ps1`.
- Producción: servicio PostgreSQL disponible, dominio/DNS y certificado/clave TLS PEM propios.
- SMTP si se requiere entregar correos de recuperación.

El script comprueba la configuración y analiza un contenido inocuo con ClamAV antes de completar la preparación. No instala paquetes del sistema operativo ni modifica DNS, firewall o certificados del equipo.

## Demo UNC

```powershell
npm run start:demo
```

Por defecto:

| Elemento | Valor |
| --- | --- |
| Dirección web | `http://127.0.0.1:8080` |
| API privada | `127.0.0.1:3001` |
| PostgreSQL aislado | `127.0.0.1:55440`, base `fceadatasys_demo` |
| Configuración | `.local/deploy/demo.env` |
| Clúster | `.local/deploy/demo/postgres-data` |
| Adjuntos | `server/.local/demo/attachments` |

El clúster demo se crea con autenticación SCRAM y contraseñas aleatorias. Es independiente del clúster anterior de pruebas en puerto 55439 y del servicio institucional. El lanzador lo inicia si está detenido y lo detiene al salir si él lo inició.

Datos: **6 facultades, 18 carreras, 5 filiales, 14 autores, 12 tutores y 8 publicaciones con PDF**. Los archivos se cargan por la API y pasan ClamAV; no se publican PDF estáticos.

| Usuario | Rol | Contraseña inicial de ejemplo |
| --- | --- | --- |
| `admin` | Administrador | `Fcea2026!` |
| `digitador` | Digitador | `Fcea2026!` |
| `publico` | Público | `Fcea2026!` |

Las contraseñas se pueden configurar antes de la primera carga. Repetir el preparador conserva registros, contraseñas e historial. Si se cambiaron credenciales o se editaron muestras, usar el arranque `--start-only` para evitar reanudar la carga de ejemplos.

## Producción

```powershell
npm run start:production
```

La base predeterminada de producción se llama **`fceadatasys`** y utiliza el servicio PostgreSQL principal (por defecto `127.0.0.1:5432`). El asistente pide host, puerto, usuario y contraseña administrativa, cuentas técnicas, dirección HTTPS, certificados, almacenamiento, ClamAV, identidad del Administrador, SMTP y cada opción de copias de seguridad. Construye las URLs y mantiene ocultas las entradas secretas.

Para configurar, guardar solamente o aplicar toda la preparación sin dejar la web iniciada:

```powershell
npm run configure -- --profile production
```

La configuración se guarda en `.local/deploy/production.env`, ignorada por Git. La cuenta administrativa debe existir y poder crear roles/base; el asistente crea los roles técnicos cuando faltan. Si ya existen, sus contraseñas deben coincidir: se comprueba su acceso y no se restablecen. Si existe la base, pregunta **conservar / eliminar y recrear / cancelar**; conservar es la opción predeterminada. Recrear exige una copia local previa verificada, la confirmación exacta `ELIMINAR fceadatasys` y que no haya conexiones activas. Nunca se eliminan roles, adjuntos u otras bases. `--non-interactive` conserva siempre. La base anterior `fceadatasys_production` no se renombra ni se elimina automáticamente al elegir el nuevo nombre.

La primera carga crea únicamente un Administrador (valores iniciales: **Administrador / CI `0000000` / usuario `admin`**), parámetros **300 palabras / PDF / 10 MiB** y auditoría. La identidad inicial se puede ajustar en el asistente y no se cargan muestras UNC. La contraseña inicial y la URL administrativa se retiran del archivo tras preparar la base; la API recibe solo sus credenciales runtime.

Si se habilitan copias, el asistente guarda `.local/backups/production.env`, provisiona una cuenta PostgreSQL de lectura y permite importar el JSON OAuth y abrir el navegador para autorizar Drive, probar la primera copia y registrar o actualizar la tarea diaria Windows/Linux con la hora elegida. También ofrece deshabilitar una tarea previa cuando se desactiva la programación. Solo se requieren las herramientas PostgreSQL; la subida utiliza directamente la API de Google Drive. Preparación de cuenta, proyecto, credenciales y consentimiento: [guía de Google Drive](docs/operacion/GOOGLE-DRIVE.md). Instalación y responsabilidades: [INSTALLATION-PRODUCTION.md](docs/operacion/INSTALLATION-PRODUCTION.md).

Demo admite una cuenta personal de Google. Producción utiliza su propia configuración y proyecto de Google. La caducidad semanal corresponde al estado OAuth externo **Prueba/Testing** de Google Cloud; elegir el perfil local `production` no cambia ese estado. En Google **En producción**, el código renueva automáticamente el acceso mientras la autorización siga válida. Detalles y renovación: [Google Drive](docs/operacion/GOOGLE-DRIVE.md#10-caducidad-y-uso-en-producción).

La web escucha por defecto en `0.0.0.0`, puerto HTTPS del `PUBLIC_URL`; la API permanece en loopback. El servidor web incluido entrega `client/dist`, sirve configuración pública en ejecución y dirige `/api/v1` a la API. No es necesario ejecutar Vite ni configurar Nginx para este camino de despliegue.

## Configuración principal

Editar `.local/deploy/demo.env` o `.local/deploy/production.env`, o usar el asistente. Las [plantillas](deployment/.env.production.example) contienen marcadores; el asistente genera los secretos reales. No compartir ni versionar archivos locales.

| Campo | Uso |
| --- | --- |
| `PROFILE` | `demo` o `production`; debe coincidir con el comando. |
| `PUBLIC_URL` | Origen completo, sin ruta/barra final. Producción exige HTTPS. Define también el puerto web. |
| `WEB_HOST` | `127.0.0.1` para acceso local o `0.0.0.0` para escuchar en las interfaces del servidor. |
| `API_PORT` | Puerto privado de la API, diferente del web. |
| `DATABASE_URL` | Base y rol runtime limitado. |
| `MIGRATION_DATABASE_URL` | Misma base con propietario distinto, para migraciones y grants. |
| `PG_ADMIN_URL` | Conexión administrativa opcional para la primera creación de roles/base. |
| `MANAGE_POSTGRES` | `true` para el clúster demo aislado; producción utiliza `false` y un servicio PostgreSQL propio. |
| `PG_BIN_DIRECTORY` | Carpeta de herramientas PostgreSQL; vacío si están en PATH. |
| `PG_DATA_DIRECTORY` | Directorio del clúster administrado demo, dentro de `.local/deploy/demo/`. |
| `JWT_SECRET` | Secreto aleatorio propio, generado por el asistente. |
| `TLS_CERT_FILE` / `TLS_KEY_FILE` | Certificado/fullchain y clave privada PEM. |
| `ATTACHMENT_DIRECTORY` | Almacenamiento privado persistente; nunca un directorio público. |
| `CLAMAV_*` | Ejecutable, firmas, timeout y antigüedad máxima. |
| `BOOTSTRAP_ADMIN_*` | Identidad y credenciales para la primera cuenta de producción. |
| `SMTP_*` | Transporte para recuperación. Sin SMTP no se envían correos. |
| `BACKUP_ENABLED` / `BACKUP_CONFIG_FILE` | Habilitar las copias y elegir su archivo privado. |
| `BACKUP_CONFIGURE_DRIVE` / `BACKUP_TEST_ON_SETUP` | Autorizar la API de Drive en el navegador y probar una primera copia durante la preparación. |
| `BACKUP_INSTALL_SCHEDULE` / `BACKUP_TIME` | Registrar/actualizar la tarea diaria y su hora local `HH:MM`. |
| `BACKUP_DISABLE_SCHEDULE` | Deshabilitar una tarea anterior si el instalador lo solicitó; se consume al aplicarse. |
| `INSTALL_BACKUP_DIRECTORY` | Carpeta privada de la copia obligatoria antes de recrear una base. |

Las rutas relativas de este archivo parten de la **raíz del repositorio**. El lanzador traduce la configuración de la API y no sobrescribe `server/.env`, `.env.demo` ni `.env.production` anteriores. Tampoco depende de variables `VITE_*` locales: compila únicamente para API y sirve dominio/perfil en ejecución. Un cambio de dominio requiere reiniciar, no recompilar.

## Arranque posterior, preparación y cierre

```powershell
# Preparar sin dejar servicios activos
node scripts/run.mjs --profile demo --setup-only

# Iniciar una instalación preparada, sin migrar ni cargar datos
npm run start:demo -- --start-only
npm run start:production -- --start-only

# Ejecutar sin preguntas con la configuración existente
node scripts/run.mjs --profile production --non-interactive

# Configuración alternativa explícita
node scripts/run.mjs --profile production --config .local/deploy/otra-entrega.env

# Cierre ordenado desde otra terminal
npm run stop:demo
npm run stop:production
```

También se puede detener con **Ctrl+C** en la terminal del lanzador. Se cierran web y API, se liberan recursos y se conserva la base, adjuntos y auditoría. El cierre de producción no detiene su servicio PostgreSQL externo. Cada perfil admite un lanzador activo y comprueba puertos antes de arrancar.

El proceso permanece en primer plano. Para ejecución después de reiniciar el equipo, registrar el comando `node scripts/run.mjs --profile production --start-only --non-interactive` como servicio mediante el gestor de la institución, con directorio de trabajo del repositorio y permisos sobre configuración, certificados y adjuntos. El lanzador no registra automáticamente servicios globales del sistema operativo.

## Desarrollo y validación

La ventana Roles y permisos permite configurar acciones por rol y excepciones por cuenta. Auditoría muestra una vista amigable con opciones JSON/raw. Copias de seguridad permite respaldos de PostgreSQL y consulta del estado local/en Google Drive. Para recuperar una copia rápidamente, detener el sistema y ejecutar `npm run restore -- --profile production` (o `demo`): el asistente permite elegir un respaldo verificado y conserva la base anterior. Configuración y acceso a Drive: [GOOGLE-DRIVE.md](docs/operacion/GOOGLE-DRIVE.md). Programación y restauración: [BACKUPS.md](docs/operacion/BACKUPS.md); accesos: [PERMISSIONS.md](docs/operacion/PERMISSIONS.md). Requieren las dos migraciones del 26/10/2026 y los grants actualizados.

El cliente de desarrollo también utiliza API real. Las instrucciones manuales y contratos están en [cliente](client/README.md), [servidor](server/README.md), [API](server/docs/API.md) y [conjuntos iniciales](server/docs/INITIAL-DATA.md).

```powershell
npm run test:deployment
npm test --prefix client
npm run test:unit --prefix server
npm run test:typecheck --prefix server
npm run build --prefix client
npm run build --prefix server
```

Las pruebas de integración requieren bases separadas y configuración explícita: [TESTING.md](server/docs/TESTING.md). Una suite omitida por falta de URL no equivale a una validación aprobada. Los stubs/fixtures de pruebas no forman un backend seleccionable para despliegue.

Revisión y límites del lanzador: [DEPLOYMENT.md](docs/operacion/DEPLOYMENT.md). Los [22 pasos de conexión](docs/historico/integracion/PLAN-CONEXION-CLIENTE-SERVIDOR-2026-10-17.md) y sus entregas conservan evidencia histórica; las referencias anteriores al simulador corresponden a estados retirados.

## Dependencias

Cliente y servidor conservan sus propios lockfiles. El lanzador utiliza `npm ci --include=dev` y no cambia la política npm del equipo. Conservar las medidas de instalación documentadas (`allow-git=none`, `ignore-scripts=true`, `min-release-age=7`, `strict-ssl=true`) según la configuración del entorno; aplicarlas globalmente afecta otros proyectos del mismo usuario.

## Documentación del proyecto

Los entregables editables se mantienen en la [carpeta Proyecto](../), fuera del repositorio. El [índice Word](<../TPF - Indice de documentos.docx>) identifica versiones vigentes, antecedentes y pendientes. La [documentación técnica](docs/README.md) separa operación, contratos, validaciones fechadas e historia. No se mantienen ZIP de entrega ni PDF equivalentes a Word/PowerPoint.
