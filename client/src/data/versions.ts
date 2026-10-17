import { problem } from "./problems";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export async function etagOf(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(value)),
  );
  return `"sha256-${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}
export async function assertVersion(
  current: unknown,
  expected?: string,
  code = "RESOURCE_VERSION_CONFLICT",
) {
  if (!expected)
    throw problem(
      428,
      "PRECONDITION_REQUIRED",
      "Volvé a consultar el registro antes de modificarlo.",
    );
  if (!/^"sha256-[a-f0-9]{64}"$/.test(expected))
    throw problem(
      400,
      "VALIDATION_ERROR",
      "La versión del registro no es válida.",
    );
  if ((await etagOf(current)) !== expected)
    throw problem(
      412,
      code,
      "El registro cambió en otra operación o pestaña. Tus datos ingresados se conservaron; revisá la versión actual antes de volver a guardar.",
    );
}
