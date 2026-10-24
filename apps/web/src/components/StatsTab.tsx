import { useCallback, useEffect, useState } from "preact/hooks";
import { ApiFailure, api, type Stats } from "../lib/api";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; stats: Stats };

function Chart({ stats }: { stats: Stats }) {
  const width = 320;
  const height = 120;
  const top = 8;
  const bottom = 20;
  const max = Math.max(1, ...stats.daily.map((d) => d.views));
  const slot = width / stats.daily.length;
  const barWidth = Math.max(2, slot - 2);
  const plot = height - top - bottom;
  return (
    <>
      <svg class="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Bar chart of page views per day for the last ${stats.days} days. The busiest day had ${max} views.`}>
        <line x1="0" x2={width} y1={height - bottom} y2={height - bottom} />
        {stats.daily.map((day, index) => {
          const h = (day.views / max) * plot;
          return (
            <rect key={day.date} x={index * slot + 1} y={height - bottom - h} width={barWidth} height={Math.max(h, day.views > 0 ? 1 : 0)} rx="2">
              <title>{`${day.date}: ${day.views} views`}</title>
            </rect>
          );
        })}
        <text x="0" y={height - 6}>{stats.daily[0]?.date.slice(5)}</text>
        <text x={width} y={height - 6} text-anchor="end">{stats.daily[stats.daily.length - 1]?.date.slice(5)}</text>
      </svg>
      <table class="sr-only">
        <caption>Views and clicks per day</caption>
        <thead><tr><th scope="col">Date</th><th scope="col">Views</th><th scope="col">Clicks</th></tr></thead>
        <tbody>
          {stats.daily.map((day) => (
            <tr key={day.date}><td>{day.date}</td><td>{day.views}</td><td>{day.clicks}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function StatsTab({ username }: { username: string | null }) {
  const [days, setDays] = useState<7 | 30>(7);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  const fetchStats = useCallback(() => {
    setLoad({ state: "loading" });
    api.stats(days).then(
      (stats) => setLoad({ state: "ready", stats }),
      (error) => setLoad({ state: "error", message: error instanceof ApiFailure ? error.message : "Something went wrong." }),
    );
  }, [days]);

  useEffect(fetchStats, [fetchStats]);

  return (
    <>
      <div class="panel-head">
        <h2>Stats</h2>
        <div class="segmented" role="group" aria-label="Time range">
          <button type="button" aria-pressed={days === 7} onClick={() => setDays(7)}>7 days</button>
          <button type="button" aria-pressed={days === 30} onClick={() => setDays(30)}>30 days</button>
        </div>
      </div>

      {load.state === "loading" && <div class="skeleton" style="height:200px" aria-busy="true" aria-label="Loading stats" />}

      {load.state === "error" && (
        <div class="notice error" role="alert">
          <span>{load.message}</span>
          <button class="btn btn-quiet" type="button" onClick={fetchStats}>Try again</button>
        </div>
      )}

      {load.state === "ready" && (
        <>
          <div class="stat-grid">
            <div class="card stat"><span class="muted">Page views</span><strong>{load.stats.totals.views}</strong></div>
            <div class="card stat"><span class="muted">Link clicks</span><strong>{load.stats.totals.clicks}</strong></div>
          </div>

          {load.stats.totals.views === 0 && load.stats.totals.clicks === 0 ? (
            <div class="card empty">
              <h3>No visits yet</h3>
              <p class="muted">
                {username
                  ? "Put your Linkbeam link in your Instagram, TikTok, X or WhatsApp bio. Share it in your posts and messages. Visits will show here."
                  : "Choose a username in Settings first. Then put your link in your social media bios to get visits."}
              </p>
            </div>
          ) : (
            <>
              <div class="card">
                <h3>Views per day</h3>
                <Chart stats={load.stats} />
              </div>
              <div class="card">
                <h3>Top links</h3>
                {load.stats.top_links.length === 0 ? (
                  <p class="muted">No link clicks yet.</p>
                ) : (
                  <ol class="top-links">
                    {load.stats.top_links.map((link) => (
                      <li key={link.id}><span>{link.title}</span><strong>{link.clicks} clicks</strong></li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
