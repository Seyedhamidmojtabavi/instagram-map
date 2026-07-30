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

Add both keys to `.env.local`:

- `NEXT_PUBLIC_NESHAN_WEB_KEY` renders the Neshan map in the browser. Restrict
  this key to your local and production domains in the Neshan developer panel.
- `NESHAN_SERVICE_KEY` is used only by the local geocoding script. It is never
  bundled into browser code or committed.

To load `.env.local` for the command-line geocoder:

```bash
set -a
source .env.local
set +a
npm run locations:geocode
```

## Location workflow

1. `locations:candidates` rebuilds a local evidence file from `../Classified/`.
2. `locations:geocode` searches Neshan, accepts only high-confidence matches,
   writes accepted pins to `public/locations.geojson`, and leaves uncertain
   results in `data/location-review.json`.
3. Review uncertain matches manually. Never approve a private residence or an
   incidental post location.

The website supports search, per-category layers, clustered markers, profile
details, Instagram links, and Neshan deep links. Profiles can appear in multiple
layers.

## Validation

```bash
npm test
npm run lint
npx tsc --noEmit
```
