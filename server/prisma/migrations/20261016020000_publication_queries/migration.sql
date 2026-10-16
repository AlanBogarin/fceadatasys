BEGIN;
-- Compatibility normalization plus combining diacritics used by Spanish/English.
-- Requires the UTF-8 PostgreSQL database already used by this project.
CREATE FUNCTION public.publication_search_text(value text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT regexp_replace(normalize(coalesce(value,''), NFKD), U&'[\0300-\036f\1ab0-\1aff\1dc0-\1dff\20d0-\20ff\fe20-\fe2f]', '', 'g');
$$;
-- Explicit text search configurations make these immutable/indexable. No
-- extensions or untrusted language/parser are needed. simple preserves literal
-- bilingual terms while Spanish/English supply stemming and stop-word handling.
CREATE FUNCTION public.publication_search_document(title text, summary text, english_abstract text, keywords text)
RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT setweight(to_tsvector('spanish'::regconfig, public.publication_search_text(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(keywords,''))), 'A')
    || setweight(to_tsvector('english'::regconfig, public.publication_search_text(english_abstract)), 'B')
    || to_tsvector('simple'::regconfig, public.publication_search_text(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(english_abstract,'') || ' ' || coalesce(keywords,'')));
$$;
CREATE FUNCTION public.publication_person_document(name text)
RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, pg_temp AS $$
  SELECT to_tsvector('spanish'::regconfig, public.publication_search_text(name)) || to_tsvector('simple'::regconfig, public.publication_search_text(name));
$$;
CREATE INDEX publicaciones_busqueda_gin ON public.publicaciones
  USING GIN (public.publication_search_document(titulo, resumen, abstract, palabras_clave));
CREATE INDEX autores_busqueda_gin ON public.autores USING GIN (public.publication_person_document(nombre_completo));
CREATE INDEX tutores_busqueda_gin ON public.tutores USING GIN (public.publication_person_document(nombre_completo));
CREATE INDEX publicaciones_activo_fecha_numero_idx ON public.publicaciones (activo, creado_en DESC, numero DESC);
COMMIT;
