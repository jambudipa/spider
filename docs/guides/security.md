# Security Handling Guide

This guide covers authentication, session management, and security features in Spider. Learn how to handle login flows, manage cookies, extract tokens, and work with protected content.

## Overview

Spider provides several components for security handling:

- `CookieManager` - Cookie storage and management
- `SessionStore` - Session persistence across requests
- `TokenExtractor` - Extract authentication tokens from pages
- `StateManager` - Manage CSRF tokens and state
- `EnhancedHttpClient` - HTTP client with session support

## Authentication Strategies

### Basic Authentication

For HTTP Basic Auth:

```typescript
class BasicAuthMiddleware {
  constructor(private username: string, private password: string) {}
  
  name = 'basic-auth'
  
  processRequest(request) {
    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64')
    
    return Effect.succeed({
      ...request,
      headers: {
        ...request.headers,
        'Authorization': `Basic ${auth}`
      }
    })
  }
}

const middleware = new MiddlewareManager()
  .use(new BasicAuthMiddleware('user', 'pass'))
```

### Bearer Token Authentication

For API token authentication:

```typescript
class BearerAuthMiddleware {
  constructor(private token: string) {}
  
  name = 'bearer-auth'
  
  processRequest(request) {
    return Effect.succeed({
      ...request,
      headers: {
        ...request.headers,
        'Authorization': `Bearer ${this.token}`
      }
    })
  }
}
```

### API Key Authentication

For API key authentication:

```typescript
class ApiKeyMiddleware {
  constructor(private apiKey: string, private headerName = 'X-API-Key') {}
  
  name = 'api-key'
  
  processRequest(request) {
    return Effect.succeed({
      ...request,
      headers: {
        ...request.headers,
        [this.headerName]: this.apiKey
      }
    })
  }
}
```

## Cookie-Based Authentication

### Using CookieManager

```typescript
import { CookieManager, makeCookieManager } from '@jambudipa/spider'
import { Effect } from 'effect'

const program = Effect.gen(function* () {
  const cookieManager = yield* CookieManager
  
  // Store cookies from login
  yield* cookieManager.setCookie('example.com', {
    name: 'session_id',
    value: 'abc123',
    domain: '.example.com',
    path: '/',
    httpOnly: true,
    secure: true,
    expires: Date.now() + 86400000  // 24 hours
  })
  
  // Get cookies for domain
  const cookies = yield* cookieManager.getCookies('example.com')
  
  // Clear cookies when done
  yield* cookieManager.clearCookies('example.com')
})

Effect.runPromise(
  program.pipe(Effect.provide(CookieManagerLive))
)
```

### Browser-Based Login

Use browser automation for complex login forms:

```typescript
import { BrowserManager, PlaywrightAdapter } from '@jambudipa/spider/browser'

async function performLogin(url: string, username: string, password: string) {
  const manager = new BrowserManager({ headless: true })
  await manager.initialise()
  
  const page = await manager.getPage(url)
  const adapter = new PlaywrightAdapter(page)
  
  // Navigate to login page
  await adapter.goto(`${url}/login`)
  
  // Fill login form
  await adapter.fill('#username', username)
  await adapter.fill('#password', password)
  
  // Handle potential CAPTCHA or 2FA here
  
  // Submit form
  await adapter.click('#login-button')
  
  // Wait for redirect
  await adapter.waitForNavigation()
  
  // Extract cookies
  const cookies = await page.cookies()
  
  // Save cookies for future requests
  const cookieHeader = cookies
    .map(c => `${c.name}=${c.value}`)
    .join('; ')
  
  await manager.cleanup()
  
  return { cookies, cookieHeader }
}
```

## Session Management

### Using SessionStore

```typescript
import { SessionStore, makeSessionStore } from '@jambudipa/spider'
import { Effect } from 'effect'

const program = Effect.gen(function* () {
  const sessionStore = yield* SessionStore
  
  // Create new session
  const session = yield* sessionStore.createSession('user123', {
    cookies: [
      { name: 'session_id', value: 'abc123' },
      { name: 'user_id', value: 'user123' }
    ],
    headers: {
      'Authorization': 'Bearer token123'
    },
    metadata: {
      loginTime: Date.now(),
      userRole: 'admin'
    }
  })
  
  // Get session
  const activeSession = yield* sessionStore.getSession('user123')
  
  // Update session
  yield* sessionStore.updateSession('user123', {
    ...activeSession,
    metadata: {
      ...activeSession.metadata,
      lastActivity: Date.now()
    }
  })
  
  // Delete session on logout
  yield* sessionStore.deleteSession('user123')
})

Effect.runPromise(
  program.pipe(Effect.provide(SessionStoreLive))
)
```

### Session Persistence

Maintain sessions across crawl restarts:

