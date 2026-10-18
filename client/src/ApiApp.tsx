import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Check,
  ChevronRight,
  LogOut,
  Menu,
  UserRound,
  LockKeyhole,
} from "lucide-react";
import { Auth } from "./AuthPage";
import { AccountMenu } from "./AccountMenu";
import CatalogPage, { RolesPage } from "./CatalogPage";
import { ChangePassword, Profile, UsersPage } from "./UserPages";
import { SettingsPage } from "./SettingsPage";
import { AttachmentPage } from "./AttachmentPage";
import { AuditPage } from "./AuditPage";
import { ApiDashboard } from "./ApiDashboard";
import { ApiPublicationsPage } from "./ApiPublicationPages";
import {
  ApiBibliographicPage,
  ApiPublicationReportsPage,
} from "./ApiBibliographicPages";
import { DataProvider, useDataClient } from "./data/context";
import { createApiClient } from "./data/apiClient";
import { ApiSession, browserSessionBus } from "./data/apiSession";
import { HttpTransport } from "./data/http";
import type { ClientConfig } from "./data/config";
import { useQuery } from "./data/useQuery";
import { canOpenPage } from "./security";
import { roleLabel } from "./model";
import { CATALOG_KEYS, isCatalogKey } from "./catalogs";
import { allItems, groups } from "./navigation";
import { Alert, Brand, errorText, initials } from "./ui";
import { useApiConfirmation } from "./useApiConfirmation";

