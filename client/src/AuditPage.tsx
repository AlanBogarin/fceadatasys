import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  ListFilter,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import "./administration.css";
import {
  emptyAuditFilters,
  type AuditFilters,
  type AuditIntent,
} from "./audit";
import { auditFailure } from "./auditSignals";
import { useDataClient, useDataEnvironment } from "./data/context";
import type { UserDto as User } from "./data/contracts";
import { useQuery } from "./data/useQuery";
import type { ViewState as State } from "./data/view";
import { roleLabel, ROLES } from "./model";
import { downloadReport } from "./publicationExports";
import { Alert, errorText, Field, Modal } from "./ui";
import { AuditChanges } from "./AuditChanges";
import { hasPermission } from "./permissions";

export function AuditPage({
  state,
  user,
  assertActive,
}: {
  state?: State;
  user: User;
  assertActive?: () => void;
  recordAudit?: (intent: AuditIntent) => void;
}) {
  const [filters, setFilters] = useState<AuditFilters>({
    ...emptyAuditFilters,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailId, setDetailId] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const exporting = useRef(false);
  const open = useRef(true);
  const client = useDataClient();
  const api = useDataEnvironment().mode === "api";
  const allowed = api
    ? user.active && hasPermission(user, "audit.read")
    : state?.users.some(
        (account) =>
          account.id === user.id &&
          account.active &&
          account.role === "ADMINISTRADOR",
      );
  const request = useQuery(
    (signal) => {
      if (!allowed) throw Error("No tenés permiso para consultar auditoría.");
      return client.audit.list(filters, page, pageSize, signal);
    },
    [state, filters, page, pageSize],
  );
  const detailRequest = useQuery(
    async (signal) =>
      detailId && allowed ? client.audit.get(detailId, signal) : undefined,
    [detailId, allowed],
  );
  const detail = detailRequest.data;
  useEffect(() => {
    const lastPage = Math.max(1, request.data?.pagination.totalPages ?? 1);
    if (request.data && page > lastPage) setPage(lastPage);
  }, [request.data, page]);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  if (!allowed) {
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
  const records = request.data?.data ?? [];
  const total = request.data?.pagination.total ?? 0;
  const allTotal = request.data?.summary.total ?? 0;
  const filterError = request.error ? errorText(request.error) : "";
  const pages = Math.max(1, request.data?.pagination.totalPages ?? 1);
  const currentPage = Math.min(page, pages);
  const visible = records;
  const actors = new Map(
    (request.data?.summary.actors ?? []).map((actor) => [actor.id, actor.name]),
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
      assertActive?.();
      if (!request.data?.export.snapshot)
        throw Error("Consultá una selección exportable antes de descargar.");
      const report = await client.audit.export(
        filters,
        format,
        request.data.export.snapshot,
      );
      if (!open.current) return;
      assertActive?.();
      if ("data" in report) {
        setNotice("No hay eventos para exportar. No se generó un archivo.");
        return;
      }
      downloadReport(report);
      setNotice(
        `Reporte ${format.toUpperCase()} generado con ${total} ${total === 1 ? "evento" : "eventos"}.`,
      );
    } catch (caught) {
      if (!api) auditFailure("Auditoría", "Exportar auditoría", caught);
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
          <ShieldCheck size={14} /> Acceso autorizado · Solo lectura
        </span>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <span className="stat-icon">
            <Clock3 size={20} />
          </span>
          <div>
            <p>Eventos registrados</p>
            <strong>{request.data ? allTotal : "—"}</strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon blue">
            <ListFilter size={20} />
          </span>
          <div>
            <p>Coinciden con los filtros</p>
            <strong>{request.data ? total : "—"}</strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon audit-failure-icon">
            <AlertTriangle size={20} />
          </span>
          <div>
            <p>Operaciones fallidas</p>
            <strong>{request.data?.summary.failed ?? "—"}</strong>
          </div>
        </div>
      </div>
      <section className="panel" aria-busy={busy || request.loading}>
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
              {filters.actorId && !actors.has(filters.actorId) && (
                <option value={filters.actorId}>ID: {filters.actorId}</option>
              )}
              {[...actors].map(([identifier, name]) => {
                const account =
                  state?.users.find((entry) => entry.id === identifier) ??
                  request.data?.summary.actors.find(
                    (entry) => entry.id === identifier,
                  );
                return (
                  <option key={identifier} value={identifier}>
                    {account
                      ? `${account.name} · ${account.username ? `@${account.username}` : `ID: ${identifier}`}`
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
              {filters.module &&
                !request.data?.summary.modules.includes(filters.module) && (
                  <option value={filters.module}>{filters.module}</option>
                )}
              {(request.data?.summary.modules ?? []).map((name) => (
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
              {filters.operation &&
                !request.data?.summary.operations.includes(
                  filters.operation,
                ) && (
                  <option value={filters.operation}>{filters.operation}</option>
                )}
              {(request.data?.summary.operations ?? []).map((name) => (
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
            disabled={
              !hasPermission(user, "audit.export") ||
              busy ||
              request.loading ||
              !request.data?.export.exportable ||
              Boolean(filterError)
            }
            onClick={() => exportReport("pdf")}
          >
            <Download size={16} />
            {busy ? "Generando reporte…" : "Exportar PDF"}
          </button>
          <button
            className="secondary"
            disabled={
              !hasPermission(user, "audit.export") ||
              busy ||
              request.loading ||
              !request.data?.export.exportable ||
              Boolean(filterError)
            }
            onClick={() => exportReport("xlsx")}
          >
            <Download size={16} />
            Exportar Excel
          </button>
        </div>
        <div className="audit-alerts">
          <Alert text={filterError || error} />
          {request.loading && <p role="status">Consultando eventos…</p>}
          <button
            className="secondary"
            disabled={busy || request.loading}
            onClick={() => {
              client.audit.invalidateOptions?.();
              request.reload();
            }}
          >
            Actualizar resultados
          </button>
          {total > 0 && !request.data?.export.exportable && (
            <Alert text="La selección supera 500 eventos o el tamaño máximo de exportación. Reducí los filtros." />
          )}
          <Alert text={notice} success />
        </div>
        <div className="table-scroll">
          <table className="audit-table" aria-label="Eventos de auditoría">
            <thead>
              <tr>
                <th scope="col">Fecha y hora</th>
                <th scope="col">Nombre / Usuario / Rol</th>
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
                    {event.username && <small>@{event.username}</small>}
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
                      onClick={() => setDetailId(event.id)}
                    >
                      <Eye size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!request.loading && !records.length && !filterError && (
          <div className="no-results">
            <ShieldCheck size={32} />
            <h3>
              {allTotal
                ? "No hay eventos con estos filtros"
                : "Todavía no hay eventos registrados"}
            </h3>
            <p>
              {allTotal
                ? "Probá otro criterio o limpiá los filtros para ver todos los eventos."
                : "Los accesos y las operaciones se mostrarán aquí cuando se registren."}
            </p>
          </div>
        )}
        <div className="table-footer audit-pagination">
          <span role="status">
            {request.loading
              ? "Consultando eventos…"
              : filterError
                ? "Resultados no disponibles"
                : total
                  ? `Mostrando ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, total)} de ${total}`
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
              disabled={request.loading || currentPage === 1}
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
              disabled={request.loading || currentPage === pages}
              onClick={() => setPage(currentPage + 1)}
            >
              <ChevronRight />
            </button>
          </div>
        </div>
      </section>
      <p className="audit-scope">
        {api ? (
          "Bitácora del servidor. Los eventos son inmutables y el rol corresponde al momento de la operación."
        ) : (
          <>
            Bitácora local de demostración. Los registros anteriores conservan
            únicamente los datos que estaban disponibles; no se inventan
            actividades pasadas ni direcciones IP.
          </>
        )}
      </p>
      {detailId && (
        <Modal
          title="Detalle de auditoría"
          eyebrow="Trazabilidad institucional"
          close={() => setDetailId(undefined)}
        >
          {detailRequest.loading && <p role="status">Consultando detalle…</p>}
          {Boolean(detailRequest.error) && (
            <div className="modal-body">
              <Alert text={errorText(detailRequest.error)} />
              <button className="secondary" onClick={detailRequest.reload}>
                Volver a consultar
              </button>
            </div>
          )}
          {detail && (
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
                  ["Nombre completo", detail.actorName],
                  ["Usuario", detail.username],
                  ["ID usuario", detail.actorId],
                  [
                    "Rol",
                    detail.actorRole
                      ? roleLabel[detail.actorRole]
                      : "Sin identificar",
                  ],
                  ["Operación", detail.operation],
                  ["Módulo", detail.module],
                  ["Recurso", api ? detail.module : detail.resourceName],
                  ["ID recurso", detail.resourceId],
                  ["Publicación", detail.publicationId],
                  [
                    "Resultado",
                    detail.status === "EXITO" ? "Éxito" : "Fallido",
                  ],
                  ["Detalle", detail.detail],
                  ["ID sesión", detail.sessionId],
                  [
                    "IP",
                    detail.ip ??
                      (api
                        ? "No registrado"
                        : "No disponible en esta versión local"),
                  ],
                  ["Navegador", detail.userAgent],
                  ...(!api
                    ? [
                        [
                          "Origen",
                          detail.origin === "ACTUAL"
                            ? "Registrado por este módulo"
                            : "Bitácora de una versión anterior",
                        ],
                      ]
                    : []),
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "No registrado"}</dd>
                  </div>
                ))}
              </dl>
              <AuditChanges
                key={detail.id}
                before={detail.before}
                after={detail.after}
              />
            </div>
          )}
          <div className="modal-footer">
            <button
              className="secondary"
              onClick={() => setDetailId(undefined)}
            >
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
