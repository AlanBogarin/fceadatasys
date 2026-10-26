import type { Role } from "./model";
import {
  hasPermission,
  pagePermissions,
  type PermissionAccount,
} from "./permissions";

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
export function canOpenPage(
  account: Role | PermissionAccount,
  page: string,
): boolean {
  if (publicPages.includes(page)) return true;
  const user = typeof account === "string" ? { role: account } : account;
  return (pagePermissions[page] ?? []).some((key) => hasPermission(user, key));
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
