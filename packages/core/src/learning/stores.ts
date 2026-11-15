import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { atomicWrite } from '../shared/utils/atomic-write';
import type { ApprovedRule, LessonStore, RuleStore, TaughtLesson } from './types';

export class MemoryRuleStore implements RuleStore {
    private readonly items = new Map<string, ApprovedRule>();

    async add(rule: ApprovedRule): Promise<void> { this.items.set(rule.id, rule); }
    async list(): Promise<ApprovedRule[]> { return [...this.items.values()]; }
    async remove(id: string): Promise<boolean> { return this.items.delete(id); }
}

/** Approved rules in one JSON file, written atomically. */
export class FileRuleStore implements RuleStore {
    constructor(private readonly path: string) {}

    async add(rule: ApprovedRule): Promise<void> {
        const all = (await this.list()).filter(r => r.id !== rule.id);
        await this.write([...all, rule]);
    }

    async list(): Promise<ApprovedRule[]> {
        try {
            const parsed = JSON.parse(await fs.readFile(this.path, 'utf8'));
            return Array.isArray(parsed) ? parsed as ApprovedRule[] : [];
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw err;
        }
    }

    async remove(id: string): Promise<boolean> {
        const all = await this.list();
        const rest = all.filter(r => r.id !== id);
        if (rest.length === all.length) return false;
        await this.write(rest);
        return true;
    }

    private async write(rules: ApprovedRule[]): Promise<void> {
        await fs.mkdir(dirname(this.path), { recursive: true });
        await atomicWrite(this.path, JSON.stringify(rules, null, 2));
    }
}

export class MemoryLessonStore implements LessonStore {
    private readonly items = new Map<string, TaughtLesson>();

    async add(lesson: TaughtLesson): Promise<void> { this.items.set(lesson.id, lesson); }
    async list(): Promise<TaughtLesson[]> { return [...this.items.values()]; }
    async remove(id: string): Promise<boolean> { return this.items.delete(id); }
}

/** Taught lessons in one JSON file, written atomically. */
export class FileLessonStore implements LessonStore {
    constructor(private readonly path: string) {}

    async add(lesson: TaughtLesson): Promise<void> {
        const all = (await this.list()).filter(l => l.id !== lesson.id);
        await this.write([...all, lesson]);
    }

    async list(): Promise<TaughtLesson[]> {
        try {
            const parsed = JSON.parse(await fs.readFile(this.path, 'utf8'));
            return Array.isArray(parsed) ? parsed as TaughtLesson[] : [];
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw err;
        }
    }

    async remove(id: string): Promise<boolean> {
        const all = await this.list();
        const rest = all.filter(l => l.id !== id);
        if (rest.length === all.length) return false;
        await this.write(rest);
        return true;
    }

    private async write(lessons: TaughtLesson[]): Promise<void> {
        await fs.mkdir(dirname(this.path), { recursive: true });
        await atomicWrite(this.path, JSON.stringify(lessons, null, 2));
    }
}
