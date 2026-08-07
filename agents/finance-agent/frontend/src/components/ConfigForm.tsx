"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { getConfig, updateConfig } from "@/lib/api";
import type { CompanyConfig } from "@/lib/types";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Constants
// ═════════════════════════════════════════════════════════════════════════

/** Available LLM providers */
const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google AI" },
  { value: "azure", label: "Azure OpenAI" },
  { value: "ollama", label: "Ollama (local)" },
] as const;

/** Models keyed by provider */
const MODELS_BY_PROVIDER: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  anthropic: [
    { value: "claude-3-opus", label: "Claude 3 Opus" },
    { value: "claude-3-sonnet", label: "Claude 3 Sonnet" },
    { value: "claude-3-haiku", label: "Claude 3 Haiku" },
  ],
  google: [
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
  azure: [
    { value: "gpt-4o", label: "GPT-4o (Azure)" },
    { value: "gpt-4", label: "GPT-4 (Azure)" },
  ],
  ollama: [
    { value: "llama3", label: "Llama 3" },
    { value: "mistral", label: "Mistral" },
    { value: "codellama", label: "CodeLlama" },
  ],
};

/** Available native tools (mirrors src/tools/index.ts) */
const AVAILABLE_TOOLS = [
  { id: "income-statement", label: "Estado de Resultados", description: "Pérdidas y ganancias del período" },
  { id: "balance-sheet", label: "Balance General", description: "Estado de situación financiera" },
  { id: "cash-flow", label: "Flujo de Caja", description: "Movimientos de efectivo" },
  { id: "aging-report", label: "Antigüedad de Saldos", description: "Cuentas por cobrar y pagar vencidas" },
  { id: "budget-vs-actual", label: "Presupuesto vs Real", description: "Comparativa presupuestaria" },
  { id: "kpi-dashboard", label: "KPIs Financieros", description: "Indicadores clave de rendimiento" },
  { id: "revenue-breakdown", label: "Desglose de Ingresos", description: "Ingresos por producto/región/canal" },
  { id: "cost-analysis", label: "Análisis de Costos", description: "Costos y gastos por categoría" },
  { id: "tax-summary", label: "Resumen Impositivo", description: "Situación fiscal (IVA, Renta, ICA)" },
  { id: "payroll-summary", label: "Resumen de Nómina", description: "Costos y distribución de nómina" },
] as const;

/** Example companies that can be enabled */
const AVAILABLE_COMPANIES = [
  { id: "company-a", label: "Comercializadora ABC S.A.S." },
  { id: "company-b", label: "Industrias del Valle S.A." },
  { id: "company-c", label: "Servicios Financieros LMN Ltda." },
  { id: "company-d", label: "Construcciones del Sur S.A.S." },
] as const;

/** Temperature presets */
const TEMPERATURE_PRESETS = [
  { value: 0.0, label: "0.0 — Preciso (determinista)" },
  { value: 0.3, label: "0.3 — Conservador" },
  { value: 0.7, label: "0.7 — Balanceado" },
  { value: 1.0, label: "1.0 — Creativo" },
  { value: 1.5, label: "1.5 — Experimental" },
] as const;

/** Max tokens presets */
const MAX_TOKENS_PRESETS = [
  { value: 512, label: "512 — Respuestas cortas" },
  { value: 1024, label: "1,024 — Estándar" },
  { value: 2048, label: "2,048 — Detallado" },
  { value: 4096, label: "4,096 — Muy detallado" },
  { value: 8192, label: "8,192 — Extenso" },
] as const;

// ═════════════════════════════════════════════════════════════════════════
// 2.  State types & reducer
// ═════════════════════════════════════════════════════════════════════════

interface ConfigFormState {
  /** Whether the initial config is being loaded */
  loading: boolean;
  /** Whether a save operation is in progress */
  saving: boolean;
  /** Error message from loading or saving */
  error: string | null;
  /** Success message after save */
  success: string | null;
  /** Whether the form has been modified since last load/save */
  dirty: boolean;
}

type ConfigFormAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS" }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_ERROR"; error: string }
  | { type: "MARK_DIRTY" }
  | { type: "CLEAR_MESSAGES" };

function formReducer(state: ConfigFormState, action: ConfigFormAction): ConfigFormState {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, loading: true, error: null };
    case "LOAD_SUCCESS":
      return { ...state, loading: false, dirty: false };
    case "LOAD_ERROR":
      return { ...state, loading: false, error: action.error };
    case "SAVE_START":
      return { ...state, saving: true, error: null, success: null };
    case "SAVE_SUCCESS":
      return { ...state, saving: false, success: "Configuración guardada correctamente.", dirty: false };
    case "SAVE_ERROR":
      return { ...state, saving: false, error: action.error };
    case "MARK_DIRTY":
      return { ...state, dirty: true, success: null };
    case "CLEAR_MESSAGES":
      return { ...state, error: null, success: null };
    default:
      return state;
  }
}

const INITIAL_STATE: ConfigFormState = {
  loading: false,
  saving: false,
  error: null,
  success: null,
  dirty: false,
};

// ═════════════════════════════════════════════════════════════════════════
// 3.  Form field types
// ═════════════════════════════════════════════════════════════════════════

interface ConfigFormFields {
  provider: string;
  modelName: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  enabledTools: string[];
  enabledCompanies: string[];
  companyName: string;
  companyCountry: string;
  companyCurrency: string;
  companyTimezone: string;
}

const DEFAULT_FIELDS: ConfigFormFields = {
  provider: "openai",
  modelName: "gpt-4o",
  apiKey: "",
  temperature: 0.7,
  maxTokens: 2048,
  enabledTools: AVAILABLE_TOOLS.map((t) => t.id),
  enabledCompanies: [],
  companyName: "",
  companyCountry: "Colombia",
  companyCurrency: "COP",
  companyTimezone: "America/Bogota",
};

// ═════════════════════════════════════════════════════════════════════════
// 4.  Sub-components
// ═════════════════════════════════════════════════════════════════════════

/* ─── Section header ────────────────────────────────────────────────── */

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      )}
    </div>
  );
}

/* ─── Checkbox group ────────────────────────────────────────────────── */

interface CheckboxGroupProps {
  /** Unique name for the fieldset */
  name: string;
  /** Legend text */
  legend: string;
  /** Description shown below the legend */
  description?: string;
  /** Available options */
  options: readonly { readonly id: string; readonly label: string; readonly description?: string }[];
  /** Currently selected values */
  selected: string[];
  /** Called when selection changes */
  onChange: (selected: string[]) => void;
  /** Error message */
  error?: string | null;
}

