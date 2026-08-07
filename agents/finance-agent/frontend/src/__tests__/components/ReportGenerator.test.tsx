// ─────────────────────────────────────────────────────────────────────────
// Finance Agent — ReportGenerator Component Tests
// Tests for src/components/ReportGenerator.tsx
// ─────────────────────────────────────────────────────────────────────────

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportGenerator, type ReportTemplate, type ReportGeneratorRequest } from "@/components/ReportGenerator";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Test data
// ═════════════════════════════════════════════════════════════════════════

const sampleTemplates: ReportTemplate[] = [
  {
    id: "balance",
    label: "Balance General",
    description: "Estado de situación financiera",
    category: "Estados Financieros",
  },
  {
    id: "income-statement",
    label: "Estado de Resultados",
    description: "Pérdidas y ganancias del período",
    category: "Estados Financieros",
  },
  {
    id: "cash-flow",
    label: "Flujo de Caja",
    description: "Movimientos de efectivo",
    category: "Estados Financieros",
  },
  {
    id: "tax-summary",
    label: "Resumen Impositivo",
    description: "Situación fiscal",
    category: "Impuestos",
  },
];

// ═════════════════════════════════════════════════════════════════════════
// 2.  Tests
// ═════════════════════════════════════════════════════════════════════════

describe("ReportGenerator — src/components/ReportGenerator.tsx", () => {
  // ── 2.1  Basic rendering ──────────────────────

  describe("basic rendering", () => {
    it("debe renderizar el título y descripción", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      expect(screen.getByText("Generar Reporte")).toBeInTheDocument();
      expect(
        screen.getByText(/Selecciona una plantilla/),
      ).toBeInTheDocument();
    });

    it("debe renderizar todas las plantillas agrupadas por categoría", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      expect(screen.getByText("Balance General")).toBeInTheDocument();
      expect(screen.getByText("Estado de Resultados")).toBeInTheDocument();
      expect(screen.getByText("Flujo de Caja")).toBeInTheDocument();
      expect(screen.getByText("Resumen Impositivo")).toBeInTheDocument();
    });

    it("debe mostrar los encabezados de categoría", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      expect(screen.getByText("ESTADOS FINANCIEROS")).toBeInTheDocument();
      expect(screen.getByText("IMPUESTOS")).toBeInTheDocument();
    });

    it("debe mostrar mensaje cuando no hay plantillas", () => {
      render(
        <ReportGenerator
          templates={[]}
          onGenerate={jest.fn()}
        />,
      );

      expect(
        screen.getByText("No hay plantillas disponibles."),
      ).toBeInTheDocument();
    });
  });

  // ── 2.2  Template selection ───────────────────

  describe("template selection", () => {
    it("debe seleccionar una plantilla al hacer clic", async () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const balanceRadio = screen.getByLabelText("Balance General");
      await userEvent.click(balanceRadio);

      expect(balanceRadio).toBeChecked();
    });

    it("debe mostrar la descripción de la plantilla", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      expect(
        screen.getByText("Estado de situación financiera"),
      ).toBeInTheDocument();
    });

    it("debe usar selectedTemplateId para preseleccionar", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          selectedTemplateId="cash-flow"
          onGenerate={jest.fn()}
        />,
      );

      const cashFlowRadio = screen.getByLabelText("Flujo de Caja");
      expect(cashFlowRadio).toBeChecked();
    });
  });

  // ── 2.3  Period selection ─────────────────────

  describe("period selection", () => {
    it("debe tener un selector de período predefinido", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      expect(screen.getByText("Mes actual")).toBeInTheDocument();
      expect(screen.getByText("Año actual")).toBeInTheDocument();
    });

    it("debe tener un campo de período personalizado", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const customInput = screen.getByLabelText("Período personalizado");
      expect(customInput).toBeInTheDocument();
      expect(customInput).toHaveAttribute("placeholder", "2025-01 o 2025-Q1");
    });

    it("debe actualizar el período al seleccionar un preset", async () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const presetSelect = screen.getByLabelText("Período predefinido");
      fireEvent.change(presetSelect, { target: { value: "2025" } });

      const customInput = screen.getByLabelText("Período personalizado");
      expect(customInput).toHaveValue("2025");
    });

    it("debe limpiar el preset cuando se escribe un período personalizado", async () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      // Select a preset first
      const presetSelect = screen.getByLabelText("Período predefinido");
      fireEvent.change(presetSelect, { target: { value: "2025" } });

      // Then type a custom period
      const customInput = screen.getByLabelText("Período personalizado");
      await userEvent.clear(customInput);
      await userEvent.type(customInput, "2025-03");

      // Preset should be cleared
      expect(presetSelect).toHaveValue("");
    });

    it("debe mostrar advertencia de formato para período inválido", async () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const customInput = screen.getByLabelText("Período personalizado");
      await userEvent.type(customInput, "invalid-period");

      expect(
        screen.getByText(/Formato esperado/),
      ).toBeInTheDocument();
    });
  });

  // ── 2.4  Export formats ───────────────────────

  describe("export formats", () => {
    it("debe mostrar las opciones de formato", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      expect(screen.getByText("Markdown")).toBeInTheDocument();
      expect(screen.getByText("PDF")).toBeInTheDocument();
      expect(screen.getByText("Excel (XLSX)")).toBeInTheDocument();
    });

    it("debe tener PDF seleccionado por defecto", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const pdfCheckbox = screen.getByLabelText("PDF");
      expect(pdfCheckbox).toBeChecked();
    });

    it("debe permitir seleccionar múltiples formatos", async () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const markdownCheckbox = screen.getByLabelText("Markdown");
      await userEvent.click(markdownCheckbox);

      expect(markdownCheckbox).toBeChecked();
      expect(screen.getByLabelText("PDF")).toBeChecked();
    });

    it("debe permitir deseleccionar un formato", async () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const pdfCheckbox = screen.getByLabelText("PDF");
      await userEvent.click(pdfCheckbox);

      expect(pdfCheckbox).not.toBeChecked();
    });

    it("debe mostrar advertencia si no hay formatos seleccionados", async () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const pdfCheckbox = screen.getByLabelText("PDF");
      await userEvent.click(pdfCheckbox);

      expect(
        screen.getByText("Selecciona al menos un formato."),
      ).toBeInTheDocument();
    });
  });

  // ── 2.5  Title field ──────────────────────────

  describe("title field", () => {
    it("debe mostrar el campo de título opcional", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const titleInput = screen.getByLabelText(/Título personalizado/);
      expect(titleInput).toBeInTheDocument();
    });

    it("debe permitir escribir un título personalizado", async () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const titleInput = screen.getByLabelText(/Título personalizado/);
      await userEvent.type(titleInput, "Balance General - Cierre Mensual");

      expect(titleInput).toHaveValue("Balance General - Cierre Mensual");
    });
  });

  // ── 2.6  Submit flow ──────────────────────────

  describe("submit flow", () => {
    it("debe llamar a onGenerate con los datos correctos", async () => {
      const handleGenerate = jest.fn();

      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={handleGenerate}
        />,
      );

      // Select a template
      await userEvent.click(screen.getByLabelText("Balance General"));

      // Set period
      const presetSelect = screen.getByLabelText("Período predefinido");
      fireEvent.change(presetSelect, { target: { value: "2025-01" } });

      // Select formats
      await userEvent.click(screen.getByLabelText("Markdown"));

      // Submit
      const submitBtn = screen.getByText("Generar Reporte");
      fireEvent.click(submitBtn);

      expect(handleGenerate).toHaveBeenCalledTimes(1);

      const request: ReportGeneratorRequest = handleGenerate.mock.calls[0][0];
      expect(request.templateId).toBe("balance");
      expect(request.period).toBe("2025-01");
      expect(request.formats).toContain("pdf");
      expect(request.formats).toContain("markdown");
    });

    it("debe incluir el título opcional en la solicitud", async () => {
      const handleGenerate = jest.fn();

      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={handleGenerate}
        />,
      );

      // Select template
      await userEvent.click(screen.getByLabelText("Balance General"));

      // Set period
      const presetSelect = screen.getByLabelText("Período predefinido");
      fireEvent.change(presetSelect, { target: { value: "2025-01" } });

      // Set title
      const titleInput = screen.getByLabelText(/Título personalizado/);
      await userEvent.type(titleInput, "Mi Reporte");

      // Submit
      const submitBtn = screen.getByText("Generar Reporte");
      fireEvent.click(submitBtn);

      expect(handleGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Mi Reporte" }),
      );
    });

    it("debe estar deshabilitado el botón si no hay template seleccionado", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const submitBtn = screen.getByText("Generar Reporte");
      expect(submitBtn).toBeDisabled();
    });

    it("debe estar deshabilitado el botón si no hay período", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      // Select template but no period
      fireEvent.click(screen.getByLabelText("Balance General"));

      const submitBtn = screen.getByText("Generar Reporte");
      expect(submitBtn).toBeDisabled();
    });

    it("debe estar deshabilitado el botón si no hay formatos", async () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      // Select template
      await userEvent.click(screen.getByLabelText("Balance General"));

      // Set period
      const presetSelect = screen.getByLabelText("Período predefinido");
      fireEvent.change(presetSelect, { target: { value: "2025-01" } });

      // Deselect PDF
      await userEvent.click(screen.getByLabelText("PDF"));

      const submitBtn = screen.getByText("Generar Reporte");
      expect(submitBtn).toBeDisabled();
    });
  });

  // ── 2.7  Generating state ─────────────────────

  describe("generating state", () => {
    it("debe mostrar 'Generando...' cuando isGenerating=true", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
          isGenerating
        />,
      );

      expect(screen.getByText("Generando...")).toBeInTheDocument();
    });

    it("debe deshabilitar controles cuando isGenerating=true", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
          isGenerating
        />,
      );

      // All inputs should be disabled
      const customInput = screen.getByLabelText("Período personalizado");
      expect(customInput).toBeDisabled();

      const presetSelect = screen.getByLabelText("Período predefinido");
      expect(presetSelect).toBeDisabled();

      const titleInput = screen.getByLabelText(/Título personalizado/);
      expect(titleInput).toBeDisabled();
    });

    it("debe tener aria-busy en el botón cuando isGenerating=true", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
          isGenerating
        />,
      );

      const submitBtn = screen.getByText("Generando...");
      expect(submitBtn).toHaveAttribute("aria-busy", "true");
    });
  });

  // ── 2.8  Error display ────────────────────────

  describe("error display", () => {
    it("debe mostrar el mensaje de error", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
          error="Error al generar el reporte"
        />,
      );

      expect(
        screen.getByText("Error al generar el reporte"),
      ).toBeInTheDocument();
    });

    it("debe tener role alert en el mensaje de error", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
          error="Error de conexión"
        />,
      );

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toContain("Error de conexión");
    });

    it("no debe mostrar error cuando error es null", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
          error={null}
        />,
      );

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  // ── 2.9  Accessibility ────────────────────────

  describe("accessibility", () => {
    it("debe tener un form con aria-label", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const form = screen.getByLabelText("Generar reporte financiero");
      expect(form.tagName).toBe("FORM");
    });

    it("debe tener radiogroup para las plantillas", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const radiogroup = screen.getAllByRole("radiogroup")[0];
      expect(radiogroup).toBeInTheDocument();
    });

    it("debe tener fieldset para período", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const periodLegend = screen.getByText("Período");
      expect(periodLegend.tagName).toBe("LEGEND");
    });

    it("debe tener fieldset para formatos de exportación", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      const formatsLegend = screen.getByText("Formatos de exportación");
      expect(formatsLegend.tagName).toBe("LEGEND");
    });

    it("debe tener sr-only labels para inputs sin label visible", () => {
      render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
        />,
      );

      // The period preset and custom inputs have sr-only labels
      expect(
        screen.getByText("Período predefinido"),
      ).toBeInTheDocument();

      expect(
        screen.getByText("Período personalizado (ISO-8601, ej. 2025-01 o 2025-Q1)"),
      ).toBeInTheDocument();
    });
  });

  // ── 2.10  Custom className ────────────────────

  describe("custom className", () => {
    it("debe aplicar className adicional", () => {
      const { container } = render(
        <ReportGenerator
          templates={sampleTemplates}
          onGenerate={jest.fn()}
          className="custom-class"
        />,
      );

      const form = container.querySelector("form");
      expect(form?.className).toContain("custom-class");
    });
  });
});
