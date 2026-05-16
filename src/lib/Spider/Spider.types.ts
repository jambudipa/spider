import { Option } from 'effect';
import { NetworkError, RequestAbortError, ResponseError } from '../errors/effect-errors.js';

export type PageFetchErrorKind =
  | 'timeout'
  | 'dns'
  | 'http_4xx'
  | 'http_429'
  | 'http_5xx'
  | 'connection_refused'
  | 'other';

export interface PageFetchError {
  readonly kind: PageFetchErrorKind;
  readonly durationMs: number;
  readonly statusCode?: number;
  readonly message: string;
  readonly attemptsMade: number;
}

export const classifyFetchError = (
  error: unknown,
  durationMs: number,
  attemptsMade: number
): PageFetchError => {
  if (
    (error instanceof Error && error.name === 'TimeoutException') ||
    error instanceof RequestAbortError
  ) {
    return { kind: 'timeout', durationMs, attemptsMade, message: String(error) };
  }
  if (error instanceof NetworkError) {
    const statusOpt = Option.fromNullable(error.statusCode);
    if (Option.isSome(statusOpt)) {
      const status = statusOpt.value;
      if (status >= 500)
        return { kind: 'http_5xx', durationMs, attemptsMade, statusCode: status, message: error.message };
      if (status === 429)
        return { kind: 'http_429', durationMs, attemptsMade, statusCode: status, message: error.message };
      if (status >= 400)
        return { kind: 'http_4xx', durationMs, attemptsMade, statusCode: status, message: error.message };
    }
    const causeStr = String(error.cause ?? '');
    // Adapter sentinels are checked first so a caller-supplied error
    // message containing raw `ENOTFOUND`/`ECONNREFUSED` substrings cannot
    // override an explicit adapter classification.
    if (causeStr.includes('[adapter-kind:dns:'))
      return { kind: 'dns', durationMs, attemptsMade, message: error.message };
    if (causeStr.includes('[adapter-kind:connection_refused:'))
      return { kind: 'connection_refused', durationMs, attemptsMade, message: error.message };
    if (
      causeStr.includes('ENOTFOUND') ||
      causeStr.includes('ENONAME') ||
      causeStr.includes('WSAHOST_NOT_FOUND') ||
      causeStr.includes('getaddrinfo')
    ) return { kind: 'dns', durationMs, attemptsMade, message: error.message };
    if (causeStr.includes('ECONNREFUSED'))
      return { kind: 'connection_refused', durationMs, attemptsMade, message: error.message };
    return { kind: 'other', durationMs, attemptsMade, message: error.message };
  }
  if (error instanceof ResponseError) {
    const causeStr = String(error.cause ?? '');
    if (causeStr.includes('ECONNREFUSED'))
      return { kind: 'connection_refused', durationMs, attemptsMade, message: error.message };
    return { kind: 'other', durationMs, attemptsMade, message: error.message };
  }
  return { kind: 'other', durationMs, attemptsMade, message: String(error) };
};
