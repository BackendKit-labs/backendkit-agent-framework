import { join } from 'node:path';
import {
    FileApprovalStore, NdjsonRunJournal, createApprovalHandler, parseFlow, runFlow,
    type AgentEngine, type ApproverDirectory, type FlowResult, type StepExecutor, type ToolPolicy,
} from '@backendkit-labs/agent-core';
import { EXECUTOR, REBALANCER } from './agents';

/**
 * The rebalance as a FLOW: a process that survives a restart and stops for a person. Two steps. The rebalancer computes the orders; a person looks at
 * the plan and decides; only then does the executor send them (and each order is still governed by the executor's power, so one above its limit asks
 * again). The flow is data: the framework runs it, journals it and resumes it.
 */
export const REBALANCE_FLOW = `
flow: rebalance
version: 1
trigger: { type: manual }
steps:
  - id: plan
    agent: ${REBALANCER}
    prompt: "Compute the orders that bring the portfolio back to its target allocation"
  - id: execute
    agent: ${EXECUTOR}
    prompt: "Send the orders of the plan, exactly as given"
    after: [plan]
    gate: { approval: human }
`;

/**
 * How a step runs is the executor you pass: here, the agent the step names, on the engine of the advisor. It is the pattern of the docs (a
 * `StepExecutor` is a function); the steps are one after the other, so one engine serves them. What the agent does is governed as always.
 */
export function engineStepExecutor(engine: AgentEngine): StepExecutor {
    return {
        async run(step, input) {
            engine.switchAgent(step.agent);
            const result = await engine.run(input.context ? `${input.prompt}\n\nWhat the previous steps produced:\n${input.context}` : input.prompt);
            return { content: result.text };
        },
    };
}

/**
 * Who may approve the plan: a person of finance. The flow asks the policy about the step as `flow.step:<id>`; its `ask` names the role, and the flow
 * (and the handler a supervisor decides through) check it against the directory. Nothing else is needed: it is the same `approverRoles` as an order.
 */
export const planNeedsFinance: ToolPolicy = {
    decide: (_principal, call) => (call.tool.name === 'flow.step:execute'
        ? { effect: 'ask', reason: 'the plan is approved by a person of finance before anything is sent', accepts: ['human'], approverRoles: ['finance'] }
        : { effect: 'allow' }),
};

export interface RebalanceRun {
    engine: AgentEngine;
    /** Where the run keeps its journal and its approvals. The same directory after a restart is what makes the run resume. */
    dir: string;
    runId: string;
    /** The person the run acts for: who asked. Four eyes is on: they cannot approve their own plan. */
    userId: string;
    /** Who the people are and their roles: what the roles of the plan are checked against. */
    directory: ApproverDirectory;
}

/** Starts the rebalance, or resumes it when the same `runId` and `dir` already have a record. */
export function runRebalance(run: RebalanceRun): Promise<FlowResult> {
    return runFlow(parseFlow(REBALANCE_FLOW), {
        executor: engineStepExecutor(run.engine),
        journal: new NdjsonRunJournal(join(run.dir, 'journal')),
        approvals: {
            store: approvalStore(run.dir), identity: { userId: run.userId }, policy: planNeedsFinance,
            approverDirectory: run.directory, forbidSelfApproval: true,
        },
        runId: run.runId,
        payload: {},
    });
}

export const approvalStore = (dir: string) => new FileApprovalStore(join(dir, 'approvals'));

/**
 * What a supervisor (a console, an MCP client, another process) decides the plan through. It checks the same rules as the flow, so a bad decision is
 * refused where it is made and the request stays open for someone who may decide it; the flow checks it again when it goes on.
 */
export const approvalHandler = (dir: string, directory: ApproverDirectory) =>
    createApprovalHandler(approvalStore(dir), { approverDirectory: directory, forbidSelfApproval: true });
