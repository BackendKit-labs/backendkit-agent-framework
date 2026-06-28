from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import asyncpg
import structlog

logger = structlog.get_logger(__name__)


class DatabasePool:
    """Async PostgreSQL connection pool manager.

    Wraps asyncpg connection pool with convenience methods
    for executing queries and managing connections.
    """

    def __init__(self, dsn: str, min_size: int = 5, max_size: int = 20) -> None:
        self._dsn = dsn
        self._min_size = min_size
        self._max_size = max_size
        self._pool: asyncpg.Pool | None = None

    async def start(self) -> None:
        """Create the connection pool."""
        if self._pool is not None:
            logger.warning("database_pool_already_started")
            return

        self._pool = await asyncpg.create_pool(
            dsn=self._dsn,
            min_size=self._min_size,
            max_size=self._max_size,
        )
        logger.info("database_pool_started", min_size=self._min_size, max_size=self._max_size)

    async def stop(self) -> None:
        """Close the connection pool."""
        if self._pool is None:
            logger.warning("database_pool_not_started")
            return

        await self._pool.close()
        self._pool = None
        logger.info("database_pool_stopped")

    @property
    def pool(self) -> asyncpg.Pool:
        if self._pool is None:
            raise RuntimeError("Database pool not started. Call start() first.")
        return self._pool

    async def execute(self, query: str, *args: Any) -> str:
        """Execute a query and return the command status tag.

        Args:
            query: SQL query string.
            *args: Query parameters.

        Returns:
            Command status tag (e.g. "INSERT 0 1").
        """
        return await self.pool.execute(query, *args)

    async def fetch(self, query: str, *args: Any) -> list[asyncpg.Record]:
        """Fetch multiple rows from the database.

        Args:
            query: SQL query string.
            *args: Query parameters.

        Returns:
            List of Record objects.
        """
        return await self.pool.fetch(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> asyncpg.Record | None:
        """Fetch a single row from the database.

        Args:
            query: SQL query string.
            *args: Query parameters.

        Returns:
            A Record object or None if no rows match.
        """
        return await self.pool.fetchrow(query, *args)

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[asyncpg.Connection]:
        """Async context manager for acquiring a connection from the pool.

        Yields:
            An asyncpg Connection instance.
        """
        async with self.pool.acquire() as conn:
            yield conn
