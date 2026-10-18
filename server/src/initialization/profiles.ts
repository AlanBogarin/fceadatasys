import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import {
  normalizeCatalog,
  validateCatalogInput,
  type CatalogKey,
} from "../catalogs/schemas.js";
import { createUserSchema, userInputSchema } from "../users/schemas.js";
import { publicationHash, countWords } from "../publications/schemas.js";
import { bootstrapInput } from "./bootstrap.js";

const source = new URL("../../data/", import.meta.url);
export const dataDirectory = existsSync(source)
  ? source
  : new URL("../../../data/", import.meta.url);
const read = (path: string): unknown =>
  JSON.parse(readFileSync(new URL(path, dataDirectory), "utf8"));
const names = z.array(z.string().min(1)).min(1);
const universitySchema = z
  .object({
    universidad: z.string(),
    sigla: z.string(),
    pais: z.string(),
    facultades: z.array(
      z
        .object({
          facultad: z.string(),
          sigla: z.string(),
          carreras: names,
          filiales: names,
        })
        .strict(),
    ),
    filiales_globales: z.array(
      z
        .object({
          nombre: z.string(),
          tipo: z.string(),
          facultades_presentes: names,
        })
        .strict(),
    ),
  })
  .strict();
const peopleSchema = z
  .object({
    accounts: z.array(userInputSchema),
    authors: names,
    tutors: names,
    levels: names,
    types: names,
  })
  .strict();
const publicationSchema = z
  .object({
    title: z.string(),
    summary: z.string(),
    abstract: z.string(),
    keywords: z.string(),
    year: z.number().int(),
    authors: names,
    tutors: names,
    career: z.string(),
    level: z.string(),
    type: z.string(),
    branch: z.string(),
    document: z.string().regex(/^[A-Za-z0-9-]+\.pdf$/),
  })
  .strict();
export type DemoPublication = z.infer<typeof publicationSchema>;

export function loadDemoDataset() {
  const institution = universitySchema.parse(read("demo/unc.json"));
  const people = peopleSchema.parse(read("demo/people.json"));
  if (
    people.accounts.length !== 3 ||
    people.accounts[0].role !== "ADMINISTRADOR" ||
    new Set(people.accounts.map((user) => user.role)).size !== 3
  )
    throw Error(
      "Datos demo inválidos: se requiere primero el Administrador y una cuenta por rol.",
    );
  const publications = z
    .array(publicationSchema)
    .parse(read("demo/publications.json"));
  const catalogs: {
    key: CatalogKey;
    name: string;
    fields: Record<string, string>;
  }[] = [];
  const add = (
    key: CatalogKey,
    name: string,
    fields: Record<string, string> = {},
  ) => {
    const valid = validateCatalogInput(key, { name, fields });
    catalogs.push({ key, ...valid });
  };
  for (const faculty of institution.facultades) {
    add("facultades", faculty.facultad, {
      sigla: faculty.sigla,
      descripcion:
        "Datos institucionales según el YAML aportado para la demostración.",
    });
    for (const career of faculty.carreras)
      add("carreras", career, {
        descripcion: `Carrera de ${faculty.facultad} (${faculty.sigla}), según el YAML de demostración.`,
      });
  }
  for (const branch of institution.filiales_globales)
    add("filiales", branch.nombre, {
      descripcion: `${branch.tipo}. Presencia indicada: ${branch.facultades_presentes.join(", ")}. Según el YAML de demostración.`,
    });
  for (const author of people.authors) add("autores", author);
  for (const tutor of people.tutors) add("tutores", tutor);
  for (const level of people.levels)
    add("niveles", level, {
      descripcion: "Clasificación para los trabajos ficticios de demostración.",
    });
  for (const type of people.types)
    add("tipos", type, {
      descripcion: "Clasificación para los trabajos ficticios de demostración.",
    });
  const unique = (values: string[], label: string) => {
    if (new Set(values.map(normalizeCatalog)).size !== values.length)
      throw Error(`Datos demo inválidos: duplicados en ${label}.`);
  };
  for (const key of [
    "facultades",
    "carreras",
    "filiales",
    "autores",
    "tutores",
    "niveles",
    "tipos",
  ])
    unique(
      catalogs.filter((item) => item.key === key).map((item) => item.name),
      key,
    );
  unique(
    people.accounts.map((user) => user.username),
    "usuarios",
  );
  for (const field of ["title", "summary", "abstract"] as const) {
    if (
      new Set(publications.map((item) => publicationHash(item[field]))).size !==
      publications.length
    )
      throw Error(`Datos demo inválidos: duplicados en ${field}.`);
  }
  const references = (key: CatalogKey, values: string[]) => {
    const available = new Set(
      catalogs.filter((item) => item.key === key).map((item) => item.name),
    );
    if (values.some((value) => !available.has(value)))
      throw Error(`Datos demo inválidos: referencia de ${key}.`);
  };
  for (const publication of publications) {
    references("autores", publication.authors);
    references("tutores", publication.tutors);
    references("carreras", [publication.career]);
    references("niveles", [publication.level]);
    references("tipos", [publication.type]);
    references("filiales", [publication.branch]);
    unique(publication.authors, "autoría");
    unique(publication.tutors, "orientación");
    if (countWords(publication.summary) > 300)
      throw Error("Datos demo inválidos: resumen de más de 300 palabras.");
    if (
      !existsSync(
        new URL(`demo/documents/${publication.document}`, dataDirectory),
      )
    )
      throw Error("Datos demo inválidos: falta un documento.");
  }
  return { institution, people, catalogs, publications };
}
export type DemoDataset = ReturnType<typeof loadDemoDataset>;

