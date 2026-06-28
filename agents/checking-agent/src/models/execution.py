from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from src.models.enums import (
    EstadoEjecucion,
    EstadoPrueba,
    Severidad,
    TipoCorrelacion,
)


class ErrorEncontrado(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    timestamp: datetime
    modulo: str
    mensaje: str
    stack_trace: Optional[str] = None
    severidad: Severidad
    patron_asociado: Optional[str] = None
    frecuencia: int = Field(default=1, ge=1)


class PruebaResultado(BaseModel):
    nombre: str
    modulo: str
    estado: EstadoPrueba
    duracion_ms: int = Field(ge=0)
    mensaje_error: Optional[str] = None
    timestamp: datetime


class Correlacion(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    error_id: UUID
    prueba_id: UUID
    tipo: TipoCorrelacion
    confianza: float = Field(ge=0.0, le=1.0)
    descripcion: str


class ResumenReporte(BaseModel):
    total_errores: int = Field(default=0, ge=0)
    total_pruebas: int = Field(default=0, ge=0)
    pruebas_fallidas: int = Field(default=0, ge=0)
    bugs_criticos: int = Field(default=0, ge=0)
    bugs_altos: int = Field(default=0, ge=0)
    tiempo_total_analisis_ms: int = Field(default=0, ge=0)
    recomendaciones: list[str] = Field(default_factory=list)


class ResultadoAnalisis(BaseModel):
    errores_encontrados: list[ErrorEncontrado] = Field(default_factory=list)
    pruebas_ejecutadas: list[PruebaResultado] = Field(default_factory=list)
    correlaciones: list[Correlacion] = Field(default_factory=list)
    resumen: ResumenReporte = Field(default_factory=ResumenReporte)


class EjecucionAnalisis(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    agente_id: UUID
    inicio: datetime
    fin: Optional[datetime] = None
    estado: EstadoEjecucion = EstadoEjecucion.RUNNING
    resultados: Optional[ResultadoAnalisis] = None
