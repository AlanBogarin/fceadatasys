import test from "node:test";
import { catalogFields } from "../../server/test/helpers/catalog-fields";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { apiFixture, testAdmin, testPassword } from "./api-fixture";
import {
  createClamScanner,
  type Scanner,
} from "../../server/src/attachments/scanner.js";
import { AppError } from "../../server/src/errors.js";
import { ClientProblem } from "../src/data/problems";
import { canSelectAttachment } from "../src/data/apiPublications";
import { emptyBibliographicFilters } from "../src/bibliography";
import { emptyReportFilters } from "../src/publications";
import type {
  AttachmentDto,
  PublicationCreateDto,
  UserDto,
} from "../src/data/contracts";

const failure = (code: string) => (error: unknown) =>
  error instanceof ClientProblem && error.code === code;
test("Pasos 16–20: archivos, publicaciones, consulta y reportes reales", async (t) => {
  let scan: Scanner["scan"] = async () => ({
    clean: true,
    engine: "fixture explícito",
  });
  const fixture = await apiFixture({
    scanner: { scan: (bytes) => scan(bytes) },
  });
  t.after(() => fixture.close());
  const suffix = randomUUID().slice(0, 8);
  const browser = fixture.browser();
  const admin = browser.tab();
  await admin.client.auth.initializeBrowser();
  await admin.client.auth.login(testAdmin, testPassword);
  const accounts: { user: UserDto; tab: typeof admin }[] = [];
  for (const role of ["DIGITADOR", "DIGITADOR", "PUBLICO"] as const) {
    const username = `pub.${suffix}.${accounts.length}`;
    const user = await admin.client.users.create(
      {
        name: `Publicaciones ${role} ${suffix}`,
        username,
        ci: fixture.ci(),
        email: `${username}@example.test`,
        role,
        active: true,
      },
      testPassword,
    );
    const tab = fixture.browser().tab();
    await tab.client.auth.initializeBrowser();
    await tab.client.auth.login(username, testPassword);
    accounts.push({ user, tab });
  }
  const [digitador, other, publico] = accounts.map((account) => account.tab);
  const refs: Record<string, string> = {};
  for (const key of [
    "autores",
    "tutores",
    "carreras",
    "niveles",
    "tipos",
    "filiales",
  ] as const)
    refs[key] = (
      await admin.client.catalogs.save(key, {
        name: `Conexión publicaciones ${key} ${suffix}`,
        fields: catalogFields(key),
      })
    ).data.id;
  const secondAuthor = (
    await admin.client.catalogs.save("autores", {
      name: `Coautor ordenado ${suffix}`,
      fields: catalogFields("autores"),
    })
  ).data.id;
  let sequence = 0;
  const input = (
    extra: Partial<PublicationCreateDto> = {},
  ): PublicationCreateDto => {
    const label = `${suffix} ${++sequence}`;
    return {
      title: `Economía regional conexión ${label}`,
      summary: `Educación financiera y economía regional ${label}`,
      abstract: `Regional savings research and financial literacy ${label}`,
      keywords: "economía, savings, educación",
      authorIds: [secondAuthor, refs.autores],
      tutorIds: [refs.tutores],
      careerId: refs.carreras,
      levelId: refs.niveles,
      typeId: refs.tipos,
      branchId: refs.filiales,
      year: 2026,
      approved: true,
      source: "EXTERNA",
      requiresLibraryCopy: false,
      externalUrl: `https://example.test/${label.replaceAll(" ", "-")}`,
      ...extra,
    };
  };
  const base = await readFile(
    new URL(
      "../../server/data/demo/documents/Educacion-financiera-y-ahorro.pdf",
      import.meta.url,
    ),
  );
  const pdf = () =>
    new File(
      [
        new Uint8Array(
          Buffer.from(
            base
              .toString("latin1")
              .replace("%%EOF", `% ${randomUUID()}\n%%EOF`),
            "latin1",
          ),
        ),
      ],
      `Investigación ${suffix} ${sequence++}.pdf`,
      { type: "application/pdf" },
    );
  let fileA: AttachmentDto;
  let fileB: AttachmentDto;
  let publicationId: string;

  await t.test(
    "PDF inicial y TXT habilitado pasan ClamAV real; archivo inválido, duplicado y scanner caído fallan cerrado",
    async () => {
      const setting = await admin.client.settings.get();
      await admin.client.settings.update(
        { allowedFormats: ["pdf"] },
        { ifMatch: setting.etag },
      );
      await assert.rejects(
        admin.client.attachments.upload(
          new File(["texto"], "texto.txt", { type: "text/plain" }),
        ),
        failure("INVALID_ATTACHMENT"),
      );
      const real = createClamScanner(fixture.config.attachments);
      scan = (bytes) => real.scan(bytes);
      const document = pdf();
      fileA = await digitador.client.attachments.upload(document);
      assert.equal(fileA.status, "DISPONIBLE");
      assert.equal(fileA.reservedPublicationId, null);
      assert.equal(fileA.createdBy.id, accounts[0].user.id);
      assert.match(fileA.sha256, /^[a-f0-9]{64}$/);
      await assert.rejects(
        digitador.client.attachments.upload(document),
        failure("DUPLICATE_ATTACHMENT"),
      );
      const current = await admin.client.settings.get();
      await admin.client.settings.update(
        { allowedFormats: ["pdf", "txt"] },
        { ifMatch: current.etag },
      );
      const text = await admin.client.attachments.upload(
        new File([`Investigación en UTF-8 ${suffix}`], `Notas ${suffix}.txt`, {
          type: "text/plain",
        }),
      );
      assert.equal(text.mime, "text/plain");
      await assert.rejects(
        admin.client.attachments.upload(
          new File(["No es PDF"], "falso.pdf", { type: "application/pdf" }),
        ),
        failure("INVALID_ATTACHMENT"),
      );
      scan = async () => {
        throw new AppError(
          503,
          "ANTIMALWARE_UNAVAILABLE",
          "Scanner no disponible",
        );
      };
      const before = await fixture.prisma.storedAttachment.count();
      await assert.rejects(
        admin.client.attachments.upload(pdf()),
        failure("ANTIMALWARE_UNAVAILABLE"),
      );
      assert.equal(await fixture.prisma.storedAttachment.count(), before);
      scan = async () => ({
        clean: false,
        engine: "fixture explícito",
        signature: "Prueba inocua simulada",
      });
      await assert.rejects(
        admin.client.attachments.upload(pdf()),
        failure("ATTACHMENT_REJECTED"),
      );
      scan = async () => ({ clean: true, engine: "fixture explícito" });
    },
  );

  await t.test(
    "Listado paginado, contadores globales y alcance de cargas; cancelación posterior conserva el archivo",
    async () => {
      fileB = await digitador.client.attachments.upload(pdf());
      const own = await digitador.client.attachments.list({
        page: 1,
        pageSize: 1,
      });
      assert.equal(own.data.length, 1);
      assert.ok(own.pagination.total >= 2);
      const all = await digitador.client.attachments.list({
        status: "DISPONIBLE",
        pageSize: 100,
      });
      assert.equal(own.summary.DISPONIBLE, all.pagination.total);
      assert.equal(
        (await digitador.client.attachments.get(fileA.id)).id,
        fileA.id,
      );
      await assert.rejects(
        other.client.attachments.get(fileA.id),
        failure("FORBIDDEN"),
      );
      for (const read of [
        () => publico.client.attachments.list(),
        () => publico.client.attachments.get(fileA.id),
        () => publico.client.attachments.upload(pdf()),
      ])
        await assert.rejects(read(), failure("FORBIDDEN"));
      assert.ok(
        (
          await digitador.client.attachments.list({ search: fileB.name })
        ).data.some((file) => file.id === fileB.id),
      );
      // Abrir/cancelar el formulario no ejecuta POST de publicaciones ni elimina el upload confirmado.
      assert.equal(
        (await digitador.client.attachments.get(fileB.id)).id,
        fileB.id,
      );
    },
  );

  await t.test(
    "Registro local/externo/sin copia, autoría ordenada, validación, duplicados y ETag entre pestañas",
    async () => {
      const local = await digitador.client.publications.create(
        input({
          source: "LOCAL",
          externalUrl: "",
          requiresLibraryCopy: true,
          attachmentId: fileA.id,
        }),
      );
      publicationId = local.id;
      assert.equal(local.hasAttachment, true);
      assert.deepEqual(
        local.authors.map((person) => person.id),
        [secondAuthor, refs.autores],
      );
      const externalInput = input();
      await admin.client.publications.create(externalInput);
      await assert.rejects(
        admin.client.publications.create({
          ...input(),
          title: externalInput.title.toUpperCase().replaceAll(" ", "  "),
        }),
        failure("DUPLICATE_PUBLICATION"),
      );
      await assert.rejects(
        admin.client.publications.create({
          ...input(),
          summary: externalInput.summary,
        }),
        failure("DUPLICATE_PUBLICATION"),
      );
      await assert.rejects(
        admin.client.publications.create({
          ...input(),
          abstract: externalInput.abstract,
        }),
        failure("DUPLICATE_PUBLICATION"),
      );
      await admin.client.publications.create(
        input({ source: "LOCAL", externalUrl: "", requiresLibraryCopy: false }),
      );
      await assert.rejects(
        admin.client.publications.create(
          input({
            source: "LOCAL",
            externalUrl: "",
            requiresLibraryCopy: true,
          }),
        ),
        failure("VALIDATION_ERROR"),
      );
      await assert.rejects(
        admin.client.publications.create(input({ careerId: refs.niveles })),
        failure("INVALID_PUBLICATION_REFERENCE"),
      );
      const tab = browser.tab();
      await tab.runtime.restore();
      const stale = await tab.client.publications.get(local.id);
      const before = await digitador.client.publications.get(local.id);
      const changed = await digitador.client.publications.update(
        local.id,
        {
          title: `${local.title} corregida`,
          authorIds: [refs.autores, secondAuthor],
        },
        { ifMatch: before.etag },
      );
      assert.equal(changed.id, local.id);
      assert.equal(changed.code, local.code);
      assert.deepEqual(changed.createdBy, local.createdBy);
      assert.equal(changed.createdAt, local.createdAt);
      assert.deepEqual(
        changed.authors.map((person) => person.id),
        [refs.autores, secondAuthor],
      );
      const revision = tab.runtime.getSnapshot().revision;
      await assert.rejects(
        tab.client.publications.update(
          local.id,
          { title: "No sobrescribir" },
          { ifMatch: stale.etag },
        ),
        failure("PRECONDITION_FAILED"),
      );
      assert.equal(tab.runtime.getSnapshot().revision, revision);
      assert.equal(
        (await tab.client.publications.get(local.id)).data.title,
        changed.title,
      );
      await assert.rejects(
        publico.client.publications.create(input()),
        failure("FORBIDDEN"),
      );
    },
  );

  await t.test(
    "H3: A → B → otro navegador → A original; reserva oculta nunca disponible y descarga por publicación",
    async () => {
      const before = await digitador.client.publications.get(publicationId);
      await digitador.client.publications.update(
        publicationId,
        { attachmentId: fileB.id },
        { ifMatch: before.etag },
      );
      const otherBrowser = fixture.browser().tab();
      await otherBrowser.client.auth.initializeBrowser();
      await otherBrowser.client.auth.login(
        accounts[0].user.username,
        testPassword,
      );
      const historical = (
        await otherBrowser.client.attachments.list({
          status: "RESERVADO",
          search: fileA.name,
        })
      ).data.find((file) => file.id === fileA.id)!;
      assert.equal(historical.status, "RESERVADO");
      assert.equal(historical.reservedPublicationId, publicationId);
      assert.equal(canSelectAttachment(historical), false);
      assert.equal(canSelectAttachment(historical, publicationId), true);
      await assert.rejects(
        admin.client.publications.create(
          input({
            source: "LOCAL",
            externalUrl: "",
            requiresLibraryCopy: true,
            attachmentId: fileA.id,
          }),
        ),
        failure("DUPLICATE_PUBLICATION"),
      );
      const current = await otherBrowser.client.publications.get(publicationId);
      await otherBrowser.client.publications.update(
        publicationId,
        { attachmentId: fileA.id },
        { ifMatch: current.etag },
      );
      const downloaded = await otherBrowser.client.attachments.download(
        fileA.id,
        publicationId,
      );
      assert.ok("bytes" in downloaded);
      assert.equal(
        new TextDecoder().decode(downloaded.bytes.slice(0, 4)),
        "%PDF",
      );
      assert.equal(downloaded.filename, fileA.name);
      const info = await publico.client.publications.get(publicationId);
      assert.equal(info.data.hasAttachment, true);
      assert.equal("attachment" in info.data, false);
      assert.doesNotMatch(
        JSON.stringify(info.data),
        /sha256|storageKey|correo|orc_id|password/,
      );
      await assert.rejects(
        publico.client.attachments.download(fileA.id, publicationId),
        failure("FORBIDDEN"),
      );
    },
  );

  await t.test(
    "FTS bilingüe/acentos, AND, nombres/IDs, fechas institucionales, vacío y paginación reales",
    async () => {
      const filters = {
        ...emptyBibliographicFilters,
        careerId: refs.carreras,
        search: "economia savings",
      };
      const result = await publico.client.publications.list(filters, 1, 1);
      assert.equal(result.data.length, 1);
      assert.ok(result.pagination.total >= 3);
      const second = await publico.client.publications.list(filters, 2, 1);
      assert.notEqual(result.data[0].id, second.data[0].id);
      assert.equal(second.pagination.total, result.pagination.total);
      const record = (await admin.client.publications.get(publicationId)).data;
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Asuncion",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(record.createdAt));
      const exact = {
        ...filters,
        author: record.authors[0].name.toUpperCase(),
        tutor: record.tutors[0].name,
        authorId: record.authors[0].id,
        tutorId: record.tutors[0].id,
        code: record.code,
        year: String(record.year),
        source: "LOCAL",
        from: day,
        to: day,
      };
      assert.equal(
        (await publico.client.publications.list(exact)).pagination.total,
        1,
      );
      assert.equal(
        (
          await publico.client.publications.list({
            ...exact,
            source: "EXTERNA",
          })
        ).pagination.total,
        0,
      );
      assert.equal(
        (
          await publico.client.publications.list({
            ...filters,
            search: "econo",
          })
        ).pagination.total,
        0,
      );
      const empty = await publico.client.publications.list({
        ...filters,
        search: randomUUID(),
      });
      assert.deepEqual(empty.data, []);
      assert.equal(empty.pagination.total, 0);
      await assert.rejects(
        publico.client.publications.list({ ...filters, from: "2026-02-30" }),
        failure("VALIDATION_ERROR"),
      );
    },
  );

  await t.test(
    "Reporte exporta PDF/Excel del conjunto completo, entrada publicationId, snapshot, vacío y permisos",
    async () => {
      const filters = { ...emptyReportFilters, careerId: refs.carreras };
      const report = await admin.client.reports.list(filters, 1, 1);
      assert.equal(report.data.length, 1);
      assert.ok(report.pagination.total >= 3);
      assert.ok(report.report.snapshot);
      const pdfResult = await admin.client.reports.export(
        filters,
        "pdf",
        report.report.snapshot,
      );
      assert.ok("bytes" in pdfResult);
      assert.equal(
        new TextDecoder().decode(pdfResult.bytes.slice(0, 4)),
        "%PDF",
      );
      const excel = await admin.client.reports.export(
        filters,
        "xlsx",
        report.report.snapshot,
      );
      assert.ok("bytes" in excel);
      const ExcelJS = createRequire(
        new URL("../../server/package.json", import.meta.url),
      )("exceljs");
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(Buffer.from(excel.bytes));
      const codes = book
        .getWorksheet("Investigaciones")
        .getSheetValues()
        .flat(2)
        .filter(
          (value: unknown) =>
            typeof value === "string" && /^INV-\d+$/.test(value),
        );
      assert.equal(codes.length, report.pagination.total);
      const singleFilters = { ...emptyReportFilters, publicationId };
      const single = await admin.client.reports.list(singleFilters);
      assert.equal(single.pagination.total, 1);
      assert.ok(single.report.snapshot);
      assert.ok(
        "bytes" in
          (await admin.client.reports.export(
            singleFilters,
            "pdf",
            single.report.snapshot,
          )),
      );
      const before = await admin.client.publications.get(publicationId);
      await admin.client.publications.update(
        publicationId,
        { keywords: `economía savings revisión ${suffix}` },
        { ifMatch: before.etag },
      );
      await assert.rejects(
        admin.client.reports.export(
          singleFilters,
          "pdf",
          single.report.snapshot,
        ),
        failure("REPORT_VERSION_CONFLICT"),
      );
      const none = { ...emptyReportFilters, publicationId: randomUUID() };
      const empty = await admin.client.reports.list(none);
      assert.equal(empty.report.snapshot, null);
      assert.equal(empty.report.exportable, false);
      assert.deepEqual(
        await admin.client.reports.export(none, "pdf", "0".repeat(64)),
        { data: [], total: 0 },
      );
      for (const tab of [digitador, publico]) {
        await assert.rejects(
          tab.client.reports.list(filters),
          failure("FORBIDDEN"),
        );
        await assert.rejects(
          tab.client.reports.export(filters, "pdf", report.report.snapshot),
          failure("FORBIDDEN"),
        );
      }
    },
  );

  await t.test(
    "Auditoría fallida revierte publicación y upload; descarga/exportación no entregan bytes",
    async () => {
      const failedInput = input();
      fixture.failingAudit.add("REGISTRAR_INVESTIGACION");
      const revision = admin.runtime.getSnapshot().revision;
      await assert.rejects(
        admin.client.publications.create(failedInput),
        failure("AUDIT_UNAVAILABLE"),
      );
      assert.equal(admin.runtime.getSnapshot().revision, revision);
      assert.equal(
        await fixture.prisma.publication.count({
          where: { title: failedInput.title },
        }),
        0,
      );
      fixture.failingAudit.clear();
      fixture.failingAudit.add("ADJUNTO_CARGADO");
      const before = await fixture.prisma.storedAttachment.count();
      await assert.rejects(
        admin.client.attachments.upload(pdf()),
        failure("AUDIT_UNAVAILABLE"),
      );
      assert.equal(await fixture.prisma.storedAttachment.count(), before);
      fixture.failingAudit.clear();
      fixture.failingAudit.add("DESCARGAR_ADJUNTO");
      await assert.rejects(
        admin.client.attachments.download(fileA.id, publicationId),
        failure("AUDIT_UNAVAILABLE"),
      );
      fixture.failingAudit.clear();
      const filters = { ...emptyReportFilters, publicationId };
      const query = await admin.client.reports.list(filters);
      assert.ok(query.report.snapshot);
      fixture.failingAudit.add("REPORTE_EXPORTADO");
      await assert.rejects(
        admin.client.reports.export(filters, "pdf", query.report.snapshot),
        failure("AUDIT_UNAVAILABLE"),
      );
      fixture.failingAudit.clear();
    },
  );

  await t.test(
    "Inactivación conserva historia, restringe consulta/descarga y oculta reserva ajena a Digitador",
    async () => {
      const initial = await admin.client.publications.get(publicationId);
      await assert.rejects(
        digitador.client.publications.inactivate(publicationId, {
          ifMatch: initial.etag,
        }),
        failure("FORBIDDEN"),
      );
      await admin.client.publications.inactivate(publicationId, {
        ifMatch: initial.etag,
      });
      const historical = await admin.client.publications.get(publicationId);
      assert.equal(historical.data.active, false);
      for (const tab of [digitador, publico])
        await assert.rejects(
          tab.client.publications.get(publicationId),
          failure("NOT_FOUND"),
        );
      await assert.rejects(
        digitador.client.attachments.download(fileA.id, publicationId),
        failure("NOT_FOUND"),
      );
      assert.ok(
        "bytes" in
          (await admin.client.attachments.download(fileA.id, publicationId)),
      );
      const reserved = (
        await digitador.client.attachments.list({
          status: "RESERVADO",
          search: fileB.name,
        })
      ).data.find((file) => file.id === fileB.id)!;
      assert.equal(reserved.status, "RESERVADO");
      assert.equal(reserved.reservedPublicationId, null);
      assert.equal(canSelectAttachment(reserved), false);
      const audits = await fixture.prisma.auditLog.findMany({
        where: { publicationId },
        select: { operation: true, status: true },
      });
      for (const operation of [
        "REGISTRAR_INVESTIGACION",
        "PUBLICACION_MODIFICADA",
        "DESCARGAR_ADJUNTO",
        "REPORTE_EXPORTADO",
        "PUBLICACION_INACTIVADA",
      ])
        assert.ok(
          audits.some(
            (event) =>
              event.operation === operation && event.status === "EXITO",
          ),
          operation,
        );
    },
  );
});
