import assert from 'node:assert/strict';

globalThis.Zotero = {
  debug() {},
  ItemTypes: {
    getName(itemTypeID) { return itemTypeID === 1 ? 'case' : (itemTypeID === 2 ? 'statute' : ''); },
  },
};

const { Patcher } = await import('../lib/services/patcher.mjs');
const { Jurisdiction } = await import('../lib/services/jurisdiction.mjs');

const item = {
  id: 1,
  itemTypeID: 1,
  fields: {
    reporter: '',
    court: '',
    extra: 'mlzsync1:{"extrafields":{"reporter":"F.3d"}}',
  },
  getField(field) { return this.fields[field] || ''; },
  setField(field, value) { this.fields[field] = value; },
  async saveTx() { this.saveCount = (this.saveCount || 0) + 1; },
};

const patcher = new Patcher({
  jurisdiction: Jurisdiction,
  schemaConfig: {
    getFieldDefinitionsForItemType(itemType) {
      if (itemType === 'case') return [{ field: 'DOI', baseField: null }];
      if (itemType === 'statute') return [{ field: 'jurisdiction', baseField: null }];
      return [];
    },
  },
  abbrevService: {
    normalizeKey(value) { return String(value || '').trim(); },
    formatJurisdictionDisplay(value) { return value; },
  },
});
const items = new Map([[item.id, item]]);
patcher._getZoteroItemByAnyID = (itemID) => items.get(itemID);
patcher._resolveNativeFieldName = (_itemTypeID, fieldName) => fieldName;

await patcher._syncCaseReporterFromFieldsAndMLZ(item.id);
assert.equal(item.fields.reporter, 'F.3d', 'initial sync hydrates an empty reporter field');

item.setField('reporter', '');
await patcher._syncCaseReporterFromFieldsAndMLZ(item.id);
assert.equal(Jurisdiction.getMLZExtraFields(item.fields.extra)?.reporter, undefined,
  'clearing reporter removes its mlzsync value instead of restoring it');

const doiItem = {
  id: 2,
  itemTypeID: 1,
  fields: {
    DOI: '',
    extra: 'mlzsync1:{"extrafields":{"DOI":"10.1000/example"}}',
  },
  getField(field) { return this.fields[field] || ''; },
  setField(field, value) { this.fields[field] = value; },
  async saveTx() { this.saveCount = (this.saveCount || 0) + 1; },
};
items.set(doiItem.id, doiItem);

await patcher._syncSchemaConfiguredFields(doiItem.id);
assert.equal(doiItem.fields.DOI, '10.1000/example', 'initial sync hydrates an empty DOI field');

doiItem.setField('DOI', '10.1000/revised');
await patcher._syncSchemaConfiguredFields(doiItem.id);
assert.equal(Jurisdiction.getMLZExtraFields(doiItem.fields.extra)?.DOI, '10.1000/revised',
  'editing DOI updates its mlzsync value');

doiItem.setField('DOI', '');
await patcher._syncSchemaConfiguredFields(doiItem.id);
assert.equal(Jurisdiction.getMLZExtraFields(doiItem.fields.extra)?.DOI, undefined,
  'clearing DOI removes its mlzsync value instead of restoring it');

const jurisdictionItem = {
  id: 3,
  itemTypeID: 2,
  fields: {
    jurisdiction: '',
    extra: 'mlzsync1:{"extrafields":{"jurisdiction":"005us:ny"}}',
  },
  getField(field) { return this.fields[field] || ''; },
  setField(field, value) { this.fields[field] = value; },
  async saveTx() { this.saveCount = (this.saveCount || 0) + 1; },
};
items.set(jurisdictionItem.id, jurisdictionItem);

await patcher._syncSchemaConfiguredFields(jurisdictionItem.id);
assert.equal(jurisdictionItem.fields.jurisdiction, 'us:ny', 'initial sync hydrates an empty jurisdiction field');

jurisdictionItem.setField('jurisdiction', '');
await patcher._syncSchemaConfiguredFields(jurisdictionItem.id);
assert.equal(Jurisdiction.getMLZExtraFields(jurisdictionItem.fields.extra)?.jurisdiction, undefined,
  'clearing jurisdiction removes its mlzsync value instead of restoring it');

console.log('MLZ field sync tests passed');
