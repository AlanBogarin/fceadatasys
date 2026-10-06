# Registro de decisiones técnicas

## Línea base de implementación inicial

**Actualizado:** 2026-10-06. Estas decisiones resuelven las condiciones técnicas de cierre previas. Son contratos para la implementación, no evidencia de que el software ya exista o haya sido probado. El repositorio aún no contiene código de aplicación.

| Área | Decisión | Condiciones de implementación |
|---|---|---|
| Runtime/API | Node.js 24+, TypeScript y **Fastify** | Usar Fastify; validar compatibilidad/versiones al crear `server/`. |
| Esquemas API | Zod / JSON Schema mediante `fastify-type-provider-zod` | Validar request/response y conservar un contrato coherente con Problem Details. |
| Plugins API | `@fastify/jwt`, `@fastify/cookie`, `@fastify/cors`, `@fastify/rate-limit` | Configurar explícitamente origins permitidos, cookies y límites; no habilitar CORS abierto. |
| Frontend | React, Vite, TypeScript, Tailwind CSS, Shadcn UI/Radix UI, TanStack Query y Zod | Cliente independiente en `client/`; consumir contratos versionados de la API. |
| Persistencia | PostgreSQL y Prisma ORM | Migraciones en `server/prisma/migrations/`; aplicar SQL de PostgreSQL cuando Prisma no represente la función requerida. |
| Contraseñas | Argon2id | Persistir solo hash; calibrar costo en entorno real; secretos nunca se registran. |
| Access token | JWT firmado con secreto del backend, validez de 15 minutos, enviado como `Authorization: Bearer <token>` | Guardar el access token solo en memoria del cliente (no `localStorage`/`sessionStorage`); secreto por entorno/gestor de secretos; validar emisor/audiencia/expiración. |
| Refresh token | 64 bytes aleatorios criptográficos codificados en hex (128 caracteres); validez de 7 días; cookie `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth` y `Secure` en producción | Transportar exclusivamente en cookie. Persistir solo SHA-256. En desarrollo HTTP, `Secure` se desactiva únicamente mediante configuración local explícita. Cambios con cookie deben validar `Origin`/`Referer` y aceptar solo origen permitido; `SameSite` no sustituye toda defensa CSRF. |
| Rotación/reutilización | `POST /api/v1/auth/refresh` revoca/consume el token anterior y emite nuevo par. Reutilizar token consumido/revocado alerta y revoca todas las sesiones del usuario | Persistir hashes consumidos/revocados el tiempo necesario para reconocer reutilización; modelar sesión/familia y rotación atómicamente para evitar carreras. No tratar cualquier token aleatorio desconocido como prueba concluyente de robo sin controles adicionales. |
| Logout | `POST /api/v1/auth/logout`; revocar la sesión en PostgreSQL, expirar la cookie mediante `Set-Cookie` con los mismos Path/atributos, y auditar logout/duración atómicamente | `Clear-Cookie` no es un encabezado HTTP estándar; eliminación práctica mediante `Set-Cookie` expirado. Revocación y audit log deben estar en una misma transacción; el access JWT de hasta 15 min debe rechazarse tras logout conforme al estado de revocación acordado. |
| Secretos SMTP | Leer `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` desde `process.env` o gestor de secretos | Prohibido valores reales en código, `.env.example`, imágenes Docker, repositorio o logs. `.env` local ignorado por Git; documentar nombres/rotación, nunca valores. La rotación operativa cambia el secreto en el gestor y reinicia/recarga el servicio según plataforma. |
| Diagnóstico SMTP | En arranque, ejecutar `transporter.verify()`. Si falla, no detener API; deshabilitar temporalmente envío y conservar respuesta genérica externa | Registrar alerta operacional sin credenciales/datos sensibles y exponer salud degradada a monitoreo administrativo. No afirmar al usuario que se envió el correo si el SMTP no está disponible. Reintento/recuperación del transportador debe ser operable. |
| Recuperación | Token criptográfico de 32 bytes en hex; persistir solo SHA-256; expira a los 15 minutos; un solo uso | Marcar consumo y cambiar hash Argon2id en operación transaccional; token nunca aparece en logs. Al restablecer contraseña, revocar todas las sesiones para forzar autenticación nueva. |
| Rate limit recuperación | Máximo 3 solicitudes por correo e IP cada hora | Aplicar límites por IP y por identidad de correo normalizada (ambos límites), con almacenamiento adecuado al despliegue; respuesta pública idéntica para no revelar cuenta. |
| Anti-enumeración | Para solicitud válida, inexistente o inactiva, responder HTTP 200 con mensaje genérico: “Si la dirección de correo ingresada corresponde a una cuenta registrada y activa, se ha enviado un correo con las instrucciones para restablecer su contraseña.” | Igualar forma/tiempo observable razonablemente; incluir respuestas a límite de tasa de manera consistente y no confirmar existencia. No enviar contraseñas temporales. |
| FTS PostgreSQL | Columna almacenada `publicaciones.busqueda_vector` de tipo `tsvector` con lexemas `spanish` para título/resumen/palabras clave y `english` para título/abstract; índice GIN `idx_publicaciones_fts` | Crear mediante migración SQL Prisma personalizada. Verificar tipo real de `palabras_clave` antes de construir la expresión; convertir arreglos a texto de forma determinista si aplica. |
| Consultas FTS | Consultas parametrizadas con Prisma `$queryRaw`, `websearch_to_tsquery`, paginación `LIMIT`/`OFFSET` | El contrato requiere español e inglés en una búsqueda. La consulta debe formar tsquery en ambos idiomas (o demostrar otra estrategia equivalente) y combinarla con el vector; no limitarse a `websearch_to_tsquery('spanish', ...)` para abstracts ingleses. Usar parámetros, revisar `EXPLAIN (ANALYZE, BUFFERS)` y medir ≤1,5 s con datos/condiciones representativas. Un GIN existente no prueba por sí solo rendimiento. |
| Archivos | PDF inicialmente, ClamAV y SHA-256 | Integrar controles de contenido/magic bytes, tamaño, sanitización y flujo seguro antes de habilitar cargas. |
| Reportes | PDFMake y ExcelJS | Dirección para módulos posteriores; no bloquea la primera entrega priorizada de autenticación/usuarios/menú. |
| Organización | Aplicación en `server/` y `client/`, con configuración y dependencias separadas | Compartir/documentar el contrato API (preferentemente OpenAPI generado desde backend); evitar contratos manuales divergentes. |
| API/errores | Prefijo `/api/v1` y RFC 7807 / Problem Details | Seguir los campos y códigos acordados en `AGENTS.md`; no inventar códigos sin documentarlos. |
| ADMIN inicial | Seed toma credenciales de variables de entorno | Sin valores predeterminados; operación segura e idempotente; no imprimir credenciales; documentar bootstrap y rotación. |

