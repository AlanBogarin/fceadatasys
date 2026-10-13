import {
  authenticate,
  guardAdmin,
  makeUser,
  updateUser,
  validateUser,
  changeOwnPassword,
  changeUserPassword,
  resetPassword,
  type State,
  type User,
  type UserInput,
} from "./model";
import { userDependencies } from "./relations";

export type Resultado<Datos> =
  | { exito: true; mensaje: string; datos: Datos }
  | { exito: false; mensaje: string; datos?: Datos };

export function failureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "No se pudo completar la operación. Volvé a intentarlo.";
}

export function requireResult<Datos>(result: Resultado<Datos>): Datos {
  if (!result.exito) {
    throw Error(result.mensaje);
  }
  return result.datos;
}

export async function createUser(
  state: State,
  actorId: string,
  input: UserInput,
  password: string,
): Promise<Resultado<State>> {
  try {
    // Paso 1: validar permiso y campos obligatorios.
    guardAdmin(state, actorId);
    const validated = validateUser(input, state.users);

    // Paso 2: validar contraseña y preparar la cuenta sin guardar texto plano.
    const created = await makeUser(validated, password);

    // Paso 3: devolver el estado a persistir; la UI informa éxito solo tras guardarlo.
    return {
      exito: true,
      mensaje: "Usuario creado.",
      datos: { ...state, users: [...state.users, created] },
    };
  } catch (error) {
    return { exito: false, mensaje: failureMessage(error) };
  }
}

export function loadUserForEdit(
  state: State,
  actorId: string,
  userId: string,
): Resultado<User> {
  try {
    // Paso 1: autorizar antes de consultar y mostrar información de otra cuenta.
    guardAdmin(state, actorId);

    // Paso 2: consultar los datos actuales; nunca editar directamente la fila de la tabla.
    const currentUser = state.users.find(
      (candidate) => candidate.id === userId,
    );
    if (!currentUser) {
      throw Error("No se encontró el usuario. Actualizá el listado.");
    }

    // Paso 3: entregar una copia para precargar el formulario.
    return {
      exito: true,
      mensaje: "Datos actuales consultados.",
      datos: { ...currentUser },
    };
  } catch (error) {
    return { exito: false, mensaje: failureMessage(error) };
  }
}

export function editUser(
  state: State,
  actorId: string,
  userId: string,
  input: UserInput,
): Resultado<State> {
  try {
    // Paso 1: comprobar permiso y existencia, incluso si el formulario fue alterado.
    requireResult(loadUserForEdit(state, actorId, userId));

    // Paso 2: aplicar RN-01, unicidad y protección del administrador.
    const nextState = updateUser(state, actorId, userId, input);

    // Paso 3: entregar los cambios para su persistencia local.
    return { exito: true, mensaje: "Usuario actualizado.", datos: nextState };
  } catch (error) {
    return { exito: false, mensaje: failureMessage(error) };
  }
}

export function deleteUser(
  state: State,
  actorId: string,
  userId: string,
): Resultado<State> {
  try {
    // Paso 1: autorizar y consultar la cuenta actual.
    const target = requireResult(loadUserForEdit(state, actorId, userId));
    if (actorId === userId) {
      throw Error("No podés eliminar tu propia cuenta.");
    }

    // Paso 2: proteger el último administrador y la integridad referencial (RN-02).
    const activeAdministrators = state.users.filter(
      (candidate) => candidate.active && candidate.role === "ADMINISTRADOR",
    );
    if (
      target.active &&
      target.role === "ADMINISTRADOR" &&
      activeAdministrators.length <= 1
    ) {
      throw Error("Debe quedar al menos un administrador activo.");
    }
    const dependencies = userDependencies(state, userId);
    if (dependencies.length > 0) {
      throw Error(
        `No se puede eliminar el usuario: tiene registros o transacciones asociados, o relaciones pendientes de verificar. ${dependencies.join("; ")}.`,
      );
    }

    // Paso 3: eliminar solo la cuenta sin vínculos y sus recuperaciones pendientes.
    const nextState = {
      ...state,
      users: state.users.filter((candidate) => candidate.id !== userId),
      recovery: state.recovery.filter((recovery) => recovery.userId !== userId),
    };
    return { exito: true, mensaje: "Usuario eliminado.", datos: nextState };
  } catch (error) {
    return { exito: false, mensaje: failureMessage(error) };
  }
}

