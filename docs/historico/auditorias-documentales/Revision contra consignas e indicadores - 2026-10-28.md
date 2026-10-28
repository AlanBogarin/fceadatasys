# Revisión de FCEA-Datasys contra las consignas e indicadores

**Registro histórico.** Conserva el alcance y los resultados de su fecha original. Las menciones al simulador, tareas pendientes, ZIP y rutas de versiones anteriores no describen la distribución vigente. Consultar el [índice técnico actual](../../README.md) y el índice Word de Proyecto. La presentación evaluada aquí es la defensa rediseñada anterior; la presentación oficial posterior fue elegida por el usuario. Los PDF equivalentes retirados se enlazan a sus fuentes editables conservadas.

Fecha de corte: 28 de octubre de 2026. Repositorio inspeccionado: `9a4835d`.

## Dictamen

**La presentación cubre los temas de la defensa, pero la entrega todavía no acredita el cumplimiento completo de las consignas.** El documento actual del proyecto es una síntesis para la defensa y necesita convertirse en el informe final exigido. Los manuales actualizados contienen la estructura general solicitada y no necesitan rehacerse desde cero. Faltan el video terminado y partes importantes de análisis, diseño y documentación contractual.

Esta revisión sustituye cualquier interpretación anterior de «preparado» que pudiera entenderse como conformidad integral con el esquema del informe. Preparar archivos para exponer y cumplir todos los apartados académicos son verificaciones distintas.

Se aplicó la metodología de la habilidad gauntlet a la auditoría, según la solicitud del usuario: criterios observables, contraste inicial, crítica con evidencia y revisión de los hallazgos. No se generó un prompt. Se corrigieron conclusiones demasiado amplias durante la revisión: existen UML históricos, existen reportes de las dos operaciones y existe evidencia histórica de envío a Drive; ninguno de esos hechos basta por sí solo para declarar terminada toda la entrega.

No se modificaron la presentación, los manuales, el software, la base de datos ni el ZIP. El único entregable nuevo es este informe. No se ejecutaron nuevamente las 395 pruebas ni se realizaron operaciones de negocio o respaldos durante esta auditoría.

## Fuentes y versiones revisadas

| Referencia | Archivo | Uso |
| --- | --- | --- |
| N1 | [TP - TPF-IS1-2026.pdf](<../../../../Referencias/TP - TPF-IS1-2026.pdf>) | P. 1: entregables. P. 3: caso del repositorio. P. 7-8: esquema obligatorio. P. 9: diccionario de datos. |
| N2 | [TPF - Evaluacion.pdf](<../../../../Referencias/TPF - Evaluacion.pdf>) | Los 12 criterios de defensa, con un máximo total de 100 puntos. |
| N3 | [TPF - 3er avance - Indicadores.pdf](<../../../../Referencias/TPF - 3er avance - Indicadores.pdf>) | P. 1: partes generales de un manual y cinco aspectos del desarrollo del Manual de Usuario. |
| N4 | [TP - Guia para ingenieria del sootware.docx](<../../../../Referencias/TP - Guia para ingenieria del sootware.docx>) | Imagen incrustada del esquema hasta el apartado 11.5. Se inspeccionó la imagen, además del texto de N1. |
| P | [Presentación rediseñada, PowerPoint](<../../../../Historico/Defensas/01 Presentacion de la defensa - redisenada.pptx>) y su PPTX | 18 diapositivas. Es la versión usada para este dictamen, no la presentación anterior que permanece en la carpeta. |
| D | [Documento del proyecto y defensa, Word](<../../../../TPF - Documento del proyecto y defensa.docx>) y su DOCX | 14 páginas. Portada y once secciones principales. |
| U | [Manual de usuario actualizado, Word](<../../../../TPF - Manual de usuario.docx>) y su DOCX | 56 páginas, 50 figuras y 11 tablas. DOCX idéntico al de `docs/manuales-2026-10-28/`. |
| S | [Manual de seguridad actualizado, Word](<../../../../TPF - Manual de seguridad.docx>) y su DOCX | 25 páginas. DOCX idéntico al de `docs/manuales-2026-10-28/`. |
| A1 | [Primer avance](<../../../../TPF - 1er avance.docx>) | Institución, visión, misión, estructura textual, problema, objetivos, entrevistas y requerimientos históricos. |
| A2 | [Segundo avance](<../../../../TPF - 2do avance.docx>) | Casos de uso y sus especificaciones, un diagrama de clases y diagramas de actividades. |
| A3 | [Entrevista](<../../../../Anexos/Relevamiento/Entrevista.docx>) | Fuente del alcance bibliográfico y de la aprobación académica externa. |
| A4 | [Manual del tercer avance](<../../../../Historico/Avances entregados/TPF - 3er avance - Manual de usuario.docx>) | Antecedente histórico. Contiene módulos descritos como «en construcción» y no debe sustituir al manual actualizado. |
| T | [AGENTS.md](<../../../AGENTS.md>), [schema.prisma](<../../../server/prisma/schema.prisma>), navegación y contratos | Contraste con el alcance y la implementación actual. El esquema y las migraciones no sustituyen al diccionario académico. |
| E | [Carpeta de evidencias](<../../../../Anexos/Evidencias>) | Reportes, restauración, tarea programada, nube y verificaciones archivadas. |

