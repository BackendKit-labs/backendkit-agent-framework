import type { Metadata } from "next";
import { DashboardMetrics } from "@/components/dashboard/DashboardMetrics";
import { HealthStatus } from "@/components/dashboard/HealthStatus";
import { RecentQueries } from "@/components/dashboard/RecentQueries";

/* ─── Metadata ──────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Panel principal con métricas financieras, estado del sistema y consultas recientes.",
};

/* ─── Dashboard Page ────────────────────────────────────────────────── */

/**
 * Dashboard page — the main landing page of the Finance Agent.
 *
 * Layout:
 * 1. Page header with title and description
 * 2. Metrics grid (4 cards: revenue, expenses, cash, net income)
 * 3. Two-column section: system health + recent queries
 *
 * Each section is a Server Component that fetches its own data.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          Dashboard Financiero
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Resumen ejecutivo de métricas financieras, estado del sistema y
          actividad reciente.
        </p>
      </header>

      {/* ── Metrics grid ────────────────────────────────────────────── */}
      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">
          Métricas financieras
        </h2>
        <DashboardMetrics />
      </section>

      {/* ── Two-column: health + recent queries ─────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section
          aria-labelledby="health-heading"
          className="lg:col-span-1"
        >
          <h2
            id="health-heading"
            className="mb-4 text-lg font-semibold text-gray-900"
          >
            Estado del Sistema
          </h2>
          <HealthStatus />
        </section>

        <section
          aria-labelledby="queries-heading"
          className="lg:col-span-2"
        >
          <h2
            id="queries-heading"
            className="mb-4 text-lg font-semibold text-gray-900"
          >
            Últimas Consultas
          </h2>
          <RecentQueries />
        </section>
      </div>
    </div>
  );
}
