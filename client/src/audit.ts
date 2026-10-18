import { guardAdmin, type State, type Role } from "./model";
import { CATALOG_KEYS, catalogConfig, normalizeCatalog } from "./catalogs";
import { settingsOf } from "./settings";
import { registrationDate } from "./publications";

export type AuditStatus = "EXITO" | "FALLIDO";
export type AuditEvent = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string;
  username?: string | null;
  actorRole: Role | null;
  operation: string;
  module: string;
  resourceId: string | null;
  resourceName?: string;
  publicationId: string | null;
  status: AuditStatus;
  detail: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  sessionId: string | null;
  ip: string | null;
  userAgent: string | null;
  sourceId?: string;
  origin?: "ACTUAL" | "ANTERIOR";
};
export type AuditIntent = Pick<AuditEvent, "operation" | "module" | "status"> &
  Partial<
    Pick<
      AuditEvent,
      | "actorId"
      | "actorName"
      | "resourceId"
      | "resourceName"
      | "publicationId"
      | "detail"
      | "before"
      | "after"
      | "sourceId"
    >
  >;
export type AuditContext = {
  actorId: string | null;
  sessionId: string | null;
  userAgent: string | null;
};
export type AuditFilters = {
  from: string;
  to: string;
  actorId: string;
  role: string;
  module: string;
  operation: string;
  status: string;
  search: string;
};
export const emptyAuditFilters: AuditFilters = {
  from: "",
  to: "",
  actorId: "",
  role: "",
  module: "",
  operation: "",
  status: "",
  search: "",
};

export function safeAuditText(value: string): string {
  return value
    .replace(/sk-[a-z0-9_-]+/gi, "[credencial omitida]")
    .replace(/Bearer\s+\S+/gi, "[credencial omitida]")
    .replace(
      /((?:password|contraseña|token|api.?key|secret|salt|hash)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[omitido]",
    )
    .slice(0, 1200);
}

function safeSnapshot(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const cleaned: Record<string, unknown> = {};
  for (const [name, content] of Object.entries(value)) {
    if (/password|contrase|token|secret|salt|hash|recovery/i.test(name))
      continue;
    if (typeof content === "string") cleaned[name] = safeAuditText(content);
    else if (Array.isArray(content))
      cleaned[name] = content.slice(0, 100).map((entry) => {
        if (typeof entry === "string") return safeAuditText(entry);
        if (entry && typeof entry === "object") return safeSnapshot(entry);
        return entry;
      });
    else if (content && typeof content === "object")
      cleaned[name] = safeSnapshot(content as Record<string, unknown>);
    else cleaned[name] = content;
  }
  return cleaned;
}

export function appendAudit(
  state: State,
  intent: AuditIntent,
  context: AuditContext,
): State {
  // Paso 1: tomar identidad del estado vigente, sin copiar credenciales a la bitácora.
  const actorId =
    intent.actorId === undefined ? context.actorId : intent.actorId;
  const actor = state.users.find((account) => account.id === actorId);
  // Paso 2: guardar instantáneas acotadas y omitir IP desconocida en esta versión local.
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    actorId,
    actorName: safeAuditText(
      intent.actorName ?? actor?.name ?? "Cuenta no identificada",
    ),
    actorRole: actor?.role ?? null,
    operation: intent.operation,
    module: intent.module,
    resourceId: intent.resourceId ?? null,
    resourceName: safeAuditText(intent.resourceName ?? ""),
    publicationId: intent.publicationId ?? null,
    status: intent.status,
    detail: safeAuditText(
      intent.detail ?? "Operación registrada en la demostración local.",
    ),
    before: safeSnapshot(intent.before),
    after: safeSnapshot(intent.after),
    sessionId: context.sessionId,
    userAgent: context.userAgent,
    ip: null,
    origin: "ACTUAL",
    ...(intent.sourceId ? { sourceId: intent.sourceId } : {}),
  };
  // Paso 3: agregar un evento nuevo; no editar ni eliminar los anteriores.
  return { ...state, auditEvents: [...(state.auditEvents ?? []), event] };
}

export function businessStateKey(state: State): string {
  const { auditEvents: _events, ...business } = state;
  return JSON.stringify(business);
}

