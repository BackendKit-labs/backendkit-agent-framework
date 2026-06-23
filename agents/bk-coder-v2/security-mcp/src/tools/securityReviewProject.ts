import { z }                from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const securityReviewProjectSchema = {
    projectRoot: z.string().describe('Absolute path to the project root directory'),
};

export const securityReviewProjectTool: AgentToolDef<typeof securityReviewProjectSchema> = {
    name:        'security_review_project',
    description: 'Full OWASP security review of the project. Reads all source files, analyzes for vulnerabilities, writes .security/security-review.md.',
    schema:      securityReviewProjectSchema,
    buildPrompt: (args: any) => {
        const { projectRoot } = args;
        return `You are a security expert conducting an OWASP Top 10 security review.

## Step 1 — Read the codebase
Use list_directory on ${projectRoot}/src to find all source files.
Read each file thoroughly using read_file.
Also read ${projectRoot}/package.json (or go.mod / requirements.txt) for dependency info.

## Step 2 — Analyze for vulnerabilities
Check for OWASP Top 10:
- A01 Broken Access Control: missing auth guards, improper authorization
- A02 Cryptographic Failures: weak algorithms (MD5/SHA1/DES), hardcoded secrets
- A03 Injection: SQL injection, command injection, XSS
- A04 Insecure Design: missing input validation, business logic flaws
- A05 Security Misconfiguration: exposed debug info, default credentials
- A06 Vulnerable Components: outdated dependencies with known CVEs
- A07 Auth Failures: weak passwords, missing rate limiting, insecure sessions
- A08 Data Integrity Failures: unsafe deserialization
- A09 Logging Failures: missing security event logging
- A10 SSRF: unvalidated external requests

For each finding: severity (critical/high/medium/low), CWE, file, line, recommendation.

## Step 3 — Write the report
Use write_file to write to: ${projectRoot}/.security/security-review.md

Report format:
# Security Review

**Fecha:** {date}
**Scope:** ${projectRoot}/src/
**Standard:** OWASP Top 10 (2021)
**Veredicto:** ✅ PASS | ❌ FAIL | ⚠️ CONDITIONAL

## Resumen Ejecutivo
{2-3 sentences}

## Vulnerabilidades
| Severidad | OWASP | CWE | Descripción | Archivo | Línea | Recomendación |
|-----------|-------|-----|-------------|---------|-------|---------------|
...

## Checklist OWASP Top 10
| # | Categoría | Estado | Notas |
...

VERDICT: PASS

## Step 4 — Return verdict as last line
VERDICT: PASS
VERDICT: FAIL
VERDICT: CONDITIONAL`;
    },
};
