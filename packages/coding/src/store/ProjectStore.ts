import { readFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { ProjectStoreData, SessionUpdates } from '@bk/agent-core';
import { cwdToProjectKey, atomicWriteSync } from '@bk/agent-core';

export class ProjectStore implements ProjectStoreData {
    readonly homeDir: string;
    readonly projectDir: string;

    constructor(cwd: string, appName = 'bk-agent') {
        this.homeDir = join(homedir(), `.${appName}`);
        this.projectDir = join(this.homeDir, 'projects', cwdToProjectKey(cwd));
        mkdirSync(join(this.projectDir, 'audits'), { recursive: true });
        mkdirSync(join(this.projectDir, 'memory'), { recursive: true });
        this.initSessionFile(cwd);
    }

    private initSessionFile(cwd: string): void {
        const sessionPath = join(this.projectDir, 'memory', 'session.md');
        if (existsSync(sessionPath)) return;
        const projectName = basename(cwd);
        const date = new Date().toISOString().slice(0, 10);
        const template = [
            '---',
            `project: ${projectName}`,
            `created_at: ${date}`,
            `updated_at: ${date}`,
            'last_checkpoint: null',
            '---',
            '',
            '## Current Feature',
            '*(none)*',
            '',
            '## Decisions',
            '',
            '## Active Issues',
            '',
            '## Next Steps',
            '',
            '## Engine Learnings',
            '',
        ].join('\n');
        atomicWriteSync(sessionPath, template);
    }

    // ── memory/contexto-proyecto.md ───────────────────────────────────────────
    getContext(): string { return this.read(join('memory', 'contexto-proyecto.md')); }
    appendContext(content: string): void { this.append(join('memory', 'contexto-proyecto.md'), content); }

    // ── learnings.md ──────────────────────────────────────────────────────────
    getLearnings(): string { return this.read('learnings.md'); }
    appendLearning(content: string): void { this.append('learnings.md', content); }

    // ── audits/ ───────────────────────────────────────────────────────────────
    saveAudit(agentId: string, content: string): void {
        const date = new Date().toISOString().slice(0, 10);
        const file = join(this.projectDir, 'audits', `${agentId}-${date}.md`);
        atomicWriteSync(file, content);
    }
    getLatestAudit(agentId: string): string | null {
        const dir = join(this.projectDir, 'audits');
        const files = existsSync(dir)
            ? readdirSync(dir).filter(f => f.startsWith(`${agentId}-`)).sort()
            : [];
        if (files.length === 0) return null;
        return readFileSync(join(dir, files[files.length - 1]), 'utf-8');
    }
    listAudits(): string[] {
        const dir = join(this.projectDir, 'audits');
        return existsSync(dir) ? readdirSync(dir).sort() : [];
    }

    // ── USER.md (global) ──────────────────────────────────────────────────────
    getUserProfile(): string {
        return this.readAbs(join(this.homeDir, 'USER.md'));
    }
    appendUserPreference(content: string): void {
        this.appendAbs(join(this.homeDir, 'USER.md'), content);
    }

    // ── System prompt context builder ─────────────────────────────────────────
    buildSystemContext(agentMd?: string): string {
        const parts: string[] = [];
        const userProfile = this.getUserProfile();
        if (userProfile) parts.push(`## User Profile\n${userProfile}`);
        if (agentMd) parts.push(`## Project Instructions\n${agentMd}`);
        const context = this.getContext();
        if (context) parts.push(`## Project Context\n${context}`);
        const learnings = this.getLearnings();
        if (learnings) parts.push(`## Learned Preferences\n${learnings}`);
        return parts.join('\n\n');
    }

    // ── memory/session.md ─────────────────────────────────────────────────────
    updateSession(updates: SessionUpdates): void {
        const sessionPath = join(this.projectDir, 'memory', 'session.md');
        let content = '';
        try { content = readFileSync(sessionPath, 'utf-8'); } catch { return; }

        const date = new Date().toISOString().slice(0, 10);
        content = content.replace(/^updated_at: .+$/m, `updated_at: ${date}`);

        if (updates.feature !== undefined) {
            content = this.setSection(content, 'Current Feature', updates.feature);
        }
        if (updates.decisions?.length) {
            const bullets = updates.decisions.map(d => `- ${d}`).join('\n');
            content = this.appendToSection(content, 'Decisions', bullets);
        }
        if (updates.issues !== undefined) {
            const body = updates.issues.length
                ? updates.issues.map((s, i) => `${i + 1}. ${s}`).join('\n')
                : '*(none)*';
            content = this.setSection(content, 'Active Issues', body);
        }
        if (updates.next_steps !== undefined) {
            const body = updates.next_steps.length
                ? updates.next_steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
                : '*(none)*';
            content = this.setSection(content, 'Next Steps', body);
        }
        if (updates.learnings?.length) {
            const bullets = updates.learnings.map(l => `- ${l}`).join('\n');
            content = this.appendToSection(content, 'Engine Learnings', bullets);
        }

        atomicWriteSync(sessionPath, content);
    }

    // ── Private helpers ───────────────────────────────────────────────────────
    private read(filename: string): string {
        return this.readAbs(join(this.projectDir, filename));
    }
    private readAbs(path: string): string {
        try { return readFileSync(path, 'utf-8').trim(); } catch { return ''; }
    }
    private append(filename: string, content: string): void {
        this.appendAbs(join(this.projectDir, filename), content);
    }
    private appendAbs(path: string, content: string): void {
        const existing = this.readAbs(path);
        atomicWriteSync(path, existing ? `${existing}\n\n${content}` : content);
    }

    /** Replace entire content of a markdown section. Creates section if absent. */
    private setSection(content: string, title: string, body: string): string {
        const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(## ${escaped}\\n)[\\s\\S]*?(?=\\n## |$)`);
        if (re.test(content)) return content.replace(re, `$1${body}\n`);
        return `${content.trimEnd()}\n\n## ${title}\n${body}\n`;
    }

    /** Append lines to a markdown section, skipping placeholder text. Creates section if absent. */
    private appendToSection(content: string, title: string, lines: string): string {
        const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`(## ${escaped}\\n)([\\s\\S]*?)(?=\\n## |$)`);
        const match = re.exec(content);
        if (!match) return `${content.trimEnd()}\n\n## ${title}\n${lines}\n`;
        const existing = (match[2] ?? '').trim();
        const isEmpty = !existing || existing === '*(none)*';
        const newBody = isEmpty ? lines : `${existing}\n${lines}`;
        return content.replace(re, `$1${newBody}\n`);
    }
}
