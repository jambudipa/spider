# @jambudipa/spider

## 0.3.1

### Patch Changes

- Fix deduplicateUrls hanging with scoped layers by replacing unbounded concurrent Effect fibers with sequential plain JS Map deduplication

## 0.3.0

### Minor Changes

- ### Bug Fixes
  - Fix critical URL deduplication crash ("Cannot read private member #context") by eliminating URL object mutations in normalizeUrl across all 4 call sites

  ### Test Suite Overhaul
  - Rewrite all stub test files with real assertions (Spider, Scraper, SpiderMiddleware, PageData, Robots, UrlDeduplicator)
  - Add new utility test suites: UrlUtils (23 tests), JsonUtils (16 tests), RegexUtils (18 tests)
  - Remove 3 dead stub test files (BrowserManager, CSRFTokenLocks, SecretAPIToken)
  - Fix all pre-existing TypeScript type errors across scenario test files

  ### Structural Cleanup
  - Fix Effect layer composition patterns (Layer.mergeAll vs Layer.provide)
  - Fix Effect.Service access patterns in middleware tests
  - Extract Spider operational defaults to Spider.defaults.ts

## 0.2.1

### Patch Changes

- Comprehensive documentation validation and fixes
  - Fixed 39+ documentation issues across all guide files
  - Updated all Effect service usage patterns from `new SpiderService()` to `yield* SpiderService`
  - Converted ResumabilityService and other service patterns to proper Effect.js idioms
  - Added global doc-validation tool for automated documentation checking
  - Resolved syntax errors in API reference and configuration documentation
  - All code examples now follow idiomatic Effect.js patterns

## 0.2.0

### Minor Changes

- Add comprehensive documentation and achieve 100% test pass rate
  - Complete documentation structure with guides, API reference, and examples
  - Achieve 100% success rate on all 16 web-scraping.dev challenge scenarios
  - Add browser automation components (BrowserManager and PlaywrightAdapter)
  - Improve test organization and structure
  - Document all services and components accurately
  - Clarify anti-bot capabilities through configuration and browser automation
