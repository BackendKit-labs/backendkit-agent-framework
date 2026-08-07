import { z } from 'zod';
import type { ToolRegistry, ToolResult } from '../core/tool-registry';

// ──────────────────────────────────────────────
// Schemas de entrada
// ──────────────────────────────────────────────

/**
 * Formatos de exportación soportados.
 */
export const ExportFormatSchema = z.enum(['markdown', 'pdf', 'xlsx']);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

/**
 * Schema para la solicitud de generación de un reporte.
 */
export const ReportRequestSchema = z.object({
  /** Nombre o identificador del template a usar (ej: "balance", "income-statement") */
  template: z.string().min(1, 'El nombre del template es requerido'),
  /** Período contable (ej: "2026-Q1", "2026-01") */
  period: z.string().min(1, 'El período es requerido'),
  /** Lista de formatos de exportación deseados */
  formats: z.array(ExportFormatSchema).min(1, 'Al menos un formato es requerido'),
  /** Tools adicionales a ejecutar para enriquecer el reporte */
  extraToolNames: z.array(z.string()).default([]),
  /** Título personalizado para el reporte */
  title: z.string().optional(),
  /** Subtítulo o descripción */
  subtitle: z.string().optional(),
});

export type ReportRequest = z.infer<typeof ReportRequestSchema>;

// ──────────────────────────────────────────────
// Tipos de salida
// ──────────────────────────────────────────────

/**
 * Resultado de la recolección de datos de una tool.
 */
export interface CollectedData {
  /** Nombre de la tool ejecutada */
  toolName: string;
  /** Datos devueltos por la tool */
  data: unknown;
  /** Tiempo de ejecución en ms */
  executionTimeMs: number;
  /** Indica si la ejecución fue exitosa */
  success: boolean;
  /** Mensaje de error si falló */
  error?: string;
}

/**
 * Resultado completo de la generación de un reporte.
 */
export interface ReportResult {
  /** Título del reporte */
  title: string;
  /** Período del reporte */
  period: string;
  /** Fecha de generación (ISO 8601) */
  generatedAt: string;
  /** Datos recolectados de cada tool */
  collectedData: CollectedData[];
  /** Contenido en markdown (renderizado) */
  markdown: string;
  /** Map de formato → contenido (base64 para binarios, string para markdown) */
  exports: Partial<Record<ExportFormat, string>>;
  /** Tiempo total de generación en ms */
  totalExecutionTimeMs: number;
  /** Indica si el reporte se generó exitosamente */
  success: boolean;
  /** Mensaje de error general si falló */
  error?: string;
}

// ──────────────────────────────────────────────
// Mapeo template → tools requeridas
// ──────────────────────────────────────────────

/**
 * Mapa que asocia cada template con las tools que debe ejecutar para recolectar datos.
 * Se puede extender registrando templates adicionales.
 */
const TEMPLATE_TOOL_MAP: Record<string, string[]> = {
  'balance': ['get_balance_sheet'],
  'income-statement': ['get_income_statement'],
  'cash-flow': ['get_cash_flow'],
  'aging-report': ['aging-report'],
  'budget-vs-actual': ['get_budget_vs_actual'],
  'kpi-dashboard': ['get_kpi_dashboard'],
  'revenue-breakdown': ['get_revenue_breakdown'],
  'cost-analysis': ['get_cost_analysis'],
  'tax-summary': ['get_tax_summary'],
  'payroll-summary': ['get_payroll_summary'],
};

/**
 * Registra un template personalizado con sus tools asociadas.
 * Útil para templates custom que el cliente agrega en el vault.
 *
 * @param templateName - Nombre del template.
 * @param toolNames - Lista de tools que necesita ejecutar.
 */
export function registerTemplateTools(
  templateName: string,
  toolNames: string[],
): void {
  TEMPLATE_TOOL_MAP[templateName] = toolNames;
}

/**
 * Obtiene la lista de tools requeridas para un template.
 * Si el template no está registrado, retorna un array vacío.
 *
 * @param templateName - Nombre del template.
 * @returns Lista de nombres de tools.
 */
export function getToolsForTemplate(templateName: string): string[] {
  return TEMPLATE_TOOL_MAP[templateName] ?? [];
}

// ──────────────────────────────────────────────
// Motor de renderizado de templates
// ──────────────────────────────────────────────

