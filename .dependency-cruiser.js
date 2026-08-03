/**
 * Enforces bounded-context isolation across the Nx monorepo:
 * - apps (services) may never import another app's internals directly (only via HTTP/gRPC contracts)
 * - libs may never import from apps (dependency direction must flow apps -> libs)
 * - no circular dependencies anywhere in the graph
 * This replaces `@nx/enforce-module-boundaries` per architecture.md §8 (Biome cannot express this).
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make services hard to reason about and break in isolation.',
      from: {},
      // Type-only import cycles are erased at compile time (safe); only flag runtime cycles.
      to: { circular: true, viaOnly: { dependencyTypesNot: ['type-only'] } },
    },
    {
      name: 'no-cross-app-imports',
      severity: 'error',
      comment:
        "Bounded contexts must not import each other's internals — communicate over REST/gRPC/events instead. " +
        '`<app>-e2e` projects are exempt from the "from" side since their sole purpose is exercising their own app in-process.',
      from: { path: '^apps/(?!.*-e2e/)([^/]+)/src' },
      to: {
        path: '^apps/([^/]+)/src',
        pathNot: '^apps/$1/src',
      },
    },
    {
      name: 'no-lib-importing-app',
      severity: 'error',
      comment: 'Shared libs must stay app-agnostic; apps depend on libs, never the reverse.',
      from: { path: '^libs' },
      to: { path: '^apps' },
    },
    {
      name: 'domain-stays-pure',
      severity: 'error',
      comment:
        'Hexagonal: domain is the innermost layer — it must not depend on application, infrastructure, or interface (nor any framework). Keeps business rules testable in isolation.',
      from: { path: '^apps/[^/]+/src/domain/' },
      to: { path: '^apps/[^/]+/src/(application|infrastructure|interface)/' },
    },
    {
      name: 'application-no-outward-deps',
      severity: 'error',
      comment:
        'Hexagonal: application (use cases) may depend on domain only — never on infrastructure adapters or the interface/delivery layer.',
      from: { path: '^apps/[^/]+/src/application/' },
      to: { path: '^apps/[^/]+/src/(infrastructure|interface)/' },
    },
    {
      name: 'interface-not-infrastructure',
      severity: 'error',
      comment:
        'Hexagonal: the interface/delivery layer talks to application (and domain types), never directly to infrastructure adapters. Wiring happens at the composition root.',
      from: { path: '^apps/[^/]+/src/interface/' },
      to: { path: '^apps/[^/]+/src/infrastructure/' },
    },
    {
      name: 'workflow-code-no-app-layers',
      severity: 'error',
      comment:
        'Temporal workflow code runs in a sandboxed isolate: it must import only @temporalio/workflow and pure local types — never the domain/application/infrastructure/interface layers, whose IO/config would break deterministic replay.',
      from: { path: '^apps/[^/]+/src/workflows/', pathNot: '\\.spec\\.ts$' },
      to: { path: '^apps/[^/]+/src/(domain|application|infrastructure|interface|activities)/' },
    },
    {
      name: 'workflow-code-only-temporal-npm',
      severity: 'error',
      comment:
        'Temporal workflow code must not pull in any npm package other than @temporalio/workflow — Nest/TypeORM/config in the sandbox would make workflow execution non-deterministic.',
      from: { path: '^apps/[^/]+/src/workflows/', pathNot: '\\.spec\\.ts$' },
      to: { dependencyTypes: ['npm'], pathNot: 'node_modules/@temporalio/workflow/' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    reporterOptions: {
      text: {
        highlightFocused: true,
      },
    },
  },
};
