# Lanzador de configuración y despliegue — actualización 26/10/2026

## Alcance

`scripts/run.mjs` es el punto de entrada desde la raíz. Soporta Windows y Linux con Node 24, herramientas PostgreSQL y ClamAV instaladas. Dos perfiles explícitos: `demo` y `production`. No selecciona ni compila un backend simulado.

Configura/instala/prepara/arranca el sistema con `npm start`, `npm run start:demo` o `npm run start:production`. `--configure` pregunta todas las opciones y permite guardar solamente o aplicar la preparación sin iniciar la web; `--setup-only` prepara sin dejar servicios; `--start-only` arranca sin instalación/migraciones/datos; `--stop` solicita cierre ordenado del perfil. `--config` selecciona un archivo explícito; `--non-interactive` evita preguntas y siempre conserva una base existente; `--skip-install` requiere dependencias existentes.

## Componentes

- `scripts/deployment/config.mjs`: valores iniciales, archivos `.env` privados, validación de perfiles/destinos, traducción a configuración API y redacción de secretos. Se filtran variables heredadas para no mezclar configuraciones de otros entornos.
- `database.mjs`: clúster demo SCRAM aislado, creación de roles/base, propietario/migraciones, grants y comprobación de runtime. En producción verifica credenciales técnicas antes de permitir una recreación. Las contraseñas existentes se conservan. La identidad del clúster demo se comprueba con `pg_controldata` y `pg_control_system()`, incluyendo rutas Unicode de Windows.
- `wizard.mjs`: cuestionario de PostgreSQL principal, red, TLS, cuentas, almacenamiento, antivirus, SMTP y copias. Producción usa `fceadatasys` por defecto, sin un clúster dentro del proyecto.
- `production-database.mjs`: inspección y decisión sobre una base existente, snapshot obligatorio con índice pg_restore válido y confirmación exacta antes de recrearla. No fuerza desconexiones ni elimina roles/archivos. Registra el procedimiento en `.local/deploy/production/installation-events.jsonl`. También provisiona el lector de copias y sus grants actuales/futuros.
- `backup-setup.mjs`: comprueba herramientas, ofrece autorizar Drive, valida su configuración, prueba una copia y aplica la tarea diaria o su deshabilitación cuando se elige.
- `processes.mjs`: ejecución sin shell, salidas acotadas/redactadas, tiempos máximos y compatibilidad con procesos PostgreSQL de Windows.
- `gateway.mjs`: HTTP demo o HTTPS con certificado/clave PEM, cliente compilado, configuración pública en ejecución y proxy acotado `/api/v1`. La API permanece en `127.0.0.1`.
- `server/src/main.ts`: cierre ordenado mediante señales y canal IPC del lanzador; desconectar el padre cierra la API hija.

Se aplican todas las migraciones pendientes y se conservan los contratos HTTP. Producción existente conserva usuarios y omite bootstrap, salvo recreación explícitamente elegida y confirmada. Demo puede reanudar su carga. La copia previa a una recreación conserva también la auditoría de la base anterior.

## Configuración

Archivo predeterminado `.local/deploy/PERFIL.env`; plantillas en `deployment/.env.*.example`. El asistente genera JWT y contraseñas de base aleatorios, conserva configuraciones existentes y permite entrada oculta de secretos. Archivos creados con permisos 0600 donde el sistema lo soporta; en Windows el operador debe mantener los permisos del directorio de su usuario/servicio. Las rutas relativas parten de la raíz del proyecto.

El asistente de producción solicita las credenciales del PostgreSQL principal y construye `PG_ADMIN_URL`. La preparación utiliza esa cuenta para crear base/roles cuando faltan; luego la retira del archivo. Las ejecuciones posteriores pueden usar el propietario si los roles/base ya existen. `MIGRATION_DATABASE_URL` usa el propietario; `DATABASE_URL`, el runtime. La API hija no recibe credenciales administrativas, de migración ni bootstrap. La contraseña inicial también se retira tras preparar la base, incluso cuando se conservó una cuenta existente.

Demo por defecto: web 8080, API 3001, clúster propio en 55440 bajo `.local/deploy/demo/postgres-data`. Producción: web HTTPS 443, API 3000, base `fceadatasys` en el PostgreSQL principal configurado (por defecto puerto 5432). La dirección pública determina origen, cookies seguras, URL de recuperación y configuración del navegador.

El script conserva archivos `server/.env*`, contraseñas de roles y propietarios existentes. Si se elige conservar una base cuyo propietario no coincide, detiene la preparación para que el operador revise la configuración. Un perfil activo bloquea otra instancia del mismo perfil; un bloqueo PostgreSQL serializa preparaciones de la misma base desde otros directorios. Las conexiones activas impiden recrearla. Solo se detiene el clúster demo iniciado por el proceso actual.

## Web y seguridad

