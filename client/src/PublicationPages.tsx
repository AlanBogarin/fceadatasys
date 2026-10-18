import {
  Archive,
  ArrowLeft,
  Download,
  FileText,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { attachmentAccept } from "./attachments";
import { attachmentSize, selectableAttachments } from "./attachmentService";
import type { AuditIntent } from "./audit";
import { auditFailure } from "./auditSignals";
import { bibliographicRecord, emptyBibliographicFilters } from "./bibliography";
import { catalogConfig, normalizeCatalog, type CatalogKey } from "./catalogs";
import { useDataClient, useDataEnvironment } from "./data/context";
import type { UserDto as User } from "./data/contracts";
import { useQuery } from "./data/useQuery";
import { useVersionedDraft, VersionReview } from "./data/useVersionedDraft";
import type { ViewState as State } from "./data/view";
import { downloadReport } from "./publicationExports";
import {
  emptyReportFilters,
  publicationActor,
  registrationDate,
  requiredCatalogs,
  type Publication,
  type PublicationInput,
  type Reference,
  type ReportFilters,
} from "./publications";
import "./publications.css";
import { settingsOf } from "./settings";
import { Alert, applyFieldProblems, errorText, Field } from "./ui";

type PageProps = {
  state: State;
  user: User;
  notify: (message: string) => void;
  showReport: (publicationId: string) => void;
  assertActive: () => void;
  initialAttachmentId?: string;
  consumeInitialAttachment?: () => void;
};

function ReferencePicker({
  state,
  catalog,
  name,
  label,
  initialId = "",
}: {
  state: State;
  catalog: CatalogKey;
  name: string;
  label: string;
  initialId?: string;
}) {
  return (
    <Field label={label}>
      <select name={name} required defaultValue={initialId}>
        <option value="" disabled>
          Seleccioná una opción
        </option>
        {state.catalogs[catalog]
          .filter((entry) => entry.active || entry.id === initialId)
          .map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
      </select>
    </Field>
  );
}

function PeoplePicker({
  state,
  catalog,
  label,
  selected,
  onChange,
}: {
  state: State;
  catalog: "autores" | "tutores";
  label: string;
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const records = state.catalogs[catalog].filter(
    (entry) => entry.active || selected.includes(entry.id),
  );
  const client = useDataClient();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const request = useQuery(
    () =>
      client.catalogs.list(catalog, {
        search: query,
        active: "true",
        page,
        pageSize: 10,
      }),
    [state, catalog, query, page],
  );
  const matches = request.data?.data ?? [];
  const pages = Math.max(1, request.data?.pagination.totalPages ?? 1);
  const current = Math.min(page, pages);
  const visible = matches;
  const searchLabel = `Buscar ${catalog}`;
  return (
    <fieldset className="people-picker">
      <legend>{label} *</legend>
      <p>
        Seleccioná una o más personas. El número indica el orden de selección.
      </p>
      <Field label={searchLabel}>
        <input
          type="search"
          placeholder="Nombre, CI, correo u otro dato…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      </Field>
      <div className="people-selected" aria-label={`${label} seleccionados`}>
        {selected.map((identifier, index) => {
          const person = records.find((entry) => entry.id === identifier);
          return (
            <button
              key={identifier}
              type="button"
              className="person-chip"
              aria-label={`Quitar ${person?.name ?? "persona"} de ${catalog}`}
              onClick={() =>
                onChange(selected.filter((entry) => entry !== identifier))
              }
            >
              <b>{index + 1}</b> {person?.name ?? "Registro no disponible"}{" "}
              <X size={14} />
            </button>
          );
        })}
      </div>
      <p role="status">
        {request.loading
          ? "Buscando…"
          : `${request.data?.pagination.total ?? 0} coincidencia(s)`}{" "}
        · {selected.length} seleccionados
      </p>
      <div className="people-options">
        {visible.map((entry) => (
          <label key={entry.id}>
            <input
              type="checkbox"
              aria-label={entry.name}
              checked={selected.includes(entry.id)}
              onChange={(event) => {
                if (event.target.checked) {
                  onChange([...selected, entry.id]);
                } else {
                  onChange(
                    selected.filter((identifier) => identifier !== entry.id),
                  );
                }
              }}
            />
            <span>
              {entry.name}
              {entry.fields.ci && <small>CI: {entry.fields.ci}</small>}
            </span>
            {selected.includes(entry.id) && (
              <span className="badge neutral">
                {selected.indexOf(entry.id) + 1}
              </span>
            )}
          </label>
        ))}
      </div>
      <Alert text={request.error ? errorText(request.error) : ""} />
      {!request.loading && !matches.length && (
        <p>No hay coincidencias. Probá otro nombre o dato.</p>
      )}
      {pages > 1 && (
        <div className="people-pagination">
          <button
            type="button"
            className="secondary"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            Anterior
          </button>
          <span>
            Página {current} de {pages}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={current === pages}
            onClick={() => setPage(current + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </fieldset>
  );
}

export function AttachmentDownload({
  publication,
  attachment: providedAttachment,
  state,
  user,
  assertActive = () => {},
  publicationId,
}: {
  publication?: Publication;
  attachment?: Publication["attachment"];
  state?: State;
  user: User;
  assertActive?: () => void;
  publicationId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const client = useDataClient();
  const { mode } = useDataEnvironment();
  const [error, setError] = useState("");
  const latestState = useRef(state);
  const pageOpen = useRef(true);
  const running = useRef(false);
  latestState.current = state;
  useEffect(() => {
    pageOpen.current = true;
    return () => {
      pageOpen.current = false;
    };
  }, []);

  async function download() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      // Paso 1: verificar sesión, permisos y el documento realmente registrado.
      assertActive();
      const attachment = providedAttachment ?? publication?.attachment;
      if (!attachment) throw Error("No se encontró el adjunto registrado.");
      const result = await client.attachments.download(
        attachment.id,
        publication?.id ?? publicationId,
      );
      if (!pageOpen.current) return;
      assertActive();
      if ("data" in result) throw Error("El adjunto no está disponible.");
      downloadReport(result);
    } catch (caught) {
      if (mode === "mock")
        auditFailure("Publicaciones", "Operación rechazada", caught);
      if (pageOpen.current) setError(errorText(caught));
    } finally {
      running.current = false;
      if (pageOpen.current) setBusy(false);
    }
  }

  const attachment = providedAttachment ?? publication?.attachment;
  if (!attachment || user.role === "PUBLICO") return null;
  let fileSize = `${Math.ceil(attachment.size / 1024)} KB`;
  if (attachment.size >= 1024 * 1024) {
    fileSize = `${(attachment.size / 1024 / 1024).toLocaleString("es-PY", { maximumFractionDigits: 2 })} MiB`;
  }
  return (
    <div className="attachment-download">
      <p>
        {attachment.name} · {fileSize}
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={download}
      >
        <Download size={17} />
        {busy ? "Preparando archivo…" : "Descargar adjunto"}
      </button>
      <Alert text={error} />
    </div>
  );
}

export function PublicationDetail({
  publication,
  state,
  user,
  assertActive = () => {},
}: {
  publication: Publication & { hasAttachment?: boolean };
  state?: State;
  user: User;
  assertActive?: () => void;
}) {
  return (
    <article className="publication-detail">
      <p className="eyebrow">
        {publication.code} · Registrada el{" "}
        {registrationDate(publication.createdAt)}
      </p>
      <h2>{publication.title}</h2>
      <dl>
        <div>
          <dt>Autores</dt>
          <dd>{publication.authors.map((entry) => entry.name).join("; ")}</dd>
        </div>
        <div>
          <dt>Tutores / orientadores</dt>
          <dd>{publication.tutors.map((entry) => entry.name).join("; ")}</dd>
        </div>
        <div>
          <dt>Carrera</dt>
          <dd>{publication.career.name}</dd>
        </div>
        <div>
          <dt>Nivel académico</dt>
          <dd>{publication.level.name}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{publication.type.name}</dd>
        </div>
        <div>
          <dt>Sede / filial</dt>
          <dd>{publication.branch.name}</dd>
        </div>
        <div>
          <dt>Año de publicación</dt>
          <dd>{publication.year}</dd>
        </div>
        <div>
          <dt>Registrado por</dt>
          <dd>{publication.createdBy.name}</dd>
        </div>
      </dl>
      <h3>Resumen</h3>
      <p>{publication.summary}</p>
      <h3>Abstract</h3>
      <p lang="en">{publication.abstract}</p>
      <h3>Palabras clave</h3>
      <p>{publication.keywords}</p>
      <h3>
        {publication.attachment
          ? "Documento adjunto"
          : publication.externalUrl
            ? "Enlace al documento"
            : "Documento"}
      </h3>
      {publication.attachment ? (
        <AttachmentDownload
          publication={publication}
          state={state}
          user={user}
          assertActive={assertActive}
        />
      ) : publication.externalUrl ? (
        <a
          className="document-link"
          href={publication.externalUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {publication.externalUrl}
        </a>
      ) : publication.hasAttachment ? (
        <p>
          {user.role === "PUBLICO"
            ? "Tu rol permite consultar los metadatos bibliográficos. La descarga del adjunto está restringida."
            : "El adjunto no está disponible para descargar."}
        </p>
      ) : (
        <p>Publicación local sin copia digital obligatoria en Biblioteca.</p>
      )}
    </article>
  );
}

export function PublicationsPage({
  state,
  user,
  notify,
  showReport,
  assertActive,
  initialAttachmentId = "",
  consumeInitialAttachment,
}: PageProps) {
  const client = useDataClient();
  const version = useVersionedDraft<
    ReturnType<typeof bibliographicRecord> | undefined
  >(undefined);
  const [editing, setEditing] = useState<
    Publication & { hasAttachment?: boolean }
  >();
  const [status, setStatus] = useState("true");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(!!initialAttachmentId);
  const [selected, setSelected] = useState<Publication>();
  const [authorIds, setAuthorIds] = useState<string[]>([]);
  const [tutorIds, setTutorIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [documentMode, setDocumentMode] = useState(
    initialAttachmentId ? "uploaded" : "link",
  );
  const [attachmentId, setAttachmentId] = useState(initialAttachmentId);
  const [attachmentQuery, setAttachmentQuery] = useState("");
  const [requiresLibraryCopy, setRequiresLibraryCopy] = useState(true);
  const uploads = selectableAttachments(state, user.id, editing?.id);
  const attachmentTerm = normalizeCatalog(attachmentQuery);
  const matchingUploads = uploads.filter((entry) =>
    normalizeCatalog(entry.attachment.name).includes(attachmentTerm),
  );
  const selectedUpload = uploads.find(
    (entry) => entry.attachment.id === attachmentId,
  );
  const latestState = useRef(state);
  latestState.current = state;
  const saving = useRef(false);
  const pageOpen = useRef(true);
  useEffect(() => {
    pageOpen.current = true;
    consumeInitialAttachment?.();
    return () => {
      pageOpen.current = false;
    };
  }, []);
  const missing = requiredCatalogs.filter(
    (catalog) => !state.catalogs[catalog].some((entry) => entry.active),
  );
  const request = useQuery(
    () =>
      client.publications.list(
        { ...emptyBibliographicFilters, search: query, active: status },
        page,
        12,
      ),
    [state, query, status, page],
  );
  const records = request.data?.data ?? [];
  const total = request.data?.pagination.total ?? 0;
  const pages = Math.max(1, request.data?.pagination.totalPages ?? 1);
  useEffect(() => {
    if (request.data && page > pages) setPage(pages);
  }, [request.data, page, pages]);
  const currentPage = Math.min(page, pages);

  function startCreation() {
    setEditing(undefined);
    setSelected(undefined);
    setError("");
    setSummary("");
    setAuthorIds([]);
    setTutorIds([]);
    setDocumentMode("link");
    setAttachmentId("");
    setAttachmentQuery("");
    setRequiresLibraryCopy(true);
    setCreating(true);
  }

  async function startEditing(record: Publication) {
    try {
      const detail = await client.publications.get(record.id);
      const current = detail.data;
      if (current.active === false)
        throw Error("No se puede editar una publicación inactiva.");
      setEditing(current);
      setSelected(undefined);
      setError("");
      setSummary(current.summary);
      setAuthorIds(current.authors.map((person) => person.id));
      setTutorIds(current.tutors.map((person) => person.id));
      setDocumentMode(
        current.hasAttachment ? "keep" : current.externalUrl ? "link" : "none",
      );
      setAttachmentId(current.attachment?.id ?? "");
      setAttachmentQuery("");
      setRequiresLibraryCopy(
        current.requiresLibraryCopy ?? !!current.attachment,
      );
      version.review(current, detail.etag);
      setCreating(true);
    } catch (error) {
      setError(errorText(error));
    }
  }

  async function inactivate(record: Publication) {
    setError("");
    try {
      const current = await client.publications.get(record.id);
      if (
        JSON.stringify(current.data) !==
        JSON.stringify(bibliographicRecord(state, user.id, record.id))
      )
        throw Error("El registro cambió. Abrí su detalle nuevamente.");
      await client.publications.inactivate(record.id, {
        ifMatch: current.etag,
      });
      setSelected(undefined);
      notify("Publicación inactivada. Se conserva su historial.");
    } catch (error) {
      setError(errorText(error));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setError("");
    setBusy(true);
    const element = event.currentTarget;
    try {
      // Paso 1: leer los campos y participantes elegidos, sin guardar parcialmente.
      const form = new FormData(event.currentTarget);
      assertActive();
      publicationActor(state, user.id);
      let file: File | undefined;
      let attachment: PublicationInput["attachment"];
      if (documentMode === "file") {
        const selectedFile = form.get("attachment");
        if (!(selectedFile instanceof File) || !selectedFile.size)
          throw Error("Seleccioná el documento de la investigación.");
        file = selectedFile;
        const uploaded = await client.attachments.upload(file);
        attachment = undefined;
        setAttachmentId(uploaded.id);
        form.set("uploadedId", uploaded.id);
      }
      const text = (key: string) => String(form.get(key) ?? "");
      const input: PublicationInput = {
        title: text("title"),
        authorIds,
        tutorIds,
        careerId: text("careerId"),
        levelId: text("levelId"),
        typeId: text("typeId"),
        branchId: text("branchId"),
        year: Number(text("year")),
        summary: text("summary"),
        abstract: text("abstract"),
        keywords: text("keywords"),
        externalUrl: text("externalUrl"),
        attachment,
        attachmentId:
          documentMode === "file"
            ? text("uploadedId")
            : documentMode === "uploaded" || documentMode === "keep"
              ? attachmentId || undefined
              : editing
                ? null
                : undefined,
        source: documentMode === "link" ? "EXTERNA" : "LOCAL",
        requiresLibraryCopy:
          documentMode === "link" || documentMode === "none"
            ? false
            : requiresLibraryCopy,
        approved: form.get("approved") === "on",
      };
      // Paso 2: el servicio valida reglas y prepara todos los registros de la transacción.
      if (!pageOpen.current) {
        throw Error(
          "Los datos cambiaron o el formulario se cerró. Volvé a intentar.",
        );
      }
      assertActive();
      if (input.attachmentId && documentMode === "uploaded") {
        const upload = uploads.find(
          (entry) => entry.attachment.id === input.attachmentId,
        );
        if (!upload)
          throw Error("El archivo ya no está disponible para vincular.");
      }
      const etag = editing
        ? await version.check(
            bibliographicRecord(latestState.current, user.id, editing.id),
            "PRECONDITION_FAILED",
          )
        : undefined;
      // Paso 3: persistir todo junto; informar éxito solamente si la escritura finaliza.
      const { approved, attachment: _metadata, ...patch } = input;
      const result = editing
        ? await client.publications
            .update(editing.id, patch, { ifMatch: etag })
            .catch((error) => {
              version.failed(error);
              throw error;
            })
        : await client.publications.create({ ...patch, approved });
      setSelected(result);
      setCreating(false);
      setEditing(undefined);
      notify(
        `${result.code}: investigación ${editing ? "modificada" : "registrada"} correctamente.`,
      );
    } catch (caught) {
      auditFailure("Publicaciones", "Operación rechazada", caught);
      if (pageOpen.current) {
        applyFieldProblems(element, caught);
        setError(errorText(caught));
      }
    } finally {
      saving.current = false;
      if (pageOpen.current) setBusy(false);
    }
  }

  if (creating) {
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Gestión bibliográfica</p>
            <h1>
              {editing ? "Editar investigación" : "Registrar investigación"}
            </h1>
            <p>
              Registrá los datos del trabajo aprobado y su documento, según
              corresponda.
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setCreating(false)}
          >
            <ArrowLeft size={17} /> Volver al listado
          </button>
        </div>
        {!!missing.length && (
          <div className="catalog-prerequisites" role="status">
            <strong>Antes de registrar, completá estos catálogos:</strong>
            <ul>
              {missing.map((catalog) => (
                <li key={catalog}>
                  <a href={`#${catalog}`}>{catalogConfig[catalog].title}</a>
                </li>
              ))}
            </ul>
            <p>
              Si tu rol no administra alguna de estas opciones, solicitá su
              carga al administrador.
            </p>
          </div>
        )}
        <form
          key={editing?.id ?? "new"}
          className="publication-form"
          onSubmit={submit}
        >
          {version.conflict && editing && (
            <VersionReview
              values={{
                Título:
                  state.publications?.find((record) => record.id === editing.id)
                    ?.title ?? "No disponible",
                Resumen:
                  state.publications?.find((record) => record.id === editing.id)
                    ?.summary ?? "",
                Estado:
                  state.publications?.find((record) => record.id === editing.id)
                    ?.active === false
                    ? "Inactiva"
                    : "Activa",
              }}
              onReviewed={() => {
                void client.publications
                  .get(editing.id)
                  .then((result) => {
                    version.review(result.data, result.etag);
                    setError("");
                  })
                  .catch((error) => setError(errorText(error)));
              }}
            />
          )}
          <fieldset disabled={busy} className="publication-fields">
            <section>
              <h2>1. Identificación del trabajo</h2>
              <p>Los campos con * son obligatorios.</p>
              <Field label="Título *">
                <input
                  name="title"
                  required
                  maxLength={250}
                  placeholder="Título completo de la investigación"
                  defaultValue={editing?.title}
                />
              </Field>
              <div className="publication-grid">
                <ReferencePicker
                  state={state}
                  catalog="tipos"
                  name="typeId"
                  label="Tipo de publicación *"
                  initialId={editing?.type.id}
                />
                <Field label="Año de publicación *">
                  <input
                    name="year"
                    type="number"
                    min={1900}
                    max={new Date().getFullYear()}
                    required
                    defaultValue={editing?.year ?? new Date().getFullYear()}
                  />
                </Field>
                <ReferencePicker
                  state={state}
                  catalog="carreras"
                  name="careerId"
                  label="Carrera *"
                  initialId={editing?.career.id}
                />
                <ReferencePicker
                  state={state}
                  catalog="niveles"
                  name="levelId"
                  label="Nivel académico *"
                  initialId={editing?.level.id}
                />
                <ReferencePicker
                  state={state}
                  catalog="filiales"
                  name="branchId"
                  label="Sede / filial *"
                  initialId={editing?.branch.id}
                />
              </div>
            </section>
            <section>
              <h2>2. Autoría y orientación</h2>
              <PeoplePicker
                state={state}
                catalog="autores"
                label="Autores"
                selected={authorIds}
                onChange={setAuthorIds}
              />
              <PeoplePicker
                state={state}
                catalog="tutores"
                label="Tutores / orientadores"
                selected={tutorIds}
                onChange={setTutorIds}
              />
            </section>
            <section>
              <h2>3. Contenido y documento</h2>
              <Field
                label="Resumen *"
                hint={`${summary.trim().split(/\s+/).filter(Boolean).length} / ${settingsOf(state).summaryWordLimit} palabras`}
              >
                <textarea
                  name="summary"
                  rows={5}
                  required
                  maxLength={5000}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </Field>
              <Field label="Abstract (inglés) *">
                <textarea
                  name="abstract"
                  rows={5}
                  lang="en"
                  required
                  maxLength={5000}
                  defaultValue={editing?.abstract}
                />
              </Field>
              <Field
                label="Palabras clave *"
                hint="Separá los términos con comas."
              >
                <input
                  name="keywords"
                  required
                  maxLength={300}
                  defaultValue={editing?.keywords}
                />
              </Field>
              <Field label="Documento de la investigación *">
                <select
                  value={documentMode}
                  onChange={(event) => setDocumentMode(event.target.value)}
                >
                  <option value="link">Enlace externo</option>
                  {editing?.hasAttachment && (
                    <option value="keep">
                      Conservar adjunto actual
                      {editing.attachment
                        ? `: ${editing.attachment.name}`
                        : " (sin descarga disponible)"}
                    </option>
                  )}
                  <option value="file">Archivo adjunto nuevo</option>
                  <option value="uploaded">Archivo ya cargado</option>
                  <option value="none">
                    Local sin copia digital obligatoria
                  </option>
                </select>
              </Field>
              {documentMode === "file" ? (
                <Field
                  label="Adjuntar documento *"
                  hint={`Hasta ${settingsOf(state).maxPdfSizeMb} MiB. El archivo quedará guardado en este navegador.`}
                >
                  <input
                    name="attachment"
                    type="file"
                    accept={attachmentAccept(settingsOf(state).allowedFormats)}
                    required
                  />
                </Field>
              ) : documentMode === "uploaded" ? (
                <>
                  <Field
                    label="Buscar archivos ya cargados"
                    hint="Buscá por nombre. La selección se conserva al cambiar la búsqueda."
                  >
                    <input
                      type="search"
                      placeholder="Nombre del archivo…"
                      value={attachmentQuery}
                      onChange={(event) =>
                        setAttachmentQuery(event.target.value)
                      }
                    />
                  </Field>
                  <p role="status">
                    {matchingUploads.length} de {uploads.length} archivo(s)
                    disponible(s)
                  </p>
                  <Field
                    label="Archivo disponible *"
                    hint="Se vinculará al guardar la investigación. Cada documento conserva su reserva histórica."
                  >
                    <select
                      required
                      value={attachmentId}
                      onChange={(event) => setAttachmentId(event.target.value)}
                    >
                      <option value="">Seleccioná un archivo cargado</option>
                      {selectedUpload &&
                        !matchingUploads.some(
                          (entry) => entry.attachment.id === attachmentId,
                        ) && (
                          <option value={attachmentId}>
                            {selectedUpload.attachment.name} ·{" "}
                            {attachmentSize(selectedUpload.attachment.size)}
                            {" (seleccionado)"}
                          </option>
                        )}
                      {matchingUploads.map((entry) => (
                        <option
                          key={entry.attachment.id}
                          value={entry.attachment.id}
                        >
                          {entry.attachment.name} ·{" "}
                          {attachmentSize(entry.attachment.size)}
                        </option>
                      ))}
                    </select>
                    {!uploads.length && (
                      <small>
                        No hay archivos disponibles. Podés adjuntar un documento
                        nuevo en este formulario.
                      </small>
                    )}
                  </Field>
                  {!!uploads.length && !matchingUploads.length && (
                    <p>No hay archivos que coincidan. Probá otro nombre.</p>
                  )}
                </>
              ) : documentMode === "link" ? (
                <Field
                  label="Enlace al documento *"
                  hint="Dirección HTTP o HTTPS del documento alojado externamente."
                >
                  <input
                    name="externalUrl"
                    type="url"
                    required
                    maxLength={2000}
                    placeholder="https://..."
                    defaultValue={editing?.externalUrl}
                  />
                </Field>
              ) : documentMode === "keep" ? (
                <p>Se conservará el documento actual y su historial de uso.</p>
              ) : (
                <p>
                  Esta modalidad corresponde a trabajos locales que no requieren
                  conservar una copia digital en Biblioteca.
                </p>
              )}
              {documentMode !== "link" && (
                <label className="publication-confirm">
                  <input
                    type="checkbox"
                    checked={
                      documentMode === "none" ? false : requiresLibraryCopy
                    }
                    disabled={documentMode === "none"}
                    onChange={(event) =>
                      setRequiresLibraryCopy(event.target.checked)
                    }
                  />
                  Corresponde conservar este trabajo en Biblioteca (archivo
                  obligatorio).
                </label>
              )}
              <label className="publication-confirm">
                <input
                  name="approved"
                  type="checkbox"
                  required
                  defaultChecked={!!editing}
                />{" "}
                Confirmo que el trabajo ya fue aprobado fuera del repositorio.
              </label>
            </section>
          </fieldset>
          <Alert text={error} />
          <div className="publication-actions">
            <button
              className="secondary"
              type="button"
              disabled={busy}
              onClick={() => setCreating(false)}
            >
              Cancelar
            </button>
            <button
              className="primary"
              disabled={busy || !!missing.length}
              type="submit"
            >
              {busy ? "Guardando investigación…" : "Guardar investigación"}
            </button>
          </div>
        </form>
      </>
    );
  }

  if (selected) {
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Registro guardado</p>
            <h1>Detalle de investigación</h1>
          </div>
          <div className="publication-actions">
            <button
              className="secondary"
              onClick={() => setSelected(undefined)}
            >
              <ArrowLeft size={17} /> Volver
            </button>
            {user.role === "ADMINISTRADOR" && (
              <button
                className="primary"
                onClick={() => showReport(selected.id)}
              >
                <FileText size={17} /> Reporte de esta investigación
              </button>
            )}
            {selected.active !== false && (
              <button
                className="secondary"
                onClick={() => startEditing(selected)}
              >
                <Pencil size={17} /> Editar
              </button>
            )}
            {selected.active !== false && user.role === "ADMINISTRADOR" && (
              <button
                className="secondary"
                onClick={() => inactivate(selected)}
              >
                <Archive size={17} /> Inactivar
              </button>
            )}
          </div>
        </div>
        <PublicationDetail
          publication={selected}
          state={state}
          user={user}
          assertActive={assertActive}
        />
        <Alert text={error} />
        {user.role === "DIGITADOR" && (
          <p>El registro está disponible en Reportes para el administrador.</p>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Gestión bibliográfica</p>
          <h1>Investigaciones registradas</h1>
          <p>Registrá trabajos aprobados y consultá sus datos.</p>
        </div>
        <button className="primary" onClick={startCreation}>
          <Plus size={18} /> Registrar investigación
        </button>
      </div>
      <div className="publication-toolbar">
        <Field label="Buscar por código, título o autor">
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Buscar investigación"
          />
        </Field>
        <span>{request.loading ? "Consultando…" : `${total} registros`}</span>
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
        {user.role === "ADMINISTRADOR" && (
          <button className="secondary" onClick={() => showReport("")}>
            <FileText size={17} /> Ver reporte
          </button>
        )}
      </div>
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
            {records.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.code}</td>
                <td>
                  <strong>{entry.title}</strong>
                  <small>
                    {entry.authors.map((author) => author.name).join("; ")}
                  </small>
                </td>
                <td>{entry.career.name}</td>
                <td>{registrationDate(entry.createdAt)}</td>
                <td>
                  <div className="publication-row-actions">
                    <button
                      className="secondary"
                      onClick={() => setSelected(entry)}
                    >
                      Ver detalle
                    </button>
                    {entry.active !== false && (
                      <button
                        className="icon-btn"
                        title="Editar"
                        onClick={() => startEditing(entry)}
                        aria-label={`Editar ${entry.title}`}
                      >
                        <Pencil size={16} />
                      </button>
                    )}
                    {entry.active === false && (
                      <span className="badge neutral">Inactiva</span>
                    )}
                    {entry.active !== false &&
                      user.role === "ADMINISTRADOR" && (
                        <button
                          className="icon-btn"
                          title="Inactivar"
                          onClick={() => inactivate(entry)}
                          aria-label={`Inactivar ${entry.title}`}
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
        {!request.loading && !records.length && (
          <div className="publication-empty">
            <FileText size={32} />
            <h2>No hay investigaciones para mostrar</h2>
            <p>Registrá la primera investigación o cambiá la búsqueda.</p>
          </div>
        )}
      </div>
      <Alert text={error} />
      <Alert text={request.error ? errorText(request.error) : ""} />
      <div className="people-pagination">
        <button
          className="secondary"
          disabled={currentPage === 1}
          onClick={() => setPage(currentPage - 1)}
        >
          Anterior
        </button>
        <span>
          Página {currentPage} de {pages} · {total} registros
        </span>
        <button
          className="secondary"
          disabled={currentPage === pages}
          onClick={() => setPage(currentPage + 1)}
        >
          Siguiente
        </button>
      </div>
    </>
  );
}

export function PublicationReportsPage({
  state,
  user,
  initialId,
  assertActive,
  recordAudit,
}: {
  state: State;
  user: User;
  initialId: string;
  assertActive: () => void;
  recordAudit: (intent: AuditIntent) => void;
}) {
  const client = useDataClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState<ReportFilters>({
    ...emptyReportFilters,
    publicationId: initialId,
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const latestState = useRef(state);
  const pageOpen = useRef(true);
  useEffect(() => {
    pageOpen.current = true;
    return () => {
      pageOpen.current = false;
    };
  }, []);
  latestState.current = state;
  const request = useQuery(
    () => client.reports.list(filters, page, pageSize),
    [state, filters, page, pageSize],
  );
  useEffect(() => {
    const lastPage = Math.max(1, request.data?.pagination.totalPages ?? 1);
    if (request.data && page > lastPage) setPage(lastPage);
  }, [request.data, page]);
  const records = request.data?.data ?? [];
  const total = request.data?.pagination.total ?? 0;
  const filterError = request.error ? errorText(request.error) : "";
  const exportable = !!request.data?.report.exportable && !request.loading;
  const saved = state.publications ?? [];
  const uniqueReferences = (
    field: "career" | "level" | "type",
  ): Reference[] => [
    ...new Map(saved.map((entry) => [entry[field].id, entry[field]])).values(),
  ];
  function changeFilter(key: keyof ReportFilters, value: string) {
    setFilters({ ...filters, [key]: value });
    setPage(1);
    setError("");
    setNotice("");
  }
  async function exportReport(format: "pdf" | "xlsx") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      // Paso 1: comprobar sesión y permisos antes de preparar el archivo.
      assertActive();
      if (!request.data?.report.snapshot)
        throw Error("Consultá una selección exportable antes de descargar.");
      const report = await client.reports.export(
        filters,
        format,
        request.data.report.snapshot,
      );
      // Paso 2: una generación lenta no debe saltarse el vencimiento de la sesión.
      if (!pageOpen.current) {
        return;
      }
      assertActive();
      // Paso 3: descargar exactamente los registros filtrados y confirmar el resultado.
      if ("data" in report) {
        setNotice("No hay registros para exportar. No se generó un archivo.");
        return;
      }
      downloadReport(report);
      setNotice(
        `Reporte ${format.toUpperCase()} generado con ${total} registro(s).`,
      );
    } catch (caught) {
      auditFailure("Publicaciones", "Operación rechazada", caught);
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reportes · Registro de investigaciones</p>
          <h1>Reporte de investigaciones</h1>
          <p>Consultá y exportá los mismos datos guardados en Publicaciones.</p>
        </div>
      </div>
      <fieldset className="report-filters" disabled={busy}>
        <h2>Filtros del reporte</h2>
        <p>
          El período corresponde a la fecha de registro, en horario de Paraguay.
        </p>
        <div className="publication-grid">
          <Field label="Fecha de registro desde">
            <input
              type="date"
              value={filters.from}
              onInput={(event) =>
                changeFilter("from", event.currentTarget.value)
              }
            />
          </Field>
          <Field label="Fecha de registro hasta">
            <input
              type="date"
              value={filters.to}
              onInput={(event) => changeFilter("to", event.currentTarget.value)}
            />
          </Field>
          <Field label="Carrera">
            <select
              value={filters.careerId}
              onChange={(event) => changeFilter("careerId", event.target.value)}
            >
              <option value="">Todas las carreras</option>
              {uniqueReferences("career").map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nivel académico">
            <select
              value={filters.levelId}
              onChange={(event) => changeFilter("levelId", event.target.value)}
            >
              <option value="">Todos los niveles</option>
              {uniqueReferences("level").map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Investigación">
            <select
              value={filters.publicationId}
              onChange={(event) =>
                changeFilter("publicationId", event.target.value)
              }
            >
              <option value="">Todas las investigaciones</option>
              {saved.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.code} · {entry.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo de publicación">
            <select
              value={filters.typeId ?? ""}
              onChange={(event) => changeFilter("typeId", event.target.value)}
            >
              <option value="">Todos los tipos</option>
              {uniqueReferences("type").map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Año de publicación">
            <input
              type="number"
              min={1900}
              max={9999}
              value={filters.year ?? ""}
              onChange={(event) => changeFilter("year", event.target.value)}
            />
          </Field>
          <Field label="Nombre de autor">
            <input
              value={filters.author ?? ""}
              maxLength={150}
              onChange={(event) => changeFilter("author", event.target.value)}
            />
          </Field>
          <Field label="Nombre de tutor">
            <input
              value={filters.tutor ?? ""}
              maxLength={150}
              onChange={(event) => changeFilter("tutor", event.target.value)}
            />
          </Field>
          <Field label="Estado">
            <select
              value={filters.active ?? ""}
              onChange={(event) => changeFilter("active", event.target.value)}
            >
              <option value="">Todas las publicaciones</option>
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </select>
          </Field>
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setFilters({ ...emptyReportFilters });
            setPage(1);
            setError("");
            setNotice("");
          }}
        >
          Limpiar filtros
        </button>
      </fieldset>
      <Alert text={filterError || error} />
      <Alert text={notice} success />
      <div className="report-heading">
        <div>
          <h2>Vista previa</h2>
          <p>
            {request.loading
              ? "Consultando…"
              : `${total} investigación(es) seleccionada(s)`}{" "}
            · Máximo {request.data?.report.maxRecords ?? 500} por exportación
          </p>
        </div>
        <div className="publication-actions">
          <button
            className="secondary"
            disabled={busy || !exportable || !!filterError}
            onClick={() => exportReport("xlsx")}
          >
            <Download size={17} /> Descargar Excel
          </button>
          <button
            className="primary"
            disabled={busy || !exportable || !!filterError}
            onClick={() => exportReport("pdf")}
          >
            <Download size={17} /> Descargar PDF
          </button>
        </div>
      </div>
      <button
        className="secondary"
        disabled={busy || request.loading}
        onClick={request.reload}
      >
        Actualizar vista previa
      </button>
      {total > 0 && !request.data?.report.exportable && (
        <Alert text="La selección supera el límite de exportación. Reducí los filtros." />
      )}
      <div className="people-pagination">
        <button
          className="secondary"
          disabled={page <= 1 || request.loading}
          onClick={() => setPage(page - 1)}
        >
          Anterior
        </button>
        <span>
          Página {page} de{" "}
          {Math.max(1, request.data?.pagination.totalPages ?? 1)}
        </span>
        <button
          className="secondary"
          disabled={
            page >= (request.data?.pagination.totalPages ?? 1) ||
            request.loading
          }
          onClick={() => setPage(page + 1)}
        >
          Siguiente
        </button>
        <Field label="Registros por página">
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(+event.target.value);
              setPage(1);
            }}
          >
            {[10, 20, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {records.map((entry) => (
        <PublicationDetail
          key={entry.id}
          publication={entry}
          state={state}
          user={user}
          assertActive={assertActive}
        />
      ))}
      {!request.loading && !records.length && (
        <div className="publication-empty">
          <Search size={32} />
          <h2>No hay registros con estos filtros</h2>
          <p>
            Registrá una investigación o ajustá los filtros. No se generarán
            archivos vacíos.
          </p>
        </div>
      )}
    </>
  );
}
