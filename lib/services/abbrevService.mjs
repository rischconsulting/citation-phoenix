import { getLocaleCandidates, selectLocaleFiles } from './locale.mjs';

export class AbbrevService {
  constructor({ dataStore, locale }) {
    this.dataStore = dataStore;
    this.locale = locale;
    this._localeCandidates = getLocaleCandidates(locale);
    this._autoDatasets = new Map();
    this._autoDatasetsByRoot = new Map();
    this._autoDomainsByRoot = new Map();
    this._primaryDatasets = new Map();
    this._primaryDatasetsByRoot = new Map();
    this._mapDatasets = new Map();
    this._mapDatasetsByRoot = new Map();
    this._defaultAutoDataset = null;
    this._defaultPrimaryDataset = null;
    this._defaultMapDataset = null;
    this._autoUS = null;
    this._primaryUS = null;
    this._secondaryDatasets = {};
    this._secondaryDatasetOrder = [];
    this._secondaryDatasetMeta = new Map();
    this._defaultSecondaryDataset = 'secondary-us-bluebook';
    this._jurisUSMap = null;
    this._primaryJur = null;
    this._defaultJurisdiction = 'us';
    this._userSecondaryOverrides = {};
    this._secondaryOverridesPref = 'extensions.indigobook-cslm.secondaryContainerTitleOverrides';
    this._userJurisdictionOverrides = {};
    this._jurisdictionOverridesPref = 'extensions.indigobook-cslm.jurisdictionOverrides';
  }

  async preload() {
    const listing = await this.dataStore.loadJSON('juris-abbrevs/DIRECTORY_LISTING.json');
    const listingEntries = Array.isArray(listing) ? listing : [];
    const listingFiles = this._expandListingFiles(listingEntries);
    const fileNames = listingFiles.map((item) => item.filename);
    const fileMetaByName = new Map(listingFiles.map((item) => [item.filename, item.name]));
    const mapListing = await this.dataStore.loadJSONAny(['juris-maps/DIRECTORY_LISTING.json']);
    const mapListingEntries = Array.isArray(mapListing) ? mapListing : [];
    const mapFileMetaByName = new Map(
      mapListingEntries
        .map((item) => [String(item?.filename || '').trim(), String(item?.name || '').trim()])
        .filter(([filename]) => Boolean(filename)),
    );

    const autoFiles = fileNames.filter((file) => /^auto-.*\.json$/i.test(file));
    this._autoDatasets = await this._loadDatasetGroup('juris-abbrevs', autoFiles, fileMetaByName);
    this._autoDatasetsByRoot = this._groupDatasetsByRoot(this._autoDatasets);
    this._autoDomainsByRoot = this._groupDatasetDomainsByRoot(this._autoDatasets);
    this._defaultAutoDataset = this._pickLocaleDataset(Array.from(this._autoDatasets.keys()), 'auto') || null;
    this._autoUS = this._defaultAutoDataset ? this._autoDatasets.get(this._defaultAutoDataset)?.data || null : null;
    this._defaultJurisdiction = this._jurisdictionRootFromFilename(this._defaultAutoDataset) || this._defaultJurisdiction;

    const primaryFiles = fileNames.filter((file) => /^primary-.*\.json$/i.test(file));
    this._primaryDatasets = await this._loadDatasetGroup('juris-abbrevs', primaryFiles, fileMetaByName);
    this._primaryDatasetsByRoot = this._groupDatasetsByRoot(this._primaryDatasets);
    this._defaultPrimaryDataset = this._primaryDatasets.has('primary-us')
      ? 'primary-us'
      : (Array.from(this._primaryDatasets.keys())[0] || null);
    this._primaryUS = this._defaultPrimaryDataset ? this._primaryDatasets.get(this._defaultPrimaryDataset)?.data || null : null;

    const mapFiles = Array.from(new Set([
      ...mapListingEntries
        .map((item) => String(item?.filename || '').trim())
        .filter((file) => /^juris-.*-map\.json$/i.test(file)),
      ...fileNames.filter((file) => /^juris-.*-map\.json$/i.test(file)),
    ])).sort((a, b) => a.localeCompare(b));
    this._mapDatasets = await this._loadDatasetGroup('juris-maps', mapFiles, mapFileMetaByName);
    this._mapDatasetsByRoot = this._groupDatasetsByRoot(this._mapDatasets);
    this._defaultMapDataset = this._mapDatasets.has('juris-us-map')
      ? 'juris-us-map'
      : (Array.from(this._mapDatasets.keys())[0] || null);
    this._jurisUSMap = this._defaultMapDataset ? this._mapDatasets.get(this._defaultMapDataset)?.data || null : null;

    const secondaryFiles = fileNames.filter((file) => /^secondary-.*\.json$/i.test(file));
    this._secondaryDatasetMeta = new Map(
      secondaryFiles.map((file) => {
        const dataset = this._datasetNameFromFilename(file);
        return [dataset, {
          filename: file,
          name: fileMetaByName.get(file) || dataset,
        }];
      }),
    );
    this._secondaryDatasets = {};
    for (const file of secondaryFiles) {
      const dataset = this._datasetNameFromFilename(file);
      this._secondaryDatasets[dataset] = await this.dataStore.loadJSON(`juris-abbrevs/${file}`);
    }
    this._secondaryDatasetOrder = this._buildSecondaryDatasetOrder(Object.keys(this._secondaryDatasets));
    this._defaultSecondaryDataset = this._secondaryDatasetOrder.find((dataset) => this._secondaryDatasets?.[dataset])
      || this._secondaryDatasetOrder[0]
      || 'secondary-us-bluebook';
    this._primaryJur = await this.dataStore.loadJSONAny(['juris-maps/primary-jurisdictions.json', 'data/primary-jurisdictions.json']);
    this._userSecondaryOverrides = this._loadSecondaryOverrides();
    this._userJurisdictionOverrides = this._loadJurisdictionOverrides();
  }

  _buildLocalePathCandidates(basePath, suffix) {
    const candidates = [];
    const seen = new Set();
    for (const candidate of this._localeCandidates) {
      const path = `${basePath}-${candidate}${suffix}`;
      if (seen.has(path)) continue;
      seen.add(path);
      candidates.push(path);
    }
    return candidates;
  }

  _expandListingFiles(listingEntries = []) {
    const rows = [];
    const seen = new Set();

    for (const item of Array.isArray(listingEntries) ? listingEntries : []) {
      const filename = String(item?.filename || '').trim();
      const name = String(item?.name || '').trim();
      if (filename && !seen.has(filename)) {
        seen.add(filename);
        rows.push({ filename, name });
      }

      const variants = item?.variants;
      if (!variants || typeof variants !== 'object' || Array.isArray(variants) || !filename) continue;

      for (const variantName of Object.keys(variants)) {
        const variant = String(variantName || '').trim();
        if (!variant) continue;
        const variantFile = filename.replace(/\.json$/i, `-${variant}.json`);
        if (!variantFile || seen.has(variantFile)) continue;
        seen.add(variantFile);
        rows.push({ filename: variantFile, name });
      }
    }

    return rows;
  }

  async _loadDatasetGroup(rootDir, fileNames, metaByFileName = new Map()) {
    const datasets = new Map();
    const files = Array.isArray(fileNames) ? fileNames.slice().sort((a, b) => a.localeCompare(b)) : [];
    for (const file of files) {
      const dataset = this._datasetNameFromFilename(file);
      const data = await this.dataStore.loadJSON(`${rootDir}/${file}`);
      datasets.set(dataset, {
        dataset,
        fileName: file,
        root: this._jurisdictionRootFromFilename(file),
        domain: this._datasetDomainFromFilename(file),
        domainKey: this._normalizeDatasetDomain(this._datasetDomainFromFilename(file)),
        name: String(metaByFileName.get(file) || this._inferDatasetDisplayName(dataset, data)).trim(),
        data,
      });
    }
    return datasets;
  }

  _inferDatasetDisplayName(dataset, data) {
    const explicitName = String(data?.name || '').trim();
    if (explicitName) return explicitName;

    const localizedJurisdictions = this._getLocalizedMapJurisdictions(data);
    if (Array.isArray(localizedJurisdictions)) {
      for (const item of localizedJurisdictions) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const label = String(item[1] || '').trim();
        if (label) return label;
      }
    }

