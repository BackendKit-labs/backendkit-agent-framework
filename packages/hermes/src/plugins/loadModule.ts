import { isAbsolute, resolve } from 'node:path';
import type { HermesPlugin } from './types';

/**
 * Loads a plugin from a path or package name written in the fleet file. Relative paths and package names are resolved from
 * `baseDir` (the directory of the fleet file or of the project), not from where Hermes happens to be installed.
 *
 * Plugins are CommonJS modules. They export the plugin, `default` the plugin, or a function that takes the entry's `options`
 * and returns it. (An ES-module-only package cannot be `require`d on every Node version Hermes supports; build it as CommonJS,
 * or pass the plugin object to Hermes from code.)
 */
export function loadPluginModule(spec: string, baseDir: string, options: Record<string, unknown> = {}): HermesPlugin {
    let path: string;
    try {
        path = spec.startsWith('.') || isAbsolute(spec) ? require.resolve(resolve(baseDir, spec)) : require.resolve(spec, { paths: [baseDir] });
    } catch (err) {
        throw new Error(`cannot find plugin module "${spec}" from ${baseDir}: ${(err as Error).message.split('\n')[0]}`);
    }
    let mod: unknown;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require(path);
    } catch (err) {
        const code = (err as { code?: string }).code;
        throw new Error(code === 'ERR_REQUIRE_ESM'
            ? `plugin module "${spec}" is an ES module; plugins must be CommonJS (or be passed to Hermes as an object from code)`
            : `plugin module "${spec}" failed to load: ${(err as Error).message.split('\n')[0]}`);
    }
    const exported = (mod as { default?: unknown } | undefined)?.default ?? mod;
    return (typeof exported === 'function' ? (exported as (o: Record<string, unknown>) => HermesPlugin)(options) : exported) as HermesPlugin;
}
