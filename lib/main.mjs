import { DataStore } from './services/dataStore.mjs';
import { ModuleLoader } from './services/moduleLoader.mjs';
import { AbbrevService } from './services/abbrevService.mjs';
import { Jurisdiction } from './services/jurisdiction.mjs';
import { Patcher } from './services/patcher.mjs';
import { PrefsUI } from './services/prefsUI.mjs';
import { CaseCourtMapper } from './services/caseCourtMapper.mjs';
import { SchemaConfig } from './services/schemaConfig.mjs';

let _ctx;
const COMMENTER_INFO_ROW_IDS = [
  'citation-phoenix-commenter-row',
  'indigobook-cslm-commenter-row',
];

const BUNDLED_TRANSLATOR_FILES = [
  'Lexis+.js',
  'Westlaw.js',
];

function _extractStyleID(styleXML) {
  if (!styleXML) return '';
  const match = styleXML.match(/<id>\s*([^<]+?)\s*<\/id>/i);
  return match ? String(match[1]).trim() : '';
}

function _extractStyleUpdated(styleXML) {
  if (!styleXML) return '';
  const match = styleXML.match(/<updated>\s*([^<]+?)\s*<\/updated>/i);
  return match ? String(match[1]).trim() : '';
}

function _styleUpdatedMillis(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const millis = Date.parse(raw);
  return Number.isFinite(millis) ? millis : null;
}

function _styleInstallSourceURL(rootURI, relPath) {
  const base = rootURI?.spec || '';
  return base ? `${base}${relPath}` : relPath;
}

function _diagnostic(message) {
  try { Zotero.debug(message); } catch (e) {}
  try { Zotero.logError(message); } catch (e) {}
}

async function _readInstalledStyleXML(installedStyle) {
  const path = installedStyle?.file?.path || installedStyle?.path || '';
  if (!path) return '';

  try {
    if (typeof IOUtils?.readUTF8 === 'function') {
      return await IOUtils.readUTF8(path);
    }
  } catch (e) {}

  try {
    if (typeof Zotero?.File?.getContentsAsync === 'function') {
      return await Zotero.File.getContentsAsync(path);
    }
  } catch (e) {}

  return '';
}

async function _getInstalledStyleUpdatedMillis(installedStyle) {
  for (const value of [
    installedStyle?.updated,
    installedStyle?.styleUpdated,
    installedStyle?.data?.updated,
  ]) {
    const millis = _styleUpdatedMillis(value);
    if (millis != null) return millis;
  }

  const styleXML = await _readInstalledStyleXML(installedStyle);
  return _styleUpdatedMillis(_extractStyleUpdated(styleXML));
}

async function _installStyleFileFallback({ styleXML, styleID, filename, force = false }) {
  const stylesDir = Zotero?.getStylesDirectory?.();
  if (!stylesDir || !filename || !styleXML || typeof IOUtils?.writeUTF8 !== 'function') {
    return false;
  }

  const destFile = stylesDir.clone();
  destFile.append(filename);
  if (destFile.exists() && !force) {
    try { Zotero.debug(`[Citation Phoenix] style fallback skipped (file exists): ${filename}`); } catch (e) {}
    return !!Zotero?.Styles?.get?.(styleID);
  }

  await IOUtils.writeUTF8(destFile.path, styleXML);
  await Zotero?.Styles?.reinit?.();

  return !!Zotero?.Styles?.get?.(styleID);
}

async function _ensureStylesLoaded() {
  const styles = Zotero?.Styles;
  if (!styles) return false;
  if (typeof styles.initialized === 'function' && styles.initialized()) return true;
  if (typeof styles.init === 'function') {
    await styles.init();
    return typeof styles.initialized !== 'function' || styles.initialized();
  }
  return true;
}

function _unregisterCommenterInfoRows() {
  try {
    const manager = Zotero?.ItemPaneManager;
    if (typeof manager?.unregisterInfoRow !== 'function') return;

    const rowData = manager.customInfoRowData;
    const optionsCache = manager._infoRowManager?._optionsCache;
    const hasRegistry = !!rowData || !!optionsCache;

    for (const rowID of COMMENTER_INFO_ROW_IDS) {
      const isRegistered = !!rowData?.[rowID] || !!optionsCache?.[rowID];
      if (hasRegistry && !isRegistered) continue;
      manager.unregisterInfoRow(rowID);
    }
  } catch (e) {}
}

