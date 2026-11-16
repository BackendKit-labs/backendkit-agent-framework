import type { AgentEvent, RunResult, RunToolCall } from '../types';

/** Collects the events of one turn into the `RunResult` that `engine.run` returns. */
export class RunRecorder {
    private text = '';
    private readonly toolCalls: RunToolCall[] = [];
    private readonly errors: string[] = [];
    private readonly systemPrompts: string[] = [];
    private budgetExceeded = false;

    push(event: AgentEvent): void {
        switch (event.type) {
            case 'token': this.text += event.content; break;
            case 'tool_result':
                this.toolCalls.push({
                    name: event.name, success: event.success,
                    ...(event.agent_id ? { agentId: event.agent_id } : {}),
                    ...(event.error_code ? { errorCode: event.error_code } : {}),
                    ...(event.outcome ? { outcome: event.outcome } : {}),
                    ...(event.preview ? { preview: event.preview } : {}),
                });
                this.text = ''; // what the agent says is what comes after its last tool call
                break;
            case 'error': this.errors.push(event.message); break;
            case 'system_prompt': this.systemPrompts.push(event.text); break;
            case 'budget_exceeded': this.budgetExceeded = true; break;
            default: break;
        }
    }

    markBudgetExceeded(): void {
        this.budgetExceeded = true;
    }

    result(aborted: boolean): RunResult {
        return {
            text: this.text.trim(), toolCalls: this.toolCalls, errors: this.errors, aborted,
            budgetExceeded: this.budgetExceeded, systemPrompts: this.systemPrompts,
        };
    }
}
