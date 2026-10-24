import { Hono } from "hono";
import {
  MAX_LINKS_PER_USER,
  createLinkSchema,
  idSchema,
  isPermutation,
  linkOrderSchema,
  normalizeTarget,
  patchLinkSchema,
  type LinkKind,
} from "@linkbeam/shared";
import { randomId } from "../crypto";
import type { AppEnv } from "../env";
import { ApiError, notFound, unauthorized } from "../errors";
import { readJson, validate } from "../http";
import { requireSession } from "../sessions";

interface LinkRow {
  id: string;
  kind: LinkKind;
  title: string;
  target: string;
  message: string | null;
  position: number;
  enabled: number;
  starts_at: number | null;
  ends_at: number | null;
}

const LIST_LINKS_SQL =
  "SELECT id, kind, title, target, message, position, enabled, starts_at, ends_at FROM links WHERE user_id = ?1 ORDER BY position";
const GET_LINK_SQL =
  "SELECT id, kind, title, target, message, position, enabled, starts_at, ends_at FROM links WHERE id = ?1 AND user_id = ?2";

/** What the API returns: the stored flag becomes a real true or false. */
export function linkOf(row: LinkRow): Omit<LinkRow, "enabled"> & { enabled: boolean } {
  return { ...row, enabled: row.enabled === 1 };
}

export function linkRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireSession);

  routes.get("/", async (c) => {
    const rows = await c.env.DB.prepare(LIST_LINKS_SQL)
      .bind(c.get("user").id)
      .all<LinkRow>();
    return c.json({ links: rows.results.map(linkOf) });
  });

  routes.post("/", async (c) => {
    const input = await readJson(c, createLinkSchema);
    const id = randomId(12);
    // One statement counts and inserts, so parallel requests cannot push a user past the limit.
    let result: D1Result;
    try {
      result = await c.env.DB.prepare(
      `INSERT INTO links (id, user_id, kind, title, target, message, position, enabled, starts_at, ends_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, COALESCE(MAX(position), -1) + 1, ?7, ?8, ?9
         FROM links WHERE user_id = ?2 HAVING COUNT(*) < ?10`,
    )
      .bind(
        id,
        c.get("user").id,
        input.kind,
        input.title,
        input.target,
        input.message ?? null,
        input.enabled === false ? 0 : 1,
        input.starts_at ?? null,
        input.ends_at ?? null,
        MAX_LINKS_PER_USER,
      )
      .run();
    } catch (error) {
      // The account was deleted while this request was running: the database refuses a link with no owner.
      if (error instanceof Error && error.message.includes("FOREIGN KEY")) throw unauthorized();
      throw error;
    }
    if (result.meta.changes === 0) {
      throw new ApiError(409, "link_limit", `You can have up to ${MAX_LINKS_PER_USER} links. Delete one to add another.`);
    }
    const row = await c.env.DB.prepare(GET_LINK_SQL)
      .bind(id, c.get("user").id)
      .first<LinkRow>();
    if (!row) throw unauthorized();
    return c.json(linkOf(row), 201);
  });

  routes.put("/order", async (c) => {
    const { ids } = await readJson(c, linkOrderSchema);
    const userId = c.get("user").id;
    const current = await c.env.DB.prepare("SELECT id FROM links WHERE user_id = ?1 ORDER BY position")
      .bind(userId)
      .all<{ id: string }>();
    if (!isPermutation(current.results.map((row) => row.id), ids)) {
      throw new ApiError(400, "invalid_order", "Send every one of your links exactly once.");
    }
    const list = JSON.stringify(ids);
    // Two steps in one batch: park the rows on negative positions, then number them.
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE links SET position = -position - 1 WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))",
      ).bind(userId, list),
      c.env.DB.prepare(
        `UPDATE links SET position = (SELECT CAST(j.key AS INTEGER) FROM json_each(?2) j WHERE j.value = links.id)
          WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
      ).bind(userId, list),
    ]);
    return c.body(null, 204);
  });

  routes.patch("/:id", async (c) => {
    const id = validate(idSchema, c.req.param("id"));
    const patch = await readJson(c, patchLinkSchema);
    const userId = c.get("user").id;

    const existing = await c.env.DB.prepare(GET_LINK_SQL)
      .bind(id, userId)
      .first<LinkRow>();
    if (!existing) throw notFound("This link does not exist.");

    let target = existing.target;
    if (patch.target !== undefined) {
      const normalised = normalizeTarget(existing.kind, patch.target);
      if (normalised === null) {
        throw new ApiError(400, "invalid_input", "target: This address or number is not valid for this link type.");
      }
      target = normalised;
    }
    const startsAt = patch.starts_at !== undefined ? patch.starts_at : existing.starts_at;
    const endsAt = patch.ends_at !== undefined ? patch.ends_at : existing.ends_at;
    if (startsAt !== null && endsAt !== null && startsAt >= endsAt) {
      throw new ApiError(400, "invalid_input", "ends_at: The end must be after the start.");
    }

    await c.env.DB.prepare(
      `UPDATE links SET title = ?1, target = ?2, message = ?3, enabled = ?4, starts_at = ?5, ends_at = ?6
        WHERE id = ?7 AND user_id = ?8`,
    )
      .bind(
        patch.title ?? existing.title,
        target,
        patch.message !== undefined ? patch.message : existing.message,
        patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
        startsAt,
        endsAt,
        id,
        userId,
      )
      .run();

    const row = await c.env.DB.prepare(GET_LINK_SQL)
      .bind(id, userId)
      .first<LinkRow>();
    if (!row) throw notFound("This link does not exist.");
    return c.json(linkOf(row));
  });

  routes.delete("/:id", async (c) => {
    const id = validate(idSchema, c.req.param("id"));
    const result = await c.env.DB.prepare("DELETE FROM links WHERE id = ?1 AND user_id = ?2")
      .bind(id, c.get("user").id)
      .run();
    if (result.meta.changes === 0) throw notFound("This link does not exist.");
    return c.body(null, 204);
  });

  return routes;
}
