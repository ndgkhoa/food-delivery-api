export interface ConfigValueResponse {
  key: string;
  value: number;
}

export interface ConfigValueListItemResponse {
  key: string;
  value: number;
  scope: 'tenant' | 'global';
}
