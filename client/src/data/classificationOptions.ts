import type { DataClient, ListQuery } from "./client";
import type { Pagination } from "./contracts";

// Facultades no forma parte del modelo de clasificación de una publicación.
export const publicationClassificationFields = {
  carreras: "careerId",
  filiales: "branchId",
  tipos: "typeId",
  niveles: "levelId",
} as const;
export type PublicationClassification =
  keyof typeof publicationClassificationFields;
export type ClassificationReference = { id: string; name: string };
export type ClassificationOptions = {
  options: ClassificationReference[];
  selected: ClassificationReference | null;
  pagination: Pagination;
};

// Una sola página de activos, más la referencia elegida del DTO de publicación.
// Conservarla no exige consultar un registro inactivo que Público no puede leer.
export async function loadClassificationOptions(
  catalogs: Pick<DataClient["catalogs"], "list">,
  catalog: PublicationClassification,
  query: Pick<ListQuery, "search" | "page" | "pageSize"> = {},
  selected: ClassificationReference | null = null,
  signal?: AbortSignal,
): Promise<ClassificationOptions> {
  const result = await catalogs.list(
    catalog,
    { ...query, active: "true" },
    signal,
  );
  const options = result.data.map(({ id, name }) => ({ id, name }));
  const current = selected
    ? (options.find((option) => option.id === selected.id) ?? {
        id: selected.id,
        name: selected.name,
      })
    : null;
  if (current && !options.some((option) => option.id === current.id))
    options.unshift(current);
  return { options, selected: current, pagination: result.pagination };
}
