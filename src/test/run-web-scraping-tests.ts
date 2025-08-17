#!/usr/bin/env tsx

/**
 * Web-scraping.dev Functional Test Runner
 * Execute with: npx tsx src/test/run-web-scraping-tests.ts
 */

import { Effect, Exit } from 'effect';
import { program } from './functional/WebScrapingDevTests.js';

console.log('🕷️  Spider Web-scraping.dev Test Suite');
console.log('=====================================\n');

Effect.runPromiseExit(program)
  .then((exit) => {
    if (Exit.isFailure(exit)) {
      console.error('\n❌ Test execution failed:', exit.cause);
      process.exit(1);
    } else {
      console.log('\n✅ Test execution completed successfully');
      process.exit(0);
    }
  })
  .catch((error) => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });
