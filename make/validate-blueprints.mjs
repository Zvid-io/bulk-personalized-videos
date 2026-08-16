import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const makeRoot = dirname(fileURLToPath(import.meta.url));
const publicFiles = [
  'zvid-bulk-personalized-videos-dry-run.blueprint.json',
  'zvid-bulk-personalized-videos.blueprint.json',
];
const localFiles = publicFiles.map((file) => file.replace('.blueprint.json', '.local.blueprint.json'));
const files = [...publicFiles];

for (const file of localFiles) {
  try {
    await access(resolve(makeRoot, file));
    files.push(file);
  } catch {
    // Local blueprints are generated only when a private Make clone exists.
  }
}

for (const file of files) {
  const text = await readFile(resolve(makeRoot, file), 'utf8');
  const blueprint = JSON.parse(text);
  const ids = blueprint.flow.map((module) => module.id);
  const zvidModules = blueprint.flow.filter((module) => module.module.includes(':') && /zvid/i.test(module.module));

  assert.ok(blueprint.name.startsWith('Zvid - '), `${file}: unexpected scenario name`);
  assert.equal(new Set(ids).size, ids.length, `${file}: duplicate module IDs`);
  assert.ok(zvidModules.length > 0, `${file}: no Zvid modules`);
  assert.doesNotMatch(text, /\bzvid_[A-Za-z0-9]+\b/, `${file}: contains an API key`);
  if (file.includes('.local.')) {
    for (const module of zvidModules) {
      assert.match(
        module.module,
        /^app#[a-z][a-z0-9-]+:/,
        `${file}: private custom-app modules must use the app# namespace`,
      );
    }
  }
  assert.doesNotMatch(
    text.toLowerCase(),
    /pexels|pixabay|unsplash|giphy|jamendo/,
    `${file}: exposes a stock implementation detail`,
  );
  for (const module of blueprint.flow.filter((item) => item.module === 'http:ActionSendData')) {
    assert.match(module.mapper.url, /^https:\/\/raw\.githubusercontent\.com\/Zvid-io\//);
    assert.deepEqual(module.mapper.headers, []);
    assert.equal(module.mapper.followAllRedirects, false);
    assert.equal(module.mapper.serializeUrl, false);
    assert.equal(module.mapper.useMtls, false);
    assert.ok(!('bodyType' in module.mapper), `${file}: GET request contains a stale bodyType`);
    assert.ok(!('timeout' in module.mapper), `${file}: GET request contains a stale empty timeout`);
    assert.ok(!('ca' in module.mapper), `${file}: GET request contains a stale empty certificate`);
  }
  for (const module of zvidModules) {
    assert.equal(module.parameters.__IMTCONN__, 0, `${file}: embeds a real connection ID`);
  }

  if (file.includes('dry-run')) {
    const iterator = blueprint.flow.find((module) => module.module === 'builtin:BasicFeeder');
    const validator = blueprint.flow.find((module) => module.module.endsWith(':validateRender'));
    assert.equal(iterator.mapper.array.length, 4, `${file}: expected four sample rows`);
    assert.ok(validator, `${file}: missing Validate a render payload`);
    assert.equal(validator.mapper.variables, '{{2.value}}');
    assert.ok(
      iterator.mapper.array.every((row) => row.firstName && !('variables' in row)),
      `${file}: iterator rows must map directly into the Variables JSON field`,
    );
  } else {
    const submit = blueprint.flow.find((module) => module.module.endsWith(':createBulkRender'));
    const statusChecks = blueprint.flow.filter((module) => module.module.endsWith(':getBulkRender'));
    const output = blueprint.flow.at(-1);
    const items = JSON.parse(submit.mapper.items);
    assert.equal(items.length, 4, `${file}: expected four bulk items`);
    assert.equal(new Set(items.map((item) => item.name)).size, 4, `${file}: duplicate job names`);
    assert.equal(statusChecks.length, 2, `${file}: expected two batch status checks`);
    assert.ok(output.module.endsWith(':getBulkRender'));
    assert.equal(output.mapper.bulkId, '{{2.bulkId}}');
    assert.equal(
      blueprint.flow.filter((module) => module.module === 'builtin:BasicFeeder').length,
      0,
      `${file}: paid workflow must not end with an unused Iterator`,
    );
  }
}

console.log(`Validated ${files.length} Make blueprint(s).`);
