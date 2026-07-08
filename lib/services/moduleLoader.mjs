import { Jurisdiction } from './jurisdiction.mjs';

export class ModuleLoader {
  constructor({ rootURI, dataStore, locale }) {
    this.rootURI = rootURI;
    this.dataStore = dataStore;
    this.locale = locale;
    this._defaultJurisdiction = 'us';
    this._availableFiles = [];
    this._byFile = new Map();
    this._byJur = new Map();
    this._byModuleID = new Map();
  }

  async preload() {
    const idx = await this.dataStore.loadJSON('style-modules/index.json');
    const allFiles = Array.isArray(idx?.files) ? idx.files.slice() : [];
    this._availableFiles = allFiles
      .filter((file) => /\.csl$/i.test(file) && file.toLowerCase().startsWith('juris-'))
      .sort((a, b) => a.localeCompare(b));

    // Load all module XML now so sys.loadJurisdictionStyle can stay sync.
    for (const file of this._availableFiles) {
      const path = 'style-modules/' + file;
      const xml = await this.dataStore.loadText(path);
      this._byFile.set(file, xml);
      const info = this._parseModuleFilename(file);
      if (!info) continue;

      this._byModuleID.set(info.id, xml);

      let byVariant = this._byJur.get(info.jurisdiction);
      if (!byVariant) {
        byVariant = new Map();
        this._byJur.set(info.jurisdiction, byVariant);
      }
      byVariant.set(info.variant, xml);
    }

    if (!this._hasModuleForJurisdiction(this._defaultJurisdiction) && this._availableFiles.length) {
      const firstInfo = this._parseModuleFilename(this._availableFiles[0]);
      const firstRoot = firstInfo?.jurisdiction?.split(':')[0] || '';
      if (firstRoot && this._hasModuleForJurisdiction(firstRoot)) {
        this._defaultJurisdiction = firstRoot;
      }
    }
  }

  _parseModuleFilename(file) {
    const stem = String(file || '').replace(/\.csl$/i, '');
    if (!stem.toLowerCase().startsWith('juris-')) return null;

    const body = stem.slice(6);
    if (!body) return null;

    const dashIdx = body.indexOf('-');
    const jurisdictionPart = dashIdx === -1 ? body : body.slice(0, dashIdx);
    const variantPart = dashIdx === -1 ? '' : body.slice(dashIdx + 1);
    if (!jurisdictionPart) return null;

    return {
      fileName: file,
      id: stem,
      jurisdiction: jurisdictionPart.toLowerCase().replace(/\+/g, ':'),
      variant: variantPart.toLowerCase(),
    };
  }

  _hasModuleForJurisdiction(jurisdiction) {
    return this._byJur.has(String(jurisdiction || '').toLowerCase());
  }

  hasJurisdiction(jur) {
    return this._hasModuleForJurisdiction(jur);
  }

  _normalizeVariantName(variantName) {
    return String(variantName || '').trim().toLowerCase();
  }

  _getJurisdictionVariantMap(jurisdiction) {
    return this._byJur.get(String(jurisdiction || '').toLowerCase()) || null;
  }

  _getModuleForJurisdiction(jurisdiction, variantName = '') {
    const byVariant = this._getJurisdictionVariantMap(jurisdiction);
    if (!byVariant) return null;

    const variant = this._normalizeVariantName(variantName);
    if (variant && byVariant.has(variant)) {
      return byVariant.get(variant);
    }
    if (byVariant.has('')) {
      return byVariant.get('');
    }
    if (!variant && byVariant.size) {
      return byVariant.values().next().value || null;
    }
    return null;
  }

  loadJurisdictionStyleSync(jurisdiction, variantName='IndigoTemp') {
    const variant = this._normalizeVariantName(variantName);
    const jur = String(jurisdiction || this._defaultJurisdiction || 'us').trim().toLowerCase() || 'us';
    const chain = Jurisdiction.trimChain(jur);

    // Juris-M prefers the requested variant across the whole chain before
    // falling back to plain modules for the same jurisdictions.
    if (variant) {
      for (const j of chain) {
        const byVariant = this._getJurisdictionVariantMap(j);
        if (byVariant?.has(variant)) {
          return byVariant.get(variant);
        }
      }
    }

    for (const j of chain) {
      const xml = this._getModuleForJurisdiction(j, '');
      if (xml) return xml;
    }

    return this._getModuleForJurisdiction(this._defaultJurisdiction, variant) || null;
  }
}
