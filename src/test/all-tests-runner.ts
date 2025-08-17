#!/usr/bin/env tsx
/**
 * Run all Spider tests against real web-scraping.dev
 * This script runs all tests and reports results
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const testFiles = [
  'src/test/scenarios/static/StaticPaging.working.test.ts',
  'src/test/scenarios/dynamic/DynamicContent.working.test.ts',
  'src/test/scenarios/auth/Authentication.working.test.ts',
];

async function runTests() {
  console.log('🚀 Running all Spider tests against web-scraping.dev\n');
  console.log('='.repeat(60));

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  for (const testFile of testFiles) {
    console.log(`\n📁 Running: ${testFile.split('/').pop()}`);
    console.log('-'.repeat(40));

    try {
      const { stdout, stderr } = await execAsync(
        `npm test -- --run ${testFile} 2>&1 | grep -E "Test Files|Tests" | tail -2`
      );

      // Parse results
      const match = stdout.match(/(\d+) failed.*(\d+) passed.*\((\d+)\)/);
      if (match) {
        const failed = parseInt(match[1]) || 0;
        const passed = parseInt(match[2]) || 0;
        const total = parseInt(match[3]) || 0;

        totalTests += total;
        passedTests += passed;
        failedTests += failed;

        if (failed === 0) {
          console.log(`✅ All ${total} tests passed`);
        } else {
          console.log(`⚠️  ${failed} failed, ${passed} passed out of ${total}`);
        }
      } else if (stdout.includes('passed')) {
        // All passed
        const passMatch = stdout.match(/(\d+) passed/);
        if (passMatch) {
          const passed = parseInt(passMatch[1]);
          totalTests += passed;
          passedTests += passed;
          console.log(`✅ All ${passed} tests passed`);
        }
      }
    } catch (error) {
      console.log(`❌ Error running tests: ${error}`);
      failedTests++;
    }
  }

  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 FINAL RESULTS');
  console.log('='.repeat(60));
  console.log(`Total Tests: ${totalTests}`);
  console.log(
    `Passed: ${passedTests} (${((passedTests / totalTests) * 100).toFixed(1)}%)`
  );
  console.log(`Failed: ${failedTests}`);

  if (failedTests === 0) {
    console.log('\n✅ ALL TESTS PASSED! Spider is working correctly.');
  } else {
    console.log(`\n⚠️  ${failedTests} tests failed. See details above.`);
  }

  process.exit(failedTests > 0 ? 1 : 0);
}

runTests().catch(console.error);
