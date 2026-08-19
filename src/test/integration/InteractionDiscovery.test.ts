/**
 * Interaction-driven discovery, against a real browser and a real origin.
 *
 * Nothing here is faked: a local HTTP server serves a client-rendered page,
 * Playwright drives it, and the service records what the interactions reveal.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Effect } from 'effect';
import { chromium, type Browser, type Page } from 'playwright';
import {
  InteractionDiscoveryService,
  type InteractionControl,
  type InteractionSweepOptions,
} from '../../lib/InteractionDiscovery/InteractionDiscovery.service.js';

/** A 1x1 transparent GIF — enough to make the browser issue a real request. */
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const PAGE_HTML = `<!doctype html>
<html><head><title>Sweep target</title></head>
<body>
  <img src="/pixel.gif" alt="in markup">
  <button id="docs">Documents</button>
  <button id="quiet">Quiet</button>
  <a id="leave" href="/other">Leave</a>
  <script>
    document.getElementById('docs').addEventListener('click', () => {
      fetch('/api/documents?id=9f3a-opaque-guid');
    });
  </script>
</body></html>`;

const QUIET_HTML = `<!doctype html>
<html><head><title>Quiet</title></head>
<body><button id="quiet">Quiet</button></body></html>`;

let server: Server;
let origin: string;
let browser: Browser;
let page: Page;

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    // These tests share one page across cases. Without no-store the browser
    // serves subresources from cache on the second visit, no request event
    // fires, and the ledger looks empty for reasons that have nothing to do
    // with the sweep.
    const send = (contentType: string, body: string | Buffer) => {
      res.writeHead(200, {
        'content-type': contentType,
        'cache-control': 'no-store, must-revalidate',
      });
      res.end(body);
    };

    if (path === '/pixel.gif') {
      send('image/gif', PIXEL);
      return;
    }
    if (path === '/api/documents') {
      send('application/json', JSON.stringify([{ name: 'Statement.pdf' }]));
      return;
    }
    if (path === '/quiet') {
      send('text/html', QUIET_HTML);
      return;
    }
    send('text/html', PAGE_HTML);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const sweep = (
  controls: readonly InteractionControl[],
  options?: InteractionSweepOptions
) =>
  Effect.gen(function* () {
    const discovery = yield* InteractionDiscoveryService;
    return yield* discovery.sweep(page, controls, options);
  }).pipe(Effect.provide(InteractionDiscoveryService.Default));

const DOCS: InteractionControl = {
  id: 'tab-docs',
  label: 'Documents',
  selector: '#docs',
  settleMs: 600,
};

describe('InteractionDiscoveryService', () => {
  it('attributes a revealed identity to the control that revealed it', async () => {
    // The sweep does its own navigation, so the ledger is attached before the
    // page's subresources load and they land in the baseline window.
    const result = await Effect.runPromise(
      sweep([DOCS], { navigateTo: origin, baselineMs: 600 })
    );

    const revealed = result.requests.find((r) =>
      r.url.includes('/api/documents')
    );
    expect(revealed).toBeDefined();
    expect(revealed?.revealedBy).toEqual({
      id: 'tab-docs',
      label: 'Documents',
    });
    expect(result.driven).toEqual([{ id: 'tab-docs', label: 'Documents' }]);
  });

  it('leaves markup traffic unattributed', async () => {
    const result = await Effect.runPromise(
      sweep([DOCS], { navigateTo: origin, baselineMs: 600 })
    );

    const pixel = result.requests.find((r) => r.url.includes('/pixel.gif'));
    expect(pixel).toBeDefined();
    // The image was in the delivered markup. It belongs to nobody, and must
    // not be credited to whichever control happened to run.
    expect(pixel?.revealedBy).toBeUndefined();
  });

  it('records the label that makes an opaque identity nameable', async () => {
    await page.goto(origin, { waitUntil: 'load' });

    const result = await Effect.runPromise(sweep([DOCS]));

    const revealed = result.requests.find((r) => r.url.includes('opaque-guid'));
    expect(revealed?.revealedBy?.label).toBe('Documents');
  });

  it('refuses when no oracle was declared', async () => {
    await page.goto(origin, { waitUntil: 'load' });

    const error = await Effect.runPromise(Effect.flip(sweep([])));
    expect(error._tag).toBe('NoOracleDeclaredError');
  });

  it('refuses when no declared control could be driven', async () => {
    await page.goto(origin, { waitUntil: 'load' });

    const error = await Effect.runPromise(
      Effect.flip(
        sweep([
          { id: 'ghost', label: 'Not present', selector: '#nope', settleMs: 0 },
        ])
      )
    );

    expect(error._tag).toBe('NoControlsDrivenError');
    expect(error.message).toContain('Not present');
  });

  it('refuses a sweep that drove controls and revealed nothing', async () => {
    await page.goto(`${origin}/quiet`, { waitUntil: 'load' });

    const error = await Effect.runPromise(
      Effect.flip(
        sweep([
          { id: 'quiet', label: 'Quiet', selector: '#quiet', settleMs: 300 },
        ])
      )
    );

    // A vacuous pass is worse than a failure because it looks like success.
    expect(error._tag).toBe('NothingRevealedError');
  });

  it('refuses a control that navigates away from the page being measured', async () => {
    await page.goto(origin, { waitUntil: 'load' });

    const error = await Effect.runPromise(
      Effect.flip(
        sweep([
          { id: 'leave', label: 'Leave', selector: '#leave', settleMs: 600 },
        ])
      )
    );

    expect(error._tag).toBe('SweepNavigatedAwayError');
  });
});
