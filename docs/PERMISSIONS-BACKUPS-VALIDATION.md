# Validación de permisos, auditoría y copias — 26/10/2026

Se inspeccionaron el contrato maestro, estado Git inicial limpio, Fastify/Prisma/PostgreSQL, autenticación y confirmación, rutas protegidas, modelo de sesiones, cliente React, auditoría y lanzador Windows/Linux. El usuario autorizó expresamente actualizar `AGENTS.md` para reflejar permisos configurables.

## Cambios y contratos

- Política persistida por rol con excepciones por cuenta; defaults compatibles, revocación en sesión, controles en servidor y UI, protección del último gestor y de cuentas superiores. Política y auditoría se confirman juntas. ETag canónico evita falsos conflictos por orden de claves JSONB.
- Auditoría distingue Nombre completo/Usuario y muestra estructuras, booleanos y colecciones en forma legible; JSON y raw siguen disponibles como opciones técnicas.
- Copias locales custom de PostgreSQL y subida a Drive mediante rclone, verificación del índice y checksum, ejecución manual con historial, exclusión entre procesos, estados completo/parcial/fallido, tareas diarias idempotentes Windows/Linux y horario configurable.
- Dos migraciones, SQL de reversión y grants runtime. Contratos ampliados en `server/docs/API.md` y `server/docs/DATABASE.md`. Operación y configuración en `BACKUPS.md`; reglas de acceso en `PERMISSIONS.md`.

## Resultados

| Verificación | Resultado |
| --- | --- |
| Servidor, pruebas sin servicios | 232 aprobadas, 0 fallos/omitidas |
| Cliente | 115 aprobadas, 0 fallos/omitidas |
| Regresión PostgreSQL anterior | 136 aprobadas, 0 fallos/omitidas; ClamAV real habilitado |
| Nueva integración de permisos y copias | 1 escenario integrado aprobado, sin omisión |
| Gateway/despliegue | 8 aprobadas |
| Programación de copias | 3 aprobadas |
| Compilaciones cliente/servidor y tipos de pruebas | Aprobadas |
| Migraciones y grants en clúster nuevo | Aplicados y comprobados con rol limitado |
| SQL de reversión | Ejecutado en base desechable |
| PowerShell | Análisis sintáctico del instalador aprobado |
| Programador | Dry run con 23:30 en America/Asuncion; sin registrar una tarea real |
| Navegador | Login, roles/permisos, detalle amigable, JSON/raw, pantalla de copias sin configurar y logout verificados |

La nueva integración ejercitó concesión de catálogo a Digitador, excepciones de Administrador, revocación inmediata, rechazo de escalación, último gestor, conflicto de versión, rollback real al fallar auditoría, pg_dump/pg_restore reales, exclusión de ejecución manual/programada e historial. Los tests sin servicios cubren fallo de nube/checksum preservando local, rechazo al fallar auditoría y pérdida del bloqueo. Se utilizaron bases clonadas en un clúster aislado del proyecto, sin modificar las bases demo/producción existentes. Las firmas locales de ClamAV estaban vencidas y se actualizaron con el script existente antes de aprobar la regresión.

## Límites operativos

Google Drive se sustituyó en las pruebas: no se autorizó ni probó una cuenta real. No se instaló una tarea real de Windows ni un crontab en Linux. La activación requiere elegir carpeta privada, credenciales de lectura PostgreSQL, autorizar Drive mediante rclone y ejecutar el instalador con el horario deseado. No se acredita restauración institucional completa ni copia de los adjuntos; la guía describe cómo ensayar una restauración en una base nueva y preservar los archivos de Biblioteca.

No hay errores conocidos pendientes en las validaciones enumeradas. La compensación de efectos externos ante un fallo de auditoría depende de que disco y proveedor sigan accesibles; se documenta el procedimiento de revisión. No se publicaron cambios ni se registraron tareas con credenciales de ejemplo.
