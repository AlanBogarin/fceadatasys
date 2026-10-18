import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useDataClient } from "./data/context";
import { useQuery } from "./data/useQuery";
import {
  loadClassificationOptions,
  type PublicationClassification,
} from "./data/classificationOptions";
import { canSelectAttachment } from "./data/apiPublications";
import type {
  AttachmentDetailDto,
  AttachmentDto,
  Pagination,
} from "./data/contracts";
import type { Reference } from "./publications";
import { attachmentSize } from "./attachmentService";
import { Alert, Field, errorText } from "./ui";

export function useDebounced<T>(value: T, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export function QueryMessage({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error?: unknown;
  retry?: () => void;
}) {
  return (
    <>
      {loading && <p role="status">Consultando…</p>}
      <Alert text={error ? errorText(error) : ""} />
      {Boolean(error) && retry && (
        <button type="button" className="secondary" onClick={retry}>
          Volver a consultar
        </button>
      )}
    </>
  );
}

export function PaginationControls({
  pagination,
  page,
  setPage,
  loading = false,
}: {
  pagination?: Pagination;
  page: number;
  setPage: (page: number) => void;
  loading?: boolean;
}) {
  return (
    <div className="people-pagination">
      <button
        type="button"
        className="secondary"
        disabled={loading || page <= 1}
        onClick={() => setPage(page - 1)}
      >
        Anterior
      </button>
      <span>
        {pagination
          ? `${pagination.total} registro(s) · Página ${page} de ${Math.max(1, pagination.totalPages)}`
          : "—"}
      </span>
      <button
        type="button"
        className="secondary"
        disabled={loading || !pagination || page >= pagination.totalPages}
        onClick={() => setPage(page + 1)}
      >
        Siguiente
      </button>
    </div>
  );
}

export function ClassificationPicker({
  catalog,
  label,
  name,
  selected,
  onChange,
  historical = false,
  required = false,
}: {
  catalog: PublicationClassification;
  label: string;
  name: string;
  selected: Reference | null;
  onChange: (reference: Reference | null) => void;
  historical?: boolean;
  required?: boolean;
}) {
  const client = useDataClient();
  const [search, setSearch] = useState("");
  const term = useDebounced(search);
  const [page, setPage] = useState(1);
  const request = useQuery(
    async (signal) => {
      if (!historical)
        return loadClassificationOptions(
          client.catalogs,
          catalog,
          { search: term, page, pageSize: 10 },
          selected,
          signal,
        );
      const result = await client.catalogs.list(
        catalog,
        { search: term, page, pageSize: 10 },
        signal,
      );
      const options: Reference[] = result.data.map(({ id, name }) => ({
        id,
        name,
      }));
      if (selected && !options.some((item) => item.id === selected.id))
        options.unshift(selected);
      return { options, selected, pagination: result.pagination };
    },
    [client, catalog, term, page, historical, selected?.id, selected?.name],
  );
  const options = request.data?.options ?? (selected ? [selected] : []);
  return (
    <div className="people-picker">
      <Field label={`Buscar opciones de ${label}`}>
        <input
          type="search"
          maxLength={150}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </Field>
      <Field label={label}>
        <select
          name={name}
          value={selected?.id ?? ""}
          required={required}
          onChange={(event) =>
            onChange(
              options.find((item) => item.id === event.target.value) ?? null,
            )
          }
        >
          <option value="">
            {required ? "Seleccioná una opción" : "Todas las opciones"}
          </option>
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </Field>
      <QueryMessage {...request} retry={request.reload} />
      {request.data?.pagination.total === 0 && (
        <small>No hay opciones con esta búsqueda.</small>
      )}
      <PaginationControls
        pagination={request.data?.pagination}
        page={page}
        setPage={setPage}
        loading={request.loading}
      />
    </div>
  );
}

export function PeoplePicker({
  catalog,
  label,
  selected,
  onChange,
}: {
  catalog: "autores" | "tutores";
  label: string;
  selected: Reference[];
  onChange: (value: Reference[]) => void;
}) {
  const client = useDataClient();
  const [search, setSearch] = useState("");
  const term = useDebounced(search);
  const [page, setPage] = useState(1);
  const request = useQuery(
    (signal) =>
      client.catalogs.list(
        catalog,
        { search: term, active: "true", page, pageSize: 10 },
        signal,
      ),
    [client, catalog, term, page],
  );
  return (
    <fieldset className="people-picker">
      <legend>{label} *</legend>
      <p>Seleccioná las personas en orden de participación.</p>
      <Field label={`Buscar ${catalog}`}>
        <input
          type="search"
          maxLength={150}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </Field>
      <div className="people-selected" aria-label={`${label} seleccionados`}>
        {selected.map((person, index) => (
          <button
            type="button"
            className="person-chip"
            key={person.id}
            aria-label={`Quitar ${person.name}`}
            onClick={() =>
              onChange(selected.filter((item) => item.id !== person.id))
            }
          >
            <b>{index + 1}</b> {person.name}
            <X size={14} />
          </button>
        ))}
      </div>
      <div className="people-options">
        {request.data?.data.map((person) => (
          <label key={person.id}>
            <input
              type="checkbox"
              checked={selected.some((item) => item.id === person.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, { id: person.id, name: person.name }]
                    : selected.filter((item) => item.id !== person.id),
                )
              }
            />
            <span>{person.name}</span>
          </label>
        ))}
      </div>
      <QueryMessage {...request} retry={request.reload} />
      {request.data?.pagination.total === 0 && (
        <p>No hay personas con esta búsqueda.</p>
      )}
      <PaginationControls
        pagination={request.data?.pagination}
        page={page}
        setPage={setPage}
        loading={request.loading}
      />
    </fieldset>
  );
}

