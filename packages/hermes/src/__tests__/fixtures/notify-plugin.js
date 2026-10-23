'use strict';
// A plugin written as a plain CommonJS module, loaded by path from a fleet file (see plugins.test.ts).
const { defineTool, z } = require('@backendkit-labs/agent-core');

module.exports = function createPlugin(options) {
    return {
        name: 'notify',
        version: '1.2.3',
        requires: { tools: ['notify_send'], events: ['fleet.gap'] },
        setup(api) {
            // the fleet file is data (JSON), so what the test watches is shared through a global rather than through `options`
            const sent = globalThis.__notifySent;
            if (options.prefix) sent.push(options.prefix);
            api.registerTool(defineTool({
                name: 'notify_send',
                description: 'Tell the operators something (test double).',
                input: z.object({ text: z.string() }),
                execute: async ({ text }) => { sent.push(text); return 'sent'; },
            }));
            api.on('fleet.gap', (e) => { sent.push('gap:' + e.need); });
        },
    };
};
