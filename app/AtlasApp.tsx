"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  categoryById,
  families,
  familyById,
  type Atlas,
  type DirectoryEntry,
  type Place,
} from "@/lib/atlas-types";
import { MapCanvas } from "./MapCanvas";
import { khatamPath } from "./khatam";

const REFRESH_MS = 5 * 60 * 1000;
const PAGE = 120;

function Khatam({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="khatam">
      <path d={khatamPath(12, 12, 11)} fill={color} />
    </svg>
  );
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌‍]/g, " ");
}

function timeAgo(iso: string | null) {
  if (!iso) return null;
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (minutes < 60) return format.format(-Math.max(minutes, 0), "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return format.format(-hours, "hour");
  return format.format(-Math.round(hours / 24), "day");
}

function categoryLabels(ids: string[]) {
  return ids.map((id) => categoryById.get(id)?.label ?? id);
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

export function AtlasApp({ webKey }: { webKey: string }) {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<string | null>(null);
  const [mappedOnly, setMappedOnly] = useState(false);
  const [selectedPk, setSelectedPk] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const mobile = useIsMobile();

  const [limitState, setLimitState] = useState({ key: "", count: PAGE });
  const deepLinkHandled = useRef(false);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/atlas", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json() as Promise<Atlas>;
        })
        .then((data) => {
          if (!active) return;
          setAtlas(data);
          setLoadError("");
          // Open the page named in the URL (#/username) the first time data arrives.
          if (!deepLinkHandled.current) {
            deepLinkHandled.current = true;
            const handle = decodeURIComponent(window.location.hash.replace(/^#\/?/, "")).toLowerCase();
            const entry = handle ? data.directory.find((item) => item.username.toLowerCase() === handle) : null;
            if (entry) {
              setSelectedPk(entry.pk);
              setFocusRequest((value) => value + 1);
            }
          }
        })
        .catch(() => {
          if (active) setLoadError("Places could not be loaded. Check your connection and reload the page.");
        });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  const placeByPk = useMemo(
    () => new Map((atlas?.features ?? []).map((place) => [place.properties.pk, place])),
    [atlas],
  );
  const entryByPk = useMemo(
    () => new Map((atlas?.directory ?? []).map((entry) => [entry.pk, entry])),
    [atlas],
  );

  const select = useCallback(
    (pk: string | null, { focus = true } = {}) => {
      setSelectedPk(pk);
      const entry = pk ? entryByPk.get(pk) : null;
      window.history.replaceState(null, "", entry ? `#/${entry.username}` : window.location.pathname);
      if (pk && focus) setFocusRequest((value) => value + 1);
    },
    [entryByPk],
  );

  const matches = useMemo(() => {
    const needle = normalize(query.trim());
    return (atlas?.directory ?? []).filter((entry) => {
      if (family && entry.family !== family) return false;
      if (mappedOnly && !entry.located) return false;
      if (!needle) return true;
      const place = placeByPk.get(entry.pk);
      return normalize(
        [entry.fullName, entry.username, entry.bio, place?.properties.address ?? "", ...categoryLabels(entry.categories)].join(" "),
      ).includes(needle);
    });
  }, [atlas, family, mappedOnly, query, placeByPk]);

  const visiblePlaces = useMemo(
    () => matches.map((entry) => placeByPk.get(entry.pk)).filter((place): place is Place => Boolean(place)),
    [matches, placeByPk],
  );

  const familyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of atlas?.directory ?? []) {
      if (entry.family) counts.set(entry.family, (counts.get(entry.family) ?? 0) + 1);
    }
    return counts;
  }, [atlas]);

  // Paging resets whenever the search or filters change.
  const filterKey = `${query}|${family}|${mappedOnly}`;
  const limit = limitState.key === filterKey ? limitState.count : PAGE;
  const showMore = () => setLimitState({ key: filterKey, count: limit + PAGE });

  const selectedEntry = selectedPk ? entryByPk.get(selectedPk) ?? null : null;
  const selectedPlace = selectedPk ? placeByPk.get(selectedPk) ?? null : null;
  const stats = atlas?.stats;
  const updated = timeAgo(atlas?.lastSyncAt ?? null);

  return (
    <div className="atlas">
      <MapCanvas
        webKey={webKey}
        places={visiblePlaces}
        selectedPk={selectedPk}
        onSelect={(pk) => select(pk, { focus: false })}
        focusRequest={focusRequest}
        padding={mobile ? { left: 0, bottom: Math.round(window.innerHeight * 0.5) } : { left: 420, bottom: 0 }}
      />

      <aside className={`panel ${sheetOpen ? "is-open" : ""} ${selectedEntry ? "has-detail" : ""}`} aria-label="Places">
        <button
          type="button"
          className="sheet-handle"
          onClick={() => setSheetOpen((open) => !open)}
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? "Collapse list" : "Expand list"}
        >
          <span />
        </button>

        <header className="panel-head">
          <div className="brand">
            <Khatam color="var(--firouzeh)" size={26} />
            <div>
              <h1>Following Atlas</h1>
              <p lang="fa" dir="rtl">اطلس صفحه‌های دنبال‌شده</p>
            </div>
          </div>
          {stats && (
            <p className="summary">
              <strong>{stats.located.toLocaleString("en")}</strong> places on the map from{" "}
              <strong>{stats.following.toLocaleString("en")}</strong> followed pages.
              {updated && (
                <span className={`freshness ${atlas?.sync?.ok === false ? "is-stale" : ""}`}>
                  {atlas?.sync?.message ?? `Updated ${updated}`}
                </span>
              )}
            </p>
          )}
        </header>

        {selectedEntry ? (
          <PlaceDetail entry={selectedEntry} place={selectedPlace} onBack={() => select(null)} onFocus={() => setFocusRequest((value) => value + 1)} />
        ) : (
          <>
            <div className="controls">
              <label className="search">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onFocus={() => setSheetOpen(true)}
                  placeholder="Search names, streets, or categories"
                  aria-label="Search places and pages"
                  dir="auto"
                />
              </label>

              <div className="families" role="group" aria-label="Filter by category">
                <button type="button" className={`chip ${family === null ? "is-on" : ""}`} aria-pressed={family === null} onClick={() => setFamily(null)}>
                  Everything
                </button>
                {families.map((item) => {
                  const count = familyCounts.get(item.id) ?? 0;
                  if (!count) return null;
                  const on = family === item.id;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={`chip ${on ? "is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => setFamily(on ? null : item.id)}
                      style={{ "--chip": item.color } as React.CSSProperties}
                    >
                      <Khatam color={item.color} size={12} />
                      {item.label}
                      <span className="chip-count">{count}</span>
                    </button>
                  );
                })}
              </div>

              <label className="toggle">
                <input type="checkbox" checked={mappedOnly} onChange={(event) => setMappedOnly(event.target.checked)} />
                <span className="toggle-track" aria-hidden="true"><span /></span>
                Only pages with a place on the map
              </label>
            </div>

            <div className="results" aria-live="polite">
              {loadError ? (
                <p className="notice">{loadError}</p>
              ) : !atlas ? (
                <ul className="list" aria-hidden="true">
                  {Array.from({ length: 7 }, (_, index) => <li key={index} className="entry is-loading"><span /><span /></li>)}
                </ul>
              ) : matches.length === 0 ? (
                <div className="notice">
                  <strong>No pages match {query ? `“${query}”` : "these filters"}.</strong>
                  <button type="button" className="link-button" onClick={() => { setQuery(""); setFamily(null); setMappedOnly(false); }}>
                    Clear search and filters
                  </button>
                </div>
              ) : (
                <>
                  <p className="result-count">
                    {matches.length.toLocaleString("en")} {matches.length === 1 ? "page" : "pages"}, {visiblePlaces.length.toLocaleString("en")} on the map
                  </p>
                  <ul className="list">
                    {matches.slice(0, limit).map((entry) => (
                      <DirectoryRow key={entry.pk} entry={entry} onSelect={() => select(entry.pk)} />
                    ))}
                  </ul>
                  {matches.length > limit && (
                    <button type="button" className="more" onClick={showMore}>
                      Show {Math.min(PAGE, matches.length - limit)} more
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function DirectoryRow({ entry, onSelect }: { entry: DirectoryEntry; onSelect: () => void }) {
  const familyInfo = entry.family ? familyById.get(entry.family) : null;
  const label = entry.primaryCategory ? categoryById.get(entry.primaryCategory)?.label : entry.pending ? "Being classified" : null;
  return (
    <li>
      <button type="button" className="entry" onClick={onSelect}>
        <Khatam color={familyInfo?.color ?? "var(--rule-strong)"} size={18} />
        <span className="entry-text">
          <span className="entry-name" dir="auto">{entry.fullName || entry.username}</span>
          <span className="entry-meta">
            <span className="handle">@{entry.username}</span>
            {label && <span className="entry-category">{label}</span>}
          </span>
        </span>
        {entry.located && (
          <span className="on-map" title="On the map">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11Z" fill="currentColor" />
              <circle cx="12" cy="10" r="2.4" fill="#fff" />
            </svg>
            <span className="sr-only">On the map</span>
          </span>
        )}
      </button>
    </li>
  );
}

function PlaceDetail({
  entry,
  place,
  onBack,
  onFocus,
}: {
  entry: DirectoryEntry;
  place: Place | null;
  onBack: () => void;
  onFocus: () => void;
}) {
  const familyInfo = entry.family ? familyById.get(entry.family) : null;
  const coordinates = place?.geometry.coordinates;
  const bio = place?.properties.biography || entry.bio;
  return (
    <article className="detail">
      <button type="button" className="back" onClick={onBack}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        All pages
      </button>

      <div className="detail-title" style={{ "--family": familyInfo?.color ?? "var(--slate)" } as React.CSSProperties}>
        <Khatam color={familyInfo?.color ?? "var(--slate)"} size={34} />
        <div>
          <h2 dir="auto">{entry.fullName || entry.username}</h2>
          <p className="handle">@{entry.username}{entry.verified ? ", verified" : ""}</p>
        </div>
      </div>

      {entry.categories.length > 0 && (
        <ul className="tags" aria-label="Categories">
          {categoryLabels(entry.categories).map((label) => <li key={label}>{label}</li>)}
        </ul>
      )}

      {place ? (
        <section className="detail-block">
          <h3>Address</h3>
          <p dir="auto">{place.properties.address || "Pinned from the page’s own location tag"}</p>
          <button type="button" className="link-button" onClick={onFocus}>Show on the map</button>
        </section>
      ) : (
        <section className="detail-block">
          <h3>Not on the map</h3>
          <p>{entry.pending ? "This page was followed recently and is still being processed." : "This page has no public street address, so it is listed without a pin."}</p>
        </section>
      )}

      {bio && (
        <section className="detail-block">
          <h3>Bio</h3>
          <p className="bio" dir="auto">{bio}</p>
        </section>
      )}

      <div className="actions">
        <a className="button primary" href={`https://www.instagram.com/${entry.username}/`} target="_blank" rel="noreferrer">
          Open on Instagram
        </a>
        {coordinates && (
          <a
            className="button"
            href={`https://neshan.org/maps/@${coordinates[1]},${coordinates[0]},17z`}
            target="_blank"
            rel="noreferrer"
          >
            Directions in Neshan
          </a>
        )}
      </div>
    </article>
  );
}
