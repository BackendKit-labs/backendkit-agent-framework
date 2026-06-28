from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

import structlog

from src.database.connection import DatabasePool
from src.models.agent import AgenteAnalisis, ConfiguracionAgente, NotificacionConfig, PatronError, Umbrales
from src.models.enums import EstadoAgente, EstadoEjecucion, EstadoPrueba, Severidad, TipoCorrelacion
from src.models.execution import Correlacion, EjecucionAnalisis, ErrorEncontrado, PruebaResultado

logger = structlog.get_logger(__name__)


def _row_to_agente(row: asyncpg_record_to_dict) -> AgenteAnalisis:
    """Convert a database row to an AgenteAnalisis model."""
    return AgenteAnalisis(
        id=row["id"],
        nombre=row["nombre"],
        estado=EstadoAgente(row["estado"]),
        ultima_ejecucion=row["ultima_ejecucion"],
        creado=row["creado"],
        configuracion=ConfiguracionAgente(
            rutas_log=[],
            patrones_error=[],
            suite_pruebas="",
            umbrales=Umbrales(),
        ),
    )


def _row_to_ejecucion(row: asyncpg_record_to_dict) -> EjecucionAnalisis:
    """Convert a database row to an EjecucionAnalisis model."""
    return EjecucionAnalisis(
        id=row["id"],
        agente_id=row["agente_id"],
        inicio=row["inicio"],
        fin=row["fin"],
        estado=EstadoEjecucion(row["estado"]),
    )


# Type alias for clarity — asyncpg.Record supports dict-like access
asyncpg_record_to_dict = Any


