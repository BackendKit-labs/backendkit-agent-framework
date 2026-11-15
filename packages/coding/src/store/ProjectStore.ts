import { readFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { ProjectStoreData, SessionUpdates } from './types';
import { cwdToProjectKey, atomicWriteSync, compactSessionContent } from '@backendkit-labs/agent-core';

const SESSION_COMPACT_THRESHOLD = 8192; // bytes — matches core's SESSION_MAX_BYTES

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

    // ── learnings.md (legacy fallback only) ──────────────────────────────────
    getLearnings(): string { return this.read('learnings.md'); }
    appendLearning(content: string): void { this.append('learnings.md', content); }

    // ── agent-notes/{agent}.md ─────────────────────────────────────────────────
    getAgentNotes(agentId: string): string {
        // project-specific notes take priority over global
        const projectNote = this.read(join('agent-notes', `${agentId}.md`));
        const globalNote  = this.readAbs(join(this.homeDir, 'agent-notes', `${agentId}.md`));
        const parts = [globalNote, projectNote].filter(Boolean);
        return parts.join('\n');
    }

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
        // learnings.md kept for legacy compatibility but no longer primary channel
        // agent-notes are injected per-agent via AgentLoader
        return parts.join('\n\n');
    }

    // ── System prompt builder for a specific agent (includes agent-notes) ──────
    buildAgentContext(agentId: string, agentMd?: string): string {
        const base  = this.buildSystemContext(agentMd);
        const notes = this.getAgentNotes(agentId);
        if (!notes) return base;
        return base ? `${base}\n\n## Agent Session Notes\n${notes}` : `## Agent Session Notes\n${notes}`;
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

        if (Buffer.byteLength(content, 'utf-8') > SESSION_COMPACT_THRESHOLD) {
            content = compactSessionContent(content);
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
