/**
 * CSV → bulk render items.
 *
 * This is the one file you edit to adapt the example to your own spreadsheet:
 * change REQUIRED_COLUMNS and rowToVariables() to match your columns and the
 * variables your template declares.
 */

import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

/** Columns every row must provide (header names, case-sensitive). */
export const REQUIRED_COLUMNS = [
  'first_name',
  'product_name',
  'product_tagline',
  'product_image',
  'discount_label',
  'coupon_code',
  'cta_url',
];

/**
 * Map one CSV row to the template variables it personalizes.
 * Keys must match the `variables` declared in template.json.
 *
 * @param {Record<string, string>} row
 */
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

/**
 * Load and validate the CSV, returning render-ready bulk items.
 *
 * Each valid row becomes `{ variables, name, row }` where `name` is a
 * filesystem-safe output name and `row` is the 1-based CSV data row number
 * (header excluded) used to map API errors back to the spreadsheet.
 *
 * @param {string} csvPath
 * @returns {{ items: Array<{variables: object, name: string, row: number}>,
 *             rowErrors: Array<{row: number, message: string}> }}
 */
export function loadItems(csvPath) {
  const raw = readFileSync(csvPath, 'utf8');
  /** @type {Record<string, string>[]} */
  const records = parse(raw, {
    columns: true,
    bom: true,
    trim: true,
    skip_empty_lines: true,
  });

  if (records.length === 0) {
    throw new Error(`${csvPath} contains no data rows`);
  }

  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !(column in records[0])
  );
  if (missingColumns.length > 0) {
    throw new Error(
      `${csvPath} is missing required column(s): ${missingColumns.join(', ')}. ` +
        `Expected header: ${REQUIRED_COLUMNS.join(',')}`
    );
  }

  const items = [];
  const rowErrors = [];

  records.forEach((record, index) => {
    const row = index + 1;
    const problems = [];

    for (const column of REQUIRED_COLUMNS) {
      if (!record[column]) problems.push(`"${column}" is empty`);
    }
    if (record.product_image && !isHttpUrl(record.product_image)) {
      problems.push('"product_image" must be an http(s) URL');
    }

    if (problems.length > 0) {
      rowErrors.push({ row, message: problems.join('; ') });
      return;
    }

    items.push({
      variables: rowToVariables(record),
      name: `offer-${slugify(record.first_name)}-r${row}`,
      row,
    });
  });

  return { items, rowErrors };
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Lowercase ASCII slug safe for filenames and job names. */
export function slugify(value) {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'row'
  );
}
