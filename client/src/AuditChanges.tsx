import { useState } from "react";
const permissionLabels: Record<string, string> = {
  "users.read": "Consultar usuarios",
  "users.manage": "Crear, editar y activar/inactivar usuarios",
  "users.delete": "Eliminar usuarios sin referencias",
  "users.password": "Asignar contraseñas a usuarios",
  "permissions.manage": "Administrar roles y permisos",
  "publications.create": "Crear publicaciones",
  "publications.edit": "Editar publicaciones",
  "publications.inactivate": "Inactivar publicaciones",
  "publications.history": "Consultar publicaciones inactivas",
  "attachments.upload": "Consultar y cargar archivos",
  "attachments.download": "Descargar adjuntos",
  "attachments.manage": "Usar archivos cargados por otras cuentas",
  "catalogs.autores.manage": "Consultar y gestionar autores",
  "catalogs.autores.delete": "Eliminar autores",
  "catalogs.tutores.manage": "Consultar y gestionar tutores",
  "catalogs.tutores.delete": "Eliminar tutores",
  "catalogs.carreras.manage": "Consultar y gestionar carreras",
  "catalogs.carreras.delete": "Eliminar carreras",
  "catalogs.facultades.manage": "Consultar y gestionar facultades",
  "catalogs.facultades.delete": "Eliminar facultades",
  "catalogs.filiales.manage": "Consultar y gestionar filiales",
  "catalogs.filiales.delete": "Eliminar filiales",
  "catalogs.tipos.manage": "Consultar y gestionar tipos",
  "catalogs.tipos.delete": "Eliminar tipos",
  "catalogs.niveles.manage": "Consultar y gestionar niveles",
  "catalogs.niveles.delete": "Eliminar niveles",
  "settings.manage": "Modificar parámetros generales",
  "reports.read": "Consultar reportes",
  "reports.export": "Exportar reportes",
  "audit.read": "Consultar auditoría",
  "audit.export": "Exportar auditoría",
  "backups.manage": "Consultar y ejecutar copias de seguridad",
};

const labels: Record<string, string> = {
  id: "Identificador",
  name: "Nombre completo",
  username: "Usuario",
  ci: "CI",
  email: "Correo electrónico",
  role: "Rol",
  active: "Activo",
  title: "Título",
  summary: "Resumen",
  abstract: "Abstract",
  keywords: "Palabras clave",
  year: "Año",
  code: "Código",
  authors: "Autores",
  tutors: "Tutores y orientadores",
  career: "Carrera",
  level: "Nivel académico",
  type: "Tipo de publicación",
  branch: "Filial",
  fields: "Datos",
  createdAt: "Fecha de creación",
  updatedAt: "Fecha de actualización",
  source: "Procedencia",
  requiresLibraryCopy: "Requiere copia en Biblioteca",
  externalUrl: "URL externa",
  attachment: "Archivo adjunto",
  summaryWordLimit: "Límite de palabras del resumen",
  maxPdfSizeMb: "Tamaño máximo del archivo (MiB)",
  allowedFormats: "Formatos admitidos",
  reason: "Motivo",
  endedAt: "Fin de sesión",
  durationSeconds: "Duración (segundos)",
  lastActivityAt: "Última actividad",
  roles: "Permisos por rol",
  users: "Excepciones por cuenta",
  permissions: "Permisos",
  status: "Estado",
  size: "Tamaño (bytes)",
  careerId: "Carrera (identificador)",
  levelId: "Nivel académico (identificador)",
  typeId: "Tipo de publicación (identificador)",
  branchId: "Filial (identificador)",
  authorIds: "Autores (identificadores)",
  tutorIds: "Tutores (identificadores)",
  attachmentId: "Adjunto (identificador)",
  createdBy: "Registrado por",
  publicationId: "Publicación (identificador)",
  sessionId: "Sesión (identificador)",
  filename: "Nombre del archivo",
  localSaved: "Copia local guardada",
  cloudSaved: "Copia en Google Drive guardada",
  scannedAt: "Fecha de análisis",
  scanner: "Antivirus",
  engine: "Motor de análisis",
  signature: "Detección",
  state: "Estado del archivo",
  total: "Cantidad total",
  format: "Formato",
  filters: "Filtros",
  approvedExternally: "Aprobado fuera del sistema",
};
export const auditFieldLabel = (key: string) =>
  permissionLabels[key] ??
  labels[key] ??
  key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
export function AuditValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>Sin dato</span>;
  if (typeof value === "boolean") return <span>{value ? "Sí" : "No"}</span>;
  if (Array.isArray(value))
    return value.length ? (
      <ul>
        {value.map((entry, i) => (
          <li key={i}>
            <AuditValue value={entry} />
          </li>
        ))}
      </ul>
    ) : (
      <span>Sin elementos</span>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([key, entry]) => (
          <div key={key}>
            <dt>{auditFieldLabel(key)}</dt>
            <dd>
              <AuditValue value={entry} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return (
    <span>{(permissionLabels[String(value)] ?? String(value)) || "Vacío"}</span>
  );
}
export function AuditChanges({
  before,
  after,
}: {
  before: unknown;
  after: unknown;
}) {
  const [mode, setMode] = useState("friendly");
  return (
    <section>
      <label>
        Mostrar datos
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="friendly">Vista amigable</option>
          <option value="json">JSON (técnico)</option>
          <option value="raw">Raw (técnico)</option>
        </select>
      </label>
      <div className="audit-snapshots">
        {[
          ["Valores anteriores", before],
          ["Valores nuevos", after],
        ].map(([title, value]) => (
          <section key={String(title)}>
            <h3>{String(title)}</h3>
            {value == null ? (
              <p>No corresponde o no fue registrado.</p>
            ) : mode === "friendly" ? (
              <AuditValue value={value} />
            ) : (
              <pre>
                {JSON.stringify(value, null, mode === "json" ? 2 : undefined)}
              </pre>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
