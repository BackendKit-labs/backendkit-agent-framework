import { defineTool, z } from '@backendkit-labs/agent-core';
import { routeLearning } from '../store/LearningRouter';

export const saveLearningTool = defineTool({
    name: 'save_learning',
    description: [
        'Save a learning from this session. The system classifies it automatically and routes it to the right destination:',
        '- tool_quirk  → agent-notes/{agent}.md  (specific behavior of a tool or library)',
        '- skill       → skills/{name}.yaml       (reusable step-by-step process)',
        '- project     → contexto-proyecto.md     (architectural decision or project fact)',
        '- user        → USER.md                  (user preference or working style)',
        '- session     → discarded                (ephemeral, not worth persisting)',
        'Duplicates are detected and skipped automatically.',
    ].join('\n'),
    input: z.object({
        content: z.string().min(1).describe('The learning to save (concrete and specific)'),
    }),
    execute: async ({ content }, ctx) => {
        if (!ctx.store) return 'Error: no persistent store configured';
        if (!ctx.llmCall) {
            // Fallback: no LLM available, append to legacy learnings.md
            ctx.store.appendLearning(content);
            return 'Learning saved (no router available).';
        }

        const store = ctx.store as import('../store/ProjectStore').ProjectStore;

        const result = await routeLearning(content, {
            projectDir: store.projectDir,
            homeDir:    store.homeDir,
            llm:        ctx.llmCall,
            emit:       ctx.emitCompacting,
        });

        if (result.skipped) {
            return `Learning skipped (${result.type === 'session' ? 'ephemeral' : 'duplicate'}) → ${result.target}`;
        }
        return `Learning saved [${result.type}] → ${result.target}`;
    },
});
