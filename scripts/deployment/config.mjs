import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";

export const secret = () => randomBytes(36).toString("base64url");
export function defaults(root, profile) {
  const demo = profile === "demo";
  const database = demo ? "fceadatasys_demo" : "fceadatasys_production";
  const port = demo ? 55440 : 5432;
  const owner = demo ? "fcea_demo_owner" : "fcea_production_owner";
  const runtime = demo ? "fcea_demo_app" : "fcea_production_app";
  const ownerPassword = secret(),
    runtimePassword = secret();
  return {
    PROFILE: profile,
    PUBLIC_URL: demo ? "http://127.0.0.1:8080" : "https://CAMBIAR_DOMINIO",
    WEB_HOST: demo ? "127.0.0.1" : "0.0.0.0",
    API_PORT: demo ? "3001" : "3000",
    MANAGE_POSTGRES: demo ? "true" : "false",
    PG_BIN_DIRECTORY:
      process.platform === "win32" ? "C:/Program Files/PostgreSQL/18/bin" : "",
    PG_DATA_DIRECTORY: `.local/deploy/${profile}/postgres-data`,
    DATABASE_URL: `postgresql://${runtime}:${runtimePassword}@127.0.0.1:${port}/${database}`,
    MIGRATION_DATABASE_URL: `postgresql://${owner}:${ownerPassword}@127.0.0.1:${port}/${database}`,
    PG_ADMIN_URL: "",
    JWT_SECRET: secret(),
    TLS_CERT_FILE: "",
    TLS_KEY_FILE: "",
    ATTACHMENT_DIRECTORY: `server/.local/${profile}/attachments`,
    CLAMAV_COMMAND:
      process.platform === "win32"
        ? "C:/Program Files/ClamAV/clamscan.exe"
        : "clamscan",
    CLAMAV_DATABASE_DIR: "server/.local/clamav/database",
    CLAMAV_TIMEOUT_MS: "120000",
    CLAMAV_MAX_SIGNATURE_AGE_DAYS: "7",
    ATTACHMENT_CONCURRENCY: "2",
    DEMO_ADMIN_PASSWORD: "Fcea2026!",
    DEMO_DIGITADOR_PASSWORD: "Fcea2026!",
    DEMO_PUBLICO_PASSWORD: "Fcea2026!",
    BOOTSTRAP_ADMIN_NAME: "Administrador",
    BOOTSTRAP_ADMIN_CI: "0000000",
    BOOTSTRAP_ADMIN_USERNAME: "admin",
    BOOTSTRAP_ADMIN_EMAIL: "",
    BOOTSTRAP_ADMIN_PASSWORD: "",
    SMTP_HOST: "",
    SMTP_PORT: "587",
    SMTP_USER: "",
    SMTP_PASS: "",
    SMTP_FROM: "",
    SMTP_SECURE: "false",
  };
}
export function writeConfig(file, values) {
  mkdirSync(dirname(file), { recursive: true });
  const lines = Object.entries(values).map(([key, value]) => {
    value = String(value);
    if (/[\r\n\0]/.test(value)) throw Error(`Configuración inválida: ${key}.`);
    const quote = ['"', "'", "`"].find(
      (character) => !value.includes(character),
    );
    if (!quote)
      throw Error(`Configuración inválida: revisar comillas de ${key}.`);
    return `${key}=${quote}${value}${quote}`;
  });
  writeFileSync(
    file,
    "# Configuración local privada. No compartir ni versionar.\n" +
      lines.join("\n") +
      "\n",
    { mode: 0o600 },
  );
  chmodSync(file, 0o600);
}
export const readConfig = (file) => parseEnv(readFileSync(file, "utf8"));
export const localPath = (root, value) =>
  isAbsolute(value) ? value : resolve(root, value);
