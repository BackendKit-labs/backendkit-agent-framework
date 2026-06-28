"""Unit tests for all data models."""

from datetime import datetime
from uuid import UUID

import pytest
from pydantic import ValidationError

from src.models.agent import (
    AgenteAnalisis,
    ConfiguracionAgente,
    NotificacionConfig,
    PatronError,
    Umbrales,
)
from src.models.enums import (
    EstadoAgente,
    EstadoEjecucion,
    EstadoPrueba,
    Severidad,
    TipoCorrelacion,
)
from src.models.execution import (
    Correlacion,
    EjecucionAnalisis,
    ErrorEncontrado,
    PruebaResultado,
    ResumenReporte,
    ResultadoAnalisis,
)


# ── Enum Tests ──────────────────────────────────────────────────────────────


class TestEnums:
    def test_estado_agente_values(self) -> None:
        assert EstadoAgente.IDLE.value == "IDLE"
        assert EstadoAgente.RUNNING.value == "RUNNING"
        assert EstadoAgente.COMPLETED.value == "COMPLETED"
        assert EstadoAgente.FAILED.value == "FAILED"

    def test_severidad_values(self) -> None:
        assert Severidad.CRITICAL.value == "CRITICAL"
        assert Severidad.HIGH.value == "HIGH"
        assert Severidad.MEDIUM.value == "MEDIUM"
        assert Severidad.LOW.value == "LOW"

    def test_estado_ejecucion_values(self) -> None:
        assert EstadoEjecucion.RUNNING.value == "RUNNING"
        assert EstadoEjecucion.COMPLETED.value == "COMPLETED"
        assert EstadoEjecucion.FAILED.value == "FAILED"

    def test_estado_prueba_values(self) -> None:
        assert EstadoPrueba.PASSED.value == "PASSED"
        assert EstadoPrueba.FAILED.value == "FAILED"
        assert EstadoPrueba.SKIPPED.value == "SKIPPED"
        assert EstadoPrueba.ERROR.value == "ERROR"

    def test_tipo_correlacion_values(self) -> None:
        assert TipoCorrelacion.CAUSA_DIRECTA.value == "CAUSA_DIRECTA"
        assert TipoCorrelacion.CAUSA_PROBABLE.value == "CAUSA_PROBABLE"
        assert TipoCorrelacion.COINCIDENCIA.value == "COINCIDENCIA"

    def test_enum_membership(self) -> None:
        assert "IDLE" in EstadoAgente.__members__
        assert "CRITICAL" in Severidad.__members__
        assert "RUNNING" in EstadoEjecucion.__members__
        assert "PASSED" in EstadoPrueba.__members__
        assert "CAUSA_DIRECTA" in TipoCorrelacion.__members__


# ── PatronError Tests ───────────────────────────────────────────────────────


class TestPatronError:
    def test_create_valid(self) -> None:
        patron = PatronError(
            nombre="fatal-error",
            regex="FATAL.*Exception",
            severidad=Severidad.CRITICAL,
            modulo="app-core",
        )
        assert patron.nombre == "fatal-error"
        assert patron.regex == "FATAL.*Exception"
        assert patron.severidad == Severidad.CRITICAL
        assert patron.modulo == "app-core"

    def test_empty_name_raises(self) -> None:
        with pytest.raises(ValidationError):
            PatronError(
                nombre="",
                regex=".*",
                severidad=Severidad.LOW,
                modulo="test",
            )

    def test_invalid_severidad_raises(self) -> None:
        with pytest.raises(ValidationError):
            PatronError(
                nombre="test",
                regex=".*",
                severidad="INVALID_SEVERITY",  # type: ignore[arg-type]
                modulo="test",
            )

    def test_serialization_roundtrip(self) -> None:
        patron = PatronError(
            nombre="db-timeout",
            regex="timeout.*database",
            severidad=Severidad.HIGH,
            modulo="database",
        )
        data = patron.model_dump()
        restored = PatronError.model_validate(data)
        assert restored == patron


# ── Umbrales Tests ──────────────────────────────────────────────────────────


class TestUmbrales:
    def test_default_values(self) -> None:
        umbrales = Umbrales()
        assert umbrales.max_errores_por_minuto == 100
        assert umbrales.max_tiempo_respuesta_ms == 5000
        assert umbrales.max_fallos_consecutivos == 3

    def test_custom_values(self) -> None:
        umbrales = Umbrales(
            max_errores_por_minuto=50,
            max_tiempo_respuesta_ms=2000,
            max_fallos_consecutivos=5,
        )
        assert umbrales.max_errores_por_minuto == 50
        assert umbrales.max_tiempo_respuesta_ms == 2000
        assert umbrales.max_fallos_consecutivos == 5

    def test_negative_values_raises(self) -> None:
        with pytest.raises(ValidationError):
            Umbrales(max_errores_por_minuto=-1)


