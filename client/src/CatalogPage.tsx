import { hasPermission } from "./permissions";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  FolderOpen,
  ListFilter,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { auditFailure } from "./auditSignals";
import { catalogConfig, type CatalogKey, type CatalogRecord } from "./catalogs";
import { useDataClient } from "./data/context";
import type { UserDto as User } from "./data/contracts";
import { catalogDto } from "./data/contracts";
import { useQuery } from "./data/useQuery";
import { useActionVersion } from "./data/useActionVersion";
import { useVersionedDraft, VersionReview } from "./data/useVersionedDraft";
import type { ViewState as State } from "./data/view";
import { applyFieldProblems } from "./ui";
type VersionedCatalog = CatalogRecord & { etag?: string };

function CatalogDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-label={title} onCancel={close}>
      <div className="modal-heading">
        <div>
          <p className="eyebrow">Catálogos institucionales</p>
          <h2>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Cerrar formulario"
          onClick={close}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
const message = (e: unknown) =>
  e instanceof DOMException && e.name === "AbortError"
    ? ""
    : e instanceof Error
      ? e.message
      : "No se pudo guardar el registro.";

export default function CatalogPage({
  catalog,
  state,
  user,
  notify,
}: {
  catalog: CatalogKey;
  state?: State;
  user: User;
  notify: (s: string) => void;
}) {
  const client = useDataClient();
  const config = catalogConfig[catalog];
  const person = catalog === "autores" || catalog === "tutores";
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<VersionedCatalog | "new" | null>(null);
  const [detail, setDetail] = useState<CatalogRecord | null>(null);
  const [toggle, setToggle] = useState<VersionedCatalog | null>(null);
  const [deleting, setDeleting] = useState<VersionedCatalog | null>(null);
  const [error, setError] = useState("");
  const actionVersion = useActionVersion<CatalogRecord>(
    `${toggle?.id ?? ""}:${deleting?.id ?? ""}`,
  );
  const request = useQuery(
    (signal) =>
      client.catalogs.list(
        catalog,
        {
          search: query,
          active: status ? String(status === "active") : "",
          page,
          pageSize: 8,
        },
        signal,
      ),
    [state, catalog, query, status, page],
  );
  const filtered = request.data?.data ?? [];
  const total = request.data?.pagination.total ?? 0;
  const totalRecords = request.data?.summary.total;
  const activeRecords = request.data?.summary.active;
  const pages = Math.max(1, request.data?.pagination.totalPages ?? 1);
  useEffect(() => {
    if (request.data && page > pages) setPage(pages);
  }, [request.data, page, pages]);
  const current = Math.min(page, pages);
  const visible = filtered;
  const resetFilters = () => {
    setQuery("");
    setStatus("");
    setPage(1);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {person ? "Gestión bibliográfica" : "Administración"} / Catálogos
          </p>
          <h1>{config.title}</h1>
          <p>{config.description}</p>
        </div>
        <button className="primary" onClick={() => setEditing("new")}>
          <Plus size={18} />
          {config.createLabel}
        </button>
      </div>
      <div className="stats-grid compact">
        <div className="stat">
          <span className="stat-icon">
            <FolderOpen />
          </span>
          <div>
            <p>Total de registros</p>
            <strong>
              {totalRecords === undefined
                ? "—"
                : String(totalRecords).padStart(2, "0")}
            </strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon">
            <Check />
          </span>
          <div>
            <p>Activos</p>
            <strong>
              {activeRecords === undefined
                ? "—"
                : String(activeRecords).padStart(2, "0")}
            </strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon lilac">
            <Settings2 />
          </span>
          <div>
            <p>Inactivos</p>
            <strong>
              {totalRecords === undefined || activeRecords === undefined
                ? "—"
                : String(totalRecords - activeRecords).padStart(2, "0")}
            </strong>
          </div>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Directorio de {config.title.toLocaleLowerCase("es")}</h2>
            <p>Consultá, agregá y actualizá los registros.</p>
          </div>
          <span className="badge blue">{totalRecords ?? "—"} registros</span>
        </div>
        <div className="filter-bar">
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label={`Buscar en ${config.title}`}
              placeholder={
                person
                  ? "Buscar por nombre, CI o correo…"
                  : "Buscar por nombre o datos del registro…"
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            aria-label="Filtrar por estado"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
          <button
            className="icon-btn filter-clear"
            aria-label="Limpiar filtros"
            onClick={resetFilters}
          >
            <ListFilter size={19} />
          </button>
        </div>
        <div className="table-scroll">
          <table className="catalog-table">
            <thead>
              <tr>
                <th>{person ? "Nombre completo" : "Nombre"}</th>
                {config.fields.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
                <th>Estado</th>
                <th className="actions-th">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong className="catalog-name">{record.name}</strong>
                  </td>
                  {config.fields.map((f) => (
                    <td key={f.key}>
                      <span className="catalog-value">
                        {record.fields[f.key] || "—"}
                      </span>
                    </td>
                  ))}
                  <td>
                    <span className={`status ${record.active ? "active" : ""}`}>
                      <i />
                      {record.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        title="Ver detalle"
                        aria-label={`Ver ${record.name}`}
                        onClick={() => {
                          void client.catalogs
                            .get(catalog, record.id)
                            .then((result) => setDetail(result.data))
                            .catch((error) => setError(message(error)));
                        }}
                      >
                        <Eye size={17} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Editar"
                        aria-label={`Editar ${record.name}`}
                        onClick={() => {
                          void client.catalogs
                            .get(catalog, record.id)
                            .then((result) =>
                              setEditing({ ...result.data, etag: result.etag }),
                            )
                            .catch((error) => setError(message(error)));
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-btn"
                        title={record.active ? "Inactivar" : "Activar"}
                        aria-label={`${record.active ? "Inactivar" : "Activar"} ${record.name}`}
                        onClick={async () => {
                          setError("");
                          try {
                            const result = await client.catalogs.get(
                              catalog,
                              record.id,
                            );
                            setToggle({ ...result.data, etag: result.etag });
                          } catch (error) {
                            setError(message(error));
                          }
                        }}
                      >
                        <Settings2 size={17} />
                      </button>
                      {hasPermission(user, `catalogs.${catalog}.delete`) && (
                        <button
                          type="button"
                          className="icon-btn catalog-delete"
                          title="Eliminar"
                          aria-label={`Eliminar ${record.name}`}
                          onClick={async () => {
                            setError("");
                            try {
                              const result = await client.catalogs.get(
                                catalog,
                                record.id,
                              );
                              setDeleting({
                                ...result.data,
                                etag: result.etag,
                              });
                            } catch (error) {
                              setError(message(error));
                            }
                          }}
                        >
                          <Trash2 size={17} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {request.loading && <p role="status">Consultando registros…</p>}
        {Boolean(request.error) && <p role="alert">{message(request.error)}</p>}
        {!request.loading && !request.error && !visible.length && (
          <div className="no-results catalog-empty">
            <FolderOpen size={34} />
            <h3>
              {totalRecords
                ? "No se encontraron coincidencias"
                : `Todavía no hay registros en ${config.title.toLocaleLowerCase("es")}`}
            </h3>
            <p>
              {totalRecords
                ? "Probá otra búsqueda o limpiá los filtros."
                : "Agregá el primer registro para comenzar a organizar este catálogo."}
            </p>
            <button
              className="secondary"
              onClick={totalRecords ? resetFilters : () => setEditing("new")}
            >
              {totalRecords ? "Limpiar filtros" : config.createLabel}
            </button>
          </div>
        )}
        <div className="table-footer">
          <span>
            {filtered.length
              ? `Mostrando ${(current - 1) * 8 + 1}–${Math.min(current * 8, total)} de ${total} registros`
              : request.data
                ? "0 registros"
                : request.loading
                  ? "Consultando…"
                  : "Sin datos disponibles"}
          </span>
          <div className="pagination">
            <button
              className="icon-btn"
              aria-label="Página anterior"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {current} / {pages}
            </span>
            <button
              className="icon-btn"
              aria-label="Página siguiente"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </section>
      <div className="inline-note">
        <ShieldCheck size={18} />
        <p>
          La inactivación conserva la información y puede revertirse. Los
          nombres y los identificadores no deben repetirse dentro del catálogo.
        </p>
      </div>
      {deleting && (
        <CatalogDialog
          title="Eliminar registro"
          close={() => setDeleting(null)}
        >
          <div className="modal-body">
            {actionVersion.review}
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <p>
              ¿Querés eliminar definitivamente <strong>{deleting.name}</strong>?
            </p>
            <p className="muted catalog-confirm-note">
              Esta acción no se puede deshacer. Solo se permite si el registro
              no está vinculado a investigaciones.
            </p>
          </div>
          <div className="modal-footer">
            <button
              type="button"
              className="secondary"
              onClick={() => setDeleting(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="primary"
              disabled={actionVersion.blocked}
              onClick={async () => {
                try {
                  // Paso 1 y 2: el servicio exige Administrador y ausencia de referencias.
                  // Paso 3: confirmar el guardado antes de comunicar la eliminación.
                  await client.catalogs.remove(catalog, deleting.id, {
                    ifMatch: deleting.etag,
                  });
                  notify("Registro eliminado.");
                  setDeleting(null);
                } catch (caught) {
                  actionVersion.failed(
                    caught,
                    () => client.catalogs.get(catalog, deleting.id),
                    (result) => {
                      setDeleting({ ...result.data, etag: result.etag });
                      setError("");
                    },
                  );
                  auditFailure("Catálogos", "Operación rechazada", caught);
                  setError(message(caught));
                }
              }}
            >
              Eliminar definitivamente
            </button>
          </div>
        </CatalogDialog>
      )}
      {editing && (
        <CatalogForm
          catalog={catalog}
          state={state}
          user={user}
          editing={editing}
          notify={notify}
          close={() => setEditing(null)}
        />
      )}
      {detail && (
        <CatalogDialog
          title={`Detalle de ${config.singular}`}
          close={() => setDetail(null)}
        >
          <div className="catalog-detail-heading">
            <h3>{detail.name}</h3>
            <span className={`badge ${detail.active ? "blue" : "neutral"}`}>
              {detail.active ? "Activo" : "Inactivo"}
            </span>
          </div>
          <dl className="details">
            {[
              ...config.fields.map((f) => [
                f.label,
                detail.fields[f.key] || "Sin registrar",
              ]),
              [
                "Fecha de registro",
                new Date(detail.createdAt).toLocaleString("es-PY"),
              ],
              [
                "Última modificación",
                new Date(detail.updatedAt).toLocaleString("es-PY"),
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setDetail(null)}>
              Cerrar
            </button>
          </div>
        </CatalogDialog>
      )}
      {toggle && (
        <CatalogDialog
          title={toggle.active ? "Inactivar registro" : "Activar registro"}
          close={() => setToggle(null)}
        >
          <div className="modal-body">
            {actionVersion.review}
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <p>
              ¿Querés {toggle.active ? "inactivar" : "activar"}{" "}
              <strong>{toggle.name}</strong>?
            </p>
            <p className="muted catalog-confirm-note">
              {toggle.active
                ? "Sus datos seguirán disponibles para consulta y podrás volver a activarlo."
                : "El registro volverá a estar activo en este catálogo."}
            </p>
          </div>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setToggle(null)}>
              Cancelar
            </button>
            <button
              className="primary"
              disabled={actionVersion.blocked}
              onClick={async () => {
                try {
                  await client.catalogs.active(
                    catalog,
                    toggle.id,
                    !toggle.active,
                    { ifMatch: toggle.etag },
                  );
                  notify(
                    toggle.active
                      ? "Registro inactivado."
                      : "Registro activado.",
                  );
                  setToggle(null);
                } catch (e) {
                  actionVersion.failed(
                    e,
                    () => client.catalogs.get(catalog, toggle.id),
                    (result) => {
                      setToggle({ ...result.data, etag: result.etag });
                      setError("");
                    },
                  );
                  auditFailure("Catálogos", "Operación rechazada", e);
                  setError(message(e));
                }
              }}
            >
              Confirmar
            </button>
          </div>
        </CatalogDialog>
      )}
    </>
  );
}

function CatalogForm({
  catalog,
  state,
  user,
  editing,
  notify,
  close,
}: {
  catalog: CatalogKey;
  state?: State;
  user: User;
  editing: VersionedCatalog | "new";
  notify: (s: string) => void;
  close: () => void;
}) {
  const config = catalogConfig[catalog];
  const record = editing === "new" ? null : editing;
  const client = useDataClient();
  const version = useVersionedDraft(
    record ? catalogDto(record) : null,
    record?.etag,
    record ? () => client.catalogs.get(catalog, record.id) : undefined,
  );
  const current =
    version.latest?.data ??
    (record
      ? state?.catalogs[catalog].find((item) => item.id === record.id)
      : undefined);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const element = e.currentTarget;
    const values = new FormData(element);
    try {
      const etag = record
        ? await version.check(current ? catalogDto(current) : null)
        : undefined;
      await client.catalogs.save(
        catalog,
        {
          name: String(values.get("name") || ""),
          fields: Object.fromEntries(
            config.fields.map((f) => [f.key, String(values.get(f.key) || "")]),
          ),
        },
        record?.id,
        { ifMatch: etag },
      );
      notify(record ? "Registro actualizado." : "Registro creado.");
      close();
    } catch (e) {
      applyFieldProblems(element, e);
      version.failed(e);
      auditFailure("Catálogos", "Operación rechazada", e);
      setError(message(e));
    }
  }
  return (
    <CatalogDialog
      title={record ? `Editar ${config.singular}` : config.createLabel}
      close={close}
    >
      <form onSubmit={submit}>
        <div className="modal-body">
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {version.reviewError && <p role="alert">{version.reviewError}</p>}
          {version.conflict && !version.latest && !version.reviewError && (
            <p role="status">Consultando la versión actual…</p>
          )}
          {version.conflict && version.latest && current && (
            <VersionReview
              values={{
                Nombre: current.name,
                ...current.fields,
                Estado: current.active ? "Activo" : "Inactivo",
              }}
              onReviewed={() => {
                version.acceptLatest();
                setError("");
              }}
            />
          )}
          <p className="muted">
            Los campos marcados con * son obligatorios.
          </p>
          <label className="field">
            <span>
              {catalog === "autores" || catalog === "tutores"
                ? "Nombre completo *"
                : "Nombre *"}
            </span>
            <input
              name="name"
              required
              maxLength={150}
              defaultValue={record?.name}
              autoFocus
              autoComplete="off"
            />
          </label>
          {config.fields.map((field) => (
            <label key={field.key} className="field">
              <span>
                {field.label}
                {field.required ? " *" : ""}
              </span>
              {field.key === "descripcion" ? (
                <textarea
                  name={field.key}
                  maxLength={field.maxLength}
                  defaultValue={record?.fields[field.key]}
                  rows={3}
                />
              ) : (
                <input
                  name={field.key}
                  required={field.required}
                  type={field.type || "text"}
                  inputMode={field.key === "ci" ? "numeric" : undefined}
                  maxLength={field.maxLength}
                  placeholder={field.placeholder}
                  defaultValue={record?.fields[field.key]}
                  autoComplete="off"
                />
              )}
            </label>
          ))}
          {record && !record.active && (
            <p className="inline-hint">
              Este registro está inactivo. Editarlo conserva su estado; podés
              activarlo desde el listado.
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={close}>
            Cancelar
          </button>
          <button className="primary">
            {record ? "Guardar cambios" : "Crear registro"}
            <Check size={17} />
          </button>
        </div>
      </form>
    </CatalogDialog>
  );
}
