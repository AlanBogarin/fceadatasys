# FCEA-Datasys · Cliente

Cliente React + TypeScript + Vite del catálogo bibliográfico FCEA/UNC. El punto de entrada consume exclusivamente la API real. El despliegue con backend simulado fue retirado; sus fixtures internos se conservan únicamente para regresiones de reglas y no forman una aplicación seleccionable.

## Ejecutar el sistema completo

Desde la raíz:

```powershell
npm run start:demo
```

```powershell
npm run start:production
```

El lanzador prepara y sirve cliente/API bajo el mismo origen. La configuración pública se obtiene de `/runtime-config.js`; permite cambiar dominio/perfil al reiniciar sin recompilar. Producción exige certificado TLS y credenciales propias. Ver [README raíz](../README.md) y [despliegue](../docs/DEPLOYMENT.md).

## Desarrollo del cliente

Requiere Node 24.11+ (<25) y una API real iniciada con PostgreSQL. Desde `client/`:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Configuración local:

```dotenv
VITE_DATA_MODE=api
VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1
```

Autorizar exactamente el origen de Vite (`http://127.0.0.1:5173`) en CORS de la API y usar el mismo host para cookies. El archivo `public/runtime-config.js` es un marcador de desarrollo; el servidor del lanzador lo sustituye por configuración pública real. Vite y el cliente rechazan `VITE_DATA_MODE=mock`.

La demo del lanzador usa por defecto web en 8080 y API privada en 3001; para desarrollar contra esa API hay que configurar explícitamente su CORS y URL, o usar una instancia de desarrollo separada. No ejecutar Vite como servicio institucional.

## Permisos y datos

Administrador mantiene usuarios, publicaciones, catálogos, parámetros, reportes y auditoría. Digitador registra/edita publicaciones y mantiene autores/tutores. Público consulta metadatos de publicaciones activas y no descarga adjuntos. La evaluación académica ocurre fuera del sistema.

Los datos y archivos proceden del servidor. El access token vive en memoria; las cookies de sesión son HttpOnly. Las señales entre pestañas no incluyen credenciales ni datos de negocio. La demo UNC también utiliza estos controles y descarga autenticada; no publica archivos de muestra en `public/demo`.

## Validación

```powershell
npm test
npm run build
```

`npm run test:api` requiere su base exclusiva, SMTP de pruebas y ClamAV según la [entrega 1–10](../docs/IMPLEMENTACION-CONEXION-PASOS-1-10-2026-10-18.md). El fixture PDF se obtiene de `server/data/demo/documents/`, no de un directorio web público.

Los [22 pasos de conexión](../docs/PLAN-CONEXION-CLIENTE-SERVIDOR-2026-10-17.md) están implementados. Sus entregas conservan evidencia histórica: [1–10](../docs/IMPLEMENTACION-CONEXION-PASOS-1-10-2026-10-18.md), [11–15](../docs/IMPLEMENTACION-CONEXION-PASOS-11-15-2026-10-18.md), [16–20](../docs/IMPLEMENTACION-CONEXION-PASOS-16-20-2026-10-18.md) y [21–22](../docs/IMPLEMENTACION-CONEXION-PASOS-21-22-2026-10-18.md). Las instrucciones antiguas del simulador en documentos anteriores describen una modalidad de despliegue retirada.
