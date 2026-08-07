"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { getConfig, updateConfig } from "@/lib/api";
import type { CompanyConfig, CompanyInfo } from "@/lib/types";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Types
// ═════════════════════════════════════════════════════════════════════════

/** A company entry managed in this form */
interface CompanyEntry {
  /** Unique identifier (auto-generated for new entries) */
  id: string;
  name: string;
  country: string;
  currency: string;
  timezone: string;
}

/** Form state for the multi-company editor */
interface EmpresaFormState {
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

type EmpresaFormAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS" }
  | { type: "LOAD_ERROR"; error: string }
  | { type: "SAVE_START" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_ERROR"; error: string }
  | { type: "MARK_DIRTY" }
  | { type: "CLEAR_MESSAGES" };

function formReducer(
  state: EmpresaFormState,
  action: EmpresaFormAction,
): EmpresaFormState {
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
      return {
        ...state,
        saving: false,
        success: "Configuración guardada correctamente.",
        dirty: false,
      };
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

const INITIAL_STATE: EmpresaFormState = {
  loading: false,
  saving: false,
  error: null,
  success: null,
  dirty: false,
};

// ═════════════════════════════════════════════════════════════════════════
// 2.  Constants
// ═════════════════════════════════════════════════════════════════════════

/** Common country presets */
const COUNTRY_PRESETS = [
  { value: "Colombia", label: "Colombia" },
  { value: "México", label: "México" },
  { value: "Argentina", label: "Argentina" },
  { value: "Chile", label: "Chile" },
  { value: "Perú", label: "Perú" },
  { value: "Ecuador", label: "Ecuador" },
  { value: "Estados Unidos", label: "Estados Unidos" },
  { value: "España", label: "España" },
] as const;

/** Currency presets keyed by country */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  Colombia: "COP",
  México: "MXN",
  Argentina: "ARS",
  Chile: "CLP",
  Perú: "PEN",
  Ecuador: "USD",
  "Estados Unidos": "USD",
  España: "EUR",
};

/** Timezone presets keyed by country */
const TIMEZONE_BY_COUNTRY: Record<string, string> = {
  Colombia: "America/Bogota",
  México: "America/Mexico_City",
  Argentina: "America/Argentina/Buenos_Aires",
  Chile: "America/Santiago",
  Perú: "America/Lima",
  Ecuador: "America/Guayaquil",
  "Estados Unidos": "America/New_York",
  España: "Europe/Madrid",
};

// ═════════════════════════════════════════════════════════════════════════
// 3.  Sub-components
// ═════════════════════════════════════════════════════════════════════════

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
    <div className="space-y-6 animate-pulse" aria-label="Cargando empresas">
      {[1, 2].map((card) => (
        <div key={card} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 h-5 w-48 rounded bg-gray-200" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="h-10 rounded-lg bg-gray-200" />
            <div className="h-10 rounded-lg bg-gray-200" />
            <div className="h-10 rounded-lg bg-gray-200" />
            <div className="h-10 rounded-lg bg-gray-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Empty state ───────────────────────────────────────────────────── */

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <svg
        className="mb-4 h-12 w-12 text-gray-400"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
        />
      </svg>
      <h3 className="text-base font-semibold text-gray-900">
        No hay empresas configuradas
      </h3>
      <p className="mt-1 text-sm text-gray-500">
        Agrega una empresa para comenzar a configurar el agente financiero.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="btn-primary mt-6"
      >
        + Agregar Empresa
      </button>
    </div>
  );
}

/* ─── Company card ──────────────────────────────────────────────────── */

interface CompanyCardProps {
  company: CompanyEntry;
  index: number;
  errors: Partial<Record<string, string>>;
  onChange: (id: string, field: keyof CompanyEntry, value: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  isFirst: boolean;
  isLast: boolean;
  disabled?: boolean;
}

function CompanyCard({
  company,
  index,
  errors,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  disabled = false,
}: CompanyCardProps) {
  const cardId = useId();
  const nameErrorId = useId();

  const handleCountryChange = useCallback(
    (value: string) => {
      onChange(company.id, "country", value);
      // Auto-fill currency and timezone based on country preset
      const currency = CURRENCY_BY_COUNTRY[value];
      if (currency) {
        onChange(company.id, "currency", currency);
      }
      const timezone = TIMEZONE_BY_COUNTRY[value];
      if (timezone) {
        onChange(company.id, "timezone", timezone);
      }
    },
    [company.id, onChange],
  );

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      role="group"
      aria-labelledby={`${cardId}-title`}
    >
      {/* Card header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Reorder buttons */}
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              disabled={isFirst || disabled}
              onClick={() => onMoveUp(index)}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label={`Mover ${company.name || "empresa"} hacia arriba`}
            >
              <svg className="h-3 w-3" viewBox="0 0 10 6" fill="currentColor" aria-hidden="true">
                <path d="M5 0L10 6H0z" />
              </svg>
            </button>
            <button
              type="button"
              disabled={isLast || disabled}
              onClick={() => onMoveDown(index)}
              className="inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label={`Mover ${company.name || "empresa"} hacia abajo`}
            >
              <svg className="h-3 w-3" viewBox="0 0 10 6" fill="currentColor" aria-hidden="true">
                <path d="M5 6L0 0h10z" />
              </svg>
            </button>
          </div>

          <h3
            id={`${cardId}-title`}
            className="text-base font-semibold text-gray-900"
          >
            {company.name || `Empresa #${index + 1}`}
          </h3>

          {company.name && (
            <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
              #{index + 1}
            </span>
          )}
        </div>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onRemove(company.id)}
          className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Eliminar ${company.name || "empresa"}`}
        >
          <svg
            className="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
          Eliminar
        </button>
      </div>

      {/* Card fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Name */}
        <div className="space-y-1.5">
          <label htmlFor={`${cardId}-name`} className="label">
            Nombre de la empresa <span className="text-red-500">*</span>
          </label>
          <input
            id={`${cardId}-name`}
            type="text"
            value={company.name}
            onChange={(e) => onChange(company.id, "name", e.target.value)}
            disabled={disabled}
            placeholder="Ej: Comercializadora ABC S.A.S."
            className="input"
            aria-invalid={!!errors[`${company.id}.name`]}
            aria-describedby={errors[`${company.id}.name`] ? nameErrorId : undefined}
          />
          {errors[`${company.id}.name`] && (
            <p id={nameErrorId} className="text-sm text-red-600" role="alert">
              {errors[`${company.id}.name`]}
            </p>
          )}
        </div>

        {/* Country */}
        <div className="space-y-1.5">
          <label htmlFor={`${cardId}-country`} className="label">
            País <span className="text-red-500">*</span>
          </label>
          <select
            id={`${cardId}-country`}
            value={company.country}
            onChange={(e) => handleCountryChange(e.target.value)}
            disabled={disabled}
            className="input"
          >
            <option value="">Seleccionar país...</option>
            {COUNTRY_PRESETS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
            <option value="__other__">Otro...</option>
          </select>
          {company.country === "__other__" && (
            <input
              type="text"
              value={company.country === "__other__" ? "" : company.country}
              onChange={(e) => onChange(company.id, "country", e.target.value)}
              placeholder="Escribe el país"
              className="input mt-2"
              disabled={disabled}
            />
          )}
        </div>

        {/* Currency */}
        <div className="space-y-1.5">
          <label htmlFor={`${cardId}-currency`} className="label">
            Moneda <span className="text-red-500">*</span>
          </label>
          <input
            id={`${cardId}-currency`}
            type="text"
            value={company.currency}
            onChange={(e) => onChange(company.id, "currency", e.target.value)}
            disabled={disabled}
            placeholder="Ej: COP"
            className="input"
          />
        </div>

        {/* Timezone */}
        <div className="space-y-1.5">
          <label htmlFor={`${cardId}-timezone`} className="label">
            Zona horaria <span className="text-red-500">*</span>
          </label>
          <input
            id={`${cardId}-timezone`}
            type="text"
            value={company.timezone}
            onChange={(e) => onChange(company.id, "timezone", e.target.value)}
            disabled={disabled}
            placeholder="Ej: America/Bogota"
            className="input"
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Confirm dialog (inline) ───────────────────────────────────────── */

function ConfirmDialog({
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
  variant = "danger",
}: {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: "danger" | "warning";
}) {
  const dialogId = useId();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogId}
    >
      <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <p id={dialogId} className="text-sm text-gray-700">
          {message}
        </p>
        <div className="mt-4 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn-secondary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              variant === "danger" ? "btn-danger" : "btn-primary"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// 4.  Main EmpresaConfigForm component
// ═════════════════════════════════════════════════════════════════════════

/**
 * EmpresaConfigForm — multi-company configuration form.
 *
 * Features:
 * - View all configured companies in a list
 * - Add new companies with name, country, currency, timezone
 * - Edit existing companies inline
 * - Remove companies with confirmation
 * - Reorder companies via move up/down buttons
 * - Country presets auto-fill currency and timezone
 * - Validation before save
 * - Loading skeleton while fetching config
 * - Error and success banners
 * - Dirty state tracking
 */
export function EmpresaConfigForm() {
  /* ── State ───────────────────────────────────────────────────────── */
  const [companies, setCompanies] = useState<CompanyEntry[]>([]);
  const [state, dispatch] = useReducer(formReducer, INITIAL_STATE);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextIdRef = useRef(1);

  /* ── Load existing config on mount ────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      dispatch({ type: "LOAD_START" });

      const result = await getConfig();

      if (cancelled) return;

      if (result.ok) {
        const config = result.data.data;
        // If there's a company configured, use it as the first entry
        const initialCompanies: CompanyEntry[] = [];

        if (config.company.name) {
          initialCompanies.push({
            id: `company-${nextIdRef.current++}`,
            name: config.company.name,
            country: config.company.country,
            currency: config.company.currency,
            timezone: config.company.timezone,
          });
        }

        setCompanies(initialCompanies);
        dispatch({ type: "LOAD_SUCCESS" });
      } else {
        // If loading fails, start with an empty list
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

  /* ── Company CRUD operations ─────────────────────────────────────── */

  const addCompany = useCallback(() => {
    const newCompany: CompanyEntry = {
      id: `company-${nextIdRef.current++}`,
      name: "",
      country: "Colombia",
      currency: "COP",
      timezone: "America/Bogota",
    };
    setCompanies((prev) => [...prev, newCompany]);
    dispatch({ type: "MARK_DIRTY" });
  }, []);

  const updateCompany = useCallback(
    (id: string, field: keyof CompanyEntry, value: string) => {
      setCompanies((prev) =>
        prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)),
      );
      dispatch({ type: "MARK_DIRTY" });
      // Clear validation error for this field
      setValidationErrors((prev) => {
        const key = `${id}.${field}`;
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

  const requestRemove = useCallback((id: string) => {
    setRemoveTarget(id);
  }, []);

  const confirmRemove = useCallback(() => {
    if (removeTarget) {
      setCompanies((prev) => prev.filter((c) => c.id !== removeTarget));
      setRemoveTarget(null);
      dispatch({ type: "MARK_DIRTY" });
    }
  }, [removeTarget]);

  const cancelRemove = useCallback(() => {
    setRemoveTarget(null);
  }, []);

  const moveCompany = useCallback(
    (index: number, direction: "up" | "down") => {
      setCompanies((prev) => {
        const next = [...prev];
        const targetIndex = direction === "up" ? index - 1 : index + 1;

        if (targetIndex < 0 || targetIndex >= next.length) return prev;

        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        return next;
      });
      dispatch({ type: "MARK_DIRTY" });
    },
    [],
  );

  /* ── Validation ──────────────────────────────────────────────────── */

  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    if (companies.length === 0) {
      // No companies is valid — the agent will use defaults
      setValidationErrors({});
      return true;
    }

    for (const company of companies) {
      if (!company.name.trim()) {
        errors[`${company.id}.name`] = "El nombre de la empresa es requerido.";
      }
      if (!company.country.trim() || company.country === "__other__") {
        errors[`${company.id}.country`] = "El país es requerido.";
      }
      if (!company.currency.trim()) {
        errors[`${company.id}.currency`] = "La moneda es requerida.";
      }
      if (!company.timezone.trim()) {
        errors[`${company.id}.timezone`] = "La zona horaria es requerida.";
      }
    }

    // Check for duplicate names
    const names = companies.map((c) => c.name.trim().toLowerCase());
    const duplicates = names.filter(
      (name, i) => name && names.indexOf(name) !== i,
    );
    if (duplicates.length > 0) {
      for (const company of companies) {
        if (
          duplicates.includes(company.name.trim().toLowerCase()) &&
          !errors[`${company.id}.name`]
        ) {
          errors[`${company.id}.name`] =
            "Ya existe otra empresa con este nombre.";
        }
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [companies]);

  /* ── Submit handler ──────────────────────────────────────────────── */

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (!validate()) {
        // Focus the first error field
        const firstErrorKey = Object.keys(validationErrors)[0];
        if (firstErrorKey && formRef.current) {
          const fieldId = firstErrorKey.replace(".", "-");
          const firstErrorEl =
            formRef.current.querySelector<HTMLElement>(`[id$="${fieldId}"]`);
          firstErrorEl?.focus();
        }
        return;
      }

      dispatch({ type: "SAVE_START" });

      // Use the first company as the primary company config
      // In a real multi-company setup, the backend would accept an array
      const primaryCompany = companies[0];

      const configPayload: Partial<CompanyConfig> = {
        company: primaryCompany
          ? {
              name: primaryCompany.name.trim(),
              country: primaryCompany.country.trim(),
              currency: primaryCompany.currency.trim(),
              timezone: primaryCompany.timezone,
            }
          : {
              name: "",
              country: "Colombia",
              currency: "COP",
              timezone: "America/Bogota",
            },
      };

      const result = await updateConfig(configPayload);

      if (result.ok) {
        dispatch({ type: "SAVE_SUCCESS" });
      } else {
        dispatch({
          type: "SAVE_ERROR",
          error:
            result.error.message || "Error al guardar la configuración.",
        });
      }
    },
    [companies, validate, validationErrors],
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
    <>
      {/* ── Remove confirmation dialog ──────────────────────────────── */}
      {removeTarget && (
        <ConfirmDialog
          message={`¿Estás seguro de que deseas eliminar esta empresa? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          cancelLabel="Cancelar"
          onConfirm={confirmRemove}
          onCancel={cancelRemove}
          variant="danger"
        />
      )}

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        noValidate
        className="space-y-8"
      >
        {/* ── Alert messages ────────────────────────────────────────── */}
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

        {/* ── Company list ──────────────────────────────────────────── */}
        {companies.length === 0 ? (
          <EmptyState onAdd={addCompany} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {companies.length}{" "}
                {companies.length === 1 ? "empresa configurada" : "empresas configuradas"}
              </p>
              <button
                type="button"
                onClick={addCompany}
                className="btn-secondary"
                disabled={state.saving}
              >
                + Agregar Empresa
              </button>
            </div>

            <div className="space-y-4" role="list" aria-label="Lista de empresas">
              {companies.map((company, index) => (
                <div key={company.id} role="listitem">
                  <CompanyCard
                    company={company}
                    index={index}
                    errors={validationErrors}
                    onChange={updateCompany}
                    onRemove={requestRemove}
                    onMoveUp={(i) => moveCompany(i, "up")}
                    onMoveDown={(i) => moveCompany(i, "down")}
                    isFirst={index === 0}
                    isLast={index === companies.length - 1}
                    disabled={state.saving}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Save / Reset buttons ──────────────────────────────────── */}
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
                setCompanies([]);
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
    </>
  );
}