# ── ConfiguracionAgente Tests ───────────────────────────────────────────────


class TestConfiguracionAgente:
    def test_full_data(self) -> None:
        config = ConfiguracionAgente(
            rutas_log=["/var/log/app/*.log"],
            patrones_error=[
                PatronError(
                    nombre="fatal",
                    regex="FATAL",
                    severidad=Severidad.CRITICAL,
                    modulo="core",
                )
            ],
            suite_pruebas="/tests/suite",
            umbrales=Umbrales(),
            programacion="0 */6 * * *",
            notificaciones=NotificacionConfig(email=True),
        )
        assert len(config.rutas_log) == 1
        assert len(config.patrones_error) == 1
        assert config.suite_pruebas == "/tests/suite"
        assert config.programacion == "0 */6 * * *"
        assert config.notificaciones.email is True

    def test_default_notificaciones(self) -> None:
        config = ConfiguracionAgente(
            rutas_log=["/var/log/app/*.log"],
            patrones_error=[],
            suite_pruebas="/tests/suite",
            umbrales=Umbrales(),
        )
        assert config.notificaciones.email is False
        assert config.notificaciones.webhook is False
        assert config.notificaciones.webhook_url is None


# ── AgenteAnalisis Tests ────────────────────────────────────────────────────


class TestAgenteAnalisis:
    def test_uuid_generation(self) -> None:
        agente = AgenteAnalisis(
            nombre="test-agent",
            configuracion=ConfiguracionAgente(
                rutas_log=["/var/log/app/*.log"],
                patrones_error=[],
                suite_pruebas="/tests/suite",
                umbrales=Umbrales(),
            ),
        )
        assert isinstance(agente.id, UUID)
        assert agente.estado == EstadoAgente.IDLE
        assert agente.ultima_ejecucion is None
        assert isinstance(agente.creado, datetime)

    def test_unique_uuids(self) -> None:
        agente1 = AgenteAnalisis(
            nombre="agent-1",
            configuracion=ConfiguracionAgente(
                rutas_log=[],
                patrones_error=[],
                suite_pruebas="/tests",
                umbrales=Umbrales(),
            ),
        )
        agente2 = AgenteAnalisis(
            nombre="agent-2",
            configuracion=ConfiguracionAgente(
                rutas_log=[],
                patrones_error=[],
                suite_pruebas="/tests",
                umbrales=Umbrales(),
            ),
        )
        assert agente1.id != agente2.id

    def test_serialization_roundtrip(self) -> None:
        agente = AgenteAnalisis(
            nombre="roundtrip-agent",
            configuracion=ConfiguracionAgente(
                rutas_log=["/var/log/app/*.log"],
                patrones_error=[],
                suite_pruebas="/tests/suite",
                umbrales=Umbrales(),
            ),
        )
        data = agente.model_dump(mode="json")
        restored = AgenteAnalisis.model_validate(data)
        assert restored.id == agente.id
        assert restored.nombre == agente.nombre
        assert restored.estado == agente.estado


# ── ErrorEncontrado Tests ───────────────────────────────────────────────────


class TestErrorEncontrado:
    def test_create_valid(self) -> None:
        error = ErrorEncontrado(
            timestamp=datetime.now(),
            modulo="app-core",
            mensaje="FATAL: NullPointerException",
            severidad=Severidad.CRITICAL,
        )
        assert isinstance(error.id, UUID)
        assert error.frecuencia == 1
        assert error.stack_trace is None
        assert error.patron_asociado is None

    def test_with_all_fields(self) -> None:
        error = ErrorEncontrado(
            timestamp=datetime.now(),
            modulo="database",
            mensaje="Connection timeout",
            stack_trace="Traceback...",
            severidad=Severidad.HIGH,
            patron_asociado="db-timeout",
            frecuencia=5,
        )
        assert error.stack_trace == "Traceback..."
        assert error.patron_asociado == "db-timeout"
        assert error.frecuencia == 5


# ── PruebaResultado Tests ───────────────────────────────────────────────────


class TestPruebaResultado:
    def test_all_states(self) -> None:
        now = datetime.now()
        for estado in EstadoPrueba:
            prueba = PruebaResultado(
                nombre=f"test_{estado.value}",
                modulo="test_module",
                estado=estado,
                duracion_ms=100,
                timestamp=now,
            )
            assert prueba.estado == estado
            assert prueba.duracion_ms == 100

    def test_with_error_message(self) -> None:
        prueba = PruebaResultado(
            nombre="failing_test",
            modulo="test_module",
            estado=EstadoPrueba.FAILED,
            duracion_ms=250,
            mensaje_error="AssertionError: expected True, got False",
            timestamp=datetime.now(),
        )
        assert prueba.mensaje_error is not None
        assert "AssertionError" in prueba.mensaje_error


