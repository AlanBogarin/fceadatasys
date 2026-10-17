-- Maintenance only, owner role. Refuses to discard new formats or detached history.
BEGIN;
LOCK TABLE publicaciones, adjuntos, parametros_publicaciones, asignaciones_adjuntos IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM adjuntos WHERE mime <> 'application/pdf')
    OR EXISTS (SELECT 1 FROM parametros_publicaciones WHERE formatos_admitidos <> ARRAY['pdf']::text[])
    OR EXISTS (SELECT 1 FROM asignaciones_adjuntos a WHERE NOT EXISTS (
      SELECT 1 FROM publicaciones p WHERE p.id = a.publicacion_id AND p.adjunto_id = a.adjunto_id)) THEN
    RAISE EXCEPTION 'La reversión perdería formatos configurados o historia de adjuntos. Conservar la migración y restaurar un backup si corresponde.';
  END IF;
END $$;
DROP TRIGGER publicaciones_reserva_adjunto ON publicaciones;
DROP FUNCTION public.reserve_publication_attachment();
DROP TABLE asignaciones_adjuntos;
DROP FUNCTION public.protect_attachment_assignment();
ALTER TABLE parametros_publicaciones DROP COLUMN formatos_admitidos;
ALTER TABLE adjuntos DROP CONSTRAINT adjuntos_formato_check, DROP CONSTRAINT adjuntos_nombre_check;
ALTER TABLE adjuntos ADD CONSTRAINT adjuntos_pdf_check CHECK (mime = 'application/pdf' AND tamano BETWEEN 1 AND 10485760),
  ADD CONSTRAINT adjuntos_nombre_check CHECK (length(btrim(nombre)) > 0 AND lower(right(nombre, 4)) = '.pdf' AND nombre !~ '[[:cntrl:]/:*?"<>|]' AND position(chr(92) in nombre) = 0);
COMMIT;
