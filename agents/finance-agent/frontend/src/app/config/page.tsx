import type { Metadata } from "next";
import { ConfigForm } from "@/components/ConfigForm";

/* ─── Metadata ──────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: "Configuración",
  description:
    "Configura el modelo LLM, las herramientas disponibles, los gates y las empresas habilitadas para el agente financiero.",
};

/* ─── Config Page ───────────────────────────────────────────────────── */

/**
 * Config page — full configuration form for the Finance Agent.
 *
 * Sections rendered by ConfigForm:
 * 1. **Empresa** — company name, country, currency, timezone
 * 2. **Modelo LLM** — provider, model, API key, temperature, max tokens
 * 3. **Herramientas** — which native tools are enabled
 * 4. **Empresas habilitadas (Gates)** — which companies the agent can operate on
 *
 * The form loads existing config via GET /api/config on mount and
 * persists changes via PUT /api/config on submit.
 */
export default function ConfigPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Configuración del Agente
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Configura el modelo LLM, las herramientas disponibles, los gates y
          las empresas habilitadas para el agente financiero.
        </p>
      </header>

      {/* ── Config form ─────────────────────────────────────────────── */}
      <section aria-labelledby="config-form-heading">
        <h2 id="config-form-heading" className="sr-only">
          Formulario de configuración
        </h2>
        <ConfigForm />
      </section>
    </div>
  );
}
