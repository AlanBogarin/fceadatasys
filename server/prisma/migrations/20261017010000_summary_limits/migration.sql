BEGIN;
-- Fail rather than silently rewriting an existing administrative setting.
ALTER TABLE parametros_publicaciones ADD CONSTRAINT parametros_resumen_cliente_check CHECK (limite_palabras_resumen BETWEEN 10 AND 1000);
COMMIT;
