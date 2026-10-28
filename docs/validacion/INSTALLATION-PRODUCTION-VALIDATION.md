# Validación del asistente de producción — 26/10/2026

Actualización del transporte de Drive del 27/10/2026: [DRIVE-API-VALIDATION.md](DRIVE-API-VALIDATION.md). Los recuentos de esta página corresponden a la validación original del asistente.

Se revisó el lanzador existente, los perfiles y plantillas, la preparación de PostgreSQL, el aprovisionamiento inicial, los comandos de copias y la programación Windows/Linux. Se conservaron los cambios anteriores de permisos, auditoría y copias. El alcance de esta ampliación es el asistente y su integración con esas capacidades.

## Resultado

Producción propone `fceadatasys` y solicita datos del servicio PostgreSQL principal y credenciales administrativas, sin iniciar un clúster de producción dentro del proyecto. El cuestionario abarca web/TLS, cuentas, almacenamiento, antivirus, Administrador inicial, SMTP y todas las opciones de respaldo. Permite guardar solamente o aplicar la preparación.

Si existe la base, la ejecución interactiva ofrece conservar, recrear o cancelar. Recrear requiere copia local previa con índice comprobado, confirmación exacta, identidad sin cambios y ausencia de conexiones activas. No se fuerzan desconexiones. Sin interacción conserva. Las credenciales de roles existentes deben coincidir; no se restablecen ni se eliminan roles. Cambiar el nombre sugerido no migra automáticamente una base anterior.

El asistente integra la cuenta dedicada de lectura, autorización OAuth con la API de Google Drive, primera copia local/Drive, tarea diaria idempotente, horario y deshabilitación explícita de una tarea previa. Las conexiones administrativas y la contraseña inicial se retiran del archivo de despliegue tras una preparación exitosa. La API mantiene credenciales limitadas.

## Comprobaciones ejecutadas

| Comprobación | Resultado |
| --- | --- |
| `npm run test:deployment` | 21 aprobadas, sin fallos ni omisiones. |
| `npm run test:backups` | 3 aprobadas, sin fallos ni omisiones. |
| `npm run test:unit --prefix server` | 232 aprobadas, sin fallos ni omisiones. |
| `npm test --prefix client` | 115 aprobadas, sin fallos ni omisiones. |
| `npm run test:production-setup` | 9 aprobadas, sin fallos ni omisiones, con PostgreSQL y ClamAV reales. |
| Compilación cliente/API y generación Prisma | Aprobadas desde el lanzador completo de integración. |
| `npm run test:typecheck --prefix server` | Aprobada. |
| Sintaxis JavaScript y analizador PowerShell del instalador | Aprobados. |

Total de las suites enumeradas: **380 pruebas aprobadas**.

La integración crea un clúster temporal con puerto asignado, separado del servicio principal. Ejecuta el lanzador completo de producción con TLS de prueba, aplica las nueve migraciones, crea un único Administrador, comprueba el retiro de secretos iniciales y verifica roles limitados. Crea una tabla después de configurar el lector y comprueba lectura y rechazo de escritura. Conserva el identificador y datos al repetir la preparación; rechaza contraseña incorrecta antes de ofrecer eliminación, fallo de copia, confirmación incorrecta y conexiones activas. Finalmente recrea la base del clúster temporal y restaura el respaldo en otra base aislada, comprobando el dato previo. El clúster se detuvo y su directorio temporal se eliminó al finalizar.

## Límites de esta validación

No se modificó el PostgreSQL principal, no se autorizó una cuenta real de Google Drive ni se registraron tareas reales de Windows/Linux. El cuestionario y las decisiones de integración de copias se prueban con funciones sustitutas; la prueba de PostgreSQL utiliza pg_dump/pg_restore reales. La programación se valida mediante pruebas de generación/idempotencia y análisis sintáctico PowerShell. La autorización OAuth, permisos de la cuenta del sistema operativo y primera copia real se completan en el servidor destino.

La instalación de paquetes del SO, DNS/firewall, emisión/renovación TLS, servicio permanente de la aplicación, ACL, retención, respaldo de adjuntos y ensayos institucionales de recuperación quedan descritos en [INSTALLATION-PRODUCTION.md](../operacion/INSTALLATION-PRODUCTION.md). No hay fallos conocidos en las comprobaciones enumeradas.
