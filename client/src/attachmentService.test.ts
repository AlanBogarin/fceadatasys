import { test } from "node:test";
import assert from "node:assert/strict";
import { seed, type State } from "./model";
import { buildDemoData } from "./demoData";
import {
  attachmentRecords,
  availableAttachments,
  uploadAttachment,
} from "./attachmentService";
import { registerPublication, type PublicationInput } from "./publications";
import { requireResult } from "./userService";
import { userDependencies } from "./relations";
import { canOpenPage } from "./security";

async function fixture() {
  const initial = await seed();
  let state = buildDemoData(
    initial,
    initial.users[0].id,
    "http://localhost:5173",
  ).state;
  const [admin, editor, reader] = state.users;
  const source = state.publications![0];
  const input: PublicationInput = {
    title: "Nueva investigación sobre documentos",
    summary: "Resumen original de la carga de archivos.",
    abstract: "An original abstract for attachment registration.",
    keywords: "documentos, biblioteca",
    authorIds: source.authors.map((entry) => entry.id),
    tutorIds: source.tutors.map((entry) => entry.id),
    careerId: source.career.id,
    levelId: source.level.id,
    typeId: source.type.id,
    branchId: source.branch.id,
    year: 2026,
    approved: true,
    externalUrl: "",
    source: "LOCAL",
  };
  const bytes = new Map<string, Blob>();
  const operations: string[] = [];
  const file = new File(
    ["%PDF-1.7\nUnit test fixture\n%%EOF\n"],
    "Trabajo.pdf",
    { type: "application/pdf" },
  );
  const commit = (next: State) => {
    operations.push("commit");
    state = next;
  };
  const write = async (id: string, blob?: Blob) => {
    operations.push(blob ? "write" : "remove");
    if (blob) bytes.set(id, blob);
    else bytes.delete(id);
  };
  const upload = (actorId = editor.id, candidate = file) =>
    uploadAttachment({
      state,
      actorId,
      file: candidate,
      commit,
      write,
      assertActive() {},
    });
  return {
    get state() {
      return state;
    },
    admin,
    editor,
    reader,
    input,
    file,
    upload,
    write,
    commit,
    bytes,
    operations,
  };
}

test("Carga previa: guarda binario, metadatos y bitácora; conserva datos anteriores sin crear publicaciones", async () => {
  const f = await fixture();
  const before = JSON.stringify(f.state);
  const count = f.state.publications!.length;
  const result = await f.upload();
  assert.deepEqual(f.operations, ["write", "commit"]);
  assert.equal(f.bytes.get(result.attachment.id), f.file);
  assert.equal(f.state.publications!.length, count);
  assert.equal(f.state.attachmentAudit?.[0].operation, "ADJUNTO_CARGADO");
  assert.equal(f.state.attachmentAudit?.[0].status, "EXITO");
  assert.equal(availableAttachments(JSON.parse(before), f.editor.id).length, 0);
  assert.equal(
    availableAttachments(JSON.parse(JSON.stringify(f.state)), f.editor.id)[0]
      .attachment.id,
    result.attachment.id,
  );
  assert.ok(
    userDependencies(f.state, f.editor.id).some((entry) =>
      entry.includes(result.attachment.id),
    ),
  );
});

test("Duplicados: rechaza copias renombradas, tanto disponibles como vinculadas, y audita el rechazo", async () => {
  const f = await fixture();
  const upload = await f.upload();
  const renamed = new File([f.file], "Otro nombre.pdf");
  await assert.rejects(f.upload(f.admin.id, renamed), /duplicado/);
  assert.equal(f.bytes.size, 1);
  assert.equal(f.state.attachmentAudit?.at(-1)?.operation, "ADJUNTO_RECHAZADO");
  const registered = requireResult(
    registerPublication(f.state, f.editor.id, {
      ...f.input,
      attachmentId: upload.attachment.id,
    }),
  );
  f.commit(registered.state);
  await assert.rejects(f.upload(f.editor.id, renamed), /duplicado/);
  // También detecta adjuntos de versiones previas, sin registro de carga separado.
  const legacy = { ...f.state, uploadedAttachments: undefined };
  await assert.rejects(
    uploadAttachment({
      state: legacy,
      actorId: f.admin.id,
      file: f.file,
      commit: f.commit,
      write: f.write,
      assertActive() {},
    }),
    /duplicado/,
  );
  assert.equal(f.bytes.size, 1);
});

