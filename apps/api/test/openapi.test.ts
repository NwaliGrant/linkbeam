import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const spec = parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docs", "openapi.yaml"), "utf8")) as {
  paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function documented(): string[] {
  return Object.entries(spec.paths)
    .flatMap(([path, operations]) =>
      Object.keys(operations)
        .filter((method) => HTTP_METHODS.includes(method))
        .map((method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`),
    )
    .sort();
}

function implemented(): string[] {
  const routes = createApp().routes.filter((route) => route.method !== "ALL");
  return [...new Set(routes.map((route) => `${route.method} ${route.path.replace(/\/$/, "")}`))].sort();
}

describe("docs/openapi.yaml", () => {
  it("documents every route the API serves and nothing else", () => {
    expect(documented()).toEqual(implemented());
  });

  it("gives every operation at least one response, and every error response uses the shared Error shape", () => {
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!HTTP_METHODS.includes(method)) continue;
        const responses = operation.responses ?? {};
        expect(Object.keys(responses).length, `${method} ${path}`).toBeGreaterThan(0);
        for (const [status, response] of Object.entries(responses)) {
          // Pages outside /api/v1 are HTML for people, so their errors are friendly pages, not the JSON shape.
          if (Number(status) >= 400 && path.startsWith("/api/v1")) {
            expect(response, `${method} ${path} ${status}`).toEqual({ $ref: "#/components/responses/Error" });
          }
        }
      }
    }
  });
});