export function auditMutation(
  before: State,
  after: State,
  context: AuditContext,
  intent?: AuditIntent,
): State {
  // Paso 1: impedir que un formulario sustituya o borre el historial existente.
  if (
    JSON.stringify(before.auditEvents ?? []) !==
    JSON.stringify(after.auditEvents ?? [])
  ) {
    throw Error("No se permite editar ni eliminar eventos de auditoría.");
  }
  let prepared = after;
  function record(event: Omit<AuditIntent, "status">) {
    prepared = appendAudit(prepared, { ...event, status: "EXITO" }, context);
  }
  // Paso 2: identificar cambios de negocio reales, no simples lecturas o renovaciones.
  // Las credenciales solo generan el tipo de operación: sus valores nunca se guardan.
  if (!intent || intent.module !== "Sesiones") {
    for (const previous of before.users) {
      const next = after.users.find((account) => account.id === previous.id);
      const resource = {
        module: "Usuarios",
        resourceId: previous.id,
        resourceName: previous.username,
      };
      if (!next)
        record({
          ...resource,
          operation: "Eliminar usuario",
          before: { ...previous },
        });
      else {
        if (previous.passwordHash !== next.passwordHash)
          record({
            ...resource,
            operation: "Cambiar contraseña",
            detail: "Credencial actualizada. Su contenido no se registra.",
          });
        const oldData = {
          nombre: previous.name,
          usuario: previous.username,
          cedula: previous.ci,
          correo: previous.email,
          rol: previous.role,
          activo: previous.active,
        };
        const newData = {
          nombre: next.name,
          usuario: next.username,
          cedula: next.ci,
          correo: next.email,
          rol: next.role,
          activo: next.active,
        };
        if (JSON.stringify(oldData) !== JSON.stringify(newData)) {
          let operation = "Modificar usuario";
          if (previous.role !== next.role) operation = "Cambiar rol de usuario";
          else if (previous.active !== next.active)
            operation = next.active ? "Activar usuario" : "Inactivar usuario";
          record({ ...resource, operation, before: oldData, after: newData });
        }
      }
    }
    for (const account of after.users.filter(
      (account) => !before.users.some((previous) => previous.id === account.id),
    )) {
      record({
        module: "Usuarios",
        operation: "Crear usuario",
        resourceId: account.id,
        resourceName: account.username,
        after: { ...account },
      });
    }
  }
  for (const catalog of CATALOG_KEYS) {
    for (const previous of before.catalogs[catalog]) {
      const next = after.catalogs[catalog].find(
        (entry) => entry.id === previous.id,
      );
      if (JSON.stringify(previous) === JSON.stringify(next)) continue;
      let operation = "Modificar registro";
      if (!next) operation = "Eliminar registro";
      else if (previous.active !== next.active)
        operation = next.active ? "Activar registro" : "Inactivar registro";
      record({
        module: catalogConfig[catalog].title,
        operation,
        resourceId: previous.id,
        resourceName: previous.name,
        before: { ...previous },
        after: next ? { ...next } : null,
      });
    }
    for (const entry of after.catalogs[catalog].filter(
      (entry) =>
        !before.catalogs[catalog].some((previous) => previous.id === entry.id),
    )) {
      record({
        module: catalogConfig[catalog].title,
        operation: "Crear registro",
        resourceId: entry.id,
        resourceName: entry.name,
        after: { ...entry },
      });
    }
  }
  for (const publication of after.publications ?? []) {
    const previous = before.publications?.find(
      (entry) => entry.id === publication.id,
    );
    if (JSON.stringify(previous) === JSON.stringify(publication)) continue;
    const legacy = after.publicationAudit?.find(
      (event) =>
        event.publicationId === publication.id &&
        event.operation === "REGISTRAR_INVESTIGACION",
    );
    record({
      module: "Publicaciones",
      operation: previous ? "Modificar publicación" : "Registrar publicación",
      resourceId: publication.id,
      resourceName: `${publication.code} · ${publication.title}`,
      publicationId: publication.id,
      before: previous ? { ...previous } : null,
      after: { ...publication },
      ...(!previous && legacy ? { sourceId: `publicacion:${legacy.id}` } : {}),
    });
  }
  for (const entry of after.publicationAudit ?? []) {
    if (
      entry.operation !== "DESCARGAR_ADJUNTO" ||
      before.publicationAudit?.some((previous) => previous.id === entry.id)
    )
      continue;
    record({
      module: "Archivos",
      operation: "Descargar adjunto",
      resourceId: entry.publicationId,
      publicationId: entry.publicationId,
      sourceId: `publicacion:${entry.id}`,
    });
  }
  for (const entry of after.attachmentAudit ?? []) {
    if (before.attachmentAudit?.some((previous) => previous.id === entry.id))
      continue;
    prepared = appendAudit(
      prepared,
      {
        module: "Archivos",
        operation:
          entry.operation === "ADJUNTO_CARGADO"
            ? "Cargar adjunto"
            : "Rechazar adjunto",
        status: entry.status,
        resourceId: entry.resourceId,
        detail: entry.detail,
        sourceId: `adjunto:${entry.id}`,
      },
      context,
    );
  }
  if (
    JSON.stringify(settingsOf(before)) !== JSON.stringify(settingsOf(after))
  ) {
    record({
      module: "Parámetros",
      operation: "Modificar parámetros",
      resourceId: "generales",
      resourceName: "Parámetros generales",
      before: { ...settingsOf(before) },
      after: { ...settingsOf(after) },
    });
  }
  // Paso 3: el llamador persiste registros y eventos juntos en una sola escritura.
  if (intent) prepared = appendAudit(prepared, intent, context);
  return prepared;
}

