# AGENTS.md - Contrato Maestro de fceadatasys

## 1. Identidad y misión

**Proyecto:** `fceadatasys` (el nombre puede cambiar).

**Institución:** Facultad de Ciencias Económicas y Administrativas (FCEA), Universidad Nacional de Concepción (UNC).

**Área informatizada:** Dirección de Investigación / Departamento de Investigación, en coordinación operativa con Biblioteca y TIC.

El sistema es un **catálogo bibliográfico digital** de producciones académicas y científicas. El repositorio no evalúa ni aprueba tesis: la evaluación académica ocurre fuera del sistema. El software registra y permite consultar trabajos una vez aprobados.

El sistema debe organizar, preservar y difundir metadatos institucionales, controlar el acceso, gestionar publicaciones, usuarios, catálogos, reportes y auditoría.

## 2. Fuente de verdad y prioridad

Este archivo es el **contrato maestro** del repositorio.

Ante contradicciones entre subagentes, documentación, código existente o decisiones locales:

1. prevalece este `AGENTS.md`;
2. luego prevalecen los requerimientos funcionales y no funcionales documentados del proyecto;
3. luego las decisiones explícitas tomadas durante la implementación;
4. finalmente convenciones técnicas razonables del stack existente.

Un subagente **no debe reinterpretar unilateralmente** una regla de este archivo.

Solo se debe solicitar aclaración al usuario cuando la contradicción sea insalvable mediante estas reglas de prioridad.

## 3. Orquestación

- **OpenCode** es responsable de la orquestación, planificación, dependencias, secuenciación, validación y coordinación entre subagentes.
- **OmniRoute** se limita a la selección/ruteo del modelo o capacidad apropiada. No decide la arquitectura ni sustituye al orquestador.
- El orden de ejecución **no es fijo**. OpenCode debe decidirlo según dependencias reales y estado del repositorio.
- Un agente puede bloquearse por una dependencia de otro dominio, pero no debe modificar directamente archivos fuera de su ámbito.

## 4. Reglas obligatorias para todo subagente

Antes de modificar cualquier archivo:

1. inspeccionar el estado actual del repositorio;
2. identificar stack, estructura, convenciones y cambios existentes;
3. localizar los archivos bajo su alcance;
4. revisar dependencias con otros dominios;
5. comprobar que la modificación no contradiga este contrato.

Después de modificar:

1. ejecutar las validaciones disponibles para su dominio;
2. comprobar que no se rompieron contratos de otros dominios;
3. dejar explícitos los fallos que no pudo resolver;
4. no declarar terminado un trabajo sin cumplir su Definition of Done.

### Aislamiento de dominio

Cada subagente tiene ownership explícito. No debe editar directamente archivos de otro dominio.

Cuando sea necesaria una modificación cruzada:

- documentar el contrato requerido;
- solicitar que el agente dueño haga el cambio;
- OpenCode coordina la dependencia.

### Scope-locking

Toda tarea debe limitarse a los archivos y componentes necesarios.

No realizar refactors oportunistas, cambios de estilo masivos ni modificaciones no relacionadas con el objetivo de la tarea.

## 5. Arquitectura funcional

Dominios principales:

- Base de datos y persistencia.
- Seguridad y auditoría.
- Backend/API y reglas de negocio.
- Frontend y experiencia de usuario.

### Roles

#### ADMINISTRADOR

Control total del sistema:

- usuarios y roles;
- publicaciones;
- catálogos;
- parámetros generales;
- reportes;
- auditoría;
- descarga de adjuntos;
- inactivación de publicaciones y usuarios.

#### DIGITADOR / GESTOR DE CARGA

Personal de Biblioteca:

- crear publicaciones;
- consultar, buscar y filtrar;
- modificar publicaciones;
- descargar adjuntos;
- gestionar metadatos según permisos.

No puede administrar usuarios, roles, parámetros administrativos, auditoría ni eliminar/inactivar publicaciones.

#### PUBLICO

Usuario registrado, creado exclusivamente por Administrador.

Puede:

- iniciar sesión;
- consultar publicaciones;
- buscar y filtrar metadatos.

No puede descargar archivos adjuntos.

## 6. Publicaciones

Campos funcionales obligatorios:

