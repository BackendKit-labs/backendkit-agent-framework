// ─────────────────────────────────────────────────────────────────────────
// Finance Agent — MetricCard Component Tests
// Tests for src/components/MetricCard.tsx
// ─────────────────────────────────────────────────────────────────────────

import { render, screen, fireEvent } from "@testing-library/react";
import { MetricCard } from "@/components/MetricCard";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Basic rendering
// ═════════════════════════════════════════════════════════════════════════

describe("MetricCard — src/components/MetricCard.tsx", () => {
  it("debe renderizar el título y el valor", () => {
    render(<MetricCard title="Ingresos del Mes" value="$ 12,450,000" />);

    expect(screen.getByText("Ingresos del Mes")).toBeInTheDocument();
    expect(screen.getByText("$ 12,450,000")).toBeInTheDocument();
  });

  it("debe renderizar el valor numérico correctamente", () => {
    render(<MetricCard title="Utilidad Neta" value={2180000} />);

    expect(screen.getByText("2180000")).toBeInTheDocument();
  });

  it("debe tener role article y aria-label descriptivo", () => {
    render(<MetricCard title="Flujo de Caja" value="$ 4,220,000" />);

    const card = screen.getByRole("article");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute(
      "aria-label",
      "Flujo de Caja: $ 4,220,000",
    );
  });

  // ── 1.1  Trend ────────────────────────────────

  describe("trend indicator", () => {
    it("debe mostrar la tendencia cuando se proporciona", () => {
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          trend="+15.3% vs mes anterior"
          trendDirection="up"
        />,
      );

      expect(screen.getByText("+15.3% vs mes anterior")).toBeInTheDocument();
    });

    it("debe mostrar flecha hacia arriba para trendDirection up", () => {
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          trend="+15%"
          trendDirection="up"
        />,
      );

      const trendEl = screen.getByLabelText("Tendencia: +15%");
      expect(trendEl).toBeInTheDocument();
      expect(trendEl.innerHTML).toContain("↑");
    });

    it("debe mostrar flecha hacia abajo para trendDirection down", () => {
      render(
        <MetricCard
          title="Gastos"
          value="$ 5,000"
          trend="+3.2%"
          trendDirection="down"
        />,
      );

      const trendEl = screen.getByLabelText("Tendencia: +3.2%");
      expect(trendEl).toBeInTheDocument();
      expect(trendEl.innerHTML).toContain("↓");
    });

    it("debe mostrar flecha neutra para trendDirection neutral", () => {
      render(
        <MetricCard
          title="Margen"
          value="15%"
          trend="0%"
          trendDirection="neutral"
        />,
      );

      const trendEl = screen.getByLabelText("Tendencia: 0%");
      expect(trendEl).toBeInTheDocument();
      expect(trendEl.innerHTML).toContain("→");
    });

    it("debe usar neutral por defecto cuando no se especifica trendDirection", () => {
      render(
        <MetricCard title="KPI" value="42" trend="estable" />,
      );

      const trendEl = screen.getByLabelText("Tendencia: estable");
      expect(trendEl).toBeInTheDocument();
      expect(trendEl.innerHTML).toContain("→");
    });

    it("debe aplicar color verde para tendencia up", () => {
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          trend="+15%"
          trendDirection="up"
        />,
      );

      const trendEl = screen.getByLabelText("Tendencia: +15%");
      expect(trendEl.className).toContain("text-green-600");
    });

    it("debe aplicar color rojo para tendencia down", () => {
      render(
        <MetricCard
          title="Gastos"
          value="$ 5,000"
          trend="+3.2%"
          trendDirection="down"
        />,
      );

      const trendEl = screen.getByLabelText("Tendencia: +3.2%");
      expect(trendEl.className).toContain("text-red-600");
    });

    it("debe aplicar color gris para tendencia neutral", () => {
      render(
        <MetricCard
          title="Margen"
          value="15%"
          trend="0%"
          trendDirection="neutral"
        />,
      );

      const trendEl = screen.getByLabelText("Tendencia: 0%");
      expect(trendEl.className).toContain("text-gray-500");
    });
  });

  // ── 1.2  Icon ─────────────────────────────────

  describe("icon", () => {
    it("debe renderizar el icono cuando se proporciona", () => {
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          icon={<span data-testid="custom-icon">📈</span>}
        />,
      );

      expect(screen.getByTestId("custom-icon")).toBeInTheDocument();
    });

    it("debe tener aria-hidden en el contenedor del icono", () => {
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          icon={<span>📈</span>}
        />,
      );

      // The icon is wrapped in <span aria-hidden="true"> — the parent span of the emoji
      const iconContainer = screen.getByText("📈").parentElement;
      expect(iconContainer).toHaveAttribute("aria-hidden", "true");
    });

    it("debe renderizar sin icono cuando no se proporciona", () => {
      const { container } = render(
        <MetricCard title="Ingresos" value="$ 10,000" />,
      );

      // No debe haber elementos con aria-hidden="true" (el icon container)
      const ariaHiddenElements = container.querySelectorAll('[aria-hidden="true"]');
      // El único aria-hidden podría ser el del icono si existiera
      // Como no hay icono, no debería haber ninguno
      expect(ariaHiddenElements.length).toBe(0);
    });
  });

  // ── 1.3  Loading state ────────────────────────

  describe("loading state", () => {
    it("debe mostrar skeleton cuando loading=true", () => {
      const { container } = render(
        <MetricCard title="Ingresos" value="$ 10,000" loading />,
      );

      const skeletons = container.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("debe actualizar aria-label cuando loading=true", () => {
      render(<MetricCard title="Flujo de Caja" value="$ 4,220,000" loading />);

      const card = screen.getByRole("article");
      expect(card).toHaveAttribute(
        "aria-label",
        "Flujo de Caja: Cargando...",
      );
    });

    it("debe ocultar el valor cuando loading=true", () => {
      render(<MetricCard title="Ingresos" value="$ 10,000" loading />);

      expect(screen.queryByText("$ 10,000")).not.toBeInTheDocument();
    });

    it("debe mostrar skeleton de trend cuando loading=true y hay trend", () => {
      const { container } = render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          trend="+15%"
          loading
        />,
      );

      // Debe haber al menos 2 skeletons (value + trend)
      const skeletons = container.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── 1.4  Click handler ────────────────────────

  describe("click handler", () => {
    it("debe ejecutar onClick con Enter", () => {
      const handleClick = jest.fn();
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          onClick={handleClick}
        />,
      );

      const card = screen.getByRole("article");
      fireEvent.keyDown(card, { key: "Enter" });
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("debe ejecutar onClick con Space", () => {
      const handleClick = jest.fn();
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          onClick={handleClick}
        />,
      );

      const card = screen.getByRole("article");
      fireEvent.keyDown(card, { key: " " });
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it("debe tener tabIndex=0 cuando onClick está definido", () => {
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          onClick={() => {}}
        />,
      );

      const card = screen.getByRole("article");
      expect(card).toHaveAttribute("tabindex", "0");
    });

    it("debe tener cursor pointer cuando onClick está definido", () => {
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          onClick={() => {}}
        />,
      );

      const card = screen.getByRole("article");
      expect(card.className).toContain("cursor-pointer");
    });

    it("no debe tener tabIndex cuando onClick no está definido", () => {
      render(<MetricCard title="Ingresos" value="$ 10,000" />);

      const card = screen.getByRole("article");
      expect(card).not.toHaveAttribute("tabindex");
    });
  });

  // ── 1.5  Custom className ─────────────────────

  describe("custom className", () => {
    it("debe aplicar className adicional", () => {
      render(
        <MetricCard
          title="Ingresos"
          value="$ 10,000"
          className="custom-class"
        />,
      );

      const card = screen.getByRole("article");
      expect(card.className).toContain("custom-class");
    });

    it("debe mantener las clases por defecto", () => {
      render(<MetricCard title="Ingresos" value="$ 10,000" />);

      const card = screen.getByRole("article");
      expect(card.className).toContain("card");
    });
  });
});
