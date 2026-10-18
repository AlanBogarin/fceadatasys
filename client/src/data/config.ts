export type ClientConfig = {
  mode: "api";
  apiBaseUrl: string;
  profile: "demo" | "production";
};
export type RuntimeConfig = { apiBaseUrl?: string; profile?: string };
declare global {
  interface Window {
    __FCEA_CONFIG__?: RuntimeConfig;
  }
}
export function clientConfig(
  environment: { VITE_DATA_MODE?: string; VITE_API_BASE_URL?: string } = {},
  runtime: RuntimeConfig = {},
): ClientConfig {
  if (environment.VITE_DATA_MODE && environment.VITE_DATA_MODE !== "api")
    throw Error(
      "El backend simulado fue retirado. El cliente requiere la API real.",
    );
  const url = new URL(
    runtime.apiBaseUrl ??
      environment.VITE_API_BASE_URL ??
      "http://127.0.0.1:3000/api/v1",
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("La URL base de API no es válida.");
  if (runtime.profile && !["demo", "production"].includes(runtime.profile))
    throw Error("Perfil de despliegue inválido.");
  return {
    mode: "api",
    apiBaseUrl: url.href.replace(/\/$/, ""),
    profile: runtime.profile === "demo" ? "demo" : "production",
  };
}
