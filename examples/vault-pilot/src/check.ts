/**
 * Offline checks: no model, no key, no network. A scripted model plays the part of the LLM, so what is checked is the
 * wiring the framework provides: what each department agent can reach in the vault.
 *
 *   npm run check
 */
import assert from 'node:assert/strict';
import { ProviderRegistry, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { createEnterpriseSetup, ENTERPRISE_TOOLS } from '@backendkit-labs/agent-enterprise';
import { mockTransport, scriptedProvider } from '@backendkit-labs/agent-testkit';
import { makeWorkspace, type Workspace } from './vault';

/** A department agent is asked something; the scripted model calls one tool with one query, then answers. */
async function callTool(ws: Workspace, agent: string, tool: string, query: string, extra: { globalExcludeFolders?: string[] } = {}) {
  const model = scriptedProvider([
    { tool_calls: [{ id: 'c1', name: tool, args: { query } }] },
    { content: 'done' },
  ]);
  const providers = new ProviderRegistry();
  providers.register('main', model);
  providers.register('local', model);            // HR and finance are configured to use a local model
  const setup = createEnterpriseSetup({ ...ws, providers, defaultProvider: 'main', maxIterations: 4, agentIdentity: selfAssertedIdentities(), identity: { userId: process.env.USERNAME ?? process.env.USER ?? 'me' }, ...extra });
  await setup.indexAll();

  const t = mockTransport();
  const engine = setup.engineFactory(`check-${agent}-${Date.now()}`, t.transport);
  engine.switchAgent(agent);
  const result = await engine.run(query);
  const call = result.toolCalls[0];
  // What the model got back: the second call to the model carries the full result of the tool call.
  const text = (model.calls[1] ?? []).filter(m => m.role === 'tool').map(m => String(m.content ?? '')).join('\n');
  return { call, text };
}

let passed = 0;
let failed = 0;
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${(e as Error).message.split('\n').join('\n       ')}`); }
}

async function main(): Promise<void> {
  console.log('vault-pilot: department agents over a shared vault\n');
  const ws = makeWorkspace();

  await check('HR answers from its own folder', async () => {
    const { call, text } = await callTool(ws, 'hr', ENTERPRISE_TOOLS.SEARCH_HR, 'How long is parental leave?');
    assert.equal(call.success, true);
    assert.match(text, /16 weeks/);
  });

  await check('a department also sees the shared folders: general and policies', async () => {
    const { text } = await callTool(ws, 'hr', ENTERPRISE_TOOLS.SEARCH_HR, 'personal data of employees confidential');
    assert.match(text, /Data handling policy|confidential/i);
  });

  await check('Sales cannot reach HR content through its own search', async () => {
    const question = 'parental leave weeks birth parent';
    const hr = await callTool(ws, 'hr', ENTERPRISE_TOOLS.SEARCH_HR, question);
    assert.match(hr.text, /16 weeks/, 'control: the same question does find the note when HR asks');
    const sales = await callTool(ws, 'sales', ENTERPRISE_TOOLS.SEARCH_SALES, question);
    assert.equal(sales.call.success, true);
    assert.doesNotMatch(sales.text, /16 weeks|parental leave policy/i);
  });

  await check('Sales cannot even call the HR search tool', async () => {
    const { call } = await callTool(ws, 'sales', ENTERPRISE_TOOLS.SEARCH_HR, 'parental leave');
    assert.equal(call.success, false, 'the call is refused: the tool is not one of the agent\'s allowed tools');
  });

  await check('Finance answers from its own folder, not from Support', async () => {
    const { text } = await callTool(ws, 'finance', ENTERPRISE_TOOLS.SEARCH_FINANCE, 'who approves an expense above 5000 EUR');
    assert.match(text, /CFO/);
    assert.doesNotMatch(text, /refund/i);
  });

  // The General agent answers with the default provider, which may be remote: what it can search is what that provider may see. HR and Finance
  // (whose agents use a local model) are out of its reach by default, and the operator can say otherwise.
  await check('the General agent does NOT see HR or Finance by default: what it retrieves goes to the default provider', async () => {
    const { call, text } = await callTool(ws, 'general', ENTERPRISE_TOOLS.SEARCH_GENERAL, 'parental leave');
    assert.equal(call.success, true);
    assert.doesNotMatch(text, /16 weeks/);
  });

  await check('with globalExcludeFolders: [] the General agent searches the whole vault, as the operator chose', async () => {
    const { text } = await callTool(ws, 'general', ENTERPRISE_TOOLS.SEARCH_GENERAL, 'parental leave', { globalExcludeFolders: [] });
    assert.match(text, /16 weeks/);
  });



  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
