"""Custom exceptions for the log scanner service."""


class ScannerError(Exception):
    """Base exception for all scanner errors."""
    pass


class LogFileNotFoundError(ScannerError):
    """Raised when a log file is not found."""

    def __init__(self, file_path: str) -> None:
        self.file_path = file_path
        super().__init__(f"Log file not found: {file_path}")


class PermissionDeniedError(ScannerError):
    """Raised when permission is denied reading a file."""

    def __init__(self, file_path: str) -> None:
        self.file_path = file_path
        super().__init__(f"Permission denied reading file: {file_path}")


class MalformedLogLineError(ScannerError):
    """Raised when a log line is malformed (non-critical, line is skipped)."""

    def __init__(self, line: str, reason: str = "malformed") -> None:
        self.line = line
        super().__init__(f"Malformed log line (skipped): {reason} — {line!r}")


class BufferOverflowError(ScannerError):
    """Raised when a write exceeds the maximum buffer size."""

    def __init__(self, data_size: int, max_size: int) -> None:
        self.data_size = data_size
        self.max_size = max_size
        super().__init__(
            f"Buffer overflow: cannot write {data_size} bytes "
            f"(max buffer size: {max_size} bytes)"
        )
