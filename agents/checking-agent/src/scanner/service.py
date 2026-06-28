"""Main scanner service — orchestrates log scanning, buffering, and publishing."""

from __future__ import annotations

import asyncio
import glob
import os
from datetime import datetime
from typing import AsyncGenerator

import aiofiles
import structlog

from src.models.execution import ErrorEncontrado
from src.scanner.buffer import CircularBuffer
from src.scanner.events import EventProducer
from src.scanner.exceptions import (
    LogFileNotFoundError,
    PermissionDeniedError,
    ScannerError,
)
from src.scanner.worker import LogWorker

logger = structlog.get_logger(__name__)


class ScannerService:
    """Main orchestrator for log scanning.

    Streams log files in chunks through a circular buffer, processes
    them with the LogWorker, and publishes results via EventProducer.
    """

    def __init__(
        self,
        buffer: CircularBuffer | None = None,
        worker: LogWorker | None = None,
        producer: EventProducer | None = None,
        chunk_size: int = 1024 * 1024,
    ) -> None:
        """Initialize the scanner service.

        Args:
            buffer: A CircularBuffer instance. If None, a default 10 MB buffer
                is created.
            worker: A LogWorker instance. If None, a default worker with 4
                threads is created.
            producer: An EventProducer instance. If None, a default producer
                connecting to localhost Redis is created.
            chunk_size: Size of each read chunk in bytes (default 1 MB).
        """
        self._buffer: CircularBuffer = buffer or CircularBuffer()
        self._worker: LogWorker = worker or LogWorker()
        self._producer: EventProducer = producer or EventProducer()
        self._chunk_size: int = chunk_size
        logger.debug(
            "ScannerService initialized",
            chunk_size=chunk_size,
            buffer_max_size=self._buffer.max_size,
        )

    async def scan_file(self, file_path: str) -> list[ErrorEncontrado]:
        """Scan a single log file for error patterns.

        Streams the file in chunks into the circular buffer. When the buffer
        is full or the file ends, the buffer content is sent to the worker
        for processing. Found errors are published via EventProducer.

        Args:
            file_path: Path to the log file.

        Returns:
            A list of ErrorEncontrado objects found in the file.

        Raises:
            LogFileNotFoundError: If the file does not exist.
            PermissionDeniedError: If the file cannot be read due to permissions.
            ScannerError: For other scanning errors.
        """
        all_errors: list[ErrorEncontrado] = []

        if not os.path.exists(file_path):
            raise LogFileNotFoundError(file_path)

        if not os.access(file_path, os.R_OK):
            raise PermissionDeniedError(file_path)

        try:
            async with aiofiles.open(file_path, mode="rb") as f:
                logger.info("Scanning file", file_path=file_path)

                while True:
                    chunk_bytes = await f.read(self._chunk_size)
                    if not chunk_bytes:
                        # End of file — flush remaining buffer
                        if self._buffer.size > 0:
                            chunk_errors = await self._flush_buffer()
                            all_errors.extend(chunk_errors)
                        break

                    # Write to circular buffer
                    self._buffer.write(chunk_bytes)

                    # If buffer is full, process and clear
                    if self._buffer.is_full():
                        chunk_errors = await self._flush_buffer()
                        all_errors.extend(chunk_errors)

                logger.info(
                    "File scan complete",
                    file_path=file_path,
                    errors_found=len(all_errors),
                )

        except LogFileNotFoundError:
            raise
        except PermissionDeniedError:
            raise
        except PermissionError:
            raise PermissionDeniedError(file_path)
        except Exception as exc:
            logger.error(
                "Error scanning file",
                file_path=file_path,
                error=str(exc),
            )
            raise ScannerError(f"Error scanning file {file_path}: {exc}") from exc

        # Publish found errors
        if all_errors:
            await self._producer.publish_batch(all_errors)

        return all_errors

    async def scan_directory(
        self, dir_path: str, pattern: str = "*.log"
    ) -> list[ErrorEncontrado]:
        """Scan all files matching a pattern in a directory.

        Args:
            dir_path: Directory path to scan.
            pattern: Glob pattern for file matching (default "*.log").

        Returns:
            A combined list of ErrorEncontrado objects from all matching files.
        """
        all_errors: list[ErrorEncontrado] = []
        search_pattern = os.path.join(dir_path, pattern)
        matching_files = glob.glob(search_pattern)

        if not matching_files:
            logger.info(
                "No matching files found",
                directory=dir_path,
                pattern=pattern,
            )
            return all_errors

        logger.info(
            "Scanning directory",
            directory=dir_path,
            pattern=pattern,
            files_found=len(matching_files),
        )

        for file_path in sorted(matching_files):
            if os.path.isfile(file_path):
                file_errors = await self.scan_file(file_path)
                all_errors.extend(file_errors)

        logger.info(
            "Directory scan complete",
            directory=dir_path,
            files_scanned=len(matching_files),
            total_errors=len(all_errors),
        )
        return all_errors

    async def close(self) -> None:
        """Clean up resources (buffer, producer connection)."""
        self._buffer.clear()
        await self._producer.close()
        logger.debug("ScannerService resources cleaned up")

    async def _flush_buffer(self) -> list[ErrorEncontrado]:
        """Flush the current buffer contents through the worker.

        Returns:
            A list of ErrorEncontrado objects from the buffer content.
        """
        data = self._buffer.read()
        self._buffer.clear()

        if not data:
            return []

        try:
            text = data.decode("utf-8", errors="replace")
            errors = await self._worker.process_chunk(text)
            return errors
        except Exception as exc:
            logger.error("Failed to flush buffer", error=str(exc))
            return []
