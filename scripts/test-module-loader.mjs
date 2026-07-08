import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const moduleLoaderURL = pathToFileURL(path.join(rootDir, 'lib', 'services', 'moduleLoader.mjs')).href;
const { ModuleLoader } = await import(moduleLoaderURL);

const indexPath = path.join(rootDir, 'style-modules', 'index.json');
const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));

const fakeDataStore = {
  async loadJSON(relPath) {
    assert.equal(relPath, 'style-modules/index.json');
    return index;
  },
  async loadText(relPath) {
    return relPath;
  },
};

const loader = new ModuleLoader({
  rootURI: null,
  dataStore: fakeDataStore,
  locale: 'en-US',
});

await loader.preload();

const cases = [
  {
    jurisdiction: 'us:ny',
    variant: 'IndigoTemp',
    expected: 'style-modules/juris-us+ny-IndigoTemp.csl',
    label: 'exact state + exact variant',
  },
  {
    jurisdiction: 'us:tx',
    variant: 'IndigoTemp',
    expected: 'style-modules/juris-us-IndigoTemp.csl',
    label: 'missing child falls back to parent variant',
  },
  {
    jurisdiction: 'ca:qc',
    variant: 'IndigoTemp',
    expected: 'style-modules/juris-ca+qc.csl',
    label: 'missing variant falls back to plain child module',
  },
  {
    jurisdiction: 'ca:on',
    variant: 'IndigoTemp',
    expected: 'style-modules/juris-ca+on.csl',
    label: 'plain provincial module is used for IndigoTemp request',
  },
  {
    jurisdiction: 'eu.int:cjeu',
    variant: 'IndigoTemp',
    expected: 'style-modules/juris-eu.int+cjeu-IndigoTemp.csl',
    label: 'exact supranational child + exact variant',
  },
  {
    jurisdiction: 'eu.int:cjeu',
    variant: 'LegCit',
    expected: 'style-modules/juris-eu.int+cjeu-LegCit.csl',
    label: 'exact supranational child + alternate variant',
  },
  {
    jurisdiction: 'eu.int:cjeu',
    variant: 'oscola',
    expected: 'style-modules/juris-eu.int-oscola.csl',
    label: 'missing child variant falls back to parent variant',
  },
  {
    jurisdiction: 'zz:demo',
    variant: 'IndigoTemp',
    expected: 'style-modules/juris-us-IndigoTemp.csl',
    label: 'unknown root falls back to default root variant',
  },
];

let failures = 0;

for (const testCase of cases) {
  const actual = loader.loadJurisdictionStyleSync(testCase.jurisdiction, testCase.variant);
  try {
    assert.equal(actual, testCase.expected);
    console.log(`PASS ${testCase.label}: ${testCase.jurisdiction} / ${testCase.variant} -> ${actual}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${testCase.label}: expected ${testCase.expected} but got ${actual}`);
  }
}

if (failures) {
  process.exitCode = 1;
  console.error(`\n${failures} module loader regression test(s) failed.`);
} else {
  console.log(`\nAll ${cases.length} module loader regression tests passed.`);
}
