import type { Prisma, PrismaClient, Role, User } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";

export const permissionDefinitions: { key: string; label: string }[] = [
  { key: "users.read", label: "Consultar usuarios" },
  { key: "users.manage", label: "Crear, editar y activar/inactivar usuarios" },
  { key: "users.delete", label: "Eliminar usuarios sin referencias" },
  { key: "users.password", label: "Asignar contraseñas a usuarios" },
  { key: "permissions.manage", label: "Administrar roles y permisos" },
  { key: "publications.create", label: "Crear publicaciones" },
  { key: "publications.edit", label: "Editar publicaciones" },
  { key: "publications.inactivate", label: "Inactivar publicaciones" },
  { key: "publications.history", label: "Consultar publicaciones inactivas" },
  { key: "attachments.upload", label: "Consultar y cargar archivos" },
  { key: "attachments.download", label: "Descargar adjuntos" },
  {
    key: "attachments.manage",
    label: "Usar archivos cargados por otras cuentas",
  },
  { key: "catalogs.autores.manage", label: "Consultar y gestionar autores" },
  { key: "catalogs.autores.delete", label: "Eliminar autores" },
  { key: "catalogs.tutores.manage", label: "Consultar y gestionar tutores" },
  { key: "catalogs.tutores.delete", label: "Eliminar tutores" },
  { key: "catalogs.carreras.manage", label: "Consultar y gestionar carreras" },
  { key: "catalogs.carreras.delete", label: "Eliminar carreras" },
  {
    key: "catalogs.facultades.manage",
    label: "Consultar y gestionar facultades",
  },
  { key: "catalogs.facultades.delete", label: "Eliminar facultades" },
  { key: "catalogs.filiales.manage", label: "Consultar y gestionar filiales" },
  { key: "catalogs.filiales.delete", label: "Eliminar filiales" },
  { key: "catalogs.tipos.manage", label: "Consultar y gestionar tipos" },
  { key: "catalogs.tipos.delete", label: "Eliminar tipos" },
  { key: "catalogs.niveles.manage", label: "Consultar y gestionar niveles" },
  { key: "catalogs.niveles.delete", label: "Eliminar niveles" },
  { key: "settings.manage", label: "Modificar parámetros generales" },
  { key: "reports.read", label: "Consultar reportes" },
  { key: "reports.export", label: "Exportar reportes" },
  { key: "audit.read", label: "Consultar auditoría" },
  { key: "audit.export", label: "Exportar auditoría" },
  { key: "backups.manage", label: "Consultar y ejecutar copias de seguridad" },
];
export const permissionKeys = permissionDefinitions.map((item) => item.key);
export const defaultPermissions: Record<Role, string[]> = {
  ADMINISTRADOR: [
    "users.read",
    "users.manage",
    "users.delete",
    "users.password",
    "permissions.manage",
    "publications.create",
    "publications.edit",
    "publications.inactivate",
    "publications.history",
    "attachments.upload",
    "attachments.download",
    "attachments.manage",
    "catalogs.autores.manage",
    "catalogs.autores.delete",
    "catalogs.tutores.manage",
    "catalogs.tutores.delete",
    "catalogs.carreras.manage",
    "catalogs.carreras.delete",
    "catalogs.facultades.manage",
    "catalogs.facultades.delete",
    "catalogs.filiales.manage",
    "catalogs.filiales.delete",
    "catalogs.tipos.manage",
    "catalogs.tipos.delete",
    "catalogs.niveles.manage",
    "catalogs.niveles.delete",
    "settings.manage",
    "reports.read",
    "reports.export",
    "audit.read",
    "audit.export",
    "backups.manage",
  ],
  DIGITADOR: [
    "publications.create",
    "publications.edit",
    "attachments.upload",
    "attachments.download",
    "catalogs.autores.manage",
    "catalogs.tutores.manage",
  ],
  PUBLICO: [],
};
const permissionsSchema = z
  .array(
    z
      .string()
      .refine((key) => permissionKeys.includes(key), "Permiso desconocido."),
  )
  .max(permissionKeys.length)
  .refine((keys) => new Set(keys).size === keys.length, "Permisos repetidos.");