Las páginas citadas en este informe son las páginas físicas del PDF. Los manuales numeran su cuerpo desde la tercera página física.

## 1. Presentación frente a la rúbrica de defensa

«Cumple contenido» significa que el material está presente y es coherente. «Parcial» identifica un aspecto concreto pendiente. «Demostración pendiente» significa que una diapositiva o un resultado archivado no permiten evaluar por sí solos la ejecución en vivo. No se asigna una nota anticipada.

| Indicador N2 | Máximo | Evidencia en P | Dictamen y mejora necesaria |
| --- | ---: | --- | --- |
| 1. Título del proyecto y nombre del software | 4 | Diap. 1 y 18 | **Cumple contenido.** El título y FCEA-Datasys identifican el catálogo y su institución. |
| 2. Objetivo general y específicos | 10 | Diap. 4-5 | **Cumple contenido.** Son coherentes con consulta, registro, control de acceso, reportes y recuperación. La síntesis de cinco grupos remite a siete objetivos completos en D. |
| 3. Requerimientos funcionales | 10 | Diap. 6-7 y procesos 10-16 | **Cumple como síntesis.** Se reconocen operaciones concretas. Para facilitar preguntas, conviene vincular esta síntesis con los 16 RF de D, sin agregar todos a las diapositivas. |
| 4. Herramientas de desarrollo | 5 | Diap. 8 | **Parcial para el nivel excelente.** Identifica herramientas y función, pero falta explicar expresamente por qué se eligieron. D, p. 6, ya contiene una columna de justificación aprovechable. |
| 5. Gantt | 5 | Diap. 9; D, p. 7-8; cronograma PDF/CSV | **Parcial.** Hay tareas, fechas y barras, y el CSV incluye duración y dependencia. La planificación es retrospectiva estimada, no un plan original contrastable. Hacer visibles duración y secuencia y explicar la variación. Si existe el plan original, incorporarlo; si no, conservar la aclaración actual. |
| 6. Primera transacción | 15 | Diap. 10: registro de publicación | **Demostración pendiente.** La captura muestra el formulario y el recorrido resumido. Para acreditar el criterio completo hay que crear un registro, verificar persistencia y mostrar al menos un rechazo sin datos parciales. D, p. 9, ya describe ese ensayo. |
| 7. Segunda transacción | 15 | Diap. 11: alta de usuario | **Demostración pendiente.** Falta observar el alta completa, validaciones, cuenta persistida y rechazo de duplicado. D, p. 10, propone un procedimiento adecuado. |
| 8. Reportes de ambas transacciones | 10 | Diap. 12; dos PDF y dos XLSX en `Reportes/` | **Material disponible; correlación de la defensa pendiente.** Existen exportaciones de la API para INV-00008 y dos altas demo. Durante la defensa deben coincidir con los registros que se creen en esa demostración. El segundo reporte es auditoría filtrada por `USUARIO_CREADO`, circunstancia que debe explicarse. |
| 9. Backup manual y restauración | 6 | Diap. 14; `restauracion-actual.json` | **Respaldo documental disponible; demostración pendiente.** La evidencia archivada registra una restauración aislada aprobada. La diapositiva debe identificar el dump concreto y su hash y acompañar la generación del respaldo y la restauración de prueba. Los conteos no sustituyen esas operaciones. |
| 10. Backup automático local | 7 | Diap. 15; `programacion-vigente.json`; `backup-automatico-actual.json` | **Parcial.** Se muestra horario y salida 0, y existe una copia PROGRAMADO/COMPLETO. Son evidencias de intentos distintos. Presentar una misma ejecución identificable desde la tarea hasta el archivo, con fecha/hora y hash. No atribuir el dump incluido a la última tarea por aproximación. |
| 11. Backup en nube | 8 | Diap. 16; `recuperacion-drive-actual.json`; antecedente de validación Drive | **Parcial en la presentación.** Recuperación, acceso restringido y coincidencia de hash están documentados. El envío real está descrito como antecedente del 27/10 en `docs/DRIVE-API-VALIDATION.md`; conviene mostrar también la subida y su identificador remoto, no solamente la descarga de un archivo existente. |
| 12. Presentación y defensa oral | 5 | Orden de 18 diapositivas y guion | **No verificable documentalmente.** El orden y el diseño sirven de apoyo, pero dominio, exposición y respuestas requieren observar al grupo. |

