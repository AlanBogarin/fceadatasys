# FCEA-Datasys · Cliente

Cliente React + TypeScript + Vite del catálogo bibliográfico FCEA/UNC. **Continúa con backend simulado, sin conexión a server/**.

La [revisión conjunta de preparación para la integración](../docs/REVISION-PREPARACION-INTEGRACION-2026-10-17.md) contrasta las pantallas con los endpoints existentes. Las tres diferencias detectadas se corrigieron en la [implementación de H1–H3](../docs/IMPLEMENTACION-H1-H2-H3-2026-10-17.md), separada del trabajo de conexión futura.

Las adaptaciones para la integración futura están implementadas en servicios asíncronos: DTO seguros, sesión única entre pestañas, plazos y actividad, confirmación de cambios, versiones de registros, errores por campo, consultas paginadas, carga por identificador y exportaciones con snapshot. Incluye edición e inactivación de publicaciones, formatos PDF/TXT configurables y campos opcionales acordes al contrato maestro.

El detalle de la tabla, archivos, contratos, validaciones y límites está en [Adaptaciones del cliente](docs/ADAPTACIONES-CLIENTE.md). Esa guía describe el estado vigente; los documentos anteriores son antecedentes fechados.

## Ejecutar

Requiere Node.js compatible con Vite 7 (el proyecto se comprobó con Node 24).

```powershell
cd client
npm install
npm run dev
```

Abrir la dirección indicada por Vite. No hace falta iniciar el servidor. La configuración de ejemplo está en [.env.example](.env.example); el modo predeterminado es mock. El modo api permanece bloqueado hasta implementar el transporte HTTP.

## Cuentas ficticias iniciales

| Usuario   | Rol           | Contraseña de demostración |
| --------- | ------------- | -------------------------- |
| admin     | Administrador | Fcea2026!                  |
| digitador | Digitador     | Fcea2026!                  |
| publico   | Público       | Fcea2026!                  |

Son cuentas del simulador, independientes del servidor. En una instalación nueva se incluyen muestras UNC identificadas como demo: personas y trabajos ficticios y PDF estáticos de ejemplo. Inicio permite actualizar las muestras sin reemplazar registros propios.

Una cuenta activa se comparte entre las pestañas del mismo origen. Cerrar sesión en una la cierra en todas. Tras diez minutos sin interacción se exige autenticación. Tres fallos consecutivos de login bloquean la cuenta por cinco minutos; tres contraseñas de confirmación incorrectas cierran la sesión compartida.

## Datos y permisos

Los metadatos y cuentas ficticias persisten en localStorage; los archivos cargados, en IndexedDB. Mantener el mismo navegador, host y puerto para recuperar los datos. La migración conserva registros anteriores. El almacenamiento local sigue siendo manipulable y no constituye seguridad de producción.

Administrador mantiene usuarios, publicaciones, catálogos, parámetros, reportes y auditoría. Digitador registra/edita publicaciones y mantiene autores/tutores. Público consulta metadatos de publicaciones activas y no descarga adjuntos. La evaluación académica ocurre fuera del sistema.

Las altas piden confirmación visual; modificar/inactivar/eliminar requiere la contraseña vigente del actor. Cancelar conserva el formulario. Los conflictos de versión exigen revisar los valores actuales antes de volver a guardar. Los reportes vacíos no generan archivos.

## Validación

```powershell
npm test
npm run build
```

Suite actual: **87 pruebas**. La guía de adaptaciones incluye el recorrido verificado en dos pestañas y los límites que corresponden al futuro adaptador HTTP.

## Documentación anterior

- [Auditoría y parámetros](docs/AUDITORIA-Y-PARAMETROS.md)
- [Carga de archivos](docs/CARGA-DE-ARCHIVOS.md)
- [Transacción y reporte](docs/TRANSACCION-Y-REPORTE.md)
- [Datos de demostración](docs/DATOS-DE-DEMOSTRACION.md)
- [Usuarios y seguridad](docs/usuarios-seguridad/Casos-de-uso-y-reglas.md)
