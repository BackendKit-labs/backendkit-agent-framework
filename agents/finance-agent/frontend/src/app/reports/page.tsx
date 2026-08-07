"use client";

import {
  type ChangeEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { postReport, listReports } from "@/lib/api";
import type {
  ExportFormat,
  PeriodString,
  ReportRequest,
  ReportResult,
  CollectedData,
} from "@/lib/types";
import { MetricCard } from "@/components/MetricCard";
import { StatusBadge } from "@/components/StatusBadge";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Constants
// ═════════════════════════════════════════════════════════════════════════

/** Available report templates — mirrors the backend templates */
const REPORT_TEMPLATES = [
  {
    id: "income-statement",
    label: "Estado de Resultados",
    description: "Pérdidas y ganancias del período",
    category: "Estados Financieros",
  },
  {
    id: "balance-sheet",
    label: "Balance General",
    description: "Estado de situación financiera",
    category: "Estados Financieros",
  },
  {
    id: "cash-flow",
    label: "Flujo de Caja",
    description: "Movimientos de efectivo",
    category: "Estados Financieros",
  },
  {
    id: "aging-report",
    label: "Antigüedad de Saldos",
    description: "Cuentas por cobrar y pagar vencidas",
    category: "Análisis",
  },
  {
    id: "budget-vs-actual",
    label: "Presupuesto vs Real",
    description: "Comparativa presupuestaria",
    category: "Análisis",
  },
  {
    id: "kpi-dashboard",
    label: "KPIs Financieros",
    description: "Indicadores clave de rendimiento",
    category: "Dashboard",
  },
  {
    id: "revenue-breakdown",
    label: "Desglose de Ingresos",
    description: "Ingresos por producto/región/canal",
    category: "Análisis",
  },
  {
    id: "cost-analysis",
    label: "Análisis de Costos",
    description: "Costos y gastos por categoría",
    category: "Análisis",
  },
  {
    id: "tax-summary",
    label: "Resumen Impositivo",
    description: "Situación fiscal (IVA, Renta, ICA)",
    category: "Impuestos",
  },
  {
    id: "payroll-summary",
    label: "Resumen de Nómina",
    description: "Costos y distribución de nómina",
    category: "RRHH",
  },
] as const;

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "markdown", label: "Markdown" },
  { value: "pdf", label: "PDF" },
  { value: "xlsx", label: "Excel (XLSX)" },
];

