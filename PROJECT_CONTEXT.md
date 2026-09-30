# Contexto maestro del proyecto — fceadatasys

## 1. Identificación del proyecto

**Nombre del proyecto:** `fceadatasys` — susceptible a cambios.

**Institución:** Facultad de Ciencias Económicas y Administrativas, Universidad Nacional de Concepción (FCEA-UNC).

**Área:** Dirección de Investigación / Departamento de Investigación de la FCEA-UNC.

El área académica a informatizar se encarga de organizar, registrar, custodiar, preservar y difundir el catálogo de producciones científicas y académicas de la facultad, incluyendo trabajos finales de grado y posgrado, proyectos de investigación y artículos académicos que correspondan al alcance definido para el repositorio.

---

# 2. Área y estructura institucional

La estructura jerárquica y operativa del área académica a informatizar se compone de los siguientes niveles funcionalmente delimitados:

1. **Decanato y Consejo Directivo (FCEA-UNC):** autoridad institucional encargada de las resoluciones y formalización de decisiones relacionadas con la actividad académica y de investigación.

2. **Dirección de Investigación:** dependencia responsable de la gestión operativa del repositorio, recepción de trabajos aprobados y definición de políticas de acceso y publicación.

3. **Comisión de Evaluación de Tesis / Comité Científico:** instancia académica que evalúa y aprueba los trabajos finales de grado y tesis. Este proceso es independiente del repositorio.

4. **Dirección de TIC:** responsable de la infraestructura tecnológica institucional y de la administración técnica correspondiente.

5. **Gestor de Carga / Digitador (Biblioteca):** responsable de ingresar y mantener los metadatos bibliográficos y la información descriptiva de las publicaciones.

6. **Usuarios Públicos:** estudiantes, docentes y otros usuarios registrados por el Administrador que utilizan el sistema para consultar, buscar y filtrar información bibliográfica.

---

# 3. Planteamiento del problema

Actualmente, una parte importante de las producciones académicas y trabajos finales de grado se encuentra en formato físico en la biblioteca, lo que dificulta su localización, consulta y gestión centralizada.

Entre las principales deficiencias identificadas se encuentran:

1. Dificultades relacionadas con conectividad e infraestructura institucional.
2. Ausencia de validaciones automatizadas suficientes para detectar publicaciones y archivos duplicados.
3. Falta de un sistema centralizado de consulta bibliográfica.
4. Falta de mecanismos estructurados de control de usuarios y permisos.
5. Falta de trazabilidad completa de las operaciones realizadas en el sistema.
6. Ausencia de un módulo de reportes estadísticos y administrativos.
7. Necesidad de proteger los archivos digitales frente a contenido malicioso.
8. Necesidad de mantener información histórica sin eliminarla arbitrariamente.

---

# 4. Descripción del área a informatizar

El sistema informatizará los procesos de registro, organización, consulta, administración y preservación del catálogo bibliográfico de la Dirección de Investigación y la Biblioteca de la FCEA-UNC.

El sistema permitirá gestionar:

- publicaciones;
- autores;
- tutores;
- carreras;
- filiales;
- tipos de publicación;
- niveles académicos;
- usuarios;
- roles;
- parámetros generales;
- archivos digitales;
- publicaciones externas mediante URL;
- auditoría;
- búsquedas;
- reportes administrativos.

El sistema **no constituye un mecanismo de evaluación ni aprobación académica**.

Los trabajos registrados deben corresponder a publicaciones o trabajos cuya aprobación académica ya haya ocurrido por los mecanismos institucionales correspondientes.

---

# 5. Objetivo general

Desarrollar e implementar un sistema web destinado a registrar, organizar, preservar, consultar y administrar el catálogo bibliográfico de producciones académicas y científicas de la FCEA-UNC.

---

# 6. Objetivos específicos

1. Analizar las necesidades operativas y los flujos de trabajo de la Dirección de Investigación y Biblioteca.

2. Diseñar y establecer un modelo de información que permita gestionar publicaciones, autores, tutores, catálogos, usuarios y auditoría.

3. Implementar mecanismos de autenticación, autorización y control de acceso según roles.

4. Implementar mecanismos de validación y detección de duplicados.