async function _installStyleIfMissing({ rootURI, dataStore, relPath }) {
  const styleXML = await dataStore.loadText(relPath);
  const styleID = _extractStyleID(styleXML);
  const bundledUpdatedMillis = _styleUpdatedMillis(_extractStyleUpdated(styleXML));
  if (!styleID) {
    try { Zotero.debug(`[Citation Phoenix] style install skipped (missing id): ${relPath}`); } catch (e) {}
    return;
  }

  await _ensureStylesLoaded();
  const installedStyle = Zotero?.Styles?.get?.(styleID);
  if (installedStyle) {
    const installedUpdatedMillis = await _getInstalledStyleUpdatedMillis(installedStyle);
    const shouldUpdate = bundledUpdatedMillis != null
      && (installedUpdatedMillis == null || bundledUpdatedMillis > installedUpdatedMillis);

    if (!shouldUpdate) {
      try { Zotero.debug(`[Citation Phoenix] style already up to date: ${styleID}`); } catch (e) {}
      return;
    }

    try { Zotero.debug(`[Citation Phoenix] updating installed style: ${styleID}`); } catch (e) {}
  }

  const installFn = Zotero?.Styles?.install;
  if (typeof installFn !== 'function') {
    try { Zotero.debug(`[Citation Phoenix] style install unavailable (no Zotero.Styles.install): ${styleID}`); } catch (e) {}
    return;
  }

  const sourceURL = _styleInstallSourceURL(rootURI, relPath);
  let installed = false;

  // Install using XML payload so Zotero never attempts to fetch the bundled URL.
  try {
    await installFn.call(Zotero.Styles, styleXML, sourceURL, true);
    installed = !!Zotero?.Styles?.get?.(styleID);
  } catch (e) {}

  if (!installed) {
    try {
      installed = await _installStyleFileFallback({
        styleXML,
        styleID,
        filename: relPath.split('/').pop(),
        force: !!installedStyle,
      });
    } catch (e) {}
  }

  try {
    Zotero.debug(`[Citation Phoenix] style ${installed ? 'installed' : 'install failed'}: ${styleID}`);
  } catch (e) {}
}

async function _ensureBundledStylesInstalled({ rootURI, dataStore }) {
  let files = null;
  try {
    files = await dataStore.loadJSON('styles/index.json');
  } catch (e) {
    try { Zotero.debug(`[Citation Phoenix] style install skipped (styles/index.json unavailable): ${String(e)}`); } catch (_) {}
    return;
  }

  if (!Array.isArray(files) || !files.length) {
    try { Zotero.debug('[Citation Phoenix] style install skipped (styles/index.json empty or invalid)'); } catch (e) {}
    return;
  }

  try {
    await _ensureStylesLoaded();
  } catch (e) {
    try { Zotero.debug(`[Citation Phoenix] style install skipped (Zotero styles unavailable): ${String(e)}`); } catch (_) {}
    return;
  }

  for (const file of files) {
    const relPath = `styles/${file}`;
    try {
      await _installStyleIfMissing({ rootURI, dataStore, relPath });
    } catch (e) {
      try { Zotero.debug(`[Citation Phoenix] style install error (${relPath}): ${String(e)}`); } catch (_) {}
    }
  }
}

function _extractTranslatorMetadata(code) {
  // Translator files begin with a bare JSON object on its own lines before any JS code.
  const match = code.match(/^\s*(\{[\s\S]*?\})\s*(?=\n[^}]|\nfunction|\nvar |\nconst |\nlet |\/\*)/m);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch (e) { return null; }
}

function _translatorUpdatedMillis(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T');
  const millis = Date.parse(normalized);
  return Number.isFinite(millis) ? millis : null;
}

async function _ensureTranslatorsLoaded() {
  const translators = Zotero?.Translators;
  if (!translators) return false;
  if (typeof translators.init === 'function') {
    await translators.init();
  }
  return true;
}

async function _getInstalledTranslator(translatorID) {
  try {
    await _ensureTranslatorsLoaded();
    const getFn = Zotero?.Translators?.get;
    if (typeof getFn !== 'function') return null;
    return await getFn.call(Zotero.Translators, translatorID);
  } catch (e) {
    return null;
  }
}

