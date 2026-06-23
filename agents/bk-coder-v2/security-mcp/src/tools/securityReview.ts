import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── OWASP Detection Rules ─────────────────────────────────────────────────────

interface Vulnerability {
  severity: 'critical' | 'high' | 'medium' | 'low';
  cwe?: string;
  description: string;
  filePath: string;
  line?: number;
  recommendation: string;
}

interface DetectionRule {
  name: string; description: string; cwe: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  patterns: RegExp[]; excludePatterns?: RegExp[];
  recommendation: string;
}

const DETECTION_RULES: DetectionRule[] = [
  { name:'hardcoded-secrets', description:'Hardcoded password, API key, secret or token found', cwe:'CWE-798', severity:'critical',
    patterns:[/password\s*[:=]\s*["'][^"'\s]{4,}["']/gi,/api[_-]?key\s*[:=]\s*["'][^"'\s]{4,}["']/gi,/secret\s*[:=]\s*["'][^"'\s]{4,}["']/gi,/token\s*[:=]\s*["'][^"'\s]{4,}["']/gi],
    excludePatterns:[/process\.env\./], recommendation:'Move secrets to environment variables.' },
  { name:'sql-injection', description:'SQL query built with string concatenation', cwe:'CWE-89', severity:'critical',
    patterns:[/`SELECT\s+.*\$\{/gi,/'SELECT\s+.*'\s*\+/gi,/"SELECT\s+.*"\s*\+/gi,/execute\([^)]*\+/gi,/query\([^)]*\+/gi],
    recommendation:'Use parameterized queries or an ORM.' },
  { name:'xss', description:'Direct HTML injection without sanitization', cwe:'CWE-79', severity:'high',
    patterns:[/innerHTML\s*=/gi,/dangerouslySetInnerHTML/gi,/document\.write\(/gi,/eval\(/gi],
    recommendation:'Use textContent instead of innerHTML.' },
  { name:'insecure-crypto', description:'Use of weak cryptographic algorithm', cwe:'CWE-327', severity:'high',
    patterns:[/createHash\(['"]md5['"]\)/gi,/createHash\(['"]sha1['"]\)/gi,/['"]md5['"]/gi,/['"]sha1['"]/gi,/['"]des['"]/gi,/['"]rc4['"]/gi],
    recommendation:'Use strong algorithms: SHA-256/SHA-512, AES-256.' },
  { name:'missing-auth', description:'Endpoint or route without authentication guard', cwe:'CWE-306', severity:'high',
    patterns:[/@Controller\(/gi,/@Get\(/gi,/@Post\(/gi,/@Put\(/gi,/@Delete\(/gi,/@Patch\(/gi],
    excludePatterns:[/@UseGuards/gi,/@Public\(\)/gi,/@SkipAuth/gi],
    recommendation:'Add authentication guards to all protected endpoints.' },
  { name:'path-traversal', description:'Path constructed with user input', cwe:'CWE-22', severity:'high',
    patterns:[/path\.join\([^)]*\.\.\//gi,/['"]\.\.\/['"]/gi,/\.\.\/.*\+/gi,/\+\s*['"]\.\.\//gi],
    recommendation:'Validate and sanitize user-supplied paths.' },
  { name:'command-injection', description:'Shell command executed with variable input', cwe:'CWE-78', severity:'critical',
    patterns:[/exec\([^)]*\+/gi,/execSync\([^)]*\+/gi,/spawn\([^)]*\+/gi,/exec\([^)]*\$\{/gi,/execSync\([^)]*\$\{/gi,/spawn\([^)]*\$\{/gi],
    recommendation:'Use execFile() or spawn() with arguments array.' },
  { name:'insecure-deserialization', description:'JSON.parse() without try/catch', cwe:'CWE-502', severity:'medium',
    patterns:[/JSON\.parse\(/gi],
    excludePatterns:[/try\s*\{[\s\S]*?JSON\.parse\([\s\S]*?\}\s*catch/gi],
    recommendation:'Wrap JSON.parse() in try/catch blocks.' },
  { name:'hardcoded-urls-ips', description:'Hardcoded URL or private IP address found', cwe:'CWE-200', severity:'medium',
    patterns:[/['"]https?:\/\/[^'"]+['"]/gi,/['"]192\.168\.\d{1,3}\.\d{1,3}['"]/gi,/['"]10\.\d{1,3}\.\d{1,3}\.\d{1,3}['"]/gi],
    excludePatterns:[/\/\/\s*(TODO|FIXME|HACK|XXX)/gi],
    recommendation:'Move URLs and IPs to configuration files.' },
];

function scanFile(filePath: string): Vulnerability[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const findings: Vulnerability[] = [];
    for (const rule of DETECTION_RULES) {
      for (let i = 0; i < lines.length; i++) {
        if (rule.excludePatterns?.some(p => p.test(lines[i]))) continue;
        for (const pattern of rule.patterns) {
          if (pattern.test(lines[i])) {
            findings.push({ severity:rule.severity, cwe:rule.cwe, description:`${rule.description} in ${path.basename(filePath)}`, filePath:path.resolve(filePath), line:i+1, recommendation:rule.recommendation });
            break;
          }
        }
      }
    }
    return findings;
  } catch { return []; }
}

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (['node_modules','dist','.git'].includes(entry.name)) continue;
      if (entry.isDirectory()) results.push(...collectFiles(fullPath));
      else if (/\.(ts|js|tsx|jsx)$/i.test(entry.name)) results.push(fullPath);
    }
  } catch {}
  return results;
}

function detectProjectRoot(codePaths: string[]): string {
  let dir = codePaths[0] ? path.resolve(codePaths[0]) : process.cwd();
  if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir);
  let current = dir;
  while (current !== path.parse(current).root) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    current = path.dirname(current);
  }
  return dir;
}

function generateReport(vulns: Vulnerability[], verdict: string, codePaths: string[], domain: string): string {
  const now = new Date().toISOString();
  const lines = [`# Security Review Report`,'',`**Date:** ${now}`,`**Domain:** ${domain}`,`**Files reviewed:** ${codePaths.join(', ')}`,`**Verdict:** ${verdict}`,''];
  if (vulns.length === 0) { lines.push('## ✅ No vulnerabilities found'); return lines.join('\n'); }
  const c = vulns.filter(v => v.severity === 'critical').length;
  const h = vulns.filter(v => v.severity === 'high').length;
  const m = vulns.filter(v => v.severity === 'medium').length;
  const l = vulns.filter(v => v.severity === 'low').length;
  lines.push('## Summary','','| Severity | Count |','|----------|-------|',`| Critical | ${c} |`,`| High     | ${h} |`,`| Medium   | ${m} |`,`| Low      | ${l} |`,`| **Total** | **${vulns.length}** |`,'','## Vulnerabilities','');
  const order: Record<string,number> = {critical:0,high:1,medium:2,low:3};
  [...vulns].sort((a,b) => (order[a.severity]??99)-(order[b.severity]??99)).forEach(v => {
    lines.push(`### ${v.severity.toUpperCase()}: ${v.description}`,'',`- **CWE:** ${v.cwe||'N/A'}`,`- **File:** \`${v.filePath}\``,v.line ? `- **Line:** ${v.line}` : '',`- **Recommendation:** ${v.recommendation}`,'');
  });
  return lines.join('\n');
}

// ── Schema ────────────────────────────────────────────────────────────────────

export const securityReviewSchema = {
  codePaths: z.array(z.string()).min(1).describe('Rutas de archivos/directorios a revisar'),
  vaultNamespace: z.string().describe('Namespace del vault de seguridad'),
  domain: z.string().describe('Dominio de la revisión (auth, api, database, etc.)'),
};

// ── Tool ──────────────────────────────────────────────────────────────────────

export const securityReviewTool: AgentToolDef<typeof securityReviewSchema> = {
  name: 'security_review',
  description: 'Revisa código contra OWASP y mejores prácticas de seguridad. Analiza archivos buscando vulnerabilidades y genera reporte.',
  schema: securityReviewSchema,
  buildPrompt: (args: any) => {
    const { codePaths, vaultNamespace, domain } = args;

    // Escaneo determinista con reglas OWASP
    const allVulns: Vulnerability[] = [];
    for (const cp of codePaths) {
      const resolved = path.resolve(cp);
      const files = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
        ? collectFiles(resolved) : [resolved];
      files.forEach(f => allVulns.push(...scanFile(f)));
    }

    const hasCritical = allVulns.some(v => v.severity === 'critical' || v.severity === 'high');
    const verdict = allVulns.length === 0 ? 'PASS' : hasCritical ? 'FAIL' : 'CONDITIONAL';

    // Generar reporte
    const projectRoot = detectProjectRoot(codePaths);
    const securityDir = path.join(projectRoot, '.security');
    fs.mkdirSync(securityDir, { recursive: true });
    const reportContent = generateReport(allVulns, verdict, codePaths, domain);
    const reportPath = path.join(securityDir, 'security-review.md');
    fs.writeFileSync(reportPath, reportContent, 'utf-8');

    const vulnSummary = allVulns.map(v => `[${v.severity}] ${v.description} (line ${v.line})`).join('\n');

    return `You are a security expert reviewing code for domain "${domain}" with vault "${vaultNamespace}".

## OWASP Scan Results (${allVulns.length} findings)
${vulnSummary || 'No vulnerabilities found by static analysis.'}

## Verdict: ${verdict}
Report saved to: ${reportPath}

## Task
1. ${allVulns.length > 0 ? 'Confirm if each finding is a true positive and suggest specific fixes.' : 'Confirm the code appears secure.'}
2. Save key findings to knowledge base (save_knowledge).
3. Record patterns for future reviews (learn_pattern).

Return a JSON object:
{
  "verdict": "${verdict}",
  "vulnerabilities": ${JSON.stringify(allVulns)},
  "reportPath": "${reportPath}",
  "analysis": "your analysis here",
  "knowledgeSaved": true,
  "patternsLearned": true
}`;
  },
};
