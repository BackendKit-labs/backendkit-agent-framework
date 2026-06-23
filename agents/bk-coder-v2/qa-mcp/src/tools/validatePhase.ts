import { z }                from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const validatePhaseSchema = {
    projectRoot:  z.string().describe('Absolute path to the project root directory'),
    phaseNumber:  z.number().int().min(1).describe('Phase number to validate'),
    phaseTitle:   z.string().describe('Title of the phase'),
    criteria:     z.array(z.string()).describe('Completion criteria to validate'),
    execReport:   z.string().optional().describe('Build/test execution results from command-runner'),
};

export const validatePhaseTool: AgentToolDef<typeof validatePhaseSchema> = {
    name:        'validate_phase',
    description: 'Validate a phase implementation against specification.md criteria. Uses reasoning to check each criterion against the actual code. Writes qa-phaseN.md report and returns VERDICT.',
    schema:      validatePhaseSchema,
    buildPrompt: (args: any) => {
        const { projectRoot, phaseNumber, phaseTitle, criteria, execReport } = args;
        const specsDir = `${projectRoot}/.specs`;
        const qaDir    = `${projectRoot}/.qa`;

        return `You are an independent QA engineer validating Phase ${phaseNumber}: "${phaseTitle}".
You did NOT write this code. Evaluate it objectively against the specification.

## Step 1 — Read the specification and design
Use read_file to read:
- ${specsDir}/specification.md  (acceptance criteria)
- ${specsDir}/design.md         (ADRs to verify compliance)

## Step 2 — Read the implementation
Use list_directory on ${projectRoot}/src to see all files.
Read each source file thoroughly — you need to verify the actual code, not guess.

${execReport ? `## Execution results (build + tests already ran)\n${execReport}\n` : ''}

## Step 3 — Validate each criterion independently

For each criterion below, determine:
- ✅ PASS: criterion is clearly met with evidence from the code
- ❌ FAIL: criterion is not met or implementation is wrong/missing
- ⚠️ WARNING: criterion is partially met or has minor issues

Criteria to evaluate:
${criteria.map((c: string, i: number) => `${i + 1}. ${c}`).join('\n')}

IMPORTANT rules for QA:
- Base your verdict ONLY on what you can verify from the code (static analysis)
- For "tests pass": verify the test FILE EXISTS and covers the scenario — do NOT mark ❌ just because you can't run them
- For performance criteria: evaluate if the CODE DESIGN is reasonable — do NOT mark ❌ just because you can't benchmark
- Reserve ❌ FAIL for concrete, visible defects: missing files, wrong logic, violated ADRs, absent validation

## Step 4 — Write QA report
Use write_file to write the report to: ${qaDir}/qa-phase${phaseNumber}.md

Report format:
# QA Report — Phase ${phaseNumber}: ${phaseTitle}
**Veredicto:** ✅ GO | ❌ NO GO | ⚠️ CONDITIONAL

## Criterios
| # | Criterio | Resultado | Evidencia |
|---|----------|-----------|-----------|
| 1 | ... | ✅/❌/⚠️ | file:line — explanation |

## Hallazgos
(only if there are issues)

## Conclusión
Brief summary.

VERDICT: GO

## Step 5 — Return verdict
The VERY LAST LINE of your response must be exactly one of:
VERDICT: GO
VERDICT: NO_GO
VERDICT: CONDITIONAL`;
    },
};
