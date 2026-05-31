import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SkillLoader } from '../loader';
import type { Skill } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function writeSkillYaml(dir: string, filename: string, skill: Partial<Skill>): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    const yaml = [
        `name: ${skill.name ?? 'test-skill'}`,
        `version: ${skill.version ?? '1.0.0'}`,
        `description: ${skill.description ?? 'Test'}`,
        `triggers:`,
        ...(skill.triggers ?? ['keyword']).map(t => `  - ${t}`),
        skill.systemPromptAddition ? `systemPromptAddition: "${skill.systemPromptAddition}"` : '',
        skill.language ? `language:\n${skill.language.map(l => `  - ${l}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');
    await fs.writeFile(path.join(dir, filename), yaml, 'utf-8');
}

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpHome: string;
let tmpCwd: string;
const APP_NAME = 'test-app';

beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-loader-home-'));
    tmpCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-loader-cwd-'));
    process.env.USERPROFILE = tmpHome;
    process.env.HOME = tmpHome;
});

afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
    await fs.rm(tmpCwd, { recursive: true, force: true });
    delete process.env.USERPROFILE;
    delete process.env.HOME;
});

// ── loadGlobal() ──────────────────────────────────────────────────────────────

describe('SkillLoader.loadGlobal()', () => {
    it('returns empty array when global skills dir does not exist', async () => {
        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadGlobal();
        expect(skills).toEqual([]);
    });

    it('loads skills from ~/.{appName}/skills/global/', async () => {
        const globalDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'global');
        await writeSkillYaml(globalDir, 'style.yaml', { name: 'style-guide', triggers: ['style'] });

        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadGlobal();

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('style-guide');
    });

    it('assigns scope "global" to loaded skills', async () => {
        const globalDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'global');
        await writeSkillYaml(globalDir, 'foo.yaml', { name: 'foo', triggers: ['foo'] });

        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadGlobal();

        expect(skills[0].scope).toBe('global');
    });

    it('ignores non-yaml files', async () => {
        const globalDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'global');
        await fs.mkdir(globalDir, { recursive: true });
        await fs.writeFile(path.join(globalDir, 'notes.txt'), 'not a skill');
        await writeSkillYaml(globalDir, 'real.yaml', { name: 'real', triggers: ['real'] });

        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadGlobal();

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('real');
    });

    it('skips invalid YAML files without throwing', async () => {
        const globalDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'global');
        await fs.mkdir(globalDir, { recursive: true });
        await fs.writeFile(path.join(globalDir, 'broken.yaml'), ':: invalid: [yaml');
        await writeSkillYaml(globalDir, 'good.yaml', { name: 'good', triggers: ['good'] });

        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadGlobal();

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('good');
    });
});

// ── loadPacks() ───────────────────────────────────────────────────────────────

describe('SkillLoader.loadPacks()', () => {
    it('returns empty array when packs dir does not exist', async () => {
        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadPacks();
        expect(skills).toEqual([]);
    });

    it('loads skills from each pack subdirectory', async () => {
        const packsDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'packs');
        const packA = path.join(packsDir, '@bk-node');
        const packB = path.join(packsDir, '@bk-python');

        await writeSkillYaml(packA, 'node.yaml', { name: 'node-skill', triggers: ['npm'] });
        await writeSkillYaml(packB, 'python.yaml', { name: 'python-skill', triggers: ['pip'] });

        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadPacks();

        expect(skills).toHaveLength(2);
        const names = skills.map(s => s.name);
        expect(names).toContain('node-skill');
        expect(names).toContain('python-skill');
    });

    it('assigns scope "pack" and sets pack field to directory name', async () => {
        const packDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'packs', '@bk-node');
        await writeSkillYaml(packDir, 'skill.yaml', { name: 'pack-skill', triggers: ['node'] });

        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadPacks();

        expect(skills[0].scope).toBe('pack');
        expect(skills[0].pack).toBe('@bk-node');
    });

    it('ignores files at the packs root level (only loads from subdirectories)', async () => {
        const packsDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'packs');
        await fs.mkdir(packsDir, { recursive: true });
        await fs.writeFile(path.join(packsDir, 'stray.yaml'), 'name: stray\nversion: 1.0.0\ndescription: x\ntriggers:\n  - x\n');

        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadPacks();

        // stray.yaml is at the packs root, not in a subdirectory
        expect(skills).toHaveLength(0);
    });
});

// ── loadProject() ─────────────────────────────────────────────────────────────

