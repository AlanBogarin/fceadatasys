# Registro de decisiones técnicas

## Línea base propuesta para la primera implementación

**Fuente:** acuerdos técnicos recibidos el 2026-10-05. Se registran como línea base de dirección del proyecto; su existencia funcional no está verificada porque el repositorio no contiene código de aplicación.

| Área | Decisión recibida | Estado y condiciones |
|---|---|---|
| Runtime/API | Node.js 24+ y TypeScript | Aceptada como línea base. |
| Framework API | Fastify o Express | **Pendiente de elegir uno** antes de desarrollar rutas. |
| Frontend | React, Vite, TypeScript, Tailwind CSS, Shadcn UI/Radix UI, TanStack Query y Zod | Aceptada como línea base; confirmar versiones compatibles al inicializar el proyecto. |
| Persistencia | PostgreSQL y Prisma ORM | Aceptada como línea base. Migraciones SQL personalizadas pueden ser necesarias para constraints/índices que el ORM no represente. |
| Full-text search | PostgreSQL FTS para búsqueda bibliográfica | Requisito aceptado; la afirmación de “soporte nativo” no basta como solución. Verificar configuración española/inglesa, índices `tsvector`, migraciones y consultas; medir el objetivo contractual. La documentación de Prisma presenta FTS PostgreSQL como Preview y señala limitaciones de soporte para `tsvector`/índices funcionales; revisar la documentación de la versión elegida: [Full-text search](https://www.prisma.io/docs/orm/v7/prisma-client/queries/full-text-search), [PostgreSQL connector](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql), [indexes](https://docs.prisma.io/docs/orm/v6/prisma-schema/data-model/indexes). |
| Contraseñas | Argon2id | Aceptada; parametrizar costo de forma segura para el entorno. |
| Sesión | JWT access token y refresh token en cookies HttpOnly | Aceptada como dirección, pendiente de contrato: duración, rotación, detección de reutilización, revocación/logout, almacenamiento/estado del refresh, `Secure`/`SameSite`, CSRF y expiración. Cookie HttpOnly por sí sola no define una sesión completa segura. |
| Recuperación | SMTP institucional con token de un solo uso | Canal propuesto. Confirmar disponibilidad real y entrega desde cada entorno. Token con expiración, aleatorio, uso único, persistido como hash, respuesta anti-enumeración, rate limit y sin secretos en logs. |
| Secretos SMTP | El mensaje dice “configuradas directamente en el backend” | Interpretación segura obligatoria: el backend solo lee variables de entorno/secret manager. Valores no se escriben en código, configuración versionada, `.env.example`, contenedores ni logs. `.env` solo local, ignorado por Git. |
| Archivos | ClamAV y SHA-256 para PDF | Dirección aceptada; validar operación, límites, magic bytes y fallos del scanner antes de habilitar cargas. |
| Reportes | PDFMake y ExcelJS | Línea base para cuando se implemente reportes; fuera del alcance de la primera entrega priorizada. |
| Estructura | `server/` y `client/` independientes | Aceptada como propuesta. Contrato OpenAPI compartido/documentado debe mantener cliente y servidor consistentes; los límites de importación no deben duplicar contratos manualmente sin validación. |
| API/errores | `/api/v1` y RFC 7807 Problem Details | Confirmado por el contrato maestro; preservar sus códigos/campos acordados. |
| Bootstrap ADMIN | Seed obtiene credenciales de entorno | Aceptado con controles: no valores predeterminados; no credenciales en Git; seed idempotente/seguro; secretos documentados únicamente por nombres en `.env.example`; no imprimirlos; documentar operación de primer despliegue y rotación. |

## Condiciones de cierre pendientes

1. Elegir Fastify o Express.
2. Documentar el contrato de JWT, cookies, CSRF, revocación, expiración y logout.
3. Confirmar SMTP institucional en el ambiente objetivo y establecer cómo se inyectan/rotan secretos.
4. Definir duración, rate limits e invalidación del token de recuperación y sus interacciones con sesiones activas.
5. Registrar cómo Prisma implementará FTS y sus índices PostgreSQL específicos, o aprobar una alternativa compatible con `AGENTS.md`.

Hasta cerrar estas condiciones, pueden prepararse estructura, modelo inicial y documentación de contratos; no declarar terminados los flujos de login/recuperación, logout ni el requisito de FTS.
