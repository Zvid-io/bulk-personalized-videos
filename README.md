# Personalized ecommerce videos with Node.js

Create one vertical offer video per CSV row with Zvid's product video API. The
sample uses one three-scene JSON design and a fictional ARCADIA campaign:
Amira receives a watch offer with `AMIRA-20`; Omar receives a sneaker offer with
`OMAR-25`. Names, discounts and offer URLs are illustrative. Replace them with
approved customer and product information before real use.

Article: [Product Video API: Personalized Offers with Node.js](https://zvid.io/blog/developer-tutorials/ecommerce-product-video-template-json).

## Quick start

Install Node.js 20 or newer. Get an API key at https://app.zvid.io/api-keys and
have enough Zvid credits for the estimate. Keep the key on your server.

From the extracted `bulk-personalized-videos` directory:

```bash
npm ci
npm test
```

Copy `.env.example` to `.env` using your file manager, then set:

```dotenv
ZVID_API_KEY=zvid_your_key_here
```

Leave the optional API origin and webhook settings unset for the first run.
Validate only the first two rows:

```bash
node src/index.js --dry-run --limit 2 --out out/sample --max-credits 22
```

Validation does not consume render credits. Read `out/sample/validation.json`,
including warnings. The supplied pair estimates at 11 credits each, 22 total.
The estimate can change with your inputs, design or current service pricing.
A passing validation does not prove that remote media will load or that a
longer product name will fit; inspect a small rendered sample before scaling.

After reviewing the estimate, render and download the pair:

```bash
node src/index.js --limit 2 --out out/sample --max-credits 22
```

This command validates again and spends render credits. `--max-credits` checks
the validation estimate, not a server-enforced spending limit. The CLI saves
accepted batch/job IDs in `out/sample/run.json`, polls until completion, downloads
`offer-amira-r1.mp4` and `offer-omar-r2.mp4`, and writes `results.csv`.
The output is 1080 by 1920 at 30 fps, approximately 10.25 seconds per video.

## Recover an interrupted run

```bash
node src/index.js --resume --out out/sample
```

Resume only polls and downloads saved jobs. It never submits another render.
It retries missing or failed downloads and leaves existing successful local
files in place. Do not run two processes against the same output directory.

If a submission response is lost before the server's batch ID is saved, the
journal records `submission_unknown`. Check the batch in https://app.zvid.io
before deciding whether to submit again. Resume cannot discover a missing ID
or queue rows that were never submitted. Do not delete the journal to bypass
this check. Keep a new CSV containing only confirmed unsubmitted/rejected rows,
fix their data, then use a new output directory for an intentional new run.

Failed renders are recorded without automatic resubmission. A download failure
is separate from a render failure; `results.csv` records its error and resume
can download the completed job without rendering again. Download media promptly
and copy published assets to storage you control: render-output URLs expire.

## Files and variable mapping

| File | Responsibility |
| --- | --- |
| `template.json` | Three scenes, typography, transitions, photo placement and variable defaults |
| `campaign.json` | Shared brand, headline, accent color and music |
| `data/customers.csv` | Four fictional recipients; the walkthrough selects the first two |
| `src/csv.js` | Required columns and `rowToVariables()` |
| `src/index.js` | Command-line options and authentication |
| `src/run.js` | Validation, saved batch state, polling and manifest |
| `src/util.js` | Environment loading and atomic downloads |
| `tests/run.test.js` | Offline failure, recovery, cost-cap and CSV checks |

| CSV column | Template variable | First row |
| --- | --- | --- |
| `first_name` | `firstName` | Amira |
| `product_name` | `productName` | The Field Watch |
| `product_tagline` | `productMeta` | Black dial · Mesh strap |
| `product_image` | `productImage` | Public Zvid CDN photo URL |
| `discount_label` | `discountLabel` | 20% OFF |
| `coupon_code` | `couponCode` | AMIRA-20 |
| `cta_url` | `ctaUrl` | arcadia.example/amira |

Keep the case-sensitive headers. Selected rows with missing fields or invalid
image URL schemes stop before submission. The example requires every listed
field; this is an application choice. Change `REQUIRED_COLUMNS` and
`rowToVariables()` together to support a different schema.

CSV values are substituted into designed text and URLs. Use approved inputs,
keep text lengths close to the samples and avoid markup in imported text.
The script does not create coupons, verify product specifications, choose
recipients, send messages, upload to a storefront or publish ads.
`ctaUrl` is visible text inside the MP4, not a clickable link. Put the actual
shop URL in the surrounding email, landing page or platform link field.

## API flow

The CLI uses the official `@zvid/sdk` client. It authenticates with the API key
and sends the JSON project in `payload`, shared variables in `variables`, and
per-row values in `items[].variables` to the [bulk render endpoint](https://docs.zvid.io/docs/automation/bulk-rendering/).
Per-row values override shared values, which override the design defaults.

Each accepted item becomes a separate job. An API response can contain both
accepted jobs and rejected item errors; the manifest preserves both. Polling
uses the returned batch ID. A queued job is not a completed video.

API submission retries are disabled because a lost response may hide an
accepted paid request. Transient polling errors stop the process; use resume
later. Keep the journal until the outputs are stored and reviewed.

Run `node src/index.js --help` for all options. The default batch size is 100;
the API hard limit is 500, and an account's limit may be lower. Reduce
`--batch-size` when the API reports that limit. The default polling deadline is
30 minutes; reaching it does not cancel server jobs.

Exit codes: `0` all selected work completed (and downloaded unless disabled),
`1` configuration, validation, submission or polling error, `2` incomplete
work, render rejection/failure, download failure or polling timeout.

## Customization

Start with `campaign.json` for brand, copy, accent color and music. Change a
single recipient in `data/customers.csv` to test a new product or offer. Change
`template.json` for design and timing; you can build a project in the
[Zvid editor](https://editor.zvid.io). Validate again after each change, then
review one complete output before increasing the number of rows.

See [validation and estimates](https://docs.zvid.io/docs/validate-and-estimate/),
[credits and plans](https://docs.zvid.io/docs/credits-and-plans/) and
[authentication](https://docs.zvid.io/docs/authentication/) for the API contract.
An optional `ZVID_WEBHOOK_URL` adds callbacks; it does not disable polling.

## Other integrations in this repository

The repository also retains [n8n examples](https://github.com/Zvid-io/bulk-personalized-videos/tree/master/n8n) and
[Make examples](https://github.com/Zvid-io/bulk-personalized-videos/tree/master/make). They have their own setup and behavior and do
not inherit this Node.js runner's saved-state recovery. The article's Node.js
ZIP includes only the CLI, tests, inputs, dependency files and license.

## Support

For help, visit [https://zvid.io/contact](https://zvid.io/contact).
