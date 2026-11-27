/**
 * Shell command analysis for the run_command allowlist.
 *
 * The allowlist is a guard rail, not a security boundary: allowed interpreters (node, python, npm, git
 * aliases...) can run arbitrary code, so real confinement is the sandbox. What this module guarantees is that
 * the allowlist and the per-agent blocklist see every binary the shell would start by *wrapping*, not only
 * the first word of each segment: `env sh -c ...`, `xargs sh -c ...`, `timeout 5 sh`, `find -exec sh ...`, `npm exec -- sh ...`.
 * Forms that run code given inline (`npx -c`, `git -c alias.x=!sh`, `make --eval`) and variables a program runs or loads
 * (`GIT_PAGER`, `NODE_OPTIONS`, `LD_PRELOAD`...) become marker bins that no allowlist has, so the command is refused by name.
 */

/** Marker bins: never on any allowlist, so they make the command fail with a readable name. */
const QUOTED_SUBSTITUTION = '"$(…)"';
const ENV_SPLIT_STRING = 'env -S';

interface Segment { tokens: string[] }

/** Split `command` into segments of unquoted/unescaped words; redirect targets are dropped. */
function tokenize(command: string): { segments: Segment[]; markers: string[] } {
    const segments: Segment[] = [];
    const markers: string[] = [];
    let tokens: string[] = [];
    let word = '';
    let inWord = false;
    let i = 0;

    const endWord = () => { if (inWord) { tokens.push(word); word = ''; inWord = false; } };
    const endSegment = () => { endWord(); if (tokens.length) segments.push({ tokens }); tokens = []; };

    /** Consume one word (the target of a redirect) without emitting it. */
    const skipWord = () => {
        while (i < command.length && /\s/.test(command[i])) i++;
        if (command[i] === '(') return; // process substitution `>(cmd)`: the `(` splits the segment
        while (i < command.length) {
            const c = command[i];
            if (c === '"' || c === "'") {
                const close = command.indexOf(c, i + 1);
                i = close === -1 ? command.length : close + 1;
            } else if (/[\s|;&<>()`]/.test(c)) break;
            else i += c === '\\' ? 2 : 1;
        }
    };

    while (i < command.length) {
        const c = command[i];
        if (c === '\\') {
            if (command[i + 1] === '\n') { i += 2; continue; }
            if (command[i + 1] === '\r' && command[i + 2] === '\n') { i += 3; continue; }
            word += command[i + 1] ?? ''; inWord = true; i += 2; continue;
        }
        if (c === "'") {
            const close = command.indexOf("'", i + 1);
            word += command.slice(i + 1, close === -1 ? command.length : close);
            inWord = true; i = close === -1 ? command.length : close + 1; continue;
        }
        if (c === '"') {
            inWord = true; i++;
            while (i < command.length && command[i] !== '"') {
                if (command[i] === '\\') { word += command[i + 1] ?? ''; i += 2; continue; }
                if (command[i] === '`' || (command[i] === '$' && command[i + 1] === '(')) {
                    if (!markers.includes(QUOTED_SUBSTITUTION)) markers.push(QUOTED_SUBSTITUTION);
                }
                word += command[i]; i++;
            }
            i++; continue;
        }
        if (/\s/.test(c)) {
            if (c === '\n' || c === '\r') endSegment(); else endWord();
            i++; continue;
        }
        if (c === '>' || c === '<') {
            if (inWord && /^[0-9]+$/.test(word)) { word = ''; inWord = false; } // `2>file`: fd, not an argument
            else endWord();
            i++;
            if (command[i] === c) i++;           // >> and <<
            if (command[i] === '&') i++;         // >&2
            skipWord();
            continue;
        }
        if (c === '&' || c === '|' || c === ';' || c === '`' || c === '(' || c === ')') {
            endSegment(); i++;
            if ((c === '&' || c === '|') && command[i] === c) i++;
            continue;
        }
        if (c === '$' && command[i + 1] === '(') { endSegment(); i += 2; continue; }
        word += c; inWord = true; i++;
    }
    endSegment();
    return { segments, markers };
}

const baseName = (token: string): string => token.split('/').pop()?.split('\\').pop() ?? '';
const isAssignment = (t: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t);

// Options that consume the next token as their value, per wrapper.
const ENV_VALUE_OPTS = new Set(['-u', '--unset', '-C', '--chdir']);
const XARGS_VALUE_OPTS = new Set(['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--arg-file', '--max-args', '--max-procs', '--max-lines', '--max-chars', '--delimiter', '--eof']);
const TIMEOUT_VALUE_OPTS = new Set(['-s', '--signal', '-k', '--kill-after']);
const FIND_EXEC = new Set(['-exec', '-execdir', '-ok', '-okdir']);

/** Drop leading options (and the values of those that take one); stop at the first non-option. */
function skipOptions(tokens: string[], valueOpts: Set<string>): string[] {
    let i = 0;
    while (i < tokens.length) {
        const t = tokens[i];
        if (t === '--') { i++; break; }
        if (!t.startsWith('-') || t === '-') break;
        i += valueOpts.has(t) ? 2 : 1;
    }
    return tokens.slice(i);
}

/**
 * Variables whose value a program runs, loads or uses as a command (`GIT_PAGER='sh -c …' git log`, `NODE_OPTIONS=--require=x`):
 * setting one starts something the allowlist never sees. Each makes a marker bin (`GIT_PAGER=`), which no allowlist has.
 */
const EXECUTING_VARIABLES = new Set([
    'PAGER', 'GIT_PAGER', 'MANPAGER', 'EDITOR', 'VISUAL', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR', 'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_ASKPASS',
    'SSH_ASKPASS', 'GIT_EXTERNAL_DIFF', 'GIT_EXEC_PATH', 'GIT_TEMPLATE_DIR', 'NODE_OPTIONS', 'NODE_PATH',
    'BASH_ENV', 'ENV', 'PROMPT_COMMAND', 'SHELLOPTS', 'IFS', 'PATH', 'PYTHONSTARTUP', 'PYTHONPATH', 'PYTHONHOME', 'PERL5OPT', 'PERL5LIB',
    'RUBYOPT', 'RUBYLIB', 'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
]);
const EXECUTING_PREFIXES = ['DYLD_', 'GIT_CONFIG', 'npm_config_', 'NPM_CONFIG_'];
const variableMarker = (assignment: string): string | undefined => {
    const name = assignment.slice(0, assignment.indexOf('='));
    return EXECUTING_VARIABLES.has(name) || EXECUTING_PREFIXES.some(p => name.startsWith(p)) ? `${name}=` : undefined;
};

/** Leading assignments of a segment: the markers of those that execute, and the rest of the tokens. */
function takeAssignments(tokens: string[]): { markers: string[]; rest: string[] } {
    const markers: string[] = [];
    let rest = tokens;
    while (rest.length && isAssignment(rest[0])) {
        const m = variableMarker(rest[0]);
        if (m) markers.push(m);
        rest = rest.slice(1);
    }
    return { markers, rest };
}

// Forms that run code given inline, on programs that are often allowlisted. Each is a marker bin no allowlist has.
const NPX_INLINE = 'npx -c';
const NPM_EXEC_INLINE = 'npm exec -c';
const MAKE_EVAL = 'make --eval';
const GIT_CONFIG_INLINE = 'git -c';
/** npx / npm exec options that take a value: what follows is not the package. */
const NPX_VALUE_OPTS = new Set(['-p', '--package', '-w', '--workspace', '--prefix', '--registry', '--cache', '--userconfig']);

/** `npx` / `npm exec`: inline code is a marker; otherwise the command it runs is judged too (`npm exec -- sh -c …`). */
function execBins(args: string[], inlineMarker: string): string[] {
    const wrapped = skipOptions(args, NPX_VALUE_OPTS);
    const own = args.slice(0, args.length - wrapped.length);        // its own options, not those of the command it runs
    if (own.some(a => a === '-c' || a === '--call' || a.startsWith('--call='))) return [inlineMarker];
    return binsOfTokens(wrapped);
}

/** Every binary a segment starts: its own plus those it wraps (recursively). */
function binsOfTokens(tokens: string[]): string[] {
    const { markers, rest } = takeAssignments(tokens);
    if (!rest.length) return markers;
    const bin = baseName(rest[0]);
    const args = rest.slice(1);
    const out = [bin, ...markers];
    switch (bin) {
        case 'env': {
            let wrapped = skipOptions(args, ENV_VALUE_OPTS);
            const leading = args.slice(0, args.length - wrapped.length);
            if (leading.some(a => a === '-S' || a.startsWith('--split-string') || /^-[A-Za-z]*S/.test(a))) { out.push(ENV_SPLIT_STRING); break; }
            out.push(...binsOfTokens(wrapped));
            break;
        }
        case 'npx':
        case 'bunx':
            out.push(...execBins(args, NPX_INLINE));
            break;
        case 'npm':
        case 'pnpm':
        case 'yarn': {
            const [sub, ...after] = skipOptions(args, NPX_VALUE_OPTS);
            if (sub !== undefined && ['exec', 'x', 'dlx'].includes(sub)) out.push(...execBins(after, NPM_EXEC_INLINE));
            break;
        }
        case 'make':
        case 'gmake':
            if (args.some(a => a === '-E' || a === '--eval' || a.startsWith('--eval='))) out.push(MAKE_EVAL);
            break;
        case 'git': {
            // Global options before the subcommand: `-c key=value` and `--config-env` set config that may run a command
            // (`alias.x=!sh`, `core.pager`, `core.sshCommand`, `core.hooksPath`...).
            for (const a of args) {
                if (!a.startsWith('-')) break;
                if (a === '-c' || /^-c./.test(a) || a === '--config-env' || a.startsWith('--config-env=')) { out.push(GIT_CONFIG_INLINE); break; }
            }
            break;
        }
        case 'xargs':
            out.push(...binsOfTokens(skipOptions(args, XARGS_VALUE_OPTS)));
            break;
        case 'timeout': {
            const afterOpts = skipOptions(args, TIMEOUT_VALUE_OPTS);
            out.push(...binsOfTokens(afterOpts.slice(1))); // first is the duration
            break;
        }
        case 'find': {
            for (let i = 0; i < args.length; i++) {
                if (args[i] === '-delete') out.push('rm');
                if (!FIND_EXEC.has(args[i])) continue;
                let end = i + 1;
                while (end < args.length && args[end] !== ';' && args[end] !== '+') end++;
                out.push(...binsOfTokens(args.slice(i + 1, end)));
                i = end;
            }
            break;
        }
    }
    return out;
}

/** Binaries the shell would start for `command`, including those behind env/xargs/timeout/find -exec. */
export function extractAllBins(command: string): string[] {
    const { segments, markers } = tokenize(command);
    return [...segments.flatMap(s => binsOfTokens(s.tokens)).filter(Boolean), ...markers];
}

/** Base binary of the leading word of a single command (env assignments skipped); for the Windows remap. */
export function extractBin(command: string): string {
    const stripped = command.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
    const first = stripped.split(/[\s|;&<>]/)[0] ?? '';
    return baseName(first);
}
