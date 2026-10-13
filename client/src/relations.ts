import type { State } from "./model";
import { CATALOG_KEYS } from "./catalogs";

export function userDependencies(state: State, userId: string): string[] {
  // Paso 1: consultar relaciones explícitas de registros/transacciones del repositorio.
  const dependencies = (state.repositoryLinks ?? [])
    .filter((reference) => reference.userId === userId)
    .map((reference) => `${reference.kind}: ${reference.recordId}`);

  // Paso 2: revisar TODOS los participantes de catálogos, incluso registros inactivos.
  for (const catalogKey of CATALOG_KEYS) {
    for (const record of state.catalogs[catalogKey]) {
      if (!record.participantIds) {
        dependencies.push(
          `${catalogKey}: ${record.name} (registro anterior sin trazabilidad; no se puede descartar una relación)`,
        );
      } else if (record.participantIds.includes(userId)) {
        dependencies.push(`${catalogKey}: ${record.name}`);
      }
    }
  }

  // Paso 3: informar las dependencias; nunca asumir cero ante datos antiguos desconocidos.
  return dependencies;
}
