import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createApp, type AppOptions } from "../app.js";
import type { AppConfig } from "../config.js";
import { normalizeCatalog } from "../catalogs/schemas.js";
import { bootstrapAdmin } from "./bootstrap.js";
import {
  assertLimitedRuntime,
  assertProfileTarget,
  dataDirectory,
  demoPasswords,
  loadDemoDataset,
} from "./profiles.js";

type Row = {
  id: string;
  name: string;
  active: boolean;
  username?: string;
  role?: string;
  title?: string;
  sha256?: string;
  status?: string;
};
type Page = { data: Row[]; pagination: { totalPages: number } };

export async function initializeDemo(
  prisma: PrismaClient,
  config: AppConfig,
  environment: NodeJS.ProcessEnv,
  progress: (message: string) => void = () => {},
  options: AppOptions = {},
) {
  assertProfileTarget("demo", {
    ...environment,
    DATABASE_URL: config.databaseUrl,
    NODE_ENV: config.nodeEnv,
  });
  await assertLimitedRuntime(prisma);
  const dataset = loadDemoDataset();
  const accounts = demoPasswords(environment, dataset);
  const initial = await bootstrapAdmin(prisma, accounts[0]);
  const app = await createApp(config, prisma, { ...options, logger: false });
  const cookies = new Map<string, string>();
  let accessToken = "";
  let loggedIn = false;
  const counts = {
    usersCreated: Number(initial),
    catalogsCreated: 0,
    publicationsCreated: 0,
    attachmentsCreated: 0,
  };
  async function request<T>(
    path: string,
    method: "GET" | "POST" = "GET",
    body?: unknown,
  ): Promise<T> {
    let payload: string | Buffer | undefined;
    const headers: Record<string, string> = {
      origin: config.allowedOrigins[0],
      "user-agent": "fceadatasys-demo-initializer",
      cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    };
    if (body instanceof FormData) {
      const encoded = new Request("http://127.0.0.1/multipart", {
        method: "POST",
        body,
      });
      headers["content-type"] = encoded.headers.get("content-type")!;
      payload = Buffer.from(await encoded.arrayBuffer());
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const response = await app.inject({
      method,
      url: `/api/v1${path}`,
      headers,
      payload,
      remoteAddress: "127.0.0.1",
    });
    for (const cookie of response.cookies) {
      if (cookie.value) cookies.set(cookie.name, cookie.value);
      else cookies.delete(cookie.name);
    }
    if (response.statusCode >= 400) {
      const code = response.json<{ code?: string }>().code ?? "HTTP_ERROR";
      // No propagar cuerpos de login, encabezados ni errores Prisma al terminal.
      throw Error(
        `Carga demo interrumpida: ${method} ${path.split("?")[0]} respondió ${response.statusCode} ${code}. Los datos confirmados se conservan; corregí la causa y repetí la carga.`,
      );
    }
    return response.statusCode === 204 ? (undefined as T) : response.json<T>();
  }
  async function list(path: string) {
    const all: Row[] = [];
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      const response = await request<Page>(`${path}?page=${page}&pageSize=100`);
      pages = response.pagination.totalPages;
      all.push(...response.data);
    }
    return all;
  }
  try {
    await request("/auth/browser", "POST");
    const login = await request<{ accessToken: string }>(
      "/auth/login",
      "POST",
      { username: accounts[0].username, password: accounts[0].password },
    );
    accessToken = login.accessToken;
    loggedIn = true;
    const users = await list("/usuarios");
    for (const account of accounts.slice(1)) {
      const existing = users.find((user) => user.username === account.username);
      if (existing) {
        if (existing.role !== account.role || !existing.active)
          throw Error(
            "Carga demo interrumpida: una cuenta de demostración existente cambió de rol/estado; no se sobrescribe.",
          );
      } else {
        await request("/usuarios", "POST", account);
        counts.usersCreated++;
      }
    }
    const ids = new Map<string, string>();
    const key = (kind: string, name: string) =>
      `${kind}:${normalizeCatalog(name)}`;
    for (const kind of new Set(dataset.catalogs.map((item) => item.key))) {
      const existing = await list(`/catalogos/${kind}`);
      for (const catalog of dataset.catalogs.filter(
        (item) => item.key === kind,
      )) {
        let row = existing.find(
          (row) =>
            normalizeCatalog(row.name) === normalizeCatalog(catalog.name),
        );
        if (row && !row.active)
          throw Error(
            "Carga demo interrumpida: un catálogo requerido está inactivo; no se reactiva automáticamente.",
          );
        if (!row) {
          row = await request<Row>(`/catalogos/${kind}`, "POST", {
            name: catalog.name,
            fields: catalog.fields,
          });
          counts.catalogsCreated++;
        }
        ids.set(key(kind, catalog.name), row.id);
      }
      progress(
        `Catálogo ${kind}: ${dataset.catalogs.filter((item) => item.key === kind).length} registros preparados.`,
      );
    }
    const publications = await list("/publicaciones");
    const attachments = await list("/adjuntos");
    for (const publication of dataset.publications) {
      if (
        publications.some(
          (row) =>
            normalizeCatalog(row.title ?? "") ===
            normalizeCatalog(publication.title),
        )
      ) {
        progress(`Conservada: ${publication.title}.`);
        continue;
      }
      progress(`Preparando PDF y análisis antivirus: ${publication.title}.`);
      const bytes = await readFile(
        new URL(`demo/documents/${publication.document}`, dataDirectory),
      );
      const hash = createHash("sha256").update(bytes).digest("hex");
      let attachment = attachments.find((row) => row.sha256 === hash);
      if (attachment && attachment.status !== "DISPONIBLE")
        throw Error(
          "Carga demo interrumpida: un documento ya está vinculado, reservado o rechazado; no se reutiliza indebidamente.",
        );
      if (!attachment) {
        const form = new FormData();
        form.set(
          "file",
          new File([new Uint8Array(bytes)], publication.document, {
            type: "application/pdf",
          }),
        );
        attachment = await request<Row>("/adjuntos", "POST", form);
        counts.attachmentsCreated++;
      }
      const identifier = (kind: string, name: string) =>
        ids.get(key(kind, name))!;
      await request("/publicaciones", "POST", {
        title: publication.title,
        summary: publication.summary,
        abstract: publication.abstract,
        keywords: publication.keywords,
        year: publication.year,
        approved: true,
        authorIds: publication.authors.map((name) =>
          identifier("autores", name),
        ),
        tutorIds: publication.tutors.map((name) => identifier("tutores", name)),
        careerId: identifier("carreras", publication.career),
        levelId: identifier("niveles", publication.level),
        typeId: identifier("tipos", publication.type),
        branchId: identifier("filiales", publication.branch),
        source: "LOCAL",
        requiresLibraryCopy: true,
        externalUrl: "",
        attachmentId: attachment.id,
      });
      counts.publicationsCreated++;
      progress(`Registrada: ${publication.title}.`);
    }
    await request("/auth/logout", "POST");
    loggedIn = false;
    return {
      ...counts,
      users: accounts.length,
      catalogs: dataset.catalogs.length,
      publications: dataset.publications.length,
    };
  } finally {
    if (loggedIn) {
      try {
        await request("/auth/logout", "POST");
      } catch {
        progress(
          "No se pudo cerrar la sesión de inicialización; se requiere revisar auditoría y sesión.",
        );
      }
    }
    accessToken = "";
    cookies.clear();
    await app.close();
  }
}
