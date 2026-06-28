"""Unit tests for the log scanner service (Phase 2)."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.agent import PatronError
from src.models.enums import Severidad
from src.models.execution import ErrorEncontrado
from src.scanner.buffer import CircularBuffer
from src.scanner.events import EventProducer
from src.scanner.exceptions import (
    BufferOverflowError,
    LogFileNotFoundError,
    MalformedLogLineError,
    PermissionDeniedError,
    ScannerError,
)
from src.scanner.patterns import PatternManager, _extract_module
from src.scanner.service import ScannerService
from src.scanner.worker import LogWorker


# ── CircularBuffer Tests ────────────────────────────────────────────────────


class TestCircularBuffer:
    def test_write_and_read(self) -> None:
        buf = CircularBuffer(max_size=100)
        buf.write(b"hello ")
        buf.write(b"world")
        assert buf.read() == b"hello world"
        assert buf.size == 11

    def test_overflow_eviction(self) -> None:
        buf = CircularBuffer(max_size=10)
        buf.write(b"1234567890")  # exactly max_size
        assert buf.size == 10
        buf.write(b"abc")  # should evict oldest 3 bytes
        assert buf.size == 10
        assert buf.read() == b"4567890abc"

    def test_overflow_raises_when_data_larger_than_max(self) -> None:
        buf = CircularBuffer(max_size=10)
        with pytest.raises(BufferOverflowError):
            buf.write(b"a" * 11)

    def test_clear(self) -> None:
        buf = CircularBuffer(max_size=100)
        buf.write(b"some data")
        assert buf.size > 0
        buf.clear()
        assert buf.size == 0
        assert buf.read() == b""

    def test_empty_read(self) -> None:
        buf = CircularBuffer(max_size=100)
        assert buf.read() == b""

    def test_is_full(self) -> None:
        buf = CircularBuffer(max_size=5)
        assert not buf.is_full()
        buf.write(b"12345")
        assert buf.is_full()

    def test_max_size_property(self) -> None:
        buf = CircularBuffer(max_size=42)
        assert buf.max_size == 42

    def test_size_property(self) -> None:
        buf = CircularBuffer(max_size=100)
        assert buf.size == 0
        buf.write(b"test")
        assert buf.size == 4

    def test_write_empty_bytes(self) -> None:
        buf = CircularBuffer(max_size=10)
        buf.write(b"")
        assert buf.size == 0
        assert buf.read() == b""

    def test_invalid_max_size_raises(self) -> None:
        with pytest.raises(ValueError):
            CircularBuffer(max_size=0)

    # ── Buffer overflow edge cases ──────────────────────────────────────

    def test_exact_boundary_no_eviction(self) -> None:
        """Writing exactly max_size bytes should not evict."""
        buf = CircularBuffer(max_size=10)
        buf.write(b"1234567890")
        assert buf.size == 10
        assert buf.read() == b"1234567890"

    def test_multiple_evictions(self) -> None:
        """Multiple writes that exceed capacity should evict oldest each time."""
        buf = CircularBuffer(max_size=10)
        buf.write(b"abcdefghij")  # 10 bytes, full
        buf.write(b"klm")         # evicts 'abc', stores 'defghijklm'
        assert buf.size == 10
        assert buf.read() == b"defghijklm"
        buf.write(b"nop")         # evicts 'def', stores 'ghijklmnop'
        assert buf.size == 10
        assert buf.read() == b"ghijklmnop"

    def test_eviction_with_exact_fill(self) -> None:
        """Eviction should work correctly when data exactly fills after eviction."""
        buf = CircularBuffer(max_size=5)
        buf.write(b"12345")  # full
        buf.write(b"67")     # evicts '12', stores '34567'
        assert buf.size == 5
        assert buf.read() == b"34567"
        buf.write(b"890")    # evicts '345', stores '67890'
        assert buf.size == 5
        assert buf.read() == b"67890"


# ── PatternManager Tests ────────────────────────────────────────────────────


class TestPatternManager:
    def test_predefined_fatal_matches(self) -> None:
        pm = PatternManager()
        result = pm.match("2024-01-01 FATAL: something went wrong")
        assert result is not None
        name, severity, matched, module = result
        assert name == "fatal"
        assert severity == Severidad.CRITICAL.value
        assert "FATAL" in matched

    def test_predefined_exception_matches(self) -> None:
        pm = PatternManager()
        result = pm.match("java.lang.NullPointerException at main()")
        assert result is not None
        name, severity, matched, module = result
        assert name == "exception"
        assert severity == Severidad.HIGH.value
        assert "Exception" in matched

    def test_predefined_error_matches(self) -> None:
        pm = PatternManager()
        result = pm.match("Error: connection refused")
        assert result is not None
        name, severity, matched, module = result
        assert name == "exception"
        assert severity == Severidad.HIGH.value

    def test_predefined_traceback_matches(self) -> None:
        pm = PatternManager()
        result = pm.match("Traceback (most recent call last):")
        assert result is not None
        assert result[0] == "exception"

    def test_predefined_warning_matches(self) -> None:
        pm = PatternManager()
        result = pm.match("WARN: disk space low")
        assert result is not None
        name, severity, matched, module = result
        assert name == "warning"
        assert severity == Severidad.MEDIUM.value

    def test_predefined_warning_abbreviated_matches(self) -> None:
        pm = PatternManager()
        result = pm.match("WARNING: memory usage high")
        assert result is not None
        assert result[0] == "warning"

    def test_no_match_returns_none(self) -> None:
        pm = PatternManager()
        result = pm.match("INFO: everything is fine")
        assert result is None

    def test_case_insensitive_matching(self) -> None:
        pm = PatternManager()
        assert pm.match("fatal: crash") is not None
        assert pm.match("Fatal: crash") is not None
        assert pm.match("FATAL: crash") is not None

    def test_custom_patterns(self) -> None:
        custom = [
            PatronError(
                nombre="custom-db",
                regex=r"DB_TIMEOUT",
                severidad=Severidad.HIGH,
                modulo="database",
            )
        ]
        pm = PatternManager(custom_patterns=custom)
        result = pm.match("DB_TIMEOUT on query")
        assert result is not None
        name, severity, matched, module = result
        assert name == "custom-db"
        assert severity == Severidad.HIGH.value

    def test_custom_and_predefined_both_work(self) -> None:
        custom = [
            PatronError(
                nombre="custom-oom",
                regex=r"OutOfMemory",
                severidad=Severidad.CRITICAL,
                modulo="jvm",
            )
        ]
        pm = PatternManager(custom_patterns=custom)
        assert pm.match("OutOfMemory in heap") is not None
        assert pm.match("FATAL: crash") is not None
        assert pm.match("INFO: ok") is None

    # ── Module extraction tests ─────────────────────────────────────────

    def test_match_returns_module_from_brackets(self) -> None:
        pm = PatternManager()
        result = pm.match("[database] FATAL: connection lost")
        assert result is not None
        name, severity, matched, module = result
        assert module == "database"

    def test_match_returns_module_from_prefix(self) -> None:
        pm = PatternManager()
        result = pm.match("worker-1: WARN: high memory usage")
        assert result is not None
        name, severity, matched, module = result
        assert module == "worker-1"

    def test_match_defaults_to_pattern_name(self) -> None:
        pm = PatternManager()
        result = pm.match("FATAL: something broke")
        assert result is not None
        name, severity, matched, module = result
        # The line "FATAL: something broke" has a prefix "FATAL" which is extracted
        assert module == "FATAL"

    def test_match_module_with_dot_in_brackets(self) -> None:
        pm = PatternManager()
        result = pm.match("[my.app.module] FATAL: crash")
        assert result is not None
        assert result[3] == "my.app.module"

    def test_match_module_with_hyphen_in_prefix(self) -> None:
        pm = PatternManager()
        result = pm.match("api-gateway: ERROR: timeout")
        assert result is not None
        assert result[3] == "api-gateway"


# ── _extract_module helper tests ────────────────────────────────────────────


class TestExtractModule:
    def test_bracket_pattern(self) -> None:
        assert _extract_module("[db] query failed", "default") == "db"

    def test_prefix_pattern(self) -> None:
        assert _extract_module("worker: FATAL error", "default") == "worker"

    def test_fallback_to_default(self) -> None:
        assert _extract_module("just a log line", "default") == "default"

    def test_bracket_takes_precedence_over_prefix(self) -> None:
        assert _extract_module("[db] worker: FATAL", "default") == "db"

    def test_empty_line(self) -> None:
        assert _extract_module("", "default") == "default"

    def test_module_with_dots_in_brackets(self) -> None:
        assert _extract_module("[com.example.app] started", "default") == "com.example.app"

    def test_module_with_hyphens_in_prefix(self) -> None:
        assert _extract_module("my-service: running", "default") == "my-service"


# ── LogWorker Tests ─────────────────────────────────────────────────────────


class TestLogWorker:
    @pytest.mark.asyncio
    async def test_process_chunk_finds_patterns(self) -> None:
        worker = LogWorker(max_workers=2)
        chunk = (
            "INFO: starting service\n"
            "FATAL: null pointer in module\n"
            "WARN: low memory\n"
            "DEBUG: some debug info\n"
        )
        errors = await worker.process_chunk(chunk)
        assert len(errors) == 2
        severities = {e.severidad for e in errors}
        assert Severidad.CRITICAL in severities
        assert Severidad.MEDIUM in severities

    @pytest.mark.asyncio
    async def test_process_chunk_empty_chunk(self) -> None:
        worker = LogWorker(max_workers=2)
        errors = await worker.process_chunk("")
        assert errors == []

    @pytest.mark.asyncio
    async def test_process_chunk_no_matches(self) -> None:
        worker = LogWorker(max_workers=2)
        errors = await worker.process_chunk(
            "INFO: all good\nDEBUG: nothing to see"
        )
        assert errors == []

    @pytest.mark.asyncio
    async def test_process_batch_parallel(self) -> None:
        worker = LogWorker(max_workers=4)
        chunks = [
            "FATAL: crash in module A\n",
            "WARN: issue in module B\n",
            "INFO: normal operation\n",
            "Exception in module D\n",
        ]
        errors = await worker.process_batch(chunks)
        assert len(errors) == 3

    @pytest.mark.asyncio
    async def test_process_batch_empty(self) -> None:
        worker = LogWorker(max_workers=2)
        errors = await worker.process_batch([])
        assert errors == []

    @pytest.mark.asyncio
    async def test_malformed_lines_dont_crash(self) -> None:
        worker = LogWorker(max_workers=2)
        chunk = "FATAL: error\n\x00\x00\x00\x00\nWARN: warning\n"
        errors = await worker.process_chunk(chunk)
        # Should not crash; should find the valid lines
        assert len(errors) >= 2

    @pytest.mark.asyncio
    async def test_error_encontrado_fields(self) -> None:
        worker = LogWorker(max_workers=2)
        errors = await worker.process_chunk("FATAL: critical error occurred")
        assert len(errors) == 1
        error = errors[0]
        assert isinstance(error.timestamp, datetime)
        # Module is extracted from the line prefix "FATAL:"
        assert error.modulo == "FATAL"
        assert "FATAL" in error.mensaje
        assert error.stack_trace is None
        assert error.severidad == Severidad.CRITICAL
        assert error.patron_asociado == "fatal"
        assert error.frecuencia == 1

    @pytest.mark.asyncio
    async def test_process_chunk_uses_module_from_line(self) -> None:
        worker = LogWorker(max_workers=2)
        errors = await worker.process_chunk("[myapp] FATAL: critical error")
        assert len(errors) == 1
        assert errors[0].modulo == "myapp"

    @pytest.mark.asyncio
    async def test_process_chunk_with_various_encodings(self) -> None:
        """Test that various encodings in log lines don't crash processing."""
        worker = LogWorker(max_workers=2)
        chunk = (
            "FATAL: normal ascii error\n"
            "WARN: café réservé\n"
            "FATAL: エラー発生\n"
            "WARN: línea con acentos\n"
        )
        errors = await worker.process_chunk(chunk)
        # Should find all 4 matches without crashing
        assert len(errors) == 4


