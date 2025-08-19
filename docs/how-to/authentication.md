# How to Handle Authentication

This guide shows you how to scrape websites that require authentication using various methods with Spider and Effect patterns.

## Cookie-Based Authentication

Most websites use session cookies after login. Here's how to handle cookie-based authentication:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';
import { EnhancedHttpClient, CookieManager } from '@jambudipa/spider';
import * as cheerio from 'cheerio';

const cookieAuthProgram = Effect.gen(function* () {
  const httpClient = yield* EnhancedHttpClient;
  const cookieManager = yield* CookieManager;
  const spider = yield* SpiderService;
  
  console.log('🔐 Starting cookie-based authentication...');
  
  try {
    // Step 1: Get the login page to retrieve any CSRF tokens
    const loginPageResponse = yield* httpClient.get('https://example.com/login');
    const $ = cheerio.load(loginPageResponse.body);
    const csrfToken = $('input[name="csrf_token"]').val() || $('meta[name="csrf-token"]').attr('content');
    
    console.log('📄 Login page loaded, CSRF token:', csrfToken ? 'found' : 'not found');

    // Step 2: Submit login form
    const loginFormData = {
      username: 'your-username',
      password: 'your-password',
      ...(csrfToken && { csrf_token: csrfToken })
    };
    
    const loginResult = yield* httpClient.submitForm('https://example.com/login', loginFormData);

    // Step 3: Check if login was successful
    if (loginResult.status === 200 && (loginResult.url.includes('dashboard') || loginResult.body.includes('Welcome'))) {
      console.log('✅ Login successful!');
      
      // Step 4: Use spider to crawl protected content with authenticated session
      const results = [];
      const collectSink = Sink.forEach((result) =>
        Effect.sync(() => {
          results.push(result);
          console.log(`🔒 Crawled protected page: ${result.pageData.title}`);
        })
      );
      
      yield* spider.crawl(['https://example.com/protected-page'], collectSink);
      
      return results;
      
    } else {
      return yield* Effect.fail(new Error('Login failed - check credentials'));
    }

  } catch (error) {
    return yield* Effect.fail(new Error(`Authentication failed: ${error.message}`));
  }
});

// Configuration for authenticated crawling
const config = makeSpiderConfig({
  userAgent: 'Authenticated Spider 1.0',
  requestDelayMs: 1000,
  maxPages: 10
});

// Run the cookie authentication program
Effect.runPromise(
  cookieAuthProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(EnhancedHttpClient.Live),
    Effect.provide(CookieManager.Live),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((results) => {
  console.log(`\n📊 Successfully crawled ${results.length} protected pages`);
}).catch((error) => {
  console.error('❌ Cookie authentication failed:', error.message);
});
```

## Token-Based Authentication (JWT/API Keys)

For APIs or sites using token-based auth:

```typescript
import { Effect, Sink, Ref } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';
import { EnhancedHttpClient } from '@jambudipa/spider';

// Token authentication service
const makeTokenAuthService = Effect.gen(function* () {
  const tokenRef = yield* Ref.make(null);
  const httpClient = yield* EnhancedHttpClient;
  
  const authenticate = (username, password) => Effect.gen(function* () {
    console.log('🔐 Getting authentication token...');
    
    // Step 1: Get authentication token
    const authResponse = yield* httpClient.post('https://api.example.com/auth/login', {
      username,
      password
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (authResponse.status !== 200) {
      return yield* Effect.fail(new Error('Authentication failed'));
    }

    const tokenData = JSON.parse(authResponse.body);
    const authToken = tokenData.access_token;
    
    if (!authToken) {
      return yield* Effect.fail(new Error('No access token received'));
    }

    // Store token for future requests
    yield* Ref.set(tokenRef, authToken);
    console.log('✅ Token obtained successfully');
    
    return { token: authToken, expiresIn: tokenData.expires_in };
  });
  
  const makeAuthenticatedRequest = (url, options = {}) => Effect.gen(function* () {
    const token = yield* Ref.get(tokenRef);
    
    if (!token) {
      return yield* Effect.fail(new Error('Not authenticated - no token available'));
    }
    
    // Add authorization header
    const requestOptions = {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      }
    };
    
    return yield* httpClient.request(url, requestOptions);
  });
  
  return {
    authenticate,
    makeAuthenticatedRequest,
    getToken: () => Ref.get(tokenRef)
  };
});

const tokenAuthProgram = Effect.gen(function* () {
  const authService = yield* makeTokenAuthService;
  const spider = yield* SpiderService;
  
  // Step 1: Authenticate and get token
  const authResult = yield* authService.authenticate('your-username', 'your-password');
  console.log('🔑 Token expires in:', authResult.expiresIn, 'seconds');
  
  // Step 2: Make authenticated API requests
  const protectedResponse = yield* authService.makeAuthenticatedRequest('https://api.example.com/protected-endpoint');
  const protectedData = JSON.parse(protectedResponse.body);
  
  console.log('🔒 Protected data:', protectedData);
  
  // Step 3: Use spider for crawling API endpoints (if needed)
  const apiEndpoints = [
    'https://api.example.com/user/profile',
    'https://api.example.com/user/data'
  ];
  
  const results = [];
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      results.push(result);
      console.log(`📡 API endpoint crawled: ${result.pageData.url}`);
    })
  );
  
  // Note: For API endpoints, you might need custom middleware to add auth headers
  // This is just an example of how you'd combine token auth with spider crawling
  yield* spider.crawl(apiEndpoints, collectSink);
  
  return { protectedData, crawlResults: results };
});

