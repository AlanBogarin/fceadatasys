import type { State, User } from "./model";
import { settingsOf } from "./settings";
import { catalogConfig, normalizeCatalog, type CatalogKey } from "./catalogs";
import type { Resultado } from "./userService";
import {
  validateAttachmentMetadata,
  type PublicationAttachment,
} from "./attachments";

export type Reference = { id: string; name: string };
export type Publication = {
  id: string;
  active?: boolean;
  demoKey?: string;
  code: string;
  title: string;
  authors: Reference[];
  tutors: Reference[];
  career: Reference;
  level: Reference;
  type: Reference;
  branch: Reference;
  summary: string;
  abstract: string;
  keywords: string;
  externalUrl: string;
  source?: "LOCAL" | "EXTERNA";
  requiresLibraryCopy?: boolean;
  attachment?: PublicationAttachment;
  year: number;
  createdAt: string;
  createdBy: Reference;
};
export type PublicationInput = {
  title: string;
  authorIds: string[];
  tutorIds: string[];
  careerId: string;
  levelId: string;
  typeId: string;
  branchId: string;
  summary: string;
  abstract: string;
  keywords: string;
  externalUrl: string;
  attachment?: PublicationAttachment;
  attachmentId?: string;
  source?: "LOCAL" | "EXTERNA";
  requiresLibraryCopy?: boolean;
  year: number;
  approved: boolean;
};
export type PublicationAudit = {
  id: string;
  publicationId: string;
  actorId: string;
  actorRole: User["role"];
  operation: "REGISTRAR_INVESTIGACION" | "DESCARGAR_ADJUNTO";
  createdAt: string;
};
export type ReportFilters = {
  from: string;
  to: string;
  careerId: string;
  levelId: string;
  publicationId: string;
};
export const emptyReportFilters: ReportFilters = {
  from: "",
  to: "",
  careerId: "",
  levelId: "",
  publicationId: "",
};
export const requiredCatalogs: CatalogKey[] = [
  "autores",
  "tutores",
  "carreras",
  "niveles",
  "tipos",
  "filiales",
];

export function publicationActor(
  state: State,
  actorId: string,
  report = false,
): User {
  // Paso 1: comprobar identidad y estado; Paso 2: exigir el permiso de la operación.
  const actor = state.users.find(
    (account) => account.id === actorId && account.active,
  );
  if (
    !actor ||
    actor.role === "PUBLICO" ||
    (report && actor.role !== "ADMINISTRADOR")
  ) {
    throw Error("No tenés permiso para realizar esta operación.");
  }
  // Paso 3: devolver el usuario vigente, sin confiar en el rol enviado por la pantalla.
  return actor;
}

function reference(
  state: State,
  catalog: CatalogKey,
  targetId: string,
): Reference {
  const record = state.catalogs[catalog].find(
    (entry) => entry.id === targetId && entry.active,
  );
  if (!record) {
    throw Error(
      `Seleccioná un registro activo de ${catalogConfig[catalog].title.toLowerCase()}.`,
    );
  }
  return { id: record.id, name: record.name };
}

function references(
  state: State,
  catalog: CatalogKey,
  identifiers: string[],
): Reference[] {
  if (!identifiers.length || new Set(identifiers).size !== identifiers.length) {
    throw Error(
      `Seleccioná al menos un registro de ${catalog}; no se permiten repetidos.`,
    );
  }
  return identifiers.map((identifier) => reference(state, catalog, identifier));
}

function requiredText(value: string, label: string, maximum: number): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!normalizeCatalog(cleaned) || cleaned.length > maximum) {
    throw Error(`${label}: completá el campo con hasta ${maximum} caracteres.`);
  }
  return cleaned;
}

