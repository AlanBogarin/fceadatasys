import { useState } from "react";
import { Database } from "lucide-react";
import type { State, User } from "./model";
import { buildDemoData } from "./demoData";
import { Alert, errorText } from "./ui";

export function DemoDataPanel({
  state,
  user,
  commit,
  notify,
}: {
  state: State;
  user: User;
  commit: (state: State) => void;
  notify: (message: string) => void;
}) {
  const [error, setError] = useState("");
  if (user.role !== "ADMINISTRADOR") return null;

  function addSamples() {
    setError("");
    try {
      // Paso 1 y 2: verificar permisos y preparar las muestras sin reemplazar datos.
      const result = buildDemoData(state, user.id, window.location.href);
      if (!result.addedCatalogs && !result.addedPublications) {
        notify(
          "Los datos de demostración ya están cargados. No se agregaron duplicados.",
        );
        return;
      }
      // Paso 3: la confirmación habitual verifica sesión y conserva la atomicidad local.
      commit(result.state);
      notify(
        `Se agregaron ${result.addedCatalogs} registros de catálogos y ${result.addedPublications} investigaciones de demostración.`,
      );
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  return (
    <section className="demo-data-panel" aria-label="Datos de demostración">
      <div>
        <p className="eyebrow">Para practicar y presentar</p>
        <h2>Datos de demostración</h2>
        <p>
          14 autores, 12 tutores, los siete catálogos y 8 investigaciones con
          documentos PDF de muestra. Todos son ficticios.
        </p>
        <small>
          La carga conserva tus registros y no duplica muestras ya agregadas.
          Incluye personas sin vínculos para probar la eliminación y personas
          vinculadas para mostrar la restricción.
        </small>
      </div>
      <button type="button" className="secondary" onClick={addSamples}>
        <Database size={18} /> Cargar datos de prueba
      </button>
      <div className="demo-data-error">
        <Alert text={error} />
      </div>
    </section>
  );
}
