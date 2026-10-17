import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Construction,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  LibraryBig,
  LockKeyhole,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AttachmentPage } from "./AttachmentPage";
import { AuditPage } from "./AuditPage";
import { Auth } from "./AuthPage";
import { BibliographicPage } from "./BibliographicPage";
import CatalogPage, { RolesPage } from "./CatalogPage";
import { DemoDataPanel } from "./DemoDataPanel";
import { PublicationReportsPage, PublicationsPage } from "./PublicationPages";
import { SettingsPage } from "./SettingsPage";
import { ChangePassword, Profile, UsersPage } from "./UserPages";
import { auditMutation, type AuditContext, type AuditIntent } from "./audit";
import { observeAudit } from "./auditSignals";
import { isCatalogKey } from "./catalogs";
import { assertMockMode, clientConfig } from "./data/config";
import { DataProvider } from "./data/context";
import { userDto, type UserDto as User } from "./data/contracts";
import { browserLock } from "./data/coordination";
import { createMockClient } from "./data/mockClient";
import { problem } from "./data/problems";
import { viewStateOf, type ViewState } from "./data/view";
import "./demoData.css";
import { roleLabel, type Role, type State } from "./model";
import { canOpenPage } from "./security";
import { load, save } from "./storage";
import { Brand, errorText, initials } from "./ui";
import { useMutationConfirmation } from "./useMutationConfirmation";
import { useSession } from "./useSession";
type Item = {
  id: string;
  label: string;
  icon: LucideIcon;
  ready?: boolean;
  roles?: Role[];
};
const admins: Role[] = ["ADMINISTRADOR"];
const editors: Role[] = ["ADMINISTRADOR", "DIGITADOR"];
const groups: {
  label: string;
  items: Item[];
}[] = [
  {
    label: "Repositorio",
    items: [
      { id: "dashboard", label: "Inicio", icon: LayoutDashboard, ready: true },
      {
        id: "publicaciones",
        label: "Catálogo bibliográfico",
        icon: BookOpen,
        ready: true,
      },
      { id: "busqueda", label: "Búsqueda avanzada", icon: Search, ready: true },
    ],
  },
  {
    label: "Gestión bibliográfica",
    items: [
      {
        id: "gestion-publicaciones",
        ready: true,
        label: "Publicaciones",
        icon: FileText,
        roles: editors,
      },
      {
        id: "archivos",
        ready: true,
        label: "Carga de archivos",
        icon: UploadCloud,
        roles: editors,
      },
      {
        id: "autores",
        ready: true,
        label: "Autores",
        icon: Users,
        roles: editors,
      },
      {
        id: "tutores",
        ready: true,
        label: "Tutores y orientadores",
        icon: GraduationCap,
        roles: editors,
      },
    ],
  },
  {
    label: "Administración",
    items: [
      {
        id: "usuarios",
        label: "Usuarios",
        icon: ShieldCheck,
        ready: true,
        roles: admins,
      },
      {
        id: "carreras",
        ready: true,
        label: "Carreras",
        icon: GraduationCap,
        roles: admins,
      },
      {
        id: "facultades",
        ready: true,
        label: "Facultades",
        icon: Building2,
        roles: admins,
      },
      {
        id: "filiales",
        label: "Sedes y filiales",
        icon: Building2,
        ready: true,
        roles: admins,
      },
      {
        id: "tipos",
        ready: true,
        label: "Tipos de publicación",
        icon: FolderOpen,
        roles: admins,
      },
      {
        id: "niveles",
        ready: true,
        label: "Niveles académicos",
        icon: LibraryBig,
        roles: admins,
      },
      {
        id: "roles",
        ready: true,
        label: "Roles y permisos",
        icon: LockKeyhole,
        roles: admins,
      },
      {
        id: "parametros",
        ready: true,
        label: "Parámetros generales",
        icon: SlidersHorizontal,
        roles: admins,
      },
      {
        id: "reportes",
        ready: true,
        label: "Reporte de investigaciones",
        icon: FileText,
        roles: admins,
      },
      {
        id: "auditoria",
        label: "Auditoría",
        icon: Clock3,
        roles: admins,
        ready: true,
      },
    ],
  },
];
const allItems = groups.flatMap((group) => group.items);
const route = () => location.hash.slice(1) || "dashboard";
function AccountMenu({
  user,
  navigate,
  logout,
}: {
  user: User;
  navigate: (targetId: string) => void;
  logout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      className="account-menu"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="profile-button"
        onClick={() => setOpen(!open)}
        aria-label="Opciones de mi cuenta"
        aria-expanded={open}
        aria-controls="account-options"
      >
        <span className="avatar small">{initials(user.name)}</span>
        <span>{roleLabel[user.role]}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <nav
          id="account-options"
          className="account-options"
          aria-label="Opciones de mi cuenta"
        >
          <a
            href="#perfil"
            onClick={() => {
              setOpen(false);
              navigate("perfil");
            }}
          >
            <UserRound size={17} />
            Mi perfil
          </a>
          <a
            href="#password"
            onClick={() => {
              setOpen(false);
              navigate("password");
            }}
          >
            <LockKeyhole size={17} />
            Cambiar contraseña
          </a>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              logout();
            }}
          >
            <LogOut size={17} />
            Cerrar sesión
          </button>
        </nav>
      )}
    </div>
  );
}
export default function App() {
  const [state, setState] = useState<State>();
  const [fatal, setFatal] = useState("");
  const sessionControl = useSession();
  const { session, locked } = sessionControl;
  const stateRef = useRef<State | undefined>(undefined);
  stateRef.current = state;
  const [page, setPage] = useState(route);
  const [toast, setToast] = useState("");
  const [reportPublicationId, setReportPublicationId] = useState("");
  const [registrationAttachmentId, setRegistrationAttachmentId] = useState("");
  const [recoveryLink, setRecoveryLink] = useState<string | null>(() =>
    new URL(location.href).searchParams.get("token"),
  );
  const [mobile, setMobile] = useState(false);
  const auditSessionId = useRef(
    sessionStorage.getItem("fcea-datasys.audit.session") ?? crypto.randomUUID(),
  );
  const sessionStarted = useRef(
    Number(sessionStorage.getItem("fcea-datasys.audit.started")) || Date.now(),
  );
  if (sessionControl.info) {
    auditSessionId.current = sessionControl.info.id;
    sessionStarted.current = sessionControl.info.createdAt;
  }
  const sessionIdentity = useRef(session);
  sessionIdentity.current = session;
  const confirmationControl = useMutationConfirmation({
    getState: () => stateRef.current,
    actorId: session,
    assertActive: sessionControl.assertActive,
    persist: (after, before) => commitAuthentication(after, before),
    logout: () => logout(),
    recordConfirmation: (valid, persist) =>
      sessionControl.confirmation(
        valid,
        valid
          ? persist
          : () =>
              recordAudit({
                module: "Seguridad",
                operation:
                  (sessionControl.info?.confirmationFailures ?? 0) >= 2
                    ? "Cerrar sesión por confirmaciones incorrectas"
                    : "Confirmación rechazada",
                status: "FALLIDO",
                detail: `Contraseña de confirmación incorrecta. Duración de sesión: ${Math.max(0, Math.floor((Date.now() - (sessionControl.info?.createdAt ?? Date.now())) / 1000))} segundos.`,
              }),
      ),
    contextKey: `${session ?? ""}:${locked}:${page}`,
  });
  const clientRuntime = useRef({ confirmationControl, sessionControl });
  clientRuntime.current = { confirmationControl, sessionControl };
  const [client] = useState(() =>
    createMockClient({
      read: () => {
        if (!stateRef.current)
          throw Error("Los datos todavía no están disponibles.");
        return stateRef.current;
      },
      actorId: () => sessionIdentity.current ?? "",
      assertActive: () => clientRuntime.current.sessionControl.assertActive(),
      commit: async (after, before, options) => {
        if (options?.currentPasswordVerified) {
          clientRuntime.current.sessionControl.assertActive();
          await commitAuthentication(after, before);
        } else
          await clientRuntime.current.confirmationControl.commit(after, before);
      },
      audit: (intent) => recordAudit(intent),
      authentication: {
        current: () => clientRuntime.current.sessionControl.current(),
        login: (userId, before) =>
          clientRuntime.current.sessionControl.login(userId, async (shared) => {
            auditSessionId.current = shared.id;
            sessionStarted.current = shared.createdAt;
            await before();
          }),
        logout: (before) => clientRuntime.current.sessionControl.logout(before),
        activity: () => clientRuntime.current.sessionControl.activity(),
        commit: (after, before, intent) =>
          commitAuthentication(after, before, intent),
      },
    }),
  );
  useEffect(() => {
    try {
      assertMockMode(clientConfig(import.meta.env));
    } catch (error) {
      setFatal(errorText(error));
      return;
    }
    if (new URL(location.href).searchParams.has("token")) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete("token");
      history.replaceState(null, "", cleanUrl);
    }
    load()
      .then(setState)
      .catch((error) =>
        setFatal(
          `No se pudieron cargar los datos del navegador. ${errorText(error)}`,
        ),
      );
    const listener = () => setPage(route());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page, session]);
  function auditContext(): AuditContext {
    return {
      actorId: sessionIdentity.current,
      sessionId: sessionIdentity.current ? auditSessionId.current : null,
      userAgent: navigator.userAgent,
    };
  }
  async function commitAuthentication(
    next: State,
    expected = stateRef.current,
    intent?: AuditIntent,
    auditOnly = false,
  ) {
    return browserLock("data", async () => {
      // Paso 1: rechazar escrituras calculadas sobre una versión desactualizada.
      const stored = localStorage.getItem("fcea-datasys.frontend.v1");
      if (auditOnly && stored) {
        expected = JSON.parse(stored) as State;
        next = expected;
      }
      if (
        stored &&
        JSON.stringify(JSON.parse(stored)) !== JSON.stringify(expected)
      ) {
        const latest = JSON.parse(stored) as State;
        stateRef.current = latest;
        setState(latest);
        throw problem(
          412,
          "RESOURCE_VERSION_CONFLICT",
          "Los datos cambiaron en otra operación o pestaña. Se conservaron tus datos ingresados; revisá los valores actuales.",
        );
      }
      // Paso 2: guardar de forma indivisible el estado local completo.
      if (!expected) throw Error("Los datos todavía no están disponibles.");
      const context = auditContext();
      if (
        intent?.module === "Sesiones" &&
        intent.operation === "Iniciar sesión" &&
        intent.status === "EXITO"
      ) {
        context.sessionId = auditSessionId.current;
      }
      let audited: State;
      try {
        audited = auditMutation(expected, next, context, intent);
        save(audited);
      } catch {
        throw problem(
          503,
          "AUDIT_UNAVAILABLE",
          "No se pudieron guardar los datos junto con su auditoría. La operación se canceló.",
        );
      }
      // Paso 3: actualizar la pantalla únicamente después de persistir.
      stateRef.current = audited;
      setState(audited);
    });
  }
  function recordAudit(intent: AuditIntent) {
    const latest = stateRef.current;
    if (!latest) return;
    return commitAuthentication(latest, latest, intent, true);
  }
  useEffect(
    () =>
      observeAudit((intent) => {
        void Promise.resolve(recordAudit(intent)).catch((caught) => {
          setFatal(`No se pudo registrar la auditoría. ${errorText(caught)}`);
        });
      }),
    [],
  );
  const previousLock = useRef(false);
  useEffect(() => {
    if (!state) return;
    if (state && session && locked && !previousLock.current) {
      void Promise.resolve(
        recordAudit({
          module: "Sesiones",
          operation: "Bloquear por inactividad",
          status: "EXITO",
          detail: "La sesión alcanzó el plazo de diez minutos sin actividad.",
        }),
      ).catch((caught) => setFatal(errorText(caught)));
    }
    previousLock.current = locked;
  }, [locked, state, session]);
  const deniedPage = useRef("");
  useEffect(() => {
    const currentUser = stateRef.current?.users.find(
      (account) => account.id === session && account.active,
    );
    const key = `${session}:${page}`;
    if (
      currentUser &&
      !locked &&
      !canOpenPage(currentUser.role, page) &&
      deniedPage.current !== key
    ) {
      deniedPage.current = key;
      void Promise.resolve(
        recordAudit({
          module: "Seguridad",
          operation: "Acceso denegado",
          status: "FALLIDO",
          resourceName: page,
          detail: "La cuenta no tiene permiso para abrir esta página.",
        }),
      ).catch((caught) => setFatal(errorText(caught)));
    } else if (currentUser && canOpenPage(currentUser.role, page))
      deniedPage.current = "";
  }, [session, page, locked]);
  useEffect(() => {
    function synchronize(event: StorageEvent) {
      if (event.key === "fcea-datasys.frontend.v1") {
        load()
          .then(setState)
          .catch((error) => setFatal(errorText(error)));
      }
    }
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, []);
  const userRecord = state?.users.find(
    (account) => account.id === session && account.active,
  );
  const user = userRecord ? userDto(userRecord) : undefined;
  const view = useMemo(
    () => (state && userRecord ? viewStateOf(state, userRecord.id) : undefined),
    [state, userRecord?.id],
  );
  useEffect(() => {
    if (state && session && !user) {
      void sessionControl.logout().catch((error) => setFatal(errorText(error)));
    }
  }, [state, session, user]);
  const navigate = (targetId: string) => {
    location.hash = targetId;
    setMobile(false);
  };
  const logout = () => {
    return client.auth
      .logout()
      .then(() => {
        location.hash = "login";
        setToast("Sesión cerrada.");
      })
      .catch((caught) => {
        setFatal(
          `No se pudo registrar el cierre de sesión. ${errorText(caught)}`,
        );
      });
  };
  if (fatal) {
    return (
      <div className="loading">
        <CircleHelp />
        <h1>No pudimos abrir la demostración</h1>
        <p>{fatal}</p>
        <button className="primary" onClick={() => location.reload()}>
          Volver a intentar
        </button>
      </div>
    );
  }
  if (!state) {
    return (
      <div className="loading">
        <Brand />
        <p>Preparando tu espacio de trabajo…</p>
      </div>
    );
  }
  if (!user || locked || recoveryLink !== null) {
    return (
      <DataProvider client={client}>
        <Auth
          initialToken={recoveryLink ?? undefined}
          onResetComplete={() => {
            setRecoveryLink(null);
            if (user && !locked) navigate("dashboard");
          }}
          lockedUsername={locked ? user?.username : undefined}
          onExit={logout}
          onLogin={() => {
            setToast("");
            if (!locked) {
              navigate("dashboard");
            }
          }}
        />
        {toast && (
          <div className="toast" role="status">
            <Check size={18} />
            {toast}
          </div>
        )}
      </DataProvider>
    );
  }
  const current = allItems.find((item) => item.id === page);
  const permitted = canOpenPage(user.role, page);
  const title = (() => {
    if (page === "perfil") {
      return "Mi perfil";
    }
    if (page === "password") {
      return "Cambiar contraseña";
    }
    return current?.label || "Inicio";
  })();
  function renderPage() {
    if (!permitted) {
      return (
        <section className="empty-module">
          <ShieldCheck size={39} />
          <h1>Acceso restringido</h1>
          <p>La página no existe o tu rol no tiene permiso para abrirla.</p>
          <a className="secondary" href="#dashboard">
            Volver al inicio
          </a>
        </section>
      );
    }
    if (page === "publicaciones" || page === "busqueda") {
      return (
        <BibliographicPage
          key={page}
          state={view!}
          user={user!}
          advanced={page === "busqueda"}
          navigate={navigate}
          assertActive={sessionControl.assertActive}
        />
      );
    }
    if (isCatalogKey(page)) {
      return (
        <CatalogPage
          key={page}
          catalog={page}
          state={view!}
          user={user!}
          notify={setToast}
        />
      );
    }
    if (page === "roles") {
      return <RolesPage />;
    }
    if (page === "auditoria") {
      return (
        <AuditPage
          state={view!}
          user={user!}
          assertActive={sessionControl.assertActive}
          recordAudit={recordAudit}
        />
      );
    }
    if (page === "parametros") {
      return <SettingsPage state={view!} user={user!} notify={setToast} />;
    }
    if (page === "gestion-publicaciones") {
      return (
        <PublicationsPage
          initialAttachmentId={registrationAttachmentId}
          consumeInitialAttachment={() => setRegistrationAttachmentId("")}
          state={view!}
          user={user!}
          assertActive={sessionControl.assertActive}
          notify={setToast}
          showReport={(publicationId) => {
            setReportPublicationId(publicationId);
            navigate("reportes");
          }}
        />
      );
    }
    if (page === "archivos") {
      return (
        <AttachmentPage
          state={view!}
          user={user!}
          assertActive={sessionControl.assertActive}
          register={(attachmentId) => {
            setRegistrationAttachmentId(attachmentId);
            navigate("gestion-publicaciones");
          }}
        />
      );
    }
    if (page === "reportes") {
      return (
        <PublicationReportsPage
          recordAudit={recordAudit}
          state={view!}
          user={user!}
          initialId={reportPublicationId}
          assertActive={sessionControl.assertActive}
        />
      );
    }
    if (page === "usuarios") {
      return <UsersPage state={view!} user={user!} notify={setToast} />;
    }
    if (page === "perfil") {
      return <Profile state={view!} user={user!} notify={setToast} />;
    }
    if (page === "password") {
      return (
        <ChangePassword
          state={view!}
          user={user!}
          onDone={() => {
            navigate("perfil");
            setToast("Contraseña actualizada. Tu sesión sigue activa.");
          }}
        />
      );
    }
    if (current && !current.ready) {
      return <Placeholder title={current.label} />;
    }
    return (
      <Dashboard
        state={view!}
        user={user!}
        navigate={navigate}
        notify={setToast}
      />
    );
  }
  return (
    <DataProvider client={client}>
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
                        href={`#${item.id}`}
                        onClick={() => setMobile(false)}
                        className={`nav-item ${page === item.id ? "selected" : ""}`}
                        aria-current={page === item.id ? "page" : undefined}
                      >
                        <item.icon size={18} />
                        <span>{item.label}</span>
                        {!item.ready && (
                          <span
                            className="pending-dot"
                            title="En construcción"
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
                onClick={() => setMobile(false)}
              >
                <UserRound size={18} />
                Mi perfil
              </a>
              <a
                href="#password"
                className={`nav-item ${page === "password" ? "selected" : ""}`}
                onClick={() => setMobile(false)}
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
              <strong>{title}</strong>
            </div>
            <div className="topbar-right">
              <span className="demo-chip">Demostración local</span>
              <AccountMenu user={user} navigate={navigate} logout={logout} />
            </div>
          </header>
          <main id="main" className="main-content" key={page}>
            {renderPage()}
          </main>
          <footer className="workspace-footer">
            <span>FCEA · Universidad Nacional de Concepción</span>
            <span>Repositorio de investigaciones · Demostración local</span>
          </footer>
        </div>
        {confirmationControl.confirmation}
        {toast && (
          <div className="toast" role="status">
            <Check size={18} />
            {toast}
          </div>
        )}
      </div>
    </DataProvider>
  );
}
function Dashboard({
  state,
  user,
  navigate,
  notify,
}: {
  state: ViewState;
  user: User;
  navigate: (targetId: string) => void;
  notify: (message: string) => void;
}) {
  const cards = [
    ...(user.role !== "PUBLICO"
      ? [
          {
            id: "gestion-publicaciones",
            label: "Registrar investigación",
            desc: "Trabajos aprobados y su información bibliográfica.",
            icon: FileText,
            pending: false,
          },
        ]
      : []),
    ...(user.role !== "PUBLICO"
      ? [
          {
            id: "autores",
            label: "Autores",
            desc: "Directorio de autores de trabajos académicos.",
            icon: Users,
            pending: false,
          },
          {
            id: "tutores",
            label: "Tutores y orientadores",
            desc: "Directorio de orientación académica.",
            icon: GraduationCap,
            pending: false,
          },
        ]
      : []),
    {
      id: "publicaciones",
      label: "Catálogo bibliográfico",
      desc: "Consulta de la producción académica.",
      icon: BookOpen,
      pending: false,
    },
    ...(user.role === "ADMINISTRADOR"
      ? [
          {
            id: "usuarios",
            label: "Gestión de usuarios",
            desc: "Cuentas, roles y acceso institucional.",
            icon: Users,
            pending: false,
          },
        ]
      : []),
    {
      id: "perfil",
      label: "Mi perfil",
      desc: "Tu información y cuenta personal.",
      icon: UserRound,
      pending: false,
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tu espacio de trabajo</p>
          <h1>Bienvenido, {user.name.split(" ")[0]}</h1>
          <p>Organizá tu trabajo desde el repositorio institucional.</p>
        </div>
        <span className="date-pill">
          {new Intl.DateTimeFormat("es-PY", {
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date())}
        </span>
      </div>
      <section className="welcome-banner">
        <div>
          <span className="banner-label">FCEA · UNC</span>
          <h2>
            Preservamos conocimiento.
            <br />
            Conectamos nuestra comunidad.
          </h2>
          <p>
            Accedé a las herramientas disponibles para tu rol de{" "}
            {roleLabel[user.role].toLowerCase()}.
          </p>
          <button
            className="banner-button"
            onClick={() =>
              navigate(user.role === "ADMINISTRADOR" ? "usuarios" : "perfil")
            }
          >
            {user.role === "ADMINISTRADOR"
              ? "Administrar usuarios"
              : "Ver mi perfil"}
            <ArrowRight size={17} />
          </button>
        </div>
        <div className="banner-art" aria-hidden="true">
          <BookOpen size={100} strokeWidth={0.8} />
          <span className="orbit one" />
          <span className="orbit two" />
          <span className="art-small">
            <GraduationCap size={30} />
          </span>
        </div>
      </section>
      <div className="stats-grid">
        <div className="stat">
          <span className="stat-icon">
            <Users />
          </span>
          <div>
            <p>
              {user.role === "ADMINISTRADOR"
                ? "Usuarios registrados"
                : "Mi cuenta"}
            </p>
            <strong>
              {user.role === "ADMINISTRADOR"
                ? state.users.length.toString().padStart(2, "0")
                : "Activa"}
            </strong>
            <small>
              {user.role === "ADMINISTRADOR"
                ? `${state.users.filter((account) => account.active).length} cuentas activas`
                : roleLabel[user.role]}
            </small>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon blue">
            <ShieldCheck />
          </span>
          <div>
            <p>Rol de acceso</p>
            <strong className="stat-word">{roleLabel[user.role]}</strong>
            <small>Opciones según tus permisos</small>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon lilac">
            <Building2 />
          </span>
          <div>
            <p>Institución</p>
            <strong className="stat-word">FCEA · UNC</strong>
            <small>Universidad Nacional de Concepción</small>
          </div>
        </div>
      </div>
      <DemoDataPanel user={user} notify={notify} />
      <div className="section-heading">
        <h2>Accesos rápidos</h2>
        <span>Herramientas de tu cuenta</span>
      </div>
      <div className="quick-grid">
        {cards.map((card) => (
          <button
            className="quick-card"
            key={card.id}
            onClick={() => navigate(card.id)}
          >
            <span className="quick-icon">
              <card.icon size={23} />
            </span>
            {card.pending && (
              <span className="badge neutral">En construcción</span>
            )}
            <h3>{card.label}</h3>
            <p>{card.desc}</p>
            <span className="quick-link">
              Abrir sección
              <ArrowRight size={16} />
            </span>
          </button>
        ))}
      </div>
      <div className="delivery-note">
        <CircleHelp size={21} />
        <div>
          <strong>Tu repositorio, organizado</strong>
          <p>
            Mantené actualizados los autores, tutores y catálogos de tu
            institución desde las opciones disponibles para tu cuenta.
          </p>
        </div>
      </div>
    </>
  );
}
function Placeholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Repositorio institucional</p>
          <h1>{title}</h1>
          <p>Esta sección forma parte del menú del sistema.</p>
        </div>
        <span className="badge neutral">En construcción</span>
      </div>
      <section className="empty-module">
        <span className="empty-icon">
          <Construction size={39} />
        </span>
        <span className="badge neutral">Próxima entrega</span>
        <h2>
          {description
            ? "Acceso no disponible"
            : "Estamos preparando esta sección"}
        </h2>
        <p>
          {description ||
            "Este módulo está fuera del alcance de la primera entrega. Podés gestionar los catálogos habilitados para tu rol, actualizar tu perfil y recorrer el menú."}
        </p>
        <a className="secondary" href="#dashboard">
          <ArrowLeft size={17} />
          Volver al inicio
        </a>
      </section>
    </>
  );
}
