import { defineConfig } from "@playwright/test";

// Run "pnpm exec playwright install chromium" once, or set CHROMIUM_PATH to a Chromium or Chrome you already have.
const executablePath = process.env.CHROMIUM_PATH;

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  // Lighthouse is slow, so it has its own command: pnpm lighthouse
  testIgnore: /lighthouse\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4321",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    { command: "node start-api.mjs", url: "http://localhost:8787/api/v1/health", reuseExistingServer: false, timeout: 120_000 },
    { command: "node start-web.mjs", url: "http://localhost:4321/signin", reuseExistingServer: false, timeout: 120_000 },
  ],
});
