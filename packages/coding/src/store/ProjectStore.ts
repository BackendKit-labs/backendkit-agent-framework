import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { ProjectStoreData } from '@bk/agent-core';
import { cwdToProjectKey } from '@bk/agent-core';

export class ProjectStore implements ProjectStoreData {
    readonly homeDir: string;
    readonly projectDir: string;

    constructor(cwd: string, appName = 'bk-agent') {
        this.homeDir = join(homedir(), `.${appName}`);
        this.projectDir = join(this.homeDir, 'projects', cwdToProjectKey(cwd));
        mkdirSync(join(this.projectDir, 'audits'), { recursive: true });
        mkdirSync(join(this.projectDir, 'memory'), { recursive: true });
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
        writeFileSync(file, content, 'utf-8');
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
        writeFileSync(path, existing ? `${existing}\n\n${content}` : content, 'utf-8');
    }
}
