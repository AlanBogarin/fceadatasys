BEGIN;
ALTER TABLE parametros_publicaciones DROP CONSTRAINT parametros_resumen_cliente_check;
COMMIT;