La rúbrica no prohíbe usar un alta de usuario como segunda transacción ni exige un reporte general independiente de usuarios. No se justifica cambiar esa elección únicamente por preferencia. Debe explicarse qué datos y evento de auditoría confirma la operación y cómo el reporte identifica esa alta.

Los UML, el contrato y el diccionario son requisitos del **informe final N1**, no apartados obligatorios de las diapositivas de N2. No hace falta convertir la presentación en una proyección de todo el informe para resolver esas omisiones.

## 2. Informe/especificación frente al esquema obligatorio

Documento evaluado: D. Encontrar un apartado en A1 o A2 permite reutilizarlo, pero no equivale a que esté incluido en el informe final del ZIP. Tampoco es necesario crear un archivo independiente por cada apartado: pueden integrarse en el informe y sus anexos.

| Apartado exigido en N1, p. 7-8 | Estado de D | Evidencia y acción |
| --- | --- | --- |
| Portada | Cumple | P. 1: institución, proyecto, software, docentes, integrantes, lugar y fecha. |
| Índice de contenido | Falta | El cuerpo comienza en p. 2. Crear índice del informe final. |
| Índice de figuras | Falta | No está incluido. Incorporar títulos y páginas de las figuras definitivas. |
| Índice de tablas | Falta | Hay ocho tablas en DOCX, sin índice de tablas. |
| Introducción | Falta como apartado | Redactar introducción académica y ubicarla antes del capítulo 1. El propósito de defensa no desarrolla esa sección. |
| 1. Título del proyecto | Cumple contenido | Está en portada. Conservarlo en el apartado requerido. |
| 2. Nombre del software | Cumple contenido | FCEA-Datasys en portada. |
| 3. Estructura de la institución/área | Parcial | D explica responsables operativos, pero no desarrolla la estructura institucional. Reutilizar A1 previa revisión. |
| 3.1. Datos de la institución | Parcial | Portada identifica institución; A1 aporta datos adicionales. Integrarlos con su fuente. |
| 3.2. Descripción del área | Cumple contenido | Sección 1, p. 2. Reorganizar en el esquema. |
| 3.3. Visión | Falta | Existe en A1, apartado 3.3. Incorporar y conservar procedencia institucional. |
| 3.4. Misión | Falta | Existe en A1, apartado 3.4. Incorporar y conservar procedencia institucional. |
| 4. Organigrama | Falta | A1 contiene una jerarquía textual. Preparar el organigrama legible y distinguir estructura institucional de roles del software. |
| 5. Planteamiento del problema | Cumple contenido | Sección 1, p. 2. |
| 6. Descripción del área a informatizar | Cumple contenido | Sección 1, p. 2, y alcance operativo. |
| 7. Objetivos; 7.1. General; 7.2. Específicos | Cumple contenido | Sección 1, p. 2. Reubicar con la numeración solicitada. |
| 8. Entrevistas realizadas | Falta | A1 resume la entrevista y A3 conserva contenido. Incorporar preguntas/respuestas, identificación y alcance, sin inventar fecha o validaciones no documentadas. |
| 9. Metodologías aplicadas | Falta | No hay desarrollo equivalente. |
| 9.1. Investigación | Falta | Explicar la técnica efectivamente aplicada y su evidencia de relevamiento. |
| 9.2. Programación | Falta | Documentar la forma real de desarrollo. No declarar Scrum u otra metodología sin sustento. |
| 9.3. Análisis y diseño | Falta | Explicar modelado, especificación y cómo guiaron el desarrollo. |
| 10. Modelo de ciclo de desarrollo | Falta | Describir el ciclo realmente seguido y relacionarlo con los avances/hitos. |
| 11. Análisis y especificación de requerimientos | Parcial | D tiene una síntesis funcional y reglas. Falta consolidar el análisis con estructura y trazabilidad. |
| 11.1. Definición de requerimientos | Parcial | A1 contiene DR-01 a DR-06; D no los desarrolla como apartado. Reconciliar con el alcance actual. |
| 11.2. Especificación de requerimientos | Parcial | Hay 16 RF y reglas, pero no una especificación consolidada en este apartado. Actualizar ER históricos de A1. |
| 11.3. Especificación de software | Parcial | D explica arquitectura y procesos; A1 conserva ES históricos. Integrar módulos, entradas, salidas, validaciones y límites actuales. |
| 11.4. Requerimientos funcionales | Cumple contenido | Sección 2, p. 3-4: RF01 a RF16. Unificar identificadores con el resto de documentos. |
| 11.5. Requerimientos no funcionales | Parcial | P. 5 incluye cualidades, integridad, acceso y objetivo de búsqueda. Convertirlos en una lista explícita con criterios verificables y límites declarados. |
| 11.6. Mínimos de hardware, software y red | Parcial | Versiones y prerrequisitos de software están en p. 13. Falta dimensionamiento mínimo de hardware y red para un escenario definido. U, p. 5, reconoce que no hay mínimos oficiales medidos. |
| 12. Herramientas de desarrollo | Cumple contenido | Sección 4, p. 6: uso y justificación. |
| 13. Contrato de prestación de servicios | Falta | No se localizó contrato en los documentos revisados ni en el paquete final. Prepararlo sin inventar partes, acuerdos o firmas. |
| 14. Cronograma/Gantt | Parcial | Sección 5, p. 7-8 y archivos separados. La limitación de la planificación estimada debe permanecer expresa. |
| 15. Diagramas UML | Falta en D | Su única imagen es el Gantt. A2 no se integra en el ZIP como informe ni completa los ocho tipos. |
| 15.1. Casos de uso | Falta en D | A2 contiene diagramas de este tipo. Actualizar y construir el conjunto coherente con el proceso seleccionado. |
| 15.1.1. Especificación de casos de uso | Parcial | Secciones 6-7 describen actores y pasos. A2 contiene precondiciones, alternativos y postcondiciones aprovechables, con reglas que deben actualizarse. |
| 15.2. Clases | Falta en D | Existe una imagen en A2, con diferencias materiales respecto del modelo actual. |
| 15.3. Objetos | No localizado | Crear para el requerimiento seleccionado. |
| 15.4. Actividades | Falta en D | A2 incluye diagramas de actividades de varios procesos. Rehacer/actualizar el del requerimiento seleccionado. |
| 15.5. Estados | No localizado | Crear para el mismo requerimiento. |
| 15.6. Secuencia | No localizado | Crear para el mismo requerimiento. |
| 15.7. Componentes | No localizado | Crear y vincular con la implementación que soporta ese proceso. |
| 15.8. Colaboración | No localizado | Crear las interacciones del mismo proceso. |
| Coherencia entre todos los UML | No acreditada | N1 exige que los ocho correspondan al mismo requerimiento. No basta agrupar imágenes de procesos distintos. |
| 16. Diseño de datos | Falta | Los archivos técnicos existen en el software, pero no está desarrollado el capítulo académico. |
| 16.1. E/R de base de datos | No localizado como entregable formal | Crear desde el modelo real, incluyendo Autor y las relaciones N:M con publicaciones y tutores. Un diagrama de clases no sustituye automáticamente al E/R. |
| 16.2. Diccionario de datos | No localizado como entregable formal | Crear con las ocho columnas de N1, p. 9: tabla, campo, descripción, tipo de dato, longitud, clave, obligatorio y relaciones. Contrastar también restricciones SQL de las migraciones. |
| 17. Manual del usuario | Disponible, integración parcial | U existe en DOCX/PDF. Crear referencia expresa al documento/anexo en el capítulo 17 del informe final. |
| 18. Manual de seguridad | Disponible, integración parcial | S existe en DOCX/PDF. Crear referencia expresa en el capítulo 18. |
| Conclusión | Falta | D termina con fuentes y matriz de defensa, sin conclusión del proyecto. |
| Bibliografía | Parcial | Sección 11 contiene fuentes. Reorganizarla como bibliografía e incluir las consignas, entrevista y fuentes del contenido institucional. No se exige aquí un estilo bibliográfico no indicado por la consigna. |

