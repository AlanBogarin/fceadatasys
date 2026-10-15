# Persistencia inicial

Este hito implementa usuarios, sesiones, rotación refresh, recuperación, límites de recuperación y auditoría. Publicaciones, autores, tutores, catálogos, parámetros, adjuntos y FTS se implementarán en sus migraciones posteriores; no existen tablas ficticias que permitan declararlos completos.

PostgreSQL 18 y Prisma 7 con `@prisma/adapter-pg`. El cliente Prisma usa nombres ingleses; las tablas y columnas PostgreSQL se mapean al español en `prisma/schema.prisma`. Todas las fechas son `timestamptz(3)` y la API las serializa UTC.

| Modelo Prisma | Tabla | Contrato |
| --- | --- | --- |
| User | usuarios | UUID, CI única, email/usuario con claves normalizadas únicas, rol, estado, Argon2id, contador y bloqueo |
| Session | sesiones | Usuario FK RESTRICT, creación, última interacción, vencimiento y revocación |
| RefreshToken | tokens_refresh | SHA-256 único, sesión FK RESTRICT, consumo/revocación y vencimiento |
| RecoveryToken | tokens_recuperacion | SHA-256 único, usuario FK RESTRICT, uso único y vencimiento |
| RecoveryRate | limites_recuperacion | Clave por identidad/IP, inicio de ventana y contador; actualización bajo bloqueo transaccional |
| AuditLog | auditoria | Actor/rol, operación/recurso, IP/User-Agent/sesión, estado/detalle y JSON antes/después |

`publicationId` es un UUID reservado en auditoría, sin FK hasta incorporar el modelo de publicaciones. Actor y sesión pueden ser nulos en intentos anónimos y eventos operacionales. No se almacenan contraseñas, tokens ni hashes sensibles en JSON de auditoría. El evento operacional de bootstrap es `USER_BOOTSTRAP`, recurso `usuarios`.

## Preparación y permisos

La aplicación **no** debe usar el usuario propietario/superusuario. El operador crea dos identidades distintas: propietario de migraciones y rol runtime `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` sin pertenencia al propietario. Definir contraseñas con el gestor de secretos o `\password` de psql; no escribirlas en SQL versionado. PostgreSQL debe usar SCRAM y una configuración `pg_hba.conf` restringida; `trust` se reserva para el cluster local efímero de pruebas.

1. Crear base vacía y usuario propietario fuera del proceso de aplicación.
2. Desde `server/`, instalar dependencias y generar el cliente: `npm ci`, `npm run db:generate`.
3. Inyectar `DATABASE_URL` del propietario para `npm run db:migrate`.
4. Con psql como propietario ejecutar `psql -v app_role=fceadatasys_app -f scripts/runtime-grants.sql`. El rol debe existir previamente. Repetir al incorporar tablas nuevas, revisando el alcance de permisos.
5. Cambiar `DATABASE_URL` al rol runtime antes de bootstrap y arranque; retirar credenciales de migraciones del entorno de aplicación.

El rol runtime tiene SELECT/INSERT/UPDATE sobre las cinco tablas operativas y SELECT/INSERT sobre auditoría. No recibe DELETE, TRUNCATE, DDL ni acceso a `_prisma_migrations`. Las FK conservan el historial; la API inactiva usuarios en lugar de borrarlos. La migración protege `auditoria` mediante triggers contra UPDATE/DELETE/TRUNCATE y revoca permisos públicos. Un superusuario/propietario podría alterar el esquema: restringir esas credenciales operacionalmente es parte del despliegue.