export function registerPublication(
  state: State,
  actorId: string,
  input: PublicationInput,
): Resultado<{ state: State; publication: Publication }> {
  try {
    // Paso 1: validar permisos y datos del trabajo ya aprobado.
    const actor = publicationActor(state, actorId);
    if (!input.approved) {
      throw Error(
        "Confirmá que el trabajo ya fue aprobado fuera del repositorio.",
      );
    }
    const title = requiredText(input.title, "Título", 250);
    const summary = requiredText(input.summary, "Resumen", 5000);
    const abstract = requiredText(input.abstract, "Abstract", 5000);
    const keywords = requiredText(input.keywords, "Palabras clave", 300);
    const maximumWords = settingsOf(state).summaryWordLimit;
    if (summary.split(/\s+/u).length > maximumWords) {
      throw Error(`El resumen no puede superar las ${maximumWords} palabras.`);
    }
    if (
      !Number.isInteger(input.year) ||
      input.year < 1900 ||
      input.year > new Date().getFullYear()
    ) {
      throw Error(
        "Ingresá un año de publicación válido, entre 1900 y el año actual.",
      );
    }
    let attachment = input.attachment;
    if (input.attachmentId) {
      if (attachment) throw Error("Seleccioná un único adjunto.");
      const upload = state.uploadedAttachments?.find(
        (entry) => entry.attachment.id === input.attachmentId,
      );
      if (
        !upload ||
        (actor.role !== "ADMINISTRADOR" && upload.createdBy.id !== actor.id)
      ) {
        throw Error(
          "El adjunto no está disponible o no tenés permiso para vincularlo.",
        );
      }
      attachment = upload.attachment;
    } else if (
      attachment &&
      state.uploadedAttachments?.some(
        (entry) => entry.attachment.sha256 === attachment!.sha256,
      )
    ) {
      throw Error(
        "Archivo duplicado: elegí el PDF desde los archivos ya cargados.",
      );
    }
    const source =
      input.source ?? (input.externalUrl.trim() ? "EXTERNA" : "LOCAL");
    const requiresLibraryCopy =
      source === "LOCAL" ? (input.requiresLibraryCopy ?? true) : false;
    let externalUrl = "";
    if (source === "LOCAL") {
      if (attachment) validateAttachmentMetadata(attachment);
      if (input.externalUrl.trim()) {
        throw Error("Elegí una modalidad: archivo PDF o enlace externo.");
      }
      if (requiresLibraryCopy && !attachment) {
        throw Error(
          "Adjuntá un PDF: la copia digital es obligatoria para este trabajo de Biblioteca.",
        );
      }
    } else {
      if (attachment || input.requiresLibraryCopy) {
        throw Error("Elegí una modalidad: archivo PDF o enlace externo.");
      }
      if (!input.externalUrl.trim())
        throw Error("Adjuntá un PDF o ingresá un enlace al documento.");
      let documentUrl: URL;
      try {
        documentUrl = new URL(input.externalUrl.trim());
      } catch {
        throw Error(
          "Ingresá el enlace completo al documento, comenzando con https:// o http://.",
        );
      }
      if (
        !["https:", "http:"].includes(documentUrl.protocol) ||
        documentUrl.username ||
        documentUrl.password ||
        documentUrl.href.length > 2000
      ) {
        throw Error(
          "El enlace debe usar HTTP o HTTPS, sin credenciales y con hasta 2000 caracteres.",
        );
      }
      externalUrl = documentUrl.href;
    }

    // Paso 2: comprobar duplicados y todas las relaciones antes de modificar el estado.
    const existing = state.publications ?? [];
    if (
      attachment &&
      existing.some(
        (publication) =>
          publication.attachment?.sha256 === attachment!.sha256 ||
          publication.attachment?.id === attachment!.id,
      )
    ) {
      throw Error(
        "Este archivo PDF ya está adjuntado a otra investigación. No se guardaron cambios.",
      );
    }
    for (const publication of existing) {
      for (const field of ["title", "summary", "abstract"] as const) {
        const candidate = { title, summary, abstract }[field];
        if (
          normalizeCatalog(publication[field]) === normalizeCatalog(candidate)
        ) {
          const label = {
            title: "título",
            summary: "resumen",
            abstract: "abstract",
          }[field];
          throw Error(
            `Ya existe una investigación con ese ${label}. No se guardaron cambios.`,
          );
        }
      }
    }
    const publication: Publication = {
      id: crypto.randomUUID(),
      code: `INV-${String(existing.length + 1).padStart(5, "0")}`,
      title,
      authors: references(state, "autores", input.authorIds),
      tutors: references(state, "tutores", input.tutorIds),
      career: reference(state, "carreras", input.careerId),
      level: reference(state, "niveles", input.levelId),
      type: reference(state, "tipos", input.typeId),
      branch: reference(state, "filiales", input.branchId),
      summary,
      abstract,
      keywords,
      externalUrl,
      source,
      requiresLibraryCopy,
      attachment: attachment ? { ...attachment } : undefined,
      year: input.year,
      createdAt: new Date().toISOString(),
      createdBy: { id: actor.id, name: actor.name },
    };
    const audit: PublicationAudit = {
      id: crypto.randomUUID(),
      publicationId: publication.id,
      actorId: actor.id,
      actorRole: actor.role,
      operation: "REGISTRAR_INVESTIGACION",
      createdAt: publication.createdAt,
    };

    // Paso 3: preparar una sola escritura con investigación, vínculo de usuario y bitácora.
    // La pantalla confirma el éxito únicamente después de guardar este estado completo.
    const nextState: State = {
      ...state,
      publications: [...existing, publication],
      publicationAudit: [...(state.publicationAudit ?? []), audit],
      repositoryLinks: [
        ...(state.repositoryLinks ?? []),
        {
          userId: actor.id,
          recordId: publication.id,
          kind: "investigación",
        },
      ],
    };
    return {
      exito: true,
      mensaje: "Investigación registrada.",
      datos: { state: nextState, publication },
    };
  } catch (error) {
    let message = "No se pudo registrar la investigación.";
    if (error instanceof Error) {
      message = error.message;
    }
    return { exito: false, mensaje: message };
  }
}

