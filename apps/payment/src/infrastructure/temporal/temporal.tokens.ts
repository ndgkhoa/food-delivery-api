/** DI token for the connected Temporal client `Connection` (closed on shutdown). */
export const TEMPORAL_CONNECTION = Symbol('TemporalConnection');

/** DI token for the Temporal `WorkflowClient` used to start + signal workflows. */
export const WORKFLOW_CLIENT = Symbol('TemporalWorkflowClient');
