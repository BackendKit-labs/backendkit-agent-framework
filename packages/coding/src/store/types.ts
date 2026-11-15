export interface SessionUpdates {
    /** Replace the Current Feature section — what is being worked on + progress */
    feature?: string;
    /** Append bullets to Decisions — key choices made (accumulates over time) */
    decisions?: string[];
    /** Replace Active Issues section — current blockers or open items */
    issues?: string[];
    /** Append bullets to Engine Learnings — non-obvious codebase discoveries (accumulates) */
    learnings?: string[];
    /** Replace Next Steps section — what needs to happen after this */
    next_steps?: string[];
}

export interface ProjectStoreData {
    /** Absolute path to the project memory directory (~/.{appName}/projects/{key}). Read-only. */
    readonly projectDir?: string;
    appendContext(content: string): void;
    appendLearning(content: string): void;
    saveAudit(agentId: string, content: string): void;
    getContext(): string;
    getLearnings(): string;
    /** Returns combined global + project agent-notes for a given agent id. */
    getAgentNotes?(agentId: string): string;
    listAudits(): string[];
    getLatestAudit(agentId: string): string | null;
    appendUserPreference(content: string): void;
    updateSession(updates: SessionUpdates): void;
}
