import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { defaults, writeConfig } from "../deployment/config.mjs";
import {
  activateRecovered,
  claimRestoreSlot,
  localCopies,
  restoreDatabase,
  restoreEnvironment,
  sha256,
} from "./restore.mjs";

async function fixture(t) {
  const parent = resolve(".tmp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "restore-unit-"));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(parent + sep));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("lista copias locales con rutas relativas, ordenadas; excluye parciales y directorios", async (t) => {
  const root = await fixture(t),
    config = defaults(root, "demo");
  assert.deepEqual(await localCopies(root, config), []);
  writeConfig(join(root, ".local/backups/demo.env"), {
    BACKUP_DIRECTORY: "copies",
  });
  const copies = join(root, ".local/backups/copies");
  await mkdir(copies);
  await writeFile(join(copies, "primera.dump"), "PGDMPfirst");
  await writeFile(join(copies, "segunda.dump.partial"), "PGDMPpartial");
  await mkdir(join(copies, "folder.dump"));
  const list = await localCopies(root, config);
  assert.equal(list.length, 1);
  assert.equal(list[0].path, join(copies, "primera.dump"));
  assert.equal(list[0].size, 10);
});

test("el bloqueo compartido rechaza un lanzador/restaurador activo y se libera", async (t) => {
  const root = await fixture(t);
  const release = await claimRestoreSlot(root, "demo");
  await assert.rejects(claimRestoreSlot(root, "demo"), /Detené el sistema/);
  const lock = JSON.parse(
    await readFile(join(root, ".local/deploy/demo/run.lock"), "utf8"),
  );
  assert.equal(lock.operation, "restore");
  await release();
  await (
    await claimRestoreSlot(root, "demo")
  )();
});

test("rechaza archivos inválidos antes de ejecutar herramientas o conectar PostgreSQL", async (t) => {
  const root = await fixture(t),
    file = join(root, "invalid.dump"),
    calls = [];
  await writeFile(file, "not a postgres dump");
  await assert.rejects(
    restoreDatabase(root, defaults(root, "demo"), {
      file,
      confirm: async () => assert.fail("No debe pedir activación"),
      execute: async (...args) => calls.push(args),
    }),
    /no es una copia custom/,
  );
  assert.deepEqual(calls, []);
  await (
    await claimRestoreSlot(root, "demo")
  )();
});

test("exige confirmación interactiva y hash válido antes de reservar el perfil", async (t) => {
  const root = await fixture(t),
    config = defaults(root, "demo");
  await assert.rejects(
    restoreDatabase(root, config),
    /confirmación interactiva/,
  );
  await assert.rejects(
    restoreDatabase(root, config, {
      expectedSha256: "incorrecto",
      confirm: async () => "",
    }),
    /SHA-256 inválido/,
  );
});

test("el entorno PostgreSQL conserva caracteres de la contraseña sin argumentos públicos", () => {
  const env = restoreEnvironment(
    "postgresql://owner:p%40ss%3Aword@localhost:5544/fcea?sslmode=require",
  );
  assert.equal(env.PGPASSWORD, "p@ss:word");
  assert.equal(env.PGSSLMODE, "require");
  assert.equal(env.PGDATABASE, "fcea");
  assert.equal(env.PGPORT, "5544");
});

function switchFixture({
  active = false,
  changed = false,
  failRename = false,
} = {}) {
  const commands = [];
  const client = {
    query: async (sql, values) => {
      commands.push(sql);
      if (sql.startsWith("SELECT oid"))
        return {
          rows: [
            {
              id: values[0] === "original" ? (changed ? "99" : "1") : "2",
              connections: active ? 1 : 0,
            },
          ],
        };
      if (failRename && sql.includes('"staging" RENAME'))
        throw Error("second rename failed");
      return { rows: [] };
    },
  };
  return {
    client,
    commands,
    input: {
      database: "original",
      staging: "staging",
      previous: "previous",
      databaseId: "1",
      stagingId: "2",
    },
  };
}

test("activa con dos renombrados en la misma transacción y preserva la base anterior cerrada", async () => {
  const f = switchFixture();
  await activateRecovered(f.client, f.input);
  assert.equal(f.commands[0], "BEGIN");
  assert.equal(f.commands.at(-1), "COMMIT");
  assert.ok(
    f.commands.includes('ALTER DATABASE "original" RENAME TO "previous"'),
  );
  assert.ok(
    f.commands.includes('ALTER DATABASE "staging" RENAME TO "original"'),
  );
  assert.ok(!f.commands.some((sql) => /DROP|DELETE|TRUNCATE/.test(sql)));
});
for (const [scenario, reason] of [
  [{ active: true }, /conexiones activas/],
  [{ changed: true }, /identidad/],
  [{ failRename: true }, /second rename/],
]) {
  test(`revierte activación fallida: ${Object.keys(scenario)[0]}`, async () => {
    const f = switchFixture(scenario);
    await assert.rejects(activateRecovered(f.client, f.input), reason);
    assert.equal(f.commands.at(-1), "ROLLBACK");
    assert.ok(!f.commands.includes("COMMIT"));
  });
}

test("SHA-256 se calcula sobre el archivo completo", async (t) => {
  const root = await fixture(t),
    file = join(root, "hash.dump");
  await writeFile(file, "abc");
  assert.equal(
    await sha256(file),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});
