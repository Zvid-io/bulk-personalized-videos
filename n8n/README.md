# n8n versions of this example

No-code ports of the CLI in this repo. All of them fetch `template.json`,
`campaign.json` and the customer data, map every row to template variables,
submit **batched** requests to `POST /api/render/bulk/api-key` (up to 500
items per request, batch size configurable) and map every result back to its
source row. API calls retry 3× on transient failures, a free `dryRun` mode
validates every row and reports the exact credit cost before you spend
anything, and rows the API rejects never sink the batch.

They are built entirely from n8n **core nodes** (HTTP Request, Code, IF,
Loop Over Items…), so they run on any n8n — self-hosted or Cloud — with no
community package required. If you can install community nodes, see
[the official Zvid nodes](#official-zvid-nodes-for-n8n) below for native
building blocks.

| File | What it is |
| --- | --- |
| [`zvid-bulk-personalized-videos.workflow.json`](zvid-bulk-personalized-videos.workflow.json) | **Start here.** CSV from a URL → submit → poll until done → summary with every video URL. |
| [`zvid-bulk-google-sheets.workflow.json`](zvid-bulk-google-sheets.workflow.json) | Same pipeline, but rows come from a **Google Sheet**. |
| [`zvid-bulk-webhook-submit.workflow.json`](zvid-bulk-webhook-submit.workflow.json) | **Event-driven variant, submit side**: fire-and-forget submission, no polling, no long-running execution. |
| [`zvid-render-events-receiver.workflow.json`](zvid-render-events-receiver.workflow.json) | **Event-driven variant, receiver side**: one execution per finished video (`render.completed` / `render.failed`) — plug in your email/Sheets/Slack action. |

## Import & run (polling workflow)

1. In n8n: **Workflows → Import from File…** — or *Import from URL* with the
   raw GitHub URL of the workflow JSON.
2. Create a **Header Auth** credential — header name `x-api-key`, value = an
   API key from [app.zvid.io](https://app.zvid.io) → **API Keys** — and attach
   it to the three API nodes (*Validate row (free)*, *Submit bulk render*,
   *Get batch status*).
3. Open **Campaign Config** and adjust:
   - `csvUrl` / `templateUrl` / `campaignUrl` — point at your own files
     (keep the same CSV headers, or edit the *Build bulk items* code node —
     it is this workflow's `src/csv.js`).
   - `rowLimit` — 0 renders every row; set 2 to test cheaply.
   - `dryRun: true` — free per-row validation + credit estimate, renders nothing.
   - `batchSize` — items per bulk request (default 100, API max 500).
4. Execute. The *Summary* node ends the run with per-video CDN URLs, credits
   reserved, and any failed/rejected/skipped rows.

Videos live on Zvid's CDN, so nothing needs to touch disk and the workflow
runs green on n8n Cloud. Self-hosters who want local files can set
`saveToDisk: true` to also write `results.csv` + the MP4s to `outDir` — n8n
only allows writes under `~/.n8n-files` (`N8N_RESTRICT_FILE_ACCESS_TO`), so
create the folder once (on Docker installs:
`docker exec <n8n-container> mkdir -p /home/node/.n8n-files/zvid-out`) and
fetch results with `docker cp <n8n-container>:/home/node/.n8n-files/zvid-out .`.

## Google Sheets variant

Same pipeline, but *Read customer rows* replaces the CSV download — handy
when the campaign list is a living spreadsheet your team edits.

1. Copy [`data/customers.csv`](../data/customers.csv) into a Google Sheet to
   try it (File → Import in Sheets keeps the header row), or use your own
   sheet with the same header names: `first_name, product_name,
   product_tagline, product_image, discount_label, coupon_code, cta_url`.
2. Attach your **Google Sheets** credential to *Read customer rows* (n8n's
   standard Google OAuth setup).
3. In **Campaign Config**, set `sheetUrl` to your spreadsheet URL and
   `sheetTab` to the **exact tab name** shown in the bar at the bottom of the
   sheet — this is the #1 gotcha; there is no "first tab" fallback.
4. Everything else (dry run, batching, polling, outputs) works exactly like
   the CSV workflow. Manifest rows use the sheet's real row numbers, so
   `csv_row: 5` means row 6 in the spreadsheet (header included).

To render a different design, swap the template/campaign URLs and remap the
columns in *Build bulk items* — its variable names must match the `variables`
your template declares.

## The webhook (event-driven) variant

For big batches or serverless-style setups, skip polling entirely:

1. Import **both** webhook files, **activate the receiver**, and copy its
   production webhook URL (`https://<your-n8n>/webhook/zvid-render-events`).
2. Put that URL in the submit workflow's `webhookReceiverUrl` and execute it.
   The run ends at submission; Zvid then POSTs one event per job to the
   receiver, which recovers the job name + CSV row and hands each finished
   video to your action nodes.

Caveats worth knowing (also on the workflows' sticky notes):

- The receiver URL must be **publicly reachable** — Zvid refuses private and
  `localhost` URLs in production. For a local n8n, use a tunnel
  (ngrok / cloudflared) and set n8n's `WEBHOOK_URL` accordingly.
- Per-request deliveries are **unsigned** (the URL travelled inside your
  authenticated submit): treat the URL as a secret, and/or add a
  `?token=...` you verify in the receiver. For signed deliveries, use the
  **Zvid Trigger** node from the official package below, or register an
  account endpoint via `POST /api/webhooks` — see the
  [webhook docs](https://docs.zvid.io/automation/webhooks).
- `render.failed` events carry only the `jobId` and error (credits are
  refunded automatically); completed events are mapped back to their CSV row
  via the `-r<row>` suffix the submit workflow bakes into every job name.

## Official Zvid nodes for n8n

Zvid also ships an official community-node package —
[`@zvid/n8n-nodes-zvid`](https://www.npmjs.com/package/@zvid/n8n-nodes-zvid)
(**Settings → Community Nodes → Install** on self-hosted n8n, package name
`@zvid/n8n-nodes-zvid`). It gives you native building blocks for everything
these workflows do with raw HTTP:

- **Zvid node → Render → Create Bulk** — one template × up to 500 variable
  sets, with an optional *Wait for Completion* mode that replaces this
  repo's submit + poll loop with a single node.
- **Zvid node → Render → Validate** — the same free pre-flight check the
  `dryRun` branch performs, as one operation you can branch on with an IF.
- **Zvid Trigger** — registers an account webhook when the workflow
  activates and **verifies the HMAC signature** of every delivery: the
  hardened replacement for the raw Webhook receiver above.
- A **Zvid AI Agent** template (Zvid Agent Tools sub-node + chat trigger)
  for authoring videos conversationally instead of from a spreadsheet.

The workflows in this folder intentionally stick to core nodes so they work
where community nodes can't be installed; with the package installed, each
raw piece (submit, poll, validate, receive) has a one-node native
equivalent.

## n8n ≥ 2.0 notes (tested on 2.29)

- File writes are restricted to `~/.n8n-files` by default — hence the
  `saveToDisk` default and `outDir` location above.
- The Code nodes avoid `new URL` on purpose: the task-runner sandbox does not
  expose it.
- The Execute Command node no longer exists, so the output folder must be
  created outside n8n (one-time `mkdir` above).
