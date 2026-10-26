import { hasPermission } from "./permissions";
import {
  ArrowRight,
  BookOpen,
  Building2,
  GraduationCap,
  ShieldCheck,
  Users,
  UserRound,
} from "lucide-react";
import { useDataClient } from "./data/context";
import type { UserDto } from "./data/contracts";
import { dashboardLinks, loadDashboard } from "./data/dashboard";
import { useQuery } from "./data/useQuery";
import { roleLabel } from "./model";
import { Alert, errorText } from "./ui";

export function ApiDashboard({
  user,
  navigate,
}: {
  user: UserDto;
  navigate: (page: string) => void;
}) {
  const client = useDataClient();
  const query = useQuery((signal) => loadDashboard(client, signal), [client]);
  const data = query.data;
  const account = data?.user ?? user;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tu espacio de trabajo</p>
          <h1>Bienvenido, {account.name.split(" ")[0]}</h1>
          <p>Organizá tu trabajo desde el repositorio institucional.</p>
        </div>
        <span className="date-pill">
          {new Intl.DateTimeFormat("es-PY", {
            timeZone: "America/Asuncion",
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
            {roleLabel[account.role].toLowerCase()}.
          </p>
          <button
            className="banner-button"
            onClick={() => navigate("publicaciones")}
          >
            Consultar el catálogo <ArrowRight size={17} />
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
      <Alert text={query.error ? errorText(query.error) : ""} />
      {query.loading && <p role="status">Consultando indicadores…</p>}
      <div className="stats-grid" aria-busy={query.loading}>
        <div className="stat">
          <span className="stat-icon">
            <Users />
          </span>
          <div>
            <p>
              {hasPermission(account, "users.read")
                ? "Usuarios registrados"
                : "Mi cuenta"}
            </p>
            <strong>
              {data
                ? (data.users?.total ??
                  (account.active ? "Activa" : "Inactiva"))
                : "—"}
            </strong>
            <small>
              {data?.users
                ? `${data.users.active} cuentas activas`
                : roleLabel[account.role]}
            </small>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon blue">
            <ShieldCheck />
          </span>
          <div>
            <p>Rol de acceso</p>
            <strong className="stat-word">{roleLabel[account.role]}</strong>
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
        <div className="stat">
          <span className="stat-icon">
            <BookOpen />
          </span>
          <div>
            <p>Publicaciones consultables</p>
            <strong>{data?.publications ?? "—"}</strong>
            <small>
              {hasPermission(account, "publications.history")
                ? "Incluye el historial inactivo"
                : "Publicaciones activas"}
            </small>
          </div>
        </div>
      </div>
      <button
        className="secondary"
        disabled={query.loading}
        onClick={query.reload}
      >
        Actualizar indicadores
      </button>
      {data?.publications === 0 && (
        <p role="status">
          Todavía no hay publicaciones disponibles para tu cuenta.
        </p>
      )}
      <div className="section-heading">
        <h2>Accesos rápidos</h2>
        <span>Herramientas de tu cuenta</span>
      </div>
      <div className="quick-grid">
        {dashboardLinks(account).map((item) => (
          <button
            className="quick-card"
            key={item.id}
            onClick={() => navigate(item.id)}
          >
            <span className="quick-icon">
              <item.icon size={23} />
            </span>
            <h3>{item.label}</h3>
            <span className="quick-link">
              Abrir sección <ArrowRight size={16} />
            </span>
          </button>
        ))}
        <button className="quick-card" onClick={() => navigate("perfil")}>
          <span className="quick-icon">
            <UserRound size={23} />
          </span>
          <h3>Mi perfil</h3>
          <p>Tu información y cuenta personal.</p>
          <span className="quick-link">
            Abrir sección <ArrowRight size={16} />
          </span>
        </button>
      </div>
    </>
  );
}
