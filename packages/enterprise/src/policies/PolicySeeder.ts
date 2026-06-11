import * as fs from 'fs/promises';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PolicyDefinition {
    domain: string;   // subfolder under /politicas/
    slug: string;     // filename (without .md)
    content: string;  // full Markdown content including frontmatter
}

export interface PolicySeederOptions {
    /**
     * When true, overwrites existing policy files.
     * Default: false — existing files are left untouched (preserves company edits).
     */
    overwrite?: boolean;
}

// ── PolicySeeder ──────────────────────────────────────────────────────────────

/**
 * Seeds default business policy notes into the vault under /politicas/.
 *
 * Each policy lives at: {vaultPath}/politicas/{domain}/{slug}.md
 *
 * Policies contain the business rules that were previously hardcoded in agent
 * system prompts (ADR-4). Agents retrieve them at runtime via their search tool,
 * so editing a vault note changes agent behavior without any code deployment.
 *
 * By default, existing policy files are NOT overwritten — the company's edits
 * always take precedence. Pass `overwrite: true` to reset to framework defaults.
 */
export class PolicySeeder {
    constructor(private readonly vaultPath: string) {}

    /**
     * Seeds all default policies. Returns the paths of files actually written.
     * Skips files that already exist unless `overwrite: true`.
     */
    async seed(opts: PolicySeederOptions = {}): Promise<string[]> {
        const written: string[] = [];
        for (const policy of SEED_POLICIES) {
            const dir = path.join(this.vaultPath, 'politicas', policy.domain);
            await fs.mkdir(dir, { recursive: true });
            const file = path.join(dir, `${policy.slug}.md`);
            if (!opts.overwrite) {
                try { await fs.access(file); continue; } catch { /* doesn't exist — write it */ }
            }
            await fs.writeFile(file, policy.content, 'utf-8');
            written.push(file);
        }
        return written;
    }

    /** Returns the absolute path where a policy note will be written. */
    policyPath(domain: string, slug: string): string {
        return path.join(this.vaultPath, 'politicas', domain, `${slug}.md`);
    }
}

// ── Seed policies ─────────────────────────────────────────────────────────────

