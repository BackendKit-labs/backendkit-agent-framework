import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { run, isOk } from '@backendkit-labs/result';
import { SlashCommandRegistry } from './SlashCommandRegistry';
import { createSkillManager } from '../skills/manager';
import { parseMdSkill } from '../skills/parse-md-skill';
import { getFrameworkDir } from '../shared/utils/project-key';
import { atomicWrite } from '../shared/utils/atomic-write';
import {
    createCheckpoint,
    listCheckpoints,
    readCheckpoint,
    getLatestCheckpoints,
    extractSessionFromCheckpoint,
} from '../checkpoint';
import {
    loadWorkspaces,
    saveWorkspaces,
    createWorkspace,
    addProject,
    importProject,
    removeProject,
    deleteWorkspace,
    setActiveProject,
    buildWorkspaceContext,
    deriveProjectName,
    setCommonRoot,
    detectCommonRoot,
} from '../workspace';

// ── Internal helper ───────────────────────────────────────────────────────────

async function doSwitch(
    wsName: string,
    projectName: string,
    config: import('../workspace').WorkspacesConfig,
    appName: string,
    emit: (text: string) => void,
    injectContext?: (message: string) => void,
    onCwdChange?: (cwd: string, contextMessage?: string) => void,
): Promise<void> {
    const ws = config[wsName];
    if (!ws) { emit(`Workspace "${wsName}" not found.`); return; }
    const target = ws.projects.find(p => p.name === projectName);
    if (!target) { emit(`Project "${projectName}" not found in workspace "${wsName}".`); return; }

    // Persist the new active state
    const updated = setActiveProject(config, wsName, target.name);
    await saveWorkspaces(appName, updated);

    // Build workspace context once — passed to both injectContext (host) and
    // onCwdChange (engine bindings) so the inject is guaranteed even when the
    // host overrides injectContext with its own pendingContext mechanism.
    const context = await buildWorkspaceContext(wsName, updated[wsName]!, appName);
    injectContext?.(context);

    if (onCwdChange) {
        const effectiveCwd = ws.commonRoot ?? target.cwd;
        onCwdChange(effectiveCwd, context);
        const rootNote = ws.commonRoot ? ` (shared root: ${ws.commonRoot})` : '';
        emit(`Switched to workspace "${wsName}" — project: ${target.name}${rootNote}`);
    } else {
        emit(`Workspace "${wsName}" loaded — project: ${target.name} (${target.cwd})`);
    }
}

// ── Registry ──────────────────────────────────────────────────────────────────

/**
 * Registers the framework's built-in slash commands into the given registry.
 * Call this once when bootstrapping the app — before registering app-specific commands.
 */
