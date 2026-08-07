// ─────────────────────────────────────────────────────────────────────────
// Finance Agent — VaultExplorer Component Tests
// Tests for src/components/VaultExplorer.tsx
// ─────────────────────────────────────────────────────────────────────────

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VaultExplorer, type VaultTreeNode } from "@/components/VaultExplorer";

// ═════════════════════════════════════════════════════════════════════════
// 1.  Test data
// ═════════════════════════════════════════════════════════════════════════

const sampleTree: VaultTreeNode = {
  id: "vault",
  label: "Vault",
  type: "directory",
  children: [
    {
      id: "colombia",
      label: "Colombia",
      type: "directory",
      children: [
        {
          id: "colombia/impuestos",
          label: "Impuestos",
          type: "directory",
          children: [
            {
              id: "colombia/impuestos/retencion-en-la-fuente",
              label: "Retención en la Fuente",
              type: "document",
              meta: {
                extension: "md",
                category: "impuestos",
                country: "colombia",
              },
            },
            {
              id: "colombia/impuestos/iva",
              label: "IVA",
              type: "document",
              meta: {
                extension: "md",
                category: "impuestos",
                country: "colombia",
              },
            },
          ],
        },
        {
          id: "colombia/laboral",
          label: "Laboral",
          type: "directory",
          children: [
            {
              id: "colombia/laboral/cesantias",
              label: "Cesantías",
              type: "document",
              meta: {
                extension: "md",
                category: "laboral",
                country: "colombia",
              },
            },
            {
              id: "colombia/laboral/prima-servicios",
              label: "Prima de Servicios",
              type: "document",
              meta: {
                extension: "md",
                category: "laboral",
                country: "colombia",
              },
            },
          ],
        },
      ],
    },
    {
      id: "normativas",
      label: "Normativas",
      type: "directory",
      children: [
        {
          id: "normativas/dian-regulaciones",
          label: "DIAN Regulaciones",
          type: "document",
          meta: {
            extension: "pdf",
            category: "normativas",
            country: "colombia",
          },
        },
      ],
    },
  ],
};

const emptyTree: VaultTreeNode = {
  id: "vault",
  label: "Vault",
  type: "directory",
  children: [],
};

// ═════════════════════════════════════════════════════════════════════════
// 2.  Tests
// ═════════════════════════════════════════════════════════════════════════

