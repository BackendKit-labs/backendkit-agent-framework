"use client";

import { type ComponentPropsWithoutRef, type ElementType } from "react";

type StatusVariant = "online" | "offline" | "attention";

interface StatusBadgeProps<T extends ElementType = "span"> {
  /** The status variant: online (green), offline (gray), attention (yellow) */
  status: StatusVariant;
  /** Optional label override. Defaults to the capitalized status string. */
  label?: string;
  /** Render as a different HTML element (e.g. "div", "li") */
  as?: T;
  /** Additional CSS classes */
  className?: string;
}

const STATUS_STYLES: Record<
  StatusVariant,
  { dot: string; bg: string; text: string }
> = {
  online: {
    dot: "bg-green-500",
    bg: "bg-green-50",
    text: "text-green-800",
  },
  offline: {
    dot: "bg-gray-400",
    bg: "bg-gray-50",
    text: "text-gray-600",
  },
  attention: {
    dot: "bg-yellow-500",
    bg: "bg-yellow-50",
    text: "text-yellow-800",
  },
};

const DEFAULT_LABELS: Record<StatusVariant, string> = {
  online: "Online",
  offline: "Offline",
  attention: "Atención",
};

/**
 * StatusBadge — displays an Online / Offline / Atención pill with a
 * colored dot. Fully accessible via a `status` role and an `aria-label`.
 *
 * @example
 * ```tsx
 * <StatusBadge status="online" />
 * <StatusBadge status="attention" label="Revisión pendiente" />
 * ```
 */
export function StatusBadge<T extends ElementType = "span">({
  status,
  label,
  as,
  className = "",
}: StatusBadgeProps<T>) {
  const Component = as ?? ("span" as ElementType);
  const styles = STATUS_STYLES[status];
  const displayLabel = label ?? DEFAULT_LABELS[status];

  return (
    <Component
      role="status"
      aria-label={`Estado: ${displayLabel}`}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles.bg} ${styles.text} ${className}`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${styles.dot}`}
        aria-hidden="true"
      />
      {displayLabel}
    </Component>
  );
}
