import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SkillManager } from '../manager';
import { assertSafeFileName } from '../safe-name';

describe('assertSafeFileName', () => {
    it.each(['react-pack', 'my.skill_1', '@owner-repo', 'Node 20 tips'])('accepts %j', name => {
        expect(() => assertSafeFileName('skill name', name)).not.toThrow();
    });

    it.each([
        '', '.', '..', '../x', '..\\x', 'a/b', 'a\\b', 'C:evil', 'name:stream', 'a\u0000b', 'x'.repeat(101),
    ])('rejects %j', name => {
        expect(() => assertSafeFileName('skill name', name)).toThrow(/Unsafe skill name/);
    });
});

describe('SkillManager.install: names from downloaded content', () => {
    let root: string;
    let source: string;
    let project: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-safety-'));
        source = path.join(root, 'source');
        project = path.join(root, 'project');
        fs.mkdirSync(source);
        fs.mkdirSync(project);
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    const skillFile = (file: string, name: string) =>
        fs.writeFileSync(path.join(source, file), `---\nname: ${JSON.stringify(name)}\ndescription: d\n---\nDo the thing.\n`);

    it('installs a well-named skill into the project skills directory', async () => {
        skillFile('good.md', 'good-skill');
        await new SkillManager('safety-test').install(source, { projectDir: project });
        expect(fs.existsSync(path.join(project, 'skills', 'good-skill.md'))).toBe(true);
    });

    it.each(['../../escaped', '..\\..\\escaped', '../escaped', 'sub/dir'])(
        'refuses a skill named %j and writes nothing, not even the good ones next to it',
        async evilName => {
            skillFile('good.md', 'good-skill');
            skillFile('evil.md', evilName);
            await expect(new SkillManager('safety-test').install(source, { projectDir: project }))
                .rejects.toThrow(/Unsafe skill name/);
            expect(fs.existsSync(path.join(project, 'skills'))).toBe(false);
            expect(fs.existsSync(path.join(root, 'escaped.md'))).toBe(false);
            expect(fs.existsSync(path.join(project, 'escaped.md'))).toBe(false);
        },
    );

    it('refuses a pack named ".." before touching anything', async () => {
        skillFile('good.md', 'good-skill');
        await expect(new SkillManager('safety-test').install(source, { pack: '..' }))
            .rejects.toThrow(/Unsafe pack name/);
    });

    it('uninstall("..") is refused instead of removing the skills directory', async () => {
        await expect(new SkillManager('safety-test').uninstall('..')).rejects.toThrow(/Unsafe pack name/);
    });
});