async function _installTranslatorIfMissing({ dataStore, relPath }) {
  const code = await dataStore.loadText(relPath);
  const metadata = _extractTranslatorMetadata(code);
  if (!metadata?.translatorID) {
    try { Zotero.debug(`[Citation Phoenix] translator install skipped (missing translatorID): ${relPath}`); } catch (e) {}
    return;
  }

  const installedTranslator = await _getInstalledTranslator(metadata.translatorID);
  if (installedTranslator) {
    const bundledUpdatedMillis = _translatorUpdatedMillis(metadata.lastUpdated);
    const installedUpdatedMillis = _translatorUpdatedMillis(installedTranslator.lastUpdated);
    const shouldUpdate = bundledUpdatedMillis != null
      && (installedUpdatedMillis == null || bundledUpdatedMillis > installedUpdatedMillis);

    if (!shouldUpdate) {
      try { Zotero.debug(`[Citation Phoenix] translator already up to date: ${metadata.label}`); } catch (e) {}
      return;
    }

    try { Zotero.debug(`[Citation Phoenix] updating installed translator: ${metadata.label}`); } catch (e) {}
  }

  const saveFn = Zotero?.Translators?.save;
  if (typeof saveFn !== 'function') {
    try { Zotero.debug(`[Citation Phoenix] translator install unavailable (no Zotero.Translators.save): ${metadata.label}`); } catch (e) {}
    return;
  }

  let installed = false;
  try {
    await saveFn.call(Zotero.Translators, metadata, code);
    installed = !!(await _getInstalledTranslator(metadata.translatorID));
  } catch (e) {
    try { Zotero.debug(`[Citation Phoenix] translator install error (${metadata.label}): ${String(e)}`); } catch (_) {}
  }

  try {
    Zotero.debug(`[Citation Phoenix] translator ${installed ? 'installed' : 'install failed'}: ${metadata.label}`);
  } catch (e) {}
}

async function _ensureBundledTranslatorsInstalled({ dataStore }) {
  for (const file of BUNDLED_TRANSLATOR_FILES) {
    const relPath = `translators/${file}`;
    try {
      await _installTranslatorIfMissing({ dataStore, relPath });
    } catch (e) {
      try { Zotero.debug(`[Citation Phoenix] translator install error (${relPath}): ${String(e)}`); } catch (_) {}
    }
  }
}

