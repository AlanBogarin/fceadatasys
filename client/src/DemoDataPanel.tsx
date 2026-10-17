import { auditFailure } from "./auditSignals";
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
  commit: (state: State) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  if (user.role !== "ADMINISTRADOR") return null;

  async function addSamples() {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      // Paso 1 y 2: preparar altas y correcciones de nombres institucionales de muestra.
      const result = buildDemoData(state, user.id, window.location.href);
      if (
        !result.addedCatalogs &&
        !result.addedPublications &&
        !result.updatedCatalogs &&
        !result.updatedPublications &&
        !result.consolidatedBranches
      ) {
        notify(
          "Los datos UNC de demostración ya están actualizados. No se agregaron duplicados.",
        );
        return;
      }
      // Paso 3: la confirmación habitual verifica sesión y conserva la atomicidad local.
      await commit(result.state);
      notify(
        `Datos UNC (demo): ${result.addedCatalogs} registros y ${result.addedPublications} investigaciones agregados; ${result.updatedCatalogs} registros y ${result.updatedPublications} investigaciones corregidos. Filiales ficticias consolidadas: ${result.consolidatedBranches}.`,
      );
    } catch (caught) {
      auditFailure("Datos de demostración", "Operación rechazada", caught);
      setError(errorText(caught));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="demo-data-panel" aria-label="Datos de demostración">
      <div>
        <p className="eyebrow">Para practicar y presentar</p>
        <h2>Datos de demostración</h2>
        <p>
          14 autores, 12 tutores, los siete catálogos y 8 investigaciones con
          documentos PDF de muestra. Facultades, carreras y sedes usan nombres
          reales de la UNC, identificados con (demo). Las personas y los
          trabajos son ficticios.
        </p>
        <small>
          Actualiza los nombres institucionales de las muestras antiguas y
          conserva tus registros propios. Los cambios existentes requieren tu
          contraseña. Incluye personas sin vínculos para probar la eliminación y
          personas vinculadas para mostrar la restricción.
        </small>
      </div>
      <button
        type="button"
        className="secondary"
        onClick={addSamples}
        disabled={working}
      >
        <Database size={18} />{" "}
        {working ? "Preparando datos…" : "Cargar / actualizar datos de prueba"}
      </button>
      <div className="demo-data-error">
        <Alert text={error} />
      </div>
    </section>
  );
}
