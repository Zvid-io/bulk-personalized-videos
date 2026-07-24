# Bulk personalized videos from a CSV

Turn a spreadsheet into **one branded video per row** with a single API call.
This example renders a personalized offer video for every customer in
[`data/customers.csv`](data/customers.csv) — their name, their product, their
photo, their coupon code — from one designed template, using Zvid's
[bulk render endpoint](https://docs.zvid.io/automation/bulk-rendering).

Each 1080×1920 video greets the customer by name, showcases their product with
a Ken Burns zoom and discount badge, then reveals their personal coupon code:

| Scene 1 — greeting | Scene 2 — product | Scene 3 — coupon |
| --- | --- | --- |
| "HEY, AMIRA" + headline + 20% OFF chip | product photo, discount badge, name & tagline | "Your code is ready." + `AMIRA-20` |

The same pattern powers e-commerce win-back campaigns, real-estate listing
videos (one per property), sales outreach (one per prospect), HR onboarding
(one per hire) — anywhere you have a table of people or things and want a
video for each.

## Quick start

```bash
npm install
cp .env.example .env        # put your API key in .env (app.zvid.io → API Keys)

npm run dry-run             # validate every row + credit estimate — free
npm run sample              # render the first 2 rows only
npm start                   # render all 4 sample rows
```

Requires Node.js ≥ 20. A successful run downloads the MP4s into `out/` and
writes `out/results.csv` — a manifest mapping every CSV row to its video URL,
thumbnail, credits spent, and any error.

```
Personalized video campaign — 4 video(s) from customers.csv
  Batch 1: blk_rkrJEvDXoCUszBZhpiKu — 4 job(s) queued, 44 credits reserved
  4 done · 0 failed · 0 rendering — 41s
Downloading 4 video(s) to out/ ...

Done. 4 rendered — 44 credits reserved. Manifest: out/results.csv
```

## No-code: n8n

The [`n8n/`](n8n) folder has ready-to-import n8n workflows that do everything
this CLI does — CSV **and** Google Sheets sources, polling **and**
webhook-driven variants, with the same free dry-run, batching and retries —
built from n8n core nodes only, so they run on self-hosted n8n and n8n Cloud
alike. For native Zvid nodes (bulk render, validate, render-finished trigger),
install the official
[`@zvid/n8n-nodes-zvid`](https://www.npmjs.com/package/@zvid/n8n-nodes-zvid)
community package. Full instructions: [n8n/README.md](n8n/README.md).

## How it works

One HTTP request fans out into N render jobs:

```jsonc
POST https://api.zvid.io/api/render/bulk/api-key
x-api-key: YOUR_API_KEY

{
  "payload":   { /* template.json — full project with {{placeholders}} */ },
  "variables": { /* campaign.json — batch-level values, e.g. brand color */ },
  "items": [
    { "variables": { "firstName": "Amira", "couponCode": "AMIRA-20", ... },
      "name": "offer-amira-r1" },
    { "variables": { "firstName": "Omar",  "couponCode": "OMAR-25",  ... },
      "name": "offer-omar-r2" }
  ],
  "name": "personalized-offers 2026-07-19"
}
```

- **`payload`** is the designed video ([`template.json`](template.json)) with
  `{{variable}}` placeholders in its text, colors, and image URLs, plus a
  `variables` block declaring defaults. You can pass a stored `"template":
  "tpl_…"` id instead — same request otherwise.
- **`items`** is your spreadsheet: each entry's `variables` merge over the
  batch-level `variables`, which merge over the template defaults.
- Validation is **best-effort per item**: valid rows queue immediately, broken
  rows come back in the response's `itemErrors` array with field-level messages —
  one bad row never sinks the batch.
- The `202` response returns a `bulkId`; poll `GET /api/render/bulk/{bulkId}`
  until every job is terminal, or set `ZVID_WEBHOOK_URL` to get a signed
  webhook per finished job instead.
- Credits are reserved per job and **automatically refunded for failed jobs**.
- Up to 500 items per request (plan limits may be lower); the script batches
  larger CSVs automatically (`--batch-size`).

## Project layout

| File | Purpose |
| --- | --- |
| [`template.json`](template.json) | The designed video — 3 scenes, animations, transitions, music. Edit visuals here. |
| [`campaign.json`](campaign.json) | Batch-level variables: brand name, accent color, headline, music. |
| [`data/customers.csv`](data/customers.csv) | One row per video. Sample photos from Pexels & Unsplash. |
| [`src/index.js`](src/index.js) | CLI: load → validate → submit → poll → download → manifest. |
| [`src/csv.js`](src/csv.js) | **The file you edit** — maps your columns to template variables. |
| [`src/zvid.js`](src/zvid.js) | Minimal API client (fetch + retries with backoff, typed errors). |
| [`src/util.js`](src/util.js) | .env loader, concurrency helper, streaming downloads. |
| [`n8n/`](n8n) | Ready-to-import n8n workflows: CSV / Google Sheets / webhook variants. |

## CSV schema

| Column | Template variable | Example |
| --- | --- | --- |
| `first_name` | `firstName` | `Amira` |
| `product_name` | `productName` | `The Field Watch` |
| `product_tagline` | `productMeta` | `Sapphire glass · Italian leather` |
| `product_image` | `productImage` | any public http(s) image, ideally ≥ 1080×1920 |
| `discount_label` | `discountLabel` | `20% OFF` |
| `coupon_code` | `couponCode` | `AMIRA-20` |
| `cta_url` | `ctaUrl` | `arcadia.example/amira` |

To use your own spreadsheet, export it as CSV with these headers — or change
`REQUIRED_COLUMNS` and `rowToVariables()` in [`src/csv.js`](src/csv.js) to
match your columns.

## Adapting the template

- **Brand it**: change `brandName`, `accentColor`, `headline`, and `musicUrl`
  in [`campaign.json`](campaign.json) — the accent color flows through every
  band, chip, and highlight automatically.
- **Keep copy lengths similar** to the defaults (±30%) so the designed type
  scale and layout keep looking right; don't shrink font sizes to squeeze in
  longer text.
- **Swap the design**: any project JSON with `{{placeholders}}` works as
  `template.json`. Build one visually in the [Zvid editor](https://app.zvid.io),
  or start from a library example. `condition` (e.g. `showOffer`) and
  `iterate` are supported too.
- **Different output**: change `resolution` (`full-hd`, `instagram-post`, …)
  or add an `overrides` object to the submit call.

## Production notes

- **Dry-run first**: `npm run dry-run` runs every row through
  `POST /api/render/validate/api-key` — free, returns field-level errors and
  the exact credit cost before you commit a large batch.
- **Polling vs webhooks**: polling is simplest and what this script does; for
  big batches or serverless callers, set `ZVID_WEBHOOK_URL` and receive
  `render.completed` / `render.failed` events per job (HMAC-signed — see
  [webhook docs](https://docs.zvid.io/automation/webhooks)).
- **Retries**: the client retries 429/5xx/network errors with exponential
  backoff and honors `Retry-After`. Failed *renders* are not auto-retried by
  the script — they're listed in `results.csv` with their error; fix the rows
  and re-run just those.
- **Rate limits & queueing**: bulk items count against your plan's render
  rate limits, and bulk jobs yield slightly to interactive renders — large
  batches are throughput-friendly by design.
- **Exit codes**: `0` all rendered, `1` fatal (config/auth/credits), `2`
  partial (some rows failed or timed out) — CI-friendly.

## Sample asset credits

Product photos by [Adrian Regeci](https://www.pexels.com/photo/a-black-wrist-watch-beside-a-magazine-11403924/),
[Minh Tri](https://www.pexels.com/photo/a-close-up-shot-of-a-pair-of-sneakers-9207813/),
[Philipp Aleev](https://www.pexels.com/photo/brown-backpack-hanging-from-the-tree-trunk-9088788/),
[Rendy Ramdani](https://www.pexels.com/photo/close-up-photo-of-beauty-products-on-glass-bottles-12146904/) and
[Pavel Danilyuk](https://www.pexels.com/photo/a-woman-in-brown-knitted-sweater-holding-a-basket-5789010/) on Pexels;
[Luke Peterson](https://unsplash.com/photos/black-wireless-headphones-on-white-table-lUMj2Zv5HUE),
[Kiran CK](https://unsplash.com/photos/black-framed-sunglasses-on-white-surface-lSl94SZHRgA) and
[Beau Carpenter](https://unsplash.com/photos/a-coffee-maker-pouring-coffee-into-a-cup-KGR2u2rG6c4) on Unsplash.
Music from [Pixabay](https://pixabay.com/music/).
