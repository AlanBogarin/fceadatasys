import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "VITE_");
  if (
    mode === "mock" ||
    (environment.VITE_DATA_MODE && environment.VITE_DATA_MODE !== "api")
  )
    throw Error(
      "El backend simulado fue retirado. Configurar VITE_DATA_MODE=api.",
    );
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true },
  };
});
