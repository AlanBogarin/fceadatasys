export type ClientConfig = { mode: "mock" | "api"; apiBaseUrl: string };
export function clientConfig(
  environment: { VITE_DATA_MODE?: string; VITE_API_BASE_URL?: string } = {},
): ClientConfig {
  const mode = environment.VITE_DATA_MODE ?? "mock";
  if (mode !== "mock" && mode !== "api")
    throw Error("VITE_DATA_MODE debe ser mock o api.");
  const url = new URL(
    environment.VITE_API_BASE_URL ?? "http://127.0.0.1:3000/api/v1",
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("La URL base de API no es válida.");
  return { mode, apiBaseUrl: url.href.replace(/\/$/, "") };
}
export function assertMockMode(config: ClientConfig) {
  if (config.mode !== "mock")
    throw Error(
      "El modo API todavía no está habilitado. Usá VITE_DATA_MODE=mock para abrir la demostración local.",
    );
}
