import path from 'path';
import express from 'express';
import { createEngine } from '../core/engine';
import { ToolRegistry } from '../core/tool-registry';
import { registerNativeTools } from '../tools';
import { ReportEngine } from '../reports/report-engine';

/**
 * Crea y configura el servidor HTTP MCP.
 * 
 * @param port - Puerto en el que escuchará el servidor (default: 3001)
 * @returns Instancia del servidor Express configurado
 */
export function createMCPServer(port: number = 3001): express.Application {
  const app = express();

  // Middleware para parsear JSON
  app.use(express.json());

  // Servir archivos estáticos del dashboard (public/)
  app.use(express.static(path.join(__dirname, '../../public')));

  // Instanciar el engine y el registry
  const engine = createEngine();
  const registry = new ToolRegistry();

  // Registrar tools nativas
  registerNativeTools((tool) => registry.registerNativeTool(tool));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Endpoint para listar tools disponibles
  app.get('/tools', (_req, res) => {
    const tools = registry.listTools();
    res.json({ tools });
  });

  // Endpoint para ejecutar una tool
  app.post('/tools/:toolName/execute', async (req, res) => {
    try {
      const { toolName } = req.params;
      const input = req.body;

      const result = await registry.executeTool(toolName, input);
      // executeTool() no lanza — devuelve { success: false, error } para tool
      // inexistente o fallo de validación/ejecución. Sin este chequeo, el
      // status HTTP era siempre 200 aunque la tool fallara.
      res.status(result.success ? 200 : 400).json(result);
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Error al ejecutar la tool',
        toolName: req.params.toolName,
      });
    }
  });

  // Endpoint para ejecutar un mensaje (completar con el LLM)
  app.post('/chat', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Mensaje requerido' });
      }

      const response = await engine.complete(message);
      res.json({ response });
    } catch (error: any) {
      res.status(500).json({
        error: error.message || 'Error al procesar el mensaje',
      });
    }
  });

  // ── Reportes ───────────────────────────────────
  const reportEngine = new ReportEngine({
    toolRegistry: registry,
    templateLoader: async (templateName: string) => {
      const fs = await import('fs');
      const templatesDir = path.resolve(__dirname, '../../src/reports/templates');
      const filePath = path.join(templatesDir, `${templateName}.md`);
      return fs.readFileSync(filePath, 'utf-8');
    },
  });

  /** GET /api/reports/templates — lista las plantillas disponibles */
  app.get('/api/reports/templates', (_req, res) => {
    const fs = require('fs');
    const templatesDir = path.resolve(__dirname, '../../src/reports/templates');
    let files: string[];
    try {
      files = fs.readdirSync(templatesDir);
    } catch {
      return res.json({ templates: [] });
    }
    const templates = files
      .filter((f: string) => f.endsWith('.md'))
      .map((f: string) => f.replace(/\.md$/, ''));
    res.json({ templates });
  });

  /** POST /api/reports/generate — genera un reporte */
  app.post('/api/reports/generate', async (req, res) => {
    try {
      const result = await reportEngine.generate(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || 'Error al generar el reporte',
      });
    }
  });

  return app;
}

// Iniciar servidor si se ejecuta directamente
if (require.main === module) {
  const port = parseInt(process.env.PORT || '3001', 10);
  const app = createMCPServer(port);
  app.listen(port, () => {
    console.log(`[MCP HTTP] Servidor escuchando en puerto ${port}`);
  });
}