```typescript
import { ResumabilityService, FileStorageBackend } from '@jambudipa/spider'

// Configure session persistence
const resumabilityConfig = {
  strategy: 'hybrid',
  backend: new FileStorageBackend('./sessions'),
  sessionKey: 'crawler-session'
}

// Sessions will be saved and restored automatically
```

## Token Extraction

### Using TokenExtractor

```typescript
import { TokenExtractor, makeTokenExtractor } from '@jambudipa/spider'
import { Effect } from 'effect'

const program = Effect.gen(function* () {
  const tokenExtractor = yield* TokenExtractor
  
  // Extract tokens from HTML
  const html = '<meta name="csrf-token" content="abc123">'
  
  const tokens = yield* tokenExtractor.extractTokens(html, {
    patterns: [
      { type: 'csrf', pattern: /<meta name="csrf-token" content="([^"]+)"/ },
      { type: 'api', pattern: /data-api-key="([^"]+)"/ },
      { type: 'session', pattern: /sessionId:\s*'([^']+)'/ }
    ]
  })
  
  // Use extracted tokens
  const csrfToken = tokens.find(t => t.type === 'csrf')?.value
})

Effect.runPromise(
  program.pipe(Effect.provide(TokenExtractorLive))
)
```

### Common Token Patterns

```typescript
// CSRF tokens
const csrfPatterns = [
  /<meta name="csrf-token" content="([^"]+)"/,
  /<input type="hidden" name="csrf_token" value="([^"]+)"/,
  /csrfToken:\s*["']([^"']+)["']/,
  /_csrf:\s*["']([^"']+)["']/
]

// API tokens
const apiPatterns = [
  /data-api-key="([^"]+)"/,
  /apiKey:\s*["']([^"']+)["']/,
  /X-API-Key:\s*["']([^"']+)["']/
]

// Session tokens
const sessionPatterns = [
  /sessionId:\s*["']([^"']+)["']/,
  /session_id=([^;]+)/,
  /"session":\s*"([^"]+)"/
]
```

## CSRF Protection

### Handling CSRF Tokens

```typescript
import { StateManager, makeStateManager } from '@jambudipa/spider'

async function handleCSRFProtection(page, formUrl: string) {
  // Extract CSRF token
  const csrfToken = await page.evaluate(() => {
    // Try meta tag
    const meta = document.querySelector('meta[name="csrf-token"]')
    if (meta) return meta.getAttribute('content')
    
    // Try hidden input
    const input = document.querySelector('input[name="csrf_token"]')
    if (input) return input.value
    
    // Try from JavaScript
    if (window.csrfToken) return window.csrfToken
    
    return null
  })
  
  if (!csrfToken) {
    throw new Error('CSRF token not found')
  }
  
  // Include in form submission
  await page.fill('input[name="csrf_token"]', csrfToken)
  
  // Or include in headers
  await page.setExtraHTTPHeaders({
    'X-CSRF-Token': csrfToken
  })
  
  return csrfToken
}
```

### StateManager for CSRF

```typescript
const program = Effect.gen(function* () {
  const stateManager = yield* StateManager
  
  // Store CSRF token
  yield* stateManager.setState('csrf', {
    token: 'abc123',
    expires: Date.now() + 3600000
  })
  
  // Get token for requests
  const state = yield* stateManager.getState('csrf')
  
  if (state && state.expires > Date.now()) {
    // Use token
    headers['X-CSRF-Token'] = state.token
  } else {
    // Token expired, get new one
  }
})
```

## OAuth 2.0 Flow

### Implementing OAuth

```typescript
async function performOAuth(clientId: string, clientSecret: string) {
  const manager = new BrowserManager()
  await manager.initialise()
  
  const page = await manager.getPage()
  
  // Step 1: Redirect to OAuth provider
  const authUrl = `https://oauth.example.com/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent('http://localhost:3000/callback')}&response_type=code`
  
  await page.goto(authUrl)
  
  // Step 2: User logs in (automated or manual)
  await page.fill('#email', 'user@example.com')
  await page.fill('#password', 'password')
  await page.click('#authorize')
  
  // Step 3: Extract authorization code
  await page.waitForURL('**/callback?code=*')
  const url = new URL(page.url())
  const code = url.searchParams.get('code')
  
  // Step 4: Exchange code for token
  const tokenResponse = await fetch('https://oauth.example.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: 'http://localhost:3000/callback'
    })
  })
  
  const { access_token, refresh_token } = await tokenResponse.json()
  
  await manager.cleanup()
  
  return { access_token, refresh_token }
}
```

## Two-Factor Authentication

### Handling 2FA

```typescript
async function handle2FA(page, totpSecret?: string) {
  // Check if 2FA is required
  const requires2FA = await page.isVisible('.two-factor-input')
  
  if (!requires2FA) return
  
  if (totpSecret) {
    // Generate TOTP code
    const totp = generateTOTP(totpSecret)
    await page.fill('.two-factor-input', totp)
  } else {
    // Wait for manual input
    console.log('Please enter 2FA code manually...')
    await page.waitForNavigation({ timeout: 60000 })
  }
}