5. Implementar mecanismos de protección y revisión de seguridad de archivos digitales.

6. Implementar búsquedas bibliográficas eficientes con un tiempo de respuesta objetivo de hasta 1,5 segundos bajo condiciones de prueba representativas.

7. Implementar reportes administrativos y estadísticos exportables a PDF y Excel.

8. Mantener trazabilidad de las operaciones relevantes mediante un sistema de auditoría inmutable.

9. Mantener los datos históricos mediante mecanismos de inactivación en lugar de eliminación arbitraria.

10. Evaluar el sistema mediante pruebas funcionales, de integración, seguridad, integridad y rendimiento.

---

# 7. Resultado de la entrevista

## Bloque 1: Definición y alcance del repositorio web

El sistema será una aplicación web destinada principalmente a funcionar como catálogo bibliográfico digital de la FCEA-UNC.

Su propósito es permitir la consulta y administración de información bibliográfica sobre producciones académicas que forman parte del alcance institucional del repositorio.

El sistema no reemplaza los procesos académicos de evaluación, aprobación o defensa de tesis.

---

## Bloque 2: Producciones físicas y publicaciones externas

Debe distinguirse entre:

- publicaciones locales cuya copia física se encuentra bajo custodia de la institución;
- publicaciones externas cuya versión digital se encuentra en una plataforma externa.

Para una publicación local que deba conservar su copia digital en el repositorio, el archivo digital es obligatorio.

Para una publicación externa, como una publicación disponible en una plataforma OJS institucional, debe almacenarse la URL correspondiente y no es obligatorio cargar un archivo local.

---

## Bloque 3: Evaluación académica y repositorio

El repositorio **NO evalúa ni aprueba tesis**.

La evaluación académica corresponde a las instancias institucionales responsables.

El sistema registra y administra información de publicaciones una vez que estas cumplen las condiciones necesarias para formar parte del catálogo.

---

## Bloque 4: Roles y permisos

Se establecen tres roles funcionales:

### Administrador (`ADMIN`)

Tiene control administrativo integral del sistema.

Puede:

- gestionar usuarios;
- asignar roles;
- gestionar catálogos;
- gestionar parámetros generales;
- crear, consultar, buscar, filtrar y modificar publicaciones;
- descargar archivos;
- inactivar publicaciones;
- eliminar físicamente cuando la regla de negocio lo permita;
- consultar y exportar auditoría;
- generar reportes;
- administrar la configuración funcional del sistema.

### Digitador (`DIGITADOR`)

Es responsable de la carga y mantenimiento de información bibliográfica.

Puede:

- crear publicaciones;
- consultar publicaciones;
- buscar y filtrar publicaciones;
- modificar publicaciones;
- gestionar autores y tutores desde las operaciones permitidas;
- cargar archivos;
- descargar archivos según autorización.

No puede:

- administrar usuarios;
- asignar roles;
- consultar o administrar la auditoría administrativa;
- administrar parámetros reservados al Administrador;
- realizar operaciones reservadas exclusivamente al Administrador.

### Público (`PUBLICO`)

Son usuarios registrados por un Administrador.

Debe iniciar sesión para acceder al sistema.

Puede:

- consultar publicaciones;
- buscar publicaciones;
- filtrar publicaciones;
- consultar metadatos bibliográficos.

No puede:

- crear publicaciones;
- modificar publicaciones;
- eliminar o inactivar publicaciones;
- descargar archivos adjuntos;
- administrar usuarios;
- administrar catálogos;
- consultar auditoría;
- generar reportes administrativos.

---

## Bloque 5: Metadatos, autores, tutores y archivos

Una publicación debe gestionar como mínimo:

- título;
- autores;
- carrera;
- nivel académico;
- tipo de publicación;
- tutores;
- filial;
- resumen;
- abstract;
- palabras clave;
- archivo o URL según corresponda.

### Autores

Los autores constituyen una entidad independiente.

Un autor puede participar en múltiples publicaciones.

Una publicación puede tener uno o múltiples autores.

La relación entre publicaciones y autores es N:M.

Un mismo autor no puede aparecer más de una vez en la misma publicación.

Debe conservarse el orden de autoría.

Los datos definidos para un autor son:

- ID;
- nombre completo;
- CI, opcional;
- correo electrónico, opcional;
- ORCID, opcional.

### Tutores

Los tutores constituyen una relación N:M con las publicaciones.

Una publicación puede tener múltiples tutores.

Un tutor puede participar en múltiples publicaciones.

Un mismo tutor no debe repetirse dentro de la misma publicación.

### Resumen

El resumen tiene un límite configurable.

El valor inicial es de **300 palabras**.

El backend debe realizar la validación definitiva del límite.

### Palabras clave

Las palabras clave serán introducidas manualmente por el Digitador.

No se establece actualmente un catálogo obligatorio de tesauros como requisito del sistema.

### Archivos

El archivo digital de una publicación local es obligatorio cuando la publicación deba conservarse digitalmente en el repositorio.

Inicialmente se admite PDF, salvo que el Administrador configure otros formatos permitidos.

Los formatos admitidos deben pasar por controles de seguridad.

La seguridad de archivos debe considerar, según corresponda:

- extensión;
- MIME;
- magic bytes;
- nombre sanitizado;
- hash;
- revisión antimalware.

El mecanismo antimalware debe priorizar una solución gratuita o de bajo costo y sencilla de operar.

La selección técnica concreta queda pendiente de la implementación y no debe inventarse antes de inspeccionar el repositorio.

Las publicaciones externas deben almacenar una URL en lugar de exigir un archivo local.

---

## Bloque 6: Flujo de registro

El flujo institucional parte del inventario oficial de trabajos aprobados que es remitido a la dependencia correspondiente.

El Digitador registra manualmente los metadatos en el sistema.

El sistema debe validar la información antes de permitir el registro.

Las validaciones definitivas se realizan en backend independientemente de las validaciones informativas del frontend.

---

## Bloque 7: Reportes

Los reportes administrativos estarán disponibles exclusivamente para `ADMIN`.

Deben permitir filtros como:

- carrera;
- año;
- rango de fechas;
- tipo de publicación;
- nivel académico;
- otros filtros definidos por los requisitos.

Los reportes deben poder exportarse a:

- PDF;
- Excel.

Cuando una consulta no produzca registros:

- la API responde HTTP 200;
- devuelve el payload vacío definido por el contrato;
- no se genera un archivo de reporte.

---

# 8. Definición de requerimientos

## DR-01: Registro y consulta de publicaciones

El sistema debe permitir registrar, consultar, buscar, filtrar y administrar publicaciones según los permisos correspondientes.

## DR-02: Gestión de usuarios

El sistema debe permitir al Administrador registrar, consultar, modificar, buscar, filtrar e inactivar usuarios y asignar roles.

## DR-03: Control de acceso

El sistema debe autenticar usuarios y controlar las operaciones disponibles según su rol.

## DR-04: Informes y reportes

El sistema debe permitir a los Administradores generar reportes e informes estadísticos según los filtros definidos.

## DR-05: Gestión de catálogos y parámetros

El sistema debe permitir administrar:

- carreras;
- filiales;
- tipos de publicación;
- tutores;
- parámetros generales;
- límite de palabras del resumen;
- formatos de archivo permitidos.

## DR-06: Auditoría

El sistema debe mantener un historial de las operaciones relevantes, permitir su consulta administrativa y garantizar su inmutabilidad.

---

# 9. Especificación de requerimientos

## ER-01: Registro de publicaciones

El sistema debe permitir, según el rol:

- crear;
- consultar;
- buscar;
- filtrar;
- modificar;
- inactivar;
- descargar archivos cuando esté autorizado.

La eliminación física de publicaciones no constituye una operación normal.

La eliminación física solo se permite cuando una regla explícita del sistema lo autorice, particularmente en situaciones relacionadas con archivos maliciosos.

Las publicaciones históricas deben conservarse mediante inactivación.

### Datos principales

- título;
- autores;
- carrera;
- nivel académico;
- tipo de publicación;
- tutores;
- filial;
- resumen;
- abstract;
- palabras clave;
- archivo o URL según tipo de publicación.

### Validaciones

El sistema debe:

- exigir campos obligatorios;
- validar el límite configurable del resumen;
- detectar duplicados;
- aplicar normalización;
- impedir condiciones de carrera en reglas de unicidad;
- impedir autores duplicados dentro de una publicación;
- impedir tutores duplicados dentro de una publicación;
- validar archivos;
- ejecutar controles de seguridad sobre archivos;
- impedir archivos duplicados mediante hash;
- impedir publicaciones con información duplicada según las reglas definidas.

---

## ER-02: Gestión de usuarios

El Administrador podrá:

- registrar;
- consultar;
- modificar;
- buscar;
- filtrar;
- inactivar usuarios;
- asignar roles.

### Datos principales

- CI;
- correo;
- nombre;
- usuario;
- contraseña;
- rol;
- estado.

### Validaciones

El sistema debe:

- evitar usuarios duplicados;
- validar campos obligatorios;
- aplicar las reglas de unicidad correspondientes;
- impedir almacenar contraseñas en texto plano;
- restringir la gestión de usuarios al Administrador.

---

## ER-03: Control de acceso y Login

El sistema permitirá iniciar sesión mediante usuario y contraseña.

El sistema debe:

- rechazar usuarios inexistentes;
- validar credenciales;
- controlar permisos por rol;
- registrar intentos exitosos;
- registrar intentos fallidos;
- registrar información de sesión según corresponda.

### Bloqueo

Después de **3 intentos fallidos**, el usuario debe quedar bloqueado durante **5 minutos**.

El bloqueo se aplica por usuario.

No debe existir bypass de autorización.

---

## ER-04: Informes y reportes estadísticos

Los reportes estarán disponibles exclusivamente para `ADMIN`.

Deben permitir filtrar, según corresponda, por:

- carrera;
- año;
- rango de fechas;
- nivel académico;
- tipo de publicación;
- otros criterios establecidos.

Formatos:

- PDF;
- Excel.

Si no existen registros:

- HTTP 200;
- payload vacío;
- no generar archivo.

---

## ER-05: Gestión de catálogos y parámetros

El Administrador podrá registrar, consultar, buscar, filtrar, modificar, inactivar y, cuando corresponda, eliminar elementos de los catálogos.

Los catálogos incluyen:

- carreras;
- filiales;
- tipos de publicación;
- tutores;
- otros catálogos definidos por el modelo del sistema.

Los parámetros generales incluyen como mínimo:

- límite de palabras del resumen;
- formatos de archivo permitidos.

### Reglas de catálogos

El sistema debe:

- evitar duplicados;
- conservar información histórica;
- impedir eliminar físicamente un catálogo que tenga referencias que hagan incompatible su eliminación;
- inactivar el catálogo cuando corresponda;
- excluir catálogos inactivos de nuevas selecciones donde la regla de negocio lo indique;
- conservar las publicaciones históricas asociadas.

Si un catálogo no tiene referencias incompatibles con la eliminación, puede eliminarse físicamente.

Un catálogo vacío debe mostrar claramente que no contiene elementos.

---

## ER-06: Auditoría, logs y trazabilidad

El sistema debe registrar las operaciones relevantes.

Como mínimo se deben auditar:

- inicio de sesión exitoso;
- intento de inicio de sesión fallido;
- logout;
- tiempos de sesión;
- carga de publicaciones;
- modificación de publicaciones;
- carga de archivos;
- descarga de archivos;
- creación de usuarios;
- modificación de usuarios;
- inactivación de usuarios;
- asignación o modificación de roles;
- modificaciones de catálogos;
- modificaciones de parámetros;
- operaciones de seguridad o validación fallidas que deban quedar registradas.

El registro debe poder incluir:

- ID;
- fecha y hora;
- usuario;
- rol;
- operación;
- entidad afectada;
- registro afectado;
- IP;
- User-Agent;
- ID de sesión;
- estado `ÉXITO` o `FALLIDO`;
- motivo o detalle del fallo;
- valores anteriores;
- valores nuevos.

Los valores anteriores/nuevos podrán representarse estructuradamente, por ejemplo mediante JSON.

### Reglas de auditoría

- La auditoría es inmutable.
- No se permite modificar manualmente registros históricos.
- No se permite eliminar registros de auditoría.
- Nunca deben registrarse contraseñas, tokens o secretos.
- Si una operación que requiere auditoría no puede registrarse correctamente, la operación original debe cancelarse.
- El Administrador puede consultar, filtrar, visualizar y exportar registros de auditoría.