Las claves `emailKey` y `usernameKey` son NFKC, trim y minúsculas; la API y bootstrap las producen antes de insertar y son los únicos escritores autorizados funcionalmente. La base protege su unicidad, pero no recalcula esas claves: cualquier importación futura deberá reutilizar el mismo normalizador y validar su equivalencia antes de escribir. No sustituirlo por `lower()` de una base con locale diferente sin probar equivalencias Unicode. La CI admite 5–12 dígitos normalizados y es única. Las restricciones UNIQUE de PostgreSQL arbitran carreras. Los cambios que podrían dejar cero administradores activos comparten `pg_advisory_xact_lock(741901)` mediante `$executeRaw` (el retorno PostgreSQL `void` no puede deserializarse con `$queryRaw` del adaptador); login/refresh/reset aplican bloqueos de filas y actualizaciones condicionales para evitar consumo o incrementos dobles.

## Bootstrap

Inyectar `BOOTSTRAP_ADMIN_NAME`, `BOOTSTRAP_ADMIN_CI`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` y `DATABASE_URL`; ejecutar `npm run db:bootstrap`. No hay cuentas ni contraseña predeterminadas. Se usa la misma política de API: nombre hasta 100 caracteres, CI 5–12 dígitos, usuario ASCII 3–40 caracteres, email válido, contraseña 8–128 caracteres con letra y número.

Solo crea el primer usuario en una base vacía. Inserción y evento de auditoría ocurren en una transacción; fallo de auditoría revierte el alta. Una segunda ejecución con identidad idéntica y cuenta administradora activa no modifica contraseña/estado. Una identidad incompatible o base con otras cuentas se rechaza. Retirar las variables `BOOTSTRAP_ADMIN_*` después del alta. El script no imprime secretos, URLs ni objetos de error Prisma.

## Migraciones y recuperación

`prisma/migrations/` es el historial versionado. Usar `prisma migrate deploy` en despliegue; nunca `db push` contra datos institucionales. Tomar y verificar backup antes de cambios de esquema. La migración inicial prepara el schema `public` si falta y crea tipos, tablas, índices, constraints y triggers en una transacción; no depende de extensiones: Prisma genera UUID desde cliente.

`prisma/rollback-initial.sql` permite revertir el primer esquema únicamente en una base desechable o bajo una recuperación autorizada con backup verificado. Destruye datos; no es un procedimiento de operación habitual ni altera automáticamente `_prisma_migrations`. Para producción se restaura el backup o se crea una migración correctiva; para pruebas se recrea una base vacía. No borrar historia de auditoría para limpiar fixtures: ejecutar cada suite en base aislada y descartarla después.

Los tokens consumidos/revocados no se eliminan desde las rutas para conservar detección de reutilización. Queda pendiente definir retención institucional, limpieza operacional y copia/restauración programadas antes del despliegue de producción.

## Validación

`scripts/database-smoke.ts` valida en una base de pruebas ya migrada: permisos runtime, unicidad concurrente, inmutabilidad de auditoría, FK y rollback al fallar la escritura del audit log. Requiere `TEST_DATABASE_URL` runtime y `TEST_DATABASE_OWNER_URL` propietario apuntando a la misma base **de pruebas** y `ALLOW_DATABASE_TESTS=1`. No modifica bases existentes de la instalación PostgreSQL. Ver resultados efectivos en la entrega; la presencia del script no demuestra que haya pasado.

Ejecutar desde `server/` con esas variables inyectadas: `node --import tsx scripts/database-smoke.ts`. Por seguridad el script acepta únicamente host local y nombres `fceadatasys_*test`. Conserva fixtures para inspección y nunca borra auditoría.

Validación realizada el 15/10/2026: PostgreSQL 18.3, Prisma 7.10.0 y rol runtime limitado en cluster efímero con puerto propio. Schema Prisma válido, migración aplicada y estado al día, siete verificaciones del script aprobadas. Bootstrap produjo un usuario/un evento tras dos ejecuciones; al revocar INSERT de auditoría revirtió el alta y conservó cero usuarios/cero eventos. Rollback inicial sobre base desechable produjo cero tablas operativas y la reaplicación restauró el esquema y sus protecciones. Estas pruebas no validan backup institucional, retención ni infraestructura de producción.
