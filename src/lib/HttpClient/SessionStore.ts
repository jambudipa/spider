/**
 * Session Store Service
 * Manages user sessions including cookies, tokens, and authentication state
 */

import { Context, Effect, Layer, Option, Ref } from 'effect';
import { CookieManager } from './CookieManager.js';
import { TokenType } from '../StateManager/StateManager.service.js';

export interface Session {
  id: string;
  cookies: string;
  tokens: Map<TokenType, string>;
  userData?: Record<string, any>;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt?: Date;
}

export interface Credentials {
  username: string;
  password: string;
  [key: string]: any;
}

export interface SessionStoreService {
  /**
   * Create a new session
   */
  createSession: (id?: string) => Effect.Effect<Session, never, never>;

  /**
   * Get current session
   */
  getCurrentSession: () => Effect.Effect<Option.Option<Session>, never, never>;

  /**
   * Load a session by ID
   */
  loadSession: (id: string) => Effect.Effect<void, Error, never>;

  /**
   * Save current session
   */
  saveSession: () => Effect.Effect<string, Error, never>;

  /**
   * Clear current session
   */
  clearSession: () => Effect.Effect<void, never, never>;

  /**
   * Check if session is valid (not expired)
   */
  isSessionValid: () => Effect.Effect<boolean, never, never>;

  /**
   * Update session data
   */
  updateSessionData: (
    data: Record<string, any>
  ) => Effect.Effect<void, Error, never>;

  /**
   * Export session for persistence
   */
  exportSession: () => Effect.Effect<string, Error, never>;

  /**
   * Import session from persistence
   */
  importSession: (data: string) => Effect.Effect<void, Error, never>;
}

export class SessionStore extends Context.Tag('SessionStore')<
  SessionStore,
  SessionStoreService
>() {}

/**
 * Create a SessionStore service implementation
 */
