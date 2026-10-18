import { createPrisma } from "../src/db.js";
import { loadConfig } from "../src/config.js";
import { bootstrapAdmin } from "../src/initialization/bootstrap.js";
import { initializeDemo } from "../src/initialization/demo.js";
import {
  assertLimitedRuntime,
  assertProfileTarget,
  productionInput,
} from "../src/initialization/profiles.js";

async function main() {
  const target = assertProfileTarget(process.argv[2], process.env);
  // Validar las credenciales de producción antes de abrir la base; sin defaults para correo/contraseña.
  const admin =
    target.profile === "production" ? productionInput(process.env) : undefined;
  const prisma = createPrisma(target.databaseUrl);
  try {
    await assertLimitedRuntime(prisma);
    if (target.profile === "production") {
      const created = await bootstrapAdmin(prisma, admin!, true);
      console.log(
        created
          ? "Entrega inicial preparada: un Administrador y parámetros 300 palabras / PDF / 10 MiB. Sin muestras."
          : "Entrega inicial existente; no se modificaron datos ni credenciales.",
      );
    } else {
      const result = await initializeDemo(
        prisma,
        loadConfig(),
        process.env,
        console.log,
      );
      console.log(
        JSON.stringify({
          profile: "demo",
          database: target.databaseName,
          ...result,
        }),
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((error: unknown) => {
  const message =
    error instanceof Error &&
    /^(Inicialización rechazada|Falta configuración|Configuración bootstrap|Bootstrap rechazado|Configuración demo|Datos demo|Carga demo|Configuración inválida)/.test(
      error.message,
    )
      ? error.message
      : "Inicialización falló; revisar la base elegida, migraciones, grants, archivos y ClamAV. No se imprimen credenciales ni errores internos.";
  console.error(message);
  process.exitCode = 1;
});
