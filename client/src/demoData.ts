import type { State } from "./model";
import { guardAdmin } from "./model";
import {
  CATALOG_KEYS,
  normalizeCatalog,
  saveCatalogRecord,
  setCatalogActive,
  type CatalogInput,
  type CatalogKey,
} from "./catalogs";
import { registerPublication } from "./publications";
import { requireResult } from "./userService";

const demoPrefix = "fcea-demo-v1";
const demoLabel = " (demo)";

const authorNames = [
  "Lucía Benítez",
  "Mateo Acosta",
  "Camila Rojas",
  "Bruno Villalba",
  "Sofía Cabrera",
  "Nicolás Vera",
  "Valentina Duarte",
  "Diego González",
  "Martina López",
  "Tomás Fernández",
  "Emilia Gómez",
  "Joaquín Ortiz",
  "Paula Méndez",
  "Agustín Núñez",
];
const tutorNames = [
  "Laura Martínez",
  "Andrés Giménez",
  "Carolina Sosa",
  "Gabriel Paredes",
  "Daniela Aquino",
  "Sebastián Leiva",
  "Patricia Franco",
  "Miguel Espínola",
  "Adriana Cáceres",
  "Hugo Valdez",
  "Claudia Ramírez",
  "Ricardo Ayala",
];
const careerNames = [
  "Administración de Empresas",
  "Contaduría Pública",
  "Economía",
  "Comercio Internacional",
];
const levelNames = ["Grado", "Especialización", "Maestría"];
const typeNames = [
  "Trabajo de grado",
  "Artículo científico",
  "Monografía",
  "Proyecto de investigación",
];
const branchNames = [
  "Sede Central de Concepción",
  "Filial Norte",
  "Filial Sur",
];

