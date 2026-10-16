import type { State, User } from "./model";
import {
  publicationActor,
  type Publication,
  type Reference,
} from "./publications";
import {
  commitWithAttachment,
  preparePdf,
  type PublicationAttachment,
} from "./attachments";

export type UploadedAttachment = {
  attachment: PublicationAttachment;
  createdAt: string;
  createdBy: Reference;
};
export type AttachmentAudit = {
  id: string;
  resourceId?: string;
  actorId: string;
  actorRole: User["role"];
  createdAt: string;
  operation: "ADJUNTO_CARGADO" | "ADJUNTO_RECHAZADO";
  status: "EXITO" | "FALLIDO";
  detail?: string;
};
export type AttachmentRecord = UploadedAttachment & {
  publication?: Publication;
};

// Metadatos locales: no representan un veredicto CLEAN ni un análisis antivirus.
export function attachmentRecords(
  state: State,
  actorId: string,
): AttachmentRecord[] {
  const actor = publicationActor(state, actorId);
  const records = new Map<string, AttachmentRecord>();
  for (const upload of state.uploadedAttachments ?? []) {
    if (actor.role === "ADMINISTRADOR" || upload.createdBy.id === actor.id) {
      records.set(upload.attachment.id, { ...upload });
    }
  }
  for (const publication of state.publications ?? []) {
    if (!publication.attachment) continue;
    records.set(publication.attachment.id, {
      ...(state.uploadedAttachments?.find(
        (entry) => entry.attachment.id === publication.attachment!.id,
      ) ?? {
        attachment: publication.attachment,
        createdAt: publication.createdAt,
        createdBy: publication.createdBy,
      }),
      publication,
    });
  }
  return [...records.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function availableAttachments(
  state: State,
  actorId: string,
): UploadedAttachment[] {
  return attachmentRecords(state, actorId).filter(
    (record) => !record.publication,
  );
}

export async function uploadAttachment({
  state,
  actorId,
  file,
  commit,
  assertActive,
  onStage,
  write,
}: {
  state: State;
  actorId: string;
  file: File;
  commit: (state: State) => void;
  assertActive: () => void;
  onStage?: (stage: "validating" | "saving") => void;
  write?: (id: string, file?: Blob) => Promise<void>;
}): Promise<UploadedAttachment> {
  assertActive();
  const actor = publicationActor(state, actorId);
  const audit = (
    operation: AttachmentAudit["operation"],
    resourceId?: string,
    detail?: string,
  ): AttachmentAudit => ({
    id: crypto.randomUUID(),
    actorId: actor.id,
    actorRole: actor.role,
    createdAt: new Date().toISOString(),
    operation,
    resourceId,
    detail,
    status: operation === "ADJUNTO_CARGADO" ? "EXITO" : "FALLIDO",
  });
  let attachment: PublicationAttachment;
  try {
    onStage?.("validating");
    attachment = await preparePdf(file);
    const hashes = [
      ...(state.uploadedAttachments ?? []).map(
        (entry) => entry.attachment.sha256,
      ),
      ...(state.publications ?? []).flatMap((entry) =>
        entry.attachment ? [entry.attachment.sha256] : [],
      ),
    ];
    if (hashes.includes(attachment.sha256)) {
      throw Error(
        "Archivo duplicado: este PDF ya fue cargado, aunque tenga otro nombre.",
      );
    }
  } catch (error) {
    assertActive();
    commit({
      ...state,
      attachmentAudit: [
        ...(state.attachmentAudit ?? []),
        audit(
          "ADJUNTO_RECHAZADO",
          undefined,
          error instanceof Error ? error.message : "Archivo inválido.",
        ),
      ],
    });
    throw error;
  }
  assertActive();
  onStage?.("saving");
  const upload: UploadedAttachment = {
    attachment,
    createdAt: new Date().toISOString(),
    createdBy: { id: actor.id, name: actor.name },
  };
  await commitWithAttachment(
    attachment,
    file,
    () => {
      assertActive();
      commit({
        ...state,
        uploadedAttachments: [...(state.uploadedAttachments ?? []), upload],
        attachmentAudit: [
          ...(state.attachmentAudit ?? []),
          audit("ADJUNTO_CARGADO", attachment.id),
        ],
        repositoryLinks: [
          ...(state.repositoryLinks ?? []),
          { userId: actor.id, recordId: attachment.id, kind: "documento" },
        ],
      });
    },
    write,
  );
  return upload;
}

export function attachmentSize(size: number): string {
  return size >= 1024 * 1024
    ? `${(size / 1024 / 1024).toLocaleString("es-PY", { maximumFractionDigits: 2 })} MB`
    : `${Math.max(1, Math.ceil(size / 1024))} KB`;
}
