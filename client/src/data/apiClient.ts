import type { CatalogKey } from "../catalogs";
import type { DataClient, ListQuery } from "./client";
import type {
  CatalogDto,
  MutationOptions,
  Page,
  SettingsDto,
  UserDto,
} from "./contracts";
import { ApiSession } from "./apiSession";
import { mutationHeaders, queryString } from "./http";
import { createPublicationServices } from "./apiPublications";
import { createAuditService } from "./apiAudit";

export type ConfirmationRequest = { title: string; password: boolean };
export type ConfirmMutation = (
  request: ConfirmationRequest,
) => Promise<string | undefined>;

export function createApiClient(
  session: ApiSession,
  confirm: ConfirmMutation,
): DataClient {
  const http = session.http;
  async function options(
    title: string,
    value: MutationOptions = {},
  ): Promise<MutationOptions> {
    const password =
      value.confirmationPassword ?? (await confirm({ title, password: true }));
    return { ...value, confirmationPassword: password };
  }
  async function mutate<T>(work: () => Promise<T>): Promise<T> {
    const result = await work();
    session.invalidate();
    return result;
  }
  const catalogPath = (key: CatalogKey, id?: string) => {
    return `/catalogos/${encodeURIComponent(key)}${id ? `/${encodeURIComponent(id)}` : ""}`;
  };
  const users: DataClient["users"] = {
    async list(query = {}, signal) {
      const list = (value: ListQuery & { role?: string }) =>
        http.get<Page<UserDto>>(`/usuarios${queryString(value)}`, signal);
      const [result, total, active, administrators] = await Promise.all([
        list(query),
        list({ pageSize: 1 }),
        list({ active: "true", pageSize: 1 }),
        list({ active: "true", role: "ADMINISTRADOR", pageSize: 1 }),
      ]);
      return {
        ...result,
        summary: {
          total: total.pagination.total,
          active: active.pagination.total,
          administrators: administrators.pagination.total,
        },
      };
    },
    get: (id, signal) =>
      http.versioned<UserDto>(`/usuarios/${encodeURIComponent(id)}`, {
        signal,
      }),
    me: (signal) => http.get<UserDto>("/me", signal),
    async create(input, password) {
      await confirm({
        title: `Crear la cuenta de ${input.name}`,
        password: false,
      });
      return mutate(
        async () =>
          (
            await http.request<UserDto>("/usuarios", {
              method: "POST",
              body: { ...input, password },
            })
          ).data,
      );
    },
    async update(id, input, value) {
      const headers = mutationHeaders(
        await options("Guardar los cambios del usuario", value),
      );
      return mutate(
        async () =>
          (
            await http.request<UserDto>(`/usuarios/${encodeURIComponent(id)}`, {
              method: "PATCH",
              body: input,
              headers,
            })
          ).data,
      );
    },
    async remove(id, value) {
      const headers = mutationHeaders(
        await options("Eliminar definitivamente el usuario", value),
      );
      await mutate(() =>
        http.request(`/usuarios/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers,
        }),
      );
    },
    async profile(input, value) {
      const confirmed = await options(
        "Guardar los cambios de tu perfil",
        value,
      );
      const headers = mutationHeaders({
        confirmationPassword: confirmed.confirmationPassword,
      });
      const user = (
        await http.request<UserDto>("/me", {
          method: "PATCH",
          body: input,
          headers,
        })
      ).data;
      session.updateUser(user);
      return user;
    },
    password: session.password,
    async managedPassword(id, newPassword, value) {
      const confirmed = await options(
        "Asignar una contraseña al usuario",
        value,
      );
      const headers = mutationHeaders({
        confirmationPassword: confirmed.confirmationPassword,
      });
      await mutate(() =>
        http.request(`/usuarios/${encodeURIComponent(id)}/password`, {
          method: "PATCH",
          body: { newPassword },
          headers,
        }),
      );
    },
  };
  const catalogs: DataClient["catalogs"] = {
    async list(key, query = {}, signal) {
      const path = catalogPath(key);
      const list = (value: ListQuery) =>
        http.get<Page<CatalogDto>>(`${path}${queryString(value)}`, signal);
      const [result, total, active] = await Promise.all([
        list(query),
        list({ pageSize: 1 }),
        list({ active: "true", pageSize: 1 }),
      ]);
      return {
        ...result,
        summary: {
          total: total.pagination.total,
          active: active.pagination.total,
        },
      };
    },
    get: (key, id, signal) =>
      http.versioned<CatalogDto>(catalogPath(key, id), { signal }),
    async save(key, input, id, value) {
      const path = catalogPath(key, id);
      const headers = id
        ? mutationHeaders(
            await options("Guardar los cambios del registro", value),
          )
        : {};
      if (!id) await confirm({ title: `Crear ${input.name}`, password: false });
      return mutate(() =>
        http.versioned<CatalogDto>(path, {
          method: id ? "PATCH" : "POST",
          body: input,
          headers,
        }),
      );
    },
    async active(key, id, active, value) {
      const path = catalogPath(key, id);
      const headers = mutationHeaders(
        await options(
          active ? "Activar el registro" : "Inactivar el registro",
          value,
        ),
      );
      return mutate(() =>
        http.versioned<CatalogDto>(path, {
          method: "PATCH",
          body: { active },
          headers,
        }),
      );
    },
    async remove(key, id, value) {
      const path = catalogPath(key, id);
      const headers = mutationHeaders(
        await options("Eliminar definitivamente el registro", value),
      );
      await mutate(() => http.request(path, { method: "DELETE", headers }));
    },
  };
  const client: DataClient = {
    auth: {
      initializeBrowser: session.initializeBrowser,
      session: session.session,
      login: session.login,
      refresh: session.refresh,
      activity: session.activity,
      logout: session.logout,
      async requestRecovery(email) {
        return (
          await http.request<{ message: string }>("/auth/recover-password", {
            method: "POST",
            body: { email },
            public: true,
          })
        ).data;
      },
      async resetPassword(token, newPassword) {
        await http.request("/auth/reset-password", {
          method: "POST",
          body: { token, newPassword },
          public: true,
        });
        // El token puede pertenecer a otra cuenta: releer la cookie determina si la sesión sigue vigente.
        session.clear();
        try {
          await session.restore();
        } catch {
          /* La sesión revocada regresa al acceso. */
        }
        session.invalidate();
      },
    },
    users,
    catalogs,
    settings: {
      get: (signal) =>
        http.versioned<SettingsDto>("/parametros/publicaciones", { signal }),
      async update(input, value) {
        const headers = mutationHeaders(
          await options("Guardar los parámetros generales", value),
        );
        return mutate(() =>
          http.versioned<SettingsDto>("/parametros/publicaciones", {
            method: "PATCH",
            body: input,
            headers,
          }),
        );
      },
    },
    ...createPublicationServices(session, confirm, options, mutate),
    audit: createAuditService(session),
  };
  // Una sola escritura por pestaña, incluida su espera de confirmación.
  let writing = false;
  const guard = <T extends (...args: any[]) => Promise<any>>(work: T): T =>
    (async (...args: Parameters<T>) => {
      if (writing)
        throw Error("Hay otra operación pendiente. Esperá a que termine.");
      writing = true;
      try {
        return await work(...args);
      } finally {
        writing = false;
      }
    }) as T;
  client.users.create = guard(client.users.create);
  client.users.update = guard(client.users.update);
  client.users.remove = guard(client.users.remove);
  client.users.profile = guard(client.users.profile);
  client.users.password = guard(client.users.password);
  client.users.managedPassword = guard(client.users.managedPassword);
  client.catalogs.save = guard(client.catalogs.save);
  client.catalogs.active = guard(client.catalogs.active);
  client.catalogs.remove = guard(client.catalogs.remove);
  client.settings.update = guard(client.settings.update);
  client.publications.create = guard(client.publications.create);
  client.publications.update = guard(client.publications.update);
  client.publications.inactivate = guard(client.publications.inactivate);
  client.attachments.upload = guard(client.attachments.upload);
  client.attachments.download = guard(client.attachments.download);
  client.reports.export = guard(client.reports.export);
  client.audit.export = guard(client.audit.export);
  return client;
}
