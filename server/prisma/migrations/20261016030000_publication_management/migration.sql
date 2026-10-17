BEGIN;
ALTER TABLE parametros_publicaciones ADD COLUMN formatos_admitidos TEXT[] NOT NULL DEFAULT ARRAY['pdf']::text[];
ALTER TABLE parametros_publicaciones ADD CONSTRAINT parametros_formatos_check CHECK (
  cardinality(formatos_admitidos) BETWEEN 1 AND 2
  AND formatos_admitidos <@ ARRAY['pdf','txt']::text[]
  AND array_position(formatos_admitidos, NULL) IS NULL
  AND (cardinality(formatos_admitidos) = 1 OR formatos_admitidos[1] <> formatos_admitidos[2])
  AND array_ndims(formatos_admitidos) = 1 AND array_lower(formatos_admitidos, 1) = 1
);
ALTER TABLE adjuntos DROP CONSTRAINT adjuntos_pdf_check, DROP CONSTRAINT adjuntos_nombre_check;
ALTER TABLE adjuntos ADD CONSTRAINT adjuntos_formato_check CHECK (
  tamano BETWEEN 1 AND 10485760 AND (
    (mime = 'application/pdf' AND lower(right(nombre, 4)) = '.pdf') OR
    (mime = 'text/plain' AND lower(right(nombre, 4)) = '.txt')
  )
), ADD CONSTRAINT adjuntos_nombre_check CHECK (
  length(btrim(nombre)) > 4 AND nombre !~ '[[:cntrl:]/:*?"<>|]' AND position(chr(92) in nombre) = 0
);

CREATE TABLE asignaciones_adjuntos (
  adjunto_id UUID PRIMARY KEY REFERENCES adjuntos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  publicacion_id UUID NOT NULL REFERENCES publicaciones(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX asignaciones_adjuntos_publicacion_idx ON asignaciones_adjuntos(publicacion_id);
INSERT INTO asignaciones_adjuntos(adjunto_id, publicacion_id)
  SELECT adjunto_id, id FROM publicaciones WHERE adjunto_id IS NOT NULL;
CREATE FUNCTION public.reserve_publication_attachment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.adjunto_id IS NOT NULL THEN
    INSERT INTO public.asignaciones_adjuntos(adjunto_id, publicacion_id)
      VALUES (NEW.adjunto_id, NEW.id) ON CONFLICT (adjunto_id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.asignaciones_adjuntos WHERE adjunto_id = NEW.adjunto_id AND publicacion_id = NEW.id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'El adjunto ya fue utilizado en otra publicación.', CONSTRAINT = 'asignaciones_adjuntos_pkey';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER publicaciones_reserva_adjunto AFTER INSERT OR UPDATE OF adjunto_id ON publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.reserve_publication_attachment();
-- History cannot be reassigned or removed, even through the owner role.
CREATE FUNCTION public.protect_attachment_assignment() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'La asignación histórica de adjuntos es inmutable.'; END; $$;
CREATE TRIGGER asignaciones_adjuntos_inmutables BEFORE UPDATE OR DELETE OR TRUNCATE ON asignaciones_adjuntos
  FOR EACH STATEMENT EXECUTE FUNCTION public.protect_attachment_assignment();
COMMIT;
