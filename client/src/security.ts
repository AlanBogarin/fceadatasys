import type { Role } from "./model";

// Decisión del grupo: diez minutos. El bloqueo por intentos fallidos es independiente.
export const INACTIVITY_MINUTES = 10;
export const INACTIVITY_MS = INACTIVITY_MINUTES * 60_000;

const publicPages = [
  "dashboard",
  "publicaciones",
  "busqueda",
  "perfil",
  "password",
];
const editorPages = ["gestion-publicaciones", "archivos", "autores", "tutores"];
const administratorPages = [
  "usuarios",
  "carreras",
  "facultades",
  "filiales",
  "tipos",
  "niveles",
  "roles",
  "parametros",
  "reportes",
  "auditoria",
];

export function canOpenPage(role: Role, page: string): boolean {
  // Paso 1: comprobar que se trate de una página conocida.
  if (publicPages.includes(page)) {
    return true;
  }

  // Paso 2: aplicar permisos aun cuando se ingresa directamente por URL.
  if (editorPages.includes(page)) {
    return role === "ADMINISTRADOR" || role === "DIGITADOR";
  }

  // Paso 3: denegar por defecto páginas desconocidas o administrativas sin permiso.
  return administratorPages.includes(page) && role === "ADMINISTRADOR";
}

export function sessionExpired(deadline: number, now = Date.now()): boolean {
  return (
    !Number.isFinite(deadline) ||
    deadline <= now ||
    deadline > now + INACTIVITY_MS
  );
}

export function renewActivity(
  deadline: number,
  now = Date.now(),
): number | null {
  // Una interacción tardía nunca debe reactivar una sesión ya vencida.
  if (sessionExpired(deadline, now)) {
    return null;
  }

  return now + INACTIVITY_MS;
}
