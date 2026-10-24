import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Same servers as the other browser tests, but only the Lighthouse audit, and one test at a time.
export default defineConfig({
  ...base,
  testMatch: /lighthouse\.spec\.ts/,
  testIgnore: [],
  timeout: 300_000,
});
