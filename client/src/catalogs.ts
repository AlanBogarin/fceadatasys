import type { State, Role } from "./model";
import { publicationUsesCatalog } from "./publications";
export const CATALOG_KEYS = [
  "autores",
  "tutores",
  "carreras",
  "facultades",
  "filiales",
  "tipos",
  "niveles",
] as const;
export type CatalogKey = (typeof CATALOG_KEYS)[number];
export type CatalogRecord = {
  id: string;
  name: string;
  active: boolean;
  fields: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  participantIds?: string[];
  demoKey?: string;
};
export type CatalogInput = Pick<CatalogRecord, "name" | "fields">;
export type Catalogs = Record<CatalogKey, CatalogRecord[]>;
type CatalogField = {
  key: string;
  label: string;
  type?: "email";
  maxLength: number;
  placeholder?: string;
  required?: boolean;
};
export const catalogConfig: Record<
  CatalogKey,
  {
    title: string;
    singular: string;
    createLabel: string;
    description: string;
    fields: CatalogField[];
  }
> = {
  autores: {
    title: "Autores",
    singular: "autor",
    createLabel: "Nuevo autor",
    description: "Registrá las personas autoras de la producción académica.",
    fields: [
      {
        key: "ci",
        label: "Cédula de identidad",
        maxLength: 12,
        placeholder: "Solo números",
      },
      {
        key: "email",
        label: "Correo electrónico",
        type: "email",
        maxLength: 150,
      },
      {
        key: "orcid",
        label: "ORCID",
        maxLength: 19,
        placeholder: "0000-0000-0000-0000",
      },
    ],
  },
  tutores: {
    title: "Tutores y orientadores",
    singular: "tutor",
    createLabel: "Nuevo tutor",
    description: "Mantené el directorio de tutores y orientadores académicos.",
    fields: [
      {
        key: "ci",
        label: "Cédula de identidad",
        maxLength: 12,
        placeholder: "Solo números",
      },
      {
        key: "email",
        label: "Correo electrónico",
        type: "email",
        maxLength: 150,
      },
      { key: "especialidad", label: "Especialidad", maxLength: 150 },
    ],
  },
  carreras: {
    title: "Carreras",
    singular: "carrera",
    createLabel: "Nueva carrera",
    description:
      "Organizá las carreras utilizadas para clasificar las publicaciones.",
    fields: [
      { key: "codigo", label: "Código", maxLength: 30 },
      { key: "descripcion", label: "Descripción", maxLength: 300 },
    ],
  },
  facultades: {
    title: "Facultades",
    singular: "facultad",
    createLabel: "Nueva facultad",
    description: "Administrá las unidades académicas del repositorio.",
    fields: [
      { key: "sigla", label: "Sigla", maxLength: 30 },
      { key: "descripcion", label: "Descripción", maxLength: 300 },
    ],
  },
  filiales: {
    title: "Sedes y filiales",
    singular: "sede o filial",
    createLabel: "Nueva sede o filial",
    description:
      "Registrá las sedes y filiales de procedencia de los trabajos.",
    fields: [
      { key: "direccion", label: "Dirección", maxLength: 200 },
      { key: "descripcion", label: "Descripción", maxLength: 300 },
    ],
  },
  tipos: {
    title: "Tipos de publicación",
    singular: "tipo de publicación",
    createLabel: "Nuevo tipo de publicación",
    description: "Definí las categorías de producción académica.",
    fields: [{ key: "descripcion", label: "Descripción", maxLength: 300 }],
  },
  niveles: {
    title: "Niveles académicos",
    singular: "nivel académico",
    createLabel: "Nuevo nivel académico",
    description: "Mantené los niveles que clasifican las publicaciones.",
    fields: [{ key: "descripcion", label: "Descripción", maxLength: 300 }],
  },
};
export const emptyCatalogs = (): Catalogs => ({
  autores: [],
  tutores: [],
  carreras: [],
  facultades: [],
  filiales: [],
  tipos: [],
  niveles: [],
});
export const isCatalogKey = (value: string): value is CatalogKey =>
  (CATALOG_KEYS as readonly string[]).includes(value);
