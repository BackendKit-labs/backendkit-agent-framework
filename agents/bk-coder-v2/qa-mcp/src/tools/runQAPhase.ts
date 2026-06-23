import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const runQAPhaseSchema = {
  specPath: z.string().describe('Ruta al specification.md'),
  phaseNumber: z.number().int().min(1).describe('Número de fase a validar'),
  codePaths: z.array(z.string()).min(1).describe('Rutas de archivos a validar'),
  vaultNamespace: z.string().describe('Namespace del vault para consultar expertise de QA'),
  designPath: z.string().optional().describe('Ruta opcional al design.md para validar ADRs'),
};

export const runQAPhaseTool: AgentToolDef<typeof runQAPhaseSchema> = {
  name: 'run_qa_phase',
  description: 'Valida el código de una fase contra los criterios de specification.md y los ADRs de design.md. Genera reporte qa-phaseN.md en projectRoot/.qa/',
  schema: runQAPhaseSchema,
  buildPrompt: (args: any) => {
    const { specPath, phaseNumber, codePaths, vaultNamespace, designPath } = args;

    return `You are a QA engineer validating Phase ${phaseNumber} of a project.

## Instructions
1. Read the specification at: ${specPath}
${designPath ? `2. Read the design document at: ${designPath} (extract ADRs)` : ''}
${designPath ? '3.' : '2.'} Read the code files:
${codePaths.map((p: string) => `   - ${p}`).join('\n')}
${designPath ? '4.' : '3.'} Use QA vault expertise from namespace: ${vaultNamespace}

## Task
1. Extract all validation criteria from the specification relevant to this phase
2. For each criterion, determine if the code PASSES (✅), FAILS (❌), or needs manual review (⚠️)
3. Check ADR compliance (if design.md provided)
4. Generate findings with severity (low/medium/high)
5. Determine verdict: GO (all pass), NO GO (any fail), CONDITIONAL (warnings only)
6. Save learning: learn_pattern and save_knowledge

Return a JSON object:
{
  "verdict": "GO" | "NO GO" | "CONDITIONAL",
  "criteria_results": [
    { "id": "C1", "description": "...", "result": "✅", "evidence": "..." }
  ],
  "adr_compliance": [
    { "adr": "ADR-001", "result": "✅" }
  ],
  "findings": [
    { "severity": "low", "description": "...", "suggestion": "..." }
  ],
  "qa_report_path": ".qa/qa-phase${phaseNumber}.md"
}`;
  },
};
