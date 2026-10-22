import { execFile } from 'child_process';
import { promisify } from 'util';
import { defineTool, z } from '@backendkit-labs/agent-core';

const execFileAsync = promisify(execFile);

const MAX_OUTPUT = 10_000;

/**
 * Runs `git` with an argument array: no shell, so nothing the model puts in a value (author, grep,
 * path, branch…) can be interpreted as shell syntax. It is also asynchronous, so independent calls
 * really overlap instead of blocking the event loop.
 *
 * GIT_TERMINAL_PROMPT=0 makes push/pull fail instead of hanging on a credentials prompt;
 * GIT_OPTIONAL_LOCKS=0 stops read-only commands (status) from taking the index lock.
 */
export async function git(args: string[], cwd: string): Promise<string> {
    try {
        const { stdout, stderr } = await execFileAsync('git', args, {
            cwd,
            encoding: 'utf-8',
            timeout: 15_000,
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
        });
        // checkout, merge, push… report their result on stderr, so keep both.
        const out = [stdout, stderr].map((s) => s.trim()).filter(Boolean).join('\n');
        return (out || '(no output)').slice(0, MAX_OUTPUT);
    } catch (err) {
        const e = err as { stderr?: string; stdout?: string; message?: string };
        const msg = (e.stderr || e.stdout || e.message || String(err)).trim();
        return `Error: ${msg.slice(0, 2000)}`;
    }
}

/** A ref, branch, remote or hash must not start with "-": git would take it for an option. */
function safe(label: string, value: string): string {
    if (value.startsWith('-')) throw new Error(`${label} must not start with "-" (got "${value}")`);
    return value;
}

/** A value an action needs: fail clearly instead of running git with the text "undefined". */
function need(label: string, value: string | undefined): string {
    if (!value) throw new Error(`${label} is required for this action`);
    return safe(label, value);
}

// ── Status & Info ─────────────────────────────────────────────────────────────

export const gitStatus = defineTool({
    name: 'git_status',
    description: 'Show the working tree status (staged, unstaged, untracked files)',
    input: z.object({
        cwd: z.string().describe('Repository path'),
        short: z.boolean().optional().describe('Short format output'),
    }),
    execute: async ({ cwd, short }) => git(['status', ...(short ? ['-s'] : [])], cwd),
});

export const gitLog = defineTool({
    name: 'git_log',
    description: 'Show commit history. Supports filtering by author, path, count, and grep.',
    input: z.object({
        cwd:    z.string(),
        count:  z.number().int().min(1).max(100).default(20).describe('Number of commits'),
        branch: z.string().optional().describe('Branch or ref (default: HEAD)'),
        path:   z.string().optional().describe('Limit to commits touching this path'),
        author: z.string().optional().describe('Filter by author name/email'),
        grep:   z.string().optional().describe('Filter commit messages'),
        oneline: z.boolean().optional().describe('One line per commit'),
    }),
    execute: async ({ cwd, count, branch, path, author, grep, oneline }) => {
        const args = ['log', `--max-count=${count}`];
        args.push(oneline ? '--oneline' : '--pretty=format:%h  %an  %ar  %s');
        if (author) args.push(`--author=${author}`);
        if (grep)   args.push(`--grep=${grep}`);
        args.push(branch ? safe('branch', branch) : 'HEAD');
        if (path)   args.push('--', path);
        return git(args, cwd);
    },
});

export const gitDiff = defineTool({
    name: 'git_diff',
    description: 'Show changes between commits, branches, or working tree',
    input: z.object({
        cwd:    z.string(),
        staged: z.boolean().optional().describe('Show staged (cached) changes'),
        from:   z.string().optional().describe('From commit/branch'),
        to:     z.string().optional().describe('To commit/branch (default: HEAD)'),
        path:   z.string().optional().describe('Limit to a specific path'),
        stat:   z.boolean().optional().describe('Show diffstat instead of full diff'),
    }),
    execute: async ({ cwd, staged, from, to, path, stat }) => {
        const args = ['diff'];
        if (stat)   args.push('--stat');
        if (staged) args.push('--cached');
        if (from && to) args.push(`${safe('from', from)}..${safe('to', to)}`);
        else if (from)  args.push(safe('from', from));
        if (path)   args.push('--', path);
        return git(args, cwd);
    },
});

