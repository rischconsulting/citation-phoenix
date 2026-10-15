import assert from 'node:assert/strict';
import { Patcher } from '../lib/services/patcher.mjs';

const fieldIDs = new Map([['date', 1], ['title', 2], ['extra', 3], ['court', 4]]);
const fieldNames = new Map(Array.from(fieldIDs, ([name, id]) => [id, name]));
const registeredRows = [];

globalThis.Zotero = {
  locale: 'en-US',
  debug() {},
  ItemTypes: {
    getName(id) { return id === 1 || id === 3 ? 'statute' : (id === 2 ? 'case' : ''); },
  },
  ItemFields: {
    getID(name) { return fieldIDs.get(name) || null; },
    getName(id) { return fieldNames.get(id) || null; },
    isValidForType(fieldID, itemTypeID) {
      return (itemTypeID === 1 && [1, 2, 3].includes(fieldID))
        || (itemTypeID === 2 && [2, 3, 4].includes(fieldID));
    },
    getFieldIDFromTypeAndBase() { return null; },
    getItemTypeFields() { return [2, 1, 3]; },
  },
  ItemPaneManager: {
    registerInfoRow(spec) {
      registeredRows.push(spec);
      return `citation-phoenix@michaelrisch.com-${spec.rowID}`;
    },
    unregisterInfoRow() {},
  },
};

const definitions = {
  gazette: [
    { field: 'title', baseField: null, kind: 'field' },
    { field: 'publicationDate', baseField: null, kind: 'date' },
    { field: 'date', baseField: null, kind: 'date' },
  ],
  regulation: [
    { field: 'title', baseField: null, kind: 'field' },
    { field: 'date', baseField: null, kind: 'date' },
    { field: 'adoptionDate', baseField: null, kind: 'date' },
  ],
  case: [
    { field: 'division', baseField: null, kind: 'field' },
  ],
  newspaperArticle: [
    { field: 'court', baseField: null, kind: 'field' },
  ],
  statute: [
    { field: 'reign', baseField: null, kind: 'field' },
    { field: 'regnalYear', baseField: null, kind: 'field' },
    { field: 'publicationDate', baseField: null, kind: 'date' },
    { field: 'originalDate', baseField: null, kind: 'date' },
    { field: 'dateAmended', baseField: null, kind: 'date' },
  ],
};
const sequences = {
  gazette: ['title', 'publicationDate', 'date'],
  regulation: ['title', 'date', 'adoptionDate'],
};
const schemaConfig = {
  getAllFieldNames() {
    return [
      'title', 'date', 'publicationDate', 'adoptionDate', 'division', 'court',
      'reign', 'regnalYear', 'originalDate', 'dateAmended',
    ];
  },
  getFieldDefinitionsForItemType(type) { return definitions[type] || []; },
  getFieldDefinition(type, field) {
    return (definitions[type] || []).find((definition) => definition.field === field) || null;
  },
  getSequenceForItemType(type) { return sequences[type] || []; },
  isCustomItemType(type) { return type === 'gazette' || type === 'regulation'; },
  getBaseItemType(type) { return type === 'gazette' || type === 'regulation' ? 'statute' : type; },
  getExtraCreatorTypes() { return []; },
};

