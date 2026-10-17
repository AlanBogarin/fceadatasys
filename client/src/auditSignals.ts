import type { AuditIntent } from "./audit";

let observer: ((intent: AuditIntent) => void) | undefined;
export function observeAudit(next: (intent: AuditIntent) => void): () => void {
  observer = next;
  return () => {
    if (observer === next) observer = undefined;
  };
}
export function auditFailure(
  module: string,
  operation: string,
  error: unknown,
) {
  observer?.({
    module,
    operation,
    status: "FALLIDO",
    detail: error instanceof Error ? error.message : "Operación rechazada.",
  });
}
