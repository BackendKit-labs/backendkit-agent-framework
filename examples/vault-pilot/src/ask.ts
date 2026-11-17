/**
 * Ask a department agent a question, with a real model. The agent searches its own folders of the vault and answers
 * from what it finds.
 *
 *   npm run ask                                   # HR: how long is parental leave?
 *   npm run ask -- finance "Who approves a 7000 EUR expense?"
 *   npm run ask -- sales "How much discount can I give?"
 *
 * Agents: general, support, hr, sales, finance, ops. The key is read from DEEPSEEK_API_KEY and never printed.
 */
import 'dotenv/config';
import { CallbackTransport, ProviderRegistry } from '@backendkit-labs/agent-core';
import { createEnterpriseSetup } from '@backendkit-labs/agent-enterprise';
import { DeepSeekProvider } from '@backendkit-labs/agent-providers';
import { makeWorkspace } from './vault';

const DEFAULTS: Record<string, string> = {
  hr: 'How long is parental leave for the birth parent, and how do I ask for it?',
  finance: 'Who has to approve an expense of 7000 EUR?',
  sales: 'How much discount can I give a customer without asking anyone?',
  support: 'A customer wants a refund 10 days after delivery. What do I do?',
  general: 'What are the office hours?',
};

async function main(): Promise<void> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) { console.error('Set DEEPSEEK_API_KEY (see .env.example). `npm run check` needs no key.'); process.exit(2); }
  const agent = process.argv[2] ?? 'hr';
  const question = process.argv.slice(3).join(' ') || DEFAULTS[agent] || DEFAULTS.general;

  const provider = new DeepSeekProvider({ apiKey: key, model: process.env.LLM_MODEL });
  const providers = new ProviderRegistry();
  providers.register('main', provider);
  providers.register('local', provider);       // HR and finance ask for a local model; here they share the cloud one

  const ws = makeWorkspace();
  const setup = createEnterpriseSetup({ ...ws, providers, defaultProvider: 'main' });
  console.log('Indexing the sample vault...');
  await setup.indexAll();

  let tokens = 0;
  const transport = new CallbackTransport(e => {
    if (e.type === 'tool_call') console.log(`\n[${agent}] ${e.name}(${(e.args_preview ?? '').slice(0, 90)})`);
    if (e.type === 'tool_result') console.log(`   ${e.success ? 'found' : 'refused'}: ${(e.preview ?? '').split('\n').filter(Boolean)[1] ?? ''}`);
    if (e.type === 'token') process.stdout.write(e.content);
    if (e.type === 'metrics') tokens += e.input_tokens + e.output_tokens;
  });
  const engine = setup.engineFactory(`ask-${Date.now()}`, transport);
  engine.switchAgent(agent);

  console.log(`\nQuestion to ${agent}: ${question}\n`);
  await engine.run(question);
  console.log(`\n\n(${tokens} tokens)`);
}

main().catch(e => { console.error(String((e as Error).message ?? e).replace(/sk-[A-Za-z0-9]+/g, 'sk-***')); process.exit(1); });
