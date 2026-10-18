import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { auditFailure } from "./auditSignals";
import { useDataClient } from "./data/context";
import { INACTIVITY_MINUTES } from "./security";
import {
  Alert,
  applyFieldProblems,
  Brand,
  errorText,
  Field,
  Password,
} from "./ui";
export function Auth({
  onLogin,
  lockedUsername,
  onExit,
  initialToken,
  onResetComplete,
}: {
  onLogin: () => void;
  lockedUsername?: string;
  onExit: () => void;
  initialToken?: string;
  onResetComplete: () => void;
}) {
  const client = useDataClient();
  const [mode, setMode] = useState<"login" | "recover" | "reset">(
    initialToken !== undefined ? "reset" : "login",
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(initialToken ?? "");
  const switchMode = (value: typeof mode) => {
    setMode(value);
    setError("");
    setMessage("");
    setToken("");
    if (value === "login") onResetComplete();
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer los datos de entrada e impedir envíos duplicados.
    if (busy) return;
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      if (mode === "login") {
        await client.auth.initializeBrowser();
        await client.auth.login(
          lockedUsername || String(form.get("username")),
          String(form.get("password")),
        );
        onLogin();
      }
      if (mode === "recover") {
        const email = String(form.get("email"));
        const result = await client.auth.requestRecovery(email);

        setMessage(result.message);
      }
      if (mode === "reset") {
        const password = String(form.get("newPassword"));
        if (password !== form.get("confirm"))
          throw Error("Las contraseñas no coinciden.");
        await client.auth.resetPassword(token, password);
        setMode("login");
        setToken("");
        setMessage("Contraseña actualizada. Ya podés iniciar sesión.");
        onResetComplete();
      }
    } catch (error) {
      applyFieldProblems(element, error);
      auditFailure("Sesiones", "Autenticación o recuperación rechazada", error);
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand onNavigate={() => switchMode("login")} />
        <span className="demo-chip">
          {(typeof window !== "undefined" &&
            window.__FCEA_CONFIG__?.profile === "demo") ||
          import.meta.env?.MODE === "demo"
            ? "Demostración conectada"
            : "Acceso institucional"}
        </span>
      </header>
      <main className="auth-main">
        <section className="institution-panel">
          <div className="institution-top">
            <span className="institution-logos">
              <a
                href="#dashboard"
                onClick={() => switchMode("login")}
                aria-label="FCEA · Ir al inicio del sistema"
              >
                <img
                  src="/fcea-logo.png"
                  alt="Escudo de la Facultad de Ciencias Económicas y Administrativas"
                />
              </a>
              <img
                className="unc-logo"
                src="/unc-logo.png"
                alt="Escudo de la Universidad Nacional de Concepción"
              />
            </span>
            <span>
              Universidad Nacional
              <br />
              <strong>de Concepción</strong>
            </span>
          </div>
          <div className="institution-copy">
            <span className="institution-kicker">
              Facultad de Ciencias Económicas y Administrativas
            </span>
            <h1>
              El conocimiento
              <br />
              de nuestra comunidad,
              <br />
              en un solo lugar.
            </h1>
            <p>
              Un espacio para organizar, preservar y consultar la producción
              académica de la FCEA.
            </p>
          </div>
          <figure className="campus-photo">
            <img
              src="/fcea-campus.png"
              alt="Edificio de la Facultad de Ciencias Económicas y Administrativas de la Universidad Nacional de Concepción, con jardines y bandera paraguaya"
            />
            <figcaption>
              Facultad de Ciencias Económicas y Administrativas · UNC
            </figcaption>
          </figure>
          <div className="institution-foot">
            <BookOpen size={19} />
            <span>Repositorio institucional de investigaciones</span>
          </div>
        </section>
        <section className="auth-card">
          {lockedUsername && (
            <div className="alert" role="alert">
              <LockKeyhole />
              <div>
                <strong>Sesión bloqueada por inactividad</strong>
                <p>
                  Pasaron {INACTIVITY_MINUTES} minutos sin actividad. Volvé a
                  autenticarse como {lockedUsername}.
                </p>
                <button className="text-button" type="button" onClick={onExit}>
                  Cerrar sesión y usar otra cuenta
                </button>
              </div>
            </div>
          )}
          <span className="auth-symbol">
            {mode === "login" ? <LockKeyhole size={27} /> : <Mail size={27} />}
          </span>
          <h2>
            {(() => {
              if (mode === "login") {
                return "Bienvenido a FCEA-Datasys";
              }
              if (mode === "recover") {
                return "Recuperá tu acceso";
              }
              return "Creá una nueva contraseña";
            })()}
          </h2>
          <p className="muted auth-subtitle">
            {(() => {
              if (mode === "login") {
                return "Ingresá con tu cuenta institucional para continuar.";
              }
              if (mode === "recover") {
                return "Ingresá el correo asociado a tu cuenta.";
              }
              return "El enlace de recuperación es válido por 15 minutos.";
            })()}
          </p>
          <form onSubmit={submit} key={mode}>
            <Alert text={error} />
            <Alert text={message} success />
            {(() => {
              if (mode === "login") {
                return (
                  <>
                    <Field label="Usuario">
                      <input
                        readOnly={Boolean(lockedUsername)}
                        defaultValue={lockedUsername}
                        name="username"
                        required
                        autoComplete="username"
                        placeholder="Tu nombre de usuario"
                      />
                    </Field>
                    <Field label="Contraseña">
                      <Password name="password" />
                    </Field>
                    <div className="form-between">
                      <span className="muted">
                        <ShieldCheck size={14} />
                        Acceso por roles
                      </span>
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => switchMode("recover")}
                      >
                        ¿Olvidaste tu contraseña?
                      </button>
                    </div>
                  </>
                );
              }
              if (mode === "recover") {
                return (
                  <Field label="Correo electrónico">
                    <input
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="nombre@institucion.edu.py"
                    />
                  </Field>
                );
              }
              return (
                <>
                  <input type="hidden" name="token" value={token} />
                  <Field
                    label="Nueva contraseña"
                    hint="Mínimo 8 caracteres, una letra y un número."
                  >
                    <Password
                      name="newPassword"
                      autoComplete="new-password"
                      placeholder="Nueva contraseña"
                    />
                  </Field>
                  <Field label="Confirmar contraseña">
                    <Password
                      name="confirm"
                      autoComplete="new-password"
                      placeholder="Repetí la nueva contraseña"
                    />
                  </Field>
                </>
              );
            })()}
            <button className="primary full" disabled={busy}>
              {(() => {
                if (busy) {
                  return "Procesando…";
                }
                if (mode === "login") {
                  return "Iniciar sesión";
                }
                if (mode === "recover") {
                  return "Solicitar recuperación";
                }
                return "Guardar nueva contraseña";
              })()}
              <ArrowRight size={18} />
            </button>
          </form>
          {mode !== "login" && (
            <button
              className="text-button back-link"
              onClick={() => switchMode("login")}
            >
              <ArrowLeft size={16} />
              Volver al inicio de sesión
            </button>
          )}
          <div className="auth-note">
            <ShieldCheck size={18} />
            <p>
              Ingresá con la cuenta asignada por el administrador de la
              institución.
            </p>
          </div>
        </section>
      </main>
      <footer className="auth-footer">
        <span>FCEA-Datasys · Universidad Nacional de Concepción</span>
        <span>Catálogo bibliográfico digital</span>
      </footer>
    </div>
  );
}
