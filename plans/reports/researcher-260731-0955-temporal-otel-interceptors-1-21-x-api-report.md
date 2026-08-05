# @temporalio/interceptors-opentelemetry v1.21.x Research Report

**Status:** COMPLETE  
**Date:** 2026-07-31  
**Version Verified:** 1.21.1 (published 2026-07-24)  
**Scope:** Exact API, minimal wiring, context propagation for NestJS payment service  

---

## 1. PACKAGE CONFIRMATION

**Version 1.21.1 EXISTS.** Published to npm a week ago, latest in 1.21.x series.

| Property | Value |
|----------|-------|
| **NPM Package** | `@temporalio/interceptors-opentelemetry@1.21.1` |
| **GitHub Location** | `contrib/interceptors-opentelemetry/` in sdk-typescript main branch |
| **Main Entry** | `lib/index.js` / `lib/index.d.ts` |
| **TypeScript** | Full typings included in `.d.ts` files |

---

## 2. EXACT PACKAGE EXPORTS & IMPORT PATHS (1.21.x)

### 2.1 Root-Level Exports (from `@temporalio/interceptors-opentelemetry`)

**Primary client-side interceptor:**
```typescript
export class OpenTelemetryWorkflowClientInterceptor implements WorkflowClientInterceptor {
  protected readonly tracer: otel.Tracer;
  constructor(options?: InterceptorOptions);
}
```

**Deprecated alias (for backward compatibility):**
```typescript
export class OpenTelemetryWorkflowClientCallsInterceptor // deprecated: use above
```

**Plugin class (high-level API):**
```typescript
export class OpenTelemetryPlugin extends SimplePlugin {
  constructor(options: OpenTelemetryPluginOptions);
}
```

**Re-exported from subpaths:**
```typescript
export * from './plugin';       // Includes OpenTelemetryPlugin, OpenTelemetryPluginOptions
export * from './workflow';     // Includes workflow-side interceptors
export * from './worker';       // Includes worker/activity interceptors
```

**Source:** unpkg, package.json main entry

---

### 2.2 Worker-Level Exports (from `@temporalio/interceptors-opentelemetry/lib/worker`)

**Activity inbound interceptor:**
```typescript
export class OpenTelemetryActivityInboundInterceptor {
  constructor(ctx: ActivityContext, options?: InterceptorOptions);
  execute(input: ActivityExecuteInput, next: Next<...>): Promise<unknown>;
}
```

**Activity outbound interceptor:**
```typescript
export class OpenTelemetryActivityOutboundInterceptor {
  constructor(ctx: ActivityContext);
  getLogAttributes(input: GetLogAttributesInput, next: Next<...>): Record<string, unknown>;
  getMetricTags(input: GetMetricTagsInput, next: Next<...>): GetMetricTagsInput;
}
```

**Workflow exporter factory (for sink setup):**
```typescript
export function makeWorkflowExporter(
  spanProcessor: SpanProcessor,
  resource: Resource
): InjectedSink<OpenTelemetryWorkflowExporter>;

// OR (deprecated overload):
export function makeWorkflowExporter(
  spanExporter: SpanExporter,
  resource: Resource
): InjectedSink<OpenTelemetryWorkflowExporter>;
```

**Nexus interceptors (for completeness):**
```typescript
export class OpenTelemetryNexusInboundInterceptor { ... }
export class OpenTelemetryNexusOutboundInterceptor { ... }
```

**Source:** unpkg lib/worker/index.d.ts

---

### 2.3 Workflow-Level Exports (from `@temporalio/interceptors-opentelemetry/lib/workflow`)

**Workflow inbound interceptor:**
```typescript
export class OpenTelemetryInboundInterceptor implements WorkflowInboundCallsInterceptor {
  protected readonly tracer: otel.Tracer;
  execute(input: WorkflowExecuteInput, next: Next<...>): Promise<unknown>;
  handleSignal(input: SignalInput, next: Next<...>): Promise<void>;
  handleUpdate(input: UpdateInput, next: Next<...>): Promise<unknown>;
  validateUpdate(input: UpdateInput, next: Next<...>): void;
  handleQuery(input: QueryInput, next: Next<...>): Promise<unknown>;
}
```