El gateway entrega únicamente recursos web admitidos dentro de `client/dist`, impide traversal/archivos ocultos/escape por symlinks y no publica PDF estáticos. `/runtime-config.js` contiene solo URL pública de API y perfil; no expone claves ni usa caché. Las consultas fetch usan `referrerPolicy=strict-origin`: la restauración de sesión por cookie conserva el control de origen también en solicitudes GET del mismo sitio, sin enviar rutas ni tokens de recuperación. El cliente consume la configuración al arrancar; cambiar dominio/perfil exige reinicio, no recompilación.

Rechaza Host incompatible, limita cabeceras/tiempos/cuerpo y sustituye encabezados de proxy aportados por el cliente. Conserva cookies, autorización, contenido multipart y respuestas de archivos. Los fallos de infraestructura de `/api/v1` también utilizan Problem Details con el código documentado `GATEWAY_ERROR`, sin query sensible. La API confía únicamente en el proxy local explícito (`TRUSTED_PROXIES=127.0.0.1`); conexiones directas desde otras direcciones no pueden declarar su IP mediante X-Forwarded-For. Sin proxy configurado se conserva el comportamiento previo de no confiar en encabezados.

HTTPS requiere certificados PEM vigentes, correspondientes al dominio/IP y a la clave privada. Se valida antes de preparar la base; no existe fallback automático a HTTP en producción. El operador proporciona certificados confiables y cadena completa. No se desactiva la verificación TLS de los clientes ni se modifica el almacén de certificados del equipo.

El punto de entrada `MockApp` y el panel de carga local se retiraron. Vite rechaza el modo mock. Los PDF antiguos se retiraron de `client/public`; los fixtures de integración apuntan a las copias privadas de `server/data/demo`. Algunas funciones/modelos históricos permanecen como soporte de tests y de componentes compartidos; no tienen un punto de entrada desplegable ni ofrecen login/recuperación local.

## Responsabilidades del entorno

El script automatiza la configuración del proyecto, dependencias npm, base/migraciones/permisos/datos y procesos web/API. Requiere herramientas del sistema instaladas y permisos PostgreSQL adecuados. No instala paquetes del SO, configura DNS/firewall, obtiene certificados ACME ni registra servicios globales automáticamente.

El lanzador se ejecuta en primer plano. Para operación permanente debe registrarse `--start-only --non-interactive` con el gestor de servicios institucional. El asistente integra las copias Windows/Linux y su horario, previa autorización de Drive; también se conservan los comandos independientes de [BACKUPS.md](BACKUPS.md). La retención y revisión operativa siguen a cargo de la institución. `configure` y la preparación de ambos perfiles descargan automáticamente las firmas ausentes mediante FreshClam e intentan una actualización si falla el análisis con las firmas existentes. `--start-only` omite la preparación; el mantenimiento periódico durante una ejecución continua requiere FreshClam institucional. El script `server/scripts/update-clamav.ps1` se conserva como herramienta manual de mantenimiento. El detalle actualizado está en [INSTALLATION-PRODUCTION.md](INSTALLATION-PRODUCTION.md). Los resultados del 18/10 siguientes son evidencia histórica anterior a esta ampliación.

## Validación

`npm run test:deployment` verifica perfiles, aislamiento de configuración heredada, persistencia sin interpolación de shell, redacción de secretos, servidor estático, rutas bloqueadas y proxy HTTP con cookies/bytes/encabezados. Los servidores HTTP sustitutos de estos tests son fixtures, no un modo de despliegue.

Las unitarias de servidor comprueban confianza restringida en proxy e IP efectiva. El cliente comprueba rechazo del modo retirado y prioridad de la configuración en ejecución. Las pruebas de integración existentes conservan sus bases exclusivas y el control ClamAV.

Las verificaciones TCP requieren permiso para loopback en el entorno de ejecución. Un rechazo EACCES del sandbox no acredita un fallo funcional; se repiten con acceso local autorizado y se registran sus resultados efectivos.
## Resultado verificado del 18/10/2026

