import { useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CalendarDays,
  FileText,
  LockKeyhole,
  Search,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import type { ViewState as State } from "./data/view";
import type { UserDto as User } from "./data/contracts";
import { Alert, Field, errorText } from "./ui";
import { AttachmentDownload } from "./PublicationPages";
import { registrationDate } from "./publications";
import {
  bibliographyOptions,
  bibliographicRecord,
  emptyBibliographicFilters,
  queryBibliography,
  type BibliographicFilters,
} from "./bibliography";
import "./bibliography.css";
import { useDataClient } from "./data/context";
import { useQuery } from "./data/useQuery";

export function BibliographicPage({
  state,
  user,
  advanced,
  navigate,
  assertActive,
}: {
  state: State;
  user: User;
  advanced: boolean;
  navigate: (page: string) => void;
  assertActive: () => void;
}) {
  const [draft, setDraft] = useState({ ...emptyBibliographicFilters });
  const [filters, setFilters] = useState({ ...emptyBibliographicFilters });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const client = useDataClient();
  const request = useQuery(
    () => client.publications.list(filters, page, pageSize),
    [state, filters, page, pageSize],
  );
  const result = request.data
    ? {
        records: request.data.data,
        total: request.data.pagination.total,
        totalPages: request.data.pagination.totalPages,
        page: request.data.pagination.page,
      }
    : undefined;
  const queryError = request.error ? errorText(request.error) : "";

  function update(field: keyof BibliographicFilters, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }));
  }
  function search(event: FormEvent) {
    event.preventDefault();
    try {
      assertActive();
      queryBibliography(state, user.id, draft, 1, pageSize);
      setFilters({ ...draft });
      setPage(1);
      setError("");
      setSelectedId("");
    } catch (caught) {
      setError(errorText(caught));
    }
  }
  function clear() {
    setDraft({ ...emptyBibliographicFilters });
    setFilters({ ...emptyBibliographicFilters });
    setPage(1);
    setError("");
  }

  if (selectedId) {
    try {
      const record = bibliographicRecord(state, user.id, selectedId);
      return (
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow">Repositorio / Ficha bibliográfica</p>
              <h1>Detalle de investigación</h1>
            </div>
            <button className="secondary" onClick={() => setSelectedId("")}>
              <ArrowLeft size={17} /> Volver a resultados
            </button>
          </div>
          <article className="publication-detail">
            <p className="eyebrow">
              {record.code} · {record.year} ·{" "}
              {record.source === "LOCAL"
                ? "Publicación local"
                : "Publicación externa"}
            </p>
            <h2>{record.title}</h2>
            <dl>
              {[
                [
                  "Autores (orden de autoría)",
                  record.authors.map((person) => person.name).join("; "),
                ],
                [
                  "Tutores / orientadores",
                  record.tutors.map((person) => person.name).join("; "),
                ],
                ["Carrera", record.career.name],
                ["Nivel académico", record.level.name],
                ["Tipo de publicación", record.type.name],
                ["Sede / filial", record.branch.name],
                ["Fecha de registro", registrationDate(record.createdAt)],
                ["Año de publicación", String(record.year)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <h3>Resumen</h3>
            <p>{record.summary}</p>
            <h3>Abstract</h3>
            <p lang="en">{record.abstract}</p>
            <h3>Palabras clave</h3>
            <p>{record.keywords}</p>
            <h3>Documento</h3>
            {record.externalUrl && (
              <a
                className="document-link"
                href={record.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Abrir documento externo <ArrowRight size={14} />
              </a>
            )}
            {record.hasAttachment && user.role === "PUBLICO" && (
              <p className="bibliography-restricted">
                <LockKeyhole size={17} /> Este trabajo tiene un PDF adjunto. Tu
                rol permite consultar su información bibliográfica.
              </p>
            )}
            {record.attachment && user.role !== "PUBLICO" && (
              <AttachmentDownload
                publication={record}
                state={state}
                user={user}
                assertActive={assertActive}
              />
            )}
            {!record.externalUrl && !record.hasAttachment && (
              <p>No hay documento digital disponible en esta ficha.</p>
            )}
          </article>
        </>
      );
    } catch (caught) {
      return (
        <>
          <Alert text={errorText(caught)} />
          <button className="secondary" onClick={() => setSelectedId("")}>
            Volver a resultados
          </button>
        </>
      );
    }
  }

  function classification(
    field: "career" | "level" | "type" | "branch",
    key: keyof BibliographicFilters,
    label: string,
  ) {
    return (
      <Field label={label}>
        <select
          value={draft[key]}
          onChange={(event) => update(key, event.target.value)}
        >
          <option value="">Todas las opciones</option>
          {bibliographyOptions(state, user.id, field).map((reference) => (
            <option key={reference.id} value={reference.id}>
              {reference.name}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Repositorio institucional</p>
          <h1>{advanced ? "Búsqueda avanzada" : "Catálogo bibliográfico"}</h1>
          <p>
            {advanced
              ? "Combiná criterios para encontrar una investigación."
              : "Explorá los trabajos académicos registrados en el repositorio."}
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => navigate(advanced ? "publicaciones" : "busqueda")}
        >
          <SlidersHorizontal size={17} />
          {advanced ? "Ver catálogo" : "Búsqueda avanzada"}
        </button>
      </div>
      <form className="bibliography-filters" onSubmit={search}>
        <Field
          label="Buscar investigaciones"
          hint="Código, título, resumen, abstract, palabras clave, autores o tutores."
        >
          <input
            type="search"
            value={draft.search}
            onChange={(event) => update("search", event.target.value)}
            maxLength={300}
            placeholder="Ej.: educación financiera, ahorro, INV-00001…"
          />
        </Field>
        <div className="publication-grid">
          {classification("career", "careerId", "Carrera")}
          {classification("type", "typeId", "Tipo de publicación")}
          {advanced && (
            <>
              {classification("level", "levelId", "Nivel académico")}
              {classification("branch", "branchId", "Sede / filial")}
              <Field label="Nombre del autor">
                <input
                  value={draft.author}
                  maxLength={150}
                  onChange={(event) => update("author", event.target.value)}
                  placeholder="Buscar por nombre de autor"
                />
              </Field>
              <Field label="Nombre del tutor">
                <input
                  value={draft.tutor}
                  maxLength={150}
                  onChange={(event) => update("tutor", event.target.value)}
                  placeholder="Buscar por nombre de tutor"
                />
              </Field>
              <Field label="Año de publicación">
                <input
                  type="number"
                  min={1900}
                  max={9999}
                  value={draft.year}
                  onChange={(event) => update("year", event.target.value)}
                />
              </Field>
              <Field label="Procedencia">
                <select
                  value={draft.source}
                  onChange={(event) => update("source", event.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="LOCAL">Local</option>
                  <option value="EXTERNA">Externa</option>
                </select>
              </Field>
              <Field label="Fecha de registro desde">
                <input
                  type="date"
                  value={draft.from}
                  onInput={(event) => update("from", event.currentTarget.value)}
                />
              </Field>
              <Field label="Fecha de registro hasta">
                <input
                  type="date"
                  value={draft.to}
                  onInput={(event) => update("to", event.currentTarget.value)}
                />
              </Field>
            </>
          )}
        </div>
        <div className="publication-actions">
          <button className="primary" type="submit">
            <Search size={17} /> Buscar
          </button>
          <button className="secondary" type="button" onClick={clear}>
            Limpiar filtros
          </button>
        </div>
      </form>
      <Alert text={error || queryError} />
      <div className="bibliography-result-heading">
        <h2>
          Resultados{" "}
          <span>{request.loading ? "Buscando…" : (result?.total ?? 0)}</span>
        </h2>
        <Field label="Resultados por página">
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[6, 12, 24].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="bibliography-grid">
        {result?.records.map((record) => (
          <article className="bibliography-card" key={record.id}>
            <div className="bibliography-card-tags">
              <span className="badge neutral">{record.type.name}</span>
              <span>{record.year}</span>
            </div>
            <p className="eyebrow">{record.code}</p>
            <h2>{record.title}</h2>
            <p className="bibliography-authors">
              <Users size={16} />{" "}
              {record.authors.map((person) => person.name).join("; ")}
            </p>
            <p className="bibliography-summary">{record.summary}</p>
            <div className="bibliography-meta">
              <span>
                <BookOpen size={15} />
                {record.career.name}
              </span>
              <span>
                <CalendarDays size={15} />
                {registrationDate(record.createdAt)}
              </span>
            </div>
            <div className="bibliography-card-footer">
              <span>
                <FileText size={15} />
                {record.hasAttachment
                  ? "PDF adjunto"
                  : record.externalUrl
                    ? "Documento enlazado"
                    : "Ficha bibliográfica"}
              </span>
              <button
                className="secondary"
                onClick={() => setSelectedId(record.id)}
              >
                Ver ficha <ArrowRight size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {result?.total === 0 && (
        <div className="publication-empty">
          <Search size={32} />
          <h2>No se encontraron investigaciones</h2>
          <p>
            Cambiá los términos o quitá algunos filtros para ampliar la
            búsqueda.
          </p>
          <button className="secondary" onClick={clear}>
            Mostrar todas
          </button>
        </div>
      )}
      {!!result?.total && (
        <div className="bibliography-pagination">
          <button
            className="secondary"
            disabled={result.page <= 1}
            onClick={() => setPage(result!.page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {result.page} de {result.totalPages}
          </span>
          <button
            className="secondary"
            disabled={result.page >= result.totalPages}
            onClick={() => setPage(result!.page + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </>
  );
}
