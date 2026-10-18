import { attachmentRecords, uploadAttachment } from "../attachmentService";
import type { PublicationAttachment } from "../attachments";
import { readAttachment } from "../attachments";
import {
  auditRecords,
  queryAudit,
  type AuditFilters,
  type AuditIntent,
} from "../audit";
import { buildAuditReport } from "../auditExports";
import {
  bibliographicActor,
  bibliographicRecord,
  queryBibliography,
  type BibliographicFilters,
} from "../bibliography";
import {
  deleteCatalogRecord,
  filterCatalog,
  saveCatalogRecord,
  setCatalogActive,
  type CatalogInput,
  type CatalogKey,
} from "../catalogs";
import { buildDemoData } from "../demoData";
import type { State, UserInput } from "../model";
import {
  digest,
  guardAdmin,
  passwordError,
  randomToken,
  resetPassword,
} from "../model";
import { buildPublicationReport } from "../publicationExports";
import {
  editPublication,
  inactivatePublication,
  publicationReport,
  registerPublication,
  type PublicationInput,
  type ReportFilters,
} from "../publications";
import { INACTIVITY_MS } from "../security";
import { settingsOf, updateSettings } from "../settings";
import {
  createUser,
  deleteUser,
  editProfile,
  editUser,
  loginUser,
  requireResult,
  updateManagedPassword,
  updatePersonalPassword,
} from "../userService";
import type {
  AttachmentDto,
  ExportMetadata,
  ExportResult,
  MutationOptions,
  PublicationCreateDto,
  PublicationPatchDto,
  SessionDto,
  SettingsDto,
  Versioned,
} from "./contracts";
import { catalogDto, userDto } from "./contracts";
import { browserLock } from "./coordination";
import { ClientProblem, problem } from "./problems";
import { paginate } from "./query";
import type { SharedSession } from "./session";
import { assertVersion, canonical, etagOf } from "./versions";

type Context = {
  read: () => State;
  actorId: () => string;
  assertActive: () => void;
  commit: (
    after: State,
    before: State,
    options?: { currentPasswordVerified: boolean },
  ) => Promise<void>;
  audit: (intent: AuditIntent) => void | Promise<void>;
  authentication?: {
    current: () => SharedSession | null;
    login: (
      userId: string,
      before: () => void | Promise<void>,
    ) => Promise<void>;
    logout: (before: () => void | Promise<void>) => Promise<void>;
    activity: () => Promise<void>;
    commit: (
      after: State,
      before: State,
      intent: AuditIntent,
    ) => void | Promise<void>;
  };
  coordinate?: <T>(work: () => Promise<T>) => Promise<T>;
  readBinary?: (attachment: PublicationAttachment) => Promise<Uint8Array>;
  writeBinary?: (id: string, file?: Blob) => Promise<void>;
};

function failure(
  error: unknown,
  duplicateCode = "DUPLICATE_PUBLICATION",
): never {
  if (error instanceof ClientProblem) throw error;
  const message =
    error instanceof Error
      ? error.message
      : "No se pudo completar la operación.";
  const status = /permiso|administrador|público/i.test(message)
    ? 403
    : /duplicad|ya existe|ya.*adjuntado/i.test(message)
      ? 409
      : /no se encontró/i.test(message)
        ? 404
        : 400;
  const field = /resumen/i.test(message)
    ? "summary"
    : /abstract/i.test(message)
      ? "abstract"
      : /título/i.test(message)
        ? "title"
        : /correo/i.test(message)
          ? "email"
          : /CI |cédula/i.test(message)
            ? "ci"
            : undefined;
  throw problem(
    status,
    status === 409
      ? duplicateCode
      : status === 403
        ? "FORBIDDEN"
        : "VALIDATION_ERROR",
    message,
    field ? [{ name: field, reason: message }] : [],
  );
}

