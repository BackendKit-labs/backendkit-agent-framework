from pathlib import Path

import yaml
from pydantic import ValidationError

from src.config.schema import AgentConfigSchema, ConfigSchema, NotificacionSchema, UmbralesSchema


class EmptyConfigError(ValueError):
    """Raised when the YAML configuration file is empty."""


def load_config(path: str) -> AgentConfigSchema:
    """Load and validate a YAML configuration file.

    Args:
        path: Path to the YAML configuration file.

    Returns:
        A validated AgentConfigSchema instance.

    Raises:
        FileNotFoundError: If the file does not exist.
        EmptyConfigError: If the YAML file is empty.
        ValidationError: If the YAML content fails schema validation.
    """
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f"Configuration file not found: {path}")

    with file_path.open("r", encoding="utf-8") as f:
        raw_data = yaml.safe_load(f)

    if raw_data is None:
        raise EmptyConfigError(f"YAML file is empty: {path}")

    return AgentConfigSchema.model_validate(raw_data)


def default_config() -> AgentConfigSchema:
    """Return a default agent configuration.

    Returns:
        An AgentConfigSchema with sensible defaults.
    """
    return AgentConfigSchema(
        nombre="default-agent",
        configuracion=ConfigSchema(
            rutas_log=["/var/log/app/*.log"],
            patrones_error=[],
            suite_pruebas="/tests/default_suite",
            umbrales=UmbralesSchema(),
            programacion=None,
            notificaciones=NotificacionSchema(),
        ),
    )