## Condiciones resueltas

1. Framework: Fastify.
2. Access JWT: 15 minutos; refresh aleatorio con hash SHA-256 persistido, cookie HttpOnly/Secure en producción/SameSite Strict/Path restringido, expiración 7 días, rotación y detección de reutilización.
3. Logout: revocación de sesión y auditoría atómicas; cookie expirada en respuesta.
4. Secretos y SMTP: solo entorno/secret manager; diagnóstico de arranque con modo degradado sin interrumpir API ni filtrar fallo a usuarios.
5. Recuperación: token de 32 bytes, hash persistido, 15 minutos, uso único, límites 3 por correo/IP por hora, HTTP 200 genérico y revocación de sesiones al reset.
6. FTS: migración SQL PostgreSQL con `tsvector` y GIN, consulta parametrizada desde Prisma y paginación.

## Precisiones que se verifican durante implementación

Estas precisiones no reabren las elecciones técnicas; convierten los requisitos acordados en una implementación segura y verificable:

- conservar historial de hashes refresh consumidos para poder detectar reutilización;
- usar defensa CSRF/origin para endpoints que aceptan cookies, además de SameSite;
- eliminar cookie con `Set-Cookie` expirado, ya que `Clear-Cookie` no es un encabezado HTTP estándar;
- implementar consulta bilingüe real: el ejemplo de tsquery únicamente español no satisface por sí solo búsqueda del abstract inglés;
- verificar tipo de `palabras_clave`, definición SQL de columna generada y uso efectivo de GIN;
- probar atomicidad, revocación, rate limits, anti-enumeración, fallos SMTP y rendimiento FTS en entorno representativo.
