export const AUDIT_LOG_DAYS = 90;

/** Daily housekeeping, run by the Cron Trigger. Deletes only rows that can no longer be used. */
export async function cleanup(db: D1Database, now: number): Promise<Record<string, number>> {
  const day = 86_400;
  const results = await db.batch([
    db.prepare("DELETE FROM login_tokens WHERE expires_at < ?1").bind(now - day),
    db.prepare("DELETE FROM oauth_states WHERE expires_at < ?1").bind(now),
    db.prepare("DELETE FROM rate_limits WHERE expires_at < ?1").bind(now),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?1 OR last_seen_at < ?2").bind(now, now - 14 * day),
    // The security log is kept for 90 days. The Privacy page promises this, so keep the two in step.
    db.prepare("DELETE FROM audit_log WHERE at < ?1").bind(now - AUDIT_LOG_DAYS * day),
  ]);
  const [tokens, states, limits, sessions, audit] = results.map((r) => r.meta.changes);
  return { login_tokens: tokens ?? 0, oauth_states: states ?? 0, rate_limits: limits ?? 0, sessions: sessions ?? 0, audit_log: audit ?? 0 };
}
