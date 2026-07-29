export interface ConfigValueResponse {
  key: string;
  value: number;
}

/** One entry in `GET /api/v1/config` — `scope` says whether the effective value came from the tenant's own override or the global default. */
export interface ConfigValueListItemResponse {
  key: string;
  value: number;
  scope: 'tenant' | 'global';
}
