// Lists the licence of every dependency (direct and indirect) and flags anything that is not a permissive licence.
// Run: node scripts/licenses.mjs        (writes docs/evidence/stage7/licenses-*.csv and prints a summary)
// Exit code 1 if a licence is found that is not on the allow list and not explained in EXPLAINED below.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs", "evidence", "stage7");
mkdirSync(out, { recursive: true });

// Permissive licences that are compatible with publishing Linkbeam under MIT.
const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1", "MIT OR Apache-2.0", "(MIT OR CC0-1.0)"]);
// Weak-copyleft or attribution licences that are fine here, and why. Anything else fails the check.
const EXPLAINED = {
  "LGPL-3.0-or-later": "sharp's image library (libvips), a separate binary used while building. Not part of the deployed site or Worker, and not changed by us.",
  "MPL-2.0": "Build-time tools (lightningcss) and dev tests (axe-core). File-level copyleft only. Not changed by us and not shipped.",
  "CC-BY-4.0": "caniuse-lite browser data used while building. Attribution: Alexis Deveria and Sergey Rubanov. Not shipped.",
};

function scan(scope) {
  const args = ["licenses", "list", "--json", ...(scope === "production" ? ["--prod"] : [])];
  const data = JSON.parse(execFileSync("pnpm", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  const rows = [];
  for (const [license, packages] of Object.entries(data)) {
    for (const pkg of packages) for (const version of pkg.versions) rows.push({ name: pkg.name, version, license });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  writeFileSync(join(out, `licenses-${scope}.csv`), ["name,version,license", ...rows.map((r) => `${r.name},${r.version},"${r.license}"`)].join("\n") + "\n");
  return rows;
}

let failed = false;
for (const scope of ["production", "all"]) {
  const rows = scan(scope);
  const counts = new Map();
  for (const row of rows) counts.set(row.license, (counts.get(row.license) ?? 0) + 1);
  console.log(`\n${scope}: ${rows.length} packages`);
  for (const [license, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    const status = ALLOWED.has(license) ? "ok" : EXPLAINED[license] ? "explained" : "NOT ALLOWED";
    if (status === "NOT ALLOWED") failed = true;
    console.log(`  ${String(count).padStart(4)}  ${license}  [${status}]`);
  }
}
process.exit(failed ? 1 : 0);
