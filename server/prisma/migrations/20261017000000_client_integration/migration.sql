BEGIN;
ALTER TABLE sesiones ADD COLUMN navegador_clave CHAR(64), ADD COLUMN fallos_confirmacion INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sesiones ADD CONSTRAINT sesiones_confirmacion_check CHECK (fallos_confirmacion BETWEEN 0 AND 3);
CREATE UNIQUE INDEX sesiones_navegador_activo_key ON sesiones(navegador_clave) WHERE revocado_en IS NULL AND navegador_clave IS NOT NULL;
ALTER TABLE parametros_publicaciones ADD COLUMN tamano_maximo_mb INTEGER NOT NULL DEFAULT 10;
ALTER TABLE parametros_publicaciones ADD CONSTRAINT parametros_tamano_check CHECK (tamano_maximo_mb BETWEEN 1 AND 25);
-- Preserve existing configured word limits; the API documents the same range.
ALTER TABLE adjuntos DROP CONSTRAINT adjuntos_formato_check;
ALTER TABLE adjuntos ADD CONSTRAINT adjuntos_formato_check CHECK (tamano BETWEEN 1 AND 26214400 AND (
 (mime = 'application/pdf' AND lower(right(nombre, 4)) = '.pdf') OR
 (mime = 'text/plain' AND lower(right(nombre, 4)) = '.txt')));
CREATE INDEX auditoria_rol_estado_fecha_idx ON auditoria(rol, estado, creado_en DESC);
CREATE INDEX adjuntos_fecha_id_idx ON adjuntos(creado_en DESC, id);
COMMIT;
