import { Check, CircleHelp, Eye, EyeOff, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ClientProblem } from "./data/problems";
export function errorText(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "";
  if (error instanceof ClientProblem)
    return [
      ...new Set([
        error.message,
        ...(error.problem.invalid_params ?? []).map((field) => field.reason),
      ]),
    ].join(" ");
  if (error instanceof Error) {
    return error.message;
  }
  return "No se pudo completar la operación.";
}
export function applyFieldProblems(form: HTMLFormElement, error: unknown) {
  if (!(error instanceof ClientProblem)) return;
  let first:
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined;
  for (const field of error.problem.invalid_params ?? []) {
    const name = field.name.split(".").at(-1)!;
    const element = form.elements.namedItem(
      name === "currentPassword" ? "current" : name,
    );
    if (!(
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ))
      continue;
    element.setAttribute("aria-invalid", "true");
    element.setCustomValidity(field.reason);
    element.addEventListener(
      "input",
      () => {
        element.removeAttribute("aria-invalid");
        element.setCustomValidity("");
      },
      { once: true },
    );
    first ??= element;
  }
  first?.reportValidity();
}
export function initials(name: string): string {
  const words = name.split(" ").slice(0, 2);
  const letters = words.map((word) => word[0]);
  return letters.join("").toUpperCase();
}
export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <a
      className="brand"
      href="#dashboard"
      onClick={onNavigate}
      aria-label="FCEA-Datasys · Ir a Inicio"
    >
      <span className="brand-mark faculty-brand">
        <img src="/fcea-logo.png" alt="" />
      </span>
      <span>
        <strong>FCEA-Datasys</strong>
        <small>Repositorio institucional · UNC</small>
      </span>
    </a>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Password({
  name,
  required = true,
  placeholder = "Ingresá tu contraseña",
  autoComplete = "current-password",
}: {
  name: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="password">
      <input
        name={name}
        type={show ? "text" : "password"}
        required={required}
        maxLength={128}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
        onClick={() => setShow(!show)}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

export function Alert({
  text,
  success = false,
}: {
  text: string;
  success?: boolean;
}) {
  return text ? (
    <div
      role={success ? "status" : "alert"}
      className={`alert ${success ? "success" : ""}`}
    >
      {success ? <Check size={17} /> : <CircleHelp size={17} />}
      <span>{text}</span>
    </div>
  ) : null;
}

export function Modal({
  title,
  eyebrow = "Administración de cuentas",
  close,
  children,
}: {
  title: string;
  eyebrow?: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      old?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className="modal" aria-label={title} onCancel={close}>
      <div className="modal-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <button
          className="icon-btn"
          aria-label="Cerrar formulario"
          onClick={close}
        >
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
