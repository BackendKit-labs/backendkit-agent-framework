import type { Metadata } from "next";
import { EmpresaConfigForm } from "./empresa-config-form";

/* ─── Metadata ──────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: "Configuración de Empresas",
  description:
    "Gestiona las empresas del sistema: agrega, edita o elimina empresas para el agente financiero.",
};

/* ─── Empresa Config Page ───────────────────────────────────────────── */

/**
 * Configuración multi-empresa page.
 *
 * Allows the user to:
 * - View a list of configured companies
 * - Add a new company (name, country, currency, timezone)
 * - Edit an existing company
 * - Remove a company
 *
 * The form loads existing config via GET /api/config on mount and
 * persists changes via PUT /api/config on submit.
 */
export default function EmpresaConfigPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Configuración de Empresas
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Administra las empresas del sistema. Puedes agregar nuevas empresas,
          editar sus datos o eliminarlas.
        </p>
      </header>

      {/* ── Company config form ─────────────────────────────────────── */}
      <section aria-labelledby="empresa-form-heading">
        <h2 id="empresa-form-heading" className="sr-only">
          Formulario de empresas
        </h2>
        <EmpresaConfigForm />
      </section>
    </div>
  );
}
