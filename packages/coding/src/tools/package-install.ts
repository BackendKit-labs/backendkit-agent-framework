/**
 * Whether a shell command installs or removes packages. Installing runs third-party code (postinstall scripts),
 * so `run_command` declares it with `alwaysAsk` and a person is asked even after choosing "approve all".
 *
 * The check works on what the shell will actually run, not on how the line starts: the command is split at
 * `&&`, `||`, `;`, `|`, `&`, newlines, `$(`, backticks and parentheses; each segment loses its leading
 * `VAR=value` assignments and wrappers (`sudo`, `time`, `env`, ...); quoted payloads (`bash -c "npm i x"`) are
 * checked too. When in doubt it says yes: a needless question costs a click, a missed install runs code unasked.
 */

const QUOTED = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
const SEGMENT_SEPARATORS = /&&|\|\||[|;`\r\n(){}]|\$\(|(?<!>)&(?!&)/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Commands that run another command: the real binary is whatever follows (and its flags / assignments). */
const WRAPPERS = new Set(['sudo', 'doas', 'time', 'nohup', 'nice', 'env', 'command', 'exec', 'builtin', 'stdbuf', 'timeout']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'cmd', 'powershell', 'pwsh']);

const INSTALL_SUBCOMMANDS = new Set(['install', 'i', 'in', 'ins', 'inst', 'add']);
const REMOVE_SUBCOMMANDS = new Set(['uninstall', 'remove', 'rm', 'un', 'unlink', 'r']);

/** Global flags of the JS package managers that take a separate value, so the value is not mistaken for the subcommand. */
const VALUE_FLAGS = new Set(['--prefix', '-c', '--cwd', '--dir', '--workspace', '-w', '--registry', '--cache', '--userconfig', '--filter', '-f']);

const MAX_DEPTH = 3;

export function requiresInstallApproval(command: string, depth = 0): boolean {
    if (depth > MAX_DEPTH) return true;

    // quoted payloads first: `bash -c "cd x && npm install y"`. Inside double quotes `\"` is a literal quote.
    for (const m of command.matchAll(QUOTED)) {
        const inner = m[1] !== undefined ? m[1].replace(/\\(["\\$`])/g, '$1') : (m[2] ?? '');
        if (inner && requiresInstallApproval(inner, depth + 1)) return true;
    }

    // A quoted string with no shell operator in it is one word (a program path with spaces, a quoted subcommand):
    // keep it as that word. One with operators could hide a second command, so it is blanked; its payload was
    // checked above.
    const unquoted = command
        .replace(QUOTED, (_whole, dq: string | undefined, sq: string | undefined) => {
            const inner = dq ?? sq ?? '';
            return /[&|;`$()<>{}\r\n]/.test(inner) ? '""' : inner.replace(/\s+/g, '_');
        })
        .replace(/[0-9]*>>?\s*(?:&[0-9]*|\S*)/g, '')
        // `{}` is the placeholder of xargs -I and find -exec, an argument, not a brace group that splits the command
        .replace(/\{\}/g, 'placeholder-argument');
    return unquoted.split(SEGMENT_SEPARATORS).some(segment => segmentInstalls(segment, depth));
}

function segmentInstalls(segment: string, depth: number): boolean {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    let i = 0;

    // leading assignments and wrappers, in any order: `FOO=1 sudo -E env BAR=2 npm install x`
    for (;;) {
        while (i < tokens.length && ENV_ASSIGNMENT.test(tokens[i])) i++;
        const word = bin(tokens[i]);
        if (!word || !WRAPPERS.has(word)) break;
        i++;
        while (i < tokens.length && (tokens[i].startsWith('-') || ENV_ASSIGNMENT.test(tokens[i]))) i++;
        if (word === 'timeout' && i < tokens.length && /^\d/.test(tokens[i])) i++; // timeout 30 npm install x
    }

    const name = bin(tokens[i]);
    if (!name) return false;
    const rest = tokens.slice(i + 1);

    // Commands that run another command not at their start: `xargs npm install`, `find . -exec npm install x ;`.
    // xargs adds what it reads to the command: `ls | xargs npm install` names packages, so it is judged as if one were named.
    if (name === 'xargs') return segmentInstalls(`${skipXargsOptions(rest).join(' ')} stdin-argument`, depth + 1);
    if (name === 'find') {
        const exec = rest.findIndex(a => FIND_EXEC.has(a));
        return exec >= 0 && segmentInstalls(rest.slice(exec + 1).filter(a => a !== ';' && a !== '+' && a !== '\\').join(' '), depth + 1);
    }

    // Runners that fetch a package and run it: always for `dlx`, for npx/bunx/npm exec when the command names one to fetch.
    if (name === 'npx' || name === 'bunx') return fetchesPackage(rest);

    // a shell given its script as an argument: the quoted payload was already checked; an unquoted one is the rest
    if (SHELLS.has(name)) {
        // drop the shell's own switches (-c, -Command, cmd's /c) and judge the script that follows
        let s = 0;
        while (s < rest.length && /^(-|\/[a-z]$)/i.test(rest[s])) s++;
        return requiresInstallApproval(rest.slice(s).join(' '), depth + 1);
    }

    // python -m pip install x
    if (/^(python|python3|py)(\d+(\.\d+)*)?$/.test(name)) {
        const m = rest.indexOf('-m');
        if (m >= 0 && bin(rest[m + 1]) === 'pip') return pipTouches(rest.slice(m + 2));
        return false;
    }

    if (name === 'pip' || name === 'pip3') return pipTouches(rest);
    if (name === 'npm' || name === 'yarn' || name === 'pnpm' || name === 'bun') return jsManagerTouches(rest);
    const sub = rest.find(a => !a.startsWith('-'))?.toLowerCase();
    if (name === 'uv') {
        if (sub === 'pip') return pipTouches(rest.slice(rest.indexOf('pip') + 1));
        if (sub === 'tool') return rest.some(a => a === 'install' || a === 'uninstall');
        return sub === 'add' || sub === 'remove';
    }
    if (name === 'poetry' || name === 'pdm') return sub === 'add' || sub === 'remove';
    if (name === 'pipx' || name === 'gem') return sub === 'install' || sub === 'uninstall';
    if (name === 'cargo') return sub === 'install' || sub === 'add' || sub === 'remove' || sub === 'uninstall';
    if (name === 'go') return sub === 'install' || sub === 'get';
    return false;
}

const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const XARGS_VALUE_OPTS = new Set(['-i', '-l', '-n', '-p', '-s', '-d', '-e', '-a', '--arg-file', '--max-args', '--max-procs', '--max-lines', '--max-chars', '--delimiter', '--eof', '--replace']);

function skipXargsOptions(args: string[]): string[] {
    let k = 0;
    while (k < args.length && args[k].startsWith('-')) {
        // -I {} takes a value; -I{} carries it
        k += XARGS_VALUE_OPTS.has(args[k].toLowerCase()) && !args[k].includes('=') ? 2 : 1;
    }
    return args.slice(k);
}

/** `npx pkg@1`, `npx -y pkg`, `npx -p pkg cmd`: the runner fetches a package and runs its code. `npx tsc` runs a local one. */
function fetchesPackage(args: string[]): boolean {
    if (args.some(a => a === '-y' || a === '--yes' || a === '-p' || a === '--package' || a.startsWith('--package='))) return true;
    const pkg = args.find(a => !a.startsWith('-'));
    return pkg !== undefined && /.@/.test(pkg);   // a version or tag after the name: `create-app@latest`, `@scope/x@2`
}

function pipTouches(args: string[]): boolean {
    const sub = args.find(a => !a.startsWith('-'))?.toLowerCase();
    return sub === 'install' || sub === 'uninstall';
}

function jsManagerTouches(args: string[]): boolean {
    let k = 0;
    while (k < args.length && args[k].startsWith('-')) {
        k += VALUE_FLAGS.has(args[k].toLowerCase()) && !args[k].includes('=') ? 2 : 1;
    }
    const sub = args[k]?.toLowerCase();
    if (!sub) return false;
    if (sub === 'dlx') return true;                                       // pnpm dlx / yarn dlx always fetch
    if (sub === 'exec' || sub === 'x') return fetchesPackage(args.slice(k + 1));
    if (REMOVE_SUBCOMMANDS.has(sub)) return true;
    if (!INSTALL_SUBCOMMANDS.has(sub)) return false;
    // `install` with only flags restores package.json (nothing new), so it does not ask; naming anything does, wherever
    // the flags sit: `npm i foo`, `npm i -D foo`, `yarn add foo -D`, `npm install --registry http://x foo`.
    return args.slice(k + 1).some(a => !a.startsWith('-'));
}

/** The lowercased program name of a token: no directory, no Windows launcher extension. */
function bin(token: string | undefined): string {
    if (!token) return '';
    const base = token.split('/').pop()!.split('\\').pop()!.toLowerCase();
    return base.replace(/\.(cmd|exe|bat|ps1)$/, '');
}