const PERIOD_PRESETS: { value: string; label: string }[] = [
  { value: "", label: "Personalizado..." },
  { value: new Date().toISOString().slice(0, 7), label: "Mes actual" },
  {
    value: `${Number(new Date().toISOString().slice(0, 4)) - 1}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
    label: "Mes anterior",
  },
  { value: `${new Date().toISOString().slice(0, 4)}-Q1`, label: "Q1 (Ene–Mar)" },
  { value: `${new Date().toISOString().slice(0, 4)}-Q2`, label: "Q2 (Abr–Jun)" },
  { value: `${new Date().toISOString().slice(0, 4)}-Q3`, label: "Q3 (Jul–Sep)" },
  { value: `${new Date().toISOString().slice(0, 4)}-Q4`, label: "Q4 (Oct–Dic)" },
  { value: new Date().toISOString().slice(0, 4), label: "Año actual" },
];

// ═════════════════════════════════════════════════════════════════════════
// 2.  State types & reducer
// ═════════════════════════════════════════════════════════════════════════

interface ReportsPageState {
  /** Whether a report generation is in progress */
  generating: boolean;
  /** Whether the report list is loading */
  loadingList: boolean;
  /** Error message */
  error: string | null;
  /** The last generated report result */
  lastResult: ReportResult | null;
  /** Previously generated reports */
  history: ReportResult[];
  /** Whether to show the history panel */
  showHistory: boolean;
}

type ReportsPageAction =
  | { type: "GENERATE_START" }
  | { type: "GENERATE_SUCCESS"; result: ReportResult }
  | { type: "GENERATE_ERROR"; error: string }
  | { type: "LOAD_HISTORY_START" }
  | { type: "LOAD_HISTORY_SUCCESS"; reports: ReportResult[] }
  | { type: "LOAD_HISTORY_ERROR"; error: string }
  | { type: "TOGGLE_HISTORY" }
  | { type: "CLEAR_ERROR" };

function reportsReducer(
  state: ReportsPageState,
  action: ReportsPageAction,
): ReportsPageState {
  switch (action.type) {
    case "GENERATE_START":
      return { ...state, generating: true, error: null, lastResult: null };
    case "GENERATE_SUCCESS":
      return {
        ...state,
        generating: false,
        lastResult: action.result,
        history: [action.result, ...state.history].slice(0, 50),
      };
    case "GENERATE_ERROR":
      return { ...state, generating: false, error: action.error };
    case "LOAD_HISTORY_START":
      return { ...state, loadingList: true };
    case "LOAD_HISTORY_SUCCESS":
      return { ...state, loadingList: false, history: action.reports };
    case "LOAD_HISTORY_ERROR":
      return { ...state, loadingList: false, error: action.error };
    case "TOGGLE_HISTORY":
      return { ...state, showHistory: !state.showHistory };
    case "CLEAR_ERROR":
      return { ...state, error: null };
    default:
      return state;
  }
}

const INITIAL_STATE: ReportsPageState = {
  generating: false,
  loadingList: false,
  error: null,
  lastResult: null,
  history: [],
  showHistory: false,
};

// ═════════════════════════════════════════════════════════════════════════
// 3.  Sub-components
// ═════════════════════════════════════════════════════════════════════════

/* ─── Template selector ─────────────────────────────────────────────── */

function TemplateSelector({
  templates,
  selectedId,
  onChange,
  disabled,
}: {
  templates: readonly typeof REPORT_TEMPLATES[number][];
  selectedId: string;
  onChange: (id: string) => void;
  disabled: boolean;
}) {
  const labelId = useId();

  const grouped = useMemo(() => {
    const map = new Map<string, typeof REPORT_TEMPLATES[number][]>();
    for (const t of templates) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return map;
  }, [templates]);

  return (
    <fieldset>
      <legend id={labelId} className="label mb-2">
        Plantilla
      </legend>

      {templates.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No hay plantillas disponibles.</p>
      ) : (
        <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-2">
          {Array.from(grouped.entries()).map(([category, categoryTemplates]) => (
            <div key={category}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {category}
              </p>
              <div className="flex flex-col gap-1">
                {categoryTemplates.map((tpl) => {
                  const isSelected = selectedId === tpl.id;
                  return (
                    <label
                      key={tpl.id}
                      className={`
                        flex cursor-pointer items-start gap-3 rounded-lg border p-3
                        transition-colors duration-150
                        focus-within:ring-2 focus-within:ring-primary-500
                        ${
                          isSelected
                            ? "border-primary-500 bg-primary-50"
                            : "border-gray-200 bg-white hover:bg-gray-50"
                        }
                      `}
                    >
                      <input
                        type="radio"
                        name="template"
                        value={tpl.id}
                        checked={isSelected}
                        onChange={() => onChange(tpl.id)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary-900"
                        disabled={disabled}
                        aria-describedby={tpl.description ? `${tpl.id}-desc` : undefined}
                      />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-gray-900">{tpl.label}</span>
                        {tpl.description && (
                          <span id={`${tpl.id}-desc`} className="text-xs text-gray-500">
                            {tpl.description}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/* ─── Period selector ───────────────────────────────────────────────── */

function PeriodSelector({
  period,
  periodPreset,
  onPeriodChange,
  onPresetChange,
  disabled,
  formId,
}: {
  period: string;
  periodPreset: string;
  onPeriodChange: (value: string) => void;
  onPresetChange: (value: string) => void;
  disabled: boolean;
  formId: string;
}) {
  const isValid = period === "" || /^\d{4}(-\d{2}|-Q[1-4])$/.test(period);

  return (
    <fieldset>
      <legend className="label mb-2">Período</legend>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={`${formId}-period-preset`} className="sr-only">
            Período predefinido
          </label>
          <select
            id={`${formId}-period-preset`}
            value={periodPreset}
            onChange={(e) => onPresetChange(e.target.value)}
            className="input"
            disabled={disabled}
          >
            {PERIOD_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label htmlFor={`${formId}-period-custom`} className="sr-only">
            Período personalizado (ISO-8601, ej. 2025-01 o 2025-Q1)
          </label>
          <input
            id={`${formId}-period-custom`}
            type="text"
            inputMode="text"
            placeholder="2025-01 o 2025-Q1"
            value={period}
            onChange={(e) => {
              onPeriodChange(e.target.value);
              onPresetChange("");
            }}
            className="input"
            disabled={disabled}
            aria-label="Período personalizado"
          />
        </div>
      </div>

      {period && !isValid && (
        <p className="text-xs text-red-600" role="alert">
          Formato esperado: AAAA-MM (ej. 2025-01) o AAAA-Q[1-4] (ej. 2025-Q1)
        </p>
      )}
    </fieldset>
  );
}

/* ─── Format checkboxes ─────────────────────────────────────────────── */

function FormatSelector({
  selected,
  onChange,
  disabled,
  formId,
}: {
  selected: ExportFormat[];
  onChange: (formats: ExportFormat[]) => void;
  disabled: boolean;
  formId: string;
}) {
  const handleToggle = useCallback(
    (format: ExportFormat) => {
      onChange(
        selected.includes(format)
          ? selected.filter((f) => f !== format)
          : [...selected, format],
      );
    },
    [selected, onChange],
  );

  return (
    <fieldset>
      <legend className="label mb-2">Formatos de exportación</legend>

      <div className="flex flex-wrap gap-4">
        {EXPORT_FORMATS.map((fmt) => {
          const isChecked = selected.includes(fmt.value);
          return (
            <label
              key={fmt.value}
              className={`
                flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2
                transition-colors duration-150
                ${
                  isChecked
                    ? "border-primary-500 bg-primary-50"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                }
              `}
            >
              <input
                type="checkbox"
                value={fmt.value}
                checked={isChecked}
                onChange={() => handleToggle(fmt.value)}
                className="h-4 w-4 rounded accent-primary-900"
                disabled={disabled}
              />
              <span className="text-sm font-medium text-gray-700">{fmt.label}</span>
            </label>
          );
        })}
      </div>

      {selected.length === 0 && (
        <p className="text-xs text-red-600" role="alert">
          Selecciona al menos un formato.
        </p>
      )}
    </fieldset>
  );
}

/* ─── Report result display ─────────────────────────────────────────── */

function ReportResultCard({ result }: { result: ReportResult }) {
  const generatedDate = new Date(result.generatedAt).toLocaleString("es-CO", {
    dateStyle: "long",
    timeStyle: "short",
  });

  const successCount = result.collectedData.filter((d) => d.success).length;
  const totalCount = result.collectedData.length;

  return (
    <div className="card animate-slide-up space-y-4" role="region" aria-label="Resultado del reporte">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {result.title}
          </h3>
          <p className="text-sm text-gray-500">
            Período: {result.period} &middot; Generado: {generatedDate}
          </p>
        </div>
        <StatusBadge
          status={result.success ? "online" : "offline"}
          label={result.success ? "Completado" : "Error"}
        />
      </div>

      {/* Execution stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          title="Datos recolectados"
          value={`${successCount}/${totalCount}`}
          trend={totalCount > 0 ? `${Math.round((successCount / totalCount) * 100)}% éxito` : undefined}
          trendDirection={successCount === totalCount ? "up" : successCount > 0 ? "neutral" : "down"}
        />
        <MetricCard
          title="Tiempo total"
          value={`${(result.totalExecutionTimeMs / 1000).toFixed(1)}s`}
        />
        <MetricCard
          title="Formatos"
          value={Object.keys(result.exports).length}
          trend={Object.keys(result.exports).join(", ").toUpperCase()}
        />
        <MetricCard
          title="Estado"
          value={result.success ? "OK" : "Error"}
          trendDirection={result.success ? "up" : "down"}
        />
      </div>

      {/* Collected data details */}
      {result.collectedData.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-primary-700 hover:text-primary-600 focus:outline-none focus:underline">
            Ver datos recolectados ({result.collectedData.length} tools)
          </summary>
          <div className="mt-3 space-y-2">
            {result.collectedData.map((data, idx) => (
              <DataRow key={idx} data={data} />
            ))}
          </div>
        </details>
      )}

      {/* Markdown preview */}
      {result.markdown && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium text-primary-700 hover:text-primary-600 focus:outline-none focus:underline">
            Vista previa del reporte
          </summary>
          <div className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-4">
            <pre className="whitespace-pre-wrap text-xs text-gray-700 font-mono">
              {result.markdown.slice(0, 4000)}
              {result.markdown.length > 4000 && "\n\n... (contenido truncado)"}
            </pre>
          </div>
        </details>
      )}

      {/* Error detail */}
      {result.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <span className="font-medium">Error:</span> {result.error}
        </div>
      )}
    </div>
  );
}

/* ─── Data row for collected data ───────────────────────────────────── */

function DataRow({ data }: { data: CollectedData }) {
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        data.success
          ? "border-green-200 bg-green-50"
          : "border-red-200 bg-red-50"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-900">{data.toolName}</span>
        <span className="text-xs text-gray-500">
          {(data.executionTimeMs / 1000).toFixed(2)}s
        </span>
      </div>
      {data.error && (
        <p className="mt-1 text-red-700">{data.error}</p>
      )}
    </div>
  );
}

/* ─── History list ──────────────────────────────────────────────────── */

function ReportHistory({
  reports,
  loading,
  onSelect,
}: {
  reports: ReportResult[];
  loading: boolean;
  onSelect: (report: ReportResult) => void;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-label="Cargando historial">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg bg-gray-100"
          />
        ))}
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-gray-400">
        <svg
          className="h-8 w-8"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="text-sm">No hay reportes generados aún</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2" role="list" aria-label="Historial de reportes">
      {reports.map((report, idx) => (
        <li key={`${report.generatedAt}-${idx}`}>
          <button
            type="button"
            onClick={() => onSelect(report)}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left text-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">
                {report.title}
              </p>
              <p className="text-xs text-gray-500">
                {report.period} &middot;{" "}
                {new Date(report.generatedAt).toLocaleDateString("es-CO")}
              </p>
            </div>
            <StatusBadge
              status={report.success ? "online" : "offline"}
              label={report.success ? "OK" : "Error"}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* ─── Loading skeleton for the form ─────────────────────────────────── */

function FormSkeleton() {
  return (
    <div className="card space-y-6 animate-pulse" aria-label="Cargando formulario">
      <div className="h-6 w-48 rounded bg-gray-200" />
      <div className="h-4 w-72 rounded bg-gray-100" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-gray-100" />
        ))}
      </div>
      <div className="h-10 w-40 rounded-lg bg-gray-200" />
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 4.  Main ReportsPage component
// ═════════════════════════════════════════════════════════════════════════

/**
 * ReportsPage — generate and view financial reports.
 *
 * Layout:
 * 1. Page header with title and description
 * 2. Two-column layout:
 *    - Left: report generation form (template, period, formats)
 *    - Right: history panel (collapsible on mobile)
 * 3. Result display area (shows after generation)
 *
 * Features:
 * - Template selection grouped by category
 * - Period presets + custom ISO-8601 input
 * - Multi-format export (markdown, PDF, XLSX)
 * - Report history with selection
 * - Loading, error, and empty states
 * - Full keyboard navigation and screen reader support
 */
export default function ReportsPage() {
  const [state, dispatch] = useReducer(reportsReducer, INITIAL_STATE);

  /* ── Form state ──────────────────────────────────────────────────── */
  const [templateId, setTemplateId] = useState("");
  const [period, setPeriod] = useState("");
  const [periodPreset, setPeriodPreset] = useState("");
  const [formats, setFormats] = useState<ExportFormat[]>(["pdf"]);
  const [title, setTitle] = useState("");

  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  /* ── Derived ─────────────────────────────────────────────────────── */
  const isFormValid = templateId.trim() !== "" && period.trim() !== "" && formats.length > 0;

  /* ── Load history on mount ───────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      dispatch({ type: "LOAD_HISTORY_START" });
      const result = await listReports({ limit: 20 });

      if (cancelled) return;

      if (result.ok) {
        dispatch({ type: "LOAD_HISTORY_SUCCESS", reports: result.data.data });
      } else {
        // Silently use empty history if backend not available
        dispatch({ type: "LOAD_HISTORY_SUCCESS", reports: [] });
      }
    }

    loadHistory();
    return () => { cancelled = true; };
  }, []);

  /* ── Generate handler ────────────────────────────────────────────── */

  const handleGenerate = useCallback(async () => {
    if (!isFormValid || state.generating) return;

    dispatch({ type: "GENERATE_START" });

    const request: ReportRequest = {
      template: templateId,
      period: period as PeriodString,
      formats,
      title: title.trim() || undefined,
    };

    const result = await postReport(request);

    if (result.ok) {
      dispatch({ type: "GENERATE_SUCCESS", result: result.data.data });
      // Scroll to result
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } else {
      dispatch({
        type: "GENERATE_ERROR",
        error: result.error.message || "Error al generar el reporte.",
      });
    }
  }, [templateId, period, formats, title, isFormValid, state.generating]);

  /* ── Handle period preset change ─────────────────────────────────── */

  const handlePresetChange = useCallback((value: string) => {
    setPeriodPreset(value);
    if (value) setPeriod(value);
  }, []);

  /* ── Handle form submit ──────────────────────────────────────────── */

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      handleGenerate();
    },
    [handleGenerate],
  );

  /* ── Select report from history ──────────────────────────────────── */

  const handleSelectHistory = useCallback((report: ReportResult) => {
    dispatch({ type: "GENERATE_SUCCESS", result: report });
    setTimeout(() => {
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }, []);

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Reportes Financieros
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Genera reportes financieros a partir de plantillas predefinidas.
          Selecciona el tipo de reporte, configura el período y los formatos
          de exportación.
        </p>
      </header>

      {/* ── Error banner ────────────────────────────────────────────── */}
      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            ⚠️
          </span>
          <p className="flex-1">{state.error}</p>
          <button
            type="button"
            onClick={() => dispatch({ type: "CLEAR_ERROR" })}
            className="shrink-0 text-red-600 opacity-60 hover:opacity-100 focus:outline-none focus:underline"
            aria-label="Cerrar mensaje de error"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Two-column layout: form + history ───────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ── Left column: Generation form ──────────────────────────── */}
        <div className="lg:col-span-2">
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            noValidate
            className="card flex flex-col gap-6"
            aria-label="Formulario de generación de reportes"
          >
            {/* Form header */}
            <header>
              <h2 className="text-lg font-semibold text-gray-900">
                Generar Reporte
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Selecciona una plantilla, configura el período y los formatos
                de exportación.
              </p>
            </header>

            {/* Template selector */}
            <TemplateSelector
              templates={REPORT_TEMPLATES}
              selectedId={templateId}
              onChange={setTemplateId}
              disabled={state.generating}
            />

            {/* Period */}
            <PeriodSelector
              period={period}
              periodPreset={periodPreset}
              onPeriodChange={setPeriod}
              onPresetChange={handlePresetChange}
              disabled={state.generating}
              formId={formId}
            />

            {/* Export formats */}
            <FormatSelector
              selected={formats}
              onChange={setFormats}
              disabled={state.generating}
              formId={formId}
            />

            {/* Optional title */}
            <div>
              <label htmlFor={`${formId}-title`} className="label mb-1">
                Título personalizado{" "}
                <span className="font-normal text-gray-400">(opcional)</span>
              </label>
              <input
                id={`${formId}-title`}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej: Balance General - Cierre Mensual"
                className="input"
                disabled={state.generating}
                maxLength={120}
              />
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
              <button
                type="submit"
                disabled={!isFormValid || state.generating}
                className="btn-primary"
                aria-busy={state.generating}
              >
                {state.generating ? (
                  <>
                    <svg
                      className="-ml-1 mr-2 h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Generando...
                  </>
                ) : (
                  "Generar Reporte"
                )}
              </button>
            </div>
          </form>
        </div>

        {/* ── Right column: History ─────────────────────────────────── */}
        <div className="lg:col-span-1">
          <div className="card flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Historial
              </h2>
              <button
                type="button"
                onClick={() => dispatch({ type: "TOGGLE_HISTORY" })}
                className="text-sm text-primary-700 hover:text-primary-600 focus:outline-none focus:underline lg:hidden"
                aria-expanded={state.showHistory}
                aria-controls="report-history-panel"
              >
                {state.showHistory ? "Ocultar" : "Mostrar"}
              </button>
            </div>

            <div
              id="report-history-panel"
              className={`${state.showHistory ? "block" : "hidden"} lg:block`}
            >
              <ReportHistory
                reports={state.history}
                loading={state.loadingList}
                onSelect={handleSelectHistory}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Result area ─────────────────────────────────────────────── */}
      <div ref={resultRef} tabIndex={-1}>
        {state.generating && (
          <div className="card flex items-center gap-3" role="status" aria-label="Generando reporte">
            <svg
              className="h-5 w-5 animate-spin text-primary-600"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-sm text-gray-600">
              Generando reporte... Esto puede tomar unos segundos.
            </span>
          </div>
        )}

        {state.lastResult && !state.generating && (
          <ReportResultCard result={state.lastResult} />
        )}
      </div>
    </div>
  );
}