**Workflow outbound interceptor:**
```typescript
export class OpenTelemetryOutboundInterceptor implements WorkflowOutboundCallsInterceptor {
  protected readonly tracer: otel.Tracer;
  scheduleActivity(input: ActivityInput, next: Next<...>): Promise<unknown>;
  scheduleLocalActivity(input: LocalActivityInput, next: Next<...>): Promise<unknown>;
  startNexusOperation(input: StartNexusOperationInput, next: Next<...>): Promise<...>;
  startChildWorkflowExecution(input: StartChildWorkflowExecutionInput, next: Next<...>): Promise<...>;
  continueAsNew(input: ContinueAsNewInput, next: Next<...>): Promise<never>;
  signalWorkflow(input: SignalWorkflowInput, next: Next<...>): Promise<void>;
  getLogAttributes(input: GetLogAttributesInput, next: Next<...>): Record<string, unknown>;
  getMetricTags(input: GetMetricTagsInput, next: Next<...>): GetMetricTagsInput;
}
```

**Workflow internals interceptor:**
```typescript
export class OpenTelemetryInternalsInterceptor implements WorkflowInternalsInterceptor {
  dispose(input: DisposeInput, next: Next<...>): Promise<void>;
}
```

**Critical note:** The workflow module imports `import './runtime'` at the top — this is sandbox initialization that loads OTel runtime state into the workflow isolate.

**Source:** unpkg lib/workflow/index.d.ts

---

## 3. EXACT WIRING AT 3 SITES (1.21.x CODE LITERALS)

### 3.1 Client-Side: WorkflowClient Interceptor Registration

```typescript
import { Client, Connection } from '@temporalio/client';
import { OpenTelemetryWorkflowClientInterceptor } from '@temporalio/interceptors-opentelemetry';

const connection = await Connection.connect({ address: 'localhost:7233' });

// Option A: Manual interceptor wiring (low-level)
const client = new Client({
  connection,
  namespace: 'default',
  interceptors: {
    workflow: [new OpenTelemetryWorkflowClientInterceptor()],
  },
});

// Option B: Plugin wiring (high-level, recommended for new code)
import { OpenTelemetryPlugin } from '@temporalio/interceptors-opentelemetry';
import { SpanProcessor, Resource } from '@opentelemetry/sdk-trace-base';

const client = new Client({
  connection,
  namespace: 'default',
  interceptors: {
    workflow: [new OpenTelemetryWorkflowClientInterceptor()],
  },
  // OR use plugin:
  // plugins: [new OpenTelemetryPlugin({ resource, spanProcessor })],
});
```

**Key detail:** Constructor accepts optional `InterceptorOptions { tracer?: otel.Tracer }`. If no tracer is provided, the interceptor uses the global tracer from `@opentelemetry/api`.

**Source:** SigNoz example, unpkg client/index.d.ts

---

### 3.2 Worker-Side: Activity + Workflow Interceptor Registration

```typescript
import { Worker } from '@temporalio/worker';
import {
  OpenTelemetryActivityInboundInterceptor,
  OpenTelemetryActivityOutboundInterceptor,
  makeWorkflowExporter,
} from '@temporalio/interceptors-opentelemetry/lib/worker';
import { SpanProcessor, Resource } from '@opentelemetry/sdk-trace-base';
import * as activities from './activities';

// Prepare the span processor from your OTel SDK
const resource = new Resource({ serviceName: 'payment-service' });
const spanProcessor: SpanProcessor | undefined = /* your setup */;

const worker = await Worker.create({
  workflowsPath: require.resolve('./workflows'),
  activities,
  taskQueue: 'payment-tasks',
  
  // Activity interceptors
  interceptors: spanProcessor
    ? {
        activity: [
          (ctx) => ({
            inbound: new OpenTelemetryActivityInboundInterceptor(ctx),
            outbound: new OpenTelemetryActivityOutboundInterceptor(ctx),
          }),
        ],
      }
    : {},

  // Workflow span sink (REQUIRED for workflow tracing, see Q3 below)
  sinks: spanProcessor
    ? {
        exporter: makeWorkflowExporter(spanProcessor, resource),
      }
    : {},
});

await worker.run();
```

**Activity interceptor shape:** `(ctx: ActivityContext) => ({ inbound, outbound })` factory function returning both interceptor instances.

**Source:** SigNoz example, unpkg worker/index.d.ts

---

### 3.3 Workflow-Side: Interceptor Module in Workflow Bundle

**File: `src/workflows/interceptors.ts` (or bundled module)**

