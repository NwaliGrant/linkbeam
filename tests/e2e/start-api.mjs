// Starts a throwaway local API for the browser tests: fresh database, migrations applied, console mail.
// Mail is printed to .e2e/api.log, which the tests read to find sign-in links.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const e2e = join(root, ".e2e");
const state = join(e2e, "state");
rmSync(e2e, { recursive: true, force: true });
mkdirSync(state, { recursive: true });

const env = { ...process.env, WRANGLER_SEND_METRICS: "false" };
const api = join(root, "apps", "api");
const migrate = spawnSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "linkbeam", "--local", "--persist-to", state], { cwd: api, env, stdio: "inherit" });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);

const log = createWriteStream(join(e2e, "api.log"));
const child = spawn(
  "pnpm",
  ["exec", "wrangler", "dev", "--port", "8787", "--persist-to", state,
    "--var", "APP_URL:http://localhost:4321", "--var", "MAIL_MODE:console", "--var", "IP_HASH_SECRET:e2e-secret"],
  { cwd: api, env, stdio: ["ignore", "pipe", "pipe"] },
);
child.stdout.on("data", (chunk) => { log.write(chunk); process.stdout.write(chunk); });
child.stderr.on("data", (chunk) => { log.write(chunk); process.stderr.write(chunk); });
const stop = () => { child.kill("SIGTERM"); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
