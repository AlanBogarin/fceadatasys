import { loadConfig } from '../src/config.js';
import { createMailer, type MailerFailure } from '../src/security/mailer.js';

const instructions: Record<MailerFailure, string> = {
  not_configured: 'Falta configurar SMTP_HOST y SMTP_FROM.',
  authentication: 'Autenticación rechazada. Revisar SMTP_USER y la contraseña de aplicación SMTP_PASS.',
  tls: 'No se pudo validar TLS. Revisar certificados y configuración del servicio SMTP.',
  connection: 'No se pudo conectar. Revisar DNS, red, puerto y TLS del servicio SMTP.',
  recipient: 'El servicio rechazó el destinatario.',
  delivery: 'El servicio SMTP no está disponible. Revisar su configuración y estado.',
};

async function main() {
  const mailer = createMailer(loadConfig());
  try {
    if (await mailer.verify()) console.log('SMTP verificado: conexión TLS y autenticación disponibles. No se envió ningún correo.');
    else { console.error(instructions[mailer.lastFailure ?? 'delivery']); process.exitCode = 1; }
  } finally { await mailer.close?.(); }
}

main().catch(() => {
  // Never print SMTP errors, environment values or recovery links.
  console.error('No se pudo verificar SMTP. Revisar las variables de configuración del servidor.');
  process.exitCode = 1;
});
