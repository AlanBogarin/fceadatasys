# Conjuntos de demostración y entrega inicial — 18/10/2026

**Actualización de despliegue:** ejecutar `npm run start:demo` o `npm run start:production` desde la raíz; ver [README](../../README.md) y [DEPLOYMENT.md](../../docs/operacion/DEPLOYMENT.md). El backend simulado ya no es desplegable. Las instrucciones manuales siguientes se conservan para administración de los conjuntos y del clúster anterior; el lanzador crea su propio clúster demo en puerto 55440.

| Entorno | Contenido | Destino |
| --- | --- | --- |
| Pruebas del desarrollador | Fixtures técnicos y escenarios de errores, con sufijos por ejecución. | Bases `*_test` existentes; no se utilizan para presentar el sistema. |
| Demostración | UNC del YAML aportado, personas ficticias legibles, tres roles y ocho investigaciones con PDF. | `fceadatasys_demo`, `.env.demo`. |
| Producción: entrega inicial | Un Administrador y parámetros predeterminados, sin muestras. | Base vacía propia, `.env.production`. |

Ningún cargador borra registros ni auditoría para convertir un entorno en otro.

## Demostración UNC

La [estructura institucional](../data/demo/unc.json) transcribe el YAML aportado por el usuario; no se realizó una verificación institucional externa. Las personas y los trabajos son ficticios, identificados como tales en resúmenes y PDF.

**Campos obligatorios actualizados el 28/10/2026:** los 14 autores y 12 tutores incluyen CI y correo sintéticos (`autorN@demo.example.test` / `tutorN@demo.example.test`); cada tutor tiene especialidad. Las 18 carreras tienen códigos sintéticos estables `DEMO-<sigla>-<posición>`, las facultades conservan sus siglas y las cinco sedes incluyen direcciones expresamente ficticias en `unc.json`. Estos valores permiten mostrar los campos obligatorios sin atribuir contactos, códigos o direcciones reales a la institución. ORCID y descripciones siguen siendo opcionales; ver [CATALOGS.md](CATALOGS.md).

| Datos | Cantidad |
| --- | --- |
| Facultades | 6: FCEA, FHyCE, FCA, FACET, FMUNC y FOUNC |
| Carreras | 18, agrupadas por facultad en el manifiesto |
| Sedes/filiales | 5: Concepción, Horqueta, Yby Yaú, Vallemí y Fuerte Olimpo |
| Autores / tutores | 14 / 12 |
| Niveles / tipos | 3 / 4 |
| Usuarios / publicaciones / PDF | 3 / 8 / 8 |

Son **62 entradas de catálogos/personas**: 36 clasificaciones en `catalogos`, 14 autores y 12 tutores. Niveles: Grado, Especialización y Maestría. Tipos: Trabajo de grado, Artículo científico, Monografía y Proyecto de investigación.

Se conservan todas las carreras del YAML: cuatro FCEA, seis FHyCE, tres FCA, dos FACET, una Medicina y dos Odontología. El modelo actual tiene catálogos planos, sin FK Facultad–Carrera ni Facultad–Publicación. Las asociaciones se conservan en el manifiesto y en descripciones, sin inventar relaciones de base de datos. Las publicaciones de ejemplo pertenecen a FCEA y usan Concepción/Horqueta; las otras filiales conservan la información de extensión/desarrollo indicada por el usuario.

### Cuentas

| Usuario | Rol | Contraseña de ejemplo exclusiva de demo |
| --- | --- | --- |
| `admin` | ADMINISTRADOR | `Fcea2026!` |
| `digitador` | DIGITADOR | `Fcea2026!` |
| `publico` | PUBLICO | `Fcea2026!` |

Se leen de `DEMO_ADMIN_PASSWORD`, `DEMO_DIGITADOR_PASSWORD` y `DEMO_PUBLICO_PASSWORD` en `.env.demo`. Pueden cambiarse antes de la primera carga; repetir no cambia credenciales. Correos `*.example.test` y CI de estas cuentas son sintéticos. Manifiesto de personas/cuentas: [people.json](../data/demo/people.json).

### Publicaciones

1. Educación financiera y hábitos de ahorro de estudiantes universitarios.
2. Digitalización de procesos en microemprendimientos comerciales.
3. Costos de producción y rentabilidad en pequeños negocios.
4. Inclusión financiera en comunidades rurales.
5. Clima laboral y desempeño en organizaciones locales.
6. Comercio electrónico y preferencias de consumo juvenil.
7. Presupuesto familiar y planificación del gasto.
8. Emprendimiento sostenible y desarrollo económico local.

