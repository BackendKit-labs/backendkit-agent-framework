from typing import Optional

from pydantic import BaseModel, Field

from src.models.enums import Severidad


class PatronErrorSchema(BaseModel):
    nombre: str
    regex: str
    severidad: Severidad
    modulo: str


class UmbralesSchema(BaseModel):
    max_errores_por_minuto: int = Field(default=100, ge=0)
    max_tiempo_respuesta_ms: int = Field(default=5000, ge=0)
    max_fallos_consecutivos: int = Field(default=3, ge=0)


class NotificacionSchema(BaseModel):
    email: bool = False
    webhook: bool = False
    webhook_url: Optional[str] = None


class ConfigSchema(BaseModel):
    rutas_log: list[str]
    patrones_error: list[PatronErrorSchema]
    suite_pruebas: str
    umbrales: UmbralesSchema
    programacion: Optional[str] = None
    notificaciones: NotificacionSchema = Field(default_factory=NotificacionSchema)


class AgentConfigSchema(BaseModel):
    nombre: str
    configuracion: ConfigSchema
