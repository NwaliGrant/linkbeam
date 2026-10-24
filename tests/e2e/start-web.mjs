// Starts the site's dev server and keeps it in the foreground, which Playwright needs.
// (The "astro dev" command may detach itself when it detects an AI agent, so the programmatic API is used.)
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "web");
const require = createRequire(join(root, "package.json"));
const { dev } = await import(require.resolve("astro"));
const server = await dev({ root, logLevel: "info", server: { port: 4321, host: "localhost" } });
const stop = async () => { await server.stop(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
