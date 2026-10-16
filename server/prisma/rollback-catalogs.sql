-- Revert ONLY 20261016000000_catalogs, in maintenance mode with a verified backup.
-- Refuses to destroy catalog data; incoming FK dependencies also prevent DROP.
-- Does not remove authentication, users, immutable audit logs or migration history.
BEGIN;
LOCK TABLE public.autores, public.tutores, public.catalogos IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.autores) OR EXISTS (SELECT 1 FROM public.tutores)
     OR EXISTS (SELECT 1 FROM public.catalogos) THEN
    RAISE EXCEPTION 'No se puede revertir catálogos con datos; restaurar backup o aplicar una migración correctiva.';
  END IF;
END;
$$;
DROP TABLE public.autores;
DROP TABLE public.tutores;
DROP TABLE public.catalogos;
DROP TYPE public.tipo_catalogo;
COMMIT;
-- Prisma history is intentionally untouched. Do not run migrate deploy after a
-- manual down on a tracked database. Restore a consistent backup or forward repair.
