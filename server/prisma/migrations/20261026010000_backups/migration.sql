CREATE TABLE public.respaldos (
  id UUID PRIMARY KEY,
  creado_en TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalizado_en TIMESTAMPTZ(3),
  origen VARCHAR(20) NOT NULL CHECK (origen IN ('MANUAL', 'PROGRAMADO')),
  estado VARCHAR(20) NOT NULL CHECK (estado IN ('EN_CURSO', 'COMPLETO', 'PARCIAL', 'FALLIDO')),
  archivo VARCHAR(150),
  copia_local BOOLEAN NOT NULL DEFAULT false,
  copia_nube BOOLEAN NOT NULL DEFAULT false,
  detalle TEXT
);
CREATE INDEX respaldos_fecha_idx ON public.respaldos (creado_en, id);
