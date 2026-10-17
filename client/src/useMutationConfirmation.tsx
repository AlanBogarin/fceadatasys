import { useEffect, useRef, useState, type FormEvent } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { State } from "./model";
import { Alert, errorText, Field, Password } from "./ui";
import {
  existingChanges,
  newBusinessRecords,
  verifyConfirmationPassword,
} from "./mutationPolicy";
import { businessStateKey } from "./audit";
import { auditFailure } from "./auditSignals";

type PendingMutation = {
  before: State;
  after: State;
  actorId: string;
  creation: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
};
export function useMutationConfirmation({
  getState,
  actorId,
  assertActive,
  persist,
  logout,
  contextKey,
}: {
  getState: () => State | undefined;
  actorId: string | null;
  assertActive: () => void;
  persist: (after: State, before: State) => void;
  logout: () => void;
  contextKey: string;
}) {
  const [pending, setPending] = useState<PendingMutation>();
  const current = useRef<PendingMutation | undefined>(undefined);
  const failures = useRef(new Map<string, number>());
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  function cancel(message = "Operación cancelada. No se guardaron cambios.") {
    const request = current.current;
    current.current = undefined;
    setPending(undefined);
    setError("");
    request?.reject(Error(message));
  }
  useEffect(() => {
    cancel(
      "La pantalla o la sesión cambió. No se guardaron cambios pendientes.",
    );
    return () => {
      current.current?.reject(Error("La confirmación se cerró sin guardar."));
      current.current = undefined;
    };
  }, [contextKey]);

  async function commit(after: State, expectedBefore?: State) {
    // Paso 1: comprobar sesión antes de aceptar una operación, aunque no requiera contraseña.
    assertActive();
    const before = getState();
    if (!before || !actorId) throw Error("Volvé a iniciar sesión.");
    if (
      expectedBefore &&
      businessStateKey(expectedBefore) !== businessStateKey(before)
    )
      throw Error("Los datos cambiaron. Volvé a revisar el formulario.");
    after = { ...after, auditEvents: before.auditEvents };
    if (current.current)
      throw Error("Terminá o cancelá la confirmación de seguridad pendiente.");
    // Paso 2: altas con mensaje; modificaciones/bajas con contraseña; bitácoras sin diálogo.
    const modifications = existingChanges(before, after);
    const additions = newBusinessRecords(before, after);
    if (!modifications.length && !additions.length) {
      persist(after, before);
      return;
    }
    // Paso 3: mantener la operación en memoria hasta verificar la contraseña actual.
    await new Promise<void>((resolve, reject) => {
      const request = {
        before,
        after,
        actorId,
        resolve,
        reject,
        creation: !modifications.length,
      };
      current.current = request;
      setPending(request);
      setError("");
    });
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || !current.current) return;
    const request = current.current;
    const form = event.currentTarget;
    const password = String(
      new FormData(form).get("confirmationPassword") ?? "",
    );
    form.reset();
    busy.current = true;
    setWorking(true);
    setError("");
    try {
      assertActive();
      if (
        !getState() ||
        businessStateKey(getState()!) !== businessStateKey(request.before)
      )
        throw Error(
          "Los datos cambiaron. Cancelá y revisá el registro antes de guardar.",
        );
      const valid =
        request.creation ||
        (await verifyConfirmationPassword(
          request.before,
          request.actorId,
          password,
        ));
      if (current.current !== request) return;
      assertActive();
      if (
        !getState() ||
        businessStateKey(getState()!) !== businessStateKey(request.before)
      )
        throw Error(
          "Los datos cambiaron durante la verificación. No se guardaron cambios.",
        );
      if (!valid) {
        auditFailure(
          "Seguridad",
          "Confirmar modificación",
          Error(
            "Contraseña de confirmación incorrecta. No se aplicaron cambios.",
          ),
        );
        const count = (failures.current.get(request.actorId) ?? 0) + 1;
        failures.current.set(request.actorId, count);
        if (count >= 3) {
          cancel(
            "Tres contraseñas incorrectas. Se cerró la sesión por seguridad.",
          );
          logout();
          return;
        }
        setError(
          `Contraseña incorrecta. No se guardaron cambios. Quedan ${3 - count} intento(s).`,
        );
        return;
      }
      const latest = getState()!;
      persist({ ...request.after, auditEvents: latest.auditEvents }, latest);
      failures.current.delete(request.actorId);
      current.current = undefined;
      setPending(undefined);
      request.resolve();
    } catch (caught) {
      if (current.current === request) setError(errorText(caught));
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  const changes = pending ? existingChanges(pending.before, pending.after) : [];
  const additions = pending
    ? newBusinessRecords(pending.before, pending.after)
    : [];
  return {
    commit,
    confirmation: pending ? (
      <ConfirmationDialog
        working={working}
        close={() => {
          if (!busy.current) cancel();
        }}
      >
        <form onSubmit={confirm}>
          <div className="modal-body">
            {pending.creation ? (
              <p>
                Vas a registrar los siguientes datos. Revisalos y confirmá para
                guardarlos.
              </p>
            ) : (
              <p>
                Antes de aplicar esta operación, confirmá tu identidad con{" "}
                <strong>tu contraseña actual</strong>.
              </p>
            )}
            <ul className="confirmation-records">
              {changes.slice(0, 6).map((change, index) => (
                <li key={index}>
                  {change.deleted ? "Eliminar" : "Modificar"}:{" "}
                  <strong>{change.name}</strong>
                </li>
              ))}
              {additions.slice(0, 6).map((name, index) => (
                <li key={`new-${index}`}>
                  Crear: <strong>{name}</strong>
                </li>
              ))}
            </ul>
            {!pending.creation && (
              <>
                <p className="muted">
                  Si estás administrando otra cuenta, ingresá tu contraseña, no
                  la de esa persona.
                </p>
                <Field label="Tu contraseña actual">
                  <Password
                    name="confirmationPassword"
                    autoComplete="current-password"
                  />
                </Field>
              </>
            )}
            <Alert text={error} />
          </div>
          <div className="modal-footer">
            <button
              className="secondary"
              type="button"
              disabled={working}
              onClick={() => cancel()}
            >
              Cancelar sin guardar
            </button>
            <button className="primary" type="submit" disabled={working}>
              {pending.creation
                ? "Confirmar registro"
                : working
                  ? "Verificando…"
                  : changes.some((change) => change.deleted)
                    ? "Confirmar eliminación"
                    : "Confirmar y guardar"}
            </button>
          </div>
        </form>
      </ConfirmationDialog>
    ) : null,
  };
}

function ConfirmationDialog({
  children,
  close,
  working,
}: {
  children: React.ReactNode;
  close: () => void;
  working: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      className="modal security-confirmation"
      ref={dialog}
      aria-label="Confirmación de seguridad"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-heading">
        <div>
          <p className="eyebrow">Protección de cambios</p>
          <h2>
            <ShieldCheck size={20} /> Confirmación de seguridad
          </h2>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Cancelar confirmación"
          disabled={working}
          onClick={close}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