    return this._formatDatasetLabel(dataset);
  }

  _getLocalizedMapJurisdictions(mapData) {
    const jurisdictions = mapData?.jurisdictions;
    if (!jurisdictions || typeof jurisdictions !== 'object' || Array.isArray(jurisdictions)) return null;

    for (const candidate of this._localeCandidates || []) {
      const rows = jurisdictions?.[candidate];
      if (Array.isArray(rows) && rows.length) return rows;
    }

    return Array.isArray(jurisdictions?.default) ? jurisdictions.default : null;
  }

  _groupDatasetsByRoot(datasets) {
    const byRoot = new Map();
    for (const info of datasets?.values?.() || []) {
      const root = String(info?.root || '').trim().toLowerCase();
      if (!root) continue;
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(info);
    }
    for (const infos of byRoot.values()) {
      infos.sort((a, b) => String(a.fileName || '').localeCompare(String(b.fileName || '')));
    }
    return byRoot;
  }

  _groupDatasetDomainsByRoot(datasets) {
    const byRoot = new Map();
    for (const info of datasets?.values?.() || []) {
      const root = String(info?.root || '').trim().toLowerCase();
      const domain = String(info?.domain || '').trim();
      const domainKey = this._normalizeDatasetDomain(domain);
      if (!root || !domain || !domainKey) continue;
      if (!byRoot.has(root)) byRoot.set(root, []);
      const entries = byRoot.get(root);
      if (!entries.some((entry) => this._normalizeDatasetDomain(entry) === domainKey)) {
        entries.push(domain);
      }
    }
    for (const entries of byRoot.values()) {
      entries.sort((a, b) => a.localeCompare(b));
    }
    return byRoot;
  }

  _pickLocaleDataset(datasetNames, prefix) {
    const names = Array.isArray(datasetNames) ? datasetNames.slice() : [];
    if (!names.length) return null;

    const exactCandidates = selectLocaleFiles(names.map((name) => `${name}.json`), prefix, this.locale, '.json')
      .map((file) => this._datasetNameFromFilename(file));
    if (exactCandidates.length) {
      return exactCandidates[0];
    }

    const exactPrefix = `${prefix}-`;
    const lowerLocale = this._localeCandidates[0] || '';
    for (const name of names) {
      if (name.toLowerCase() === `${prefix}-${lowerLocale}`.toLowerCase()) return name;
      if (name.toLowerCase().startsWith(exactPrefix)) return name;
    }

    return names[0];
  }

  _buildSecondaryDatasetOrder(loadedDatasets = []) {
    const core = ['secondary-us-bluebook', 'secondary-science'];
    const loaded = Array.isArray(loadedDatasets) ? loadedDatasets : [];
    const names = [];
    for (const dataset of core) {
      if (loaded.includes(dataset) && !names.includes(dataset)) names.push(dataset);
    }
    for (const dataset of loaded.slice().sort((a, b) => a.localeCompare(b))) {
      if (!names.includes(dataset)) names.push(dataset);
    }
    return names;
  }

  _datasetNameFromFilename(fileName) {
    return String(fileName || '').trim().replace(/\.json$/i, '');
  }

  _datasetBodyFromFilename(fileName) {
    return this._datasetNameFromFilename(fileName)
      .replace(/^auto-/i, '')
      .replace(/^primary-/i, '')
      .replace(/^secondary-/i, '')
      .replace(/^juris-/i, '')
      .replace(/-map$/i, '');
  }

  _jurisdictionRootFromFilename(fileName) {
    const body = this._datasetBodyFromFilename(fileName);
    const root = body.split('-')[0];
    return root ? root.toLowerCase().replace(/\+/g, ':') : null;
  }

  _datasetDomainFromFilename(fileName) {
    const body = this._datasetBodyFromFilename(fileName);
    const dashIdx = body.indexOf('-');
    if (dashIdx === -1) return null;
    const domain = body.slice(dashIdx + 1).trim();
    return domain || null;
  }

  _normalizeDatasetDomain(rawDomain) {
    return String(rawDomain || '').trim().toLowerCase() || null;
  }

  _splitJurisdictionDomain(rawJurisdiction) {
    const input = String(rawJurisdiction || '').trim();
    const atIdx = input.indexOf('@');
    const jurisdiction = (atIdx === -1 ? input : input.slice(0, atIdx)).trim().toLowerCase();
    const domain = atIdx === -1 ? '' : input.slice(atIdx + 1).trim();
    return {
      jurisdiction,
      domain,
      domainKey: this._normalizeDatasetDomain(domain),
    };
  }

  _jurisdictionRoot(rawJurisdiction) {
    const jurisdiction = this._splitJurisdictionDomain(rawJurisdiction).jurisdiction;
    if (!jurisdiction || jurisdiction === 'default') {
      return this._defaultJurisdiction || 'us';
    }
    return jurisdiction.split(':')[0] || (this._defaultJurisdiction || 'us');
  }

  _jurisdictionMapCode(rawJurisdiction) {
    const jurisdiction = this._splitJurisdictionDomain(rawJurisdiction).jurisdiction;
    if (!jurisdiction || jurisdiction === 'default') {
      return this._defaultJurisdiction || 'us';
    }
    const parts = jurisdiction.split(':').filter(Boolean);
    return parts[parts.length - 1] || (this._defaultJurisdiction || 'us');
  }

  _pickDatasetInfoForRoot(byRoot, root, fallbackDatasetName = null, preferredDomain = null) {
    const normalizedRoot = String(root || '').trim().toLowerCase();
    if (!normalizedRoot) return null;

    const entries = byRoot?.get?.(normalizedRoot) || [];
    if (Array.isArray(entries) && entries.length) {
      const normalizedDomain = this._normalizeDatasetDomain(preferredDomain);
      if (normalizedDomain) {
        const exactDomain = entries.find((entry) => this._normalizeDatasetDomain(entry?.domain) === normalizedDomain);
        if (exactDomain) return exactDomain;
      }
      const fallback = String(fallbackDatasetName || '').trim().toLowerCase();
      if (fallback.startsWith('juris-') && fallback.endsWith('-map')) {
        const exactMap = entries.find((entry) => String(entry.dataset || '').toLowerCase() === `juris-${normalizedRoot}-map`);
        if (exactMap) return exactMap;
      } else if (fallback.startsWith('primary-')) {
        const exactPrimary = entries.find((entry) => String(entry.dataset || '').toLowerCase() === `primary-${normalizedRoot}`);
        if (exactPrimary) return exactPrimary;
      } else if (fallback.startsWith('auto-')) {
        const exactAuto = entries.find((entry) => String(entry.dataset || '').toLowerCase() === `auto-${normalizedRoot}`);
        if (exactAuto) return exactAuto;
      }
      return entries[0];
    }

    if (fallbackDatasetName) {
      for (const group of byRoot?.values?.() || []) {
        const match = group.find((entry) => entry.dataset === fallbackDatasetName);
        if (match) return match;
      }
    }
    return null;
  }

  _normalizeJurisdictionDatasetName(rawDataset) {
    const dataset = String(rawDataset || '').trim();
    if (!dataset) return this._defaultAutoDataset || 'auto-us';
    return dataset.replace(/^jurisdiction:/i, '');
  }

  _getJurisdictionDatasetInfo(rawDataset) {
    const dataset = this._normalizeJurisdictionDatasetName(rawDataset);
    if (this._autoDatasets.has(dataset)) {
      return { kind: 'auto', ...this._autoDatasets.get(dataset) };
    }
    if (this._primaryDatasets.has(dataset)) {
      return { kind: 'primary', ...this._primaryDatasets.get(dataset) };
    }
    if (this._mapDatasets.has(dataset)) {
      return { kind: 'map', ...this._mapDatasets.get(dataset) };
    }
    return null;
  }

  _getJurisdictionOverrideBucket(rawDataset) {
    const dataset = this._normalizeJurisdictionDatasetName(rawDataset);
    if (!dataset) return {};
    const bucket = this._userJurisdictionOverrides?.[dataset];
    return bucket && typeof bucket === 'object' && !Array.isArray(bucket) ? bucket : {};
  }

  _getAutoDatasetInfoForJurisdiction(rawJurisdiction) {
    const parsed = this._splitJurisdictionDomain(rawJurisdiction);
    const root = this._jurisdictionRoot(parsed.jurisdiction);
    return this._pickDatasetInfoForRoot(this._autoDatasetsByRoot, root, this._defaultAutoDataset, parsed.domain);
  }

  _getPrimaryDatasetInfoForJurisdiction(rawJurisdiction) {
    const root = this._jurisdictionRoot(rawJurisdiction);
    return this._pickDatasetInfoForRoot(this._primaryDatasetsByRoot, root, this._defaultPrimaryDataset);
  }

  _getMapDatasetInfoForJurisdiction(rawJurisdiction) {
    const root = this._jurisdictionRoot(rawJurisdiction);
    return this._pickDatasetInfoForRoot(this._mapDatasetsByRoot, root, this._defaultMapDataset);
  }

  getAvailableAbbrevDomains() {
    const out = {};
    for (const [root, infos] of this._autoDatasetsByRoot.entries()) {
      if (!Array.isArray(infos) || !infos.length) continue;
      const domains = this._autoDomainsByRoot.get(root);
      out[root] = Array.isArray(domains) ? domains.slice() : [];
    }
    return out;
  }

  normalizeKey(s) {
    return (s || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[’]/g, "'")
      .replace(/[^a-z0-9\s\.-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  parseDirective(val) {
    if (!val) return { value: val, directive: null };
    const m = /^!([a-z-]+)\>\>\>(.+)$/.exec(val);
    if (!m) return { value: val, directive: null };
    return { value: m[2], directive: m[1] };
  }

  lookupForCiteProc(category, key, jur, options = {}) {
    const parsedJurisdiction = this._splitJurisdictionDomain(jur || this._defaultJurisdiction || 'default');
    const preferredJur = parsedJurisdiction.jurisdiction || (this._defaultJurisdiction || 'default');
    const effectiveJur = preferredJur === 'default' ? this._defaultJurisdiction || 'us' : preferredJur;
    const preferredJurWithDomain = parsedJurisdiction.domain ? `${effectiveJur}@${parsedJurisdiction.domain}` : effectiveJur;
    const autoInfo = this._getAutoDatasetInfoForJurisdiction(preferredJurWithDomain)
      || this._getAutoDatasetInfoForJurisdiction(effectiveJur)
      || this._getJurisdictionDatasetInfo(this._defaultAutoDataset)
      || { kind: 'auto', dataset: this._defaultAutoDataset || 'auto-us', data: this._autoUS };
    const primaryData = this._primaryUS?.xdata || null;
    const primaryOverrides = this._getJurisdictionOverrideBucket(this._defaultPrimaryDataset);
    const autoOverrides = this._getJurisdictionOverrideBucket(autoInfo?.dataset);
    const noHints = !!options.noHints;
    const normalizedKey = this.normalizeKey(key);
    const normalizedKeyNoDots = normalizedKey.replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    const containerTitleKeys = [normalizedKey];
    if (normalizedKeyNoDots && normalizedKeyNoDots !== normalizedKey) {
      containerTitleKeys.push(normalizedKeyNoDots);
    }
    let hit = null;

    if (category === 'institution-part' || category === 'institution-entire') {
      hit = this._lookupInstitutionCategoryValue(
        category,
        key,
        normalizedKey,
        effectiveJur,
        autoInfo?.data?.xdata,
        autoOverrides,
      );
      if (hit?.value) return { jurisdiction: preferredJurWithDomain, value: hit.value };
      return null;
    }

    if (category === 'place') {
      const upper = effectiveJur.toUpperCase();
      const value = this._lookupAutoUSPlaceOverride(upper, autoInfo?.dataset)
        || this._primaryJur?.xdata?.default?.place?.[upper]
        || autoInfo?.data?.xdata?.default?.place?.[upper]
        || null;
      return value ? { jurisdiction: preferredJurWithDomain, value } : null;
    }

    if (category === 'container-title') {
      for (const containerTitleKey of containerTitleKeys) {
      hit = lookupJurChainWithOverrides(
        primaryData,
        primaryOverrides,
        effectiveJur,
        'container-title',
        containerTitleKey,
        );
        if (hit?.value) return { jurisdiction: preferredJurWithDomain, value: hit.value };

        const secondaryValue = this._lookupSecondaryContainerTitle(containerTitleKey);
        if (secondaryValue) return { jurisdiction: 'default', value: secondaryValue };
      }

      if (!noHints) {
        const fallback = this.abbreviateContainerTitleFallback(key, preferredJur);
        if (fallback) return { jurisdiction: preferredJur === 'default' ? 'default' : preferredJurWithDomain, value: fallback };
      }
    }

    if (category === 'title') {
      hit = lookupJurChainWithOverrides(
        primaryData,
        primaryOverrides,
        effectiveJur,
        'title',
        normalizedKey,
      );
      if (hit?.value) return { jurisdiction: preferredJurWithDomain, value: hit.value };

      if (!noHints) {
        const fallback = this.abbreviateTitleFallback(key, preferredJur);
        if (fallback) return { jurisdiction: preferredJur === 'default' ? 'default' : preferredJurWithDomain, value: fallback };
      }
    }

    return null;
  }

  lookupSync(listname, key, jur) {
    return this.lookupForCiteProc(listname, key, jur)?.value || null;
  }

  listAutoUSPlaceJurisdictions() {
    const place = this._getAutoDatasetInfoForJurisdiction(this._defaultJurisdiction)?.data?.xdata?.default?.place
      || this._autoUS?.xdata?.default?.place
      || {};
    const keys = new Set(Object.keys(place));
    for (const key of this._listAutoUSPlaceOverrideKeys(this._defaultAutoDataset)) {
      keys.add(key);
    }

    return Array.from(keys)
      .map((key) => {
        const code = String(key || '').trim().toLowerCase();
        return {
          code,
          label: this.formatJurisdictionDisplay(code),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.code.localeCompare(b.code));
  }

  listJurisdictionMenuOptions() {
    const rows = [];
    const seen = new Set();

    for (const info of this._autoDatasets.values()) {
      const place = info?.data?.xdata?.default?.place;
      if (!place || typeof place !== 'object' || Array.isArray(place)) continue;

      for (const [rawCode, rawLabel] of Object.entries(place)) {
        const code = String(rawCode || '').trim().toLowerCase().replace(/\+/g, ':');
        if (!code || seen.has(code)) continue;
        seen.add(code);
        const display = this.formatJurisdictionDisplay(code) || String(rawLabel || '').trim() || code;
        const parts = this._buildJurisdictionDisplayParts(code, info);
        rows.push({
          code,
          label: display,
          root: parts?.root || code.split(':')[0] || code,
          rootLabel: parts?.rootLabel || display,
          depth: parts?.depth || code.split(':').filter(Boolean).length,
        });
      }
    }

    return rows.sort((a, b) => {
      return a.rootLabel.localeCompare(b.rootLabel)
        || a.root.localeCompare(b.root)
        || a.depth - b.depth
        || a.label.localeCompare(b.label)
        || a.code.localeCompare(b.code);
    });
  }

  listCourtOptionsForJurisdiction(rawJurisdiction) {
    const mapInfo = this._getMapDatasetInfoForJurisdiction(rawJurisdiction) || { data: this._jurisUSMap };
    const mapData = mapInfo?.data || null;
    const mapJurisdiction = this._jurisdictionMapCode(rawJurisdiction);
    const selectionJurisdiction = String(rawJurisdiction || this._defaultJurisdiction || 'us').trim().toLowerCase();
    const jurisdictions = this._getLocalizedMapJurisdictions(mapData);
    const courts = Array.isArray(mapData?.courts) ? mapData.courts : [];
    const row = Array.isArray(jurisdictions)
      ? jurisdictions.find((item) => Array.isArray(item) && String(item[0] || '').trim().toLowerCase() === mapJurisdiction)
      : null;

    if (!row || !courts.length) {
      return this.listInstitutionPartOptionsForJurisdictionTree(rawJurisdiction);
    }

    const rows = [];
    const seen = new Set();
    for (const ref of row.slice(2)) {
      const index = Number(ref);
      if (!Number.isFinite(index) || index < 0 || index >= courts.length) continue;
      const court = courts[index];
      if (!Array.isArray(court) || court.length < 2) continue;
      const key = this.normalizeKey(court[0]);
      const label = String(court[1] ?? '').trim();
      if (!key || !label || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        key,
        label,
        abbreviation: court[0] || '',
        jurisdiction: selectionJurisdiction,
        isChild: false,
      });
    }

    return rows.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  }

  formatJurisdictionDisplay(rawJurisdiction) {
    const jurisdiction = (rawJurisdiction || '').toString().trim().toLowerCase();
    if (!jurisdiction) return '';

    const parts = this._buildJurisdictionDisplayParts(jurisdiction);
    if (!parts?.labels?.length) return '';
    return parts.labels.join('|');
  }

  _buildJurisdictionDisplayParts(rawJurisdiction, rawAutoInfo = null) {
    const jurisdiction = (rawJurisdiction || '').toString().trim().toLowerCase();
    if (!jurisdiction) return null;

    const parts = jurisdiction.split(':').filter(Boolean);
    if (!parts.length) return null;

    const autoInfo = rawAutoInfo || this._getAutoDatasetInfoForJurisdiction(jurisdiction) || { data: this._autoUS };
    const rootCode = parts[0].toLowerCase();
    const rootLabel = String(
      autoInfo?.data?.name
      || this._lookupJurisdictionPlaceLabel(rootCode, autoInfo)
      || parts[0],
    ).trim();
    const labels = [rootLabel || parts[0].toUpperCase()];
    let chain = rootCode;

    for (let index = 1; index < parts.length; index += 1) {
      chain = `${chain}:${parts[index]}`;
      const label = this._lookupJurisdictionPlaceLabel(chain, autoInfo) || parts[index].replace(/\./g, ' ');
      labels.push(this._normalizeJurisdictionDisplayLabel(chain, label));
    }

    return {
      code: jurisdiction,
      root: rootCode,
      rootLabel: labels[0],
      labels,
      depth: parts.length,
    };
  }

  listInstitutionPartOptionsForJurisdiction(rawJurisdiction) {
    const jurisdiction = (rawJurisdiction || this._defaultJurisdiction || 'us').toString().trim().toLowerCase() || 'us';
    const normalizedJurisdiction = jurisdiction === 'default' ? this._defaultJurisdiction || 'us' : jurisdiction;
    const autoInfo = this._getAutoDatasetInfoForJurisdiction(normalizedJurisdiction) || { data: this._autoUS };
    const rows = [];

    const entries = this._listInstitutionPartEntriesForJurisdiction(normalizedJurisdiction, autoInfo);
    for (const [key, value] of entries.entries()) {
      rows.push({
        key,
        label: this.formatInstitutionPartDisplay(key, normalizedJurisdiction),
        abbreviation: value,
        jurisdiction: normalizedJurisdiction,
        isChild: false,
      });
    }

    return rows.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  }

  listInstitutionPartOptionsForJurisdictionTree(rawJurisdiction) {
    const jurisdiction = (rawJurisdiction || this._defaultJurisdiction || 'us').toString().trim().toLowerCase() || 'us';
    const normalizedJurisdiction = jurisdiction === 'default' ? this._defaultJurisdiction || 'us' : jurisdiction;
    const autoInfo = this._getAutoDatasetInfoForJurisdiction(normalizedJurisdiction) || { data: this._autoUS };
    const rows = [];

    // Courts at the exact jurisdiction level — no jurisdiction prefix in label.
    const exactEntries = this._listInstitutionPartEntriesForJurisdiction(normalizedJurisdiction, autoInfo);
    for (const [key, value] of exactEntries.entries()) {
      rows.push({
        key,
        label: this.formatInstitutionPartDisplay(key, normalizedJurisdiction),
        abbreviation: value,
        jurisdiction: normalizedJurisdiction,
        isChild: false,
      });
    }

    // Courts from every child jurisdiction — labeled "PlaceAbbrev: Court Name".
    const childPrefix = `${normalizedJurisdiction}:`;
    const childJurisdictions = new Set();
    for (const childJur of Object.keys(autoInfo?.data?.xdata || {})) {
      if (childJur.startsWith(childPrefix)) childJurisdictions.add(childJur);
    }
    for (const parsed of this._listAutoUSInstitutionOverrideEntries(autoInfo?.dataset)) {
      if (parsed.jurisdiction.startsWith(childPrefix)) childJurisdictions.add(parsed.jurisdiction);
    }

    for (const childJur of Array.from(childJurisdictions).sort()) {
      if (!childJur.startsWith(childPrefix)) continue;
      const childEntries = this._listInstitutionPartEntriesForJurisdiction(childJur, autoInfo);
      if (!childEntries.size) continue;

      const placeLabel = this._lookupJurisdictionPlaceLabel(childJur, autoInfo) || childJur;
      for (const [key, value] of childEntries.entries()) {
        rows.push({
          key,
          label: `${placeLabel}: ${this.formatInstitutionPartDisplay(key, childJur)}`,
          abbreviation: value,
          jurisdiction: childJur,
          isChild: true,
        });
      }
    }

    return rows.sort((a, b) => {
      if (!a.isChild && b.isChild) return -1;
      if (a.isChild && !b.isChild) return 1;
      return a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
    });
  }

  formatInstitutionPartDisplay(rawKey, rawJurisdiction = this._defaultJurisdiction || 'us') {
    const key = this.normalizeKey(rawKey);
    if (!key) return '';

    const mapInfo = this._getMapDatasetInfoForJurisdiction(rawJurisdiction) || { data: this._jurisUSMap };
    const mapped = this._lookupCourtDisplayLabel(key, mapInfo?.data);
    if (mapped) return mapped;

    const lookupJurisdiction = (rawJurisdiction || this._defaultJurisdiction || 'us').toString().trim().toLowerCase() || 'us';
    for (const category of ['institution-part', 'institution-entire']) {
      const hit = this.lookupForCiteProc(category, key, lookupJurisdiction, { noHints: true });
      const value = this.parseDirective(hit?.value).value;
      if (value) return value;
    }

    return key
      .split('.')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  _listInstitutionPartEntriesForJurisdiction(rawJurisdiction, autoInfo = null) {
    const jurisdiction = (rawJurisdiction || 'us').toString().trim().toLowerCase();
    if (!jurisdiction) return new Map();

    const entries = new Map();
    for (const category of ['institution-entire', 'institution-part']) {
      const baseEntries = autoInfo?.data?.xdata?.[jurisdiction]?.[category];
      if (baseEntries && typeof baseEntries === 'object' && !Array.isArray(baseEntries)) {
        for (const [rawKey, rawValue] of Object.entries(baseEntries)) {
          const key = this.normalizeKey(rawKey);
          const value = String(rawValue ?? '').trim();
          if (!key || !value) continue;
          entries.set(key, value);
        }
      }
      for (const parsed of this._listAutoUSInstitutionOverrideEntries(autoInfo?.dataset)) {
        if (parsed.category !== category) continue;
        if (parsed.jurisdiction !== jurisdiction) continue;
        if (!parsed.key || !parsed.value) continue;
        entries.set(parsed.key, parsed.value);
      }
    }

    return entries;
  }

  _listAutoUSInstitutionOverrideEntries(rawDataset = this._defaultAutoDataset) {
    const bucket = this._getJurisdictionOverrideBucket(rawDataset);
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return [];
    const datasetRoot = this._jurisdictionRootFromFilename(rawDataset) || 'us';

    const rows = [];
    for (const [overrideKey, overrideValue] of Object.entries(bucket)) {
      const parsed = this._parseJurisdictionDatasetOverrideKey(overrideKey);
      if (!parsed) continue;
      if (parsed.category !== 'institution-part' && parsed.category !== 'institution-entire') continue;

      let jurisdiction = (parsed.jurisdiction || '').toString().trim().toLowerCase();
      if (rawDataset && datasetRoot !== 'us' && jurisdiction === 'us') {
        jurisdiction = datasetRoot;
      }
      const key = this.normalizeKey(parsed.key);
      const value = String(overrideValue ?? '').trim();
      if (!jurisdiction || !key || !value) continue;

      rows.push({
        jurisdiction: jurisdiction === 'default' ? 'us' : jurisdiction,
        key,
        value,
        category: parsed.category,
      });
    }
    return rows.sort((a, b) => {
      const rank = (category) => (category === 'institution-part' ? 1 : 0);
      return rank(a.category) - rank(b.category);
    });
  }

  abbreviateContainerTitleFallback(title, jur) {
    return this._abbreviateByWords(title, jur, ['container-title']);
  }

  abbreviateTitleFallback(title, jur) {
    return this._abbreviateByWords(title, jur, ['title', 'container-title']);
  }

  _abbreviateByWords(title, jur, categories) {
    const source = (title || '').toString().trim();
    if (!source) return null;

    // Preserve dotted initialisms (for example, "U.S.C.") as-is.
    // These are already canonical abbreviations and fallback word logic can corrupt them.
    if (/^(?:[A-Za-z]\.){2,}[A-Za-z]?\.?$/.test(source)) return null;

    const segments = this._tokenizeWordAndSeparatorSegments(source);
    const hasWord = segments.some((segment) => segment.type === 'word');
    if (!hasWord) return null;

    const output = [];
    for (let index = 0; index < segments.length; ) {
      const segment = segments[index];
      if (segment.type !== 'word') {
        output.push(segment.text);
        index += 1;
        continue;
      }

      const phraseWords = [];
      let bestMatch = null;

      for (let scan = index; scan < segments.length && phraseWords.length < 4; scan += 1) {
        if (segments[scan].type !== 'word') continue;
        phraseWords.push(segments[scan].text);

        const normalized = this.normalizeKey(phraseWords.join(' '));
        const hit = this._lookupFallbackPhrase(normalized, jur, categories);
        if (hit?.value) {
          bestMatch = {
            value: this.parseDirective(hit.value).value,
            endIndex: scan,
          };
        }
      }

      if (bestMatch) {
        output.push(bestMatch.value);
        index = bestMatch.endIndex + 1;
        continue;
      }

      output.push(this._abbreviateCoreWord(segment.text, jur, categories));
      index += 1;
    }

    const abbreviated = output.join('').trim();
    return abbreviated && abbreviated !== source ? abbreviated : null;
  }

  _tokenizeWordAndSeparatorSegments(source) {
    const segments = [];
    const matcher = /([A-Za-z0-9]+|[^A-Za-z0-9]+)/g;
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const text = match[0];
      segments.push({
        type: /^[A-Za-z0-9]+$/.test(text) ? 'word' : 'sep',
        text,
      });
    }
    return segments;
  }

  _abbreviateSingleToken(token, jur, categories) {
    const parts = token.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
    if (!parts) return token;

    const prefix = parts[1] || '';
    const core = parts[2] || '';
    const suffix = parts[3] || '';
    if (!core) return token;

    // Handle compounds like "Rights-Civil" by abbreviating each side independently.
    const compoundParts = core.split(/([-\u2010-\u2015])/);
    const abbreviatedCore = compoundParts
      .map((part) => (/^[-\u2010-\u2015]$/.test(part) ? part : this._abbreviateCoreWord(part, jur, categories)))
      .join('');

    const safeSuffix = abbreviatedCore.endsWith('.') && suffix.startsWith('.') ? suffix.slice(1) : suffix;
    return `${prefix}${abbreviatedCore}${safeSuffix}`;
  }

  _abbreviateCoreWord(word, jur, categories) {
    const normalized = this.normalizeKey(word);
    if (!normalized) return word;

    const hit = this._lookupFallbackPhrase(normalized, jur, categories)
      || this._lookupSupplementalWord(normalized);
    if (!hit?.value) return word;

    return this.parseDirective(hit.value).value;
  }

  _lookupFallbackPhrase(normalized, jur, categories) {
    const normalizedJur = jur === 'default' ? (this._defaultJurisdiction || 'us') : jur;
    const autoInfo = this._getAutoDatasetInfoForJurisdiction(normalizedJur)
      || this._getJurisdictionDatasetInfo(this._defaultAutoDataset)
      || { data: this._autoUS };
    const primaryData = this._primaryUS?.xdata || null;
    const primaryOverrides = this._getJurisdictionOverrideBucket(this._defaultPrimaryDataset);
    for (const category of categories) {
      const primaryHit = lookupJurChainWithOverrides(
        primaryData,
        primaryOverrides,
        normalizedJur,
        category,
        normalized,
      );
      if (primaryHit?.value) return primaryHit;

      const secondaryValue = (category === 'container-title')
        ? this._lookupSecondaryContainerTitle(normalized)
        : this._lookupSecondaryCategoryValue(category, normalized)
          || this._lookupSecondaryContainerTitle(normalized)
          || null;
      if (secondaryValue) return { jurisdiction: 'default', value: secondaryValue };
    }
    return null;
  }

  _lookupJurisdictionPlaceLabel(rawJurisdiction) {
    const jurisdiction = (rawJurisdiction || '').toString().trim().toUpperCase();
    if (!jurisdiction) return null;
    const autoInfo = this._getAutoDatasetInfoForJurisdiction(jurisdiction)
      || this._getJurisdictionDatasetInfo(this._defaultAutoDataset)
      || { data: this._autoUS };

    return this._lookupAutoUSPlaceOverride(jurisdiction, autoInfo?.dataset)
      || this._primaryJur?.xdata?.default?.place?.[jurisdiction]
      || autoInfo?.data?.xdata?.default?.place?.[jurisdiction]
      || null;
  }

  _lookupAutoUSPlaceOverride(rawJurisdiction, rawDataset = this._defaultAutoDataset) {
    const jurisdiction = (rawJurisdiction || '').toString().trim().toUpperCase();
    if (!jurisdiction) return null;

    const overrideKey = this._makeJurisdictionDatasetOverrideKey('default', 'place', jurisdiction);
    if (!overrideKey) return null;

    const bucket = this._getJurisdictionOverrideBucket(rawDataset);
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, overrideKey)) return null;
    return bucket[overrideKey] || null;
  }

  _listAutoUSPlaceOverrideKeys(rawDataset = this._defaultAutoDataset) {
    const bucket = this._getJurisdictionOverrideBucket(rawDataset);
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) return [];

    const keys = [];
    for (const overrideKey of Object.keys(bucket)) {
      const parsed = this._parseJurisdictionDatasetOverrideKey(overrideKey);
      if (!parsed) continue;
      if (parsed.jurisdiction !== 'default' || parsed.category !== 'place') continue;
      keys.push(parsed.key);
    }
    return keys;
  }

  _lookupCourtDisplayLabel(rawKey, mapData = this._jurisUSMap) {
    const key = this.normalizeKey(rawKey);
    if (!key) return null;

    const courts = mapData?.courts;
    if (!Array.isArray(courts)) return null;

    for (const item of courts) {
      if (!Array.isArray(item) || item.length < 2) continue;
      if (this.normalizeKey(item[0]) !== key) continue;
      const value = String(item[1] ?? '').trim();
      if (value) return value;
    }
    return null;
  }

  _normalizeJurisdictionDisplayLabel(jurisdiction, label) {
    return String(label || '').trim();
  }

  listSecondaryContainerTitleAbbreviations(rawDataset = this._defaultSecondaryDataset) {
    const dataset = this._normalizeSecondaryDataset(rawDataset);
    const base = this._secondaryDatasets?.[dataset]?.xdata?.default?.['container-title'] || {};
    const user = this._userSecondaryOverrides?.[dataset] || {};
    const merged = { ...base, ...user };
    return Object.keys(merged)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({
        key,
        value: merged[key],
        source: Object.prototype.hasOwnProperty.call(user, key) ? 'user' : 'base',
      }));
  }

  listSecondaryDatasetOptions() {
    const rows = [];
    const seen = new Set();

    for (const dataset of this._getSecondaryLookupOrder()) {
      if (!this._secondaryDatasets?.[dataset] || seen.has(dataset)) continue;
      seen.add(dataset);
      rows.push({
        dataset,
        label: this._secondaryDatasetMeta.get(dataset)?.name || this._formatDatasetLabel(dataset),
        isDefault: dataset === this._defaultSecondaryDataset,
      });
    }

    for (const dataset of Object.keys(this._secondaryDatasets || {}).sort((a, b) => a.localeCompare(b))) {
      if (seen.has(dataset)) continue;
      seen.add(dataset);
      rows.push({
        dataset,
        label: this._secondaryDatasetMeta.get(dataset)?.name || this._formatDatasetLabel(dataset),
        isDefault: dataset === this._defaultSecondaryDataset,
      });
    }

    return rows;
  }

  listPrimaryDatasetOptions() {
    const rows = [];
    const seen = new Set();

    for (const info of this._primaryDatasets.values()) {
      if (!info || seen.has(info.dataset)) continue;
      seen.add(info.dataset);
      rows.push({
        dataset: info.dataset,
        label: this._formatJurisdictionDatasetLabel({ ...info, kind: 'primary' }),
        isDefault: info.dataset === this._defaultPrimaryDataset,
      });
    }

    return rows;
  }

  listPrimaryAbbreviations(rawDataset = this._defaultPrimaryDataset) {
    return this.listJurisdictionPreferenceEntries(rawDataset);
  }

  upsertPrimaryAbbreviation(rawDataset, rawJurisdiction, category, key, value) {
    return this.upsertJurisdictionPreferenceEntry(rawDataset, rawJurisdiction, category, key, value);
  }

  removePrimaryAbbreviation(rawDataset, rawJurisdiction, category, key) {
    return this.removeJurisdictionPreferenceEntry(rawDataset, rawJurisdiction, category, key);
  }

  resetPrimaryAbbreviations(rawDataset = this._defaultPrimaryDataset) {
    this.resetJurisdictionPreferenceOverrides(rawDataset);
  }

  listJurisdictionDatasetOptions() {
    const rows = [];
    const seen = new Set();

    const pushInfo = (info) => {
      if (!info || seen.has(info.dataset)) return;
      seen.add(info.dataset);
      rows.push({
        value: `jurisdiction:${info.dataset}`,
        label: this._formatJurisdictionDatasetLabel(info),
        dataset: info.dataset,
        kind: info.kind,
        isDefault: info.dataset === this._defaultAutoDataset || info.dataset === this._defaultMapDataset,
      });
    };

    for (const info of this._autoDatasets.values()) pushInfo({ kind: 'auto', ...info });
    for (const info of this._primaryDatasets.values()) pushInfo({ kind: 'primary', ...info });
    for (const info of this._mapDatasets.values()) pushInfo({ kind: 'map', ...info });

    return rows;
  }

  upsertSecondaryContainerTitleAbbreviation(rawDataset, rawKey, rawValue) {
    const dataset = this._normalizeSecondaryDataset(rawDataset);
    const key = this.normalizeKey(rawKey);
    const value = (rawValue || '').toString().trim();
    if (!key || !value) return false;
    if (!this._userSecondaryOverrides[dataset] || typeof this._userSecondaryOverrides[dataset] !== 'object') {
      this._userSecondaryOverrides[dataset] = {};
    }
    this._userSecondaryOverrides[dataset][key] = value;
    this._saveSecondaryOverrides();
    return true;
  }

  removeSecondaryContainerTitleAbbreviation(rawDataset, rawKey) {
    const dataset = this._normalizeSecondaryDataset(rawDataset);
    const key = this.normalizeKey(rawKey);
    if (!key) return false;
    const bucket = this._userSecondaryOverrides?.[dataset];
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, key)) return false;
    delete bucket[key];
    this._saveSecondaryOverrides();
    return true;
  }

  resetSecondaryContainerTitleOverrides(rawDataset = this._defaultSecondaryDataset) {
    const dataset = this._normalizeSecondaryDataset(rawDataset);
    this._userSecondaryOverrides[dataset] = {};
    this._saveSecondaryOverrides();
  }

  listJurisdictionPreferenceEntries(rawDataset = null) {
    const info = this._getJurisdictionDatasetInfo(rawDataset)
      || this._getJurisdictionDatasetInfo(this._defaultAutoDataset);
    const rows = [];
    if (info?.kind === 'primary') {
      this._collectXDataRows(rows, info.dataset, info.data?.xdata);
    } else if (info?.kind === 'map') {
      this._collectJurisMapRows(rows, info);
    } else {
      this._collectXDataRows(rows, info?.dataset || this._defaultAutoDataset || 'auto-us', info?.data?.xdata);
    }
    this._collectOverrideOnlyJurisdictionRows(rows, info?.dataset || null);

    return rows
      .sort((a, b) => {
        return a.dataset.localeCompare(b.dataset)
          || a.jurisdiction.localeCompare(b.jurisdiction)
          || a.category.localeCompare(b.category)
          || a.key.localeCompare(b.key);
      })
      .map((row) => ({
        ...row,
        source: this._getJurisdictionOverrideValue(row.id) != null ? 'user' : 'base',
        value: this._getJurisdictionOverrideValue(row.id) ?? row.value,
      }));
  }

  upsertJurisdictionPreferenceEntry(dataset, jurisdiction, category, key, value) {
    const ds = (dataset || '').toString().trim();
    const normalizedJurisdiction = this._normalizeOverrideJurisdictionForCategory(ds, jurisdiction, category);
    const id = this._makeJurisdictionDatasetOverrideKey(normalizedJurisdiction, category, key);
    const val = (value || '').toString().trim();
    if (!ds || !id || !val) return false;
    if (!this._userJurisdictionOverrides[ds] || typeof this._userJurisdictionOverrides[ds] !== 'object') {
      this._userJurisdictionOverrides[ds] = {};
    }
    this._userJurisdictionOverrides[ds][id] = val;
    this._saveJurisdictionOverrides();
    return true;
  }

  removeJurisdictionPreferenceEntry(dataset, jurisdiction, category, key) {
    const ds = (dataset || '').toString().trim();
    const normalizedJurisdiction = this._normalizeOverrideJurisdictionForCategory(ds, jurisdiction, category);
    const id = this._makeJurisdictionDatasetOverrideKey(normalizedJurisdiction, category, key);
    if (!ds || !id) return false;
    const bucket = this._userJurisdictionOverrides?.[ds];
    if (!bucket) return false;

    let targetID = id;
    if (!Object.prototype.hasOwnProperty.call(bucket, targetID)) {
      const legacyJurisdiction = this._normalizeLegacyOverrideJurisdictionForCategory(ds, normalizedJurisdiction, category);
      const legacyID = this._makeJurisdictionDatasetOverrideKey(legacyJurisdiction, category, key);
      if (!legacyID || !Object.prototype.hasOwnProperty.call(bucket, legacyID)) return false;
      targetID = legacyID;
    }

    delete bucket[targetID];
    this._saveJurisdictionOverrides();
    return true;
  }

  resetJurisdictionPreferenceOverrides(rawDataset = null) {
    if (!rawDataset) {
      this._userJurisdictionOverrides = {};
      this._saveJurisdictionOverrides();
      return;
    }

    const dataset = this._normalizeJurisdictionDatasetName(rawDataset);
    if (!dataset) return;
    delete this._userJurisdictionOverrides[dataset];
    this._saveJurisdictionOverrides();
  }

  importOverrides(kind, rawDataset, payload) {
    const importKind = (kind || '').toString().trim().toLowerCase();
    const xdata = payload?.xdata && typeof payload.xdata === 'object' && !Array.isArray(payload.xdata)
      ? payload.xdata
      : payload;
    const summary = this._createImportSummary();

    if (!xdata || typeof xdata !== 'object' || Array.isArray(xdata)) {
      summary.error = 'Import file did not contain an xdata object.';
      return summary;
    }

    if (importKind === 'journals') {
      return this._importSecondaryOverrides(rawDataset, xdata, summary);
    }

    if (importKind === 'abbrev' || importKind === 'jurisdiction') {
      return this._importJurisdictionOverrides(rawDataset, xdata, summary);
    }

    summary.error = `Unsupported import target: ${importKind || 'unknown'}.`;
    return summary;
  }

  _importSecondaryOverrides(rawDataset, xdata, summary) {
    const dataset = this._normalizeSecondaryDataset(rawDataset);
    const defaultRows = xdata?.default;
    const containerTitles = defaultRows?.['container-title'];

    if (!defaultRows || typeof defaultRows !== 'object' || Array.isArray(defaultRows)) {
      summary.error = 'Import file did not contain xdata.default entries for journal abbreviations.';
      return summary;
    }

    const existingRows = this.listSecondaryContainerTitleAbbreviations(dataset);
    const existingByKey = new Map(existingRows.map((row) => [this.normalizeKey(row.key), String(row.value ?? '').trim()]));
    let changed = false;

    for (const [jurisdiction, categories] of Object.entries(xdata)) {
      if (String(jurisdiction || '').trim().toLowerCase() !== 'default') {
        this._recordImportSkip(summary, 'outside_selected_dataset_scope', jurisdiction);
        continue;
      }

      if (!categories || typeof categories !== 'object' || Array.isArray(categories)) {
        this._recordImportSkip(summary, 'invalid_category_block', jurisdiction);
        continue;
      }

      for (const [category, entries] of Object.entries(categories)) {
        const normalizedCategory = String(category || '').trim().toLowerCase();
        if (normalizedCategory !== 'container-title') {
          this._recordImportSkip(summary, 'unsupported_category', `default::${normalizedCategory}`);
          continue;
        }

        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
          this._recordImportSkip(summary, 'invalid_entries_block', `default::${normalizedCategory}`);
          continue;
        }

        for (const [rawKey, rawValue] of Object.entries(entries)) {
          const key = this.normalizeKey(rawKey);
          const value = String(rawValue ?? '').trim();
          const context = `default::container-title::${String(rawKey || '').trim()}`;
          if (!key || !value) {
            this._recordImportSkip(summary, 'blank_key_or_value', context);
            continue;
          }

          const existingValue = existingByKey.get(key);
          if (existingValue === value) {
            this._recordImportSkip(summary, 'unchanged', context);
            continue;
          }

          if (!this._userSecondaryOverrides[dataset] || typeof this._userSecondaryOverrides[dataset] !== 'object') {
            this._userSecondaryOverrides[dataset] = {};
          }
          this._userSecondaryOverrides[dataset][key] = value;
          existingByKey.set(key, value);
          changed = true;
          if (typeof existingValue === 'string') {
            summary.updated += 1;
          } else {
            summary.added += 1;
          }
        }
      }
    }

    if (changed) this._saveSecondaryOverrides();
    return this._finalizeImportSummary(summary);
  }

  _importJurisdictionOverrides(rawDataset, xdata, summary) {
    const info = this._getJurisdictionDatasetInfo(rawDataset)
      || this._getJurisdictionDatasetInfo(this._defaultAutoDataset);
    if (!info) {
      summary.error = 'Selected dataset could not be resolved.';
      return summary;
    }
    if (info.kind === 'map') {
      summary.error = 'Map datasets do not accept abbrev imports.';
      return summary;
    }

    const dataset = info.dataset;
    const root = String(info.root || this._jurisdictionRootFromFilename(dataset) || '').trim().toLowerCase();
    const categories = this._getImportableJurisdictionCategories(info);
    const existingRows = this.listJurisdictionPreferenceEntries(dataset);
    const existingByID = new Map(
      existingRows
        .map((row) => {
          const id = this._makeJurisdictionDatasetOverrideKey(row.jurisdiction, row.category, row.key);
          return id ? [id, String(row.value ?? '').trim()] : null;
        })
        .filter(Boolean),
    );
    if (!this._userJurisdictionOverrides[dataset] || typeof this._userJurisdictionOverrides[dataset] !== 'object') {
      this._userJurisdictionOverrides[dataset] = {};
    }
    const bucket = this._userJurisdictionOverrides[dataset];
    let changed = false;

    for (const [rawJurisdiction, categoryRows] of Object.entries(xdata)) {
      const jurisdiction = String(rawJurisdiction || '').trim().toLowerCase();
      if (!this._isImportJurisdictionInScope(jurisdiction, root)) {
        this._recordImportSkip(summary, 'outside_selected_dataset_scope', jurisdiction);
        continue;
      }
      if (!categoryRows || typeof categoryRows !== 'object' || Array.isArray(categoryRows)) {
        this._recordImportSkip(summary, 'invalid_category_block', jurisdiction);
        continue;
      }

      for (const [rawCategory, entries] of Object.entries(categoryRows)) {
        const category = String(rawCategory || '').trim().toLowerCase();
        const categoryContext = `${jurisdiction || 'default'}::${category}`;
        if (!categories.has(category)) {
          this._recordImportSkip(summary, 'unsupported_category', categoryContext);
          continue;
        }
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
          this._recordImportSkip(summary, 'invalid_entries_block', categoryContext);
          continue;
        }

        for (const [rawKey, rawValue] of Object.entries(entries)) {
          const key = String(rawKey || '').trim();
          const value = String(rawValue ?? '').trim();
          const context = `${jurisdiction || 'default'}::${category}::${key}`;
          if (!key || !value) {
            this._recordImportSkip(summary, 'blank_key_or_value', context);
            continue;
          }

          const normalizedJurisdiction = this._normalizeOverrideJurisdictionForCategory(dataset, jurisdiction, category);
          const id = this._makeJurisdictionDatasetOverrideKey(normalizedJurisdiction, category, key);
          if (!id) {
            this._recordImportSkip(summary, 'invalid_override_key', context);
            continue;
          }

          const existingValue = existingByID.get(id);
          if (existingValue === value) {
            this._recordImportSkip(summary, 'unchanged', context);
            continue;
          }

          bucket[id] = value;
          existingByID.set(id, value);
          changed = true;
          if (typeof existingValue === 'string') {
            summary.updated += 1;
          } else {
            summary.added += 1;
          }
        }
      }
    }

    if (changed) this._saveJurisdictionOverrides();
    return this._finalizeImportSummary(summary);
  }

  _createImportSummary() {
    return {
      added: 0,
      updated: 0,
      skipped: 0,
      skipReasons: new Map(),
      error: '',
    };
  }

  _recordImportSkip(summary, reason, context = '') {
    if (!summary?.skipReasons) return;
    summary.skipped += 1;
    const current = summary.skipReasons.get(reason) || { reason, count: 0, examples: [] };
    current.count += 1;
    const example = String(context || '').trim();
    if (example && current.examples.length < 3 && !current.examples.includes(example)) {
      current.examples.push(example);
    }
    summary.skipReasons.set(reason, current);
  }

  _finalizeImportSummary(summary) {
    return {
      added: summary.added,
      updated: summary.updated,
      skipped: summary.skipped,
      error: summary.error || '',
      skipReasons: Array.from(summary.skipReasons.values()).sort((a, b) => a.reason.localeCompare(b.reason)),
    };
  }

  _isImportJurisdictionInScope(jurisdiction, root) {
    const jur = String(jurisdiction || '').trim().toLowerCase();
    const normalizedRoot = String(root || '').trim().toLowerCase();
    if (!jur) return false;
    if (jur === 'default') return true;
    if (!normalizedRoot) return true;
    return jur === normalizedRoot || jur.startsWith(`${normalizedRoot}:`);
  }

  _getImportableJurisdictionCategories(info) {
    const categories = new Set([
      'container-title',
      'institution-entire',
      'institution-part',
      'place',
      'title',
    ]);
    for (const row of this.listJurisdictionPreferenceEntries(info?.dataset || null)) {
      const category = String(row?.category || '').trim().toLowerCase();
      if (category) categories.add(category);
    }
    return categories;
  }

  _lookupSecondaryContainerTitle(normalizedKey, rawDataset = null) {
    if (!normalizedKey) return null;

    const dataset = rawDataset ? this._normalizeSecondaryDataset(rawDataset) : null;
    if (dataset) {
      const bucket = this._userSecondaryOverrides?.[dataset] || {};
      if (Object.prototype.hasOwnProperty.call(bucket, normalizedKey)) {
        return bucket[normalizedKey];
      }
      return this._secondaryDatasets?.[dataset]?.xdata?.default?.['container-title']?.[normalizedKey] || null;
    }

    for (const name of this._getSecondaryLookupOrder()) {
      const bucket = this._userSecondaryOverrides?.[name] || {};
      if (Object.prototype.hasOwnProperty.call(bucket, normalizedKey)) {
        return bucket[normalizedKey];
      }
      const value = this._secondaryDatasets?.[name]?.xdata?.default?.['container-title']?.[normalizedKey];
      if (value) return value;
    }

    return null;
  }

  _lookupSecondaryCategoryValue(category, normalizedKey) {
    if (!category || !normalizedKey) return null;
    for (const name of this._getSecondaryLookupOrder()) {
      const value = this._secondaryDatasets?.[name]?.xdata?.default?.[category]?.[normalizedKey];
      if (value) return value;
    }
    return null;
  }

  _getSecondaryLookupOrder() {
    const names = [];
    for (const name of this._secondaryDatasetOrder) {
      if (this._secondaryDatasets?.[name]) names.push(name);
    }
    for (const name of Object.keys(this._secondaryDatasets || {})) {
      if (!names.includes(name) && this._secondaryDatasets?.[name]) names.push(name);
    }
    return names;
  }

  _normalizeSecondaryDataset(rawDataset) {
    const dataset = (rawDataset || '').toString().trim() || this._defaultSecondaryDataset;
    if (this._secondaryDatasets?.[dataset]) return dataset;
    return this._defaultSecondaryDataset;
  }

  _formatDatasetLabel(dataset) {
    return String(dataset || '')
      .replace(/^secondary-/i, '')
      .replace(/-/g, ' ')
      .replace(/\b([a-z])/g, (match) => match.toUpperCase());
  }

  _formatJurisdictionDatasetLabel(info) {
    const name = String(info?.name || '').trim();
    if (!name) return this._formatDatasetLabel(info?.dataset);
    return `${name} (${info.dataset})`;
  }

  _loadSecondaryOverrides() {
    try {
      const raw = Zotero?.Prefs?.get?.(this._secondaryOverridesPref);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

      // Backward-compatible migration from flat key/value map.
      const looksFlat = Object.values(parsed).some((v) => typeof v === 'string' || typeof v === 'number');
      if (looksFlat) {
        const migrated = {};
        for (const [k, v] of Object.entries(parsed)) {
          const key = this.normalizeKey(k);
          const value = (v || '').toString().trim();
          if (key && value) migrated[key] = value;
        }
        return { [this._defaultSecondaryDataset]: migrated };
      }

      const cleaned = {};
      for (const [dataset, bucket] of Object.entries(parsed)) {
        const ds = (dataset || '').toString().trim();
        if (!ds || !bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
        cleaned[ds] = {};
        for (const [k, v] of Object.entries(bucket)) {
          const key = this.normalizeKey(k);
          const value = (v || '').toString().trim();
          if (key && value) cleaned[ds][key] = value;
        }
      }

      return cleaned;
    } catch (e) {
      return {};
    }
  }

  _saveSecondaryOverrides() {
    try {
      Zotero?.Prefs?.set?.(this._secondaryOverridesPref, JSON.stringify(this._userSecondaryOverrides || {}));
    } catch (e) {}
  }

  _makeJurisdictionOverrideID(dataset, jurisdiction, category, key) {
    const ds = (dataset || '').toString().trim();
    const inner = this._makeJurisdictionDatasetOverrideKey(jurisdiction, category, key);
    if (!ds || !inner) return null;
    return `${ds}::${inner}`;
  }

  _makeJurisdictionDatasetOverrideKey(jurisdiction, category, key) {
    const jur = (jurisdiction || '').toString().trim();
    const cat = (category || '').toString().trim();
    const k = (key || '').toString().trim();
    if (!jur || !cat || !k) return null;
    return `${jur}::${cat}::${k}`;
  }

  _normalizeOverrideJurisdictionForCategory(dataset, jurisdiction, category) {
    const ds = (dataset || '').toString().trim().toLowerCase();
    const jur = (jurisdiction || '').toString().trim().toLowerCase();
    const cat = (category || '').toString().trim().toLowerCase();
    if (!jur) return jur;
    if (jur !== 'default') return jur;

    if (cat === 'place' || cat === 'courts' || cat === 'jurisdictions') {
      return 'default';
    }

    if (ds.startsWith('auto-')) {
      return this._jurisdictionRootFromFilename(ds) || 'us';
    }

    return 'us';
  }

  _normalizeLegacyOverrideJurisdictionForCategory(dataset, jurisdiction, category) {
    const ds = (dataset || '').toString().trim().toLowerCase();
    const jur = (jurisdiction || '').toString().trim().toLowerCase();
    const cat = (category || '').toString().trim().toLowerCase();
    if (!jur) return jur;
    if (cat === 'place' || cat === 'courts' || cat === 'jurisdictions') return jur;
    if (ds.startsWith('auto-')) {
      const root = this._jurisdictionRootFromFilename(ds) || 'us';
      if (jur === root && root !== 'us') return 'us';
    }
    return jur;
  }

  _getJurisdictionOverrideValue(id) {
    if (!id) return null;
    const parts = id.split('::');
    if (parts.length < 4) return null;
    const ds = parts.shift();
    const inner = parts.join('::');
    const bucket = this._userJurisdictionOverrides?.[ds];
    if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, inner)) return null;
    return bucket[inner];
  }

  _collectXDataRows(rows, dataset, xdata) {
    if (!xdata || typeof xdata !== 'object') return;
    for (const [jurisdiction, byCategory] of Object.entries(xdata)) {
      if (!byCategory || typeof byCategory !== 'object') continue;
      for (const [category, entries] of Object.entries(byCategory)) {
        if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
        for (const [key, value] of Object.entries(entries)) {
          if (value == null) continue;
          const row = {
            dataset,
            jurisdiction: String(jurisdiction),
            category: String(category),
            key: String(key),
            value: String(value),
          };
          row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
          rows.push(row);
        }
      }
    }
  }

  _collectJurisMapRows(rows, mapInfo = this._jurisUSMap) {
    const mapData = mapInfo?.data || mapInfo || this._jurisUSMap;
    const dataset = mapInfo?.dataset || this._defaultMapDataset || 'juris-us-map';
    const courts = mapData?.courts;
    if (Array.isArray(courts)) {
      for (const item of courts) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const code = String(item[0] ?? '').trim();
        const name = String(item[1] ?? '').trim();
        if (!code || !name) continue;
        const row = {
          dataset,
          jurisdiction: 'default',
          category: 'courts',
          key: code,
          value: name,
        };
        row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
        rows.push(row);
      }
    }

    const jurisdictions = this._getLocalizedMapJurisdictions(mapData);
    if (Array.isArray(jurisdictions)) {
      for (const item of jurisdictions) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const code = String(item[0] ?? '').trim();
        const name = String(item[1] ?? '').trim();
        if (!code || !name) continue;
        const row = {
          dataset,
          jurisdiction: 'default',
          category: 'jurisdictions',
          key: code,
          value: name,
        };
        row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
        rows.push(row);
      }
    }
  }

  _collectOverrideOnlyJurisdictionRows(rows, allowedDataset = null) {
    const seen = new Set(rows.map((row) => row.id).filter(Boolean));
    const normalizedAllowedDataset = allowedDataset ? this._normalizeJurisdictionDatasetName(allowedDataset) : null;

    for (const [dataset, bucket] of Object.entries(this._userJurisdictionOverrides || {})) {
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
      if (normalizedAllowedDataset && dataset !== normalizedAllowedDataset) continue;

      for (const [overrideKey, overrideValue] of Object.entries(bucket)) {
        const parsed = this._parseJurisdictionDatasetOverrideKey(overrideKey);
        if (!parsed) continue;
        const mappedJurisdiction = this._normalizeListedOverrideJurisdiction(dataset, parsed.jurisdiction, parsed.category);

        const id = this._makeJurisdictionOverrideID(dataset, mappedJurisdiction, parsed.category, parsed.key);
        if (!id || seen.has(id)) continue;

        rows.push({
          dataset: String(dataset),
          jurisdiction: mappedJurisdiction,
          category: parsed.category,
          key: parsed.key,
          value: String(overrideValue),
          id,
        });
        seen.add(id);
      }
    }
  }

  _parseJurisdictionDatasetOverrideKey(overrideKey) {
    const parts = String(overrideKey || '').split('::');
    if (parts.length < 3) return null;

    const jurisdiction = String(parts[0] || '').trim();
    const category = String(parts[1] || '').trim();
    const key = String(parts.slice(2).join('::') || '').trim();
    if (!jurisdiction || !category || !key) return null;

    return { jurisdiction, category, key };
  }

  _normalizeListedOverrideJurisdiction(dataset, jurisdiction, category) {
    const ds = (dataset || '').toString().trim().toLowerCase();
    const jur = (jurisdiction || '').toString().trim().toLowerCase();
    const cat = (category || '').toString().trim().toLowerCase();
    if (!jur) return jur;
    if (cat === 'place' || cat === 'courts' || cat === 'jurisdictions') return jur;
    if (ds.startsWith('auto-')) {
      const root = this._jurisdictionRootFromFilename(ds) || 'us';
      if (jur === 'us' && root !== 'us') return root;
    }
    return jur;
  }

  _loadJurisdictionOverrides() {
    try {
      const raw = Zotero?.Prefs?.get?.(this._jurisdictionOverridesPref);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const cleaned = {};
      for (const [dataset, bucket] of Object.entries(parsed)) {
        const ds = (dataset || '').toString().trim();
        if (!ds || !bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
        const outBucket = {};
        for (const [id, value] of Object.entries(bucket)) {
          const key = (id || '').toString().trim();
          const val = (value || '').toString().trim();
          if (!key || !val) continue;
          outBucket[key] = val;
        }
        cleaned[ds] = outBucket;
      }
      return cleaned;
    } catch (e) {
      return {};
    }
  }

  _saveJurisdictionOverrides() {
    try {
      Zotero?.Prefs?.set?.(this._jurisdictionOverridesPref, JSON.stringify(this._userJurisdictionOverrides || {}));
    } catch (e) {}
  }

  _lookupSupplementalWord(normalized) {
    const supplemental = {
      'association': 'Ass’n',
      'broadcasting': 'Broad.',
      'company': 'Co.',
      'companies': 'Cos.',
      'corporation': 'Corp.',
      'corporations': 'Corps.',
      'incorporated': 'Inc.',
      'international': 'Int’l',
      'limited': 'Ltd.',
      'ltd': 'Ltd.',
      'online': 'Online',
      'production': 'Prod.',
      'productions': 'Prods.',
      'professional': 'Pro.',
      'public': 'Pub.',
      'services': 'Servs.',
      'service': 'Serv.',
      'technology': 'Tech.',
      'technologies': 'Techs.',
      'university': 'U.',
    };

    const value = supplemental[normalized] || null;
    return value ? { jurisdiction: 'default', value } : null;
  }

  _lookupInstitutionCategoryValue(category, rawKey, normalizedKey, jurisdiction, xdata, overrides) {
    const categoryName = String(category || '').trim().toLowerCase();
    if (!categoryName || !xdata) return null;

    const lookupKeys = [];
    for (const candidate of [rawKey, normalizedKey]) {
      const value = String(candidate || '').trim();
      if (value && !lookupKeys.includes(value)) {
        lookupKeys.push(value);
      }
    }

    for (const lookupKey of lookupKeys) {
      const hit = lookupJurChainWithOverrides(
        xdata,
        overrides,
        jurisdiction,
        categoryName,
        lookupKey,
      );
      if (hit?.value != null) return hit;
    }

    return null;
  }
}

