# Mantenimiento de usuarios y autenticación

Grupo 2 · Sistema de Repositorio de Investigaciones

Ingeniería de Software I · Actualización 8 de octubre de 2026

Grupo 2 presenta la actualización del mantenimiento de usuarios y de los controles locales de autenticación y acceso para Ingeniería de Software I. El documento vincula reglas, casos de uso, diagramas y pruebas para explicar el funcionamiento ante la mesa examinadora.

La entrega conserva el alcance de frontend: React y TypeScript, persistencia en localStorage y sesión por pestaña en sessionStorage. No implementa backend, base de datos relacional, JWT ni envío de correo. Los controles locales permiten demostrar las reglas, pero no ofrecen seguridad frente a alguien que modifica el almacenamiento o el código del navegador.

Los diagramas son modelos de diseño específicos por flujo. Los elementos marcados módulo o hook representan funciones de TypeScript, no clases orientadas a objetos que deban existir literalmente en el código. User, State y las relaciones corresponden a los tipos implementados.

## Reglas y alcance

RN-01 — El nombre de la cuenta Público es de solo lectura en edición administrativa y Mi perfil. También se rechaza su cambio en la lógica de negocio. Un cambio de rol en el mismo guardado no permite eludir la restricción.

RN-02 — Tanto eliminar como pasar de Activo a Inactivo requieren ausencia de vínculos. Se consultan las relaciones registradas y todos los participantes históricos de catálogos. Un registro anterior sin trazabilidad impide la baja cautelarmente, sin inventar su propietario.

RN-03 — La condición de cuenta inactiva se comunica después de verificar correctamente la contraseña. Las credenciales erróneas mantienen el mensaje genérico. Un bloqueo temporal vigente tiene prioridad.

RN-04 — La apertura por URL aplica la matriz de permisos, con denegación por defecto. La sesión se bloquea a los 10 minutos sin actividad, según la elección del grupo. El plazo se conserva al recargar y se revisa al regresar a la pestaña; una interacción posterior al vencimiento no lo renueva.

## CU01 Crear Usuario

**Actores:** Administrador autenticado. El sistema actúa como participante secundario.

**Precondiciones:** Sesión vigente y rol Administrador. Almacenamiento local disponible. El nombre se captura libremente al crear, incluso para Público; RN-01 rige en la edición.

**Flujo principal**

1. El administrador abre Usuarios y selecciona Nuevo usuario. El sistema comprueba el permiso de apertura.
2. El sistema muestra el formulario vacío con nombre, CI, correo, usuario, rol, estado, contraseña y confirmación.
3. El administrador completa los datos y confirma Crear usuario.
4. El servicio comprueba permiso, campos obligatorios, formatos, unicidad de CI/correo/usuario y política de contraseña.
5. El modelo genera identificador, sal aleatoria y hash; el sistema revalida sesión y versión de los datos antes de persistir.
6. Al guardar correctamente, el sistema cierra el formulario, actualiza el listado y confirma la creación.

**Flujos alternativos y excepciones**

- A1 Datos inválidos, duplicados o contraseñas diferentes: mostrar el motivo, conservar el formulario y no crear la cuenta.
- A2 Sin permiso o sesión vencida: impedir la operación; si venció por inactividad, solicitar autenticación.
- A3 Cancelar: cerrar el formulario sin cambios.
- E1 Error de almacenamiento o datos cambiados en otra operación: no informar éxito; mostrar error y solicitar reintento o reapertura.

**Postcondiciones:** Éxito: una cuenta nueva persistida con contraseña derivada, sin contraseña en texto plano. Rechazo: no se agrega la cuenta.

> **Espacio reservado para captura de interfaz**
>
> Insertar captura de Usuarios → Nuevo usuario con datos ficticios y sin contraseñas visibles.

### Diagrama de clases específico