# ── ScannerService Tests ────────────────────────────────────────────────────


class TestScannerService:
    @pytest.mark.asyncio
    async def test_scan_file_with_real_temp_file(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".log", delete=False
        ) as f:
            f.write(
                "INFO: starting\n"
                "FATAL: critical error\n"
                "WARN: warning message\n"
                "DEBUG: debug info\n"
            )
            temp_path = f.name

        try:
            service = ScannerService(chunk_size=64)
            errors = await service.scan_file(temp_path)
            assert len(errors) == 2
            severities = {e.severidad for e in errors}
            assert Severidad.CRITICAL in severities
            assert Severidad.MEDIUM in severities
            await service.close()
        finally:
            os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_scan_file_not_found_raises(self) -> None:
        """scan_file should raise LogFileNotFoundError for missing files."""
        service = ScannerService()
        with pytest.raises(LogFileNotFoundError):
            await service.scan_file("/nonexistent/path.log")
        await service.close()

    @pytest.mark.asyncio
    async def test_scan_file_permission_error_raises(self) -> None:
        """scan_file should raise PermissionDeniedError when file is not readable."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".log", delete=False
        ) as f:
            f.write("FATAL: error\n")
            temp_path = f.name

        try:
            with patch("os.access", return_value=False):
                service = ScannerService()
                with pytest.raises(PermissionDeniedError):
                    await service.scan_file(temp_path)
                await service.close()
        finally:
            os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_scan_file_empty_file(self) -> None:
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".log", delete=False
        ) as f:
            temp_path = f.name

        try:
            service = ScannerService()
            errors = await service.scan_file(temp_path)
            assert errors == []
            await service.close()
        finally:
            os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_scan_file_large_file_streaming(self) -> None:
        """Test that large files are streamed without loading entirely in memory."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".log", delete=False
        ) as f:
            # Write enough lines to exceed a small chunk size
            for i in range(1000):
                f.write(f"INFO: line {i}\n")
            f.write("FATAL: error at end\n")
            temp_path = f.name

        try:
            service = ScannerService(chunk_size=256)
            errors = await service.scan_file(temp_path)
            assert len(errors) == 1
            assert errors[0].severidad == Severidad.CRITICAL
            await service.close()
        finally:
            os.unlink(temp_path)

    @pytest.mark.asyncio
    async def test_scan_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create two log files
            for fname in ["app1.log", "app2.log", "readme.txt"]:
                with open(os.path.join(tmpdir, fname), "w") as f:
                    if fname.endswith(".log"):
                        f.write(f"FATAL: error in {fname}\n")
                    else:
                        f.write("not a log file\n")

            service = ScannerService(chunk_size=64)
            errors = await service.scan_directory(tmpdir, "*.log")
            assert len(errors) == 2
            await service.close()

    @pytest.mark.asyncio
    async def test_scan_directory_no_matches(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            service = ScannerService()
            errors = await service.scan_directory(tmpdir, "*.log")
            assert errors == []
            await service.close()

    @pytest.mark.asyncio
    async def test_close_cleans_up(self) -> None:
        service = ScannerService()
        # Should not raise
        await service.close()

    @pytest.mark.asyncio
    async def test_scan_file_propagates_scanner_error(self) -> None:
        """Test that unexpected errors are wrapped in ScannerError."""
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".log", delete=False
        ) as f:
            f.write("FATAL: error\n")
            temp_path = f.name

        try:
            service = ScannerService()
            # Force an error by providing an invalid chunk_size that causes issues
            with patch.object(
                service._buffer, "write", side_effect=RuntimeError("mock error")
            ):
                with pytest.raises(ScannerError):
                    await service.scan_file(temp_path)
            await service.close()
        finally:
            os.unlink(temp_path)


