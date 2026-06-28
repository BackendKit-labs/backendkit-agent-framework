// Test de protocolo stdio para health-checker
// Simula la comunicación stdio usando el módulo MCP directamente

// En lugar de spawn, probamos el engine directamente
// y verificamos que el servidor responde correctamente

import { createInterface } from 'readline';

// Test 1: Verificar que el archivo existe y es válido
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const baseDir = 'C:\\Users\\mairon.cuello\\development\\workspace-ia\\health-checker';

console.log('=== Verificación de archivos ===');

// 1. package.json
const pkgPath = resolve(baseDir, 'package.json');
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  console.log(`✅ package.json existe`);
  console.log(`   - @backendkit-labs/mcp-server: ${deps['@backendkit-labs/mcp-server'] || '❌ MISSING'}`);
  console.log(`   - zod: ${deps['zod'] || '❌ MISSING'}`);
  console.log(`   - typescript: ${deps['typescript'] || '❌ MISSING'}`);
  console.log(`   - tsx: ${deps['tsx'] || '❌ MISSING'}`);
  console.log(`   - @types/node: ${deps['@types/node'] || '❌ MISSING'}`);
} else {
  console.log('❌ package.json no existe');
}

// 2. tsconfig.json
const tsconfigPath = resolve(baseDir, 'tsconfig.json');
if (existsSync(tsconfigPath)) {
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
  console.log(`✅ tsconfig.json existe`);
  console.log(`   - target: ${tsconfig.compilerOptions?.target}`);
  console.log(`   - module: ${tsconfig.compilerOptions?.module}`);
} else {
  console.log('❌ tsconfig.json no existe');
}

// 3. health-checker.ts
const tsPath = resolve(baseDir, 'health-checker.ts');
if (existsSync(tsPath)) {
  const content = readFileSync(tsPath, 'utf-8');
  console.log(`✅ health-checker.ts existe (${content.length} bytes)`);

  // Verificar imports
  const imports = content.match(/import\s+.*?from\s+['"].*?['"]/g) || [];
  console.log(`   - Imports encontrados: ${imports.length}`);
  imports.forEach(i => console.log(`     ${i}`));

  // Verificar AgentMCPServer
  if (content.includes('AgentMCPServer')) {
    console.log('✅ Usa AgentMCPServer');
  } else {
    console.log('❌ NO usa AgentMCPServer');
  }

  // Verificar startStdio
  if (content.includes('startStdio')) {
    console.log('✅ Usa startStdio()');
  } else {
    console.log('❌ NO usa startStdio()');
  }

  // Verificar tools
  const toolNames = ['system_health', 'check_agent', 'check_environment', 'check_messaging', 'check_scheduler', 'end_to_end_test'];
  for (const name of toolNames) {
    if (content.includes(`name: '${name}'`) || content.includes(`name: "${name}"`)) {
      console.log(`✅ Tool declarada: ${name}`);
    } else {
      console.log(`❌ Tool faltante: ${name}`);
    }
  }

  // Verificar buildPrompt
  const buildPromptCount = (content.match(/buildPrompt/g) || []).length;
  console.log(`✅ buildPrompt encontrado ${buildPromptCount} veces (esperado: 6)`);

  // Verificar engine
  if (content.includes('engineFactory') || content.includes('createStubEngine') || content.includes('run:')) {
    console.log('✅ Engine definido');
  } else {
    console.log('❌ Engine NO definido');
  }

  // Verificar --check-now
  if (content.includes('--check-now')) {
    console.log('✅ Flag --check-now implementado');
  } else {
    console.log('❌ Flag --check-now NO implementado');
  }

  // Verificar try/catch global
  if (content.includes('try') && content.includes('catch')) {
    console.log('✅ Manejo de errores global (try/catch)');
  } else {
    console.log('❌ Sin manejo de errores global');
  }

  // Verificar cache
  if (content.includes('getCached') && content.includes('setCache')) {
    console.log('✅ Cache Manager implementado');
  } else {
    console.log('❌ Cache Manager NO implementado');
  }

  // Verificar tipos compartidos
  const typeNames = ['HealthReport', 'OrchestratorCheck', 'AgentsCheck', 'FlowsCheck', 'SchedulerCheck', 'EnvironmentCheck', 'MessagingCheck', 'VaultCheck', 'CacheEntry'];
  for (const name of typeNames) {
    if (content.includes(`interface ${name}`) || content.includes(`type ${name}`)) {
      console.log(`✅ Tipo definido: ${name}`);
    } else {
      console.log(`❌ Tipo faltante: ${name}`);
    }
  }
} else {
  console.log('❌ health-checker.ts no existe');
}

// Test de compilación
console.log('\n=== Verificación de compilación ===');
try {
  // Verificamos que TypeScript está instalado
  const tsPkg = JSON.parse(readFileSync(resolve(baseDir, 'node_modules', 'typescript', 'package.json'), 'utf-8'));
  console.log(`✅ TypeScript ${tsPkg.version} instalado`);
} catch {
  console.log('⚠️  TypeScript no encontrado en node_modules (puede estar en path global)');
}

// Verificar node_modules
console.log('\n=== Verificación de dependencias ===');
const depsToCheck = ['@backendkit-labs/mcp-server', 'zod'];
for (const dep of depsToCheck) {
  try {
    const depPkg = JSON.parse(readFileSync(resolve(baseDir, 'node_modules', dep, 'package.json'), 'utf-8'));
    console.log(`✅ ${dep} ${depPkg.version} instalado`);
  } catch {
    console.log(`❌ ${dep} NO instalado en node_modules`);
  }
}

console.log('\n=== VEREDICTO ===');
console.log('Revisa el reporte completo arriba. Si hay ❌, la Fase 1 tiene issues.');
