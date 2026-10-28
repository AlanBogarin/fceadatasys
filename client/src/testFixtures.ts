import type { State } from "./model";
import {
  saveCatalogRecord,
  type CatalogInput,
  type CatalogKey,
} from "./catalogs";

let fixtureNumber = 7000000;
// Solo fixtures de pruebas: los casos de validación obligatoria llaman al servicio real.
export function saveCatalogSample(
  state: State,
  actorId: string,
  catalog: CatalogKey,
  input: CatalogInput,
  targetId?: string,
): State {
  fixtureNumber += 1;
  const existing = state.catalogs[catalog].find(
    (record) => record.id === targetId,
  );
  const fields: Record<string, string> = {};
  if (catalog === "autores" || catalog === "tutores") {
    fields.ci = existing?.fields.ci || String(fixtureNumber);
    fields.email =
      existing?.fields.email || `persona${fixtureNumber}@example.test`;
  }
  if (catalog === "carreras")
    fields.codigo = existing?.fields.codigo || `PRUEBA-${fixtureNumber}`;
  if (catalog === "tutores")
    fields.especialidad =
      existing?.fields.especialidad || "Especialidad de prueba";
  if (catalog === "facultades")
    fields.sigla = existing?.fields.sigla || `FAC-${fixtureNumber}`;
  if (catalog === "filiales")
    fields.direccion = existing?.fields.direccion || "Dirección de prueba";
  return saveCatalogRecord(
    state,
    actorId,
    catalog,
    { ...input, fields: { ...fields, ...input.fields } },
    targetId,
  );
}
