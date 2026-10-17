import nodemailer from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { AppConfig } from '../config.js';

export const RECOVERY_TTL_MINUTES = 15;
export type MailerFailure = 'not_configured' | 'authentication' | 'tls' | 'connection' | 'recipient' | 'delivery';

export interface Mailer {
  available: boolean;
  readonly lastFailure?: MailerFailure;
  verify(): Promise<boolean>;
  sendRecovery(email: string, url: string): Promise<void>;
  close?(): Promise<void>;
}

interface MailTransport {
  verify(): Promise<boolean>;
  sendMail(message: SendMailOptions): Promise<Pick<SMTPTransport.SentMessageInfo, 'accepted'>>;
  close(): void;
}

interface MailerDependencies {
  createTransport?: (options: SMTPTransport.Options) => MailTransport;
  schedule?: (check: () => void, delayMs: number) => () => void;
}

const scheduleCheck: NonNullable<MailerDependencies['schedule']> = (check, delayMs) => {
  const timer = setTimeout(check, delayMs);
  timer.unref();
  return () => clearTimeout(timer);
};

function failureCategory(error: unknown): MailerFailure {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'EAUTH') return 'authentication';
  if (code === 'ETLS' || (typeof code === 'string' && /CERT|TLS|SELF_SIGNED/.test(code))) return 'tls';
  if (code === 'EENVELOPE') return 'recipient';
  if (['ECONNECTION', 'ECONNRESET', 'ECONNREFUSED', 'EDNS', 'ETIMEDOUT', 'ESOCKET'].includes(String(code))) return 'connection';
  return 'delivery';
}

function recoveryMessage(from: string, email: string, url: string): SendMailOptions {
  const link = new URL(url);
  if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password) throw new Error('Enlace de recuperación inválido.');
  const safeUrl = link.toString().replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return {
    from: { name: 'FCEA Datasys', address: from }, to: { name: '', address: email },
    subject: 'Restablecer contraseña — FCEA Datasys',
    text: `FCEA — Universidad Nacional de Concepción\n\nRecibimos una solicitud para restablecer tu contraseña.\nAbre este enlace (vence en ${RECOVERY_TTL_MINUTES} minutos y solo puede utilizarse una vez):\n${link}\n\nSi no solicitaste este cambio, ignora este correo. Tu contraseña no se modificará.\nNo compartas este enlace.`,
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Restablecer contraseña</title></head><body><h1>Restablecer contraseña</h1><p>FCEA — Universidad Nacional de Concepción</p><p>Recibimos una solicitud para restablecer tu contraseña.</p><p><a href="${safeUrl}">Restablecer mi contraseña</a></p><p>El enlace vence en ${RECOVERY_TTL_MINUTES} minutos y solo puede utilizarse una vez.</p><p>Si el enlace no abre, copia esta dirección en tu navegador:<br>${safeUrl}</p><p>Si no solicitaste este cambio, ignora este correo. Tu contraseña no se modificará.</p><p>No compartas este enlace.</p></body></html>`,
    disableFileAccess: true, disableUrlAccess: true,
  };
}

export function createMailer(config: AppConfig, dependencies: MailerDependencies = {}): Mailer {
  const smtp = config.smtp;
  const transport = smtp ? (dependencies.createTransport ?? nodemailer.createTransport)({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    requireTLS: !smtp.secure, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    ...(smtp.user && smtp.pass ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, dnsTimeout: 5000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  }) : undefined;
  const schedule = dependencies.schedule ?? scheduleCheck;
  let cancelCheck: (() => void) | undefined;
  let verifying: Promise<boolean> | undefined;
  let closed = false;
  let revision = 0;
  let lastFailure: MailerFailure | undefined = smtp ? undefined : 'not_configured';
  const queueCheck = () => {
    cancelCheck?.();
    cancelCheck = undefined;
    if (!closed && transport) cancelCheck = schedule(() => { void mailer.verify(); }, mailer.available ? 300000 : 60000);
  };
  const mailer: Mailer = {
    available: false,
    get lastFailure() { return lastFailure; },
    verify() {
      if (closed || !transport) return Promise.resolve(false);
      if (verifying) return verifying;
      cancelCheck?.();
      const observedRevision = revision;
      verifying = Promise.resolve().then(() => transport.verify()).then(success => {
        if (!closed && observedRevision === revision) {
          mailer.available = !!success;
          lastFailure = success ? undefined : 'connection';
        }
        return mailer.available;
      }, error => {
        if (!closed && observedRevision === revision) { mailer.available = false; lastFailure = failureCategory(error); }
        return mailer.available;
      }).finally(() => { verifying = undefined; queueCheck(); });
      return verifying;
    },
    async sendRecovery(email, url) {
      if (closed || !transport || !mailer.available || !smtp) throw new Error('SMTP no disponible');
      const message = recoveryMessage(smtp.from, email, url);
      try {
        const result = await transport.sendMail(message);
        if (!result.accepted.some(address => address.toLowerCase() === email.toLowerCase())) {
          throw Object.assign(new Error('Destinatario rechazado.'), { code: 'EENVELOPE' });
        }
        revision++;
        if (!closed) { mailer.available = true; lastFailure = undefined; }
      } catch (error) {
        revision++;
        lastFailure = failureCategory(error);
        // A rejected recipient does not mean SMTP is down for every other account.
        if (lastFailure !== 'recipient') mailer.available = false;
        // Do not retry a message: the server may have accepted DATA before disconnecting.
        throw new Error('No se pudo entregar el correo de recuperación.');
      } finally { queueCheck(); }
    },
    async close() {
      closed = true;
      mailer.available = false;
      cancelCheck?.();
      await verifying;
      transport?.close();
    },
  };
  return mailer;
}
