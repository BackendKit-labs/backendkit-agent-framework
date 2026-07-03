/* ─── Types ─────────────────────────────────────────────────────────── */

interface QueryItem {
  id: string;
  query: string;
  tool: string;
  timestamp: string;
  status: "success" | "error" | "running";
}

/* ─── Mock data ─────────────────────────────────────────────────────── */

const MOCK_QUERIES: QueryItem[] = [
  {
    id: "q-001",
    query: "Estado de resultados Q1 2025",
    tool: "income-statement",
    timestamp: "Hace 5 min",
    status: "success",
  },
  {
    id: "q-002",
    query: "Balance general marzo 2025",
    tool: "balance-sheet",
    timestamp: "Hace 12 min",
    status: "success",
  },
  {
    id: "q-003",
    query: "Flujo de caja proyectado",
    tool: "cash-flow",
    timestamp: "Hace 28 min",
    status: "success",
  },
  {
    id: "q-004",
    query: "Antigüedad de cartera >60 días",
    tool: "aging-report",
    timestamp: "Hace 1 hora",
    status: "success",
  },
  {
    id: "q-005",
    query: "Comparativa presupuesto vs real",
    tool: "budget-vs-actual",
    timestamp: "Hace 2 horas",
    status: "error",
  },
  {
    id: "q-006",
    query: "KPIs financieros del mes",
    tool: "kpi-dashboard",
    timestamp: "Hace 3 horas",
    status: "success",
  },
];

/* ─── Helpers ───────────────────────────────────────────────────────── */

const STATUS_BADGE: Record<
  QueryItem["status"],
  { label: string; className: string }
> = {
  success: {
    label: "Completado",
    className: "badge-success",
  },
  error: {
    label: "Error",
    className: "badge-danger",
  },
  running: {
    label: "Ejecutando",
    className: "badge-info",
  },
};

const TOOL_LABELS: Record<string, string> = {
  "income-statement": "Estado de Resultados",
  "balance-sheet": "Balance General",
  "cash-flow": "Flujo de Caja",
  "aging-report": "Antigüedad de Saldos",
  "budget-vs-actual": "Presupuesto vs Real",
  "kpi-dashboard": "KPIs Financieros",
  "revenue-breakdown": "Ingresos",
  "cost-analysis": "Costos",
  "tax-summary": "Impuestos",
  "payroll-summary": "Nómina",
};

function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

/* ─── RecentQueries ─────────────────────────────────────────────────── */

/**
 * RecentQueries — displays a table of the most recent tool queries
 * executed by the Finance Agent.
 *
 * This is a Server Component. Replace mock data with an API call when
 * the backend is ready.
 */
export function RecentQueries() {
  const queries = MOCK_QUERIES;

  return (
    <div className="card overflow-hidden">
      {queries.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">
          No hay consultas recientes.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  Consulta
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  Herramienta
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  Estado
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500"
                >
                  Hora
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {queries.map((query) => {
                const badge = STATUS_BADGE[query.status];
                return (
                  <tr
                    key={query.id}
                    className="transition-colors hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                      {query.query}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600">
                      {getToolLabel(query.tool)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={badge.className}>{badge.label}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                      {query.timestamp}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
