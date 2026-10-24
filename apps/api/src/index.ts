import { createApp } from "./app";
import { cleanup } from "./cleanup";
import type { Bindings } from "./env";

const app = createApp();

export default {
  fetch: app.fetch,
  // Runs on the cron schedule in wrangler.toml. Keeps the free database small.
  async scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanup(env.DB, Math.floor(Date.now() / 1000)));
  },
} satisfies ExportedHandler<Bindings>;
