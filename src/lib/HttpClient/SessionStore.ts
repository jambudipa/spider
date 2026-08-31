/**
 * Session Store Service
 * Manages user sessions including cookies, tokens, and authentication state
 */

import { Context, Data, DateTime, Effect, HashMap, Layer, Option, Random, Ref, Schema } from 'effect';
import { CookieManager } from './CookieManager.js';
import { TokenType } from '../StateManager/StateManager.service.js';

// ============================================================================
// Error Types
// ============================================================================

/** Identifies a session operation that cannot complete with the current store state. */
export class SessionError extends Data.TaggedError('SessionError')<{
  readonly sessionId?: string;
  readonly operation: string;
  readonly cause?: unknown;
}> {
  /** Produces the stable human-readable error text from the stored operation and session id. */
  get message(): string {
    return `Session operation '${this.operation}' failed${
      this.sessionId ? ` for session ${this.sessionId}` : ''
    }`;
  }

  /** Creates the load failure used when the requested id is absent from memory. */
  static notFound(id: string): SessionError {
    return new SessionError({
      sessionId: id,
      operation: 'load',
      cause: `Session ${id} not found`
    });
  }

  /** Creates the load failure used when the stored expiration time has passed. */
  static expired(id: string): SessionError {
    return new SessionError({
      sessionId: id,
      operation: 'load',
      cause: `Session ${id} has expired`
    });
  }

  /** Creates the failure used by operations that require a selected session. */
  static noActive(): SessionError {
    return new SessionError({
      operation: 'access',
      cause: 'No active session'
    });
  }

  /** Wraps invalid serialized session data at the import or export boundary. */
  static parseError(cause: unknown): SessionError {
    return new SessionError({
      operation: 'import',
      cause: `Invalid session JSON: ${cause}`
    });
  }

  /** Wraps data that passed JSON decoding but cannot become a live session. */
  static reconstructError(cause: unknown): SessionError {
    return new SessionError({
      operation: 'import',
      cause: `Failed to reconstruct session: ${cause}`
    });
  }

  /** Creates the export failure used when no session is selected. */
  static exportError(): SessionError {
    return new SessionError({
      operation: 'export',
      cause: 'No active session to export'
    });
  }
}

// ============================================================================
// Schema Definitions
// ============================================================================

/** Validates the JSON-safe `[token type, token value]` representation. */
const TokenEntrySchema = Schema.Tuple([Schema.String, Schema.String]);

/** Validates the persisted session shape before reconstruction. */
const SerializedSessionSchema = Schema.Struct({
  id: Schema.String,
  cookies: Schema.String,
  tokens: Schema.Array(TokenEntrySchema),
  userData: Schema.OptionFromOptional(Schema.Record(Schema.String, Schema.Unknown)),
  createdAt: Schema.String,
  lastUsedAt: Schema.String,
  expiresAt: Schema.OptionFromOptional(Schema.String)
});

/** JSON-safe session form used only at the persistence boundary. */
type SerializedSession = typeof SerializedSessionSchema.Type;

/** Lists runtime token discriminators because persisted JSON loses the enum type. */
const tokenTypeValues: ReadonlyArray<string> = [
  TokenType.CSRF,
  TokenType.API,
  TokenType.AUTH,
  TokenType.REFRESH
];

/** Narrows a persisted string to a token type that the state manager accepts. */
const isTokenType = (value: string): value is TokenType => {
  return tokenTypeValues.includes(value);
};

/** Rejects persisted token pairs whose discriminator is no longer supported. */
const isValidTokenTuple = (
  entry: readonly [string, string]
): entry is readonly [TokenType, string] => {
  return isTokenType(entry[0]);
};

// ============================================================================
// Session Types
// ============================================================================