export const normalizeCatalog = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
const trim = (value: string) => value.trim().replace(/\s+/g, " ");
export function canManageCatalog(role: Role, key: CatalogKey) {
  return (
    role === "ADMINISTRADOR" ||
    (role === "DIGITADOR" && (key === "autores" || key === "tutores"))
  );
}
// Compatible con los datos locales de la primera entrega, sin regenerar usuarios.
export function migrateCatalogs(state: State): State {
  const catalogs = emptyCatalogs();
  for (const key of CATALOG_KEYS) {
    const existing = state.catalogs?.[key];
    if (existing !== undefined && !Array.isArray(existing)) {
      throw Error(`Los datos del catálogo ${key} no son compatibles.`);
    }
    catalogs[key] = existing ?? [];
  }
  return { ...state, catalogs };
}
export function guardCatalog(state: State, actorId: string, key: CatalogKey) {
  const actor = state.users.find(
    (account) => account.id === actorId && account.active,
  );
  if (!actor || !canManageCatalog(actor.role, key)) {
    throw Error("No tenés permiso para modificar este catálogo.");
  }
}
export function saveCatalogRecord(
  state: State,
  actorId: string,
  key: CatalogKey,
  input: CatalogInput,
  targetId?: string,
): State {
  guardCatalog(state, actorId, key);
  const rows = state.catalogs[key];
  const old = targetId
    ? rows.find((entry) => entry.id === targetId)
    : undefined;
  if (targetId && !old) {
    throw Error("No se encontró el registro.");
  }
  const name = trim(input.name);
  if (!normalizeCatalog(name) || name.length > 150) {
    throw Error("Ingresá un nombre de hasta 150 caracteres.");
  }
  if (
    rows.some(
      (entry) =>
        entry.id !== targetId &&
        normalizeCatalog(entry.name) === normalizeCatalog(name),
    )
  ) {
    throw Error(
      "Ya existe un registro con ese nombre, incluso si está inactivo.",
    );
  }
  const fields: Record<string, string> = {};
  for (const field of catalogConfig[key].fields) {
    const value = trim(input.fields[field.key] || "");
    if (value.length > field.maxLength) {
      throw Error(`${field.label}: máximo ${field.maxLength} caracteres.`);
    }
    fields[field.key] = (() => {
      if (field.key === "email") {
        return value.toLocaleLowerCase("es");
      }
      if (field.key === "orcid") {
        return value.toUpperCase();
      }
      return value;
    })();
  }
  if (fields.ci && !/^\d{5,12}$/.test(fields.ci)) {
    throw Error("La CI debe contener entre 5 y 12 dígitos.");
  }
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
    throw Error("Ingresá un correo electrónico válido.");
  }
  if (fields.orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(fields.orcid)) {
    throw Error(
      "El formato de ORCID debe ser 0000-0000-0000-0000; el último carácter también puede ser X.",
    );
  }
  for (const unique of ["ci", "email", "orcid", "codigo", "sigla"]) {
    if (
      fields[unique] &&
      rows.some(
        (entry) =>
          entry.id !== targetId &&
          normalizeCatalog(entry.fields[unique] || "") ===
            normalizeCatalog(fields[unique]),
      )
    ) {
      throw Error(
        `Ya existe un registro con ese valor de ${catalogConfig[key].fields.find((f) => f.key === unique)?.label}.`,
      );
    }
  }
  const now = new Date().toISOString();
  const record: CatalogRecord = {
    id: old?.id ?? crypto.randomUUID(),
    ...(old?.demoKey ? { demoKey: old.demoKey } : {}),
    name,
    fields,
    active: old?.active ?? true,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
    participantIds:
      old && !old.participantIds
        ? undefined
        : Array.from(new Set([...(old?.participantIds ?? []), actorId])),
  };
  return {
    ...state,
    catalogs: {
      ...state.catalogs,
      [key]: old
        ? rows.map((entry) => (entry.id === targetId ? record : entry))
        : [...rows, record],
    },
  };
}
export function setCatalogActive(
  state: State,
  actorId: string,
  key: CatalogKey,
  targetId: string,
  active: boolean,
): State {
  guardCatalog(state, actorId, key);
  if (
    !active &&
    (state.publications ?? []).some(
      (publication) =>
        publication.active !== false &&
        publicationUsesCatalog(publication, key, targetId),
    )
  ) {
    throw Error(
      "No se puede inactivar: el registro está vinculado a una investigación registrada.",
    );
  }
  if (!state.catalogs[key].some((entry) => entry.id === targetId)) {
    throw Error("No se encontró el registro.");
  }
  return {
    ...state,
    catalogs: {
      ...state.catalogs,
      [key]: state.catalogs[key].map((entry) =>
        entry.id === targetId
          ? {
              ...entry,
              active,
              participantIds: entry.participantIds
                ? Array.from(new Set([...entry.participantIds, actorId]))
                : undefined,
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    },
  };
}
export function filterCatalog(
  rows: CatalogRecord[],
  query: string,
  status: string,
) {
  const term = normalizeCatalog(query);
  return rows
    .filter(
      (entry) =>
        (!term ||
          normalizeCatalog(
            [entry.name, ...Object.values(entry.fields)].join(" "),
          ).includes(term)) &&
        (!status || entry.active === (status === "active")),
    )
    .sort((left, right) =>
      left.name.localeCompare(right.name, "es", { sensitivity: "base" }),
    );
}

export function deleteCatalogRecord(
  state: State,
  actorId: string,
  catalog: CatalogKey,
  targetId: string,
): State {
  // Paso 1: exigir un administrador activo, incluso si se evita la pantalla.
  const administrator = state.users.find((account) => account.id === actorId);
  if (!administrator?.active || administrator.role !== "ADMINISTRADOR") {
    throw Error("No tenés permiso para eliminar registros de catálogos.");
  }

  // Paso 2: comprobar existencia y referencias antes de eliminar físicamente.
  if (!state.catalogs[catalog].some((record) => record.id === targetId)) {
    throw Error("No se encontró el registro.");
  }
  if (
    (state.publications ?? []).some((publication) =>
      publicationUsesCatalog(publication, catalog, targetId),
    )
  ) {
    throw Error(
      "No se puede eliminar: el registro está vinculado a una investigación registrada. Sus datos deben conservarse.",
    );
  }

  // Paso 3: preparar el nuevo estado sin modificar el original ni sus investigaciones.
  return {
    ...state,
    catalogs: {
      ...state.catalogs,
      [catalog]: state.catalogs[catalog].filter(
        (record) => record.id !== targetId,
      ),
    },
  };
}
