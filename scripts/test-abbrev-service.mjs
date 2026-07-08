import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abbrevServiceURL = pathToFileURL(path.join(rootDir, 'lib', 'services', 'abbrevService.mjs')).href;
const { AbbrevService } = await import(abbrevServiceURL);

globalThis.Zotero = {
  Prefs: {
    get() {
      return '';
    },
    set() {},
  },
};

const cache = new Map();
const fakeDataStore = {
  async loadJSON(relPath) {
    if (cache.has(relPath)) return cache.get(relPath);
    const absPath = path.join(rootDir, relPath);
    const data = JSON.parse(await fs.readFile(absPath, 'utf8'));
    cache.set(relPath, data);
    return data;
  },
  async loadJSONAny(relPaths) {
    for (const relPath of relPaths || []) {
      try {
        return await this.loadJSON(relPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return null;
  },
};

const service = new AbbrevService({
  dataStore: fakeDataStore,
  locale: 'de-AT',
});

await service.preload();

const availableDomains = service.getAvailableAbbrevDomains();
assert.ok(Array.isArray(availableDomains.ca), 'Canada should expose abbreviation domains');
assert.ok(availableDomains.ca.includes('fr'), 'Canada should expose the fr abbreviation domain');
assert.ok(Array.isArray(availableDomains.ch), 'Switzerland should expose an abbreviation domain entry even without variants');
assert.equal(availableDomains.ch.length, 0, 'Switzerland should expose an empty abbreviation domain list when no variants exist');

const cases = [
  {
    category: 'institution-entire',
    key: 'ogh',
    jurisdiction: 'at',
    expected: 'OGH',
    label: 'Austria canonical court abbreviation resolves from institution-entire',
  },
  {
    category: 'institution-part',
    key: 'ogh',
    jurisdiction: 'at',
    expected: 'Oberster Gerichtshof',
    label: 'Austria display-form court label remains available from institution-part',
  },
  {
    category: 'institution-entire',
    key: 'vfgh',
    jurisdiction: 'at',
    expected: 'VfGH',
    label: 'Austria constitutional court abbreviation resolves from institution-entire',
  },
  {
    category: 'institution-part',
    key: 'vfgh',
    jurisdiction: 'at',
    expected: 'VfSlg',
    label: 'Austria constitutional court reporter-style short form remains distinct in institution-part',
  },
  {
    category: 'institution-entire',
    key: 'ogh',
    jurisdiction: 'at:vienna',
    expected: 'OGH',
    label: 'Institution-entire lookup falls back through jurisdiction chain',
  },
  {
    category: 'institution-part',
    key: 'supreme.court.prov',
    jurisdiction: 'ca:bc',
    expected: 'BC SC',
    label: 'Default Canadian dataset remains in use without a domain hint',
  },
  {
    category: 'institution-part',
    key: 'supreme.court.prov',
    jurisdiction: 'ca:bc@fr',
    expected: 'BC C Supr',
    label: 'French Canadian domain selects auto-ca-fr for provincial court labels',
  },
  {
    category: 'institution-entire',
    key: 'supreme.court',
    jurisdiction: 'ca@fr',
    expected: 'CSC',
    label: 'French Canadian domain selects auto-ca-fr for canonical court abbreviations',
  },
];

const optionCases = [
  {
    jurisdiction: 'at',
    key: 'ogh',
    expected: 'Oberster Gerichtshof',
    label: 'Merged court options prefer institution-part when both institution-part and institution-entire exist',
  },
];

let failures = 0;

for (const testCase of cases) {
  const actual = service.lookupForCiteProc(testCase.category, testCase.key, testCase.jurisdiction, { noHints: true })?.value || null;
  try {
    assert.equal(actual, testCase.expected);
    console.log(`PASS ${testCase.label}: ${testCase.category} / ${testCase.jurisdiction} / ${testCase.key} -> ${actual}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${testCase.label}: expected ${testCase.expected} but got ${actual}`);
  }
}

service._userJurisdictionOverrides['auto-us'] = {
  'us:zz::institution-entire::synthetic.court': 'Synthetic Entire',
  'us:zz::institution-part::dual.court': 'Dual Part',
  'us:zz::institution-entire::dual.court': 'Dual Entire',
};
service._userJurisdictionOverrides['auto-li'] = {
  'us::institution-entire::legacy.li.court': 'Legacy LI Entire',
};

for (const optionCase of optionCases) {
  const row = service.listInstitutionPartOptionsForJurisdictionTree(optionCase.jurisdiction)
    .find((entry) => entry.jurisdiction === optionCase.jurisdiction && entry.key === optionCase.key);
  const actual = row?.abbreviation || null;
  try {
    assert.equal(actual, optionCase.expected);
    console.log(`PASS ${optionCase.label}: ${optionCase.jurisdiction} / ${optionCase.key} -> ${actual}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${optionCase.label}: expected ${optionCase.expected} but got ${actual}`);
  }
}

for (const syntheticCase of [
  {
    key: 'synthetic.court',
    expected: 'Synthetic Entire',
    label: 'Merged court options include institution-entire-only entries',
  },
  {
    key: 'dual.court',
    expected: 'Dual Part',
    label: 'Merged court options prefer institution-part overrides over institution-entire overrides',
  },
]) {
  const row = service.listInstitutionPartOptionsForJurisdictionTree('us:zz')
    .find((entry) => entry.jurisdiction === 'us:zz' && entry.key === syntheticCase.key);
  const actual = row?.abbreviation || null;
  try {
    assert.equal(actual, syntheticCase.expected);
    console.log(`PASS ${syntheticCase.label}: us:zz / ${syntheticCase.key} -> ${actual}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${syntheticCase.label}: expected ${syntheticCase.expected} but got ${actual}`);
  }
}

try {
  assert.equal(service.formatInstitutionPartDisplay('synthetic.court', 'us:zz'), 'Synthetic Entire');
  console.log('PASS Entire-only display fallback uses institution-entire value');
} catch (error) {
  failures += 1;
  console.error(`FAIL Entire-only display fallback uses institution-entire value: expected Synthetic Entire but got ${service.formatInstitutionPartDisplay('synthetic.court', 'us:zz')}`);
}

try {
  const row = service.listInstitutionPartOptionsForJurisdictionTree('li')
    .find((entry) => entry.jurisdiction === 'li' && entry.key === 'legacy.li.court');
  assert.equal(row?.abbreviation || null, 'Legacy LI Entire');
  console.log('PASS Legacy auto-li institution-entire override stored under us is listed for li');
} catch (error) {
  failures += 1;
  console.error('FAIL Legacy auto-li institution-entire override stored under us is listed for li');
}

try {
  const saved = service.upsertJurisdictionPreferenceEntry('auto-li', 'default', 'institution-entire', 'new.li.court', 'New LI Entire');
  assert.equal(saved, true);
  assert.equal(service._userJurisdictionOverrides['auto-li']['li::institution-entire::new.li.court'], 'New LI Entire');
  const row = service.listInstitutionPartOptionsForJurisdictionTree('li')
    .find((entry) => entry.jurisdiction === 'li' && entry.key === 'new.li.court');
  assert.equal(row?.abbreviation || null, 'New LI Entire');
  console.log('PASS New auto-li default institution-entire override saves and lists under li');
} catch (error) {
  failures += 1;
  console.error('FAIL New auto-li default institution-entire override saves and lists under li');
}

try {
  const removed = service.removeJurisdictionPreferenceEntry('auto-li', 'li', 'institution-entire', 'legacy.li.court');
  assert.equal(removed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(service._userJurisdictionOverrides['auto-li'], 'us::institution-entire::legacy.li.court'), false);
  console.log('PASS Legacy auto-li institution-entire override can be removed using li');
} catch (error) {
  failures += 1;
  console.error('FAIL Legacy auto-li institution-entire override can be removed using li');
}

try {
  const importResult = service.importOverrides('jurisdiction', 'auto-li', {
    xdata: {
      li: {
        'institution-entire': {
          fogh: 'Imported Court Name',
        },
        'intitution-entire': {
          typo: 'Should Skip',
        },
      },
      ch: {
        'institution-entire': {
          foo: 'Outside Scope',
        },
      },
    },
  });
  assert.equal(importResult.added, 1);
  assert.equal(importResult.updated, 0);
  assert.equal(importResult.skipped, 2);
  assert.equal(service._userJurisdictionOverrides['auto-li']['li::institution-entire::fogh'], 'Imported Court Name');
  assert.ok(importResult.skipReasons.some((entry) => entry.reason === 'unsupported_category' && entry.count === 1));
  assert.ok(importResult.skipReasons.some((entry) => entry.reason === 'outside_selected_dataset_scope' && entry.count === 1));
  console.log('PASS Import writes supported rows and reports skipped reasons');
} catch (error) {
  failures += 1;
  console.error('FAIL Import writes supported rows and reports skipped reasons');
}

try {
  const importResult = service.importOverrides('jurisdiction', 'auto-li', {
    xdata: {
      li: {
        'institution-entire': {
          fogh: 'Imported Court Name',
        },
      },
    },
  });
  assert.equal(importResult.added, 0);
  assert.equal(importResult.updated, 0);
  assert.equal(importResult.skipped, 1);
  assert.ok(importResult.skipReasons.some((entry) => entry.reason === 'unchanged' && entry.count === 1));
  console.log('PASS Import reports unchanged rows as skipped with a reason');
} catch (error) {
  failures += 1;
  console.error('FAIL Import reports unchanged rows as skipped with a reason');
}

if (failures) {
  process.exitCode = 1;
  console.error(`\n${failures} abbreviation regression test(s) failed.`);
} else {
  console.log(`\nAll ${cases.length + optionCases.length + 8} abbreviation regression tests passed.`);
}
