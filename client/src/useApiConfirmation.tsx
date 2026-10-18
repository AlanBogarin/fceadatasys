import { useEffect, useRef, useState } from "react";
import type { ConfirmationRequest, ConfirmMutation } from "./data/apiClient";
import { Field, Modal, Password } from "./ui";

// Conserva la contraseña únicamente en el formulario y en la petición pendiente.
export function useApiConfirmation(contextKey: string) {
  const [request, setRequest] = useState<ConfirmationRequest | null>(null);
  const pending = useRef<{
    resolve: (password?: string) => void;
    reject: (error: unknown) => void;
  } | null>(null);
  const cancel = () => {
    pending.current?.reject(
      new DOMException("Confirmación cancelada", "AbortError"),
    );
    pending.current = null;
    setRequest(null);
  };
  useEffect(() => {
    cancel();
    return cancel;
  }, [contextKey]);
  const confirm: ConfirmMutation = (value) => {
    if (pending.current)
      return Promise.reject(
        Error("Hay otra operación esperando confirmación."),
      );
    return new Promise((resolve, reject) => {
      pending.current = { resolve, reject };
      setRequest(value);
    });
  };
  return {
    confirm,
    dialog: request && (
      <Modal
        title="Confirmar operación"
        eyebrow="Repositorio institucional"
        close={cancel}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const password = request.password
              ? String(
                  new FormData(event.currentTarget).get("confirmationPassword"),
                )
              : undefined;
            const resolve = pending.current?.resolve;
            event.currentTarget.reset();
            pending.current = null;
            setRequest(null);
            resolve?.(password);
          }}
        >
          <div className="modal-body">
            <p>{request.title}</p>
            {request.password && (
              <Field label="Tu contraseña actual">
                <Password
                  name="confirmationPassword"
                  autoComplete="current-password"
                />
              </Field>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="secondary" onClick={cancel}>
              Cancelar
            </button>
            <button className="primary">Confirmar</button>
          </div>
        </form>
      </Modal>
    ),
  };
}
