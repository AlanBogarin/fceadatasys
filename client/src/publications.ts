import {
  validateAttachmentMetadata,
  type PublicationAttachment,
} from "./attachments";
import { catalogConfig, normalizeCatalog, type CatalogKey } from "./catalogs";
import type { UserDto } from "./data/contracts";
import type { ViewState } from "./data/view";
import type { State, User } from "./model";
import { settingsOf } from "./settings";
import type { Resultado } from "./userService";

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
  updatedAt?: string;
  attachmentHistory?: PublicationAttachment[];
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
  attachmentId?: string | null;
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
  operation:
    | "REGISTRAR_INVESTIGACION"
    | "DESCARGAR_ADJUNTO"
    | "PUBLICACION_MODIFICADA"
    | "PUBLICACION_INACTIVADA";
  createdAt: string;
};
export type ReportFilters = {
  from: string;
  to: string;
  careerId: string;
  levelId: string;
  publicationId: string;
  typeId?: string;
  year?: string;
  author?: string;
  tutor?: string;
  active?: string;
};
export const emptyReportFilters: ReportFilters = {
  from: "",
  to: "",
  careerId: "",
  levelId: "",
  publicationId: "",
  typeId: "",
  year: "",
  author: "",
  tutor: "",
  active: "",
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
  state: Pick<ViewState, "users">,
  actorId: string,
  report = false,
): UserDto {
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
  previous?: Publication,
): Reference {
  const record = state.catalogs[catalog].find(
    (entry) =>
      entry.id === targetId &&
      (entry.active ||
        (previous && publicationUsesCatalog(previous, catalog, targetId))),
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
  previous?: Publication,
): Reference[] {
  if (!identifiers.length || new Set(identifiers).size !== identifiers.length) {
    throw Error(
      `Seleccioná al menos un registro de ${catalog}; no se permiten repetidos.`,
    );
  }
  return identifiers.map((identifier) =>
    reference(state, catalog, identifier, previous),
  );
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
  editingId?: string,
): Resultado<{ state: State; publication: Publication }> {
  try {
    // Paso 1: validar permisos y datos del trabajo ya aprobado.
    const actor = publicationActor(state, actorId);
    const previous = editingId
      ? state.publications?.find(
          (record) => record.id === editingId && record.active !== false,
        )
      : undefined;
    if (editingId && !previous)
      throw Error("No se encontró una publicación activa para editar.");
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
      const upload =
        state.uploadedAttachments?.find(
          (entry) => entry.attachment.id === input.attachmentId,
        ) ??
        (previous?.attachment?.id === input.attachmentId
          ? { attachment: previous.attachment, createdBy: previous.createdBy }
          : undefined);
      if (
        upload &&
        "reservedPublicationId" in upload &&
        upload.reservedPublicationId &&
        upload.reservedPublicationId !== editingId
      )
        throw Error(
          "Archivo duplicado: ya está adjuntado o reservado a otra investigación.",
        );
      if (
        !upload ||
        (["RECHAZADO", "PENDIENTE", "VINCULADO"].includes(
          "status" in upload ? (upload.status ?? "") : "",
        ) &&
          upload.attachment.id !== previous?.attachment?.id) ||
        (upload.attachment.id !== previous?.attachment?.id &&
          actor.role !== "ADMINISTRADOR" &&
          upload.createdBy.id !== actor.id)
      ) {
        throw Error(
          "El adjunto no está disponible o no tenés permiso para vincularlo.",
        );
      }
      attachment = upload.attachment;
    } else if (
      attachment &&
      attachment.id !== previous?.attachment?.id &&
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
    const changedAttachment =
      attachment && attachment.id !== previous?.attachment?.id;
    if (
      changedAttachment &&
      state.uploadedAttachments?.some(
        (upload) =>
          upload.attachment.id === attachment?.id &&
          ["RECHAZADO", "PENDIENTE"].includes(upload.status ?? ""),
      )
    )
      throw Error("El adjunto no está disponible para vincular.");
    if (
      changedAttachment &&
      attachment &&
      (!settingsOf(state).allowedFormats.includes(
        attachment.mime === "text/plain" ? "txt" : "pdf",
      ) ||
        attachment.size > settingsOf(state).maxPdfSizeMb * 1024 * 1024)
    )
      throw Error("El adjunto no cumple los formatos o el tamaño vigentes.");
    if (
      attachment &&
      existing.some(
        (publication) =>
          publication.id !== editingId &&
          (publication.attachment?.sha256 === attachment!.sha256 ||
            publication.attachment?.id === attachment!.id ||
            publication.attachmentHistory?.some(
              (file) =>
                file.id === attachment!.id ||
                file.sha256 === attachment!.sha256,
            )),
      )
    ) {
      throw Error(
        "Este archivo PDF ya está adjuntado a otra investigación. No se guardaron cambios.",
      );
    }
    for (const publication of existing) {
      if (publication.id === editingId) continue;
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
      ...previous,
      id: previous?.id ?? crypto.randomUUID(),
      code:
        previous?.code ?? `INV-${String(existing.length + 1).padStart(5, "0")}`,
      active: true,
      title,
      authors: references(state, "autores", input.authorIds, previous),
      tutors: references(state, "tutores", input.tutorIds, previous),
      career: reference(state, "carreras", input.careerId, previous),
      level: reference(state, "niveles", input.levelId, previous),
      type: reference(state, "tipos", input.typeId, previous),
      branch: reference(state, "filiales", input.branchId, previous),
      summary,
      abstract,
      keywords,
      externalUrl,
      source,
      requiresLibraryCopy,
      attachment: attachment ? { ...attachment } : undefined,
      year: input.year,
      createdAt: previous?.createdAt ?? new Date().toISOString(),
      createdBy: previous?.createdBy ?? { id: actor.id, name: actor.name },
      updatedAt: new Date().toISOString(),
      attachmentHistory: [
        ...new Map(
          [
            ...(previous?.attachmentHistory ?? []),
            ...(previous?.attachment ? [previous.attachment] : []),
            ...(attachment ? [attachment] : []),
          ].map((file) => [file.id, file]),
        ).values(),
      ],
    };
    const audit: PublicationAudit = {
      id: crypto.randomUUID(),
      publicationId: publication.id,
      actorId: actor.id,
      actorRole: actor.role,
      operation: previous
        ? "PUBLICACION_MODIFICADA"
        : "REGISTRAR_INVESTIGACION",
      createdAt: publication.createdAt,
    };

    // Paso 3: preparar una sola escritura con investigación, vínculo de usuario y bitácora.
    // La pantalla confirma el éxito únicamente después de guardar este estado completo.
    const nextState: State = {
      ...state,
      publications: previous
        ? existing.map((record) =>
            record.id === editingId ? publication : record,
          )
        : [...existing, publication],
      uploadedAttachments: (state.uploadedAttachments ?? []).map((upload) =>
        upload.attachment.id === attachment?.id ||
        upload.attachment.id === previous?.attachment?.id
          ? {
              ...upload,
              reservedPublicationId: publication.id,
              status:
                upload.attachment.id === attachment?.id
                  ? "DISPONIBLE"
                  : "RESERVADO",
            }
          : upload,
      ),
      publicationAudit: [...(state.publicationAudit ?? []), audit],
      repositoryLinks: [
        ...(state.repositoryLinks ?? []),
        ...(!previous
          ? [
              {
                userId: actor.id,
                recordId: publication.id,
                kind: "investigación" as const,
              },
            ]
          : []),
      ],
    };
    return {
      exito: true,
      mensaje: previous
        ? "Investigación modificada."
        : "Investigación registrada.",
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

export function publicationView(
  state: Pick<State, "catalogs">,
  record: Publication,
): Publication {
  const current = (key: CatalogKey, reference: Reference): Reference => ({
    id: reference.id,
    name:
      state.catalogs[key].find((row) => row.id === reference.id)?.name ??
      reference.name,
  });
  return {
    ...record,
    authors: record.authors.map((person) => current("autores", person)),
    tutors: record.tutors.map((person) => current("tutores", person)),
    career: current("carreras", record.career),
    level: current("niveles", record.level),
    type: current("tipos", record.type),
    branch: current("filiales", record.branch),
  };
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
  if (
    filters.year &&
    (!/^\d{4}$/.test(filters.year) ||
      +filters.year < 1900 ||
      +filters.year > 9999)
  )
    throw Error("Ingresá un año válido, entre 1900 y 9999.");

  // Paso 3: usar los registros realmente guardados, sin inventar resultados vacíos.
  return (state.publications ?? [])
    .map((publication) => publicationView(state, publication))
    .filter((publication) => {
      const date = registrationDate(publication.createdAt);
      return (
        (!filters.from || date >= filters.from) &&
        (!filters.to || date <= filters.to) &&
        (!filters.careerId || publication.career.id === filters.careerId) &&
        (!filters.levelId || publication.level.id === filters.levelId) &&
        (!filters.typeId || publication.type.id === filters.typeId) &&
        (!filters.year || publication.year === Number(filters.year)) &&
        (!filters.active ||
          (publication.active !== false) === (filters.active === "true")) &&
        (!filters.author ||
          publication.authors.some((person) =>
            normalizeCatalog(person.name).includes(
              normalizeCatalog(filters.author!),
            ),
          )) &&
        (!filters.tutor ||
          publication.tutors.some((person) =>
            normalizeCatalog(person.name).includes(
              normalizeCatalog(filters.tutor!),
            ),
          )) &&
        (!filters.publicationId || publication.id === filters.publicationId)
      );
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function editPublication(
  state: State,
  actorId: string,
  id: string,
  input: PublicationInput,
) {
  return registerPublication(state, actorId, { ...input, approved: true }, id);
}

export function inactivatePublication(
  state: State,
  actorId: string,
  id: string,
): State {
  const actor = publicationActor(state, actorId, true);
  const publication = state.publications?.find((record) => record.id === id);
  if (!publication) throw Error("No se encontró la publicación.");
  if (publication.active === false) return state;
  return {
    ...state,
    publications: state.publications!.map((record) =>
      record.id === id
        ? { ...record, active: false, updatedAt: new Date().toISOString() }
        : record,
    ),
    publicationAudit: [
      ...(state.publicationAudit ?? []),
      {
        id: crypto.randomUUID(),
        publicationId: id,
        actorId,
        actorRole: actor.role,
        operation: "PUBLICACION_INACTIVADA",
        createdAt: new Date().toISOString(),
      },
    ],
  };
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
