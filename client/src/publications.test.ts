import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "./model";
import {
  deleteCatalogRecord,
  saveCatalogRecord,
  setCatalogActive,
} from "./catalogs";
import { preparePdf } from "./attachments";
import { jsPDF } from "jspdf";
import { userDependencies } from "./relations";
import { requireResult } from "./userService";
import {
  emptyReportFilters,
  publicationReport,
  registerPublication,
  registrationDate,
  requiredCatalogs,
  type PublicationInput,
} from "./publications";
import { buildPublicationReport } from "./publicationExports";
import ExcelJS from "exceljs";

async function fixture() {
  let state = await seed();
  const administrator = state.users[0];
  for (const catalog of requiredCatalogs) {
    state = saveCatalogRecord(state, administrator.id, catalog, {
      name: `Ejemplo ${catalog}`,
      fields: {},
    });
  }
  const input: PublicationInput = {
    title: "Gestión económica de las pequeñas empresas de Concepción",
    authorIds: [state.catalogs.autores[0].id],
    tutorIds: [state.catalogs.tutores[0].id],
    careerId: state.catalogs.carreras[0].id,
    levelId: state.catalogs.niveles[0].id,
    typeId: state.catalogs.tipos[0].id,
    branchId: state.catalogs.filiales[0].id,
    summary:
      "Se analizan las prácticas de gestión y su relación con el desarrollo local.",
    abstract: "This study examines management practices and local development.",
    keywords: "gestión, desarrollo, Concepción",
    externalUrl: "https://example.org/investigacion.pdf",
    year: 2026,
    approved: true,
  };
  return {
    state,
    input,
    administrator,
    editor: state.users[1],
    reader: state.users[2],
  };
}

test("El documento requiere enlace o PDF; conserva enlaces anteriores y bloquea la misma huella de archivo", async () => {
  const { state, input, administrator } = await fixture();
  const document = new jsPDF();
  document.text("Prueba de publicación con PDF", 20, 20);
  const attachment = await preparePdf(
    new File([document.output("arraybuffer")], "Trabajo.pdf"),
  );
  assert.equal(
    registerPublication(state, administrator.id, { ...input, externalUrl: "" })
      .exito,
    false,
  );
  assert.equal(
    registerPublication(state, administrator.id, { ...input, attachment })
      .exito,
    false,
  );
  const result = requireResult(
    registerPublication(state, administrator.id, {
      ...input,
      externalUrl: "",
      attachment,
    }),
  );
  assert.equal(result.publication.externalUrl, "");
  assert.equal(result.publication.attachment?.sha256, attachment.sha256);
  const duplicate = registerPublication(result.state, administrator.id, {
    ...input,
    title: "Título diferente",
    summary: "Resumen diferente",
    abstract: "Different text",
    externalUrl: "",
    attachment: { ...attachment, id: crypto.randomUUID() },
  });
  assert.equal(duplicate.exito, false);
  assert.match(duplicate.mensaje, /archivo PDF ya/);
  const persisted = JSON.parse(JSON.stringify(result.state));
  assert.equal(persisted.publications[0].attachment.name, "Trabajo.pdf");
  assert.equal(registerPublication(state, administrator.id, input).exito, true);
  const workbook = new ExcelJS.Workbook();
  const report = await buildPublicationReport(
    result.state,
    administrator.id,
    emptyReportFilters,
    "xlsx",
  );
  await workbook.xlsx.load(report.bytes as unknown as ExcelJS.Buffer);
  assert.equal(
    workbook.getWorksheet("Investigaciones")?.getRow(2).getCell(15).value,
    "Trabajo.pdf",
  );
});

test("No elimina autores, tutores ni clasificaciones referenciadas por una investigación", async () => {
  const { state, input, administrator } = await fixture();
  const registered = requireResult(
    registerPublication(state, administrator.id, input),
  );
  const original = JSON.stringify(registered.state);
  for (const catalog of requiredCatalogs) {
    assert.throws(
      () =>
        deleteCatalogRecord(
          registered.state,
          administrator.id,
          catalog,
          registered.state.catalogs[catalog][0].id,
        ),
      /vinculado/,
    );
  }
  assert.equal(JSON.stringify(registered.state), original);
});

test("La transacción guarda investigación, participantes y bitácora juntos sin alterar el estado original", async () => {
  const { state, input, editor } = await fixture();
  const original = JSON.stringify(state);
  const result = requireResult(registerPublication(state, editor.id, input));
  assert.equal(JSON.stringify(state), original);
  assert.equal(result.state.publications?.length, 1);
  assert.equal(
    result.state.publicationAudit?.[0].publicationId,
    result.publication.id,
  );
  assert.equal(result.state.repositoryLinks?.[0].userId, editor.id);
  assert.match(
    userDependencies(result.state, editor.id).join(" "),
    /investigación/,
  );
  const reopened = JSON.parse(JSON.stringify(result.state));
  assert.equal(reopened.publications[0].title, input.title);
  assert.equal(result.publication.code, "INV-00001");
});