### Diferencias concretas que impiden reutilizar los avances sin revisión

1. **A1, bloque de entrevista sobre metadatos:** reproduce «menos de 300 palabras» y tesauros. El contrato actual permite hasta el límite inclusive y palabras clave manuales. Conservar la entrevista como evidencia original y explicar la decisión consolidada; no alterar retrospectivamente la respuesta entrevistada.
2. **A2, diagrama de clases bajo el título homónimo:** representa IDs `Long`, una tabla `UsuarioRol`, estados `BORRADOR/PUBLICADO/ARCHIVADO` y una clase `Asignatura` con `calificacion`. El modelo actual usa UUID para esas entidades, rol como enum/política efectiva y publicaciones activas/inactivas. `Asignatura` y calificaciones no pertenecen al alcance definido. El diagrama tampoco desarrolla la entidad independiente Autor que requiere el contrato actual.
3. **A2, caso de uso 8, exportación de auditoría:** describe formatos PDF/CSV. El producto y los entregables actuales utilizan PDF/Excel.
4. **A2, caso de uso 9:** presenta el tiempo de expiración como parámetro editable. U y la ventana actual indican que la política de sesión es informativa en ese formulario.
5. **A4, sección «Secciones en construcción»:** dice que catálogo, búsqueda, archivos, parámetros y auditoría no funcionan. Esto contradice la versión conectada y los manuales actualizados. Ese documento debe quedar identificado como antecedente.
6. **Identificadores de RF:** D usa RF01 para acceso y sesiones y RF02 para cuentas; U usa RF 01 para acceso y RF 02 para consulta del catálogo. A1 usa otra organización. No son códigos de error API, pero falta un mapeo documental para evitar citar un mismo identificador con significados diferentes.

