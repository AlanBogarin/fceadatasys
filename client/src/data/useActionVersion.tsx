import { useEffect, useState } from "react";
import type { Versioned } from "./contracts";
import { ClientProblem } from "./problems";
import { VersionReview } from "./useVersionedDraft";
import { errorText } from "../ui";

// La versión de una acción de estado/baja solo cambia después de una revisión explícita.
export function useActionVersion<T extends { name: string; active: boolean }>(
  context: string,
) {
  const [pending, setPending] = useState<{
    read: () => Promise<Versioned<T>>;
    accept: (value: Versioned<T>) => void;
  }>();
  const [latest, setLatest] = useState<Versioned<T>>();
  const [error, setError] = useState("");
  useEffect(() => {
    setPending(undefined);
    setLatest(undefined);
    setError("");
  }, [context]);
  useEffect(() => {
    if (!pending) return;
    let active = true;
    void pending
      .read()
      .then((value) => {
        if (active) setLatest(value);
      })
      .catch((error) => {
        if (active) setError(errorText(error));
      });
    return () => {
      active = false;
    };
  }, [pending]);
  return {
    blocked: !!pending,
    failed(
      error: unknown,
      read: () => Promise<Versioned<T>>,
      accept: (value: Versioned<T>) => void,
    ) {
      if (error instanceof ClientProblem && error.status === 412) {
        setLatest(undefined);
        setError("");
        setPending({ read, accept });
      }
    },
    review: pending && (
      <>
        {error ? (
          <p role="alert">{error}</p>
        ) : !latest ? (
          <p role="status">Consultando la versión actual…</p>
        ) : (
          <VersionReview
            values={{
              Nombre: latest.data.name,
              Estado: latest.data.active ? "Activo" : "Inactivo",
              "Datos actuales": JSON.stringify(latest.data, null, 2),
            }}
            onReviewed={() => {
              pending.accept(latest);
              setPending(undefined);
              setLatest(undefined);
            }}
          />
        )}
      </>
    ),
  };
}
