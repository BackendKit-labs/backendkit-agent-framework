"""Log worker for parallel processing of log chunks."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import structlog

from src.models.enums import Severidad
from src.models.execution import ErrorEncontrado
from src.scanner.exceptions import MalformedLogLineError
from src.scanner.patterns import PatternManager

logger = structlog.get_logger(__name__)


class LogWorker:
    """Processes log chunks in parallel using a thread pool.

    Each chunk is split into lines and matched against compiled patterns.
    Malformed lines are caught and logged without crashing the worker.
    """

    def __init__(
        self,
        max_workers: int = 4,
        pattern_manager: PatternManager | None = None,
    ) -> None:
        """Initialize the log worker.

        Args:
            max_workers: Maximum number of parallel worker threads (default 4).
            pattern_manager: A PatternManager instance. If None, a default one
                is created with predefined patterns only.
        """
        self._max_workers: int = max_workers
        self._pattern_manager: PatternManager = (
            pattern_manager or PatternManager()
        )
        self._executor: ThreadPoolExecutor = ThreadPoolExecutor(
            max_workers=max_workers
        )
        logger.debug(
            "LogWorker initialized",
            max_workers=max_workers,
        )

    async def process_chunk(self, chunk: str) -> list[ErrorEncontrado]:
        """Process a single text chunk against all patterns.

        Splits the chunk into sub-chunks and processes them in parallel
        using the thread pool.

        Args:
            chunk: A string of log text (may contain multiple lines).

        Returns:
            A list of ErrorEncontrado objects for matched lines.
        """
        lines: list[str] = chunk.splitlines()
        if not lines:
            return []

        # Split lines into sub-chunks for parallel processing
        sub_chunk_size = max(1, len(lines) // self._max_workers)
        sub_chunks: list[str] = []
        for i in range(0, len(lines), sub_chunk_size):
            sub_lines = lines[i:i + sub_chunk_size]
            sub_chunks.append("\n".join(sub_lines))

        # Process sub-chunks in parallel
        all_errors: list[ErrorEncontrado] = []
        future_to_idx = {
            self._executor.submit(self._process_chunk_sync, sc): i
            for i, sc in enumerate(sub_chunks)
        }

        for future in as_completed(future_to_idx):
            try:
                errors = future.result()
                all_errors.extend(errors)
            except Exception as exc:
                logger.warning(
                    "Sub-chunk processing failed",
                    error=str(exc),
                )

        return all_errors

    async def process_batch(
        self, chunks: list[str]
    ) -> list[ErrorEncontrado]:
        """Process multiple chunks in parallel using the thread pool.

        Args:
            chunks: A list of text chunks to process.

        Returns:
            A combined list of ErrorEncontrado objects from all chunks.
        """
        if not chunks:
            return []

        all_errors: list[ErrorEncontrado] = []
        future_to_chunk = {
            self._executor.submit(self._process_chunk_sync, chunk): i
            for i, chunk in enumerate(chunks)
        }

        for future in as_completed(future_to_chunk):
            chunk_idx = future_to_chunk[future]
            try:
                errors = future.result()
                all_errors.extend(errors)
                logger.debug(
                    "Chunk processed",
                    chunk_index=chunk_idx,
                    errors_found=len(errors),
                )
            except Exception as exc:
                logger.error(
                    "Failed to process chunk",
                    chunk_index=chunk_idx,
                    error=str(exc),
                )

        logger.info(
            "Batch processing complete",
            chunks=len(chunks),
            total_errors=len(all_errors),
        )
        return all_errors

    def _process_chunk_sync(self, chunk: str) -> list[ErrorEncontrado]:
        """Synchronous wrapper for process_chunk used by the thread pool.

        Args:
            chunk: A string of log text.

        Returns:
            A list of ErrorEncontrado objects.
        """
        errors: list[ErrorEncontrado] = []
        lines: list[str] = chunk.splitlines()

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            try:
                result = self._pattern_manager.match(stripped)
                if result is not None:
                    # match now returns (name, severity, matched_text, module)
                    pattern_name, severity_str, matched_text, module = result
                    error = ErrorEncontrado(
                        timestamp=datetime.now(),
                        modulo=module,
                        mensaje=matched_text,
                        stack_trace=None,
                        severidad=Severidad(severity_str),
                        patron_asociado=pattern_name,
                    )
                    errors.append(error)
            except Exception as exc:
                logger.warning(
                    "Malformed log line, skipping",
                    line=stripped[:120],
                    error=str(exc),
                )

        return errors
