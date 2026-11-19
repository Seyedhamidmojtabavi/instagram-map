"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { categoryById } from "@/lib/atlas-types";

type Proposal = { source: string; title: string; address: string; coordinates: [number, number]; confidence: number };
type ReviewItem = {
  pk: string;
  username: string;
  fullName: string;
  biography: string;
  categories: string[];
  reason: string;
  proposals: Proposal[];
};
type Run = {
  startedAt: string;
  finishedAt?: string;
  ok: boolean;
  error?: string | null;
  searchNotice?: string | null;
  stats?: Record<string, number>;
};
type AdminData = {
  review: { count: number; items: ReviewItem[] };
  status: { scheduler?: string; running?: boolean; nextRunAt?: string | null; intervalMinutes?: number } | null;
  owner: { username: string } | null;
  target: { username: string } | null;
  backoffUntil: string | null;
  runs: Run[];
};

const TOKEN_KEY = "atlas-admin-token";

function formatTime(iso?: string | null) {
  if (!iso) return "not scheduled";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function AdminConsole() {
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState("");
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    try {
      // Session storage only exists in the browser, so it is read after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToken(sessionStorage.getItem(TOKEN_KEY) ?? "");
    } catch {
      // Storage can be unavailable in private windows; the form still works.
    }
  }, []);

  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(path, {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        setToken("");
        try {
          sessionStorage.removeItem(TOKEN_KEY);
        } catch {}
        throw new Error("That admin token was not accepted.");
      }
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status}).`);
      return body;
    },
    [token],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      setData(await call("/api/admin/review"));
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [call, token]);

  useEffect(() => {
    // Polling an API: state is set when each request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function syncNow() {
    try {
      await call("/api/admin/sync", { method: "POST" });
      setNotice("Sync queued. It starts within 10 seconds.");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  async function approve(item: ReviewItem, payload: Record<string, unknown>, done: string) {
    try {
      await call("/api/admin/approve", { method: "POST", body: JSON.stringify({ username: item.username, ...payload }) });
      setNotice(`${done} The map updates after the next sync, which starts now.`);
      setData((current) =>
        current
          ? { ...current, review: { count: current.review.count - 1, items: current.review.items.filter((entry) => entry.pk !== item.pk) } }
          : current,
      );
    } catch (reason) {
      setError((reason as Error).message);
    }
  }

  if (!token) {
    return (
      <main className="admin admin-signin">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            try {
              sessionStorage.setItem(TOKEN_KEY, draft);
            } catch {}
            setToken(draft);
          }}
        >
          <h1>Atlas admin</h1>
          <p>Enter the ADMIN_TOKEN set on the server.</p>
          <input type="password" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Admin token" autoFocus />
          <button type="submit" className="button primary">Sign in</button>
          {error && <p className="admin-error">{error}</p>}
        </form>
      </main>
    );
  }

  const lastRun = data?.runs[0];
  return (
    <main className="admin">
      <header className="admin-head">
        <div>
          <h1>Atlas admin</h1>
          <p>
            {data?.target
              ? <>Tracking who <strong>@{data.target.username}</strong> follows{data.owner && data.owner.username !== data.target.username ? <>, signed in as @{data.owner.username}</> : null}.</>
              : "No sync has finished yet."}
          </p>
        </div>
        <div className="admin-actions">
          <Link href="/" className="button">View the map</Link>
          <button type="button" className="button primary" onClick={syncNow} disabled={data?.status?.running}>
            {data?.status?.running ? "Syncing…" : "Sync now"}
          </button>
        </div>
      </header>

      {notice && <p className="admin-notice" role="status">{notice}</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}

      <section className="admin-section">
        <h2>Sync</h2>
        <dl className="admin-facts">
          <div><dt>Schedule</dt><dd>{data?.status?.scheduler === "on" ? `Every ${data.status.intervalMinutes} minutes` : "Off (no Instagram credentials)"}</dd></div>
          <div><dt>Next run</dt><dd>{formatTime(data?.status?.nextRunAt)}</dd></div>
          <div><dt>Last run</dt><dd>{lastRun ? `${formatTime(lastRun.finishedAt ?? lastRun.startedAt)}, ${lastRun.ok ? "succeeded" : "failed"}` : "none yet"}</dd></div>
          {data?.backoffUntil && <div><dt>Paused by Instagram until</dt><dd>{formatTime(data.backoffUntil)}</dd></div>}
        </dl>
        {lastRun?.error && <p className="admin-error">{lastRun.error}</p>}
        {lastRun?.searchNotice && <p className="admin-muted">{lastRun.searchNotice}. Pins still come from Instagram addresses, place tags, map links, and your approvals.</p>}
        {data && data.runs.length > 0 && (
          <table className="admin-runs">
            <thead><tr><th>Finished</th><th>Result</th><th>Following</th><th>Profiles read</th><th>New</th><th>On map</th><th>To review</th></tr></thead>
            <tbody>
              {data.runs.map((run) => (
                <tr key={run.startedAt}>
                  <td>{formatTime(run.finishedAt ?? run.startedAt)}</td>
                  <td>{run.ok ? "OK" : "Failed"}</td>
                  <td>{run.stats?.following ?? "–"}</td>
                  <td>{run.stats?.profilesFetched ?? "–"}</td>
                  <td>{run.stats?.added ?? "–"}</td>
                  <td>{run.stats?.located ?? "–"}</td>
                  <td>{run.stats?.review ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="admin-section">
        <h2>Needs a location ({data?.review.count ?? 0})</h2>
        <p className="admin-muted">These pages look like public places, but no source was confident enough to pin them. Pick a match, paste a map link or coordinates, or mark the page as not a place.</p>
        <ul className="review-list">
          {data?.review.items.map((item) => <ReviewCard key={item.pk} item={item} onApprove={approve} />)}
        </ul>
        {data && data.review.items.length === 0 && <p>Nothing to review.</p>}
      </section>
    </main>
  );
}

function ReviewCard({
  item,
  onApprove,
}: {
  item: ReviewItem;
  onApprove: (item: ReviewItem, payload: Record<string, unknown>, done: string) => void;
}) {
  const [location, setLocation] = useState("");
  return (
    <li className="review-item">
      <div className="review-who">
        <strong dir="auto">{item.fullName || item.username}</strong>
        <a href={`https://www.instagram.com/${item.username}/`} target="_blank" rel="noreferrer">@{item.username}</a>
        <span className="admin-muted">{item.categories.map((id) => categoryById.get(id)?.label ?? id).join(", ")}</span>
      </div>
      {item.biography && <p className="review-bio" dir="auto">{item.biography}</p>}
      {item.proposals.length > 0 && (
        <ul className="proposals">
          {item.proposals.map((proposal) => (
            <li key={`${proposal.source}-${proposal.coordinates.join()}`}>
              <div>
                <strong dir="auto">{proposal.title}</strong>
                <span dir="auto">{proposal.address || "No address"}</span>
                <a href={`https://neshan.org/maps/@${proposal.coordinates[1]},${proposal.coordinates[0]},17z`} target="_blank" rel="noreferrer">
                  Check location
                </a>
              </div>
              <button
                type="button"
                className="button"
                onClick={() => onApprove(item, { coordinates: proposal.coordinates, title: proposal.title, address: proposal.address }, `Pinned @${item.username}.`)}
              >
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="review-manual"
        onSubmit={(event) => {
          event.preventDefault();
          if (location.trim()) onApprove(item, { location }, `Pinned @${item.username}.`);
        }}
      >
        <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Map link or 35.7081, 51.4206" aria-label={`Location for @${item.username}`} />
        <button type="submit" className="button">Pin</button>
        <button type="button" className="link-button" onClick={() => onApprove(item, { hidden: true }, `@${item.username} will stay off the map.`)}>
          Not a public place
        </button>
      </form>
    </li>
  );
}
