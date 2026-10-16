-- Revert ONLY 20261016010000_publication_registration in maintenance mode,
-- after a verified backup. Refuses data loss; never changes immutable audit logs.
BEGIN;
LOCK TABLE public.publicaciones, public.publicacion_autores, public.publicacion_tutores,
  public.adjuntos, public.parametros_publicaciones IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.publicaciones) OR EXISTS (SELECT 1 FROM public.adjuntos)
     OR EXISTS (SELECT 1 FROM public.parametros_publicaciones WHERE limite_palabras_resumen <> 300) THEN
    RAISE EXCEPTION 'No se puede revertir publicaciones con datos o parámetros modificados.';
  END IF;
END;
$$;
DROP TABLE public.publicacion_autores;
DROP TABLE public.publicacion_tutores;
DROP TABLE public.publicaciones;
DROP FUNCTION public.check_publication_participants();
DROP TABLE public.adjuntos;
DROP TABLE public.parametros_publicaciones;
DROP TYPE public.origen_publicacion;
DROP TYPE public.estado_adjunto;
DROP INDEX public.catalogos_id_tipo_key;
COMMIT;
-- Prisma history is intentionally untouched. Restore a consistent backup or
-- forward repair after a manual down; migrate deploy does not replay applied rows.