export function auditRecords(state: State, actorId: string): AuditEvent[] {
  guardAdmin(state, actorId);
  const records = structuredClone(state.auditEvents ?? []);
  const known = new Set(records.map((event) => event.sourceId));
  function legacy(
    entry: { id: string; actorId: string; actorRole: Role; createdAt: string },
    sourceId: string,
    intent: AuditIntent,
  ) {
    if (known.has(sourceId)) return;
    records.push({
      id: sourceId,
      createdAt: entry.createdAt,
      actorId: entry.actorId,
      actorName: "Cuenta registrada por ID",
      actorRole: entry.actorRole,
      operation: intent.operation,
      module: intent.module,
      resourceId: intent.resourceId ?? null,
      resourceName: "",
      publicationId: intent.publicationId ?? null,
      status: intent.status,
      detail: `Evento conservado de la versión anterior. ${safeAuditText(intent.detail ?? "No se registraron sesión, IP ni navegador.")}`,
      before: null,
      after: null,
      sessionId: null,
      ip: null,
      userAgent: null,
      sourceId,
      origin: "ANTERIOR",
    });
  }
  for (const entry of state.publicationAudit ?? [])
    legacy(entry, `publicacion:${entry.id}`, {
      module: "Publicaciones",
      operation:
        entry.operation === "REGISTRAR_INVESTIGACION"
          ? "Registrar publicación"
          : "Descargar adjunto",
      status: "EXITO",
      resourceId: entry.publicationId,
      publicationId: entry.publicationId,
    });
  for (const entry of state.attachmentAudit ?? [])
    legacy(entry, `adjunto:${entry.id}`, {
      module: "Archivos",
      operation:
        entry.operation === "ADJUNTO_CARGADO"
          ? "Cargar adjunto"
          : "Rechazar adjunto",
      status: entry.status,
      resourceId: entry.resourceId,
      detail: entry.detail,
    });
  return records.sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
}

export function queryAudit(
  state: State,
  actorId: string,
  filters: AuditFilters,
): AuditEvent[] {
  // Paso 1: autorizar antes de construir resultados o validar filtros.
  const records = auditRecords(state, actorId);
  for (const date of [filters.from, filters.to]) {
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        Number.isNaN(Date.parse(`${date}T12:00:00Z`)) ||
        new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date)
    )
      throw Error("Ingresá fechas válidas para el filtro.");
  }
  if (filters.from && filters.to && filters.from > filters.to)
    throw Error("La fecha inicial no puede ser posterior a la final.");
  // Paso 2: combinar filtros; la búsqueda ignora acentos y mayúsculas.
  const term = normalizeCatalog(filters.search);
  const usernames = new Map(
    state.users.map((account) => [account.id, account.username]),
  );
  return records.filter((event) => {
    const day = registrationDate(event.createdAt);
    return (
      (!filters.from || day >= filters.from) &&
      (!filters.to || day <= filters.to) &&
      (!filters.actorId || event.actorId === filters.actorId) &&
      (!filters.role ||
        (filters.role === "SIN_IDENTIFICAR"
          ? event.actorRole === null
          : event.actorRole === filters.role)) &&
      (!filters.module || event.module === filters.module) &&
      (!filters.operation || event.operation === filters.operation) &&
      (!filters.status || event.status === filters.status) &&
      (!term ||
        normalizeCatalog(
          [
            event.id,
            event.actorName,
            event.actorId,
            event.actorId ? usernames.get(event.actorId) : "",
            event.operation,
            event.module,
            event.resourceName,
            event.resourceId,
            event.publicationId,
            event.sessionId,
            event.detail,
          ].join(" "),
        ).includes(term))
    );
  });
}