**Restricción del usuario para el trabajo posterior:** los nuevos UML deben crearse con el MCP de Visual Paradigm. No se debe entregar como solución un diagrama genérico de los archivos fuente ni atribuir a Visual Paradigm las imágenes históricas sin evidencia de procedencia. En esta revisión no se creó ningún diagrama. No hay una herramienta MCP de Visual Paradigm disponible en esta sesión; esa disponibilidad será una dependencia de la etapa de creación.

## 3. Manual de Usuario frente a los indicadores

N1 exige el manual como entregable y N3 define su estructura y contenido. No corresponde exigir dentro de cada manual los 18 capítulos del informe del proyecto.

| Indicador N3 | Evidencia en U | Dictamen |
| --- | --- | --- |
| Portada con software, tipo de manual, autores, mes/año y ciudad/país | P. 1 | Cumple. |
| Índice | P. 2 | Cumple. |
| Introducción | P. 3 | Cumple. |
| Desarrollo | P. 3-55 | Cumple. |
| Conclusión | P. 55-56 | Cumple. |
| Fuentes de consulta | P. 56 | Cumple presencia. Mejorar la referencia a las consignas que sustentan políticas declaradas. |
| 1. Planteamiento del problema | P. 3 | Cumple. |
| 2. Objetivo general y específicos | P. 3 | Cumple. |
| 3. Funcionales, no funcionales, implementación, hardware/software y red | P. 4-5 | Cumple las categorías. El hardware es cualitativo: completar su dimensionamiento en el informe y remitirlo desde el manual. |
| 4. Ejecución, nombre e ícono/ubicación | P. 5-6 | Cumple la adaptación a una aplicación web. Explica el navegador, URL y ausencia de un ejecutable/ícono propio instalado. No hay que inventar un acceso directo inexistente. |
| 5. Login, principal, menús y ventanas, imágenes y operación | P. 6-54, figuras 1-50 | Cobertura de las ventanas principales actuales, contrastada con `ApiApp.tsx` y `navigation.ts`. Incluye catálogos, publicaciones, usuarios, permisos, parámetros, informes, auditoría, copias, perfil y contraseña. |
| Tipos y rangos de campos | Tablas 5-9 y explicación de parámetros/archivos | Cumple en los formularios principales. Incluye límites, obligatoriedad, unicidad, referencias y modalidad documental. |
| Función de botones y teclas | Recorridos de cada módulo y «Teclado y controles comunes» | Cumple. Explica guardar/cancelar/confirmar, paginación y atajos; declara que no hay F1-F12 propias. |

