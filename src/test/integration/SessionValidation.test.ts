/**
 * Session validation, against a real browser and a real origin.
 *
 * The local origin answers 200 at the same URL for both contexts and draws its
 * signed-in state in JavaScript — the shape that defeats a redirect-based
 * probe. A second route redirects instead, so the fallback rule is exercised
 * on the target class it is actually right for.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Effect } from 'effect';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import {
  SessionValidationService,
  type SessionValidationRequest,
} from '../../lib/SessionValidation/SessionValidation.service.js';

/**
 * A client-rendered account page: identical bytes for both contexts, and the
 * marker mounted from script after a tick.
 */
const SPA_HTML = `<!doctype html>
<html><head><title>My account</title></head>
<body>
  <div id="app"></div>
  <script>
    var signedIn = document.cookie.indexOf('session=') !== -1;
    setTimeout(function () {
      document.getElementById('app').innerHTML = signedIn
        ? '<nav data-testid="account-menu">Signed in as Mark</nav>'
        : '<button>Sign in</button>';
    }, 100);
  </script>
</body></html>`;

let server: Server;
let origin: string;
let browser: Browser;
let sessionContext: BrowserContext;
let anonymousContext: BrowserContext;
let sessionPage: Page;
let anonymousPage: Page;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const signedIn = (req.headers.cookie ?? '').includes('session=');
    const send = (body: string) => {
      res.writeHead(200, {
        'content-type': 'text/html',
        'cache-control': 'no-store, must-revalidate',
      });
      res.end(body);
    };

    // The client-rendered case: same status, same URL, same bytes.
    if (path === '/my-account') return send(SPA_HTML);

    // The server-rendered case: an anonymous visit is sent to the sign-in page.
    if (path === '/orders') {
      if (!signedIn) {
        res.writeHead(302, { location: '/sign-in' });
        res.end();
        return;
      }
      return send('<!doctype html><html><body>Orders</body></html>');
    }

    // A route that is genuinely public for everyone.
    if (path === '/about') {
      return send('<!doctype html><html><body>About</body></html>');
    }

    if (path === '/sign-in') {
      return send('<!doctype html><html><body>Sign in</body></html>');
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${port}`;

  browser = await chromium.launch();
  sessionContext = await browser.newContext();
  await sessionContext.addCookies([
    { name: 'session', value: 'real-token', url: origin },
  ]);
  anonymousContext = await browser.newContext();
  sessionPage = await sessionContext.newPage();
  anonymousPage = await anonymousContext.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  // Two contexts leave two keep-alive sockets, and `close` waits for both.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}, 60_000);

const validate = (request: SessionValidationRequest) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const validation = yield* SessionValidationService;
      return yield* validation.validate(sessionPage, anonymousPage, request);
    }).pipe(Effect.provide(SessionValidationService.Default))
  );

describe('SessionValidationService', () => {
  it('proves a session on a client-rendered route a redirect probe reads as public', async () => {
    const result = await validate({
      url: `${origin}/my-account`,
      marker: { selector: '[data-testid="account-menu"]' },
      settleMs: 500,
    });

    expect(result.valid).toBe(true);
    expect(result.reason).toBe('marker-seen-only-by-session');
    // The evidence the redirect rule would have had: nothing at all.
    expect(result.session.finalUrl).toBe(result.anonymous.finalUrl);
  });

  it('accepts a text marker as well as a selector', async () => {
    const result = await validate({
      url: `${origin}/my-account`,
      marker: { text: 'Signed in as Mark' },
      settleMs: 500,
    });

    expect(result.valid).toBe(true);
    expect(result.session.markerSeen).toBe(true);
    expect(result.anonymous.markerSeen).toBe(false);
  });

  it('rejects a marker both contexts can see, rather than validating the wrong thing', async () => {
    const result = await validate({
      url: `${origin}/about`,
      marker: { text: 'About' },
      settleMs: 200,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('marker-not-discriminating');
  });

  it('reports a session that cannot see its own marker', async () => {
    const result = await validate({
      url: `${origin}/my-account`,
      marker: { selector: '#nothing-renders-this' },
      settleMs: 500,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('marker-absent-from-session');
  });

  it('reads the marker after the settle window, not at navigation', async () => {
    // The marker mounts 100ms after load. A zero settle window must not call a
    // valid session rejected by accident of timing — it must fail for the
    // reason it actually failed.
    const impatient = await validate({
      url: `${origin}/my-account`,
      marker: { selector: '[data-testid="account-menu"]' },
      settleMs: 0,
    });
    expect(impatient.reason).toBe('marker-absent-from-session');

    const patient = await validate({
      url: `${origin}/my-account`,
      marker: { selector: '[data-testid="account-menu"]' },
      settleMs: 500,
    });
    expect(patient.valid).toBe(true);
  });

  it('falls back to the redirect rule when no marker is declared', async () => {
    const result = await validate({ url: `${origin}/orders`, settleMs: 200 });

    expect(result.valid).toBe(true);
    expect(result.reason).toBe('anonymous-redirected-away');
    expect(result.anonymous.finalUrl).toBe(`${origin}/sign-in`);
    expect(result.session.markerSeen).toBeUndefined();
  });

  it('proves nothing, and says so, when the fallback sees no redirect', async () => {
    const result = await validate({
      url: `${origin}/my-account`,
      settleMs: 200,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('no-protection-observed');
  });

  it('reports its own reason when the validation route cannot be reached', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const validation = yield* SessionValidationService;
        return yield* validation.validate(sessionPage, anonymousPage, {
          url: 'http://127.0.0.1:1/unreachable',
          settleMs: 0,
        });
      }).pipe(Effect.provide(SessionValidationService.Default))
    );

    expect(exit._tag).toBe('Failure');
    const failure = JSON.stringify(exit);
    expect(failure).toContain('ValidationRouteUnreachableError');
    expect(failure).toContain('session');
  });
});