---

# 10. Especificación de software

## ES-01. Módulo de Publicaciones

### Operaciones

- crear;
- consultar;
- buscar;
- filtrar;
- modificar;
- inactivar;
- descargar archivo según autorización.

### Datos

- título;
- autores;
- carrera;
- nivel académico;
- tipo;
- tutores;
- filial;
- resumen;
- abstract;
- palabras clave;
- archivo o URL.

### Validaciones

- campos obligatorios;
- límite configurable del resumen;
- duplicación de título;
- duplicación de resumen;
- duplicación de abstract;
- duplicación de archivo mediante hash;
- normalización de datos;
- unicidad de autores dentro de la publicación;
- unicidad de tutores dentro de la publicación;
- seguridad del archivo;
- autorización por rol.

---

## ES-02. Módulo de Usuarios

### Operaciones

- registrar;
- consultar;
- buscar;
- filtrar;
- modificar;
- inactivar;
- asignar roles.

### Datos

- CI;
- correo;
- nombre;
- usuario;
- contraseña;
- rol;
- estado.

### Validaciones

- unicidad;
- campos obligatorios;
- contraseña almacenada de forma segura;
- autorización exclusiva del Administrador.

---

## ES-03. Módulo de Login

### Datos

- usuario;
- contraseña.

### Validaciones

- campos obligatorios;
- usuario existente;
- credenciales válidas;
- autorización según rol;
- máximo de 3 intentos fallidos;
- bloqueo durante 5 minutos;
- bloqueo por usuario;
- auditoría de intentos exitosos y fallidos.

---

## ES-04. Módulo de Informes

### Operaciones

- filtrar;
- consultar;
- generar PDF;
- generar Excel.

### Datos de filtro

- rango de fechas;
- nivel académico;
- carrera;
- tipo de publicación;
- otros filtros definidos.

### Validaciones

- acceso exclusivo a `ADMIN`;
- filtros válidos;
- si no existen registros, HTTP 200 con payload vacío;
- no generar archivo cuando no existen registros.

---

## ES-05. Módulo de Catálogos y Parámetros

### Catálogos

- carreras;
- filiales;
- tipos de publicación;
- tutores.

### Parámetros

- límite de palabras del resumen;
- formatos de archivo permitidos.

### Operaciones

- registrar;
- consultar;
- buscar;
- filtrar;
- modificar;
- inactivar;
- eliminar cuando esté permitido.

### Validaciones

- evitar duplicados;
- impedir eliminación física cuando existan referencias incompatibles;
- mantener histórico;
- excluir elementos inactivos de nuevas selecciones cuando corresponda;
- acceso restringido a roles autorizados.

---

## ES-06. Módulo de Auditoría y Trazabilidad

### Operaciones

- consultar;
- buscar;
- filtrar;
- visualizar detalle;
- exportar.

### Datos

- ID;
- fecha y hora;
- usuario;
- rol;
- operación;
- entidad;
- registro afectado;
- IP;
- User-Agent;
- sesión;
- estado;
- motivo;
- valores anteriores;
- valores nuevos.

### Validaciones

- acceso exclusivo a `ADMIN`;
- registros inmutables;
- prohibición de modificación;
- prohibición de eliminación;
- validación de rangos de fechas;
- auditoría de operaciones relevantes;
- cancelación de la operación original cuando falle una auditoría obligatoria.

---

## ES-07. Módulo de Autores

### Datos

- ID;
- nombre completo;
- CI opcional;
- correo opcional;
- ORCID opcional.

### Reglas

- relación N:M con publicaciones;
- un autor puede participar en múltiples publicaciones;
- una publicación puede tener múltiples autores;
- no repetir el mismo autor dentro de una publicación;
- conservar orden de autoría.

---

## ES-08. Módulo de Tutores

### Datos

- identificación del tutor;
- información descriptiva definida por el modelo.

### Reglas

- relación N:M con publicaciones;
- un tutor puede participar en múltiples publicaciones;
- una publicación puede tener múltiples tutores;
- no repetir un tutor dentro de una publicación.

---

