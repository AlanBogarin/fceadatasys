import { useRef, useState, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  ListFilter,
  ShieldCheck,
} from "lucide-react";
import type { State, User } from "./model";
import { roleLabel } from "./model";
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
  const [detail, setDetail] = useState<AuditEvent>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef(state);
  current.current = state;
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  let all: AuditEvent[] = [];
  let records: AuditEvent[] = [];
  let filterError = "";
  try {
    all = auditRecords(state, user.id);
    records = queryAudit(state, user.id, filters);
  } catch (caught) {
    filterError = errorText(caught);
  }
  const pages = Math.max(1, Math.ceil(records.length / 10));
  const currentPage = Math.min(page, pages);
  const visible = records.slice((currentPage - 1) * 10, currentPage * 10);
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
    if (busy) return;
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
      setError(errorText(caught));
    } finally {
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
          <ShieldCheck size={14} /> Solo lectura
        </span>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <div>
            <p>Eventos registrados</p>
            <strong>{all.length}</strong>
          </div>
        </div>
        <div className="stat">
          <div>
            <p>Coinciden con los filtros</p>
            <strong>{records.length}</strong>
          </div>
        </div>
        <div className="stat">
          <div>
            <p>Operaciones fallidas</p>
            <strong>
              {records.filter((event) => event.status === "FALLIDO").length}
            </strong>
          </div>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Bitácora de operaciones</h2>
            <p>
              Fechas en horario de Paraguay · Los eventos no se editan ni
              eliminan.
            </p>
          </div>
        </div>
        <div className="panel-body audit-filters">
          <Field label="Buscar en auditoría">
            <input
              type="search"
              value={filters.search}
              placeholder="Usuario, operación, recurso o detalle…"
              onChange={(event) => change("search", event.target.value)}
            />
          </Field>
          <Field label="Desde">
            <input
              type="date"
              value={filters.from}
              onChange={(event) => change("from", event.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <input
              type="date"
              value={filters.to}
              onChange={(event) => change("to", event.target.value)}
            />
          </Field>
          <Field label="Usuario">
            <select
              value={filters.actorId}
              onChange={(event) => change("actorId", event.target.value)}
            >
              <option value="">Todos</option>
              {[...actors].map(([identifier, name]) => (
                <option key={identifier} value={identifier}>
                  {state.users.find((account) => account.id === identifier)
                    ?.username ?? name}
                </option>
              ))}
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
        </div>
        <div className="administration-actions">
          <button
            className="secondary"
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
            Exportar PDF
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
          <table className="audit-table">
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Usuario / Rol</th>
                <th>Operación</th>
                <th>Módulo / Recurso</th>
                <th>Resultado</th>
                <th>Detalle</th>
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
                      className={`badge ${event.status === "EXITO" ? "blue" : "neutral"}`}
                    >
                      {event.status === "EXITO" ? "Éxito" : "Fallido"}
                    </span>
                  </td>
                  <td>
                    <button
                      className="icon-btn"
                      title="Ver evento"
                      aria-label={`Ver evento ${event.id}`}
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
            <p>Las próximas operaciones aparecerán aquí cuando se guarden.</p>
          </div>
        )}
        <div className="table-footer">
          <span>
            {records.length
              ? `Mostrando ${(currentPage - 1) * 10 + 1}–${Math.min(currentPage * 10, records.length)} de ${records.length}`
              : "0 eventos"}
          </span>
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
            <dl>
              {[
                ["ID", detail.id],
                ["Fecha y hora", auditDate(detail.createdAt)],
                ["Usuario", detail.actorName],
                ["ID usuario", detail.actorId],
                ["Rol", detail.actorRole],
                ["Operación", detail.operation],
                ["Módulo", detail.module],
                ["Recurso", detail.resourceName || detail.resourceId],
                ["Publicación", detail.publicationId],
                ["Resultado", detail.status],
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
            <h3>Valores anteriores</h3>
            <pre>
              {detail.before
                ? JSON.stringify(detail.before, null, 2)
                : "No corresponde o no fue registrado."}
            </pre>
            <h3>Valores nuevos</h3>
            <pre>
              {detail.after
                ? JSON.stringify(detail.after, null, 2)
                : "No corresponde o no fue registrado."}
            </pre>
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