export function productionInput(environment: NodeJS.ProcessEnv) {
  const profile = z
    .object({
      profile: z.literal("production"),
      administrator: userInputSchema.omit({ email: true }),
      settings: z.object({
        summaryWordLimit: z.literal(300),
        maxPdfSizeMb: z.literal(10),
        allowedFormats: z.tuple([z.literal("pdf")]),
      }),
      catalogs: z.tuple([]),
      authors: z.tuple([]),
      tutors: z.tuple([]),
      publications: z.tuple([]),
      attachments: z.tuple([]),
    })
    .strict()
    .parse(read("production/initial.json"));
  return bootstrapInput(environment, {
    BOOTSTRAP_ADMIN_NAME: profile.administrator.name,
    BOOTSTRAP_ADMIN_CI: profile.administrator.ci,
    BOOTSTRAP_ADMIN_USERNAME: profile.administrator.username,
  });
}

export function assertProfileTarget(
  profile: string | undefined,
  environment: NodeJS.ProcessEnv,
) {
  if (
    !["demo", "production"].includes(profile ?? "") ||
    environment.INITIAL_DATA_PROFILE !== profile
  )
    throw Error(
      "Inicialización rechazada: indicar demo o production y el mismo INITIAL_DATA_PROFILE.",
    );
  const url = URL.parse(environment.DATABASE_URL ?? "");
  const name = environment.INITIAL_DATA_DATABASE_NAME;
  if (
    !url ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !name ||
    !/^[a-z][a-z0-9_]*$/.test(name) ||
    url.pathname !== `/${name}`
  )
    throw Error(
      "Inicialización rechazada: DATABASE_URL e INITIAL_DATA_DATABASE_NAME deben identificar la misma base explícita.",
    );
  if (
    profile === "demo" &&
    (environment.NODE_ENV === "production" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !/^fceadatasys_(?:[a-z0-9]+_)*demo(?:_test)?$/.test(name))
  )
    throw Error(
      "Inicialización rechazada: demo requiere una base local exclusiva terminada en _demo o _demo_test, fuera de producción.",
    );
  if (
    profile === "production" &&
    /(?:^|_)demo(?:_|$)|client_connection_test/.test(name)
  )
    throw Error(
      "Inicialización rechazada: la entrega inicial no utiliza bases demo ni la base de integración del cliente.",
    );
  return {
    databaseUrl: url.href,
    databaseName: name,
    profile: profile as "demo" | "production",
  };
}

export async function assertLimitedRuntime(prisma: PrismaClient) {
  const [role] = await prisma.$queryRaw<
    {
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      owner_access: boolean;
    }[]
  >`
    SELECT r.rolsuper,r.rolcreatedb,r.rolcreaterole,
      (pg_has_role(r.oid,c.relowner,'MEMBER') OR pg_has_role(r.oid,d.datdba,'MEMBER')) AS owner_access
    FROM pg_roles r JOIN pg_class c ON c.oid='public.usuarios'::regclass
    JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`;
  if (
    !role ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.owner_access
  )
    throw Error(
      "Inicialización rechazada: usar el rol runtime limitado, después de aplicar migraciones y grants.",
    );
}

export function demoPasswords(
  environment: NodeJS.ProcessEnv,
  dataset: DemoDataset,
) {
  const keys = {
    ADMINISTRADOR: "DEMO_ADMIN_PASSWORD",
    DIGITADOR: "DEMO_DIGITADOR_PASSWORD",
    PUBLICO: "DEMO_PUBLICO_PASSWORD",
  };
  return dataset.people.accounts.map((user) => {
    const password = environment[keys[user.role]];
    if (!password) throw Error(`Falta configuración ${keys[user.role]}.`);
    const parsed = createUserSchema.safeParse({ ...user, password });
    if (!parsed.success)
      throw Error(`Configuración demo inválida: revisar ${keys[user.role]}.`);
    return parsed.data;
  });
}
