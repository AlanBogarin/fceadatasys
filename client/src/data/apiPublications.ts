import type { BibliographicRecord } from "../bibliography";
import type { ConfirmMutation } from "./apiClient";
import type { ApiSession } from "./apiSession";
import type { DataClient } from "./client";
import type {
  AttachmentDetailDto,
  AttachmentDto,
  ExportMetadata,
  MutationOptions,
  Page,
} from "./contracts";
import { mutationHeaders, queryString } from "./http";

export function createPublicationServices(
  session: ApiSession,
  confirm: ConfirmMutation,
  options: (title: string, value?: MutationOptions) => Promise<MutationOptions>,
  mutate: <T>(work: () => Promise<T>) => Promise<T>,
): Pick<DataClient, "publications" | "attachments" | "reports"> {
  const http = session.http;
  const publicationPath = (id: string) =>
    `/publicaciones/${encodeURIComponent(id)}`;
  return {
    publications: {
      async list(filters, page = 1, pageSize = 12, signal) {
        const started = performance.now();
        const result = await http.get<Page<BibliographicRecord>>(
          `/publicaciones${queryString({ ...filters, page, pageSize })}`,
          signal,
        );
        return { ...result, durationMs: performance.now() - started };
      },
      get: (id, signal) =>
        http.versioned<BibliographicRecord>(publicationPath(id), { signal }),
      async create(input) {
        await confirm({ title: `Registrar ${input.title}`, password: false });
        return mutate(async () => {
          const { data } = await http.request<
            Omit<BibliographicRecord, "hasAttachment">
          >("/publicaciones", { method: "POST", body: input });
          return { ...data, hasAttachment: !!data.attachment };
        });
      },
      async update(id, input, value) {
        const headers = mutationHeaders(
          await options("Guardar los cambios de la investigación", value),
        );
        return mutate(
          async () =>
            (
              await http.request<BibliographicRecord>(publicationPath(id), {
                method: "PATCH",
                body: input,
                headers,
              })
            ).data,
        );
      },
      async inactivate(id, value) {
        const headers = mutationHeaders(
          await options(
            "Inactivar la investigación conservando su historial",
            value,
          ),
        );
        return mutate(
          async () =>
            (
              await http.request<BibliographicRecord>(
                `${publicationPath(id)}/estado`,
                { method: "PATCH", body: { active: false }, headers },
              )
            ).data,
        );
      },
    },
    attachments: {
      async list(query = {}, signal) {
        const list = (filters: typeof query) =>
          http.get<Page<AttachmentDto>>(
            `/adjuntos${queryString(filters)}`,
            signal,
          );
        const statuses = [
          "DISPONIBLE",
          "VINCULADO",
          "RESERVADO",
          "RECHAZADO",
          "PENDIENTE",
        ];
        const [result, ...counts] = await Promise.all([
          list(query),
          ...statuses.map((status) => list({ status, pageSize: 1 })),
        ]);
        return {
          ...result,
          summary: Object.fromEntries(
            statuses.map((status, index) => [
              status,
              counts[index].pagination.total,
            ]),
          ),
        };
      },
      get: (id, signal) =>
        http.get<AttachmentDetailDto>(
          `/adjuntos/${encodeURIComponent(id)}`,
          signal,
        ),
      async upload(file, onStage) {
        onStage?.("validating");
        const data = new FormData();
        data.append("file", file);
        await confirm({
          title: `Cargar ${file.name} y analizarlo con el antivirus`,
          password: false,
        });
        onStage?.("saving");
        // Invalida al confirmar POST, incluso si la lectura posterior falla: nunca repetir la carga automáticamente.
        const uploaded = await mutate(
          async () =>
            (
              await http.request<{ id: string }>("/adjuntos", {
                method: "POST",
                body: data,
              })
            ).data,
        );
        try {
          const detail = await http.get<AttachmentDetailDto>(
            `/adjuntos/${encodeURIComponent(uploaded.id)}`,
          );
          return { ...detail, status: "DISPONIBLE", publication: null };
        } catch (error) {
          throw Error(
            `El servidor confirmó la carga ${uploaded.id}, pero no se pudo consultar su detalle. Actualizá Archivos antes de volver a cargar. ${error instanceof Error ? error.message : ""}`,
          );
        }
      },
      async download(_id, publicationId) {
        if (!publicationId)
          throw Error(
            "La descarga requiere una publicación vinculada visible.",
          );
        return http.download(`${publicationPath(publicationId)}/adjunto`);
      },
    },
    reports: {
      list: (filters, page = 1, pageSize = 10, signal) =>
        http.get<Page<BibliographicRecord> & { report: ExportMetadata }>(
          `/reportes/publicaciones${queryString({ ...filters, page, pageSize })}`,
          signal,
        ),
      export: (filters, format, snapshot) =>
        http.download(
          `/reportes/publicaciones/exportar${queryString({ ...filters, format, snapshot })}`,
        ),
    },
  };
}

// Una reserva no visible conserva su estado RESERVADO; null nunca equivale a DISPONIBLE.
export function canSelectAttachment(
  file: AttachmentDto,
  publicationId?: string,
): boolean {
  return (
    (file.status === "DISPONIBLE" &&
      file.publication === null &&
      file.reservedPublicationId === null) ||
    (!!publicationId &&
      file.status === "RESERVADO" &&
      file.reservedPublicationId === publicationId)
  );
}