// Configuration for API scraping
const config = makeSpiderConfig({
  userAgent: 'Token Auth Spider 1.0',
  requestDelayMs: 500 // Faster for APIs
});

Effect.runPromise(
  tokenAuthProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(EnhancedHttpClient.Live),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((result) => {
  console.log('\n📊 Token authentication completed successfully');
  console.log('Protected data keys:', Object.keys(result.protectedData));
  console.log('Crawled endpoints:', result.crawlResults.length);
}).catch((error) => {
  console.error('❌ Token authentication failed:', error.message);
});
```

## Session-Based Authentication with Persistent Storage

For complex authentication flows, use session persistence:

```typescript
import { Effect, Sink, Ref } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';
import { EnhancedHttpClient, CookieManager } from '@jambudipa/spider';
import * as fs from 'fs/promises';

// Session management with persistent storage
const makeSessionService = (sessionFile = 'session.json') => Effect.gen(function* () {
  const sessionRef = yield* Ref.make(null);
  const httpClient = yield* EnhancedHttpClient;
  const cookieManager = yield* CookieManager;
  
  const saveSession = () => Effect.gen(function* () {
    // Save both cookies and session data
    const cookieData = yield* cookieManager.serialize();
    const sessionData = yield* Ref.get(sessionRef);
    
    const persistentSession = {
      cookies: cookieData,
      sessionData,
      timestamp: Date.now()
    };
    
    yield* Effect.tryPromise({
      try: () => fs.writeFile(sessionFile, JSON.stringify(persistentSession), 'utf8'),
      catch: (error) => new Error(`Failed to save session: ${error}`)
    });
    
    console.log('💾 Session saved to', sessionFile);
  });
  
  const loadSession = () => Effect.gen(function* () {
    const fileExists = yield* Effect.tryPromise({
      try: () => fs.access(sessionFile),
      catch: () => false
    }).pipe(Effect.map(() => true), Effect.orElse(() => Effect.succeed(false)));
    
    if (!fileExists) {
      console.log('ℹ️ No existing session file found');
      return false;
    }
    
    const sessionContent = yield* Effect.tryPromise({
      try: () => fs.readFile(sessionFile, 'utf8'),
      catch: (error) => new Error(`Failed to read session: ${error}`)
    });
    
    const persistentSession = JSON.parse(sessionContent);
    
    // Check if session is too old (24 hours)
    if (Date.now() - persistentSession.timestamp > 24 * 60 * 60 * 1000) {
      console.log('⏰ Session expired, will re-authenticate');
      return false;
    }
    
    // Restore cookies and session data
    yield* cookieManager.deserialize(persistentSession.cookies);
    yield* Ref.set(sessionRef, persistentSession.sessionData);
    
    console.log('✅ Session restored from', sessionFile);
    return true;
  });
  
  const authenticate = (username, password) => Effect.gen(function* () {
    console.log('🔐 Authenticating with session management...');
    
    // Login and get session data
    const loginResult = yield* httpClient.post('https://example.com/api/login', {
      username,
      password
    });
    
    if (loginResult.status !== 200) {
      return yield* Effect.fail(new Error('Login failed'));
    }
    
    const sessionData = JSON.parse(loginResult.body);
    
    // Store session data
    yield* Ref.set(sessionRef, {
      sessionToken: sessionData.sessionToken,
      userId: sessionData.userId,
      expiresAt: new Date(Date.now() + sessionData.expiresIn * 1000)
    });
    
    // Save to persistent storage
    yield* saveSession();
    
    console.log('✅ Authentication successful, session stored');
    return sessionData;
  });
  
  const validateSession = () => Effect.gen(function* () {
    // Test session validity by accessing profile endpoint
    const profileResponse = yield* httpClient.get('https://example.com/api/profile').pipe(
      Effect.catchAll(() => Effect.succeed({ status: 401 }))
    );
    
    const isValid = profileResponse.status === 200;
    console.log(isValid ? '✅ Session is valid' : '❌ Session expired');
    
    return isValid;
  });
  
  return {
    authenticate,
    saveSession,
    loadSession,
    validateSession,
    getSession: () => Ref.get(sessionRef)
  };
});

const sessionAuthProgram = Effect.gen(function* () {
  const sessionService = yield* makeSessionService('spider-session.json');
  const spider = yield* SpiderService;
  
  // Try to load existing session
  const sessionLoaded = yield* sessionService.loadSession();
  
  if (sessionLoaded) {
    const sessionValid = yield* sessionService.validateSession();
    
    if (!sessionValid) {
      console.log('🔄 Re-authenticating...');
      yield* sessionService.authenticate('user', 'pass');
    }
  } else {
    console.log('🆕 First-time authentication...');
    yield* sessionService.authenticate('user', 'pass');
  }
  
  // Now use spider to crawl protected content
  const results = [];
  const collectSink = Sink.forEach((result) =>
    Effect.sync(() => {
      results.push(result);
      console.log(`🔒 Crawled: ${result.pageData.title}`);
    })
  );
  
  yield* spider.crawl(['https://example.com/api/profile', 'https://example.com/dashboard'], collectSink);
  
  return results;
});

// Configuration
const config = makeSpiderConfig({
  userAgent: 'Session Spider 1.0',
  requestDelayMs: 1000,
  maxPages: 5
});

Effect.runPromise(
  sessionAuthProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(EnhancedHttpClient.Live),
    Effect.provide(CookieManager.Live),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((results) => {
  console.log(`\n📊 Session-based authentication completed: ${results.length} pages crawled`);
}).catch((error) => {
  console.error('❌ Session authentication failed:', error.message);
});
```

## Form-Based Authentication with CSRF Protection

Handle complex forms with CSRF tokens and hidden fields:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';
import { EnhancedHttpClient, CookieManager } from '@jambudipa/spider';
import * as cheerio from 'cheerio';

const formAuthProgram = Effect.gen(function* () {
  const httpClient = yield* EnhancedHttpClient;
  const spider = yield* SpiderService;
  
  console.log('📋 Starting form-based authentication...');

  try {
    // Step 1: Get login form and extract all necessary fields
    const formPageResponse = yield* httpClient.get('https://secure-site.com/login');
    const $ = cheerio.load(formPageResponse.body);
    
    // Extract form data
    const formData = {
      csrfToken: $('input[name="_token"]').val(),
      sessionId: $('input[name="session_id"]').val(),
      formAction: $('form#login-form').attr('action') || '/login'
    };
    
    console.log('📄 Form data extracted:', {
      hasCsrfToken: !!formData.csrfToken,
      hasSessionId: !!formData.sessionId,
      formAction: formData.formAction
    });

    // Step 2: Submit form with all required fields
    const formSubmissionData = {
      username: 'your-username',
      password: 'your-password',
      ...(formData.csrfToken && { _token: formData.csrfToken }),
      ...(formData.sessionId && { session_id: formData.sessionId }),
      remember_me: '1'
    };
    
    const loginResult = yield* httpClient.submitForm(
      `https://secure-site.com${formData.formAction}`,
      formSubmissionData,
      {
        headers: {
          'Referer': 'https://secure-site.com/login'
        }
      }
    );

    // Step 3: Verify login success and continue scraping
    if (loginResult.status === 200 && !loginResult.url.includes('login')) {
      console.log('✅ Form authentication successful');
      
      // Use spider to crawl protected content
      const results = [];
      const collectSink = Sink.forEach((result) =>
        Effect.sync(() => {
          results.push(result);
          console.log(`🔒 Accessed protected page: ${result.pageData.title}`);
        })
      );
      
      yield* spider.crawl(['https://secure-site.com/dashboard'], collectSink);
      
      return results;
      
    } else {
      return yield* Effect.fail(new Error('Form authentication failed - check credentials or form fields'));
    }

  } catch (error) {
    return yield* Effect.fail(new Error(`Form authentication failed: ${error.message}`));
  }
});

