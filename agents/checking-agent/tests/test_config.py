"""Unit tests for YAML configuration loading."""

from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from src.config.loader import EmptyConfigError, default_config, load_config
from src.config.schema import AgentConfigSchema, ConfigSchema, NotificacionSchema, UmbralesSchema
from src.models.enums import Severidad


class TestLoadConfig:
    def test_load_valid_yaml(self, tmp_path: Path) -> None:
        config_path = tmp_path / "valid_config.yaml"
        config_data = {
            "nombre": "test-agent",
            "configuracion": {
                "rutas_log": ["/var/log/app/*.log"],
                "patrones_error": [
                    {
                        "nombre": "fatal-error",
                        "regex": "FATAL.*Exception",
                        "severidad": "CRITICAL",
                        "modulo": "app-core",
                    }
                ],
                "suite_pruebas": "/tests/suite",
                "umbrales": {
                    "max_errores_por_minuto": 50,
                    "max_tiempo_respuesta_ms": 3000,
                    "max_fallos_consecutivos": 5,
                },
                "programacion": "0 */6 * * *",
                "notificaciones": {
                    "email": True,
                    "webhook": False,
                },
            },
        }
        with config_path.open("w", encoding="utf-8") as f:
            yaml.dump(config_data, f)

        result = load_config(str(config_path))
        assert isinstance(result, AgentConfigSchema)
        assert result.nombre == "test-agent"
        assert len(result.configuracion.patrones_error) == 1
        assert result.configuracion.patrones_error[0].severidad == Severidad.CRITICAL
        assert result.configuracion.programacion == "0 */6 * * *"
        assert result.configuracion.notificaciones.email is True

    def test_missing_file_raises(self) -> None:
        with pytest.raises(FileNotFoundError):
            load_config("/nonexistent/path/config.yaml")

    def test_invalid_yaml_raises(self, tmp_path: Path) -> None:
        config_path = tmp_path / "invalid.yaml"
        config_path.write_text("nombre: 123\nconfiguracion: invalid", encoding="utf-8")

        with pytest.raises(ValidationError):
            load_config(str(config_path))

    def test_empty_yaml_raises(self, tmp_path: Path) -> None:
        config_path = tmp_path / "empty.yaml"
        config_path.write_text("", encoding="utf-8")

        with pytest.raises(EmptyConfigError):
            load_config(str(config_path))

    def test_config_with_optional_fields(self, tmp_path: Path) -> None:
        config_path = tmp_path / "minimal.yaml"
        config_data = {
            "nombre": "minimal-agent",
            "configuracion": {
                "rutas_log": ["/var/log/app/*.log"],
                "patrones_error": [],
                "suite_pruebas": "/tests/minimal",
                "umbrales": {
                    "max_errores_por_minuto": 100,
                    "max_tiempo_respuesta_ms": 5000,
                    "max_fallos_consecutivos": 3,
                },
            },
        }
        with config_path.open("w", encoding="utf-8") as f:
            yaml.dump(config_data, f)

        result = load_config(str(config_path))
        assert result.nombre == "minimal-agent"
        assert result.configuracion.programacion is None
        assert result.configuracion.notificaciones.email is False

    def test_config_with_custom_patterns(self, tmp_path: Path) -> None:
        config_path = tmp_path / "custom_patterns.yaml"
        config_data = {
            "nombre": "custom-agent",
            "configuracion": {
                "rutas_log": ["/var/log/custom/*.log"],
                "patrones_error": [
                    {
                        "nombre": "critical-oom",
                        "regex": "OutOfMemoryError",
                        "severidad": "CRITICAL",
                        "modulo": "jvm",
                    },
                    {
                        "nombre": "warning-leak",
                        "regex": "memory.*leak",
                        "severidad": "MEDIUM",
                        "modulo": "jvm",
                    },
                    {
                        "nombre": "info-timeout",
                        "regex": "request.*timed?out",
                        "severidad": "LOW",
                        "modulo": "network",
                    },
                ],
                "suite_pruebas": "/tests/custom",
                "umbrales": {
                    "max_errores_por_minuto": 200,
                    "max_tiempo_respuesta_ms": 10000,
                    "max_fallos_consecutivos": 10,
                },
            },
        }
        with config_path.open("w", encoding="utf-8") as f:
            yaml.dump(config_data, f)

        result = load_config(str(config_path))
        assert len(result.configuracion.patrones_error) == 3
        severities = [p.severidad for p in result.configuracion.patrones_error]
        assert Severidad.CRITICAL in severities
        assert Severidad.MEDIUM in severities
        assert Severidad.LOW in severities


class TestDefaultConfig:
    def test_default_config_returns_valid_schema(self) -> None:
        config = default_config()
        assert isinstance(config, AgentConfigSchema)
        assert config.nombre == "default-agent"
        assert isinstance(config.configuracion, ConfigSchema)
        assert isinstance(config.configuracion.umbrales, UmbralesSchema)
        assert isinstance(config.configuracion.notificaciones, NotificacionSchema)

    def test_default_config_has_sensible_defaults(self) -> None:
        config = default_config()
        assert config.configuracion.umbrales.max_errores_por_minuto == 100
        assert config.configuracion.umbrales.max_tiempo_respuesta_ms == 5000
        assert config.configuracion.umbrales.max_fallos_consecutivos == 3
        assert config.configuracion.notificaciones.email is False
        assert config.configuracion.notificaciones.webhook is False
        assert config.configuracion.programacion is None
        assert len(config.configuracion.patrones_error) == 0

    def test_default_config_serialization(self) -> None:
        config = default_config()
        data = config.model_dump(mode="json")
        restored = AgentConfigSchema.model_validate(data)
        assert restored.nombre == config.nombre
        assert restored.configuracion.suite_pruebas == config.configuracion.suite_pruebas
