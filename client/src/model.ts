import { userDependencies } from "./relations";
import { emptyCatalogs, type Catalogs } from "./catalogs";
// Adaptador local de demostración. No constituye autenticación ni autorización de servidor.
export const ROLES = ["ADMINISTRADOR", "DIGITADOR", "PUBLICO"] as const;
export type Role = (typeof ROLES)[number];
export type User = {
  id: string;
  name: string;
  ci: string;
  email: string;
  username: string;
  role: Role;
  active: boolean;
  passwordHash: string;
  salt: string;
  createdAt: string;
  failures: number;
  lockedUntil: number;
};
export type UserInput = Pick<
  User,
  "name" | "ci" | "email" | "username" | "role" | "active"
>;
export type Recovery = {
  hash: string;
  userId: string;
  expiresAt: number;
};
export type RepositoryLink = {
  userId: string;
  recordId: string;
  kind: "investigación" | "revisión" | "documento" | "transacción";
};
export type State = {
  version: 1;
  users: User[];
  recovery: Recovery[];
  catalogs: Catalogs;
  repositoryLinks?: RepositoryLink[];
};
export const DEMO_PASSWORD = "Fcea2026!";
export const roleLabel: Record<Role, string> = {
  ADMINISTRADOR: "Administrador",
  DIGITADOR: "Digitador",
  PUBLICO: "Público",
};
const normalize = (value: string) =>
  value.trim().normalize("NFKC").toLocaleLowerCase("es");
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (part) => part.toString(16).padStart(2, "0")).join("");
export const randomToken = () =>
  hex(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(value: string) {
  // Paso 1: codificar el token recibido.
  const encodedToken = new TextEncoder().encode(value);
  // Paso 2: calcular su resumen sin guardar el token original.
  const tokenDigest = await crypto.subtle.digest("SHA-256", encodedToken);
  // Paso 3: devolver una representación comparable.
  return hex(new Uint8Array(tokenDigest));
}
export async function hashPassword(password: string, salt: string) {
  // Paso 1: preparar la contraseña como material criptográfico no exportable.
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  // Paso 2: derivar el hash con la sal individual de la cuenta.
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: 120000,
      salt: new TextEncoder().encode(salt),
    },
    material,
    256,
  );
  // Paso 3: devolver el hash; nunca persistir la contraseña en texto plano.
  return hex(new Uint8Array(bits));
}
export function passwordError(password: string) {
  // Paso 1 y 2: comprobar longitud y composición de la nueva contraseña.
  if (
    password.length < 8 ||
    !/[A-Za-z]/.test(password) ||
    !/\d/.test(password)
  ) {
    return "Usá al menos 8 caracteres, una letra y un número.";
  }
  // Paso 3: una cadena vacía indica que la validación fue satisfactoria.
  return "";
}
export function validateUser(
  input: UserInput,
  users: User[],
  editingId?: string,
) {
  // Paso 1: validar campos requeridos y formatos.
  if (
    ![input.name, input.ci, input.email, input.username].every((value) =>
      value.trim(),
    )
  ) {
    throw Error("Completá todos los campos obligatorios.");
  }
  if (input.name.trim().length > 100) {
    throw Error("El nombre completo admite hasta 100 caracteres.");
  }
  if (!/^\d{5,12}$/.test(input.ci.trim())) {
    throw Error("La CI debe contener entre 5 y 12 dígitos.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
    throw Error("Ingresá un correo electrónico válido.");
  }
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(input.username.trim())) {
    throw Error(
      "El usuario debe tener de 3 a 40 letras, números, puntos, guiones o guiones bajos.",
    );
  }
  if (!ROLES.includes(input.role)) {
    throw Error("Elegí un rol válido.");
  }
  // Paso 2: comprobar unicidad excluyendo la cuenta en edición.
  for (const [key, label] of [
    ["ci", "CI"],
    ["email", "correo"],
    ["username", "usuario"],
  ] as const) {
    if (
      users.some(
        (account) =>
          account.id !== editingId &&
          normalize(account[key]) === normalize(input[key]),
      )
    ) {
      throw Error(`Ya existe una cuenta con ese ${label}.`);
    }
  }
  // Paso 3: devolver campos normalizados.
  return {
    ...input,
    name: input.name.trim(),
    ci: input.ci.trim(),
    email: normalize(input.email),
    username: input.username.trim(),
  };
}
export async function makeUser(
  input: UserInput,
  password: string,
): Promise<User> {
  // Paso 1: validar la contraseña antes de construir la cuenta.
  if (passwordError(password)) {
    throw Error(passwordError(password));
  }
  // Paso 2: generar una sal aleatoria exclusiva de esta credencial.
  const salt = randomToken();
  // Paso 3: construir los datos iniciales; el servicio decide cuándo persistirlos.
  return {
    ...input,
    id: crypto.randomUUID(),
    salt,
    passwordHash: await hashPassword(password, salt),
    createdAt: new Date().toISOString(),
    failures: 0,
    lockedUntil: 0,
  };
}
export async function seed(): Promise<State> {
  const users = await Promise.all(
    [
      {
        name: "Administrador de demostración",
        ci: "1000001",
        email: "admin@demo.fcea.test",
        username: "admin",
        role: "ADMINISTRADOR" as Role,
        active: true,
      },
      {
        name: "Digitador de demostración",
        ci: "1000002",
        email: "digitador@demo.fcea.test",
        username: "digitador",
        role: "DIGITADOR" as Role,
        active: true,
      },
      {
        name: "Lector de demostración",
        ci: "1000003",
        email: "publico@demo.fcea.test",
        username: "publico",
        role: "PUBLICO" as Role,
        active: true,
      },
    ].map((input) => makeUser(input, DEMO_PASSWORD)),
  );
  return {
    version: 1,
    users,
    recovery: [],
    catalogs: emptyCatalogs(),
    repositoryLinks: [],
  };
}
export async function authenticate(
  state: State,
  username: string,
  password: string,
  now = Date.now(),
) {
  // Paso 1: localizar la cuenta por su usuario normalizado.
  const user = state.users.find(
    (account) => normalize(account.username) === normalize(username),
  );
  if (!user) {
    return { state, error: "Usuario o contraseña incorrectos." };
  }
  // Paso 2: respetar el bloqueo y verificar la contraseña antes de revelar el estado.
  if (user.lockedUntil > now) {
    return {
      state,
      error:
        "La cuenta está bloqueada temporalmente. Volvé a intentar en 5 minutos.",
    };
  }
  if ((await hashPassword(password, user.salt)) !== user.passwordHash) {
    const failures = user.lockedUntil ? 1 : user.failures + 1;
    const lockedUntil = failures >= 3 ? now + 5 * 60000 : 0;
    return {
      state: {
        ...state,
        users: state.users.map((account) =>
          account.id === user.id
            ? { ...account, failures, lockedUntil }
            : account,
        ),
      },
      error: lockedUntil
        ? "Tres intentos fallidos. La cuenta quedó bloqueada durante 5 minutos."
        : "Usuario o contraseña incorrectos.",
    };
  }
  if (!user.active) {
    return {
      state,
      error: "Tu cuenta se encuentra inactiva. Contacta con el administrador",
    };
  }
  return {
    state: {
      ...state,
      users: state.users.map((account) =>
        account.id === user.id
          ? { ...account, failures: 0, lockedUntil: 0 }
          : account,
      ),
    },
    // Paso 3: entregar la identidad solo cuando todos los controles se cumplieron.
    userId: user.id,
  };
}
export function guardAdmin(state: State, actorId: string) {
  // Paso 1 y 2: comprobar identidad, estado activo y rol de administración.
  if (
    !state.users.some(
      (account) =>
        account.id === actorId &&
        account.active &&
        account.role === "ADMINISTRADOR",
    )
  ) {
    throw Error("Esta acción está reservada al administrador.");
  }
  // Paso 3: permitir que continúe la operación autorizada.
}
export function updateUser(
  state: State,
  actorId: string,
  targetId: string,
  input: UserInput,
): State {
  // Paso 1: comprobar permiso y validar datos antes de aplicar cambios.
  guardAdmin(state, actorId);
  const validatedInput = validateUser(input, state.users, targetId);
  const existingUser = state.users.find((account) => account.id === targetId);
  if (!existingUser) {
    throw Error("No se encontró el usuario.");
  }
  // Paso 2: aplicar RN-01, RN-02 y protección de las cuentas administradoras.
  if (
    (existingUser.role === "PUBLICO" || validatedInput.role === "PUBLICO") &&
    validatedInput.name !== existingUser.name
  ) {
    throw Error("El nombre completo de una cuenta Público es de solo lectura.");
  }
  if (
    actorId === targetId &&
    (!validatedInput.active || validatedInput.role !== "ADMINISTRADOR")
  ) {
    throw Error(
      "No podés inactivar ni quitar el rol de tu propia cuenta administradora.",
    );
  }
  if (
    existingUser.active &&
    existingUser.role === "ADMINISTRADOR" &&
    (!validatedInput.active || validatedInput.role !== "ADMINISTRADOR") &&
    state.users.filter(
      (account) => account.active && account.role === "ADMINISTRADOR",
    ).length === 1
  ) {
    throw Error("Debe quedar al menos un administrador activo.");
  }
  if (existingUser.active && !validatedInput.active) {
    const dependencies = userDependencies(state, targetId);
    if (dependencies.length > 0) {
      throw Error(
        "No se puede dar de baja al usuario: tiene registros o transacciones asociados, o relaciones pendientes de verificar. " +
          dependencies.join("; "),
      );
    }
  }

  // Paso 3: producir un nuevo estado sin modificar el original.
  return {
    ...state,
    users: state.users.map((account) =>
      account.id === targetId ? { ...account, ...validatedInput } : account,
    ),
  };
}
export async function resetPassword(
  state: State,
  token: string,
  password: string,
  now = Date.now(),
): Promise<State> {
  if (passwordError(password)) {
    throw Error(passwordError(password));
  }
  const hash = await digest(token);
  const recovery = state.recovery.find(
    (entry) => entry.hash === hash && entry.expiresAt > now,
  );
  const user = state.users.find(
    (account) => account.id === recovery?.userId && account.active,
  );
  if (!recovery || !user) {
    throw Error("El enlace venció o ya fue utilizado. Solicitá uno nuevo.");
  }
  const salt = randomToken();
  const passwordHash = await hashPassword(password, salt);
  return {
    ...state,
    users: state.users.map((account) =>
      account.id === user.id
        ? { ...account, salt, passwordHash, failures: 0, lockedUntil: 0 }
        : account,
    ),
    recovery: state.recovery.filter((entry) => entry.userId !== user.id),
  };
}
async function replacePassword(
  state: State,
  targetId: string,
  password: string,
): Promise<State> {
  if (passwordError(password)) {
    throw Error(passwordError(password));
  }
  const salt = randomToken();
  const passwordHash = await hashPassword(password, salt);
  return {
    ...state,
    users: state.users.map((account) =>
      account.id === targetId
        ? { ...account, salt, passwordHash, failures: 0, lockedUntil: 0 }
        : account,
    ),
    recovery: state.recovery.filter((entry) => entry.userId !== targetId),
  };
}
export async function changeOwnPassword(
  state: State,
  actorId: string,
  current: string,
  password: string,
): Promise<State> {
  const user = state.users.find(
    (account) => account.id === actorId && account.active,
  );
  if (!user) {
    throw Error("No se encontró una cuenta activa.");
  }
  if ((await hashPassword(current, user.salt)) !== user.passwordHash) {
    throw Error("La contraseña actual es incorrecta.");
  }
  if (current === password) {
    throw Error("Elegí una contraseña diferente a la actual.");
  }
  // El identificador de usuario permanece igual; la sesión local de esta pestaña sigue activa.
  return replacePassword(state, user.id, password);
}
export async function changeUserPassword(
  state: State,
  actorId: string,
  targetId: string,
  password: string,
): Promise<State> {
  guardAdmin(state, actorId);
  if (actorId === targetId) {
    throw Error(
      "Para cambiar tu contraseña, usá Mi cuenta → Cambiar contraseña.",
    );
  }
  const user = state.users.find((account) => account.id === targetId);
  if (!user) {
    throw Error("No se encontró el usuario.");
  }
  if ((await hashPassword(password, user.salt)) === user.passwordHash) {
    throw Error("Elegí una contraseña diferente a la actual.");
  }
  return replacePassword(state, targetId, password);
}
