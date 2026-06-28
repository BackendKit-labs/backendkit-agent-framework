"""Unit tests for database operations using mocks."""

from datetime import datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID, uuid4

import pytest

from src.database.connection import DatabasePool
from src.database.repository import BaseRepository
from src.models.agent import (
    AgenteAnalisis,
    ConfiguracionAgente,
    NotificacionConfig,
    PatronError,
    Umbrales,
)
from src.models.enums import EstadoAgente, EstadoEjecucion, EstadoPrueba, Severidad
from src.models.execution import EjecucionAnalisis, ErrorEncontrado, PruebaResultado


@pytest.fixture
def mock_pool() -> MagicMock:
    """Create a mocked DatabasePool."""
    pool = MagicMock(spec=DatabasePool)
    pool.execute = AsyncMock()
    pool.fetch = AsyncMock()
    pool.fetchrow = AsyncMock()
    return pool


@pytest.fixture
def repository(mock_pool: MagicMock) -> BaseRepository:
    """Create a BaseRepository with a mocked pool."""
    return BaseRepository(mock_pool)


@pytest.fixture
def sample_agente() -> AgenteAnalisis:
    return AgenteAnalisis(
        nombre="test-agent",
        configuracion=ConfiguracionAgente(
            rutas_log=["/var/log/app/*.log"],
            patrones_error=[
                PatronError(
                    nombre="fatal",
                    regex="FATAL.*",
                    severidad=Severidad.CRITICAL,
                    modulo="core",
                )
            ],
            suite_pruebas="/tests/suite",
            umbrales=Umbrales(),
            notificaciones=NotificacionConfig(email=True),
        ),
    )


@pytest.fixture
def sample_ejecucion() -> EjecucionAnalisis:
    return EjecucionAnalisis(
        agente_id=uuid4(),
        inicio=datetime.now(),
    )


# ── DatabasePool Tests ──────────────────────────────────────────────────────


class TestDatabasePool:
    async def _make_pool_with_mock(self, **overrides: Any) -> tuple[DatabasePool, AsyncMock]:
        """Helper to create a DatabasePool with a mocked asyncpg pool.

        Args:
            **overrides: Attributes to set on the mock pool instance
                         (e.g. fetch=AsyncMock(return_value=[...])).
        """
        mock_pool_instance = AsyncMock()
        mock_pool_instance.execute = AsyncMock(return_value="INSERT 0 1")
        mock_pool_instance.fetch = AsyncMock(return_value=[])
        mock_pool_instance.fetchrow = AsyncMock(return_value=None)

        for key, value in overrides.items():
            setattr(mock_pool_instance, key, value)

        with patch("src.database.connection.asyncpg.create_pool", new_callable=AsyncMock) as mock_create:
            mock_create.return_value = mock_pool_instance
            pool = DatabasePool(dsn="postgresql://localhost/testdb")
            await pool.start()
            return pool, mock_create

    async def test_start(self) -> None:
        mock_pool_instance = AsyncMock()
        with patch("src.database.connection.asyncpg.create_pool", new_callable=AsyncMock) as mock_create:
            mock_create.return_value = mock_pool_instance

            pool = DatabasePool(dsn="postgresql://localhost/testdb")
            await pool.start()

            mock_create.assert_called_once_with(
                dsn="postgresql://localhost/testdb",
                min_size=5,
                max_size=20,
            )

    async def test_start_stop(self) -> None:
        mock_pool_instance = AsyncMock()
        with patch("src.database.connection.asyncpg.create_pool", new_callable=AsyncMock) as mock_create:
            mock_create.return_value = mock_pool_instance

            pool = DatabasePool(dsn="postgresql://localhost/testdb")
            await pool.start()
            await pool.stop()

            mock_pool_instance.close.assert_called_once()

    async def test_execute(self) -> None:
        pool, _ = await self._make_pool_with_mock(
            execute=AsyncMock(return_value="INSERT 0 1"),
        )

        result = await pool.execute("INSERT INTO test VALUES ($1)", 1)
        assert result == "INSERT 0 1"

    async def test_fetch(self) -> None:
        pool, _ = await self._make_pool_with_mock(
            fetch=AsyncMock(return_value=[{"id": 1}]),
        )

        rows = await pool.fetch("SELECT * FROM test")
        assert len(rows) == 1
        assert rows[0]["id"] == 1

    async def test_fetchrow(self) -> None:
        pool, _ = await self._make_pool_with_mock(
            fetchrow=AsyncMock(return_value={"id": 1, "name": "test"}),
        )

        row = await pool.fetchrow("SELECT * FROM test WHERE id = $1", 1)
        assert row is not None
        assert row["name"] == "test"

    async def test_fetchrow_not_found(self) -> None:
        pool, _ = await self._make_pool_with_mock(
            fetchrow=AsyncMock(return_value=None),
        )

        row = await pool.fetchrow("SELECT * FROM test WHERE id = $1", 999)
        assert row is None

    async def test_connection_context_manager(self) -> None:
        mock_conn = AsyncMock()
        mock_pool_instance = AsyncMock()
        mock_pool_instance.acquire = MagicMock()
        mock_pool_instance.acquire.return_value.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_pool_instance.acquire.return_value.__aexit__ = AsyncMock(return_value=None)
        pool, _ = await self._make_pool_with_mock(
            acquire=mock_pool_instance.acquire,
        )

        async with pool.connection() as conn:
            assert conn is mock_conn


