# @jambudipa/spider

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
