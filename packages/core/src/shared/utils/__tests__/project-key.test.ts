import { getFrameworkDir } from '../project-key';

describe('getFrameworkDir', () => {
    it('builds the dot-directory for a valid app name', () => {
        expect(getFrameworkDir('my-app_2')).toMatch(/[\\/]\.my-app_2$/);
    });

    it.each(['../evil', 'a/b', 'a\\b', '', 'app name', '..'])('rejects %j', (name) => {
        expect(() => getFrameworkDir(name)).toThrow(/Invalid appName/);
    });
});
