import type { State } from "../model";
import type { Catalogs } from "../catalogs";
import { bibliographicRecord } from "../bibliography";
import { catalogDto, userDto, type UserDto } from "./contracts";
import { settingsOf } from "../settings";

// Modelo de lectura de las pantallas. Las credenciales y la recuperación quedan
// exclusivamente dentro del adaptador mock; nunca se pasan como props.
export type ViewState = Pick<
  State,
  "version" | "catalogs" | "publications" | "uploadedAttachments" | "settings"
> & { users: UserDto[] };

export function viewStateOf(state: State, actorId: string): ViewState {
  const actor = state.users.find((user) => user.id === actorId && user.active);
  if (!actor) throw Error("La sesión no es válida.");
  const catalogs = Object.fromEntries(
    Object.entries(state.catalogs).map(([key, records]) => [
      key,
      actor.role === "PUBLICO" && ["autores", "tutores"].includes(key)
        ? []
        : records
            .filter((record) => actor.role !== "PUBLICO" || record.active)
            .map(catalogDto),
    ]),
  ) as Catalogs;
  return {
    version: 1,
    users: (actor.role === "ADMINISTRADOR" ? state.users : [actor]).map(
      userDto,
    ),
    catalogs,
    publications: (state.publications ?? [])
      .filter(
        (record) => actor.role === "ADMINISTRADOR" || record.active !== false,
      )
      .map((record) => bibliographicRecord(state, actorId, record.id)),
    uploadedAttachments:
      actor.role === "PUBLICO"
        ? []
        : (state.uploadedAttachments ?? []).filter(
            (record) =>
              actor.role === "ADMINISTRADOR" || record.createdBy.id === actorId,
          ),
    settings: settingsOf(state),
  };
}