export const gitShow = defineTool({
    name: 'git_show',
    description: 'Show a specific commit: message, author, and diff',
    input: z.object({
        cwd:  z.string(),
        ref:  z.string().describe('Commit hash, tag, or branch'),
        stat: z.boolean().optional().describe('Show diffstat only'),
    }),
    execute: async ({ cwd, ref, stat }) =>
        git(['show', ...(stat ? ['--stat'] : []), safe('ref', ref)], cwd),
});

export const gitBlame = defineTool({
    name: 'git_blame',
    description: 'Show what revision and author last modified each line of a file',
    input: z.object({
        cwd:  z.string(),
        file: z.string().describe('File path relative to repo root'),
        from: z.number().int().optional().describe('Start line'),
        to:   z.number().int().optional().describe('End line'),
    }),
    execute: async ({ cwd, file, from, to }) =>
        git(['blame', ...(from && to ? ['-L', `${from},${to}`] : []), '--', file], cwd),
});

export const gitReflog = defineTool({
    name: 'git_reflog',
    description: 'Show the reflog — all recent HEAD movements including resets and checkouts',
    input: z.object({
        cwd:   z.string(),
        count: z.number().int().min(1).max(50).default(20),
    }),
    execute: async ({ cwd, count }) =>
        git(['reflog', `--max-count=${count}`, '--pretty=format:%h %gd %ar %gs'], cwd),
});

// ── Staging & Committing ──────────────────────────────────────────────────────

export const gitAdd = defineTool({
    name: 'git_add',
    description: 'Stage files for commit',
    input: z.object({
        cwd:   z.string(),
        files: z.array(z.string()).describe('Files or patterns to stage. Use ["."] to stage all.'),
        patch: z.boolean().optional().describe('Interactive patch mode (not supported in non-TTY)'),
    }),
    execute: async ({ cwd, files }) => git(['add', '--', ...files], cwd),
});

export const gitCommit = defineTool({
    name: 'git_commit',
    description: 'Create a commit with the staged changes',
    input: z.object({
        cwd:     z.string(),
        message: z.string().describe('Commit message (Conventional Commits preferred)'),
        amend:   z.boolean().optional().describe('Amend the previous commit'),
        noEdit:  z.boolean().optional().describe('Amend without editing message (keeps existing message)'),
    }),
    execute: async ({ cwd, message, amend, noEdit }) => {
        if (amend && noEdit) return git(['commit', '--amend', '--no-edit'], cwd);
        return git(['commit', ...(amend ? ['--amend'] : []), '-m', message], cwd);
    },
});

// ── Branches ──────────────────────────────────────────────────────────────────

export const gitBranch = defineTool({
    name: 'git_branch',
    description: 'List, create, rename, or delete branches',
    input: z.object({
        cwd:     z.string(),
        action:  z.enum(['list', 'create', 'rename', 'delete', 'delete-force']).default('list'),
        name:    z.string().optional().describe('Branch name (required for create/rename/delete)'),
        newName: z.string().optional().describe('New name (required for rename)'),
        remote:  z.boolean().optional().describe('Include remote branches in list'),
    }),
    execute: async ({ cwd, action, name, newName, remote }) => {
        switch (action) {
            case 'list':         return git(['branch', ...(remote ? ['-a'] : [])], cwd);
            case 'create':       return git(['branch', need('name', name)], cwd);
            case 'rename':       return git(['branch', '-m', need('name', name), need('newName', newName)], cwd);
            case 'delete':       return git(['branch', '-d', need('name', name)], cwd);
            case 'delete-force': return git(['branch', '-D', need('name', name)], cwd);
        }
    },
});