const SEED_POLICIES: PolicyDefinition[] = [
    {
        domain: 'finanzas',
        slug: 'approval-authority',
        content: `---
title: "Policy: Approval Authority Matrix — Finance"
vigente_desde: "2026-01-01"
aprobada_por: "CFO"
version: 1
tags: ["politica", "finanzas", "aprobacion"]
description: "Expense and payment approval authority thresholds"
---

## Approval Authority Matrix

All expense, payment, and purchase approvals must follow this matrix.
No exceptions without written CFO authorisation.

| Amount | Required Approver |
|--------|-------------------|
| Under $500 | Team lead |
| $500 to $5,000 | Department manager |
| $5,000 to $50,000 | CFO |
| Above $50,000 | Board of directors |

### Rules

- Amounts must not be split across multiple requests to avoid approval thresholds.
- Recurring expenses (contracts, subscriptions) follow the annualised amount.
- Emergency purchases above the team-lead limit require retroactive approval within 24 h.
`,
    },
    {
        domain: 'finanzas',
        slug: 'confidentiality',
        content: `---
title: "Policy: Financial Data Confidentiality"
vigente_desde: "2026-01-01"
aprobada_por: "CFO"
version: 1
tags: ["politica", "finanzas", "confidencialidad"]
description: "What financial data may not be shared externally"
---

## Financial Data Confidentiality

The following information must not be shared in any response that could be forwarded externally:

- Revenue figures (total or by product/segment)
- Gross or net margin data
- Individual or team salary, bonus, or compensation data
- Unpublished financial forecasts or projections
- Customer contract values

### Handling requests for restricted data

1. Decline to provide the specific figure requested.
2. State clearly that the information is confidential.
3. Direct the requester to the appropriate owner (Finance Director or CFO) via official channels.
4. Flag the interaction in the audit log with write_knowledge.
`,
    },
    {
        domain: 'operaciones',
        slug: 'incident-severity',
        content: `---
title: "Policy: Incident Severity Classification — Operations"
vigente_desde: "2026-01-01"
aprobada_por: "Head of Engineering"
version: 1
tags: ["politica", "operaciones", "incidentes", "severidad"]
description: "Incident severity levels, response SLAs, and escalation paths"
---

## Incident Severity Classification

| Level | Criteria | Response SLA | Escalation |
|-------|----------|-------------|------------|
| P1 — Critical | Full outage, all users affected | Immediate — war room within 15 min | Engineering lead + on-call + CTO notified |
| P2 — High | Partial outage or severe degradation | On-call engineer within 15 min | Engineering lead notified |
| P3 — Medium | Non-critical degradation, workaround available | Response within 4 business hours | Ticket assigned to on-call queue |
| P4 — Low | Cosmetic issue, no functional impact | Response next business day | Added to backlog |

### Classification rules

- Default to the higher severity when in doubt.
- A P1 auto-triggers a war-room channel and notified stakeholders list.
- Severity may be downgraded after the initial assessment — never upgraded silently.
- Post-incident review is mandatory for P1 and P2.
`,
    },
    {
        domain: 'ventas',
        slug: 'discount-authority',
        content: `---
title: "Policy: Discount Authority — Sales"
vigente_desde: "2026-01-01"
aprobada_por: "VP Sales"
version: 1
tags: ["politica", "ventas", "descuentos", "precios"]
description: "Who can authorise discounts and under what conditions"
---

## Discount Authority Matrix

| Discount | Authorised By |
|----------|--------------|
| Up to 10% | Account executive (self-authorised) |
| 10% to 20% | Sales manager approval required |
| 20% to 35% | VP Sales approval required |
| Above 35% | CEO approval required |

### Conditions

- Discounts must be justified in the CRM record before applying.
- Volume discounts (annual contracts, multi-seat) follow separate negotiation guidelines — search for "volume pricing policy ventas".
- One-time promotional discounts require VP Sales sign-off regardless of amount.
- Retroactive discounts (applied after invoicing) require Finance approval in addition to Sales authority.
`,
    },
    {
        domain: 'soporte',
        slug: 'escalation-levels',
        content: `---
title: "Policy: Escalation Levels — Customer Support"
vigente_desde: "2026-01-01"
aprobada_por: "Head of Support"
version: 1
tags: ["politica", "soporte", "escalamiento"]
description: "Support tier definitions and escalation criteria"
---

## Escalation Levels

| Tier | Scope | Handled By | Escalate When |
|------|-------|-----------|---------------|
| Tier 1 — Standard | Common product questions, documented FAQs | Support agent using KB | Issue not in KB or unresolved after 2 attempts |
| Tier 2 — Account / Billing | Billing disputes, account changes, refunds | Senior support agent | Dispute > $200 or customer requests manager |
| Tier 3 — Critical | Service outages, data loss, security concerns | Engineering + Support lead | Immediately on identification |

### Rules

- Always attempt Tier 1 resolution first using the knowledge base.
- A Tier 2 escalation must include the ticket history and a summary of steps already taken.
- Tier 3 must be escalated within 5 minutes of identification — do not attempt to resolve first.
- The escalating agent retains ownership of the customer communication throughout.
`,
    },
    {
        domain: 'rrhh',
        slug: 'data-privacy',
        content: `---
title: "Policy: Employee Data Privacy — HR"
vigente_desde: "2026-01-01"
aprobada_por: "HR Director"
version: 1
tags: ["politica", "rrhh", "privacidad", "datos"]
description: "Rules for handling employee personal and confidential data"
---

## Employee Data Privacy

### Data that must never be shared

- Individual salary, bonus, or total compensation figures
- Performance review scores or disciplinary records
- Medical information or disability accommodations
- Whether a named individual is currently employed (confirm only via official channels)
- Personal contact details (home address, personal phone/email)

### Handling data requests

1. Verify the requester's authorisation level before providing any employee data.
2. Salary data may only be shared with the employee themselves, their direct manager, HR Director, or CFO — never in group responses.
3. Employment verification requests (background checks, reference letters) must be routed to the HR Director.
4. Requests that appear to aggregate individual data across employees must be escalated to the HR Director regardless of individual fields.

### Retention

Employee records are retained per local labour law requirements.
Consult the HR Director for data deletion or anonymisation requests.
`,
    },
];
