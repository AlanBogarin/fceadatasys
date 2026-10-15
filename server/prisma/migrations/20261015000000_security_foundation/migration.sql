-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

BEGIN;

-- CreateEnum
CREATE TYPE "rol_usuario" AS ENUM ('ADMINISTRADOR', 'DIGITADOR', 'PUBLICO');

-- CreateEnum
CREATE TYPE "estado_auditoria" AS ENUM ('EXITO', 'FALLIDO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(160) NOT NULL,
    "ci" VARCHAR(30) NOT NULL,
    "correo" VARCHAR(254) NOT NULL,
    "correo_clave" VARCHAR(254) NOT NULL,
    "usuario" VARCHAR(80) NOT NULL,
    "usuario_clave" VARCHAR(80) NOT NULL,
    "rol" "rol_usuario" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "contrasena_hash" TEXT NOT NULL,
    "intentos_fallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueado_hasta" TIMESTAMPTZ(3),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultima_actividad_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMPTZ(3) NOT NULL,
    "revocado_en" TIMESTAMPTZ(3),

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_refresh" (
    "id" UUID NOT NULL,
    "sesion_id" UUID NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMPTZ(3) NOT NULL,
    "consumido_en" TIMESTAMPTZ(3),
    "revocado_en" TIMESTAMPTZ(3),

    CONSTRAINT "tokens_refresh_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_recuperacion" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_en" TIMESTAMPTZ(3) NOT NULL,
    "consumido_en" TIMESTAMPTZ(3),

    CONSTRAINT "tokens_recuperacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "limites_recuperacion" (
    "clave" VARCHAR(128) NOT NULL,
    "inicio_ventana" TIMESTAMPTZ(3) NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "limites_recuperacion_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuario_id" UUID,
    "rol" "rol_usuario",
    "operacion" VARCHAR(80) NOT NULL,
    "recurso" VARCHAR(80) NOT NULL,
    "recurso_id" VARCHAR(128),
    "publicacion_id" UUID,
    "ip" VARCHAR(64) NOT NULL,
    "user_agent" VARCHAR(1024) NOT NULL,
    "sesion_id" UUID,
    "estado" "estado_auditoria" NOT NULL,
    "detalle" TEXT,
    "valores_anteriores" JSONB,
    "valores_nuevos" JSONB,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_ci_key" ON "usuarios"("ci");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_clave_key" ON "usuarios"("correo_clave");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_usuario_clave_key" ON "usuarios"("usuario_clave");

-- CreateIndex
CREATE INDEX "usuarios_rol_activo_idx" ON "usuarios"("rol", "activo");

-- CreateIndex
CREATE INDEX "sesiones_usuario_revocacion_idx" ON "sesiones"("usuario_id", "revocado_en");

-- CreateIndex
CREATE INDEX "sesiones_vencimiento_idx" ON "sesiones"("vence_en");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_refresh_hash_key" ON "tokens_refresh"("hash");

-- CreateIndex
CREATE INDEX "tokens_refresh_sesion_idx" ON "tokens_refresh"("sesion_id");

-- CreateIndex
CREATE INDEX "tokens_refresh_vencimiento_idx" ON "tokens_refresh"("vence_en");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_recuperacion_hash_key" ON "tokens_recuperacion"("hash");

-- CreateIndex
CREATE INDEX "tokens_recuperacion_usuario_idx" ON "tokens_recuperacion"("usuario_id");

-- CreateIndex
CREATE INDEX "tokens_recuperacion_vencimiento_idx" ON "tokens_recuperacion"("vence_en");

-- CreateIndex
CREATE INDEX "limites_recuperacion_ventana_idx" ON "limites_recuperacion"("inicio_ventana");

-- CreateIndex
CREATE INDEX "auditoria_fecha_id_idx" ON "auditoria"("creado_en", "id");

-- CreateIndex
CREATE INDEX "auditoria_usuario_fecha_idx" ON "auditoria"("usuario_id", "creado_en");

-- CreateIndex
CREATE INDEX "auditoria_operacion_fecha_idx" ON "auditoria"("operacion", "creado_en");

-- CreateIndex
CREATE INDEX "auditoria_sesion_idx" ON "auditoria"("sesion_id");

-- CreateIndex
CREATE INDEX "auditoria_publicacion_idx" ON "auditoria"("publicacion_id");

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tokens_refresh" ADD CONSTRAINT "tokens_refresh_sesion_id_fkey" FOREIGN KEY ("sesion_id") REFERENCES "sesiones"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tokens_recuperacion" ADD CONSTRAINT "tokens_recuperacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_sesion_id_fkey" FOREIGN KEY ("sesion_id") REFERENCES "sesiones"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Defense in depth beyond API validation. UNIQUE constraints arbitrate races.
ALTER TABLE "usuarios"
  ADD CONSTRAINT "usuarios_ci_formato_check" CHECK ("ci" ~ '^[0-9]{5,12}$'),
  ADD CONSTRAINT "usuarios_nombre_no_vacio_check" CHECK (length(btrim("nombre")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "usuarios_usuario_formato_check" CHECK ("usuario" ~ '^[A-Za-z0-9._-]{3,40}$'),
  ADD CONSTRAINT "usuarios_intentos_no_negativos_check" CHECK ("intentos_fallidos" >= 0),
  ADD CONSTRAINT "usuarios_correo_clave_no_vacia_check" CHECK (length("correo_clave") > 0),
  ADD CONSTRAINT "usuarios_usuario_clave_no_vacia_check" CHECK (length("usuario_clave") > 0);
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_vencimiento_check" CHECK ("vence_en" > "creado_en");
ALTER TABLE "tokens_refresh"
  ADD CONSTRAINT "tokens_refresh_hash_formato_check" CHECK ("hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "tokens_refresh_vencimiento_check" CHECK ("vence_en" > "creado_en");
ALTER TABLE "tokens_recuperacion"
  ADD CONSTRAINT "tokens_recuperacion_hash_formato_check" CHECK ("hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "tokens_recuperacion_vencimiento_check" CHECK ("vence_en" > "creado_en");
ALTER TABLE "limites_recuperacion" ADD CONSTRAINT "limites_recuperacion_cantidad_check" CHECK ("cantidad" >= 0);

CREATE FUNCTION public.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Los registros de auditoría son inmutables.';
END;
$$;
CREATE TRIGGER auditoria_reject_update_delete
  BEFORE UPDATE OR DELETE ON public.auditoria
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_mutation();
CREATE TRIGGER auditoria_reject_truncate
  BEFORE TRUNCATE ON public.auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_mutation();
REVOKE ALL ON public.auditoria FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

COMMIT;
