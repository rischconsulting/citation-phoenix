import { getLocaleCandidates } from './locale.mjs';

function humanizeKey(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  return source
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function toKebabCase(value) {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase();
}

export class SchemaConfig {
  constructor({ dataStore }) {
    this.dataStore = dataStore;
    this.raw = null;
    this.localizationRaw = null;
    this._types = {};
    this._knownItemTypes = new Set();
    this._customTypesByBaseItemType = new Map();
    this._creatorsByItemType = new Map();
    this._fieldDefsByItemType = new Map();
    this._fieldDefIndexByItemType = new Map();
    this._allFieldNames = new Set();
    this._cslFieldSources = new Map();
    this._cslDateSources = new Map();
    this._extraCreatorTypes = [];
    this._sequenceByItemType = new Map();
    this._localizedFieldsByLocale = new Map();
    this._localizedCreatorsByLocale = new Map();
    this._localizedItemTypesByLocale = new Map();
  }

  async preload() {
    this.raw = await this.dataStore.loadJSON('content/schema.json');
    this.localizationRaw = await this.dataStore.loadJSON('content/localization.json').catch(() => null);
    this._types = this.raw?.TYPES || {};
    this._compileItemTypes();
    this._compileCreators();
    this._compileFieldDefinitions();
    this._compileCSLMappings();
    this._compileExtraCreatorTypes();
    this._compileSequence();
    this._compileLocalization();
  }

  getExtraCreatorTypes() {
    return this._extraCreatorTypes.map((entry) => ({ ...entry }));
  }

  getCreatorKeysForItemType(itemTypeName) {
    const key = String(itemTypeName || '').trim();
    const direct = this._creatorsByItemType.get(key);
    if (direct) return Array.from(direct);

    const fallbackKey = this.getBaseItemType(key);
    return Array.from(this._creatorsByItemType.get(fallbackKey) || []);
  }

  getFieldDefinitionsForItemType(itemTypeName) {
    const key = String(itemTypeName || '').trim();
    const direct = this._fieldDefsByItemType.get(key);
    if (direct) return direct.map((entry) => ({ ...entry }));

    const fallbackKey = this.getBaseItemType(key);
    return (this._fieldDefsByItemType.get(fallbackKey) || []).map((entry) => ({ ...entry }));
  }

  getFieldDefinition(itemTypeName, fieldName) {
    const key = String(itemTypeName || '').trim();
    const fieldKey = String(fieldName || '').trim();
    return this._fieldDefIndexByItemType.get(key)?.get(fieldKey)
      || this._fieldDefIndexByItemType.get(this.getBaseItemType(key))?.get(fieldKey)
      || null;
  }

  getAllFieldNames() {
    return Array.from(this._allFieldNames.values()).sort((a, b) => a.localeCompare(b));
  }

  getLocalizedFieldLabel(fieldName, rawLocale = null) {
    const key = String(fieldName || '').trim();
    if (!key) return '';

    const localized = this._lookupLocalizedEntry(this._localizedFieldsByLocale, key, rawLocale);
    if (localized) return localized;

    if (/Flag$/.test(key)) {
      return humanizeKey(key.replace(/Flag$/, ''));
    }
    return humanizeKey(key);
  }

  getLocalizedCreatorLabel(creatorType, rawLocale = null) {
    const key = String(creatorType || '').trim();
    if (!key) return '';
    return this._lookupLocalizedEntry(this._localizedCreatorsByLocale, key, rawLocale) || humanizeKey(key);
  }

  getLocalizedItemTypeLabel(itemTypeName, rawLocale = null) {
    const key = String(itemTypeName || '').trim();
    if (!key) return '';
    return this._lookupLocalizedEntry(this._localizedItemTypesByLocale, key, rawLocale) || humanizeKey(key);
  }

  getKnownItemTypeNames() {
    return Array.from(this._knownItemTypes.values()).sort((a, b) => a.localeCompare(b));
  }

  getItemTypeDefinition(itemTypeName) {
    const key = String(itemTypeName || '').trim();
    if (!key) return null;

    const definition = this._types?.[key] || null;
    return {
      itemType: key,
      zotero: String(definition?.zotero || key).trim(),
      csl: String(definition?.csl || key).trim(),
      custom: !!definition,
    };
  }

  getBaseItemType(itemTypeName) {
    return this.getItemTypeDefinition(itemTypeName)?.zotero || '';
  }

  getCSLTypeForItemType(itemTypeName) {
    return this.getItemTypeDefinition(itemTypeName)?.csl || '';
  }

  isCustomItemType(itemTypeName) {
    const key = String(itemTypeName || '').trim();
    return !!key && Object.prototype.hasOwnProperty.call(this._types || {}, key);
  }

  getCustomTypesForBaseItemType(baseItemTypeName) {
    const key = String(baseItemTypeName || '').trim();
    return [...(this._customTypesByBaseItemType.get(key) || [])];
  }

  getCustomItemTypeOptions(rawLocale = null) {
    const locale = rawLocale || null;
    const out = [];
    for (const schemaItemType of this.getKnownItemTypeNames()) {
      if (!this.isCustomItemType(schemaItemType)) continue;
      out.push({
        itemType: schemaItemType,
        baseItemType: this.getBaseItemType(schemaItemType),
        cslType: this.getCSLTypeForItemType(schemaItemType),
        label: this.getLocalizedItemTypeLabel(schemaItemType, locale),
      });
    }
    return out;
  }

  getCSLFieldMappings() {
    return Array.from(this._cslFieldSources.entries()).map(([cslField, fields]) => ({
      cslField,
      fields: [...fields],
    }));
  }

  getCSLDateMappings() {
    return Array.from(this._cslDateSources.entries()).map(([cslField, fields]) => ({
      cslField,
      fields: [...fields],
    }));
  }

  getSequenceForItemType(itemTypeName) {
    const key = String(itemTypeName || '').trim();
    const direct = this._sequenceByItemType.get(key);
    if (direct) return [...direct];

    return [...(this._sequenceByItemType.get(this.getBaseItemType(key)) || [])];
  }

  _compileItemTypes() {
    this._knownItemTypes.clear();
    this._customTypesByBaseItemType.clear();

    for (const entry of Array.isArray(this.localizationRaw?.itemTypes) ? this.localizationRaw.itemTypes : []) {
      const normalized = this._normalizeItemTypeKey(entry?.itemType);
      if (normalized) this._knownItemTypes.add(normalized);
    }

    for (const schemaItemType of Object.keys(this._types || {})) {
      const normalized = this._normalizeItemTypeKey(schemaItemType);
      if (!normalized) continue;
      this._knownItemTypes.add(normalized);

      const baseItemType = this.getBaseItemType(normalized);
      if (!baseItemType || baseItemType === normalized) continue;
      if (!this._customTypesByBaseItemType.has(baseItemType)) {
        this._customTypesByBaseItemType.set(baseItemType, []);
      }
      const bucket = this._customTypesByBaseItemType.get(baseItemType);
      if (!bucket.includes(normalized)) bucket.push(normalized);
    }
  }

  _compileCreators() {
    const creators = this.raw?.CREATORS || {};
    for (const [schemaItemType, creatorList] of Object.entries(creators)) {
      const itemTypeName = this._normalizeItemTypeKey(schemaItemType);
      if (!itemTypeName) continue;
      if (!this._creatorsByItemType.has(itemTypeName)) {
        this._creatorsByItemType.set(itemTypeName, new Set());
      }
      const bucket = this._creatorsByItemType.get(itemTypeName);
      for (const creatorKey of Array.isArray(creatorList) ? creatorList : []) {
        const normalized = String(creatorKey || '').trim();
        if (normalized) bucket.add(normalized);
      }
    }
  }

  _compileFieldDefinitions() {
    const addDefinition = (schemaItemType, definition, kind) => {
      const itemTypeName = this._normalizeItemTypeKey(schemaItemType);
      if (!itemTypeName) return;

      const field = String(definition?.field || definition || '').trim();
      if (!field) return;

      if (!this._fieldDefsByItemType.has(itemTypeName)) {
        this._fieldDefsByItemType.set(itemTypeName, []);
        this._fieldDefIndexByItemType.set(itemTypeName, new Map());
      }

      const index = this._fieldDefIndexByItemType.get(itemTypeName);
      if (index.has(field)) return;

      const entry = {
        field,
        baseField: String(definition?.baseField || '').trim() || null,
        kind,
      };

      this._fieldDefsByItemType.get(itemTypeName).push(entry);
      index.set(field, entry);
      this._allFieldNames.add(field);
    };

    for (const [schemaItemType, fieldList] of Object.entries(this.raw?.FIELDS || {})) {
      for (const definition of Array.isArray(fieldList) ? fieldList : []) {
        addDefinition(schemaItemType, definition, 'field');
      }
    }

    for (const [schemaItemType, fieldList] of Object.entries(this.raw?.DATES || {})) {
      for (const fieldName of Array.isArray(fieldList) ? fieldList : []) {
        addDefinition(schemaItemType, { field: fieldName }, 'date');
      }
    }
  }

  _compileCSLMappings() {
    for (const [cslField, fields] of Object.entries(this.raw?.CSL_FIELDS || {})) {
      const normalizedField = String(cslField || '').trim();
      if (!normalizedField) continue;
      this._cslFieldSources.set(
        normalizedField,
        (Array.isArray(fields) ? fields : [])
          .map((field) => String(field || '').trim())
          .filter(Boolean),
      );
    }

    for (const [cslField, fields] of Object.entries(this.raw?.CSL_DATES || {})) {
      const normalizedField = String(cslField || '').trim();
      if (!normalizedField) continue;
      this._cslDateSources.set(
        normalizedField,
        (Array.isArray(fields) ? fields : [])
          .map((field) => String(field || '').trim())
          .filter(Boolean),
      );
    }
  }

  _compileExtraCreatorTypes() {
    const allKeys = new Set();
    for (const creatorKeys of this._creatorsByItemType.values()) {
      for (const creatorKey of creatorKeys) allKeys.add(creatorKey);
    }

    let nextID = 9001;
    this._extraCreatorTypes = Array.from(allKeys).sort().map((key) => {
      const label = humanizeKey(key);
      const normalizedKey = String(key).trim();
      return {
        key: normalizedKey,
        creatorTypeID: String(nextID++),
        creatorTypeName: `ibcslm-${toKebabCase(normalizedKey)}`,
        label,
        storage: 'creator',
        mlzType: normalizedKey,
        cslField: toKebabCase(normalizedKey),
      };
    });
  }

  _compileSequence() {
    for (const [schemaItemType, sequence] of Object.entries(this.raw?.SEQUENCE || {})) {
      const itemTypeName = this._normalizeItemTypeKey(schemaItemType);
      if (!itemTypeName) continue;
      if (!this._sequenceByItemType.has(itemTypeName)) {
        this._sequenceByItemType.set(itemTypeName, []);
      }
      const target = this._sequenceByItemType.get(itemTypeName);
      for (const fieldName of Array.isArray(sequence) ? sequence : []) {
        const normalized = String(fieldName || '').trim();
        if (normalized && !target.includes(normalized)) {
          target.push(normalized);
        }
      }
    }
  }

  _compileLocalization() {
    this._localizedFieldsByLocale.clear();
    this._localizedCreatorsByLocale.clear();
    this._localizedItemTypesByLocale.clear();

    const localeSources = [
      this.raw?.locales || {},
      this.localizationRaw?.locales || {},
    ];
    const allLocales = new Set();
    for (const source of localeSources) {
      for (const locale of Object.keys(source || {})) {
        const normalizedLocale = String(locale || '').trim().toLowerCase();
        if (normalizedLocale) allLocales.add(normalizedLocale);
      }
    }

    for (const normalizedLocale of allLocales) {
      const schemaPayload = this._getLocalePayload(this.raw?.locales, normalizedLocale);
      const localizationPayload = this._getLocalePayload(this.localizationRaw?.locales, normalizedLocale);

      const fields = this._mergeLocalizationBuckets(
        schemaPayload?.fields,
        localizationPayload?.fields,
      );
      const creatorTypes = this._mergeLocalizationBuckets(
        schemaPayload?.creatorTypes,
        localizationPayload?.creatorTypes,
      );
      const itemTypes = this._mergeLocalizationBuckets(
        schemaPayload?.itemTypes,
        localizationPayload?.itemTypes,
      );

      this._localizedFieldsByLocale.set(normalizedLocale, fields);
      this._localizedCreatorsByLocale.set(normalizedLocale, creatorTypes);
      this._localizedItemTypesByLocale.set(normalizedLocale, itemTypes);
    }
  }

  _mergeLocalizationBuckets(...sources) {
    const out = new Map();
    for (const source of sources) {
      for (const [key, value] of Object.entries(source || {})) {
        const normalizedKey = String(key || '').trim();
        const normalizedValue = String(value || '').trim();
        if (normalizedKey && normalizedValue) {
          out.set(normalizedKey, normalizedValue);
        }
      }
    }
    return out;
  }

  _normalizeLocalizationBucket(source) {
    const out = new Map();
    for (const [key, value] of Object.entries(source || {})) {
      const normalizedKey = String(key || '').trim();
      const normalizedValue = String(value || '').trim();
      if (normalizedKey && normalizedValue) {
        out.set(normalizedKey, normalizedValue);
      }
    }
    return out;
  }

  _getLocalePayload(source, normalizedLocale) {
    const target = String(normalizedLocale || '').trim().toLowerCase();
    if (!target || !source || typeof source !== 'object') return null;

    for (const [key, payload] of Object.entries(source)) {
      const normalizedKey = String(key || '').trim().replace(/_/g, '-').toLowerCase();
      if (normalizedKey === target) {
        return payload || null;
      }
    }

    return null;
  }

  _lookupLocalizedEntry(store, key, rawLocale = null) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return '';

    const candidates = this._getLocalizationLocaleCandidates(rawLocale);
    for (const locale of candidates) {
      const bucket = store.get(locale);
      const value = bucket?.get(normalizedKey);
      if (value) return value;
    }

    return '';
  }

  _getLocalizationLocaleCandidates(rawLocale) {
    const candidates = [];
    const push = (value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized && !candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    };

    for (const candidate of getLocaleCandidates(rawLocale)) {
      push(candidate);
      if (candidate === 'us') {
        push('en-us');
        push('en');
      }
    }

    push('en-us');
    push('en');
    return candidates;
  }

  _normalizeItemTypeKey(itemTypeName) {
    return String(itemTypeName || '').trim();
  }
}
