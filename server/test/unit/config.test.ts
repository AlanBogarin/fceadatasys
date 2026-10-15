import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';

const environment = { DATABASE_URL: 'postgresql://unit:db-secret@localhost/unit', JWT_SECRET: 'unit-secret-'.repeat(5), ALLOWED_ORIGINS: 'http://localhost:5173', RECOVERY_URL: 'http://localhost:5173/reset', SECURE_COOKIES: 'false' };

test('Configuración usa el entorno inyectado sin mutarlo y aplica predeterminados', () => {
  const input = Object.freeze({ ...environment, UNRELATED_ENV: 'ignored' });
  const result = loadConfig(input);
  assert.equal(result.nodeEnv, 'development');
  assert.equal(result.host, '127.0.0.1');
  assert.equal(result.port, 3000);
  assert.equal(result.secureCookies, false);
  assert.equal(result.smtp, undefined);
  assert.deepEqual(result.allowedOrigins, ['http://localhost:5173']);
  result.allowedOrigins.push('https://other.example.org');
  assert.deepEqual(loadConfig(input).allowedOrigins, ['http://localhost:5173']);
  assert.equal(input.ALLOWED_ORIGINS, environment.ALLOWED_ORIGINS);
});

test('Orígenes exactos múltiples son válidos; comodines, credenciales, paths y lista vacía no', () => {
  assert.deepEqual(loadConfig({ ...environment, ALLOWED_ORIGINS: 'http://localhost:5173, https://catalogo.example.org' }).allowedOrigins, ['http://localhost:5173', 'https://catalogo.example.org']);
  for (const origin of ['', '*', 'null', 'http://localhost:5173/', 'https://u:p@example.org', 'https://example.org/path', 'https://example.org?q=1', 'ftp://example.org', 'https://example.org,']) assert.throws(() => loadConfig({ ...environment, ALLOWED_ORIGINS: origin }), Error, origin);
});

test('Producción exige HTTPS para orígenes y recuperación y cookies Secure', () => {
  const production = { ...environment, NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://catalogo.example.org', RECOVERY_URL: 'https://catalogo.example.org/reset', SECURE_COOKIES: 'true' };
  assert.equal(loadConfig(production).secureCookies, true);
  for (const change of [{ SECURE_COOKIES: 'false' }, { ALLOWED_ORIGINS: 'http://catalogo.example.org' }, { RECOVERY_URL: 'http://catalogo.example.org/reset' }]) assert.throws(() => loadConfig({ ...production, ...change }));
});

test('Campos requeridos, puertos, booleanos y protocolo PostgreSQL se validan', () => {
  for (const change of [{ DATABASE_URL: undefined }, { DATABASE_URL: 'https://example.org' }, { JWT_SECRET: 'short' }, { JWT_SECRET: 'replace-with-a-random-secret-at-least-32-characters' }, { JWT_SECRET: 'CHANGE_ME'.repeat(5) }, { PORT: '0' }, { PORT: '65536' }, { PORT: '1.5' }, { SECURE_COOKIES: 'yes' }, { NODE_ENV: 'staging' }, { RECOVERY_URL: 'not a url' }]) assert.throws(() => loadConfig({ ...environment, ...change }));
  assert.equal(loadConfig({ ...environment, PORT: '65535' }).port, 65535);
});

test('SMTP admite relay sin credenciales o par completo, rechaza configuración incompleta', () => {
  const smtp = { SMTP_HOST: 'mail.example.org', SMTP_FROM: 'repository@example.org' };
  assert.deepEqual(loadConfig({ ...environment, ...smtp }).smtp, { host: smtp.SMTP_HOST, from: smtp.SMTP_FROM, port: 587, secure: false, user: undefined, pass: undefined });
  assert.deepEqual(loadConfig({ ...environment, ...smtp, SMTP_USER: 'operator', SMTP_PASS: 'smtp-secret', SMTP_PORT: '465', SMTP_SECURE: 'true' }).smtp, { host: smtp.SMTP_HOST, from: smtp.SMTP_FROM, port: 465, secure: true, user: 'operator', pass: 'smtp-secret' });
  for (const change of [{ SMTP_FROM: undefined }, { SMTP_USER: 'operator' }, { SMTP_PASS: 'smtp-secret' }, { SMTP_FROM: 'bad-email' }, { SMTP_PORT: '65536' }, { SMTP_SECURE: 'yes' }]) assert.throws(() => loadConfig({ ...environment, ...smtp, ...change }));
});

test('Errores de configuración identifican campos sin revelar valores secretos', () => {
  const secret = 'SENSITIVE_DATABASE_PASSWORD';
  const smtpSecret = 'SENSITIVE_SMTP_PASSWORD';
  try {
    loadConfig({ ...environment, DATABASE_URL: `invalid:${secret}`, JWT_SECRET: 'SENSITIVE_JWT_SHORT', SMTP_PASS: smtpSecret, SMTP_PORT: 'bad' });
    assert.fail('Se esperaba rechazo de configuración.');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.match(error.message, /DATABASE_URL/);
    assert.match(error.message, /JWT_SECRET/);
    assert.match(error.message, /SMTP_PORT/);
    for (const value of [secret, smtpSecret, 'SENSITIVE_JWT_SHORT']) assert.equal(error.message.includes(value), false);
  }
});