function CheckboxGroup({
  name,
  legend,
  description,
  options,
  selected,
  onChange,
  error,
}: CheckboxGroupProps) {
  const legendId = useId();
  const errorId = useId();

  const handleToggle = useCallback(
    (id: string, checked: boolean) => {
      if (checked) {
        onChange([...selected, id]);
      } else {
        onChange(selected.filter((s) => s !== id));
      }
    },
    [selected, onChange],
  );

  const allSelected = options.every((opt) => selected.includes(opt.id));

  const handleSelectAll = useCallback(() => {
    if (allSelected) {
      onChange([]);
    } else {
      onChange(options.map((opt) => opt.id));
    }
  }, [allSelected, options, onChange]);

  return (
    <fieldset
      className="space-y-3"
      aria-describedby={error ? errorId : undefined}
    >
      <legend id={legendId} className="text-sm font-medium text-gray-700">
        {legend}
      </legend>
      {description && (
        <p className="text-xs text-gray-500">{description}</p>
      )}

      {/* Select all / deselect all */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-xs font-medium text-primary-700 hover:text-primary-600 focus:outline-none focus:underline"
          onClick={handleSelectAll}
        >
          {allSelected ? "Deseleccionar todos" : "Seleccionar todos"}
        </button>
        <span className="text-xs text-gray-400">
          ({selected.length}/{options.length} seleccionados)
        </span>
      </div>

      {/* Checkbox list */}
      <ul className="space-y-2" role="group" aria-labelledby={legendId}>
        {options.map((option) => {
          const isChecked = selected.includes(option.id);
          const checkboxId = `${name}-${option.id}`;

          return (
            <li key={option.id}>
              <label
                htmlFor={checkboxId}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  isChecked
                    ? "border-primary-200 bg-primary-50/50"
                    : "border-gray-200 bg-white hover:bg-gray-50"
                }`}
              >
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => handleToggle(option.id, e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-900 focus:ring-primary-500"
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-gray-900">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="text-xs text-gray-500">
                      {option.description}
                    </span>
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      {error && (
        <p id={errorId} className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/* ─── Select field ──────────────────────────────────────────────────── */

interface SelectFieldProps {
  label: string;
  name: string;
  value: string;
  options: readonly { readonly value: string; readonly label: string }[];
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
}

function SelectField({
  label,
  name,
  value,
  options,
  onChange,
  error,
  disabled = false,
  placeholder,
}: SelectFieldProps) {
  const errorId = useId();

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="label">
        {label}
      </label>
      <select
        id={name}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="input"
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ─── Text input field ──────────────────────────────────────────────── */

interface TextFieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
  type?: "text" | "password" | "email";
  helperText?: string;
}

function TextField({
  label,
  name,
  value,
  onChange,
  error,
  disabled = false,
  placeholder,
  type = "text",
  helperText,
}: TextFieldProps) {
  const errorId = useId();
  const helperId = useId();

  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="label">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="input"
        aria-invalid={!!error}
        aria-describedby={
          [error ? errorId : "", helperText ? helperId : ""]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {helperText && !error && (
        <p id={helperId} className="text-xs text-gray-500">
          {helperText}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ─── Range slider ──────────────────────────────────────────────────── */

interface SliderFieldProps {
  label: string;
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
  presets?: readonly { readonly value: number; readonly label: string }[];
  onChange: (value: number) => void;
  disabled?: boolean;
}

function SliderField({
  label,
  name,
  value,
  min,
  max,
  step,
  presets,
  onChange,
  disabled = false,
}: SliderFieldProps) {
  const sliderId = useId();
  const valueId = useId();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor={sliderId} className="label">
          {label}
        </label>
        <span
          id={valueId}
          className="text-sm font-medium text-gray-900 tabular-nums"
        >
          {value}
        </span>
      </div>

      <input
        id={sliderId}
        name={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="
          h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200
          accent-primary-900
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1
          disabled:cursor-not-allowed disabled:opacity-50
        "
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-describedby={valueId}
      />

      {/* Preset quick-select buttons */}
      {presets && presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(preset.value)}
              className={`
                rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors
                focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1
                ${
                  value === preset.value
                    ? "bg-primary-900 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }
                disabled:cursor-not-allowed disabled:opacity-50
              `}
              aria-pressed={value === preset.value}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Alert banner ──────────────────────────────────────────────────── */

function AlertBanner({
  type,
  message,
  onDismiss,
}: {
  type: "error" | "success";
  message: string;
  onDismiss?: () => void;
}) {
  const styles =
    type === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : "border-green-200 bg-green-50 text-green-800";

  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${styles}`}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {type === "error" ? "⚠️" : "✅"}
      </span>
      <p className="flex-1">{message}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-current opacity-60 hover:opacity-100 focus:outline-none focus:underline"
          aria-label="Cerrar mensaje"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* ─── Loading skeleton ──────────────────────────────────────────────── */

function FormSkeleton() {
  return (
    <div className="space-y-8 animate-pulse" aria-label="Cargando formulario">
      {[1, 2, 3].map((section) => (
        <div key={section} className="space-y-4">
          <div className="h-5 w-48 rounded bg-gray-200" />
          <div className="h-3 w-72 rounded bg-gray-100" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="h-10 rounded-lg bg-gray-200" />
            <div className="h-10 rounded-lg bg-gray-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 5.  Main ConfigForm component
// ═════════════════════════════════════════════════════════════════════════

/**
 * ConfigForm — full configuration form for the Finance Agent.
 *
 * Sections:
 * 1. **Empresa** — company name, country, currency, timezone
 * 2. **Modelo LLM** — provider, model, API key, temperature, max tokens
 * 3. **Herramientas** — which native tools are enabled
 * 4. **Empresas habilitadas** — which companies the agent can operate on
 *
 * On save, it POSTs the configuration to `/api/config` via the existing
 * `updateConfig` API client function.
 */
export function ConfigForm() {
  /* ── Form state ──────────────────────────────────────────────────── */
  const [fields, setFields] = useState<ConfigFormFields>(DEFAULT_FIELDS);
  const [state, dispatch] = useReducer(formReducer, INITIAL_STATE);
  const [validationErrors, setValidationErrors] = useState<
    Partial<Record<keyof ConfigFormFields, string>>
  >({});

  const formRef = useRef<HTMLFormElement>(null);
  const headingId = useId();
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Load existing config on mount ────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      dispatch({ type: "LOAD_START" });

      const result = await getConfig();

      if (cancelled) return;

      if (result.ok) {
        const config = result.data.data;
        setFields({
          provider: config.model.provider,
          modelName: config.model.modelName,
          apiKey: config.model.apiKey,
          temperature: config.model.temperature,
          maxTokens: config.model.maxTokens,
          enabledTools: AVAILABLE_TOOLS.map((t) => t.id),
          enabledCompanies: [],
          companyName: config.company.name,
          companyCountry: config.company.country,
          companyCurrency: config.company.currency,
          companyTimezone: config.company.timezone,
        });
        dispatch({ type: "LOAD_SUCCESS" });
      } else {
        // If loading fails (e.g. no config yet), use defaults silently
        dispatch({ type: "LOAD_SUCCESS" });
      }
    }

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ── Auto-dismiss success message ────────────────────────────────── */

  useEffect(() => {
    if (state.success) {
      successTimeoutRef.current = setTimeout(() => {
        dispatch({ type: "CLEAR_MESSAGES" });
      }, 5000);
    }

    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
    };
  }, [state.success]);

  /* ── Field updaters ──────────────────────────────────────────────── */

  const updateField = useCallback(
    <K extends keyof ConfigFormFields>(key: K, value: ConfigFormFields[K]) => {
      setFields((prev) => ({ ...prev, [key]: value }));
      dispatch({ type: "MARK_DIRTY" });
      // Clear validation error for this field when user edits it
      setValidationErrors((prev) => {
        if (prev[key]) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return prev;
      });
    },
    [],
  );

  /* ── Validation ──────────────────────────────────────────────────── */

  const validate = useCallback((): boolean => {
    const errors: Partial<Record<keyof ConfigFormFields, string>> = {};

    if (!fields.companyName.trim()) {
      errors.companyName = "El nombre de la empresa es requerido.";
    }
    if (!fields.companyCountry.trim()) {
      errors.companyCountry = "El país es requerido.";
    }
    if (!fields.companyCurrency.trim()) {
      errors.companyCurrency = "La moneda es requerida.";
    }
    if (!fields.provider) {
      errors.provider = "Selecciona un proveedor de modelo LLM.";
    }
    if (!fields.modelName) {
      errors.modelName = "Selecciona un modelo LLM.";
    }
    if (!fields.apiKey.trim()) {
      errors.apiKey = "La API key del modelo es requerida.";
    }
    if (fields.enabledTools.length === 0) {
      errors.enabledTools = "Selecciona al menos una herramienta.";
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [fields]);

  /* ── Submit handler ──────────────────────────────────────────────── */

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (!validate()) {
        // Focus the first error field
        const firstErrorKey = Object.keys(validationErrors)[0];
        if (firstErrorKey && formRef.current) {
          const firstErrorEl = formRef.current.querySelector<HTMLElement>(
            `[name="${firstErrorKey}"]`,
          );
          firstErrorEl?.focus();
        }
        return;
      }

      dispatch({ type: "SAVE_START" });

      const configPayload: Partial<CompanyConfig> = {
        company: {
          name: fields.companyName.trim(),
          country: fields.companyCountry.trim(),
          currency: fields.companyCurrency.trim(),
          timezone: fields.companyTimezone,
        },
        model: {
          provider: fields.provider,
          modelName: fields.modelName,
          apiKey: fields.apiKey.trim(),
          temperature: fields.temperature,
          maxTokens: fields.maxTokens,
        },
      };

      const result = await updateConfig(configPayload);

      if (result.ok) {
        dispatch({ type: "SAVE_SUCCESS" });
      } else {
        dispatch({
          type: "SAVE_ERROR",
          error: result.error.message || "Error al guardar la configuración.",
        });
      }
    },
    [fields, validate, validationErrors],
  );

  /* ── Provider change handler (resets model if needed) ─────────────── */

  const handleProviderChange = useCallback(
    (provider: string) => {
      const models = MODELS_BY_PROVIDER[provider] ?? [];
      const currentModelStillValid = models.some((m) => m.value === fields.modelName);

      updateField("provider", provider);
      if (!currentModelStillValid && models.length > 0) {
        updateField("modelName", models[0].value);
      }
    },
    [fields.modelName, updateField],
  );

  /* ── Derived values ──────────────────────────────────────────────── */

  const availableModels = useMemo(
    () => MODELS_BY_PROVIDER[fields.provider] ?? [],
    [fields.provider],
  );

  /* ── Render ──────────────────────────────────────────────────────── */

  if (state.loading) {
    return (
      <div className="card">
        <FormSkeleton />
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      noValidate
      className="space-y-10"
      aria-labelledby={headingId}
    >
      {/* ── Page heading ────────────────────────────────────────────── */}
      <header>
        <h1
          id={headingId}
          className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl"
        >
          Configuración del Agente
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Configura el modelo LLM, las herramientas disponibles y las empresas
          habilitadas para el agente financiero.
        </p>
      </header>

      {/* ── Alert messages ──────────────────────────────────────────── */}
      {state.error && (
        <AlertBanner
          type="error"
          message={state.error}
          onDismiss={() => dispatch({ type: "CLEAR_MESSAGES" })}
        />
      )}
      {state.success && (
        <AlertBanner
          type="success"
          message={state.success}
          onDismiss={() => dispatch({ type: "CLEAR_MESSAGES" })}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1 — Company Info
          ═══════════════════════════════════════════════════════════════ */}
      <section className="card space-y-5">
        <SectionHeader
          title="Información de la Empresa"
          description="Datos generales de la compañía para contextualizar los reportes financieros."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Nombre de la empresa"
            name="companyName"
            value={fields.companyName}
            onChange={(v) => updateField("companyName", v)}
            error={validationErrors.companyName}
            placeholder="Ej: Comercializadora ABC S.A.S."
          />
          <TextField
            label="País"
            name="companyCountry"
            value={fields.companyCountry}
            onChange={(v) => updateField("companyCountry", v)}
            error={validationErrors.companyCountry}
            placeholder="Ej: Colombia"
          />
          <TextField
            label="Moneda"
            name="companyCurrency"
            value={fields.companyCurrency}
            onChange={(v) => updateField("companyCurrency", v)}
            error={validationErrors.companyCurrency}
            placeholder="Ej: COP"
          />
          <TextField
            label="Zona horaria"
            name="companyTimezone"
            value={fields.companyTimezone}
            onChange={(v) => updateField("companyTimezone", v)}
            placeholder="Ej: America/Bogota"
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2 — LLM Model
          ═══════════════════════════════════════════════════════════════ */}
      <section className="card space-y-5">
        <SectionHeader
          title="Modelo de Lenguaje (LLM)"
          description="Selecciona el proveedor y modelo que usará el agente para procesar consultas financieras."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField
            label="Proveedor"
            name="provider"
            value={fields.provider}
            options={PROVIDERS}
            onChange={handleProviderChange}
            error={validationErrors.provider}
          />
          <SelectField
            label="Modelo"
            name="modelName"
            value={fields.modelName}
            options={availableModels}
            onChange={(v) => updateField("modelName", v)}
            error={validationErrors.modelName}
            disabled={availableModels.length === 0}
            placeholder={
              availableModels.length === 0
                ? "Sin modelos disponibles"
                : undefined
            }
          />
        </div>

        <TextField
          label="API Key"
          name="apiKey"
          type="password"
          value={fields.apiKey}
          onChange={(v) => updateField("apiKey", v)}
          error={validationErrors.apiKey}
          placeholder="sk-..."
          helperText="La API key se almacena de forma segura y nunca se expone al frontend."
        />

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <SliderField
            label="Temperatura"
            name="temperature"
            value={fields.temperature}
            min={0}
            max={2}
            step={0.1}
            presets={TEMPERATURE_PRESETS}
            onChange={(v) => updateField("temperature", v)}
          />
          <SliderField
            label="Máximo de tokens"
            name="maxTokens"
            value={fields.maxTokens}
            min={128}
            max={16384}
            step={128}
            presets={MAX_TOKENS_PRESETS}
            onChange={(v) => updateField("maxTokens", v)}
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3 — Enabled Tools
          ═══════════════════════════════════════════════════════════════ */}
      <section className="card space-y-5">
        <SectionHeader
          title="Herramientas Habilitadas"
          description="Selecciona las herramientas financieras que el agente puede utilizar para responder consultas."
        />

        <CheckboxGroup
          name="enabledTools"
          legend="Herramientas disponibles"
          options={AVAILABLE_TOOLS}
          selected={fields.enabledTools}
          onChange={(v) => updateField("enabledTools", v)}
          error={validationErrors.enabledTools}
        />
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4 — Enabled Companies (Gates)
          ═══════════════════════════════════════════════════════════════ */}
      <section className="card space-y-5">
        <SectionHeader
          title="Empresas Habilitadas (Gates)"
          description="Define sobre qué empresas puede operar el agente. Si no seleccionas ninguna, el agente operará sobre todas."
        />

        <CheckboxGroup
          name="enabledCompanies"
          legend="Empresas"
          options={AVAILABLE_COMPANIES}
          selected={fields.enabledCompanies}
          onChange={(v) => updateField("enabledCompanies", v)}
        />

        {fields.enabledCompanies.length === 0 && (
          <p className="text-xs italic text-gray-400">
            Sin restricción — el agente opera sobre todas las empresas.
          </p>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5 — Save button
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-6">
        <div className="flex items-center gap-2">
          {state.dirty && (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-800">
              <span aria-hidden="true">●</span>
              Sin guardar
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setFields(DEFAULT_FIELDS);
              setValidationErrors({});
              dispatch({ type: "CLEAR_MESSAGES" });
            }}
            className="btn-secondary"
            disabled={state.saving}
          >
            Restablecer
          </button>

          <button
            type="submit"
            className="btn-primary min-w-[160px]"
            disabled={state.saving}
          >
            {state.saving ? (
              <span className="inline-flex items-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
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
                Guardando...
              </span>
            ) : (
              "Guardar Configuración"
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