export function AttachmentPicker({
  publicationId,
  selected,
  onChange,
}: {
  publicationId?: string;
  selected: AttachmentDetailDto | null;
  onChange: (value: AttachmentDto | null) => void;
}) {
  const client = useDataClient();
  const [search, setSearch] = useState("");
  const term = useDebounced(search);
  const [status, setStatus] = useState("DISPONIBLE");
  const [page, setPage] = useState(1);
  const request = useQuery(
    (signal) =>
      client.attachments.list(
        { search: term, status, page, pageSize: 10 },
        signal,
      ),
    [client, term, status, page],
  );
  const options =
    request.data?.data.filter((item) =>
      canSelectAttachment(item, publicationId),
    ) ?? [];
  return (
    <div className="people-picker">
      <Field label="Buscar archivos ya cargados">
        <input
          type="search"
          maxLength={300}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </Field>
      {publicationId && (
        <Field label="Origen del archivo">
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="DISPONIBLE">Disponibles</option>
            <option value="RESERVADO">Reservas de esta publicación</option>
          </select>
        </Field>
      )}
      <Field label="Archivo disponible *">
        <select
          required
          value={selected?.id ?? ""}
          onChange={(event) =>
            onChange(
              options.find((item) => item.id === event.target.value) ?? null,
            )
          }
        >
          <option value="">Seleccioná un archivo</option>
          {selected && !options.some((item) => item.id === selected.id) && (
            <option value={selected.id}>{selected.name} (seleccionado)</option>
          )}
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {attachmentSize(item.size)}
            </option>
          ))}
        </select>
      </Field>
      <QueryMessage {...request} retry={request.reload} />
      {request.data && !options.length && (
        <p>
          No hay archivos elegibles en esta página. Las reservas solo se pueden
          recuperar para su publicación original.
        </p>
      )}
      <PaginationControls
        pagination={request.data?.pagination}
        page={page}
        setPage={setPage}
        loading={request.loading}
      />
    </div>
  );
}