**Resultado:** cumple la estructura y tiene contenido operativo suficiente para los indicadores revisados. Esto no certifica que cada frase y cada estado transitorio de la interfaz hayan sido probados nuevamente. No se identificó una razón estructural para crear otro Manual de Usuario.

## 4. Manual de Seguridad

S tiene portada (p. 1), índice (p. 2), introducción y desarrollo (desde p. 3), conclusión (p. 24) y fuentes (p. 24-25). Su desarrollo trata responsables y activos, infraestructura, antimalware, acceso, criptografía, permisos, auditoría, copias, restauración, alertas e incidentes.

**Cumple la estructura general de un manual.** N1 exige su existencia, pero los documentos normativos suministrados no contienen una rúbrica técnica específica del Manual de Seguridad equivalente a los cinco aspectos del Manual de Usuario. No se puede certificar conformidad con una rúbrica adicional no aportada ni una implementación institucional de todos los controles por leer el documento.

Mejoras localizadas para ambos manuales:

- **Fuente de la política de contraseña:** U (apartado de recuperación) y S, p. 8, atribuyen a «la consigna» una composición de dos mayúsculas, dos minúsculas, dos números y dos símbolos. Esa condición no aparece en N1, N2 o N3 revisados. Citar la instrucción académica concreta si existe o presentarla como política propuesta/institucional, sin atribución no trazable. Ambos manuales sí declaran correctamente que el código actual exige 8-128 caracteres, letra ASCII y número. La auditoría no convierte esa diferencia en un incumplimiento demostrado de estos tres PDF.
- **Mínimos de infraestructura:** completar o referenciar un dimensionamiento para volumen y concurrencia definidos. No inventar valores medidos ni afirmar que el rendimiento observado se mantiene en cualquier equipo.
- **Trazabilidad de requerimientos:** unificar los RF del informe y del manual o incluir una tabla de equivalencias.
- **Referencias históricas:** mantener fecha/versión y condición de antecedente. Las rutas a documentos eliminados son referencias históricas, no evidencia disponible dentro del ZIP actual.

## 5. Entregables generales y paquete

| Exigencia de N1, p. 1 | Resultado |
| --- | --- |
| Software y código fuente | ZIP de código presente. Esta auditoría no vuelve a certificar toda su funcionalidad. |
| Base con registros para pruebas | Dumps y datos demo presentes. Hay evidencia archivada de restauración. |
| Video promocional/demostrativo de máximo 3 minutos | **Falta.** No se localizaron videos en los archivos de proyecto revisados ni en el ZIP. `06 Guion de defensa.txt` es un guion, no la grabación. |
| Informe del proyecto DOCX/PDF | Formatos presentes, contenido todavía incompleto respecto del esquema de p. 7-8. |
| Manual de Usuario DOCX/PDF | Presente y estructuralmente conforme con N3. |
| Presentación PPTX/PDF | Presente la versión rediseñada de 18 diapositivas en el ZIP. |
| Backup y texto con cuentas/contraseñas de prueba | Presentes. No se reproducen contraseñas en este informe. |
| Todo en un único comprimido | ZIP presente y legible, pero incompleto por el video y el informe formal pendiente. |
| Informe y Manual de Usuario impresos y anillados | **No verificable con los archivos.** Debe comprobarlo el grupo antes de la entrega física. |

Se verificaron las 51 entradas del manifiesto contra los archivos y contra el ZIP: sin diferencias de hash. El ZIP pasó la comprobación CRC. Esto verifica integridad de archivos, no cumplimiento académico de su contenido. El ZIP contiene los tres DOCX de defensa/manuales, no los avances A1/A2 ni una especificación final que los consolide.

**Corrección necesaria en la lista de entrega:** N1, p. 1, incluye expresamente el video. En una entrega evaluada contra esta consigna no debe tratarse como opcional mediante frases como «si forma parte de esta entrega». Esa redacción aparece en el material de preparación y debe actualizarse al incorporar el video.

## 6. Diferencia de alcance que requiere respaldo documental

