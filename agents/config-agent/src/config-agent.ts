import 'dotenv/config';
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { CallbackTransport, type AgentEngine } from '@backendkit-labs/agent-core';
import { createEngine } from './engine.js';
import { tools } from './tools.js';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

async function main(): Promise<void> {
  if (process.argv.includes('--serve-ui')) {
    const { serveConfigUi } = await import('./web/server.js');
    const result = await serveConfigUi({});
    console.log(`\n🔧 Config-Agent UI iniciado en ${result.url}\n`);
    return; // No iniciar modo MCP
  }

  // Flag --validate-all
  if (process.argv.includes('--validate-all')) {
    const { readdirSync, existsSync } = await import('fs');
    const { resolve } = await import('path');
    const { homedir } = await import('os');
    const { readVersion } = await import('./storage/versionedStore.js');
    const { readSchema } = await import('./storage/schemaStore.js');
    const { validateConfig } = await import('./services/validator.js');
    const { inferSchema } = await import('./services/inferer.js');

    const dataDir = process.env.CONFIG_DATA_DIR || resolve(homedir(), '.backendkit', 'config');
    const agentsDir = resolve(dataDir, 'agents');

    console.log('\n🔧 Validando todos los agentes...\n');

    if (!existsSync(agentsDir)) {
      console.log('  No hay agentes registrados aún.');
      process.exit(0);
    }

    const agents = readdirSync(agentsDir).filter(f => existsSync(resolve(agentsDir, f, 'current')));
    let totalOk = 0;
    let totalFail = 0;

    for (const agent of agents) {
      const configVersion = readVersion(agent, 'current');
      if (!configVersion) {
        console.log(`  ❌ ${agent}: no se pudo leer la configuración`);
        totalFail++;
        continue;
      }
      let schema = readSchema(agent);
      if (!schema) schema = inferSchema(configVersion.config);
      const result = validateConfig(configVersion.config, schema);
      const icon = result.status === 'valid' ? '✅' : result.status === 'incomplete' ? '⚠️' : '❌';
      console.log(`  ${icon} ${agent}: ${result.passed}/${result.passed + result.failed} checks OK`);
      if (result.missingRequired.length > 0) {
        console.log(`       Faltan: ${result.missingRequired.join(', ')}`);
      }
      if (result.status === 'valid') totalOk++;
      else totalFail++;
    }

    console.log(`\n  Resumen: ${totalOk} OK, ${totalFail} con problemas\n`);
    process.exit(0);
  }

  // Flag --detect-env
  if (process.argv.includes('--detect-env')) {
    const { readdirSync, existsSync } = await import('fs');
    const { resolve } = await import('path');
    const { homedir } = await import('os');
    const { detectEnv } = await import('./tools/detectEnv.js');

    const dataDir = process.env.CONFIG_DATA_DIR || resolve(homedir(), '.backendkit', 'config');
    const agentsDir = resolve(dataDir, 'agents');

    console.log('\n🔧 Detectando variables de entorno...\n');

    if (!existsSync(agentsDir)) {
      console.log('  No hay agentes registrados aún.');
      process.exit(0);
    }

    const agents = readdirSync(agentsDir).filter(f => existsSync(resolve(agentsDir, f, 'current')));

    for (const agent of agents) {
      const result = await detectEnv({ agent_id: agent, save: true, mode: 'merge' });
      console.log(`  ${agent}: ${result.detected} vars detectadas`);
      if (result.new.length > 0) console.log(`    + Nuevas: ${result.new.map(n => n.key).join(', ')}`);
      if (result.updated.length > 0) console.log(`    ~ Actualizadas: ${result.updated.map(u => u.key).join(', ')}`);
      if (result.conflicts.length > 0) console.log(`    ⚠ Conflictos: ${result.conflicts.map(c => c.key).join(', ')}`);
    }

    console.log(`\n  ✅ Detección completada\n`);
    process.exit(0);
  }

  // Flag --export
  const exportIndex = process.argv.indexOf('--export');
  if (exportIndex !== -1 && process.argv[exportIndex + 1]) {
    const agentId = process.argv[exportIndex + 1];
    const formatIndex = process.argv.indexOf('--format');
    const format = formatIndex !== -1 && process.argv[formatIndex + 1] ? process.argv[formatIndex + 1] : 'env';

    const { readVersion } = await import('./storage/versionedStore.js');
    const configVersion = readVersion(agentId, 'current');

    if (!configVersion) {
      console.error(`Error: El agente '${agentId}' no existe o no tiene configuración.`);
      process.exit(1);
    }

    if (format === 'json') {
      console.log(JSON.stringify(configVersion.config, null, 2));
    } else {
      for (const [key, value] of Object.entries(configVersion.config)) {
        console.log(`${key}=${value}`);
      }
    }
    process.exit(0);
  }

  if (process.argv.includes('--test-all')) {
    console.log('\n🔧 Config-Agent — Diagnóstico\n');
    console.log('  ✅ Config-Agent iniciado correctamente');
    console.log(`  📁 Data dir: ${process.env.CONFIG_DATA_DIR || '~/.backendkit/config'}`);
    console.log(`  📦 Tools registradas: ${tools.length}`);

    console.log('\n--- Tools de lectura ---');
    const lectura = ['get_config', 'list_configs', 'diff_config', 'get_config_schema'];
    for (const name of lectura) {
      console.log(`  📋 ${name}: registrada`);
    }

    console.log('\n--- Tools de escritura ---');
    const escritura = ['set_config', 'set_secret', 'import_config', 'restore_config', 'commit_config'];
    for (const name of escritura) {
      console.log(`  📋 ${name}: registrada`);
    }

    console.log('\n--- Tools de operación ---');
    const operacion = ['validate_config', 'reload_config', 'detect_env'];
    for (const name of operacion) {
      console.log(`  📋 ${name}: registrada`);
    }

    console.log(`\n  ✅ Modo diagnóstico completado (${tools.length} tools)`);
    process.exit(0);
  }

  const server = new AgentMCPServer({
    name: 'config-agent',
    tools: tools as unknown as AgentToolDef[],
    engineFactory: (transport: CallbackTransport) => createEngine(transport) as unknown as AgentEngine,
  });

  await server.startStdio();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
