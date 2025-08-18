# Browser Automation Guide

Spider integrates with Playwright to handle JavaScript-rendered content, dynamic loading, and complex web interactions. This guide covers how to use browser automation effectively.

## Overview

Spider includes two main components for browser automation:
- `BrowserManager` - Manages browser lifecycle and pooling
- `PlaywrightAdapter` - Wraps Playwright functionality for Spider integration

## When to Use Browser Automation

Use browser automation when:
- Content is rendered by JavaScript
- Pages use infinite scroll or dynamic loading
- Authentication requires form interaction
- Anti-bot measures require JavaScript execution
- You need to interact with page elements (buttons, forms)

Avoid browser automation when:
- Content is available in static HTML
- You need maximum crawling speed
- Server resources are limited

## Basic Setup

### Installation

First, install Playwright:

```bash
npm install playwright
# Download browser binaries
npx playwright install chromium
```

### Enable in Configuration

```typescript
import { makeSpiderConfig } from '@jambudipa/spider'

const config = makeSpiderConfig({
  enableBrowserAutomation: true,
  browserOptions: {
    headless: true,
    viewport: { width: 1920, height: 1080 }
  }
})
```

## BrowserManager

The `BrowserManager` class handles browser lifecycle and pooling:

```typescript
import { BrowserManager } from '@jambudipa/spider/browser'

const manager = new BrowserManager({
  headless: true,              // Run without UI
  timeout: 30000,              // Page timeout (30s)
  poolSize: 3,                 // Browser instances
  viewport: { width: 1920, height: 1080 },
  userAgent: 'Mozilla/5.0...',
  locale: 'en-GB',
  extraHTTPHeaders: {
    'Accept-Language': 'en-GB,en;q=0.9'
  }
})

// Initialise browser pool
await manager.initialise()

// Get a page for crawling
const page = await manager.getPage('https://example.com')

// Clean up when done
await manager.cleanup()
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `headless` | boolean | true | Run browser without UI |
| `timeout` | number | 30000 | Page load timeout (ms) |
| `poolSize` | number | 3 | Number of browser instances |
| `viewport` | object | {width: 1920, height: 1080} | Browser viewport size |
| `userAgent` | string | Chrome default | Custom user agent |
| `locale` | string | 'en-GB' | Browser locale |
| `extraHTTPHeaders` | object | {} | Additional HTTP headers |

## PlaywrightAdapter

The `PlaywrightAdapter` wraps Playwright pages for Spider:

```typescript
import { PlaywrightAdapter } from '@jambudipa/spider/browser'

const adapter = new PlaywrightAdapter(page)

// Navigate to URL
await adapter.goto('https://example.com')

// Wait for content to load
await adapter.waitForSelector('.content')

// Extract HTML
const html = await adapter.content()

// Take screenshot
await adapter.screenshot({ path: 'page.png' })

// Execute JavaScript
const result = await adapter.evaluate(() => {
  return document.title
})
```

## Common Patterns

### Handling Dynamic Content

```typescript
// Wait for JavaScript to render content
const adapter = new PlaywrightAdapter(page)
await adapter.goto(url)

// Wait for specific element
await adapter.waitForSelector('.dynamic-content', {
  timeout: 10000
})

// Or wait for network idle
await adapter.waitForLoadState('networkidle')

const html = await adapter.content()
```

### Infinite Scroll

```typescript
async function handleInfiniteScroll(adapter: PlaywrightAdapter) {
  let previousHeight = 0
  let currentHeight = await adapter.evaluate(() => document.body.scrollHeight)
  
  while (previousHeight !== currentHeight) {
    // Scroll to bottom
    await adapter.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight)
    })
    
    // Wait for new content
    await adapter.waitForTimeout(2000)
    
    previousHeight = currentHeight
    currentHeight = await adapter.evaluate(() => document.body.scrollHeight)
  }
  
  return await adapter.content()
}
```

### Click to Load More

```typescript
async function loadMoreContent(adapter: PlaywrightAdapter) {
  while (true) {
    // Check if load more button exists
    const hasButton = await adapter.evaluate(() => {
      const button = document.querySelector('#load-more')
      return button !== null && !button.disabled
    })
    
    if (!hasButton) break
    
    // Click the button
    await adapter.click('#load-more')
    
    // Wait for new content
    await adapter.waitForTimeout(1000)
  }
  
  return await adapter.content()
}
```

### Form Interaction

```typescript
async function submitForm(adapter: PlaywrightAdapter) {
  // Fill form fields
  await adapter.fill('#username', 'myuser')
  await adapter.fill('#password', 'mypass')
  
  // Select dropdown
  await adapter.selectOption('#country', 'UK')
  
  // Check checkbox
  await adapter.check('#agree-terms')
  
  // Submit form
  await adapter.click('#submit-button')
  
  // Wait for navigation
  await adapter.waitForNavigation()
}
```

### Cookie Handling

```typescript
// Accept cookie popup
async function acceptCookies(adapter: PlaywrightAdapter) {
  try {
    // Wait for popup to appear
    await adapter.waitForSelector('.cookie-popup', {
      timeout: 5000
    })
    
    // Click accept button
    await adapter.click('button:has-text("Accept")')
    
    // Wait for popup to disappear
    await adapter.waitForSelector('.cookie-popup', {
      state: 'hidden'
    })
  } catch {
    // No cookie popup, continue
  }
}
```

## Working with Spider

### Integration Example

```typescript
import { SpiderService, makeSpiderConfig } from '@jambudipa/spider'
import { BrowserManager, PlaywrightAdapter } from '@jambudipa/spider/browser'
import { Effect, Sink } from 'effect'

