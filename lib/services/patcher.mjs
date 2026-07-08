export class Patcher {
  constructor({ moduleLoader, abbrevService, jurisdiction, caseCourtMapper }) {
    this.moduleLoader = moduleLoader;
    this.abbrevService = abbrevService;
    this.Jurisdiction = jurisdiction;
    this.caseCourtMapper = caseCourtMapper || null;
    this._orig = {};
    this._didWarnNoSyncStyleRead = false;
    this._didWarnRetrieveItem = false;
    this._retrieveItemLogCount = 0;
    this._maxRetrieveItemLogs = 40;
    this._abbrevLogCount = 0;
    this._maxAbbrevLogs = 40;
    this._shortFormLogCount = 0;
    this._maxShortFormLogs = 40;
    this._fieldLogCount = 0;
    this._maxFieldLogs = 40;
    this._citationDataLogCount = 0;
    this._maxCitationDataLogs = 80;
    this._itemObserverID = null;
    this._itemPanePatchTimer = null;
    this._itemPanePatchAttempts = 0;
    this._maxItemPanePatchAttempts = 20;
    this._commenterCreatorTypeID = '9001';
    this._commenterCreatorTypeName = 'commenter';
    this._commenterCreatorTypeLabel = 'Commenter';
    this._translatorCreatorTypeID = '9002';
    this._translatorCreatorTypeName = 'ibcslm-translator';
    this._translatorCreatorTypeLabel = 'Translator';
    this._commenterRowID = 'ibcslm-commenter-row';
    this._extraPersonTypes = [
      {
        key: 'commenter',
        creatorTypeID: this._commenterCreatorTypeID,
        creatorTypeName: this._commenterCreatorTypeName,
        label: this._commenterCreatorTypeLabel,
        storage: 'creator',
        mlzType: 'commenter',
        cslField: 'commenter',
      },
      {
        key: 'translator',
        creatorTypeID: this._translatorCreatorTypeID,
        creatorTypeName: this._translatorCreatorTypeName,
        label: this._translatorCreatorTypeLabel,
        storage: 'creator',
        mlzType: 'translator',
        cslField: 'translator',
      },
    ];
    this._jurisdictionRowID = 'ibcslm-jurisdiction-row';
    this._customCourtRowID = 'ibcslm-custom-court-row';
    this._syncInFlight = new Set();
    this._journalAbbrByContainerTitleKey = new Map();
  }

  patch() {
    this._patchCreatorTypes();
    this._patchInfoBoxPrototype();
    this._patchRetrieveItem();
    this._patchAbbreviations();
    this._patchLoadJurisdictionStyle();
    this._patchGetCiteProcFallback();
    this._registerCaseReporterSync();
    this._patchItemPaneRender();
    this._patchInfoBoxRender();
  }

  unpatch() {
    this._unregisterCaseReporterSync();
    this._unpatchInfoBoxRender();
    this._unpatchItemPaneRender();
    this._journalAbbrByContainerTitleKey.clear();
    const sysProto = Zotero?.Cite?.System?.prototype;
    if (sysProto) {
      if (this._orig.retrieveItem) sysProto.retrieveItem = this._orig.retrieveItem;
      if (this._orig.getAbbreviation) sysProto.getAbbreviation = this._orig.getAbbreviation;
      if (this._orig.normalizeAbbrevsKey) sysProto.normalizeAbbrevsKey = this._orig.normalizeAbbrevsKey;
      if (this._orig.loadJurisdictionStyle) sysProto.loadJurisdictionStyle = this._orig.loadJurisdictionStyle;
      if (this._orig.retrieveStyleModule) sysProto.retrieveStyleModule = this._orig.retrieveStyleModule;
    }
    const creatorTypes = Zotero?.CreatorTypes;
    if (creatorTypes) {
      if (this._orig.creatorTypesGetID) creatorTypes.getID = this._orig.creatorTypesGetID;
      if (this._orig.creatorTypesGetName) creatorTypes.getName = this._orig.creatorTypesGetName;
      if (this._orig.creatorTypesGetLocalizedString) creatorTypes.getLocalizedString = this._orig.creatorTypesGetLocalizedString;
      if (this._orig.creatorTypesGetTypesForItemType) creatorTypes.getTypesForItemType = this._orig.creatorTypesGetTypesForItemType;
    }
    const infoBoxProto = this._getInfoBoxPrototype();
    if (infoBoxProto) {
      if (this._orig.infoBoxProtoRender) infoBoxProto.render = this._orig.infoBoxProtoRender;
      if (this._orig.infoBoxProtoModifyCreator) infoBoxProto.modifyCreator = this._orig.infoBoxProtoModifyCreator;
      if (this._orig.infoBoxProtoRemoveCreator) infoBoxProto.removeCreator = this._orig.infoBoxProtoRemoveCreator;
    }
    if (this._orig.getCiteProc) Zotero.Style.prototype.getCiteProc = this._orig.getCiteProc;
  }

  _patchCreatorTypes() {
    const creatorTypes = Zotero?.CreatorTypes;
    if (!creatorTypes) return;
    if (!this._orig.creatorTypesGetID && creatorTypes.getID) this._orig.creatorTypesGetID = creatorTypes.getID;
    if (!this._orig.creatorTypesGetName && creatorTypes.getName) this._orig.creatorTypesGetName = creatorTypes.getName;
    if (!this._orig.creatorTypesGetLocalizedString && creatorTypes.getLocalizedString) {
      this._orig.creatorTypesGetLocalizedString = creatorTypes.getLocalizedString;
    }
    if (!this._orig.creatorTypesGetTypesForItemType && creatorTypes.getTypesForItemType) {
      this._orig.creatorTypesGetTypesForItemType = creatorTypes.getTypesForItemType;
    }

    const self = this;
    creatorTypes.getID = function (creatorType) {
      const extraPersonType = self._getExtraPersonConfigByCreatorType(creatorType);
      if (extraPersonType) return extraPersonType.creatorTypeID;
      return self._orig.creatorTypesGetID?.apply(this, arguments);
    };
    creatorTypes.getName = function (creatorTypeID) {
      const extraPersonType = self._getExtraPersonConfigByCreatorType(creatorTypeID);
      if (extraPersonType) return extraPersonType.creatorTypeName;
      return self._orig.creatorTypesGetName?.apply(this, arguments);
    };
    creatorTypes.getLocalizedString = function (creatorType) {
      const extraPersonType = self._getExtraPersonConfigByCreatorType(creatorType);
      if (extraPersonType) return extraPersonType.label;
      return self._orig.creatorTypesGetLocalizedString?.apply(this, arguments);
    };
    creatorTypes.getTypesForItemType = function (itemTypeID) {
      const result = self._orig.creatorTypesGetTypesForItemType?.apply(this, arguments) || [];
      if (!self._itemTypeSupportsExtraPerson(itemTypeID)) return result;
      const next = [...result];
      for (const extraPersonType of self._extraPersonTypes) {
        if (next.some((entry) => self._getExtraPersonConfigByCreatorType(entry?.id || entry?.name)?.key === extraPersonType.key)) continue;
        next.push({ id: extraPersonType.creatorTypeID, name: extraPersonType.creatorTypeName });
      }
      return next;
    };
  }

  _getInfoBoxPrototype() {
    try {
      const mainWindow = Zotero.getMainWindow?.();
      const ctor = mainWindow?.customElements?.get?.('info-box');
      return ctor?.prototype || null;
    } catch (e) {}
    return null;
  }

  _patchInfoBoxPrototype(protoOverride = null) {
    const proto = protoOverride || this._getInfoBoxPrototype();
    if (!proto) return;
    if (!this._orig.infoBoxProtoRender && typeof proto.render === 'function') {
      this._orig.infoBoxProtoRender = proto.render;
    }
    if (!this._orig.infoBoxProtoModifyCreator && typeof proto.modifyCreator === 'function') {
      this._orig.infoBoxProtoModifyCreator = proto.modifyCreator;
    }
    if (!this._orig.infoBoxProtoRemoveCreator && typeof proto.removeCreator === 'function') {
      this._orig.infoBoxProtoRemoveCreator = proto.removeCreator;
    }

    const self = this;

    if (this._orig.infoBoxProtoRender) {
      proto.render = function (...args) {
        const result = self._orig.infoBoxProtoRender.apply(this, args);
        try {
          try {
            const itemID = this.item?.id;
            const customRows = this.querySelectorAll?.('[data-custom-row-id]')?.length || 0;
            Zotero.debug(`[IndigoBook CSL-M] info-box proto render: item=${String(itemID || '')} customRows=${String(customRows)}`);
          } catch (e) {}
          self._ensureExtraPersonMenuItems(this);
          self._removeCommenterField(this);
          self._renderExtraPersonCreatorRows(this);
        } catch (e) {
          try { Zotero.debug(`[IndigoBook CSL-M] info-box commenter render patch failed: ${String(e)}`); } catch (_) {}
        }
        return result;
      };
    }

    if (this._orig.infoBoxProtoModifyCreator) {
      proto.modifyCreator = function (index, fields) {
        const nativeCount = this.item?.numCreators?.() || 0;
        const extraPersonType = self._getExtraPersonConfigByCreatorType(fields?.creatorTypeID);
        const existingExtraPersonType = self._getExtraPersonConfigByIndex(this, index);
        if (extraPersonType) {
          const nextPerson = self._extraPersonFromCreatorFields(fields);
          self._setStoredExtraPerson(this.item, extraPersonType, nextPerson);
          self._markExtraPersonCreatorRow(self._getCreatorTypeLabel(this, index)?.closest?.('.meta-row'), extraPersonType);
          return true;
        }

        if (existingExtraPersonType) {
          self._setStoredExtraPerson(this.item, existingExtraPersonType, null);
          const nativeIndex = self._getNativeCreatorIndex(this, index);
          return self._orig.infoBoxProtoModifyCreator.call(this, Math.min(nativeIndex, nativeCount), fields);
        }

        const nativeIndex = self._getNativeCreatorIndex(this, index);
        return self._orig.infoBoxProtoModifyCreator.call(this, nativeIndex, fields);
      };
    }

    if (this._orig.infoBoxProtoRemoveCreator) {
      proto.removeCreator = async function (index) {
        const extraPersonType = self._getExtraPersonConfigByIndex(this, index);
        if (extraPersonType) {
          self._setStoredExtraPerson(this.item, extraPersonType, null);
          self._removeExtraPersonCreatorRows(this, extraPersonType);
          if (this.saveOnEdit) {
            await this.item.saveTx({ skipDateModifiedUpdate: true });
          }
          return;
        }

        const nativeIndex = self._getNativeCreatorIndex(this, index);
        return self._orig.infoBoxProtoRemoveCreator.call(this, nativeIndex);
      };
    }
  }

  _patchInfoBoxPrototypeFromInstance(infoBox) {
    try {
      const proto = Object.getPrototypeOf(infoBox);
      if (!proto) return;
      this._patchInfoBoxPrototype(proto);
    } catch (e) {}
  }

  _registerCaseReporterSync() {
    if (!Zotero?.Notifier?.registerObserver) return;
    if (this._itemObserverID) return;

    const self = this;
    this._itemObserverID = Zotero.Notifier.registerObserver({
      async notify(event, type, ids) {
        try { Zotero.debug(`[IndigoBook CSL-M] case reporter sync notifier: event=${String(event)} type=${String(type)} ids=${Array.isArray(ids) ? ids.length : 0}`); } catch (e) {}
        const isSyncEvent = ['add', 'modify', 'refresh', 'redraw', 'select'].includes(event);
        if (!isSyncEvent) return;

        if (type === 'item' && Array.isArray(ids) && ids.length) {
          for (const id of ids) {
            await self._syncCaseReporterFromFieldsAndMLZ(id);
          }
          return;
        }

        await self._syncCaseReporterFromActiveSelection();
      },
    }, ['item', 'itempane', 'tab'], 'indigobook-cslm-case-reporter-sync');
  }

  _patchItemPaneRender() {
    if (this._orig.itemDetailsRender && this._orig.itemDetailsOwner) return;

    const itemDetails = this._getActiveItemDetails();
    if (!itemDetails?.render) {
      this._scheduleItemPaneRenderPatch();
      return;
    }

    const self = this;
    this._orig.itemDetailsOwner = itemDetails;
    this._orig.itemDetailsRender = itemDetails.render;
    itemDetails.render = async function (...args) {
      try {
        const itemID = this.item?.id;
        if (itemID != null) {
          try { Zotero.debug(`[IndigoBook CSL-M] case reporter item-pane render sync: item=${String(itemID)}`); } catch (e) {}
          await self._syncCaseReporterFromFieldsAndMLZ(itemID);
        }
      } catch (e) {
        try { Zotero.debug(`[IndigoBook CSL-M] case reporter item-pane render sync failed: ${String(e)}`); } catch (_) {}
      }
      return self._orig.itemDetailsRender.apply(this, args);
    };
  }

  _patchInfoBoxRender() {
    if (this._orig.infoBoxRender && this._orig.infoBoxOwner) return;

    const infoBox = this._getActiveInfoBox();
    if (!infoBox?.render) {
      this._scheduleItemPaneRenderPatch();
      return;
    }

    this._patchInfoBoxPrototypeFromInstance(infoBox);

    const self = this;
    this._orig.infoBoxOwner = infoBox;
    this._orig.infoBoxRender = infoBox.render;
    infoBox.render = function (...args) {
      const result = self._orig.infoBoxRender.apply(this, args);
      try {
        try {
          const itemID = this.item?.id;
          const customRows = this.querySelectorAll?.('[data-custom-row-id]')?.length || 0;
          Zotero.debug(`[IndigoBook CSL-M] info-box instance render: item=${String(itemID || '')} customRows=${String(customRows)}`);
        } catch (e) {}
        self._ensureExtraPersonMenuItems(this);
        self._removeCommenterField(this);
        self._renderExtraPersonCreatorRows(this);
        self._renderJurisdictionField(this);
        self._renderCourtField(this);
        self._renderCustomCourtField(this);
      } catch (e) {
        try { Zotero.debug(`[IndigoBook CSL-M] custom info row render failed: ${String(e)}`); } catch (_) {}
      }
      return result;
    };
  }

  _scheduleItemPaneRenderPatch() {
    if ((this._orig.itemDetailsRender && this._orig.itemDetailsOwner)
      && (this._orig.infoBoxRender && this._orig.infoBoxOwner)) return;
    if (this._itemPanePatchAttempts >= this._maxItemPanePatchAttempts) return;
    if (this._itemPanePatchTimer) return;

    this._itemPanePatchAttempts += 1;
    this._itemPanePatchTimer = setTimeout(() => {
      this._itemPanePatchTimer = null;
      this._patchItemPaneRender();
      this._patchInfoBoxRender();
    }, 500);
  }

  _unpatchItemPaneRender() {
    try {
      if (this._itemPanePatchTimer) {
        clearTimeout(this._itemPanePatchTimer);
        this._itemPanePatchTimer = null;
      }
      if (this._orig.itemDetailsOwner && this._orig.itemDetailsRender) {
        this._orig.itemDetailsOwner.render = this._orig.itemDetailsRender;
      }
    } catch (e) {
    } finally {
      delete this._orig.itemDetailsOwner;
      delete this._orig.itemDetailsRender;
    }
  }

  _unpatchInfoBoxRender() {
    try {
      if (this._orig.infoBoxOwner && this._orig.infoBoxRender) {
        this._orig.infoBoxOwner.render = this._orig.infoBoxRender;
      }
      this._removeExtraPersonCreatorRows(this._getActiveInfoBox());
      this._removeCommenterField(this._getActiveInfoBox());
      this._removeJurisdictionField(this._getActiveInfoBox());
      this._removeCustomCourtField(this._getActiveInfoBox());
    } catch (e) {
    } finally {
      delete this._orig.infoBoxOwner;
      delete this._orig.infoBoxRender;
    }
  }

  _unregisterCaseReporterSync() {
    try {
      if (this._itemObserverID && Zotero?.Notifier?.unregisterObserver) {
        Zotero.Notifier.unregisterObserver(this._itemObserverID);
      }
    } catch (e) {
    } finally {
      this._itemObserverID = null;
      this._syncInFlight.clear();
    }
  }

  async _syncCaseReporterFromFieldsAndMLZ(itemID) {
    const normalizedID = String(itemID);
    if (this._syncInFlight.has(normalizedID)) return;

    this._syncInFlight.add(normalizedID);
    try {
      const item = this._getZoteroItemByAnyID(itemID);
      if (!item || item.deleted) return;

      const itemTypeName = Zotero?.ItemTypes?.getName?.(item.itemTypeID);
      if (itemTypeName !== 'case') return;

      const reporter = String(item.getField?.('reporter') || '').trim();
      const rawCourt = String(item.getField?.('court') || '').trim();
      const hasCourtKeyAlready = this._looksLikeCourtKey(rawCourt);
      const parsedCourt = hasCourtKeyAlready ? null : (this.caseCourtMapper?.mapCaseCourt?.(rawCourt) || null);
      const mappedCourt = this.abbrevService.normalizeKey(parsedCourt?.courtKey || '');
      const mappedJurisdiction = String(parsedCourt?.jurisdiction || '').trim().toLowerCase();
      const court = this.abbrevService.normalizeKey(rawCourt || '');
      const extra = String(item.getField?.('extra') || '');
      const mlzFields = this.Jurisdiction.getMLZExtraFields?.(extra) || null;
      const mlzReporter = String(mlzFields?.reporter || '').trim();
      const mlzCourt = this.abbrevService.normalizeKey(mlzFields?.court || '');
      const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(extra) || '';
      const derivedJurisdiction = this.Jurisdiction.fromItem(item);
      const inferredJurisdiction = mappedJurisdiction || derivedJurisdiction;
      const upgradedCourt = this._upgradeGenericCourtKey(court, inferredJurisdiction);

      try {
        Zotero.debug(`[IndigoBook CSL-M] case court mapping: raw="${rawCourt}" mappedCourt="${mappedCourt}" mappedJurisdiction="${mappedJurisdiction}" derivedJurisdiction="${derivedJurisdiction}" inferredJurisdiction="${inferredJurisdiction}" upgradedCourt="${upgradedCourt}"`);
      } catch (e) {}

      let nextExtra = extra;
      let changed = false;

      // Convert imported raw court labels into canonical court keys once.
      const targetCourt = mappedCourt || upgradedCourt;
      if (targetCourt && (!hasCourtKeyAlready || court !== targetCourt)) {
        item.setField('court', targetCourt);
        changed = true;
      }

      const effectiveCourt = targetCourt || court;
      const effectiveJurisdiction = inferredJurisdiction;
      const canRewriteJurisdiction = !mlzJurisdiction || /^us(?::|$)/.test(mlzJurisdiction);

      // User-facing Zotero reporter field is authoritative when populated.
      if (reporter && reporter !== mlzReporter) {
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, 'reporter', reporter) || nextExtra;
      }

      // Backfill Zotero reporter field from mlzsync when blank.
      if (!reporter && mlzReporter) {
        item.setField('reporter', mlzReporter);
        changed = true;
      }

      // Keep mlzsync jurisdiction current so new/converted case items persist immediately.
      if (canRewriteJurisdiction && effectiveJurisdiction && effectiveJurisdiction !== mlzJurisdiction) {
        const displayJurisdiction = this.abbrevService.formatJurisdictionDisplay(effectiveJurisdiction);
        nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(nextExtra, effectiveJurisdiction, displayJurisdiction) || nextExtra;
      }

      // Keep mlzsync court aligned with the Zotero court field key.
      if (effectiveCourt && effectiveCourt !== mlzCourt) {
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, 'court', effectiveCourt) || nextExtra;
      }

      // Backfill Zotero court field from mlzsync when blank.
      if (!effectiveCourt && mlzCourt) {
        item.setField('court', mlzCourt);
        changed = true;
      }

      if (nextExtra !== extra) {
        item.setField('extra', nextExtra);
        changed = true;
      }

      if (!changed) return;

      await item.saveTx({ skipDateModifiedUpdate: true });
      try {
        Zotero.debug(`[IndigoBook CSL-M] case sync: wrote reporter/jurisdiction/court mlz state (item ${normalizedID})`);
      } catch (e) {}
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[IndigoBook CSL-M] case reporter sync failed for item ${normalizedID}: ${String(e)}`); } catch (_) {}
    } finally {
      this._syncInFlight.delete(normalizedID);
    }
  }

  _looksLikeCourtKey(value) {
    const normalized = this.abbrevService.normalizeKey(value || '');
    if (!normalized) return false;
    return /^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(normalized);
  }

  _upgradeGenericCourtKey(courtKey, jurisdiction) {
    const key = this.abbrevService.normalizeKey(courtKey || '');
    const jur = String(jurisdiction || '').trim().toLowerCase();
    if (!key) return '';

    if ((key === 'court.appeal' || key === 'court.appeals') && jur === 'us:c') {
      return 'court.appeals.federal.circuit';
    }
    if (key === 'court.appeal') {
      return 'court.appeals';
    }
    return '';
  }

  async _syncCaseReporterFromActiveSelection() {
    try {
      const pane = Zotero.getActiveZoteroPane?.();
      if (!pane?.getSelectedItems) return;

      const selected = pane.getSelectedItems();
      if (!Array.isArray(selected) || !selected.length) return;

      for (const entry of selected) {
        const id = (typeof entry === 'number' || typeof entry === 'string') ? entry : entry?.id;
        if (id == null) continue;
        await this._syncCaseReporterFromFieldsAndMLZ(id);
      }
    } catch (e) {
      try { Zotero.debug(`[IndigoBook CSL-M] case reporter selection sync failed: ${String(e)}`); } catch (_) {}
    }
  }

  _getActiveItemDetails() {
    try {
      const mainWindow = Zotero.getMainWindow?.();
      const fromMainWindow = mainWindow?.ZoteroPane?.itemPane?._itemDetails;
      if (fromMainWindow) return fromMainWindow;

      const activePane = Zotero.getActiveZoteroPane?.();
      return activePane?.itemPane?._itemDetails || null;
    } catch (e) {}
    return null;
  }

  _getActiveInfoBox() {
    try {
      const itemDetails = this._getActiveItemDetails();
      if (itemDetails?.getPane) {
        const pane = itemDetails.getPane('info');
        if (pane) return pane;
      }

      const mainWindow = Zotero.getMainWindow?.();
      return mainWindow?.document?.getElementById?.('zotero-editpane-info-box') || null;
    } catch (e) {}
    return null;
  }

  _renderJurisdictionField(infoBox) {
    const item = infoBox?.item;
    const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
    if (!item || item.deleted || itemTypeName !== 'case') {
      this._removeJurisdictionField(infoBox);
      return;
    }

    const table = this._getInfoTable(infoBox);
    if (!table) return;

    const row = this._getOrCreateJurisdictionRow(infoBox);
    const beforeRow = this._findInfoFieldRow(infoBox, 'court');
    if (beforeRow && beforeRow.parentNode === table) {
      table.insertBefore(row, beforeRow);
    } else if (row.parentNode !== table) {
      table.appendChild(row);
    }

    this._updateJurisdictionRow(infoBox, row, item);
  }

  _renderExtraPersonCreatorRows(infoBox) {
    for (const extraPersonType of this._extraPersonTypes) {
      this._renderExtraPersonCreatorRow(infoBox, extraPersonType);
    }
  }

  _renderExtraPersonCreatorRow(infoBox, extraPersonType) {
    const item = infoBox?.item;
    if (!item || item.deleted || !this._itemTypeSupportsExtraPerson(item.itemTypeID)) {
      this._removeExtraPersonCreatorRows(infoBox, extraPersonType);
      return;
    }

    const extraPerson = this._getStoredExtraPerson(item, extraPersonType);
    if (!extraPerson) {
      const activeRow = this._getActiveExtraPersonCreatorRow(infoBox, extraPersonType);
      if (activeRow) {
        this._markExtraPersonCreatorRow(activeRow, extraPersonType);
        return;
      }
      this._removeExtraPersonCreatorRows(infoBox, extraPersonType);
      try { Zotero.debug(`[IndigoBook CSL-M] ${extraPersonType.key} creator row skipped: item=${String(item?.id || '')} no stored value`); } catch (e) {}
      return;
    }
    if (typeof infoBox.addCreatorRow !== 'function') {
      try { Zotero.debug(`[IndigoBook CSL-M] ${extraPersonType.key} creator row skipped: item=${String(item?.id || '')} addCreatorRow unavailable`); } catch (e) {}
      return;
    }

    const existingRow = this._getExtraPersonCreatorRows(infoBox, extraPersonType)[0];
    if (existingRow) {
      this._markExtraPersonCreatorRow(existingRow, extraPersonType);
      return;
    }

    this._removeEmptyDefaultCreatorRows(infoBox);
    const creatorData = this._extraPersonToCreatorData(extraPerson);
    const rowIndex = infoBox._creatorCount;
    infoBox.addCreatorRow(creatorData, extraPersonType.creatorTypeID, false, infoBox._firstRowBeforeCreators || null);

    const label = this._getCreatorTypeLabel(infoBox, rowIndex);
    const row = label?.closest('.meta-row') || null;
    if (!row) return;

    this._markExtraPersonCreatorRow(row, extraPersonType);
    row.setAttribute('data-ibcslm-rendered-extra-person-row', extraPersonType.key);
    try {
      Zotero.debug(`[IndigoBook CSL-M] ${extraPersonType.key} creator row rendered: item=${String(item?.id || '')} rowIndex=${String(rowIndex)}`);
    } catch (e) {}
  }

  _getCreatorTypeLabel(infoBox, rowIndex) {
    return infoBox?.querySelector?.(`.meta-label[fieldname="creator-${rowIndex}-typeID"]`)
      || infoBox?.querySelector?.(`.meta-label[fieldname="creator-${rowIndex}"]`)
      || null;
  }

  _getCreatorRowIndex(row) {
    const fieldName = String(row?.querySelector?.('.meta-label')?.getAttribute?.('fieldname') || '');
    const match = fieldName.match(/^creator-(\d+)(?:-|$)/);
    return match ? Number(match[1]) : null;
  }

  _getCreatorRows(infoBox) {
    if (!infoBox?.querySelectorAll) return [];
    const labels = Array.from(infoBox.querySelectorAll('.meta-label[fieldname^="creator-"]'));
    const rows = [];
    for (const label of labels) {
      const row = label.closest?.('.meta-row') || null;
      if (row && !rows.includes(row)) rows.push(row);
    }
    return rows;
  }

  _getExtraPersonCreatorRows(infoBox, extraPersonType = null) {
    return this._getCreatorRows(infoBox).filter((row) => {
      const rowTypeKey = row.getAttribute?.('data-ibcslm-extra-person-type') || '';
      if (rowTypeKey) return !extraPersonType || rowTypeKey === extraPersonType.key;
      if (!extraPersonType && row.getAttribute?.('data-ibcslm-commenter-row') === 'true') return true;
      const label = row.querySelector?.('.meta-label');
      const rowConfig = this._getExtraPersonConfigByCreatorType(label?.getAttribute?.('typeid'));
      return rowConfig && (!extraPersonType || rowConfig.key === extraPersonType.key);
    });
  }

  _getExtraPersonConfigByIndex(infoBox, rowIndex) {
    const row = this._getCreatorTypeLabel(infoBox, rowIndex)?.closest?.('.meta-row') || null;
    if (!row) return null;
    const rowTypeKey = row.getAttribute?.('data-ibcslm-extra-person-type') || '';
    if (rowTypeKey) return this._extraPersonTypes.find((config) => config.key === rowTypeKey) || null;
    if (row.getAttribute?.('data-ibcslm-commenter-row') === 'true') {
      return this._extraPersonTypes.find((config) => config.key === 'commenter') || null;
    }
    const label = row.querySelector?.('.meta-label');
    return this._getExtraPersonConfigByCreatorType(label?.getAttribute?.('typeid'));
  }

  _getNativeCreatorIndex(infoBox, rowIndex) {
    let nativeIndex = Number(rowIndex) || 0;
    for (const row of this._getExtraPersonCreatorRows(infoBox)) {
      const extraIndex = this._getCreatorRowIndex(row);
      if (extraIndex != null && extraIndex < rowIndex) nativeIndex -= 1;
    }
    return Math.max(0, nativeIndex);
  }

  _getActiveExtraPersonCreatorRow(infoBox, extraPersonType) {
    const activeElement = infoBox?.ownerDocument?.activeElement || null;
    return this._getExtraPersonCreatorRows(infoBox, extraPersonType).find((row) => {
      return activeElement && row.contains?.(activeElement);
    }) || null;
  }

  _markExtraPersonCreatorRow(row, extraPersonType) {
    if (!row) return;
    row.setAttribute('data-ibcslm-extra-person-type', extraPersonType.key);
    if (extraPersonType.key === 'commenter') row.setAttribute('data-ibcslm-commenter-row', 'true');
    const plusButton = row.querySelector('.zotero-clicky-plus');
    const optionsButton = row.querySelector('.zotero-clicky-options');
    const grippy = row.querySelector('.zotero-clicky-grippy');
    if (plusButton) plusButton.hidden = false;
    if (optionsButton) optionsButton.hidden = false;
    if (grippy) {
      grippy.hidden = true;
      grippy.disabled = true;
    }
  }

  _removeEmptyDefaultCreatorRows(infoBox) {
    const item = infoBox?.item;
    if (item?.numCreators?.()) return;
    for (const row of this._getCreatorRows(infoBox)) {
      if (this._getExtraPersonCreatorRows(infoBox).includes(row)) continue;
      const values = Array.from(row.querySelectorAll('input, textarea, editable-text')).map((node) => {
        return String(node.value ?? node.getAttribute?.('value') ?? '').trim();
      });
      if (values.some(Boolean)) continue;
      row.parentNode?.removeChild(row);
      if (typeof infoBox._creatorCount === 'number' && infoBox._creatorCount > 0) {
        infoBox._creatorCount -= 1;
      }
    }
  }

  _ensureExtraPersonMenuItems(infoBox) {
    const item = infoBox?.item;
    if (!item || !this._itemTypeSupportsExtraPerson(item.itemTypeID) || !infoBox.editable) return;
    const menu = infoBox._creatorTypeMenu;
    if (!menu) return;

    const doc = menu.ownerDocument || infoBox.ownerDocument;
    for (const extraPersonType of this._extraPersonTypes) {
      const existing = Array.from(menu.children || []).some((node) => {
        return String(node?.getAttribute?.('typeid') || '') === extraPersonType.creatorTypeID;
      });
      if (existing) continue;

      const menuitem = doc.createXULElement('menuitem');
      menuitem.setAttribute('label', extraPersonType.label);
      menuitem.setAttribute('typeid', extraPersonType.creatorTypeID);
      menu.appendChild(menuitem);
    }
  }

  _removeExtraPersonCreatorRows(infoBox, extraPersonType = null) {
    for (const row of this._getExtraPersonCreatorRows(infoBox, extraPersonType)) {
      row.parentNode?.removeChild(row);
      if (typeof infoBox._creatorCount === 'number' && infoBox._creatorCount > 0) {
        infoBox._creatorCount -= 1;
      }
    }
  }

  _renderCourtField(infoBox) {
    const item = infoBox?.item;
    const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
    const row = this._findInfoFieldRow(infoBox, 'court');
    if (!row) return;

    if (!item || item.deleted || itemTypeName !== 'case') {
      this._removeCustomCourtField(infoBox);
      this._restoreCourtField(row, item);
      return;
    }

    this._updateCourtRow(infoBox, row, item);
  }

  _renderCustomCourtField(infoBox) {
    const item = infoBox?.item;
    const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
    const courtRow = this._findInfoFieldRow(infoBox, 'court');
    if (!courtRow) {
      this._removeCustomCourtField(infoBox);
      return;
    }

    // Keep this helper row focused on editable case items only.
    if (!item || item.deleted || itemTypeName !== 'case' || !infoBox.editable) {
      this._removeCustomCourtField(infoBox);
      return;
    }

    const table = this._getInfoTable(infoBox);
    if (!table) return;

    const row = this._getOrCreateCustomCourtRow(infoBox);
    if (courtRow.parentNode === table) {
      const afterCourt = courtRow.nextSibling;
      if (afterCourt !== row) table.insertBefore(row, afterCourt);
    } else if (row.parentNode !== table) {
      table.appendChild(row);
    }

    this._updateCustomCourtRow(row, item);
  }

  _removeJurisdictionField(infoBox) {
    const row = infoBox?.querySelector?.(`#${this._jurisdictionRowID}`);
    if (row?.parentNode) row.parentNode.removeChild(row);
  }

  _removeCommenterField(infoBox) {
    const row = infoBox?.querySelector?.(`#${this._commenterRowID}`);
    if (row?.parentNode) row.parentNode.removeChild(row);
    for (const customRow of infoBox?.querySelectorAll?.('[data-custom-row-id$="indigobook-cslm-commenter-row"]') || []) {
      customRow.parentNode?.removeChild(customRow);
    }
  }

  _removeCustomCourtField(infoBox) {
    const row = infoBox?.querySelector?.(`#${this._customCourtRowID}`);
    if (row?.parentNode) row.parentNode.removeChild(row);
  }

  _getInfoTable(infoBox) {
    return infoBox?._infoTable || infoBox?.querySelector?.('#info-table') || null;
  }

  _findInfoFieldRow(infoBox, fieldName) {
    const table = this._getInfoTable(infoBox);
    if (!table) return null;

    for (const row of table.querySelectorAll('.meta-row')) {
      const labelWrapper = row.querySelector('.meta-label');
      if (labelWrapper?.getAttribute('fieldname') === fieldName) return row;
    }
    return null;
  }

  _getOrCreateJurisdictionRow(infoBox) {
    let row = infoBox.querySelector(`#${this._jurisdictionRowID}`);
    if (row) return row;

    const doc = infoBox.ownerDocument;
    row = doc.createElement('div');
    row.id = this._jurisdictionRowID;
    row.className = 'meta-row';

    const labelWrapper = doc.createElement('div');
    labelWrapper.className = 'meta-label';
    labelWrapper.setAttribute('fieldname', 'jurisdiction');

    let label;
    if (typeof infoBox.createLabelElement === 'function') {
      label = infoBox.createLabelElement({
        id: 'itembox-field-jurisdiction-label',
        text: 'Jurisdiction',
      });
    } else {
      label = doc.createElement('label');
      label.id = 'itembox-field-jurisdiction-label';
      label.textContent = 'Jurisdiction';
    }
    labelWrapper.appendChild(label);

    const dataWrapper = doc.createElement('div');
    dataWrapper.className = 'meta-data';

    row.appendChild(labelWrapper);
    row.appendChild(dataWrapper);
    return row;
  }

  _getOrCreateCustomCourtRow(infoBox) {
    let row = infoBox.querySelector(`#${this._customCourtRowID}`);
    if (row) return row;

    const doc = infoBox.ownerDocument;
    row = doc.createElement('div');
    row.id = this._customCourtRowID;
    row.className = 'meta-row';

    const labelWrapper = doc.createElement('div');
    labelWrapper.className = 'meta-label';
    labelWrapper.setAttribute('fieldname', 'custom-court');

    let label;
    if (typeof infoBox.createLabelElement === 'function') {
      label = infoBox.createLabelElement({
        id: 'itembox-field-custom-court-label',
        text: 'Custom Court',
      });
    } else {
      label = doc.createElement('label');
      label.id = 'itembox-field-custom-court-label';
      label.textContent = 'Custom Court';
    }
    labelWrapper.appendChild(label);

    const dataWrapper = doc.createElement('div');
    dataWrapper.className = 'meta-data';

    row.appendChild(labelWrapper);
    row.appendChild(dataWrapper);
    return row;
  }

  _updateCustomCourtRow(row, item) {
    const dataWrapper = row.querySelector('.meta-data');
    if (!dataWrapper) return;
    dataWrapper.textContent = '';

    const doc = row.ownerDocument;
    const container = doc.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '6px';

    const customInput = doc.createElement('input');
    customInput.id = 'itembox-field-court-custom';
    customInput.className = 'value';
    customInput.placeholder = 'Enter custom court key';
    customInput.style.maxWidth = '220px';

    const currentCourt = String(item?.getField?.('court') || '').trim();
    customInput.value = currentCourt;

    const saveCustomCourtValue = async () => {
      const rawCustomValue = String(customInput.value || '').trim();
      if (!rawCustomValue) return;
      await this._saveCourtFromMenu(item, rawCustomValue);
    };

    const setButton = doc.createElement('button');
    setButton.type = 'button';
    setButton.textContent = 'Set';
    setButton.addEventListener('click', () => {
      saveCustomCourtValue();
    });

    customInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      saveCustomCourtValue();
    });

    container.appendChild(customInput);
    container.appendChild(setButton);
    dataWrapper.appendChild(container);
  }

  _updateJurisdictionRow(infoBox, row, item) {
    const dataWrapper = row.querySelector('.meta-data');
    if (!dataWrapper) return;

    const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
    const displayValue = this.abbrevService.formatJurisdictionDisplay(currentJurisdiction);
    dataWrapper.textContent = '';

    if (infoBox.editable) {
      dataWrapper.appendChild(this._buildJurisdictionMenuList(infoBox, item, currentJurisdiction, displayValue));
      return;
    }

    if (typeof infoBox.createValueElement === 'function') {
      const valueElem = infoBox.createValueElement({
        editable: false,
        text: displayValue,
        id: 'itembox-field-jurisdiction-value',
        attributes: {
          'aria-labelledby': 'itembox-field-jurisdiction-label',
          fieldname: 'jurisdiction',
          title: currentJurisdiction,
        },
      });
      valueElem.value = displayValue;
      dataWrapper.appendChild(valueElem);
      return;
    }

    const input = row.ownerDocument.createElement('input');
    input.className = 'value';
    input.readOnly = true;
    input.value = displayValue;
    input.title = currentJurisdiction;
    dataWrapper.appendChild(input);
  }

  _updateCourtRow(infoBox, row, item) {
    const dataWrapper = row.querySelector('.meta-data');
    if (!dataWrapper) return;

    const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
    const currentCourtKey = this._getDisplayedCourtKey(item);
    const displayValue = this._formatCourtDisplay(currentCourtKey, currentJurisdiction);
    dataWrapper.textContent = '';

    if (infoBox.editable) {
      dataWrapper.appendChild(this._buildCourtMenuList(infoBox, item, currentJurisdiction, currentCourtKey, displayValue));
      return;
    }

    if (typeof infoBox.createValueElement === 'function') {
      const valueElem = infoBox.createValueElement({
        editable: false,
        text: displayValue,
        id: 'itembox-field-court-value',
        attributes: {
          'aria-labelledby': 'itembox-field-court-label',
          fieldname: 'court',
          title: currentCourtKey,
        },
      });
      valueElem.value = displayValue;
      dataWrapper.appendChild(valueElem);
      return;
    }

    const input = row.ownerDocument.createElement('input');
    input.className = 'value';
    input.readOnly = true;
    input.value = displayValue;
    input.title = currentCourtKey;
    dataWrapper.appendChild(input);
  }

  _restoreCourtField(row, item) {
    const dataWrapper = row?.querySelector('.meta-data');
    if (!dataWrapper) return;
    const courtValue = String(item?.getField?.('court') || '');
    const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
    const displayValue = this._formatCourtDisplay(courtValue, currentJurisdiction);
    dataWrapper.textContent = '';

    const infoBox = row.closest('#zotero-editpane-info-box');
    if (infoBox && typeof infoBox.createValueElement === 'function') {
      const valueElem = infoBox.createValueElement({
        editable: false,
        text: displayValue,
        id: 'itembox-field-court-value',
        attributes: {
          'aria-labelledby': 'itembox-field-court-label',
          fieldname: 'court',
          title: courtValue,
        },
      });
      valueElem.value = displayValue;
      dataWrapper.appendChild(valueElem);
      return;
    }

    const input = row.ownerDocument.createElement('input');
    input.className = 'value';
    input.readOnly = true;
    input.value = displayValue;
    input.title = courtValue;
    dataWrapper.appendChild(input);
  }

  _buildJurisdictionMenuList(infoBox, item, currentJurisdiction, displayValue) {
    const doc = infoBox.ownerDocument;
    return this._buildFilteredPickerControl(doc, {
      fieldName: 'jurisdiction',
      inputId: 'itembox-field-jurisdiction-input',
      listId: 'itembox-field-jurisdiction-list',
      currentValue: currentJurisdiction,
      displayValue,
      options: this._getJurisdictionOptions(currentJurisdiction),
      minChars: 2,
      onSelect: async (option) => {
        await this._saveJurisdictionFromMenu(item, option.code);
      },
      formatOptionText: (option) => option.label,
    });
  }

  _buildCourtMenuList(infoBox, item, currentJurisdiction, currentCourtKey, displayValue) {
    const doc = infoBox.ownerDocument;
    const menulist = doc.createXULElement('menulist');
    menulist.id = 'itembox-field-court-menu';
    menulist.className = 'zotero-clicky keyboard-clickable';
    menulist.setAttribute('aria-labelledby', 'itembox-field-court-label');
    menulist.setAttribute('fieldname', 'court');
    menulist.setAttribute('tooltiptext', currentCourtKey);
    menulist.style.flex = '1';

    const popup = menulist.appendChild(doc.createXULElement('menupopup'));
    const options = this._getCourtOptions(currentJurisdiction, currentCourtKey);
    const hasCourt = !!String(currentCourtKey || '').trim();
    const noEntryValue = `${currentJurisdiction}||__no_entry__`;
    const compoundCurrentValue = hasCourt ? `${currentJurisdiction}||${currentCourtKey}` : noEntryValue;

    if (!hasCourt) {
      const placeholder = doc.createXULElement('menuitem');
      placeholder.setAttribute('value', noEntryValue);
      placeholder.setAttribute('label', 'no entry');
      placeholder.setAttribute('tooltiptext', 'no entry');
      popup.appendChild(placeholder);
    }

    for (const option of options) {
      const menuitem = doc.createXULElement('menuitem');
      menuitem.setAttribute('value', `${option.jurisdiction}||${option.key}`);
      menuitem.setAttribute('label', option.label);
      menuitem.setAttribute('tooltiptext', option.abbreviation || option.key);
      popup.appendChild(menuitem);
    }

    menulist.value = compoundCurrentValue;
    if (!hasCourt && menulist.selectedItem) {
      menulist.setAttribute('label', 'no entry');
    } else if (!menulist.selectedItem && options.length) {
      const fallbackIndex = options.findIndex((option) => !option.isChild && option.key === currentCourtKey && option.jurisdiction === currentJurisdiction);
      menulist.selectedIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
    }

    if (menulist.selectedItem && displayValue) {
      menulist.setAttribute('label', menulist.selectedItem.getAttribute('label'));
    }

    const saveCourtValue = async () => {
      const selectedValue = String(menulist.value || '').trim();
      if (!selectedValue) return;
      if (selectedValue.endsWith('||__no_entry__')) {
        const extra = String(item.getField?.('extra') || '');
        let nextExtra = this.Jurisdiction.updateMLZExtraField?.(extra, 'court', '') || extra;
        if (nextExtra === extra && String(item.getField?.('court') || '').trim() === '') return;
        item.setField('extra', nextExtra);
        item.setField('court', '');
        await item.saveTx({ skipDateModifiedUpdate: true });
        try {
          const infoBox = this._getActiveInfoBox?.();
          if (infoBox) {
            this._renderCourtField(infoBox);
            this._renderCustomCourtField(infoBox);
          }
        } catch (e) {}
        return;
      }
      await this._saveCourtFromMenu(item, selectedValue);
    };

    menulist.addEventListener('command', saveCourtValue);
    menulist.addEventListener('change', saveCourtValue);

    return menulist;
  }

  _buildFilteredPickerControl(doc, {
    fieldName,
    inputId,
    listId,
    currentValue,
    displayValue,
    options,
    minChars = 2,
    onSelect,
    formatOptionText,
  }) {
    let currentDisplayValue = String(displayValue || '');
    let currentRawValue = String(currentValue || '');

    const wrapper = doc.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';
    wrapper.style.gap = '0';
    wrapper.style.width = '100%';
    wrapper.style.position = 'relative';
    if (fieldName === 'jurisdiction') {
      wrapper.style.maxWidth = '22em';
    }

    const input = doc.createElement('input');
    input.id = inputId;
    input.className = 'value';
    input.setAttribute('fieldname', fieldName);
    input.setAttribute('aria-labelledby', `itembox-field-${fieldName}-label`);
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.flex = '1';
    input.style.minWidth = '0';
    input.value = currentDisplayValue;
    input.title = currentRawValue;
    input.style.boxSizing = 'border-box';
    input.style.width = '100%';
    input.style.maxWidth = fieldName === 'jurisdiction' ? '22em' : '100%';
    input.style.whiteSpace = 'nowrap';
    input.style.overflow = 'hidden';
    input.style.textOverflow = 'ellipsis';

    const normalizedOptions = Array.isArray(options)
      ? options.map((option) => ({
        ...option,
        displayText: String(typeof formatOptionText === 'function' ? formatOptionText(option) : option.label || option.code || '').trim(),
        searchText: this._normalizeMenuSearchText(`${String(option.label || '')} ${String(option.code || '')} ${String(option.abbreviation || '')}`),
      })).filter((option) => option.displayText)
      : [];

    const popup = doc.createElement('div');
    popup.id = listId;
    popup.style.position = 'absolute';
    popup.style.left = '0';
    popup.style.right = '0';
    popup.style.top = '100%';
    popup.style.zIndex = '2000';
    popup.style.maxHeight = '220px';
    popup.style.overflowY = 'auto';
    popup.style.border = '1px solid ThreeDShadow';
    popup.style.background = 'Field';
    popup.style.color = 'FieldText';
    popup.style.display = 'none';
    popup.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    popup.style.marginTop = '2px';

    const hidePopup = () => {
      popup.style.display = 'none';
      while (popup.firstChild) popup.removeChild(popup.firstChild);
    };

    const renderOptions = () => {
      const query = this._normalizeMenuSearchText(String(input.value || ''));
      hidePopup();

      if (query.length < Math.max(1, Number(minChars) || 2)) return;

      const matches = normalizedOptions.filter((option) => option.searchText.includes(query));
      if (!matches.length) {
        const empty = doc.createElement('div');
        empty.textContent = 'No matches';
        empty.style.padding = '4px 8px';
        empty.style.opacity = '0.7';
        popup.appendChild(empty);
        popup.style.display = 'block';
        return;
      }

      for (const option of matches.slice(0, 100)) {
        const row = doc.createElement('button');
        row.type = 'button';
        row.textContent = option.displayText;
        row.title = option.displayText;
        row.style.display = 'block';
        row.style.width = '100%';
        row.style.boxSizing = 'border-box';
        row.style.textAlign = 'left';
        row.style.padding = '2px 8px';
        row.style.border = '0';
        row.style.margin = '0';
        row.style.background = 'transparent';
        row.style.color = 'inherit';
        row.style.whiteSpace = 'nowrap';
        row.style.overflow = 'hidden';
        row.style.textOverflow = 'ellipsis';
        row.style.lineHeight = '1.2';
        row.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
      row.addEventListener('click', async () => {
          input.value = option.displayText;
          input.title = option.displayText;
          currentDisplayValue = option.displayText;
          currentRawValue = option.code;
          hidePopup();
          await onSelect?.(option);
        });
        popup.appendChild(row);
      }

      popup.style.display = 'block';
    };

    const resolveSelectedOption = async () => {
      const raw = String(input.value || '').trim();
      if (!raw) return;

      const normalizedRaw = this._normalizeMenuSearchText(raw);
      const exact = normalizedOptions.find((option) => {
        return this._normalizeMenuSearchText(option.displayText) === normalizedRaw
          || this._normalizeMenuSearchText(option.code) === normalizedRaw;
      });
      const uniquePrefix = !exact
        ? normalizedOptions.filter((option) => option.searchText.includes(normalizedRaw))
        : [];
      const match = exact || (uniquePrefix.length === 1 ? uniquePrefix[0] : null);

      if (!match) {
        input.value = currentDisplayValue;
        input.title = currentRawValue;
        hidePopup();
        return;
      }

      input.value = match.displayText;
      input.title = match.code;
      currentDisplayValue = match.displayText;
      currentRawValue = match.code;
      hidePopup();
      await onSelect?.(match);
    };

    input.addEventListener('input', renderOptions);
    input.addEventListener('focus', () => {
      if (typeof input.select === 'function') input.select();
      renderOptions();
    });
    input.addEventListener('change', resolveSelectedOption);
    input.addEventListener('blur', resolveSelectedOption);
    input.addEventListener('keydown', (event) => {
      const key = String(event.key || '');
      if (key === 'Escape') {
        hidePopup();
        return;
      }
      if (key !== 'Enter') return;
      event.preventDefault();
      resolveSelectedOption();
    });

    wrapper.appendChild(input);
    wrapper.appendChild(popup);
    return wrapper;
  }

  _attachMenuSearchFilter(menulist, popup, { minChars = 2, displayValue = '' } = {}) {
    if (!menulist || !popup) return;
    const searchField = menulist.inputField || menulist;

    const state = {
      timer: null,
      minChars: Math.max(1, Number(minChars) || 2),
    };

    const clearTimer = () => {
      if (!state.timer) return;
      clearTimeout(state.timer);
      state.timer = null;
    };

    const setAllVisible = () => {
      this._removeMenuNoResultsItem(popup);
      for (const node of Array.from(popup.children || [])) {
        if (node?.localName !== 'menuitem') continue;
        node.hidden = false;
      }
    };

    const applyFilter = (rawQuery = '') => {
      const normalizedQuery = this._normalizeMenuSearchText(rawQuery);
      if (!normalizedQuery || normalizedQuery.length < state.minChars) {
        setAllVisible();
        return;
      }

      let visibleCount = 0;
      for (const node of Array.from(popup.children || [])) {
        if (node?.localName !== 'menuitem') continue;
        const haystack = String(node._ibcslmSearchText || node.getAttribute('label') || node.getAttribute('value') || '').trim();
        const matches = this._normalizeMenuSearchText(haystack).includes(normalizedQuery);
        node.hidden = !matches;
        if (matches) visibleCount += 1;
      }

      if (!visibleCount) {
        this._showMenuNoResultsItem(popup);
        return;
      }

      this._removeMenuNoResultsItem(popup);
    };

    const resetSearch = () => {
      clearTimer();
      if (searchField && 'value' in searchField) searchField.value = '';
      applyFilter('');
    };

    const onInput = () => {
      clearTimer();
      const query = String(searchField?.value || '');
      applyFilter(query);
    };

    const onKeyDown = (event) => {
      if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (String(event.key || '') === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        resetSearch();
      }
    };

    if (searchField?.addEventListener) {
      searchField.addEventListener('input', onInput);
      searchField.addEventListener('keydown', onKeyDown, true);
    } else {
      menulist.addEventListener('keydown', onKeyDown, true);
    }
    popup.addEventListener('popuphidden', resetSearch);
    popup.addEventListener('popupshown', onInput);
    popup.addEventListener('command', resetSearch);

    if (displayValue) {
      menulist.setAttribute('label', displayValue);
      if (searchField && 'value' in searchField) {
        searchField.value = '';
      }
    }
    setAllVisible();
  }

  _normalizeMenuSearchText(value) {
    return this.abbrevService.normalizeKey(value || '');
  }

  _showMenuNoResultsItem(popup) {
    if (!popup) return;
    this._removeMenuNoResultsItem(popup);
    const doc = popup.ownerDocument;
    const item = doc.createXULElement('menuitem');
    item.setAttribute('label', 'No matches');
    item.setAttribute('disabled', 'true');
    item.hidden = false;
    item._ibcslmNoResults = true;
    popup.appendChild(item);
    popup._ibcslmNoResultsItem = item;
  }

  _removeMenuNoResultsItem(popup) {
    const item = popup?._ibcslmNoResultsItem;
    if (item?.parentNode) item.parentNode.removeChild(item);
    if (popup?._ibcslmNoResultsItem) delete popup._ibcslmNoResultsItem;
  }

  _getJurisdictionOptions(currentJurisdiction) {
    const options = this.abbrevService.listJurisdictionMenuOptions(currentJurisdiction);
    if (!currentJurisdiction) return options;
    if (options.some((option) => option.code === currentJurisdiction)) return options;

    return [{
      code: currentJurisdiction,
      label: this.abbrevService.formatJurisdictionDisplay(currentJurisdiction) || currentJurisdiction,
    }, ...options];
  }

  _getCourtOptions(currentJurisdiction, currentCourtKey) {
    const options = this.abbrevService.listInstitutionPartOptionsForJurisdictionTree(currentJurisdiction);
    if (!currentCourtKey) return options;
    // Check if the current selection is represented in the list (exact jurisdiction, non-child).
    const hasExact = options.some((option) => !option.isChild && option.key === currentCourtKey && option.jurisdiction === currentJurisdiction);
    if (hasExact) return options;

    return [{
      key: currentCourtKey,
      label: this._formatCourtDisplay(currentCourtKey, currentJurisdiction),
      abbreviation: '',
      jurisdiction: currentJurisdiction || 'us',
      isChild: false,
    }, ...options];
  }

  _getDisplayedJurisdictionCode(item) {
    const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(item) || '';
    if (mlzJurisdiction) return mlzJurisdiction;
    return this.Jurisdiction.fromItem(item);
  }

  _getDisplayedCourtKey(item) {
    return this.abbrevService.normalizeKey(item?.getField?.('court') || '');
  }

  _formatCourtDisplay(courtKey, jurisdiction) {
    const key = this.abbrevService.normalizeKey(courtKey || '');
    if (!key) return '';
    return this.abbrevService.formatInstitutionPartDisplay(key, jurisdiction) || String(courtKey || '');
  }

  _getStoredExtraPerson(item, extraPersonType) {
    const creators = this.Jurisdiction.getMLZExtraCreatorsByType?.(item, extraPersonType.mlzType) || [];
    return creators[0] || null;
  }

  _setStoredExtraPerson(item, extraPersonType, person) {
    if (!item?.setField) return;
    const extra = String(item.getField?.('extra') || '');
    const nextExtra = this.Jurisdiction.updateMLZExtraCreators?.call(
      this.Jurisdiction,
      extra,
      extraPersonType.mlzType,
      person ? [person] : [],
    ) || extra;
    if (nextExtra !== extra) {
      item.setField('extra', nextExtra);
    }
  }

  _formatStoredExtraPerson(person) {
    if (!person || typeof person !== 'object') return '';
    if (person.name) return String(person.name).trim();
    const firstName = String(person.firstName || '').trim();
    const lastName = String(person.lastName || '').trim();
    return `${firstName}${firstName && lastName ? ' ' : ''}${lastName}`.trim();
  }

  _extraPersonFromCreatorFields(fields) {
    if (!fields || typeof fields !== 'object') return null;
    const fieldMode = Number(fields.fieldMode) || 0;
    const firstName = String(fields.firstName || '').trim();
    const lastName = String(fields.lastName || '').trim();
    if (!firstName && !lastName) return null;
    if (fieldMode === 1) {
      return { name: lastName || firstName };
    }
    return { firstName, lastName };
  }

  _extraPersonToCreatorData(person) {
    if (!person || typeof person !== 'object') return null;
    if (person.name) {
      return {
        firstName: '',
        lastName: String(person.name || '').trim(),
        fieldMode: 1,
      };
    }
    return {
      firstName: String(person.firstName || '').trim(),
      lastName: String(person.lastName || '').trim(),
      fieldMode: 0,
    };
  }

  _getExtraPersonConfigByCreatorType(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    return this._extraPersonTypes.find((config) => {
      if (normalized === String(config.creatorTypeID).toLowerCase()) return true;
      if (normalized === String(config.creatorTypeName).toLowerCase()) return true;
      return config.key === 'commenter' && normalized === String(config.label).toLowerCase();
    }) || null;
  }

  _itemTypeSupportsExtraPerson(itemTypeID) {
    return Zotero?.ItemTypes?.getName?.(itemTypeID) === 'case';
  }

  async _saveJurisdictionFromMenu(item, selectedCode) {
    try {
      const current = this.Jurisdiction.getMLZJurisdiction?.(item) || '';
      if (current === selectedCode) return;

      const extra = String(item.getField?.('extra') || '');
      const displayValue = this.abbrevService.formatJurisdictionDisplay(selectedCode);
      let nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, selectedCode, displayValue) || extra;
      nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, 'court', '') || nextExtra;
      if (nextExtra === extra && String(item.getField?.('court') || '').trim() === '') return;

      item.setField('extra', nextExtra);
      item.setField('court', '');
      await item.saveTx({ skipDateModifiedUpdate: true });
      try {
        const infoBox = this._getActiveInfoBox?.();
        if (infoBox) {
          const courtRow = this._findInfoFieldRow(infoBox, 'court');
          if (courtRow) this._renderCourtField(infoBox);
          this._renderCustomCourtField(infoBox);
        }
      } catch (e) {}
      try { Zotero.debug(`[IndigoBook CSL-M] jurisdiction row saved: item=${String(item.id)} jurisdiction=${selectedCode}`); } catch (e) {}
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[IndigoBook CSL-M] jurisdiction row save failed: ${String(e)}`); } catch (_) {}
    }
  }

  async _saveCourtFromMenu(item, selectedValue) {
    try {
      // selectedValue is "jurisdiction||courtKey" or just "courtKey" for legacy data.
      const sep = selectedValue.indexOf('||');
      const targetJurisdiction = sep >= 0 ? selectedValue.slice(0, sep).trim().toLowerCase() : null;
      const rawKey = sep >= 0 ? selectedValue.slice(sep + 2).trim() : selectedValue.trim();
      const normalizedKey = this.abbrevService.normalizeKey(rawKey);
      if (!normalizedKey) return;

      const currentCourtKey = this._getDisplayedCourtKey(item);
      const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
      const jurisdictionChanged = targetJurisdiction && targetJurisdiction !== currentJurisdiction;
      const courtChanged = currentCourtKey !== normalizedKey;
      if (!jurisdictionChanged && !courtChanged) return;

      if (jurisdictionChanged) {
        const extra = String(item.getField?.('extra') || '');
        const displayValue = this.abbrevService.formatJurisdictionDisplay(targetJurisdiction);
        const updatedExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, targetJurisdiction, displayValue) || extra;
        item.setField('extra', updatedExtra);

        const targetOptions = this.abbrevService.listInstitutionPartOptionsForJurisdictionTree(targetJurisdiction);
        if (!targetOptions.length) {
          item.setField('court', '');
          await item.saveTx({ skipDateModifiedUpdate: true });
          try { Zotero.debug(`[IndigoBook CSL-M] court row cleared for jurisdiction with no institution-part: item=${String(item.id)} jurisdiction=${targetJurisdiction}`); } catch (e) {}
          return;
        }
      }

      item.setField('court', normalizedKey);
      await item.saveTx({ skipDateModifiedUpdate: true });
      try { Zotero.debug(`[IndigoBook CSL-M] court row saved: item=${String(item.id)} court=${normalizedKey} jurisdiction=${targetJurisdiction || 'unchanged'}`); } catch (e) {}
    } catch (e) {
      try { Zotero.logError(e); } catch (_) {}
      try { Zotero.debug(`[IndigoBook CSL-M] court row save failed: ${String(e)}`); } catch (_) {}
    }
  }

  _patchRetrieveItem() {
    const sysProto = Zotero?.Cite?.System?.prototype;
    if (!sysProto?.retrieveItem) return;
    this._orig.retrieveItem = sysProto.retrieveItem;

    const self = this;
    sysProto.retrieveItem = function (id) {
      const cslItem = self._orig.retrieveItem.call(this, id);

      // Preserve original return contract (sync vs async).
      if (cslItem && typeof cslItem.then === 'function') {
        return cslItem.then((item) => self._decorateCSLItem(item, id));
      }

      return self._decorateCSLItem(cslItem, id);
    };
  }

  _decorateCSLItem(cslItem, id) {
    if (Array.isArray(cslItem)) {
      if (Array.isArray(id)) {
        return cslItem.map((item, idx) => this._decorateCSLItem(item, id[idx]));
      }
      return cslItem.map((item) => this._decorateCSLItem(item, id));
    }

    if (!cslItem || typeof cslItem !== 'object') {
      try {
        this._logRetrieveItemDetails(id, null, 'non-object return');
        this._warnRetrieveItem(`retrieveItem returned non-object for id ${id}`);
      } catch (e) {}
      return cslItem;
    }

    // Clone to a plain object so custom getters/setters cannot coerce id types.
    cslItem = { ...cslItem };

    // citeproc registry lookups depend on Item.id matching the requested ID key.
    // Force a stable string key derived from retrieveItem() input to avoid number/string mismatches.
    const normalizedID = this._normalizeItemID(id);
    if (normalizedID != null) cslItem.id = String(normalizedID);

    this._logRetrieveItemDetails(id, cslItem.id, 'ok');

    try {
      const zotItem = this._getZoteroItemByAnyID(id);
      if (zotItem) {
        this._hydrateCSLItemFromZotero(cslItem, zotItem);
        const jur = this.Jurisdiction.fromItem(zotItem);
        cslItem.jurisdiction = jur;
        cslItem.country = jur.split(':')[0];
        this._decorateShortForms(cslItem, jur);
        this._logCitationItemData(cslItem, zotItem, 'retrieveItem');
        this._logRenderProbeFromItem(cslItem, jur, 'retrieveItem');
      } else {
        this._logField('missing-zotero-item', `id=${String(id)}`);
      }
    } catch (e) {
      this._warnRetrieveItem(String(e));
    }

    return cslItem;
  }

  _getZoteroItemByAnyID(id) {
    try {
      let zotItem = Zotero.Items.get(id);
      if (zotItem) return zotItem;

      if (typeof id === 'string' && /^\d+$/.test(id)) {
        zotItem = Zotero.Items.get(Number(id));
        if (zotItem) return zotItem;
      }

      if (typeof id === 'object' && id && id.id != null) {
        zotItem = Zotero.Items.get(id.id);
        if (zotItem) return zotItem;
      }
    } catch (e) {}
    return null;
  }

  _hydrateCSLItemFromZotero(cslItem, zotItem) {
    try {
      const mlzFields = this.Jurisdiction.getMLZExtraFields?.(zotItem) || null;
      const commenterCreators = this.Jurisdiction.getMLZExtraCreatorsByType?.(zotItem, 'commenter') || [];
      const translatorCreators = this.Jurisdiction.getMLZExtraCreatorsByType?.(zotItem, 'translator') || [];

      if (!cslItem.title) {
        const title = zotItem.getField?.('title');
        if (title) cslItem.title = title;
      }

      if (!cslItem['container-title']) {
        const containerTitle = zotItem.getField?.('publicationTitle')
          || zotItem.getField?.('reporter')
          || zotItem.getField?.('report')
          || mlzFields?.reporter
          || '';
        if (containerTitle) cslItem['container-title'] = containerTitle;
        else this._logField('missing-container-title-source', `itemType=${String(cslItem.type)} title=${String(cslItem.title || '')}`);
      }

      const journalAbbr = String(
        zotItem.getField?.('journalAbbreviation')
          || zotItem.getField?.('journalAbbr')
          || '',
      ).trim();
      if (journalAbbr) {
        const normalizedContainerTitle = this.abbrevService.normalizeKey(cslItem['container-title'] || '');
        if (normalizedContainerTitle) {
          this._journalAbbrByContainerTitleKey.set(normalizedContainerTitle, journalAbbr);
        }
        const hadShort = !!String(cslItem['container-title-short'] || '').trim();
        cslItem['container-title-short'] = journalAbbr;
        this._logShortForm(
          'container-title',
          cslItem['container-title'] || '',
          cslItem['container-title-short'],
          hadShort ? 'journal-abbr-override' : 'journal-abbr',
        );
      }

      if (!cslItem.authority) {
        const court = String(zotItem.getField?.('court') || '').trim();
        if (court) {
          cslItem.authority = [{ literal: this.abbrevService.normalizeKey(court) || court }];
        }
      }

      if (!cslItem.commenter && commenterCreators.length) {
        cslItem.commenter = commenterCreators.map((creator) => this._extraPersonToCSLCreator(creator))
          .filter((creator) => creator.literal || creator.given || creator.family);
      }

      if (!cslItem.translator && translatorCreators.length) {
        cslItem.translator = translatorCreators.map((creator) => this._extraPersonToCSLCreator(creator))
          .filter((creator) => creator.literal || creator.given || creator.family);
      }

      const seeAlso = this._collectSeeAlsoURIs(cslItem, zotItem);
      if (seeAlso.length) {
        cslItem.seeAlso = seeAlso;
      }
    } catch (e) {
      this._warnRetrieveItem(`hydrateCSLItemFromZotero failed: ${String(e)}`);
    }
  }

  _collectSeeAlsoURIs(cslItem, zotItem) {
    const out = [];
    const seen = new Set();
    const selfURI = this._getItemURI(zotItem);

    const add = (value) => {
      const normalized = this._resolveSeeAlsoEntryToURI(value, zotItem?.libraryID);
      if (!normalized) return;
      if (selfURI && normalized === selfURI) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    };

    try {
      const existingSeeAlso = Array.isArray(cslItem?.seeAlso) ? cslItem.seeAlso : [];
      for (const entry of existingSeeAlso) {
        add(entry);
      }

      const relatedKeys = Array.isArray(zotItem?.relatedItems) ? zotItem.relatedItems : [];
      for (const key of relatedKeys) {
        const relatedItem = Zotero.Items.getByLibraryAndKey?.(zotItem.libraryID, key);
        add(relatedItem);
      }

      const relatedPredicate = Zotero.Relations?.relatedItemPredicate;
      const relatedURIs = relatedPredicate ? (zotItem?.getRelationsByPredicate?.(relatedPredicate) || []) : [];
      for (const uri of relatedURIs) {
        add(uri);
      }
    } catch (e) {
      this._warnRetrieveItem(`collectSeeAlsoURIs failed: ${String(e)}`);
    }

    return out;
  }

  _resolveSeeAlsoEntryToURI(value, libraryID = null) {
    if (value == null) return null;
    if (typeof value === 'object') {
      const directURI = this._getItemURI(value);
      if (directURI) return directURI;
      if ('key' in value && libraryID != null) {
        const relatedItem = Zotero.Items.getByLibraryAndKey?.(libraryID, value.key);
        return this._getItemURI(relatedItem);
      }
      return null;
    }

    const raw = String(value).trim();
    if (!raw) return null;

    if (/^https?:\/\/zotero\.org\//i.test(raw)) return raw;
    if (/^\d+$/.test(raw)) return this._getItemURI(Zotero.Items.get?.(Number(raw)));
    if (/^[A-Z0-9]{8}$/i.test(raw) && libraryID != null) return this._getItemURI(Zotero.Items.getByLibraryAndKey?.(libraryID, raw));

    return raw;
  }

  _getItemURI(item) {
    if (!item) return null;
    try {
      return Zotero.URI?.getItemURI?.(item) || null;
    } catch (e) {}
    return null;
  }

  _extraPersonToCSLCreator(person) {
    const literalName = String(person?.name || '').trim();
    if (literalName) return { literal: literalName };
    return {
      given: String(person?.firstName || '').trim(),
      family: String(person?.lastName || '').trim(),
    };
  }

  _decorateShortForms(cslItem, jur) {
    try {
      if (!cslItem['container-title-short'] && cslItem['container-title']) {
        const hit = this.abbrevService.lookupForCiteProc('container-title', cslItem['container-title'], jur, { noHints: false });
        if (hit?.value) {
          cslItem['container-title-short'] = this.abbrevService.parseDirective(hit.value).value;
          this._logShortForm('container-title', cslItem['container-title'], cslItem['container-title-short'], 'hit');
        } else {
          this._logShortForm('container-title', cslItem['container-title'], null, 'miss');
        }
      }

      if (!cslItem['title-short'] && cslItem.title) {
        const hit = this.abbrevService.lookupForCiteProc('title', cslItem.title, jur, { noHints: false });
        if (hit?.value) {
          cslItem['title-short'] = this.abbrevService.parseDirective(hit.value).value;
          this._logShortForm('title', cslItem.title, cslItem['title-short'], 'hit');
        } else {
          this._logShortForm('title', cslItem.title, null, 'miss');
        }
      }
    } catch (e) {
      this._warnRetrieveItem(`decorateShortForms failed: ${String(e)}`);
    }
  }

  _logShortForm(category, source, value, stage) {
    if (this._shortFormLogCount >= this._maxShortFormLogs) return;
    this._shortFormLogCount += 1;
    const msg = `[IndigoBook CSL-M] shortForm[${this._shortFormLogCount}] ${stage}: category=${category} source=${String(source)} value=${String(value)}`;
    try { Zotero.debug(msg); } catch (e) {}
  }

  _logField(stage, detail) {
    if (this._fieldLogCount >= this._maxFieldLogs) return;
    this._fieldLogCount += 1;
    const msg = `[IndigoBook CSL-M] field[${this._fieldLogCount}] ${stage}: ${detail}`;
    try { Zotero.debug(msg); } catch (e) {}
  }

  _isHarvardCRCL(text) {
    const normalized = this.abbrevService.normalizeKey(text || '');
    return normalized.includes('harvard civil rights')
      && normalized.includes('civil liberties')
      && normalized.includes('law review');
  }

  _logRenderProbeFromItem(cslItem, jur, stage) {
    try {
      const source = String(cslItem?.['container-title'] || '');
      if (!this._isHarvardCRCL(source)) return;
      const msg = `[IndigoBook CSL-M] renderProbe item(${stage}): jur=${String(jur)} type=${String(cslItem?.type || '')} container-title=${source} container-title-short=${String(cslItem?.['container-title-short'] || '')} title=${String(cslItem?.title || '')} title-short=${String(cslItem?.['title-short'] || '')}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logRenderProbeFromAbbreviation(category, key, jurisdiction, noHints, stage) {
    try {
      if (category !== 'container-title') return;
      if (!this._isHarvardCRCL(key)) return;
      const normalized = this.abbrevService.normalizeKey(key || '');
      const msg = `[IndigoBook CSL-M] renderProbe abbr(${stage}): category=${String(category)} jur=${String(jurisdiction)} noHints=${String(!!noHints)} key=${String(key)} normalized=${normalized}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _normalizeItemID(id) {
    if (id == null) return null;
    if (Array.isArray(id)) return null;
    if (typeof id === 'object') {
      if ('id' in id) return id.id;
      return String(id);
    }
    return id;
  }

  _logRetrieveItemDetails(inputID, outputID, stage) {
    if (this._retrieveItemLogCount >= this._maxRetrieveItemLogs) return;
    this._retrieveItemLogCount += 1;
    const inType = Array.isArray(inputID) ? 'array' : typeof inputID;
    const outType = Array.isArray(outputID) ? 'array' : typeof outputID;
    const msg = `[IndigoBook CSL-M] retrieveItem[${this._retrieveItemLogCount}] ${stage}: inputID(${inType})=${String(inputID)} => cslItem.id(${outType})=${String(outputID)}`;
    try { Zotero.debug(msg); } catch (e) {}
    try { Zotero.logError(msg); } catch (e) {}
  }

  _warnRetrieveItem(reason) {
    if (this._didWarnRetrieveItem) return;
    this._didWarnRetrieveItem = true;
    try {
      Zotero.debug(`[IndigoBook CSL-M] retrieveItem patch warning: ${reason}`);
    } catch (e) {}
  }

  _patchAbbreviations() {
    const sysProto = Zotero?.Cite?.System?.prototype;
    if (!sysProto) return;
    if (sysProto.getAbbreviation) this._orig.getAbbreviation = sysProto.getAbbreviation;
    if (sysProto.normalizeAbbrevsKey) this._orig.normalizeAbbrevsKey = sysProto.normalizeAbbrevsKey;

    const self = this;
    sysProto.normalizeAbbrevsKey = function (_familyVar, key) {
      return self.abbrevService.normalizeKey(key);
    };

    sysProto.getAbbreviation = function (styleID, obj, jurisdiction, category, key, noHints) {
      let origJurisdiction = jurisdiction || 'default';
      if (self._orig.getAbbreviation) {
        origJurisdiction = self._orig.getAbbreviation.call(this, styleID, obj, jurisdiction, category, key, noHints) || origJurisdiction;
      }

      self._logRenderProbeFromAbbreviation(category, key, jurisdiction || origJurisdiction || 'default', noHints, 'pre');

      try {
        const jur = (jurisdiction || origJurisdiction || 'default').toLowerCase();
        if (category === 'container-title') {
          const normalizedContainerTitle = self.abbrevService.normalizeKey(key);
          const journalAbbr = self._journalAbbrByContainerTitleKey.get(normalizedContainerTitle);
          if (journalAbbr) {
            if (!obj[jur]) obj[jur] = self._newAbbreviationSegments(this);
            if (!obj[jur][category]) obj[jur][category] = {};
            obj[jur][category][key] = journalAbbr;
            self._logRenderProbeFromAbbreviation(category, key, jur, noHints, 'journal-abbr');
            self._logAbbreviation(category, key, jur, journalAbbr, 'journal-abbr');
            return jur;
          }
        }

        const hit = self.abbrevService.lookupForCiteProc(category, key, jur, { noHints });
        if (hit?.value) {
          const targetJur = hit.jurisdiction || jur || 'default';
          if (!obj[targetJur]) obj[targetJur] = self._newAbbreviationSegments(this);
          if (!obj[targetJur][category]) obj[targetJur][category] = {};
          obj[targetJur][category][key] = hit.value;
          self._logRenderProbeFromAbbreviation(category, key, targetJur, noHints, 'hit');
          self._logAbbreviation(category, key, targetJur, obj[targetJur][category][key], 'hit');
          return targetJur;
        }
        const resolvedJur = (origJurisdiction || jur || 'default').toLowerCase();
        // Citeproc expects transform.abbrevs[returnedJurisdiction] to exist.
        if (!obj[resolvedJur]) obj[resolvedJur] = self._newAbbreviationSegments(this);
        if (!obj.default) obj.default = self._newAbbreviationSegments(this);
        self._logRenderProbeFromAbbreviation(category, key, resolvedJur, noHints, 'miss');
        self._logAbbreviation(category, key, resolvedJur, null, 'miss');
        return resolvedJur;
      } catch (e) {
        self._logAbbreviation(category, key, origJurisdiction, String(e), 'error');
      }

      const fallbackJur = ((origJurisdiction || jurisdiction || 'default') || 'default').toLowerCase();
      try {
        if (!obj[fallbackJur]) obj[fallbackJur] = self._newAbbreviationSegments(this);
        if (!obj.default) obj.default = self._newAbbreviationSegments(this);
      } catch (e) {}
      return fallbackJur;
    };
  }

  _newAbbreviationSegments(sysObj) {
    if (typeof sysObj?.AbbreviationSegments === 'function') {
      return new sysObj.AbbreviationSegments();
    }

    return {
      'container-title': {},
      'collection-title': {},
      'institution-entire': {},
      'institution-part': {},
      nickname: {},
      number: {},
      title: {},
      place: {},
      hereinafter: {},
      classic: {},
      'container-phrase': {},
      'title-phrase': {},
    };
  }

  _logAbbreviation(category, key, jurisdiction, value, stage) {
    if (this._abbrevLogCount >= this._maxAbbrevLogs) return;
    this._abbrevLogCount += 1;
    const msg = `[IndigoBook CSL-M] getAbbreviation[${this._abbrevLogCount}] ${stage}: category=${category} jurisdiction=${jurisdiction} key=${String(key)} value=${String(value)}`;
    try { Zotero.debug(msg); } catch (e) {}
  }

  _patchLoadJurisdictionStyle() {
    const sysProto = Zotero?.Cite?.System?.prototype;
    if (!sysProto) return;

    // Save originals if present
    if (sysProto.loadJurisdictionStyle) this._orig.loadJurisdictionStyle = sysProto.loadJurisdictionStyle;
    if (sysProto.retrieveStyleModule) this._orig.retrieveStyleModule = sysProto.retrieveStyleModule;

    const self = this;

    // citeproc-js expects sys.loadJurisdictionStyle(jurisdiction, variantName)
    sysProto.loadJurisdictionStyle = function (jurisdiction, variantName) {
      const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
      if (xml) {
        self._logJurisdictionModuleLoad('loadJurisdictionStyle', jurisdiction, variantName, xml);
        return xml;
      }
      if (self._orig.loadJurisdictionStyle) return self._orig.loadJurisdictionStyle.call(this, jurisdiction, variantName);
      return null;
    };

    // Some builds may call a differently named hook; provide alias
    sysProto.retrieveStyleModule = function (jurisdiction, variantName) {
      const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
      if (xml) {
        self._logJurisdictionModuleLoad('retrieveStyleModule', jurisdiction, variantName, xml);
        return xml;
      }
      if (self._orig.retrieveStyleModule) return self._orig.retrieveStyleModule.call(this, jurisdiction, variantName);
      return null;
    };
  }

  _patchGetCiteProcFallback() {
    // Optional: remove the placeholder warning in juris-title if module loading fails.
    // We inject the base US macros as a safety net; if citeproc loads jurisdiction modules,
    // they will overwrite these later.
    const proto = Zotero?.Style?.prototype;
    if (!proto?.getCiteProc) return;
    this._orig.getCiteProc = proto.getCiteProc;

    const self = this;
    // Zotero 8 expects getCiteProc to be synchronous.
    // Keep this wrapper sync and avoid async I/O in this hot path.
    proto.getCiteProc = function (...args) {
      const styleXML = self._getStyleXMLSync(this);
      if (!styleXML) {
        const citeproc = self._orig.getCiteProc.apply(this, args);
        return self._instrumentCiteProcEngine(citeproc);
      }

      let effectiveXML = styleXML;
      const hasIndigoPref = effectiveXML.includes('jurisdiction-preference="IndigoTemp"');
      const hasEmptyCitation = self._hasEmptyCitationLayout(effectiveXML);
      if (hasEmptyCitation && (hasIndigoPref || self._looksLikeJurisStyle(effectiveXML))) {
        const baseUS = self.moduleLoader?._byFile?.get('juris-us.csl') || null;
        if (baseUS) {
          effectiveXML = baseUS;
          try { Zotero.debug('[IndigoBook CSL-M] Replaced empty IndigoTemp citation layout with base juris-us.csl'); } catch (e) {}
        }
      }

      // Replace the obvious placeholder hint line if present
      let patched = effectiveXML.replace(/\[HINT:[^\]]+\]/g, '');
      const restore = self._tempSetXML(this, patched);
      try {
        const citeproc = self._orig.getCiteProc.apply(this, args);
        return self._instrumentCiteProcEngine(citeproc);
      } finally {
        restore();
      }
    };
  }

  _instrumentCiteProcEngine(citeproc) {
    if (!citeproc || typeof citeproc !== 'object') return citeproc;
    if (citeproc.__indigoRenderProbeInstrumented) return citeproc;
    citeproc.__indigoRenderProbeInstrumented = true;

    this._logCiteprocEngineDetails(citeproc);
    this._instrumentParallelLifecycle(citeproc);

    try {
      const availableAbbrevDomains = this.abbrevService?.getAvailableAbbrevDomains?.();
      if (citeproc.opt && availableAbbrevDomains && Object.keys(availableAbbrevDomains).length) {
        citeproc.opt.availableAbbrevDomains = {
          ...(citeproc.opt.availableAbbrevDomains || {}),
          ...availableAbbrevDomains,
        };
      }
    } catch (e) {}

    try {
      const methodList = [
        'processCitationCluster',
        'previewCitationCluster',
        'appendCitationCluster',
        'makeBibliography',
        'updateItems',
      ];
      const available = methodList.filter((name) => typeof citeproc[name] === 'function').join(',');
      Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc instrumentation: methods=${available || 'none'}`);
    } catch (e) {}

    this._instrumentParallelTracker(citeproc);

    const wrap = (methodName) => {
      const orig = citeproc?.[methodName];
      if (typeof orig !== 'function') return;
      const self = this;
      citeproc[methodName] = function (...args) {
        self._logCiteprocMethodStart(methodName, args);
        self._logCitationBranchProbe(methodName, args[0]);
        try {
          const result = orig.apply(this, args);
          self._logCiteprocMethodEnd(methodName, result);
          return result;
        } catch (e) {
          self._logCiteprocMethodError(methodName, e);
          throw e;
        }
      };
    };

    wrap('processCitationCluster');
    wrap('previewCitationCluster');
    wrap('appendCitationCluster');
    wrap('makeBibliography');
    wrap('updateItems');
    return citeproc;
  }

  _instrumentParallelLifecycle(citeproc) {
    const wrap = (methodName) => {
      const orig = citeproc?.[methodName];
      if (typeof orig !== 'function') return;
      const marker = `__indigoParallelLifecycle_${methodName}`;
      if (citeproc[marker]) return;
      citeproc[marker] = true;

      const self = this;
      citeproc[methodName] = function (...args) {
        self._logParallelLifecycle(citeproc, `${methodName}:before`, args);
        try {
          const result = orig.apply(this, args);
          self._logParallelLifecycle(citeproc, `${methodName}:after`, args, result);
          return result;
        } catch (e) {
          self._logParallelLifecycle(citeproc, `${methodName}:error`, args, e);
          throw e;
        }
      };
    };

    wrap('retrieveAllStyleModules');
    wrap('loadStyleModule');
    wrap('buildTokenLists');
    wrap('configureTokenList');
  }

  _logCiteprocEngineDetails(citeproc) {
    try {
      const ctorName = String(citeproc?.constructor?.name || 'unknown');
      const prefRs = Zotero.Prefs?.get?.('cite.useCiteprocRs');
      const parallelEnabled = citeproc?.opt?.parallel?.enable;
      const trackRepeat = Object.keys(citeproc?.opt?.track_repeat || {});
      const hasParallelTracker = !!citeproc?.parallel;
      const msg = `[IndigoBook CSL-M] citeproc engine: ctor=${ctorName} citeprocRsPref=${String(!!prefRs)} hasParallelTracker=${String(hasParallelTracker)} parallelEnabled=${String(!!parallelEnabled)} trackRepeat=${trackRepeat.join('|') || 'none'}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logParallelLifecycle(citeproc, stage, args, resultOrError = undefined) {
    try {
      const parallel = citeproc?.opt?.parallel || {};
      const trackRepeat = Object.keys(citeproc?.opt?.track_repeat || {});
      const argSummary = this._summarizeParallelLifecycleArgs(stage, args);
      let tail = '';
      if (stage.endsWith(':error')) {
        tail = ` error=${String(resultOrError)}`;
      } else if (stage.endsWith(':after')) {
        tail = ` result=${this._summarizeParallelLifecycleResult(resultOrError)}`;
      }
      const msg = `[IndigoBook CSL-M] citeproc parallel lifecycle(${stage}): enabled=${String(!!parallel.enable)} parallelKeys=${Object.keys(parallel).join('|') || 'none'} trackRepeat=${trackRepeat.join('|') || 'none'} ${argSummary}${tail}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _summarizeParallelLifecycleArgs(stage, args) {
    try {
      if (stage.startsWith('retrieveAllStyleModules')) {
        return `jurisdictions=${JSON.stringify(args?.[0] || null)}`;
      }
      if (stage.startsWith('loadStyleModule')) {
        const xml = typeof args?.[1] === 'string' ? args[1] : '';
        return `jurisdiction=${String(args?.[0] || '')} hasXml=${String(!!xml)} xmlParallelAttrs=${String(/parallel-(first|last|last-to-first|delimiter-override)\s*=/.test(xml))} skipFallback=${String(!!args?.[2])}`;
      }
      if (stage.startsWith('buildTokenLists')) {
        const node = args?.[0];
        const target = args?.[1];
        const nodeName = String(node?.name || node?.nodeName || node?.tokentype || '');
        const targetKeys = target && typeof target === 'object' ? Object.keys(target).slice(0, 6).join('|') : 'none';
        return `node=${nodeName || 'unknown'} targetKeys=${targetKeys}`;
      }
      if (stage.startsWith('configureTokenList')) {
        const tokens = args?.[0];
        const tokenCount = Array.isArray(tokens) ? tokens.length : -1;
        const tokenNames = Array.isArray(tokens) ? tokens.slice(0, 5).map((token) => String(token?.name || token?.tokentype || '')).join('|') : 'none';
        return `tokenCount=${String(tokenCount)} tokenNames=${tokenNames || 'none'}`;
      }
    } catch (e) {}
    return 'args=unavailable';
  }

  _summarizeParallelLifecycleResult(result) {
    if (Array.isArray(result)) return `array(${result.length})`;
    if (result && typeof result === 'object') return `object(${Object.keys(result).slice(0, 6).join('|')})`;
    return String(result);
  }

  _logJurisdictionModuleLoad(hookName, jurisdiction, variantName, xml) {
    try {
      const hasParallelFirst = /parallel-first\s*=/.test(xml);
      const hasParallelLast = /parallel-last\s*=/.test(xml);
      const hasParallelLastToFirst = /parallel-last-to-first\s*=/.test(xml);
      const hasParallelDelimiter = /parallel-delimiter-override\s*=/.test(xml);
      const msg = `[IndigoBook CSL-M] jurisdiction module(${hookName}): jurisdiction=${String(jurisdiction || '')} variant=${String(variantName || '')} parallel-first=${String(hasParallelFirst)} parallel-last=${String(hasParallelLast)} parallel-last-to-first=${String(hasParallelLastToFirst)} parallel-delimiter=${String(hasParallelDelimiter)}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logCitationBranchProbe(methodName, citation) {
    try {
      const items = this._extractCitationItems(citation);
      if (!Array.isArray(items) || !items.length) return;

      for (const citationItem of items) {
        const itemID = citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null;
        const pos = citationItem?.position;
        const nearNote = !!(citationItem?.['near-note'] || citationItem?.nearNote);
        const hasLocator = citationItem?.locator != null && String(citationItem.locator).trim() !== '';
        const label = String(citationItem?.label || '');

        let branch = 'full';
        if (pos === 2 || pos === 'ibid-with-locator') branch = 'ibid-with-locator';
        else if (pos === 1 || pos === 'ibid') branch = 'ibid';
        else if (nearNote || pos === 3 || pos === 'subsequent') branch = 'short';

        const msg = `[IndigoBook CSL-M] renderProbe citeproc(${methodName}): branch=${branch} position=${String(pos)} near-note=${String(nearNote)} locator=${String(citationItem?.locator || '')} label=${label} has-locator=${String(hasLocator)} itemID=${String(itemID)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      }
    } catch (e) {}
  }

  _extractCitationItems(citationArg) {
    if (!citationArg) return [];
    if (Array.isArray(citationArg?.citationItems)) return citationArg.citationItems;
    if (Array.isArray(citationArg)) {
      for (const part of citationArg) {
        if (Array.isArray(part?.citationItems)) return part.citationItems;
      }
    }
    return [];
  }

  _logCiteprocMethodStart(methodName, args) {
    try {
      const items = this._extractCitationItems(args?.[0]);
      this._logCitationRequestPayload(methodName, items, args);
      const ids = items
        .map((citationItem) => citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null)
        .filter((id) => id != null)
        .map((id) => String(id))
        .join(',');
      Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc start(${methodName}): args=${String(args?.length || 0)} ids=${ids || 'none'}`);
    } catch (e) {}
  }

  _logCiteprocMethodEnd(methodName, result) {
    try {
      let shape = typeof result;
      if (Array.isArray(result)) shape = `array(${result.length})`;
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        shape = `object(${Object.keys(result).slice(0, 6).join('|')})`;
      }
      Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc end(${methodName}): result=${shape}`);
    } catch (e) {}
  }

  _logCiteprocMethodError(methodName, error) {
    try {
      const msg = `[IndigoBook CSL-M] renderProbe citeproc error(${methodName}): ${String(error)} stack=${String(error?.stack || '')}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _instrumentParallelTracker(citeproc) {
    try {
      const startCitation = citeproc?.parallel?.StartCitation;
      if (typeof startCitation !== 'function') return;
      if (citeproc.parallel.__indigoStartCitationInstrumented) return;
      citeproc.parallel.__indigoStartCitationInstrumented = true;

      const self = this;
      citeproc.parallel.StartCitation = function (...args) {
        try {
          self._logParallelStartCitation(args?.[0], this?.state);
        } catch (e) {}
        return startCitation.apply(this, args);
      };
    } catch (e) {}
  }

  _logCitationItemData(cslItem, zotItem, stage) {
    if (this._citationDataLogCount >= this._maxCitationDataLogs) return;
    this._citationDataLogCount += 1;
    try {
      const payload = {
        id: cslItem?.id ?? null,
        zoteroID: zotItem?.id ?? null,
        key: zotItem?.key ?? null,
        type: cslItem?.type ?? null,
        title: cslItem?.title ?? null,
        jurisdiction: cslItem?.jurisdiction ?? null,
        authority: cslItem?.authority ?? null,
        'container-title': cslItem?.['container-title'] ?? null,
        'container-title-short': cslItem?.['container-title-short'] ?? null,
        'title-short': cslItem?.['title-short'] ?? null,
        seeAlso: Array.isArray(cslItem?.seeAlso) ? cslItem.seeAlso : [],
      };
      const msg = `[IndigoBook CSL-M] citation itemData[${this._citationDataLogCount}] ${stage}: ${JSON.stringify(payload)}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logCitationRequestPayload(methodName, items, args) {
    if (!Array.isArray(items) || !items.length) return;
    if (this._citationDataLogCount >= this._maxCitationDataLogs) return;
    try {
      const payload = items.map((citationItem) => ({
        id: citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null,
        locator: citationItem?.locator ?? null,
        label: citationItem?.label ?? null,
        position: citationItem?.position ?? null,
        'near-note': citationItem?.['near-note'] ?? citationItem?.nearNote ?? null,
        prefix: citationItem?.prefix ?? null,
        suffix: citationItem?.suffix ?? null,
      }));
      const msg = `[IndigoBook CSL-M] citation request(${methodName}): items=${JSON.stringify(payload)} arg-shape=${String(args?.length || 0)}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _logParallelStartCitation(sortedItems, state) {
    if (!Array.isArray(sortedItems) || !sortedItems.length) return;
    try {
      const payload = sortedItems.map((entry) => ({
        item: {
          id: entry?.[0]?.id ?? null,
          title: entry?.[0]?.title ?? null,
          authority: this._summarizeParallelValue(entry?.[0]?.authority),
          number: this._summarizeParallelValue(entry?.[0]?.number),
          seeAlso: Array.isArray(entry?.[0]?.seeAlso) ? entry[0].seeAlso : [],
        },
        citationItem: {
          id: entry?.[1]?.id ?? entry?.[1]?.itemID ?? entry?.[1]?.itemId ?? null,
          locator: entry?.[1]?.locator ?? null,
          position: entry?.[1]?.position ?? null,
          parallel: entry?.[1]?.parallel ?? null,
        },
      }));
      const suppressRepeats = Array.isArray(state?.tmp?.suppress_repeats) ? state.tmp.suppress_repeats : [];
      const msg = `[IndigoBook CSL-M] parallel StartCitation: sortedItems=${JSON.stringify(payload)} suppressRepeats=${JSON.stringify(suppressRepeats)}`;
      Zotero.debug(msg);
      Zotero.logError(msg);
    } catch (e) {}
  }

  _summarizeParallelValue(value) {
    if (value == null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this._summarizeParallelValue(entry));
    }
    if (typeof value === 'object') {
      const out = {};
      for (const key of ['literal', 'family', 'given', 'name', 'year']) {
        if (value[key] != null) out[key] = value[key];
      }
      if (Object.keys(out).length) return out;
      return JSON.stringify(value);
    }
    return String(value);
  }

  _getStyleXMLSync(styleObj) {
    if (styleObj._xml) return styleObj._xml;
    if (styleObj._style) return styleObj._style;
    if (styleObj.file && styleObj.file.exists()) {
      try {
        if (typeof Zotero?.File?.getContents === 'function') {
          return Zotero.File.getContents(styleObj.file);
        }
        this._warnNoSyncStyleRead('Zotero.File.getContents is unavailable');
      } catch (e) {
        this._warnNoSyncStyleRead(String(e));
      }
    }
    return null;
  }

  _warnNoSyncStyleRead(reason) {
    if (this._didWarnNoSyncStyleRead) return;
    this._didWarnNoSyncStyleRead = true;
    try {
      Zotero.debug(`[IndigoBook CSL-M] Sync style fallback unavailable: ${reason}. Preload style XML during activation.`);
    } catch (e) {}
  }

  _hasEmptyCitationLayout(xml) {
    if (!xml) return false;
    return /<citation>\s*<layout>\s*<\/layout>\s*<\/citation>/i.test(xml);
  }

  _looksLikeJurisStyle(xml) {
    if (!xml) return false;
    return /<macro\s+name="juris-[^"]+"/i.test(xml)
      || /class="legal"/i.test(xml)
      || /jurisdiction-preference=/i.test(xml);
  }

  _tempSetXML(styleObj, xml) {
    const prev = { _xml: styleObj._xml, _style: styleObj._style };
    if ('_xml' in styleObj) styleObj._xml = xml;
    if ('_style' in styleObj) styleObj._style = xml;
    return () => {
      if ('_xml' in styleObj) styleObj._xml = prev._xml;
      if ('_style' in styleObj) styleObj._style = prev._style;
    };
  }
}
