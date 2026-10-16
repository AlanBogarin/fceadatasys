BEGIN;

-- CreateEnum
CREATE TYPE "origen_publicacion" AS ENUM ('LOCAL', 'EXTERNA');

-- CreateEnum
CREATE TYPE "estado_adjunto" AS ENUM ('PENDING', 'CLEAN', 'REJECTED');

-- CreateTable
CREATE TABLE "adjuntos" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "tamano" INTEGER NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "almacenamiento_clave" VARCHAR(255) NOT NULL,
    "estado" "estado_adjunto" NOT NULL DEFAULT 'PENDING',
    "contenido_verificado" BOOLEAN NOT NULL DEFAULT false,
    "analizado_en" TIMESTAMPTZ(3),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,

    CONSTRAINT "adjuntos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publicaciones" (
    "id" UUID NOT NULL,
    "numero" BIGSERIAL NOT NULL,
    "titulo" VARCHAR(250) NOT NULL,
    "titulo_hash" CHAR(64) NOT NULL,
    "resumen" VARCHAR(5000) NOT NULL,
    "resumen_hash" CHAR(64) NOT NULL,
    "abstract" VARCHAR(5000) NOT NULL,
    "abstract_hash" CHAR(64) NOT NULL,
    "palabras_clave" VARCHAR(300) NOT NULL,
    "anio" INTEGER NOT NULL,
    "origen" "origen_publicacion" NOT NULL,
    "requiere_copia_biblioteca" BOOLEAN NOT NULL,
    "url_externa" VARCHAR(2000),
    "adjunto_id" UUID,
    "adjunto_hash" CHAR(64),
    "carrera_id" UUID NOT NULL,
    "carrera_tipo" "tipo_catalogo" NOT NULL DEFAULT 'carreras',
    "nivel_id" UUID NOT NULL,
    "nivel_tipo" "tipo_catalogo" NOT NULL DEFAULT 'niveles',
    "tipo_id" UUID NOT NULL,
    "tipo_catalogo" "tipo_catalogo" NOT NULL DEFAULT 'tipos',
    "filial_id" UUID NOT NULL,
    "filial_tipo" "tipo_catalogo" NOT NULL DEFAULT 'filiales',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID NOT NULL,

    CONSTRAINT "publicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publicacion_autores" (
    "publicacion_id" UUID NOT NULL,
    "autor_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "publicacion_autores_pkey" PRIMARY KEY ("publicacion_id","autor_id")
);

-- CreateTable
CREATE TABLE "publicacion_tutores" (
    "publicacion_id" UUID NOT NULL,
    "tutor_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,

    CONSTRAINT "publicacion_tutores_pkey" PRIMARY KEY ("publicacion_id","tutor_id")
);

-- CreateTable
CREATE TABLE "parametros_publicaciones" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "limite_palabras_resumen" INTEGER NOT NULL DEFAULT 300,

    CONSTRAINT "parametros_publicaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "adjuntos_sha256_key" ON "adjuntos"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "adjuntos_almacenamiento_key" ON "adjuntos"("almacenamiento_clave");

-- CreateIndex
CREATE INDEX "adjuntos_creador_idx" ON "adjuntos"("creado_por_id");

-- CreateIndex
CREATE UNIQUE INDEX "adjuntos_id_sha256_key" ON "adjuntos"("id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "publicaciones_numero_key" ON "publicaciones"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "publicaciones_titulo_hash_key" ON "publicaciones"("titulo_hash");

-- CreateIndex
CREATE UNIQUE INDEX "publicaciones_resumen_hash_key" ON "publicaciones"("resumen_hash");

-- CreateIndex
CREATE UNIQUE INDEX "publicaciones_abstract_hash_key" ON "publicaciones"("abstract_hash");

-- CreateIndex
CREATE UNIQUE INDEX "publicaciones_adjunto_id_key" ON "publicaciones"("adjunto_id");

-- CreateIndex
CREATE UNIQUE INDEX "publicaciones_adjunto_hash_key" ON "publicaciones"("adjunto_hash");

-- CreateIndex
CREATE INDEX "publicaciones_carrera_idx" ON "publicaciones"("carrera_id", "carrera_tipo");

-- CreateIndex
CREATE INDEX "publicaciones_nivel_idx" ON "publicaciones"("nivel_id", "nivel_tipo");

-- CreateIndex
CREATE INDEX "publicaciones_tipo_idx" ON "publicaciones"("tipo_id", "tipo_catalogo");

-- CreateIndex
CREATE INDEX "publicaciones_filial_idx" ON "publicaciones"("filial_id", "filial_tipo");

-- CreateIndex
CREATE INDEX "publicaciones_creador_idx" ON "publicaciones"("creado_por_id");

-- CreateIndex
CREATE INDEX "publicaciones_fecha_id_idx" ON "publicaciones"("creado_en", "id");

-- CreateIndex
CREATE UNIQUE INDEX "publicaciones_adjunto_id_hash_key" ON "publicaciones"("adjunto_id", "adjunto_hash");

-- CreateIndex
CREATE INDEX "publicacion_autores_autor_idx" ON "publicacion_autores"("autor_id");

-- CreateIndex
CREATE UNIQUE INDEX "publicacion_autores_orden_key" ON "publicacion_autores"("publicacion_id", "orden");

-- CreateIndex
CREATE INDEX "publicacion_tutores_tutor_idx" ON "publicacion_tutores"("tutor_id");

-- CreateIndex
CREATE UNIQUE INDEX "publicacion_tutores_orden_key" ON "publicacion_tutores"("publicacion_id", "orden");

-- CreateIndex
CREATE UNIQUE INDEX "catalogos_id_tipo_key" ON "catalogos"("id", "tipo");

-- AddForeignKey
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicaciones" ADD CONSTRAINT "publicaciones_adjunto_id_adjunto_hash_fkey" FOREIGN KEY ("adjunto_id", "adjunto_hash") REFERENCES "adjuntos"("id", "sha256") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicaciones" ADD CONSTRAINT "publicaciones_carrera_id_carrera_tipo_fkey" FOREIGN KEY ("carrera_id", "carrera_tipo") REFERENCES "catalogos"("id", "tipo") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicaciones" ADD CONSTRAINT "publicaciones_nivel_id_nivel_tipo_fkey" FOREIGN KEY ("nivel_id", "nivel_tipo") REFERENCES "catalogos"("id", "tipo") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicaciones" ADD CONSTRAINT "publicaciones_tipo_id_tipo_catalogo_fkey" FOREIGN KEY ("tipo_id", "tipo_catalogo") REFERENCES "catalogos"("id", "tipo") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicaciones" ADD CONSTRAINT "publicaciones_filial_id_filial_tipo_fkey" FOREIGN KEY ("filial_id", "filial_tipo") REFERENCES "catalogos"("id", "tipo") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicaciones" ADD CONSTRAINT "publicaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicacion_autores" ADD CONSTRAINT "publicacion_autores_publicacion_id_fkey" FOREIGN KEY ("publicacion_id") REFERENCES "publicaciones"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicacion_autores" ADD CONSTRAINT "publicacion_autores_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "autores"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicacion_tutores" ADD CONSTRAINT "publicacion_tutores_publicacion_id_fkey" FOREIGN KEY ("publicacion_id") REFERENCES "publicaciones"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "publicacion_tutores" ADD CONSTRAINT "publicacion_tutores_tutor_id_fkey" FOREIGN KEY ("tutor_id") REFERENCES "tutores"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE publicaciones
  ADD CONSTRAINT publicaciones_textos_check CHECK (length(btrim(titulo)) > 0 AND length(btrim(resumen)) > 0 AND length(btrim(abstract)) > 0 AND length(btrim(palabras_clave)) > 0),
  ADD CONSTRAINT publicaciones_hashes_check CHECK (titulo_hash ~ '^[0-9a-f]{64}$' AND resumen_hash ~ '^[0-9a-f]{64}$' AND abstract_hash ~ '^[0-9a-f]{64}$' AND (adjunto_hash IS NULL OR adjunto_hash ~ '^[0-9a-f]{64}$')),
  ADD CONSTRAINT publicaciones_anio_check CHECK (anio BETWEEN 1900 AND 9999),
  ADD CONSTRAINT publicaciones_catalogos_tipo_check CHECK (carrera_tipo = 'carreras' AND nivel_tipo = 'niveles' AND tipo_catalogo = 'tipos' AND filial_tipo = 'filiales'),
  ADD CONSTRAINT publicaciones_adjunto_par_check CHECK ((adjunto_id IS NULL) = (adjunto_hash IS NULL)),
  ADD CONSTRAINT publicaciones_modalidad_check CHECK (
    (origen = 'EXTERNA' AND NOT requiere_copia_biblioteca AND url_externa ~ '^https?://' AND url_externa IS NOT NULL AND adjunto_id IS NULL)
    OR (origen = 'LOCAL' AND url_externa IS NULL AND (NOT requiere_copia_biblioteca OR adjunto_id IS NOT NULL))
  );
ALTER TABLE adjuntos
  ADD CONSTRAINT adjuntos_pdf_check CHECK (mime = 'application/pdf' AND tamano BETWEEN 1 AND 10485760),
  ADD CONSTRAINT adjuntos_nombre_check CHECK (length(btrim(nombre)) > 0 AND lower(right(nombre, 4)) = '.pdf' AND nombre !~ '[[:cntrl:]/:*?"<>|]' AND position(chr(92) in nombre) = 0),
  ADD CONSTRAINT adjuntos_hash_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT adjuntos_almacenamiento_check CHECK (length(btrim(almacenamiento_clave)) > 0),
  ADD CONSTRAINT adjuntos_clean_check CHECK (estado <> 'CLEAN' OR (contenido_verificado AND analizado_en IS NOT NULL));
ALTER TABLE publicacion_autores ADD CONSTRAINT publicacion_autores_orden_check CHECK (orden > 0);
ALTER TABLE publicacion_tutores ADD CONSTRAINT publicacion_tutores_orden_check CHECK (orden > 0);
ALTER TABLE parametros_publicaciones ADD CONSTRAINT parametros_publicaciones_singleton_check CHECK (id = 1 AND limite_palabras_resumen BETWEEN 1 AND 10000);
INSERT INTO parametros_publicaciones(id, limite_palabras_resumen) VALUES (1, 300);

-- Deferred cardinality checks allow nested inserts but reject a publication with
-- no authors/tutors at COMMIT, including removal/moving of its final relationship.
CREATE FUNCTION public.check_publication_participants() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  publication_ids uuid[];
  pid uuid;
BEGIN
  IF TG_TABLE_NAME = 'publicaciones' THEN
    publication_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    publication_ids := ARRAY[OLD.publicacion_id];
  ELSE
    publication_ids := ARRAY[OLD.publicacion_id, NEW.publicacion_id];
  END IF;
  FOREACH pid IN ARRAY publication_ids LOOP
    IF EXISTS (SELECT 1 FROM public.publicaciones WHERE id = pid)
       AND (NOT EXISTS (SELECT 1 FROM public.publicacion_autores WHERE publicacion_id = pid)
         OR NOT EXISTS (SELECT 1 FROM public.publicacion_tutores WHERE publicacion_id = pid)) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Una publicación requiere al menos un autor y un tutor.';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER publicaciones_participantes_check
  AFTER INSERT OR UPDATE ON public.publicaciones DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_publication_participants();
CREATE CONSTRAINT TRIGGER publicacion_autores_minimo_check
  AFTER DELETE OR UPDATE ON public.publicacion_autores DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_publication_participants();
CREATE CONSTRAINT TRIGGER publicacion_tutores_minimo_check
  AFTER DELETE OR UPDATE ON public.publicacion_tutores DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.check_publication_participants();

COMMIT;