## ES-09. Módulo de Búsqueda

El sistema debe permitir consultar publicaciones mediante búsqueda y filtros.

Debe contemplar:

- búsqueda en español;
- búsqueda en inglés para el contenido correspondiente, especialmente abstract;
- preferentemente una única consulta bilingüe cuando sea técnicamente viable;
- filtros bibliográficos;
- paginación.

### Rendimiento

El tiempo objetivo máximo de respuesta de búsqueda es de **1,5 segundos** bajo condiciones representativas.

El cumplimiento debe demostrarse mediante pruebas de rendimiento.

La mera existencia de índices no constituye evidencia suficiente.

---

# 11. Requerimientos funcionales

**RF-01:** Registro, consulta, búsqueda, filtrado, modificación, inactivación y administración de publicaciones según rol.

**RF-02:** Gestión de autores y relación N:M con publicaciones, conservando orden de autoría.

**RF-03:** Gestión de tutores y relación N:M con publicaciones.

**RF-04:** Registro, consulta, modificación, inactivación y asignación de roles para usuarios mediante el Administrador.

**RF-05:** Control de acceso seguro, autenticación, sesiones y bloqueo por intentos fallidos.

**RF-06:** Filtrado, consulta y generación de reportes institucionales en PDF y Excel exclusivamente para Administradores.

**RF-07:** Gestión y mantenimiento de catálogos académicos y parámetros generales.

**RF-08:** Validación de archivos y controles de seguridad antes de su almacenamiento.

**RF-09:** Detección de duplicados mediante normalización y mecanismos que eviten condiciones de carrera.

**RF-10:** Búsqueda bibliográfica con paginación y soporte de contenido en español e inglés según las reglas definidas.

**RF-11:** Control, seguimiento y auditoría detallada de actividades, cambios e inicios de sesión.

**RF-12:** Conservación histórica mediante inactivación y restricciones de eliminación física.

**RF-13:** Gestión de publicaciones externas mediante almacenamiento de URL cuando corresponda.

---

# 12. Requerimientos no funcionales

| Código | Categoría | Subcategoría | Descripción |
|---|---|---|---|
| RNF-01 | Producto | Seguridad | El sistema debe realizar controles de seguridad sobre los archivos subidos, incluyendo validaciones de tipo y mecanismos de detección de contenido malicioso. |
| RNF-02 | Producto | Seguridad | El sistema debe controlar el acceso mediante autenticación y autorización basada en roles. |
| RNF-03 | Producto | Eficiencia | Las búsquedas deben alcanzar un tiempo de respuesta de hasta 1,5 segundos bajo condiciones de prueba representativas. |
| RNF-04 | Producto | Disponibilidad | El sistema debe diseñarse para una disponibilidad institucional continua, minimizando interrupciones y errores conforme a las condiciones de infraestructura definidas para el proyecto. |
| RNF-05 | Producto | Usabilidad | La interfaz debe mantener una organización clara, navegación comprensible y documentación/manual de uso cuando corresponda. |
| RNF-06 | Organizacional | Desarrollo | El sistema deberá desarrollarse utilizando las tecnologías, herramientas y estándares que se definan para el proyecto, respetando las decisiones técnicas registradas. |
| RNF-07 | Producto | Integridad | Las operaciones que requieran auditoría deben garantizar que una falla en el registro de auditoría impida completar la operación original. |
| RNF-08 | Producto | Seguridad | Las contraseñas, tokens y secretos no deben almacenarse ni registrarse en texto plano. |
| RNF-09 | Producto | Seguridad | El sistema no debe confiar únicamente en la extensión de un archivo para determinar si es seguro. |
| RNF-10 | Producto | Trazabilidad | Los registros de auditoría deben mantenerse inmutables. |
| RNF-11 | Producto | API | La API debe utilizar `/api/v1`, paginación cuando corresponda y errores consistentes basados en RFC 7807 Problem Details. |
| RNF-12 | Producto | API | Las respuestas exitosas sin error deben utilizar los códigos HTTP correspondientes al contrato; cuando un reporte no tenga resultados, debe responder HTTP 200 con payload vacío y sin generar archivo. |
| RNF-13 | Producto | Datos | PostgreSQL es el motor de base de datos definido para el proyecto. |
| RNF-14 | Producto | Mantenibilidad | Las responsabilidades entre dominios deben mantenerse separadas y las modificaciones deben respetar el ownership definido para los componentes del sistema. |

