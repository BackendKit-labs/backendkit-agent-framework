from enum import Enum, StrEnum


class EstadoAgente(StrEnum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Severidad(StrEnum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class EstadoEjecucion(StrEnum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class EstadoPrueba(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    ERROR = "ERROR"


class TipoCorrelacion(StrEnum):
    CAUSA_DIRECTA = "CAUSA_DIRECTA"
    CAUSA_PROBABLE = "CAUSA_PROBABLE"
    COINCIDENCIA = "COINCIDENCIA"
