import 'dotenv/config';
import express from 'express';
import {
  getBalanceSheet,
  getIncomeStatement,
  getCashFlow,
  getAgingReport,
  getBudgetVsActual,
  getKpiDashboard,
  getRevenueBreakdown,
  getCostAnalysis,
  getTaxSummary,
  getPayrollSummary,
} from './data';

/**
 * API REST del ERP mock. Simula la API "nativa" que tendría un ERP real
 * (SAP, Contpaqi, Odoo, etc.) — el agente NUNCA habla con esto directamente,
 * siempre a través del adaptador MCP en src/mcp-adapter/server.ts.
 */
export function createErpApiServer(): express.Application {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/financials/balance-sheet', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    res.json(getBalanceSheet(period));
  });

  app.get('/api/financials/income-statement', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    res.json(getIncomeStatement(period));
  });

  app.get('/api/financials/cash-flow', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    res.json(getCashFlow(period));
  });

  app.get('/api/financials/aging-report', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    const type = req.query.type === 'payable' ? 'payable' : 'receivable';
    res.json(getAgingReport(period, type));
  });

  app.get('/api/financials/budget-vs-actual', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    const department = req.query.department ? String(req.query.department) : undefined;
    res.json(getBudgetVsActual(period, department));
  });

  app.get('/api/financials/kpi-dashboard', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    res.json(getKpiDashboard(period));
  });

  app.get('/api/financials/revenue-breakdown', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    const groupBy =
      req.query.groupBy === 'region' || req.query.groupBy === 'channel'
        ? req.query.groupBy
        : 'product';
    res.json(getRevenueBreakdown(period, groupBy));
  });

  app.get('/api/financials/cost-analysis', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    res.json(getCostAnalysis(period));
  });

  app.get('/api/financials/tax-summary', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    const country = String(req.query.country ?? 'CO');
    res.json(getTaxSummary(period, country));
  });

  app.get('/api/payroll/summary', (req, res) => {
    const period = String(req.query.period ?? currentPeriod());
    res.json(getPayrollSummary(period));
  });

  return app;
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

if (require.main === module) {
  const port = parseInt(process.env.ERP_API_PORT || '4100', 10);
  const app = createErpApiServer();
  app.listen(port, () => {
    console.log(`[mock-erp-agent] API REST del ERP escuchando en http://localhost:${port}`);
  });
}
