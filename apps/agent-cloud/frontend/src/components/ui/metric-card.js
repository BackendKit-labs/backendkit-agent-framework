"use strict";
'use client';
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricCard = MetricCard;
const utils_1 = require("@/lib/utils");
function MetricCard({ title, value, icon, description, trend, isLoading = false, className, }) {
    if (isLoading) {
        return (<div className={(0, utils_1.cn)('rounded-lg border border-gray-200 bg-white p-6 shadow-sm', className)}>
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-4 w-24 animate-pulse rounded bg-gray-200"/>
            <div className="h-8 w-16 animate-pulse rounded bg-gray-200"/>
          </div>
          <div className="h-10 w-10 animate-pulse rounded-lg bg-gray-200"/>
        </div>
        {description && (<div className="mt-2 h-3 w-32 animate-pulse rounded bg-gray-200"/>)}
      </div>);
    }
    return (<div className={(0, utils_1.cn)('rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md', className)}>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="text-3xl font-bold text-gray-900">{value}</p>
        </div>
        {icon && (<div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            {icon}
          </div>)}
      </div>
      <div className="mt-2 flex items-center gap-2">
        {trend && (<span className={(0, utils_1.cn)('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', trend.isPositive
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700')}>
            <svg className={(0, utils_1.cn)('h-3 w-3', trend.isPositive ? 'rotate-0' : 'rotate-180')} fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"/>
            </svg>
            {trend.isPositive ? '+' : '-'}
            {Math.abs(trend.value)}%
          </span>)}
        {description && (<p className="text-sm text-gray-500">{description}</p>)}
      </div>
    </div>);
}
//# sourceMappingURL=metric-card.js.map