test("Rechaza roles, cuentas inactivas, referencias inexistentes/inactivas y autores repetidos sin escrituras parciales", async () => {
  const { state, input, editor, reader } = await fixture();
  assert.equal(registerPublication(state, reader.id, input).exito, false);
  const inactive = {
    ...state,
    users: state.users.map((account) => ({ ...account, active: false })),
  };
  assert.equal(registerPublication(inactive, editor.id, input).exito, false);
  for (const patch of [
    { authorIds: [] },
    { authorIds: [input.authorIds[0], input.authorIds[0]] },
    { tutorIds: ["missing"] },
    { careerId: "missing" },
    { approved: false },
    { summary: "palabra ".repeat(301) },
    { title: " " },
    { externalUrl: "javascript:alert(1)" },
    { externalUrl: "https://user:password@example.org" },
    { year: 3000 },
  ]) {
    const result = registerPublication(state, editor.id, {
      ...input,
      ...patch,
    });
    assert.equal(result.exito, false, JSON.stringify(patch));
    assert.equal(state.publications, undefined);
    assert.equal(state.publicationAudit, undefined);
  }
  const inactiveCatalog = {
    ...state,
    catalogs: {
      ...state.catalogs,
      carreras: state.catalogs.carreras.map((entry) => ({
        ...entry,
        active: false,
      })),
    },
  };
  assert.equal(
    registerPublication(inactiveCatalog, editor.id, input).exito,
    false,
  );
  assert.equal(
    registerPublication(state, editor.id, {
      ...input,
      summary: "palabra ".repeat(300),
    }).exito,
    true,
  );
});

test("Normaliza duplicados de título, resumen y abstract, y conserva los nombres históricos", async () => {
  const { state, input, administrator } = await fixture();
  const registered = requireResult(
    registerPublication(state, administrator.id, input),
  );
  for (const field of ["title", "summary", "abstract"] as const) {
    const next = {
      ...input,
      title: "Otra investigación",
      summary: "Otro resumen",
      abstract: "Another abstract",
    };
    next[field] =
      ` ${input[field].toUpperCase().normalize("NFD").replace(/\p{M}/gu, "")} !!! `;
    assert.equal(
      registerPublication(registered.state, administrator.id, next).exito,
      false,
    );
  }
  assert.throws(
    () =>
      setCatalogActive(
        registered.state,
        administrator.id,
        "carreras",
        input.careerId,
        false,
      ),
    /vinculado/,
  );
  const changed = saveCatalogRecord(
    registered.state,
    administrator.id,
    "carreras",
    { name: "Nombre nuevo", fields: {} },
    input.careerId,
  );
  assert.equal(changed.publications?.[0].career.name, "Ejemplo carreras");
});

test("Reporte restringido al administrador, filtros inclusivos y selección de la misma transacción", async () => {
  const { state, input, administrator, editor, reader } = await fixture();
  const first = requireResult(registerPublication(state, editor.id, input));
  const second = requireResult(
    registerPublication(first.state, administrator.id, {
      ...input,
      title: "Otro título",
      summary: "Otro resumen de investigación",
      abstract: "A second abstract",
    }),
  );
  const today = registrationDate(first.publication.createdAt);
  assert.equal(
    publicationReport(second.state, administrator.id, {
      ...emptyReportFilters,
      from: today,
      to: today,
    }).length,
    2,
  );
  const single = publicationReport(second.state, administrator.id, {
    ...emptyReportFilters,
    publicationId: first.publication.id,
  });
  assert.equal(single.length, 1);
  assert.equal(single[0].title, input.title);
  assert.equal(
    publicationReport(second.state, administrator.id, {
      ...emptyReportFilters,
      careerId: "other",
    }).length,
    0,
  );
  assert.equal(
    publicationReport(second.state, administrator.id, {
      ...emptyReportFilters,
      levelId: "other",
    }).length,
    0,
  );
  for (const account of [editor, reader]) {
    assert.throws(
      () => publicationReport(second.state, account.id, emptyReportFilters),
      /permiso/,
    );
  }
  assert.throws(
    () =>
      publicationReport(second.state, administrator.id, {
        ...emptyReportFilters,
        from: "2026-10-15",
        to: "2026-10-10",
      }),
    /inicial/,
  );
  assert.throws(
    () =>
      publicationReport(second.state, administrator.id, {
        ...emptyReportFilters,
        from: "2026-02-30",
      }),
    /válidas/,
  );
  assert.equal(registrationDate("2026-10-14T01:00:00Z"), "2026-10-13");
});

test("Exportaciones PDF y Excel contienen los registros seleccionados; sin datos no se genera archivo", async () => {
  const { state, input, administrator, reader } = await fixture();
  await assert.rejects(
    buildPublicationReport(state, administrator.id, emptyReportFilters, "pdf"),
    /No hay/,
  );
  await assert.rejects(
    buildPublicationReport(state, reader.id, emptyReportFilters, "xlsx"),
    /permiso/,
  );
  const registered = requireResult(
    registerPublication(state, administrator.id, input),
  );
  const pdf = await buildPublicationReport(
    registered.state,
    administrator.id,
    emptyReportFilters,
    "pdf",
  );
  assert.equal(new TextDecoder().decode(pdf.bytes.slice(0, 5)), "%PDF-");
  assert.match(new TextDecoder("latin1").decode(pdf.bytes), /INV-00001/);
  const excel = await buildPublicationReport(
    registered.state,
    administrator.id,
    emptyReportFilters,
    "xlsx",
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(excel.bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("Investigaciones")!;
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell("B2").value, input.title);
  assert.equal(sheet.getCell("M2").value, input.summary);
  assert.equal(sheet.getCell("O2").value, input.externalUrl);
});
