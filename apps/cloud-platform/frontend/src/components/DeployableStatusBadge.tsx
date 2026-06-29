import React from 'react';
import { DeployableStatus } from '@/lib/types';

interface DeployableStatusBadgeProps {
  status: DeployableStatus;
}

const STATUS_STYLES: Record<DeployableStatus, { className: string; label: string }> = {
  running: {
    className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
    label: 'Running',
  },
  starting: {
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
    label: 'Starting',
  },
  pending: {
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    label: 'Pending',
  },
  stopped: {
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    label: 'Stopped',
  },
  error: {
    className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    label: 'Error',
  },
};

export default function DeployableStatusBadge({ status }: DeployableStatusBadgeProps) {
  const baseClasses =
    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
  const variant = STATUS_STYLES[status] ?? {
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    label: status,
  };

  return <span className={`${baseClasses} ${variant.className}`}>{variant.label}</span>;
}
