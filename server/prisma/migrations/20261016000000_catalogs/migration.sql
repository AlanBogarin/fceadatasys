BEGIN;

-- CreateEnum
CREATE TYPE "tipo_catalogo" AS ENUM ('carreras', 'facultades', 'filiales', 'tipos', 'niveles');

-- CreateTable
CREATE TABLE "autores" (
    "id" UUID NOT NULL,
    "nombre_completo" VARCHAR(150) NOT NULL,
    "nombre_clave" VARCHAR(300) NOT NULL,
    "ci" VARCHAR(12),
    "correo" VARCHAR(150),
    "orc_id" VARCHAR(19),
    "ci_clave" VARCHAR(300),
    "correo_clave" VARCHAR(300),
    "orcid_clave" VARCHAR(300),
    "busqueda_clave" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "autores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tutores" (
    "id" UUID NOT NULL,
    "nombre_completo" VARCHAR(150) NOT NULL,
    "nombre_clave" VARCHAR(300) NOT NULL,
    "ci" VARCHAR(12),
    "correo" VARCHAR(150),
    "especialidad" VARCHAR(150),
    "ci_clave" VARCHAR(300),
    "correo_clave" VARCHAR(300),
    "busqueda_clave" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tutores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogos" (
    "id" UUID NOT NULL,
    "tipo" "tipo_catalogo" NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "nombre_clave" VARCHAR(300) NOT NULL,
    "codigo" VARCHAR(30),
    "sigla" VARCHAR(30),
    "direccion" VARCHAR(200),
    "descripcion" VARCHAR(300),
    "codigo_clave" VARCHAR(300),
    "sigla_clave" VARCHAR(300),
    "busqueda_clave" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "catalogos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "autores_nombre_clave_key" ON "autores"("nombre_clave");

-- CreateIndex
CREATE UNIQUE INDEX "autores_ci_clave_key" ON "autores"("ci_clave");

-- CreateIndex
CREATE UNIQUE INDEX "autores_correo_clave_key" ON "autores"("correo_clave");

-- CreateIndex
CREATE UNIQUE INDEX "autores_orcid_clave_key" ON "autores"("orcid_clave");

-- CreateIndex
CREATE INDEX "autores_activo_nombre_idx" ON "autores"("activo", "nombre_clave", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tutores_nombre_clave_key" ON "tutores"("nombre_clave");

-- CreateIndex
CREATE UNIQUE INDEX "tutores_ci_clave_key" ON "tutores"("ci_clave");

-- CreateIndex
CREATE UNIQUE INDEX "tutores_correo_clave_key" ON "tutores"("correo_clave");

-- CreateIndex
CREATE INDEX "tutores_activo_nombre_idx" ON "tutores"("activo", "nombre_clave", "id");

-- CreateIndex
CREATE INDEX "catalogos_tipo_activo_nombre_idx" ON "catalogos"("tipo", "activo", "nombre_clave", "id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogos_tipo_nombre_clave_key" ON "catalogos"("tipo", "nombre_clave");

-- CreateIndex
CREATE UNIQUE INDEX "catalogos_tipo_codigo_clave_key" ON "catalogos"("tipo", "codigo_clave");

-- CreateIndex
CREATE UNIQUE INDEX "catalogos_tipo_sigla_clave_key" ON "catalogos"("tipo", "sigla_clave");

-- Defense in depth. Empty optional identifiers are stored as NULL so UNIQUE permits
-- multiple people without CI/email/ORCID. Normalized keys are computed by the API.
ALTER TABLE autores
  ADD CONSTRAINT autores_nombre_check CHECK (length(btrim(nombre_completo)) BETWEEN 1 AND 150 AND length(nombre_clave) > 0),
  ADD CONSTRAINT autores_ci_check CHECK (ci IS NULL OR ci ~ '^[0-9]{5,12}$'),
  ADD CONSTRAINT autores_orcid_check CHECK (orc_id IS NULL OR orc_id ~ '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$'),
  ADD CONSTRAINT autores_claves_check CHECK ((ci IS NULL) = (ci_clave IS NULL) AND (correo IS NULL) = (correo_clave IS NULL) AND (orc_id IS NULL) = (orcid_clave IS NULL));
ALTER TABLE tutores
  ADD CONSTRAINT tutores_nombre_check CHECK (length(btrim(nombre_completo)) BETWEEN 1 AND 150 AND length(nombre_clave) > 0),
  ADD CONSTRAINT tutores_ci_check CHECK (ci IS NULL OR ci ~ '^[0-9]{5,12}$'),
  ADD CONSTRAINT tutores_claves_check CHECK ((ci IS NULL) = (ci_clave IS NULL) AND (correo IS NULL) = (correo_clave IS NULL));
ALTER TABLE catalogos
  ADD CONSTRAINT catalogos_nombre_check CHECK (length(btrim(nombre)) BETWEEN 1 AND 150 AND length(nombre_clave) > 0),
  ADD CONSTRAINT catalogos_campos_tipo_check CHECK ((tipo = 'carreras' OR codigo IS NULL) AND (tipo = 'facultades' OR sigla IS NULL) AND (tipo = 'filiales' OR direccion IS NULL)),
  ADD CONSTRAINT catalogos_claves_check CHECK ((codigo IS NULL) = (codigo_clave IS NULL) AND (sigla IS NULL) = (sigla_clave IS NULL));

COMMIT;