describe("VaultExplorer — src/components/VaultExplorer.tsx", () => {
  // ── 2.1  Basic rendering ──────────────────────

  describe("basic rendering", () => {
    it("debe renderizar el título y descripción", () => {
      render(<VaultExplorer tree={sampleTree} />);

      expect(screen.getByText("Vault")).toBeInTheDocument();
      expect(
        screen.getByText("Base de conocimiento — documentos y normativas"),
      ).toBeInTheDocument();
    });

    it("debe renderizar los directorios raíz", () => {
      render(<VaultExplorer tree={sampleTree} />);

      expect(screen.getByText("Colombia")).toBeInTheDocument();
      expect(screen.getByText("Normativas")).toBeInTheDocument();
    });

    it("debe tener role tree en el contenedor principal", () => {
      render(<VaultExplorer tree={sampleTree} />);

      const tree = screen.getByRole("tree");
      expect(tree).toBeInTheDocument();
    });

    it("debe mostrar el footer con conteo de documentos y carpetas", () => {
      render(<VaultExplorer tree={sampleTree} />);

      // flattenTree includes the root node, so: 5 docs + root(1) + colombia(1) + impuestos(1) + laboral(1) + normativas(1) = 5 carpetas
      const footer = screen.getByText(/5 carpetas/);
      expect(footer).toBeInTheDocument();
      expect(footer.textContent).toContain("5 documentos");
    });
  });

  // ── 2.2  Empty state ──────────────────────────

  describe("empty state", () => {
    it("debe mostrar mensaje cuando el vault está vacío", () => {
      render(<VaultExplorer tree={emptyTree} />);

      expect(screen.getByText("El vault está vacío")).toBeInTheDocument();
    });
  });

  // ── 2.3  Loading state ────────────────────────

  describe("loading state", () => {
    it("debe mostrar spinner y mensaje de carga", () => {
      render(<VaultExplorer tree={sampleTree} loading />);

      expect(screen.getByText("Cargando vault...")).toBeInTheDocument();
    });

    it("debe tener aria-label en loading", () => {
      render(<VaultExplorer tree={sampleTree} loading />);

      expect(
        screen.getByLabelText("Cargando explorador del vault"),
      ).toBeInTheDocument();
    });

    it("debe mostrar skeletons durante la carga", () => {
      const { container } = render(
        <VaultExplorer tree={sampleTree} loading />,
      );

      const skeletons = container.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  // ── 2.4  Error state ──────────────────────────

  describe("error state", () => {
    it("debe mostrar el mensaje de error", () => {
      render(
        <VaultExplorer
          tree={sampleTree}
          error="No se pudo conectar con el servidor"
        />,
      );

      expect(
        screen.getByText("No se pudo conectar con el servidor"),
      ).toBeInTheDocument();
    });

    it("debe tener role alert en el error", () => {
      render(
        <VaultExplorer tree={sampleTree} error="Error de conexión" />,
      );

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
    });

    it("debe mostrar el título de error", () => {
      render(
        <VaultExplorer tree={sampleTree} error="Error" />,
      );

      expect(
        screen.getByText("Error al cargar el vault"),
      ).toBeInTheDocument();
    });
  });

  // ── 2.5  Expand/collapse ──────────────────────

  describe("expand/collapse", () => {
    it("debe expandir un directorio al hacer clic", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      // Colombia starts collapsed (only root is expanded by default)
      expect(screen.queryByText("Impuestos")).not.toBeInTheDocument();

      // Click to expand
      const colombiaBtn = screen.getByLabelText("Carpeta: Colombia");
      await userEvent.click(colombiaBtn);

      // After expanding, children should be visible
      expect(screen.getByText("Impuestos")).toBeInTheDocument();
    });

    it("debe colapsar un directorio al hacer clic de nuevo", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      // Expand first
      const colombiaBtn = screen.getByLabelText("Carpeta: Colombia");
      await userEvent.click(colombiaBtn);
      expect(screen.getByText("Impuestos")).toBeInTheDocument();

      // Click again to collapse
      await userEvent.click(colombiaBtn);

      expect(
        screen.queryByText("Impuestos"),
      ).not.toBeInTheDocument();
    });

    it("debe expandir con Enter", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      const colombiaBtn = screen.getByLabelText("Carpeta: Colombia");

      // Expand with Enter
      fireEvent.keyDown(colombiaBtn, { key: "Enter" });
      expect(screen.getByText("Impuestos")).toBeInTheDocument();
    });

    it("debe expandir con ArrowRight", () => {
      render(<VaultExplorer tree={sampleTree} />);

      const colombiaBtn = screen.getByLabelText("Carpeta: Colombia");

      // Expand with ArrowRight
      fireEvent.keyDown(colombiaBtn, { key: "ArrowRight" });
      expect(screen.getByText("Impuestos")).toBeInTheDocument();
    });

    it("debe colapsar con ArrowLeft", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      // Expand first
      const colombiaBtn = screen.getByLabelText("Carpeta: Colombia");
      await userEvent.click(colombiaBtn);
      expect(screen.getByText("Impuestos")).toBeInTheDocument();

      // Collapse with ArrowLeft
      fireEvent.keyDown(colombiaBtn, { key: "ArrowLeft" });
      expect(screen.queryByText("Impuestos")).not.toBeInTheDocument();
    });
  });

  // ── 2.6  Document selection ───────────────────

  describe("document selection", () => {
    it("debe llamar a onSelectDocument al hacer clic en un documento", async () => {
      const handleSelect = jest.fn();

      render(
        <VaultExplorer
          tree={sampleTree}
          onSelectDocument={handleSelect}
        />,
      );

      // First expand the path to the document
      await userEvent.click(screen.getByLabelText("Carpeta: Colombia"));
      await userEvent.click(screen.getByLabelText("Carpeta: Impuestos"));

      // Click on a document
      const docBtn = screen.getByLabelText("Documento: Retención en la Fuente");
      await userEvent.click(docBtn);

      expect(handleSelect).toHaveBeenCalledTimes(1);
      expect(handleSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "colombia/impuestos/retencion-en-la-fuente",
          label: "Retención en la Fuente",
          type: "document",
        }),
      );
    });

    it("debe seleccionar un documento con Enter", async () => {
      const handleSelect = jest.fn();

      render(
        <VaultExplorer
          tree={sampleTree}
          onSelectDocument={handleSelect}
        />,
      );

      // Expand path
      await userEvent.click(screen.getByLabelText("Carpeta: Colombia"));
      await userEvent.click(screen.getByLabelText("Carpeta: Impuestos"));

      const docBtn = screen.getByLabelText("Documento: Retención en la Fuente");
      fireEvent.keyDown(docBtn, { key: "Enter" });

      expect(handleSelect).toHaveBeenCalledTimes(1);
    });

    it("debe seleccionar un documento con Space", async () => {
      const handleSelect = jest.fn();

      render(
        <VaultExplorer
          tree={sampleTree}
          onSelectDocument={handleSelect}
        />,
      );

      // Expand path
      await userEvent.click(screen.getByLabelText("Carpeta: Colombia"));
      await userEvent.click(screen.getByLabelText("Carpeta: Impuestos"));

      const docBtn = screen.getByLabelText("Documento: Retención en la Fuente");
      fireEvent.keyDown(docBtn, { key: " " });

      expect(handleSelect).toHaveBeenCalledTimes(1);
    });

    it("debe resaltar el documento seleccionado", async () => {
      render(
        <VaultExplorer
          tree={sampleTree}
          selectedDocumentId="colombia/impuestos/retencion-en-la-fuente"
        />,
      );

      // The selected document path should be auto-expanded
      const docBtn = screen.getByLabelText("Documento: Retención en la Fuente");
      expect(docBtn.className).toContain("bg-primary-50");
    });
  });

  // ── 2.7  Search ───────────────────────────────

  describe("search", () => {
    it("debe tener un campo de búsqueda", () => {
      render(<VaultExplorer tree={sampleTree} />);

      expect(
        screen.getByPlaceholderText("Buscar documentos..."),
      ).toBeInTheDocument();
    });

    it("debe resaltar nodos que coinciden con la búsqueda", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      const searchInput = screen.getByPlaceholderText("Buscar documentos...");
      await userEvent.type(searchInput, "IVA");

      const ivaBtn = screen.getByLabelText("Documento: IVA");
      expect(ivaBtn.className).toContain("bg-yellow-50");
    });

    it("debe expandir automáticamente los padres de nodos coincidentes", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      // Initially Colombia is collapsed
      expect(screen.queryByText("Impuestos")).not.toBeInTheDocument();

      // Search for something deep
      const searchInput = screen.getByPlaceholderText("Buscar documentos...");
      await userEvent.type(searchInput, "Cesantías");

      // Colombia and Laboral should be auto-expanded
      expect(screen.getByText("Cesantías")).toBeInTheDocument();
    });

    it("debe mostrar conteo de resultados accesible", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      const searchInput = screen.getByPlaceholderText("Buscar documentos...");
      await userEvent.type(searchInput, "IVA");

      // The sr-only element should announce results
      const resultsAnnouncement = screen.getByText((content) =>
        content.includes("resultados") && content.includes("IVA"),
      );
      expect(resultsAnnouncement).toBeInTheDocument();
    });

    it("debe mostrar conteo de documentos cuando no hay búsqueda", () => {
      render(<VaultExplorer tree={sampleTree} />);

      const docsCount = screen.getByText("5 documentos disponibles");
      expect(docsCount).toBeInTheDocument();
    });
  });

  // ── 2.8  Auto-expand selected document ────────

  describe("auto-expand selected document", () => {
    it("debe expandir automáticamente la ruta del documento seleccionado", () => {
      render(
        <VaultExplorer
          tree={sampleTree}
          selectedDocumentId="colombia/laboral/cesantias"
        />,
      );

      // The path should be expanded
      expect(screen.getByText("Cesantías")).toBeInTheDocument();
      expect(screen.getByText("Laboral")).toBeInTheDocument();
    });
  });

  // ── 2.9  Extension badges ─────────────────────

  describe("extension badges", () => {
    it("debe mostrar la extensión del documento", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      // Expand to reveal documents
      await userEvent.click(screen.getByLabelText("Carpeta: Colombia"));
      await userEvent.click(screen.getByLabelText("Carpeta: Impuestos"));

      expect(screen.getByText(".md")).toBeInTheDocument();
    });

    it("debe mostrar .pdf para documentos PDF", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      // Expand Normativas
      await userEvent.click(screen.getByLabelText("Carpeta: Normativas"));

      expect(screen.getByText(".pdf")).toBeInTheDocument();
    });
  });

  // ── 2.10  Accessibility ───────────────────────

  describe("accessibility", () => {
    it("debe tener treeitem en cada nodo", () => {
      render(<VaultExplorer tree={sampleTree} />);

      const treeitems = screen.getAllByRole("treeitem");
      expect(treeitems.length).toBeGreaterThan(0);
    });

    it("debe tener aria-expanded en directorios", async () => {
      render(<VaultExplorer tree={sampleTree} />);

      // Colombia starts collapsed
      const colombiaItem = screen.getByLabelText("Carpeta: Colombia");
      // The aria-expanded is on the treeitem div, not the button div
      const treeitem = colombiaItem.closest('[role="treeitem"]');
      expect(treeitem).toHaveAttribute("aria-expanded", "false");

      // Expand
      await userEvent.click(colombiaItem);
      expect(treeitem).toHaveAttribute("aria-expanded", "true");
    });

    it("debe tener aria-selected en el documento seleccionado", () => {
      render(
        <VaultExplorer
          tree={sampleTree}
          selectedDocumentId="colombia/impuestos/retencion-en-la-fuente"
        />,
      );

      const docItem = screen.getByLabelText("Documento: Retención en la Fuente");
      const treeitem = docItem.closest('[role="treeitem"]');
      expect(treeitem).toHaveAttribute("aria-selected", "true");
    });

    it("debe tener un nav con aria-label", () => {
      render(<VaultExplorer tree={sampleTree} />);

      const nav = screen.getByLabelText("Explorador del vault");
      expect(nav.tagName).toBe("NAV");
    });

    it("debe tener un campo de búsqueda con label asociado", () => {
      render(<VaultExplorer tree={sampleTree} />);

      const searchInput = screen.getByPlaceholderText("Buscar documentos...");
      expect(searchInput).toHaveAttribute("id");
    });
  });

  // ── 2.11  Custom className ────────────────────

  describe("custom className", () => {
    it("debe aplicar className adicional", () => {
      const { container } = render(
        <VaultExplorer tree={sampleTree} className="custom-class" />,
      );

      const rootEl = container.firstChild as HTMLElement;
      expect(rootEl.className).toContain("custom-class");
    });
  });
});
