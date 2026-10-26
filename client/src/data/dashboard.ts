import { hasPermission, type PermissionAccount } from "../permissions";
import { emptyBibliographicFilters } from "../bibliography";
import { allItems } from "../navigation";
import { canOpenPage } from "../security";
import type { DataClient } from "./client";
import type { Role } from "./contracts";

export async function loadDashboard(client: DataClient, signal?: AbortSignal) {
  const user = await client.users.me(signal);
  const [publications, users] = await Promise.all([
    client.publications.list({ ...emptyBibliographicFilters }, 1, 1, signal),
    hasPermission(user, "users.read")
      ? client.users.list({ pageSize: 1 }, signal)
      : undefined,
  ]);
  return {
    user,
    publications: publications.pagination.total,
    users: users?.summary,
  };
}

export function dashboardLinks(role: Role | PermissionAccount) {
  const destinations = new Set([
    "gestion-publicaciones",
    "archivos",
    "autores",
    "tutores",
    "publicaciones",
    "busqueda",
    "usuarios",
    "reportes",
    "auditoria",
  ]);
  return allItems.filter(
    (item) => destinations.has(item.id) && canOpenPage(role, item.id),
  );
}
