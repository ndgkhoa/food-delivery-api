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
