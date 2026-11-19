# Following Atlas

Every Instagram page an account follows, in a searchable directory, with the
cafés, shops, clinics and studios among them pinned on a Neshan map.

The site and the sync run as one Railway service. The sync keeps the atlas
current on its own: it reads the following list every hour, picks up new
follows, drops unfollowed pages, refreshes stale profiles, classifies pages
into 21 categories, and finds a location for the ones that are public places.

## How the sync works

```
Instagram ──► following list ──► profiles + post tags ──► Gemini classification
                                                         │
             approvals (admin) ──► geocoding ◄───────────┘
                                      │
                                      ▼
                         atlas.json on the volume ──► /api/atlas ──► map + directory
```

Each run (`pipeline/sync.mjs`):

1. **Following list.** Reads the complete list for the signed-in account (or
   `IG_TARGET_USERNAME`). A list Instagram hides, or one that suddenly shrinks
   by more than 60%, fails the run instead of wiping the atlas.
2. **Profiles.** Fetches new follows first, then the stalest profiles, up to
   `IG_PROFILE_BUDGET` per run with a jittered pause between requests. For
   business accounts it also reads the location tags on recent posts.
3. **Classification.** Pages whose name, bio, or Instagram category changed
   are classified with Gemini (structured JSON output, batches of 25). An
   overloaded model falls through to the next one in `GEMINI_MODEL`, then to
   keyword rules, so a sync never stalls on classification.
4. **Location.** Strongest evidence wins:
   1. a human approval from the admin page or `scripts/location-approvals.json`
   2. the street address a business publishes on its Instagram profile
   3. a Google Maps, Neshan, Balad, Waze or Apple Maps link in the bio
   4. a post tag whose venue name matches the page
   5. a confident Neshan search match (official API with `NESHAN_API_KEY`,
      otherwise Neshan's public search)
   6. a venue the business tags in most of its posts

   Anything weaker goes to the review queue in `/admin`. A pin that was
   found once is kept when later evidence is merely weaker (a bio edit, say).
5. **Publish.** Writes `atlas.json` (public) and `review.json` (admin only).

### Privacy rules

- Private accounts and personal, noncommercial accounts are never published,
  not even in the directory.
- People, creators, artists and media pages are only pinned when they publish
  an explicit public address and run a business account. They are never
  located from incidental post tags.
- Businesses whose bio says they have closed or are moving are not pinned.

## Deploy on Railway

1. Attach a **volume** to the service (any mount path). The sync stores its
   state there and Railway exposes the path as `RAILWAY_VOLUME_MOUNT_PATH`.
2. Set the service variables:

   | Variable | Required | What it is |
   | --- | --- | --- |
   | `NEXT_PUBLIC_NESHAN_WEB_KEY` | yes | Neshan web key for the map. Needed at build time. Allow the Railway domain for it in the Neshan panel. |
   | `IG_AUTHORIZATION` | yes | `Bearer IGT:2:…` token of the account whose follows the atlas tracks. |
   | `GEMINI_API_KEY` | recommended | Google Gemini key for classification. Without it, keyword rules are used. |
   | `ADMIN_TOKEN` | recommended | 12+ random characters. Protects `/admin`. |
   | `NESHAN_API_KEY` | optional | Neshan service key for more search matches. |
   | `IG_TARGET_USERNAME` | optional | Track another public account. Instagram hides most lists from low-activity sessions, so a token from the tracked account itself is more reliable. |

   Tuning: `SYNC_INTERVAL_MINUTES` (60), `IG_PROFILE_BUDGET` (80),
   `IG_REQUEST_DELAY_MS` (2500), `GEMINI_MODEL` (`gemini-2.5-flash`).
3. Deploy. `railway.toml` builds with `npm run build` and starts
   `npm run start`, which runs `server/boot.mjs`: it starts the web server and
   schedules the first sync 20 seconds after boot.

With about 1,250 followed pages and the default budget, the first full pass
takes roughly 16 hourly runs. Pages appear in the directory immediately and
gain their category and pin as their profile is read.

Instagram's paged following list is not stable: two back-to-back reads of
about 1,250 follows differ by roughly ten accounts. Each run therefore reads
the list twice and merges the results, and a page is only removed after it
has been missing for three runs in a row (about three hours).

### When the Instagram token expires

The run fails with "The Instagram session is no longer valid" (visible in
`/admin`). The site keeps serving the last published atlas. Copy a fresh
token, update `IG_AUTHORIZATION`, and redeploy. If Instagram rate limits the
account, the sync backs off (doubling up to 24 hours) and resumes on its own.

## Admin

`/admin` (sign in with `ADMIN_TOKEN`) shows sync health, the last ten runs,
and the review queue. For each page there you can accept a proposed match,
paste a map link or coordinates, or mark it as not a public place. Decisions
are saved to the volume and applied on a sync that starts immediately.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
npm run sync
npm run dev
```

`npm run sync` writes to `./data/runtime/` (git-ignored). Before the first
sync, the site shows the curated pins in `public/locations.geojson`.

## Validation

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

The pipeline tests run against a fake Instagram API, so they need no
credentials or network.

## Design

The interface follows the `frontend-design` skill from
[anthropics/skills](https://github.com/anthropics/skills), vendored in
`.claude/skills/frontend-design`. Tokens live at the top of
`app/globals.css`: lapis ink, firouzeh (turquoise) for actions, saffron only
for the selected pin, and the eight-pointed khatam star for pins and the logo.
