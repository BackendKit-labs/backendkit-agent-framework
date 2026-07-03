// ─────────────────────────────────────────────────────────────────────────
// Finance Agent — Frontend Shared Types
// Mirrors the backend tool output shapes so the frontend can consume them
// with full type safety.  Every interface here corresponds 1:1 to a backend
// tool's return type or a domain concept used across the UI.
// ─────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════
// 1.  Period & Date helpers
// ═════════════════════════════════════════════════════════════════════════

/** ISO-8601 period string, e.g. "2025-01" or "2025-Q1" */
export type PeriodString = string;

/** ISO-8601 timestamp */
export type Timestamp = string;

// ═════════════════════════════════════════════════════════════════════════
// 2.  Income Statement  (src/tools/income-statement.ts)
// ═════════════════════════════════════════════════════════════════════════

export interface IncomeStatement {
  revenue: number;
  cogs: number;
  grossMargin: number;
  operatingExpenses: number;
  netIncome: number;
  ebitda: number;
  period: PeriodString;
  _timestamp: Timestamp;
}

// ═════════════════════════════════════════════════════════════════════════
// 3.  Balance Sheet  (src/tools/balance-sheet.ts)
// ═════════════════════════════════════════════════════════════════════════

export interface BalanceRatios {
  liquidity: number;
  solvency: number;
  currentRatio: number;
}

export interface BalanceSheet {
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  ratios: BalanceRatios;
  period: PeriodString;
  _timestamp: Timestamp;
}

// ═════════════════════════════════════════════════════════════════════════
// 4.  Cash Flow  (src/tools/cash-flow.ts)
// ═════════════════════════════════════════════════════════════════════════

export interface CashFlow {
  operating: number;
  investing: number;
  financing: number;
  netVariation: number;
  endingBalance: number;
  period: PeriodString;
  _timestamp: Timestamp;
}

// ═════════════════════════════════════════════════════════════════════════
// 5.  Aging Report  (src/tools/aging-report.ts)
// ═════════════════════════════════════════════════════════════════════════

export interface AgingBucket {
  range: string; // e.g. "0-30", "31-60", "61-90", "91+"
  amount: number;
  count: number;
  percentage: number;
}

export type AgingType = "receivable" | "payable";

export interface AgingReport {
  buckets: AgingBucket[];
  total: number;
  period: PeriodString;
  type: AgingType;
  _timestamp: Timestamp;
}

// ═════════════════════════════════════════════════════════════════════════
// 6.  Budget vs Actual  (src/tools/budget-vs-actual.ts)
// ═════════════════════════════════════════════════════════════════════════

export interface BudgetCategory {
  name: string;
  budget: number;
  actual: number;
  variance: number;
  variancePercentage: number;
}

export interface BudgetVsActual {
  categories: BudgetCategory[];
  totalBudget: number;
  totalActual: number;
  totalVariance: number;
  period: PeriodString;
  _timestamp: Timestamp;
}

// ═════════════════════════════════════════════════════════════════════════
// 7.  KPI Dashboard  (src/tools/kpi-dashboard.ts)
// ═════════════════════════════════════════════════════════════════════════

export type KpiTrend = "up" | "down" | "stable";

export interface KpiItem {
  name: string;
  value: number;
  unit: string;
  trend: KpiTrend;
  previousValue?: number;
  variation?: number;
}

export interface KpiDashboard {
  kpis: KpiItem[];
  period: PeriodString;
  _timestamp: Timestamp;
}

// ═════════════════════════════════════════════════════════════════════════
// 8.  Revenue Breakdown  (src/tools/revenue-breakdown.ts)
// ═════════════════════════════════════════════════════════════════════════

export type RevenueGroupBy = "product" | "region" | "channel";

export interface RevenueCategory {
  category: string;
  amount: number;
}

export interface RevenueBreakdown {
  breakdown: RevenueCategory[];
  total: number;
  period: PeriodString;
  _timestamp: Timestamp;
}

// ═════════════════════════════════════════════════════════════════════════
// 9.  Cost Analysis  (src/tools/cost-analysis.ts)
// ═════════════════════════════════════════════════════════════════════════

export interface CostCategory {
  name: string;
  amount: number;
  budget: number;
  variance: number;
  variancePercentage: number;
}

export interface CostAnalysis {
  categories: CostCategory[];
  totalCost: number;
  totalBudget: number;
  period: PeriodString;
  _timestamp: Timestamp;
}

// ═════════════════════════════════════════════════════════════════════════
// 10. Tax Summary  (src/tools/tax-summary.ts)
// ═════════════════════════════════════════════════════════════════════════

export type TaxStatus = "paid" | "pending" | "accrued";

export interface TaxItem {
  name: string;
  amount: number;
  status: TaxStatus;
  dueDate?: string;
}

export interface TaxSummary {
  taxes: TaxItem[];
  totalAccrued: number;
  totalPaid: number;
  totalPending: number;
  period: PeriodString;
  country: string;
}

// ═════════════════════════════════════════════════════════════════════════
// 11. Payroll Summary  (src/tools/payroll-summary.ts)
// ═════════════════════════════════════════════════════════════════════════

export interface PayrollSummary {
  totalGross: number;
  totalNet: number;
  headcount: number;
  avgSalary: number;
  deductions: number;
  period: PeriodString;
  _timestamp: Timestamp;
}

// ═════════════════════════════════════════════════════════════════════════
// 12. Report Engine  (src/reports/report-engine.ts)
// ═════════════════════════════════════════════════════════════════════════

export type ExportFormat = "markdown" | "pdf" | "xlsx";