/**
 * Renderiza un template markdown reemplazando variables con los datos recolectados.
 *
 * Soporta variables en formato `{{variable.path}}` donde `path` puede ser
 * una ruta anidada separada por puntos (ej: `{{data.revenue}}`).
 *
 * @param template - Contenido del template markdown.
 * @param data - Datos recolectados para inyectar.
 * @returns Markdown renderizado.
 */
export function renderTemplate(
  template: string,
  data: CollectedData[],
): string {
  let result = template;

  // Construir un objeto plano con todos los datos recolectados
  const context: Record<string, unknown> = {};
  for (const item of data) {
    if (item.success && item.data !== undefined) {
      context[item.toolName] = item.data;
    }
  }

  // Reemplazar variables {{variable}} o {{variable.path}}
  result = result.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, path: string) => {
    const value = resolvePath(context, path);
    if (value === undefined) {
      return `{{${path}}}`; // dejar sin reemplazar si no existe
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  });

  return result;
}

/**
 * Resuelve una ruta punteada dentro de un objeto.
 * Ej: resolvePath({ a: { b: 42 } }, "a.b") → 42
 */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ──────────────────────────────────────────────
// Motor de exportación
// ──────────────────────────────────────────────

/**
 * Interfaz que deben implementar los exportadores (PDF, XLSX, etc.).
 */
export interface Exporter {
  /** Identificador del formato */
  format: ExportFormat;
  /**
   * Exporta el contenido a un string (base64 para binarios, texto plano para markdown).
   * @param markdown - Contenido markdown del reporte.
   * @param data - Datos recolectados (útil para XLSX que necesita datos tabulares).
   * @returns Contenido exportado como string.
   */
  export(markdown: string, data: CollectedData[]): Promise<string>;
}

/**
 * Exportador por defecto para markdown (solo retorna el markdown tal cual).
 */
class MarkdownExporter implements Exporter {
  readonly format: ExportFormat = 'markdown';

  async export(markdown: string, _data: CollectedData[]): Promise<string> {
    return markdown;
  }
}

/**
 * Registro de exportadores disponibles.
 */
const exporters: Map<ExportFormat, Exporter> = new Map([
  ['markdown', new MarkdownExporter()],
]);

/**
 * Registra un exportador personalizado (ej: PDF, XLSX).
 *
 * @param exporter - Instancia del exportador a registrar.
 */
export function registerExporter(exporter: Exporter): void {
  exporters.set(exporter.format, exporter);
}

/**
 * Obtiene un exportador por formato.
 *
 * @param format - Formato deseado.
 * @returns Instancia del exportador o undefined si no está registrado.
 */
export function getExporter(format: ExportFormat): Exporter | undefined {
  return exporters.get(format);
}

const DEFAULT_TEMPLATE_TOOL_MAP: Record<string, string[]> = { ...TEMPLATE_TOOL_MAP };

/**
 * Restablece el mapa de templates y el registro de exportadores a su estado
 * por defecto. Uso exclusivo en tests: ambos son estado module-level
 * compartido, y `registerTemplateTools`/`registerExporter` no tienen forma
 * de "desregistrar" — sin este reset, un test que registra un template o
 * exportador custom contamina a todos los que corren después en el mismo archivo.
 */
export function resetReportEngineRegistries(): void {
  for (const key of Object.keys(TEMPLATE_TOOL_MAP)) {
    delete TEMPLATE_TOOL_MAP[key];
  }
  Object.assign(TEMPLATE_TOOL_MAP, DEFAULT_TEMPLATE_TOOL_MAP);

  exporters.clear();
  exporters.set('markdown', new MarkdownExporter());
}

// ──────────────────────────────────────────────
// Motor principal de reportes
// ──────────────────────────────────────────────

/**
 * Opciones para la generación de un reporte.
 */
export interface ReportEngineOptions {
  /** Registro de tools para ejecutar las consultas */
  toolRegistry: ToolRegistry;
  /** Función que carga el contenido del template markdown dado su nombre */
  templateLoader: (templateName: string) => Promise<string>;
}

/**
 * Motor de reportes.
 *
 * Orquesta el flujo completo:
 * 1. Recolectar datos ejecutando las tools asociadas al template.
 * 2. Renderizar el template markdown con los datos recolectados.
 * 3. Exportar a los formatos solicitados.
 */
export class ReportEngine {
  private readonly toolRegistry: ToolRegistry;
  private readonly templateLoader: (templateName: string) => Promise<string>;