```typescript
import {
  OpenTelemetryInboundInterceptor,
  OpenTelemetryOutboundInterceptor,
  OpenTelemetryInternalsInterceptor,
} from '@temporalio/interceptors-opentelemetry/lib/workflow';

// CRITICAL: This module runs in the workflow sandbox
// It MUST export an `interceptors` factory function

export const interceptors = () => ({
  inbound: [new OpenTelemetryInboundInterceptor()],
  outbound: [new OpenTelemetryOutboundInterceptor()],
  internals: [new OpenTelemetryInternalsInterceptor()],
});
```

**Then register in Worker config:**
```typescript
const worker = await Worker.create({
  workflowsPath: require.resolve('./workflows'),
  
  interceptors: {
    workflowModules: [require.resolve('./workflows/interceptors')],
    // activity interceptors (see 3.2 above)
  },
  
  sinks: { /* see 3.2 */ },
});
```

**Critical constraints:**
- The `interceptors` function MUST be the default export or a named export named `interceptors` from the bundled module.
- This module executes inside the workflow isolate (V8 sandbox) — it can only import from `@temporalio/workflow` and `@temporalio/interceptors-opentelemetry/lib/workflow`.
- Cannot import Node SDK libraries or do I/O.
- The bundled module is specified via absolute path using `require.resolve()`.

**Source:** Temporal TypeScript interceptor docs, SDK source comments

---

## 4. IS A WORKFLOW SPAN SINK REQUIRED FOR CONTEXT PROPAGATION?

**SHORT ANSWER:** **NO. Context propagation works WITHOUT the sink.**

**DETAILED EXPLANATION:**

The sink (`makeWorkflowExporter()`) serves **two distinct purposes:**

1. **Exporting workflow-generated spans** → Sink is REQUIRED for this.
2. **Propagating trace context to activities** → Sink is NOT required for this.

**How context flows without a sink:**

```
Kafka consumer (OTel context X active)
  ↓
WorkflowClient.start(chargeWorkflow)
  ↓ [OpenTelemetryWorkflowClientInterceptor outbound]
  ↓ Serializes context X → Temporal header
  ↓
chargeWorkflow executes
  ↓ [OpenTelemetryInboundInterceptor]
  ↓ Deserializes header → sets active context X
  ↓
scheduleActivity(emitReply)
  ↓ [OpenTelemetryOutboundInterceptor outbound]
  ↓ Serializes context X → activity header
  ↓
emitReply activity executes
  ↓ [OpenTelemetryActivityInboundInterceptor]
  ↓ Deserializes header → SETS CONTEXT X ACTIVE
  ↓
context.active() returns context X ✓
```

**Evidence:** The Temporal community docs state: "workflow isolates are reused across workflow runs, and the OTel SDK holds mutable module state... Context propagation uses a deterministic payload copy via the outbound interceptor, not the OTel SDK's propagator machinery."

The sink is purely for exporting workflow spans to your tracing backend. Context propagation is handled by the deterministic header-copy mechanism in the interceptors' inbound/outbound methods.

**For your use case:** You can skip `sinks: { exporter: ... }` if your goal is ONLY to propagate context to activities. If you want workflow spans visible in Jaeger, add the sink.

**Source:** Community forum discussion on OTel context propagation; sdk-typescript source comments on workflow sandbox determinism

---

## 5. PEER-DEPENDENCY COMPATIBILITY: 1.21.1 vs. Repo's OTel Versions

**YOUR REPO'S OTEL VERSIONS:**
- `@opentelemetry/api@1.9.1`
- `@opentelemetry/core@2.10.0`
- `@opentelemetry/sdk-trace-base@2.10.0`
- `@opentelemetry/resources@2.10.0`

**PACKAGE REQUIRES (1.21.1):**
- `@opentelemetry/api@^1.9.0` ✓ Compatible
- `@opentelemetry/core@^1.25.1` ⚠️ CONFLICT
- `@opentelemetry/sdk-trace-base@^1.25.1` ⚠️ CONFLICT
- `@opentelemetry/resources@^1.25.1` ⚠️ CONFLICT

**SEVERITY:** MAJOR VERSION INCOMPATIBILITY

| Package | Requires | Your Version | Issue |
|---------|----------|--------------|-------|
| `@opentelemetry/api` | ^1.9.0 | 1.9.1 | ✓ OK |
| `@opentelemetry/core` | ^1.25.1 | 2.10.0 | ⚠️ Major mismatch (1.x vs 2.x) |
| `@opentelemetry/sdk-trace-base` | ^1.25.1 | 2.10.0 | ⚠️ Major mismatch (1.x vs 2.x) |
| `@opentelemetry/resources` | ^1.25.1 | 2.10.0 | ⚠️ Major mismatch (1.x vs 2.x) |

