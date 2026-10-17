# Correo de recuperación

El servidor envía instrucciones de restablecimiento de contraseña. No recibe correo, no necesita POP/IMAP y no envía contraseñas por email. El cliente continúa con backend simulado: ya interpreta `token` de la query y lo retira del historial visible. Para usar el correo real deberá consumir los endpoints de recuperación/reset documentados en [API.md](API.md).

## Configuración

Solo en `server/.env` (ignorado por Git), o mediante variables del entorno de ejecución:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=correo-institucional@gmail.com
SMTP_PASS=CONTRASENA_DE_APLICACION
SMTP_FROM=correo-institucional@gmail.com
RECOVERY_URL=http://localhost:5173/#reset
```

Reemplazar usuario/remitente y secreto con la cuenta autorizada. Para Gmail usar contraseña de aplicación; copiar sus 16 caracteres sin los espacios de presentación. No guardar secretos en ejemplos, fixtures, scripts ni documentación. `SMTP_FROM` debe corresponder a la cuenta autenticada o a un remitente autorizado por el proveedor. La configuración local suministrada por el responsable se guarda únicamente en `.env`.

`SMTP_SECURE=true` activa TLS desde la conexión (Gmail 465). Para proveedores con STARTTLS usar su host, puerto 587 y `SMTP_SECURE=false`; STARTTLS sigue siendo obligatorio. Se validan certificados y TLS >=1.2. El servidor rechaza el puerto 465 sin TLS implícito, credenciales incompletas, credenciales sin host y enlaces de recuperación ajenos a HTTP/HTTPS o con usuario/contraseña. No desactivar validaciones de certificados para resolver errores de conexión.

`RECOVERY_URL` debe apuntar a la pantalla de restablecimiento del cliente; su transporte HTTP sigue pendiente. El servidor añade `token` a la query, antes del fragmento si existe. Producción requiere HTTPS y la URL real del frontend. Los cambios en `.env` requieren reiniciar el proceso; una caída temporal del servicio se recupera sin reinicio.

## Verificación y operación

Desde `server/` ejecutar `npm run mail:check`. Carga `.env`, comprueba DNS/conexión/TLS/autenticación y sale con código 0 si SMTP está disponible, 1 si falla. No conecta a PostgreSQL ni envía correos. Requiere la configuración válida del servidor. El diagnóstico muestra categorías seguras de fallo; nunca imprime valores de entorno ni excepciones del proveedor.

La API comprueba SMTP al iniciar, cada cinco minutos si está disponible y cada minuto durante una caída. Comparte verificaciones concurrentes, no espera SMTP en las respuestas de recuperación y sigue disponible si el correo falla. Administrador puede consultar `GET /api/v1/status`; disponibilidad SMTP no demuestra recepción en bandeja de entrada. Revisar autenticación/contraseña de aplicación si se rechaza el acceso; para errores de conexión revisar DNS, salida TCP 465/587 y configuración TLS. Los mensajes SMTP no se registran.

El correo incluye texto y HTML sin adjuntos ni recursos remotos, con enlace único, vigencia de quince minutos y aviso para solicitudes no reconocidas. El plazo de plantilla y token se obtiene de la misma constante. Se escapa el enlace para HTML. El reset consume el enlace y revoca sesiones según API.md.

## Entrega, auditoría y límites

La solicitud, límites y hash del token se confirman con su auditoría antes de enviar; si falla esa transacción no se genera un correo. La respuesta pública siempre es genérica. El token crudo existe solo en la tarea de memoria (hasta cien pendientes por proceso), nunca se devuelve por API, registra ni persiste en texto plano. Ante rechazo/error de entrega se invalida el token y se audita `RECUPERACION_ENVIO_FALLIDO`. Un destinatario rechazado no inhabilita envíos a los demás.

El cierre ordenado espera entregas y compensaciones y libera el transportador y temporizadores. Un cierre abrupto puede perder una tarea. No se reenvía un mensaje fallido automáticamente porque SMTP pudo aceptarlo antes de desconectarse; se solicita un enlace nuevo una vez recuperado el servicio, sujeto al límite de tres solicitudes por correo/IP/hora. No hay cola durable ni confirmación de recepción: un proveedor puede aceptar un correo y después filtrarlo o rebotarlo. Una futura cola durable deberá cifrar secretos y definir retención/gestión de claves (ver [SECURITY.md](SECURITY.md)).

Referencias de proveedor: [SMTP de Nodemailer](https://nodemailer.com/smtp) y [contraseñas de aplicación de Google](https://support.google.com/accounts/answer/185833?hl=es).