export async function activate({ id, version, rootURI }) {
  _diagnostic(`[Citation Phoenix] activate begin id=${String(id)} version=${String(version)}`);
  const locale = Zotero?.locale || 'en-US';
  _ctx = {
    id, version, rootURI,
    data: new DataStore(rootURI),
    modules: null,
    abbrevs: null,
    caseCourtMapper: null,
    schemaConfig: null,
    patcher: null,
    prefsUI: null,
  };

  await _ctx.data.init();
  await _ensureBundledStylesInstalled({ rootURI, dataStore: _ctx.data });
  await _ensureBundledTranslatorsInstalled({ dataStore: _ctx.data });
  _ctx.modules = new ModuleLoader({ rootURI, dataStore: _ctx.data, locale });
  await _ctx.modules.preload();

  _ctx.abbrevs = new AbbrevService({ dataStore: _ctx.data, locale });
  await _ctx.abbrevs.preload();

  _ctx.caseCourtMapper = new CaseCourtMapper({ dataStore: _ctx.data, locale });
  await _ctx.caseCourtMapper.preload();

  _ctx.schemaConfig = new SchemaConfig({ dataStore: _ctx.data });
  await _ctx.schemaConfig.preload();

  _ctx.patcher = new Patcher({
    pluginID: id,
    moduleLoader: _ctx.modules,
    abbrevService: _ctx.abbrevs,
    jurisdiction: Jurisdiction,
    caseCourtMapper: _ctx.caseCourtMapper,
    schemaConfig: _ctx.schemaConfig,
  });
  _ctx.patcher.patch();

  _ctx.prefsUI = new PrefsUI({
    pluginID: id,
    rootURI,
  });
  await _ctx.prefsUI.register();
  _unregisterCommenterInfoRows();
  try { delete Zotero.CitationPhoenixCommenterRowID; } catch (e) {}
  try { delete Zotero.IndigoBookCSLMCommenterRowID; } catch (e) {}

  Zotero.CitationPhoenixBridge = {
    listPrimaryDatasetOptions() {
      return _ctx?.abbrevs?.listPrimaryDatasetOptions?.() || [];
    },
    listSecondaryDatasetOptions() {
      return _ctx?.abbrevs?.listSecondaryDatasetOptions?.() || [];
    },
    listJurisdictionDatasetOptions() {
      return _ctx?.abbrevs?.listJurisdictionDatasetOptions?.() || [];
    },
    listPrimaryAbbreviations(dataset = 'primary-us') {
      return _ctx?.abbrevs?.listPrimaryAbbreviations?.(dataset) || [];
    },
    listSecondaryAbbreviations(dataset = 'secondary-us-bluebook') {
      return _ctx?.abbrevs?.listSecondaryContainerTitleAbbreviations?.(dataset) || [];
    },
    upsertSecondaryAbbreviation(datasetOrKey, keyOrValue, maybeValue) {
      const hasDataset = typeof maybeValue !== 'undefined';
      const dataset = hasDataset ? datasetOrKey : 'secondary-us-bluebook';
      const key = hasDataset ? keyOrValue : datasetOrKey;
      const value = hasDataset ? maybeValue : keyOrValue;
      return !!_ctx?.abbrevs?.upsertSecondaryContainerTitleAbbreviation?.(dataset, key, value);
    },
    removeSecondaryAbbreviation(datasetOrKey, maybeKey) {
      const hasDataset = typeof maybeKey !== 'undefined';
      const dataset = hasDataset ? datasetOrKey : 'secondary-us-bluebook';
      const key = hasDataset ? maybeKey : datasetOrKey;
      return !!_ctx?.abbrevs?.removeSecondaryContainerTitleAbbreviation?.(dataset, key);
    },
    resetSecondaryAbbreviations(dataset = 'secondary-us-bluebook') {
      _ctx?.abbrevs?.resetSecondaryContainerTitleOverrides?.(dataset);
      return true;
    },
    upsertPrimaryAbbreviation(dataset, jurisdiction, category, key, value) {
      return !!_ctx?.abbrevs?.upsertPrimaryAbbreviation?.(dataset, jurisdiction, category, key, value);
    },
    removePrimaryAbbreviation(dataset, jurisdiction, category, key) {
      return !!_ctx?.abbrevs?.removePrimaryAbbreviation?.(dataset, jurisdiction, category, key);
    },
    resetPrimaryAbbreviations(dataset = 'primary-us') {
      _ctx?.abbrevs?.resetPrimaryAbbreviations?.(dataset);
      return true;
    },
    listJurisdictionPreferenceEntries(dataset = null) {
      return _ctx?.abbrevs?.listJurisdictionPreferenceEntries?.(dataset) || [];
    },
    upsertJurisdictionPreferenceEntry(dataset, jurisdiction, category, key, value) {
      return !!_ctx?.abbrevs?.upsertJurisdictionPreferenceEntry?.(dataset, jurisdiction, category, key, value);
    },
    removeJurisdictionPreferenceEntry(dataset, jurisdiction, category, key) {
      return !!_ctx?.abbrevs?.removeJurisdictionPreferenceEntry?.(dataset, jurisdiction, category, key);
    },
    resetJurisdictionPreferenceOverrides(dataset = null) {
      _ctx?.abbrevs?.resetJurisdictionPreferenceOverrides?.(dataset);
      return true;
    },
    importOverrides(kind, dataset, payload) {
      return _ctx?.abbrevs?.importOverrides?.(kind, dataset, payload) || {
        added: 0,
        updated: 0,
        skipped: 0,
        error: 'Import bridge unavailable.',
        skipReasons: [],
      };
    },
  };
  Zotero.IndigoBookCSLMBridge = Zotero.CitationPhoenixBridge;

  _diagnostic(`[Citation Phoenix] activated v${version}`);
}

export async function deactivate() {
  try {
    _diagnostic('[Citation Phoenix] deactivate begin');
    try { delete Zotero.CitationPhoenixBridge; } catch (e) {}
    try { delete Zotero.IndigoBookCSLMBridge; } catch (e) {}
    _unregisterCommenterInfoRows();
    try { delete Zotero.CitationPhoenixCommenterRowID; } catch (e) {}
    try { delete Zotero.IndigoBookCSLMCommenterRowID; } catch (e) {}
    _ctx?.prefsUI?.unregister?.();
    _ctx?.patcher?.unpatch();
  } finally {
    _diagnostic('[Citation Phoenix] deactivate complete');
    _ctx = null;
  }
}
