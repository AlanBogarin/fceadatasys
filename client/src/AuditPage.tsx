import { useRef, useState, useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  ListFilter,
  Clock3,
  ShieldCheck,
} from "lucide-react";
import type { State, User } from "./model";
import { ROLES, roleLabel } from "./model";
import { Alert, errorText, Field, Modal } from "./ui";
import {
  auditRecords,
  emptyAuditFilters,
  queryAudit,
  type AuditEvent,
  type AuditFilters,
  type AuditIntent,
} from "./audit";
import { buildAuditReport } from "./auditExports";
import { downloadReport } from "./publicationExports";
import { auditFailure } from "./auditSignals";
import "./administration.css";

export function AuditPage({
  state,
  user,
  assertActive,
  recordAudit,
}: {
  state: State;
  user: User;
  assertActive: () => void;
  recordAudit: (intent: AuditIntent) => void;
}) {
  const [filters, setFilters] = useState<AuditFilters>({
    ...emptyAuditFilters,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detail, setDetail] = useState<AuditEvent>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const exporting = useRef(false);
  const current = useRef(state);
  current.current = state;
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  if (
    !state.users.some(
      (account) =>
        account.id === user.id &&
        account.active &&
        account.role === "ADMINISTRADOR",
    )
  ) {
    return (
      <section className="empty-module">
        <ShieldCheck size={39} />
        <h1>Acceso restringido</h1>
        <p>Solo un Administrador activo puede consultar la auditoría.</p>
        <a className="secondary" href="#dashboard">
          Volver al inicio
        </a>
      </section>
    );
  }
  let all: AuditEvent[] = [];
  let records: AuditEvent[] = [];
  let filterError = "";
  try {
    all = auditRecords(state, user.id);
    records = queryAudit(state, user.id, filters);
  } catch (caught) {
    filterError = errorText(caught);
  }
  const pages = Math.max(1, Math.ceil(records.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = records.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const actors = new Map(
    all
      .filter((event) => event.actorId)
      .map((event) => [event.actorId!, event.actorName]),
  );
  function change(key: keyof AuditFilters, value: string) {
    setFilters({ ...filters, [key]: value });
    setPage(1);
    setError("");
    setNotice("");
  }
  async function exportReport(format: "pdf" | "xlsx") {
    if (exporting.current) return;
    exporting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      assertActive();
      const report = await buildAuditReport(state, user.id, filters, format);
      if (!open.current) return;
      assertActive();
      if (current.current !== state)
        throw Error(
          "Los eventos cambiaron. Revisá el listado antes de exportar.",
        );
      recordAudit({
        module: "Auditoría",
        operation: "Exportar auditoría",
        status: "EXITO",
        detail: `${records.length} eventos seleccionados. Formato ${format.toUpperCase()}.`,
      });
      downloadReport(report);
      setNotice(
        `Reporte ${format.toUpperCase()} generado con ${records.length} ${records.length === 1 ? "evento" : "eventos"}.`,
      );
    } catch (caught) {
      auditFailure("Auditoría", "Exportar auditoría", caught);
      if (open.current) setError(errorText(caught));
    } finally {
      exporting.current = false;
      if (open.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración · Trazabilidad</p>
          <h1>Auditoría</h1>
          <p>Consultá las acciones y sus resultados en el repositorio.</p>
        </div>
        <span className="badge blue">
          <ShieldCheck size={14} /> Solo Administrador · Solo lectura
        </span>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <span className="stat-icon">
            <Clock3 size={20} />
          </span>
          <div>
            <p>Eventos registrados</p>
            <strong>{all.length}</strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon blue">
            <ListFilter size={20} />
          </span>
          <div>
            <p>Coinciden con los filtros</p>
            <strong>{records.length}</strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon audit-failure-icon">
            <AlertTriangle size={20} />
          </span>
          <div>
            <p>Operaciones fallidas</p>
            <strong>
              {records.filter((event) => event.status === "FALLIDO").length}
            </strong>
          </div>
        </div>
      </div>
      <section className="panel" aria-busy={busy}>
        <div className="panel-heading">
          <div>
            <h2>Bitácora de operaciones</h2>
            <p>
              Fechas en horario de Paraguay · Los eventos no se editan ni
              eliminan.
            </p>
          </div>
        </div>
        <fieldset
          className="panel-body audit-filters"
          disabled={busy}
          aria-label="Filtros de auditoría"
        >
          <Field label="Buscar en auditoría">
            <input
              type="search"
              value={filters.search}
              placeholder="Usuario, operación, recurso, publicación o sesión…"
              onChange={(event) => change("search", event.target.value)}
            />
          </Field>
          <Field label="Desde">
            <input
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => change("from", event.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <input
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => change("to", event.target.value)}
            />
          </Field>
          <Field label="Usuario">
            <select
              value={filters.actorId}
              onChange={(event) => change("actorId", event.target.value)}
            >
              <option value="">Todos</option>
              {[...actors].map(([identifier, name]) => {
                const account = state.users.find(
                  (entry) => entry.id === identifier,
                );
                return (
                  <option key={identifier} value={identifier}>
                    {account
                      ? `${account.name} · @${account.username}`
                      : `${name} · ID: ${identifier}`}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field label="Rol">
            <select
              value={filters.role}
              onChange={(event) => change("role", event.target.value)}
            >
              <option value="">Todos los roles</option>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleLabel[role]}
                </option>
              ))}
              <option value="SIN_IDENTIFICAR">Sin identificar</option>
            </select>
          </Field>
          <Field label="Módulo">
            <select
              value={filters.module}
              onChange={(event) => change("module", event.target.value)}
            >
              <option value="">Todos</option>
              {[...new Set(all.map((event) => event.module))]
                .sort()
                .map((name) => (
                  <option key={name}>{name}</option>
                ))}
            </select>
          </Field>
          <Field label="Operación">
            <select
              value={filters.operation}
              onChange={(event) => change("operation", event.target.value)}
            >
              <option value="">Todas</option>
              {[...new Set(all.map((event) => event.operation))]
                .sort()
                .map((name) => (
                  <option key={name}>{name}</option>
                ))}
            </select>
          </Field>
          <Field label="Resultado">
            <select
              value={filters.status}
              onChange={(event) => change("status", event.target.value)}
            >
              <option value="">Todos</option>
              <option value="EXITO">Éxito</option>
              <option value="FALLIDO">Fallido</option>
            </select>
          </Field>
        </fieldset>
        <div className="administration-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setFilters({ ...emptyAuditFilters });
              setPage(1);
              setError("");
              setNotice("");
            }}
          >
            <ListFilter size={16} />
            Limpiar filtros
          </button>
          <button
            className="secondary"
            disabled={busy || !records.length || Boolean(filterError)}
            onClick={() => exportReport("pdf")}
          >
            <Download size={16} />
            {busy ? "Generando reporte…" : "Exportar PDF"}
          </button>
          <button
            className="secondary"
            disabled={busy || !records.length || Boolean(filterError)}
            onClick={() => exportReport("xlsx")}
          >
            <Download size={16} />
            Exportar Excel
          </button>
        </div>
        <div className="audit-alerts">
          <Alert text={filterError || error} />
          <Alert text={notice} success />
        </div>
        <div className="table-scroll">
          <table className="audit-table" aria-label="Eventos de auditoría">
            <thead>
              <tr>
                <th scope="col">Fecha y hora</th>
                <th scope="col">Usuario / Rol</th>
                <th scope="col">Operación</th>
                <th scope="col">Módulo / Recurso</th>
                <th scope="col">Resultado</th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((event) => (
                <tr key={event.id}>
                  <td>{auditDate(event.createdAt)}</td>
                  <td>
                    <strong>{event.actorName}</strong>
                    <small>
                      {event.actorRole
                        ? roleLabel[event.actorRole]
                        : "Sin identificar"}
                    </small>
                  </td>
                  <td>{event.operation}</td>
                  <td>
                    {event.module}
                    <small>
                      {event.resourceName || event.resourceId || "—"}
                    </small>
                  </td>
                  <td>
                    <span
                      className={`badge audit-status ${event.status === "EXITO" ? "audit-success" : "audit-failure"}`}
                    >
                      {event.status === "EXITO" ? (
                        <CheckCircle2 size={13} />
                      ) : (
                        <AlertTriangle size={13} />
                      )}
                      {event.status === "EXITO" ? "Éxito" : "Fallido"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      title={`Ver detalle: ${event.operation}`}
                      aria-label={`Ver detalle de ${event.operation}, evento ${event.id}`}
                      onClick={() => setDetail(event)}
                    >
                      <Eye size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!records.length && !filterError && (
          <div className="no-results">
            <ShieldCheck size={32} />
            <h3>
              {all.length
                ? "No hay eventos con estos filtros"
                : "Todavía no hay eventos registrados"}
            </h3>
            <p>
              {all.length
                ? "Probá otro criterio o limpiá los filtros para ver todos los eventos."
                : "Los accesos y las operaciones se mostrarán aquí cuando se registren."}
            </p>
          </div>
        )}
        <div className="table-footer audit-pagination">
          <span role="status">
            {records.length
              ? `Mostrando ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, records.length)} de ${records.length}`
              : "0 eventos"}
          </span>
          <label className="audit-page-size">
            Eventos por página
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {[10, 25, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <div className="audit-page-controls">
            <button
              className="icon-btn"
              aria-label="Página anterior"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              <ChevronLeft />
            </button>
            <span>
              {currentPage} / {pages}
            </span>
            <button
              className="icon-btn"
              aria-label="Página siguiente"
              disabled={currentPage === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight />
            </button>
          </div>
        </div>
      </section>
      <p className="audit-scope">
        Bitácora local de demostración. Los registros anteriores conservan
        únicamente los datos que estaban disponibles; no se inventan actividades
        pasadas ni direcciones IP.
      </p>
      {detail && (
        <Modal
          title="Detalle de auditoría"
          eyebrow="Trazabilidad institucional"
          close={() => setDetail(undefined)}
        >
          <div className="modal-body audit-detail">
            <div className="audit-detail-heading">
              <h3>{detail.operation}</h3>
              <span
                className={`badge audit-status ${detail.status === "EXITO" ? "audit-success" : "audit-failure"}`}
              >
                {detail.status === "EXITO" ? "Éxito" : "Fallido"}
              </span>
            </div>
            <dl>
              {[
                ["ID", detail.id],
                ["Fecha y hora", auditDate(detail.createdAt)],
                ["Usuario", detail.actorName],
                ["ID usuario", detail.actorId],
                [
                  "Rol",
                  detail.actorRole
                    ? roleLabel[detail.actorRole]
                    : "Sin identificar",
                ],
                ["Operación", detail.operation],
                ["Módulo", detail.module],
                ["Recurso", detail.resourceName],
                ["ID recurso", detail.resourceId],
                ["Publicación", detail.publicationId],
                ["Resultado", detail.status === "EXITO" ? "Éxito" : "Fallido"],
                ["Detalle", detail.detail],
                ["ID sesión", detail.sessionId],
                ["IP", detail.ip ?? "No disponible en esta versión local"],
                ["Navegador", detail.userAgent],
                [
                  "Origen",
                  detail.origin === "ACTUAL"
                    ? "Registrado por este módulo"
                    : "Bitácora de una versión anterior",
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "No registrado"}</dd>
                </div>
              ))}
            </dl>
            <div className="audit-snapshots">
              <section>
                <h3>Valores anteriores</h3>
                <pre>
                  {detail.before
                    ? JSON.stringify(detail.before, null, 2)
                    : "No corresponde o no fue registrado."}
                </pre>
              </section>
              <section>
                <h3>Valores nuevos</h3>
                <pre>
                  {detail.after
                    ? JSON.stringify(detail.after, null, 2)
                    : "No corresponde o no fue registrado."}
                </pre>
              </section>
            </div>
          </div>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setDetail(undefined)}>
              Cerrar detalle
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function auditDate(value: string): string {
  return new Intl.DateTimeFormat("es-PY", {
    timeZone: "America/Asuncion",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}