class BaseRepository:
    """Base repository with CRUD operations for the checking agent domain."""

    def __init__(self, pool: DatabasePool) -> None:
        self._pool = pool

    # ── Agentes ──────────────────────────────────────────────────────────

    async def create_agente(self, agente: AgenteAnalisis) -> AgenteAnalisis:
        """Insert a new agent into the database."""
        await self._pool.execute(
            """
            INSERT INTO agentes (id, nombre, estado, ultima_ejecucion, creado)
            VALUES ($1, $2, $3, $4, $5)
            """,
            agente.id,
            agente.nombre,
            agente.estado.value,
            agente.ultima_ejecucion,
            agente.creado,
        )
        logger.info("agent_created", agent_id=str(agente.id), name=agente.nombre)
        return agente

    async def get_agente(self, agente_id: UUID) -> Optional[AgenteAnalisis]:
        """Retrieve an agent by ID."""
        row = await self._pool.fetchrow(
            "SELECT id, nombre, estado, ultima_ejecucion, creado FROM agentes WHERE id = $1",
            agente_id,
        )
        if row is None:
            return None
        return _row_to_agente(row)

    async def list_agentes(self) -> list[AgenteAnalisis]:
        """List all agents."""
        rows = await self._pool.fetch(
            "SELECT id, nombre, estado, ultima_ejecucion, creado FROM agentes ORDER BY creado DESC"
        )
        return [_row_to_agente(row) for row in rows]

    async def update_agente(self, agente_id: UUID, updates: dict) -> Optional[AgenteAnalisis]:
        """Update an agent's fields.

        Args:
            agente_id: The agent UUID.
            updates: Dictionary of field names to new values.
                     Enum fields should be passed as strings.

        Returns:
            The updated AgenteAnalisis or None if not found.
        """
        if not updates:
            return await self.get_agente(agente_id)

        set_clauses: list[str] = []
        values: list[Any] = []
        idx = 1

        for key, value in updates.items():
            if key == "estado" and isinstance(value, EstadoAgente):
                value = value.value
            set_clauses.append(f"{key} = ${idx}")
            values.append(value)
            idx += 1

        values.append(agente_id)
        query = f"UPDATE agentes SET {', '.join(set_clauses)} WHERE id = ${idx} RETURNING id, nombre, estado, ultima_ejecucion, creado"

        row = await self._pool.fetchrow(query, *values)
        if row is None:
            return None
        return _row_to_agente(row)

    async def delete_agente(self, agente_id: UUID) -> bool:
        """Delete an agent by ID.

        Returns:
            True if a row was deleted, False otherwise.
        """
        result = await self._pool.execute("DELETE FROM agentes WHERE id = $1", agente_id)
        # asyncpg returns "DELETE 0" or "DELETE 1"
        return "DELETE 1" in result

    # ── Configuraciones ──────────────────────────────────────────────────

    async def save_configuracion(self, agente_id: UUID, config: ConfiguracionAgente) -> int:
        """Save an agent's configuration.

        Returns:
            The configuration ID (serial).
        """
        config_id_row = await self._pool.fetchrow(
            """
            INSERT INTO configuraciones (agente_id, rutas_log, suite_pruebas, umbrales, programacion, notificaciones)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
            """,
            agente_id,
            json.dumps(config.rutas_log),
            config.suite_pruebas,
            json.dumps(config.umbrales.model_dump()),
            config.programacion,
            json.dumps(config.notificaciones.model_dump()),
        )
        config_id: int = config_id_row["id"]

        for patron in config.patrones_error:
            await self._pool.execute(
                """
                INSERT INTO patrones_error (configuracion_id, nombre, regex, severidad, modulo)
                VALUES ($1, $2, $3, $4, $5)
                """,
                config_id,
                patron.nombre,
                patron.regex,
                patron.severidad.value,
                patron.modulo,
            )

        logger.info("config_saved", agent_id=str(agente_id), config_id=config_id)
        return config_id

    async def get_configuracion(self, agente_id: UUID) -> Optional[ConfiguracionAgente]:
        """Retrieve the latest configuration for an agent."""
        row = await self._pool.fetchrow(
            """
            SELECT id, rutas_log, suite_pruebas, umbrales, programacion, notificaciones
            FROM configuraciones
            WHERE agente_id = $1
            ORDER BY creado DESC
            LIMIT 1
            """,
            agente_id,
        )
        if row is None:
            return None

        patrones_rows = await self._pool.fetch(
            "SELECT nombre, regex, severidad, modulo FROM patrones_error WHERE configuracion_id = $1",
            row["id"],
        )

        return ConfiguracionAgente(
            rutas_log=json.loads(row["rutas_log"]) if isinstance(row["rutas_log"], str) else row["rutas_log"],
            suite_pruebas=row["suite_pruebas"],
            umbrales=Umbrales(**json.loads(row["umbrales"]) if isinstance(row["umbrales"], str) else row["umbrales"]),
            programacion=row["programacion"],
            notificaciones=NotificacionConfig(
                **json.loads(row["notificaciones"]) if isinstance(row["notificaciones"], str) else row["notificaciones"]
            ),
            patrones_error=[
                PatronError(
                    nombre=p["nombre"],
                    regex=p["regex"],
                    severidad=Severidad(p["severidad"]),
                    modulo=p["modulo"],
                )
                for p in patrones_rows
            ],
        )

    # ── Ejecuciones ──────────────────────────────────────────────────────

    async def create_ejecucion(self, ejecucion: EjecucionAnalisis) -> EjecucionAnalisis:
        """Insert a new execution record."""
        await self._pool.execute(
            """
            INSERT INTO ejecuciones (id, agente_id, inicio, fin, estado)
            VALUES ($1, $2, $3, $4, $5)
            """,
            ejecucion.id,
            ejecucion.agente_id,
            ejecucion.inicio,
            ejecucion.fin,
            ejecucion.estado.value,
        )
        logger.info("execution_created", execution_id=str(ejecucion.id), agent_id=str(ejecucion.agente_id))
        return ejecucion

    async def get_ejecucion(self, ejecucion_id: UUID) -> Optional[EjecucionAnalisis]:
        """Retrieve an execution by ID."""
        row = await self._pool.fetchrow(
            "SELECT id, agente_id, inicio, fin, estado FROM ejecuciones WHERE id = $1",
            ejecucion_id,
        )
        if row is None:
            return None
        return _row_to_ejecucion(row)

    async def list_ejecuciones(self, agente_id: UUID) -> list[EjecucionAnalisis]:
        """List all executions for a given agent."""
        rows = await self._pool.fetch(
            "SELECT id, agente_id, inicio, fin, estado FROM ejecuciones WHERE agente_id = $1 ORDER BY inicio DESC",
            agente_id,
        )
        return [_row_to_ejecucion(row) for row in rows]

    # ── Errores ──────────────────────────────────────────────────────────

    async def save_error(self, error: ErrorEncontrado, ejecucion_id: UUID) -> ErrorEncontrado:
        """Save an error found during execution."""
        await self._pool.execute(
            """
            INSERT INTO errores (id, ejecucion_id, timestamp, modulo, mensaje, stack_trace, severidad, patron_asociado, frecuencia)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            """,
            error.id,
            ejecucion_id,
            error.timestamp,
            error.modulo,
            error.mensaje,
            error.stack_trace,
            error.severidad.value,
            error.patron_asociado,
            error.frecuencia,
        )
        return error

    # ── Pruebas ──────────────────────────────────────────────────────────

    async def save_prueba(self, prueba: PruebaResultado, ejecucion_id: UUID) -> PruebaResultado:
        """Save a test result."""
        await self._pool.execute(
            """
            INSERT INTO pruebas (ejecucion_id, nombre, modulo, estado, duracion_ms, mensaje_error, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            ejecucion_id,
            prueba.nombre,
            prueba.modulo,
            prueba.estado.value,
            prueba.duracion_ms,
            prueba.mensaje_error,
            prueba.timestamp,
        )
        return prueba

    # ── Correlaciones ────────────────────────────────────────────────────

    async def save_correlacion(self, correlacion: Correlacion, ejecucion_id: UUID) -> Correlacion:
        """Save a correlation between an error and a test."""
        await self._pool.execute(
            """
            INSERT INTO correlaciones (id, ejecucion_id, error_id, prueba_id, tipo, confianza, descripcion)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            correlacion.id,
            ejecucion_id,
            correlacion.error_id,
            correlacion.prueba_id,
            correlacion.tipo.value,
            correlacion.confianza,
            correlacion.descripcion,
        )
        return correlacion