  constructor(options: ReportEngineOptions) {
    if (!options?.toolRegistry) {
      throw new Error('toolRegistry es requerido para crear un ReportEngine');
    }
    if (!options?.templateLoader) {
      throw new Error('templateLoader es requerido para crear un ReportEngine');
    }
    this.toolRegistry = options.toolRegistry;
    this.templateLoader = options.templateLoader;
  }

  /**
   * Genera un reporte completo.
   *
   * @param request - Solicitud de generación de reporte.
   * @returns Resultado del reporte generado.
   */
  async generate(request: ReportRequest): Promise<ReportResult> {
    const startTime = Date.now();
    const title = request.title ?? `Reporte: ${request.template}`;
    const generatedAt = new Date().toISOString();

    try {
      // 1. Validar la solicitud
      const parsed = ReportRequestSchema.parse(request);

      // 2. Determinar qué tools ejecutar
      const toolNames = [
        ...getToolsForTemplate(parsed.template),
        ...parsed.extraToolNames,
      ];

      if (toolNames.length === 0) {
        return {
          title,
          period: parsed.period,
          generatedAt,
          collectedData: [],
          markdown: '',
          exports: {},
          totalExecutionTimeMs: Date.now() - startTime,
          success: false,
          error: `No hay tools registradas para el template "${parsed.template}". Use registerTemplateTools() para registrarlas.`,
        };
      }

      // 3. Recolectar datos ejecutando cada tool
      const collectedData = await this.collectData(toolNames, parsed.period);

      // 4. Cargar y renderizar el template
      const templateContent = await this.loadTemplate(parsed.template);
      const markdown = renderTemplate(templateContent, collectedData);

      // 5. Exportar a los formatos solicitados
      const exportResults: Partial<Record<ExportFormat, string>> = {};
      for (const format of parsed.formats) {
        const exporter = exporters.get(format);
        if (exporter) {
          try {
            exportResults[format] = await exporter.export(markdown, collectedData);
          } catch (err) {
            const errorMessage =
              err instanceof Error ? err.message : 'Error desconocido';
            exportResults[format] = `Error exporting to ${format}: ${errorMessage}`;
          }
        } else {
          exportResults[format] = `Exportador para "${format}" no está registrado.`;
        }
      }

      return {
        title,
        period: parsed.period,
        generatedAt,
        collectedData,
        markdown,
        exports: exportResults,
        totalExecutionTimeMs: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido al generar el reporte';
      return {
        title,
        period: request.period,
        generatedAt,
        collectedData: [],
        markdown: '',
        exports: {},
        totalExecutionTimeMs: Date.now() - startTime,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Ejecuta todas las tools necesarias para el reporte y recolecta sus resultados.
   */
  private async collectData(
    toolNames: string[],
    period: string,
  ): Promise<CollectedData[]> {
    const results: CollectedData[] = [];

    for (const toolName of toolNames) {
      try {
        const toolResult: ToolResult = await this.toolRegistry.executeTool(toolName, {
          period,
        });

        results.push({
          toolName,
          data: toolResult.data,
          executionTimeMs: toolResult.executionTimeMs,
          success: toolResult.success,
          error: toolResult.error,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        results.push({
          toolName,
          data: undefined,
          executionTimeMs: 0,
          success: false,
          error: errorMessage,
        });
      }
    }

    return results;
  }

  /**
   * Carga el contenido del template markdown.
   * Primero busca en templates custom, luego en templates base.
   */
  private async loadTemplate(templateName: string): Promise<string> {
    try {
      return await this.templateLoader(templateName);
    } catch {
      // Si no se encuentra el template, usar un template por defecto
      return this.getDefaultTemplate(templateName);
    }
  }

  /**
   * Genera un template markdown por defecto para un template dado.
   */
  private getDefaultTemplate(templateName: string): string {
    return [
      `# {{title}}`,
      ``,
      `**Template:** ${templateName}`,
      `**Generado:** {{generatedAt}}`,
      `**Período:** {{period}}`,
      ``,
      `## Datos recolectados`,
      ``,
      `{{#each collectedData}}`,
      `### {{toolName}}`,
      `\`\`\`json`,
      `{{data}}`,
      `\`\`\``,
      `{{/each}}`,
      ``,
      `---`,
      `*Reporte generado automáticamente por Finance Agent*`,
    ].join('\n');
  }
}
