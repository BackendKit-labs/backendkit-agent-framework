import { requiresInstallApproval } from '../package-install';

describe('requiresInstallApproval', () => {
    it.each([
        // what the old anchored patterns caught
        'npm install foo', 'npm i foo', 'npm add foo', 'yarn add foo', 'pnpm add foo',
        'pip install foo', 'pip3 install -r requirements.txt', 'npm uninstall foo',
        // prefixes that used to hide the install
        'cd /tmp && npm install foo',
        'cd /tmp; npm install foo',
        'FOO=1 npm install foo',
        'FOO=1 BAR=2 npm install foo',
        'echo hi | npm install foo',
        'false || npm install foo',
        '(cd app && npm install foo)',
        'echo $(npm install foo)',
        'echo hi\nnpm install foo',
        'sudo npm install foo',
        'time npm install foo',
        'env NODE_ENV=prod npm install foo',
        'FOO=1 sudo -E env BAR=2 npm install foo',
        'timeout 60 npm install foo',
        './node_modules/.bin/npm install foo',
        '"C:\\Program Files\\nodejs\\npm.cmd" install foo',
        'C:\\nodejs\\npm.cmd install foo',
        // flags in front of or around the package
        'npm install -g foo', 'npm i -D foo', 'npm install --save-dev foo', 'yarn add -D foo', 'yarn add foo -D',
        'npm --prefix ./app install foo', 'npm -w packages/core install foo', 'npm install --registry http://x.example foo',
        'npm install git+https://example.com/x.git', 'npm install ./local-dir', 'npm install @scope/pkg@1.2.3',
        // other ways to say remove
        'npm remove foo', 'npm rm foo', 'npm un foo',
        // python -m pip, and wrappers around a shell
        'python -m pip install foo', 'python3 -m pip install foo', 'py -m pip uninstall foo',
        'bash -c "npm install foo"', "sh -c 'cd x && npm i foo'", 'cmd /c npm install foo',
        'bash -c "bash -c \\"npm install foo\\""',
    ])('asks for %j', command => {
        expect(requiresInstallApproval(command)).toBe(true);
    });

    it.each([
        'npm install', 'npm install --no-audit', 'npm i --prefer-offline', 'npm ci', 'yarn install', 'pnpm install',
        'npm test', 'npm run build', 'npm run install-hooks', 'npm run i', 'npm ls', 'npm view foo', 'yarn',
        'pip list', 'pip --version', 'python script.py', 'python -m pytest',
        'git status', 'ls -la', 'cd packages && npm test', 'FOO=1 node index.js', 'echo done', 'cat package.json',
        '',
    ])('lets %j through', command => {
        expect(requiresInstallApproval(command)).toBe(false);
    });

    it('fails closed on absurd nesting instead of recursing forever', () => {
        let cmd = 'npm install foo';
        for (let i = 0; i < 8; i++) cmd = `bash -c "${cmd.replace(/"/g, '\\"')}"`;
        expect(requiresInstallApproval(cmd)).toBe(true);
    });
});

describe('installs behind other commands and other package managers (audit E-05)', () => {
    it.each([
        'xargs npm install',
        'xargs -I {} npm install {}',
        'find . -name package.json -exec npm install left-pad ;',
        'npx -y create-react-app app',
        'npx create-react-app@latest app',
        'npx -p cowsay cowsay hi',
        'pnpm dlx create-vite',
        'yarn dlx create-vite',
        'npm exec --yes -- create-vite',
        'bunx create-vite@latest',
        'bun add left-pad',
        'uv pip install requests',
        'uv add requests',
        'uv tool install ruff',
        'poetry add requests',
        'pipx install black',
        'cargo install ripgrep',
        'gem install rails',
        'go install golang.org/x/tools/gopls@latest',
    ])('%s asks', (command) => {
        expect(requiresInstallApproval(command)).toBe(true);
    });

    it.each(['npx tsc --noEmit', 'npx jest', 'bun test', 'uv run pytest', 'cargo build', 'go test ./...', 'xargs -n 1 echo', 'find . -name "*.ts" -exec grep -l x {} +'])('%s does not ask', (command) => {
        expect(requiresInstallApproval(command)).toBe(false);
    });
});