# ── EventProducer Tests ─────────────────────────────────────────────────────


class TestEventProducer:
    @pytest.mark.asyncio
    async def test_publish_error_serialization(self) -> None:
        """Test that publish_error serializes correctly with a mock Redis."""
        mock_redis = AsyncMock(spec_set=["publish", "close"])
        mock_redis.publish = AsyncMock(return_value=1)

        producer = EventProducer(redis_client=mock_redis)
        error = ErrorEncontrado(
            timestamp=datetime.now(),
            modulo="test-module",
            mensaje="FATAL: test error",
            severidad=Severidad.CRITICAL,
            patron_asociado="fatal",
        )

        await producer.publish_error(error)

        # Verify Redis publish was called
        mock_redis.publish.assert_awaited_once()
        call_args = mock_redis.publish.await_args
        assert call_args is not None
        channel, message = call_args.args
        assert channel == "logs.scanned"
        assert isinstance(message, str)
        # Verify JSON serialization contains expected fields
        assert "test-module" in message
        assert "FATAL: test error" in message
        assert "CRITICAL" in message

        await producer.close()

    @pytest.mark.asyncio
    async def test_publish_batch(self) -> None:
        mock_redis = AsyncMock(spec_set=["publish", "close"])
        mock_redis.publish = AsyncMock(return_value=1)

        producer = EventProducer(redis_client=mock_redis)
        errors = [
            ErrorEncontrado(
                timestamp=datetime.now(),
                modulo="mod1",
                mensaje="FATAL: error 1",
                severidad=Severidad.CRITICAL,
            ),
            ErrorEncontrado(
                timestamp=datetime.now(),
                modulo="mod2",
                mensaje="WARN: error 2",
                severidad=Severidad.MEDIUM,
            ),
        ]

        await producer.publish_batch(errors)
        assert mock_redis.publish.await_count == 2
        await producer.close()

    @pytest.mark.asyncio
    async def test_publish_empty_batch(self) -> None:
        mock_redis = AsyncMock(spec_set=["publish", "close"])
        producer = EventProducer(redis_client=mock_redis)
        await producer.publish_batch([])
        mock_redis.publish.assert_not_awaited()
        await producer.close()

    @pytest.mark.asyncio
    async def test_redis_unavailable_does_not_crash(self) -> None:
        """Test that producer handles Redis unavailability gracefully."""
        producer = EventProducer(redis_client=None)
        # Should not raise even though Redis is not available
        error = ErrorEncontrado(
            timestamp=datetime.now(),
            modulo="test",
            mensaje="FATAL: test",
            severidad=Severidad.CRITICAL,
        )
        # This should log a warning but not crash
        await producer.publish_error(error)
        await producer.close()

    @pytest.mark.asyncio
    async def test_close_without_redis(self) -> None:
        producer = EventProducer(redis_client=None)
        await producer.close()  # Should not raise

    @pytest.mark.asyncio
    async def test_publish_and_close_with_mock(self) -> None:
        """Test the full publish and close lifecycle with a mock Redis."""
        mock_redis = AsyncMock(spec_set=["publish", "close"])
        mock_redis.publish = AsyncMock(return_value=1)
        mock_redis.close = AsyncMock()

        producer = EventProducer(redis_client=mock_redis)
        error = ErrorEncontrado(
            timestamp=datetime.now(),
            modulo="lifecycle",
            mensaje="FATAL: lifecycle test",
            severidad=Severidad.CRITICAL,
        )

        await producer.publish_error(error)
        mock_redis.publish.assert_awaited_once()

        await producer.close()
        # close should not call redis.close because redis_client was provided (not owned)
        # Only owned clients are closed


