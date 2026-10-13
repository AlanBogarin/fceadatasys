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
import { useState, type FormEvent } from "react";
import {
  guardAdmin,
  roleLabel,
  ROLES,
  type Role,
  type State,
  type User,
  type UserInput,
} from "./model";
import { Alert, errorText, Field, initials, Modal, Password } from "./ui";
import {
  createUser,
  deleteUser,
  editProfile,
  editUser,
  loadUserForEdit,
  requireResult,
  updateManagedPassword,
  updatePersonalPassword,
} from "./userService";
export function UsersPage({
  state,
  user,
  commit,
  notify,
}: {
  state: State;
  user: User;
  commit: (value: State) => void;
  notify: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [editing, setEditing] = useState<User | "new" | null>(null);
  const [detail, setDetail] = useState<User | null>(null);
  const [toggle, setToggle] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const filtered = state.users.filter(
    (account) =>
      (!query ||
        `${account.name} ${account.username} ${account.email} ${account.ci}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!role || account.role === role) &&
      (!status || (status === "active") === account.active),
  );
  const maxPage = Math.max(1, Math.ceil(filtered.length / 6));
  const actualPage = Math.min(page, maxPage);
  const rows = filtered.slice((actualPage - 1) * 6, actualPage * 6);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración / Usuarios</p>
          <h1>Mantenimiento de usuarios</h1>
          <p>Administrá las cuentas y los permisos de acceso al sistema.</p>
        </div>
        <button className="primary" onClick={() => setEditing("new")}>
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
            <strong>{state.users.length.toString().padStart(2, "0")}</strong>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon green">
            <Check />
          </span>
          <div>
            <p>Cuentas activas</p>
            <strong>
              {state.users
                .filter((account) => account.active)
                .length.toString()
                .padStart(2, "0")}
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
              {state.users
                .filter(
                  (account) =>
                    account.active && account.role === "ADMINISTRADOR",
                )
                .length.toString()
                .padStart(2, "0")}
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
          <span className="badge blue">{state.users.length} usuarios</span>
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
                        onClick={() => setDetail(account)}
                      >
                        <Eye size={17} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Editar ${account.username}`}
                        onClick={() => {
                          try {
                            setEditing(
                              requireResult(
                                loadUserForEdit(state, user.id, account.id),
                              ),
                            );
                          } catch (error) {
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
                        disabled={account.id === user.id}
                        onClick={() => {
                          setError("");
                          setToggle(account);
                        }}
                      >
                        <Settings2 size={17} />
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Eliminar ${account.username}`}
                        disabled={account.id === user.id}
                        onClick={() => {
                          setError("");
                          setDeleting(account);
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
          {!rows.length && (
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
              ? `Mostrando ${(actualPage - 1) * 6 + 1}–${Math.min(actualPage * 6, filtered.length)} de ${filtered.length} usuarios`
              : "0 usuarios"}
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
              onClick={() => {
                try {
                  const result = deleteUser(state, user.id, deleting.id);
                  commit(requireResult(result));
                  notify(result.mensaje);
                  setDeleting(null);
                  setError("");
                } catch (error) {
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
          commit={commit}
          notify={notify}
          close={() => setPasswordUser(null)}
        />
      )}
      {editing && (
        <UserForm
          state={state}
          actor={user}
          editing={editing}
          commit={commit}
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
              onClick={() => {
                try {
                  commit(
                    requireResult(
                      editUser(state, user.id, toggle.id, {
                        ...toggle,
                        active: !toggle.active,
                      }),
                    ),
                  );
                  notify(
                    toggle.active ? "Usuario inactivado." : "Usuario activado.",
                  );
                  setToggle(null);
                } catch (error) {
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
  commit,
  close,
  notify,
}: {
  state: State;
  actor: User;
  target: User;
  commit: (value: State) => void;
  close: () => void;
  notify: (value: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer los datos de entrada e impedir envíos duplicados.
    if (busy) return;
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const password = String(data.get("newPassword"));
      if (password !== data.get("confirm")) {
        throw Error("Las contraseñas nuevas no coinciden.");
      }
      commit(
        requireResult(
          await updateManagedPassword(state, actor.id, target.id, password),
        ),
      );
      notify(`Contraseña de ${target.username} actualizada.`);
      close();
    } catch (error) {
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
  commit,
  close,
  notify,
}: {
  state: State;
  actor: User;
  editing: User | "new";
  commit: (value: State) => void;
  close: () => void;
  notify: (value: string) => void;
}) {
  const person = editing === "new" ? null : editing;
  const [selectedRole, setSelectedRole] = useState<Role>(
    person?.role || "PUBLICO",
  );
  const nameReadOnly = Boolean(
    person && (person.role === "PUBLICO" || selectedRole === "PUBLICO"),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer solamente los campos editables del perfil.
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      guardAdmin(state, actor.id);
      const input: UserInput = {
        name: String(data.get("name")),
        ci: String(data.get("ci")),
        email: String(data.get("email")),
        username: String(data.get("username")),
        role: String(data.get("role")) as Role,
        active: data.get("active") === "true",
      };
      // Paso 2: comprobar que la precarga no quedó desactualizada.
      if (
        person &&
        JSON.stringify(
          state.users.find((account) => account.id === person.id),
        ) !== JSON.stringify(person)
      ) {
        throw Error(
          "La cuenta cambió desde que abriste el formulario. Cerralo y volvé a editar.",
        );
      }
      // Paso 3: aplicar reglas y persistir antes de informar éxito.
      if (person) {
        commit(requireResult(editUser(state, actor.id, person.id, input)));
      } else {
        const password = String(data.get("password"));
        if (password !== data.get("confirm")) {
          throw Error("Las contraseñas no coinciden.");
        }
        commit(
          requireResult(await createUser(state, actor.id, input, password)),
        );
      }
      notify(
        person
          ? "Usuario actualizado."
          : "Usuario creado. Ya puede iniciar sesión.",
      );
      close();
    } catch (error) {
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
  commit,
  notify,
}: {
  state: State;
  user: User;
  commit: (value: State) => void;
  notify: (value: string) => void;
}) {
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer solamente los campos editables del perfil.
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      commit(
        requireResult(
          editProfile(state, user.id, {
            name: String(data.get("name")),
            email: String(data.get("email")),
            username: String(data.get("username")),
          }),
        ),
      );
      notify("Tu perfil fue actualizado.");
    } catch (error) {
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
                    user.role === "PUBLICO"
                      ? "Solo lectura para el rol Público."
                      : undefined
                  }
                >
                  <input
                    readOnly={user.role === "PUBLICO"}
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
  commit,
  onDone,
}: {
  state: State;
  user: User;
  commit: (value: State) => void;
  onDone: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    // Paso 1: leer solamente los campos editables del perfil.
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const password = String(data.get("newPassword"));
      if (password !== data.get("confirm")) {
        throw Error("Las contraseñas nuevas no coinciden.");
      }
      commit(
        requireResult(
          await updatePersonalPassword(
            state,
            user.id,
            String(data.get("current")),
            password,
          ),
        ),
      );
      onDone();
    } catch (error) {
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