describe('SkillLoader.loadProject()', () => {
    it('returns empty array when project skills dir does not exist', async () => {
        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadProject(tmpCwd);
        expect(skills).toEqual([]);
    });

    it('loads skills from {cwd}/.{appName}/skills/', async () => {
        const projectDir = path.join(tmpCwd, `.${APP_NAME}`, 'skills');
        await writeSkillYaml(projectDir, 'project.yaml', { name: 'project-skill', triggers: ['proj'] });

        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadProject(tmpCwd);

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe('project-skill');
    });

    it('assigns scope "project" to loaded skills', async () => {
        const projectDir = path.join(tmpCwd, `.${APP_NAME}`, 'skills');
        await writeSkillYaml(projectDir, 'ps.yaml', { name: 'ps', triggers: ['ps'] });

        const loader = new SkillLoader(APP_NAME);
        const skills = await loader.loadProject(tmpCwd);

        expect(skills[0].scope).toBe('project');
    });

    it('uses cwd path, not home path', async () => {
        // Write same skill name in both locations
        const globalDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'global');
        const projectDir = path.join(tmpCwd, `.${APP_NAME}`, 'skills');

        await writeSkillYaml(globalDir, 'shared.yaml', { name: 'shared', triggers: ['x'], systemPromptAddition: 'global content' });
        await writeSkillYaml(projectDir, 'shared.yaml', { name: 'shared', triggers: ['x'], systemPromptAddition: 'project content' });

        const loader = new SkillLoader(APP_NAME);
        const projectSkills = await loader.loadProject(tmpCwd);
        const globalSkills = await loader.loadGlobal();

        // Each loader returns its own version
        const projectShared = projectSkills.find(s => s.name === 'shared');
        const globalShared = globalSkills.find(s => s.name === 'shared');

        expect(projectShared?.systemPromptAddition).toBe('project content');
        expect(projectShared?.scope).toBe('project');
        expect(globalShared?.systemPromptAddition).toBe('global content');
        expect(globalShared?.scope).toBe('global');
    });
});

// ── loadAll() ─────────────────────────────────────────────────────────────────

describe('SkillLoader.loadAll()', () => {
    it('returns all three layers', async () => {
        const globalDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'global');
        const packDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'packs', '@bk-node');
        const projectDir = path.join(tmpCwd, `.${APP_NAME}`, 'skills');

        await writeSkillYaml(globalDir, 'g.yaml', { name: 'global-skill', triggers: ['global'] });
        await writeSkillYaml(packDir, 'p.yaml', { name: 'pack-skill', triggers: ['pack'] });
        await writeSkillYaml(projectDir, 'pr.yaml', { name: 'project-skill', triggers: ['project'] });

        const loader = new SkillLoader(APP_NAME);
        const { global, packs, project } = await loader.loadAll(tmpCwd);

        expect(global.map(s => s.name)).toContain('global-skill');
        expect(packs.map(s => s.name)).toContain('pack-skill');
        expect(project.map(s => s.name)).toContain('project-skill');
    });

    it('project layer is empty when cwd is not provided', async () => {
        const loader = new SkillLoader(APP_NAME);
        const { project } = await loader.loadAll(undefined);
        expect(project).toEqual([]);
    });

    it('all layers run in parallel and complete without error when dirs are empty', async () => {
        const loader = new SkillLoader(APP_NAME);
        const result = await loader.loadAll(tmpCwd);
        expect(result.global).toEqual([]);
        expect(result.packs).toEqual([]);
        expect(result.project).toEqual([]);
    });
});

// ── Scope precedence order (integration) ──────────────────────────────────────

describe('Skill scope precedence — loadAll + buildSystemPromptAddition', () => {
    it('project > pack > global when merged in ascending order and deduplicated last-wins', async () => {
        const { SkillActivator } = await import('../activator');
        const activator = new SkillActivator();

        const globalDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'global');
        const packDir = path.join(tmpHome, `.${APP_NAME}`, 'skills', 'packs', '@bk-node');
        const projectDir = path.join(tmpCwd, `.${APP_NAME}`, 'skills');

        // Same skill name "code-style" at all three scopes
        await writeSkillYaml(globalDir, 'cs.yaml', { name: 'code-style', triggers: ['style'], systemPromptAddition: 'Global style guide.' });
        await writeSkillYaml(packDir, 'cs.yaml', { name: 'code-style', triggers: ['style'], systemPromptAddition: 'Pack style guide.' });
        await writeSkillYaml(projectDir, 'cs.yaml', { name: 'code-style', triggers: ['style'], systemPromptAddition: 'Project style guide.' });

        const loader = new SkillLoader(APP_NAME);
        const { global, packs, project } = await loader.loadAll(tmpCwd);

        // Merge order: global first, pack next, project last (ascending priority)
        const merged = [...global, ...packs, ...project];
        const output = activator.buildSystemPromptAddition(merged);

        // Project wins — only project content appears
        expect(output).toBe('Project style guide.');
        expect(output).not.toContain('Global');
        expect(output).not.toContain('Pack');
    });
});
