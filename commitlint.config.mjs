// Conventional Commits with a mandatory scope, e.g. `feat(catalog): add restaurant CRUD`.
// Scope list mirrors the bounded contexts + shared libs defined in development-workflow.md.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-empty': [2, 'never'],
    'scope-enum': [
      2,
      'always',
      [
        'gateway',
        'auth',
        'catalog',
        'search',
        'order',
        'inventory',
        'payment',
        'delivery',
        'notification',
        'media',
        'analytics',
        'review',
        'config',
        'shared-config',
        'shared-logging',
        'shared-auth',
        'shared-tenancy',
        'shared-audit',
        'shared-messaging',
        'shared-contracts',
        'shared-errors',
        'shared-testing',
        'infra',
        'ci',
      ],
    ],
  },
};
