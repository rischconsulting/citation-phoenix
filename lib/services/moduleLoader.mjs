import { Jurisdiction } from './jurisdiction.mjs';
import { selectLocaleFiles } from './locale.mjs';

export class ModuleLoader {
  constructor({ rootURI, dataStore, locale }) {
    this.rootURI = rootURI;
    this.dataStore = dataStore;
    this.locale = locale;
    this._defaultJurisdiction = 'us';
    this._availableFiles = [];
    this._byFile = new Map();
    this._byJur = new Map();
  }

  async preload() {
    const idx = await this.dataStore.loadJSON('style-modules/index.json');
    const allFiles = Array.isArray(idx?.files) ? idx.files : [];
    this._availableFiles = selectLocaleFiles(allFiles, 'juris', this.locale, '.csl');
    if (!this._availableFiles.length) {
      this._availableFiles = allFiles
        .filter((file) => /\.csl$/i.test(file) && file.toLowerCase().startsWith('juris-'))
        .sort((a, b) => a.localeCompare(b));
    }
    if (!this._availableFiles.length) {
      this._availableFiles = allFiles.filter((file) => /\.csl$/i.test(file)).sort((a, b) => a.localeCompare(b));
    }

    // Load all module XML now so sys.loadJurisdictionStyle can be sync
    for (const file of this._availableFiles) {
      const path = 'style-modules/' + file;
      const xml = await this.dataStore.loadText(path);
      this._byFile.set(file, xml);
      const jur = this._jurFromFilename(file);
      if (jur) this._byJur.set(jur, xml);
    }

    this._defaultJurisdiction = this._availableFiles.length
      ? ((this._jurFromFilename(this._availableFiles[0]) || this._defaultJurisdiction).split(':')[0] || this._defaultJurisdiction)
      : this._defaultJurisdiction;

    // Ensure base module exists
    if (!this._byJur.has(this._defaultJurisdiction)) {
      // Try default base file
      const baseFile = this._availableFiles.find((f) => {
        const jur = this._jurFromFilename(f);
        if (!jur) return false;
        return jur.split(':')[0] === this._defaultJurisdiction && !jur.includes(':');
      }) || this._availableFiles.find((f) => {
        const jur = this._jurFromFilename(f);
        return jur && jur.split(':')[0] === this._defaultJurisdiction;
      });
      if (baseFile) this._byJur.set(this._defaultJurisdiction, this._byFile.get(baseFile));
    }
  }

  _jurFromFilename(file) {
    const stem = String(file || '').replace(/\.csl$/i, '');
    if (!stem.toLowerCase().startsWith('juris-')) return null;

    const jurisdiction = stem.slice(6).split('-')[0];
    if (!jurisdiction) return null;

    return jurisdiction.toLowerCase().replace(/\+/g, ':');
  }

  hasJurisdiction(jur) {
    return this._byJur.has((jur || '').toLowerCase());
  }

  loadJurisdictionStyleSync(jurisdiction, variantName='IndigoTemp') {
    const variant = variantName || 'IndigoTemp';
    if (variant !== 'IndigoTemp') return null;

    let jur = (jurisdiction || this._defaultJurisdiction || 'us').toLowerCase();

    // circuits have no dedicated module in your set
    if (Jurisdiction.isCircuit(jur)) return this._byJur.get(this._defaultJurisdiction) || null;

    // Walk down chain: us:ny:nyc -> us:ny -> us
    for (const j of Jurisdiction.trimChain(jur)) {
      if (this._byJur.has(j)) return this._byJur.get(j);
      // Also try state token module if j is us:ny:...
      // (our map key already supports us:ny)
    }
    return this._byJur.get(this._defaultJurisdiction) || null;
  }
}