export const connectedPages = new Set([
  "dashboard",
  "auditoria",
  "perfil",
  "password",
  "usuarios",
  "roles",
  "parametros",
  ...CATALOG_KEYS,
  "archivos",
  "gestion-publicaciones",
  "publicaciones",
  "busqueda",
  "reportes",
]);
function takeRecoveryToken() {
  const url = new URL(location.href);
  const token = url.searchParams.get("token");
  if (token !== null) {
    url.searchParams.delete("token");
    history.replaceState(null, "", url);
  }
  return token;
}
function ApiProfile() {
  const client = useDataClient();
  const query = useQuery((signal) => client.users.me(signal), [client]);
  const [message, setMessage] = useState("");
  const [profile, setProfile] = useState(query.data);
  useEffect(() => {
    if (query.data) setProfile(query.data);
  }, [query.data]);
  if (!profile && query.loading)
    return <p role="status">Consultando tu perfil…</p>;
  if (!profile)
    return (
      <>
        <Alert text={errorText(query.error)} />
        <button className="secondary" onClick={query.reload}>
          Volver a consultar
        </button>
      </>
    );
  return (
    <>
      <Alert text={message} success />
      <Alert text={query.error ? errorText(query.error) : ""} />
      <Profile user={profile} notify={setMessage} />
    </>
  );
}
export default function ApiApp({ config }: { config: ClientConfig }) {
  const [runtime] = useState(
    () =>
      new ApiSession(
        new HttpTransport(config.apiBaseUrl),
        undefined,
        browserSessionBus(),
      ),
  );
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const [route, setRoute] = useState(
    () => location.hash.slice(1) || "dashboard",
  );
  const page = route.split("?")[0];
  const routeQuery = new URLSearchParams(route.split("?")[1] ?? "");
  // Leer el token una sola vez fuera del inicializador de useState (StrictMode lo ejecuta dos veces).
  const recovery = useRef<{ value: string | null } | null>(null);
  if (!recovery.current) recovery.current = { value: takeRecoveryToken() };
  const [recoveryToken, setRecoveryToken] = useState(recovery.current.value);
  const [toast, setToast] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [mobile, setMobile] = useState(false);
  const user = snapshot.session?.user;
  const confirmation = useApiConfirmation(
    `${snapshot.session?.session.id ?? ""}:${route}`,
  );
  const confirm = useRef(confirmation.confirm);
  confirm.current = confirmation.confirm;
  const [client] = useState(() =>
    createApiClient(runtime, (request) => confirm.current(request)),
  );
  useEffect(() => runtime.start(), [runtime]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, user?.id]);
  useEffect(() => {
    if (
      user &&
      ["login", "recover", "reset"].includes(page) &&
      recoveryToken === null
    ) {
      location.hash = "dashboard";
      setRoute("dashboard");
    }
  }, [user, page, recoveryToken]);
  useEffect(() => {
    const listener = () => {
      setRoute(location.hash.slice(1) || "dashboard");
      setMobile(false);
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = (value: string) => {
    location.hash = value;
    setRoute(value);
    setMobile(false);
  };
  const logout = async () => {
    setLogoutError("");
    try {
      await client.auth.logout();
      navigate("login");
    } catch (error) {
      setLogoutError(errorText(error));
    }
  };
  function content() {
    if (!user) return null;
    if (!canOpenPage(user.role, page))
      return (
        <section className="empty-module">
          <h1>Acceso restringido</h1>
          <p>Tu rol no tiene permiso para abrir esta ventana.</p>
          <a className="secondary" href="#dashboard">
            Volver al inicio
          </a>
        </section>
      );
    if (!connectedPages.has(page))
      return (
        <section className="empty-module">
          <h1>
            {allItems.find((item) => item.id === page)?.label ??
              "Ventana pendiente"}
          </h1>
          <p>Esta ventana está pendiente de conexión al servidor.</p>
          <a className="secondary" href="#dashboard">
            Volver al inicio
          </a>
        </section>
      );
    if (page === "perfil") return <ApiProfile />;
    if (page === "dashboard")
      return <ApiDashboard user={user} navigate={navigate} />;
    if (page === "auditoria") return <AuditPage user={user} />;
    if (page === "password")
      return (
        <ChangePassword
          user={user}
          onDone={() => {
            navigate("perfil");
            setToast("Contraseña actualizada. Tu sesión sigue activa.");
          }}
        />
      );
    if (page === "usuarios") return <UsersPage user={user} notify={setToast} />;
    if (page === "roles") return <RolesPage />;
    if (page === "parametros")
      return <SettingsPage user={user} notify={setToast} />;
    if (isCatalogKey(page))
      return <CatalogPage catalog={page} user={user} notify={setToast} />;
    if (page === "archivos")
      return (
        <AttachmentPage
          user={user}
          register={(id) =>
            navigate(
              `gestion-publicaciones?attachmentId=${encodeURIComponent(id)}`,
            )
          }
        />
      );
    if (page === "gestion-publicaciones")
      return (
        <ApiPublicationsPage
          user={user}
          notify={setToast}
          initialAttachmentId={routeQuery.get("attachmentId") ?? ""}
          showReport={(id) =>
            navigate(
              `reportes${id ? `?publicationId=${encodeURIComponent(id)}` : ""}`,
            )
          }
        />
      );
    if (page === "publicaciones" || page === "busqueda")
      return (
        <ApiBibliographicPage
          user={user}
          advanced={page === "busqueda"}
          navigate={navigate}
        />
      );
    if (page === "reportes")
      return (
        <ApiPublicationReportsPage
          user={user}
          initialId={routeQuery.get("publicationId") ?? ""}
        />
      );
  }
  return (
    <DataProvider client={client} mode="api" revision={snapshot.revision}>
      {snapshot.loading ? (
        <div className="loading">
          <Brand />
          <p>Restaurando sesión…</p>
        </div>
      ) : !user || recoveryToken !== null ? (
        <>
          <Auth
            initialToken={recoveryToken ?? undefined}
            lockedUsername={snapshot.lockedUser?.username}
            onExit={logout}
            onResetComplete={() => setRecoveryToken(null)}
            onLogin={() => navigate("dashboard")}
          />
          <Alert
            text={
              logoutError || (snapshot.error ? errorText(snapshot.error) : "")
            }
          />
          {Boolean(snapshot.error) && (
            <button
              className="secondary"
              onClick={() => {
                void runtime
                  .initializeBrowser()
                  .then(runtime.restore)
                  .catch(() => {});
              }}
            >
              Volver a conectar
            </button>
          )}
        </>
      ) : (
        <div className="app-shell">
          {mobile && (
            <button
              className="sidebar-backdrop"
              aria-label="Cerrar menú"
              onClick={() => setMobile(false)}
            />
          )}
          <aside className={`sidebar ${mobile ? "open" : ""}`}>
            <div className="sidebar-brand">
              <Brand onNavigate={() => navigate("dashboard")} />
            </div>
            <div className="sidebar-nav">
              {groups.map((group) => {
                const items = group.items.filter(
                  (item) => !item.roles || item.roles.includes(user.role),
                );
                return (
                  !!items.length && (
                    <nav key={group.label} aria-label={group.label}>
                      <p className="nav-label">{group.label}</p>
                      {items.map((item) => (
                        <a
                          key={item.id}
                          className={`nav-item ${page === item.id ? "selected" : ""}`}
                          href={`#${item.id}`}
                          aria-current={page === item.id ? "page" : undefined}
                          onClick={() => setMobile(false)}
                        >
                          <item.icon size={18} />
                          <span>{item.label}</span>
                          {!connectedPages.has(item.id) && (
                            <span
                              className="pending-dot"
                              title="Pendiente de conexión"
                            />
                          )}
                        </a>
                      ))}
                    </nav>
                  )
                );
              })}
              <nav aria-label="Mi cuenta">
                <p className="nav-label">Mi cuenta</p>
                <a
                  href="#perfil"
                  className={`nav-item ${page === "perfil" ? "selected" : ""}`}
                >
                  <UserRound size={18} />
                  Mi perfil
                </a>
                <a
                  href="#password"
                  className={`nav-item ${page === "password" ? "selected" : ""}`}
                >
                  <LockKeyhole size={18} />
                  Cambiar contraseña
                </a>
              </nav>
            </div>
            <div className="sidebar-bottom">
              <div className="session-person">
                <span className="avatar">{initials(user.name)}</span>
                <span>
                  <strong>{user.name}</strong>
                  <small>{roleLabel[user.role]}</small>
                </span>
              </div>
              <button className="logout" onClick={logout}>
                <LogOut size={18} />
                Cerrar sesión
              </button>
            </div>
          </aside>
          <div className="workspace">
            <header className="topbar">
              <div className="breadcrumb">
                <button
                  className="icon-btn mobile-toggle"
                  aria-label="Abrir menú"
                  onClick={() => setMobile(true)}
                >
                  <Menu size={22} />
                </button>
                <span>Espacio institucional</span>
                <ChevronRight size={14} />
                <strong>
                  {page === "perfil"
                    ? "Mi perfil"
                    : page === "password"
                      ? "Cambiar contraseña"
                      : allItems.find((item) => item.id === page)?.label}
                </strong>
              </div>
              <div className="topbar-right">
                <span className="demo-chip">
                  {config.profile === "demo" || import.meta.env.MODE === "demo"
                    ? "Demostración conectada"
                    : "Servidor institucional"}
                </span>
                <AccountMenu user={user} navigate={navigate} logout={logout} />
              </div>
            </header>
            <main
              id="main"
              className="main-content"
              key={`${snapshot.session!.session.id}:${route}`}
            >
              <Alert text={logoutError} />
              {Boolean(snapshot.error) && (
                <Alert text={errorText(snapshot.error)} />
              )}
              {content()}
            </main>
            <footer className="workspace-footer">
              <span>FCEA · Universidad Nacional de Concepción</span>
              <span>Repositorio de investigaciones</span>
            </footer>
          </div>
          {confirmation.dialog}
          {toast && (
            <div className="toast" role="status">
              <Check size={18} />
              {toast}
            </div>
          )}
        </div>
      )}
    </DataProvider>
  );
}
