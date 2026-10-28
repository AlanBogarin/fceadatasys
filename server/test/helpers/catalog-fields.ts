import { randomInt } from 'node:crypto';

let sequence = randomInt(100000000000, 800000000000);

// Defaults only for successful creation fixtures; validation tests send raw input.
export function catalogFields(key: string, fields: Record<string, string> = {}) {
  const id = ++sequence;
  const defaults: Record<string, string> = {};
  if (key === 'autores' || key === 'tutores') {
    defaults.ci = String(id);
    defaults.email = `persona${id}@example.test`;
  }
  if (key === 'tutores') defaults.especialidad = 'Especialidad de prueba';
  if (key === 'carreras') defaults.codigo = `CAR-${id}`;
  if (key === 'facultades') defaults.sigla = `FAC-${id}`;
  if (key === 'filiales') defaults.direccion = 'Dirección de prueba';
  return { ...defaults, ...fields };
}
