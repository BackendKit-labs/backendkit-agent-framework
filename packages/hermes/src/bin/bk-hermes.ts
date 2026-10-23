#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { FleetConfigError, parseFleet } from '../fleet/schema';
import { FleetRegistry } from '../fleet/FleetRegistry';
import { applyPreset, loadPresetModule, PresetError } from '../presets/applyPreset';

const USAGE = `bk-hermes — control plane for a fleet of agents

  bk-hermes validate <fleet.yaml>   check the file; errors name the path
  bk-hermes fleet <fleet.yaml>      check every agent once and show its state
`;

function load(file: string | undefined) {
    if (!file) { console.error(USAGE); process.exit(2); }
    try {
        return parseFleet(readFileSync(file, 'utf8'));
    } catch (err) {
        if (err instanceof FleetConfigError) console.error(err.message);
        else console.error(`Cannot read ${file}: ${(err as Error).message}`);
        process.exit(1);
    }
}

async function main(argv: string[]): Promise<void> {
    const [command, file] = argv;
    if (command === 'validate') {
        let fleet = load(file);
        // presets are part of what the file means: check the fleet as it will be once they are merged
        const baseDir = dirname(resolve(file!));
        for (const entry of fleet.presets ?? []) {
            try {
                const { presets: _presets, ...rest } = fleet;
                const applied = applyPreset(rest as typeof fleet, loadPresetModule(entry.module, baseDir, entry.options), { ...(entry.grants ? { grants: entry.grants as never } : {}), ...(entry.roleMap ? { roleMap: entry.roleMap } : {}) });
                fleet = { ...applied.fleet, presets: fleet.presets };
                for (const note of applied.notes) console.log(`note: ${note}`);
            } catch (err) {
                console.error(err instanceof PresetError ? err.message : `Preset "${entry.module}": ${(err as Error).message}`);
                process.exit(1);
            }
        }
        console.log(`ok: fleet "${fleet.fleet}", ${fleet.agents.length} agent(s)`);
    } else if (command === 'fleet') {
        const fleet = load(file);
        if (fleet.agents.some(a => a.connector.kind === 'in-process')) {
            console.error('This fleet has in-process agents: they exist only inside the program that registers them.');
            process.exit(1);
        }
        const registry = new FleetRegistry(fleet);
        await registry.checkNow();
        for (const a of registry.list()) {
            console.log(`${a.id.padEnd(24)} ${a.health.state.padEnd(9)} ${a.health.latencyMs ?? '-'} ms ${a.health.detail ?? ''}`.trimEnd());
        }
        process.exit(registry.list().some(a => a.health.state === 'down') ? 1 : 0);
    } else {
        console.error(USAGE);
        process.exit(command ? 2 : 0);
    }
}

void main(process.argv.slice(2));
