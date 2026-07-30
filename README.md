# Following Atlas

An interactive Neshan map of public businesses, venues, and offices discovered
through 903 classified Instagram profiles.

## Local setup

Requires Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
npm run locations:candidates
npm run locations:geocode
npm run dev
```

Add the web key to `.env.local`:

- `NEXT_PUBLIC_NESHAN_WEB_KEY` renders the Neshan map in the browser. Restrict
  this key to your local and production domains in the Neshan developer panel.

## Location workflow

1. `locations:candidates` rebuilds a local evidence file from `../Classified/`.
2. `locations:geocode` queries the anonymous search route used by Neshan's
   public web map, accepts only high-confidence matches, writes accepted pins
   to `public/locations.geojson`, and leaves uncertain results in
   `data/location-review.json`. Browser cookies are not used or stored.
3. Human-reviewed matches are recorded in `scripts/location-approvals.json`.
   An approval is applied only while the same Neshan title, address, and
   coordinates remain in the search results. Never approve a private residence
   or an incidental post location.

The public PWA route is undocumented and may change. The decoder fails closed
if its response envelope changes, and three consecutive request failures stop
the run without replacing the current production GeoJSON.

The website supports search, per-category layers, clustered markers, profile
details, Instagram links, and Neshan deep links. Profiles can appear in multiple
layers.

## Validation

```bash
npm test
npm run lint
npx tsc --noEmit
```
