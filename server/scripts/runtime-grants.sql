-- Run with the migration owner using psql -v app_role=<existing non-owner role>.
-- The application role must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION.
-- Do not grant membership in the database owner/migration role.
\set ON_ERROR_STOP on
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT USAGE ON TYPE public.rol_usuario, public.estado_auditoria, public.tipo_catalogo,
  public.origen_publicacion, public.estado_adjunto TO :"app_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"app_role";
GRANT SELECT, INSERT, UPDATE ON public.usuarios, public.sesiones,
  public.tokens_refresh, public.tokens_recuperacion, public.limites_recuperacion TO :"app_role";
GRANT DELETE ON public.usuarios, public.tokens_recuperacion TO :"app_role";
GRANT SELECT, INSERT ON public.auditoria TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON public.autores, public.tutores, public.catalogos TO :"app_role";
GRANT SELECT, INSERT ON public.publicaciones, public.publicacion_autores, public.publicacion_tutores TO :"app_role";
GRANT USAGE ON SEQUENCE public.publicaciones_numero_seq TO :"app_role";
GRANT SELECT, UPDATE ON public.parametros_publicaciones TO :"app_role";
-- Only server-side ClamAV verdicts may provision files or quarantine records.
-- Narrow UPDATE grants also permit row locks during registration/download.
GRANT SELECT ON public.adjuntos TO :"app_role";
GRANT INSERT ON public.adjuntos TO :"app_role";
GRANT UPDATE (estado, analizado_en) ON public.adjuntos TO :"app_role";
GRANT UPDATE (activo) ON public.publicaciones TO :"app_role";
COMMIT;
