import test from "node:test";
import { removeCronTask } from "./schedule.mjs";
import assert from "node:assert/strict";
import {
  cronEntry,
  mergeCrontab,
  scheduleName,
  validTime,
} from "./schedule.mjs";

test("horario diario estricto: medianoche, fin del día y entradas malformadas", () => {
  assert.deepEqual(validTime("00:00"), [0, 0]);
  assert.deepEqual(validTime("23:59"), [23, 59]);
  for (const value of ["24:00", "02:60", "2:00", "02:00\n", "$(id)", ""])
    assert.throws(() => validTime(value));
});
test("instalar y cambiar hora conserva otras tareas y evita duplicar la propia", () => {
  const config = {
    root: "/srv/FCEA Concepción",
    node: "/usr/bin/node",
    script: "/srv/FCEA Concepción/scripts/backup.mjs",
    config: "/srv/FCEA Concepción/private.env",
    profile: "production",
    time: "02:15",
    log: "/srv/log/copias.log",
  };
  const name = scheduleName(config.root, config.profile),
    first = cronEntry(config);
  assert.match(first, /^15 2 \* \* \*/);
  const other = "0 9 * * * echo otra # otra-tarea\n";
  const installed = mergeCrontab(other, first, name);
  assert.equal(mergeCrontab(installed, first, name), installed);
  const changed = mergeCrontab(
    installed,
    cronEntry({ ...config, time: "23:30" }),
    name,
  );
  assert.ok(changed.startsWith(other));
  assert.equal(changed.split(name).length - 1, 1);
  assert.match(changed, /30 23 \* \* \*/);
  assert.equal(removeCronTask(changed, name), other);
});
test("rutas con espacios, comillas y porcentaje no inyectan comandos ni dividen cron", () => {
  const entry = cronEntry({
    root: "/srv/FCEA's 100%",
    node: "/usr/bin/node",
    script: "/srv/a",
    config: "/srv/a",
    profile: "demo",
    time: "04:00",
    log: "/srv/a.log",
  });
  assert.ok(entry.includes("'\\''"));
  assert.ok(entry.includes("100\\%"));
  assert.throws(() =>
    cronEntry({ root: "/srv/\n* * * * * bad", profile: "demo", time: "04:00" }),
  );
});