export const demoPublications = [
  {
    title:
      "Educación financiera y hábitos de ahorro de estudiantes universitarios",
    summary:
      "Ejemplo ficticio sobre educación financiera y hábitos de ahorro de estudiantes universitarios. Describe una propuesta de encuesta y clasificación de prácticas de presupuesto personal. Los datos ilustran el uso del repositorio y no corresponden a un estudio realizado.",
    abstract:
      "Fictional example about financial education and saving habits among university students. It outlines a survey proposal and personal budgeting categories. This record demonstrates the repository and does not report actual research findings.",
    keywords: "educación financiera, ahorro, estudiantes",
    career: 2,
    level: 0,
    type: 0,
    branch: 0,
    daysAgo: 0,
  },
  {
    title: "Digitalización de procesos en microemprendimientos comerciales",
    summary:
      "Caso de demostración sobre herramientas digitales para organizar ventas, compras e inventarios en microemprendimientos. Presenta objetivos y categorías de análisis para una investigación de ejemplo. No contiene información de empresas ni resultados de campo reales.",
    abstract:
      "Demonstration case about digital tools for sales, purchasing and inventory management in small businesses. It presents research objectives and example analysis categories. No actual company information or field results are included.",
    keywords: "digitalización, microemprendimientos, gestión",
    career: 0,
    level: 0,
    type: 0,
    branch: 1,
    daysAgo: 1,
  },
  {
    title: "Costos de producción y rentabilidad en pequeños negocios",
    summary:
      "Publicación ficticia centrada en identificar costos fijos y variables y organizar un esquema de análisis de rentabilidad. El contenido permite mostrar autores, tutores y clasificaciones en el reporte. No representa asesoramiento contable ni mediciones económicas reales.",
    abstract:
      "Fictional publication focused on identifying fixed and variable costs and organizing a profitability analysis outline. It illustrates bibliographic metadata and reporting. No real economic measurements or accounting advice are provided.",
    keywords: "costos, rentabilidad, contabilidad",
    career: 1,
    level: 1,
    type: 1,
    branch: 0,
    daysAgo: 3,
  },
  {
    title: "Inclusión financiera en comunidades rurales",
    summary:
      "Registro de ejemplo acerca de canales de acceso a servicios financieros en comunidades rurales. Propone dimensiones de consulta sobre disponibilidad y formación. Se utiliza exclusivamente para probar filtros del repositorio, sin entrevistas ni estadísticas institucionales reales.",
    abstract:
      "Example record about access channels to financial services in rural communities. It proposes availability and training dimensions for a hypothetical inquiry. This demonstration contains no real interviews or institutional statistics.",
    keywords: "inclusión financiera, comunidades rurales, acceso",
    career: 2,
    level: 2,
    type: 3,
    branch: 2,
    daysAgo: 7,
  },
  {
    title: "Clima laboral y desempeño en organizaciones locales",
    summary:
      "Ejercicio académico ficticio sobre comunicación interna, colaboración y condiciones de trabajo. Sus metadatos permiten presentar una investigación con varios participantes. No identifica organizaciones ni utiliza información personal de trabajadores.",
    abstract:
      "Fictional academic exercise about internal communication, collaboration and working conditions. Its metadata demonstrates a publication with several contributors. No organizations are identified and no employee personal information is used.",
    keywords: "clima laboral, desempeño, organizaciones",
    career: 0,
    level: 1,
    type: 2,
    branch: 0,
    daysAgo: 12,
  },
  {
    title: "Comercio electrónico y preferencias de consumo juvenil",
    summary:
      "Documento de demostración sobre categorías de productos, canales digitales y criterios de compra en un escenario hipotético. Sirve para visualizar clasificaciones y exportaciones. Los consumidores, observaciones y resultados no corresponden a personas ni operaciones reales.",
    abstract:
      "Demonstration document about product categories, digital channels and purchasing criteria in a hypothetical scenario. It supports classification and export examples. No real consumers, observations or transactions are represented.",
    keywords: "comercio electrónico, consumo, canales digitales",
    career: 3,
    level: 0,
    type: 1,
    branch: 1,
    daysAgo: 20,
  },
  {
    title: "Presupuesto familiar y planificación del gasto",
    summary:
      "Muestra ficticia sobre organización de ingresos y gastos en un presupuesto familiar de ejemplo. Incluye una descripción breve para comprobar la búsqueda por título y autor. No incorpora datos de hogares ni recomendaciones financieras personalizadas.",
    abstract:
      "Fictional sample about organizing income and expenses in an example household budget. It includes a short description for title and author search demonstrations. It contains no actual household data or personalized financial recommendations.",
    keywords: "presupuesto, planificación, gasto familiar",
    career: 1,
    level: 0,
    type: 2,
    branch: 2,
    daysAgo: 30,
  },
  {
    title: "Emprendimiento sostenible y desarrollo económico local",
    summary:
      "Investigación de muestra sobre criterios ambientales y sociales en propuestas de emprendimiento. Se presenta como una ficha ficticia para la exposición del sistema. No afirma resultados de impacto ni aprobación académica de un trabajo real.",
    abstract:
      "Sample research record about environmental and social criteria in entrepreneurship proposals. It is presented as a fictional entry for the system demonstration. It claims no actual impact results or academic approval of a real project.",
    keywords: "emprendimiento, sostenibilidad, desarrollo local",
    career: 0,
    level: 2,
    type: 3,
    branch: 0,
    daysAgo: 40,
  },
];

export function demoDocumentPath(index: number): string {
  return `demo/investigacion-${String(index + 1).padStart(2, "0")}.pdf`;
}

function catalogSamples(
  catalog: CatalogKey,
): (CatalogInput & { active?: boolean })[] {
  if (catalog === "autores") {
    return authorNames.map((name, index) => ({
      name: name + demoLabel,
      fields: { email: `autor${index + 1}@demo.example.test` },
      active: index !== authorNames.length - 1,
    }));
  }
  if (catalog === "tutores") {
    return tutorNames.map((name, index) => ({
      name: name + demoLabel,
      fields: {
        email: `tutor${index + 1}@demo.example.test`,
        especialidad: ["Administración", "Contabilidad", "Economía"][index % 3],
      },
      active: index !== tutorNames.length - 1,
    }));
  }
  let names: string[];
  if (catalog === "carreras") names = careerNames;
  else if (catalog === "niveles") names = levelNames;
  else if (catalog === "tipos") names = typeNames;
  else if (catalog === "filiales") names = branchNames;
  else
    names = [
      "Facultad de Ciencias Económicas y Administrativas",
      "Facultad de Estudios Sociales",
    ];
  return names.map((name, index) => {
    const fields: Record<string, string> = {
      descripcion:
        "Registro ficticio para la demostración académica del sistema.",
    };
    if (catalog === "carreras") fields.codigo = `DEMO-CAR-${index + 1}`;
    if (catalog === "facultades") fields.sigla = `DEMO-FAC-${index + 1}`;
    if (catalog === "filiales")
      fields.direccion = "Dirección de muestra, sin ubicación real.";
    return { name: name + demoLabel, fields };
  });
}

