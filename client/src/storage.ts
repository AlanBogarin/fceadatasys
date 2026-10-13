import { migrateCatalogs } from "./catalogs";
import { seed, type State } from "./model";
const KEY = "fcea-datasys.frontend.v1";
export const SESSION_KEY = "fcea-datasys.session";
export async function load(): Promise<State> {
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
    if (JSON.stringify(upgraded) !== raw) save(upgraded);
    return upgraded;
  }
  const state = await seed();
  save(state);
  return state;
}
export function save(state: State) {
  localStorage.setItem(KEY, JSON.stringify(state));
}