export function createMockClient(context: Context) {
  const read = () => {
    context.assertActive();
    return context.read();
  };
  const actor = () => context.actorId();
  const demoRecoveryLinks = new Map<string, string>();
  let reportExporting = false;
  let auditExporting = false;
  function authentication() {
    if (!context.authentication)
      throw Error("No se inicializó la sesión simulada.");
    return context.authentication;
  }
  async function sessionDto(): Promise<SessionDto> {
    const session = authentication().current();
    if (
      !session ||
      Math.min(session.expiresAt, session.lastActivityAt + INACTIVITY_MS) <=
        Date.now()
    )
      throw problem(
        401,
        "UNAUTHENTICATED",
        "La sesión venció. Volvé a iniciar sesión.",
      );
    const user = context
      .read()
      .users.find((user) => user.id === session.userId && user.active);
    if (!user)
      throw problem(401, "UNAUTHENTICATED", "La cuenta no está disponible.");
    return {
      user: userDto(user),
      session: {
        id: session.id,
        createdAt: new Date(session.createdAt).toISOString(),
        lastActivityAt: new Date(session.lastActivityAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        idleExpiresAt: new Date(
          Math.min(session.expiresAt, session.lastActivityAt + INACTIVITY_MS),
        ).toISOString(),
      },
      serverTime: new Date().toISOString(),
    };
  }
  const auth = {
    async initializeBrowser() {
      authentication();
    },
    session: sessionDto,
    async login(username: string, password: string) {
      if (!username.trim() || !password || password.length > 128)
        throw problem(
          400,
          "VALIDATION_ERROR",
          "Completá usuario y contraseña (máximo 128 caracteres).",
          [{ name: "password", reason: "Revisá los datos de acceso." }],
        );
      const before = context.read();
      const result = await loginUser(before, username, password);
      const account = before.users.find(
        (user) =>
          user.username.trim().normalize("NFKC").toLocaleLowerCase("es") ===
          username.trim().normalize("NFKC").toLocaleLowerCase("es"),
      );
      const intent: AuditIntent = {
        module: "Sesiones",
        operation: result.exito
          ? "Iniciar sesión"
          : "Inicio de sesión rechazado",
        status: result.exito ? "EXITO" : "FALLIDO",
        actorId: account?.id ?? null,
        actorName: account?.name ?? username.slice(0, 40),
        detail: result.mensaje,
      };
      if (!result.exito || !result.datos?.userId) {
        if (result.datos)
          await authentication().commit(result.datos.state, before, intent);
        throw problem(401, "INVALID_CREDENTIALS", result.mensaje);
      }
      await authentication().login(result.datos.userId, () =>
        authentication().commit(result.datos!.state, before, intent),
      );
      return sessionDto();
    },
    async activity() {
      await authentication().activity();
      return sessionDto();
    },
    async refresh() {
      return context.coordinate
        ? context.coordinate(sessionDto)
        : browserLock("refresh", sessionDto);
    },
    async logout() {
      const session = authentication().current();
      await authentication().logout(() =>
        context.audit({
          module: "Sesiones",
          operation: "Cerrar sesión",
          status: "EXITO",
          detail: `Duración de sesión: ${Math.max(0, Math.floor((Date.now() - (session?.createdAt ?? Date.now())) / 1000))} segundos. Cierre compartido entre pestañas.`,
        }),
      );
    },
    async requestRecovery(email: string) {
      const normalized = email.trim().normalize("NFKC").toLocaleLowerCase("es");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
        throw problem(400, "VALIDATION_ERROR", "Ingresá un correo válido.", [
          { name: "email", reason: "El correo no es válido." },
        ]);
      const before = context.read();
      const time = Date.now();
      const keys = [await digest(normalized), "mock-browser"];
      const rates = { ...before.recoveryRates };
      const limited = keys.some(
        (key) =>
          rates[key] &&
          time - rates[key].windowStart < 3600000 &&
          rates[key].count >= 3,
      );
      if (!limited)
        for (const key of keys) {
          const rate = rates[key];
          rates[key] =
            rate && time - rate.windowStart < 3600000
              ? { ...rate, count: rate.count + 1 }
              : { windowStart: time, count: 1 };
        }
      const person = before.users.find(
        (user) =>
          user.email.toLocaleLowerCase("es") === normalized && user.active,
      );
      const token = person && !limited ? randomToken() : undefined;
      const next: State = {
        ...before,
        recoveryRates: rates,
        recovery: [
          ...before.recovery.filter((entry) => entry.expiresAt > time),
          ...(token && person
            ? [
                {
                  userId: person.id,
                  hash: await digest(token),
                  expiresAt: time + 900000,
                },
              ]
            : []),
        ],
      };
      await authentication().commit(next, before, {
        module: "Sesiones",
        operation: "Solicitar recuperación",
        status: token ? "EXITO" : "FALLIDO",
        actorId: person?.id ?? null,
        detail: limited
          ? "Límite de solicitudes alcanzado."
          : "Solicitud de recuperación procesada en demostración local.",
      });
      demoRecoveryLinks.delete(normalized);
      if (token) demoRecoveryLinks.set(normalized, token);
      return {
        message:
          "Si la dirección corresponde a una cuenta registrada y activa, recibirás las instrucciones para restablecer tu contraseña.",
      };
    },
    // Canal exclusivo de demostración: no forma parte de la respuesta de la API.
    demoRecoveryToken(email: string) {
      return (
        demoRecoveryLinks.get(
          email.trim().normalize("NFKC").toLocaleLowerCase("es"),
        ) ?? ""
      );
    },
    async resetPassword(token: string, newPassword: string) {
      if (!/^[a-f0-9]{64}$/.test(token))
        throw problem(
          400,
          "INVALID_RECOVERY_TOKEN",
          "El enlace no es válido o venció. Solicitá uno nuevo.",
        );
      if (passwordError(newPassword))
        throw problem(400, "VALIDATION_ERROR", passwordError(newPassword), [
          { name: "newPassword", reason: passwordError(newPassword) },
        ]);
      const before = context.read();
      const hash = await digest(token);
      const userId = before.recovery.find(
        (entry) => entry.hash === hash,
      )?.userId;
      let next: State;
      try {
        next = await resetPassword(before, token, newPassword);
      } catch (error) {
        throw problem(
          400,
          error instanceof Error && /diferente/.test(error.message)
            ? "PASSWORD_UNCHANGED"
            : "INVALID_RECOVERY_TOKEN",
          error instanceof Error
            ? error.message
            : "El enlace no es válido o venció.",
        );
      }
      await authentication().commit(next, before, {
        module: "Sesiones",
        operation: "Restablecer contraseña",
        status: "EXITO",
        actorId: userId ?? null,
      });
      if (authentication().current()?.userId === userId)
        await authentication().logout(() => {});
      demoRecoveryLinks.clear();
    },
  };
  async function mutate<T>(
    build: (
      state: State,
    ) => Promise<{ state: State; value: T }> | { state: State; value: T },
    currentPasswordVerified = false,
  ): Promise<T> {
    const before = read();
    try {
      const result = await build(before);
      context.assertActive();
      if (canonical(context.read()) !== canonical(before))
        throw problem(
          412,
          "RESOURCE_VERSION_CONFLICT",
          "Los datos cambiaron durante la operación. Se conservaron tus datos ingresados.",
        );
      await context.commit(result.state, before, { currentPasswordVerified });
      return result.value;
    } catch (error) {
      throw error;
    }
  }
  const versioned = async <T>(data: T): Promise<Versioned<T>> => ({
    data,
    etag: await etagOf(data),
  });
  const catalogData = (state: State, key: CatalogKey, id: string) => {
    const current = state.catalogs[key].find((record) => record.id === id);
    if (!current)
      throw problem(404, "NOT_FOUND", "No se encontró el registro.");
    return catalogDto(current);
  };
  const publicationData = (state: State, id: string) =>
    bibliographicRecord(state, actor(), id);
  const publicationInput = (
    state: State,
    input: PublicationCreateDto,
  ): PublicationInput => {
    // La frontera recibe attachmentId; los hashes/metadatos no son un cuerpo remoto.
    if ("attachment" in input && input.attachment)
      throw problem(
        400,
        "VALIDATION_ERROR",
        "Cargá el archivo y conservá su identificador antes de guardar la publicación.",
      );
    return input;
  };
  const users = {
    async list(
      query: {
        search?: string;
        role?: string;
        active?: string;
        page?: number;
        pageSize?: number;
      } = {},
    ) {
      const state = read();
      guardAdmin(state, actor());
      const term = (query.search ?? "").toLocaleLowerCase("es");
      return {
        ...paginate(
          state.users
            .filter(
              (user) =>
                (!term ||
                  `${user.name} ${user.ci} ${user.email} ${user.username}`
                    .toLocaleLowerCase("es")
                    .includes(term)) &&
                (!query.role || user.role === query.role) &&
                (!query.active || user.active === (query.active === "true")),
            )
            .map(userDto),
          query.page,
          query.pageSize,
        ),
        summary: {
          total: state.users.length,
          active: state.users.filter((user) => user.active).length,
          administrators: state.users.filter(
            (user) => user.active && user.role === "ADMINISTRADOR",
          ).length,
        },
      };
    },
    async get(id: string) {
      const state = read();
      guardAdmin(state, actor());
      const user = state.users.find((record) => record.id === id);
      if (!user)
        throw problem(404, "USER_NOT_FOUND", "No se encontró la cuenta.");
      return versioned(userDto(user));
    },
    async create(input: UserInput, password: string) {
      return mutate(async (state) => {
        const next = requireResult(
          await createUser(state, actor(), input, password),
        );
        return { state: next, value: userDto(next.users.at(-1)!) };
      });
    },
    async update(
      id: string,
      input: Partial<UserInput>,
      options: MutationOptions,
    ) {
      return mutate(async (state) => {
        const current = state.users.find((user) => user.id === id);
        await assertVersion(
          current && userDto(current),
          options.ifMatch,
          "USER_VERSION_CONFLICT",
        );
        if (!current)
          throw problem(404, "USER_NOT_FOUND", "No se encontró la cuenta.");
        const next = requireResult(
          editUser(state, actor(), id, { ...current, ...input }),
        );
        return {
          state: next,
          value: userDto(next.users.find((user) => user.id === id)!),
        };
      });
    },
    async remove(id: string, options: MutationOptions) {
      return mutate(async (state) => {
        const current = state.users.find((user) => user.id === id);
        await assertVersion(
          current && userDto(current),
          options.ifMatch,
          "USER_VERSION_CONFLICT",
        );
        return {
          state: requireResult(deleteUser(state, actor(), id)),
          value: undefined,
        };
      });
    },
    async me() {
      return (await sessionDto()).user;
    },
    async profile(input: Pick<UserInput, "name" | "email" | "username">) {
      return mutate((state) => {
        const next = requireResult(editProfile(state, actor(), input));
        return {
          state: next,
          value: userDto(next.users.find((user) => user.id === actor())!),
        };
      });
    },
    async password(currentPassword: string, newPassword: string) {
      return mutate(
        async (state) => ({
          state: requireResult(
            await updatePersonalPassword(
              state,
              actor(),
              currentPassword,
              newPassword,
            ),
          ),
          value: undefined,
        }),
        true,
      );
    },
    async managedPassword(id: string, newPassword: string) {
      return mutate(async (state) => ({
        state: requireResult(
          await updateManagedPassword(state, actor(), id, newPassword),
        ),
        value: undefined,
      }));
    },
  };
  const catalogs = {
    async list(
      key: CatalogKey,
      query: {
        search?: string;
        active?: string;
        page?: number;
        pageSize?: number;
      } = {},
    ) {
      const state = read();
      const user = bibliographicActor(state, actor());
      if (user.role === "PUBLICO" && ["autores", "tutores"].includes(key))
        throw problem(
          403,
          "FORBIDDEN",
          "No tenés permiso para consultar este directorio.",
        );
      const rows = filterCatalog(
        state.catalogs[key],
        query.search ?? "",
        user.role === "PUBLICO"
          ? "active"
          : query.active === "true"
            ? "active"
            : query.active === "false"
              ? "inactive"
              : "",
      ).map((row) => catalogData(state, key, row.id));
      return {
        ...paginate(rows, query.page, query.pageSize),
        summary: {
          total: state.catalogs[key].length,
          active: state.catalogs[key].filter((record) => record.active).length,
        },
      };
    },
    async get(key: CatalogKey, id: string) {
      const state = read();
      const user = bibliographicActor(state, actor());
      const data = catalogData(state, key, id);
      if (
        user.role === "PUBLICO" &&
        (["autores", "tutores"].includes(key) || !data.active)
      )
        throw problem(
          403,
          "FORBIDDEN",
          "No tenés permiso para consultar este registro.",
        );
      return versioned(data);
    },
    async save(
      key: CatalogKey,
      input: CatalogInput,
      id?: string,
      options: MutationOptions = {},
    ) {
      return mutate(async (state) => {
        if (id)
          await assertVersion(catalogData(state, key, id), options.ifMatch);
        const next = saveCatalogRecord(state, actor(), key, input, id);
        const saved = id ?? next.catalogs[key].at(-1)!.id;
        return {
          state: next,
          value: await versioned(catalogData(next, key, saved)),
        };
      });
    },
    async active(
      key: CatalogKey,
      id: string,
      active: boolean,
      options: MutationOptions,
    ) {
      return mutate(async (state) => {
        await assertVersion(catalogData(state, key, id), options.ifMatch);
        const next = setCatalogActive(state, actor(), key, id, active);
        return {
          state: next,
          value: await versioned(catalogData(next, key, id)),
        };
      });
    },
    async remove(key: CatalogKey, id: string, options: MutationOptions) {
      return mutate(async (state) => {
        await assertVersion(catalogData(state, key, id), options.ifMatch);
        return {
          state: deleteCatalogRecord(state, actor(), key, id),
          value: undefined,
        };
      });
    },
  };
  const publications = {
    async list(filters: BibliographicFilters, page = 1, pageSize = 6) {
      const state = read();
      const result = queryBibliography(state, actor(), filters, page, pageSize);
      return {
        data: result.records,
        pagination: {
          page: result.page,
          pageSize,
          total: result.total,
          totalPages: result.totalPages,
        },
      };
    },
    async get(id: string) {
      return versioned(publicationData(read(), id));
    },
    async create(input: PublicationCreateDto) {
      return mutate((state) => {
        const result = requireResult(
          registerPublication(state, actor(), publicationInput(state, input)),
        );
        return {
          state: result.state,
          value: publicationData(result.state, result.publication.id),
        };
      });
    },
    async update(
      id: string,
      input: PublicationPatchDto,
      options: MutationOptions,
    ) {
      return mutate(async (state) => {
        await assertVersion(
          publicationData(state, id),
          options.ifMatch,
          "PRECONDITION_FAILED",
        );
        const current = state.publications!.find((record) => record.id === id)!;
        const merged: PublicationInput = {
          title: current.title,
          summary: current.summary,
          abstract: current.abstract,
          keywords: current.keywords,
          year: current.year,
          authorIds: current.authors.map((person) => person.id),
          tutorIds: current.tutors.map((person) => person.id),
          careerId: current.career.id,
          levelId: current.level.id,
          typeId: current.type.id,
          branchId: current.branch.id,
          source: current.source ?? (current.externalUrl ? "EXTERNA" : "LOCAL"),
          externalUrl: current.externalUrl,
          requiresLibraryCopy:
            current.requiresLibraryCopy ?? !!current.attachment,
          ...input,
          approved: true,
        };
        if (input.attachmentId === undefined)
          merged.attachment = current.attachment;
        const result = requireResult(
          editPublication(state, actor(), id, merged),
        );
        return {
          state: result.state,
          value: publicationData(result.state, id),
        };
      });
    },
    async inactivate(id: string, options: MutationOptions) {
      return mutate(async (state) => {
        await assertVersion(
          publicationData(state, id),
          options.ifMatch,
          "PRECONDITION_FAILED",
        );
        const next = inactivatePublication(state, actor(), id);
        return { state: next, value: publicationData(next, id) };
      });
    },
  };
  const attachments = {
    async list(
      query: {
        search?: string;
        status?: string;
        page?: number;
        pageSize?: number;
      } = {},
    ) {
      const state = read();
      const administrator =
        bibliographicActor(state, actor()).role === "ADMINISTRADOR";
      const rows = attachmentRecords(state, actor());
      const data: AttachmentDto[] = rows
        .filter(
          (row) =>
            (!query.status || row.status === query.status) &&
            (!query.search ||
              `${row.attachment.name} ${row.publication?.title ?? ""} ${row.publication?.code ?? ""}`
                .normalize("NFD")
                .replace(/\p{M}/gu, "")
                .toLowerCase()
                .includes(
                  query.search
                    .normalize("NFD")
                    .replace(/\p{M}/gu, "")
                    .toLowerCase(),
                )),
        )
        .map((row) => ({
          ...row.attachment,
          createdAt: row.createdAt,
          createdBy: { ...row.createdBy },
          status: row.status ?? "DISPONIBLE",
          reservedPublicationId:
            row.reservedPublicationId &&
            (administrator ||
              state.publications?.some(
                (publication) =>
                  publication.id === row.reservedPublicationId &&
                  publication.active !== false,
              ))
              ? row.reservedPublicationId
              : null,
          publication: row.publication
            ? {
                id: row.publication.id,
                title: row.publication.title,
                code: row.publication.code,
                active: row.publication.active !== false,
              }
            : null,
        }));
      return {
        ...paginate(data, query.page, query.pageSize),
        summary: Object.fromEntries(
          [
            "DISPONIBLE",
            "VINCULADO",
            "RESERVADO",
            "RECHAZADO",
            "PENDIENTE",
          ].map((status) => [
            status,
            rows.filter((row) => row.status === status).length,
          ]),
        ),
      };
    },
    async get(id: string) {
      const state = read();
      const row = attachmentRecords(state, actor()).find(
        (file) => file.attachment.id === id,
      );
      if (!row) throw Error("No se encontró el adjunto.");
      return {
        ...row.attachment,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        reservedPublicationId: row.reservedPublicationId ?? null,
      };
    },
    async upload(
      file: File,
      onStage?: (stage: "validating" | "saving") => void,
    ) {
      const before = read();
      const upload = await uploadAttachment({
        state: before,
        actorId: actor(),
        file,
        assertActive: context.assertActive,
        onStage,
        write: context.writeBinary,
        commit: async (next) => {
          await context.commit(next, before);
        },
      });
      return {
        ...upload.attachment,
        createdAt: upload.createdAt,
        createdBy: upload.createdBy,
        status: "DISPONIBLE" as const,
        reservedPublicationId: null,
        publication: null,
      };
    },
    async download(id: string): Promise<ExportResult> {
      const state = read();
      const row = attachmentRecords(state, actor()).find(
        (record) => record.attachment.id === id,
      );
      if (
        !row ||
        ["PENDIENTE", "RECHAZADO", "RESERVADO"].includes(row.status ?? "") ||
        !row.publication
      )
        throw problem(
          404,
          "ATTACHMENT_NOT_FOUND",
          "El adjunto no está disponible para descargar.",
        );
      const bytes = await (context.readBinary ?? readAttachment)(
        row.attachment,
      );
      context.assertActive();
      const current = attachmentRecords(context.read(), actor()).find(
        (record) => record.attachment.id === id,
      );
      if (
        !current?.publication ||
        ["PENDIENTE", "RECHAZADO", "RESERVADO"].includes(
          current.status ?? "",
        ) ||
        current.attachment.sha256 !== row.attachment.sha256
      )
        throw problem(
          404,
          "ATTACHMENT_NOT_FOUND",
          "El adjunto dejó de estar disponible.",
        );
      await context.audit({
        module: "Archivos",
        operation: "Descargar adjunto",
        status: "EXITO",
        resourceId: id,
        publicationId: row.publication.id,
      });
      return {
        bytes,
        filename: row.attachment.name,
        mime: row.attachment.mime,
      };
    },
  };
  const settings = {
    async get() {
      const state = read();
      bibliographicActor(state, actor());
      return versioned(settingsOf(state));
    },
    async update(input: Partial<SettingsDto>, options: MutationOptions) {
      return mutate(async (state) => {
        await assertVersion(settingsOf(state), options.ifMatch);
        const next = updateSettings(state, actor(), {
          ...settingsOf(state),
          ...input,
        });
        return { state: next, value: await versioned(settingsOf(next)) };
      });
    },
  };
  async function exportMetadata(
    filters: unknown,
    rows: unknown[],
  ): Promise<ExportMetadata> {
    return {
      snapshot: await etagOf({ filters, rows }),
      exportable:
        rows.length > 0 &&
        rows.length <= 500 &&
        JSON.stringify(rows).length <= 2000000,
      maxRecords: 500,
    };
  }
  const reports = {
    async list(filters: ReportFilters, page = 1, pageSize = 20) {
      const rows = publicationReport(read(), actor(), filters);
      return {
        ...paginate(
          rows.map((row) => publicationData(context.read(), row.id)),
          page,
          pageSize,
        ),
        report: await exportMetadata(filters, rows),
      };
    },
    async export(
      filters: ReportFilters,
      format: "pdf" | "xlsx",
      snapshot: string,
    ): Promise<ExportResult> {
      if (reportExporting)
        throw problem(
          503,
          "REPORT_SERVICE_BUSY",
          "Ya hay una exportación de investigaciones en curso.",
        );
      reportExporting = true;
      try {
        const before = read();
        const rows = publicationReport(before, actor(), filters);
        if (!rows.length) return { data: [], total: 0 };
        const metadata = await exportMetadata(filters, rows);
        if (!metadata.exportable)
          throw problem(
            400,
            "REPORT_LIMIT_EXCEEDED",
            "El reporte supera 500 registros o el límite de texto. Reducí los filtros.",
          );
        if (snapshot !== metadata.snapshot)
          throw problem(
            409,
            "REPORT_VERSION_CONFLICT",
            "Los resultados cambiaron. Consultá nuevamente antes de exportar.",
          );
        const file = await buildPublicationReport(
          before,
          actor(),
          filters,
          format,
        );
        if (file.bytes.byteLength > 20 * 1024 * 1024)
          throw problem(
            400,
            "REPORT_LIMIT_EXCEEDED",
            "El archivo supera el tamaño máximo de exportación.",
          );
        context.assertActive();
        if (
          (
            await exportMetadata(
              filters,
              publicationReport(context.read(), actor(), filters),
            )
          ).snapshot !== snapshot
        )
          throw problem(
            409,
            "REPORT_VERSION_CONFLICT",
            "Los resultados cambiaron mientras se generaba el reporte.",
          );
        await context.audit({
          module: "Reportes",
          operation: "Exportar investigaciones",
          status: "EXITO",
          detail: `${rows.length} registros. Formato ${format.toUpperCase()}.`,
        });
        return file;
      } finally {
        reportExporting = false;
      }
    },
  };
  const audit = {
    async list(filters: AuditFilters, page = 1, pageSize = 10) {
      const state = read();
      const rows = queryAudit(state, actor(), filters);
      const all = auditRecords(state, actor());
      return {
        ...paginate(rows, page, pageSize),
        export: await exportMetadata(filters, rows),
        summary: {
          total: all.length,
          failed: rows.filter((row) => row.status === "FALLIDO").length,
          modules: [...new Set(all.map((row) => row.module))].sort(),
          operations: [...new Set(all.map((row) => row.operation))].sort(),
          actors: [
            ...new Map(
              all
                .filter((row) => row.actorId)
                .map((row) => [
                  row.actorId,
                  { id: row.actorId!, name: row.actorName },
                ]),
            ).values(),
          ],
        },
      };
    },
    async get(id: string) {
      const row = auditRecords(read(), actor()).find(
        (record) => record.id === id,
      );
      if (!row) throw problem(404, "NOT_FOUND", "No se encontró el evento.");
      return row;
    },
    async export(
      filters: AuditFilters,
      format: "pdf" | "xlsx",
      snapshot: string,
    ): Promise<ExportResult> {
      if (auditExporting)
        throw problem(
          503,
          "AUDIT_EXPORT_BUSY",
          "Ya hay una exportación de auditoría en curso.",
        );
      auditExporting = true;
      try {
        const before = read();
        const rows = queryAudit(before, actor(), filters);
        if (!rows.length) return { data: [], total: 0 };
        const metadata = await exportMetadata(filters, rows);
        if (!metadata.exportable)
          throw problem(
            400,
            "AUDIT_EXPORT_LIMIT",
            "La selección supera el límite de exportación. Reducí los filtros.",
          );
        if (metadata.snapshot !== snapshot)
          throw problem(
            409,
            "AUDIT_VERSION_CONFLICT",
            "Los eventos cambiaron. Consultá nuevamente antes de exportar.",
          );
        const file = await buildAuditReport(before, actor(), filters, format);
        context.assertActive();
        if (file.bytes.byteLength > 20 * 1024 * 1024)
          throw problem(
            400,
            "AUDIT_EXPORT_LIMIT",
            "El archivo supera el tamaño máximo de exportación.",
          );
        if (
          (
            await exportMetadata(
              filters,
              queryAudit(context.read(), actor(), filters),
            )
          ).snapshot !== snapshot
        )
          throw problem(
            409,
            "AUDIT_VERSION_CONFLICT",
            "Los eventos cambiaron mientras se generaba el archivo.",
          );
        await context.audit({
          module: "Auditoría",
          operation: "Exportar auditoría",
          status: "EXITO",
          detail: `${rows.length} eventos. Formato ${format.toUpperCase()}.`,
        });
        return file;
      } finally {
        auditExporting = false;
      }
    },
  };
  const demo = {
    recoveryToken: auth.demoRecoveryToken,
    async load(baseUrl: string) {
      return mutate((state) => {
        const { state: next, ...counts } = buildDemoData(
          state,
          actor(),
          baseUrl,
        );
        return { state: next, value: counts };
      });
    },
  };
  const guarded = <T extends object>(service: T, duplicateCode?: string): T =>
    Object.fromEntries(
      Object.entries(service).map(([key, method]) => [
        key,
        key === "demoRecoveryToken" || key === "recoveryToken"
          ? method
          : async (...args: unknown[]) => {
              try {
                return await method(...args);
              } catch (error) {
                failure(error, duplicateCode);
              }
            },
      ]),
    ) as T;
  return {
    auth: guarded(auth),
    users: guarded(users, "DUPLICATE_USER"),
    catalogs: guarded(catalogs, "DUPLICATE_CATALOG"),
    publications: guarded(publications),
    attachments: guarded(attachments, "DUPLICATE_ATTACHMENT"),
    settings: guarded(settings),
    reports: guarded(reports),
    audit: guarded(audit),
    demo: guarded(demo),
  };
}
export type { DataClient } from "./client";