```plantuml
@startuml
title Clases específicas Crear Usuario
skinparam classAttributeIconSize 0
class "userService.ts" as Servicio <<módulo>> {
  +createUser(state, actorId, input, password): Resultado
}
class "model.ts" as Modelo <<módulo>> {
  +guardAdmin(state, actorId)
  +validateUser(input, users): UserInput
  +makeUser(input, password): User
}
class User {
  +id: string
  +name: string
  +ci: string
  +email: string
  +username: string
  +role: Role
  +active: boolean
  +passwordHash: string
  +salt: string
  +createdAt: string
  +failures: number
  +lockedUntil: number
}
class State {
  +users: User[]
}
class Resultado {
  +exito: boolean
  +mensaje: string
  +datos: State
}
Servicio ..> Modelo : valida y crea
Modelo ..> User : construye
State "1" o-- "0..*" User
Servicio ..> Resultado : devuelve
Resultado --> State
@enduml
```

## CU02 Editar Usuario

**Actores:** Administrador autenticado.

**Precondiciones:** Sesión vigente, permiso de usuarios y cuenta destino existente. Se consulta el usuario por ID antes de abrir el formulario.

**Flujo principal**

1. El administrador selecciona Editar en el listado.
2. loadUserForEdit comprueba el permiso, consulta la cuenta actual y entrega una copia para precargar los campos.
3. El sistema despliega el formulario precargado. Si el rol actual es Público, Nombre Completo se muestra de solo lectura.
4. El administrador modifica los campos permitidos y confirma Guardar cambios. Si asigna Público a otra cuenta, se conserva el nombre original.
5. El servicio revalida la precarga, formatos, unicidad, RN-01, cuenta propia y último administrador. Para inactivar, verifica RN-02.
6. Se revalida la sesión, se persiste el estado y se actualiza el listado con un mensaje de confirmación.

**Flujos alternativos y excepciones**

- A1 Cuenta inexistente o precarga desactualizada: no aplicar cambios; pedir volver al listado y abrir nuevamente.
- A2 Intento de modificar nombre Público, incluso alterando el formulario: rechazar con mensaje de solo lectura.
- A3 Campos inválidos, duplicados, baja con dependencias o protección de administrador: explicar la restricción y conservar datos.
- A4 Cancelación, falta de permiso, sesión vencida o fallo al guardar: no confirmar actualización.

**Postcondiciones:** Éxito: se mantienen ID, credencial y fecha de creación; solo cambian los campos autorizados. Rechazo: no se aplica la modificación.

> **Espacio reservado para captura de interfaz**
>
> Insertar captura de Editar usuario con rol Público y Nombre Completo de solo lectura.

### Diagrama de clases específico

```plantuml
@startuml
title Clases específicas Editar Usuario
skinparam classAttributeIconSize 0
class "userService.ts" as Servicio <<módulo>> {
  +loadUserForEdit(state, actorId, userId): Resultado
  +editUser(state, actorId, userId, input): Resultado
}
class "model.ts" as Modelo <<módulo>> {
  +updateUser(state, actorId, userId, input): State
  +validateUser(input, users, editingId): UserInput
}
class User {
  +id: string
  +name: string
  +ci: string
  +email: string
  +username: string
  +role: Role
  +active: boolean
}
class State {
  +users: User[]
}
class "relations.ts" as Relaciones <<módulo>> {
  +userDependencies(state, userId): string[]
}
class Resultado {
  +exito: boolean
  +mensaje: string
  +datos: User o State
}
Servicio ..> User : consulta y precarga copia
Servicio ..> Modelo : aplica RN-01 y protección admin
Modelo ..> Relaciones : RN-02 al inactivar
State "1" o-- "0..*" User
Servicio ..> Resultado
@enduml
```

## CU03 Eliminar Usuario

**Actores:** Administrador autenticado.

**Precondiciones:** Sesión vigente, usuario destino existente y distinto del administrador que opera. La ausencia de dependencias debe comprobarse al confirmar.

**Flujo principal**

