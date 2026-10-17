import { useState, type FormEvent } from "react";
import { FileCheck, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import type { State, User } from "./model";
import { Alert, errorText, Field } from "./ui";
import { defaultSettings, settingsOf, updateSettings } from "./settings";
import { auditFailure } from "./auditSignals";
import "./administration.css";

export function SettingsPage({
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
  const current = settingsOf(state);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user.role !== "ADMINISTRADOR")
    return <Alert text="No tenés permiso para administrar parámetros." />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      // Paso 1: leer valores; Paso 2: validar permisos, rangos y cambios efectivos.
      const values = new FormData(event.currentTarget);
      const next = updateSettings(state, user.id, {
        summaryWordLimit: Number(values.get("summaryWordLimit")),
        maxPdfSizeMb: Number(values.get("maxPdfSizeMb")),
      });
      if (JSON.stringify(settingsOf(next)) === JSON.stringify(current)) {
        notify("No hay cambios en los parámetros.");
        return;
      }
      // Paso 3: esperar la contraseña y la escritura conjunta con la auditoría.
      await commit(next);
      notify(
        "Parámetros actualizados. Se aplican a las nuevas cargas y registros.",
      );
    } catch (caught) {
      auditFailure("Parámetros", "Modificar parámetros", caught);
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Parámetros generales</h1>
          <p>Configurá los límites de registro y carga del repositorio.</p>
        </div>
        <span className="badge blue">Solo Administrador</span>
      </div>
      <div className="administration-layout">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Límites del repositorio</h2>
              <p>
                Los cambios no alteran publicaciones ni archivos ya guardados.
              </p>
            </div>
            <SlidersHorizontal size={24} />
          </div>
          <form key={JSON.stringify(current)} onSubmit={submit}>
            <div className="panel-body">
              <Alert text={error} />
              <Field
                label="Máximo de palabras del resumen"
                hint="Entre 10 y 1000 palabras. Se comprueba al registrar una investigación."
              >
                <input
                  name="summaryWordLimit"
                  type="number"
                  min="10"
                  max="1000"
                  step="1"
                  required
                  defaultValue={current.summaryWordLimit}
                />
              </Field>
              <Field
                label="Tamaño máximo de PDF (MB)"
                hint="Entre 1 y 25 MB. Se aplica a nuevas cargas de archivos."
              >
                <input
                  name="maxPdfSizeMb"
                  type="number"
                  min="1"
                  max="25"
                  step="1"
                  required
                  defaultValue={current.maxPdfSizeMb}
                />
              </Field>
              <p className="muted">
                Valores iniciales: {defaultSettings.summaryWordLimit} palabras y{" "}
                {defaultSettings.maxPdfSizeMb} MB. Guardar requiere tu
                contraseña actual.
              </p>
            </div>
            <div className="modal-footer">
              <button className="primary" disabled={busy}>
                <Save size={17} />
                {busy ? "Esperando confirmación…" : "Guardar parámetros"}
              </button>
            </div>
          </form>
        </section>
        <aside className="administration-info">
          <section className="panel panel-body">
            <FileCheck size={26} />
            <h2>Formato habilitado</h2>
            <strong>PDF</strong>
            <p>
              Se verifican tamaño, extensión, contenido y huella del documento.
              Otros formatos requieren sus propias validaciones antes de
              habilitarse.
            </p>
          </section>
          <section className="panel panel-body">
            <ShieldCheck size={26} />
            <h2>Política de acceso</h2>
            <p>
              Bloqueo por inactividad: <strong>10 minutos</strong>.
            </p>
            <p>
              Bloqueo por contraseña incorrecta:{" "}
              <strong>3 intentos, 5 minutos</strong>.
            </p>
            <p>Estas reglas conservan lo acordado para la evaluación.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