const browserManager = new BrowserManager({
  headless: true,
  poolSize: 5
})

await browserManager.initialise()

const program = Effect.gen(function* () {
  const spider = yield* SpiderService
  
  const processPage = Sink.forEach(result =>
    Effect.gen(function* () {
      // Get page from pool
      const page = yield* Effect.promise(() => 
        browserManager.getPage(result.pageData.url)
      )
      
      const adapter = new PlaywrightAdapter(page)
      
      // Handle dynamic content
      yield* Effect.promise(async () => {
        await adapter.waitForSelector('.content')
        const dynamicHtml = await adapter.content()
        
        // Process the dynamic content
        console.log('Processed:', result.pageData.url)
      })
      
      // Return page to pool
      yield* Effect.promise(() => 
        browserManager.releasePage(page)
      )
    })
  )
  
  yield* spider.crawl('https://example.com', processPage)
})

// Run and cleanup
try {
  await Effect.runPromise(program.pipe(
    Effect.provide(SpiderService.Default)
  ))
} finally {
  await browserManager.cleanup()
}
```

## Performance Considerations

### Browser Pool Size

Balance between performance and resource usage:

```typescript
// For high-performance systems
const config = {
  poolSize: 10,  // More parallel browsers
  headless: true
}

// For resource-constrained systems
const config = {
  poolSize: 2,   // Fewer browsers
  headless: true
}
```

### Page Caching

Reuse pages when possible:

```typescript
class PagePool {
  private pages: Map<string, Page> = new Map()
  
  async getPage(domain: string): Promise<Page> {
    if (!this.pages.has(domain)) {
      const page = await this.browser.newPage()
      this.pages.set(domain, page)
    }
    return this.pages.get(domain)!
  }
}
```

### Resource Blocking

Block unnecessary resources for faster loading:

```typescript
await page.route('**/*', route => {
  const resourceType = route.request().resourceType()
  
  // Block images, stylesheets, fonts
  if (['image', 'stylesheet', 'font'].includes(resourceType)) {
    route.abort()
  } else {
    route.continue()
  }
})
```

## Debugging

### Visual Debugging

Run with headless mode disabled:

```typescript
const manager = new BrowserManager({
  headless: false,  // See the browser
  timeout: 60000    // Longer timeout for debugging
})
```

### Screenshots

Capture screenshots for debugging:

```typescript
await adapter.screenshot({
  path: `screenshots/${Date.now()}.png`,
  fullPage: true
})
```

### Console Logs

Capture browser console output:

```typescript
page.on('console', msg => {
  console.log('Browser console:', msg.text())
})

page.on('pageerror', error => {
  console.error('Browser error:', error)
})
```

## Best Practices

### 1. Use Browser Automation Sparingly
Only when necessary for JavaScript content:

```typescript
// Check if content needs browser
const needsBrowser = await checkIfDynamic(url)

if (needsBrowser) {
  // Use browser automation
} else {
  // Use standard HTTP client
}
```

### 2. Implement Timeouts
Always set reasonable timeouts:

```typescript
await adapter.waitForSelector('.content', {
  timeout: 10000  // 10 seconds max
})
```

### 3. Handle Errors Gracefully
Browser automation can fail in many ways:

```typescript
try {
  await adapter.click('#button')
} catch (error) {
  console.warn('Button not found, continuing...')
  // Try alternative approach
}
```

### 4. Clean Up Resources
Always cleanup browser resources:

```typescript
try {
  // Your browser automation code
} finally {
  await page.close()
  await browser.close()
}
```

### 5. Respect Server Resources
Add delays between interactions:

```typescript
await adapter.click('#button')
await adapter.waitForTimeout(1000)  // 1 second delay
await adapter.click('#next')
```

## Troubleshooting

### Browser Won't Start
- Check Playwright is installed: `npx playwright install chromium`
- Verify system dependencies: `npx playwright install-deps`

### Timeouts
- Increase timeout values
- Check network connectivity
- Verify selectors are correct

### Memory Issues
- Reduce pool size
- Close unused pages
- Disable image loading

### Detection Issues
- Use realistic viewport sizes
- Add random delays
- Rotate user agents

## Next Steps

- [Anti-Bot Protection](./anti-bot.md) - Avoiding detection
- [Security Handling](./security.md) - Authentication with browsers
- [Performance Guide](./performance.md) - Optimising browser automation
- [Examples](../examples/) - Real-world browser automation examples