---
name: vuln-report
version: 1.0.0
description: Structured vulnerability reporting and severity triage — CWE-tagged findings, PASS/FAIL/CONDITIONAL verdict, secrets and dependency checks. Complements the builtin OWASP checklist by standardizing the OUTPUT, not the checklist.
triggers:
  - security
  - seguridad
  - owasp
  - vulnerability
  - vulnerabilidad
  - audit
  - auditoria
  - auditoría
  - cwe
  - severity
  - finding
  - hardening
---

## Vulnerability Report — Triage & Format

The builtin OWASP checklist tells you *what* to look for. This skill standardizes *how* you
report it so the gate and the human approver can act deterministically.

### Severity triage (use CVSS-style intuition, not vibes)
| Severity | Criterion |
|----------|-----------|
| critical | Remote code exec, auth bypass, secret leak in repo |
| high     | Injection (SQLi/XSS/cmd), IDOR, broken access control |
| medium   | Missing validation, weak crypto, verbose errors |
| low      | Hardening gaps, missing headers, defense-in-depth |

### Each finding MUST include
`severity` · `CWE-id` · description · `filePath:line` · concrete remediation.
No file/line = not actionable — either locate it or drop it.

### Always check, beyond the code
- **Secrets**: no hardcoded keys/tokens/passwords; scan config and committed `.env`.
- **Dependencies**: flag known-vulnerable packages (`npm audit` / `pip audit` mindset).
- **AuthN/AuthZ**: every endpoint verifies *authorization*, not just authentication (IDOR).

### Verdict discipline (mandatory)
- **PASS** — no critical/high findings, no hardcoded secrets.
- **CONDITIONAL** — only medium/low findings; safe to ship with tracked follow-ups.
- **FAIL** — any critical/high finding, or a leaked secret.

Write the report to `security-review.md` and end with one exact line:
`VERDICT: PASS` | `VERDICT: FAIL` | `VERDICT: CONDITIONAL`.