export function buildDemoData(
  state: State,
  actorId: string,
  baseUrl: string,
  now = new Date(),
): {
  state: State;
  addedCatalogs: number;
  addedPublications: number;
} {
  // Paso 1: la carga de muestras corresponde exclusivamente a Administrador activo.
  guardAdmin(state, actorId);
  const origin = new URL(baseUrl);
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username ||
    origin.password
  ) {
    throw Error(
      "No se pudo identificar la dirección local de los documentos de muestra.",
    );
  }

  // Paso 2: preparar catálogos sin reemplazar datos ni reactivar registros existentes.
  let prepared = state;
  let addedCatalogs = 0;
  let addedPublications = 0;
  const identifiers = {} as Record<CatalogKey, string[]>;
  for (const catalog of CATALOG_KEYS) {
    identifiers[catalog] = [];
    for (const [index, sample] of catalogSamples(catalog).entries()) {
      const demoKey = `${demoPrefix}/${catalog}/${index + 1}`;
      const existing = prepared.catalogs[catalog].find(
        (record) =>
          record.demoKey === demoKey ||
          normalizeCatalog(record.name) === normalizeCatalog(sample.name),
      );
      if (existing) {
        identifiers[catalog].push(existing.id);
        continue;
      }
      prepared = saveCatalogRecord(prepared, actorId, catalog, sample);
      const added = prepared.catalogs[catalog].at(-1)!;
      prepared = {
        ...prepared,
        catalogs: {
          ...prepared.catalogs,
          [catalog]: prepared.catalogs[catalog].map((record) =>
            record.id === added.id ? { ...record, demoKey } : record,
          ),
        },
      };
      if (sample.active === false)
        prepared = setCatalogActive(
          prepared,
          actorId,
          catalog,
          added.id,
          false,
        );
      identifiers[catalog].push(added.id);
      addedCatalogs += 1;
    }
  }

  // Paso 3: usar las mismas validaciones de registro y devolver una única confirmación local.
  for (const [index, sample] of demoPublications.entries()) {
    const demoKey = `${demoPrefix}/publicaciones/${index + 1}`;
    const title = `${sample.title} — Demostración`;
    if (
      prepared.publications?.some(
        (publication) =>
          publication.demoKey === demoKey ||
          normalizeCatalog(publication.title) === normalizeCatalog(title),
      )
    )
      continue;
    const result = requireResult(
      registerPublication(prepared, actorId, {
        title,
        authorIds: [identifiers.autores[index], identifiers.autores[index + 1]],
        tutorIds: [identifiers.tutores[index]],
        careerId: identifiers.carreras[sample.career],
        levelId: identifiers.niveles[sample.level],
        typeId: identifiers.tipos[sample.type],
        branchId: identifiers.filiales[sample.branch],
        summary: sample.summary,
        abstract: sample.abstract,
        keywords: sample.keywords,
        year: now.getFullYear() - (index % 3),
        approved: true,
        externalUrl: new URL(demoDocumentPath(index), new URL("./", origin))
          .href,
      }),
    );
    const createdAt = new Date(
      now.getTime() - sample.daysAgo * 86400000,
    ).toISOString();
    prepared = {
      ...result.state,
      publications: result.state.publications!.map((publication) =>
        publication.id === result.publication.id
          ? { ...publication, demoKey, createdAt }
          : publication,
      ),
      publicationAudit: result.state.publicationAudit!.map((audit) =>
        audit.publicationId === result.publication.id
          ? { ...audit, createdAt }
          : audit,
      ),
    };
    addedPublications += 1;
  }
  return { state: prepared, addedCatalogs, addedPublications };
}
