import { useRef, useState } from "react";
import { canonical } from "./versions";
import { ClientProblem, problem } from "./problems";

export function useVersionedDraft<T>(initial: T, initialEtag?: string) {
  const base = useRef({ value: initial, etag: initialEtag });
  const [conflict, setConflict] = useState(false);
  const [ready, setReady] = useState(!!initialEtag);
  async function check(current: T, code?: string) {
    if (canonical(current) !== canonical(base.current.value)) {
      setConflict(true);
      throw problem(
        412,
        code ?? "RESOURCE_VERSION_CONFLICT",
        "El registro cambió. Tus datos ingresados se conservaron; revisá los valores actuales antes de volver a guardar.",
      );
    }
    if (!base.current.etag)
      throw problem(
        428,
        "PRECONDITION_REQUIRED",
        "Esperá a que termine la consulta del registro.",
      );
    return base.current.etag;
  }
  function review(current: T, etag: string) {
    base.current = { value: current, etag };
    setConflict(false);
    setReady(true);
  }
  function initialize(current: T, etag: string) {
    if (!base.current.etag) {
      if (canonical(current) !== canonical(base.current.value))
        setConflict(true);
      base.current.etag = etag;
      setReady(true);
    }
  }
  function failed(error: unknown) {
    if (error instanceof ClientProblem && error.status === 412)
      setConflict(true);
  }
  return { check, conflict, review, initialize, ready, failed };
}

export function VersionReview({
  values,
  onReviewed,
}: {
  values: Record<string, string>;
  onReviewed: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="version-review" role="alert">
      <strong>Hay cambios más recientes en este registro</strong>
      <p>
        Conservamos tus datos ingresados. Compará los valores actuales antes de
        volver a guardar.
      </p>
      <button
        className="secondary"
        type="button"
        onClick={() => setOpen(!open)}
      >
        {open
          ? "Ocultar valores actuales"
          : "Comparar con los valores actuales"}
      </button>
      {open && (
        <>
          <dl>
            {Object.entries(values).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value || "Sin dato"}</dd>
              </div>
            ))}
          </dl>
          <button className="secondary" type="button" onClick={onReviewed}>
            Ya revisé; conservar mis datos ingresados
          </button>
          <p>Después podés volver a guardar y confirmar la operación.</p>
        </>
      )}
    </div>
  );
}