test("Permisos: Público, usuarios inactivos y Digitador ajeno no pueden cargar o vincular; Admin puede vincular", async () => {
  const f = await fixture();
  assert.equal(canOpenPage("PUBLICO", "archivos"), false);
  assert.equal(canOpenPage("DIGITADOR", "archivos"), true);
  await assert.rejects(f.upload(f.reader.id), /permiso/);
  assert.throws(() => attachmentRecords(f.state, f.reader.id), /permiso/);
  const inactive = {
    ...f.state,
    users: f.state.users.map((u) =>
      u.id === f.editor.id ? { ...u, active: false } : u,
    ),
  };
  await assert.rejects(
    uploadAttachment({
      state: inactive,
      actorId: f.editor.id,
      file: f.file,
      commit: f.commit,
      write: f.write,
      assertActive() {},
    }),
    /permiso/,
  );
  assert.equal(f.operations.length, 0);
  const adminFile = await f.upload(f.admin.id);
  assert.equal(availableAttachments(f.state, f.editor.id).length, 0);
  const denied = registerPublication(f.state, f.editor.id, {
    ...f.input,
    attachmentId: adminFile.attachment.id,
  });
  assert.equal(denied.exito, false);
  assert.match(denied.mensaje, /permiso/);
  const editorFile = await f.upload(
    f.editor.id,
    new File(["%PDF-1.7\nDifferent fixture\n%%EOF"], "Segundo.pdf"),
  );
  assert.equal(availableAttachments(f.state, f.admin.id).length, 2);
  const linked = requireResult(
    registerPublication(f.state, f.admin.id, {
      ...f.input,
      attachmentId: editorFile.attachment.id,
    }),
  );
  const otherEditor: State = {
    ...linked.state,
    users: linked.state.users.map((user) =>
      user.id === f.reader.id ? { ...user, role: "DIGITADOR" } : user,
    ),
  };
  assert.equal(availableAttachments(otherEditor, f.reader.id).length, 0);
  assert.equal(
    attachmentRecords(otherEditor, f.reader.id)[0].createdBy.id,
    f.editor.id,
  );
});

test("Vinculación: usa el ID guardado una sola vez y conserva el archivo si falla el registro", async () => {
  const f = await fixture();
  const upload = await f.upload();
  const bad = registerPublication(f.state, f.editor.id, {
    ...f.input,
    title: "",
    attachmentId: upload.attachment.id,
  });
  assert.equal(bad.exito, false);
  assert.equal(availableAttachments(f.state, f.editor.id).length, 1);
  const saved = requireResult(
    registerPublication(f.state, f.editor.id, {
      ...f.input,
      attachmentId: upload.attachment.id,
    }),
  );
  assert.deepEqual(saved.publication.attachment, upload.attachment);
  assert.equal(saved.publication.source, "LOCAL");
  assert.equal(availableAttachments(saved.state, f.editor.id).length, 0);
  assert.equal(
    attachmentRecords(saved.state, f.editor.id).filter(
      (entry) => entry.attachment.id === upload.attachment.id,
    ).length,
    1,
  );
  const duplicate = registerPublication(saved.state, f.editor.id, {
    ...f.input,
    title: "Otro título",
    summary: "Otro resumen",
    abstract: "Other abstract",
    attachmentId: upload.attachment.id,
  });
  assert.equal(duplicate.exito, false);
  assert.match(duplicate.mensaje, /ya está adjuntado/);
  assert.equal(
    registerPublication(f.state, f.editor.id, {
      ...f.input,
      attachment: upload.attachment,
    }).exito,
    false,
  );
  assert.equal(
    registerPublication(f.state, f.editor.id, {
      ...f.input,
      attachmentId: crypto.randomUUID(),
    }).exito,
    false,
  );
});

test("Modalidades: exige copia de Biblioteca, permite local sin copia y rechaza adjunto más URL", async () => {
  const f = await fixture();
  assert.equal(registerPublication(f.state, f.editor.id, f.input).exito, false);
  const local = requireResult(
    registerPublication(f.state, f.editor.id, {
      ...f.input,
      requiresLibraryCopy: false,
    }),
  );
  assert.equal(local.publication.requiresLibraryCopy, false);
  assert.equal(local.publication.attachment, undefined);
  const upload = await f.upload();
  for (const source of ["LOCAL", "EXTERNA"] as const) {
    assert.equal(
      registerPublication(f.state, f.editor.id, {
        ...f.input,
        source,
        externalUrl: "https://example.org/work",
        attachmentId: upload.attachment.id,
      }).exito,
      false,
    );
  }
});

test("Errores de persistencia o sesión: nunca confirma parcialmente, limpia binario nuevo y no oculta fallo de bitácora", async () => {
  const f = await fixture();
  const original = JSON.stringify(f.state);
  const args = {
    state: f.state,
    actorId: f.editor.id,
    file: f.file,
    commit: f.commit,
    write: f.write,
    assertActive() {},
  };
  await assert.rejects(
    uploadAttachment({
      ...args,
      write: async () => {
        throw Error("Sin espacio en IndexedDB");
      },
    }),
    /Sin espacio/,
  );
  assert.equal(JSON.stringify(f.state), original);
  await assert.rejects(
    uploadAttachment({
      ...args,
      commit: () => {
        throw Error("No se pudo guardar bitácora");
      },
    }),
    /bitácora/,
  );
  assert.equal(f.bytes.size, 0);
  assert.equal(JSON.stringify(f.state), original);
  let expired = false;
  await assert.rejects(
    uploadAttachment({
      ...args,
      write: async (id, blob) => {
        await f.write(id, blob);
        expired = true;
      },
      assertActive: () => {
        if (expired) throw Error("Sesión vencida");
      },
    }),
    /Sesión vencida/,
  );
  assert.equal(f.bytes.size, 0);
  assert.equal(JSON.stringify(f.state), original);
  await assert.rejects(
    uploadAttachment({
      ...args,
      file: new File(["not pdf"], "falso.pdf"),
      commit: () => {
        throw Error("Fallo de auditoría");
      },
    }),
    /auditoría/,
  );
  assert.equal(JSON.stringify(f.state), original);
});