1. El administrador selecciona Eliminar y el sistema muestra el nombre de la cuenta y la advertencia de eliminación definitiva.
2. El administrador confirma Eliminar definitivamente.
3. El servicio vuelve a comprobar permiso, existencia, cuenta propia y permanencia de al menos un administrador activo.
4. El sistema consulta relaciones de investigaciones, revisiones, documentos y transacciones registradas, y participantes de todos los catálogos, activos o inactivos.
5. Solo si no existen vínculos ni trazabilidad desconocida, elimina la cuenta y sus recuperaciones pendientes del nuevo estado.
6. Se revalida la sesión y se persiste el resultado. El listado se actualiza y se confirma la eliminación.

**Flujos alternativos y excepciones**

- A1 Existen relaciones: abortar y mostrar «No se puede eliminar el usuario: tiene registros o transacciones asociados», con el detalle disponible.
- A2 Catálogo antiguo sin participantes registrados: bloquear cautelarmente, indicando que no se puede descartar una relación.
- A3 Cuenta propia, último administrador, usuario inexistente o falta de permiso: rechazar.
- A4 Cancelación, sesión vencida o error de persistencia: no eliminar ni informar éxito.

**Postcondiciones:** Éxito: la cuenta sin vínculos deja de existir y sus tokens de recuperación se revocan. Rechazo: cuenta, relaciones y credenciales se conservan.

> **Espacio reservado para captura de interfaz**
>
> Insertar captura del diálogo Eliminar usuario y, si corresponde, del mensaje que impide la operación por dependencias.

### Diagrama de clases específico

```plantuml
@startuml
title Clases específicas Eliminar Usuario
skinparam classAttributeIconSize 0
class "userService.ts" as Servicio <<módulo>> {
  +deleteUser(state, actorId, userId): Resultado
}
class "relations.ts" as Relaciones <<módulo>> {
  +userDependencies(state, userId): string[]
}
class User {
  +id: string
  +role: Role
  +active: boolean
}
class RepositoryLink {
  +userId: string
  +recordId: string
  +kind: investigación o revisión o documento o transacción
}
class CatalogRecord {
  +id: string
  +name: string
  +active: boolean
  +participantIds: string[] opcional
}
class Recovery {
  +userId: string
  +hash: string
  +expiresAt: number
}
class Resultado {
  +exito: boolean
  +mensaje: string
  +datos: State
}
Servicio ..> Relaciones : consulta antes de eliminar
Relaciones ..> RepositoryLink
Relaciones ..> CatalogRecord
User "1" <-- "0..*" RepositoryLink : userId
User "0..*" <-- "0..*" CatalogRecord : participantIds
User "1" <-- "0..*" Recovery : revoca si se elimina
Servicio ..> User : elimina solo sin vínculos
Servicio ..> Resultado
@enduml
```

## CU04 Iniciar Sesión

**Actores:** Usuario registrado de cualquier rol. También aplica a la reautenticación después del bloqueo por inactividad.

**Precondiciones:** Cuenta registrada y almacenamiento accesible. El usuario está en la pantalla de ingreso o en la pantalla de sesión bloqueada.

**Flujo principal**

1. El usuario ingresa su nombre de usuario y contraseña y selecciona Iniciar sesión.
2. El sistema valida los campos y busca la cuenta usando el nombre de usuario normalizado.
3. Comprueba si existe un bloqueo temporal por intentos fallidos y verifica el hash de la contraseña.
4. Con credenciales válidas, verifica que la cuenta esté activa; si está inactiva, aplica RN-03 y no crea sesión.
5. Con cuenta activa, restablece el contador de fallos y persiste el estado. Guarda identidad y vencimiento por pestaña.
6. Abre Inicio con las opciones del rol. En una reautenticación, vuelve a la página anterior previa verificación de permisos.

**Flujos alternativos y excepciones**

- A1 Credenciales incorrectas: mensaje genérico; incrementar fallos de la cuenta encontrada. Tres fallos consecutivos bloquean por 5 minutos.
- A2 Cuenta inactiva con contraseña válida: «Tu cuenta se encuentra inactiva. Contacta con el administrador».
- A3 Bloqueo temporal vigente: informar y no crear sesión, aun con contraseña correcta.
- A4 Tras 10 minutos sin actividad: ocultar páginas privadas y pedir la contraseña de la misma cuenta; Cerrar sesión permite ingresar con otra.
- E1 Error de lectura, escritura o criptografía: mostrar error legible, sin abrir una sesión autenticada.

