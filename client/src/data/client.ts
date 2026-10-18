import type { AuditEvent, AuditFilters } from "../audit";
import type {
  BibliographicFilters,
  BibliographicRecord,
} from "../bibliography";
import type { CatalogInput, CatalogKey } from "../catalogs";
import type { UserInput } from "../model";
import type { ReportFilters } from "../publications";
import type {
  AttachmentDto,
  AttachmentDetailDto,
  CatalogDto,
  ExportMetadata,
  ExportResult,
  MutationOptions,
  Page,
  PublicationCreateDto,
  PublicationPatchDto,
  SessionDto,
  SettingsDto,
  UserDto,
  Versioned,
} from "./contracts";

export type ListQuery = {
  search?: string;
  active?: string;
  page?: number;
  pageSize?: number;
};
// Frontera de servicios compartida. No depende de la implementación del simulador.
export interface DataClient {
  auth: {
    initializeBrowser(): Promise<void>;
    session(signal?: AbortSignal): Promise<SessionDto>;
    login(username: string, password: string): Promise<SessionDto>;
    refresh(): Promise<SessionDto>;
    activity(): Promise<SessionDto>;
    logout(): Promise<void>;
    requestRecovery(email: string): Promise<{ message: string }>;
    resetPassword(token: string, newPassword: string): Promise<void>;
  };
  users: {
    list(
      query?: ListQuery & { role?: string },
      signal?: AbortSignal,
    ): Promise<
      Page<UserDto> & {
        summary: { total: number; active: number; administrators: number };
      }
    >;
    get(id: string, signal?: AbortSignal): Promise<Versioned<UserDto>>;
    me(signal?: AbortSignal): Promise<UserDto>;
    create(input: UserInput, password: string): Promise<UserDto>;
    update(
      id: string,
      input: Partial<UserInput>,
      options: MutationOptions,
    ): Promise<UserDto>;
    remove(id: string, options: MutationOptions): Promise<void>;
    profile(
      input: Pick<UserInput, "name" | "email" | "username">,
      options?: MutationOptions,
    ): Promise<UserDto>;
    password(currentPassword: string, newPassword: string): Promise<void>;
    managedPassword(
      id: string,
      newPassword: string,
      options?: MutationOptions,
    ): Promise<void>;
  };
  catalogs: {
    list(
      key: CatalogKey,
      query?: ListQuery,
      signal?: AbortSignal,
    ): Promise<
      Page<CatalogDto> & { summary: { total: number; active: number } }
    >;
    get(
      key: CatalogKey,
      id: string,
      signal?: AbortSignal,
    ): Promise<Versioned<CatalogDto>>;
    save(
      key: CatalogKey,
      input: CatalogInput,
      id?: string,
      options?: MutationOptions,
    ): Promise<Versioned<CatalogDto>>;
    active(
      key: CatalogKey,
      id: string,
      active: boolean,
      options: MutationOptions,
    ): Promise<Versioned<CatalogDto>>;
    remove(
      key: CatalogKey,
      id: string,
      options: MutationOptions,
    ): Promise<void>;
  };
  settings: {
    get(signal?: AbortSignal): Promise<Versioned<SettingsDto>>;
    update(
      input: Partial<SettingsDto>,
      options: MutationOptions,
    ): Promise<Versioned<SettingsDto>>;
  };
  publications: {
    list(
      filters: BibliographicFilters,
      page?: number,
      pageSize?: number,
      signal?: AbortSignal,
    ): Promise<Page<BibliographicRecord> & { durationMs?: number }>;
    get(
      id: string,
      signal?: AbortSignal,
    ): Promise<Versioned<BibliographicRecord>>;
    create(input: PublicationCreateDto): Promise<BibliographicRecord>;
    update(
      id: string,
      input: PublicationPatchDto,
      options: MutationOptions,
    ): Promise<BibliographicRecord>;
    inactivate(
      id: string,
      options: MutationOptions,
    ): Promise<BibliographicRecord>;
  };
  attachments: {
    list(
      query?: {
        search?: string;
        status?: string;
        page?: number;
        pageSize?: number;
      },
      signal?: AbortSignal,
    ): Promise<Page<AttachmentDto> & { summary: Record<string, number> }>;
    get(id: string, signal?: AbortSignal): Promise<AttachmentDetailDto>;
    upload(
      file: File,
      onStage?: (stage: "validating" | "saving") => void,
    ): Promise<AttachmentDto>;
    download(id: string, publicationId?: string): Promise<ExportResult>;
  };
  reports: {
    list(
      filters: ReportFilters,
      page?: number,
      pageSize?: number,
      signal?: AbortSignal,
    ): Promise<Page<BibliographicRecord> & { report: ExportMetadata }>;
    export(
      filters: ReportFilters,
      format: "pdf" | "xlsx",
      snapshot: string,
    ): Promise<ExportResult>;
  };
  audit: {
    list(
      filters: AuditFilters,
      page?: number,
      pageSize?: number,
      signal?: AbortSignal,
    ): Promise<
      Page<AuditEvent> & {
        export: ExportMetadata;
        summary: {
          total: number;
          failed: number;
          modules: string[];
          operations: string[];
          actors: { id: string; name: string; username?: string | null }[];
        };
      }
    >;
    get(id: string, signal?: AbortSignal): Promise<AuditEvent>;
    invalidateOptions?(): void;
    export(
      filters: AuditFilters,
      format: "pdf" | "xlsx",
      snapshot: string,
    ): Promise<ExportResult>;
  };
  demo?: {
    recoveryToken(email: string): string;
    load(baseUrl: string): Promise<{
      addedCatalogs: number;
      addedPublications: number;
      updatedCatalogs: number;
      updatedPublications: number;
      consolidatedBranches: number;
    }>;
  };
}
