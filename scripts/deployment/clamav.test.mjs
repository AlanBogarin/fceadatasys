import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, cpSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { defaults, localPath, writeConfig } from "./config.mjs";
import { prepareClamAv, verifyClamAv } from "./clamav.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const quiet = { log() {} };
function environment(t, { present = true, profile = "demo" } = {}) {
  const parent = resolve(root, ".local");
  mkdirSync(parent, { recursive: true });
  const folder = mkdtempSync(join(parent, "clamav-test-"));
  t.after(() => {
    assert.ok(folder.startsWith(parent + "/") || folder.startsWith(parent + "\\"));
    rmSync(folder, { recursive: true, force: true });
  });
  const config = {
    ...defaults(folder, profile),
    CLAMAV_COMMAND: join(folder, "tools with spaces", "clamscan"),
    CLAMAV_DATABASE_DIR: "firmas de instalación á",
  };
  const database = localPath(folder, config.CLAMAV_DATABASE_DIR);
  if (present) {
    mkdirSync(database);
    writeFileSync(join(database, "daily.cld"), "existing signatures");
  }
  return { folder, config, database };
}
function updater(database, calls, expectedCommand = join(
  dirname(database), "tools with spaces",
  process.platform === "win32" ? "freshclam.exe" : "freshclam",
)) {
  return async (command, args, options) => {
    calls.push(options.label);
    assert.equal(options.quiet, true);
    if (options.label === "ClamAV") {
      assert.deepEqual(args, ["--version"]);
      return "ClamAV version";
    }
    assert.equal(options.label, "FreshClam");
    assert.equal(command, expectedCommand);
    assert.equal(args[0], "--quiet");
    const file = args[1].slice("--config-file=".length);
    const contents = readFileSync(file, "utf8");
    assert.equal(contents.charCodeAt(0), "D".charCodeAt(0), "No UTF-8 BOM");
    assert.ok(contents.includes('DatabaseDirectory "' + database + '"'));
    assert.match(contents, /^DatabaseMirror database\.clamav\.net$/m);
    assert.match(contents, /^TestDatabases yes$/m);
    assert.doesNotMatch(contents, /OnUpdateExecute|OnErrorExecute/);
    mkdirSync(database, { recursive: true });
    writeFileSync(join(database, "daily.cvd"), "downloaded signatures");
    return "Updated";
  };
}
function scanner(scan) {
  return () => ({ scan });
}

test("Demo y producción descargan firmas ausentes sin comandos manuales", async (t) => {
  for (const profile of ["demo", "production"]) {
    const { folder, config, database } = environment(t, { present: false, profile });
    const calls = [];
    await verifyClamAv(folder, config, {
      ...quiet,
      execute: updater(database, calls),
      createScanner: scanner(async () => {
        assert.ok(existsSync(join(database, "daily.cvd")));
        return { clean: true };
      }),
    });
    assert.deepEqual(calls, ["ClamAV", "FreshClam"]);
  }
});

test("Directorio vacío o solo estado de FreshClam también descarga firmas", async (t) => {
  for (const state of ["empty", "config-only"]) {
    const { folder, config, database } = environment(t, { present: false });
    mkdirSync(database);
    if (state === "config-only") writeFileSync(join(database, "freshclam.dat"), "state");
    const calls = [];
    assert.deepEqual(await prepareClamAv(folder, config, {
      ...quiet, execute: updater(database, calls),
    }), { updated: true });
    assert.deepEqual(calls, ["ClamAV", "FreshClam"]);
  }
});

test("Instalación con clamscan en PATH también busca FreshClam en PATH", async (t) => {
  const { folder, config, database } = environment(t, { present: false });
  config.CLAMAV_COMMAND = "clamscan";
  const calls = [];
  await prepareClamAv(folder, config, {
    ...quiet,
    execute: updater(database, calls,
      process.platform === "win32" ? "freshclam.exe" : "freshclam"),
  });
  assert.deepEqual(calls, ["ClamAV", "FreshClam"]);
});

test("Firmas vigentes funcionan sin descargar; análisis usa directorio y límites configurados", async (t) => {
  const { folder, config, database } = environment(t);
  config.CLAMAV_TIMEOUT_MS = "45000";
  config.CLAMAV_MAX_SIGNATURE_AGE_DAYS = "3";
  const calls = [];
  await verifyClamAv(folder, config, {
    ...quiet,
    async execute(_command, args, options) {
      calls.push(options.label);
      assert.equal(options.label, "ClamAV", "No debe contactar la red");
      assert.deepEqual(args, ["--version"]);
      assert.equal(options.timeout, 45000);
    },
    createScanner(settings) {
      assert.deepEqual(settings, {
        command: config.CLAMAV_COMMAND,
        database,
        timeoutMs: 45000,
        maxSignatureAgeDays: 3,
      });
      return { async scan(bytes) {
        assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0);
        return { clean: true };
      } };
    },
  });
  assert.deepEqual(calls, ["ClamAV"]);
  assert.equal(readFileSync(join(database, "daily.cld"), "utf8"), "existing signatures");
});

