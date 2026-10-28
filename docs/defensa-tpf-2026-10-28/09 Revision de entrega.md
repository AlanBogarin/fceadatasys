# Revisión de entrega de FCEA-Datasys

Fecha de corte: 28/10/2026. Alcance: documentación y empaquetado para la defensa. Se conservaron las eliminaciones anteriores del árbol de trabajo y los manuales existentes. Se corrigió únicamente la maquetación del PDF de auditoría en server/src/auditing/routes.ts: el encabezado desplazaba el inicio del cuerpo y recortaba valores largos. Se restablecieron cursor, tamaño y color del cuerpo en cada página, incluidas continuaciones. No cambian contratos HTTP, permisos, datos ni migraciones.

## Entregables

Se prepararon la presentación de 18 diapositivas en PDF y PPTX, documento de proyecto y defensa en DOCX/PDF, Gantt en PDF/CSV, credenciales de demo, pasos de apertura, guion y este control. Se incorporaron los manuales existentes, exportando copias PDF coherentes con sus DOCX, los reportes reales de las dos transacciones, código, adjuntos y copias verificadas.

## Correspondencia con la rúbrica

| Criterio | Puntos | Evidencia y estado |
| --- | ---: | --- |
| Título y nombre | 4 | Portada y diapositiva 1. Preparado. |
| Objetivos | 10 | Documento, sección 1, diapositivas 4-5. Preparado. |
| Requerimientos funcionales | 10 | 16 funciones concretas en sección 2, diapositivas 6-7. Preparado. |
| Herramientas | 5 | Uso y justificación en sección 4, diapositiva 8. Preparado. |
| Gantt | 5 | Fechas, duración, dependencias y comparación. La referencia de planificación es estimada; no acredita un plan inicial aprobado. |
| Primera transacción | 15 | Registro de publicación. Código, formulario y pruebas existentes. Demostrar en vivo con datos únicos. |
| Segunda transacción | 15 | Alta de usuario. Código, formulario y pruebas existentes. Demostrar en vivo con datos únicos. |
| Reportes de ambas | 10 | Exportaciones PDF/XLSX desde la API real. T1: INV-00008. T2: auditoría filtrada por USUARIO_CREADO. Reexportar después de la demostración. |
| Backup manual | 6 | Copia local contrastada, índice y restauración nueva en clúster aislado. Preparado. |
| Backup automático | 7 | Tarea diaria Windows a las 02:00, última salida 0, archivo programado completo incluido con hash. Evidencias identificadas por origen. |
| Backup en nube | 8 | Descarga real, acceso solo de propietario y SHA-256 coincidente con local/auditoría. Preparado. |
| Defensa oral | 5 | Guion y notas. Ensayo y exposición a cargo del grupo. |

Total de la rúbrica: 100 puntos. Esta tabla documenta cobertura, no asigna una calificación.

## Verificación ejecutada

- Cliente: 115 pruebas aprobadas.
- Servidor, pruebas unitarias: 245 aprobadas.
- Despliegue y asistente: 22 aprobadas.
- Copias y restauración, pruebas sin servicios: 13 aprobadas.
- Total: 395 aprobadas, cero fallos y cero omisiones en esas suites. La ejecución inicial restringida de despliegue bloqueó sockets locales; la repetición con acceso a loopback pasó. No se ejecutó nuevamente toda la batería de integración.
- Demo iniciada sobre API real. Tres cuentas activas verificadas contra Argon2, sin cambiar contraseñas.
- Ocho adjuntos comprobados por tamaño y SHA-256.
- Dos reportes exportados por la API en PDF y XLSX, sin introducir datos de negocio nuevos.
- Copia de 93.829 bytes restaurada en clúster PostgreSQL 18 temporal: 3 usuarios, 8 publicaciones, 14 autores, 12 tutores y 8 adjuntos, sin publicaciones huérfanas de autor/tutor.
- Descarga real del mismo respaldo desde Google Drive: permiso de propietario y sin acceso público. Hash remoto igual al local y auditado.
- Tarea diaria vigente: consulta de Windows, última ejecución 28/10/2026 02:00:03, salida 0 y próxima 29/10/2026 02:00.
- PPTX: 18 diapositivas, integridad y geometría aprobadas por el validador y reimportación mediante Artifact Tool.
- PDF de auditoría: corrección del margen, repetición de las 245 pruebas unitarias, compilación y comprobación de tipos. Reporte real y caso extenso de varias páginas revisados mediante coordenadas de caracteres.

## Precisión de las evidencias de copias

La base actual procede de una restauración. Un registro en curso dentro del dump se marcó FALLIDO con motivo “Ejecución interrumpida por restauración de la base”. Esto no equivale al resultado de la última tarea de Windows. El archivo automático incluido se vincula a una fila PROGRAMADO/COMPLETO del historial recuperado; el resultado 0 del Programador se documenta de forma independiente. No se deben emparejar intentos diferentes solo por ser los más recientes.

Las pruebas de restauración y Drive de esta entrega son nuevas. Las evidencias con prefijo previa- son antecedentes del 27/10/2026 recuperados del historial Git, conservados con esa procedencia explícita.

## Pendientes del grupo y límites

- Incorporar el video de hasta tres minutos solicitado en la consigna general, si forma parte de esta entrega. Se proporciona guion, no video grabado.
- Elegir el integrante que subirá la entrega y ensayar la exposición y las operaciones con registros nuevos.
- Sustituir la referencia estimada del Gantt si existe el cronograma original. Los intervalos de ejecución reflejan hitos, no dedicación registrada.
- El reporte del alta de usuario es un reporte de auditoría de la operación. La interfaz no tiene un reporte general independiente de usuarios. Se declara esta elección expresamente.
- Para producción se requieren cuenta institucional de Drive, HTTPS, SMTP, permisos de carpetas, servicios disponibles y política de retención propia. La demo no acredita esas condiciones.
- Los dump de PostgreSQL no contienen los PDF. Se adjunta su copia separada, que debe mantenerse junto con la base compatible.

La rúbrica de defensa suministrada no exige nuevos diagramas UML. No se incorporaron dibujos UML genéricos ni se reutilizaron como si hubieran sido creados con el MCP. El Gantt es un gráfico de cronograma y conserva datos editables.
