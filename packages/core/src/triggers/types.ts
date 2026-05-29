export type TriggerConfig = ScheduleTriggerConfig | WebhookTriggerConfig | EventTriggerConfig;

export interface ScheduleTriggerConfig {
    type: 'schedule';
    /** Standard 5-field cron expression (e.g. '0 9 * * 1-5'). */
    cron: string;
    /** Prompt passed to engine.run() each time the schedule fires. */
    task: string;
    /** IANA timezone (e.g. 'America/New_York'). Defaults to system timezone. */
    timezone?: string;
}

export interface WebhookTriggerConfig {
    type: 'webhook';
    /** URL path to listen on (e.g. '/github/pr'). Must start with '/'. */
    path: string;
    /** HMAC-SHA256 secret for GitHub-style signature verification (X-Hub-Signature-256). */
    secret?: string;
    /**
     * Build the prompt from the request body and headers.
     * Defaults to a JSON dump of the body prefixed with the path.
     */
    buildPrompt?: (body: unknown, headers: Record<string, string>) => string;
}

export interface EventTriggerConfig {
    type: 'event';
    /** Topic name to subscribe to (e.g. 'ci.failed'). */
    topic: string;
    /** Only fire when the event payload's source field matches. */
    source?: string;
    /**
     * Build the prompt from the event payload.
     * Defaults to a JSON dump prefixed with the topic.
     */
    buildPrompt?: (payload: unknown) => string;
}
