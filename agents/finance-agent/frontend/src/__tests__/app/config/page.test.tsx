// ─────────────────────────────────────────────────────────────────────────
// Finance Agent — Config Page Tests
// Tests for src/app/config/page.tsx
// ─────────────────────────────────────────────────────────────────────────

import { render, screen } from "@testing-library/react";
import ConfigPage from "@/app/config/page";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Mocks — ConfigForm is a Client Component that fetches data; we mock
//     it to isolate the page-level rendering and avoid side effects.
// ═════════════════════════════════════════════════════════════════════════

jest.mock("@/components/ConfigForm", () => ({
  ConfigForm: jest.fn(() => (
    <div data-testid="config-form">ConfigForm Mock</div>
  )),
}));

// ═════════════════════════════════════════════════════════════════════════
// 2.  Tests
// ═════════════════════════════════════════════════════════════════════════

describe("ConfigPage — src/app/config/page.tsx", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── 2.1  Page structure ──────────────────────

  describe("page structure", () => {
    it("debe renderizar el título principal de la página", () => {
      render(<ConfigPage />);

      expect(
        screen.getByText("Configuración del Agente"),
      ).toBeInTheDocument();
    });

    it("debe renderizar la descripción de la página", () => {
      render(<ConfigPage />);

      expect(
        screen.getByText(
          "Configura el modelo LLM, las herramientas disponibles, los gates y las empresas habilitadas para el agente financiero.",
        ),
      ).toBeInTheDocument();
    });

    it("debe renderizar el componente ConfigForm", () => {
      render(<ConfigPage />);

      expect(screen.getByTestId("config-form")).toBeInTheDocument();
    });
  });

  // ── 2.2  Section structure ────────────────────

  describe("section structure", () => {
    it("debe tener una sección con aria-labelledby para el formulario", () => {
      render(<ConfigPage />);

      const formSection = screen.getByLabelText(
        "Formulario de configuración",
      );
      expect(formSection).toBeInTheDocument();
    });

    it("debe tener un heading sr-only para la sección del formulario", () => {
      render(<ConfigPage />);

      const srHeading = screen.getByText("Formulario de configuración");
      expect(srHeading).toBeInTheDocument();
      expect(srHeading.className).toContain("sr-only");
    });
  });

  // ── 2.3  Accessibility ────────────────────────

  describe("accessibility", () => {
    it("debe tener un heading principal h1", () => {
      render(<ConfigPage />);

      const heading = screen.getByText("Configuración del Agente");
      expect(heading.tagName).toBe("H1");
    });

    it("debe usar elementos semánticos header y section", () => {
      const { container } = render(<ConfigPage />);

      const header = container.querySelector("header");
      expect(header).toBeInTheDocument();

      const sections = container.querySelectorAll("section");
      expect(sections.length).toBe(1);
    });

    it("debe tener un contenedor principal con flex-col gap-8", () => {
      const { container } = render(<ConfigPage />);

      const rootDiv = container.firstElementChild;
      expect(rootDiv?.className).toContain("flex");
      expect(rootDiv?.className).toContain("flex-col");
      expect(rootDiv?.className).toContain("gap-8");
    });
  });

  // ── 2.4  ConfigForm integration ───────────────

  describe("ConfigForm integration", () => {
    it("debe pasar las props correctas a ConfigForm (ninguna — sin props)", () => {
      const { ConfigForm } = jest.requireMock("@/components/ConfigForm");

      render(<ConfigPage />);

      expect(ConfigForm).toHaveBeenCalledTimes(1);
      // ConfigForm is called without props (empty object from JSX spread)
      const callArgs = ConfigForm.mock.calls[0][0];
      expect(callArgs).toEqual({});
    });

    it("debe renderizar ConfigForm dentro de la sección", () => {
      render(<ConfigPage />);

      const formSection = screen.getByLabelText(
        "Formulario de configuración",
      );
      const configForm = screen.getByTestId("config-form");

      expect(formSection.contains(configForm)).toBe(true);
    });
  });

  // ── 2.5  Page header ──────────────────────────

  describe("page header", () => {
    it("debe tener el título con tracking-tight y text-2xl", () => {
      render(<ConfigPage />);

      const heading = screen.getByText("Configuración del Agente");
      expect(heading.className).toContain("text-2xl");
      expect(heading.className).toContain("tracking-tight");
    });

    it("debe tener la descripción con text-sm y text-gray-500", () => {
      render(<ConfigPage />);

      const description = screen.getByText(
        "Configura el modelo LLM, las herramientas disponibles, los gates y las empresas habilitadas para el agente financiero.",
      );
      expect(description.className).toContain("text-sm");
      expect(description.className).toContain("text-gray-500");
    });
  });
});
