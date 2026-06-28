---
name: spec-compliance
version: 1.0.0
description: Spec-compliance validation discipline — map each spec criterion to code evidence, separate blocking from advisory findings, and emit a deterministic GO/NO_GO/CONDITIONAL verdict. Activated when validating a phase against specification.md.
triggers:
  - validate
  - validacion
  - validación
  - qa
  - spec
  - criteria
  - criterio
  - verdict
  - veredicto
  - compliance
  - review
  - revisar
---

## Spec-Compliance Validation

You validate the implementation **against the specification, not against the code's own logic**.
The author already believes the code is correct — your job is to find where it diverges from
what was specified.

### Method
1. **Enumerate criteria.** List every completion criterion for the phase (from the prompt and
   `.specs/specification.md`). One row per criterion — do not collapse them.
2. **Map criterion → evidence.** For each, point to the exact file/symbol that satisfies it, or
   state plainly that nothing does. No evidence = not met.
3. **Respect the execution result.** If build/tests already failed, that is a hard NO_GO — say so;
   do not rationalize around it.
4. **Separate blocking from advisory.** A missing/incorrect criterion blocks. Style or
   maintainability notes are advisory and never by themselves a NO_GO.

### Finding format
For each issue: `severity` (high/medium/low) · `criterion id` · what's wrong · where (file:line) · suggested fix.

### Verdict discipline (mandatory)
- **GO** — every criterion met, build+tests pass.
- **CONDITIONAL** — criteria met but advisory findings remain; safe to advance with notes.
- **NO_GO** — any criterion unmet, or build/tests failed.

End the report with one exact line: `VERDICT: GO` | `VERDICT: NO_GO` | `VERDICT: CONDITIONAL`.
Never hedge the verdict — the phase-runner parses that line literally.
