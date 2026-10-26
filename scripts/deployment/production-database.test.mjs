import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defaults } from "./config.mjs";
import { resolveExistingDatabase } from "./production-database.mjs";

const root = resolve(fileURLToPath(new URL("../../", import.meta.url)));
function fixture(
  t,
  { connections = 0, copyFails = false, changed = false } = {},
) {
  const parent = resolve(root, ".local");
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(join(parent, "reinstall-test-"));
  t.after(() => {
    assert.ok(folder.startsWith(parent + sep));
    rmSync(folder, { recursive: true, force: true });
  });
  const config = {
    ...defaults(root, "production"),
    INSTALL_BACKUP_DIRECTORY: join(folder, "snapshots"),
  };
  const info = {
      id: "42",
      name: "fceadatasys",
      owner: "fcea_production_owner",
      connections,
    },
    queries = [],
    commands = [];
  let reads = 0;
  const connection = {
    query: async (sql) => {
      queries.push(sql);
      return {
        rows: sql.startsWith("SELECT")
          ? [{ ...info, id: changed && ++reads > 1 ? "43" : "42" }]
          : [],
      };
    },
  };
  const execute = async (command, args) => {
    commands.push([command, ...args]);
    if (copyFails) throw Error("Copia fallida.");
    if (args.includes("--file"))
      writeFileSync(args[args.indexOf("--file") + 1], "PGDMPfixture");
  };
  const target = { databaseName: "fceadatasys" };
  const admin = new URL(
    "postgresql://postgres:private@localhost:5432/postgres",
  );
  return {
    folder,
    config,
    queries,
    commands,
    run: (options) =>
      resolveExistingDatabase(
        folder,
        config,
        target,
        connection,
        admin,
        execute,
        { log: () => {}, ...options },
      ),
  };
}
test("sin interacción conserva la base existente y no ejecuta herramientas ni DROP", async (t) => {
  const f = fixture(t);
  assert.equal((await f.run()).id, "42");
  assert.deepEqual(f.commands, []);
  assert.ok(!f.queries.some((sql) => sql.startsWith("DROP")));
});
test("recrear requiere copia verificada y nombre exacto; registra el intento sin credenciales", async (t) => {
  const f = fixture(t);
  let reviewed = false;
  const result = await f.run({
    chooseExisting: async () => "recreate",
    confirmReset: async (info) => {
      assert.ok(info.snapshot.endsWith(".dump"));
      assert.ok(f.commands.some((command) => command.includes("--list")));
      reviewed = true;
      return "ELIMINAR fceadatasys";
    },
  });
  assert.equal(result, null);
  assert.ok(reviewed);
  assert.equal(f.queries.filter((sql) => sql.startsWith("DROP")).length, 1);
  assert.equal(readdirSync(f.config.INSTALL_BACKUP_DIRECTORY).length, 1);
  const journal = readFileSync(
    join(f.folder, ".local/deploy/production/installation-events.jsonl"),
    "utf8",
  );
  assert.ok(journal.includes("DATABASE_RECREATE_AUTHORIZED"));
  assert.ok(!journal.includes("private@"));
});
for (const [name, options, confirmation] of [
  ["confirmación incorrecta", {}, "si"],
  ["conexiones activas", { connections: 1 }, "ELIMINAR fceadatasys"],
  [
    "base reemplazada durante revisión",
    { changed: true },
    "ELIMINAR fceadatasys",
  ],
  ["fallo de copia", { copyFails: true }, "ELIMINAR fceadatasys"],
])
  test(`recreación rechazada ante ${name}; no se ejecuta DROP`, async (t) => {
    const f = fixture(t, options);
    await assert.rejects(
      f.run({
        chooseExisting: async () => "recreate",
        confirmReset: async () => confirmation,
      }),
    );
    assert.ok(!f.queries.some((sql) => sql.startsWith("DROP")));
  });
test("cancelar conserva la base sin crear copia ni modificar usuarios", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.run({ chooseExisting: async () => "cancel" }));
  assert.deepEqual(f.commands, []);
  assert.ok(f.queries.every((sql) => sql.startsWith("SELECT")));
});
test("la copia previa nunca se escribe en el cliente web", async (t) => {
  const f = fixture(t);
  f.config.INSTALL_BACKUP_DIRECTORY = join(f.folder, "client", "public");
  await assert.rejects(
    f.run({
      chooseExisting: async () => "recreate",
      confirmReset: async () => "ELIMINAR fceadatasys",
    }),
    /fuera del cliente web/,
  );
  assert.deepEqual(f.commands, []);
  assert.ok(!f.queries.some((sql) => sql.startsWith("DROP")));
});
