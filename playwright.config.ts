import { defineConfig } from '@playwright/test';

// End-to-end tests against the plugin on a real handheld. See "End-to-end tests" in Readme.md.
export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    globalTeardown: './e2e/global-teardown.ts',
    // One device, one Steam client: never run in parallel, never retry (a retry hides device flakiness)
    workers: 1,
    fullyParallel: false,
    retries: 0,
    // Stop at the first failure: the next test would start from a device state nobody checked
    maxFailures: 1,
    timeout: 360_000,
    expect: { timeout: 30_000 },
    reporter: [['list'], ['html', { open: 'never' }]],
    outputDir: 'test-results',
});
