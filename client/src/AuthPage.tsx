import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { DEMO_PASSWORD, digest, randomToken, type State } from "./model";
import { INACTIVITY_MINUTES } from "./security";
import { Alert, Brand, errorText, Field, Password } from "./ui";
import { loginUser, recoverPassword, requireResult } from "./userService";
export function Auth({
  state,
  commit,
  onLogin,
  lockedUsername,
  onExit,
}: {
  state: State;
  commit: (value: State) => void;
  onLogin: (targetId: string) => void;
  lockedUsername?: string;
  onExit: () => void;
}) {
  const [mode, setMode] = useState<"login" | "recover" | "reset">("login");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [credentials, setCredentials] = useState(false);
  const switchMode = (value: typeof mode) => {
    setMode(value);
    setError("");
    setMessage("");
    setToken("");
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer los datos de entrada e impedir envíos duplicados.
    if (busy) return;
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "login") {
        const result = await loginUser(
          state,
          lockedUsername || String(form.get("username")),
          String(form.get("password")),
        );
        if (result.datos) {
          commit(result.datos.state);
        }
        if (!result.exito) {
          setError(result.mensaje);
        } else if (result.datos.userId) {
          onLogin(result.datos.userId);
        }
      }
      if (mode === "recover") {
        const email = String(form.get("email")).trim().toLowerCase();
        const person = state.users.find(
          (account) => account.email.toLowerCase() === email && account.active,
        );
        setToken("");
        if (person) {
          const value = randomToken();
          commit({
            ...state,
            recovery: [
              ...state.recovery.filter(
                (entry) =>
                  entry.userId !== person.id && entry.expiresAt > Date.now(),
              ),
              {
                userId: person.id,
                hash: await digest(value),
                expiresAt: Date.now() + 15 * 60000,
              },
            ],
          });
          setToken(value);
        }
        setMessage(
          "Solicitud registrada. En el sistema final, una cuenta activa recibirá un enlace de recuperación por correo.",
        );
      }
      if (mode === "reset") {
        const password = String(form.get("newPassword"));
        if (password !== form.get("confirm")) {
          throw Error("Las contraseñas no coinciden.");
        }
        commit(
          requireResult(
            await recoverPassword(state, String(form.get("token")), password),
          ),
        );
        setMode("login");
        setToken("");
        setMessage("Contraseña actualizada. Ya podés iniciar sesión.");
      }
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand onNavigate={() => switchMode("login")} />
        <span className="demo-chip">Demostración local</span>
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
                  autenticarte como {lockedUsername}.
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
          {mode === "recover" && token && (
            <div className="recovery-demo">
              <strong>Recorrido de demostración</strong>
              <p>
                No se envían correos en esta versión. Podés continuar aquí para
                probar el cambio de contraseña de la cuenta local.
              </p>
              <button
                className="secondary full"
                onClick={() => {
                  setMode("reset");
                  setMessage("");
                  setError("");
                }}
              >
                Continuar con la recuperación
                <ArrowRight size={16} />
              </button>
            </div>
          )}
          {mode !== "login" && (
            <button
              className="text-button back-link"
              onClick={() => switchMode("login")}
            >
              <ArrowLeft size={16} />
              Volver al inicio de sesión
            </button>
          )}
          {mode === "login" && (
            <div className="demo-access">
              <button
                className="text-button"
                onClick={() => setCredentials(!credentials)}
                aria-expanded={credentials}
              >
                <CircleHelp size={16} />
                {credentials
                  ? "Ocultar cuentas de prueba"
                  : "Ver cuentas de prueba"}
                <ChevronDown size={15} />
              </button>
              {credentials && (
                <div className="demo-accounts">
                  <p>
                    Contraseña inicial: <code>{DEMO_PASSWORD}</code>
                  </p>
                  <p>
                    <code>admin</code> · Administrador
                  </p>
                  <p>
                    <code>digitador</code> · Gestión bibliográfica
                  </p>
                  <p>
                    <code>publico</code> · Consulta
                  </p>
                  <small>
                    Son cuentas ficticias. Si cambiás una contraseña, usá la
                    nueva.
                  </small>
                </div>
              )}
            </div>
          )}
          <div className="auth-note">
            <ShieldCheck size={18} />
            <p>
              Prototipo para presentación académica. Los datos se guardan
              únicamente en este navegador.
            </p>
          </div>
        </section>
      </main>
      <footer className="auth-footer">
        <span>FCEA-Datasys · Universidad Nacional de Concepción</span>
        <span>Primera entrega · Interfaz de usuario</span>
      </footer>
    </div>
  );
}