/** Mutable crawl-session state held in the in-memory store. */
export interface Session {
  /** Store key and stable identifier used by callers to reload the session. */
  id: string;
  /** Serialized tough-cookie jar for restoring the request context. */
  cookies: string;
  /** Authentication and anti-forgery tokens indexed by their purpose. */
  tokens: HashMap.HashMap<TokenType, string>;
  /** Caller-owned metadata preserved when session data is updated. */
  userData: Option.Option<Record<string, unknown>>;
  /** UTC time when this session first entered the store. */
  createdAt: DateTime.Utc;
  /** UTC time of the most recent read or write through this service. */
  lastUsedAt: DateTime.Utc;
  /** UTC expiry, or none when the session does not expire automatically. */
  expiresAt: Option.Option<DateTime.Utc>;
}

/** Credentials supplied by an authentication workflow before a session exists. */
export interface Credentials {
  /** Account identifier accepted by the target authentication endpoint. */
  username: string;
  /** Secret used by the target authentication endpoint. */
  password: string;
  /** Target-specific fields that do not fit the username/password pair. */
  additionalFields: Record<string, unknown>;
}

/**
 * In-memory session API that keeps cookies and session metadata synchronized.
 *
 * A service instance owns its session map. Provide a fresh layer when tests or
 * concurrent crawls require isolated session state.
 */
export interface SessionStoreService {
  /**
   * Create a new session
   */
  createSession: (_id?: string) => Effect.Effect<Session>;

  /**
   * Get current session
   */
  getCurrentSession: () => Effect.Effect<Option.Option<Session>>;

  /**
   * Load a session by ID
   */
  loadSession: (id: string) => Effect.Effect<void, SessionError>;

  /**
   * Save current session
   */
  saveSession: () => Effect.Effect<string, SessionError>;

  /**
   * Clear current session
   */
  clearSession: () => Effect.Effect<void>;

  /**
   * Check if session is valid (not expired)
   */
  isSessionValid: () => Effect.Effect<boolean>;

  /**
   * Update session data
   */
  updateSessionData: (
    _data: Record<string, unknown>
  ) => Effect.Effect<void, SessionError>;

  /**
   * Export session for persistence
   */
  exportSession: () => Effect.Effect<string, SessionError>;

  /**
   * Import session from persistence
   */
  importSession: (_data: string) => Effect.Effect<void, SessionError>;
}

/** Effect service key for the current crawl-session store. */
export class SessionStore extends Context.Service<
  SessionStore,
  SessionStoreService
>()('SessionStore') {}

/**
 * Create a SessionStore service implementation
 */