- **219 pruebas unitarias de servidor**, **113 unitarias/componentes de cliente**, **37 de integración cliente/API**, **8 del lanzador** y **3 de arranque real** aprobadas. Tipos de servidor/fixtures API y compilación de ambos componentes correctos.
- Ruta normal completa también aprobada con instalación automática `npm ci --include=dev` de ambos lockfiles, compilación, preparación y carga/reanudación; conserva credenciales y datos.
- Preparación real desde el lanzador: clúster demo nuevo con SCRAM, siete migraciones, runtime limitado, tres usuarios, 36 clasificaciones, 14 autores, 12 tutores y ocho publicaciones/PDF; ocho archivos CLEAN con fecha de análisis ClamAV real.
- Producción se preparó únicamente en `fceadatasys_launch_delivery_<ejecución>`, base aislada de QA con correo/contraseña sintéticos y certificado local. Un Administrador, parámetros predeterminados y cero catálogos/publicaciones/adjuntos. No se configuró ni inicializó una producción institucional real.
- Las tres pruebas de arranque verifican rechazo de propietario como runtime incluso en `--start-only`, demo HTTP y producción HTTPS. Incluyen tres roles demo, cookies HttpOnly/SameSite/Secure, restauración con Referer de origen, privacidad de archivos, IP no falsificable y cierre ordenado.
- Se repitió preparación de producción después de crear sesiones: ID de cuenta, contraseña y conteo de auditoría conservados; no se repitió bootstrap. El archivo ya no conserva contraseña inicial ni URL administrativa.
- Navegador IAB sobre `http://127.0.0.1:8080`: login y recarga con restauración de sesión, Inicio 3 usuarios/8 publicaciones y etiqueta Demostración conectada. [Evidencia](../historico/cliente/evidencias/lanzador-demo-2026-10-18.png).
- Vite y el lanzador rechazan explícitamente el modo mock. El compilado no contiene MockApp ni PDF públicos. Se verificaron 52 enlaces locales y ocho bloques PowerShell del README, sin errores.

La primera ejecución de las nuevas pruebas HTTP quedó bloqueada por EACCES del sandbox y pasó al repetir con acceso loopback autorizado. La primera expectativa de la prueba de arranque consideraba 200 para `/auth/browser`, cuyo contrato es 204; se corrigió antes de la regresión aprobada. La comprobación visual detectó la falta de Referer de origen en GET del mismo sitio; se corrigió en el transporte y se verificó login/recarga real. Las advertencias conocidas de consultas encoladas de `pg` no impidieron las validaciones.

Reproducir las pruebas de arranque requiere entornos locales ya preparados y explícitos:

```powershell
$env:DEPLOYMENT_DEMO_CONFIG='.local/deploy/demo.env'
$env:DEPLOYMENT_PRODUCTION_TEST_CONFIG='.local/deploy/qa-production.env'
$env:DEPLOYMENT_TEST_ADMIN_PASSWORD='CONTRASENA_SINTETICA_DE_QA'
npm run test:deployment:integration
```

El archivo QA debe apuntar a `https://127.0.0.1:PUERTO`, base `fceadatasys_launch_delivery_<ejecución>` y certificado de pruebas correspondiente. El test confía explícitamente en ese certificado para su conexión, sin desactivar la validación TLS global. No utilizar el entorno institucional para esta suite. Los tests sin sus archivos se omiten; las tres ejecuciones declaradas aprobadas se realizaron con sus destinos configurados.

Al cerrar las verificaciones se detuvieron web/API y ambos clústeres de QA iniciados por esta tarea. No quedaron listeners de prueba en 8080, 8443, 3001, 3002, 55439 ni 55440. Las bases, adjuntos, configuración privada y auditoría se conservaron.

## Corrección de rutas Windows con caracteres Unicode — 21/10/2026

Se reprodujo en PostgreSQL 18.3 para Windows que `SHOW data_directory` devuelve una ruta con `año` usando bytes de la página de códigos del sistema. Al interpretarla como UTF-8, `pg` recibe `a�o`; la comparación textual anterior rechazaba el propio clúster. Además, el lanzador detenía PostgreSQL antes de cerrar esa conexión y podía terminar con un evento `error` sin manejar (`57P01`), ocultando el rechazo inicial.

La comprobación usa ahora el identificador del clúster: compara la salida de `pg_controldata` con `pg_control_system()`. Requiere `pg_controldata` junto a las demás herramientas PostgreSQL. La conexión se cierra antes de detener un clúster iniciado por el lanzador y sus errores se conservan. Esta corrección no cambia migraciones, credenciales ni contratos HTTP.

Para aplicar la corrección en otra computadora, copiar la versión actualizada de `scripts/deployment/database.mjs` y ejecutar `npm run start:demo` desde la raíz, conservando `.local/deploy/demo.env`, el clúster y los adjuntos existentes.

Regresión reproducible con clústeres temporales exclusivos (no requiere configurar una base de negocio):

```powershell
$env:DEPLOYMENT_PG_BIN_DIRECTORY='C:/Program Files/PostgreSQL/18/bin'
node --test scripts/deployment/database.integration.mjs
npm run test:deployment
```

Resultado: cuatro escenarios PostgreSQL aprobados (ruta con `ñ` y espacios, rechazo de otro clúster conservando ambos activos, cierre antes de detener tras fallo, evento de conexión manejado conservando su causa), más las ocho pruebas del lanzador. Los dos clústeres temporales se detuvieron y sus directorios de prueba se retiraron. La primera reproducción dentro del sandbox no pudo conectarse por `EACCES` de loopback; la reproducción y regresión aprobadas se ejecutaron con acceso local autorizado.
