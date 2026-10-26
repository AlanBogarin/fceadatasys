// Contratos del cliente: no incluyen State, hashes de contraseña ni sales del adaptador local.
export type Role = "ADMINISTRADOR" | "DIGITADOR" | "PUBLICO";
export type UserDto = {
  id: string;
  name: string;
  ci: string;
  email: string;
  username: string;
  role: Role;
  permissions?: string[];
  active: boolean;
  createdAt: string;
};
export type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
export type Page<T> = { data: T[]; pagination: Pagination };
export type Versioned<T> = { data: T; etag: string };
export type ProblemDetails = {
  status: number;
  code: string;
  title: string;
  detail: string;
  timestamp?: string;
  path?: string;
  invalid_params?: { name: string; reason: string }[];
};
export type SessionDto = {
  user: UserDto;
  session: {
    id: string;
    createdAt: string;
    lastActivityAt: string;
    expiresAt: string;
    idleExpiresAt: string;
  };
  serverTime: string;
  accessToken?: string;
  tokenType?: "Bearer";
  expiresIn?: number;
};
export type MutationOptions = {
  ifMatch?: string;
  confirmationPassword?: string;
};
export type AccessPolicyDto = {
  roles: Record<Role, string[]>;
  users: Record<string, Record<string, boolean>>;
  definitions: { key: string; label: string }[];
};
export type BackupDto = {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  source: string;
  status: string;
  filename: string | null;
  localSaved: boolean;
  cloudSaved: boolean;
  detail: string | null;
};
export type ExportMetadata = {
  snapshot: string | null;
  exportable: boolean;
  maxRecords: number;
};
export type ExportResult =
  | { data: []; total: 0 }
  | { bytes: Uint8Array; filename: string; mime: string };
export type AttachmentStatus =
  "DISPONIBLE" | "VINCULADO" | "RESERVADO" | "RECHAZADO" | "PENDIENTE";
export type AttachmentDto = {
  id: string;
  name: string;
  size: number;
  mime: "application/pdf" | "text/plain";
  sha256: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  status: AttachmentStatus;
  reservedPublicationId: string | null;
  publication: {
    id: string;
    code: string;
    title: string;
    active: boolean;
  } | null;
};
export type AttachmentDetailDto = Omit<AttachmentDto, "status" | "publication">;
export type SettingsDto = {
  summaryWordLimit: number;
  maxPdfSizeMb: number;
  allowedFormats: ("pdf" | "txt")[];
};
export type CatalogDto = {
  id: string;
  name: string;
  fields: Record<string, string>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};
export type PublicationCreateDto = {
  title: string;
  authorIds: string[];
  tutorIds: string[];
  careerId: string;
  levelId: string;
  typeId: string;
  branchId: string;
  summary: string;
  abstract: string;
  keywords: string;
  year: number;
  source?: "LOCAL" | "EXTERNA";
  requiresLibraryCopy?: boolean;
  externalUrl: string;
  attachmentId?: string | null;
  approved: boolean;
};
export type PublicationPatchDto = Partial<
  Omit<PublicationCreateDto, "approved">
>;
export function catalogDto(record: CatalogDto): CatalogDto {
  return {
    id: record.id,
    name: record.name,
    fields: { ...record.fields },
    active: record.active,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function userDto(user: UserDto): UserDto {
  return {
    id: user.id,
    name: user.name,
    ci: user.ci,
    email: user.email,
    username: user.username,
    role: user.role,
    ...(user.permissions ? { permissions: [...user.permissions] } : {}),
    active: user.active,
    createdAt: user.createdAt,
  };
}
