import type { ProblemDetails } from "./contracts";

export class ClientProblem extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail);
    this.name = "ClientProblem";
  }
  get status() {
    return this.problem.status;
  }
  get code() {
    return this.problem.code;
  }
  get fields() {
    return Object.fromEntries(
      (this.problem.invalid_params ?? []).map((field) => [
        field.name,
        field.reason,
      ]),
    );
  }
}

export function problem(
  status: number,
  code: string,
  detail: string,
  fields?: ProblemDetails["invalid_params"],
) {
  return new ClientProblem({
    status,
    code,
    title:
      status === 412
        ? "El registro fue modificado"
        : status === 401
          ? "La sesión no es válida"
          : "No se pudo completar la operación",
    detail,
    invalid_params: fields,
  });
}

export function parseProblem(
  value: unknown,
  fallbackStatus = 500,
): ClientProblem {
  if (value instanceof ClientProblem) return value;
  if (
    value &&
    typeof value === "object" &&
    "code" in value &&
    "detail" in value &&
    "status" in value
  ) {
    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.code === "string" &&
      typeof candidate.detail === "string" &&
      Number.isInteger(candidate.status)
    )
      return new ClientProblem({
        status: candidate.status as number,
        code: candidate.code,
        detail: candidate.detail,
        title:
          typeof candidate.title === "string"
            ? candidate.title
            : "Operación rechazada",
        invalid_params: Array.isArray(candidate.invalid_params)
          ? candidate.invalid_params.filter(
              (field): field is { name: string; reason: string } =>
                !!field &&
                typeof field === "object" &&
                typeof field.name === "string" &&
                typeof field.reason === "string",
            )
          : [],
      });
  }
  return problem(
    fallbackStatus,
    "INTERNAL_ERROR",
    "No se pudo completar la operación. Volvé a intentar.",
  );
}

export function confirmationHeaders(password: string): Record<string, string> {
  const encoded = String.fromCharCode(...new TextEncoder().encode(password));
  return { "X-Confirmation-Password": btoa(encoded) };
}

export function errorKind(error: ClientProblem) {
  if (error.code === "INVALID_CONFIRMATION_PASSWORD") return "confirmation";
  if (error.code === "CONFIRMATION_EXPIRED") return "credential_changed";
  if (error.status === 401) return "session";
  if (error.status === 403) return "permission";
  if (error.status === 412) return "version";
  if (error.code.startsWith("DUPLICATE_")) return "duplicate";
  if (error.code === "AUDIT_UNAVAILABLE") return "audit";
  return "validation";
}