export function registerBuiltinCommands(registry: SlashCommandRegistry): void {
    registry.register('/help', 'List available commands', async (ctx) => {
        const cmds = registry.getAll();
        const list = cmds.map(c => `- ${c.name.padEnd(22)} ${c.description}`).join('\n');
        ctx.emit(`Available commands:\n${list}`);
    });

    registry.register('/agents', 'List agents or switch active agent', async (ctx) => {
        if (!ctx.agents?.length) { ctx.emit('No agents loaded.'); return; }

        const active = ctx.effectiveAgentId;

        if (ctx.prompt) {
            const options = ctx.agents.map(a => {
                const icon  = a.icon ? `${a.icon} ` : '';
                const badge = a.id === active ? ' [activo]' : '';
                const label = `${icon}${a.name}${badge}`;
                const desc  = a.description ? ` — ${a.description}` : '';
                return { label: `${label.padEnd(28)}${desc}`, value: a.id };
            });
            const selected = await ctx.prompt('Seleccionar agente:', options);
            if (!selected) return;
            if (selected === active) {
                ctx.emit(`Ya estás usando ${selected}.`);
                return;
            }
            // Switch via engine so the bridge/engine updates the active agent
            await ctx.runEngine?.(`/agent ${selected}`);
            ctx.emit(`Agente cambiado → ${selected}`);
        } else {
            const lines = ctx.agents.map(a => {
                const icon  = a.icon ? `${a.icon} ` : '';
                const marker = a.id === active ? ' ◀ activo' : '';
                return `  ${icon}${a.id.padEnd(20)} ${a.name}${marker}`;
            });
            ctx.emit(
                'Agentes disponibles:\n' + lines.join('\n') +
                '\n\nUsa /agents para el picker interactivo o /agent <id> para cambiar directamente.',
            );
        }
    });

    registry.register('/skills', 'Gestionar skills: list, install, create, generate, update, uninstall, reload', async (ctx) => {
        const parts = ctx.args.trim().split(/\s+/);
        const sub = parts[0];

        // ── /skills install <url> [--global] ─────────────────────────────────
        if (sub === 'install') {
            const source = parts[1];
            if (!source) {
                ctx.emit(
                    'Uso: /skills install <url> [--global]\n' +
                    '  /skills install https://skills.sh/owner/repo\n' +
                    '  /skills install https://github.com/owner/repo\n' +
                    '  /skills install https://skills.sh/owner/repo --global\n\n' +
                    'Sin --global, el pack se instala solo para este proyecto.',
                );
                return;
            }

            const isGlobal = parts.includes('--global');
            const appName = ctx.appName ?? 'bk-agent';
            const manager = createSkillManager(appName);

            try {
                ctx.emit(`Instalando skill desde: ${source}…`);
                await manager.install(source, {
                    projectDir: isGlobal ? undefined : ctx.projectDir,
                });
                const scope = isGlobal ? 'global' : 'proyecto';
                await ctx.reloadSkills?.();
                ctx.emit(`✓ Skill instalada (scope: ${scope}).`);
            } catch (err) {
                ctx.emit(`✗ Error al instalar: ${(err as Error).message}`);
            }
            return;
        }

        // ── /skills create <nombre> [--global] ───────────────────────────────
        if (sub === 'create') {
            const name = parts[1];
            if (!name) {
                ctx.emit(
                    'Uso: /skills create <nombre> [--global]\n' +
                    '  /skills create mi-skill           → crea en el proyecto actual\n' +
                    '  /skills create mi-skill --global  → crea en el directorio global\n\n' +
                    'El nombre debe ser kebab-case (ej: code-review-nestjs, deploy-docker).',
                );
                return;
            }
            if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
                ctx.emit('✗ El nombre debe ser kebab-case (solo letras minúsculas, números y guiones).');
                return;
            }
            const isGlobal = parts.includes('--global');
            const appName = ctx.appName ?? 'bk-agent';
            const dir = isGlobal || !ctx.projectDir
                ? path.join(getFrameworkDir(appName), 'skills', 'global')
                : path.join(ctx.projectDir, 'skills');
            const filePath = path.join(dir, `${name}.md`);

            const exists = await run(() => fs.access(filePath));
            if (isOk(exists)) {
                ctx.emit(`✗ Ya existe una skill con ese nombre: ${filePath}`);
                return;
            }

            const template = [
                '---',
                `name: ${name}`,
                'version: 1.0.0',
                'description: ',
                'triggers:',
                '  - ',
                '---',
                '',
                '',
            ].join('\n');
            await fs.mkdir(dir, { recursive: true });
            await atomicWrite(filePath, template);
            await ctx.reloadSkills?.();
            ctx.emit(`✓ Skill creada: ${filePath}`);
            return;
        }

        // ── /skills generate <descripción> [--global] ────────────────────────
        if (sub === 'generate') {
            const isGlobal = parts.includes('--global');
            const description = parts.slice(1).filter(p => p !== '--global').join(' ');
            if (!description) {
                ctx.emit(
                    'Uso: /skills generate <descripción> [--global]\n' +
                    '  /skills generate "proceso de code review para NestJS"\n' +
                    '  /skills generate "flujo de deploy con Docker Compose" --global',
                );
                return;
            }
            if (!ctx.llm) {
                ctx.emit(
                    '✗ LLM no disponible en este contexto.\n' +
                    'Usá /skills create <nombre> para crear la skill manualmente.',
                );
                return;
            }

            const appName = ctx.appName ?? 'bk-agent';
            const dir = isGlobal || !ctx.projectDir
                ? path.join(getFrameworkDir(appName), 'skills', 'global')
                : path.join(ctx.projectDir, 'skills');

            ctx.emit('Generando skill…');
            const prompt =
                `Generate a skill file in .md format with YAML frontmatter.\n` +
                `Output raw file content only — no markdown code fences, no extra explanation.\n\n` +
                `Required format:\n` +
                `---\n` +
                `name: <kebab-case name, max 4 words>\n` +
                `version: 1.0.0\n` +
                `description: <one concise line>\n` +
                `triggers:\n` +
                `  - <keyword1>\n` +
                `  - <keyword2>\n` +
                `  - <keyword3>\n` +
                `---\n\n` +
                `<Clear step-by-step instructions in markdown>\n\n` +
                `Description: "${description.slice(0, 500)}"`;

            let md: string;
            try {
                const raw = await ctx.llm(prompt);
                md = raw.replace(/^```(?:md|markdown)?\n?/im, '').replace(/```\s*$/m, '').trim();
            } catch (err) {
                ctx.emit(`✗ Error generando skill: ${(err as Error).message}`);
                return;
            }

            const skill = parseMdSkill(md);
            if (!skill?.name) {
                ctx.emit(
                    '✗ La respuesta del LLM no tiene el formato esperado.\n' +
                    'Usá /skills create <nombre> para crear la skill manualmente.',
                );
                return;
            }

            const filePath = path.join(dir, `${skill.name}.md`);
            const exists = await run(() => fs.access(filePath));
            if (isOk(exists)) {
                ctx.emit(`✗ Ya existe una skill con ese nombre: ${filePath}`);
                return;
            }
            await fs.mkdir(dir, { recursive: true });
            await atomicWrite(filePath, md);
            await ctx.reloadSkills?.();
            ctx.emit(`✓ Skill "${skill.name}" generada: ${filePath}`);
            return;
        }

        // ── /skills uninstall <pack> ──────────────────────────────────────────
        if (sub === 'uninstall') {
            const pack = parts[1];
            const appName = ctx.appName ?? 'bk-agent';
            const manager = createSkillManager(appName);

            if (!pack) {
                const packs = await manager.list();
                if (!packs.length) {
                    ctx.emit('No hay packs instalados.\nUsá /skills install <url> para instalar uno.');
                    return;
                }
                if (ctx.prompt) {
                    const options = packs.map(p => ({
                        label: `${p.pack.padEnd(26)} skills: ${p.skills.join(', ')}`,
                        value: p.pack,
                    }));
                    const selected = await ctx.prompt('Seleccioná el pack a desinstalar:', options);
                    if (!selected) return;
                    try {
                        await manager.uninstall(selected);
                        ctx.emit(`✓ Pack "${selected}" desinstalado.`);
                    } catch (err) {
                        ctx.emit(`✗ Error: ${(err as Error).message}`);
                    }
                } else {
                    const lines = packs.map(p =>
                        `  ${p.pack.padEnd(26)} ${p.skills.join(', ')}`,
                    );
                    ctx.emit('Packs instalados:\n' + lines.join('\n') + '\n\nUsá: /skills uninstall <pack>');
                }
                return;
            }

            try {
                await manager.uninstall(pack);
                ctx.emit(`✓ Pack "${pack}" desinstalado.`);
            } catch (err) {
                ctx.emit(`✗ Error: ${(err as Error).message}`);
            }
            return;
        }

        // ── /skills update <pack> ─────────────────────────────────────────────
        if (sub === 'update') {
            const pack = parts[1];
            const appName = ctx.appName ?? 'bk-agent';
            const manager = createSkillManager(appName);

            if (!pack) {
                const packs = await manager.list();
                if (!packs.length) {
                    ctx.emit('No hay packs instalados.\nUsá /skills install <url> para instalar uno.');
                    return;
                }
                if (ctx.prompt) {
                    const options = packs.map(p => ({
                        label: `${p.pack.padEnd(26)} instalado: ${p.installedAt.slice(0, 10)}`,
                        value: p.pack,
                    }));
                    const selected = await ctx.prompt('Seleccioná el pack a actualizar:', options);
                    if (!selected) return;
                    try {
                        ctx.emit(`Actualizando "${selected}"…`);
                        await manager.update(selected);
                        ctx.emit(`✓ Pack "${selected}" actualizado. Reinicia para aplicar los cambios.`);
                    } catch (err) {
                        ctx.emit(`✗ Error: ${(err as Error).message}`);
                    }
                } else {
                    const lines = packs.map(p =>
                        `  ${p.pack.padEnd(26)} instalado: ${p.installedAt.slice(0, 10)}`,
                    );
                    ctx.emit('Packs instalados:\n' + lines.join('\n') + '\n\nUsá: /skills update <pack>');
                }
                return;
            }

            try {
                ctx.emit(`Actualizando "${pack}"…`);
                await manager.update(pack);
                ctx.emit(`✓ Pack "${pack}" actualizado. Reinicia para aplicar los cambios.`);
            } catch (err) {
                ctx.emit(`✗ Error: ${(err as Error).message}`);
            }
            return;
        }

        // ── /skills reload ────────────────────────────────────────────────────
        if (sub === 'reload') {
            if (!ctx.reloadSkills) {
                ctx.emit('✗ Reload no disponible en este contexto.');
                return;
            }
            ctx.emit('Recargando skills…');
            await ctx.reloadSkills();
            ctx.emit('✓ Skills recargadas.');
            return;
        }

        // ── /skills list (default) ────────────────────────────────────────────
        const SUBCOMMANDS_HINT =
            '\n\nSubcomandos: install | create | generate | update | uninstall | reload';

        if (!ctx.skills?.length) {
            ctx.emit('No skills cargadas.' + SUBCOMMANDS_HINT);
            return;
        }

        if (ctx.prompt) {
            const options = ctx.skills.map(s => ({
                label: `${s.name.padEnd(26)} ${s.description}`,
                value: s.name,
            }));
            const INSTALL = '__install__';
            const selected = await ctx.prompt('Skills disponibles:', [
                ...options,
                { label: '+ Instalar pack desde URL...', value: INSTALL },
            ]);

            if (!selected || selected === INSTALL) {
                if (selected === INSTALL) {
                    ctx.emit('Para instalar un pack escribí:\n  /skills install https://skills.sh/owner/repo');
                }
                return;
            }

            const skill = ctx.skills.find(s => s.name === selected);
            if (skill) {
                ctx.emit([
                    `Skill: ${skill.name}`,
                    `Descripción: ${skill.description}`,
                    skill.triggers.length ? `Triggers: ${skill.triggers.join(', ')}` : '',
                    skill.language?.length ? `Lenguajes: ${skill.language.join(', ')}` : '',
                    `Scope: ${skill.scope ?? '—'}`,
                ].filter(Boolean).join('\n'));
            }
        } else {
            const lines = ctx.skills.map(s =>
                `  ${s.name.padEnd(26)} ${s.description}${s.scope === 'project' ? ' [proyecto]' : ''}`,
            );
            ctx.emit('Skills:\n' + lines.join('\n') + SUBCOMMANDS_HINT);
        }
    });

    registry.register('/status', 'Show current agent and model', async (ctx) => {
        ctx.emit([
            `Agent     : ${ctx.effectiveAgentId ?? '—'}`,
            `Model     : ${ctx.model ?? '—'}`,
            `Iteration : ${ctx.getIterationMode?.() ?? '—'}`,
        ].join('\n'));
    });

    registry.register('/iteration', 'Change or show the iteration mode', async (ctx) => {
        type Mode = 'interactive' | 'auto' | 'step-by-step';
        const MODES: Array<{ label: string; value: Mode; description: string }> = [
            { value: 'interactive', label: 'interactive', description: 'Pauses every N iterations — you decide whether to continue' },
            { value: 'auto',        label: 'auto',        description: 'Never pauses — runs until done or global cap (1000)' },
            { value: 'step-by-step',label: 'step-by-step',description: 'Pauses after every single iteration for maximum control' },
        ];

        const current = ctx.getIterationMode?.();

        // Arg directo: /iteration auto | /iteration step-by-step | /iteration interactive
        if (ctx.args) {
            const arg = ctx.args.trim() as Mode;
            if (MODES.some(m => m.value === arg)) {
                ctx.setIterationMode?.(arg);
                ctx.emit(`Iteration mode → ${arg}`);
            } else {
                ctx.emit(`Unknown mode "${arg}". Options: interactive | auto | step-by-step`);
            }
            return;
        }

        // Sin arg: mostrar modo actual y permitir elegir
        if (ctx.prompt) {
            const selected = await ctx.prompt(
                `Iteration mode (current: ${current ?? '—'}):`,
                MODES.map(m => ({
                    label: `${m.value.padEnd(16)} ${m.description}`,
                    value: m.value,
                })),
            );
            if (selected) {
                ctx.setIterationMode?.(selected as Mode);
                ctx.emit(`Iteration mode → ${selected}`);
            }
        } else {
            const lines = MODES.map(m =>
                `  ${(current === m.value ? '▶ ' : '  ')}${m.value.padEnd(16)} ${m.description}`
            );
            ctx.emit(`Iteration mode (current: ${current ?? '—'}):\n${lines.join('\n')}\n\nUse /iteration <mode> to change.`);
        }
    });

    registry.register('/workspace', 'Manage multi-project workspaces', async (ctx) => {
        const { args, emit, appName, injectContext, onCwdChange } = ctx;
        if (!appName) { emit('appName not set in CommandContext.'); return; }

        const parts = (args ?? '').split(' ').filter(Boolean);
        const sub = parts[0];

        // ── /workspace  or  /workspace list ──────────────────────────────────
        if (!sub || sub === 'list') {
            const config = await loadWorkspaces(appName);
            const names = Object.keys(config);
            if (!names.length) {
            emit(
                'No hay workspaces configurados.\n\n' +
                'Comandos disponibles:\n' +
                '  /workspace create <name>               Crear workspace nuevo\n' +
                '  /workspace add <ws> <cwd> [name]       Agregar proyecto existente\n' +
                '  /workspace import <cwd> [ws] [name]    Importar proyecto (crea ws si no existe)\n' +
                '  /workspace switch <ws> [project]       Cambiar workspace/proyecto activo\n' +
                '  /workspace set-root <ws> [path]        Raiz compartida (auto-detecta si no hay path)\n' +
                '  /workspace remove <ws> <project>       Quitar proyecto del workspace\n' +
                '  /workspace delete <name>               Eliminar workspace\n' +
                '  /workspace list                        Listar workspaces',
            );
            return;
        }

            if (ctx.prompt && !sub) {
                // Interactive: let the user pick a workspace+project to switch to directly
                const options = names.flatMap(wsName => {
                    const ws = config[wsName]!;
                    return ws.projects.map(p => ({
                        label: `${wsName.padEnd(18)} ${p.name}${p.name === ws.active ? ' *' : ''}`,
                        value: `${wsName}::${p.name}`,
                    }));
                });
                const selected = await ctx.prompt('Workspaces — select to switch:', options);
                if (!selected) return;
                const [wsName, projectName] = selected.split('::');
                sub === undefined && await doSwitch(wsName, projectName, config, appName, emit, injectContext, onCwdChange);
                return;
            }

            const lines = names.map(n => {
                const ws = config[n]!;
                const projects = ws.projects
                    .map(p => `${p.name}${p.name === ws.active ? '*' : ''}`)
                    .join(', ') || '(vacío)';
                return `  ${n.padEnd(20)} ${projects}`;
            });
            emit(
                'Workspaces (* = proyecto activo):\n' + lines.join('\n') + '\n\n' +
                'Comandos:\n' +
                '  /workspace create <name>               Crear workspace\n' +
                '  /workspace add <ws> <cwd> [name]       Agregar proyecto\n' +
                '  /workspace import <cwd> [ws] [name]    Importar proyecto\n' +
                '  /workspace switch <ws> [project]       Cambiar activo\n' +
                '  /workspace set-root <ws> [path]        Raiz compartida (auto si no hay path)\n' +
                '  /workspace remove <ws> <project>       Quitar proyecto\n' +
                '  /workspace delete <name>               Eliminar workspace',
            );
            return;
        }

        // ── /workspace create <name> ──────────────────────────────────────────
        if (sub === 'create') {
            const name = parts[1];
            if (!name) { emit('Usage: /workspace create <name>'); return; }
            const config = await loadWorkspaces(appName);
            if (config[name]) { emit(`Workspace "${name}" already exists.`); return; }
            await saveWorkspaces(appName, createWorkspace(config, name));
            emit(`Workspace "${name}" created.`);
            return;
        }

        // ── /workspace add <workspace> <cwd> [name] ──────────────────────────
        if (sub === 'add') {
            const [, wsName, cwd, projectName] = parts;
            if (!wsName || !cwd) { emit('Usage: /workspace add <workspace> <cwd> [name]'); return; }
            const resolvedCwd = path.resolve(cwd);
            const name = projectName ?? deriveProjectName(resolvedCwd);
            try {
                const config = await loadWorkspaces(appName);
                await saveWorkspaces(appName, addProject(
                    config[wsName] ? config : createWorkspace(config, wsName),
                    wsName,
                    { name, cwd: resolvedCwd },
                ));
                emit(`Added "${name}" to workspace "${wsName}".\n  cwd: ${resolvedCwd}`);
            } catch (e) { emit(`Error: ${(e as Error).message}`); }
            return;
        }

        // ── /workspace import <cwd> [workspace] [name] ───────────────────────
        // Like add but auto-creates the workspace if missing. Useful for quick onboarding.
        if (sub === 'import') {
            const [, cwd, wsName, projectName] = parts;
            if (!cwd) { emit('Usage: /workspace import <cwd> [workspace] [name]'); return; }
            const resolvedCwd = path.resolve(cwd);
            const name = projectName ?? deriveProjectName(resolvedCwd);
            const ws   = wsName ?? name;
            try {
                const config = await loadWorkspaces(appName);
                await saveWorkspaces(appName, importProject(config, ws, { name, cwd: resolvedCwd }));
                emit(`Imported "${name}" into workspace "${ws}".\n  cwd: ${resolvedCwd}`);
            } catch (e) { emit(`Error: ${(e as Error).message}`); }
            return;
        }

        // ── /workspace remove <workspace> <project> ───────────────────────────
        if (sub === 'remove') {
            const [, wsName, projectName] = parts;
            if (!wsName || !projectName) { emit('Usage: /workspace remove <workspace> <project>'); return; }
            const config = await loadWorkspaces(appName);
            if (!config[wsName]) { emit(`Workspace "${wsName}" not found.`); return; }
            try {
                await saveWorkspaces(appName, removeProject(config, wsName, projectName));
                emit(`Removed "${projectName}" from workspace "${wsName}".`);
            } catch (e) { emit(`Error: ${(e as Error).message}`); }
            return;
        }

        // ── /workspace delete <name> ──────────────────────────────────────────
        if (sub === 'delete') {
            const name = parts[1];
            if (!name) { emit('Usage: /workspace delete <name>'); return; }
            const config = await loadWorkspaces(appName);
            if (!config[name]) { emit(`Workspace "${name}" not found.`); return; }
            await saveWorkspaces(appName, deleteWorkspace(config, name));
            emit(`Workspace "${name}" deleted.`);
            return;
        }

        // ── /workspace switch <workspace> [project] ───────────────────────────
        if (sub === 'switch') {
            const [, wsName, projectName] = parts;
            const config = await loadWorkspaces(appName);

            // No args after switch → interactive picker
            if (!wsName && ctx.prompt) {
                const names = Object.keys(config);
                if (!names.length) { emit('No workspaces configured.'); return; }
                const options = names.flatMap(wn => {
                    const ws = config[wn]!;
                    return ws.projects.map(p => ({
                        label: `${wn.padEnd(18)} ${p.name}${p.name === ws.active ? ' *' : ''}`,
                        value: `${wn}::${p.name}`,
                    }));
                });
                const selected = await ctx.prompt('Switch to:', options);
                if (!selected) return;
                const [selWs, selProject] = selected.split('::');
                await doSwitch(selWs, selProject, config, appName, emit, injectContext, onCwdChange);
                return;
            }

            if (!wsName) { emit('Usage: /workspace switch <workspace> [project]'); return; }
            const ws = config[wsName];
            if (!ws) { emit(`Workspace "${wsName}" not found.`); return; }
            if (!ws.projects.length) { emit(`Workspace "${wsName}" has no projects.`); return; }

            const target = projectName
                ? ws.projects.find(p => p.name === projectName)
                : (ws.projects.find(p => p.name === ws.active) ?? ws.projects[0]);

            if (!target) { emit(`Project "${projectName}" not found in workspace "${wsName}".`); return; }
            await doSwitch(wsName, target.name, config, appName, emit, injectContext, onCwdChange);
            return;
        }

        // ── /workspace set-root <workspace> [path] ────────────────────────────
        // Sets (or auto-detects) the commonRoot for a workspace.
        // With no path arg, auto-detects the common ancestor of all project cwds.
        if (sub === 'set-root') {
            const [, wsName, rootPath] = parts;
            if (!wsName) { emit('Usage: /workspace set-root <workspace> [path]'); return; }
            const config = await loadWorkspaces(appName);
            const ws = config[wsName];
            if (!ws) { emit(`Workspace "${wsName}" not found.`); return; }
            if (!ws.projects.length) { emit(`Workspace "${wsName}" has no projects.`); return; }

            const root = rootPath
                ? path.resolve(rootPath)
                : detectCommonRoot(ws.projects.map(p => p.cwd));

            await saveWorkspaces(appName, setCommonRoot(config, wsName, root));
            emit(`Workspace "${wsName}" common root set to: ${root}\nNext /workspace switch will use this as workingDir.`);
            return;
        }

        emit([
            'Usage:',
            '  /workspace list',
            '  /workspace create <name>',
            '  /workspace add <workspace> <cwd> [name]',
            '  /workspace import <cwd> [workspace] [name]',
            '  /workspace remove <workspace> <project>',
            '  /workspace delete <name>',
            '  /workspace switch [workspace] [project]',
            '  /workspace set-root <workspace> [path]   Set shared root (auto-detected if no path)',
        ].join('\n'));
    });

    registry.register('/checkpoint', 'Create / list / load session checkpoints', async (ctx) => {
        const { args, emit, projectDir, sessionContent, injectContext } = ctx;
        if (!projectDir) { emit('No active project directory.'); return; }

        // /checkpoint list
        if (args === 'list') {
            const all = await listCheckpoints(projectDir);
            if (!all.length) { emit('No checkpoints saved.'); return; }
            const latest = getLatestCheckpoints(all);
            const lines = latest.map((cp, i) => {
                const count = all.filter(c => c.feature === cp.feature).length;
                const label = (cp.feature || '(unnamed)').padEnd(24);
                const timeDisplay = cp.time ? `${cp.time.slice(0, 2)}:${cp.time.slice(2)}` : '';
                const versions = count > 1 ? `  (${count} versions)` : '';
                return `  ${i + 1}. ${label} ${cp.date} ${timeDisplay}${versions}`;
            });
            emit(lines.join('\n'));
            return;
        }

        // /checkpoint load [feature]
        if (args === 'load' || args.startsWith('load ')) {
            const target = args.slice(4).trim();
            const all = await listCheckpoints(projectDir);
            if (!all.length) { emit('No checkpoints saved.'); return; }

            let match = target
                ? all.find(cp => cp.feature === target || cp.feature.includes(target))
                : all[0]; // most recent overall

            if (!match) { emit(`Checkpoint not found: ${target}`); return; }

            const raw = await readCheckpoint(projectDir, match.filename);
            if (raw) {
                const session = extractSessionFromCheckpoint(raw);
                const timeDisplay = match.time ? `${match.time.slice(0, 2)}:${match.time.slice(2)}` : '';
                const label = match.feature || 'unnamed';
                injectContext?.(`## Checkpoint: ${label} (${match.date} ${timeDisplay})\n\n${session}`);
                emit(`Checkpoint loaded: ${label}`);
            }
            return;
        }

        // /checkpoint [name] — create (name optional)
        const featureName = args ?? '';
        const cpPath = await createCheckpoint(projectDir, featureName, '', sessionContent ?? '');
        const label = featureName || '(unnamed)';
        emit(`Checkpoint saved: ${label}\n${cpPath}`);
    });

    // ── /plugin ───────────────────────────────────────────────────────────────
    registry.register('/plugin', 'Manage MCP agent plugins: list, add, remove', async (ctx) => {
        const { args, emit, appName } = ctx;
        const app = appName ?? 'bk-agent';
        const configPath = path.join(getFrameworkDir(app), 'config.json');

        // Provider → base URL mapping (same providers the framework supports)
        const PROVIDER_BASE_URLS: Record<string, string> = {
            deepseek:  'https://api.deepseek.com/v1',
            openai:    'https://api.openai.com/v1',
            anthropic: 'https://api.anthropic.com/v1',
        };

        type KnownPlugin = {
            npm: string;
            description: string;
            /** Default model for each supported provider. Falls back to llmModel if provider not listed. */
            models?: Record<string, string>;
            /** Default model when provider is unknown. */
            llmModel?: string;
        };

        const KNOWN_PLUGINS: Record<string, KnownPlugin> = {
            docker: {
                npm: '@backendkit-labs/docker-agent',
                description: 'Docker containers, Compose, Swarm',
                models: { deepseek: 'deepseek-chat', openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5-20251001' },
                llmModel: 'gpt-4o-mini',
            },
            k8s: {
                npm: '@backendkit-labs/k8s-agent',
                description: 'Kubernetes pods, deployments, services',
                models: { deepseek: 'deepseek-chat', openai: 'gpt-4o-mini', anthropic: 'claude-haiku-4-5-20251001' },
                llmModel: 'gpt-4o-mini',
            },
        };

        type McpEntry = { name: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> };
        interface AppConfig { defaultProvider?: string; mcpServers?: McpEntry[] }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type PluginConfig = AppConfig;

        const readConfig = async (): Promise<AppConfig> => {
            const result = await run(() => fs.readFile(configPath, 'utf-8'));
            if (!isOk(result)) return {};
            try { return JSON.parse(result.value) as AppConfig; } catch { return {}; }
        };

        const writeConfig = async (cfg: AppConfig): Promise<void> => {
            await fs.mkdir(path.dirname(configPath), { recursive: true });
            await atomicWrite(configPath, JSON.stringify(cfg, null, 2));
        };

        const parts = (args ?? '').trim().split(/\s+/).filter(Boolean);
        const sub = parts[0];

        // ── /plugin list ─────────────────────────────────────────────────────
        if (!sub || sub === 'list') {
            const cfg = await readConfig();
            const active = cfg.mcpServers ?? [];
            if (!active.length) {
                const hints = Object.entries(KNOWN_PLUGINS)
                    .map(([id, p]) => `  /plugin add ${id.padEnd(8)} — ${p.description}`)
                    .join('\n');
                emit(`No hay plugins activos.\n\nDisponibles:\n${hints}`);
                return;
            }

            // Enrich with live connection status from the engine when available
            if (ctx.mcpList) {
                const live = await ctx.mcpList();
                const liveMap = new Map(live.map(s => [s.name, s]));
                const lines = active.map(s => {
                    const status = liveMap.get(s.name);
                    const dot    = status?.connected ? '●' : '○';
                    const tools  = status?.connected ? ` (${status.toolCount} tools)` : ' (offline)';
                    return `  ${dot} ${s.name.padEnd(20)}${tools}`;
                });
                emit(`Plugins (${active.length}):\n${lines.join('\n')}\n\nUsa /plugin remove <name> para desactivar.`);
            } else {
                const lines = active.map(s => `  ${s.name.padEnd(20)} ${(s.args ?? []).join(' ')}`);
                emit(`Plugins activos (${active.length}):\n${lines.join('\n')}\n\nUsa /plugin remove <name> para desactivar.`);
            }
            return;
        }

        // ── /plugin add <id|npm-package> ─────────────────────────────────────
        if (sub === 'add') {
            const id = parts[1];
            if (!id) {
                const list = Object.entries(KNOWN_PLUGINS)
                    .map(([k, v]) => `  ${k.padEnd(8)} ${v.npm}  — ${v.description}`)
                    .join('\n');
                emit(`Uso: /plugin add <id>\n\nPlugins conocidos:\n${list}`);
                return;
            }
            const known = KNOWN_PLUGINS[id.toLowerCase()];
            const npmPkg = known?.npm ?? id;
            const name   = known ? id.toLowerCase() : (npmPkg.split('/').pop() ?? npmPkg);

            // npmPkg is spawned through a shell below — accept only valid npm package names.
            if (!/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:@[\w.^~-]+)?$/i.test(npmPkg)) {
                emit(`Nombre de paquete npm inválido: "${npmPkg}".`);
                return;
            }

            const cfg = await readConfig();
            const servers = cfg.mcpServers ?? [];
            if (servers.some(s => s.name === name)) {
                emit(`Plugin "${name}" ya está activo.`);
                return;
            }

            // Install into a dedicated dir so we can run via `node <path>` directly.
            // Using `node` instead of `npx` avoids Windows stdin-pipe forwarding issues
            // that occur when npx wraps the process through cmd.exe.
            const pluginDir = path.join(getFrameworkDir(app), 'plugins', name);
            await fs.mkdir(pluginDir, { recursive: true });

            emit(`Instalando ${npmPkg}... (puede tardar un momento)`);
            const installErr = await new Promise<string | null>((resolve) => {
                const proc = spawn('npm', ['install', npmPkg, '--no-fund', '--no-audit'], {
                    cwd: pluginDir,
                    shell: true,
                    stdio: 'inherit',
                });
                proc.on('close', (code) => resolve(code === 0 ? null : `npm salió con código ${code}`));
                proc.on('error', (e) => resolve((e as Error).message));
            });
            if (installErr) {
                emit(`✗ Error instalando plugin: ${installErr}`);
                return;
            }

            // Read main entry from the package's package.json
            const pkgJsonResult = await run(() =>
                fs.readFile(path.join(pluginDir, 'node_modules', npmPkg, 'package.json'), 'utf-8')
            );
            if (!isOk(pkgJsonResult)) {
                emit(`✗ No se encontró package.json para ${npmPkg}`);
                return;
            }
            const pkgJson = JSON.parse(pkgJsonResult.value) as { main?: string };
            const entryRelative = pkgJson.main ?? 'dist/index.js';
            const entryAbsolute = path.join(pluginDir, 'node_modules', npmPkg, entryRelative);

            // Build LLM env from the app's configured provider so the plugin
            // uses the same LLM stack without the user having to set it manually.
            const provider = cfg.defaultProvider ?? 'openai';
            const baseUrl  = PROVIDER_BASE_URLS[provider] ?? PROVIDER_BASE_URLS['openai']!;
            const model    = known?.models?.[provider] ?? known?.llmModel ?? 'gpt-4o-mini';
            const pluginEnv: Record<string, string> = {
                LLM_PROVIDER: provider,
                LLM_BASE_URL: baseUrl,
                LLM_MODEL:    model,
            };

            servers.push({ name, command: 'node', args: [entryAbsolute], env: pluginEnv });
            await writeConfig({ ...cfg, mcpServers: servers });
            emit(`✓ Plugin "${name}" instalado (${provider} / ${model}).\nReinicia el agente para activarlo.`);
            return;
        }

        // ── /plugin remove <name> ─────────────────────────────────────────────
        if (sub === 'remove') {
            const name = parts[1];
            const cfg = await readConfig();
            const before = cfg.mcpServers ?? [];

            const doRemove = async (target: string): Promise<void> => {
                const after = before.filter(s => s.name !== target);
                await writeConfig({ ...cfg, mcpServers: after });
                // Remove the local install directory if present (node-based plugins)
                const pluginDir = path.join(getFrameworkDir(app), 'plugins', target);
                await fs.rm(pluginDir, { recursive: true, force: true }).catch(() => {});
                emit(`✓ Plugin "${target}" removido.\nReinicia el agente para aplicar el cambio.`);
            };

            if (!name) {
                if (!before.length) { emit('No hay plugins activos.'); return; }
                if (ctx.prompt) {
                    const options = before.map(s => ({ label: s.name, value: s.name }));
                    const selected = await ctx.prompt('Seleccioná el plugin a remover:', options);
                    if (!selected) return;
                    if (!before.some(s => s.name === selected)) { emit(`Plugin "${selected}" no encontrado.`); return; }
                    await doRemove(selected);
                } else {
                    emit(`Uso: /plugin remove <name>\n\nActivos: ${before.map(s => s.name).join(', ')}`);
                }
                return;
            }

            if (!before.some(s => s.name === name)) { emit(`Plugin "${name}" no encontrado.`); return; }
            await doRemove(name);
            return;
        }

        emit('Subcomandos: list | add <id> | remove <name>');
    });
}
