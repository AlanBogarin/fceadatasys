import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defaults } from "./config.mjs";
import { run } from "./processes.mjs";
import { prepareClamAv, verifyClamAv } from "./clamav.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
test(
  "FreshClam real: descarga desde cero, análisis limpio y reutilización sin descarga",
  { skip: process.env.DEPLOYMENT_CLAMAV_TEST_ENABLED !== "1", timeout: 600000 },
  async (t) => {
    const parent = resolve(root, ".local");
    mkdirSync(parent, { recursive: true });
    const folder = mkdtempSync(join(parent, "clamav-installation-"));
    let verified = false;
    t.after(() => {
      assert.ok(resolve(folder).startsWith(parent + sep));
      if (verified) rmSync(folder, { recursive: true, force: true });
      else t.diagnostic("Diagnóstico de la descarga conservado en " + folder);
    });
    const config = {
      ...defaults(folder, "demo"),
      CLAMAV_DATABASE_DIR: "firmas nuevas á",
    };
    if (process.env.CLAMAV_TEST_COMMAND)
      config.CLAMAV_COMMAND = process.env.CLAMAV_TEST_COMMAND;
    const calls = [];
    const options = {
      async execute(command, args, settings) {
        calls.push(settings.label);
        return run(command, args, settings);
      },
    };
    await verifyClamAv(folder, config, options);
    assert.ok(readdirSync(join(folder, config.CLAMAV_DATABASE_DIR)).some(
      (name) => /\.(?:cvd|cld)$/i.test(name),
    ));
    assert.deepEqual(await prepareClamAv(folder, config, options), { updated: false });
    assert.deepEqual(calls, ["ClamAV", "FreshClam", "ClamAV"]);
    verified = true;
  },
);
