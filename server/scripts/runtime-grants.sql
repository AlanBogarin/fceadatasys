-- Run with the migration owner using psql -v app_role=<existing non-owner role>.
-- The application role must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION.
-- Do not grant membership in the database owner/migration role.
\set ON_ERROR_STOP on
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"DBNAME" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT USAGE ON TYPE public.rol_usuario, public.estado_auditoria TO :"app_role";
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM :"app_role";
GRANT SELECT, INSERT, UPDATE ON public.usuarios, public.sesiones,
  public.tokens_refresh, public.tokens_recuperacion, public.limites_recuperacion TO :"app_role";
GRANT SELECT, INSERT ON public.auditoria TO :"app_role";
COMMIT;
