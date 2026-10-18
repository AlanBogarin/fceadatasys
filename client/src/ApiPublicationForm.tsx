import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BibliographicRecord } from "./bibliography";
import type { Reference } from "./publications";
import type {
  AttachmentDetailDto,
  PublicationCreateDto,
  PublicationPatchDto,
  Versioned,
} from "./data/contracts";
import { useDataClient } from "./data/context";
import { useQuery } from "./data/useQuery";
import { useVersionedDraft, VersionReview } from "./data/useVersionedDraft";
import {
  AttachmentPicker,
  ClassificationPicker,
  PeoplePicker,
  QueryMessage,
} from "./ApiPublicationControls";
import {
  publicationClassificationFields,
  type PublicationClassification,
} from "./data/classificationOptions";
import { attachmentAccept } from "./attachments";
import { Alert, Field, applyFieldProblems, errorText } from "./ui";

const referenceField = {
  carreras: "career",
  niveles: "level",
  tipos: "type",
  filiales: "branch",
} as const;
const labels = {
  carreras: "Carrera *",
  niveles: "Nivel académico *",
  tipos: "Tipo de publicación *",
  filiales: "Sede / filial *",
};
const currentYear = () =>
  Number(
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "America/Asuncion",
    }).format(new Date()),
  );

export function ApiPublicationForm({
  initial,
  initialAttachmentId = "",
  onCancel,
  onSaved,
}: {
  initial?: Versioned<BibliographicRecord>;
  initialAttachmentId?: string;
  onCancel: () => void;
  onSaved: (record: BibliographicRecord) => void;
}) {
  const client = useDataClient();
  const previous = initial?.data;
  const [content, setContent] = useState({
    title: previous?.title ?? "",
    summary: previous?.summary ?? "",
    abstract: previous?.abstract ?? "",
    keywords: previous?.keywords ?? "",
    year: String(previous?.year ?? currentYear()),
    externalUrl: previous?.externalUrl ?? "",
  });
  const [authors, setAuthors] = useState<Reference[]>(previous?.authors ?? []);
  const [tutors, setTutors] = useState<Reference[]>(previous?.tutors ?? []);
  const [references, setReferences] = useState<
    Record<PublicationClassification, Reference | null>
  >({
    carreras: previous?.career ?? null,
    niveles: previous?.level ?? null,
    tipos: previous?.type ?? null,
    filiales: previous?.branch ?? null,
  });
  const [documentMode, setDocumentMode] = useState(
    previous?.hasAttachment
      ? "keep"
      : initialAttachmentId
        ? "uploaded"
        : previous?.source === "LOCAL"
          ? "none"
          : "link",
  );
  const [requiresLibraryCopy, setRequiresLibraryCopy] = useState(
    previous?.requiresLibraryCopy ?? true,
  );
  const [attachment, setAttachment] = useState<AttachmentDetailDto | null>(
    null,
  );
  const [file, setFile] = useState<File>();
  const [approved, setApproved] = useState(!!previous);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const settings = useQuery((signal) => client.settings.get(signal), [client]);
  const initialUpload = useQuery(
    (signal) =>
      initialAttachmentId
        ? client.attachments.get(initialAttachmentId, signal)
        : Promise.resolve(null),
    [client, initialAttachmentId],
  );
  const initialApplied = useRef(false);
  useEffect(() => {
    if (initialUpload.data && !initialApplied.current) {
      initialApplied.current = true;
      setAttachment(initialUpload.data);
    }
  }, [initialUpload.data]);
  const version = useVersionedDraft(
    previous,
    initial?.etag,
    previous ? () => client.publications.get(previous.id) : undefined,
  );
  const update = (key: keyof typeof content, value: string) =>
    setContent((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    try {
      if (!settings.data)
        throw Error("Consultá los parámetros antes de guardar.");
      if (!authors.length || !tutors.length)
        throw Error("Seleccioná al menos un autor y un tutor.");
      for (const key of Object.keys(references) as PublicationClassification[])
        if (!references[key])
          throw Error(
            `Seleccioná ${labels[key].replace(" *", "").toLowerCase()}.`,
          );
      const words = content.summary.trim().split(/\s+/u).filter(Boolean).length;
      if (words > settings.data.data.summaryWordLimit)
        throw Error(
          `El resumen admite hasta ${settings.data.data.summaryWordLimit} palabras.`,
        );
      if (!approved)
        throw Error(
          "Confirmá que el trabajo fue aprobado fuera del repositorio.",
        );
      const etag = previous ? await version.check(previous) : undefined;
      let attachmentId = attachment?.id;
      if (documentMode === "file") {
        if (!file) throw Error("Seleccioná un documento.");
        const uploaded = await client.attachments.upload(file);
        if (!open.current) return;
        setAttachment(uploaded);
        setDocumentMode("uploaded");
        setFile(undefined);
        attachmentId = uploaded.id;
      }
      if (documentMode === "uploaded" && !attachmentId)
        throw Error("Seleccioná un archivo cargado.");
      if (
        initialAttachmentId &&
        attachment?.id === initialAttachmentId &&
        attachment.reservedPublicationId
      )
        throw Error(
          "El archivo está reservado por una publicación anterior. Elegí otro archivo.",
        );
      if (!open.current) return;
      const fields = Object.fromEntries(
        (Object.keys(references) as PublicationClassification[]).map((key) => [
          publicationClassificationFields[key],
          references[key]!.id,
        ]),
      ) as Pick<
        PublicationCreateDto,
        "careerId" | "levelId" | "typeId" | "branchId"
      >;
      const local = documentMode !== "link";
      const patch: PublicationPatchDto = {
        title: content.title,
        summary: content.summary,
        abstract: content.abstract,
        keywords: content.keywords,
        year: Number(content.year),
        authorIds: authors.map((person) => person.id),
        tutorIds: tutors.map((person) => person.id),
        ...fields,
        source: local ? "LOCAL" : "EXTERNA",
        externalUrl: local ? "" : content.externalUrl,
        requiresLibraryCopy:
          local && documentMode !== "none" && requiresLibraryCopy,
        ...(documentMode === "keep"
          ? {}
          : attachmentId && ["uploaded", "file"].includes(documentMode)
            ? { attachmentId }
            : previous
              ? { attachmentId: null }
              : {}),
      };
      const result = previous
        ? await client.publications.update(previous.id, patch, {
            ifMatch: etag,
          })
        : await client.publications.create({
            ...patch,
            approved: true,
          } as PublicationCreateDto);
      if (open.current) onSaved(result);
    } catch (caught) {
      if (open.current) {
        version.failed(caught);
        applyFieldProblems(form, caught);
        setError(errorText(caught));
      }
    } finally {
      running.current = false;
      if (open.current) setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Gestión bibliográfica</p>
          <h1>
            {previous ? "Editar investigación" : "Registrar investigación"}
          </h1>
          <p>
            Registrá los datos del trabajo aprobado y su documento, según
            corresponda.
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Volver al listado
        </button>
      </div>
      <form className="publication-form" onSubmit={submit}>
        {version.conflict && (
          <>
            <QueryMessage
              loading={!version.latest && !version.reviewError}
              error={version.reviewError || undefined}
            />
            {version.latest && (
              <VersionReview
                values={{
                  "Datos actuales": JSON.stringify(
                    version.latest.data,
                    null,
                    2,
                  ),
                }}
                onReviewed={() => {
                  version.acceptLatest();
                  setError("");
                }}
              />
            )}
          </>
        )}
        <fieldset className="publication-fields" disabled={busy}>
          <section>
            <h2>1. Identificación del trabajo</h2>
            <p>Los campos con * son obligatorios.</p>
            <Field label="Título *">
              <input
                name="title"
                required
                maxLength={250}
                value={content.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </Field>
            <Field label="Año de publicación *">
              <input
                name="year"
                type="number"
                min={1900}
                max={currentYear()}
                required
                value={content.year}
                onChange={(event) => update("year", event.target.value)}
              />
            </Field>
            <div className="publication-grid">
              {(Object.keys(referenceField) as PublicationClassification[]).map(
                (catalog) => (
                  <ClassificationPicker
                    key={catalog}
                    catalog={catalog}
                    label={labels[catalog]}
                    name={publicationClassificationFields[catalog]}
                    selected={references[catalog]}
                    onChange={(value) =>
                      setReferences((current) => ({
                        ...current,
                        [catalog]: value,
                      }))
                    }
                    required
                  />
                ),
              )}
            </div>
          </section>
          <section>
            <h2>2. Autoría y orientación</h2>
            <PeoplePicker
              catalog="autores"
              label="Autores"
              selected={authors}
              onChange={setAuthors}
            />
            <PeoplePicker
              catalog="tutores"
              label="Tutores / orientadores"
              selected={tutors}
              onChange={setTutors}
            />
          </section>
          <section>
            <h2>3. Contenido y documento</h2>
            <QueryMessage {...settings} retry={settings.reload} />
            <Field
              label="Resumen *"
              hint={`${content.summary.trim().split(/\s+/u).filter(Boolean).length} / ${settings.data?.data.summaryWordLimit ?? "—"} palabras`}
            >
              <textarea
                name="summary"
                required
                rows={5}
                maxLength={5000}
                value={content.summary}
                onChange={(event) => update("summary", event.target.value)}
              />
            </Field>
            <Field label="Abstract (inglés) *">
              <textarea
                name="abstract"
                lang="en"
                required
                rows={5}
                maxLength={5000}
                value={content.abstract}
                onChange={(event) => update("abstract", event.target.value)}
              />
            </Field>
            <Field
              label="Palabras clave *"
              hint="Separá los términos con comas."
            >
              <input
                name="keywords"
                required
                maxLength={300}
                value={content.keywords}
                onChange={(event) => update("keywords", event.target.value)}
              />
            </Field>
            <Field label="Documento de la investigación *">
              <select
                value={documentMode}
                onChange={(event) => setDocumentMode(event.target.value)}
              >
                <option value="link">Enlace externo</option>
                {previous?.hasAttachment && (
                  <option value="keep">
                    Conservar adjunto actual
                    {previous.attachment
                      ? `: ${previous.attachment.name}`
                      : " (sin descarga disponible)"}
                  </option>
                )}
                <option value="file">Archivo adjunto nuevo</option>
                <option value="uploaded">Archivo ya cargado</option>
                <option value="none">
                  Local sin copia digital obligatoria
                </option>
              </select>
            </Field>
            {documentMode === "link" && (
              <Field label="Enlace al documento *">
                <input
                  name="externalUrl"
                  type="url"
                  required
                  maxLength={2000}
                  value={content.externalUrl}
                  onChange={(event) =>
                    update("externalUrl", event.target.value)
                  }
                />
              </Field>
            )}
            {documentMode === "file" && (
              <Field
                label="Adjuntar documento *"
                hint={`Hasta ${settings.data?.data.maxPdfSizeMb ?? "—"} MiB. Se analizará y guardará en el servidor antes de registrar la publicación.`}
              >
                <input
                  type="file"
                  required
                  accept={
                    settings.data
                      ? attachmentAccept(settings.data.data.allowedFormats)
                      : undefined
                  }
                  onChange={(event) => setFile(event.target.files?.[0])}
                />
              </Field>
            )}
            {documentMode === "uploaded" && (
              <>
                <QueryMessage {...initialUpload} retry={initialUpload.reload} />
                <AttachmentPicker
                  publicationId={previous?.id}
                  selected={attachment}
                  onChange={setAttachment}
                />
              </>
            )}
            {documentMode === "keep" && (
              <p>Se conservará el documento actual y su historial de uso.</p>
            )}
            {documentMode === "none" && (
              <p>
                Trabajo local que no requiere conservar una copia digital en
                Biblioteca.
              </p>
            )}
            {!["link", "none"].includes(documentMode) && (
              <label className="publication-confirm">
                <input
                  type="checkbox"
                  checked={requiresLibraryCopy}
                  onChange={(event) =>
                    setRequiresLibraryCopy(event.target.checked)
                  }
                />
                Corresponde conservar este trabajo en Biblioteca (archivo
                obligatorio).
              </label>
            )}
            <label className="publication-confirm">
              <input
                name="approved"
                type="checkbox"
                required
                checked={approved}
                onChange={(event) => setApproved(event.target.checked)}
              />
              Confirmo que el trabajo ya fue aprobado fuera del repositorio.
            </label>
          </section>
        </fieldset>
        <Alert text={error} />
        <div className="publication-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            className="primary"
            disabled={busy || !settings.data || version.conflict}
          >
            {busy ? "Guardando investigación…" : "Guardar investigación"}
          </button>
        </div>
      </form>
    </>
  );
}