export const makeSessionStore = Effect.gen(function* () {
  const cookieManager = yield* CookieManager;
  const sessions = yield* Ref.make(HashMap.empty<string, Session>());
  const currentSessionId = yield* Ref.make<Option.Option<string>>(
    Option.none()
  );

  const generateSessionId = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const random = yield* Random.nextIntBetween(0, 2176782336); // 36^6
    const timestamp = DateTime.toEpochMillis(now);
    return `session_${timestamp}_${random.toString(36).padStart(6, '0')}`;
  });

  return {
    createSession: (id?: string) =>
      Effect.gen(function* () {
        const sessionId = id ?? (yield* generateSessionId);
        const cookiesString = yield* cookieManager.serialize();
        const now = yield* DateTime.now;
        const expiresAt = DateTime.add(now, { hours: 24 });

        const session: Session = {
          id: sessionId,
          cookies: cookiesString,
          tokens: HashMap.empty(),
          userData: Option.none(),
          createdAt: now,
          lastUsedAt: now,
          expiresAt: Option.some(expiresAt),
        };

        yield* Ref.update(sessions, (sessionsMap) =>
          HashMap.set(sessionsMap, sessionId, session)
        );
        yield* Ref.set(currentSessionId, Option.some(sessionId));

        return session;
      }),

    getCurrentSession: () =>
      Effect.gen(function* () {
        const sessionIdOpt = yield* Ref.get(currentSessionId);

        if (Option.isNone(sessionIdOpt)) {
          return Option.none();
        }

        const sessionsMap = yield* Ref.get(sessions);
        const sessionOpt = HashMap.get(sessionsMap, sessionIdOpt.value);

        if (Option.isNone(sessionOpt)) {
          return Option.none();
        }

        // Update last used time
        const now = yield* DateTime.now;
        const updatedSession = { ...sessionOpt.value, lastUsedAt: now };
        yield* Ref.update(sessions, (map) =>
          HashMap.set(map, sessionIdOpt.value, updatedSession)
        );

        return Option.some(updatedSession);
      }),

    loadSession: (id: string) =>
      Effect.gen(function* () {
        const sessionsMap = yield* Ref.get(sessions);
        const sessionOpt = HashMap.get(sessionsMap, id);

        if (Option.isNone(sessionOpt)) {
          return yield* SessionError.notFound(id);
        }

        const session = sessionOpt.value;

        // Check if expired
        if (Option.isSome(session.expiresAt)) {
          const now = yield* DateTime.now;
          if (DateTime.isLessThan(session.expiresAt.value, now)) {
            return yield* SessionError.expired(id);
          }
        }

        // Load cookies
        yield* cookieManager.deserialize(session.cookies).pipe(
          Effect.mapError((error) => new SessionError({
            sessionId: id,
            operation: 'load',
            cause: error
          }))
        );

        // Set as current session
        yield* Ref.set(currentSessionId, Option.some(id));

        // Update last used time
        const now = yield* DateTime.now;
        const updatedSession = { ...session, lastUsedAt: now };
        yield* Ref.update(sessions, (map) =>
          HashMap.set(map, id, updatedSession)
        );
      }),

    saveSession: () =>
      Effect.gen(function* () {
        const sessionIdOpt = yield* Ref.get(currentSessionId);

        if (Option.isNone(sessionIdOpt)) {
          // Create new session if none exists
          const newSessionId = yield* generateSessionId;
          yield* Ref.set(currentSessionId, Option.some(newSessionId));
          const cookiesString = yield* cookieManager.serialize();
          const now = yield* DateTime.now;
          const expiresAt = DateTime.add(now, { hours: 24 });

          const session: Session = {
            id: newSessionId,
            cookies: cookiesString,
            tokens: HashMap.empty(),
            userData: Option.none(),
            createdAt: now,
            lastUsedAt: now,
            expiresAt: Option.some(expiresAt),
          };

          yield* Ref.update(sessions, (map) =>
            HashMap.set(map, newSessionId, session)
          );

          return newSessionId;
        }

        const sessionsMap = yield* Ref.get(sessions);
        const sessionOpt = HashMap.get(sessionsMap, sessionIdOpt.value);

        if (Option.isNone(sessionOpt)) {
          return yield* SessionError.noActive();
        }

        // Update cookies in session
        const cookiesString = yield* cookieManager.serialize();
        const now = yield* DateTime.now;
        const updatedSession = {
          ...sessionOpt.value,
          cookies: cookiesString,
          lastUsedAt: now
        };
        yield* Ref.update(sessions, (map) =>
          HashMap.set(map, sessionIdOpt.value, updatedSession)
        );

        return sessionIdOpt.value;
      }),

    clearSession: () =>
      Effect.gen(function* () {
        const sessionIdOpt = yield* Ref.get(currentSessionId);

        if (Option.isSome(sessionIdOpt)) {
          yield* Ref.update(sessions, (map) =>
            HashMap.remove(map, sessionIdOpt.value)
          );
        }

        yield* Ref.set(currentSessionId, Option.none());
        yield* cookieManager.clearCookies();
      }),

    isSessionValid: () =>
      Effect.gen(function* () {
        const sessionIdOpt = yield* Ref.get(currentSessionId);

        if (Option.isNone(sessionIdOpt)) {
          return false;
        }

        const sessionsMap = yield* Ref.get(sessions);
        const sessionOpt = HashMap.get(sessionsMap, sessionIdOpt.value);

        if (Option.isNone(sessionOpt)) {
          return false;
        }

        const session = sessionOpt.value;

        // Check expiration
        if (Option.isSome(session.expiresAt)) {
          const now = yield* DateTime.now;
          if (DateTime.isLessThan(session.expiresAt.value, now)) {
            return false;
          }
        }

        return true;
      }),

    updateSessionData: (data: Record<string, unknown>) =>
      Effect.gen(function* () {
        const sessionIdOpt = yield* Ref.get(currentSessionId);

        if (Option.isNone(sessionIdOpt)) {
          return yield* SessionError.noActive();
        }

        const sessionsMap = yield* Ref.get(sessions);
        const sessionOpt = HashMap.get(sessionsMap, sessionIdOpt.value);

        if (Option.isNone(sessionOpt)) {
          return yield* SessionError.notFound(sessionIdOpt.value);
        }

        const session = sessionOpt.value;
        const now = yield* DateTime.now;
        const existingData = Option.getOrElse(session.userData, () => ({}));
        const updatedSession = {
          ...session,
          userData: Option.some({ ...existingData, ...data }),
          lastUsedAt: now
        };
        yield* Ref.update(sessions, (map) =>
          HashMap.set(map, sessionIdOpt.value, updatedSession)
        );
      }),

    exportSession: () =>
      Effect.gen(function* () {
        const sessionIdOpt = yield* Ref.get(currentSessionId);

        if (Option.isNone(sessionIdOpt)) {
          return yield* SessionError.exportError();
        }

        const sessionsMap = yield* Ref.get(sessions);
        const sessionOpt = HashMap.get(sessionsMap, sessionIdOpt.value);

        if (Option.isNone(sessionOpt)) {
          return yield* SessionError.notFound(sessionIdOpt.value);
        }

        const session = sessionOpt.value;

        // Convert HashMap to array for JSON serialization
        const tokensArray = Array.from(HashMap.toEntries(session.tokens)).map(
          ([key, value]) => [key, value] as const
        );

        // Serialize to JSON using Schema
        const serialized: SerializedSession = {
          id: session.id,
          cookies: session.cookies,
          tokens: tokensArray.map(([k, v]) => [k, v]),
          userData: session.userData,
          createdAt: DateTime.formatIso(session.createdAt),
          lastUsedAt: DateTime.formatIso(session.lastUsedAt),
          expiresAt: Option.map(session.expiresAt, DateTime.formatIso)
        };

        return yield* Effect.try({
          try: () => Schema.encodeSync(Schema.fromJsonString(SerializedSessionSchema))(serialized),
          catch: (error) => SessionError.parseError(error)
        });
      }),

    importSession: (data: string) =>
      Effect.gen(function* () {
        // Parse and validate JSON data using Schema
        const parsed = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(Schema.fromJsonString(SerializedSessionSchema))(data),
          catch: (error) => SessionError.parseError(error)
        });

        // Reconstruct session with proper types
        const session = yield* Effect.gen(function* () {
          // Parse DateTime from ISO strings - DateTime.make returns Option
          const createdAtOpt = DateTime.make(parsed.createdAt);
          const lastUsedAtOpt = DateTime.make(parsed.lastUsedAt);

          if (Option.isNone(createdAtOpt) || Option.isNone(lastUsedAtOpt)) {
            return yield* SessionError.reconstructError('Invalid date format');
          }

          const createdAt = createdAtOpt.value;
          const lastUsedAt = lastUsedAtOpt.value;

          // Parse expiresAt if present
          const expiresAt = Option.flatMap(parsed.expiresAt, DateTime.make);

          // Convert token entries to HashMap with proper TokenType validation
          const validatedTokens = parsed.tokens.filter(isValidTokenTuple);
          const tokensMap = HashMap.fromIterable(validatedTokens);

          const session: Session = {
            id: parsed.id,
            cookies: parsed.cookies,
            tokens: tokensMap,
            userData: parsed.userData,
            createdAt,
            lastUsedAt,
            expiresAt,
          };

          return session;
        });

        // Store session
        yield* Ref.update(sessions, (map) =>
          HashMap.set(map, session.id, session)
        );

        // Load session
        yield* cookieManager.deserialize(session.cookies).pipe(
          Effect.mapError((error) => new SessionError({
            sessionId: session.id,
            operation: 'import',
            cause: error
          }))
        );
        yield* Ref.set(currentSessionId, Option.some(session.id));
      }),
  };
});

/**
 * SessionStore Layer with dependencies
 */
export const SessionStoreLive = Layer.effect(SessionStore, makeSessionStore);
