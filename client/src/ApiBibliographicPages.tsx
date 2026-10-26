import { hasPermission } from "./permissions";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Download, Search } from "lucide-react";
import {
  emptyBibliographicFilters,
  type BibliographicFilters,
  type BibliographicRecord,
} from "./bibliography";
import {
  emptyReportFilters,
  registrationDate,
  type Reference,
  type ReportFilters,
} from "./publications";
import type { UserDto } from "./data/contracts";
import { useDataClient } from "./data/context";
import { useQuery } from "./data/useQuery";
import { ClientProblem } from "./data/problems";
import {
  publicationClassificationFields,
  type PublicationClassification,
} from "./data/classificationOptions";
import {
  ClassificationPicker,
  PaginationControls,
  QueryMessage,
  useDebounced,
} from "./ApiPublicationControls";
import { ApiPublicationDetail } from "./ApiPublicationPages";
import { PublicationDetail } from "./PublicationPages";
import { downloadReport } from "./publicationExports";
import { Alert, Field, errorText } from "./ui";
import "./bibliography.css";

const labels = {
  carreras: "Carrera",
  niveles: "Nivel académico",
  tipos: "Tipo de publicación",
  filiales: "Sede / filial",
};
function SearchFilters({
  filters,
  update,
  user,
  advanced,
  disabled = false,
}: {
  filters: BibliographicFilters;
  update: (key: keyof BibliographicFilters, value: string) => void;
  user: UserDto;
  advanced: boolean;
  disabled?: boolean;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  return (
    <fieldset className="publication-fields" disabled={disabled}>
      <Field
        label="Buscar investigaciones"
        hint="Términos completos o raíces en título, resumen, abstract, palabras clave y participantes; no busca fragmentos arbitrarios."
      >
        <input
          type="search"
          maxLength={300}
          value={filters.search}
          onChange={(event) => update("search", event.target.value)}
        />
      </Field>
      <div className="publication-grid">
        {(Object.keys(labels) as PublicationClassification[])
          .filter((key) => advanced || ["carreras", "tipos"].includes(key))
          .map((catalog) => {
            const field = publicationClassificationFields[catalog];
            const id = filters[field];
            return (
              <ClassificationPicker
                key={catalog}
                catalog={catalog}
                label={labels[catalog]}
                name={field}
                selected={
                  id
                    ? { id, name: names[id] ?? "Referencia seleccionada" }
                    : null
                }
                historical={hasPermission(user, "publications.history")}
                onChange={(value) => {
                  if (value)
                    setNames((current) => ({
                      ...current,
                      [value.id]: value.name,
                    }));
                  update(field, value?.id ?? "");
                }}
              />
            );
          })}
        {advanced && (
          <>
            <Field label="Código exacto">
              <input
                value={filters.code ?? ""}
                maxLength={23}
                placeholder="INV-00001"
                onChange={(event) => update("code", event.target.value)}
              />
            </Field>
            <Field label="Nombre del autor">
              <input
                value={filters.author}
                maxLength={150}
                onChange={(event) => update("author", event.target.value)}
              />
            </Field>
            <Field label="Nombre del tutor">
              <input
                value={filters.tutor}
                maxLength={150}
                onChange={(event) => update("tutor", event.target.value)}
              />
            </Field>
            <Field label="Año de publicación">
              <input
                type="number"
                min={1900}
                max={9999}
                value={filters.year}
                onChange={(event) => update("year", event.target.value)}
              />
            </Field>
            <Field label="Procedencia">
              <select
                value={filters.source}
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
                value={filters.from}
                onChange={(event) => update("from", event.target.value)}
              />
            </Field>
            <Field label="Fecha de registro hasta">
              <input
                type="date"
                value={filters.to}
                onChange={(event) => update("to", event.target.value)}
              />
            </Field>
          </>
        )}
        {hasPermission(user, "publications.history") && (
          <Field label="Estado">
            <select
              value={filters.active ?? ""}
              onChange={(event) => update("active", event.target.value)}
            >
              <option value="">Todas las publicaciones</option>
              <option value="true">Activas</option>
              <option value="false">Inactivas</option>
            </select>
          </Field>
        )}
      </div>
    </fieldset>
  );
}

export function ApiBibliographicPage({
  user,
  advanced,
  navigate,
}: {
  user: UserDto;
  advanced: boolean;
  navigate: (page: string) => void;
}) {
  const client = useDataClient();
  const [draft, setDraft] = useState({ ...emptyBibliographicFilters });
  const [filters, setFilters] = useState({ ...emptyBibliographicFilters });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);
  const [selected, setSelected] = useState("");
  const request = useQuery(
    (signal) => client.publications.list(filters, page, pageSize, signal),
    [client, filters, page, pageSize],
  );
  const update = (key: keyof BibliographicFilters, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const clear = () => {
    setDraft({ ...emptyBibliographicFilters });
    setFilters({ ...emptyBibliographicFilters });
    setPage(1);
  };
  function submit(event: FormEvent) {
    event.preventDefault();
    setFilters({ ...draft });
    setPage(1);
  }
  if (selected)
    return (
      <>
        <div className="page-heading">
          <h1>Ficha bibliográfica</h1>
          <button className="secondary" onClick={() => setSelected("")}>
            Volver a resultados
          </button>
        </div>
        <ApiPublicationDetail id={selected} user={user} />
      </>
    );
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
          {advanced ? "Ver catálogo" : "Búsqueda avanzada"}
        </button>
      </div>
      <form className="bibliography-filters" onSubmit={submit}>
        <SearchFilters
          filters={draft}
          update={update}
          user={user}
          advanced={advanced}
        />
        <div className="publication-actions">
          <button className="primary">
            <Search size={17} />
            Buscar
          </button>
          <button type="button" className="secondary" onClick={clear}>
            Limpiar filtros
          </button>
        </div>
      </form>
      <QueryMessage {...request} retry={request.reload} />
      <div className="bibliography-result-heading">
        <h2>Resultados {request.data?.pagination.total ?? "—"}</h2>
        {request.data?.durationMs !== undefined && (
          <small role="status">
            Consulta completada en {(request.data.durationMs / 1000).toFixed(3)}{" "}
            s
          </small>
        )}
        <Field label="Resultados por página">
          <select
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[6, 12, 24].map((size) => (
              <option key={size}>{size}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="bibliography-grid">
        {request.data?.data.map((record) => (
          <article className="bibliography-card" key={record.id}>
            <div className="bibliography-card-tags">
              <span className="badge neutral">{record.type.name}</span>
              <span>{record.year}</span>
            </div>
            <p className="eyebrow">
              {record.code}
              {record.active === false ? " · Inactiva" : ""}
            </p>
            <h2>{record.title}</h2>
            <p className="bibliography-authors">
              {record.authors.map((person) => person.name).join("; ")}
            </p>
            <p className="bibliography-summary">{record.summary}</p>
            <div className="bibliography-meta">
              <span>{record.career.name}</span>
              <span>{registrationDate(record.createdAt)}</span>
            </div>
            <div className="bibliography-card-footer">
              <span>
                {record.hasAttachment
                  ? "Documento adjunto"
                  : record.externalUrl
                    ? "Documento enlazado"
                    : "Ficha bibliográfica"}
              </span>
              <button
                className="secondary"
                onClick={() => setSelected(record.id)}
              >
                Ver ficha
                <ArrowRight size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
      {request.data?.pagination.total === 0 && (
        <div className="publication-empty">
          <h2>No se encontraron investigaciones</h2>
          <p>Cambiá los términos o quitá filtros.</p>
          <button className="secondary" onClick={clear}>
            Mostrar todas
          </button>
        </div>
      )}
      <PaginationControls
        pagination={request.data?.pagination}
        page={page}
        setPage={setPage}
        loading={request.loading}
      />
    </>
  );
}

function PublicationFilter({
  id,
  onChange,
}: {
  id: string;
  onChange: (id: string) => void;
}) {
  const client = useDataClient();
  const [search, setSearch] = useState("");
  const term = useDebounced(search);
  const [page, setPage] = useState(1);
  const request = useQuery(
    (signal) =>
      client.publications.list(
        { ...emptyBibliographicFilters, search: term },
        page,
        10,
        signal,
      ),
    [client, term, page],
  );
  const selected = useQuery(
    (signal) =>
      id ? client.publications.get(id, signal) : Promise.resolve(null),
    [client, id],
  );
  const options = request.data?.data ?? [];
  return (
    <div className="people-picker">
      <Field label="Buscar investigación para el reporte">
        <input
          type="search"
          value={search}
          maxLength={300}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </Field>
      <Field label="Investigación">
        <select value={id} onChange={(event) => onChange(event.target.value)}>
          <option value="">Todas las investigaciones</option>
          {id && !options.some((record) => record.id === id) && (
            <option value={id}>
              {selected.data
                ? `${selected.data.data.code} · ${selected.data.data.title}`
                : "Investigación seleccionada"}
            </option>
          )}
          {options.map((record) => (
            <option key={record.id} value={record.id}>
              {record.code} · {record.title}
            </option>
          ))}
        </select>
      </Field>
      <QueryMessage {...request} retry={request.reload} />
      <QueryMessage
        loading={false}
        error={selected.error}
        retry={selected.reload}
      />
      <PaginationControls
        pagination={request.data?.pagination}
        page={page}
        setPage={setPage}
        loading={request.loading}
      />
    </div>
  );
}

export function ApiPublicationReportsPage({
  user,
  initialId = "",
}: {
  user: UserDto;
  initialId?: string;
}) {
  const client = useDataClient();
  const [filters, setFilters] = useState<ReportFilters>({
    ...emptyBibliographicFilters,
    ...emptyReportFilters,
    publicationId: initialId,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const running = useRef(false);
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const settled = useDebounced(filters);
  const request = useQuery(
    (signal) => client.reports.list(settled, page, pageSize, signal),
    [client, settled, page, pageSize],
  );
  const querying = request.loading || settled !== filters;
  const update = (key: keyof ReportFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
    setConflict(false);
    setError("");
    setNotice("");
  };
  async function exportFile(format: "pdf" | "xlsx") {
    if (
      running.current ||
      querying ||
      !request.data?.report.snapshot ||
      !request.data.report.exportable ||
      conflict
    )
      return;
    running.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await client.reports.export(
        settled,
        format,
        request.data.report.snapshot,
      );
      if (!open.current) return;
      if ("data" in result) {
        setNotice("No hay registros para exportar. No se generó un archivo.");
        request.reload();
        return;
      }
      downloadReport(result);
      setNotice(
        `Reporte ${format.toUpperCase()} descargado con ${request.data.pagination.total} registro(s).`,
      );
    } catch (caught) {
      if (open.current) {
        setError(errorText(caught));
        if (
          caught instanceof ClientProblem &&
          caught.code === "REPORT_VERSION_CONFLICT"
        )
          setConflict(true);
      }
    } finally {
      running.current = false;
      if (open.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Reportes · Registro de investigaciones</p>
          <h1>Reporte de investigaciones</h1>
          <p>
            El período usa fechas de registro inclusivas de America/Asuncion.
            Las exportaciones incluyen todo el conjunto filtrado.
          </p>
        </div>
      </div>
      <div className="report-filters">
        <SearchFilters
          filters={{ ...emptyBibliographicFilters, ...filters }}
          update={update}
          user={user}
          advanced
          disabled={busy}
        />
        <fieldset className="publication-fields" disabled={busy}>
          <PublicationFilter
            id={filters.publicationId}
            onChange={(id) => update("publicationId", id)}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setFilters({
                ...emptyBibliographicFilters,
                ...emptyReportFilters,
              });
              setPage(1);
              setConflict(false);
              setError("");
              setNotice("");
            }}
          >
            Limpiar filtros
          </button>
        </fieldset>
      </div>
      <QueryMessage
        loading={querying}
        error={request.error}
        retry={request.reload}
      />
      <Alert text={error} />
      <Alert text={notice} success />
      <div className="report-heading">
        <div>
          <h2>Vista previa</h2>
          <p>
            {request.data && !querying
              ? `${request.data.pagination.total} investigación(es)`
              : "—"}{" "}
            · Máximo {request.data?.report.maxRecords ?? "—"} por exportación
          </p>
        </div>
        <div className="publication-actions">
          <button
            className="secondary"
            disabled={
              !hasPermission(user, "reports.export") ||
              busy ||
              querying ||
              conflict ||
              !request.data?.report.exportable ||
              !request.data.report.snapshot
            }
            onClick={() => exportFile("xlsx")}
          >
            <Download size={17} />
            Descargar Excel
          </button>
          <button
            className="primary"
            disabled={
              !hasPermission(user, "reports.export") ||
              busy ||
              querying ||
              conflict ||
              !request.data?.report.exportable ||
              !request.data.report.snapshot
            }
            onClick={() => exportFile("pdf")}
          >
            <Download size={17} />
            Descargar PDF
          </button>
        </div>
      </div>
      <button
        className="secondary"
        disabled={busy || querying}
        onClick={() => {
          setConflict(false);
          setError("");
          request.reload();
        }}
      >
        Actualizar vista previa
      </button>
      {conflict && (
        <p role="alert">
          Los resultados cambiaron. Actualizá la vista previa antes de exportar.
        </p>
      )}
      {request.data &&
        request.data.pagination.total > 0 &&
        !request.data.report.exportable && (
          <Alert text="La selección supera el límite de exportación. Reducí los filtros." />
        )}
      {request.data?.pagination.total === 0 && (
        <div className="publication-empty">
          <h2>No hay registros con estos filtros</h2>
          <p>No se generará un archivo vacío.</p>
        </div>
      )}
      <PaginationControls
        pagination={request.data?.pagination}
        page={page}
        setPage={setPage}
        loading={querying || busy}
      />
      <Field label="Registros por página">
        <select
          disabled={busy}
          value={pageSize}
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
        >
          {[10, 20, 50].map((size) => (
            <option key={size}>{size}</option>
          ))}
        </select>
      </Field>
      {request.data?.data.map((record: BibliographicRecord) => (
        <PublicationDetail key={record.id} publication={record} user={user} />
      ))}
    </>
  );
}