export const overridesSchema = z.record(
  z
    .string()
    .refine((key) => permissionKeys.includes(key), "Permiso desconocido."),
  z.boolean(),
);
export const policySchema = z
  .object({
    roles: z
      .object({
        ADMINISTRADOR: permissionsSchema,
        DIGITADOR: permissionsSchema,
        PUBLICO: permissionsSchema,
      })
      .strict(),
    users: z.record(z.uuid(), overridesSchema),
  })
  .strict();
export type AccessPolicy = z.infer<typeof policySchema>;
export function canonicalPolicy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPolicy);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([key, entry]) => [key, canonicalPolicy(entry)]),
    );
  return value;
}
type Database = Prisma.TransactionClient | PrismaClient;
export const initialPolicy = (): AccessPolicy => ({
  roles: structuredClone(defaultPermissions),
  users: {},
});
export async function loadPolicy(db: Database): Promise<AccessPolicy> {
  const row = await db.accessPolicy.findUniqueOrThrow({ where: { id: 1 } });
  return policySchema.parse(row.policy);
}
export function permissionsFor(
  policy: AccessPolicy,
  user: Pick<User, "id" | "role">,
): string[] {
  const overrides = policy.users[user.id] ?? {};
  return permissionKeys.filter((key) => {
    if (
      ["permissions.manage", "backups.manage"].includes(key) &&
      user.role !== "ADMINISTRADOR"
    )
      return false;
    return overrides[key] ?? policy.roles[user.role].includes(key);
  });
}
export async function userPermissions(
  db: Database,
  user: Pick<User, "id" | "role">,
) {
  return permissionsFor(await loadPolicy(db), user);
}
export function assertAllowed(permissions: string[], key: string) {
  if (!permissions.includes(key))
    throw new AppError(
      403,
      "FORBIDDEN",
      "No tienes permiso para realizar esta operación.",
    );
}
/** Hold the policy lock through the business commit so revocation cannot race it. */
export async function assertRequestPermission(
  db: Database,
  request: FastifyRequest,
  user: User,
) {
  await db.$queryRaw`SELECT id FROM permisos_sistema WHERE id = 1 FOR SHARE`;
  const permissions = await userPermissions(db, user);
  if (request.auth) request.auth.permissions = permissions;
  for (const key of request.requiredPermissions ?? [])
    assertAllowed(permissions, key);
  return permissions;
}
export async function assertPermissionAdministratorRemains(db: Database) {
  const policy = await loadPolicy(db);
  const admins = await db.user.findMany({
    where: { role: "ADMINISTRADOR", active: true },
  });
  if (
    !admins.some((user) =>
      permissionsFor(policy, user).includes("permissions.manage"),
    )
  )
    throw new AppError(
      409,
      "LAST_PERMISSION_ADMIN_REQUIRED",
      "Debe quedar al menos un Administrador activo con permiso para administrar roles y permisos.",
    );
}
export async function protectUserPrivileges(
  db: Database,
  actor: User,
  target?: User,
  nextRole?: Role,
) {
  const policy = await loadPolicy(db);
  const permissions = permissionsFor(policy, actor);
  if (permissions.includes("permissions.manage")) return;
  if (
    (nextRole && nextRole !== (target?.role ?? "PUBLICO")) ||
    (target &&
      permissionsFor(policy, target).some(
        (key) => !permissions.includes(key),
      )) ||
    (!target &&
      nextRole &&
      permissionsFor(policy, { id: "", role: nextRole }).some(
        (key) => !permissions.includes(key),
      ))
  )
    throw new AppError(
      403,
      "FORBIDDEN",
      "La asignación de roles o modificación de una cuenta con permisos superiores requiere administrar roles y permisos.",
    );
}
declare module "fastify" {
  interface FastifyRequest {
    requiredPermissions?: string[];
  }
}
