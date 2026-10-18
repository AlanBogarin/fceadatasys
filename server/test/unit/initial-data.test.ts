import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  assertProfileTarget,
  dataDirectory,
  demoPasswords,
  loadDemoDataset,
  productionInput,
} from "../../src/initialization/profiles.js";
import { validateAttachment } from "../../src/attachments/formats.js";

test("Conjunto demo UNC: conserva el YAML aportado y todas las referencias bibliográficas, sin claves aleatorias", () => {
  const data = loadDemoDataset();
  assert.equal(
    data.institution.universidad,
    "Universidad Nacional de Concepción",
  );
  assert.equal(data.institution.pais, "Paraguay");
  assert.equal(data.institution.facultades.length, 6);
  assert.equal(
    data.institution.facultades.flatMap((f) => f.carreras).length,
    18,
  );
  assert.deepEqual(
    data.institution.filiales_globales.map((f) => f.nombre),
    ["Concepción", "Horqueta", "Yby Yaú", "Vallemí", "Fuerte Olimpo"],
  );
  assert.deepEqual(data.institution.facultades[0].carreras, [
    "Ingeniería Comercial",
    "Ingeniería en Informática Empresarial",
    "Licenciatura en Administración",
    "Contaduría Pública",
  ]);
  assert.deepEqual(data.institution.facultades[0].filiales, [
    "Concepción (Sede Central)",
    "Horqueta",
  ]);
  assert.equal(data.catalogs.length, 62);
  assert.equal(data.people.authors.length, 14);
  assert.equal(data.people.tutors.length, 12);
  assert.equal(data.publications.length, 8);
  assert.equal(data.people.accounts.length, 3);
  assert.equal(
    data.catalogs.some((row) => /fixture|[a-f0-9]{8}/i.test(row.name)),
    false,
  );
  assert.equal(
    data.publications.some((row) =>
      /fixture|conexión|[a-f0-9]{8}/i.test(row.title),
    ),
    false,
  );
  assert.ok(
    data.publications.every((row) =>
      ["Concepción", "Horqueta"].includes(row.branch),
    ),
  );
});

test("PDF demo: ocho documentos válidos, distintos, privados en servidor e independientes de client/public", () => {
  const hashes = new Set<string>();
  for (const publication of loadDemoDataset().publications) {
    const path = new URL(
      `demo/documents/${publication.document}`,
      dataDirectory,
    );
    assert.doesNotMatch(path.href, /client\/public/);
    const bytes = readFileSync(path);
    validateAttachment(bytes, "pdf");
    hashes.add(createHash("sha256").update(bytes).digest("hex"));
  }
  assert.equal(hashes.size, 8);
});

test("Perfiles: rechazan selección implícita, cruce de bases, demo remota/producción y URL distinta de la base declarada", () => {
  const environment = {
    DATABASE_URL: "postgresql://runtime@127.0.0.1:55439/fceadatasys_demo",
    INITIAL_DATA_PROFILE: "demo",
    INITIAL_DATA_DATABASE_NAME: "fceadatasys_demo",
  };
  assert.equal(
    assertProfileTarget("demo", environment).databaseName,
    "fceadatasys_demo",
  );
  for (const change of [
    { INITIAL_DATA_PROFILE: undefined },
    { INITIAL_DATA_DATABASE_NAME: "fceadatasys_production" },
    { NODE_ENV: "production" },
    {
      DATABASE_URL: "postgresql://runtime@remote.example.test/fceadatasys_demo",
    },
    {
      DATABASE_URL:
        "postgresql://runtime@127.0.0.1/fceadatasys_client_connection_test",
    },
  ])
    assert.throws(
      () => assertProfileTarget("demo", { ...environment, ...change }),
      /Inicialización rechazada/,
    );
  assert.throws(
    () =>
      assertProfileTarget("production", {
        ...environment,
        INITIAL_DATA_PROFILE: "production",
      }),
    /Inicialización rechazada/,
  );
  assert.equal(
    assertProfileTarget("production", {
      INITIAL_DATA_PROFILE: "production",
      INITIAL_DATA_DATABASE_NAME: "fceadatasys_production",
      DATABASE_URL:
        "postgresql://runtime@db.example.test/fceadatasys_production",
    }).profile,
    "production",
  );
});

test("Entrega inicial: Administrador, CI 0000000 y admin; exige correo/contraseña locales y jamás toma secretos demo", () => {
  assert.throws(() => productionInput({}), /BOOTSTRAP_ADMIN_EMAIL/);
  assert.throws(
    () =>
      productionInput({
        BOOTSTRAP_ADMIN_EMAIL: "admin@example.test",
        DEMO_ADMIN_PASSWORD: "DemoAdmin2026!",
      }),
    /BOOTSTRAP_ADMIN_PASSWORD/,
  );
  const admin = productionInput({
    BOOTSTRAP_ADMIN_EMAIL: "admin@example.test",
    BOOTSTRAP_ADMIN_PASSWORD: "EntregaLocal2026!",
  });
  assert.equal(admin.name, "Administrador");
  assert.equal(admin.ci, "0000000");
  assert.equal(admin.username, "admin");
  assert.equal(admin.role, "ADMINISTRADOR");
  assert.throws(
    () =>
      productionInput({
        BOOTSTRAP_ADMIN_EMAIL: "incorrecto",
        BOOTSTRAP_ADMIN_PASSWORD: "LOCAL_SECRET",
      }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /LOCAL_SECRET/);
      return true;
    },
  );
});

test("Contraseñas demo: configuración explícita, política vigente y error sin mostrar valores", () => {
  assert.throws(
    () => demoPasswords({}, loadDemoDataset()),
    /DEMO_ADMIN_PASSWORD/,
  );
  assert.throws(
    () => demoPasswords({ DEMO_ADMIN_PASSWORD: "SECRET" }, loadDemoDataset()),
    (error) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /SECRET/);
      return true;
    },
  );
});