N1, p. 3, describe un repositorio con revisión, solicitud de correcciones, aprobación/rechazo dentro del proceso. A3 y el contrato maestro definen un catálogo que registra trabajos **ya aprobados fuera del software**. También hay diferencias entre el caso base y los metadatos consolidados, como línea/área temática y fecha de presentación.

La implementación y los documentos actuales deben seguir el contrato maestro. No se recomienda agregar un flujo de aprobación académica al software. La mejora es documental: incorporar el relevamiento, la comparación de alcance y las decisiones que explican la adaptación del caso, con conformidad del docente o responsable si no existe ya. **La existencia de AGENTS.md no acredita por sí sola aceptación académica de la adaptación.** Es un riesgo de evaluación pendiente de evidencia, no un fallo de implementación demostrado por esta auditoría.

## 7. Qué crear o mejorar, por prioridad

| Prioridad | Documento/entregable | Trabajo concreto | Condición de cierre |
| --- | --- | --- | --- |
| Alta | Informe final / especificación consolidada DOCX y PDF | Reestructurar D con todos los apartados de N1; integrar A1, A2 y entrevista, reconciliados con T. Añadir índices, introducción y conclusión. | Los capítulos 1-18 y preliminares/finales tienen contenido localizable, actual y trazable. |
| Alta | Capítulo/anexo UML | Crear los ocho tipos y la especificación del caso de uso sobre un mismo requerimiento, por ejemplo «Registrar publicación». Usar el MCP de Visual Paradigm. | Consistencia de actores, datos, operaciones y estados entre diagramas, especificación y código. |
| Alta | Diseño de datos | Crear E/R y diccionario con las ocho columnas de N1, p. 9. | Cobertura del modelo actual y restricciones relevantes; no depender de la imagen de clases histórica. |
| Alta | Contrato de prestación de servicios | Preparar el apartado/anexo 13 con las condiciones reales del trabajo. | Partes, alcance y condiciones comprobables, sin firmas ni acuerdos inventados. |
| Alta | Video de máximo 3 minutos | Grabar el guion existente mostrando el sistema real y agregarlo al ZIP. | Archivo reproducible, duración <= 3 minutos, incluido en el comprimido final. |
| Alta | Justificación/validación del alcance | Añadir la decisión que concilia el caso base con el catálogo relevado. Un acta o anexo es recomendable por esta diferencia, no un formato adicional impuesto por N1. | Alcance explicado y evidencia de conformidad cuando corresponda. |
| Media | Presentación | Mejorar diap. 8-11 y 14-16 con las justificaciones y evidencias indicadas en la matriz. | Ensayo completo de ambas operaciones, reportes coincidentes y copias identificables. |
| Media | Gantt | Incorporar plan original si existe; completar explicación de duraciones, dependencias y variación. | Referencia estimada e hitos reales permanecen distinguibles y no se inventa un plan previo. |
| Media | Manuales actuales | Ajustar fuente de política, equivalencias RF y dimensionamiento/referencias. | Cambios puntuales verificados, sin perder capturas y procedimientos que ya cumplen. |
| Final | Lista de entrega, manifiesto y ZIP | Actualizar archivos definitivos, obligatoriedad del video y empaquetado después de las correcciones. | Un único paquete con las versiones elegidas, sin documentos antiguos que contradigan la versión final. |

Los apartados de metodologías, ciclo de desarrollo, entrevistas, organigrama y requisitos mínimos pueden integrarse en el informe final. No necesitan convertirse en cinco documentos sueltos adicionales. Los manuales existentes deben mejorarse de forma localizada.

## Alcance de la verificación y cierre

Se leyeron íntegramente las tres consignas PDF y se comprobaron visualmente las páginas del esquema y los indicadores del manual. Se extrajeron y contrastaron textos, encabezados, tablas e imágenes de los DOCX; se inspeccionó el inventario de UML de A2 y su diagrama de clases. Se contrastó la presentación rediseñada con los doce criterios, los manuales actuales con sus indicadores y el inventario del comprimido con N1. Se verificaron hashes, versiones, número de páginas y legibilidad estructural del ZIP.

Las demostraciones nuevas, la defensa oral, la impresión/anillado y la aceptación docente del alcance no se acreditan mediante esta revisión. Las evidencias archivadas se identifican por su fecha y origen. La condición de cierre es **auditoría completada con incumplimientos y evidencias pendientes identificados**; no es cumplimiento total de la entrega.
