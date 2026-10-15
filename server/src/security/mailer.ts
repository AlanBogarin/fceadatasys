import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';

export interface Mailer {
  available: boolean;
  verify(): Promise<boolean>;
  sendRecovery(email: string, url: string): Promise<void>;
}

export function createMailer(config: AppConfig): Mailer {
  const smtp = config.smtp;
  const transport = smtp ? nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.secure,
    ...(smtp.user && smtp.pass ? { auth: { user: smtp.user, pass: smtp.pass } } : {}),
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000,
  }) : undefined;
  return {
    available: false,
    async verify() {
      try { this.available = !!transport && await transport.verify(); } catch { this.available = false; }
      return this.available;
    },
    async sendRecovery(email, url) {
      if (!transport || !this.available || !smtp) throw new Error('SMTP no disponible');
      try {
        await transport.sendMail({ from: smtp.from, to: email, subject: 'Restablecer contraseña — FCEA Datasys',
          text: `Para restablecer tu contraseña abre este enlace (vence en 15 minutos):\n${url}\nSi no solicitaste este cambio, ignora este correo.` });
      } catch { this.available = false; throw new Error('SMTP no disponible'); }
    },
  };
}
