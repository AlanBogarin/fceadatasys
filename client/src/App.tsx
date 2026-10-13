import { Brand, errorText, initials } from "./ui";
import { UsersPage, Profile, ChangePassword } from "./UserPages";
import { Auth } from "./AuthPage";
import { useSession } from "./useSession";
import { canOpenPage, INACTIVITY_MINUTES } from "./security";
import {
  createUser,
  editUser,
  loadUserForEdit,
  deleteUser,
  editProfile,
  loginUser,
  updatePersonalPassword,
  updateManagedPassword,
  recoverPassword,
  requireResult,
} from "./userService";
import CatalogPage, { RolesPage } from "./CatalogPage";
import { isCatalogKey, canManageCatalog } from "./catalogs";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Trash2,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileText,
  FolderOpen,
  GraduationCap,
  LayoutDashboard,
  ListFilter,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  UserRound,
  Users,
  X,
  Eye,
  EyeOff,
  Clock3,
  Construction,
  LibraryBig,
  type LucideIcon,
} from "lucide-react";
import {
  authenticate,
  changeOwnPassword,
  changeUserPassword,
  DEMO_PASSWORD,
  digest,
  guardAdmin,
  hashPassword,
  makeUser,
  passwordError,
  randomToken,
  resetPassword,
  roleLabel,
  ROLES,
  updateUser,
  validateUser,
  type Role,
  type State,
  type User,
  type UserInput,
} from "./model";
import { load, save, SESSION_KEY } from "./storage";
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
      { id: "publicaciones", label: "Catálogo bibliográfico", icon: BookOpen },
      { id: "busqueda", label: "Búsqueda avanzada", icon: Search },
    ],
  },
  {
    label: "Gestión bibliográfica",
    items: [
      {
        id: "gestion-publicaciones",
        label: "Publicaciones",
        icon: FileText,
        roles: editors,
      },
      {
        id: "archivos",
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
        label: "Parámetros generales",
        icon: SlidersHorizontal,
        roles: admins,
      },
      {
        id: "reportes",
        label: "Reportes estadísticos",
        icon: FileText,
        roles: admins,
      },
      { id: "auditoria", label: "Auditoría", icon: Clock3, roles: admins },
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
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
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
  function commitAuthentication(next: State) {
    // Paso 1: rechazar escrituras calculadas sobre una versión desactualizada.
    const stored = localStorage.getItem("fcea-datasys.frontend.v1");
    if (
      stored &&
      JSON.stringify(JSON.parse(stored)) !== JSON.stringify(state)
    ) {
      const latest = JSON.parse(stored) as State;
      stateRef.current = latest;
      setState(latest);
      throw Error(
        "Los datos cambiaron en otra operación o pestaña. Volvé a abrir el formulario.",
      );
    }
    // Paso 2: guardar de forma indivisible el estado local completo.
    save(next);
    // Paso 3: actualizar la pantalla únicamente después de persistir.
    stateRef.current = next;
    setState(next);
  }
  function commit(next: State) {
    sessionControl.assertActive();
    commitAuthentication(next);
  }
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
  const user = state?.users.find(
    (account) => account.id === session && account.active,
  );
  useEffect(() => {
    if (state && session && !user) {
      sessionControl.logout();
    }
  }, [state, session, user]);
  const navigate = (targetId: string) => {
    location.hash = targetId;
    setMobile(false);
  };
  const logout = () => {
    sessionControl.logout();
    location.hash = "login";
    setToast("Sesión cerrada.");
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
  if (!user || locked) {
    return (
      <>
        <Auth
          state={state}
          commit={commitAuthentication}
          lockedUsername={locked ? user?.username : undefined}
          onExit={logout}
          onLogin={(targetId) => {
            sessionControl.login(targetId);
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
      </>
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
    if (isCatalogKey(page)) {
      return (
        <CatalogPage
          key={page}
          catalog={page}
          state={state!}
          user={user!}
          commit={commit}
          notify={setToast}
        />
      );
    }
    if (page === "roles") {
      return <RolesPage />;
    }
    if (page === "usuarios") {
      return (
        <UsersPage
          state={state!}
          user={user!}
          commit={commit}
          notify={setToast}
        />
      );
    }
    if (page === "perfil") {
      return (
        <Profile
          state={state!}
          user={user!}
          commit={commit}
          notify={setToast}
        />
      );
    }
    if (page === "password") {
      return (
        <ChangePassword
          state={state!}
          user={user!}
          commit={commit}
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
    return <Dashboard state={state!} user={user!} navigate={navigate} />;
  }
  return (
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
                        <span className="pending-dot" title="En construcción" />
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
          <span>Usuarios y seguridad · Demostración local</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function Dashboard({
  state,
  user,
  navigate,
}: {
  state: State;
  user: User;
  navigate: (targetId: string) => void;
}) {
  const cards = [
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
      pending: true,
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
