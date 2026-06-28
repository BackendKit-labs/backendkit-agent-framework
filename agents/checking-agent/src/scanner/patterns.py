"""Pattern manager for matching error patterns in log lines."""

from __future__ import annotations

import re
from typing import Pattern

import structlog

from src.models.agent import PatronError
from src.models.enums import Severidad

logger = structlog.get_logger(__name__)


def _extract_module(line: str, default_module: str) -> str:
    """Extract a module name from common log formats.

    Tries to extract module from patterns like ``[module]`` or ``module:``
    at the start of a log line. Falls back to the default module name.

    Args:
        line: The log line to extract from.
        default_module: The fallback module name.

    Returns:
        The extracted module name or the default.
    """
    # Try [module] pattern (common in Python logging, Java, etc.)
    bracket_match = re.search(r'\[([\w.-]+)\]', line)
    if bracket_match:
        return bracket_match.group(1)

    # Try module: at the start (e.g. "database: connection lost")
    prefix_match = re.match(r'^([\w.-]+):\s', line)
    if prefix_match:
        return prefix_match.group(1)

    return default_module


class PatternManager:
    """Manages predefined and custom regex patterns for log scanning.

    Patterns are compiled once and reused for efficient matching.
    """

    PREDEFINED_PATTERNS: dict[str, dict[str, str]] = {
        "fatal": {
            "regex": r"(?i)\bFATAL\b.*",
            "severidad": Severidad.CRITICAL.value,
        },
        "exception": {
            "regex": r"(?i)(?:Exception|Error|Traceback)\b",
            "severidad": Severidad.HIGH.value,
        },
        "warning": {
            "regex": r"(?i)\bWARN(?:ING)?\b",
            "severidad": Severidad.MEDIUM.value,
        },
    }

    def __init__(self, custom_patterns: list[PatronError] | None = None) -> None:
        """Initialize the pattern manager.

        Args:
            custom_patterns: Optional list of custom PatronError patterns.
        """
        self._custom_patterns: list[PatronError] = custom_patterns or []
        self._compiled_patterns: list[tuple[str, str, str, Pattern[str]]] = []
        self.compile_patterns()

    def compile_patterns(self) -> None:
        """Compile all patterns (predefined + custom) into regex Pattern objects.

        Each entry is a tuple of (pattern_name, modulo, severity, compiled_regex).
        """
        self._compiled_patterns.clear()

        # Compile predefined patterns
        for name, info in self.PREDEFINED_PATTERNS.items():
            compiled = re.compile(info["regex"], re.MULTILINE)
            self._compiled_patterns.append(
                (name, name, info["severidad"], compiled)
            )
            logger.debug("Compiled predefined pattern", name=name)

        # Compile custom patterns
        for patron in self._custom_patterns:
            compiled = re.compile(patron.regex, re.MULTILINE)
            self._compiled_patterns.append(
                (patron.nombre, patron.modulo, patron.severidad.value, compiled)
            )
            logger.debug("Compiled custom pattern", name=patron.nombre)

        logger.info(
            "Patterns compiled",
            total=len(self._compiled_patterns),
            predefined=len(self.PREDEFINED_PATTERNS),
            custom=len(self._custom_patterns),
        )

    def match(self, line: str) -> tuple[str, str, str, str] | None:
        """Match a log line against all compiled patterns.

        Args:
            line: A single log line string.

        Returns:
            A tuple of (pattern_name, severity, matched_text, module) if a match
            is found, or None if no pattern matches. The module is extracted from
            the log line if possible, or defaults to the pattern name.
        """
        for name, modulo, severity, compiled in self._compiled_patterns:
            match = compiled.search(line)
            if match:
                matched_text = match.group(0)
                module = _extract_module(line, default_module=modulo)
                logger.debug(
                    "Pattern matched",
                    pattern=name,
                    severity=severity,
                    module=module,
                    matched=matched_text[:80],
                )
                return (name, severity, matched_text, module)
        return None
