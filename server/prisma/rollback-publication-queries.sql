-- Revert ONLY 20261016020000_publication_queries, in maintenance mode and with
-- a verified backup. Drops search indexes/functions; no bibliographic data lost.
BEGIN;
DROP INDEX public.publicaciones_busqueda_gin;
DROP INDEX public.autores_busqueda_gin;
DROP INDEX public.tutores_busqueda_gin;
DROP INDEX public.publicaciones_activo_fecha_numero_idx;
DROP FUNCTION public.publication_search_document(text, text, text, text);
DROP FUNCTION public.publication_person_document(text);
DROP FUNCTION public.publication_search_text(text);
COMMIT;
-- Does not modify Prisma history. Restore a consistent backup or forward repair
-- if a tracked deployment has been manually reverted.
