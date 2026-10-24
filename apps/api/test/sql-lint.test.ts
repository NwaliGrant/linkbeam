import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const eslint = new ESLint({ cwd: root });

async function messagesFor(code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(root, "apps/api/src/example.ts") });
  return (result?.messages ?? []).filter((message) => message.ruleId === "no-restricted-syntax").map((message) => message.message);
}

describe("lint rule against string-built SQL", () => {
  it("fails a query built with a template literal", async () => {
    const found = await messagesFor("export const q = (db: D1Database, name: string) => db.prepare(`SELECT * FROM users WHERE name = '${name}'`);");
    expect(found.length).toBeGreaterThan(0);
  });

  it("fails a query built with concatenation", async () => {
    const found = await messagesFor("export const q = (db: D1Database, name: string) => db.prepare('SELECT * FROM users WHERE name = ' + name);");
    expect(found.length).toBeGreaterThan(0);
  });

  it("fails raw exec with a built string", async () => {
    const found = await messagesFor("export const q = (db: D1Database, name: string) => db.exec(`DELETE FROM users WHERE name = '${name}'`);");
    expect(found.length).toBeGreaterThan(0);
  });

  it("allows a fixed query with bound parameters", async () => {
    const found = await messagesFor("export const q = (db: D1Database, name: string) => db.prepare('SELECT * FROM users WHERE name = ?1').bind(name);");
    expect(found).toEqual([]);
  });

  it("allows a multi-line template literal that has no inserted values", async () => {
    const found = await messagesFor("export const q = (db: D1Database) => db.prepare(`SELECT *\n FROM users`);");
    expect(found).toEqual([]);
  });

  it("is clean across the real API source", async () => {
    const results = await eslint.lintFiles([join(root, "apps/api/src/**/*.ts")]);
    const offences = results.flatMap((result) => result.messages.filter((message) => message.ruleId === "no-restricted-syntax"));
    expect(offences).toEqual([]);
  });
});
