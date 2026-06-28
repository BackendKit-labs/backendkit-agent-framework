from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from src.models.enums import EstadoAgente, Severidad


class PatronError(BaseModel):
    nombre: str = Field(min_length=1)
    regex: str = Field(min_length=1)
    severidad: Severidad
    modulo: str = Field(min_length=1)


class Umbrales(BaseModel):
    max_errores_por_minuto: int = Field(default=100, ge=0)
    max_tiempo_respuesta_ms: int = Field(default=5000, ge=0)
    max_fallos_consecutivos: int = Field(default=3, ge=0)


class NotificacionConfig(BaseModel):
    email: bool = False
    webhook: bool = False
    webhook_url: Optional[str] = None


class ConfiguracionAgente(BaseModel):
    rutas_log: list[str]
    patrones_error: list[PatronError]
    suite_pruebas: str
    umbrales: Umbrales
    programacion: Optional[str] = None
    notificaciones: NotificacionConfig = Field(default_factory=NotificacionConfig)


class AgenteAnalisis(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    nombre: str
    configuracion: ConfiguracionAgente
    estado: EstadoAgente = EstadoAgente.IDLE
    ultima_ejecucion: Optional[datetime] = None
    creado: datetime = Field(default_factory=datetime.now)
