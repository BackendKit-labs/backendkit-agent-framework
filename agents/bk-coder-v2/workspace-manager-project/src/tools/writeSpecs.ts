import { z } from 'zod';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import { WorkspaceManager } from '../WorkspaceManager.js';

export const writeSpecsInputSchema = z.object({
  projectId:     z.string().optional().describe(
    'ID/nombre del proyecto donde escribir .specs/ (opcional: usa el activo). Recomendado pasarlo ' +
    'EXPLÍCITO con múltiples proyectos — bindea por id, inmune a un project_switch concurrente.'),
  specification: z.string().optional().describe('Contenido markdown completo de specification.md (lo que el director especificó con el humano).'),
  design:        z.string().optional().describe(
    'Contenido markdown completo de design.md. DEBE incluir una sección "## Project Structure" que ' +
    'declare el layout: single `src/` para un dominio, o `backend/` + `frontend/` separados para full-stack ' +
    '(nunca UI dentro del árbol backend). Si solo consume una API existente → frontend-only, no scaffoldear backend.'),
  roadmap:       z.string().optional().describe(
    'Contenido markdown completo de ROADMAP.md. Cada fase DEBE declarar una línea "**Domain:** backend|frontend|infra|data" ' +
    '(un solo dominio por fase; si cruza, partila en fases). Eso rutea al especialista correcto de forma determinista. ' +
    'Las "Files to create" deben usar los paths del Project Structure declarado en design.md.'),
});

type WriteSpecsArgs = z.infer<typeof writeSpecsInputSchema>;

/**
 * Writes director-authored design artifacts into <projectRoot>/.specs/.
 *
 * This is the "director authors, coder executes" path: the director (which holds the human's
 * design context + a reasoning model) produces the documents; this tool only persists them to
 * the project bound by `projectId`. The coder's orchestrator_sdd then reads .specs and implements
 * — it does NOT re-generate the design, so decisions can't drift in the coder.
 */
export async function writeSpecsHandler(args: WriteSpecsArgs, wm: WorkspaceManager): Promise<string> {
  const { root, name } = wm.getRoot(args.projectId);   // throws if id given but not found

  const specsDir = path.join(root, '.specs');
  fs.mkdirSync(specsDir, { recursive: true });

  const docs: Array<[string, string | undefined]> = [
    ['specification.md', args.specification],
    ['design.md',        args.design],
    ['ROADMAP.md',       args.roadmap],
  ];

  const written: string[] = [];
  for (const [file, content] of docs) {
    if (typeof content === 'string' && content.trim()) {
      fs.writeFileSync(path.join(specsDir, file), content, 'utf-8');
      written.push(file);
    }
  }

  if (written.length === 0) {
    return JSON.stringify({ error: 'No se proporcionó ningún documento (specification, design o roadmap).' });
  }

  // Soft validation — warn (don't fail) if the ROADMAP doesn't declare a domain per phase.
  const warnings: string[] = [];
  if (typeof args.roadmap === 'string' && args.roadmap.trim()) {
    const phases  = (args.roadmap.match(/^#{2,3}\s+(?:Phase|Fase)\s+\d+/gim) ?? []).length;
    const domains = (args.roadmap.match(/^\s*\*{0,2}\s*domain\s*\*{0,2}\s*:/gim) ?? []).length;
    if (phases > 0 && domains < phases) {
      warnings.push(
        `${phases - domains} de ${phases} fase(s) no declaran "**Domain:**" — esas caerán a la heurística de ruteo. ` +
        `Declará el dominio por fase para ruteo determinista al especialista correcto.`,
      );
    }
  }
  if (typeof args.design === 'string' && args.design.trim() && !/##\s*Project Structure/i.test(args.design)) {
    warnings.push('design.md no tiene sección "## Project Structure" — declará el layout (single src/ o backend/+frontend/) para evitar mezcla de dominios.');
  }

  return JSON.stringify({
    project: name, root, specsDir, written,
    next: 'Ejecutá orchestrator_sdd (con project explícito) para implementar fase por fase.',
    ...(warnings.length ? { warnings } : {}),
  });
}
