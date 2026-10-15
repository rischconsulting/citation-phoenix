/*
 * Citation Phoenix live Zotero InfoBox audit.
 *
 * Run this entire file from Zotero's Tools > Developer > Run JavaScript with
 * "Run as async function" enabled. Citation Phoenix must be installed and
 * enabled, and the library item pane must be visible. The test creates
 * temporary items in My Library and removes them when finished.
 *
 * Useful manual-review settings:
 *   itemTypes: ['case']  // test only selected effective types
 *   pauseMs: 3000        // leave each item visible for three seconds
 *   keepItems: true      // do not delete the generated test items
 */
return await (async () => {
  const options = {
    itemTypes: null,
    pauseMs: 100,
    renderTimeoutMs: 5000,
    keepItems: false,
    stopOnFailure: false,
  };

  const bridge = Zotero.CitationPhoenixBridge;
  if (typeof bridge?.getSchemaUIAuditSpec !== 'function') {
    throw new Error('Citation Phoenix UI audit bridge is unavailable. Install the newly built XPI and restart Zotero.');
  }

  const pane = Zotero.getActiveZoteroPane?.();
  if (!pane) throw new Error('No active Zotero library pane was found.');

  const delay = (ms) => Zotero.Promise.delay(Math.max(0, Number(ms) || 0));
  const waitFor = async (predicate, timeoutMs, description) => {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const value = predicate();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await delay(50);
    }
    throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError}` : ''}`);
  };

  const getInfoBox = () => {
    const itemDetails = pane.itemPane?._itemDetails
      || Zotero.getMainWindow?.()?.document?.querySelector?.('item-details');
    return itemDetails?.getPane?.('info')
      || Zotero.getMainWindow?.()?.document?.getElementById?.('zotero-editpane-info-box')
      || null;
  };

  const isVisibleRow = (row) => {
    if (!row || row.hidden || row.getAttribute?.('hidden') === 'true') return false;
    if (row.getAttribute?.('aria-hidden') === 'true') return false;
    if (String(row.style?.display || '').toLowerCase() === 'none') return false;
    for (let parent = row.parentElement; parent; parent = parent.parentElement) {
      if (parent.hidden || parent.getAttribute?.('hidden') === 'true') return false;
      if (String(parent.style?.display || '').toLowerCase() === 'none') return false;
    }
    return true;
  };

  const getRowField = (row) => {
    if (!row) return '';
    if (row.id === 'ibcslm-custom-court-row') return '';
    if (row.id === 'ibcslm-jurisdiction-row') return 'jurisdiction';

    const schemaField = String(row.getAttribute?.('data-ibcslm-schema-field') || '').trim();
    if (schemaField) return schemaField;

    const customRowID = String(row.getAttribute?.('data-custom-row-id') || '');
    const schemaMarker = 'ibcslm-schema-row-';
    const schemaMarkerIndex = customRowID.lastIndexOf(schemaMarker);
    if (schemaMarkerIndex >= 0) {
      return customRowID.slice(schemaMarkerIndex + schemaMarker.length).trim();
    }

    const label = row.querySelector?.('.meta-label[fieldname]');
    const fieldName = String(label?.getAttribute?.('fieldname') || '').trim();
    if (fieldName) return fieldName;

    return String(row.querySelector?.('[fieldname]')?.getAttribute?.('fieldname') || '').trim();
  };

  const ignoredField = (field) => {
    return !field
      || field === 'itemType'
      || field === 'itemTypeID'
      || field === 'abstractNote'
      || field === 'dateAdded'
      || field === 'dateModified'
      || field.startsWith('creator-');
  };

  const snapshotInfoBox = (infoBox) => {
    const rows = Array.from(infoBox?._infoTable?.querySelectorAll?.(':scope > .meta-row')
      || infoBox?.querySelectorAll?.('#info-table > .meta-row')
      || []);
    return rows
      .filter(isVisibleRow)
      .map((row, domIndex) => ({
        domIndex,
        field: getRowField(row),
        rowID: String(row.id || ''),
        customRowID: String(row.getAttribute?.('data-custom-row-id') || ''),
        label: String(row.querySelector?.('.meta-label label')?.textContent || '').trim(),
      }))
      .filter((entry) => !ignoredField(entry.field));
  };

  const createAuditItem = async (definition, index) => {
    const baseType = String(definition.baseItemType || definition.itemType || '').trim();
    const itemTypeID = Zotero.ItemTypes.getID(baseType);
    if (!itemTypeID) throw new Error(`Zotero does not provide base item type '${baseType}'`);

    const item = new Zotero.Item(baseType);
    item.libraryID = Zotero.Libraries.userLibraryID;
    const marker = `[Citation Phoenix UI audit ${index + 1}] ${definition.itemType}`;

    const titleBaseID = Zotero.ItemFields.getID('title');
    const titleFieldID = Zotero.ItemFields.getFieldIDFromTypeAndBase(itemTypeID, titleBaseID);
    const titleField = titleFieldID ? Zotero.ItemFields.getName(titleFieldID) : '';
    if (titleField) item.setField(titleField, marker);

    if (baseType === 'attachment') {
      item.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_URL;
      item.setField('title', marker);
      item.setField('url', 'https://example.invalid/citation-phoenix-ui-audit');
    }

    if (definition.custom) {
      item.setField('extra', `mlzsync1:${JSON.stringify({ xtype: definition.itemType })}`);
    }

    await item.saveTx({ skipDateModifiedUpdate: true });
    return item;
  };

  const renderAuditItem = async (item, effectiveType) => {
    await pane.selectItem(item.id);
    const infoBox = await waitFor(
      () => {
        const candidate = getInfoBox();
        return candidate?.item?.id === item.id ? candidate : null;
      },
      options.renderTimeoutMs,
      `InfoBox item ${item.id}`,
    );

    if (infoBox._section && !infoBox._section.open) infoBox._section.open = true;
    infoBox._resetRenderedFlags?.();
    infoBox.render?.();

    await waitFor(
      () => {
        const key = String(infoBox._ibcslmEffectiveRenderKey || '');
        const hasRows = !!infoBox._infoTable?.querySelector?.('.meta-row');
        return hasRows && (!key || key.endsWith(`::${effectiveType}`));
      },
      options.renderTimeoutMs,
      `${effectiveType} schema render`,
    );
    await delay(options.pauseMs);
    return infoBox;
  };

  const auditSnapshot = (definition, snapshot) => {
    // SEQUENCE defines relative order, while FIELDS and DATES can declare
    // additional valid fields without assigning them a sequence position.
    const ordered = definition.sequence.map(String).filter((field) => field !== 'abstractNote');
    const declared = (definition.fields || [])
      .map((entry) => String(entry?.field || ''))
      .filter((field) => field && field !== 'abstractNote');
    const expected = [...new Set([...ordered, ...declared])];
    const actual = snapshot.map((entry) => entry.field);
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((field) => !actualSet.has(field));
    const unexpected = actual.filter((field) => !expectedSet.has(field));
    const duplicates = [...new Set(actual.filter((field, index) => actual.indexOf(field) !== index))];
    const orderedSet = new Set(ordered);
    const actualExpected = actual.filter((field) => orderedSet.has(field));
    const expectedPresent = ordered.filter((field) => actualSet.has(field));
    const orderMismatches = [];
    const length = Math.max(actualExpected.length, expectedPresent.length);
    for (let index = 0; index < length; index += 1) {
      if (actualExpected[index] === expectedPresent[index]) continue;
      orderMismatches.push({
        position: index + 1,
        expected: expectedPresent[index] || '(none)',
        actual: actualExpected[index] || '(none)',
      });
      if (orderMismatches.length >= 8) break;
    }
    return {
      pass: !missing.length && !unexpected.length && !duplicates.length && !orderMismatches.length,
      expected,
      ordered,
      declared,
      actual,
      missing,
      unexpected,
      duplicates,
      orderMismatches,
      rows: snapshot,
    };
  };

  const spec = bridge.getSchemaUIAuditSpec();
  const requestedTypes = Array.isArray(options.itemTypes) && options.itemTypes.length
    ? new Set(options.itemTypes.map(String))
    : null;
  const definitions = (spec.itemTypes || []).filter((entry) => {
    return !requestedTypes || requestedTypes.has(String(entry.itemType));
  });
  if (!definitions.length) throw new Error('No schema item types matched the audit options.');

  const previousSelection = pane.getSelectedItems?.()?.[0]?.id || null;
  const results = [];
  const retainedItemIDs = [];

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    let item = null;
    let result = null;
    try {
      item = await createAuditItem(definition, index);
      const infoBox = await renderAuditItem(item, definition.itemType);
      const snapshot = snapshotInfoBox(infoBox);
      result = {
        itemType: definition.itemType,
        baseItemType: definition.baseItemType,
        itemID: item.id,
        ...auditSnapshot(definition, snapshot),
      };
    } catch (error) {
      result = {
        itemType: definition.itemType,
        baseItemType: definition.baseItemType,
        itemID: item?.id || null,
        pass: false,
        error: String(error?.stack || error),
        missing: [],
        unexpected: [],
        duplicates: [],
        orderMismatches: [],
        rows: [],
      };
    }
    results.push(result);

    const status = result.pass ? 'PASS' : 'FAIL';
    Zotero.debug(`[Citation Phoenix UI audit] ${status} ${definition.itemType}`);
    if (!result.pass) {
      Zotero.logError(`[Citation Phoenix UI audit] FAIL ${definition.itemType}: ${JSON.stringify({
        error: result.error || '',
        missing: result.missing,
        unexpected: result.unexpected,
        duplicates: result.duplicates,
        orderMismatches: result.orderMismatches,
      })}`);
    }

    if (item) {
      if (options.keepItems) retainedItemIDs.push(item.id);
      else {
        try { await item.eraseTx(); } catch (error) { Zotero.logError(error); }
      }
    }
    if (!result.pass && options.stopOnFailure) break;
  }

  if (!options.keepItems && previousSelection) {
    try { await pane.selectItem(previousSelection); } catch (_) {}
  }

  const failed = results.filter((result) => !result.pass);
  const summary = {
    passed: results.length - failed.length,
    failed: failed.length,
    total: results.length,
    retainedItemIDs,
    failures: failed.map((result) => ({
      itemType: result.itemType,
      error: result.error || '',
      missing: result.missing,
      unexpected: result.unexpected,
      duplicates: result.duplicates,
      orderMismatches: result.orderMismatches,
    })),
    results,
  };

  Zotero.debug(`[Citation Phoenix UI audit] COMPLETE ${summary.passed}/${summary.total} passed`);
  if (summary.failed) Zotero.logError(`[Citation Phoenix UI audit] ${summary.failed} item type(s) failed`);
  const reportText = JSON.stringify(summary, null, 2);
  let copied = false;
  try {
    Zotero.Utilities.Internal.copyTextToClipboard(reportText);
    copied = true;
  } catch (error) {
    Zotero.logError(error);
  }

  const completionMessage = [
    `${summary.passed}/${summary.total} item types passed.`,
    summary.failed ? `${summary.failed} item type(s) failed.` : 'No failures were found.',
    copied ? 'The detailed JSON report has been copied to the clipboard.' : 'The detailed JSON report is shown in the result pane.',
  ].join('\n');
  try {
    Services.prompt.alert(null, 'Citation Phoenix UI audit', completionMessage);
  } catch (_) {
    Zotero.getMainWindow?.()?.alert?.(completionMessage);
  }
  return reportText;
})();
