#!/usr/bin/env node
/**
 * build-images.mjs — builds Docker images for all marketing-co agents.
 *
 * Usage:
 *   node build-images.mjs              # build all
 *   node build-images.mjs seo-agent    # build a single agent
 *   node build-images.mjs --push       # build + push to registry
 *
 * Images are tagged as: mcp/marketing-co/<agent>:latest
 */

import { execSync } from 'node:child_process';
import * as path    from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AGENTS = [
    { name: 'content-strategist', script: 'content-strategist.mjs' },
    { name: 'copywriter',         script: 'copywriter.mjs' },
    { name: 'seo-agent',          script: 'seo-agent.mjs' },
    { name: 'social-media-agent', script: 'social-media-agent.mjs' },
    { name: 'campaign-agent',     script: 'campaign-agent.mjs' },
    { name: 'analytics-agent',    script: 'analytics-agent.mjs' },
];

const args    = process.argv.slice(2);
const doPush  = args.includes('--push');
const filter  = args.filter(a => !a.startsWith('--'));
const targets = filter.length > 0
    ? AGENTS.filter(a => filter.includes(a.name))
    : AGENTS;

if (targets.length === 0) {
    console.error(`[build-images] Unknown agent(s): ${filter.join(', ')}`);
    console.error(`  Available: ${AGENTS.map(a => a.name).join(', ')}`);
    process.exit(1);
}

console.log(`[build-images] Building ${targets.length} image(s)${doPush ? ' (+ push)' : ''}...\n`);

let failed = 0;
for (const agent of targets) {
    const tag = `mcp/marketing-co/${agent.name}:latest`;
    console.log(`▶ ${tag}`);

    try {
        execSync(
            `docker build --build-arg AGENT_SCRIPT=${agent.script} -t ${tag} .`,
            { cwd: __dirname, stdio: 'inherit' },
        );
        if (doPush) {
            execSync(`docker push ${tag}`, { cwd: __dirname, stdio: 'inherit' });
        }
        console.log(`✓ ${tag}\n`);
    } catch (err) {
        console.error(`✗ ${tag} — ${err.message}\n`);
        failed++;
    }
}

if (failed > 0) {
    console.error(`[build-images] ${failed} build(s) failed.`);
    process.exit(1);
} else {
    console.log(`[build-images] All images built successfully.`);
    console.log(`\nTo run a single agent locally:`);
    console.log(`  docker run --rm -p 3310:8080 -e VAULT_PATH=/vault mcp/marketing-co/content-strategist:latest`);
    console.log(`\nTo register with the platform, set image field in orchestrator.yaml`);
    console.log(`(already configured: see apps/marketing-co/orchestrator.yaml)`);
}
