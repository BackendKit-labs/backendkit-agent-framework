'use strict';
// A preset written as a plain CommonJS module and loaded by path from a fleet file (see presets.test.ts).
// Its one agent is a hand-written connector, so the module needs nothing from Hermes.
module.exports = function createPreset(options) {
    return {
        name: 'module-preset',
        version: '1.0.0',
        agents: [{ id: 'echo', connector: { kind: 'in-process' }, access: { roles: ['reader'], approval: 'never' } }],
        connectors: {
            echo: () => ({
                kind: 'in-process',
                describe: async () => ({ name: 'echo', capabilities: [{ name: 'say', description: 'says ' + options.word, async: false }] }),
                health: async () => ({ state: 'ok', latencyMs: 0 }),
                run: async (request) => ({
                    connectorRunId: 'echo-1',
                    result: async () => ({ status: 'done', output: options.word + ':' + JSON.stringify(request.input) }),
                    status: async () => 'done',
                    cancel: async () => undefined,
                }),
            }),
        },
    };
};
