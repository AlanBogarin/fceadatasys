import { useEffect, useState } from "react";
import { useDataClient } from "./data/context";
import { useQuery } from "./data/useQuery";
import { Alert, errorText } from "./ui";
import { ROLES, roleLabel } from "./model";
import type { Role } from "./data/contracts";

export function PermissionsPage() {
  const client = useDataClient();
  const query = useQuery((signal) => client.permissions!.get(signal), [client]);
  const [draft, setDraft] = useState(query.data?.data);
  const [etag, setEtag] = useState("");
  const [role, setRole] = useState<Role>("DIGITADOR");
  const [person, setPerson] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const users = useQuery(
    (signal) => client.permissions!.users(search, page, signal),
    [client, search, page],
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (query.data && !draft) {
      setDraft(query.data.data);
      setEtag(query.data.etag);
    }
  }, [query.data, draft]);
  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await client.permissions!.update(
        { roles: draft.roles, users: draft.users },
        { ifMatch: etag },
      );
      setDraft(result.data);
      setEtag(result.etag);
      setMessage(
        "Permisos actualizados. Se aplican también a las sesiones abiertas.",
      );
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
          <p className="eyebrow">Administración / Acceso</p>
          <h1>Roles y permisos</h1>
          <p>
            Definí las acciones de cada rol y las excepciones de una cuenta.
          </p>
        </div>
      </div>
      <Alert text={error || (query.error ? errorText(query.error) : "")} />
      <Alert text={message} success />
      {query.loading && <p role="status">Consultando permisos…</p>}
      {draft && (
        <section className="panel permission-panel">
          <div className="panel-heading">
            <label>
              Rol base
              <select
                value={role}
                disabled={busy}
                onChange={(e) => setRole(e.target.value as Role)}
              >
                {ROLES.map((value) => (
                  <option key={value} value={value}>
                    {roleLabel[value]}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(undefined);
                query.reload();
              }}
            >
              Recargar permisos guardados
            </button>
          </div>
          <p>
            La consulta del catálogo y las funciones de la cuenta están
            disponibles para todos. Administrar permisos y copias requiere el
            rol Administrador.
          </p>
          <div className="table-scroll">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Acción</th>
                  <th>{roleLabel[role]}</th>
                </tr>
              </thead>
              <tbody>
                {draft.definitions.map((item) => (
                  <tr key={item.key}>
                    <td>{item.label}</td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${item.label}: ${roleLabel[role]}`}
                        checked={draft.roles[role].includes(item.key)}
                        disabled={
                          busy ||
                          (role !== "ADMINISTRADOR" &&
                            ["permissions.manage", "backups.manage"].includes(
                              item.key,
                            ))
                        }
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            roles: {
                              ...draft.roles,
                              [role]: e.target.checked
                                ? [...draft.roles[role], item.key]
                                : draft.roles[role].filter(
                                    (key) => key !== item.key,
                                  ),
                            },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-heading">
            <div>
              <h2>Excepciones por cuenta</h2>
              <p>
                Heredar conserva lo definido en el rol; permitir o denegar solo
                afecta a esta cuenta.
              </p>
            </div>
          </div>
          <label>
            Buscar cuenta
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              setPerson('');
              }}
            />
          </label>
          <Alert text={users.error ? errorText(users.error) : ""} />
          <label>
            Cuenta
            <select value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Seleccioná una cuenta</option>
              {users.data?.data.map((user) => (
                <option value={user.id} key={user.id}>
                  {user.name} (@{user.username}) · {roleLabel[user.role]}
                </option>
              ))}
            </select>
          </label>
          <div className="publication-actions">
            <button
              className="secondary"
              disabled={page <= 1 || users.loading}
              onClick={() => {
                setPage(page - 1);
                setPerson("");
              }}
            >
              Anterior
            </button>
            <span>
              Página {page} · {users.data?.pagination.total ?? 0} cuentas
            </span>
            <button
              className="secondary"
              disabled={
                !users.data ||
                page >= users.data.pagination.totalPages ||
                users.loading
              }
              onClick={() => {
                setPage(page + 1);
                setPerson("");
              }}
            >
              Siguiente
            </button>
          </div>
          {person && (
            <div className="table-scroll">
              <table className="catalog-table">
                <thead>
                  <tr>
                    <th>Acción</th>
                    <th>Excepción</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.definitions.map((item) => (
                    <tr key={item.key}>
                      <td>{item.label}</td>
                      <td>
                        <select
                          aria-label={`${item.label}: excepción de cuenta`}
                          disabled={
                            busy ||
                            (users.data?.data.find((user) => user.id === person)
                              ?.role !== "ADMINISTRADOR" &&
                              ["permissions.manage", "backups.manage"].includes(
                                item.key,
                              ))
                          }
                          value={
                            draft.users[person]?.[item.key] === undefined
                              ? "inherit"
                              : String(draft.users[person][item.key])
                          }
                          onChange={(e) => {
                            const overrides = { ...draft.users[person] };
                            if (e.target.value === "inherit")
                              delete overrides[item.key];
                            else
                              overrides[item.key] = e.target.value === "true";
                            const next = { ...draft.users };
                            if (Object.keys(overrides).length)
                              next[person] = overrides;
                            else delete next[person];
                            setDraft({ ...draft, users: next });
                          }}
                        >
                          <option value="inherit">Heredar del rol</option>
                          <option value="true">Permitir</option>
                          <option value="false">Denegar</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="modal-footer">
            <button className="primary" disabled={busy} onClick={save}>
              {busy ? "Guardando…" : "Guardar permisos"}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
