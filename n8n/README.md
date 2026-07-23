# n8n version of this example

[`zvid-bulk-personalized-videos.workflow.json`](zvid-bulk-personalized-videos.workflow.json)
is a no-code port of the CLI in this repo: it fetches `template.json`,
`campaign.json` and `data/customers.csv` straight from this repository, maps
every CSV row to template variables, submits **one** request to
`POST /api/render/bulk/api-key`, polls until every job is terminal, then writes
`results.csv` and downloads the MP4s.

## Import & run

1. In n8n: **Workflows → Import from File** and pick the JSON
   (or `n8n import:workflow --input=...` via CLI).
2. Create a **Header Auth** credential — header name `x-api-key`, value = an
   API key from [app.zvid.io](https://app.zvid.io) → API Keys — and attach it
   to the three API nodes (*Validate row (free)*, *Submit bulk render*,
   *Get batch status*).
3. Open **Campaign Config** and adjust:
   - `csvUrl` / `templateUrl` / `campaignUrl` — point at your own files
     (any URL n8n can reach; keep the same CSV headers or edit the
     *Build bulk items* code node, which is this workflow's `src/csv.js`).
   - `rowLimit` — 0 renders every row; set 2 to test cheaply.
   - `dryRun: true` — free per-row validation + exact credit estimate,
     renders nothing.
4. Execute the workflow. The *Summary* node ends with per-video URLs, credits
   reserved and any failed/skipped rows.

## n8n ≥ 2.0 notes (tested on 2.29)

- **File writes are restricted to `~/.n8n-files` by default**
  (`N8N_RESTRICT_FILE_ACCESS_TO`). `outDir` therefore defaults to
  `/home/node/.n8n-files/zvid-out` — create it once
  (`docker exec n8n mkdir -p /home/node/.n8n-files/zvid-out`) and fetch
  results with `docker cp n8n:/home/node/.n8n-files/zvid-out .`.
- Set `downloadVideos: false` to skip local MP4s — the manifest still gets
  every CDN URL. On n8n Cloud, replace the two *Save* nodes with Google
  Drive/S3/email nodes.
- The Code nodes avoid `new URL` on purpose: the task-runner sandbox does not
  expose it.
