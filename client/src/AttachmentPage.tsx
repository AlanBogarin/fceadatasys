import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  FolderOpen,
  UploadCloud,
  X,
} from "lucide-react";
import type { State, User } from "./model";
import { Alert, Field, errorText } from "./ui";
import { normalizeCatalog } from "./catalogs";
import { registrationDate } from "./publications";
import { AttachmentDownload } from "./PublicationPages";
import {
  attachmentRecords,
  attachmentSize,
  uploadAttachment,
  type UploadedAttachment,
} from "./attachmentService";
import "./attachments.css";

export function AttachmentPage({
  state,
  user,
  commit,
  assertActive,
  register,
}: {
  state: State;
  user: User;
  commit: (state: State) => void;
  assertActive: () => void;
  register: (attachmentId: string) => void;
}) {
  const [file, setFile] = useState<File>();
  const [stage, setStage] = useState<"validating" | "saving">();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState<UploadedAttachment>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const records = attachmentRecords(state, user.id);
  const available = records.filter((entry) => !entry.publication).length;
  const term = normalizeCatalog(query);
  const matches = records.filter(
    (entry) =>
      (filter === "all" ||
        (filter === "available" ? !entry.publication : !!entry.publication)) &&
      normalizeCatalog(
        `${entry.attachment.name} ${entry.publication?.title ?? ""} ${entry.publication?.code ?? ""}`,
      ).includes(term),
  );
  const pages = Math.max(1, Math.ceil(matches.length / 8));
  const current = Math.min(page, pages);
  const busy = !!stage;

  function selectFiles(files: FileList | null) {
    if (running.current) return;
    setError("");
    setUploaded(undefined);
    if (!files?.length) return;
    if (files.length !== 1) {
      setFile(undefined);
      setError("Seleccioná un solo PDF por carga.");
      return;
    }
    setFile(files[0]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (running.current) return;
    if (!file) {
      setError("Seleccioná el PDF que querés cargar.");
      return;
    }
    running.current = true;
    setError("");
    setUploaded(undefined);
    try {
      const result = await uploadAttachment({
        state,
        actorId: user.id,
        file,
        commit,
        onStage: setStage,
        assertActive: () => {
          assertActive();
          if (!mounted.current)
            throw Error("La pantalla se cerró. No se confirmó la carga.");
          if (latest.current !== state)
            throw Error("Los datos cambiaron. Volvé a intentar la carga.");
        },
      });
      if (!mounted.current) return;
      setUploaded(result);
      setFile(undefined);
      if (input.current) input.current.value = "";
      setFilter("available");
      setQuery("");
      setPage(1);
    } catch (caught) {
      if (mounted.current) setError(errorText(caught));
    } finally {
      running.current = false;
      if (mounted.current) setStage(undefined);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Gestión bibliográfica</p>
          <h1>Carga de archivos</h1>
          <p>
            Prepará el documento y vinculalo al registrar una investigación.
          </p>
        </div>
        <a className="secondary" href="#gestion-publicaciones">
          <FolderOpen size={18} /> Ver publicaciones
        </a>
      </div>
      <ol className="upload-steps" aria-label="Proceso de carga">
        <li>
          <span>1</span>
          <div>
            <strong>Cargar el PDF</strong>
            <small>Seleccioná y guardá el documento.</small>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <strong>Registrar la publicación</strong>
            <small>Completá sus datos y elegí el archivo cargado.</small>
          </div>
        </li>
      </ol>
      <div className="upload-layout">
        <form className="upload-card" onSubmit={submit} aria-busy={busy}>
          <h2>Nuevo archivo</h2>
          <p>Un documento por carga · PDF de hasta 10 MB</p>
          <div
            className={`upload-dropzone${dragging ? " dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              selectFiles(event.dataTransfer.files);
            }}
          >
            <UploadCloud size={36} aria-hidden="true" />
            <strong>Arrastrá tu PDF hasta aquí</strong>
            <span>o elegilo desde tu equipo</span>
            <label
              className={`secondary upload-file-label${busy ? " disabled" : ""}`}
            >
              Seleccionar PDF
              <input
                ref={input}
                type="file"
                accept=".pdf,application/pdf"
                disabled={busy}
                onChange={(event) => {
                  selectFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          {file && (
            <div className="upload-selection">
              <FileText size={24} aria-hidden="true" />
              <div>
                <strong>{file.name}</strong>
                <small>{attachmentSize(file.size)}</small>
              </div>
              <button
                type="button"
                className="icon-btn"
                disabled={busy}
                aria-label="Quitar archivo seleccionado"
                onClick={() => {
                  setFile(undefined);
                  setError("");
                }}
              >
                <X size={18} />
              </button>
            </div>
          )}
          <Alert text={error} />
          <div className="upload-submit">
            <span role="status">
              {stage === "validating"
                ? "Comprobando el PDF y buscando duplicados…"
                : stage === "saving"
                  ? "Guardando el archivo…"
                  : "El archivo se vincula al confirmar la publicación."}
            </span>
            <button className="primary" type="submit" disabled={!file || busy}>
              <UploadCloud size={18} />
              {busy ? "Cargando…" : "Cargar archivo"}
            </button>
          </div>
        </form>
        <aside className="upload-guide">
          <h2>Antes de cargar</h2>
          <ul>
            <li>Usá la versión final de un trabajo aprobado.</li>
            <li>
              Se comprueba el formato, el contenido básico y el tamaño del PDF.
            </li>
            <li>
              No se admite el mismo archivo dos veces, aunque cambies su nombre.
            </li>
            <li>
              Los archivos disponibles se pueden usar en una sola publicación.
            </li>
          </ul>
          <div className="upload-demo-note">
            <strong>Demostración local</strong>
            <p>
              Los archivos quedan en este navegador. Esta versión no realiza
              análisis antivirus.
            </p>
          </div>
        </aside>
      </div>
      {uploaded && (
        <div className="upload-success" role="status">
          <Check size={23} aria-hidden="true" />
          <div>
            <strong>Archivo cargado: {uploaded.attachment.name}</strong>
            <p>
              Ya está disponible. Falta registrar la publicación para
              vincularlo.
            </p>
          </div>
          <button
            className="primary"
            onClick={() => register(uploaded.attachment.id)}
          >
            Registrar publicación <ArrowRight size={17} />
          </button>
        </div>
      )}
      <section
        className="upload-library"
        aria-labelledby="upload-library-title"
      >
        <div className="report-heading">
          <div>
            <h2 id="upload-library-title">Archivos cargados</h2>
            <p>
              {available} disponibles · {records.length - available} vinculados
              a publicaciones
            </p>
          </div>
        </div>
        <div className="publication-toolbar">
          <Field label="Buscar archivo o publicación">
            <input
              type="search"
              placeholder="Nombre del PDF, título o código…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </Field>
          <Field label="Estado del archivo">
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todos los archivos</option>
              <option value="available">Disponibles para vincular</option>
              <option value="linked">Vinculados a publicaciones</option>
            </select>
          </Field>
        </div>
        <div className="publication-table attachment-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Archivo</th>
                <th scope="col">Estado / publicación</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {matches.slice((current - 1) * 8, current * 8).map((entry) => (
                <tr key={entry.attachment.id}>
                  <td>
                    <strong>{entry.attachment.name}</strong>
                    <small>
                      PDF · {attachmentSize(entry.attachment.size)} ·{" "}
                      {registrationDate(entry.createdAt)}
                    </small>
                    <details>
                      <summary>Detalles del archivo</summary>
                      <small>Cargado por {entry.createdBy.name}</small>
                      <small>SHA-256</small>
                      <code>{entry.attachment.sha256}</code>
                    </details>
                  </td>
                  <td>
                    <span
                      className={`badge ${entry.publication ? "neutral" : "active"}`}
                    >
                      {entry.publication ? "Vinculado" : "Disponible"}
                    </span>
                    {entry.publication ? (
                      <>
                        <small>{entry.publication.code}</small>
                        <p>{entry.publication.title}</p>
                      </>
                    ) : (
                      <small>Pendiente de registrar su publicación</small>
                    )}
                  </td>
                  <td>
                    {entry.publication ? (
                      <AttachmentDownload
                        publication={entry.publication}
                        state={state}
                        user={user}
                        commit={commit}
                        assertActive={assertActive}
                      />
                    ) : (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() => register(entry.attachment.id)}
                      >
                        Registrar publicación <ArrowRight size={16} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!matches.length && (
            <div className="publication-empty">
              <FolderOpen size={32} />
              <h3>
                {records.length
                  ? "No hay archivos con estos filtros"
                  : "Todavía no hay archivos cargados"}
              </h3>
              <p>
                {records.length
                  ? "Probá otro nombre o cambiá el estado seleccionado."
                  : "Cargá un PDF para empezar. Los enlaces externos se registran desde Publicaciones."}
              </p>
            </div>
          )}
        </div>
        <div className="people-pagination">
          <span role="status">
            {matches.length} archivo(s) · Página {current} de {pages}
          </span>
          <div className="publication-actions">
            <button
              className="secondary"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              Anterior
            </button>
            <button
              className="secondary"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
            >
              Siguiente
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
