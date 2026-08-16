import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const makeRoot = dirname(fileURLToPath(import.meta.url));
const defaultManifest = resolve(
  makeRoot,
  '..',
  '..',
  '..',
  'zvid-integrations',
  '.make-local',
  'makecomapp.json',
);
const manifestPath = resolve(process.argv[2] ?? defaultManifest);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const appId = manifest.origins?.[0]?.appId;

if (!appId || !/^[a-z][a-z0-9-]+$/.test(appId)) {
  throw new Error(`No valid Make app ID was found in ${manifestPath}`);
}

const sourceFiles = [
  'zvid-bulk-personalized-videos-dry-run.blueprint.json',
  'zvid-bulk-personalized-videos.blueprint.json',
];

for (const sourceFile of sourceFiles) {
  const blueprint = JSON.parse(await readFile(resolve(makeRoot, sourceFile), 'utf8'));
  replaceZvidModulePrefix(blueprint.flow, `app#${appId}`);
  const targetFile = sourceFile.replace('.blueprint.json', '.local.blueprint.json');
  await writeFile(resolve(makeRoot, targetFile), `${JSON.stringify(blueprint, null, 4)}\n`);
  console.log(`Created make/${targetFile} for ${appId}`);
}

function replaceZvidModulePrefix(flow, targetAppId) {
  for (const module of flow ?? []) {
    if (module.module?.startsWith('zvid:')) {
      module.module = `${targetAppId}:${module.module.slice('zvid:'.length)}`;
    }
    for (const route of module.routes ?? []) replaceZvidModulePrefix(route.flow, targetAppId);
    replaceZvidModulePrefix(module.onerror, targetAppId);
  }
}