export const gitCheckout = defineTool({
    name: 'git_checkout',
    description: 'Switch branches or restore files',
    input: z.object({
        cwd:     z.string(),
        target:  z.string().describe('Branch name, commit hash, or file path'),
        create:  z.boolean().optional().describe('Create a new branch (-b)'),
        track:   z.string().optional().describe('Remote branch to track (e.g. origin/feature)'),
        files:   z.array(z.string()).optional().describe('Restore specific files (git checkout -- files)'),
    }),
    execute: async ({ cwd, target, create, track, files }) => {
        if (files?.length) return git(['checkout', '--', ...files], cwd);
        if (track)  return git(['checkout', '-b', safe('target', target), '--track', safe('track', track)], cwd);
        if (create) return git(['checkout', '-b', safe('target', target)], cwd);
        return git(['checkout', safe('target', target)], cwd);
    },
});

// ── Merge & Rebase ────────────────────────────────────────────────────────────

export const gitMerge = defineTool({
    name: 'git_merge',
    description: 'Merge a branch into the current branch',
    input: z.object({
        cwd:     z.string(),
        branch:  z.string().describe('Branch to merge'),
        noFF:    z.boolean().optional().describe('No fast-forward (preserves branch history)'),
        abort:   z.boolean().optional().describe('Abort an in-progress merge'),
        message: z.string().optional().describe('Custom merge commit message'),
    }),
    execute: async ({ cwd, branch, noFF, abort, message }) => {
        if (abort) return git(['merge', '--abort'], cwd);
        const args = ['merge'];
        if (noFF) args.push('--no-ff');
        if (message) args.push('-m', message);
        args.push(safe('branch', branch));
        return git(args, cwd);
    },
});

export const gitRebase = defineTool({
    name: 'git_rebase',
    description: 'Rebase current branch onto another',
    input: z.object({
        cwd:    z.string(),
        onto:   z.string().optional().describe('Base branch/commit to rebase onto'),
        abort:  z.boolean().optional().describe('Abort an in-progress rebase'),
        cont:   z.boolean().optional().describe('Continue after resolving conflicts'),
        skip:   z.boolean().optional().describe('Skip current commit and continue'),
    }),
    execute: async ({ cwd, onto, abort, cont, skip }) => {
        if (abort) return git(['rebase', '--abort'], cwd);
        if (cont)  return git(['rebase', '--continue'], cwd);
        if (skip)  return git(['rebase', '--skip'], cwd);
        return git(['rebase', need('onto', onto)], cwd);
    },
});

export const gitCherryPick = defineTool({
    name: 'git_cherry_pick',
    description: 'Apply one or more commits from another branch',
    input: z.object({
        cwd:    z.string(),
        hashes: z.array(z.string()).describe('Commit hashes to cherry-pick'),
        noCommit: z.boolean().optional().describe('Apply changes without committing (-n)'),
        abort:  z.boolean().optional().describe('Abort an in-progress cherry-pick'),
    }),
    execute: async ({ cwd, hashes, noCommit, abort }) => {
        if (abort) return git(['cherry-pick', '--abort'], cwd);
        return git(['cherry-pick', ...(noCommit ? ['-n'] : []), ...hashes.map((h) => safe('hash', h))], cwd);
    },
});

// ── Reset & Revert ────────────────────────────────────────────────────────────

export const gitReset = defineTool({
    name: 'git_reset',
    description: 'Reset HEAD to a previous state. soft=keep staged, mixed=unstage, hard=discard all',
    input: z.object({
        cwd:  z.string(),
        ref:  z.string().default('HEAD~1').describe('Commit to reset to (e.g. HEAD~1, abc1234)'),
        mode: z.enum(['soft', 'mixed', 'hard']).default('mixed')
               .describe('soft: keep staged | mixed: unstage | hard: discard changes ⚠️'),
    }),
    execute: async ({ cwd, ref, mode }) =>
        git(['reset', `--${mode}`, safe('ref', ref)], cwd),
});

export const gitRevert = defineTool({
    name: 'git_revert',
    description: 'Create a new commit that reverses a previous commit (safe for pushed commits)',
    input: z.object({
        cwd:      z.string(),
        hash:     z.string().describe('Commit hash to revert'),
        noCommit: z.boolean().optional().describe('Stage the revert without committing (-n)'),
    }),
    execute: async ({ cwd, hash, noCommit }) =>
        git(['revert', ...(noCommit ? ['-n'] : []), safe('hash', hash)], cwd),
});

