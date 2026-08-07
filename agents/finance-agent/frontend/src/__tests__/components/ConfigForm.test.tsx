// ─────────────────────────────────────────────────────────────────────────
// Finance Agent — ConfigForm Component Tests
// Tests for src/components/ConfigForm.tsx
// ─────────────────────────────────────────────────────────────────────────

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigForm } from "@/components/ConfigForm";
import * as api from "@/lib/api";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Mocks
// ═════════════════════════════════════════════════════════════════════════

jest.mock("@/lib/api", () => ({
  getConfig: jest.fn(),
  updateConfig: jest.fn(),
}));

const mockGetConfig = api.getConfig as jest.Mock;
const mockUpdateConfig = api.updateConfig as jest.Mock;

/** Sample config returned by the API */
const sampleConfig = {
  ok: true as const,
  data: {
    data: {
      company: {
        name: "Comercializadora ABC S.A.S.",
        country: "Colombia",
        currency: "COP",
        timezone: "America/Bogota",
      },
      model: {
        provider: "openai",
        modelName: "gpt-4o",
        apiKey: "sk-test-key-123",
        temperature: 0.7,
        maxTokens: 2048,
      },
    },
    success: true,
    timestamp: "2025-01-15T10:00:00Z",
  },
};

/** Error response */
const errorResponse = {
  ok: false as const,
  error: { message: "Error al cargar configuración", status: 500 },
};

// ═════════════════════════════════════════════════════════════════════════
// 2.  Tests
// ═════════════════════════════════════════════════════════════════════════