// Configuration for form authentication
const config = makeSpiderConfig({
  userAgent: 'Form Auth Spider 1.0',
  requestDelayMs: 1500, // Be respectful with form submissions
  maxPages: 5
});

Effect.runPromise(
  formAuthProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(EnhancedHttpClient.Live),
    Effect.provide(CookieManager.Live),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((results) => {
  console.log(`\n📊 Form authentication completed: ${results.length} pages accessed`);
}).catch((error) => {
  console.error('❌ Form authentication failed:', error.message);
});
```

## OAuth 2.0 Authentication

For OAuth-protected resources:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';
import { EnhancedHttpClient } from '@jambudipa/spider';

const oauthAuthProgram = Effect.gen(function* () {
  const httpClient = yield* EnhancedHttpClient;
  const spider = yield* SpiderService;
  
  // This assumes you already have an OAuth access token
  // In practice, you'd implement the full OAuth flow
  const accessToken = 'your-oauth-access-token';
  
  console.log('🔐 Starting OAuth 2.0 authentication...');
  
  // Helper to make OAuth-authenticated requests
  const makeOAuthRequest = (url) => Effect.gen(function* () {
    return yield* httpClient.get(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
  });

  try {
    // Step 1: Access OAuth-protected profile API
    const profileResponse = yield* makeOAuthRequest('https://api.example.com/v1/user/profile');
    
    if (profileResponse.status !== 200) {
      return yield* Effect.fail(new Error(`OAuth request failed: ${profileResponse.status}`));
    }
    
    const profileData = JSON.parse(profileResponse.body);
    console.log('👤 User profile loaded:', profileData.username || profileData.name);

    // Step 2: Access multiple protected endpoints
    const endpoints = [
      'https://api.example.com/v1/user/posts',
      'https://api.example.com/v1/user/followers', 
      'https://api.example.com/v1/user/following'
    ];

    const apiResults = [];
    
    for (const endpoint of endpoints) {
      console.log(`📡 Fetching: ${endpoint}`);
      
      const response = yield* makeOAuthRequest(endpoint).pipe(
        Effect.catchAll((error) => {
          console.log(`⚠️ Failed to fetch ${endpoint}: ${error.message}`);
          return Effect.succeed({ status: 500, body: '{}' });
        })
      );
      
      if (response.status === 200) {
        const data = JSON.parse(response.body);
        apiResults.push({
          endpoint,
          count: Array.isArray(data) ? data.length : Object.keys(data).length,
          data: data
        });
        
        console.log(`✅ ${endpoint}: ${apiResults[apiResults.length - 1].count} items`);
      }
    }
    
    // Step 3: Use spider for additional web scraping if needed
    // Note: For OAuth APIs, you might need custom middleware to add auth headers
    const results = [];
    const collectSink = Sink.forEach((result) =>
      Effect.sync(() => {
        results.push(result);
        console.log(`🕷️ Crawled: ${result.pageData.url}`);
      })
    );
    
    // Example: if the API provides URLs to scrape
    const urlsToScrape = apiResults
      .flatMap(result => result.data.urls || [])
      .slice(0, 5); // Limit to first 5 URLs
    
    if (urlsToScrape.length > 0) {
      console.log(`🔍 Found ${urlsToScrape.length} URLs to scrape from API results`);
      yield* spider.crawl(urlsToScrape, collectSink);
    }
    
    return {
      profile: profileData,
      apiResults,
      scrapedPages: results
    };

  } catch (error) {
    return yield* Effect.fail(new Error(`OAuth authentication failed: ${error.message}`));
  }
});

// Configuration for OAuth scraping
const config = makeSpiderConfig({
  userAgent: 'OAuth Spider 1.0',
  requestDelayMs: 1000,
  maxPages: 10
});

Effect.runPromise(
  oauthAuthProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(EnhancedHttpClient.Live),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((result) => {
  console.log('\n📊 OAuth Authentication Results:');
  console.log(`👤 Profile: ${result.profile.username || result.profile.name}`);
  console.log(`📡 API endpoints accessed: ${result.apiResults.length}`);
  console.log(`🕷️ Pages scraped: ${result.scrapedPages.length}`);
  
  result.apiResults.forEach(api => {
    console.log(`  ${api.endpoint}: ${api.count} items`);
  });
  
}).catch((error) => {
  console.error('❌ OAuth authentication failed:', error.message);
  
  if (error.message.includes('401') || error.message.includes('403')) {
    console.error('💡 Check your OAuth access token and permissions');
  }
});
```

## Multi-Step Authentication

For complex authentication flows with multiple steps:

```typescript
import { Effect, Sink } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';
import { EnhancedHttpClient, CookieManager } from '@jambudipa/spider';
import * as cheerio from 'cheerio';

const multiStepAuthProgram = Effect.gen(function* () {
  const httpClient = yield* EnhancedHttpClient;
  const spider = yield* SpiderService;
  
  console.log('🔐 Starting multi-step authentication...');

  try {
    // Step 1: Initial login with username
    console.log('📝 Step 1: Submitting username...');
    
    const step1Response = yield* httpClient.post('https://example.com/auth/step1', {
      username: 'your-username'
    });
    
    if (step1Response.status !== 200) {
      return yield* Effect.fail(new Error(`Step 1 failed: ${step1Response.status}`));
    }
    
    // Extract session token from response
    const step1Data = JSON.parse(step1Response.body);
    const sessionToken = step1Data.sessionToken;
    
    console.log('✅ Step 1 completed, session token received');

    // Step 2: Handle 2FA or additional verification
    console.log('🔢 Step 2: Submitting verification code...');
    
    const step2Response = yield* httpClient.post('https://example.com/auth/step2', {
      verification_code: '123456', // From SMS/email/authenticator app
      session_token: sessionToken
    });
    
    if (step2Response.status !== 200) {
      return yield* Effect.fail(new Error(`Step 2 failed: ${step2Response.status}`));
    }
    
    const step2Data = JSON.parse(step2Response.body);
    const authToken = step2Data.authToken;
    
    console.log('✅ Step 2 completed, auth token received');

    // Step 3: Final authentication with password
    console.log('🔑 Step 3: Submitting password...');
    
    const step3Response = yield* httpClient.post('https://example.com/auth/step3', {
      password: 'your-password',
      auth_token: authToken
    });

    if (step3Response.status !== 200) {
      return yield* Effect.fail(new Error(`Step 3 failed: ${step3Response.status}`));
    }
    
    console.log('🎉 Multi-step authentication successful!');
    
    // Step 4: Access protected resources using authenticated session
    const results = [];
    const collectSink = Sink.forEach((result) =>
      Effect.sync(() => {
        results.push(result);
        console.log(`🔒 Accessed protected page: ${result.pageData.title}`);
      })
    );
    
    // Now use spider to crawl protected content
    yield* spider.crawl([
      'https://example.com/protected',
      'https://example.com/dashboard',
      'https://example.com/profile'
    ], collectSink);
    
    return {
      authenticationSteps: 3,
      finalToken: authToken.substring(0, 10) + '...', // Don't log full token
      protectedPagesAccessed: results.length,
      results
    };

  } catch (error) {
    return yield* Effect.fail(new Error(`Multi-step authentication failed: ${error.message}`));
  }
});

// Configuration for multi-step auth
const config = makeSpiderConfig({
  userAgent: 'Multi-Step Auth Spider 1.0',
  requestDelayMs: 1500, // Allow time between auth steps
  maxPages: 10
});

Effect.runPromise(
  multiStepAuthProgram.pipe(
    Effect.provide(SpiderService.Default),
    Effect.provide(EnhancedHttpClient.Live),
    Effect.provide(CookieManager.Live),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((result) => {
  console.log('\n📊 Multi-Step Authentication Summary:');
  console.log(`🔐 Authentication steps completed: ${result.authenticationSteps}`);
  console.log(`🔑 Final auth token: ${result.finalToken}`);
  console.log(`🔒 Protected pages accessed: ${result.protectedPagesAccessed}`);
  
  result.results.forEach((page, index) => {
    console.log(`  ${index + 1}. ${page.pageData.title} (${page.pageData.statusCode})`);
  });
  
}).catch((error) => {
  console.error('❌ Multi-step authentication failed:', error.message);
  
  // Provide specific guidance based on error
  if (error.message.includes('Step 1')) {
    console.error('💡 Check your username');
  } else if (error.message.includes('Step 2')) {
    console.error('💡 Check your verification code (2FA)');
  } else if (error.message.includes('Step 3')) {
    console.error('💡 Check your password');
  }
});
```

## Handling Authentication Errors

Implement robust error handling for authentication:

```typescript
import { Effect, Schedule, Duration } from 'effect';
import { SpiderService, SpiderConfig, makeSpiderConfig, SpiderLoggerLive } from '@jambudipa/spider';
import { EnhancedHttpClient, NetworkError } from '@jambudipa/spider';

const robustAuthProgram = Effect.gen(function* () {
  const httpClient = yield* EnhancedHttpClient;
  
  console.log('🔐 Starting robust authentication with error handling...');
  
  const attemptLogin = (username, password) => Effect.gen(function* () {
    const response = yield* httpClient.post('https://example.com/login', {
      username,
      password
    });
    
    if (response.status === 200) {
      console.log('✅ Authentication successful');
      return { success: true, response };
    } else if (response.status === 401) {
      return yield* Effect.fail(new Error('Invalid credentials'));
    } else if (response.status === 429) {
      return yield* Effect.fail(new Error('Rate limited'));
    } else {
      return yield* Effect.fail(new Error(`Unexpected status: ${response.status}`));
    }
  });
  
  // Create retry schedule with exponential backoff
  const retrySchedule = Schedule.exponential(Duration.seconds(2), 2).pipe(
    Schedule.compose(Schedule.recurs(3)), // Max 3 retries
    Schedule.tapInput((error) =>
      Effect.sync(() => {
        console.log(`🔄 Retry attempt due to: ${error.message}`);
      })
    )
  );
  
  const loginWithRetry = attemptLogin('user', 'pass').pipe(
    Effect.retry({
      schedule: retrySchedule,
      while: (error) => {
        // Only retry on rate limiting and network errors
        // Don't retry on credential errors (401)
        if (error.message.includes('Invalid credentials')) {
          console.error('❌ Authentication failed: Invalid credentials');
          return false; // Don't retry
        }
        
        if (error.message.includes('Rate limited')) {
          console.log('⏳ Rate limited, will retry with backoff...');
          return true; // Retry
        }
        
        // Retry on other errors
        console.log('⚠️ Retrying due to error:', error.message);
        return true;
      }
    }),
    Effect.catchTags({
      NetworkError: (error) => {
        if (error.statusCode === 403) {
          console.error('❌ Authentication failed: Account locked or forbidden');
          return Effect.fail(new Error('Account access denied'));
        }
        return Effect.fail(error);
      }
    })
  );
  
  // Execute login with comprehensive error handling
  const loginResult = yield* loginWithRetry.pipe(
    Effect.timeout(Duration.seconds(30)), // Overall timeout
    Effect.catchTags({
      TimeoutException: () => {
        console.error('❌ Authentication timed out');
        return Effect.fail(new Error('Authentication timeout'));
      }
    })
  );
  
  console.log('🎉 Authentication completed successfully');
  return loginResult;
});

// Configuration with error handling settings
const config = makeSpiderConfig({
  userAgent: 'Robust Auth Spider 1.0',
  requestDelayMs: 1000,
  // Add timeout and retry settings if available in your config
});

Effect.runPromise(
  robustAuthProgram.pipe(
    Effect.provide(EnhancedHttpClient.Live),
    Effect.provide(SpiderConfig.Live(config)),
    Effect.provide(SpiderLoggerLive)
  )
).then((result) => {
  console.log('\n🎯 Robust authentication completed successfully');
}).catch((error) => {
  console.error('❌ All authentication attempts failed:', error.message);
  
  // Handle specific error cases
  if (error.message.includes('Invalid credentials')) {
    console.error('💡 Check your username and password');
  } else if (error.message.includes('Rate limited')) {
    console.error('💡 Too many requests - try again later');
  } else if (error.message.includes('timeout')) {
    console.error('💡 Check your network connection');
  }
});
```

## Best Practices for Authentication with Spider

1. **Always respect robots.txt** even for authenticated areas
2. **Use appropriate delays** between requests to avoid triggering anti-bot measures
3. **Handle session expiration** by detecting logout pages and re-authenticating
4. **Store credentials securely** using environment variables
5. **Implement proper error handling** using Effect patterns:
   - Use `Effect.catchTags` to handle specific error types
   - Use `Effect.retry` with exponential backoff for transient failures
   - Use `Effect.timeout` to prevent hanging requests
6. **Use cookie persistence** through CookieManager for session management
7. **Rotate user agents and headers** to appear more like a regular browser
8. **Use Effect.gen** for readable async code flow
9. **Provide proper dependencies** through Effect layers
10. **Save and restore sessions** for long-running operations

## Troubleshooting Authentication Issues

Common problems and solutions:

### Missing CSRF Tokens
```typescript
// Always extract and include CSRF tokens
const $ = cheerio.load(loginPageResponse.body);
const csrfToken = $('input[name="_token"]').val() || $('meta[name="csrf-token"]').attr('content');
```

### Cookie Expiration
```typescript
// Implement session validation
const validateSession = () => Effect.gen(function* () {
  const response = yield* httpClient.get('https://example.com/profile');
  return response.status === 200 && !response.url.includes('/login');
});
```

### Rate Limiting
```typescript
// Use proper retry schedules
const retrySchedule = Schedule.exponential(Duration.seconds(2), 2).pipe(
  Schedule.compose(Schedule.recurs(3))
);
```

### Network Errors
```typescript
// Handle specific error types
Effect.catchTags({
  NetworkError: (error) => {
    if (error.statusCode === 429) {
      return Effect.fail(new Error('Rate limited'));
    }
    return Effect.fail(error);
  }
})
```

### Authentication State Management
```typescript
// Use Ref for state management
const tokenRef = yield* Ref.make(null);
const cookieManager = yield* CookieManager;

// Persist sessions to disk
const sessionData = yield* cookieManager.serialize();
yield* Effect.tryPromise({
  try: () => fs.writeFile('session.json', sessionData),
  catch: (error) => new Error(`Failed to save: ${error}`)
});
```

Remember: Always use Effect patterns with `yield*` for accessing services and proper error handling through the Effect system.
