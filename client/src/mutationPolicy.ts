import { hashPassword, type State } from "./model";
import { settingsOf } from "./settings";
import { problem } from "./data/problems";

export function existingChanges(
  before: State,
  after: State,
): { name: string; deleted: boolean }[] {
  const changes: { name: string; deleted: boolean }[] = [];
  function compare(
    previous: { id: string; name?: string; title?: string }[],
    next: { id: string; name?: string; title?: string }[],
  ) {
    for (const record of previous) {
      const updated = next.find((candidate) => candidate.id === record.id);
      if (!updated || JSON.stringify(record) !== JSON.stringify(updated))
        changes.push({
          name: record.name ?? record.title ?? "registro",
          deleted: !updated,
        });
    }
  }
  compare(before.users, after.users);
  for (const key of Object.keys(before.catalogs) as (keyof State["catalogs"])[])
    compare(before.catalogs[key], after.catalogs[key]);
  compare(before.publications ?? [], after.publications ?? []);
  if (
    JSON.stringify(settingsOf(before)) !== JSON.stringify(settingsOf(after))
  ) {
    changes.push({ name: "Parámetros generales", deleted: false });
  }
  compare(
    (before.uploadedAttachments ?? []).map((record) => ({
      ...record,
      id: record.attachment.id,
      name: record.attachment.name,
    })),
    (after.uploadedAttachments ?? []).map((record) => ({
      ...record,
      id: record.attachment.id,
      name: record.attachment.name,
    })),
  );
  return changes;
}

export function newBusinessRecords(before: State, after: State): string[] {
  const names: string[] = [];
  for (const account of after.users)
    if (!before.users.some((record) => record.id === account.id))
      names.push(account.username);
  for (const key of Object.keys(
    before.catalogs,
  ) as (keyof State["catalogs"])[]) {
    for (const record of after.catalogs[key])
      if (!before.catalogs[key].some((previous) => previous.id === record.id))
        names.push(record.name);
  }
  for (const publication of after.publications ?? [])
    if (!before.publications?.some((record) => record.id === publication.id))
      names.push(publication.title);
  for (const upload of after.uploadedAttachments ?? [])
    if (
      !before.uploadedAttachments?.some(
        (record) => record.attachment.id === upload.attachment.id,
      )
    )
      names.push(upload.attachment.name);
  return names;
}

export async function verifyConfirmationPassword(
  state: State,
  actorId: string,
  password: string,
): Promise<boolean> {
  // Paso 1: validar identidad y contraseña de quien realiza la modificación.
  const actor = state.users.find(
    (account) => account.id === actorId && account.active,
  );
  if (!actor || actor.lockedUntil > Date.now())
    throw Error("La cuenta no está habilitada para confirmar cambios.");
  if (!password || password.length > 128) return false;
  // Paso 2: comparar con la credencial vigente, sin guardar ni registrar el texto ingresado.
  const providedHash = await hashPassword(password, actor.salt);
  // Paso 3: devolver únicamente el resultado de la verificación.
  return providedHash === actor.passwordHash;
}

export async function verifyConfirmationHeader(
  state: State,
  actorId: string,
  header?: string,
): Promise<boolean> {
  if (!header || !/^[A-Za-z0-9+/]+={0,2}$/.test(header) || header.length > 1024)
    throw problem(
      428,
      "CONFIRMATION_REQUIRED",
      "Ingresá tu contraseña actual para confirmar.",
    );
  let password: string;
  try {
    password = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(header), (character) => character.charCodeAt(0)),
    );
  } catch {
    throw problem(
      428,
      "CONFIRMATION_REQUIRED",
      "La confirmación no es válida. Volvé a ingresarla.",
    );
  }
  return verifyConfirmationPassword(state, actorId, password);
}