export function editProfile(
  state: State,
  actorId: string,
  input: Pick<UserInput, "name" | "email" | "username">,
): Resultado<State> {
  try {
    // Paso 1: solo una cuenta activa puede actualizar su propio perfil.
    const currentUser = state.users.find(
      (candidate) => candidate.id === actorId && candidate.active,
    );
    if (!currentUser) {
      throw Error("No se encontró una cuenta activa.");
    }

    // Paso 2: RN-01 también rige en Mi perfil. CI, rol y estado no provienen del formulario.
    if (
      currentUser.role === "PUBLICO" &&
      input.name.trim() !== currentUser.name
    ) {
      throw Error(
        "El nombre completo de una cuenta Público es de solo lectura.",
      );
    }
    const validated = validateUser(
      {
        ...currentUser,
        name: input.name,
        email: input.email,
        username: input.username,
      },
      state.users,
      actorId,
    );

    // Paso 3: conservar identidad y sesión, entregando únicamente los cambios autorizados.
    const users = state.users.map((candidate) => {
      if (candidate.id === actorId) {
        return { ...candidate, ...validated };
      }
      return candidate;
    });
    return {
      exito: true,
      mensaje: "Tu perfil fue actualizado.",
      datos: { ...state, users },
    };
  } catch (error) {
    return { exito: false, mensaje: failureMessage(error) };
  }
}

export async function loginUser(
  state: State,
  username: string,
  password: string,
): Promise<Resultado<{ state: State; userId?: string }>> {
  try {
    // Paso 1: los campos deben estar presentes incluso sin la validación HTML.
    if (!username.trim() || !password) {
      throw Error("Ingresá el usuario y la contraseña.");
    }

    // Paso 2: comprobar credenciales, bloqueo temporal y estado de la cuenta.
    const authentication = await authenticate(state, username, password);

    // Paso 3: devolver también los intentos fallidos para que se persistan.
    if (authentication.error) {
      return {
        exito: false,
        mensaje: authentication.error,
        datos: authentication,
      };
    }
    return { exito: true, mensaje: "Sesión iniciada.", datos: authentication };
  } catch (error) {
    return { exito: false, mensaje: failureMessage(error) };
  }
}

export async function updatePersonalPassword(
  state: State,
  actorId: string,
  currentPassword: string,
  newPassword: string,
): Promise<Resultado<State>> {
  try {
    // Paso 1 y 2: verificar cuenta, contraseña actual y política de la nueva contraseña.
    const nextState = await changeOwnPassword(
      state,
      actorId,
      currentPassword,
      newPassword,
    );
    // Paso 3: devolver cambios conservando la identidad de la sesión actual.
    return {
      exito: true,
      mensaje: "Contraseña actualizada.",
      datos: nextState,
    };
  } catch (error) {
    return { exito: false, mensaje: failureMessage(error) };
  }
}

export async function updateManagedPassword(
  state: State,
  actorId: string,
  userId: string,
  password: string,
): Promise<Resultado<State>> {
  try {
    // Paso 1 y 2: exigir administrador, cuenta existente y contraseña admisible.
    const nextState = await changeUserPassword(
      state,
      actorId,
      userId,
      password,
    );
    // Paso 3: conservar rol y estado de la cuenta administrada.
    return {
      exito: true,
      mensaje: "Contraseña del usuario actualizada.",
      datos: nextState,
    };
  } catch (error) {
    return { exito: false, mensaje: failureMessage(error) };
  }
}

export async function recoverPassword(
  state: State,
  token: string,
  password: string,
): Promise<Resultado<State>> {
  try {
    // Paso 1 y 2: comprobar contraseña y token vigente de un solo uso.
    const nextState = await resetPassword(state, token, password);
    // Paso 3: actualizar credencial e invalidar recuperaciones pendientes.
    return { exito: true, mensaje: "Contraseña recuperada.", datos: nextState };
  } catch (error) {
    return { exito: false, mensaje: failureMessage(error) };
  }
}
