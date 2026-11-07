# HMO facility geocoder (Phase F)

The Flexicare facility sheet from HR lists Lagos providers by free-text address
with **no coordinates**. The map reference layer needs lat/lng, so this one-time
script geocodes each facility **offline** and writes an enriched CSV that the
ops-admin **Bulk import → Import HMO facilities** panel ingests. The ops-api
never geocodes at runtime.

## Why offline, with an LGA fallback

- The sheet is ~500+ facilities. OSM Nominatim (keyless) allows at most **1
  request/second**, so a live import would take ~10 minutes and strain their
  free service. Geocoding once, offline, keeps that cost out of the request path.
- Lagos addresses are informal ("By Abule Soko Bus Stop", "off Celestial Way"),
  so exact street geocoding resolves only a minority. When the street address
  does not resolve, the facility is placed at its **LGA (City column) centroid**
  and tagged `coords_quality = lga_centroid` so the map can show it as
  *approximate*. Nothing is silently dropped.
- Every lookup is **cached** to a JSON file next to the output, so a re-run
  (after an interruption, or for next month's sheet) only hits the network for
  addresses it has not seen.

`coords_quality` values: `street` (exact), `lga_centroid` (approximate, LGA
area), `failed` (no coordinate — imports but will not plot until corrected in
the ops-admin facility editor).

## Usage

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
npx tsx tools/geocode-hospitals/geocode.mts \
  "<path to the HR .xlsx>" \
  flexicare-geocoded.csv
```

Then, in **ops-admin-console → Bulk import → Import HMO facilities**: Preview the
`flexicare-geocoded.csv`, then Commit. Facilities upsert by **name + LGA**, so a
refreshed monthly sheet updates in place rather than duplicating.

## Run of record

`Flexicare facilities in Lagos for June.xlsx` → **537 facilities**:
`street=55`, `lga_centroid=482`, `failed=0`. The majority are LGA-area pins; the
map labels those as approximate.
