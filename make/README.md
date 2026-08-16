# Make workflow: bulk personalized videos

These blueprints reproduce the sample campaign with native Zvid modules. They
fetch the designed [`template.json`](../template.json), apply four personalized
rows, and either validate them for free or submit them as one bulk render.

## Included blueprints

| Blueprint | Purpose | Zvid render credits |
| --- | --- | --- |
| [`zvid-bulk-personalized-videos-dry-run.blueprint.json`](zvid-bulk-personalized-videos-dry-run.blueprint.json) | Validate all four personalized rows and return one validation bundle per row. | None |
| [`zvid-bulk-personalized-videos.blueprint.json`](zvid-bulk-personalized-videos.blueprint.json) | Submit four videos, check the batch twice over 90 seconds, and return the final batch with its four-job array. | Yes |

The committed files use the public Make app ID `zvid`. During private-app
development, generate equivalent files for the app ID in the local Make clone:

```powershell
cd D:\Nodejs\Projects\zvid-cline\zvid-examples\bulk-personalized-videos
npm.cmd run make:local
npm.cmd run make:validate
```

This creates ignored `*.local.blueprint.json` files. It reads only
`makecomapp.json`; it does not read the Make token or the Zvid API key.

## Import and test locally

The private Zvid app must include **Get a bulk render** before importing the
paid workflow. Deploy the latest local Make clone first.

1. In Make, create a new empty scenario.
2. Open the scenario menu in the upper-right and select **Import blueprint**.
3. Import `zvid-bulk-personalized-videos-dry-run.local.blueprint.json`.
4. Open **Validate a render payload**, select the existing Zvid production-test
   connection, and save the module.
5. Select **Run once**. The last module must emit four bundles with `valid = true`.
   This workflow does not queue renders or spend Zvid render credits.
6. Create another empty scenario and import
   `zvid-bulk-personalized-videos.local.blueprint.json`.
7. Open **Bulk create renders (advanced)** and both **Get a bulk render** modules.
   Select the same Zvid connection in each and save them.
8. Review the four objects in **Items**. Select **Run once** only when ready to
   reserve credits for four production videos.
9. The final **Get a bulk render** output contains the four-job array. Completed
   jobs contain `outputUrl` and `thumbnailUrl`; failed jobs contain
   `errorMessage`. Add an Iterator after it only when another module will
   process each job, so Make does not warn about an unused terminal Iterator.

The workflow checks progress at 45 and 90 seconds. A busy queue or a larger
custom project can still be pending at the second check. In that case, pass the
same `bulkId` to **Get a bulk render** later instead of submitting the batch
again.

## Workflow shape

Free validation:

```text
HTTP: fetch template -> Iterator: four rows -> Zvid: validate each row
```

Paid render:

```text
HTTP: fetch template -> Zvid: bulk create -> Sleep 45 s -> Get bulk
                     -> Sleep 45 s -> Get bulk (final jobs array)
```

## Customize the data source

The blueprints embed the four checked-in sample rows so they import without a
spreadsheet connection. For production, replace that array with rows from CSV,
Google Sheets, Airtable, or a CRM, then map each row into this shape:

```json
{
  "name": "offer-amira-r1",
  "variables": {
    "firstName": "Amira",
    "productName": "The Field Watch",
    "productMeta": "Sapphire glass · Italian leather",
    "productImage": "https://cdn.zvid.io/library/examples/previews/ecom-hero-promo.3d7866ef63d0.jpg",
    "discountLabel": "20% OFF",
    "couponCode": "AMIRA-20",
    "ctaUrl": "arcadia.example/amira"
  }
}
```

Keep the validation scenario as the preflight step whenever the template or
source columns change. The bulk endpoint performs best-effort item validation,
but validating first gives a credit estimate before anything is queued.
