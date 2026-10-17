import { createHash } from "node:crypto";
import { AppError } from "./errors.js";

export const contentEtag = (value: unknown) =>
  `"sha256-${createHash("sha256").update(JSON.stringify(value)).digest("hex")}"`;
export function requireIfMatch(value: string | string[] | undefined): string {
  if (value === undefined)
    throw new AppError(
      428,
      "PRECONDITION_REQUIRED",
      "Consultá el registro antes de modificarlo.",
    );
  if (
    typeof value !== "string" ||
    !/^"sha256-[a-f0-9]{64}"$/.test(value.trim())
  )
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      "If-Match debe contener un único ETag fuerte.",
    );
  return value.trim();
}
export function assertVersion(expected: string, value: unknown) {
  if (expected !== contentEtag(value))
    throw new AppError(
      412,
      "RESOURCE_VERSION_CONFLICT",
      "El registro cambió. Consultalo nuevamente antes de guardar.",
    );
}
