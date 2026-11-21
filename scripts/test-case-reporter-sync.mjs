import assert from 'node:assert/strict';

globalThis.Zotero = {
  debug() {},
  ItemTypes: {
    getName(itemTypeID) { return itemTypeID === 1 ? 'case' : ''; },
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
  abbrevService: {
    normalizeKey(value) { return String(value || '').trim(); },
    formatJurisdictionDisplay(value) { return value; },
  },
});
patcher._getZoteroItemByAnyID = () => item;

await patcher._syncCaseReporterFromFieldsAndMLZ(item.id);
assert.equal(item.fields.reporter, 'F.3d', 'initial sync hydrates an empty reporter field');

item.setField('reporter', '');
await patcher._syncCaseReporterFromFieldsAndMLZ(item.id);
assert.equal(Jurisdiction.getMLZExtraFields(item.fields.extra)?.reporter, undefined,
  'clearing reporter removes its mlzsync value instead of restoring it');

console.log('case reporter sync tests passed');
