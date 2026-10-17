import assert from 'node:assert/strict';
import test from 'node:test';
import type { SendMailOptions } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type { AppConfig } from '../../src/config.js';
import { createMailer } from '../../src/security/mailer.js';

const smtp = { host: 'smtp.example.invalid', port: 465, secure: true, user: 'sender', pass: 'PRIVATE_SMTP_PASSWORD', from: 'sender@example.invalid' };
const recipient = 'reader@example.invalid';
const url = 'https://catalogo.example.invalid/?token=private-token&lang=es#reset';

function fixture(withSmtp = true) {
  let options: SMTPTransport.Options | undefined;
  let verifyCalls = 0;
  let closeCalls = 0;
  let verification: () => Promise<boolean> = async () => true;
  let delivery: () => Promise<{ accepted: string[] }> = async () => ({ accepted: [recipient] });
  const messages: SendMailOptions[] = [];
  const checks: { run: () => void; delay: number; cancelled: boolean }[] = [];
  const mailer = createMailer({ smtp: withSmtp ? smtp : undefined } as AppConfig, {
    createTransport(settings) {
      options = settings;
      return {
        async verify() { verifyCalls++; return verification(); },
        async sendMail(message) { messages.push(message); return delivery(); },
        close() { closeCalls++; },
      };
    },
    schedule(run, delay) {
      const check = { run, delay, cancelled: false };
      checks.push(check);
      return () => { check.cancelled = true; };
    },
  });
  return { mailer, messages, checks, get options() { return options; }, get verifyCalls() { return verifyCalls; }, get closeCalls() { return closeCalls; },
    verification(value: typeof verification) { verification = value; }, delivery(value: typeof delivery) { delivery = value; } };
}

test('Sin SMTP no hay transportador, temporizadores ni envíos', async () => {
  const f = fixture(false);
  assert.equal(await f.mailer.verify(), false);
  assert.equal(f.mailer.lastFailure, 'not_configured');
  await assert.rejects(f.mailer.sendRecovery(recipient, url), /SMTP no disponible/);
  await f.mailer.close?.();
  assert.equal(f.options, undefined);
  assert.equal(f.checks.length, 0);
  assert.equal(f.messages.length, 0);
});

test('SMTP exige TLS validado, acota esperas y deshabilita logs y acceso a recursos', async () => {
  const f = fixture();
  assert.deepEqual(f.options?.tls, { minVersion: 'TLSv1.2', rejectUnauthorized: true });
  assert.equal(f.options?.secure, true);
  assert.equal(f.options?.port, 465);
  assert.equal(f.options?.requireTLS, false);
  assert.deepEqual(f.options?.auth, { user: smtp.user, pass: smtp.pass });
  for (const key of ['connectionTimeout', 'greetingTimeout', 'socketTimeout', 'dnsTimeout'] as const) assert.ok(f.options![key]! > 0 && f.options![key]! <= 15000);
  assert.equal(f.options?.logger, false);
  assert.equal(f.options?.debug, false);
  assert.equal(f.options?.disableFileAccess, true);
  assert.equal(f.options?.disableUrlAccess, true);
  await f.mailer.close?.();
  let settings: SMTPTransport.Options | undefined;
  const starttls = createMailer({ smtp: { ...smtp, port: 587, secure: false } } as AppConfig, { createTransport(options) {
    settings = options;
    return { verify: async () => true, sendMail: async () => ({ accepted: [recipient] }), close() {} };
  } });
  assert.equal(settings?.requireTLS, true);
  await starttls.close?.();
});

test('Verificaciones concurrentes comparten conexión y recuperan disponibilidad automáticamente', async () => {
  const f = fixture();
  f.verification(async () => { throw Object.assign(new Error(`535 ${smtp.pass}`), { code: 'EAUTH' }); });
  assert.deepEqual(await Promise.all([f.mailer.verify(), f.mailer.verify(), f.mailer.verify()]), [false, false, false]);
  assert.equal(f.verifyCalls, 1);
  assert.equal(f.mailer.lastFailure, 'authentication');
  assert.equal(f.checks.at(-1)?.delay, 60000);
  await assert.rejects(f.mailer.sendRecovery(recipient, url), /SMTP no disponible/);
  f.verification(async () => true);
  f.checks.at(-1)!.run();
  assert.equal(await f.mailer.verify(), true);
  assert.equal(f.verifyCalls, 2);
  assert.equal(f.mailer.lastFailure, undefined);
  assert.equal(f.checks.at(-1)?.delay, 300000);
  await f.mailer.close?.();
});

