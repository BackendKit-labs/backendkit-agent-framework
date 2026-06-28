"""Log Scanner Service — Phase 2.

Provides log scanning, pattern matching, circular buffering,
and event publishing for the checking-agent framework.
"""

from src.scanner.buffer import CircularBuffer
from src.scanner.events import EventProducer
from src.scanner.exceptions import (
    BufferOverflowError,
    LogFileNotFoundError,
    MalformedLogLineError,
    PermissionDeniedError,
    ScannerError,
)
from src.scanner.patterns import PatternManager
from src.scanner.service import ScannerService
from src.scanner.worker import LogWorker

__all__ = [
    "CircularBuffer",
    "EventProducer",
    "ScannerError",
    "LogFileNotFoundError",
    "PermissionDeniedError",
    "MalformedLogLineError",
    "BufferOverflowError",
    "PatternManager",
    "ScannerService",
    "LogWorker",
]
