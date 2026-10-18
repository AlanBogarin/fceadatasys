import { lazy, Suspense } from "react";
import { clientConfig } from "./data/config";
const ApiApp = lazy(() => import("./ApiApp"));
export default function App() {
  let config;
  try {
    config = clientConfig(import.meta.env, window.__FCEA_CONFIG__);
  } catch (error) {
    return (
      <div className="loading" role="alert">
        <h1>Revisá la configuración del cliente</h1>
        <p>
          {error instanceof Error
            ? error.message
            : "La configuración no es válida."}
        </p>
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div className="loading">
          <p>Preparando tu espacio de trabajo…</p>
        </div>
      }
    >
      <ApiApp config={config} />
    </Suspense>
  );
}
