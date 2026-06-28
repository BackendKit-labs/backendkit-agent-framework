// Quick manual test — run with: node test-manual.mjs
import { GraphStore } from './dist/indexer/graph-store.js';
import { CodeIndexer } from './dist/indexer/indexer.js';
import { detectStackFromGraph } from './dist/indexer/stack-detector.js';
import { codeSearch } from './dist/tools/code/search.js';
import { codeContext } from './dist/tools/code/context.js';
import { skillsList } from './dist/tools/skills/list.js';
import { skillsSearch } from './dist/tools/skills/search.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const CWD = 'C:/Users/mairon.cuello/development/workspace-ia/agent-framework';
const APP_NAME = 'deepseek-code';

const dbDir = path.join(os.homedir(), `.${APP_NAME}`, 'code-index');
fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'test-agent-framework.db');

console.log('\n=== BK MCP Server — Manual Test ===\n');

// 1. Index
console.log('1. Indexing agent-framework...');
const store = new GraphStore(dbPath);
const indexer = new CodeIndexer(store, CWD);
const result = await indexer.indexDirectory(CWD);
console.log(`   Indexed: ${result.files} files, ${result.symbols} symbols`);
const stats = store.stats();
console.log(`   DB: ${stats.nodes} nodes, ${stats.edges} edges, ${stats.files} files\n`);

// 2. Stack detection
console.log('2. Stack detection...');
const stack = detectStackFromGraph(store);
console.log(`   Graph stack: ${stack.join(', ') || '(none yet)'}\n`);

// 3. code_search
console.log('3. code_search("SkillManager")...');
const searchResults = codeSearch('SkillManager', store, 5);
for (const r of searchResults) {
    console.log(`   [${r.kind}] ${r.name} — ${r.filePath.split('/').slice(-2).join('/')}:${r.startLine}`);
}

// 4. code_search — another query
console.log('\n4. code_search("activate")...');
const activateResults = codeSearch('activate', store, 5);
for (const r of activateResults) {
    console.log(`   [${r.kind}] ${r.name} — ${r.filePath.split('/').slice(-2).join('/')}:${r.startLine}`);
}

// 5. code_context
console.log('\n5. code_context("install skill from github")...');
const ctx = await codeContext('install skill from github', store, 3);
console.log(`   Found ${ctx.symbols.length} relevant symbols:`);
for (const s of ctx.symbols) {
    console.log(`   [${s.kind}] ${s.name} (${s.filePath.split('/').slice(-1)[0]}:${s.startLine})`);
    if (s.calls.length) console.log(`     calls: ${s.calls.slice(0,3).join(', ')}`);
    if (s.calledBy.length) console.log(`     calledBy: ${s.calledBy.slice(0,3).join(', ')}`);
}

// 6. skills_list
console.log('\n6. skills_list()...');
const packs = await skillsList(APP_NAME);
for (const p of packs) {
    console.log(`   ${p.pack} (${p.builtin ? 'builtin' : 'external'}) — ${p.skills.length} skills`);
}

// 7. skills_search
console.log('\n7. skills_search("retry")...');
const skillResults = await skillsSearch('retry', CWD, APP_NAME);
for (const s of skillResults) {
    console.log(`   ${s.name} [${s.scope}${s.active ? ', ACTIVE' : ''}] — ${s.description.slice(0,60)}`);
}

store.close();
console.log('\n=== Done ===');
