"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepSeekProvider = void 0;
const openai_1 = __importDefault(require("openai"));
class DeepSeekProvider {
    client;
    model;
    maxTokens;
    temperature;
    constructor(opts) {
        this.client = new openai_1.default({
            apiKey: opts.apiKey,
            baseURL: opts.baseUrl ?? 'https://api.deepseek.com/v1',
        });
        this.model = opts.model ?? 'deepseek-chat';
        this.maxTokens = opts.maxTokens ?? 8192;
        this.temperature = opts.temperature ?? 0.0;
    }
    async chat(messages, tools, callbacks) {
        try {
            const openaiTools = tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                },
            }));
            const stream = await this.client.chat.completions.create({
                model: this.model,
                messages: messages,
                tools: openaiTools.length > 0 ? openaiTools : undefined,
                tool_choice: openaiTools.length > 0 ? 'auto' : undefined,
                max_tokens: this.maxTokens,
                temperature: this.temperature,
                stream: true,
            });
            let contentBuffer = '';
            const toolCallBuffers = new Map();
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                if (!delta)
                    continue;
                if (delta.content) {
                    contentBuffer += delta.content;
                    callbacks.onChunk?.(delta.content);
                }
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index;
                        if (!toolCallBuffers.has(idx)) {
                            toolCallBuffers.set(idx, { id: tc.id ?? '', name: '', args: '' });
                        }
                        const buf = toolCallBuffers.get(idx);
                        if (tc.id)
                            buf.id = tc.id;
                        if (tc.function?.name)
                            buf.name += tc.function.name;
                        if (tc.function?.arguments)
                            buf.args += tc.function.arguments;
                    }
                }
            }
            const toolCalls = Array.from(toolCallBuffers.entries())
                .sort(([a], [b]) => a - b)
                .map(([, buf]) => ({
                id: buf.id,
                type: 'function',
                function: { name: buf.name, arguments: buf.args },
            }));
            for (const tc of toolCalls) {
                callbacks.onToolCall?.(tc.function.name, tc.function.arguments, tc.id);
            }
            callbacks.onDone({
                role: 'assistant',
                content: contentBuffer || null,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            });
        }
        catch (err) {
            callbacks.onError(err instanceof Error ? err : new Error(String(err)));
        }
    }
}
exports.DeepSeekProvider = DeepSeekProvider;
//# sourceMappingURL=DeepSeekProvider.js.map