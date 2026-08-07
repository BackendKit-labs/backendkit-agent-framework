import { MetricCard } from "@/components/MetricCard";

/* ─── Types ─────────────────────────────────────────────────────────── */

interface MetricData {
  title: string;
  value: string;
  trend: string;
  trendDirection: "up" | "down" | "neutral";
  icon: string;
}

/* ─── Mock data (will be replaced by API calls) ─────────────────────── */

const MOCK_METRICS: MetricData[] = [
  {
    title: "Ingresos del Mes",
    value: "$ 12,450,000",
    trend: "+15.3% vs mes anterior",
    trendDirection: "up",
    icon: "📈",
  },
  {
    title: "Gastos Operativos",
    value: "$ 8,230,000",
    trend: "+3.2% vs mes anterior",
    trendDirection: "up",
    icon: "📉",
  },
  {
    title: "Flujo de Caja",
    value: "$ 4,220,000",
    trend: "+8.7% vs mes anterior",
    trendDirection: "up",
    icon: "💰",
  },
  {
    title: "Utilidad Neta",
    value: "$ 2,180,000",
    trend: "+22.1% vs mes anterior",
    trendDirection: "up",
    icon: "🏆",
  },
];

/* ─── Icon component ────────────────────────────────────────────────── */

function MetricIcon({ emoji }: { emoji: string }) {
  return (
    <span className="text-xl" role="img" aria-hidden="true">
      {emoji}
    </span>
  );
}

/* ─── DashboardMetrics ──────────────────────────────────────────────── */

/**
 * DashboardMetrics — renders a responsive grid of MetricCard components.
 *
 * This is a Server Component that fetches metric data. Currently uses
 * mock data; replace with an API call when the backend is ready.
 */
export function DashboardMetrics() {
  const metrics = MOCK_METRICS;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric) => (
        <MetricCard
          key={metric.title}
          title={metric.title}
          value={metric.value}
          trend={metric.trend}
          trendDirection={metric.trendDirection}
          icon={<MetricIcon emoji={metric.icon} />}
        />
      ))}
    </div>
  );
}
