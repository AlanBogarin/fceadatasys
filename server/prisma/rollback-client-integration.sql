BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM adjuntos WHERE tamano > 10485760) OR EXISTS (SELECT 1 FROM parametros_publicaciones WHERE tamano_maximo_mb <> 10) OR EXISTS (SELECT 1 FROM sesiones WHERE navegador_clave IS NOT NULL OR fallos_confirmacion <> 0) THEN
  RAISE EXCEPTION 'La integración tiene datos nuevos. No se permite una reversión destructiva.';
 END IF;
END $$;
DROP INDEX auditoria_rol_estado_fecha_idx;
DROP INDEX adjuntos_fecha_id_idx;
ALTER TABLE adjuntos DROP CONSTRAINT adjuntos_formato_check;
ALTER TABLE adjuntos ADD CONSTRAINT adjuntos_formato_check CHECK (tamano BETWEEN 1 AND 10485760 AND ((mime='application/pdf' AND lower(right(nombre,4))='.pdf') OR (mime='text/plain' AND lower(right(nombre,4))='.txt')));
ALTER TABLE parametros_publicaciones DROP COLUMN tamano_maximo_mb;
DROP INDEX sesiones_navegador_activo_key;
ALTER TABLE sesiones DROP COLUMN navegador_clave, DROP COLUMN fallos_confirmacion;
COMMIT;
