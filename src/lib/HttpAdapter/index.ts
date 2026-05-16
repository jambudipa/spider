export type {
  HttpAdapter,
  HttpAdapterRequest,
  HttpAdapterResponse,
  HttpAdapterError,
  HttpAdapterSelector,
} from './HttpAdapter.types.js';
// `resolveAdapter` is intentionally re-exported here for in-package use
// (ScraperService imports it) but is NOT re-exported from `src/index.ts`.
export { resolveAdapter } from './HttpAdapter.types.js';
export { defaultUndiciAdapter } from './defaultUndiciAdapter.js';
