import { FileCheck, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import "./administration.css";
import { auditFailure } from "./auditSignals";
import { useDataClient } from "./data/context";
import type { UserDto as User } from "./data/contracts";
import { useVersionedDraft, VersionReview } from "./data/useVersionedDraft";
import type { ViewState as State } from "./data/view";
import { defaultSettings, settingsOf } from "./settings";
import { Alert, applyFieldProblems, errorText, Field } from "./ui";

export function SettingsPage({
  state,
  user,
  notify,
}: {
  state: State;
  user: User;
  notify: (message: string) => void;
}) {
  const current = settingsOf(state);
  const client = useDataClient();
  const version = useVersionedDraft(current);
  useEffect(() => {
    let open = true;
    void client.settings
      .get()
      .then((result) => {
        if (open) version.initialize(result.data, result.etag);
      })
      .catch((error) => {
        if (open) setError(errorText(error));
      });
    return () => {
      open = false;
    };
  }, [client]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (user.role !== "ADMINISTRADOR")
    return <Alert text="No tenés permiso para administrar parámetros." />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const element = event.currentTarget;
    try {
      // Paso 1: leer valores; Paso 2: validar permisos, rangos y cambios efectivos.
      const values = new FormData(event.currentTarget);
      const etag = await version.check(current);
      const next = {
        summaryWordLimit: Number(values.get("summaryWordLimit")),
        maxPdfSizeMb: Number(values.get("maxPdfSizeMb")),
        allowedFormats: values.getAll("allowedFormats") as ("pdf" | "txt")[],
      };
      if (JSON.stringify(next) === JSON.stringify(current)) {
        notify("No hay cambios en los parámetros.");
        return;
      }
      // Paso 3: esperar la contraseña y la escritura conjunta con la auditoría.
      const saved = await client.settings.update(next, { ifMatch: etag });
      version.review(saved.data, saved.etag);
      notify(
        "Parámetros actualizados. Se aplican a las nuevas cargas y registros.",
      );
    } catch (caught) {
      applyFieldProblems(element, caught);
      version.failed(caught);
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
          <form onSubmit={submit}>
            <div className="panel-body">
              <Alert text={error} />
              {version.conflict && (
                <VersionReview
                  values={{
                    "Palabras del resumen": String(current.summaryWordLimit),
                    "Tamaño máximo (MiB)": String(current.maxPdfSizeMb),
                    Formatos: current.allowedFormats.join(", ").toUpperCase(),
                  }}
                  onReviewed={() => {
                    void client.settings
                      .get()
                      .then((result) => {
                        version.review(result.data, result.etag);
                        setError("");
                      })
                      .catch((error) => setError(errorText(error)));
                  }}
                />
              )}
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
                label="Tamaño máximo de archivo (MiB)"
                hint="Entre 1 y 25 MiB. Se aplica a PDF y TXT en las nuevas cargas."
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
              <fieldset className="format-options">
                <legend>Formatos de archivo permitidos</legend>
                {(["pdf", "txt"] as const).map((format) => (
                  <label key={format}>
                    <input
                      type="checkbox"
                      name="allowedFormats"
                      value={format}
                      defaultChecked={current.allowedFormats.includes(format)}
                    />{" "}
                    {format.toUpperCase()}
                    {format === "txt" ? " (texto UTF-8)" : ""}
                  </label>
                ))}
                <p className="muted">
                  Elegí al menos uno. Deshabilitar un formato conserva las
                  descargas de archivos anteriores.
                </p>
              </fieldset>
              <p className="muted">
                Valores iniciales: {defaultSettings.summaryWordLimit} palabras y{" "}
                {defaultSettings.maxPdfSizeMb} MiB. Guardar requiere tu
                contraseña actual.
              </p>
            </div>
            <div className="modal-footer">
              <button className="primary" disabled={busy || !version.ready}>
                <Save size={17} />
                {busy ? "Esperando confirmación…" : "Guardar parámetros"}
              </button>
            </div>
          </form>
        </section>
        <aside className="administration-info">
          <section className="panel panel-body">
            <FileCheck size={26} />
            <h2>Formatos habilitados</h2>
            <strong>{current.allowedFormats.join(", ").toUpperCase()}</strong>
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
