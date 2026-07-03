import type { NativeToolDefinition } from '../core/tool-registry';
import { getIncomeStatementTool } from './income-statement';
import { getBalanceSheetTool } from './balance-sheet';
import { getCashFlowTool } from './cash-flow';
import { agingReportTool } from './aging-report';
import { budgetVsActualTool } from './budget-vs-actual';
import { kpiDashboardTool } from './kpi-dashboard';
import { revenueBreakdownTool } from './revenue-breakdown';
import { costAnalysisTool } from './cost-analysis';
import { taxSummaryTool } from './tax-summary';
import { getPayrollSummary } from './payroll-summary';

/**
 * Array of all native tool definitions.
 * Uses `any` type parameters to allow heterogeneous tool types in the array.
 * Each tool is still fully typed internally via defineTool().
 */
export const nativeTools: NativeToolDefinition<any, any>[] = [
  getIncomeStatementTool, getBalanceSheetTool, getCashFlowTool,
  agingReportTool, budgetVsActualTool, kpiDashboardTool,
  revenueBreakdownTool, costAnalysisTool, taxSummaryTool, getPayrollSummary,
];

export function registerNativeTools(registerFn: (tool: NativeToolDefinition<any, any>) => void): void {
  for (const tool of nativeTools) { registerFn(tool); }
}