---

# 13. Reglas de negocio transversales

1. El repositorio no evalúa ni aprueba trabajos académicos.

2. Solo se registran trabajos que correspondan al alcance institucional definido.

3. Una publicación pertenece exactamente a una filial.

4. Una publicación puede tener múltiples autores.

5. Una publicación puede tener múltiples tutores.

6. Autores y publicaciones mantienen una relación N:M.

7. Tutores y publicaciones mantienen una relación N:M.

8. Un autor no puede repetirse dentro de una publicación.

9. Un tutor no puede repetirse dentro de una publicación.

10. El orden de los autores debe conservarse.

11. Las publicaciones normalmente se inactivan en lugar de eliminarse.

12. La eliminación física solo se permite cuando una regla explícita del sistema la autorice.

13. Los catálogos pueden eliminarse físicamente cuando no existan referencias incompatibles con dicha eliminación.

14. Los catálogos con referencias que impidan su eliminación deben inactivarse.

15. Los datos históricos deben conservarse.

16. Los elementos inactivos no deben utilizarse para nuevas selecciones cuando la regla funcional así lo determine.

17. Los duplicados deben rechazarse con una indicación explícita de la condición detectada.

18. Las comparaciones de duplicados deben utilizar normalización consistente.

19. Las reglas de unicidad deben estar protegidas contra condiciones de carrera.

20. Toda operación que requiera auditoría debe cancelarse si no puede registrarse correctamente.

21. Los registros de auditoría son inmutables.

22. No deben registrarse secretos, contraseñas ni tokens.

23. No existe bypass de autorización.

24. Los reportes son exclusivos del Administrador.

25. Los reportes sin resultados no generan archivos.

26. Los usuarios `PUBLICO` son creados por `ADMIN`.

27. `PUBLICO` puede consultar metadatos pero no descargar archivos.

28. `DIGITADOR` puede descargar archivos cuando esté autorizado.

29. `ADMIN` tiene control integral sobre publicaciones y archivos.

30. Una publicación externa puede utilizar URL en lugar de archivo local.

---

# 14. API y contrato de errores

La API del sistema utilizará como prefijo:

`/api/v1`

Las operaciones que devuelvan colecciones deben implementar paginación cuando corresponda.

Los errores deben utilizar el formato **RFC 7807 Problem Details**.

El contrato debe permitir identificar como mínimo:

- status;
- code;
- title;
- detail;
- timestamp;
- path;
- parámetros inválidos cuando corresponda.

Ejemplo conceptual:

```json
{
  "status": 400,
  "code": "VALIDATION_ERROR",
  "title": "Error de validación de datos",
  "detail": "La publicación no pudo ser registrada debido a errores en los campos enviados.",
  "timestamp": "2026-09-28T15:30:00Z",
  "path": "/api/v1/publicaciones",
  "invalid_params": [
    {
      "name": "resumen",
      "reason": "El resumen excede el límite permitido."
    },
    {
      "name": "adjunto",
      "reason": "El archivo adjunto se encuentra duplicado."
    }
  ]
}
```

La estructura definitiva debe mantenerse consistente en toda la API.

---

# 15. Restricciones de diseño y alcance

Actualmente quedan deliberadamente sin definir en este documento:

- framework backend;
- framework frontend;
- ORM;
- biblioteca concreta de autenticación;
- proveedor concreto de almacenamiento;
- herramienta concreta de antimalware;
- infraestructura de despliegue;
- CI/CD;
- estructura definitiva de directorios;
- estrategia concreta de sesiones;
- detalles internos de implementación.

Estas decisiones deberán tomarse únicamente cuando sean necesarias para implementar el sistema, después de inspeccionar el repositorio y respetando las restricciones existentes.

Las decisiones técnicas que no estén previamente definidas deberán registrarse como decisiones del proyecto.

Este documento define **qué debe hacer el sistema y cuáles son sus restricciones funcionales y no funcionales**; no pretende definir todavía la arquitectura técnica detallada ni la implementación.