export function validateConfig(root, input, profile, { initial = false } = {}) {
  const required = (key) => {
    if (!input[key]?.trim()) throw Error(`Falta configuración: ${key}.`);
    return input[key];
  };
  if (!["demo", "production"].includes(profile) || input.PROFILE !== profile)
    throw Error("Perfil inválido: elegir demo o production.");
  const publicUrl = new URL(required("PUBLIC_URL"));
  if (
    !["http:", "https:"].includes(publicUrl.protocol) ||
    publicUrl.origin !== input.PUBLIC_URL ||
    publicUrl.username ||
    publicUrl.password ||
    /CAMBIAR|example\.invalid/i.test(input.PUBLIC_URL)
  )
    throw Error("PUBLIC_URL debe ser un origen real sin ruta ni barra final.");
  if (profile === "production" && publicUrl.protocol !== "https:")
    throw Error("Producción requiere HTTPS y certificados.");
  if (!["true", "false"].includes(input.MANAGE_POSTGRES))
    throw Error("MANAGE_POSTGRES debe ser true o false.");
  if (profile === "production" && input.MANAGE_POSTGRES === "true")
    throw Error(
      "Producción utiliza un servicio PostgreSQL administrado, no el clúster local demo.",
    );
  if (
    !/^\d+$/.test(input.API_PORT) ||
    +input.API_PORT < 1 ||
    +input.API_PORT > 65535
  )
    throw Error("API_PORT inválido.");
  if (
    +input.API_PORT ===
    +(publicUrl.port || (publicUrl.protocol === "https:" ? 443 : 80))
  )
    throw Error("La API y la web requieren puertos distintos.");
  if (
    required("JWT_SECRET").length < 32 ||
    /replace-with|CHANGE_ME/.test(input.JWT_SECRET)
  )
    throw Error(
      "JWT_SECRET requiere un secreto propio de al menos 32 caracteres.",
    );
  const runtime = new URL(required("DATABASE_URL"));
  const owner = new URL(required("MIGRATION_DATABASE_URL"));
  for (const url of [runtime, owner]) {
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !/^\/[a-z][a-z0-9_]*$/.test(url.pathname) ||
      !/^[a-z][a-z0-9_]*$/.test(decodeURIComponent(url.username)) ||
      url.search ||
      url.hash
    )
      throw Error("Revisar URLs PostgreSQL, nombres de base y roles.");
    if (
      (profile === "production" && !url.password) ||
      /CHANGE_ME/.test(decodeURIComponent(url.password))
    )
      throw Error("Revisar contraseñas propias en las URLs PostgreSQL.");
  }
  if (
    runtime.host !== owner.host ||
    runtime.pathname !== owner.pathname ||
    runtime.username === owner.username
  )
    throw Error(
      "Migraciones y runtime deben apuntar a la misma base con roles distintos.",
    );
  const name = runtime.pathname.slice(1);
  if (
    profile === "demo" &&
    (!["127.0.0.1", "localhost", "[::1]"].includes(runtime.hostname) ||
      !/^fceadatasys_(?:[a-z0-9]+_)*demo(?:_test)?$/.test(name))
  )
    throw Error(
      "Demo requiere una base local exclusiva terminada en _demo o _demo_test.",
    );
  if (
    profile === "production" &&
    /(?:^|_)demo(?:_|$)|(?:^|_)test(?:_|$)/.test(name)
  )
    throw Error("Producción rechaza bases demo o de pruebas.");
  if (input.PG_ADMIN_URL) {
    const admin = new URL(input.PG_ADMIN_URL);
    if (
      !["postgres:", "postgresql:"].includes(admin.protocol) ||
      admin.host !== owner.host
    )
      throw Error("PG_ADMIN_URL debe apuntar al mismo servicio PostgreSQL.");
  }
  if (publicUrl.protocol === "https:")
    for (const key of ["TLS_CERT_FILE", "TLS_KEY_FILE"]) {
      if (!existsSync(localPath(root, required(key))))
        throw Error(`No existe el archivo configurado en ${key}.`);
    }
  if (initial && profile === "production")
    for (const key of ["BOOTSTRAP_ADMIN_EMAIL", "BOOTSTRAP_ADMIN_PASSWORD"])
      required(key);
  required("WEB_HOST");
  required("CLAMAV_COMMAND");
  required("CLAMAV_DATABASE_DIR");
  required("ATTACHMENT_DIRECTORY");
  const storage = localPath(root, input.ATTACHMENT_DIRECTORY);
  for (const location of ["client/public", "client/dist"]) {
    const publicDirectory = localPath(root, location);
    if (
      storage === publicDirectory ||
      storage.startsWith(publicDirectory + "/") ||
      storage.startsWith(publicDirectory + "\\")
    )
      throw Error(
        "Los adjuntos deben permanecer fuera de directorios públicos.",
      );
  }
  if (input.MANAGE_POSTGRES === "true") {
    const cluster = localPath(root, input.PG_DATA_DIRECTORY);
    const allowed = resolve(root, ".local/deploy/demo");
    if (
      !cluster.startsWith(allowed + "/") &&
      !cluster.startsWith(allowed + "\\")
    )
      throw Error(
        "El clúster administrado debe estar dentro de .local/deploy/demo/.",
      );
    if (!owner.password)
      throw Error(
        "El clúster demo administrado requiere contraseña de propietario.",
      );
    if (!["127.0.0.1", "localhost"].includes(owner.hostname))
      throw Error("El clúster administrado debe usar loopback.");
  }
  return { profile, publicUrl, runtime, owner, databaseName: name, storage };
}
export function apiEnvironment(root, input) {
  const production = input.PROFILE === "production";
  const result = {
    NODE_ENV: production ? "production" : "development",
    HOST: "127.0.0.1",
    PORT: input.API_PORT,
    DATABASE_URL: input.DATABASE_URL,
    JWT_SECRET: input.JWT_SECRET,
    JWT_ISSUER: `fceadatasys-${input.PROFILE}`,
    JWT_AUDIENCE: `fceadatasys-${input.PROFILE}-client`,
    ALLOWED_ORIGINS: input.PUBLIC_URL,
    SECURE_COOKIES: String(input.PUBLIC_URL.startsWith("https:")),
    TRUSTED_PROXIES: "127.0.0.1",
    RECOVERY_URL: input.PUBLIC_URL + "/#reset",
    INITIAL_DATA_PROFILE: input.PROFILE,
    INITIAL_DATA_DATABASE_NAME: new URL(input.DATABASE_URL).pathname.slice(1),
    ATTACHMENT_DIRECTORY: localPath(root, input.ATTACHMENT_DIRECTORY),
    CLAMAV_COMMAND: input.CLAMAV_COMMAND,
    CLAMAV_DATABASE_DIR: localPath(root, input.CLAMAV_DATABASE_DIR),
  };
  for (const [key, value] of Object.entries(input))
    if (
      value &&
      /^(SMTP_|CLAMAV_TIMEOUT|CLAMAV_MAX_|ATTACHMENT_CONCURRENCY|DEMO_|BOOTSTRAP_ADMIN_)/.test(
        key,
      )
    )
      result[key] = value;
  return result;
}
export function redact(value, config) {
  let output = String(value);
  const secrets = Object.entries(config)
    .filter(
      ([key, value]) =>
        value &&
        /PASSWORD|SECRET|SMTP_PASS|DATABASE_URL|PG_ADMIN_URL/.test(key),
    )
    .map(([, value]) => value);
  for (const key of ["DATABASE_URL", "MIGRATION_DATABASE_URL", "PG_ADMIN_URL"])
    if (config[key])
      try {
        const password = decodeURIComponent(new URL(config[key]).password);
        if (password) secrets.push(password);
      } catch {
        /* Invalid configuration is reported without values. */
      }
  for (const secret of secrets.sort((a, b) => b.length - a.length))
    output = output.split(secret).join("[privado]");
  return output;
}
export function executionEnvironment(values = {}, inherited = process.env) {
  const output = { ...inherited };
  for (const key of Object.keys(output))
    if (
      /^(NODE_ENV$|HOST$|PORT$|DATABASE_URL$|JWT_|SMTP_|SECURE_COOKIES$|ALLOWED_ORIGINS$|RECOVERY_URL$|ATTACHMENT_|CLAMAV_|TRUSTED_PROXIES$|BOOTSTRAP_ADMIN_|DEMO_|INITIAL_DATA_|MIGRATION_DATABASE_URL$|PG_ADMIN_URL$|PGPASSWORD$|VITE_)/.test(
        key,
      )
    )
      delete output[key];
  return { ...output, ...values };
}
