---
title: "Turn a CSV into Personalized Videos with Node.js and n8n"
published: false
description: "Turn e-commerce customer and product data into personalized offer videos with Node.js or n8n, free preflight validation, and reliable bulk rendering."
tags: javascript, n8n, automation, video
---

Give this workflow an e-commerce CSV or Google Sheet, and it returns one branded 1080×1920 product-offer video for every row—plus a manifest linking each customer to the finished MP4, thumbnail, status, cost, and any error.

Amira looked at a watch but did not buy it. Omar was interested in a pair of sneakers. Instead of sending both shoppers the same generic ad—or spending days editing separate videos—their two data rows become:

```text
Amira + The Field Watch + 20% OFF + AMIRA-20
    → offer-amira-r1.mp4

Omar + The Court Sneaker + 25% OFF + OMAR-25
    → offer-omar-r2.mp4
```

Inside each output, the video greets the shopper by name, presents the relevant product, shows their discount, and reveals their personal coupon code. The returned URLs can then flow into an email, CRM, or delivery automation.

For an e-commerce team, that makes one reusable design useful across:

- Abandoned-cart and browse-abandonment follow-ups
- Win-back campaigns based on a customer's previous purchase
- Product recommendations and cross-sell offers
- Loyalty rewards with customer-specific coupon codes
- Catalog campaigns that need one consistent video per product or audience segment

The personalization comes from a CSV or Google Sheet, not from manually duplicating a timeline. One template preserves the brand; each row supplies the shopper, product, image, offer, and CTA.

In this tutorial, we will build the complete pipeline:

```text
CSV or Google Sheet
        ↓
map each row to template variables
        ↓
validate every personalized version
        ↓
submit rows in bulk
        ↓
poll for results or receive webhooks
        ↓
MP4 URLs + a row-by-row results manifest
```

You can run it as a Node.js CLI or import one of the included n8n workflows. The complete example is available on GitHub:

