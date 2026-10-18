import { useDataClient } from "./context";
import { useQuery } from "./useQuery";
import type { ListQuery } from "./client";
import {
  loadClassificationOptions,
  type ClassificationReference,
  type PublicationClassification,
} from "./classificationOptions";

export function useClassificationOptions(
  catalog: PublicationClassification,
  selected: ClassificationReference | null = null,
  query: Pick<ListQuery, "search" | "page" | "pageSize"> = {},
) {
  const client = useDataClient();
  return useQuery(
    (signal) =>
      loadClassificationOptions(
        client.catalogs,
        catalog,
        query,
        selected,
        signal,
      ),
    [
      client,
      catalog,
      query.search,
      query.page,
      query.pageSize,
      selected?.id,
      selected?.name,
    ],
  );
}
