import { useEffect, useRef, useState } from "react";
import { Archive, FileText, Pencil, Plus } from "lucide-react";
import {
  emptyBibliographicFilters,
  type BibliographicRecord,
} from "./bibliography";
import { registrationDate } from "./publications";
import type { UserDto, Versioned } from "./data/contracts";
import { useDataClient } from "./data/context";
import { useQuery } from "./data/useQuery";
import { useVersionedDraft, VersionReview } from "./data/useVersionedDraft";
import { ApiPublicationForm } from "./ApiPublicationForm";
import {
  PaginationControls,
  QueryMessage,
  useDebounced,
} from "./ApiPublicationControls";
import { PublicationDetail } from "./PublicationPages";
import { Alert, Field, errorText } from "./ui";

export function ApiPublicationDetail({
  id,
  user,
}: {
  id: string;
  user: UserDto;
}) {
  const client = useDataClient();
  const request = useQuery(
    (signal) => client.publications.get(id, signal),
    [client, id],
  );
  return (
    <>
      <QueryMessage {...request} retry={request.reload} />
      {request.data && (
        <PublicationDetail publication={request.data.data} user={user} />
      )}
    </>
  );
}

function InactivatePublication({
  initial,
  onCancel,
  onDone,
}: {
  initial: Versioned<BibliographicRecord>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const client = useDataClient();
  const version = useVersionedDraft(initial.data, initial.etag, () =>
    client.publications.get(initial.data.id),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const ifMatch = await version.check(initial.data);
      await client.publications.inactivate(initial.data.id, { ifMatch });
      onDone();
    } catch (error) {
      version.failed(error);
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="publication-detail">
      <h2>Inactivar investigación</h2>
      <p>
        {initial.data.code} · {initial.data.title}
      </p>
      <p>Se conservarán sus datos históricos.</p>
      {version.conflict && (
        <>
          <QueryMessage
            loading={!version.latest && !version.reviewError}
            error={version.reviewError || undefined}
          />
          {version.latest && (
            <VersionReview
              values={{
                "Datos actuales": JSON.stringify(version.latest.data, null, 2),
              }}
              onReviewed={version.acceptLatest}
            />
          )}
        </>
      )}
      <Alert text={error} />
      <div className="publication-actions">
        <button className="secondary" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button
          className="primary"
          disabled={busy || version.conflict}
          onClick={save}
        >
          Continuar con la inactivación
        </button>
      </div>
    </section>
  );
}

export function ApiPublicationsPage({
  user,
  notify,
  initialAttachmentId = "",
  showReport,
}: {
  user: UserDto;
  notify: (text: string) => void;
  initialAttachmentId?: string;
  showReport: (id: string) => void;
}) {
  const client = useDataClient();
  const [query, setQuery] = useState("");
  const search = useDebounced(query);
  const [status, setStatus] = useState("true");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState("");
  const [creating, setCreating] = useState(!!initialAttachmentId);
  const [handoff, setHandoff] = useState(initialAttachmentId);
  const [editing, setEditing] = useState<Versioned<BibliographicRecord>>();
  const [inactive, setInactive] = useState<Versioned<BibliographicRecord>>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const request = useQuery(
    (signal) =>
      client.publications.list(
        { ...emptyBibliographicFilters, search, active: status },
        page,
        12,
        signal,
      ),
    [client, search, status, page],
  );
  useEffect(() => {
    if (request.data && page > Math.max(1, request.data.pagination.totalPages))
      setPage(Math.max(1, request.data.pagination.totalPages));
  }, [request.data, page]);
  async function read(id: string, action: "edit" | "inactivate") {
    setBusy(true);
    setError("");
    try {
      const result = await client.publications.get(id);
      if (!open.current) return;
      if (!result.data.active) throw Error("La publicación está inactiva.");
      if (action === "edit") {
        setEditing(result);
        setCreating(true);
        setSelectedId("");
      } else setInactive(result);
    } catch (error) {
      if (open.current) setError(errorText(error));
    } finally {
      if (open.current) setBusy(false);
    }
  }
  const consumeHandoff = () => {
    setHandoff("");
    if (initialAttachmentId)
      history.replaceState(null, "", "#gestion-publicaciones");
  };
  if (creating)
    return (
      <ApiPublicationForm
        key={editing?.data.id ?? "new"}
        initial={editing}
        initialAttachmentId={editing ? "" : handoff}
        onCancel={() => {
          consumeHandoff();
          setCreating(false);
          setEditing(undefined);
        }}
        onSaved={(record) => {
          consumeHandoff();
          setCreating(false);
          setEditing(undefined);
          setSelectedId(record.id);
          notify(`${record.code}: investigación guardada correctamente.`);
        }}
      />
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Gestión bibliográfica</p>
          <h1>
            {selectedId
              ? "Detalle de investigación"
              : "Investigaciones registradas"}
          </h1>
          <p>Registrá trabajos aprobados y consultá sus datos.</p>
        </div>
        <div className="publication-actions">
          {selectedId ? (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setSelectedId("");
                setInactive(undefined);
              }}
            >
              Volver al listado
            </button>
          ) : (
            <button
              className="primary"
              onClick={() => {
                setEditing(undefined);
                setCreating(true);
              }}
            >
              <Plus size={18} />
              Registrar investigación
            </button>
          )}
          {user.role === "ADMINISTRADOR" && (
            <button
              className="secondary"
              onClick={() => showReport(selectedId)}
            >
              <FileText size={17} />
              {selectedId ? "Reporte de esta investigación" : "Ver reporte"}
            </button>
          )}
        </div>
      </div>
      <Alert text={error} />
      {inactive && (
        <InactivatePublication
          key={inactive.data.id}
          initial={inactive}
          onCancel={() => setInactive(undefined)}
          onDone={() => {
            setInactive(undefined);
            notify("Publicación inactivada. Se conserva su historial.");
          }}
        />
      )}
      {selectedId ? (
        <>
          <div className="publication-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => read(selectedId, "edit")}
            >
              <Pencil size={16} />
              Editar
            </button>
            {user.role === "ADMINISTRADOR" && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => read(selectedId, "inactivate")}
              >
                <Archive size={16} />
                Inactivar
              </button>
            )}
          </div>
          <ApiPublicationDetail id={selectedId} user={user} />
        </>
      ) : (
        <>
          <div className="publication-toolbar">
            <Field label="Buscar investigaciones">
              <input
                type="search"
                maxLength={300}
                placeholder="Código, título, términos completos o participantes"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </Field>
            {user.role === "ADMINISTRADOR" && (
              <Field label="Estado">
                <select
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="true">Activas</option>
                  <option value="false">Inactivas</option>
                  <option value="">Todas</option>
                </select>
              </Field>
            )}
          </div>
          <QueryMessage {...request} retry={request.reload} />
          <div className="publication-table">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Investigación</th>
                  <th>Carrera</th>
                  <th>Fecha de registro</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {request.data?.data.map((record) => (
                  <tr key={record.id}>
                    <td>{record.code}</td>
                    <td>
                      <strong>{record.title}</strong>
                      <small>
                        {record.authors.map((person) => person.name).join("; ")}
                      </small>
                      {record.active === false && (
                        <span className="badge neutral">Inactiva</span>
                      )}
                    </td>
                    <td>{record.career.name}</td>
                    <td>{registrationDate(record.createdAt)}</td>
                    <td>
                      <div className="publication-row-actions">
                        <button
                          className="secondary"
                          onClick={() => {
                            setSelectedId(record.id);
                            setError("");
                          }}
                        >
                          Ver detalle
                        </button>
                        {record.active !== false && (
                          <button
                            className="icon-btn"
                            aria-label={`Editar ${record.title}`}
                            disabled={busy}
                            onClick={() => read(record.id, "edit")}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {record.active !== false &&
                          user.role === "ADMINISTRADOR" && (
                            <button
                              className="icon-btn"
                              aria-label={`Inactivar ${record.title}`}
                              disabled={busy}
                              onClick={() => read(record.id, "inactivate")}
                            >
                              <Archive size={16} />
                            </button>
                          )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {request.data?.pagination.total === 0 && (
            <div className="publication-empty">
              <h2>No hay investigaciones para mostrar</h2>
              <p>Registrá la primera investigación o cambiá la búsqueda.</p>
            </div>
          )}
          <PaginationControls
            pagination={request.data?.pagination}
            page={page}
            setPage={setPage}
            loading={request.loading}
          />
        </>
      )}
    </>
  );
}