# ── Correlacion Tests ───────────────────────────────────────────────────────


class TestCorrelacion:
    def test_valid_confidence(self) -> None:
        corr = Correlacion(
            error_id=UUID("00000000-0000-0000-0000-000000000001"),
            prueba_id=UUID("00000000-0000-0000-0000-000000000002"),
            tipo=TipoCorrelacion.CAUSA_DIRECTA,
            confianza=0.95,
            descripcion="Error directly caused test failure",
        )
        assert corr.confianza == 0.95
        assert corr.tipo == TipoCorrelacion.CAUSA_DIRECTA

    def test_confidence_boundaries(self) -> None:
        Correlacion(
            error_id=UUID("00000000-0000-0000-0000-000000000001"),
            prueba_id=UUID("00000000-0000-0000-0000-000000000002"),
            tipo=TipoCorrelacion.COINCIDENCIA,
            confianza=0.0,
            descripcion="No correlation",
        )
        Correlacion(
            error_id=UUID("00000000-0000-0000-0000-000000000001"),
            prueba_id=UUID("00000000-0000-0000-0000-000000000002"),
            tipo=TipoCorrelacion.CAUSA_DIRECTA,
            confianza=1.0,
            descripcion="Perfect correlation",
        )

    def test_invalid_confidence_raises(self) -> None:
        with pytest.raises(ValidationError):
            Correlacion(
                error_id=UUID("00000000-0000-0000-0000-000000000001"),
                prueba_id=UUID("00000000-0000-0000-0000-000000000002"),
                tipo=TipoCorrelacion.CAUSA_DIRECTA,
                confianza=1.5,
                descripcion="Invalid confidence",
            )

    def test_negative_confidence_raises(self) -> None:
        with pytest.raises(ValidationError):
            Correlacion(
                error_id=UUID("00000000-0000-0000-0000-000000000001"),
                prueba_id=UUID("00000000-0000-0000-0000-000000000002"),
                tipo=TipoCorrelacion.CAUSA_DIRECTA,
                confianza=-0.1,
                descripcion="Negative confidence",
            )


# ── ResumenReporte Tests ────────────────────────────────────────────────────


class TestResumenReporte:
    def test_defaults(self) -> None:
        resumen = ResumenReporte()
        assert resumen.total_errores == 0
        assert resumen.total_pruebas == 0
        assert resumen.pruebas_fallidas == 0
        assert resumen.bugs_criticos == 0
        assert resumen.bugs_altos == 0
        assert resumen.tiempo_total_analisis_ms == 0
        assert resumen.recomendaciones == []

    def test_custom_values(self) -> None:
        resumen = ResumenReporte(
            total_errores=10,
            total_pruebas=50,
            pruebas_fallidas=3,
            bugs_criticos=2,
            bugs_altos=1,
            tiempo_total_analisis_ms=15000,
            recomendaciones=["Revisar modulo core", "Aumentar timeout"],
        )
        assert resumen.total_errores == 10
        assert len(resumen.recomendaciones) == 2


# ── ResultadoAnalisis Tests ─────────────────────────────────────────────────


class TestResultadoAnalisis:
    def test_defaults(self) -> None:
        resultado = ResultadoAnalisis()
        assert resultado.errores_encontrados == []
        assert resultado.pruebas_ejecutadas == []
        assert resultado.correlaciones == []
        assert resultado.resumen.total_errores == 0


# ── EjecucionAnalisis Tests ─────────────────────────────────────────────────


class TestEjecucionAnalisis:
    def test_default_state(self) -> None:
        ejecucion = EjecucionAnalisis(
            agente_id=UUID("00000000-0000-0000-0000-000000000001"),
            inicio=datetime.now(),
        )
        assert ejecucion.estado == EstadoEjecucion.RUNNING
        assert ejecucion.fin is None
        assert ejecucion.resultados is None

    def test_completed_state(self) -> None:
        now = datetime.now()
        ejecucion = EjecucionAnalisis(
            agente_id=UUID("00000000-0000-0000-0000-000000000001"),
            inicio=now,
            fin=now,
            estado=EstadoEjecucion.COMPLETED,
            resultados=ResultadoAnalisis(),
        )
        assert ejecucion.estado == EstadoEjecucion.COMPLETED
        assert ejecucion.fin is not None
        assert ejecucion.resultados is not None

    def test_serialization_roundtrip(self) -> None:
        ejecucion = EjecucionAnalisis(
            agente_id=UUID("00000000-0000-0000-0000-000000000001"),
            inicio=datetime.now(),
        )
        data = ejecucion.model_dump(mode="json")
        restored = EjecucionAnalisis.model_validate(data)
        assert restored.id == ejecucion.id
        assert restored.agente_id == ejecucion.agente_id
        assert restored.estado == ejecucion.estado