# ── BaseRepository Tests ────────────────────────────────────────────────────


class TestBaseRepository:
    async def test_create_agente(self, repository: BaseRepository, mock_pool: MagicMock, sample_agente: AgenteAnalisis) -> None:
        mock_pool.execute.return_value = "INSERT 0 1"

        result = await repository.create_agente(sample_agente)

        assert result.id == sample_agente.id
        assert result.nombre == sample_agente.nombre
        mock_pool.execute.assert_awaited_once()

    async def test_get_agente_found(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        agent_id = uuid4()
        mock_pool.fetchrow.return_value = {
            "id": agent_id,
            "nombre": "test-agent",
            "estado": "IDLE",
            "ultima_ejecucion": None,
            "creado": datetime.now(),
        }

        result = await repository.get_agente(agent_id)

        assert result is not None
        assert result.id == agent_id
        assert result.nombre == "test-agent"
        assert result.estado == EstadoAgente.IDLE

    async def test_get_agente_not_found(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        mock_pool.fetchrow.return_value = None

        result = await repository.get_agente(uuid4())
        assert result is None

    async def test_list_agentes(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        agent_id_1 = uuid4()
        agent_id_2 = uuid4()
        mock_pool.fetch.return_value = [
            {"id": agent_id_1, "nombre": "agent-1", "estado": "IDLE", "ultima_ejecucion": None, "creado": datetime.now()},
            {"id": agent_id_2, "nombre": "agent-2", "estado": "RUNNING", "ultima_ejecucion": None, "creado": datetime.now()},
        ]

        results = await repository.list_agentes()

        assert len(results) == 2
        assert results[0].nombre == "agent-1"
        assert results[1].nombre == "agent-2"

    async def test_list_agentes_empty(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        mock_pool.fetch.return_value = []

        results = await repository.list_agentes()
        assert results == []

    async def test_update_agente(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        agent_id = uuid4()
        mock_pool.fetchrow.return_value = {
            "id": agent_id,
            "nombre": "updated-agent",
            "estado": "RUNNING",
            "ultima_ejecucion": None,
            "creado": datetime.now(),
        }

        result = await repository.update_agente(agent_id, {"nombre": "updated-agent", "estado": EstadoAgente.RUNNING})

        assert result is not None
        assert result.nombre == "updated-agent"
        assert result.estado == EstadoAgente.RUNNING

    async def test_update_agente_not_found(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        mock_pool.fetchrow.return_value = None

        result = await repository.update_agente(uuid4(), {"nombre": "ghost"})
        assert result is None

    async def test_update_agente_empty_updates(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        agent_id = uuid4()
        mock_pool.fetchrow.return_value = {
            "id": agent_id,
            "nombre": "same-agent",
            "estado": "IDLE",
            "ultima_ejecucion": None,
            "creado": datetime.now(),
        }

        result = await repository.update_agente(agent_id, {})
        assert result is not None
        assert result.nombre == "same-agent"

    async def test_delete_agente_found(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        mock_pool.execute.return_value = "DELETE 1"

        result = await repository.delete_agente(uuid4())
        assert result is True

    async def test_delete_agente_not_found(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        mock_pool.execute.return_value = "DELETE 0"

        result = await repository.delete_agente(uuid4())
        assert result is False

    async def test_save_configuracion(self, repository: BaseRepository, mock_pool: MagicMock, sample_agente: AgenteAnalisis) -> None:
        mock_pool.fetchrow.return_value = {"id": 42}
        mock_pool.execute.return_value = "INSERT 0 1"

        config_id = await repository.save_configuracion(sample_agente.id, sample_agente.configuracion)

        assert config_id == 42
        # Should have called execute for each patron
        assert mock_pool.execute.await_count >= 1

    async def test_create_ejecucion(self, repository: BaseRepository, mock_pool: MagicMock, sample_ejecucion: EjecucionAnalisis) -> None:
        mock_pool.execute.return_value = "INSERT 0 1"

        result = await repository.create_ejecucion(sample_ejecucion)

        assert result.id == sample_ejecucion.id
        assert result.agente_id == sample_ejecucion.agente_id
        assert result.estado == EstadoEjecucion.RUNNING
        mock_pool.execute.assert_awaited_once()

    async def test_get_ejecucion_found(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        ejecucion_id = uuid4()
        agente_id = uuid4()
        now = datetime.now()
        mock_pool.fetchrow.return_value = {
            "id": ejecucion_id,
            "agente_id": agente_id,
            "inicio": now,
            "fin": None,
            "estado": "RUNNING",
        }

        result = await repository.get_ejecucion(ejecucion_id)

        assert result is not None
        assert result.id == ejecucion_id
        assert result.agente_id == agente_id
        assert result.estado == EstadoEjecucion.RUNNING

    async def test_get_ejecucion_not_found(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        mock_pool.fetchrow.return_value = None

        result = await repository.get_ejecucion(uuid4())
        assert result is None

    async def test_list_ejecuciones(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        agente_id = uuid4()
        mock_pool.fetch.return_value = [
            {"id": uuid4(), "agente_id": agente_id, "inicio": datetime.now(), "fin": None, "estado": "RUNNING"},
            {"id": uuid4(), "agente_id": agente_id, "inicio": datetime.now(), "fin": datetime.now(), "estado": "COMPLETED"},
        ]

        results = await repository.list_ejecuciones(agente_id)

        assert len(results) == 2
        assert results[0].estado == EstadoEjecucion.RUNNING
        assert results[1].estado == EstadoEjecucion.COMPLETED

    async def test_save_error(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        mock_pool.execute.return_value = "INSERT 0 1"
        error = ErrorEncontrado(
            timestamp=datetime.now(),
            modulo="core",
            mensaje="FATAL error",
            severidad=Severidad.CRITICAL,
        )
        ejecucion_id = uuid4()

        result = await repository.save_error(error, ejecucion_id)

        assert result.id == error.id
        assert result.mensaje == error.mensaje
        mock_pool.execute.assert_awaited_once()

    async def test_save_prueba(self, repository: BaseRepository, mock_pool: MagicMock) -> None:
        mock_pool.execute.return_value = "INSERT 0 1"
        prueba = PruebaResultado(
            nombre="test_ok",
            modulo="test_module",
            estado=EstadoPrueba.PASSED,
            duracion_ms=100,
            timestamp=datetime.now(),
        )
        ejecucion_id = uuid4()

        result = await repository.save_prueba(prueba, ejecucion_id)

        assert result.nombre == prueba.nombre
        assert result.estado == EstadoPrueba.PASSED
        mock_pool.execute.assert_awaited_once()
