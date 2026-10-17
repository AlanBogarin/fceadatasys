import { migrateCatalogs } from "./catalogs";
import { seed, type State } from "./model";
import { buildDemoData } from "./demoData";
import { updateSettings } from "./settings";
import { browserLock } from "./data/coordination";
const KEY = "fcea-datasys.frontend.v1";
export const SESSION_KEY = "fcea-datasys.session";
export async function load(demoBaseUrl = window.location.href): Promise<State> {
  return browserLock("data", () => loadLocal(demoBaseUrl));
}
async function loadLocal(demoBaseUrl: string): Promise<State> {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    const state = JSON.parse(raw) as State;
    if (
      state.version !== 1 ||
      !Array.isArray(state.users) ||
      !Array.isArray(state.recovery)
    ) {
      throw Error("Los datos locales no son compatibles.");
    }
    if (
      state.repositoryLinks !== undefined &&
      !Array.isArray(state.repositoryLinks)
    ) {
      throw Error(
        "Las relaciones del repositorio no son compatibles. Los datos se conservaron.",
      );
    }
    const upgraded = migrateCatalogs(state);
    if (
      (state.publications !== undefined &&
        !Array.isArray(state.publications)) ||
      (state.publicationAudit !== undefined &&
        !Array.isArray(state.publicationAudit)) ||
      (state.uploadedAttachments !== undefined &&
        !Array.isArray(state.uploadedAttachments)) ||
      (state.attachmentAudit !== undefined &&
        !Array.isArray(state.attachmentAudit)) ||
      (state.auditEvents !== undefined && !Array.isArray(state.auditEvents))
    ) {
      throw Error(
        "Los datos de investigaciones no son compatibles. Se conservaron sin cambios.",
      );
    }
    if (state.settings !== undefined) {
      const administrator = state.users.find(
        (account) => account.active && account.role === "ADMINISTRADOR",
      );
      if (!administrator)
        throw Error(
          "No se pueden validar los parámetros sin administrador activo.",
        );
      updateSettings(upgraded, administrator.id, state.settings);
    }
    if (JSON.stringify(upgraded) !== raw) save(upgraded);
    return upgraded;
  }
  const initial = await seed();
  const administrator = initial.users.find(
    (account) => account.role === "ADMINISTRADOR",
  )!;
  const { state } = buildDemoData(initial, administrator.id, demoBaseUrl);
  save(state);
  return state;
}
export function save(state: State) {
  localStorage.setItem(KEY, JSON.stringify(state));
}
