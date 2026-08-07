"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useId,
  useState,
} from "react";
import type { ExportFormat, PeriodString } from "@/lib/types";

/* ─── Types ─────────────────────────────────────────────────────────── */

/** A report template option displayed in the selector */
export interface ReportTemplate {
  /** Unique template identifier (e.g. "balance", "income-statement") */
  id: string;
  /** Human-readable label (e.g. "Balance General") */
  label: string;
  /** Optional description shown in the selector */
  description?: string;
  /** Category for grouping (e.g. "Estados Financieros", "Impuestos") */
  category: string;
}

/** Props for the ReportGenerator component */
interface ReportGeneratorProps {
  /** Available report templates */
  templates: ReportTemplate[];
  /** Currently selected template id */
  selectedTemplateId?: string;
  /** Called when the user submits a report generation request */
  onGenerate: (request: ReportGeneratorRequest) => void;
  /** Whether a report generation is in progress */
  isGenerating?: boolean;
  /** Error message to display (if any) */
  error?: string | null;
  /** Additional CSS classes */
  className?: string;
}

/** Shape of the data emitted by the form */
export interface ReportGeneratorRequest {
  templateId: string;
  period: PeriodString;
  formats: ExportFormat[];
  title?: string;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "markdown", label: "Markdown" },
  { value: "pdf", label: "PDF" },
  { value: "xlsx", label: "Excel (XLSX)" },
];

const PERIOD_PRESETS: { value: PeriodString; label: string }[] = [
  { value: "", label: "Personalizado..." },
  { value: new Date().toISOString().slice(0, 7), label: "Mes actual" },
  { value: `${Number(new Date().toISOString().slice(0, 4)) - 1}-${String(new Date().getMonth() + 1).padStart(2, "0")}`, label: "Mes anterior" },
  { value: `${new Date().toISOString().slice(0, 4)}-Q1`, label: "Q1 (Ene–Mar)" },
  { value: `${new Date().toISOString().slice(0, 4)}-Q2`, label: "Q2 (Abr–Jun)" },
  { value: `${new Date().toISOString().slice(0, 4)}-Q3`, label: "Q3 (Jul–Sep)" },
  { value: `${new Date().toISOString().slice(0, 4)}-Q4`, label: "Q4 (Oct–Dic)" },
  { value: new Date().toISOString().slice(0, 4), label: "Año actual" },
];

/* ─── Group templates by category ───────────────────────────────────── */

function groupByCategory(templates: ReportTemplate[]): Map<string, ReportTemplate[]> {
  const groups = new Map<string, ReportTemplate[]>();
  for (const t of templates) {
    const list = groups.get(t.category) ?? [];
    list.push(t);
    groups.set(t.category, list);
  }
  return groups;
}

/* ─── ReportGenerator Component ─────────────────────────────────────── */

/**
 * ReportGenerator — a form that lets the user select a report template,
 * configure the period and export formats, and trigger generation.
 *
 * Features:
 * - Template selector grouped by category
 * - Period presets + custom ISO-8601 period input
 * - Multi-format checkbox selection (markdown, PDF, XLSX)
 * - Optional title override
 * - Loading state with disabled controls
 * - Error display
 * - Full keyboard navigation and screen reader support
 *
 * @example
 * ```tsx
 * <ReportGenerator
 *   templates={[
 *     { id: "balance", label: "Balance General", category: "Estados Financieros" },
 *     { id: "income-statement", label: "Estado de Resultados", category: "Estados Financieros" },
 *   ]}
 *   onGenerate={(req) => console.log(req)}
 * />
 * ```
 */