test('Correo incluye texto y HTML seguros, enlace idéntico y caducidad de quince minutos', async () => {
  const f = fixture();
  await f.mailer.verify();
  await f.mailer.sendRecovery(recipient, url);
  const message = f.messages[0]!;
  assert.deepEqual(message.from, { name: 'FCEA Datasys', address: smtp.from });
  assert.deepEqual(message.to, { name: '', address: recipient });
  assert.match(String(message.text), /15 minutos/);
  assert.ok(String(message.text).includes(url));
  assert.ok(String(message.html).includes('href="https://catalogo.example.invalid/?token=private-token&amp;lang=es#reset"'));
  assert.match(String(message.html), /lang="es"/);
  assert.match(String(message.html), /Si no solicitaste/);
  assert.equal(message.disableFileAccess, true);
  assert.equal(message.disableUrlAccess, true);
  assert.equal(message.attachments, undefined);
  assert.equal(JSON.stringify(message).includes(smtp.pass), false);
  await f.mailer.close?.();
});

test('Enlaces con protocolos o credenciales inválidos no llegan a SMTP', async () => {
  const f = fixture();
  await f.mailer.verify();
  for (const invalid of ['javascript:alert(1)', 'https://user:secret@catalogo.example.invalid/reset', 'invalid']) await assert.rejects(f.mailer.sendRecovery(recipient, invalid));
  assert.equal(f.messages.length, 0);
  assert.equal(f.mailer.available, true);
  await f.mailer.close?.();
});

test('Fallo SMTP no expone secretos ni reenvía un mensaje con aceptación incierta', async () => {
  const f = fixture();
  await f.mailer.verify();
  f.delivery(async () => { throw Object.assign(new Error(`SMTP ${smtp.pass} ${url} ${recipient}`), { code: 'ETIMEDOUT' }); });
  await assert.rejects(f.mailer.sendRecovery(recipient, url), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'No se pudo entregar el correo de recuperación.');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(f.mailer.available, false);
  assert.equal(f.mailer.lastFailure, 'connection');
  assert.equal(f.checks.at(-1)?.delay, 60000);
  f.checks.at(-1)!.run();
  assert.equal(await f.mailer.verify(), true);
  assert.equal(f.messages.length, 1);
  f.delivery(async () => ({ accepted: [recipient] }));
  await f.mailer.sendRecovery(recipient, url);
  assert.equal(f.messages.length, 2);
  await f.mailer.close?.();
});

test('Destinatario rechazado o aceptación de otra dirección falla sin desactivar SMTP', async () => {
  const f = fixture();
  await f.mailer.verify();
  for (const result of [[], ['another@example.invalid']]) {
    f.delivery(async () => ({ accepted: result }));
    await assert.rejects(f.mailer.sendRecovery(recipient, url));
    assert.equal(f.mailer.available, true);
    assert.equal(f.mailer.lastFailure, 'recipient');
  }
  f.delivery(async () => { throw Object.assign(new Error('550 Rejected'), { code: 'EENVELOPE' }); });
  await assert.rejects(f.mailer.sendRecovery(recipient, url));
  assert.equal(f.mailer.available, true);
  await f.mailer.close?.();
});

test('Una verificación atrasada no oculta un fallo de entrega más reciente', async () => {
  const f = fixture();
  await f.mailer.verify();
  let finish!: (value: boolean) => void;
  f.verification(() => new Promise(resolve => { finish = resolve; }));
  const checking = f.mailer.verify();
  await Promise.resolve();
  f.delivery(async () => { throw Object.assign(new Error('Error de red'), { code: 'ECONNECTION' }); });
  await assert.rejects(f.mailer.sendRecovery(recipient, url));
  finish(true);
  assert.equal(await checking, false);
  assert.equal(f.mailer.lastFailure, 'connection');
  await f.mailer.close?.();
});

test('Cierre cancela temporizador y espera la verificación sin reabrir el transportador', async () => {
  const f = fixture();
  await f.mailer.verify();
  let finish!: (value: boolean) => void;
  f.verification(() => new Promise(resolve => { finish = resolve; }));
  const checking = f.mailer.verify();
  await Promise.resolve();
  assert.ok(f.checks.every(check => check.cancelled));
  const closing = f.mailer.close!();
  assert.equal(f.closeCalls, 0);
  finish(true);
  assert.equal(await checking, false);
  await closing;
  assert.equal(f.closeCalls, 1);
  assert.equal(f.mailer.available, false);
  assert.equal(await f.mailer.verify(), false);
  await assert.rejects(f.mailer.sendRecovery(recipient, url));
  assert.ok(f.checks.every(check => check.cancelled));
});
