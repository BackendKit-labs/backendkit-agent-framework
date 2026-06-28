"""Event producer for publishing scanned errors via Redis Pub/Sub."""

from __future__ import annotations

from typing import Any

import redis.asyncio as redis
import structlog

from src.models.execution import ErrorEncontrado

logger = structlog.get_logger(__name__)

DEFAULT_REDIS_HOST = "localhost"
DEFAULT_REDIS_PORT = 6379
DEFAULT_REDIS_DB = 0
PUBSUB_CHANNEL = "logs.scanned"


class EventProducer:
    """Publishes scanned errors to Redis Pub/Sub.

    If Redis is unavailable, logs a warning and continues without crashing.
    """

    def __init__(self, redis_client: redis.Redis | None = None) -> None:
        """Initialize the event producer.

        Args:
            redis_client: An optional Redis async client. If None, a default
                client is created connecting to localhost:6379, db=0.
        """
        self._redis: redis.Redis | None = redis_client
        self._owned: bool = redis_client is None

        if self._redis is None:
            try:
                self._redis = redis.Redis(
                    host=DEFAULT_REDIS_HOST,
                    port=DEFAULT_REDIS_PORT,
                    db=DEFAULT_REDIS_DB,
                    decode_responses=False,
                )
                logger.info(
                    "Created default Redis client",
                    host=DEFAULT_REDIS_HOST,
                    port=DEFAULT_REDIS_PORT,
                )
            except Exception as exc:
                logger.warning("Failed to create Redis client", error=str(exc))
                self._redis = None

    async def publish_error(self, error: ErrorEncontrado) -> None:
        """Publish a single error to the Redis Pub/Sub channel.

        Args:
            error: The ErrorEncontrado instance to publish.
        """
        if self._redis is None:
            logger.warning("Redis client not available, skipping publish")
            return

        try:
            message: str = error.model_dump_json()
            await self._redis.publish(PUBSUB_CHANNEL, message)
            logger.debug(
                "Published error to Redis",
                channel=PUBSUB_CHANNEL,
                error_id=str(error.id),
                severity=error.severidad.value,
            )
        except Exception as exc:
            logger.warning(
                "Failed to publish error to Redis",
                error=str(exc),
                error_id=str(error.id),
            )

    async def publish_batch(self, errors: list[ErrorEncontrado]) -> None:
        """Publish a batch of errors to the Redis Pub/Sub channel.

        Args:
            errors: List of ErrorEncontrado instances to publish.
        """
        if not errors:
            return

        for error in errors:
            await self.publish_error(error)

        logger.info(
            "Published batch to Redis",
            channel=PUBSUB_CHANNEL,
            count=len(errors),
        )

    async def close(self) -> None:
        """Close the Redis connection if it was created by this producer."""
        if self._redis is not None and self._owned:
            try:
                await self._redis.aclose()
                logger.debug("Redis connection closed")
            except Exception as exc:
                logger.warning("Error closing Redis connection", error=str(exc))
            finally:
                self._redis = None