**Postcondiciones:** Éxito: sesión de pestaña abierta con plazo de 10 minutos renovable por interacción. Rechazo: sin acceso privado; pueden persistirse los intentos fallidos.

> **Espacio reservado para captura de interfaz**
>
> Insertar captura del login o del mensaje de cuenta inactiva, sin mostrar la contraseña.

### Diagrama de clases específico

```plantuml
@startuml
title Clases específicas Iniciar Sesión
skinparam classAttributeIconSize 0
class "userService.ts" as Servicio <<módulo>> {
  +loginUser(state, username, password): Resultado
}
class "model.ts" as Modelo <<módulo>> {
  +authenticate(state, username, password, now)
  +hashPassword(password, salt): string
}
class User {
  +id: string
  +username: string
  +passwordHash: string
  +salt: string
  +active: boolean
  +role: Role
  +failures: number
  +lockedUntil: number
}
class "useSession.ts" as Sesion <<hook>> {
  +session: string
  +locked: boolean
  +deadline: number
  +login(userId)
  +assertActive()
  +logout()
}
class "security.ts" as Seguridad <<módulo>> {
  +INACTIVITY_MINUTES: 10
  +canOpenPage(role, page): boolean
  +sessionExpired(deadline, now): boolean
}
class Resultado {
  +exito: boolean
  +mensaje: string
  +datos: estado e identidad
}
Servicio ..> Modelo : verifica credenciales y RN-03
Modelo ..> User
Servicio ..> Resultado
Sesion --> User : identidad autenticada
Sesion ..> Seguridad : plazo y permisos RN-04
@enduml
```

## actividad crear usuario

```plantuml
@startuml
title Actividad Crear Usuario
start
:Administrador solicita Nuevo usuario;
:Comprobar sesión vigente y permiso;
if (¿Autorizado?) then (sí)
  :Mostrar formulario vacío;
else (no)
  :Mostrar acceso restringido o bloqueo;
  stop
endif
:Ingresar datos y confirmar contraseña;
:Validar obligatorios, formatos y contraseña;
:Comprobar CI, correo y usuario únicos;
if (¿Datos válidos?) then (sí)
  :Crear ID, sal y hash de contraseña;
else (no)
  :Mostrar errores sin registrar la cuenta;
  :Permitir corregir o cancelar;
  stop
endif
:Revalidar sesión y versión local antes de guardar;
if (¿Sesión vigente y datos actuales?) then (sí)
  :Persistir nuevo estado local;
else (no)
  :Abortar y solicitar autenticación o recarga;
  stop
endif
if (¿Persistencia correcta?) then (sí)
  :Actualizar listado y mostrar Usuario creado;
else (no)
  :Mostrar error de almacenamiento sin éxito;
endif
stop
@enduml
```

## actividad editar usuario

```plantuml
@startuml
title Actividad Editar Usuario
start
:Administrador selecciona Editar;
:Comprobar sesión vigente y permiso;
if (¿Autorizado?) then (sí)
  :Consultar usuario actual por ID;
else (no)
  :Rechazar apertura;
  stop
endif
if (¿Existe el usuario?) then (sí)
  :Copiar y precargar datos actuales;
else (no)
  :Mostrar usuario no encontrado;
  stop
endif
if (¿Rol actual Público?) then (sí)
  :Marcar Nombre Completo como solo lectura;
else (no)
  :Habilitar Nombre Completo;
endif
:Mostrar formulario precargado;
:Ingresar cambios o cancelar;
if (¿Confirma guardar?) then (sí)
  :Revalidar permiso, existencia y precarga vigente;
  :Validar formatos, unicidad y RN-01;
  :Si se asigna Público, conservar nombre original;
  :Proteger cuenta propia y último administrador;
  :Si se inactiva, consultar dependencias RN-02;
else (no)
  stop
endif
if (¿Cumple las reglas?) then (sí)
  :Revalidar sesión y versión local;
  :Intentar persistir estado actualizado;
else (no)
  :Mostrar restricción sin aplicar cambios;
  stop
endif
if (¿Guardado correcto?) then (sí)
  :Actualizar listado y confirmar cambios;
else (no)
  :Mostrar error y conservar datos anteriores;
endif
stop
@enduml
```

