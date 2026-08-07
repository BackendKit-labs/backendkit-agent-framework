import { StatusBadge } from "@/components/StatusBadge";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface HealthItem {
  label: string;
  status: "online" | "offline" | "attention";
  description: string;
}

/* ─── Mock data ─────────────────────────────────────────────────────── */

const MOCK_HEALTH: HealthItem[] = [
  {
    label: "API Gateway",
    status: "online",
    description: "Conectado y respondiendo",
  },
  {
    label: "Motor de Reportes",
    status: "online",
    description: "Disponible",
  },
  {
    label: "Scheduler",
    status: "online",
    description: "Tareas programadas activas",
  },
  {
    label: "Notifier",
    status: "online",
    description: "Canal de notificaciones activo",
  },
  {
    label: "Vault",
    status: "online",
    description: "Documentos disponibles",
  },
  {
    label: "MCP Bridge",
    status: "attention",
    description: "1 servidor externo sin conexión",
  },
];

/* ─── HealthStatus ──────────────────────────────────────────────────── */

/**
 * HealthStatus — displays the status of each system component.
 *
 * This is a Server Component. Replace mock data with an API call to
 * the backend health endpoint when available.
 */
export function HealthStatus() {
  const items = MOCK_HEALTH;

  return (
    <div className="card divide-y divide-gray-100">
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          No hay información de estado disponible.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100" role="list">
          {items.map((item) => (
            <li
              key={item.label}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium text-gray-900">
                  {item.label}
                </span>
                <span className="text-xs text-gray-500">
                  {item.description}
                </span>
              </div>
              <StatusBadge status={item.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
