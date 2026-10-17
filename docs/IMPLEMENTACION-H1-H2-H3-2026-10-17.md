# Implementación de H1, H2 y H3 — 17/10/2026

Se aplicaron las propuestas de la [revisión de preparación](REVISION-PREPARACION-INTEGRACION-2026-10-17.md). El cliente conserva el modo simulado; esta entrega corrige reglas y contratos para su conexión futura.

## H1: inactivación de catálogos con historia

El servidor distingue inactivación y eliminación física:

- Las relaciones de publicaciones activas impiden inactivar un catálogo.
- Si las publicaciones asociadas están inactivas, permite inactivar sin retirar las relaciones ni los metadatos históricos.
- DELETE conserva el veto de cualquier referencia, incluidas las publicaciones inactivas.
- Las dependencias de otros dominios siguen bloqueando ambas operaciones hasta definir su regla específica.

La inspección usa las FKs reales y mantiene el bloqueo del catálogo y la revalidación del actor. Las pruebas cubren autores, tutores, carreras, niveles, tipos y filiales, conservación de relaciones, exclusión de nuevas cargas y una publicación que confirma mientras la inactivación espera.

Archivos principales: `server/src/catalogs/store.ts`, `routes.ts` y `server/test/publications.integration.test.ts`. Contrato actualizado en [CATALOGS.md](../server/docs/CATALOGS.md).

## H2: vínculos de usuarios antes de inactivar

El servidor comprueba dentro de la transacción:

1. Publicaciones creadas por la cuenta, activas o inactivas.
2. Adjuntos propios en cualquier estado, incluidos rechazados y pendientes.
3. Participación en catálogos que aún existen, activos o inactivos.

La participación de catálogo se consulta en los eventos exitosos de creación, modificación, activación e inactivación que ya se guardan atómicamente en auditoría inmutable. Se une el actor/recurso/ID al registro existente. Esto conserva la historia de creadores y editores sin duplicarla en una nueva tabla ni recibir contadores del navegador.

Sesiones, accesos, cambios de perfil, operaciones rechazadas y otras bitácoras no bloquean por sí solos la inactivación. Un catálogo eliminado deja de ser esa dependencia de negocio; su historial sigue impidiendo eliminar físicamente al actor cuando corresponda.

La primera corrida de la nueva prueba concurrente detectó que una instantánea Serializable anterior a la espera podía omitir el evento recién confirmado: el escritor bloqueaba al usuario pero no actualizaba su fila. PATCH de usuarios ahora utiliza ReadCommitted con el mutex administrativo y los bloqueos existentes de actor/destino, conservando los reintentos de conflictos. Así relee los vínculos después de esperar; los demás usos de `withTransaction` mantienen Serializable por defecto.

Las pruebas comprueban documentos sin publicaciones, creadores y editores de catálogos inactivos, ausencia de veto por sesiones/rechazos, eliminación del catálogo, rollback de participación al fallar auditoría y la carrera entre edición e inactivación. La comprobación falla cerrada si no puede consultar las dependencias.

Archivos principales: `server/src/users/dependencies.ts`, `routes.ts`, `server/src/db.ts` y `server/test/users.integration.test.ts`. Contratos en [API.md](../server/docs/API.md) y [DATABASE.md](../server/docs/DATABASE.md).

## H3: reserva de adjuntos visible después de recargar

GET listado y GET detalle de adjuntos incluyen `reservedPublicationId: string | null`:

- UUID de la publicación original si existe una reserva y el actor puede verla.
- Null si no hay reserva o la publicación está fuera de su alcance.
- Administrador puede ver reservas de publicaciones inactivas; Digitador recibe el ID solo si la publicación está activa y el archivo pertenece al alcance de su consulta.

Un archivo reservado mantiene ese estado aunque no se entregue el ID por visibilidad; nunca se convierte en disponible por recibir null. El POST de carga conserva su respuesta básica. No se habilita descarga de archivos reservados, rechazados o pendientes ni reutilización en otra publicación. La vinculación vuelve a comprobar permisos, propiedad, seguridad y formato.

El cliente agrega el campo al DTO y al servicio simulado. `uploadedAttachmentFromDto` conserva la reserva al reconstruir el modelo de lectura; `selectableAttachments`, usado por el formulario, ofrece los disponibles y los reservados de la publicación editada según permisos. La pantalla de carga utiliza el mismo mapeo.

Las pruebas reconstruyen el estado desde el DTO sin historial local, recuperan el archivo para su publicación original, rechazan la reutilización ajena y comprueban omisión de reservas de publicaciones inactivas para Digitador. El backend verifica listado/detalle y restablecimiento mediante PATCH real con runtime limitado.

Contratos en [CLIENT-INTEGRATION.md](../server/docs/CLIENT-INTEGRATION.md), [ATTACHMENTS.md](../server/docs/ATTACHMENTS.md) y [adaptaciones del cliente](../client/docs/ADAPTACIONES-CLIENTE.md).

## Aplicación y reversión

No cambia el esquema Prisma, las migraciones ni los grants. H2 usa la auditoría inmutable existente, cuyos eventos ya identifican actor, operación y catálogo. El protocolo corresponde a escrituras auditadas de la API; no convierte importaciones SQL sin trazabilidad en participaciones verificadas.

Para desplegar estos cambios, compilar y actualizar el servidor; el cliente simulado conserva la demostración actual y el nuevo contrato. Las bases deben tener las migraciones y grants que ya exigía la versión anterior. Revertir el código recupera las reglas anteriores sin retirar registros históricos; no hay SQL de reversión adicional.

## Validación

Resultados finales:

- Cliente: `npm test`, **87 aprobadas**, sin fallos ni omisiones, con la regresión de reconstrucción/restablecimiento de reservas ampliada.
- Servidor: `npm test`, **348 aprobadas: 212 sin servicios y 136 PostgreSQL**, sin fallos ni omisiones. La corrida completa se repitió después de corregir la carrera H2; la primera corrida fallida no se presenta como aprobada.
- `client/npm run build`, `server/npm run build` y `server/npm run test:typecheck`: correctos sobre los cambios finales.
- Siete comprobaciones PostgreSQL de permisos, FK, unicidad, auditoría inmutable y rollback: aprobadas.
- `scripts/connection-smoke.ts`: aplicación/down/up de migraciones existentes, conservación de historia, guardas de reversión, límites, sesión única e inmutabilidad: aprobado.
- El sandbox bloqueó inicialmente el acceso TCP local; la corrida definitiva se ejecutó con acceso autorizado al clúster de pruebas `127.0.0.1:55439`. Quedó detenido al finalizar, con datos conservados.

El recorrido nuevo del cliente se validó por servicios/modelo; no se ejecutó una nueva prueba visual de navegador. La conexión real sigue siendo el hito futuro acordado.

Las comprobaciones se realizan con el clúster aislado de pruebas de `server/.tmp`, rol runtime limitado, bases exclusivas, almacenamiento temporal y ClamAV real habilitado para su suite. No se migra una base institucional ni se envían correos reales. Se conserva la advertencia de chunks grandes de ExcelJS del cliente y la advertencia conocida de consultas encoladas de `pg`.