export interface ReportRequest {
  template: string;
  period: PeriodString;
  formats: ExportFormat[];
  extraToolNames?: string[];
  title?: string;
  subtitle?: string;
}

export interface CollectedData {
  toolName: string;
  data: unknown;
  executionTimeMs: number;
  success: boolean;
  error?: string;
}

export interface ReportResult {
  title: string;
  period: PeriodString;
  generatedAt: Timestamp;
  collectedData: CollectedData[];
  markdown: string;
  exports: Partial<Record<ExportFormat, string>>;
  totalExecutionTimeMs: number;
  success: boolean;
  error?: string;
}

// ═════════════════════════════════════════════════════════════════════════
// 13. Scheduler  (src/core/scheduler-client.ts)
// ═════════════════════════════════════════════════════════════════════════

export interface ScheduleTaskInput {
  taskName: string;
  schedule: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface ScheduleTaskOutput {
  taskId: string;
  status: string;
}

export interface CancelTaskInput {
  taskId: string;
}

export interface CancelTaskOutput {
  taskId: string;
  status: string;
}

export interface ListTasksInput {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ScheduledTaskItem {
  taskId: string;
  taskName: string;
  schedule: string;
  status: string;
  nextRun?: string;
}

export interface ListTasksOutput {
  tasks: ScheduledTaskItem[];
  total: number;
}

export interface RescheduleInput {
  taskId: string;
  schedule: string;
}

export interface RescheduleOutput {
  taskId: string;
  status: string;
}

export interface GetTaskStatusInput {
  taskId: string;
}

export interface TaskStatus {
  taskId: string;
  taskName: string;
  schedule: string;
  status: string;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
}

// ═════════════════════════════════════════════════════════════════════════
// 14. Notifier  (src/core/notifier-client.ts)
// ═════════════════════════════════════════════════════════════════════════

export type NotificationChannel = "email" | "slack" | "telegram";
export type NotificationPriority = "low" | "normal" | "high";

export interface NotifyUserInput {
  userId: string;
  title: string;
  message: string;
  channel?: NotificationChannel;
  priority?: NotificationPriority;
}

export interface NotifyUserOutput {
  notificationId: string;
  status: string;
  channel: string;
}

export interface NotificationAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface SendNotificationInput {
  to: string[];
  subject: string;
  body: string;
  attachments?: NotificationAttachment[];
  channel?: NotificationChannel;
}

export interface SendNotificationOutput {
  notificationId: string;
  status: string;
  sentTo: string[];
}

export interface GetHistoryInput {
  limit?: number;
  offset?: number;
  status?: string;
}

export interface NotificationHistoryItem {
  notificationId: string;
  title: string;
  status: string;
  channel: string;
  createdAt: string;
}

export interface GetHistoryOutput {
  notifications: NotificationHistoryItem[];
  total: number;
}

// ═════════════════════════════════════════════════════════════════════════
// 15. Company Config  (src/config/schema.ts)
// ═════════════════════════════════════════════════════════════════════════

export interface CompanyInfo {
  name: string;
  country: string;
  currency: string;
  timezone: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "http" | "stdio";
  url?: string;
  command?: string;
  args?: string[];
  apiKey?: string;
}

export interface CompanyConfig {
  company: CompanyInfo;
  vault: { path: string };
  apiGateway: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
  };
  scheduler?: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
  };
  notifier?: {
    baseUrl: string;
    apiKey: string;
    timeoutMs: number;
  };
  model: {
    provider: string;
    modelName: string;
    apiKey: string;
    temperature: number;
    maxTokens: number;
  };
  mcpServers?: McpServerConfig[];
}

// ═════════════════════════════════════════════════════════════════════════
// 16. Vault  (vault/ directory structure)
// ═════════════════════════════════════════════════════════════════════════

export interface VaultDocument {
  /** Relative path within the vault, e.g. "colombia/impuestos/retencion-en-la-fuente.md" */
  path: string;
  /** Human-readable title extracted from the document */
  title: string;
  /** Markdown content */
  content: string;
  /** Category inferred from the directory, e.g. "impuestos", "laboral" */
  category: string;
  /** Country scope, e.g. "colombia" */
  country: string;
  /** Last modified timestamp */
  updatedAt: Timestamp;
}

export interface VaultCategory {
  name: string;
  label: string;
  documentCount: number;
}

// ═════════════════════════════════════════════════════════════════════════
// 17. Generic API response wrappers
// ═════════════════════════════════════════════════════════════════════════

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  error?: string;
  timestamp: Timestamp;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ═════════════════════════════════════════════════════════════════════════
// 18. UI-specific domain types
// ═════════════════════════════════════════════════════════════════════════

/** Status badge variants used across the dashboard */
export type StatusVariant = "online" | "offline" | "attention";

/** Metric card displayed on the dashboard */
export interface Metric {
  label: string;
  value: string | number;
  unit?: string;
  trend?: KpiTrend;
  variation?: number;
  icon?: string;
  color?: "primary" | "success" | "warning" | "danger" | "info";
}

/** Navigation item in the sidebar or top nav */
export interface NavItem {
  label: string;
  href: string;
  icon?: string;
  badge?: string | number;
  children?: NavItem[];
}

/** Select option used in forms and filters */
export interface SelectOption<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Sort direction for data tables */
export type SortDirection = "asc" | "desc";

/** Generic table sort state */
export interface SortState {
  column: string;
  direction: SortDirection;
}

/** Generic table filter */
export interface FilterState {
  column: string;
  value: string | number | boolean | null;
  operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "between";
}
