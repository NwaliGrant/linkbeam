import { defineConfig } from "vitest/config";

// Several security tests send 50 requests at once, or 150 one after another, against a real local database.
// They take 2 to 5 seconds, which is close to the default 5-second limit and failed on a busy machine. This is a
// bigger time budget only: no test is retried and no assertion was changed.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