- título;
- uno o más autores;
- carrera;
- nivel académico;
- tipo de publicación;
- uno o más tutores/orientadores;
- resumen;
- abstract;
- palabras clave;
- filial;
- información de archivo o URL externa según corresponda.

### Autores

Autor es una entidad independiente y administrable.

Datos:

- `id`;
- `nombre_completo`;
- `ci` opcional;
- `correo` opcional;
- `orc_id` opcional.

Un autor puede participar en múltiples publicaciones. En una publicación determinada solo puede aparecer una vez, aunque conceptualmente pueda actuar como autor/coautor.

La relación publicación-autor es N:M y debe conservar el orden de autoría.

### Tutores

Tutor/orientador es una entidad reutilizable.

Una publicación puede tener múltiples tutores y un tutor puede participar en múltiples publicaciones.

La relación publicación-tutor es N:M.

### Archivos y publicaciones externas

- El sistema admite publicaciones locales con archivo adjunto.
- Para publicaciones externas, debe almacenarse una URL.
- La copia digital es obligatoria únicamente cuando corresponda a una publicación local que físicamente deba conservarse en Biblioteca.
- El formato y las reglas de seguridad de los archivos se determinan mediante parámetros administrables y las reglas de `sa-security`.

### Inactivación

La eliminación funcional de una publicación es una **inactivación**, conservando sus datos históricos.

La eliminación física de un registro/archivo es excepcional y está permitida cuando el archivo subido haya sido identificado como malicioso o infectado, siguiendo el procedimiento de seguridad y auditoría correspondiente.

## 7. Duplicados

La detección debe normalizar los valores antes de comparar.

La normalización incluye, como mínimo:

- eliminación de espacios redundantes;
- normalización de mayúsculas/minúsculas;
- tratamiento consistente de acentos y caracteres equivalentes;
- normalización Unicode;
- eliminación/control consistente de diferencias de puntuación o representación cuando corresponda;
- normalización equivalente para textos comparables.

Reglas:

- títulos duplicados no pueden coexistir;
- un mismo hash de adjunto no puede reutilizarse;
- también debe comprobarse duplicidad normalizada de resumen y abstract;
- ante duplicado, la operación se rechaza y la respuesta debe indicar explícitamente la duplicación.

La base de datos y el backend deben colaborar para evitar condiciones de carrera.

## 8. Resumen

- El límite predeterminado es **300 palabras como máximo**.
- El límite es configurable por Administrador mediante parámetros generales.
- La validación debe contar palabras de manera determinista y consistente entre frontend/backend.
- No usar `<300`; el requisito consolidado es `<= límite configurado`.

## 9. Palabras clave y búsqueda

- Las palabras clave se ingresan manualmente por el Digitador.
- No se implementa un catálogo/tesauro propio en esta versión.
- La búsqueda debe soportar español.
- El abstract está en inglés.
- Se intentará soportar búsqueda español + inglés en una misma consulta cuando sea técnicamente viable con PostgreSQL sin introducir complejidad innecesaria.
- La implementación debe usar índices FTS apropiados y medición real de rendimiento.
- Objetivo de rendimiento: búsqueda <= 1,5 segundos en las pruebas definidas para el proyecto.

## 10. Catálogos y parámetros

Catálogos principales:

- carreras;
- filiales;
- tipos de publicación;
- tutores/orientadores;
- autores, mediante su entidad independiente.

Parámetros generales:

- límite de palabras del resumen;
- formatos/extensiones admitidos.

Reglas:

- nombres de catálogos deben ser únicos;
- un catálogo inactivo no aparece en nuevas cargas;
- los registros históricos que lo referencian se conservan;
- si un catálogo no tiene registros, la interfaz debe mostrarlo como vacío;
- si existen publicaciones activas asociadas, no se permite eliminación física ni inactivación que rompa la integridad funcional;
- si no existe ninguna referencia, la eliminación física del catálogo puede permitirse.

## 11. Usuarios y autenticación

Datos:

- CI;
- email;
- nombre;
- usuario;
- contraseña almacenada como hash seguro;
- rol;
- estado.

`ci`, `email` y `usuario` deben ser únicos cuando corresponda según el modelo.

Login:

- usuario y contraseña obligatorios;
- 3 intentos fallidos consecutivos provocan bloqueo;
- bloqueo por usuario;
- duración del bloqueo: 5 minutos;
- registrar intentos exitosos y fallidos;
- registrar logout y tiempos de sesión.

