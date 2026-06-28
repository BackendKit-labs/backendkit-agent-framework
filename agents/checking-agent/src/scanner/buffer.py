"""Circular buffer for streaming log data."""

from __future__ import annotations

import structlog

from src.scanner.exceptions import BufferOverflowError

logger = structlog.get_logger(__name__)


class CircularBuffer:
    """A fixed-size circular buffer for binary log data.

    When the buffer reaches its maximum size, the oldest data is
    evicted to make room for new writes.
    """

    def __init__(self, max_size: int = 10 * 1024 * 1024) -> None:
        """Initialize the circular buffer.

        Args:
            max_size: Maximum buffer size in bytes (default 10 MB).

        Raises:
            ValueError: If max_size is less than 1.
        """
        if max_size < 1:
            raise ValueError("max_size must be >= 1")
        self._max_size: int = max_size
        self._buffer: bytearray = bytearray()
        logger.debug("CircularBuffer initialized", max_size=max_size)

    def write(self, data: bytes) -> None:
        """Append data to the buffer, evicting oldest data if over max_size.

        Args:
            data: Bytes to write.

        Raises:
            BufferOverflowError: If data is larger than max_size.
        """
        if not data:
            return

        data_len = len(data)
        if data_len > self._max_size:
            raise BufferOverflowError(data_size=data_len, max_size=self._max_size)

        self._buffer.extend(data)

        # Evict oldest data if over capacity
        if len(self._buffer) > self._max_size:
            excess = len(self._buffer) - self._max_size
            self._buffer = self._buffer[excess:]
            logger.debug(
                "CircularBuffer evicted bytes",
                evicted=excess,
                current_size=len(self._buffer),
            )

    def read(self) -> bytes:
        """Return all current data in the buffer.

        Returns:
            Bytes currently in the buffer, or b'' if empty.
        """
        return bytes(self._buffer)

    def clear(self) -> None:
        """Reset the buffer, discarding all data."""
        self._buffer.clear()
        logger.debug("CircularBuffer cleared")

    def is_full(self) -> bool:
        """Check if the buffer has reached its maximum size.

        Returns:
            True if buffer size >= max_size.
        """
        return len(self._buffer) >= self._max_size

    @property
    def size(self) -> int:
        """Current number of bytes in the buffer."""
        return len(self._buffer)

    @property
    def max_size(self) -> int:
        """Maximum buffer size in bytes."""
        return self._max_size
