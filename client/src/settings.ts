import { guardAdmin, type State } from "./model";

export type AttachmentFormat = "pdf" | "txt";
export type SystemSettings = {
  summaryWordLimit: number;
  maxPdfSizeMb: number;
  allowedFormats?: AttachmentFormat[];
};
export const defaultSettings: SystemSettings = {
  summaryWordLimit: 300,
  maxPdfSizeMb: 10,
  allowedFormats: ["pdf"],
};
export const MAX_CONFIGURED_PDF_MB = 25;

export function settingsOf(
  state: Pick<State, "settings">,
): Required<SystemSettings> {
  return {
    ...defaultSettings,
    ...state.settings,
    allowedFormats: [...(state.settings?.allowedFormats ?? ["pdf"])],
  };
}

export function updateSettings(
  state: State,
  actorId: string,
  input: SystemSettings,
): State {
  // Paso 1: exigir administrador y valores numéricos enteros.
  guardAdmin(state, actorId);
  if (
    !Number.isInteger(input.summaryWordLimit) ||
    !Number.isInteger(input.maxPdfSizeMb)
  ) {
    throw Error("Ingresá valores enteros en los parámetros.");
  }
  // Paso 2: mantener límites compatibles con las validaciones del cliente.
  if (input.summaryWordLimit < 10 || input.summaryWordLimit > 1000) {
    throw Error("El resumen debe permitir entre 10 y 1000 palabras.");
  }
  if (input.maxPdfSizeMb < 1 || input.maxPdfSizeMb > MAX_CONFIGURED_PDF_MB) {
    throw Error("El tamaño máximo de PDF debe estar entre 1 y 25 MB.");
  }
  const formats = input.allowedFormats ?? settingsOf(state).allowedFormats;
  if (
    !formats.length ||
    new Set(formats).size !== formats.length ||
    formats.some((format) => !["pdf", "txt"].includes(format))
  )
    throw Error(
      "Elegí al menos un formato con validador disponible: PDF o TXT.",
    );
  // Paso 3: preparar el cambio; el guardado habitual exige contraseña y auditoría.
  return { ...state, settings: { ...input, allowedFormats: [...formats] } };
}