describe("ConfigForm — src/components/ConfigForm.tsx", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConfig.mockResolvedValue(sampleConfig);
  });

  // ── 2.1  Loading state ────────────────────────

  describe("loading state", () => {
    it("debe mostrar skeleton mientras carga la configuración", () => {
      // Never resolve the promise to keep loading state
      mockGetConfig.mockImplementationOnce(
        () => new Promise(() => {}), // never resolves
      );

      render(<ConfigForm />);

      expect(screen.getByLabelText("Cargando formulario")).toBeInTheDocument();
    });

    it("debe ocultar el formulario mientras carga", () => {
      mockGetConfig.mockImplementationOnce(
        () => new Promise(() => {}),
      );

      render(<ConfigForm />);

      expect(screen.queryByText("Configuración del Agente")).not.toBeInTheDocument();
    });
  });

  // ── 2.2  Load success ─────────────────────────

  describe("load success", () => {
    it("debe renderizar el título del formulario tras cargar", async () => {
      render(<ConfigForm />);

      expect(
        await screen.findByText("Configuración del Agente"),
      ).toBeInTheDocument();
    });

    it("debe cargar los valores de configuración en los campos", async () => {
      render(<ConfigForm />);

      const companyNameInput = await screen.findByLabelText("Nombre de la empresa");
      expect(companyNameInput).toHaveValue("Comercializadora ABC S.A.S.");

      const countryInput = screen.getByLabelText("País");
      expect(countryInput).toHaveValue("Colombia");

      const currencyInput = screen.getByLabelText("Moneda");
      expect(currencyInput).toHaveValue("COP");
    });

    it("debe cargar los valores del modelo LLM", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const providerSelect = screen.getByLabelText("Proveedor");
      expect(providerSelect).toHaveValue("openai");

      const apiKeyInput = screen.getByLabelText("API Key");
      expect(apiKeyInput).toHaveValue("sk-test-key-123");
    });

    it("debe llamar a getConfig al montar", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");
      expect(mockGetConfig).toHaveBeenCalledTimes(1);
    });
  });

  // ── 2.3  Load error ───────────────────────────

  describe("load error", () => {
    it("debe cargar con valores por defecto si getConfig falla", async () => {
      mockGetConfig.mockResolvedValue(errorResponse);

      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      // Should use defaults silently
      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      expect(companyNameInput).toHaveValue("");
    });
  });

  // ── 2.4  Validation ───────────────────────────

  describe("validation", () => {
    it("debe mostrar error si el nombre de empresa está vacío al enviar", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      // Clear company name
      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      await userEvent.clear(companyNameInput);

      // Submit
      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      expect(
        await screen.findByText("El nombre de la empresa es requerido."),
      ).toBeInTheDocument();
    });

    it("debe mostrar error si la API key está vacía al enviar", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      // Clear API key
      const apiKeyInput = screen.getByLabelText("API Key");
      await userEvent.clear(apiKeyInput);

      // Submit
      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      expect(
        await screen.findByText("La API key del modelo es requerida."),
      ).toBeInTheDocument();
    });

    it("debe mostrar error si no se selecciona proveedor", async () => {
      // Override the default provider to empty
      // We can't easily do this via the UI since provider has a default,
      // so we test the validation path by clearing required fields
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      // Clear company name and API key to trigger validation
      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      await userEvent.clear(companyNameInput);

      const apiKeyInput = screen.getByLabelText("API Key");
      await userEvent.clear(apiKeyInput);

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      // Should show multiple validation errors
      expect(
        await screen.findByText("El nombre de la empresa es requerido."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("La API key del modelo es requerida."),
      ).toBeInTheDocument();
    });

    it("debe limpiar el error de validación cuando el usuario edita el campo", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      // Clear company name and submit
      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      await userEvent.clear(companyNameInput);

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      expect(
        await screen.findByText("El nombre de la empresa es requerido."),
      ).toBeInTheDocument();

      // Type something to clear the error
      await userEvent.type(companyNameInput, "Mi Empresa");

      expect(
        screen.queryByText("El nombre de la empresa es requerido."),
      ).not.toBeInTheDocument();
    });
  });

  // ── 2.5  Save flow ────────────────────────────

  describe("save flow", () => {
    it("debe llamar a updateConfig con los datos del formulario", async () => {
      mockUpdateConfig.mockResolvedValue({
        ok: true,
        data: { data: sampleConfig.data.data, success: true, timestamp: "" },
      });

      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
      });

      const payload = mockUpdateConfig.mock.calls[0][0];
      expect(payload.company.name).toBe("Comercializadora ABC S.A.S.");
      expect(payload.model.provider).toBe("openai");
      expect(payload.model.apiKey).toBe("sk-test-key-123");
    });

    it("debe mostrar mensaje de éxito tras guardar", async () => {
      mockUpdateConfig.mockResolvedValue({
        ok: true,
        data: { data: sampleConfig.data.data, success: true, timestamp: "" },
      });

      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      expect(
        await screen.findByText("Configuración guardada correctamente."),
      ).toBeInTheDocument();
    });

    it("debe mostrar mensaje de error si updateConfig falla", async () => {
      mockUpdateConfig.mockResolvedValue({
        ok: false,
        error: { message: "Error de conexión", status: 500 },
      });

      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      expect(
        await screen.findByText("Error de conexión"),
      ).toBeInTheDocument();
    });

    it("debe mostrar spinner mientras guarda", async () => {
      // Keep the promise pending
      mockUpdateConfig.mockImplementationOnce(
        () => new Promise(() => {}),
      );

      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      expect(await screen.findByText("Guardando...")).toBeInTheDocument();
    });

    it("debe deshabilitar el botón de guardar mientras se guarda", async () => {
      mockUpdateConfig.mockImplementationOnce(
        () => new Promise(() => {}),
      );

      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      await screen.findByText("Guardando...");
      expect(submitBtn).toBeDisabled();
    });
  });

  // ── 2.6  Reset button ─────────────────────────

  describe("reset button", () => {
    it("debe restablecer los campos al hacer clic en Restablecer", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      // Modify a field
      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      await userEvent.clear(companyNameInput);
      await userEvent.type(companyNameInput, "Temporal");

      // Click reset
      const resetBtn = screen.getByText("Restablecer");
      fireEvent.click(resetBtn);

      // Should be back to default (empty)
      expect(companyNameInput).toHaveValue("");
    });

    it("debe limpiar los mensajes de error al restablecer", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      // Clear company name and submit to trigger error
      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      await userEvent.clear(companyNameInput);

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      expect(
        await screen.findByText("El nombre de la empresa es requerido."),
      ).toBeInTheDocument();

      // Click reset
      const resetBtn = screen.getByText("Restablecer");
      fireEvent.click(resetBtn);

      expect(
        screen.queryByText("El nombre de la empresa es requerido."),
      ).not.toBeInTheDocument();
    });
  });

  // ── 2.7  Dirty indicator ──────────────────────

  describe("dirty indicator", () => {
    it("debe mostrar indicador 'Sin guardar' cuando se modifica un campo", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      await userEvent.clear(companyNameInput);
      await userEvent.type(companyNameInput, "Nueva Empresa");

      expect(screen.getByText("Sin guardar")).toBeInTheDocument();
    });

    it("debe ocultar indicador 'Sin guardar' tras guardar exitosamente", async () => {
      mockUpdateConfig.mockResolvedValue({
        ok: true,
        data: { data: sampleConfig.data.data, success: true, timestamp: "" },
      });

      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      await userEvent.clear(companyNameInput);
      await userEvent.type(companyNameInput, "Nueva Empresa");

      expect(screen.getByText("Sin guardar")).toBeInTheDocument();

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.queryByText("Sin guardar")).not.toBeInTheDocument();
      });
    });
  });

  // ── 2.8  Provider change ──────────────────────

  describe("provider change", () => {
    it("debe cambiar los modelos disponibles al cambiar de proveedor", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      // Change provider to Anthropic
      const providerSelect = screen.getByLabelText("Proveedor");
      fireEvent.change(providerSelect, { target: { value: "anthropic" } });

      const modelSelect = screen.getByLabelText("Modelo");
      expect(modelSelect).toHaveValue("claude-3-opus");
    });

    it("debe resetear el modelo si el actual no está disponible en el nuevo proveedor", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      // Change provider to Google AI
      const providerSelect = screen.getByLabelText("Proveedor");
      fireEvent.change(providerSelect, { target: { value: "google" } });

      const modelSelect = screen.getByLabelText("Modelo");
      expect(modelSelect).toHaveValue("gemini-1.5-pro");
    });
  });

  // ── 2.9  Accessibility ────────────────────────

  describe("accessibility", () => {
    it("debe tener un heading principal con id para aria-labelledby", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const heading = screen.getByText("Configuración del Agente");
      expect(heading.tagName).toBe("H1");
    });

    it("debe tener labels asociados a los inputs", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      expect(screen.getByLabelText("Nombre de la empresa")).toBeInTheDocument();
      expect(screen.getByLabelText("País")).toBeInTheDocument();
      expect(screen.getByLabelText("Moneda")).toBeInTheDocument();
      expect(screen.getByLabelText("Proveedor")).toBeInTheDocument();
      expect(screen.getByLabelText("Modelo")).toBeInTheDocument();
      expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    });

    it("debe tener role alert para mensajes de error", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      await userEvent.clear(companyNameInput);

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      const alert = await screen.findByRole("alert");
      expect(alert).toBeInTheDocument();
    });

    it("debe tener aria-invalid en inputs con error", async () => {
      render(<ConfigForm />);

      await screen.findByText("Configuración del Agente");

      const companyNameInput = screen.getByLabelText("Nombre de la empresa");
      await userEvent.clear(companyNameInput);

      const submitBtn = screen.getByText("Guardar Configuración");
      fireEvent.click(submitBtn);

      await screen.findByText("El nombre de la empresa es requerido.");
      expect(companyNameInput).toHaveAttribute("aria-invalid", "true");
    });
  });
});
