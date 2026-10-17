import type { ViewState as State } from "./data/view";
import type { UserDto as User } from "./data/contracts";
import { normalizeCatalog } from "./catalogs";
import {
  registrationDate,
  publicationView,
  type Publication,
  type Reference,
} from "./publications";

export type BibliographicFilters = {
  search: string;
  careerId: string;
  levelId: string;
  typeId: string;
  branchId: string;
  author: string;
  tutor: string;
  year: string;
  source: string;
  from: string;
  to: string;
  active?: string;
};
export const emptyBibliographicFilters: BibliographicFilters = {
  search: "",
  careerId: "",
  levelId: "",
  typeId: "",
  branchId: "",
  author: "",
  tutor: "",
  year: "",
  source: "",
  from: "",
  to: "",
  active: "",
};
export type BibliographicRecord = Omit<
  Publication,
  "attachment" | "demoKey"
> & {
  hasAttachment: boolean;
  attachment?: Publication["attachment"];
};

export function bibliographicActor(state: State, actorId: string): User {
  const actor = state.users.find(
    (account) => account.id === actorId && account.active,
  );
  if (!actor) throw Error("La sesión no es válida. Volvé a iniciar sesión.");
  return actor;
}

function safeExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* Un dato antiguo inválido nunca se transforma en un enlace ejecutable. */
  }
  return "";
}

export function bibliographicRecord(
  state: State,
  actorId: string,
  publicationId: string,
): BibliographicRecord {
  // Paso 1: exigir cuenta activa también al consultar directamente un identificador.
  const actor = bibliographicActor(state, actorId);
  const saved = state.publications?.find(
    (record) => record.id === publicationId,
  );
  const publication = saved ? publicationView(state, saved) : undefined;
  if (
    !publication ||
    (publication.active === false && actor.role !== "ADMINISTRADOR")
  )
    throw Error("No se encontró la investigación.");
  // Paso 2: proyectar únicamente los metadatos bibliográficos; Público no recibe el adjunto.
  const result: BibliographicRecord = {
    id: publication.id,
    active: publication.active !== false,
    code: publication.code,
    title: publication.title,
    authors: publication.authors.map((person) => ({ ...person })),
    tutors: publication.tutors.map((person) => ({ ...person })),
    career: { ...publication.career },
    level: { ...publication.level },
    type: { ...publication.type },
    branch: { ...publication.branch },
    summary: publication.summary,
    abstract: publication.abstract,
    keywords: publication.keywords,
    externalUrl: safeExternalUrl(publication.externalUrl),
    year: publication.year,
    createdAt: publication.createdAt,
    createdBy: { ...publication.createdBy },
    source:
      publication.source ?? (publication.attachment ? "LOCAL" : "EXTERNA"),
    requiresLibraryCopy: publication.requiresLibraryCopy,
    hasAttachment: !!publication.attachment,
  };
  // Paso 3: habilitar metadatos de descarga solo a los roles autorizados.
  const unavailable = state.uploadedAttachments?.some(
    (upload) =>
      upload.attachment.id === publication.attachment?.id &&
      ["RECHAZADO", "PENDIENTE"].includes(upload.status ?? ""),
  );
  if (actor.role !== "PUBLICO" && publication.attachment && !unavailable)
    result.attachment = { ...publication.attachment };
  return result;
}

function validateFilters(filters: BibliographicFilters) {
  if (
    filters.search.length > 300 ||
    filters.author.length > 150 ||
    filters.tutor.length > 150
  )
    throw Error(
      "La búsqueda es demasiado extensa. Usá hasta 300 caracteres y nombres de hasta 150.",
    );
  if (
    filters.year &&
    (!/^\d{4}$/.test(filters.year) ||
      Number(filters.year) < 1900 ||
      Number(filters.year) > 9999)
  )
    throw Error("Ingresá un año de publicación válido, entre 1900 y 9999.");
  if (filters.source && !["LOCAL", "EXTERNA"].includes(filters.source))
    throw Error("Seleccioná una procedencia válida.");
  for (const date of [filters.from, filters.to]) {
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      throw Error("Seleccioná fechas reales para el período de registro.");
  }
  if (filters.from && filters.to && filters.from > filters.to)
    throw Error("La fecha inicial no puede ser posterior a la final.");
}

export function queryBibliography(
  state: State,
  actorId: string,
  filters: BibliographicFilters,
  page = 1,
  pageSize = 6,
) {
  // Paso 1: validar identidad y filtros antes de consultar los datos locales.
  const actor = bibliographicActor(state, actorId);
  validateFilters(filters);
  if (!Number.isInteger(page) || page < 1 || ![6, 12, 24].includes(pageSize))
    throw Error("La página solicitada no es válida.");
  const terms = normalizeCatalog(filters.search).split(" ").filter(Boolean);
  const authorTerm = normalizeCatalog(filters.author);
  const tutorTerm = normalizeCatalog(filters.tutor);
  // Paso 2: combinar filtros con AND y conservar el orden de autoría de cada trabajo.
  const matches = (state.publications ?? [])
    .map((publication) => publicationView(state, publication))
    .filter((publication) => {
      if (publication.active === false && actor.role !== "ADMINISTRADOR")
        return false;
      if (
        filters.active &&
        (publication.active !== false) !== (filters.active === "true")
      )
        return false;
      const date = registrationDate(publication.createdAt);
      const groups = [
        publication.code,
        `${publication.title} ${publication.summary} ${publication.abstract} ${publication.keywords}`,
        publication.authors.map((person) => person.name).join(" "),
        publication.tutors.map((person) => person.name).join(" "),
      ].map(normalizeCatalog);
      return (
        (!terms.length ||
          groups.some((group) =>
            terms.every((term) => group.includes(term)),
          )) &&
        (!filters.careerId || publication.career.id === filters.careerId) &&
        (!filters.levelId || publication.level.id === filters.levelId) &&
        (!filters.typeId || publication.type.id === filters.typeId) &&
        (!filters.branchId || publication.branch.id === filters.branchId) &&
        (!authorTerm ||
          publication.authors.some((person) =>
            normalizeCatalog(person.name).includes(authorTerm),
          )) &&
        (!tutorTerm ||
          publication.tutors.some((person) =>
            normalizeCatalog(person.name).includes(tutorTerm),
          )) &&
        (!filters.year || publication.year === Number(filters.year)) &&
        (!filters.source ||
          (publication.source ??
            (publication.attachment ? "LOCAL" : "EXTERNA")) ===
            filters.source) &&
        (!filters.from || date >= filters.from) &&
        (!filters.to || date <= filters.to)
      );
    })
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.code.localeCompare(left.code, "es", { numeric: true }),
    );
  // Paso 3: devolver solo la página y el DTO permitido para el rol.
  const totalPages = Math.ceil(matches.length / pageSize);
  const current = Math.min(page, Math.max(1, totalPages));
  return {
    records: matches
      .slice((current - 1) * pageSize, current * pageSize)
      .map((publication) =>
        bibliographicRecord(state, actorId, publication.id),
      ),
    total: matches.length,
    totalPages,
    page: current,
  };
}

export function bibliographyOptions(
  state: State,
  actorId: string,
  field: "career" | "level" | "type" | "branch",
): Reference[] {
  const actor = bibliographicActor(state, actorId);
  return [
    ...new Map(
      (state.publications ?? [])
        .filter(
          (publication) =>
            publication.active !== false || actor.role === "ADMINISTRADOR",
        )
        .map((publication) => [
          publication[field].id,
          { ...publication[field] },
        ]),
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name, "es"));
}