export function ReportGenerator({
  templates,
  selectedTemplateId: initialTemplateId,
  onGenerate,
  isGenerating = false,
  error = null,
  className = "",
}: ReportGeneratorProps) {
  /* ── State ─────────────────────────────────────────────────────── */
  const [templateId, setTemplateId] = useState(initialTemplateId ?? "");
  const [period, setPeriod] = useState("");
  const [periodPreset, setPeriodPreset] = useState("");
  const [formats, setFormats] = useState<ExportFormat[]>(["pdf"]);
  const [title, setTitle] = useState("");

  /* ── IDs for accessibility ─────────────────────────────────────── */
  const formId = useId();
  const templateLabelId = useId();
  const periodLabelId = useId();
  const formatsLabelId = useId();
  const titleLabelId = useId();
  const errorId = useId();

  /* ── Derived ───────────────────────────────────────────────────── */
  const groupedTemplates = groupByCategory(templates);
  const isFormValid = templateId.trim() !== "" && period.trim() !== "" && formats.length > 0;

  /* ── Handlers ──────────────────────────────────────────────────── */

  const handlePeriodPresetChange = useCallback(
    (e: ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setPeriodPreset(value);
      if (value) {
        setPeriod(value);
      }
    },
    [],
  );

  const handleFormatToggle = useCallback(
    (format: ExportFormat) => {
      setFormats((prev) =>
        prev.includes(format)
          ? prev.filter((f) => f !== format)
          : [...prev, format],
      );
    },
    [],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!isFormValid || isGenerating) return;

      onGenerate({
        templateId,
        period: period as PeriodString,
        formats,
        title: title.trim() || undefined,
      });
    },
    [templateId, period, formats, title, isFormValid, isGenerating, onGenerate],
  );

  /* ── Render ────────────────────────────────────────────────────── */

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      noValidate
      className={`card flex flex-col gap-6 ${className}`}
      aria-label="Generar reporte financiero"
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <header>
        <h2 className="text-lg font-semibold text-gray-900">
          Generar Reporte
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Selecciona una plantilla, configura el período y los formatos de
          exportación.
        </p>
      </header>

      {/* ── Template selector ───────────────────────────────────── */}
      <fieldset>
        <legend
          id={templateLabelId}
          className="label mb-2"
        >
          Plantilla
        </legend>

        {templates.length === 0 ? (
          <p className="text-sm text-gray-400 italic">
            No hay plantillas disponibles.
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-labelledby={templateLabelId}
            className="flex flex-col gap-2"
          >
            {Array.from(groupedTemplates.entries()).map(
              ([category, categoryTemplates]) => (
                <div key={category}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {category}
                  </p>
                  <div className="flex flex-col gap-1">
                    {categoryTemplates.map((tpl) => {
                      const isSelected = templateId === tpl.id;
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
                            onChange={() => setTemplateId(tpl.id)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-primary-900"
                            aria-describedby={
                              tpl.description ? `${tpl.id}-desc` : undefined
                            }
                          />
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-gray-900">
                              {tpl.label}
                            </span>
                            {tpl.description && (
                              <span
                                id={`${tpl.id}-desc`}
                                className="text-xs text-gray-500"
                              >
                                {tpl.description}
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </fieldset>

      {/* ── Period ───────────────────────────────────────────────── */}
      <fieldset>
        <legend
          id={periodLabelId}
          className="label mb-2"
        >
          Período
        </legend>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          {/* Preset selector */}
          <div className="flex-1">
            <label
              htmlFor={`${formId}-period-preset`}
              className="sr-only"
            >
              Período predefinido
            </label>
            <select
              id={`${formId}-period-preset`}
              value={periodPreset}
              onChange={handlePeriodPresetChange}
              className="input"
              disabled={isGenerating}
            >
              {PERIOD_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom period input */}
          <div className="flex-1">
            <label
              htmlFor={`${formId}-period-custom`}
              className="sr-only"
            >
              Período personalizado (ISO-8601, ej. 2025-01 o 2025-Q1)
            </label>
            <input
              id={`${formId}-period-custom`}
              type="text"
              inputMode="text"
              placeholder="2025-01 o 2025-Q1"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value);
                setPeriodPreset("");
              }}
              className="input"
              disabled={isGenerating}
              aria-label="Período personalizado"
            />
          </div>
        </div>

        {period && !/^\d{4}(-\d{2}|-Q[1-4])$/.test(period) && (
          <p className="text-xs text-red-600" role="alert">
            Formato esperado: AAAA-MM (ej. 2025-01) o AAAA-Q[1-4] (ej. 2025-Q1)
          </p>
        )}
      </fieldset>

      {/* ── Export formats ───────────────────────────────────────── */}
      <fieldset>
        <legend
          id={formatsLabelId}
          className="label mb-2"
        >
          Formatos de exportación
        </legend>

        <div className="flex flex-wrap gap-4">
          {EXPORT_FORMATS.map((fmt) => {
            const isChecked = formats.includes(fmt.value);
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
                  onChange={() => handleFormatToggle(fmt.value)}
                  className="h-4 w-4 rounded accent-primary-900"
                  disabled={isGenerating}
                />
                <span className="text-sm font-medium text-gray-700">
                  {fmt.label}
                </span>
              </label>
            );
          })}
        </div>

        {formats.length === 0 && (
          <p className="text-xs text-red-600" role="alert">
            Selecciona al menos un formato.
          </p>
        )}
      </fieldset>

      {/* ── Optional title ───────────────────────────────────────── */}
      <div>
        <label
          htmlFor={`${formId}-title`}
          className="label mb-1"
        >
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
          disabled={isGenerating}
          maxLength={120}
        />
      </div>

      {/* ── Error message ────────────────────────────────────────── */}
      {error && (
        <div
          id={errorId}
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {/* ── Submit button ────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
        <button
          type="submit"
          disabled={!isFormValid || isGenerating}
          className="btn-primary"
          aria-busy={isGenerating}
        >
          {isGenerating ? (
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
  );
}