export const makeSessionStore = Effect.gen(function* () {
  const cookieManager = yield* CookieManager;
  const sessions = yield* Ref.make(new Map<string, Session>());
  const currentSessionId = yield* Ref.make<Option.Option<string>>(
    Option.none()
  );

  const generateSessionId = () =>
    `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return {
    createSession: (id?: string) =>
      Effect.gen(function* () {
        const sessionId = id || generateSessionId();
        const cookiesString = yield* cookieManager.serialize();

        const session: Session = {
          id: sessionId,
          cookies: cookiesString,
          tokens: new Map(),
          createdAt: new Date(),
          lastUsedAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
        };

        const sessionsMap = yield* Ref.get(sessions);
        sessionsMap.set(sessionId, session);
        yield* Ref.set(sessions, sessionsMap);
        yield* Ref.set(currentSessionId, Option.some(sessionId));

        return session;
      }),

    getCurrentSession: () =>
      Effect.gen(function* () {
        const sessionId = yield* Ref.get(currentSessionId);

        if (Option.isNone(sessionId)) {
          return Option.none();
        }

        const sessionsMap = yield* Ref.get(sessions);
        const session = sessionsMap.get(sessionId.value);

        if (!session) {
          return Option.none();
        }

        // Update last used time
        session.lastUsedAt = new Date();
        sessionsMap.set(sessionId.value, session);
        yield* Ref.set(sessions, sessionsMap);

        return Option.some(session);
      }),

    loadSession: (id: string) =>
      Effect.gen(function* () {
        const sessionsMap = yield* Ref.get(sessions);
        const session = sessionsMap.get(id);

        if (!session) {
          return yield* Effect.fail(new Error(`Session ${id} not found`));
        }

        // Check if expired
        if (session.expiresAt && session.expiresAt < new Date()) {
          return yield* Effect.fail(new Error(`Session ${id} has expired`));
        }

        // Load cookies
        yield* cookieManager.deserialize(session.cookies);

        // Set as current session
        yield* Ref.set(currentSessionId, Option.some(id));

        // Update last used time
        session.lastUsedAt = new Date();
        sessionsMap.set(id, session);
        yield* Ref.set(sessions, sessionsMap);
      }),

    saveSession: () =>
      Effect.gen(function* () {
        const sessionId = yield* Ref.get(currentSessionId);

        if (Option.isNone(sessionId)) {
          // Create new session if none exists
          const newSession = yield* Effect.sync(() => generateSessionId());
          yield* Ref.set(currentSessionId, Option.some(newSession));
          const session = yield* Effect.succeed({
            id: newSession,
            cookies: yield* cookieManager.serialize(),
            tokens: new Map(),
            createdAt: new Date(),
            lastUsedAt: new Date(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          });

          const sessionsMap = yield* Ref.get(sessions);
          sessionsMap.set(newSession, session);
          yield* Ref.set(sessions, sessionsMap);

          return newSession;
        }

        const sessionsMap = yield* Ref.get(sessions);
        const session = sessionsMap.get(sessionId.value);

        if (!session) {
          return yield* Effect.fail(new Error('No active session to save'));
        }

        // Update cookies in session
        session.cookies = yield* cookieManager.serialize();
        session.lastUsedAt = new Date();
        sessionsMap.set(sessionId.value, session);
        yield* Ref.set(sessions, sessionsMap);

        return sessionId.value;
      }),

    clearSession: () =>
      Effect.gen(function* () {
        const sessionId = yield* Ref.get(currentSessionId);

        if (Option.isSome(sessionId)) {
          const sessionsMap = yield* Ref.get(sessions);
          sessionsMap.delete(sessionId.value);
          yield* Ref.set(sessions, sessionsMap);
        }

        yield* Ref.set(currentSessionId, Option.none());
        yield* cookieManager.clearCookies();
      }),

    isSessionValid: () =>
      Effect.gen(function* () {
        const sessionOption = yield* Effect.gen(function* () {
          const sessionId = yield* Ref.get(currentSessionId);
          
          if (Option.isNone(sessionId)) {
            return Option.none<Session>();
          }

          const sessionsMap = yield* Ref.get(sessions);
          return Option.fromNullable(sessionsMap.get(sessionId.value));
        });

        return Option.match(sessionOption, {
          onNone: () => false,
          onSome: (session) => {
            // Check expiration
            if (session.expiresAt && session.expiresAt < new Date()) {
              return false;
            }
            return true;
          }
        });
      }),

    updateSessionData: (data: Record<string, any>) =>
      Effect.gen(function* () {
        const sessionId = yield* Ref.get(currentSessionId);

        if (Option.isNone(sessionId)) {
          return yield* Effect.fail(new Error('No active session'));
        }

        const sessionsMap = yield* Ref.get(sessions);
        const session = sessionsMap.get(sessionId.value);

        if (!session) {
          return yield* Effect.fail(new Error('Session not found'));
        }

        session.userData = { ...session.userData, ...data };
        session.lastUsedAt = new Date();
        sessionsMap.set(sessionId.value, session);
        yield* Ref.set(sessions, sessionsMap);
      }),

    exportSession: () =>
      Effect.gen(function* () {
        const sessionId = yield* Ref.get(currentSessionId);

        if (Option.isNone(sessionId)) {
          return yield* Effect.fail(new Error('No active session to export'));
        }

        const sessionsMap = yield* Ref.get(sessions);
        const session = sessionsMap.get(sessionId.value);

        if (!session) {
          return yield* Effect.fail(new Error('Session not found'));
        }

        // Convert Map to array for JSON serialization
        const tokensArray = Array.from(session.tokens.entries());

        return JSON.stringify({
          ...session,
          tokens: tokensArray,
        });
      }),

    importSession: (data: string) =>
      Effect.gen(function* () {
        // Parse JSON data with proper error handling
        const parsed = yield* Effect.try({
          try: () => JSON.parse(data),
          catch: (error) => new Error(`Invalid session JSON: ${error}`)
        });

        // Reconstruct session with safe date parsing
        const session = yield* Effect.try({
          try: () => ({
            ...parsed,
            tokens: new Map(parsed.tokens || []),
            createdAt: new Date(parsed.createdAt),
            lastUsedAt: new Date(parsed.lastUsedAt),
            expiresAt: parsed.expiresAt
              ? new Date(parsed.expiresAt)
              : undefined,
          } as Session),
          catch: (error) => new Error(`Failed to reconstruct session: ${error}`)
        });

        // Store session
        const sessionsMap = yield* Ref.get(sessions);
        sessionsMap.set(session.id, session);
        yield* Ref.set(sessions, sessionsMap);

        // Load session
        yield* cookieManager.deserialize(session.cookies);
        yield* Ref.set(currentSessionId, Option.some(session.id));
      }),
  };
});

/**
 * SessionStore Layer with dependencies
 */
export const SessionStoreLive = Layer.effect(SessionStore, makeSessionStore);
