import type { AuditEvent } from "../audit";
import type { ApiSession } from "./apiSession";
import type { DataClient } from "./client";
import type { ExportMetadata, Page, UserDto } from "./contracts";
import { queryString } from "./http";

type AuditPage = Page<AuditEvent> & { export: ExportMetadata };
type Options = Pick<
  Awaited<ReturnType<DataClient["audit"]["list"]>>["summary"],
  "modules" | "operations" | "actors"
>;
type Cache = {
  controller: AbortController;
  promise: Promise<Options>;
  readers: number;
  complete: boolean;
};

export function createAuditService(session: ApiSession): DataClient["audit"] {
  const http = session.http;
  let cache: Cache | undefined;
  const invalidateOptions = () => {
    cache?.controller.abort();
    cache = undefined;
  };
  let revision = session.getSnapshot().revision;
  session.subscribe(() => {
    if (revision !== session.getSnapshot().revision) {
      revision = session.getSnapshot().revision;
      invalidateOptions();
    }
  });
  // No hay endpoint de facetas: recorrer todas las páginas sin imponer un corte.
  // Un cambio de cardinalidad durante el recorrido exige una nueva consulta.
  async function walk<T>(
    path: string,
    visit: (row: T) => void,
    signal: AbortSignal,
  ) {
    let total: number | undefined;
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      const result = await http.get<Page<T>>(
        `${path}${queryString({ page, pageSize: 100 })}`,
        signal,
      );
      if (total !== undefined && total !== result.pagination.total)
        throw Error(
          "Los datos de los filtros cambiaron. Actualizá los resultados.",
        );
      total = result.pagination.total;
      pages = result.pagination.totalPages;
      result.data.forEach(visit);
    }
  }
  async function collect(signal: AbortSignal): Promise<Options> {
    const modules = new Set<string>();
    const operations = new Set<string>();
    const historical = new Map<string, Options["actors"][number]>();
    const current = new Map<string, Options["actors"][number]>();
    await Promise.all([
      walk<AuditEvent>(
        "/auditoria",
        (event) => {
          modules.add(event.module);
          operations.add(event.operation);
          if (event.actorId && !historical.has(event.actorId))
            historical.set(event.actorId, {
              id: event.actorId,
              name: event.actorName,
              username: event.username,
            });
        },
        signal,
      ),
      walk<UserDto>(
        "/usuarios",
        (user) => {
          current.set(user.id, {
            id: user.id,
            name: user.name,
            username: user.username,
          });
        },
        signal,
      ),
    ]);
    return {
      modules: [...modules].sort(),
      operations: [...operations].sort(),
      actors: [...new Map([...historical, ...current]).values()].sort((a, b) =>
        a.name.localeCompare(b.name, "es"),
      ),
    };
  }
  function options(signal?: AbortSignal): Promise<Options> {
    signal?.throwIfAborted();
    if (!cache) {
      const controller = new AbortController();
      const entry: Cache = {
        controller,
        readers: 0,
        complete: false,
        promise: collect(controller.signal),
      };
      entry.promise = entry.promise.then(
        (result) => {
          entry.complete = true;
          return result;
        },
        (error) => {
          if (cache === entry) cache = undefined;
          throw error;
        },
      );
      cache = entry;
    }
    const entry = cache;
    entry.readers++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        entry.readers--;
        if (!entry.complete && !entry.readers) {
          if (cache === entry) cache = undefined;
          entry.controller.abort();
        }
        action();
      };
      const abort = () =>
        finish(() =>
          reject(new DOMException("Consulta cancelada", "AbortError")),
        );
      signal?.addEventListener("abort", abort, { once: true });
      entry.promise.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }
  return {
    invalidateOptions,
    async list(filters, page = 1, pageSize = 10, signal) {
      const read = (query: object) =>
        http.get<AuditPage>(`/auditoria${queryString(query)}`, signal);
      const [result, total, failed, choices] = await Promise.all([
        read({ ...filters, page, pageSize }),
        read({ pageSize: 1 }),
        read({ status: "FALLIDO", pageSize: 1 }),
        options(signal),
      ]);
      return {
        ...result,
        summary: {
          total: total.pagination.total,
          failed: failed.pagination.total,
          ...choices,
        },
      };
    },
    get: (id, signal) =>
      http.get<AuditEvent>(`/auditoria/${encodeURIComponent(id)}`, signal),
    async export(filters, format, snapshot) {
      try {
        return await http.download(
          `/auditoria/exportar${queryString({ ...filters, format, snapshot })}`,
        );
      } finally {
        // La exportación registra un evento en el servidor, incluso algunos rechazos.
        session.invalidate();
      }
    },
  };
}
