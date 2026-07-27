export interface Pagination {
  page: number;
  limit: number;
}

export interface PageResult<T> {
  data: T[];
  total: number;
}

export interface PaginatedResult<T> extends PageResult<T> {
  page: number;
  limit: number;
}