👉 [Zvid bulk personalized videos example](https://github.com/Zvid-io/bulk-personalized-videos)

## The output: one branded video per shopper

The sample campaign turns each CSV row into a branded 1080×1920 video with three scenes:

1. A greeting using the customer's first name
2. A product reveal with an image, tagline, and discount badge
3. A final card with the customer's personal coupon code and CTA

For example, this row:

```csv
first_name,product_name,product_tagline,product_image,discount_label,coupon_code,cta_url
Amira,The Field Watch,Sapphire glass · Italian leather,https://example.com/watch.jpg,20% OFF,AMIRA-20,arcadia.example/amira
```

becomes a video that greets Amira, presents *The Field Watch*, and reveals the code `AMIRA-20`.

The same architecture works for much more than discounts:

- One listing video per property
- One outreach video per sales prospect
- One onboarding video per new hire
- One product video per catalog item
- One event recap per attendee, team, or location

The content changes row by row, while the design stays consistent.

## The three layers of personalization

The project keeps design, campaign settings, and recipient data separate:

| Layer | File | Responsibility |
| --- | --- | --- |
| Video design | `template.json` | Scenes, timing, animations, transitions, typography, and `{{placeholders}}` |
| Campaign settings | `campaign.json` | Shared values such as brand name, accent color, headline, and music |
| Per-video data | `data/customers.csv` | Name, product, image, discount, coupon code, and CTA for each recipient |

That separation is important. A marketer can change the campaign color once, an editor can improve the visual template once, and an operations team can continue adding spreadsheet rows without rewriting the rendering code.

The variables are resolved in this order:

```text
template defaults
    overridden by campaign variables
        overridden by the current row's variables
```

The most specific value wins.

## Run the Node.js version

You need Node.js 20 or newer and a Zvid API key.

```bash
git clone https://github.com/Zvid-io/bulk-personalized-videos.git
cd bulk-personalized-videos
npm install

cp .env.example .env
```

Create a key at [app.zvid.io/api-keys](https://app.zvid.io/api-keys), then add it to `.env`:

```dotenv
ZVID_API_KEY=zvid_your_key_here
```

### Always begin with a dry run

Before rendering anything, validate every row and calculate the required credits:

```bash
npm run dry-run
```

The dry run calls Zvid's validation endpoint for each personalized payload. It does not render a video or spend credits. Instead, it reports:

- Whether each row produces a valid project
- Field-level errors for invalid rows
- Layout warnings, when present
- The credit estimate for every valid video
- The estimated total for the campaign

This matters when a spreadsheet contains hundreds of rows. A broken image URL or an unexpectedly expensive configuration should be discovered before the batch enters the render queue.

Once validation is clean, render only two rows as a small end-to-end test:

```bash
npm run sample
```

Then render the complete CSV:

```bash
npm start
```

Completed MP4 files are streamed into `out/`, and `out/results.csv` records the source row, job name, status, video URL, thumbnail URL, credits, and any error.

If another system will consume the CDN URLs, skip local downloads:

```bash
node src/index.js --no-download
```

## Map spreadsheet columns to template variables

Most adaptations happen in `src/csv.js`. The example validates the required columns and converts each CSV record into the variable names declared by the video template:

```js
export function rowToVariables(row) {
  return {
    firstName: row.first_name,
    productName: row.product_name,
    productMeta: row.product_tagline,
    productImage: row.product_image,
    discountLabel: row.discount_label,
    couponCode: row.coupon_code,
    ctaUrl: row.cta_url,
  };
}
```

If your sheet uses columns such as `property_address`, `agent_name`, and `listing_price`, change this mapping and declare the matching variables in your template.

The loader also performs inexpensive local checks before making an API request. It rejects empty required cells, checks that product images use HTTP or HTTPS URLs, and creates a safe job name such as `offer-amira-r1`.

Including the row number in the name makes failures much easier to trace back to their source.

## One request, many render jobs

After the CSV rows are mapped, the CLI submits them to the bulk render endpoint:

```http
POST https://api.zvid.io/api/render/bulk/api-key
x-api-key: YOUR_API_KEY
Content-Type: application/json
```

The CLI sends the complete contents of `template.json` in the `payload` field. The same API contract also accepts a stored template ID instead of an inline payload (exactly one of `template` or `payload` is required), which gives us a compact request example:

```json
{
  "template": "tpl_xxxxxxxxxxxxxxxxxxxx",
  "variables": {
    "brandName": "ARCADIA",
    "accentColor": "#C6FF3D"
  },
  "items": [
    {
      "name": "offer-amira-r1",
      "variables": {
        "firstName": "Amira",
        "productName": "The Field Watch",
        "couponCode": "AMIRA-20"
      }
    },
    {
      "name": "offer-omar-r2",
      "variables": {
        "firstName": "Omar",
        "productName": "The Court Sneaker",
        "couponCode": "OMAR-25"
      }
    }
  ],
  "name": "personalized-offers"
}
```

The response returns a `bulkId` and the render jobs that were accepted. The CLI polls:

```http
GET https://api.zvid.io/api/render/bulk/{bulkId}
```

until every job is complete or failed.

The platform supports up to 500 items in a bulk request, although the effective limit can be lower for a particular plan. This example defaults to batches of 100 and automatically submits a larger CSV as multiple batches:

```bash
node src/index.js --batch-size 100
```

## A bad row should not sink a campaign

Bulk automation becomes useful only when partial failure is treated as normal.

The API validates items independently. Valid items can enter the queue while invalid items are returned alongside the accepted jobs with their original index and field-level details. The CLI preserves the mapping from job ID to CSV row so the final manifest can tell you exactly what happened to every record.

The example also handles operational failures deliberately:

- The SDK retries network errors and HTTP `429`, `502`, `503`, and `504` responses with backoff, honoring `Retry-After` when provided.
- Polling has a configurable timeout instead of waiting forever.
- Downloads run with limited concurrency rather than opening every file at once.
- Failed render jobs are automatically refunded.
- Exit code `0` means success, `1` means a fatal configuration or submission error, and `2` means a partial result or timeout.

Those exit codes make the CLI suitable for scheduled jobs and CI pipelines, not just local demos.

Useful options include:

```bash
# Use another data file
node src/index.js --csv data/campaign-august.csv

# Render only the first 10 valid rows
node src/index.js --limit 10

# Poll every 15 seconds and stop waiting after 45 minutes
node src/index.js --poll-interval 15 --timeout 45

# Choose another output directory
node src/index.js --out out/august-campaign
```

## Prefer no-code? Import the n8n workflow

The repository also includes ready-to-import n8n workflows built entirely from n8n core nodes. That means the CSV and Google Sheets versions can run on self-hosted n8n or n8n Cloud without installing a community package.

Start with:

👉 [`zvid-bulk-personalized-videos.workflow.json`](https://github.com/Zvid-io/bulk-personalized-videos/blob/master/n8n/zvid-bulk-personalized-videos.workflow.json)

Its flow mirrors the Node.js application:

```text
Manual Trigger
  → Campaign Config
  → Fetch template, campaign, and CSV
  → Parse rows
  → Build bulk items
  → Dry run?
       ├─ yes → validate rows → credit estimate
       └─ no  → split into batches → submit → wait/poll
                                      → build manifest → summary
```

### n8n setup

1. Download the workflow JSON and choose **Workflows → Import from File** in n8n.
2. Create a **Header Auth** credential with header name `x-api-key` and your key from [app.zvid.io/api-keys](https://app.zvid.io/api-keys).
3. Attach that credential to **Validate row (free)**, **Submit bulk render**, and **Get batch status**.
4. Open **Campaign Config** and point `csvUrl`, `templateUrl`, and `campaignUrl` at your files.
5. Set `dryRun` to `true` for the first execution. The imported workflow defaults to real rendering, so this step prevents accidental credit use while you test your mapping.
6. Set `rowLimit` to `2` for the first real render, switch `dryRun` back to `false`, and execute again.

The final **Summary** node contains every completed video URL, credits reserved, and all rejected, failed, or skipped rows.

By default, the workflow leaves videos on Zvid's CDN, which is the simplest option for n8n Cloud. Self-hosted users can enable `saveToDisk` to write MP4s and `results.csv` under n8n's permitted file directory.

## Four n8n workflows are included

Different automation environments need different input and completion strategies, so the example contains four variants:

| Workflow | Use it when... |
| --- | --- |
| [CSV + polling](https://github.com/Zvid-io/bulk-personalized-videos/blob/master/n8n/zvid-bulk-personalized-videos.workflow.json) | You want the simplest import-and-run workflow and one final campaign summary |
| [Google Sheets + polling](https://github.com/Zvid-io/bulk-personalized-videos/blob/master/n8n/zvid-bulk-google-sheets.workflow.json) | Your team maintains a live spreadsheet instead of publishing a CSV |
| [Webhook submit](https://github.com/Zvid-io/bulk-personalized-videos/blob/master/n8n/zvid-bulk-webhook-submit.workflow.json) | You want the submission execution to finish immediately without a polling loop |
| [Render event receiver](https://github.com/Zvid-io/bulk-personalized-videos/blob/master/n8n/zvid-render-events-receiver.workflow.json) | You want one n8n execution per completed or failed video |

The Google Sheets version keeps the same validation, batching, polling, and summary stages. Only the source changes. This works well when a campaign manager edits rows throughout the week and the automation runs on a schedule.

The event-driven pair is a better fit for large batches or serverless-style workflows. The submit workflow sends a public receiver URL with the render request, finishes after submission, and lets the receiver handle each `render.completed` or `render.failed` event independently.

That receiver can be connected to whatever delivery step your campaign needs:

- Write the video URL back to a sheet
- Send an email or CRM update
- Publish to a content queue
- Notify a team channel
- Upload the finished MP4 to another storage service

For the raw webhook workflow, treat the receiver URL as a secret and optionally include a token that your workflow verifies. The URL must be publicly reachable; `localhost` and private network addresses cannot receive production callbacks.

## Optional: use the official Zvid nodes for n8n

The included workflows intentionally use core nodes for maximum portability. On an n8n installation that allows community nodes, you can instead install the official package:

```text
@zvid/n8n-nodes-zvid
```

Install it from **Settings → Community Nodes → Install**.

The package ships two nodes:

- **Zvid** provides operations including **Render → Validate** and **Render → Create Bulk**. Create Bulk can optionally wait for completion, replacing several raw HTTP and polling nodes.
- **Zvid Trigger** registers a webhook when the workflow activates and verifies the HMAC signature of incoming render events.

Use the core-node templates when portability is the priority. Use the native nodes when you want a smaller canvas and signed, managed event handling.

Package: [@zvid/n8n-nodes-zvid on npm](https://www.npmjs.com/package/@zvid/n8n-nodes-zvid)

## Adapt the design without changing the pipeline

The sample template uses placeholders not only for text, but also for image URLs, colors, and conditional content. Change the shared values in `campaign.json` to rebrand the entire batch:

```json
{
  "brandName": "ARCADIA",
  "accentColor": "#C6FF3D",
  "headline": "We picked this<br>just for you.",
  "subheadline": "A private offer from this season's collection.",
  "showOffer": true,
  "offerKicker": "YOUR PERSONAL OFFER",
  "ctaHeadline": "Your code is ready.",
  "musicUrl": "https://example.com/campaign-track.mp3"
}
```

You can also replace `template.json` with another Zvid project that declares the variables your rows provide. Build or refine the design in the [Zvid visual editor](https://editor.zvid.io), then keep the CSV-to-variable mapping as the stable boundary between your data and creative work.

As you customize the template, keep these practical constraints in mind:

- Keep personalized text near the length used in the original design, or test short and long values explicitly.
- Use direct, publicly accessible HTTPS URLs for images and audio.
- Validate the longest product names and taglines, not only the neat sample rows.
- Keep credentials in environment variables or n8n credentials, never inside workflow JSON or source control.
- Run a dry pass whenever the template, resolution, media, or row mapping changes.

## Polling or webhooks?

Both are valid; the right choice depends on how the workflow is hosted.

Choose **polling** when:

- You want one execution with one final summary
- The batch is small or moderate
- A long-running workflow is acceptable
- Simplicity matters more than execution time

Choose **webhooks** when:

- The caller should finish immediately after submission
- Batches are large
- Your automation platform charges for waiting executions
- Each completed video should trigger its own downstream action

For account-level signed webhooks, use the Zvid Trigger node or register an endpoint through the webhook API. See the [Zvid webhook documentation](https://docs.zvid.io/docs/automation/webhooks/) for the event payload and verification details.

## A production checklist

Before connecting the workflow to a real customer list:

1. **Validate every row.** Use the CLI's `--dry-run` flag or set `dryRun: true` in n8n.
2. **Render a tiny sample.** Two varied rows reveal more than one perfect fixture.
3. **Test text extremes.** Include your shortest and longest names, titles, and offers.
4. **Use a sensible batch size.** The example defaults to 100; your plan's effective ceiling may be lower than the API maximum.
5. **Preserve row identifiers.** Keep the source row or a stable business ID in job metadata and result manifests.
6. **Handle partial success.** Deliver completed videos and isolate only the rejected or failed rows for correction.
7. **Choose a completion strategy.** Poll for an aggregate result or use webhooks for event-driven delivery.
8. **Store the manifest.** It is the audit trail between source data, render job, output URL, cost, and failure reason.
9. **Protect secrets.** Keep API keys in `.env`, a secret manager, or n8n credentials.
10. **Monitor limits and retries.** Expect rate limits and transient network failures in any large campaign.

## Where to go next

This example turns personalization into a data problem instead of a repetitive editing task: design once, map your columns, validate, and let the batch pipeline do the mechanical work.

Start with the checked-in sample customers, inspect the generated manifest, then swap in a spreadsheet from your own use case.

- [Clone the complete example](https://github.com/Zvid-io/bulk-personalized-videos)
- [Read the bulk rendering documentation](https://docs.zvid.io/docs/automation/bulk-rendering/)
- [Create an API key](https://app.zvid.io/api-keys)
- [Open the visual editor](https://editor.zvid.io)
- [Browse the n8n workflow files](https://github.com/Zvid-io/bulk-personalized-videos/tree/master/n8n)

What would you personalize first: product offers, property listings, customer onboarding, or something else entirely?
