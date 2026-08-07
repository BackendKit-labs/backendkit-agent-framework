// ─────────────────────────────────────────────────────────────────────────
// Finance Agent — Dashboard Page Tests
// Tests for src/app/page.tsx
// ─────────────────────────────────────────────────────────────────────────

import { render, screen } from "@testing-library/react";
import DashboardPage from "@/app/page";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Mocks — child components are Server Components that we mock to
//     isolate the page-level rendering and avoid data-fetching side effects.
// ═════════════════════════════════════════════════════════════════════════

jest.mock("@/components/dashboard/DashboardMetrics", () => ({
  DashboardMetrics: jest.fn(() => (
    <div data-testid="dashboard-metrics">DashboardMetrics Mock</div>
  )),
}));

jest.mock("@/components/dashboard/HealthStatus", () => ({
  HealthStatus: jest.fn(() => (
    <div data-testid="health-status">HealthStatus Mock</div>
  )),
}));

jest.mock("@/components/dashboard/RecentQueries", () => ({
  RecentQueries: jest.fn(() => (
    <div data-testid="recent-queries">RecentQueries Mock</div>
  )),
}));

// ═════════════════════════════════════════════════════════════════════════
// 2.  Tests
// ═════════════════════════════════════════════════════════════════════════

describe("DashboardPage — src/app/page.tsx", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 2.1  Page structure ──────────────────────

  describe("page structure", () => {
    it("debe renderizar el título principal de la página", () => {
      render(<DashboardPage />);

      expect(
        screen.getByText("Dashboard Financiero"),
      ).toBeInTheDocument();
    });

    it("debe renderizar la descripción de la página", () => {
      render(<DashboardPage />);

      expect(
        screen.getByText(
          "Resumen ejecutivo de métricas financieras, estado del sistema y actividad reciente.",
        ),
      ).toBeInTheDocument();
    });

    it("debe renderizar los tres componentes hijos", () => {
      render(<DashboardPage />);

      expect(screen.getByTestId("dashboard-metrics")).toBeInTheDocument();
      expect(screen.getByTestId("health-status")).toBeInTheDocument();
      expect(screen.getByTestId("recent-queries")).toBeInTheDocument();
    });
  });

  // ── 2.2  Section headings ─────────────────────

  describe("section headings", () => {
    it("debe tener un heading para métricas financieras (sr-only)", () => {
      render(<DashboardPage />);

      const metricsHeading = screen.getByText("Métricas financieras");
      expect(metricsHeading).toBeInTheDocument();
      expect(metricsHeading.className).toContain("sr-only");
    });

    it("debe tener un heading visible para Estado del Sistema", () => {
      render(<DashboardPage />);

      expect(
        screen.getByText("Estado del Sistema"),
      ).toBeInTheDocument();
    });

    it("debe tener un heading visible para Últimas Consultas", () => {
      render(<DashboardPage />);

      expect(
        screen.getByText("Últimas Consultas"),
      ).toBeInTheDocument();
    });
  });

  // ── 2.3  Accessibility ────────────────────────

  describe("accessibility", () => {
    it("debe tener un heading principal h1", () => {
      render(<DashboardPage />);

      const heading = screen.getByText("Dashboard Financiero");
      expect(heading.tagName).toBe("H1");
    });

    it("debe tener aria-labelledby en la sección de métricas", () => {
      render(<DashboardPage />);

      const metricsSection = screen.getByLabelText("Métricas financieras");
      expect(metricsSection).toBeInTheDocument();
    });

    it("debe tener aria-labelledby en la sección de salud", () => {
      render(<DashboardPage />);

      const healthSection = screen.getByLabelText("Estado del Sistema");
      expect(healthSection).toBeInTheDocument();
    });

    it("debe tener aria-labelledby en la sección de consultas", () => {
      render(<DashboardPage />);

      const queriesSection = screen.getByLabelText("Últimas Consultas");
      expect(queriesSection).toBeInTheDocument();
    });

    it("debe usar elementos semánticos header y section", () => {
      const { container } = render(<DashboardPage />);

      const header = container.querySelector("header");
      expect(header).toBeInTheDocument();

      const sections = container.querySelectorAll("section");
      expect(sections.length).toBe(3);
    });
  });

  // ── 2.4  Layout structure ─────────────────────

  describe("layout structure", () => {
    it("debe tener un contenedor principal con flex-col gap-8", () => {
      const { container } = render(<DashboardPage />);

      const rootDiv = container.firstElementChild;
      expect(rootDiv?.className).toContain("flex");
      expect(rootDiv?.className).toContain("flex-col");
      expect(rootDiv?.className).toContain("gap-8");
    });

    it("debe tener un grid de dos columnas para health + queries en lg", () => {
      const { container } = render(<DashboardPage />);

      const gridDiv = container.querySelector(".lg\\:grid-cols-3");
      expect(gridDiv).toBeInTheDocument();
    });

    it("debe tener health-status en la primera columna del grid", () => {
      render(<DashboardPage />);

      const healthSection = screen.getByLabelText("Estado del Sistema");
      expect(healthSection.className).toContain("lg:col-span-1");
    });

    it("debe tener recent-queries en la segunda columna del grid", () => {
      render(<DashboardPage />);

      const queriesSection = screen.getByLabelText("Últimas Consultas");
      expect(queriesSection.className).toContain("lg:col-span-2");
    });
  });

  // ── 2.5  Child component rendering order ──────

  describe("child component rendering order", () => {
    it("debe renderizar DashboardMetrics antes que HealthStatus", () => {
      const { container } = render(<DashboardPage />);

      const metricsSection = screen.getByLabelText("Métricas financieras");
      const healthSection = screen.getByLabelText("Estado del Sistema");

      // The metrics section should appear before the health section in the DOM
      const metricsPos = Array.from(container.querySelectorAll("section")).indexOf(
        metricsSection.closest("section")!,
      );
      const healthPos = Array.from(container.querySelectorAll("section")).indexOf(
        healthSection.closest("section")!,
      );

      expect(metricsPos).toBeLessThan(healthPos);
    });
  });
});
