(function () {
  let initialized = false;
  let initAttempts = 0;
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const JOURNAL_DATASET_PREFIX = 'journals:';
  const ABBREVIATION_DATASET_PREFIX = 'abbrev:';

  function byId(id) {
    return document.getElementById(id);
  }

  function createHTML(tagName) {
    return document.createElementNS(HTML_NS, tagName);
  }

  function debug(message) {
    try {
      Zotero.debug(`[IndigoBook CSL-M] ${message}`);
    } catch (_) {}
  }

  function getBridge() {
    return Zotero?.IndigoBookCSLMBridge || null;
  }

  function getDatasetSelection() {
    const raw = (byId('ibcslm-dataset')?.value || '').toString();
    const parts = raw.split(':');
    if (parts.length < 2) {
      const options = getDatasetOptions();
      const defaultValue = options.find((row) => row.kind === 'jurisdiction' && row.isDefault)?.value
        || options.find((row) => row.isDefault)?.value
        || options[0]?.value
        || `${JOURNAL_DATASET_PREFIX}secondary-us-bluebook`;
      const fallbackParts = defaultValue.split(':');
      return {
        kind: fallbackParts[0] || 'journals',
        dataset: fallbackParts.slice(1).join(':') || 'secondary-us-bluebook',
      };
    }
    const kind = parts[0];
    const dataset = parts.slice(1).join(':');
    return { kind, dataset };
  }

  function getSecondaryDatasetOptions() {
    const bridge = getBridge();
    const rows = bridge?.listSecondaryDatasetOptions?.() || [];
    if (Array.isArray(rows) && rows.length) return rows;
    return [
      { dataset: 'secondary-us-bluebook', label: 'Bluebook (US)', isDefault: true },
    ];
  }

  function getPrimaryDatasetOptions() {
    const bridge = getBridge();
    const rows = bridge?.listPrimaryDatasetOptions?.() || [];
    if (Array.isArray(rows) && rows.length) return rows;
    return [
      { dataset: 'primary-us', label: 'Primary legal sources for US jurisdictions', isDefault: true },
    ];
  }

  function getDatasetOptions() {
    const abbreviationOptions = getPrimaryDatasetOptions().map((row) => ({
      value: `${ABBREVIATION_DATASET_PREFIX}${row.dataset}`,
      label: `Abbreviations: ${row.label || row.dataset}`,
      kind: 'abbrev',
      dataset: row.dataset,
      isDefault: !!row.isDefault,
    }));
    const journalOptions = getSecondaryDatasetOptions().map((row) => ({
      value: `${JOURNAL_DATASET_PREFIX}${row.dataset}`,
      label: `Journals: ${row.label || row.dataset}`,
      kind: 'journals',
      dataset: row.dataset,
      isDefault: !!row.isDefault,
    }));
    const bridge = getBridge();
    const jurisdictionOptions = bridge?.listJurisdictionDatasetOptions?.() || [];

    return abbreviationOptions.concat(journalOptions, jurisdictionOptions.map((row) => ({
      value: row.value || `jurisdiction:${row.dataset}`,
      label: row.label || row.dataset,
      kind: 'jurisdiction',
      dataset: row.dataset || String(row.value || '').split(':').slice(1).join(':'),
      isDefault: !!row.isDefault,
    })));
  }

  function isJournalMode() {
    const kind = getDatasetSelection().kind;
    return kind === 'journals' || kind === 'abbrev';
  }

  function hasPaneDOM() {
    return !!byId('ibcslm-prefpane') && !!byId('ibcslm-body') && !!byId('ibcslm-dataset');
  }

  function setStatus(message, isError) {
    const el = byId('ibcslm-status');
    if (!el) return;
    el.textContent = message || '';
    el.style.color = isError ? '#a40000' : '';
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read import file.'));
      reader.readAsText(file);
    });
  }

  function formatSkipReason(reason) {
    const labels = {
      blank_key_or_value: 'blank key or value',
      invalid_category_block: 'invalid category block',
      invalid_entries_block: 'invalid entries block',
      invalid_override_key: 'invalid override key',
      outside_selected_dataset_scope: 'outside selected dataset scope',
      unchanged: 'already matched existing value',
      unsupported_category: 'unsupported category',
    };
    return labels[reason] || reason.replace(/_/g, ' ');
  }

  function formatImportSummary(result, selection) {
    const parts = [
      `Imported into ${selection.dataset}: ${result.added} added`,
      `${result.updated} updated`,
      `${result.skipped} skipped`,
    ];
    if (result.error) {
      return result.error;
    }
    return `${parts.join(', ')}.`;
  }

  function describeImportSkips(result) {
    const reasons = Array.isArray(result?.skipReasons) ? result.skipReasons : [];
    if (!reasons.length) return '';
    return reasons.map((entry) => {
      const examples = Array.isArray(entry.examples) && entry.examples.length
        ? ` Examples: ${entry.examples.join('; ')}`
        : '';
      return `${formatSkipReason(entry.reason)} (${entry.count}).${examples}`;
    }).join('\n');
  }

  function showImportResultDialog(message) {
    const text = String(message || '').trim();
    if (!text) return;
    try {
      const promptService = Components?.classes?.['@mozilla.org/embedcomp/prompt-service;1']
        ?.getService?.(Components.interfaces.nsIPromptService);
      if (promptService?.alert) {
        promptService.alert(window, 'Phoenix Import', text);
        return;
      }
    } catch (_) {}

    try {
      window.alert(text);
    } catch (_) {
      setStatus(text, false);
    }
  }

  function applyModeClass() {
    const root = byId('ibcslm-prefpane');
    if (!root) return;
    root.classList.toggle('mode-journal', isJournalMode());

    const search = byId('ibcslm-search');
    if (search) {
      search.placeholder = isJournalMode()
        ? 'Filter abbreviations'
        : 'Filter jurisdiction rows';
    }
  }

  function populateDatasetOptions() {
    const select = byId('ibcslm-dataset');
    if (!select) return;

    const currentValue = select.value;
    const options = getDatasetOptions();
    const fallbackValue = options.find((row) => row.kind === 'jurisdiction' && row.isDefault)?.value
      || options.find((row) => row.isDefault)?.value
      || options[0]?.value
      || '';

    select.textContent = '';
    for (const row of options) {
      const option = createHTML('option');
      option.value = row.value;
      option.textContent = row.label || row.value;
      select.appendChild(option);
    }

    const hasCurrentValue = options.some((row) => row.value === currentValue);
    select.value = hasCurrentValue ? currentValue : fallbackValue;
  }

  function getAllRowsForSelectedDataset() {
    const bridge = getBridge();
    if (!bridge) return [];
    const selection = getDatasetSelection();

    if (selection.kind === 'journals') {
      const rows = bridge.listSecondaryAbbreviations?.(selection.dataset) || [];
      return rows.map((row) => ({
        kind: 'journals',
        dataset: selection.dataset,
        jurisdiction: '',
        category: 'container-title',
        key: row.key,
        value: row.value,
        source: row.source,
      }));
    }

    if (selection.kind === 'abbrev') {
      const rows = bridge.listPrimaryAbbreviations?.(selection.dataset) || [];
      return rows.map((row) => ({
        kind: 'abbrev',
        dataset: selection.dataset,
        jurisdiction: row.jurisdiction || 'us',
        category: row.category || '',
        key: row.key,
        value: row.value,
        source: row.source,
      }));
    }

    return (bridge.listJurisdictionPreferenceEntries?.(selection.dataset) || [])
      .map((row) => ({ ...row, kind: 'jurisdiction' }));
  }

  function getFilteredRows() {
    const all = getAllRowsForSelectedDataset();
    const q = (byId('ibcslm-search')?.value || '').trim().toLowerCase();
    if (!q) return all;
    return all.filter((row) => {
      return String(row.jurisdiction || '').toLowerCase().includes(q)
        || String(row.category || '').toLowerCase().includes(q)
        || String(row.key || '').toLowerCase().includes(q)
        || String(row.value || '').toLowerCase().includes(q)
        || String(row.source || '').toLowerCase().includes(q);
    });
  }

  function getCellCurrentValue(td, fallback) {
    const activeInput = td.querySelector('input');
    if (activeInput) return activeInput.value;
    const activeButton = td.querySelector('button');
    if (activeButton) return activeButton.textContent || '';
    return fallback || '';
  }

  function saveRowValue(row, value) {
    const bridge = getBridge();
    if (!bridge) return false;

    if (row.kind === 'journals') {
      return !!bridge.upsertSecondaryAbbreviation?.(row.dataset, row.key, value);
    }

    if (row.kind === 'abbrev') {
      return !!bridge.upsertPrimaryAbbreviation?.(
        row.dataset,
        row.jurisdiction,
        row.category,
        row.key,
        value,
      );
    }

    return !!bridge.upsertJurisdictionPreferenceEntry?.(
      row.dataset,
      row.jurisdiction,
      row.category,
      row.key,
      value,
    );
  }

  function removeRowOverride(row) {
    const bridge = getBridge();
    if (!bridge) return false;

    if (row.kind === 'journals') {
      return !!bridge.removeSecondaryAbbreviation?.(row.dataset, row.key);
    }

    if (row.kind === 'abbrev') {
      return !!bridge.removePrimaryAbbreviation?.(
        row.dataset,
        row.jurisdiction,
        row.category,
        row.key,
      );
    }

    return !!bridge.removeJurisdictionPreferenceEntry?.(
      row.dataset,
      row.jurisdiction,
      row.category,
      row.key,
    );
  }

  function makeValueEditorCell(row) {
    const tdVal = createHTML('td');
    tdVal.className = 'cell-value';

    const valueButton = createHTML('button');
    valueButton.type = 'button';
    valueButton.className = 'ibcslm-inline-value';
    valueButton.textContent = row.value || '';
    valueButton.title = 'Click to edit value';

    const startEdit = () => {
      tdVal.textContent = '';
      const input = createHTML('input');
      input.type = 'text';
      input.value = row.value || '';
      input.className = 'ibcslm-inline-input';

      const finish = (commit) => {
        if (!tdVal.contains(input)) return;
        if (!commit) {
          tdVal.textContent = '';
          tdVal.appendChild(valueButton);
          return;
        }
        const ok = saveRowValue(row, input.value);
        setStatus(ok ? 'Saved.' : 'Could not save value.', !ok);
        if (ok) refresh();
        if (!ok) {
          input.focus();
          input.select();
        }
      };

      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true), { once: true });

      tdVal.appendChild(input);
      input.focus();
      input.select();
    };

    valueButton.addEventListener('click', startEdit);
    tdVal.appendChild(valueButton);
    return tdVal;
  }

  function renderRows(rows) {
    const tbody = byId('ibcslm-body');
    if (!tbody) return;
    tbody.textContent = '';

    for (const row of rows) {
      const tr = createHTML('tr');

      const tdJur = createHTML('td');
      tdJur.className = 'cell-jur';
      tdJur.textContent = row.jurisdiction || '';

      const tdCat = createHTML('td');
      tdCat.className = 'cell-cat';
      tdCat.textContent = row.category || '';

      const tdKey = createHTML('td');
      tdKey.className = 'ibcslm-key';
      tdKey.textContent = row.key || '';

      const tdVal = makeValueEditorCell(row);

      const tdActions = createHTML('td');
      const btn = createHTML('button');
      btn.type = 'button';
      btn.textContent = row.source === 'user' ? 'Revert' : 'Override';
      btn.addEventListener('click', () => {
        if (row.source === 'user') {
          const ok = removeRowOverride(row);
          setStatus(ok ? 'Override removed.' : 'Could not remove override.', !ok);
          if (ok) refresh();
          return;
        }

        const currentValue = getCellCurrentValue(tdVal, row.value);
        const ok = saveRowValue(row, currentValue);
        setStatus(ok ? 'Override saved.' : 'Could not save override.', !ok);
        if (ok) refresh();
      });
      tdActions.appendChild(btn);

      tr.appendChild(tdJur);
      tr.appendChild(tdCat);
      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    }

    debug(`prefs pane rendered ${rows.length} rows`);
  }

  function setAddDefaults() {
    const jurEl = byId('ibcslm-j-jur');
    const catEl = byId('ibcslm-j-cat');
    if (!jurEl || !catEl) return;

    const selection = getDatasetSelection();
    if (selection.kind === 'journals') {
      jurEl.value = '';
      catEl.value = '';
      return;
    }

    if (selection.kind === 'abbrev') {
      if (!jurEl.value) jurEl.value = 'us';
      if (!catEl.value) catEl.value = 'container-title';
      return;
    }

    if (selection.dataset.startsWith('auto-')) {
      if (!jurEl.value) jurEl.value = 'default';
      if (!catEl.value) catEl.value = 'place';
      return;
    }

    if (selection.dataset.startsWith('juris-') && selection.dataset.endsWith('-map')) {
      if (!jurEl.value) jurEl.value = 'default';
      if (!catEl.value) catEl.value = 'courts';
    }
  }

  function resetOverridesForCurrentDataset() {
    const bridge = getBridge();
    if (!bridge) return false;
    const selection = getDatasetSelection();

    if (selection.kind === 'journals') {
      bridge.resetSecondaryAbbreviations?.(selection.dataset);
      return true;
    }

    if (selection.kind === 'abbrev') {
      bridge.resetPrimaryAbbreviations?.(selection.dataset);
      return true;
    }

    bridge.resetJurisdictionPreferenceOverrides?.(selection.dataset);
    return true;
  }

  function refresh() {
    const bridge = getBridge();
    if (!bridge) {
      renderRows([]);
      setStatus('Bridge unavailable. Restart Zotero after installing/updating the plugin.', true);
      debug('prefs pane refresh failed: bridge unavailable');
      return;
    }

    populateDatasetOptions();
    applyModeClass();
    setAddDefaults();

    const rows = getFilteredRows();
    renderRows(rows);

    const selection = getDatasetSelection();
    const dsLabel = selection.kind === 'journals'
      ? `journals (${selection.dataset})`
      : selection.kind === 'abbrev'
        ? `abbreviations (${selection.dataset})`
      : `jurisdiction (${selection.dataset})`;

    if (!rows.length) {
      setStatus(`No rows matched in ${dsLabel}.`, false);
    } else {
      setStatus(`Loaded ${rows.length} rows from ${dsLabel}.`, false);
    }
  }

  function handleAddOrUpdate() {
    const bridge = getBridge();
    if (!bridge) return;

    const keyEl = byId('ibcslm-j-key');
    const valueEl = byId('ibcslm-j-value');
    const jurEl = byId('ibcslm-j-jur');
    const catEl = byId('ibcslm-j-cat');

    const key = keyEl?.value || '';
    const value = valueEl?.value || '';
    const jurisdiction = jurEl?.value || '';
    const category = catEl?.value || '';

    const selection = getDatasetSelection();
    let ok = false;

    if (selection.kind === 'journals') {
      ok = !!bridge.upsertSecondaryAbbreviation?.(selection.dataset, key, value);
      if (!ok) {
        setStatus('Enter both key and value for journal overrides.', true);
        return;
      }
    } else if (selection.kind === 'abbrev') {
      ok = !!bridge.upsertPrimaryAbbreviation?.(
        selection.dataset,
        jurisdiction,
        category,
        key,
        value,
      );
      if (!ok) {
        setStatus('Enter jurisdiction, category, key, and value.', true);
        return;
      }
    } else {
      ok = !!bridge.upsertJurisdictionPreferenceEntry?.(
        selection.dataset,
        jurisdiction,
        category,
        key,
        value,
      );
      if (!ok) {
        setStatus('Enter jurisdiction, category, key, and value.', true);
        return;
      }
    }

    if (keyEl) keyEl.value = '';
    if (valueEl) valueEl.value = '';
    if (selection.kind !== 'journals') {
      if (jurEl) jurEl.value = '';
      if (catEl) catEl.value = '';
    }

    setStatus('Value saved.', false);
    refresh();
  }

  async function handleImportSelection() {
    const fileInput = byId('ibcslm-import-file');
    const file = fileInput?.files?.[0];
    if (!file) return;

    const bridge = getBridge();
    const selection = getDatasetSelection();
    if (!bridge) {
      setStatus('Bridge unavailable. Restart Zotero after installing/updating the plugin.', true);
      return;
    }

    try {
      const rawText = await readFileAsText(file);
      let payload = null;
      try {
        payload = JSON.parse(rawText);
      } catch (error) {
        setStatus(`Could not parse JSON import file: ${String(error?.message || error)}`, true);
        return;
      }

      const result = bridge.importOverrides?.(selection.kind, selection.dataset, payload);
      if (!result || result.error) {
        setStatus(result?.error || 'Import failed.', true);
        return;
      }

      const summary = formatImportSummary(result, selection);
      const skipDetails = describeImportSkips(result);
      setStatus(summary, false);
      refresh();
      showImportResultDialog(skipDetails ? `${summary}\n\nSkipped items:\n${skipDetails}` : summary);
    } catch (error) {
      setStatus(`Import failed: ${String(error?.message || error)}`, true);
    } finally {
      if (fileInput) fileInput.value = '';
    }
  }

  function bindEvents() {
    byId('ibcslm-dataset')?.addEventListener('change', refresh);
    byId('ibcslm-search')?.addEventListener('input', refresh);
    byId('ibcslm-add')?.addEventListener('click', handleAddOrUpdate);
    byId('ibcslm-import')?.addEventListener('click', () => {
      const fileInput = byId('ibcslm-import-file');
      if (!fileInput) return;
      fileInput.value = '';
      fileInput.click();
    });
    byId('ibcslm-import-file')?.addEventListener('change', () => {
      handleImportSelection();
    });
    byId('ibcslm-reset')?.addEventListener('click', () => {
      const ok = resetOverridesForCurrentDataset();
      setStatus(ok ? 'Overrides reset.' : 'Could not reset overrides.', !ok);
      if (ok) refresh();
    });
  }

  function init() {
    if (initialized) return;
    if (!hasPaneDOM()) {
      debug(`prefs pane init deferred: DOM not ready (attempt ${initAttempts + 1})`);
      scheduleInit();
      return;
    }
    initialized = true;
    debug('prefs pane init');
    bindEvents();
    refresh();
  }

  function scheduleInit() {
    if (initialized) return;
    initAttempts += 1;
    if (initAttempts > 20) {
      debug('prefs pane init gave up waiting for DOM');
      return;
    }
    setTimeout(init, 50);
  }

  scheduleInit();
})();
