#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { FleetConfigError, parseFleet } from '../fleet/schema';
import { FleetRegistry } from '../fleet/FleetRegistry';

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
        const fleet = load(file);
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
