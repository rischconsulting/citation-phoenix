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
  }

  async preload() {
    this.raw = await this.dataStore.loadJSON('content/schema.json');
    this.localizationRaw = await this.dataStore.loadJSON('content/localization.json').catch(() => null);
    this._types = this.raw?.TYPES || {};
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
    return Array.from(this._creatorsByItemType.get(key) || []);
  }

  getFieldDefinitionsForItemType(itemTypeName) {
    const key = String(itemTypeName || '').trim();
    return (this._fieldDefsByItemType.get(key) || []).map((entry) => ({ ...entry }));
  }

  getFieldDefinition(itemTypeName, fieldName) {
    const key = String(itemTypeName || '').trim();
    const fieldKey = String(fieldName || '').trim();
    return this._fieldDefIndexByItemType.get(key)?.get(fieldKey) || null;
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
    return [...(this._sequenceByItemType.get(key) || [])];
  }

  _compileCreators() {
    const creators = this.raw?.CREATORS || {};
    for (const [schemaItemType, creatorList] of Object.entries(creators)) {
      const itemTypeName = this._resolveZoteroItemType(schemaItemType);
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
      const itemTypeName = this._resolveZoteroItemType(schemaItemType);
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
      const itemTypeName = this._resolveZoteroItemType(schemaItemType);
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

      this._localizedFieldsByLocale.set(normalizedLocale, fields);
      this._localizedCreatorsByLocale.set(normalizedLocale, creatorTypes);
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

  _resolveZoteroItemType(schemaItemType) {
    const key = String(schemaItemType || '').trim();
    if (!key) return '';
    const mapped = this._types?.[key]?.zotero;
    return String(mapped || key).trim();
  }
}