function parseExtra(extra) {
  const result = {};
  for (const line of String(extra || '').split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

const jurisdiction = {
  getMLZItemType(item) { return item.customType || ''; },
  getMLZExtraFields(itemOrExtra) {
    const extra = typeof itemOrExtra === 'string' ? itemOrExtra : itemOrExtra?.getField?.('extra');
    return parseExtra(extra);
  },
  updateMLZExtraField(extra, field, value) {
    const parsed = parseExtra(extra);
    if (value) parsed[field] = value;
    else delete parsed[field];
    return Object.entries(parsed).map(([key, entry]) => `${key}: ${entry}`).join('\n');
  },
};

const patcher = new Patcher({
  pluginID: 'citation-phoenix@michaelrisch.com',
  abbrevService: { formatJurisdictionDisplay(value) { return value; } },
  jurisdiction,
  schemaConfig,
});

for (const [input, expected] of [
  ['2026', '2026'],
  ['2026-9', '2026-09'],
  ['2026-9-7', '2026-09-07'],
  ['9/7/2026', '2026-09-07'],
  ['September 7, 2026', '2026-09-07'],
  ['circa Michaelmas term', 'circa Michaelmas term'],
  ['', ''],
]) {
  assert.equal(patcher._normalizeSchemaDateInput(input), expected, input);
}

for (const canonical of ['2026', '2026-09', '2026-09-07']) {
  assert.equal(
    patcher._normalizeSchemaDateInput(patcher._formatSchemaDateDisplay(canonical)),
    canonical,
    `localized round trip for ${canonical}`,
  );
}
assert.deepEqual(patcher._parseRawDateToCSL('2026-09-07')['date-parts'], [[2026, 9, 7]]);
assert.deepEqual(patcher._parseRawDateToCSL('circa Michaelmas term'), { raw: 'circa Michaelmas term' });

const item = {
  id: 42,
  itemTypeID: 1,
  customType: 'gazette',
  fields: { title: 'Gazette title', date: '2025', extra: 'publicationDate: 2026-09-07' },
  getField(name) { return this.fields[name] || ''; },
  setField(name, value) { this.fields[name] = value; },
  async saveTx() { this.saveCount = (this.saveCount || 0) + 1; },
};

assert.equal(patcher._getItemTypeName(item), 'gazette');
assert.equal(patcher._shouldUseRegisteredSchemaInfoRow(item, definitions.gazette[1]), true);
assert.equal(patcher._shouldUseRegisteredSchemaInfoRow(item, definitions.gazette[2]), false);

patcher._registerSchemaInfoRows();
const publicationDateRow = registeredRows.find((row) => row.rowID.endsWith('publicationDate'));
assert.ok(publicationDateRow, 'Extra-backed date row is registered');
assert.equal(publicationDateRow.onGetData({ item }), '9/7/2026');
await publicationDateRow.onSetData({ item, value: '9/7/2026' });
assert.equal(item.saveCount || 0, 0, 'unchanged displayed date does not save');
await publicationDateRow.onSetData({ item, value: 'September 8, 2026' });
assert.equal(item.saveCount, 1, 'changed date saves once');
assert.equal(parseExtra(item.fields.extra).publicationDate, '2026-09-08');

const caseItem = {
  id: 43,
  itemTypeID: 2,
  customType: '',
  fields: { court: 'court.appeals', extra: '' },
  getField(name) { return this.fields[name] || ''; },
};
const registeredCourtID = patcher._registeredSchemaRowsByField.get('court');
assert.ok(registeredCourtID, 'Court is globally registered for an Extra-backed item type');
const disabledRegisteredCourtRow = {
  getAttribute(name) { return name === 'data-custom-row-id' ? registeredCourtID : ''; },
};
const caseInfoBox = {
  item: caseItem,
  querySelectorAll(selector) {
    return selector === '[data-custom-row-id]' ? [disabledRegisteredCourtRow] : [];
  },
};
assert.equal(
  patcher._findRegisteredSchemaInfoRow(caseInfoBox, 'court'),
  null,
  'disabled registered court row does not shadow the native Case court row',
);

const customCreatorType = { key: 'commenter', mlzType: 'commenter' };
let storedCustomCreators = [{ firstName: 'Jane', lastName: 'Original' }];
patcher._getStoredExtraPeople = () => storedCustomCreators.map((person) => ({ ...person }));
patcher._setStoredExtraPeople = (_targetItem, _creatorType, people) => {
  storedCustomCreators = people.map((person) => ({ ...person }));
};
const customCreatorRow = {
  getAttribute(name) { return name === 'data-ibcslm-extra-person-index' ? '0' : ''; },
};
const editedStorageIndex = patcher._setStoredExtraPersonForRow(
  item,
  customCreatorType,
  customCreatorRow,
  { firstName: 'Jane', lastName: 'Updated' },
);
assert.equal(editedStorageIndex, 0);
assert.deepEqual(
  storedCustomCreators,
  [{ firstName: 'Jane', lastName: 'Updated' }],
  'editing a custom creator replaces its stored entry instead of appending a duplicate',
);
assert.deepEqual(
  patcher._extraPersonFromCreatorFields({ lastName: 'Changed' }, { firstName: 'Jane', lastName: 'Updated' }),
  { firstName: 'Jane', lastName: 'Changed' },
  'partial creator edits retain the other name component',
);
assert.deepEqual(
  patcher._extraPersonFromCreatorFields({}, { firstName: 'Jane', lastName: 'Changed' }),
  { firstName: 'Jane', lastName: 'Changed' },
  'empty transient creator payload does not clear the existing contributor',
);
const firstNameEditor = { value: '' };
const lastNameEditor = { value: '' };
const hydratedCreatorRow = {
  querySelector(selector) {
    if (selector === '.meta-label') return { getAttribute() { return 'creator-4-typeID'; } };
    if (selector === '[fieldname="creator-4-firstName"]') return firstNameEditor;
    if (selector === '[fieldname="creator-4-lastName"]') return lastNameEditor;
    return null;
  },
  contains() { return false; },
  getAttribute(name) { return name === 'data-ibcslm-extra-person-index' ? '0' : ''; },
};
patcher._populateExtraPersonCreatorRow(
  { ownerDocument: { activeElement: null } },
  hydratedCreatorRow,
  { firstName: 'Jane', lastName: 'Changed' },
);
assert.equal(firstNameEditor.value, 'Jane', 'existing first name is restored into the editor');
assert.equal(lastNameEditor.value, 'Changed', 'existing last name is restored into the editor');
const originalGetExtraPersonConfigByIndex = patcher._getExtraPersonConfigByIndex.bind(patcher);
const originalGetCreatorRowIndex = patcher._getCreatorRowIndex.bind(patcher);
patcher._getExtraPersonConfigByIndex = () => customCreatorType;
patcher._getCreatorRowIndex = () => 0;
const focusedCreatorRow = {
  getAttribute(name) { return name === 'data-ibcslm-extra-person-index' ? '0' : ''; },
};
const focusedFirstName = {
  closest() { return focusedCreatorRow; },
  getAttribute(name) { return name === 'fieldname' ? 'creator-4-firstName' : ''; },
};
assert.deepEqual(
  patcher._getExtraPersonEditorValue({ item }, focusedFirstName),
  { value: 'Jane' },
  'creator focus reads the existing Extra value instead of item.getCreator()',
);
patcher._getExtraPersonConfigByIndex = originalGetExtraPersonConfigByIndex;
patcher._getCreatorRowIndex = originalGetCreatorRowIndex;

const statuteItem = {
  id: 44,
  itemTypeID: 3,
  fields: { extra: '' },
  getField(name) { return this.fields[name] || ''; },
  setField(name, value) { this.fields[name] = value; },
  async saveTx() { this.saveCount = (this.saveCount || 0) + 1; },
};
for (const field of ['reign', 'regnalYear', 'publicationDate', 'originalDate', 'dateAmended']) {
  const definition = schemaConfig.getFieldDefinition('statute', field);
  assert.ok(definition, `${field} is parsed for statute`);
  assert.equal(patcher._shouldUseRegisteredSchemaInfoRow(statuteItem, definition), true);
  const registeredRow = registeredRows.find((row) => row.rowID.endsWith(field));
  let enabled = null;
  registeredRow.onItemChange({
    item: statuteItem,
    setEnabled(value) { enabled = value; },
    setEditable() {},
  });
  assert.equal(enabled, true, `${field} registered row is enabled for statute`);
}

await patcher._saveSchemaFieldValue(
  statuteItem,
  schemaConfig.getFieldDefinition('statute', 'dateAmended'),
  'September 9, 2026',
);
assert.equal(
  parseExtra(statuteItem.fields.extra).dateAmended,
  '2026-09-09',
  'the central save path canonicalizes dates even when a UI handler does not',
);

let materializeCount = 0;
let materializedRows = [];
const materializeInfoBox = {
  item: statuteItem,
  querySelectorAll(selector) {
    return selector === '[data-custom-row-id]' ? materializedRows : [];
  },
  renderCustomRows() {
    materializeCount += 1;
    materializedRows = ['reign', 'regnalYear', 'publicationDate', 'originalDate', 'dateAmended']
      .map((field) => ({
        getAttribute(name) {
          return name === 'data-custom-row-id'
            ? patcher._registeredSchemaRowsByField.get(field)
            : '';
        },
      }));
  },
};
patcher._materializeRegisteredSchemaInfoRows(
  materializeInfoBox,
  schemaConfig.getFieldDefinitionsForItemType('statute'),
);
assert.equal(materializeCount, 1, 'missing registered rows are materialized through Zotero');
assert.ok(
  patcher._findRegisteredSchemaInfoRow(materializeInfoBox, 'dateAmended'),
  'materialized date remains a registered Zotero Info row',
);

const infoBox = {
  item,
  _resetRenderedFlags() { this.resetCount = (this.resetCount || 0) + 1; },
};
patcher._prepareInfoBoxForRender(infoBox);
assert.equal(infoBox._ibcslmEffectiveRenderKey, '42::statute::gazette');
assert.deepEqual(infoBox.fieldOrder.slice(0, 2), ['title', 'date']);
assert.equal(infoBox.resetCount, 1);
const stableFieldOrder = infoBox.fieldOrder;
patcher._prepareInfoBoxForRender(infoBox);
assert.equal(infoBox.resetCount, 1, 'same effective type does not invalidate layout');
assert.equal(infoBox.fieldOrder, stableFieldOrder, 'ordinary save redraws do not replace the field-order array');
item.customType = 'regulation';
patcher._prepareInfoBoxForRender(infoBox);
assert.equal(infoBox._ibcslmEffectiveRenderKey, '42::statute::regulation');
assert.equal(infoBox.resetCount, 2, 'custom type change invalidates layout with same native base');

const focusTransaction = [];
const transactionInfoBox = {
  _saveFieldFocus() { focusTransaction.push('save'); },
  _restoreFieldFocus() { focusTransaction.push('restore'); },
};
patcher._ensureExtraPersonMenuItems = () => focusTransaction.push('mutate');
patcher._removeCommenterField = () => {};
patcher._renderExtraPersonCreatorRows = () => {};
patcher._refreshCustomInfoRows = () => {};
patcher._refreshInfoBoxAfterRender(transactionInfoBox);
assert.deepEqual(
  focusTransaction,
  ['save', 'mutate', 'restore'],
  'custom row mutation uses Zotero native focus preservation synchronously',
);

console.log('schema rendering tests passed');
