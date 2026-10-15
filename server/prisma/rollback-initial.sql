-- Emergency rollback of the FIRST migration only. This destroys all initial data.
-- Requires maintenance mode, explicit operator approval and a verified backup.
-- Never run against a database containing later migrations or production history.
BEGIN;
DROP TABLE IF EXISTS public.auditoria;
DROP FUNCTION IF EXISTS public.reject_audit_mutation();
DROP TABLE IF EXISTS public.limites_recuperacion;
DROP TABLE IF EXISTS public.tokens_recuperacion;
DROP TABLE IF EXISTS public.tokens_refresh;
DROP TABLE IF EXISTS public.sesiones;
DROP TABLE IF EXISTS public.usuarios;
DROP TYPE IF EXISTS public.estado_auditoria;
DROP TYPE IF EXISTS public.rol_usuario;
COMMIT;
-- Prisma migration history is deliberately retained. For disposable test databases,
-- recreate the database before reapplying migrations. For production use restore
-- from backup or a forward repair migration; never fake a successfully applied down.
