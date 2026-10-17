import type { Page } from "./contracts";
import { problem } from "./problems";

export function paginate<T>(records: T[], page = 1, pageSize = 20): Page<T> {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw problem(
      400,
      "VALIDATION_ERROR",
      "La página o el tamaño solicitado no son válidos.",
    );
  return {
    data: records.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      page,
      pageSize,
      total: records.length,
      totalPages: Math.ceil(records.length / pageSize),
    },
  };
}

// Una búsqueda anterior jamás reemplaza resultados de una consulta más reciente.
export class LatestQuery {
  private revision = 0;
  private controller?: AbortController;
  cancel() {
    this.revision++;
    this.controller?.abort();
  }
  async run<T>(
    query: (signal: AbortSignal) => Promise<T>,
    publish: (value: T) => void,
    reject: (error: unknown) => void = () => {},
  ) {
    this.cancel();
    const revision = this.revision;
    const controller = (this.controller = new AbortController());
    try {
      const result = await query(controller.signal);
      if (revision === this.revision && !controller.signal.aborted)
        publish(result);
    } catch (error) {
      if (revision === this.revision && !controller.signal.aborted)
        reject(error);
    }
  }
}

export function clientDeadline(
  serverTime: string,
  expiresAt: string,
  idleExpiresAt: string,
  receivedAt = Date.now(),
) {
  const time = Date.parse(serverTime);
  const deadline = Math.min(Date.parse(expiresAt), Date.parse(idleExpiresAt));
  if (!Number.isFinite(time) || !Number.isFinite(deadline)) return receivedAt;
  return receivedAt + Math.max(0, deadline - time);
}