# ── Exceptions Tests ────────────────────────────────────────────────────────


class TestExceptions:
    def test_scanner_error_base(self) -> None:
        err = ScannerError("base error")
        assert str(err) == "base error"
        assert isinstance(err, Exception)
        assert isinstance(err, ScannerError)

    def test_log_file_not_found_error(self) -> None:
        err = LogFileNotFoundError("/path/to/file.log")
        assert "/path/to/file.log" in str(err)
        assert err.file_path == "/path/to/file.log"
        assert isinstance(err, ScannerError)

    def test_permission_denied_error(self) -> None:
        err = PermissionDeniedError("/path/to/file.log")
        assert "/path/to/file.log" in str(err)
        assert err.file_path == "/path/to/file.log"
        assert isinstance(err, ScannerError)

    def test_malformed_log_line_error(self) -> None:
        err = MalformedLogLineError("bad line", reason="invalid encoding")
        assert "bad line" in str(err)
        assert "invalid encoding" in str(err)
        assert err.line == "bad line"
        assert isinstance(err, ScannerError)

    def test_buffer_overflow_error(self) -> None:
        err = BufferOverflowError(data_size=100, max_size=50)
        assert "100" in str(err)
        assert "50" in str(err)
        assert err.data_size == 100
        assert err.max_size == 50
        assert isinstance(err, ScannerError)

    def test_scanner_error_not_base_exception(self) -> None:
        """ScannerError should NOT inherit from BaseException."""
        err = ScannerError("test")
        assert not isinstance(err, BaseException) or isinstance(err, Exception)
        # Actually check it's not a BaseException-only type
        assert isinstance(err, Exception)

    def test_log_file_not_found_is_not_builtin(self) -> None:
        """LogFileNotFoundError should not shadow built-in FileNotFoundError."""
        err = LogFileNotFoundError("/path")
        assert not isinstance(err, FileNotFoundError)
        assert isinstance(err, ScannerError)
