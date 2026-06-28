CREATE TABLE IF NOT EXISTS agentes (
    id UUID PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'IDLE',
    ultima_ejecucion TIMESTAMP,
    creado TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS configuraciones (
    id SERIAL PRIMARY KEY,
    agente_id UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
    rutas_log JSONB NOT NULL,
    suite_pruebas VARCHAR(500) NOT NULL,
    umbrales JSONB NOT NULL,
    programacion VARCHAR(100),
    notificaciones JSONB DEFAULT '{}',
    creado TIMESTAMP NOT NULL DEFAULT NOW(),
    actualizado TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patrones_error (
    id SERIAL PRIMARY KEY,
    configuracion_id INTEGER NOT NULL REFERENCES configuraciones(id) ON DELETE CASCADE,
    nombre VARCHAR(255) NOT NULL,
    regex VARCHAR(500) NOT NULL,
    severidad VARCHAR(20) NOT NULL,
    modulo VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS ejecuciones (
    id UUID PRIMARY KEY,
    agente_id UUID NOT NULL REFERENCES agentes(id) ON DELETE CASCADE,
    inicio TIMESTAMP NOT NULL,
    fin TIMESTAMP,
    estado VARCHAR(20) NOT NULL DEFAULT 'RUNNING'
);

CREATE TABLE IF NOT EXISTS errores (
    id UUID PRIMARY KEY,
    ejecucion_id UUID NOT NULL REFERENCES ejecuciones(id) ON DELETE CASCADE,
    timestamp TIMESTAMP NOT NULL,
    modulo VARCHAR(255) NOT NULL,
    mensaje TEXT NOT NULL,
    stack_trace TEXT,
    severidad VARCHAR(20) NOT NULL,
    patron_asociado VARCHAR(255),
    frecuencia INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pruebas (
    id SERIAL PRIMARY KEY,
    ejecucion_id UUID NOT NULL REFERENCES ejecuciones(id) ON DELETE CASCADE,
    nombre VARCHAR(500) NOT NULL,
    modulo VARCHAR(255) NOT NULL,
    estado VARCHAR(20) NOT NULL,
    duracion_ms INTEGER NOT NULL DEFAULT 0,
    mensaje_error TEXT,
    timestamp TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS correlaciones (
    id UUID PRIMARY KEY,
    ejecucion_id UUID NOT NULL REFERENCES ejecuciones(id) ON DELETE CASCADE,
    error_id UUID NOT NULL REFERENCES errores(id) ON DELETE CASCADE,
    prueba_id INTEGER NOT NULL REFERENCES pruebas(id) ON DELETE CASCADE,
    tipo VARCHAR(20) NOT NULL,
    confianza REAL NOT NULL CHECK (confianza >= 0 AND confianza <= 1),
    descripcion TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ejecuciones_agente ON ejecuciones(agente_id);
CREATE INDEX IF NOT EXISTS idx_errores_ejecucion ON errores(ejecucion_id);
CREATE INDEX IF NOT EXISTS idx_pruebas_ejecucion ON pruebas(ejecucion_id);
CREATE INDEX IF NOT EXISTS idx_correlaciones_ejecucion ON correlaciones(ejecucion_id);
CREATE INDEX IF NOT EXISTS idx_errores_severidad ON errores(severidad);
CREATE INDEX IF NOT EXISTS idx_errores_timestamp ON errores(timestamp);
