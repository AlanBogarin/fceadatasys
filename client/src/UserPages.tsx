import { hasPermission } from "./permissions";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  ListFilter,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { auditFailure } from "./auditSignals";
import { useDataClient } from "./data/context";
import { userDto, type UserDto as User } from "./data/contracts";
import { useQuery } from "./data/useQuery";
import { useActionVersion } from "./data/useActionVersion";
import { useVersionedDraft, VersionReview } from "./data/useVersionedDraft";
import type { ViewState as State } from "./data/view";
import {
  guardAdmin,
  roleLabel,
  ROLES,
  type Role,
  type UserInput,
} from "./model";
import {
  Alert,
  applyFieldProblems,
  errorText,
  Field,
  initials,
  Modal,
  Password,
} from "./ui";
type VersionedUser = User & { etag?: string };
const userInput = (user: User): UserInput => ({
  name: user.name,
  ci: user.ci,
  email: user.email,
  username: user.username,
  role: user.role,
  active: user.active,
});
export function UsersPage({
  state,
  user,
  notify,
}: {
  state?: State;
  user: User;
  notify: (text: string) => void;
}) {
  const client = useDataClient();
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<VersionedUser | null>(null);
  const [editing, setEditing] = useState<VersionedUser | "new" | null>(null);
  const [detail, setDetail] = useState<User | null>(null);
  const [toggle, setToggle] = useState<VersionedUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const actionVersion = useActionVersion<User>(
    `${toggle?.id ?? ""}:${deleting?.id ?? ""}`,
  );
  const request = useQuery(
    (signal) =>
      client.users.list(
        {
          search: query,
          role,
          active: status ? String(status === "active") : "",
          page,
          pageSize: 6,
        },
        signal,
      ),
    [state, query, role, status, page],
  );
  const filtered = request.data?.data ?? [];
  const total = request.data?.pagination.total ?? 0;
  const maxPage = Math.max(1, request.data?.pagination.totalPages ?? 1);
  useEffect(() => {
    if (request.data && page > maxPage) setPage(maxPage);
  }, [request.data, page, maxPage]);
  const actualPage = Math.min(page, maxPage);
  const rows = filtered;
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración / Usuarios</p>
          <h1>Mantenimiento de usuarios</h1>
          <p>Administrá las cuentas y los permisos de acceso al sistema.</p>
        </div>
        <button
          className="primary"
          disabled={!hasPermission(user, "users.manage")}
          onClick={() => setEditing("new")}
        >
          <Plus size={18} />
          Nuevo usuario
        </button>
      </div>
      <div className="stats-grid compact">
        <div className="stat">
          <span className="stat-icon">
            <Users />
          </span>
          <div>
            <p>Total de usuarios</p>
            <strong>
              {request.data
                ? String(request.data.summary.total).padStart(2, "0")
                : "—"}
            </strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon green">
            <Check />
          </span>
          <div>
            <p>Cuentas activas</p>
            <strong>
              {request.data
                ? String(request.data.summary.active).padStart(2, "0")
                : "—"}
            </strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon lilac">
            <ShieldCheck />
          </span>
          <div>
            <p>Administradores activos</p>
            <strong>
              {request.data
                ? String(request.data.summary.administrators).padStart(2, "0")
                : "—"}
            </strong>
          </div>
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Directorio de usuarios</h2>
            <p>Consultá y mantené las cuentas institucionales.</p>
          </div>
          <span className="badge blue">
            {request.data?.summary.total ?? "—"} usuarios
          </span>
        </div>
        <div className="filter-bar">
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Buscar usuarios"
              placeholder="Buscar por nombre, usuario, correo o CI…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            aria-label="Filtrar por rol"
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos los roles</option>
            {ROLES.map((entry) => (
              <option key={entry} value={entry}>
                {roleLabel[entry]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por estado"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos los estados</option>
            <option value="active">Activo</option>
            <option value="inactive">Inactivo</option>
          </select>
          <button
            className="icon-btn filter-clear"
            aria-label="Limpiar filtros"
            onClick={() => {
              setQuery("");
              setRole("");
              setStatus("");
              setPage(1);
            }}
          >
            <ListFilter size={19} />
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Documento / Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th className="actions-th">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((account) => (
                <tr key={account.id}>
                  <td>
                    <div className="user-cell">
                      <span
                        className={`avatar ${(() => {
                          if (account.role === "DIGITADOR") {
                            return "purple";
                          }
                          if (account.role === "PUBLICO") {
                            return "teal";
                          }
                          return "";
                        })()}`}
                      >
                        {initials(account.name)}
                      </span>
                      <div>
                        <strong>
                          {account.name}
                          {account.id === user.id && (
                            <span className="you-label">Vos</span>
                          )}
                        </strong>
                        <small>@{account.username}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="cell-stack">
                      <span>{account.ci}</span>
                      <small>{account.email}</small>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${(() => {
                        if (account.role === "ADMINISTRADOR") {
                          return "blue";
                        }
                        if (account.role === "DIGITADOR") {
                          return "purple";
                        }
                        return "neutral";
                      })()}`}
                    >
                      {roleLabel[account.role]}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status ${account.active ? "active" : ""}`}
                    >
                      <i />
                      {account.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-btn"
                        aria-label={`Ver ${account.username}`}
                        onClick={() => {
                          void client.users
                            .get(account.id)
                            .then((result) => setDetail(result.data))
                            .catch((error) => setError(errorText(error)));
                        }}
                      >
                        <Eye size={17} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Editar ${account.username}`}
                        disabled={!hasPermission(user, "users.manage")}
                        onClick={async () => {
                          try {
                            const result = await client.users.get(account.id);
                            setEditing({ ...result.data, etag: result.etag });
                          } catch (error) {
                            auditFailure(
                              "Usuarios",
                              "Operación rechazada",
                              error,
                            );
                            setError(errorText(error));
                          }
                        }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        className="icon-btn"
                        title="Cambiar contraseña"
                        aria-label={`Cambiar contraseña de ${account.username}`}
                        disabled={
                          account.id !== user.id &&
                          !hasPermission(user, "users.password")
                        }
                        onClick={() => {
                          if (account.id === user.id) {
                            location.hash = "password";
                          } else {
                            setPasswordUser(account);
                          }
                        }}
                      >
                        <LockKeyhole size={17} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`${account.active ? "Inactivar" : "Activar"} ${account.username}`}
                        disabled={
                          account.id === user.id ||
                          !hasPermission(user, "users.manage")
                        }
                        onClick={async () => {
                          setError("");
                          try {
                            const result = await client.users.get(account.id);
                            setToggle({ ...result.data, etag: result.etag });
                          } catch (error) {
                            setError(errorText(error));
                          }
                        }}
                      >
                        <Settings2 size={17} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Eliminar ${account.username}`}
                        disabled={
                          account.id === user.id ||
                          !hasPermission(user, "users.delete")
                        }
                        onClick={async () => {
                          setError("");
                          try {
                            const result = await client.users.get(account.id);
                            setDeleting({ ...result.data, etag: result.etag });
                          } catch (error) {
                            setError(errorText(error));
                          }
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {request.loading && <p role="status">Consultando usuarios…</p>}
          <Alert text={request.error ? errorText(request.error) : ""} />
          {!request.loading && !request.error && !rows.length && (
            <div className="no-results">
              <Search size={28} />
              <h3>No se encontraron usuarios</h3>
              <p>Probá con otra búsqueda o limpiá los filtros.</p>
            </div>
          )}
        </div>
        <div className="table-footer">
          <span>
            {filtered.length
              ? `Mostrando ${(actualPage - 1) * 6 + 1}–${Math.min(actualPage * 6, total)} de ${total} usuarios`
              : request.data
                ? "0 usuarios"
                : request.loading
                  ? "Consultando…"
                  : "Sin datos disponibles"}
          </span>
          <div className="pagination">
            <button
              className="icon-btn"
              aria-label="Página anterior"
              disabled={actualPage === 1}
              onClick={() => setPage(actualPage - 1)}
            >
              <ChevronLeft size={18} />
            </button>
            <span>
              {actualPage} / {maxPage}
            </span>
            <button
              className="icon-btn"
              aria-label="Página siguiente"
              disabled={actualPage === maxPage}
              onClick={() => setPage(actualPage + 1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </section>
      <div className="inline-note">
        <ShieldCheck size={18} />
        <p>
          Solo el administrador puede mantener usuarios. Las cuentas inactivas
          conservan sus datos y no pueden iniciar sesión.
        </p>
      </div>
      <Alert text={error} />
      {deleting && (
        <Modal title="Eliminar usuario" close={() => setDeleting(null)}>
          <div className="modal-body">
            {actionVersion.review}
            <Alert text={error} />
            <p>
              ¿Querés eliminar la cuenta de <strong>{deleting.name}</strong>?
            </p>
            <p>
              La eliminación es definitiva y solo se permite si no tiene
              registros ni transacciones asociados. La comprobación se repetirá
              al confirmar.
            </p>
          </div>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setDeleting(null)}>
              Cancelar
            </button>
            <button
              className="primary"
              disabled={actionVersion.blocked}
              onClick={async () => {
                try {
                  await client.users.remove(deleting.id, {
                    ifMatch: deleting.etag,
                  });
                  notify("Usuario eliminado.");
                  setDeleting(null);
                  setError("");
                } catch (error) {
                  actionVersion.failed(
                    error,
                    () => client.users.get(deleting.id),
                    (result) => {
                      setDeleting({ ...result.data, etag: result.etag });
                      setError("");
                    },
                  );
                  auditFailure("Usuarios", "Operación rechazada", error);
                  setError(errorText(error));
                }
              }}
            >
              Eliminar definitivamente
            </button>
          </div>
        </Modal>
      )}
      {passwordUser && (
        <AdminPasswordForm
          state={state}
          actor={user}
          target={passwordUser}
          notify={notify}
          close={() => setPasswordUser(null)}
        />
      )}
      {editing && (
        <UserForm
          state={state}
          actor={user}
          editing={editing}
          close={() => setEditing(null)}
          notify={notify}
        />
      )}
      {detail && (
        <Modal title="Detalle del usuario" close={() => setDetail(null)}>
          <div className="detail-person">
            <span className="avatar large">{initials(detail.name)}</span>
            <h3>{detail.name}</h3>
            <span className="badge blue">{roleLabel[detail.role]}</span>
          </div>
          <dl className="details">
            {[
              ["Usuario", detail.username],
              ["CI", detail.ci],
              ["Correo", detail.email],
              ["Estado", detail.active ? "Activo" : "Inactivo"],
              [
                "Fecha de registro",
                new Date(detail.createdAt).toLocaleDateString("es-PY"),
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setDetail(null)}>
              Cerrar
            </button>
          </div>
        </Modal>
      )}
      {toggle && (
        <Modal
          title={toggle.active ? "Inactivar usuario" : "Activar usuario"}
          close={() => setToggle(null)}
        >
          <div className="modal-body">
            {actionVersion.review}
            <Alert text={error} />
            <p>
              ¿Querés {toggle.active ? "inactivar" : "activar"} la cuenta de{" "}
              <strong>{toggle.name}</strong>?
            </p>
            <p className="muted">
              {toggle.active
                ? "No podrá iniciar sesión. Su información se conservará."
                : "Podrá volver a ingresar con su contraseña actual."}
            </p>
          </div>
          <div className="modal-footer">
            <button className="secondary" onClick={() => setToggle(null)}>
              Cancelar
            </button>
            <button
              className="primary"
              disabled={actionVersion.blocked}
              onClick={async () => {
                try {
                  await client.users.update(
                    toggle.id,
                    { active: !toggle.active },
                    { ifMatch: toggle.etag },
                  );
                  notify(
                    toggle.active ? "Usuario inactivado." : "Usuario activado.",
                  );
                  setToggle(null);
                } catch (error) {
                  actionVersion.failed(
                    error,
                    () => client.users.get(toggle.id),
                    (result) => {
                      setToggle({ ...result.data, etag: result.etag });
                      setError("");
                    },
                  );
                  auditFailure("Usuarios", "Operación rechazada", error);
                  setError(errorText(error));
                }
              }}
            >
              Confirmar
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function AdminPasswordForm({
  state,
  actor,
  target,
  close,
  notify,
}: {
  state?: State;
  actor: User;
  target: User;
  close: () => void;
  notify: (value: string) => void;
}) {
  const client = useDataClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer los datos de entrada e impedir envíos duplicados.
    if (busy) return;
    event.preventDefault();
    setError("");
    setBusy(true);
    const element = event.currentTarget;
    const data = new FormData(element);
    try {
      const password = String(data.get("newPassword"));
      if (password !== data.get("confirm")) {
        throw Error("Las contraseñas nuevas no coinciden.");
      }
      await client.users.managedPassword(target.id, password);
      notify(`Contraseña de ${target.username} actualizada.`);
      close();
    } catch (error) {
      applyFieldProblems(element, error);
      auditFailure("Usuarios", "Operación rechazada", error);
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Cambiar contraseña del usuario" close={close}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <Alert text={error} />
          <div className="password-target">
            <span className="avatar">{initials(target.name)}</span>
            <div>
              <strong>{target.name}</strong>
              <small>
                @{target.username} · {roleLabel[target.role]}
              </small>
            </div>
          </div>
          <p className="muted">
            Asigná una nueva contraseña a esta cuenta. La contraseña anterior
            dejará de funcionar.
          </p>
          <Field
            label="Nueva contraseña"
            hint="Mínimo 8 caracteres, una letra y un número."
          >
            <Password
              name="newPassword"
              autoComplete="new-password"
              placeholder="Nueva contraseña del usuario"
            />
          </Field>
          <Field label="Confirmar nueva contraseña">
            <Password
              name="confirm"
              autoComplete="new-password"
              placeholder="Repetí la nueva contraseña"
            />
          </Field>
          <div className="inline-note">
            <ShieldCheck size={18} />
            <p>
              El cambio no modifica el rol ni el estado del usuario. Tu sesión
              de administrador seguirá abierta.
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={close}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Guardando…" : "Guardar nueva contraseña"}
            <Check size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function UserForm({
  state,
  actor,
  editing,
  close,
  notify,
}: {
  state?: State;
  actor: User;
  editing: VersionedUser | "new";
  close: () => void;
  notify: (value: string) => void;
}) {
  const person = editing === "new" ? null : editing;
  const client = useDataClient();
  const version = useVersionedDraft(
    person ? userDto(person) : null,
    person?.etag,
    person ? () => client.users.get(person.id) : undefined,
  );
  const currentPerson =
    version.latest?.data ??
    (person ? state?.users.find((user) => user.id === person.id) : undefined);
  const [selectedRole, setSelectedRole] = useState<Role>(
    person?.role || "PUBLICO",
  );
  const nameReadOnly = Boolean(
    person &&
    (person.role === "PUBLICO" ||
      currentPerson?.role === "PUBLICO" ||
      selectedRole === "PUBLICO"),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer solamente los campos editables del perfil.
    event.preventDefault();
    setBusy(true);
    setError("");
    const element = event.currentTarget;
    const data = new FormData(element);
    try {
      if (state) guardAdmin(state, actor.id);
      const input: UserInput = {
        name: String(data.get("name")),
        ci: String(data.get("ci")),
        email: String(data.get("email")),
        username: String(data.get("username")),
        role: selectedRole,
        active: data.get("active") === "true",
      };
      // Paso 2: comprobar que la precarga no quedó desactualizada.
      const etag = person
        ? await version.check(
            currentPerson ? userDto(currentPerson) : null,
            "USER_VERSION_CONFLICT",
          )
        : undefined;
      // Paso 3: aplicar reglas y persistir antes de informar éxito.
      if (person) {
        await client.users
          .update(person.id, input, { ifMatch: etag })
          .catch((error) => {
            version.failed(error);
            throw error;
          });
      } else {
        const password = String(data.get("password"));
        if (password !== data.get("confirm")) {
          throw Error("Las contraseñas no coinciden.");
        }
        await client.users.create(input, password);
      }
      notify(
        person
          ? "Usuario actualizado."
          : "Usuario creado. Ya puede iniciar sesión.",
      );
      close();
    } catch (error) {
      applyFieldProblems(element, error);
      auditFailure("Usuarios", "Operación rechazada", error);
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={person ? "Editar usuario" : "Nuevo usuario"} close={close}>
      <form onSubmit={submit}>
        <div className="modal-body">
          <Alert text={error} />
          <Alert text={version.reviewError} />
          {version.conflict && !version.latest && !version.reviewError && (
            <p role="status">Consultando la versión actual…</p>
          )}
          {version.conflict && version.latest && currentPerson && (
            <VersionReview
              values={{
                Nombre: currentPerson.name,
                CI: currentPerson.ci,
                Correo: currentPerson.email,
                Usuario: currentPerson.username,
                Rol: roleLabel[currentPerson.role],
                Estado: currentPerson.active ? "Activo" : "Inactivo",
              }}
              onReviewed={() => {
                version.acceptLatest();
                setError("");
              }}
            />
          )}
          <p className="muted">Los campos marcados con * son obligatorios.</p>
          <div className="form-grid">
            <Field
              label="Nombre completo *"
              hint={
                nameReadOnly
                  ? "Solo lectura: la cuenta tiene o tendrá el rol Público."
                  : undefined
              }
            >
              <input
                readOnly={nameReadOnly}
                name="name"
                required
                maxLength={100}
                defaultValue={person?.name}
                placeholder="Nombre y apellido"
              />
            </Field>
            <Field label="Cédula de identidad *">
              <input
                name="ci"
                required
                inputMode="numeric"
                maxLength={12}
                defaultValue={person?.ci}
                placeholder="Sin puntos ni espacios"
              />
            </Field>
            <Field label="Correo electrónico *">
              <input
                name="email"
                type="email"
                required
                defaultValue={person?.email}
                placeholder="nombre@institucion.edu.py"
              />
            </Field>
            <Field label="Nombre de usuario *">
              <input
                name="username"
                required
                maxLength={40}
                defaultValue={person?.username}
                autoComplete="off"
                placeholder="nombre.usuario"
              />
            </Field>
            <Field label="Rol *">
              <select
                name="role"
                disabled={!hasPermission(actor, "permissions.manage")}
                value={selectedRole}
                onChange={(event) => {
                  setSelectedRole(event.target.value as Role);
                  if (person && event.target.value === "PUBLICO") {
                    const nameInput =
                      event.currentTarget.form?.elements.namedItem(
                        "name",
                      ) as HTMLInputElement | null;
                    if (nameInput) {
                      nameInput.value = person.name;
                    }
                  }
                }}
              >
                {ROLES.map((entry) => (
                  <option key={entry} value={entry}>
                    {roleLabel[entry]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Estado *">
              <select
                name="active"
                defaultValue={person?.active === false ? "false" : "true"}
              >
                <option value="true">Activo</option>
                <option value="false">Inactivo</option>
              </select>
            </Field>
            {!person && (
              <>
                <Field
                  label="Contraseña inicial *"
                  hint="Mínimo 8 caracteres, una letra y un número."
                >
                  <Password
                    name="password"
                    autoComplete="new-password"
                    placeholder="Contraseña de la cuenta"
                  />
                </Field>
                <Field label="Confirmar contraseña *">
                  <Password
                    name="confirm"
                    autoComplete="new-password"
                    placeholder="Repetí la contraseña"
                  />
                </Field>
              </>
            )}
          </div>
          {person?.id === actor.id && (
            <p className="inline-hint">
              Tu cuenta debe conservar el rol Administrador y permanecer activa.
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="secondary" onClick={close}>
            Cancelar
          </button>
          <button className="primary" disabled={busy}>
            {(() => {
              if (busy) {
                return "Guardando…";
              }
              if (person) {
                return "Guardar cambios";
              }
              return "Crear usuario";
            })()}
            <Check size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Profile({
  state,
  user,
  notify,
}: {
  state?: State;
  user: User;
  notify: (value: string) => void;
}) {
  const client = useDataClient();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer solamente los campos editables del perfil.
    event.preventDefault();
    setError("");
    const element = event.currentTarget;
    const data = new FormData(element);
    try {
      await client.users.profile({
        name: String(data.get("name")),
        email: String(data.get("email")),
        username: String(data.get("username")),
      });
      notify("Tu perfil fue actualizado.");
    } catch (error) {
      applyFieldProblems(element, error);
      auditFailure("Usuarios", "Operación rechazada", error);
      setError(errorText(error));
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Mi cuenta</p>
          <h1>Mi perfil</h1>
          <p>Consultá y actualizá tu información personal.</p>
        </div>
      </div>
      <div className="profile-layout">
        <section className="panel profile-summary">
          <span className="avatar large">{initials(user.name)}</span>
          <h2>{user.name}</h2>
          <p>@{user.username}</p>
          <span className="badge blue">{roleLabel[user.role]}</span>
          <div className="profile-meta">
            <ShieldCheck size={18} />
            <span>Cuenta activa</span>
          </div>
          <a className="secondary full" href="#password">
            <LockKeyhole size={17} />
            Cambiar contraseña
          </a>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Información personal</h2>
              <p>Mantené tus datos de contacto actualizados.</p>
            </div>
            <UserRound size={22} />
          </div>
          <form onSubmit={submit}>
            <div className="panel-body">
              <Alert text={error} />
              <div className="form-grid">
                <Field
                  label="Nombre completo"
                  hint={
                    user.role !== "ADMINISTRADOR"
                      ? `Solo lectura para el rol ${roleLabel[user.role]}.`
                      : undefined
                  }
                >
                  <input
                    readOnly={user.role !== "ADMINISTRADOR"}
                    name="name"
                    required
                    defaultValue={user.name}
                    maxLength={100}
                  />
                </Field>
                <Field label="Correo electrónico">
                  <input
                    name="email"
                    type="email"
                    required
                    defaultValue={user.email}
                  />
                </Field>
                <Field label="Nombre de usuario">
                  <input
                    name="username"
                    required
                    defaultValue={user.username}
                    maxLength={40}
                  />
                </Field>
                <Field
                  label="Cédula de identidad"
                  hint="Solo un administrador puede cambiar este dato."
                >
                  <input value={user.ci} readOnly />
                </Field>
                <Field label="Rol asignado">
                  <input value={roleLabel[user.role]} readOnly />
                </Field>
                <Field label="Estado de la cuenta">
                  <input value="Activo" readOnly />
                </Field>
              </div>
            </div>
            <div className="modal-footer">
              <button className="primary">
                Guardar cambios
                <Check size={17} />
              </button>
            </div>
          </form>
        </section>
      </div>
    </>
  );
}

export function ChangePassword({
  state,
  user,
  onDone,
}: {
  state?: State;
  user: User;
  onDone: () => void;
}) {
  const client = useDataClient();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer solamente los campos editables del perfil.
    event.preventDefault();
    setError("");
    setBusy(true);
    const element = event.currentTarget;
    const data = new FormData(element);
    try {
      const password = String(data.get("newPassword"));
      if (password !== data.get("confirm")) {
        throw Error("Las contraseñas nuevas no coinciden.");
      }
      await client.users.password(String(data.get("current")), password);
      onDone();
    } catch (error) {
      applyFieldProblems(element, error);
      auditFailure("Usuarios", "Operación rechazada", error);
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Mi cuenta / Seguridad</p>
          <h1>Cambiar contraseña</h1>
          <p>Actualizá tu contraseña de acceso personal.</p>
        </div>
      </div>
      <section className="panel password-panel">
        <div className="panel-heading">
          <div>
            <h2>Seguridad de tu cuenta</h2>
            <p>Confirmá tu contraseña actual para continuar.</p>
          </div>
          <LockKeyhole size={23} />
        </div>
        <form onSubmit={submit}>
          <div className="panel-body">
            <Alert text={error} />
            <Field label="Contraseña actual">
              <Password name="current" />
            </Field>
            <Field
              label="Nueva contraseña"
              hint="Usá al menos 8 caracteres, una letra y un número."
            >
              <Password
                name="newPassword"
                autoComplete="new-password"
                placeholder="Nueva contraseña"
              />
            </Field>
            <Field label="Confirmar nueva contraseña">
              <Password
                name="confirm"
                autoComplete="new-password"
                placeholder="Repetí tu nueva contraseña"
              />
            </Field>
            <div className="inline-note">
              <ShieldCheck size={19} />
              <p>
                Tu sesión actual seguirá abierta. La próxima vez que ingreses,
                usá la nueva contraseña.
              </p>
            </div>
          </div>
          <div className="modal-footer">
            <a className="secondary" href="#perfil">
              Volver al perfil
            </a>
            <button className="primary" disabled={busy}>
              {busy ? "Guardando…" : "Actualizar contraseña"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
