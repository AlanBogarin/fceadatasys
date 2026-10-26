import { z } from 'zod';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  allowedOrigins: string[];
  secureCookies: boolean;
  trustedProxies?: string[];
  recoveryUrl: string;
  smtp?: { host: string; port: number; user?: string; pass?: string; from: string; secure: boolean };
  attachments?: { directory: string; command: string; database?: string; timeoutMs: number; maxSignatureAgeDays: number; concurrency: number };
  backups?: { configFile: string };
}

const booleanEnv = z.enum(['true', 'false']).transform(value => value === 'true');
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url().refine(value => /^postgres(ql)?:/.test(value)),
  JWT_SECRET: z.string().min(32).refine(value => !/replace-with|CHANGE_ME/i.test(value), 'Debe configurar un secreto aleatorio.'),
  JWT_ISSUER: z.string().min(1).default('fceadatasys'),
  JWT_AUDIENCE: z.string().min(1).default('fceadatasys-client'),
  ALLOWED_ORIGINS: z.string().min(1),
  SECURE_COOKIES: booleanEnv.default(true),
  TRUSTED_PROXIES: z.string().default(''),
  RECOVERY_URL: z.url(),
  SMTP_HOST: z.string().trim().min(1).max(253).refine(value => !/[\s/@?#]/.test(value)).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM: z.email().optional(),
  SMTP_SECURE: booleanEnv.default(false),
  ATTACHMENT_DIRECTORY: z.string().min(1).default('.local/attachments'),
  CLAMAV_COMMAND: z.string().min(1).default(process.platform === 'win32' ? 'C:\\Program Files\\ClamAV\\clamscan.exe' : 'clamscan'),
  CLAMAV_DATABASE_DIR: z.string().min(1).default('.local/clamav/database'),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(120000),
  CLAMAV_MAX_SIGNATURE_AGE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  ATTACHMENT_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  BACKUP_CONFIG_FILE: z.string().min(1).optional(),
});

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(environment);
  // No imprimir valores de entorno: podrían contener credenciales.
  if (!result.success) throw new Error(`Configuración inválida: ${result.error.issues.map(issue => issue.path.join('.')).join(', ')}.`);
  const env = result.data;
  const trustedProxies = env.TRUSTED_PROXIES ? env.TRUSTED_PROXIES.split(',').map(value => value.trim()) : [];
  if (trustedProxies.some(value => !['127.0.0.1', '::1'].includes(value))) throw new Error('TRUSTED_PROXIES admite únicamente el proxy local 127.0.0.1 o ::1.');
  const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
  for (const origin of allowedOrigins) {
    const url = URL.parse(origin);
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('ALLOWED_ORIGINS debe contener orígenes HTTP/HTTPS exactos.');
    if (env.NODE_ENV === 'production' && url.protocol !== 'https:') throw new Error('Los orígenes de producción requieren HTTPS.');
  }
  if (env.NODE_ENV === 'production' && (!env.SECURE_COOKIES || !env.RECOVERY_URL.startsWith('https://'))) throw new Error('Producción requiere cookies Secure y RECOVERY_URL HTTPS.');
  const recoveryUrl = new URL(env.RECOVERY_URL);
  if (!['http:', 'https:'].includes(recoveryUrl.protocol) || recoveryUrl.username || recoveryUrl.password) throw new Error('RECOVERY_URL debe ser HTTP/HTTPS y no incluir credenciales.');
  if (!env.SMTP_HOST && (env.SMTP_FROM || env.SMTP_USER || env.SMTP_PASS)) throw new Error('Configuración SMTP incompleta: falta SMTP_HOST.');
  if (env.SMTP_HOST && (!env.SMTP_FROM || Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS))) throw new Error('Configuración SMTP incompleta.');
  if (env.SMTP_HOST && env.SMTP_PORT === 465 && !env.SMTP_SECURE) throw new Error('SMTP_PORT 465 requiere SMTP_SECURE=true.');
  return {
    nodeEnv: env.NODE_ENV, host: env.HOST, port: env.PORT, databaseUrl: env.DATABASE_URL,
    backups: env.BACKUP_CONFIG_FILE ? { configFile: env.BACKUP_CONFIG_FILE } : undefined,
    jwtSecret: env.JWT_SECRET, jwtIssuer: env.JWT_ISSUER, jwtAudience: env.JWT_AUDIENCE,
    allowedOrigins, secureCookies: env.SECURE_COOKIES, recoveryUrl: env.RECOVERY_URL, trustedProxies,
    smtp: env.SMTP_HOST ? { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.SMTP_FROM!, secure: env.SMTP_SECURE } : undefined,
    attachments: { directory: env.ATTACHMENT_DIRECTORY, command: env.CLAMAV_COMMAND, database: env.CLAMAV_DATABASE_DIR, timeoutMs: env.CLAMAV_TIMEOUT_MS, maxSignatureAgeDays: env.CLAMAV_MAX_SIGNATURE_AGE_DAYS, concurrency: env.ATTACHMENT_CONCURRENCY },
  };
}
