/**
 * Shell command analysis for the run_command allowlist.
 *
 * The allowlist is a guard rail, not a security boundary: allowed interpreters (node, python, npm, git
 * aliases...) can run arbitrary code, so real confinement is the sandbox. What this module guarantees is that
 * the allowlist and the per-agent blocklist see every binary the shell would start by *wrapping*, not only
 * the first word of each segment: `env sh -c ...`, `xargs sh -c ...`, `timeout 5 sh`, `find -exec sh ...`.
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

/** Every binary a segment starts: its own plus those it wraps (recursively). */
function binsOfTokens(tokens: string[]): string[] {
    let rest = tokens;
    while (rest.length && isAssignment(rest[0])) rest = rest.slice(1);
    if (!rest.length) return [];
    const bin = baseName(rest[0]);
    const args = rest.slice(1);
    const out = [bin];
    switch (bin) {
        case 'env': {
            let wrapped = skipOptions(args, ENV_VALUE_OPTS);
            const leading = args.slice(0, args.length - wrapped.length);
            if (leading.some(a => a === '-S' || a.startsWith('--split-string') || /^-[A-Za-z]*S/.test(a))) { out.push(ENV_SPLIT_STRING); break; }
            while (wrapped.length && isAssignment(wrapped[0])) wrapped = wrapped.slice(1);
            out.push(...binsOfTokens(wrapped));
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