Cada trabajo tiene dos autores ordenados, tutor, clasificaciones, resumen, abstract en inglés, palabras clave y PDF local. Metadatos: [publications.json](../data/demo/publications.json). Se reutilizaron los ocho PDF ficticios anteriores, copiados con nombres legibles a `server/data/demo/documents/`. La nueva carga no depende de `client/public`: usa el endpoint normal, ClamAV, hash y almacenamiento privado, con descarga autenticada.

### Ejecutar la demo en esta computadora

Desde la raíz, con Node 24/dependencias y ClamAV con firmas vigentes:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' start `
  -D '.\server\.tmp\postgres-data' `
  -l '.\server\.tmp\postgres-demo.log' `
  -o '-h 127.0.0.1 -p 55439'
./server/scripts/prepare-demo.ps1
cd server
npm run db:init:demo
npm run dev:demo
```

Omitir el primer comando si el clúster está activo. `prepare-demo.ps1` comprueba que sea el clúster aislado del repositorio en puerto 55439, crea únicamente la base demo/rol limitado si faltan, aplica las migraciones/grants vigentes y prepara `server/.env.demo` y `client/.env.demo`, ignorados por Git. Genera un JWT aleatorio y conserva archivos existentes. No modifica `.env` institucional, `pg_hba.conf` ni bases del desarrollador. El clúster local conserva su autenticación de pruebas; otras instalaciones requieren roles/contraseñas propios.

En otra terminal desde la raíz:

```powershell
cd client
npm run dev:demo
```

Abrir **http://127.0.0.1:5173**, entrar con `admin` y comprobar la cabecera **Demostración conectada**. Mantener ambas terminales abiertas y el mismo host para cookies/CORS. Al terminar: Ctrl+C en ambas y, si no se utiliza para otro trabajo, `pg_ctl stop -D '.\server\.tmp\postgres-data' -m fast -w` desde la raíz.

Para otra instalación: copiar [server/.env.demo.example](../.env.demo.example) a `.env.demo`, configurar URL de una base local exclusiva terminada en `_demo`, nombre esperado, JWT, CORS, almacenamiento y ClamAV; preparar migraciones/grants según [DATABASE.md](DATABASE.md). Copiar [client/.env.api.example](../../client/.env.api.example) a `client/.env.demo`.

La demo no lee la configuración SMTP institucional existente. Sin SMTP y una dirección receptora real de prueba, recuperación muestra el mensaje genérico y no entrega correo; `example.test` no es un buzón real. Para demostrar correo, configurar un transporte propio y una cuenta receptora mediante administración normal; no se fabrican tokens en el cliente.

## Producción: entrega inicial

Manifiesto independiente: [production/initial.json](../data/production/initial.json).

| Campo | Valor acordado |
| --- | --- |
| Nombre | Administrador |
| CI | `0000000`, conservada como texto |
| Usuario | `admin` |
| Rol / estado | ADMINISTRADOR / activo |
| Correo / contraseña | Configurar localmente; ambos obligatorios, sin valores demo |

Estado esperado: **1 usuario, 0 publicaciones, 0 adjuntos, 0 autores/tutores/catálogos**, un evento `USER_BOOTSTRAP` y parámetros **300 palabras / PDF / 10 MiB**. Las migraciones crean los parámetros; no se cargan muestras UNC ni cuentas Digitador/Público. Admin completará los catálogos de la operación real.

1. Crear una base vacía con propietario/migraciones y runtime separados según [DATABASE.md](DATABASE.md).
2. Aplicar las nueve migraciones existentes con el propietario y `scripts/runtime-grants.sql` dirigido al runtime; retirar del entorno la URL de propietario.
3. Copiar [server/.env.production.example](../.env.production.example) a `server/.env.production`. Completar localmente URL runtime/nombre de base, correo/contraseña del Admin, JWT, dominios HTTPS, almacenamiento privado, ClamAV y SMTP. Nombre/CI/usuario ya están definidos. El archivo local está ignorado por Git.
4. Desde `server/`, ejecutar `npm run db:init:production`.
5. Retirar las variables `BOOTSTRAP_ADMIN_*` del entorno tras verificar el alta; no se necesitan para arrancar la API.
6. Configurar el cliente con `VITE_DATA_MODE=api` y URL HTTPS real; compilar cliente/servidor. `npm run start:production` usa el build y `.env.production`. HTTPS, cookies Secure, SMTP, almacenamiento y backups mantienen sus requisitos operativos.

Correo/contraseña ausentes se rechazan antes de abrir la base. Se exige coincidencia explícita de perfil y nombre de base, y runtime sin privilegios/membresía del propietario. El perfil inicial rechaza bases con negocio/sesiones o parámetros alterados; no las limpia. Una repetición inmediata con la misma identidad conserva contraseña y evento de bootstrap. La cuenta y su auditoría se confirman en una transacción; fallo de auditoría cancela el alta. El comando anterior `db:bootstrap` reutiliza ese módulo y conserva su contrato.

## Repetición y errores

- Demo encuentra cuentas por usuario y registros por nombres/títulos normalizados. Conserva existentes y completa únicamente los campos obligatorios faltantes de sus muestras mediante PATCH con ETag, contraseña de confirmación y auditoría transaccional. Conserva valores personalizados, IDs, fechas de alta, relaciones, credenciales y estados; no realiza DELETE. El resultado incluye `catalogsUpdated`; una segunda ejecución con datos completos devuelve cero actualizaciones. Un catálogo requerido inactivo o identidad incompatible exige intervención explícita. Repetir `npm run db:init:demo` desde `server/` actualiza una demo anterior; el lanzador también ejecuta la inicialización al arrancar el perfil demo.
- Usuarios, catálogos, archivos y publicaciones se cargan por API con sesión Admin y auditoría. No se insertan archivos marcados CLEAN ni publicaciones directamente en PostgreSQL.
- Cada operación es transaccional; no existe una transacción global para ocho binarios y todo el conjunto. Si se interrumpe, se conservan operaciones confirmadas. Corregir la causa y repetir completa lo faltante.
- Un PDF cargado y todavía DISPONIBLE se recupera por SHA-256. Vinculados, reservados, pendientes y rechazados no se tratan como libres.
- Renombrar manualmente muestras o cambiar identificadores puede provocar rechazo por duplicados/reservas al repetir. El cargador no reconstruye ni borra historia para restaurar una demo. Utilizar otro entorno vacío o administrar explícitamente los registros.
- No ejecutar las suites de desarrollador contra demo o producción.

## Archivos, contratos y validación

Datos en `server/data/demo/` y `server/data/production/`; lógica en `src/initialization/`; CLI `scripts/initialize-data.ts`; preparación local `scripts/prepare-demo.ps1`. Plantillas separadas y marca de demo en el cliente. No se cambiaron endpoints, contratos HTTP, dependencias ni migraciones.

Resultados del 18/10/2026:

- **217 pruebas unitarias de servidor**, **7 de inicialización con PostgreSQL** y **113 del cliente** aprobadas; tipos/build de cliente y servidor correctos.
- Los siete tests verifican producción mínima, rollback de auditoría, idempotencia, reanudación tras fallo de catálogo/scanner, carga por API y separación de conjuntos. El scanner se sustituye explícitamente solo en esos casos deterministas.
- Carga real de `fceadatasys_demo`: 3 usuarios, 36 clasificaciones, 14 autores, 12 tutores, 8 publicaciones y **8 PDF CLEAN con fecha de análisis ClamAV real**. Segunda ejecución: cero usuarios/catálogos/publicaciones/adjuntos nuevos.
- Producción se verificó con credenciales sintéticas en una base de test, incluida CI `0000000`. No se inicializó producción real ni se inventaron correo/contraseña que el usuario indicó configurar localmente.
- UI IAB: login con los tres roles, Inicio 3/8, listado/ficha con nombres legibles y catálogos del YAML. Público consulta sin botón de descarga; Digitador accede a los 14 autores sin navegación de auditoría. Evidencias: [Inicio](../../docs/historico/cliente/evidencias/demo-unc-inicio-2026-10-18.png) y [publicación](../../docs/historico/cliente/evidencias/demo-unc-publicacion-2026-10-18.png).

Reproducir desde `server/`, con el clúster aislado activo:

```powershell
npm run test:unit
npm run test:typecheck
npm run build
$env:INITIAL_DATA_TEST_OWNER_URL='postgresql://fcea_test@127.0.0.1:55439/postgres'
npm run test:initial-data
```

El test crea `fceadatasys_<ejecución>_demo_test` y `fceadatasys_<ejecución>_delivery_test`, aplica migraciones/grants y conserva registros/auditoría. Runtime predeterminado: `fcea_test_app`, configurable con `INITIAL_DATA_TEST_RUNTIME_ROLE`. No consume las bases de demostración/producción. Las advertencias conocidas de `pg` y chunk de ExcelJS no impidieron las validaciones.