test("Firmas vencidas o corruptas provocan una actualización y un nuevo análisis obligatorio", async (t) => {
  const { folder, config, database } = environment(t);
  const calls = [];
  let scans = 0;
  await verifyClamAv(folder, config, {
    ...quiet,
    execute: updater(database, calls),
    createScanner: scanner(async () => {
      scans++;
      if (scans === 1) throw Object.assign(Error("Old database"), {
        code: "ANTIMALWARE_UNAVAILABLE",
      });
      assert.ok(existsSync(join(database, "daily.cvd")));
      return { clean: true };
    }),
  });
  assert.equal(scans, 2);
  assert.deepEqual(calls, ["ClamAV", "FreshClam"]);
});

test("Preparación temprana se reutiliza sin repetir comprobaciones ni descarga", async (t) => {
  const { folder, config, database } = environment(t, { present: false });
  const calls = [];
  const options = { ...quiet, execute: updater(database, calls) };
  const prepared = await prepareClamAv(folder, config, options);
  await verifyClamAv(folder, config, {
    ...options,
    prepared,
    createScanner: scanner(async () => ({ clean: true })),
  });
  assert.deepEqual(calls, ["ClamAV", "FreshClam"]);
});

test("Detección impide continuar sin intentar actualizar para obtener otro veredicto", async (t) => {
  const { folder, config } = environment(t);
  let versions = 0;
  await assert.rejects(verifyClamAv(folder, config, {
    ...quiet,
    async execute(_command, _args, options) {
      assert.equal(options.label, "ClamAV");
      versions++;
    },
    createScanner: scanner(async () => ({ clean: false })),
  }), /No se pudo aprobar el análisis de prueba/);
  assert.equal(versions, 1);
});

test("Análisis persistentemente indisponible falla con una sola actualización y sin secretos", async (t) => {
  for (const present of [true, false]) {
    const { folder, config, database } = environment(t, { present });
    const calls = [];
    let scans = 0;
    await assert.rejects(verifyClamAv(folder, config, {
      ...quiet,
      execute: updater(database, calls),
      createScanner: scanner(async () => {
        scans++;
        throw Error(config.JWT_SECRET);
      }),
    }), (error) => {
      assert.match(error.message, /No se pudo aprobar.*máximo 7 días/);
      assert.ok(!error.message.includes(config.JWT_SECRET));
      return true;
    });
    assert.deepEqual(calls, ["ClamAV", "FreshClam"]);
    assert.equal(scans, present ? 2 : 1);
  }
});

test("Fallo de descarga o descarga sin firmas cancela y da diagnóstico de FreshClam", async (t) => {
  for (const failure of ["network", "empty-result"]) {
    const { folder, config } = environment(t, { present: false });
    await assert.rejects(verifyClamAv(folder, config, {
      ...quiet,
      async execute(_command, _args, options) {
        if (options.label === "FreshClam" && failure === "network")
          throw Error(config.JWT_SECRET);
      },
      createScanner() { assert.fail("No debe analizar sin firmas"); },
    }), (error) => {
      assert.match(error.message, /No se pudieron actualizar.*Internet\/DNS.*Registro:/);
      assert.ok(!error.message.includes(config.JWT_SECRET));
      return true;
    });
  }
});

test("Ejecutable inaccesible falla antes de crear firmas y sin divulgar el error interno", async (t) => {
  const { folder, config, database } = environment(t, { present: false });
  await assert.rejects(prepareClamAv(folder, config, {
    ...quiet,
    async execute() { throw Error(config.JWT_SECRET); },
  }), (error) => {
    assert.match(error.message, /^No se pudo ejecutar ClamAV.*CLAMAV_COMMAND/);
    assert.ok(!error.message.includes(config.JWT_SECRET));
    return true;
  });
  assert.equal(existsSync(database), false);
});

test("Rutas con directivas adicionales de FreshClam se rechazan antes de escribir o ejecutar", async (t) => {
  const { folder, config } = environment(t, { present: false });
  config.CLAMAV_DATABASE_DIR = 'signatures"\nOnUpdateExecute injected';
  const calls = [];
  await assert.rejects(prepareClamAv(folder, config, {
    ...quiet,
    async execute(_command, _args, options) { calls.push(options.label); },
  }), /No se pudo configurar FreshClam/);
  assert.deepEqual(calls, ["ClamAV"]);
});

test("CLI intenta recuperar firmas y cancela antes de PostgreSQL si FreshClam no está instalado", (t) => {
  const freshclam = join(dirname(process.execPath),
    process.platform === "win32" ? "freshclam.exe" : "freshclam");
  if (existsSync(freshclam)) return t.skip("FreshClam está junto a Node; no usar red en esta prueba");
  const { folder, config } = environment(t, { present: false });
  cpSync(join(root, "scripts"), join(folder, "scripts"), { recursive: true });
  // Node --version is a harmless stand-in; its directory has no FreshClam.
  config.CLAMAV_COMMAND = process.execPath.replaceAll("\\", "/");
  const file = join(folder, "demo.env");
  writeConfig(file, config);
  const result = spawnSync(process.execPath, [
    "scripts/run.mjs", "--profile", "demo", "--config", file,
    "--setup-only", "--non-interactive", "--skip-install",
  ], { cwd: folder, windowsHide: true, encoding: "utf8", timeout: 15000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.match(output, /Descargando\/actualizando firmas oficiales/);
  assert.match(output, /No se pudieron actualizar las firmas.*automáticamente/);
  assert.doesNotMatch(output, /No se pudo completar el despliegue|Comprobando PostgreSQL/);
  assert.equal(existsSync(resolve(folder, config.PG_DATA_DIRECTORY)), false);
  assert.ok(!output.includes(config.JWT_SECRET));
});
