# Anti-Bot Protection Guide

This guide explains how to configure Spider to avoid detection and handle common anti-bot mechanisms. While Spider doesn't include a dedicated "anti-bot service", it successfully bypasses protection through careful configuration and browser automation.

## Important Note

**Spider does not have an `AntiBlockService` or similar dedicated anti-bot component.** Instead, Spider handles anti-bot challenges through:

- Smart configuration options (user agents, delays, headers)
- Browser automation via Playwright (JavaScript execution)
- Proper session and cookie management
- Middleware for custom headers and behaviour

This approach has proven effective - Spider achieves 100% success rate on all web-scraping.dev anti-bot scenarios.

## Understanding Anti-Bot Mechanisms

Websites use various techniques to detect and block bots:

### Detection Methods
1. **User Agent Analysis** - Checking for bot-like user agents
2. **Behavioural Analysis** - Detecting inhuman browsing patterns
3. **JavaScript Challenges** - Requiring JavaScript execution
4. **Header Inspection** - Checking for missing or suspicious headers
5. **Rate Limiting** - Blocking rapid requests
6. **Fingerprinting** - Browser and device fingerprinting
7. **Cookie Tracking** - Using cookies to track and block bots
8. **Referer Checking** - Validating the referring page

### Common Blocks
- CAPTCHA challenges
- "Access Denied" pages
- 403 Forbidden responses
- Infinite redirects
- Empty responses
- Session invalidation

## Configuration Strategies

### User Agent Rotation

Configure realistic user agents:

```typescript
import { makeSpiderConfig, UserAgentMiddleware } from '@jambudipa/spider'

// Single user agent
const config = makeSpiderConfig({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
})

// Or use middleware for rotation
const middleware = new MiddlewareManager()
  .use(new UserAgentMiddleware({
    rotateAgents: true,
    agents: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'
    ]
  }))
```

### Request Delays

Add human-like delays between requests:

```typescript
const config = makeSpiderConfig({
  // Fixed delay
  requestDelayMs: 2000,  // 2 seconds
  
  // Or random delay
  requestDelayMs: 1000 + Math.random() * 3000,  // 1-4 seconds
  
  // Rate limiting
  maxRequestsPerSecondPerDomain: 0.5,  // One request every 2 seconds
  
  // Limit concurrent requests
  maxConcurrentWorkers: 2
})
```

### Realistic Headers

Send headers that real browsers send:

```typescript
class RealisticHeadersMiddleware {
  name = 'realistic-headers'
  
  processRequest(request) {
    return Effect.succeed({
      ...request,
      headers: {
        ...request.headers,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="120", "Not_A Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    })
  }
}
```

## Browser Automation for JavaScript Challenges

Many anti-bot systems require JavaScript execution. Use browser automation:

```typescript
import { BrowserManager } from '@jambudipa/spider/browser'

const browserManager = new BrowserManager({
  headless: true,  // Some sites detect headless mode
  viewport: { width: 1920, height: 1080 },  // Realistic viewport
  locale: 'en-GB',
  userAgent: 'Mozilla/5.0...'  // Real browser user agent
})

// Initialise with stealth settings
const page = await browserManager.getPage(url)

// Disable automation indicators
await page.evaluateOnNewDocument(() => {
  // Hide webdriver property
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined
  })
  
  // Add chrome property
  window.chrome = { runtime: {} }
  
  // Set realistic permissions
  const originalQuery = window.navigator.permissions.query
  window.navigator.permissions.query = (parameters) => {
    if (parameters.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission })
    }
    return originalQuery(parameters)
  }
})
```

## Handling Specific Protections

### Cookie Popups

Automatically handle cookie consent:

```typescript
async function handleCookieConsent(page) {
  try {
    // Wait for popup
    await page.waitForSelector('.cookie-banner', { timeout: 5000 })
    
    // Click accept
    await page.click('button:has-text("Accept")')
    
    // Wait for dismissal
    await page.waitForSelector('.cookie-banner', { state: 'hidden' })
  } catch {
    // No popup or already accepted
  }
}
```

### CSRF Tokens

Extract and submit CSRF tokens:

```typescript
async function handleCSRF(page) {
  // Extract token from page
  const csrfToken = await page.evaluate(() => {
    // Try meta tag
    const meta = document.querySelector('meta[name="csrf-token"]')
    if (meta) return meta.content
    
    // Try hidden input
    const input = document.querySelector('input[name="csrf_token"]')
    if (input) return input.value
    
    // Try cookie
    const match = document.cookie.match(/csrf_token=([^;]+)/)
    if (match) return match[1]
    
    return null
  })
  
  // Include in subsequent requests
  return csrfToken
}
```

### Referer Validation

Set correct referer headers:

```typescript
class RefererMiddleware {
  private lastUrl: string = ''
  
  processRequest(request) {
    const headers = {
      ...request.headers,
      'Referer': this.lastUrl || request.url
    }
    
    this.lastUrl = request.url
    
    return Effect.succeed({
      ...request,
      headers
    })
  }
}
```

### Session Management

Maintain sessions across requests:

