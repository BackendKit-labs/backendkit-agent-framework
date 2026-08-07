"use client";

import { type ReactNode } from "react";

type TrendDirection = "up" | "down" | "neutral";

interface MetricCardProps {
  /** Metric title (e.g. "Ingresos del Mes") */
  title: string;
  /** Primary value to display (e.g. "$ 12,450,000") */
  value: string | number;
  /** Optional formatted sub-value (e.g. "+15.3% vs mes anterior") */
  trend?: string;
  /** Direction of the trend arrow */
  trendDirection?: TrendDirection;
  /** Optional icon rendered above the value */
  icon?: ReactNode;
  /** Optional loading state — shows a skeleton when true */
  loading?: boolean;
  /** Optional click handler */
  onClick?: () => void;
  /** Additional CSS classes */
  className?: string;
}

const TREND_ICONS: Record<TrendDirection, string> = {
  up: "↑",
  down: "↓",
  neutral: "→",
};

const TREND_COLORS: Record<TrendDirection, string> = {
  up: "text-green-600",
  down: "text-red-600",
  neutral: "text-gray-500",
};

/**
 * MetricCard — a reusable card for displaying a single KPI or metric.
 * Supports loading skeleton, trend indicators, and an optional icon.
 *
 * @example
 * ```tsx
 * <MetricCard
 *   title="Ingresos del Mes"
 *   value="$ 12,450,000"
 *   trend="+15.3%"
 *   trendDirection="up"
 *   icon={<DollarIcon />}
 * />
 * ```
 */
export function MetricCard({
  title,
  value,
  trend,
  trendDirection = "neutral",
  icon,
  loading = false,
  onClick,
  className = "",
}: MetricCardProps) {
  const card = (
    <div
      role="article"
      aria-label={`${title}: ${loading ? "Cargando..." : value}`}
      className={`card flex flex-col gap-2 transition-shadow duration-200 ${
        onClick ? "cursor-pointer hover:shadow-md" : ""
      } ${className}`}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {/* Header row: title + optional icon */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-500">{title}</span>
        {icon && (
          <span className="text-gray-400" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>

      {/* Value */}
      {loading ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-8 w-3/4 animate-pulse rounded-md bg-gray-200" />
          {trend && <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />}
        </div>
      ) : (
        <>
          <span className="text-2xl font-bold tracking-tight text-gray-900">
            {value}
          </span>

          {/* Trend indicator */}
          {trend && (
            <span
              className={`inline-flex items-center gap-1 text-sm font-medium ${TREND_COLORS[trendDirection]}`}
              aria-label={`Tendencia: ${trend}`}
            >
              <span aria-hidden="true">{TREND_ICONS[trendDirection]}</span>
              {trend}
            </span>
          )}
        </>
      )}
    </div>
  );

  return card;
}