export function registrationDate(timestamp: string): string {
  // Usar la fecha institucional para que los filtros no cambien según el equipo.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Asuncion",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = (part: string) =>
    parts.find((entry) => entry.type === part)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function publicationReport(
  state: State,
  actorId: string,
  filters: ReportFilters,
): Publication[] {
  // Paso 1: únicamente el administrador puede consultar o exportar reportes.
  publicationActor(state, actorId, true);

  // Paso 2: validar el período de registro, inclusive en ambos extremos.
  for (const date of [filters.from, filters.to]) {
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    ) {
      throw Error("Seleccioná fechas válidas para el reporte.");
    }
  }
  if (filters.from && filters.to && filters.from > filters.to) {
    throw Error("La fecha inicial no puede ser posterior a la fecha final.");
  }

  // Paso 3: usar los registros realmente guardados, sin inventar resultados vacíos.
  return (state.publications ?? [])
    .filter((publication) => {
      const date = registrationDate(publication.createdAt);
      return (
        (!filters.from || date >= filters.from) &&
        (!filters.to || date <= filters.to) &&
        (!filters.careerId || publication.career.id === filters.careerId) &&
        (!filters.levelId || publication.level.id === filters.levelId) &&
        (!filters.publicationId || publication.id === filters.publicationId)
      );
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function publicationUsesCatalog(
  publication: Publication,
  catalog: CatalogKey,
  targetId: string,
): boolean {
  const referencesByCatalog: Partial<Record<CatalogKey, Reference[]>> = {
    autores: publication.authors,
    tutores: publication.tutors,
    carreras: [publication.career],
    niveles: [publication.level],
    tipos: [publication.type],
    filiales: [publication.branch],
  };
  return (referencesByCatalog[catalog] ?? []).some(
    (entry) => entry.id === targetId,
  );
}