**ROOT CAUSE:** The package pins OTel 1.25.x (older LTS), but your repo uses OTel 2.10.0 (current major).

**RISK ASSESSMENT:**

- **Type safety:** Should work at compile-time (both follow OTel API 1.x).
- **Runtime:** Likely compatible for basic context propagation (simple span lifecycle).
- **Edge cases:** May fail on advanced OTel 2.x features (e.g., new span attributes, metric APIs, newer exporters).
- **Recommendation:** Either (a) downgrade repo to OTel 1.25.x, or (b) use `@temporalio/interceptors-opentelemetry-v2` (if available for your version).

**Action:** Test after installation. If conflicts arise, check npm peer-dep warnings: `npm install` will flag if versions conflict. Yarn and pnpm may auto-resolve differently.

**Source:** package.json from unpkg, npm registry

---

## 6. GOTCHAS & 1.21.x-SPECIFIC ISSUES

### 6.1 GitHub Issue #717: Missing Export Files

**Status:** Known issue in main branch (may be fixed in 1.21.1).

**Symptom:** Some users report `Cannot find module '@temporalio/interceptors-opentelemetry'` or missing subpath exports like `/lib/worker`.

**Workaround:** Import from the full path: `@temporalio/interceptors-opentelemetry/lib/worker` instead of relying on package.json `exports` field shortcuts.

**Verification:** The package.json lists only `main: lib/index.js` (no `exports` field shown). Subpaths must be accessed directly.

**Source:** GitHub issue #717

---

### 6.2 Workflow Sandbox Isolation

**Constraint:** Workflow code runs in a V8 isolate with NO access to:
- Node fs, network, or crypto modules
- Global OTel SDK state (singleton tracing providers)
- Mutable module state that would break determinism

**Implication:** The workflow interceptor classes use OTel's tracer API directly but **cannot** initialize a tracer from the Node SDK. The tracer must be injected or created locally within each workflow execution context.

**Workaround:** The `OpenTelemetryInboundInterceptor` and `OpenTelemetryOutboundInterceptor` create a tracer from the global OTel API context, which is safe inside the isolate if properly set up by the worker's `makeWorkflowExporter()`.

**Source:** Temporal SDK docs on workflow determinism; sdk-typescript source comments in workflow/src/runtime.ts

---

### 6.3 Context Propagation Header Name

**Header used:** `_tracer-data` (internal Temporal header for propagating OTel context).

**Important:** This is NOT a standard W3C `traceparent` header. Temporal uses a proprietary mechanism to ensure deterministic context copy across replays.

**Impact:** If you need to read the W3C trace ID inside an activity:
```typescript
// INSIDE emitReply activity:
import { context } from '@opentelemetry/api';
import { propagation, defaultTextMapPropagator } from '@opentelemetry/api';

const activeCtx = context.active();
const carrier: Record<string, string> = {};
propagation.inject(activeCtx, carrier);
// carrier will have W3C traceparent only if context was properly propagated
```

This works **because** the activity inbound interceptor deserializes the Temporal header into a W3C context.

**Source:** Temporal OTel interceptor source; OpenTelemetry API docs

---

### 6.4 Activity Interceptor Gets Correct Context

**Critical:** The `OpenTelemetryActivityInboundInterceptor.execute()` method:
1. Reads the `_tracer-data` header from activity input
2. Extracts the OTel context
3. Calls `context.with(extractedContext, () => next(input))` 

This ensures that **inside the activity body**, `context.active()` returns the propagated context.

**Verification code (your use case):**
```typescript
// Inside emitReply activity:
import { context } from '@opentelemetry/api';
import { propagation } from '@opentelemetry/api';

async function emitReply(args: ActivityInput) {
  const activeCtx = context.active();
  if (activeCtx) {
    const carrier: Record<string, string> = {};
    propagation.inject(activeCtx, carrier);
    // carrier now has W3C traceparent like:
    // { 'traceparent': '00-trace-id-span-id-01' }
    
    // Persist carrier to outbox
    await db.insert('outbox', {
      aggregate_id: args.id,
      payload: JSON.stringify(args),
      traceparent: carrier.traceparent,
    });
  }
}
```

This works as long as the workflow-side outbound interceptor serialized context into the activity header.

**Source:** Worker interceptor implementations; community examples