```typescript
import { SessionStore, CookieManager } from '@jambudipa/spider'

const sessionStore = makeSessionStore()
const cookieManager = makeCookieManager()

// Login and save session
const session = await sessionStore.createSession('site.com', {
  cookies: await page.cookies(),
  headers: { 'Authorization': 'Bearer token' }
})

// Use session for subsequent requests
const cookies = await cookieManager.getCookies('site.com')
```

## Real-World Scenarios

Based on Spider's test suite, here are proven solutions:

### Scenario 1: Block Page Detection

```typescript
// Check if blocked
async function detectBlock(html: string): boolean {
  const blockIndicators = [
    'Access Denied',
    'You have been blocked',
    'Please verify you are human',
    'Enable JavaScript and cookies'
  ]
  
  return blockIndicators.some(text => 
    html.toLowerCase().includes(text.toLowerCase())
  )
}

// If blocked, retry with browser
if (await detectBlock(response.html)) {
  const page = await browserManager.getPage(url)
  // Browser will execute JavaScript challenges
  await page.goto(url, { waitUntil: 'networkidle' })
  const content = await page.content()
}
```

### Scenario 2: Cookie-Based Blocking

```typescript
// Clear blocking cookies
async function clearBlockingCookies(page) {
  const cookies = await page.cookies()
  
  for (const cookie of cookies) {
    if (cookie.name.includes('block') || 
        cookie.name.includes('ban') ||
        cookie.value === 'blocked') {
      await page.deleteCookie(cookie)
    }
  }
}
```

### Scenario 3: Invalid Referer Blocking

```typescript
// Navigate with correct referer
async function navigateWithReferer(page, targetUrl, refererUrl) {
  // Set referer header
  await page.setExtraHTTPHeaders({
    'Referer': refererUrl
  })
  
  // Navigate
  const response = await page.goto(targetUrl)
  
  // Check if blocked (redirect to /blocked)
  if (page.url().includes('/blocked')) {
    throw new Error('Blocked due to invalid referer')
  }
  
  return response
}
```

## Best Practices

### 1. Start Human-Like

Configure Spider to behave like a human:

```typescript
const config = makeSpiderConfig({
  requestDelayMs: 2000 + Math.random() * 2000,  // Variable delays
  maxConcurrentWorkers: 1,  // Sequential browsing
  userAgent: 'Mozilla/5.0...',  // Real browser
  respectNoFollow: true,  // Respect site rules
  normalizeUrlsForDeduplication: true  // Avoid revisiting
})
```

### 2. Use Browser When Needed

Only use browser automation for JavaScript-protected content:

```typescript
// Try HTTP first
let content = await fetchWithHttp(url)

// If blocked or empty, try browser
if (isBlocked(content) || isEmpty(content)) {
  content = await fetchWithBrowser(url)
}
```

### 3. Rotate Everything

Don't just rotate user agents - rotate all identifiable attributes:

```typescript
const variations = [
  { viewport: { width: 1920, height: 1080 }, locale: 'en-GB' },
  { viewport: { width: 1366, height: 768 }, locale: 'en-US' },
  { viewport: { width: 1440, height: 900 }, locale: 'en-CA' }
]

const config = variations[Math.floor(Math.random() * variations.length)]
```

### 4. Handle Failures Gracefully

Expect and handle blocks:

```typescript
try {
  const content = await crawl(url)
} catch (error) {
  if (error.message.includes('blocked')) {
    // Wait and retry with different approach
    await sleep(60000)  // Wait 1 minute
    const content = await crawlWithBrowser(url)
  }
}
```

### 5. Monitor Success Rates

Track what works:

```typescript
const stats = {
  total: 0,
  blocked: 0,
  successful: 0
}

// Log patterns that cause blocks
if (blocked) {
  console.log('Blocked with config:', currentConfig)
  stats.blocked++
}
```

## Testing Your Configuration

Test against known anti-bot sites:

```typescript
// Test configuration
async function testAntiBot() {
  const testUrls = [
    'https://web-scraping.dev/antiblock/example',
    'https://web-scraping.dev/antiblock/cookies',
    'https://web-scraping.dev/antiblock/referer'
  ]
  
  for (const url of testUrls) {
    try {
      const result = await spider.crawl(url)
      console.log(`✅ ${url}: Success`)
    } catch (error) {
      console.log(`❌ ${url}: ${error.message}`)
    }
  }
}
```

## Limitations

Be aware of Spider's limitations:

1. **No CAPTCHA solving** - Spider cannot solve CAPTCHAs
2. **No residential proxies** - You'll need to add proxy support separately
3. **No AI detection bypass** - Advanced ML-based detection may still catch Spider
4. **Legal boundaries** - Respect terms of service and robots.txt

## Ethical Considerations

Always:
- Respect robots.txt unless you have permission
- Follow the website's terms of service
- Don't overload servers with requests
- Identify your bot in the user agent when appropriate
- Consider the website owner's perspective

## Next Steps

- [Browser Automation](./browser-automation.md) - JavaScript execution details
- [Security Handling](./security.md) - Authentication and sessions
- [Performance Guide](./performance.md) - Optimising while avoiding detection
- [Configuration Guide](./configuration.md) - All configuration options