## Organización del código

UserPages.tsx contiene mantenimiento, perfil y contraseña. AuthPage.tsx presenta login y recuperación. userService.ts expone resultados { exito, mensaje, datos } y captura errores de negocio. model.ts contiene validaciones y derivación de contraseñas. relations.ts consulta dependencias. security.ts define permisos y tiempo. useSession.ts controla bloqueo y reautenticación. storage.ts conserva y migra datos anteriores.

La persistencia se realiza en App.tsx después de recibir un resultado exitoso. Antes de guardar se comprueba que el estado local no haya cambiado desde el inicio de la operación; un fallo no produce un mensaje de éxito. Esta comprobación es defensiva, no una transacción de base de datos entre pestañas.

La sesión vigente continúa al cambiar la contraseña personal. La recuperación local revoca tokens previos; el enlace de demostración vence a los 15 minutos. El bloqueo por intentos fallidos dura 5 minutos, independientemente de los 10 minutos de inactividad.

Las investigaciones, revisiones y documentos aún no tienen pantallas operativas. RepositoryLink define cómo se registrarán sus asociaciones, y las pruebas verifican el rechazo con cada tipo. Los catálogos existentes sí incorporan los identificadores de quienes los crean o modifican; estos participantes se conservan aunque cambie el último editor.

## Guía de validación y defensa

- Pruebas automatizadas: ejecutar npm test. Cubren precarga, RN-01 administrativa y personal, permisos, creación y unicidad, eliminación con y sin relaciones, conservación de participantes, migración, login inactivo, cambios de contraseña, recuperación y límites de inactividad.

- Verificación de interfaz: ingresar como admin, abrir Usuarios y editar publico; el nombre aparece precargado y no editable. Abrir la URL #usuarios con Público debe mostrar Acceso restringido.

- Verificación de eliminación: en un entorno de prueba, crear una cuenta sin relaciones y eliminarla. Después, crear un autor como digitador y comprobar como admin que no se puede eliminar ni inactivar esa cuenta. Los datos de prueba no se incluyen en los datos iniciales del ZIP.

- Verificación de inactividad: iniciar sesión, dejar la pestaña sin teclado, clics, desplazamiento ni interacción táctil durante 10 minutos. Debe aparecer Sesión bloqueada por inactividad. Recargar no debe desbloquear. Una contraseña errónea tampoco; la correcta permite continuar.

- Cuentas iniciales ficticias en un navegador sin datos anteriores: admin, digitador y publico; contraseña inicial compartida Fcea2026!. Si ya se cambió alguna contraseña, se conserva la nueva. No borrar datos existentes para probar la migración.

## Pendientes para el sistema con backend

Backend pendiente: repetir permisos y RN-01 en cada endpoint; consultar y bloquear las relaciones en una transacción; aplicar claves foráneas con restricción de eliminación para usuarios vinculados. No confiar en un contador enviado por el cliente. Resolver concurrencia antes de confirmar la operación.

Seguridad pendiente de servidor: sesiones verificables, expiración e invalidación central, hash apropiado en servidor, recuperación por correo, protección CSRF si se usan cookies y auditoría persistente. El hash local no convierte al navegador en un sistema de autenticación seguro.

La consigna de la segunda evaluación también exige una transacción y su reporte. Esta entrega cubre mantenimiento de usuarios y seguridad del frontend; no declara terminados los módulos de publicaciones, reportes ni backend.

Datos de carátula que debe completar el grupo antes de entregar: nombres y apellidos de integrantes. No se incluyen nombres no confirmados.


Referencia de sintaxis: [documentación oficial de PlantUML](https://plantuml.com/class-diagram). Los seis diagramas se validaron con el renderizador de PlantUML y se incluyen también en formato SVG.