// ── Stash ─────────────────────────────────────────────────────────────────────

export const gitStash = defineTool({
    name: 'git_stash',
    description: 'Save, list, apply, or drop stashed changes',
    input: z.object({
        cwd:     z.string(),
        action:  z.enum(['push', 'list', 'pop', 'apply', 'drop', 'show']).default('list'),
        message: z.string().optional().describe('Stash message (for push)'),
        index:   z.number().int().min(0).optional().describe('Stash index (for apply/drop/show)'),
    }),
    execute: async ({ cwd, action, message, index }) => {
        const ref = index !== undefined ? [`stash@{${index}}`] : [];
        switch (action) {
            case 'push':  return git(['stash', 'push', ...(message ? ['-m', message] : [])], cwd);
            case 'list':  return git(['stash', 'list'], cwd);
            case 'pop':   return git(['stash', 'pop', ...ref], cwd);
            case 'apply': return git(['stash', 'apply', ...ref], cwd);
            case 'drop':  return git(['stash', 'drop', ...ref], cwd);
            case 'show':  return git(['stash', 'show', '-p', ...ref], cwd);
        }
    },
});

// ── Remote ────────────────────────────────────────────────────────────────────

export const gitPush = defineTool({
    name: 'git_push',
    description: 'Push commits to a remote repository',
    input: z.object({
        cwd:          z.string(),
        remote:       z.string().default('origin'),
        branch:       z.string().optional().describe('Branch to push (default: current)'),
        setUpstream:  z.boolean().optional().describe('Set upstream tracking (-u)'),
        forceWithLease: z.boolean().optional().describe('Safe force push (--force-with-lease)'),
        tags:         z.boolean().optional().describe('Push tags'),
    }),
    execute: async ({ cwd, remote, branch, setUpstream, forceWithLease, tags }) => {
        const args = ['push'];
        if (setUpstream)    args.push('-u');
        if (forceWithLease) args.push('--force-with-lease');
        if (tags)           args.push('--tags');
        args.push(safe('remote', remote));
        if (branch) args.push(safe('branch', branch));
        return git(args, cwd);
    },
});

export const gitPull = defineTool({
    name: 'git_pull',
    description: 'Fetch and integrate changes from a remote',
    input: z.object({
        cwd:    z.string(),
        remote: z.string().default('origin'),
        branch: z.string().optional(),
        rebase: z.boolean().optional().describe('Pull with rebase instead of merge'),
    }),
    execute: async ({ cwd, remote, branch, rebase }) => {
        const args = ['pull'];
        if (rebase) args.push('--rebase');
        args.push(safe('remote', remote));
        if (branch) args.push(safe('branch', branch));
        return git(args, cwd);
    },
});

export const gitTag = defineTool({
    name: 'git_tag',
    description: 'List, create, or delete tags',
    input: z.object({
        cwd:     z.string(),
        action:  z.enum(['list', 'create', 'delete']).default('list'),
        name:    z.string().optional().describe('Tag name'),
        ref:     z.string().optional().describe('Commit to tag (default: HEAD)'),
        message: z.string().optional().describe('Annotated tag message'),
    }),
    execute: async ({ cwd, action, name, ref, message }) => {
        switch (action) {
            case 'list':   return git(['tag', '--sort=-version:refname'], cwd);
            case 'create': return git(
                ['tag', ...(message ? ['-a'] : []), need('name', name), ...(message ? ['-m', message] : []), ...(ref ? [safe('ref', ref)] : [])],
                cwd,
            );
            case 'delete': return git(['tag', '-d', need('name', name)], cwd);
        }
    },
});

/** Tools that only read the repository: safe to hand to an agent that must never change it. */
export const READ_ONLY_GIT_TOOLS = [
    gitStatus, gitLog, gitDiff, gitShow, gitBlame, gitReflog,
];

export const ALL_GIT_TOOLS = [
    gitStatus, gitLog, gitDiff, gitShow, gitBlame, gitReflog,
    gitAdd, gitCommit,
    gitBranch, gitCheckout,
    gitMerge, gitRebase, gitCherryPick,
    gitReset, gitRevert,
    gitStash,
    gitPush, gitPull, gitTag,
];