function generateTOTP(secret: string): string {
  // Use a TOTP library like speakeasy
  const speakeasy = require('speakeasy')
  return speakeasy.totp({
    secret,
    encoding: 'base32'
  })
}
```

## Protected Content

### Handling Password-Protected Pages

```typescript
async function accessProtectedContent(url: string, credentials: any) {
  const page = await manager.getPage(url)
  
  // Check if login is required
  if (page.url().includes('/login')) {
    // Perform login
    await performLogin(page, credentials)
  }
  
  // Check if session expired
  if (await page.isVisible('.session-expired')) {
    // Refresh session
    await refreshSession(page, credentials)
  }
  
  // Access protected content
  await page.goto(url)
  const content = await page.content()
  
  return content
}
```

### Maintaining Authentication

```typescript
class AuthenticationManager {
  private sessions: Map<string, any> = new Map()
  
  async ensureAuthenticated(domain: string, page: any) {
    const session = this.sessions.get(domain)
    
    if (!session || this.isExpired(session)) {
      // Re-authenticate
      const newSession = await this.authenticate(domain, page)
      this.sessions.set(domain, newSession)
    }
    
    // Apply session
    await this.applySession(page, session)
  }
  
  private isExpired(session: any): boolean {
    return session.expires < Date.now()
  }
  
  private async applySession(page: any, session: any) {
    // Set cookies
    await page.context().addCookies(session.cookies)
    
    // Set headers
    await page.setExtraHTTPHeaders(session.headers)
  }
}
```

## Security Best Practices

### 1. Never Log Credentials

```typescript
// ❌ Bad
console.log(`Logging in with ${password}`)

// ✅ Good
console.log('Performing authentication...')
```

### 2. Store Secrets Securely

```typescript
// Use environment variables
const config = {
  apiKey: process.env.API_KEY,
  clientSecret: process.env.CLIENT_SECRET
}

// Never commit secrets
// .env file (add to .gitignore)
API_KEY=your-key-here
CLIENT_SECRET=your-secret-here
```

### 3. Validate SSL Certificates

```typescript
const config = makeSpiderConfig({
  // Only ignore in development
  ignoreHTTPSErrors: process.env.NODE_ENV === 'development'
})
```

### 4. Handle Sensitive Data Carefully

```typescript
// Clear sensitive data after use
try {
  const token = await getToken()
  await makeRequest(token)
} finally {
  // Clear from memory
  token = null
  
  // Clear from storage
  await sessionStore.deleteSession(sessionId)
  
  // Clear cookies
  await cookieManager.clearCookies(domain)
}
```

### 5. Implement Rate Limiting

```typescript
// Avoid triggering security measures
const config = makeSpiderConfig({
  requestDelayMs: 2000,
  maxRequestsPerSecondPerDomain: 1
})
```

## Common Scenarios

### Scenario 1: Login Required

```typescript
const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  // Login first
  const loginResult = await performLogin(
    'https://example.com/login',
    'username',
    'password'
  )
  
  // Use cookies for crawling
  const middleware = new MiddlewareManager()
    .use(new CookieMiddleware(loginResult.cookies))
  
  const config = makeSpiderConfig({ middleware })
  
  // Crawl protected content
  yield* spider.crawl('https://example.com/protected')
})
```

### Scenario 2: API with Rate Limits

```typescript
const config = makeSpiderConfig({
  maxRequestsPerSecondPerDomain: 0.5,  // 2 seconds between requests
  headers: {
    'X-API-Key': process.env.API_KEY
  }
})
```

### Scenario 3: Session Timeout

```typescript
class SessionRefreshMiddleware {
  private lastRefresh = Date.now()
  private readonly sessionTimeout = 3600000  // 1 hour
  
  async processRequest(request) {
    if (Date.now() - this.lastRefresh > this.sessionTimeout) {
      await this.refreshSession()
      this.lastRefresh = Date.now()
    }
    
    return request
  }
  
  private async refreshSession() {
    // Re-authenticate or refresh token
  }
}
```

## Troubleshooting

### Authentication Failures
- Verify credentials are correct
- Check if 2FA is required
- Ensure cookies are being sent
- Verify session hasn't expired

### Token Issues
- Check token extraction patterns
- Verify token hasn't expired
- Ensure token is in correct format
- Check if token needs refresh

### Session Problems
- Clear old cookies
- Check session timeout settings
- Verify session storage is working
- Ensure session is being maintained

## Next Steps

- [Browser Automation](./browser-automation.md) - Complex login flows
- [Anti-Bot Protection](./anti-bot.md) - Avoiding detection during auth
- [Configuration Guide](./configuration.md) - Security configuration options
- [Performance Guide](./performance.md) - Optimising authenticated crawls