## 12. Auditoría

La auditoría es obligatoria para:

### Acceso/sesión
- login exitoso;
- login fallido;
- logout;
- tiempos de sesión.

### Publicaciones y archivos
- carga;
- modificación de metadatos;
- descarga de adjuntos;
- inactivación;
- operaciones de archivo relevantes.

### Administración
- creación/modificación/inactivación de usuarios;
- asignación de roles;
- cambios de catálogos;
- cambios de parámetros generales.

### Seguridad/validación
- operaciones rechazadas por validación;
- operaciones rechazadas por controles de seguridad.

Cada log debe conservar, como mínimo:

- ID;
- fecha/hora;
- usuario;
- rol;
- tipo de operación;
- recurso afectado;
- publicación afectada cuando corresponda;
- IP;
- User-Agent;
- ID de sesión;
- estado `ÉXITO`/`FALLIDO`;
- motivo/detalle del fallo;
- valores anteriores/nuevos cuando corresponda, normalmente en JSON.

Los logs son inmutables: no se permite UPDATE/DELETE manual.

Si la escritura del audit log falla, **la operación original debe cancelarse**.

Solo ADMINISTRADOR puede consultar, filtrar, ver detalle y exportar auditoría.

## 13. Reportes

Solo ADMINISTRADOR.

Filtros mínimos:

- rango de fechas;
- nivel académico;
- carrera.

Se deben poder ampliar según requerimientos, incluyendo tipo y otros criterios existentes.

Formatos:

- PDF;
- Excel.

Si no existen registros:

- no se genera archivo;
- la API responde normalmente con HTTP 200 y un payload vacío según el contrato API.

## 14. API

La API debe:

- usar versionado, preferentemente `/api/v1`;
- usar HTTP estándar;
- usar paginación en listados;
- aplicar validación consistente;
- devolver errores con RFC 7807 / Problem Details;
- mantener contratos documentados para frontend.

Formato de error mínimo:

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
    }
  ]
}
```

No inventar códigos ni convenciones adicionales sin documentarlos en el contrato de API.

## 15. Seguridad de archivos

- Solo se admite PDF inicialmente, salvo que ADMINISTRADOR configure explícitamente formatos adicionales.
- Todo formato habilitado debe pasar por controles de seguridad.
- No confiar únicamente en extensión o MIME declarado por el cliente.
- Validar contenido/magic bytes cuando corresponda.
- Sanitizar nombres.
- Calcular y persistir hash.
- El mecanismo antimalware/antivirus debe ser gratuito o de bajo costo, sencillo de operar y mantenible.
- `sa-security` puede seleccionar la implementación concreta, pero debe documentarla y someterla a validación.
- Un archivo detectado como malicioso/infectado debe quedar fuera de circulación y puede requerir eliminación física.
- Toda acción de seguridad debe quedar auditada.

## 16. Base de datos

PostgreSQL, versión actual/soportada por el entorno del proyecto.

Reglas:

- claves foráneas y restricciones de integridad;
- índices adecuados;
- FTS con configuración apropiada;
- mecanismos para impedir duplicados/race conditions;
- auditoría inmutable mediante mecanismos de base de datos cuando sea apropiado;
- no eliminar datos históricos de publicaciones por una simple inactivación.

La entidad Autor y las relaciones N:M Autor-Publicación y Tutor-Publicación forman parte del modelo relacional requerido por este contrato.

## 17. Definition of Done global

Una tarea no se considera terminada si:

1. respeta el ownership del agente;
2. fue precedida por inspección del repositorio;
3. no viola este contrato;
4. tiene pruebas/validaciones apropiadas;
5. las migraciones son aplicables y reversibles cuando corresponda;
6. los contratos entre backend/frontend/database están documentados;
7. las reglas de seguridad y auditoría aplicables están cubiertas;
8. no quedan errores conocidos sin documentar;
9. las pruebas del dominio pasan;
10. OpenCode puede ejecutar una validación final integrada.

## 18. Regla de entrega

Cada subagente debe devolver a OpenCode:

- qué inspeccionó;
- qué cambió;
- archivos afectados;
- contratos nuevos/modificados;
- pruebas ejecutadas;
- resultados;
- bloqueos o riesgos pendientes.

No debe declarar "completo" si existe un requisito obligatorio incumplido.