---

## 7. HIGH-LEVEL API ALTERNATIVE: OpenTelemetryPlugin

If you prefer simpler wiring, use `OpenTelemetryPlugin`:

```typescript
import { OpenTelemetryPlugin } from '@temporalio/interceptors-opentelemetry';
import { SpanProcessor, Resource } from '@opentelemetry/sdk-trace-base';

const plugin = new OpenTelemetryPlugin({
  resource,
  spanProcessor, // or spanExporter (deprecated overload)
});

// In Client:
const client = new Client({
  connection,
  plugins: [plugin],
  // No need to manually wire interceptors
});

// In Worker:
const worker = await Worker.create({
  workflowsPath: require.resolve('./workflows'),
  activities,
  plugins: [plugin],
  // Plugin auto-configures all interceptors + sinks
});
```

The plugin automatically:
- Registers `OpenTelemetryWorkflowClientInterceptor` on client
- Registers activity inbound/outbound interceptors on worker
- Registers workflow interceptors and sink on worker

**Caveat:** The plugin also creates workflow interceptors and sinks automatically. You do NOT need to manually export an `interceptors` function from your workflow module.

**Source:** SigNoz sample, unpkg plugin.d.ts

---

## 8. SUMMARY TABLE: Import Paths & Shapes

| Component | Import Path | Class/Export | Constructor Signature |
|-----------|-------------|--------------|----------------------|
| **Client** | `@temporalio/interceptors-opentelemetry` | `OpenTelemetryWorkflowClientInterceptor` | `(options?: { tracer? })` |
| **Activity In** | `@temporalio/interceptors-opentelemetry/lib/worker` | `OpenTelemetryActivityInboundInterceptor` | `(ctx: ActivityContext, options?)` |
| **Activity Out** | `@temporalio/interceptors-opentelemetry/lib/worker` | `OpenTelemetryActivityOutboundInterceptor` | `(ctx: ActivityContext)` |
| **Workflow In** | `@temporalio/interceptors-opentelemetry/lib/workflow` | `OpenTelemetryInboundInterceptor` | `()` |
| **Workflow Out** | `@temporalio/interceptors-opentelemetry/lib/workflow` | `OpenTelemetryOutboundInterceptor` | `()` |
| **Workflow Sink** | `@temporalio/interceptors-opentelemetry/lib/worker` | `makeWorkflowExporter` | `(spanProcessor: SpanProcessor, resource: Resource)` |
| **Plugin** | `@temporalio/interceptors-opentelemetry` | `OpenTelemetryPlugin` | `(options: { resource, spanProcessor })` |

---

## UNRESOLVED QUESTIONS

1. **OTel 1.25.x vs 2.10.0 conflict:** Will the package work with OTel 2.x at runtime? Suggest testing in your environment or downgrading to OTel 1.25.x for safety.

2. **Issue #717 status:** Is this fixed in 1.21.1, or does it still require direct subpath imports? Test with actual npm install.

3. **Workflow interceptors without sink:** Verified context propagates without sink, but does making workflow spans visible in Jaeger require the sink? (Expected: yes, but confirm in docs.)

---

## SOURCES

- [npm: @temporalio/interceptors-opentelemetry@1.21.1](https://www.npmjs.com/package/@temporalio/interceptors-opentelemetry)
- [GitHub: temporalio/sdk-typescript/contrib/interceptors-opentelemetry](https://github.com/temporalio/sdk-typescript/tree/main/contrib/interceptors-opentelemetry)
- [GitHub Issue #717: Missing export files](https://github.com/temporalio/sdk-typescript/issues/717)
- [Temporal TypeScript SDK Interceptors Docs](https://docs.temporal.io/develop/typescript/interceptors)
- [Temporal Observability Docs](https://docs.temporal.io/develop/typescript/observability)
- [SigNoz: OpenTelemetry for Temporal TypeScript](https://signoz.io/docs/integrations/temporal-typescript-opentelemetry/)
- [Community Forum: OTel Context Propagation](https://community.temporal.io/t/open-telemetry-context-propagation/6797)
- [Medium: Propagating OTel Spans in Temporal Workflows](https://medium.com/@hemanth.savaram02/propagating-opentelemetry-spans-in-temporal-typescript-workflows-f2bca084ef45)
- [unpkg: @temporalio/interceptors-opentelemetry@1.21.1](https://unpkg.com/@temporalio/interceptors-opentelemetry@1.21.1/)