function lookupJurChain(xdata, jur, variable, key) {
  return lookupJurChainWithSource(xdata, jur, variable, key)?.value || null;
}

function lookupJurChainWithSource(xdata, jur, variable, key) {
  if (!xdata) return null;
  const parts = (jur || 'us').toLowerCase().split(':');
  for (let i = parts.length; i >= 1; i--) {
    const jj = parts.slice(0, i).join(':');
    const obj = xdata?.[jj]?.[variable];
    if (obj && obj[key] != null) return { jurisdiction: jj, value: obj[key] };
  }
  const obj = xdata?.['us']?.[variable];
  if (obj && obj[key] != null) return { jurisdiction: 'us', value: obj[key] };
  return null;
}

function lookupJurChainWithOverrides(xdata, overrides, jur, variable, key) {
  if (!xdata) return null;
  const parts = (jur || 'us').toLowerCase().split(':');
  for (let i = parts.length; i >= 1; i--) {
    const jj = parts.slice(0, i).join(':');
    const overrideKey = `${jj}::${variable}::${String(key ?? '')}`;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, overrideKey)) {
      return { jurisdiction: jj, value: overrides[overrideKey] };
    }
    if (jj === 'us') {
      const defaultOverrideKey = `default::${variable}::${String(key ?? '')}`;
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, defaultOverrideKey)) {
        return { jurisdiction: 'us', value: overrides[defaultOverrideKey] };
      }
    }
    const obj = xdata?.[jj]?.[variable];
    if (obj && obj[key] != null) return { jurisdiction: jj, value: obj[key] };
  }
  const usOverrideKey = `us::${variable}::${String(key ?? '')}`;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, usOverrideKey)) {
    return { jurisdiction: 'us', value: overrides[usOverrideKey] };
  }
  const defaultOverrideKey = `default::${variable}::${String(key ?? '')}`;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, defaultOverrideKey)) {
    return { jurisdiction: 'us', value: overrides[defaultOverrideKey] };
  }
  const obj = xdata?.['us']?.[variable];
  if (obj && obj[key] != null) return { jurisdiction: 'us', value: obj[key] };
  return null;
}

function trimJurisdictionChain(jurisdiction) {
  const parts = (jurisdiction || 'us').toLowerCase().split(':').filter(Boolean);
  const chain = [];
  for (let i = parts.length; i >= 1; i -= 1) {
    chain.push(parts.slice(0, i).join(':'));
  }
  if (!chain.includes('us')) chain.push('us');
  return chain;
}
