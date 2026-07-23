export class Jurisdiction {
  static fromItem(item) {
    const extra = (item.getField?.('extra') || item.extra || '') + '';
    const jur = this._fromMLZ(extra) || this._fromKeyValue(extra);
    if (!jur) return '';
    return this._normalizeJurisdiction(jur);
  }

  static getMLZExtraFields(itemOrExtra) {
    const extra = typeof itemOrExtra === 'string'
      ? itemOrExtra
      : (itemOrExtra?.getField?.('extra') || itemOrExtra?.extra || '');
    const jsonText = this._extractMLZJSON(extra);
    if (!jsonText) return null;
    try {
      const obj = JSON.parse(jsonText);
      return this._getMLZFieldObject(obj);
    } catch (e) {
      return null;
    }
  }

  static getMLZExtraCreators(itemOrExtra) {
    const extra = typeof itemOrExtra === 'string'
      ? itemOrExtra
      : (itemOrExtra?.getField?.('extra') || itemOrExtra?.extra || '');
    const jsonText = this._extractMLZJSON(extra);
    if (!jsonText) return [];
    try {
      const obj = JSON.parse(jsonText);
      return Array.isArray(obj?.extracreators) ? obj.extracreators : [];
    } catch (e) {
      return [];
    }
  }

  static getMLZExtraCreatorsByType(itemOrExtra, creatorType) {
    const normalizedType = String(creatorType || '').trim().toLowerCase();
    if (!normalizedType) return [];
    return this.getMLZExtraCreators(itemOrExtra)
      .filter((creator) => String(creator?.creatorType || '').trim().toLowerCase() === normalizedType)
      .map((creator) => ({ ...creator }));
  }

  static updateMLZExtraCreators(itemOrExtra, creatorType, creators) {
    const extra = typeof itemOrExtra === 'string'
      ? itemOrExtra
      : (itemOrExtra?.getField?.('extra') || itemOrExtra?.extra || '');
    const normalizedType = String(creatorType || '').trim().toLowerCase();
    if (!normalizedType) return extra;

    const parsed = this._getMLZPayloadAndRange(extra);
    const payload = parsed.payload || {};
    const existingCreators = Array.isArray(payload.extracreators) ? payload.extracreators : [];
    const retainedCreators = existingCreators.filter((creator) => {
      return String(creator?.creatorType || '').trim().toLowerCase() !== normalizedType;
    });

    const incomingCreators = Array.isArray(creators) ? creators : [];
    for (const creator of incomingCreators) {
      const normalizedCreator = this._normalizeExtraCreator(creator, normalizedType);
      if (normalizedCreator) retainedCreators.push(normalizedCreator);
    }

    if (retainedCreators.length) payload.extracreators = retainedCreators;
    else delete payload.extracreators;

    const hasExtraFields = this._hasMLZFields(payload);
    const hasExtraCreators = Array.isArray(payload.extracreators) && payload.extracreators.length;
    if (!hasExtraFields && !hasExtraCreators) {
      if (parsed.start != null && parsed.end != null) {
        return this._removeMLZBlock(extra, parsed.start, parsed.end);
      }
      return extra;
    }

    const mlzBlock = `mlzsync1:${JSON.stringify(payload)}`;
    if (parsed.start != null && parsed.end != null) {
      return `${extra.slice(0, parsed.start)}${mlzBlock}${extra.slice(parsed.end)}`;
    }

    const base = String(extra || '').trimEnd();
    return base ? `${base}\n${mlzBlock}` : mlzBlock;
  }

  static getMLZJurisdiction(itemOrExtra) {
    const fields = this.getMLZExtraFields(itemOrExtra);
    const value = fields?.jurisdiction;
    if (!value) return '';
    return this._normalizeJurisdiction(this._decodeLengthPrefixedJurisdiction(String(value)) || '');
  }

  static getMLZItemType(itemOrExtra) {
    const extra = typeof itemOrExtra === 'string'
      ? itemOrExtra
      : (itemOrExtra?.getField?.('extra') || itemOrExtra?.extra || '');
    const payload = this._getMLZPayloadAndRange(extra).payload || null;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';

    const nestedFields = (payload.extrafields && typeof payload.extrafields === 'object' && !Array.isArray(payload.extrafields))
      ? payload.extrafields
      : null;

    return String(
      payload.xtype
      || payload.itemType
      || nestedFields?.xtype
      || nestedFields?.itemType
      || '',
    ).trim();
  }

  static updateMLZJurisdiction(itemOrExtra, jurisdiction, displayValue = '') {
    const normalized = this._normalizeJurisdiction(jurisdiction || '');
    const encoded = normalized ? this._encodeLengthPrefixedJurisdiction(normalized, displayValue) : '';
    return this.updateMLZExtraField(itemOrExtra, 'jurisdiction', encoded);
  }

  static updateMLZItemType(itemOrExtra, itemType) {
    const extra = typeof itemOrExtra === 'string'
      ? itemOrExtra
      : (itemOrExtra?.getField?.('extra') || itemOrExtra?.extra || '');
    const parsed = this._getMLZPayloadAndRange(extra);
    const payload = parsed.payload || {};
    const value = String(itemType || '').trim();

    if (value) payload.xtype = value;
    else delete payload.xtype;
    delete payload.itemType;

    if (payload.extrafields && typeof payload.extrafields === 'object' && !Array.isArray(payload.extrafields)) {
      delete payload.extrafields.xtype;
      delete payload.extrafields.itemType;
      if (!Object.keys(payload.extrafields).length) {
        delete payload.extrafields;
      }
    }

    const hasExtraFields = this._hasMLZFields(payload);
    const hasExtraCreators = Array.isArray(payload.extracreators) && payload.extracreators.length;
    const hasControlSections = this._hasMLZControlSections(payload);
    if (!hasExtraFields && !hasExtraCreators && !hasControlSections) {
      if (parsed.start != null && parsed.end != null) {
        return this._removeMLZBlock(extra, parsed.start, parsed.end);
      }
      return extra;
    }

    const mlzBlock = `mlzsync1:${JSON.stringify(payload)}`;
    if (parsed.start != null && parsed.end != null) {
      return `${extra.slice(0, parsed.start)}${mlzBlock}${extra.slice(parsed.end)}`;
    }

    const base = String(extra || '').trimEnd();
    return base ? `${base}\n${mlzBlock}` : mlzBlock;
  }

  static updateMLZExtraField(itemOrExtra, fieldName, fieldValue) {
    const extra = typeof itemOrExtra === 'string'
      ? itemOrExtra
      : (itemOrExtra?.getField?.('extra') || itemOrExtra?.extra || '');

    const field = (fieldName || '').toString().trim();
    if (!field) return extra;

    const parsed = this._getMLZPayloadAndRange(extra);
    if (!parsed.payload && (fieldValue == null || String(fieldValue).trim() === '')) {
      return extra;
    }

    const payload = parsed.payload || {};
    const targetFields = this._ensureMLZFieldObject(payload);

    const value = fieldValue == null ? '' : String(fieldValue).trim();
    if (value) {
      targetFields[field] = value;
      if (targetFields !== payload) delete payload[field];
    } else {
      delete targetFields[field];
      if (payload.extrafields && typeof payload.extrafields === 'object' && !Array.isArray(payload.extrafields)) {
        delete payload.extrafields[field];
      }
      delete payload[field];
    }

    this._cleanupEmptyMLZFieldObject(payload);

    const hasExtraFields = this._hasMLZFields(payload);
    const hasExtraCreators = Array.isArray(payload.extracreators) && payload.extracreators.length;
    const hasControlSections = this._hasMLZControlSections(payload);
    if (!hasExtraFields && !hasExtraCreators && !hasControlSections) {
      if (parsed.start != null && parsed.end != null) {
        return this._removeMLZBlock(extra, parsed.start, parsed.end);
      }
      return extra;
    }

    const mlzBlock = `mlzsync1:${JSON.stringify(payload)}`;
    if (parsed.start != null && parsed.end != null) {
      return `${extra.slice(0, parsed.start)}${mlzBlock}${extra.slice(parsed.end)}`;
    }

    const base = String(extra || '').trimEnd();
    return base ? `${base}\n${mlzBlock}` : mlzBlock;
  }

  static _fromMLZ(extra) {
    const fields = this.getMLZExtraFields(extra);
    const j = fields?.jurisdiction;
    if (!j) return null;
    return this._decodeLengthPrefixedJurisdiction(j);
  }

  static _extractMLZJSON(extra) {
    return this._getMLZPayloadAndRange(extra).jsonText || null;
  }

  static _getMLZPayloadAndRange(extra) {
    const source = String(extra || '');
    const marker = 'mlzsync1:';
    const markerIndex = source.indexOf(marker);
    if (markerIndex === -1) {
      return { payload: null, start: null, end: null };
    }

    const braceStart = this._findMLZPayloadBraceStart(source, markerIndex + marker.length);
    if (braceStart == null) {
      return { payload: null, start: null, end: null };
    }

    let depth = 0;
    let inString = false;
    let escaping = false;

    for (let i = braceStart; i < source.length; i += 1) {
      const ch = source[i];
      if (inString) {
        if (escaping) escaping = false;
        else if (ch === '\\') escaping = true;
        else if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth += 1;
        continue;
      }
      if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          const jsonText = source.slice(braceStart, i + 1);
          try {
            return {
              payload: JSON.parse(jsonText),
              start: markerIndex,
              end: i + 1,
              jsonText,
            };
          } catch (e) {
            return {
              payload: null,
              start: markerIndex,
              end: i + 1,
              jsonText,
            };
          }
        }
      }
    }

    return { payload: null, start: markerIndex, end: source.length, jsonText: null };
  }

  static _findMLZPayloadBraceStart(source, searchStart = 0) {
    const text = String(source || '');
    let idx = Math.max(0, Number(searchStart) || 0);

    while (idx < text.length) {
      const ch = text[idx];
      if (ch === '{') return idx;
      if (/\s/.test(ch) || /\d/.test(ch)) {
        idx += 1;
        continue;
      }
      return null;
    }

    return null;
  }

  static _removeMLZBlock(extra, start, end) {
    const source = String(extra || '');
    const prefix = source.slice(0, start).replace(/[ \t]+\n?$/, '');
    const suffix = source.slice(end).replace(/^\r?\n/, '');
    const combined = `${prefix}${prefix && suffix ? '\n' : ''}${suffix}`;
    return combined.trimEnd();
  }

  static _getMLZFieldObject(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
    const topLevelFields = Object.fromEntries(
      Object.entries(payload).filter(([key]) => !this._getMLZControlKeys().includes(key)),
    );

    if (payload.extrafields && typeof payload.extrafields === 'object' && !Array.isArray(payload.extrafields)) {
      return {
        ...topLevelFields,
        ...payload.extrafields,
      };
    }

    if (!Object.keys(topLevelFields).length) return null;
    return topLevelFields;
  }

  static _ensureMLZFieldObject(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return {};
    }
    if (payload.extrafields && typeof payload.extrafields === 'object' && !Array.isArray(payload.extrafields)) {
      return payload.extrafields;
    }
    if (this._hasMLZControlSections(payload)) {
      if (!payload.extrafields || typeof payload.extrafields !== 'object' || Array.isArray(payload.extrafields)) {
        payload.extrafields = {};
      }
      return payload.extrafields;
    }
    return payload;
  }

  static _cleanupEmptyMLZFieldObject(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    if (payload.extrafields && typeof payload.extrafields === 'object' && !Array.isArray(payload.extrafields)
      && !Object.keys(payload.extrafields).length) {
      delete payload.extrafields;
    }
  }

  static _hasMLZFields(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const fields = this._getMLZFieldObject(payload);
    return !!fields && Object.keys(fields).length > 0;
  }

  static _hasMLZControlSections(payload) {
    return this._getMLZControlKeys().some((key) => key in payload);
  }

  static _getMLZControlKeys() {
    return ['extracreators', 'extrafields', 'multifields', 'multicreators', 'xtype', 'itemType'];
  }

  static _normalizeExtraCreator(creator, creatorType) {
    if (!creator || typeof creator !== 'object') return null;

    const literalName = String(creator.name || '').trim();
    if (literalName) {
      return {
        name: literalName,
        creatorType,
      };
    }

    const firstName = String(creator.firstName || '').trim();
    const lastName = String(creator.lastName || '').trim();
    if (!firstName && !lastName) return null;

    return {
      firstName,
      lastName,
      creatorType,
    };
  }

  static _decodeLengthPrefixedJurisdiction(s) {
    if (!s || s.length < 4) return null;
    const prefix = s.slice(0, 3);
    if (!/^\d{3}$/.test(prefix)) return s;
    const len = parseInt(prefix, 10);
    const code = s.slice(3, 3 + len);
    return code || null;
  }

  static _encodeLengthPrefixedJurisdiction(value, displayValue = '') {
    const jurisdiction = (value || '').toString().trim();
    if (!jurisdiction) return '';
    const display = (displayValue || '').toString().trim();
    return `${String(jurisdiction.length).padStart(3, '0')}${jurisdiction}${display}`;
  }

  static _fromKeyValue(extra) {
    const m = extra.match(/^\s*jurisdiction\s*:\s*([^\n\r]+?)\s*$/im);
    return m ? m[1] : null;
  }

  static _normalizeJurisdiction(jur) {
    let value = (jur || '').toString().trim().toLowerCase();
    if (!value) return '';

    const stateInfoByName = {
      alabama: { code: 'al', circuit: '11' },
      alaska: { code: 'ak', circuit: '9' },
      arizona: { code: 'az', circuit: '9' },
      arkansas: { code: 'ar', circuit: '8' },
      california: { code: 'ca', circuit: '9' },
      colorado: { code: 'co', circuit: '10' },
      connecticut: { code: 'ct', circuit: '2' },
      delaware: { code: 'de', circuit: '3' },
      districtofcolumbia: { code: 'dc', circuit: '0' },
      dc: { code: 'dc', circuit: '0' },
      florida: { code: 'fl', circuit: '11' },
      georgia: { code: 'ga', circuit: '11' },
      hawaii: { code: 'hi', circuit: '9' },
      idaho: { code: 'id', circuit: '9' },
      illinois: { code: 'il', circuit: '7' },
      indiana: { code: 'in', circuit: '7' },
      iowa: { code: 'ia', circuit: '8' },
      kansas: { code: 'ks', circuit: '10' },
      kentucky: { code: 'ky', circuit: '6' },
      louisiana: { code: 'la', circuit: '5' },
      maine: { code: 'me', circuit: '1' },
      maryland: { code: 'md', circuit: '4' },
      massachusetts: { code: 'ma', circuit: '1' },
      michigan: { code: 'mi', circuit: '6' },
      minnesota: { code: 'mn', circuit: '8' },
      mississippi: { code: 'ms', circuit: '5' },
      missouri: { code: 'mo', circuit: '8' },
      montana: { code: 'mt', circuit: '9' },
      nebraska: { code: 'ne', circuit: '8' },
      nevada: { code: 'nv', circuit: '9' },
      newhampshire: { code: 'nh', circuit: '1' },
      newjersey: { code: 'nj', circuit: '3' },
      newmexico: { code: 'nm', circuit: '10' },
      newyork: { code: 'ny', circuit: '2' },
      northcarolina: { code: 'nc', circuit: '4' },
      northdakota: { code: 'nd', circuit: '8' },
      ohio: { code: 'oh', circuit: '6' },
      oklahoma: { code: 'ok', circuit: '10' },
      oregon: { code: 'or', circuit: '9' },
      pennsylvania: { code: 'pa', circuit: '3' },
      puertorico: { code: 'pr', circuit: '1' },
      rhodeisland: { code: 'ri', circuit: '1' },
      southcarolina: { code: 'sc', circuit: '4' },
      southdakota: { code: 'sd', circuit: '8' },
      tennessee: { code: 'tn', circuit: '6' },
      texas: { code: 'tx', circuit: '5' },
      utah: { code: 'ut', circuit: '10' },
      vermont: { code: 'vt', circuit: '2' },
      virginia: { code: 'va', circuit: '4' },
      washington: { code: 'wa', circuit: '9' },
      westvirginia: { code: 'wv', circuit: '4' },
      wisconsin: { code: 'wi', circuit: '7' },
      wyoming: { code: 'wy', circuit: '10' },
      guam: { code: 'gu', circuit: '9' },
      usvirginislands: { code: 'vi', circuit: '3' },
      virginislands: { code: 'vi', circuit: '3' },
      northernmarianaislands: { code: 'mp', circuit: '9' },
    };

    // Preserve already-normalized jurisdiction chains.
    if (/^us(?::[a-z0-9._-]+)*$/.test(value)) return value;

    // Handle district-court shorthand text from translators (e.g., "D. Delaware", "SD Ohio").
    const districtMatch = value.match(/^([nsewmc])?\s*\.?\s*d\.?\s+(.+)$/i);
    if (districtMatch) {
      const districtPart = districtMatch[1] ? `${String(districtMatch[1]).toLowerCase()}d` : 'd';
      const stateCompact = String(districtMatch[2] || '').replace(/[^a-z]/g, '');
      const state = stateInfoByName[stateCompact];
      if (state?.code) {
        if (state.code === 'dc') return 'us:dc.d';
        if (state.circuit) return `us:c${state.circuit}:${state.code}.${districtPart}`;
        return `us:${state.code}.${districtPart}`;
      }
    }

    // Handle circuit text forms that translators may put in Extra.
    const compact = value.replace(/[^a-z0-9]/g, '');
    if (compact === 'federalcircuit' || compact === 'fedcir' || compact === 'cafc') return 'us:c';
    if (compact === 'dccircuit' || compact === 'districtofcolumbiacircuit' || compact === 'dccir') return 'us:c0';

    const ordinals = {
      first: '1',
      second: '2',
      third: '3',
      fourth: '4',
      fifth: '5',
      sixth: '6',
      seventh: '7',
      eighth: '8',
      ninth: '9',
      tenth: '10',
      eleventh: '11',
    };
    for (const [word, num] of Object.entries(ordinals)) {
      if (compact === `${word}circuit`) return `us:c${num}`;
    }
    const numbered = compact.match(/^(1|2|3|4|5|6|7|8|9|10|11)(st|nd|rd|th)?circuit$/);
    if (numbered) return `us:c${numbered[1]}`;

    // If a state name leaked through fallback parsing, map the common ones.
    const byName = {
      ohio: 'us:oh',
      california: 'us:ca',
      newyork: 'us:ny',
      texas: 'us:tx',
      florida: 'us:fl',
      illinois: 'us:il',
      pennsylvania: 'us:pa',
      virginia: 'us:va',
      massachusetts: 'us:ma',
      michigan: 'us:mi',
    };
    const compactAlpha = value.replace(/[^a-z]/g, '');
    if (stateInfoByName[compactAlpha]?.code) return `us:${stateInfoByName[compactAlpha].code}`;
    if (byName[compactAlpha]) return byName[compactAlpha];

    return value;
  }

  static isRecognizedJurisdiction(jur) {
    const normalized = this._normalizeJurisdiction(jur || '');
    if (!normalized) return false;

    if (/^us(?::[a-z0-9._-]+)*$/.test(normalized)) return true;

    const compact = normalized.replace(/[^a-z0-9]/g, '');
    const knownRoots = new Set([
      'au',
      'ca',
      'uk',
    ]);

    return knownRoots.has(compact);
  }

  static trimChain(jur) {
    const parts = (jur || 'us').toLowerCase().split(':');
    const chain = [];
    for (let i = parts.length; i >= 1; i--) chain.push(parts.slice(0, i).join(':'));
    return chain;
  }

  static isCircuit(jur) {
    const parts = (jur || '').toLowerCase().split(':');
    return parts[0] === 'us' && /^c\d+$/.test(parts[1] || '');
  }

  static topToken(jur) {
    const parts = (jur || '').toLowerCase().split(':');
    return parts[1] || null;
  }
}
