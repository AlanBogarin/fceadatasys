import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Download, FileText, Plus, Search } from "lucide-react";
import type { State, User } from "./model";
import { catalogConfig, normalizeCatalog, type CatalogKey } from "./catalogs";
import { Alert, Field, errorText } from "./ui";
import { requireResult } from "./userService";
import {
  emptyReportFilters,
  publicationReport,
  registerPublication,
  registrationDate,
  requiredCatalogs,
  type Publication,
  type PublicationInput,
  type Reference,
  type ReportFilters,
} from "./publications";
import { buildPublicationReport, downloadReport } from "./publicationExports";
import "./publications.css";

type PageProps = {
  state: State;
  user: User;
  commit: (state: State) => void;
  notify: (message: string) => void;
  showReport: (publicationId: string) => void;
};

function ReferencePicker({
  state,
  catalog,
  name,
  label,
}: {
  state: State;
  catalog: CatalogKey;
  name: string;
  label: string;
}) {
  return (
    <Field label={label}>
      <select name={name} required defaultValue="">
        <option value="" disabled>
          Seleccioná una opción
        </option>
        {state.catalogs[catalog]
          .filter((entry) => entry.active)
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
  const records = state.catalogs[catalog].filter((entry) => entry.active);
  return (
    <fieldset className="people-picker">
      <legend>{label} *</legend>
      <p>
        Seleccioná una o más personas. El número indica el orden de selección.
      </p>
      <div className="people-options">
        {records.map((entry) => (
          <label key={entry.id}>
            <input
              type="checkbox"
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
            <span>{entry.name}</span>
            {selected.includes(entry.id) && (
              <span className="badge neutral">
                {selected.indexOf(entry.id) + 1}
              </span>
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PublicationDetail({ publication }: { publication: Publication }) {
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
      <h3>Enlace al documento</h3>
      <a
        className="document-link"
        href={publication.externalUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {publication.externalUrl}
      </a>
    </article>
  );
}

export function PublicationsPage({
  state,
  user,
  commit,
  notify,
  showReport,
}: PageProps) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Publication>();
  const [authorIds, setAuthorIds] = useState<string[]>([]);
  const [tutorIds, setTutorIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const missing = requiredCatalogs.filter(
    (catalog) => !state.catalogs[catalog].some((entry) => entry.active),
  );
  const term = normalizeCatalog(query);
  const records = [...(state.publications ?? [])]
    .reverse()
    .filter((entry) =>
      normalizeCatalog(
        `${entry.code} ${entry.title} ${entry.authors.map((author) => author.name).join(" ")}`,
      ).includes(term),
    );

  function startCreation() {
    setSelected(undefined);
    setError("");
    setSummary("");
    setAuthorIds([]);
    setTutorIds([]);
    setCreating(true);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      // Paso 1: leer los campos y participantes elegidos, sin guardar parcialmente.
      const form = new FormData(event.currentTarget);
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
        approved: form.get("approved") === "on",
      };
      // Paso 2: el servicio valida reglas y prepara todos los registros de la transacción.
      const result = requireResult(registerPublication(state, user.id, input));
      // Paso 3: persistir todo junto; informar éxito solamente si la escritura finaliza.
      commit(result.state);
      setSelected(result.publication);
      setCreating(false);
      notify(
        `${result.publication.code}: investigación registrada correctamente.`,
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  if (creating) {
    return (
      <>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Gestión bibliográfica</p>
            <h1>Registrar investigación</h1>
            <p>
              Trabajo aprobado con documento disponible mediante un enlace
              externo.
            </p>
          </div>
          <button className="secondary" onClick={() => setCreating(false)}>
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
        <form className="publication-form" onSubmit={submit}>
          <section>
            <h2>1. Identificación del trabajo</h2>
            <p>Los campos con * son obligatorios.</p>
            <Field label="Título *">
              <input
                name="title"
                required
                maxLength={250}
                placeholder="Título completo de la investigación"
              />
            </Field>
            <div className="publication-grid">
              <ReferencePicker
                state={state}
                catalog="tipos"
                name="typeId"
                label="Tipo de publicación *"
              />
              <Field label="Año de publicación *">
                <input
                  name="year"
                  type="number"
                  min={1900}
                  max={new Date().getFullYear()}
                  required
                  defaultValue={new Date().getFullYear()}
                />
              </Field>
              <ReferencePicker
                state={state}
                catalog="carreras"
                name="careerId"
                label="Carrera *"
              />
              <ReferencePicker
                state={state}
                catalog="niveles"
                name="levelId"
                label="Nivel académico *"
              />
              <ReferencePicker
                state={state}
                catalog="filiales"
                name="branchId"
                label="Sede / filial *"
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
              hint={`${summary.trim().split(/\s+/).filter(Boolean).length} / 300 palabras`}
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
              />
            </Field>
            <Field
              label="Palabras clave *"
              hint="Separá los términos con comas."
            >
              <input name="keywords" required maxLength={300} />
            </Field>
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
              />
            </Field>
            <label className="publication-confirm">
              <input name="approved" type="checkbox" required /> Confirmo que el
              trabajo ya fue aprobado fuera del repositorio.
            </label>
          </section>
          <Alert text={error} />
          <div className="publication-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => setCreating(false)}
            >
              Cancelar
            </button>
            <button
              className="primary"
              disabled={busy || !!missing.length}
              type="submit"
            >
              Guardar investigación
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
          </div>
        </div>
        <PublicationDetail publication={selected} />
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar investigación"
          />
        </Field>
        <span>{records.length} registros</span>
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
                  <button
                    className="secondary"
                    onClick={() => setSelected(entry)}
                  >
                    Ver detalle
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!records.length && (
          <div className="publication-empty">
            <FileText size={32} />
            <h2>No hay investigaciones para mostrar</h2>
            <p>Registrá la primera investigación o cambiá la búsqueda.</p>
          </div>
        )}
      </div>
    </>
  );
}

export function PublicationReportsPage({
  state,
  user,
  initialId,
  assertActive,
}: {
  state: State;
  user: User;
  initialId: string;
  assertActive: () => void;
}) {
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
  let records: Publication[] = [];
  let filterError = "";
  try {
    records = publicationReport(state, user.id, filters);
  } catch (caught) {
    filterError = errorText(caught);
  }
  const saved = state.publications ?? [];
  const uniqueReferences = (field: "career" | "level"): Reference[] => [
    ...new Map(saved.map((entry) => [entry[field].id, entry[field]])).values(),
  ];
  function changeFilter(key: keyof ReportFilters, value: string) {
    setFilters({ ...filters, [key]: value });
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
      const report = await buildPublicationReport(
        state,
        user.id,
        filters,
        format,
      );
      // Paso 2: una generación lenta no debe saltarse el vencimiento de la sesión.
      if (!pageOpen.current) {
        return;
      }
      assertActive();
      publicationReport(latestState.current, user.id, filters);
      if (latestState.current !== state) {
        throw Error(
          "Los datos cambiaron. Revisá la vista previa y volvé a exportar.",
        );
      }
      // Paso 3: descargar exactamente los registros filtrados y confirmar el resultado.
      downloadReport(report);
      setNotice(
        `Reporte ${format.toUpperCase()} generado con ${records.length} registro(s).`,
      );
    } catch (caught) {
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
        </div>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setFilters({ ...emptyReportFilters });
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
          <p>{records.length} investigación(es) seleccionada(s)</p>
        </div>
        <div className="publication-actions">
          <button
            className="secondary"
            disabled={busy || !records.length || !!filterError}
            onClick={() => exportReport("xlsx")}
          >
            <Download size={17} /> Descargar Excel
          </button>
          <button
            className="primary"
            disabled={busy || !records.length || !!filterError}
            onClick={() => exportReport("pdf")}
          >
            <Download size={17} /> Descargar PDF
          </button>
        </div>
      </div>
      {records.map((entry) => (
        <PublicationDetail key={entry.id} publication={entry} />
      ))}
      {!records.length && (
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
