var IndigoBookCSLM = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/main.mjs
  var main_exports = {};
  __export(main_exports, {
    activate: () => activate,
    deactivate: () => deactivate
  });

  // lib/services/dataStore.mjs
  var DataStore = class {
    constructor(rootURI) {
      this.rootURI = rootURI;
      this.cache = /* @__PURE__ */ new Map();
    }
    async init() {
      await Promise.all([
        this.loadJSON("style-modules/index.json").catch(() => null),
        this.loadJSON("juris-abbrevs/DIRECTORY_LISTING.json").catch(() => null),
        this.loadJSON("juris-maps/DIRECTORY_LISTING.json").catch(() => null),
        this.loadJSON("juris-maps/versions.json").catch(() => null),
        this.loadJSON("juris-maps/primary-jurisdictions.json").catch(() => null)
      ]);
    }
    async loadText(relPath) {
      if (this.cache.has(relPath)) return this.cache.get(relPath);
      const url = this.rootURI.spec + relPath;
      const req = await Zotero.HTTP.request("GET", url);
      const text = req.response;
      this.cache.set(relPath, text);
      return text;
    }
    async loadJSON(relPath) {
      if (this.cache.has(relPath)) return this.cache.get(relPath);
      const text = await this.loadText(relPath);
      const obj = JSON.parse(text);
      this.cache.set(relPath, obj);
      return obj;
    }
    async loadTextAny(relPaths) {
      const paths = Array.isArray(relPaths) ? relPaths : [relPaths];
      for (const relPath of paths) {
        if (!relPath) continue;
        try {
          return await this.loadText(relPath);
        } catch (error) {
        }
      }
      return null;
    }
    async loadJSONAny(relPaths) {
      const paths = Array.isArray(relPaths) ? relPaths : [relPaths];
      for (const relPath of paths) {
        if (!relPath) continue;
        try {
          return await this.loadJSON(relPath);
        } catch (error) {
        }
      }
      return null;
    }
  };

  // lib/services/jurisdiction.mjs
  var Jurisdiction = class {
    static fromItem(item) {
      const extra = (item.getField?.("extra") || item.extra || "") + "";
      const jur = this._fromMLZ(extra) || this._fromKeyValue(extra);
      if (!jur) return "";
      return this._normalizeJurisdiction(jur);
    }
    static getMLZExtraFields(itemOrExtra) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const jsonText = this._extractMLZJSON(extra);
      if (!jsonText) return null;
      try {
        const obj = JSON.parse(jsonText);
        return obj?.extrafields || null;
      } catch (e) {
        return null;
      }
    }
    static getMLZExtraCreators(itemOrExtra) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
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
      const normalizedType = String(creatorType || "").trim().toLowerCase();
      if (!normalizedType) return [];
      return this.getMLZExtraCreators(itemOrExtra).filter((creator) => String(creator?.creatorType || "").trim().toLowerCase() === normalizedType).map((creator) => ({ ...creator }));
    }
    static updateMLZExtraCreators(itemOrExtra, creatorType, creators) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const normalizedType = String(creatorType || "").trim().toLowerCase();
      if (!normalizedType) return extra;
      const parsed = this._getMLZPayloadAndRange(extra);
      const payload = parsed.payload || {};
      const existingCreators = Array.isArray(payload.extracreators) ? payload.extracreators : [];
      const retainedCreators = existingCreators.filter((creator) => {
        return String(creator?.creatorType || "").trim().toLowerCase() !== normalizedType;
      });
      const incomingCreators = Array.isArray(creators) ? creators : [];
      for (const creator of incomingCreators) {
        const normalizedCreator = this._normalizeExtraCreator(creator, normalizedType);
        if (normalizedCreator) retainedCreators.push(normalizedCreator);
      }
      if (retainedCreators.length) payload.extracreators = retainedCreators;
      else delete payload.extracreators;
      const hasExtraFields = payload.extrafields && typeof payload.extrafields === "object" && !Array.isArray(payload.extrafields) && Object.keys(payload.extrafields).length;
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
      const base = String(extra || "").trimEnd();
      return base ? `${base}
${mlzBlock}` : mlzBlock;
    }
    static getMLZJurisdiction(itemOrExtra) {
      const fields = this.getMLZExtraFields(itemOrExtra);
      const value = fields?.jurisdiction;
      if (!value) return "";
      return this._normalizeJurisdiction(this._decodeLengthPrefixedJurisdiction(String(value)) || "");
    }
    static updateMLZJurisdiction(itemOrExtra, jurisdiction, displayValue = "") {
      const normalized = this._normalizeJurisdiction(jurisdiction || "");
      const encoded = normalized ? this._encodeLengthPrefixedJurisdiction(normalized, displayValue) : "";
      return this.updateMLZExtraField(itemOrExtra, "jurisdiction", encoded);
    }
    static updateMLZExtraField(itemOrExtra, fieldName, fieldValue) {
      const extra = typeof itemOrExtra === "string" ? itemOrExtra : itemOrExtra?.getField?.("extra") || itemOrExtra?.extra || "";
      const field = (fieldName || "").toString().trim();
      if (!field) return extra;
      const parsed = this._getMLZPayloadAndRange(extra);
      if (!parsed.payload && (fieldValue == null || String(fieldValue).trim() === "")) {
        return extra;
      }
      const payload = parsed.payload || {};
      if (!payload.extrafields || typeof payload.extrafields !== "object" || Array.isArray(payload.extrafields)) {
        payload.extrafields = {};
      }
      const value = fieldValue == null ? "" : String(fieldValue).trim();
      if (value) payload.extrafields[field] = value;
      else delete payload.extrafields[field];
      if (!Object.keys(payload.extrafields).length) delete payload.extrafields;
      const hasExtraFields = payload.extrafields && typeof payload.extrafields === "object" && !Array.isArray(payload.extrafields) && Object.keys(payload.extrafields).length;
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
      const base = String(extra || "").trimEnd();
      return base ? `${base}
${mlzBlock}` : mlzBlock;
    }
    static _fromMLZ(extra) {
      const fields = this.getMLZExtraFields(extra);
      const j = fields?.jurisdiction;
      if (!j) return null;
      return this._decodeLengthPrefixedJurisdiction(j);
    }
    static _extractMLZJSON(extra) {
      const idx = (extra || "").indexOf("mlzsync1:");
      if (idx === -1) return null;
      const braceStart = extra.indexOf("{", idx);
      if (braceStart === -1) return null;
      let depth = 0;
      let inString = false;
      let escaping = false;
      for (let i = braceStart; i < extra.length; i += 1) {
        const ch = extra[i];
        if (inString) {
          if (escaping) {
            escaping = false;
          } else if (ch === "\\") {
            escaping = true;
          } else if (ch === '"') {
            inString = false;
          }
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === "{") {
          depth += 1;
          continue;
        }
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            return extra.slice(braceStart, i + 1);
          }
        }
      }
      return null;
    }
    static _getMLZPayloadAndRange(extra) {
      const source = String(extra || "");
      const marker = "mlzsync1:";
      const markerIndex = source.indexOf(marker);
      if (markerIndex === -1) {
        return { payload: null, start: null, end: null };
      }
      const braceStart = source.indexOf("{", markerIndex);
      if (braceStart === -1) {
        return { payload: null, start: null, end: null };
      }
      let depth = 0;
      let inString = false;
      let escaping = false;
      for (let i = braceStart; i < source.length; i += 1) {
        const ch = source[i];
        if (inString) {
          if (escaping) escaping = false;
          else if (ch === "\\") escaping = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === "{") {
          depth += 1;
          continue;
        }
        if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            const jsonText = source.slice(braceStart, i + 1);
            try {
              return {
                payload: JSON.parse(jsonText),
                start: markerIndex,
                end: i + 1
              };
            } catch (e) {
              return { payload: null, start: markerIndex, end: i + 1 };
            }
          }
        }
      }
      return { payload: null, start: markerIndex, end: source.length };
    }
    static _removeMLZBlock(extra, start, end) {
      const source = String(extra || "");
      const prefix = source.slice(0, start).replace(/[ \t]+\n?$/, "");
      const suffix = source.slice(end).replace(/^\r?\n/, "");
      const combined = `${prefix}${prefix && suffix ? "\n" : ""}${suffix}`;
      return combined.trimEnd();
    }
    static _normalizeExtraCreator(creator, creatorType) {
      if (!creator || typeof creator !== "object") return null;
      const literalName = String(creator.name || "").trim();
      if (literalName) {
        return {
          name: literalName,
          creatorType
        };
      }
      const firstName = String(creator.firstName || "").trim();
      const lastName = String(creator.lastName || "").trim();
      if (!firstName && !lastName) return null;
      return {
        firstName,
        lastName,
        creatorType
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
    static _encodeLengthPrefixedJurisdiction(value, displayValue = "") {
      const jurisdiction = (value || "").toString().trim();
      if (!jurisdiction) return "";
      const display = (displayValue || "").toString().trim();
      return `${String(jurisdiction.length).padStart(3, "0")}${jurisdiction}${display}`;
    }
    static _fromKeyValue(extra) {
      const m = extra.match(/^\s*jurisdiction\s*:\s*([^\n\r]+?)\s*$/im);
      return m ? m[1] : null;
    }
    static _normalizeJurisdiction(jur) {
      let value = (jur || "").toString().trim().toLowerCase();
      if (!value) return "";
      const stateInfoByName = {
        alabama: { code: "al", circuit: "11" },
        alaska: { code: "ak", circuit: "9" },
        arizona: { code: "az", circuit: "9" },
        arkansas: { code: "ar", circuit: "8" },
        california: { code: "ca", circuit: "9" },
        colorado: { code: "co", circuit: "10" },
        connecticut: { code: "ct", circuit: "2" },
        delaware: { code: "de", circuit: "3" },
        districtofcolumbia: { code: "dc", circuit: "0" },
        dc: { code: "dc", circuit: "0" },
        florida: { code: "fl", circuit: "11" },
        georgia: { code: "ga", circuit: "11" },
        hawaii: { code: "hi", circuit: "9" },
        idaho: { code: "id", circuit: "9" },
        illinois: { code: "il", circuit: "7" },
        indiana: { code: "in", circuit: "7" },
        iowa: { code: "ia", circuit: "8" },
        kansas: { code: "ks", circuit: "10" },
        kentucky: { code: "ky", circuit: "6" },
        louisiana: { code: "la", circuit: "5" },
        maine: { code: "me", circuit: "1" },
        maryland: { code: "md", circuit: "4" },
        massachusetts: { code: "ma", circuit: "1" },
        michigan: { code: "mi", circuit: "6" },
        minnesota: { code: "mn", circuit: "8" },
        mississippi: { code: "ms", circuit: "5" },
        missouri: { code: "mo", circuit: "8" },
        montana: { code: "mt", circuit: "9" },
        nebraska: { code: "ne", circuit: "8" },
        nevada: { code: "nv", circuit: "9" },
        newhampshire: { code: "nh", circuit: "1" },
        newjersey: { code: "nj", circuit: "3" },
        newmexico: { code: "nm", circuit: "10" },
        newyork: { code: "ny", circuit: "2" },
        northcarolina: { code: "nc", circuit: "4" },
        northdakota: { code: "nd", circuit: "8" },
        ohio: { code: "oh", circuit: "6" },
        oklahoma: { code: "ok", circuit: "10" },
        oregon: { code: "or", circuit: "9" },
        pennsylvania: { code: "pa", circuit: "3" },
        puertorico: { code: "pr", circuit: "1" },
        rhodeisland: { code: "ri", circuit: "1" },
        southcarolina: { code: "sc", circuit: "4" },
        southdakota: { code: "sd", circuit: "8" },
        tennessee: { code: "tn", circuit: "6" },
        texas: { code: "tx", circuit: "5" },
        utah: { code: "ut", circuit: "10" },
        vermont: { code: "vt", circuit: "2" },
        virginia: { code: "va", circuit: "4" },
        washington: { code: "wa", circuit: "9" },
        westvirginia: { code: "wv", circuit: "4" },
        wisconsin: { code: "wi", circuit: "7" },
        wyoming: { code: "wy", circuit: "10" },
        guam: { code: "gu", circuit: "9" },
        usvirginislands: { code: "vi", circuit: "3" },
        virginislands: { code: "vi", circuit: "3" },
        northernmarianaislands: { code: "mp", circuit: "9" }
      };
      if (/^us(?::[a-z0-9._-]+)*$/.test(value)) return value;
      const districtMatch = value.match(/^([nsewmc])?\s*\.?\s*d\.?\s+(.+)$/i);
      if (districtMatch) {
        const districtPart = districtMatch[1] ? `${String(districtMatch[1]).toLowerCase()}d` : "d";
        const stateCompact = String(districtMatch[2] || "").replace(/[^a-z]/g, "");
        const state = stateInfoByName[stateCompact];
        if (state?.code) {
          if (state.code === "dc") return "us:dc.d";
          if (state.circuit) return `us:c${state.circuit}:${state.code}.${districtPart}`;
          return `us:${state.code}.${districtPart}`;
        }
      }
      const compact = value.replace(/[^a-z0-9]/g, "");
      if (compact === "federalcircuit" || compact === "fedcir" || compact === "cafc") return "us:c";
      if (compact === "dccircuit" || compact === "districtofcolumbiacircuit" || compact === "dccir") return "us:c0";
      const ordinals = {
        first: "1",
        second: "2",
        third: "3",
        fourth: "4",
        fifth: "5",
        sixth: "6",
        seventh: "7",
        eighth: "8",
        ninth: "9",
        tenth: "10",
        eleventh: "11"
      };
      for (const [word, num] of Object.entries(ordinals)) {
        if (compact === `${word}circuit`) return `us:c${num}`;
      }
      const numbered = compact.match(/^(1|2|3|4|5|6|7|8|9|10|11)(st|nd|rd|th)?circuit$/);
      if (numbered) return `us:c${numbered[1]}`;
      const byName = {
        ohio: "us:oh",
        california: "us:ca",
        newyork: "us:ny",
        texas: "us:tx",
        florida: "us:fl",
        illinois: "us:il",
        pennsylvania: "us:pa",
        virginia: "us:va",
        massachusetts: "us:ma",
        michigan: "us:mi"
      };
      const compactAlpha = value.replace(/[^a-z]/g, "");
      if (stateInfoByName[compactAlpha]?.code) return `us:${stateInfoByName[compactAlpha].code}`;
      if (byName[compactAlpha]) return byName[compactAlpha];
      return value;
    }
    static isRecognizedJurisdiction(jur) {
      const normalized = this._normalizeJurisdiction(jur || "");
      if (!normalized) return false;
      if (/^us(?::[a-z0-9._-]+)*$/.test(normalized)) return true;
      const compact = normalized.replace(/[^a-z0-9]/g, "");
      const knownRoots = /* @__PURE__ */ new Set([
        "au",
        "ca",
        "uk"
      ]);
      return knownRoots.has(compact);
    }
    static trimChain(jur) {
      const parts = (jur || "us").toLowerCase().split(":");
      const chain = [];
      for (let i = parts.length; i >= 1; i--) chain.push(parts.slice(0, i).join(":"));
      return chain;
    }
    static isCircuit(jur) {
      const parts = (jur || "").toLowerCase().split(":");
      return parts[0] === "us" && /^c\d+$/.test(parts[1] || "");
    }
    static topToken(jur) {
      const parts = (jur || "").toLowerCase().split(":");
      return parts[1] || null;
    }
  };

  // lib/services/moduleLoader.mjs
  var ModuleLoader = class {
    constructor({ rootURI, dataStore, locale }) {
      this.rootURI = rootURI;
      this.dataStore = dataStore;
      this.locale = locale;
      this._defaultJurisdiction = "us";
      this._availableFiles = [];
      this._byFile = /* @__PURE__ */ new Map();
      this._byJur = /* @__PURE__ */ new Map();
      this._byModuleID = /* @__PURE__ */ new Map();
    }
    async preload() {
      const idx = await this.dataStore.loadJSON("style-modules/index.json");
      const allFiles = Array.isArray(idx?.files) ? idx.files.slice() : [];
      this._availableFiles = allFiles.filter((file) => /\.csl$/i.test(file) && file.toLowerCase().startsWith("juris-")).sort((a, b) => a.localeCompare(b));
      for (const file of this._availableFiles) {
        const path = "style-modules/" + file;
        const xml = await this.dataStore.loadText(path);
        this._byFile.set(file, xml);
        const info = this._parseModuleFilename(file);
        if (!info) continue;
        this._byModuleID.set(info.id, xml);
        let byVariant = this._byJur.get(info.jurisdiction);
        if (!byVariant) {
          byVariant = /* @__PURE__ */ new Map();
          this._byJur.set(info.jurisdiction, byVariant);
        }
        byVariant.set(info.variant, xml);
      }
      if (!this._hasModuleForJurisdiction(this._defaultJurisdiction) && this._availableFiles.length) {
        const firstInfo = this._parseModuleFilename(this._availableFiles[0]);
        const firstRoot = firstInfo?.jurisdiction?.split(":")[0] || "";
        if (firstRoot && this._hasModuleForJurisdiction(firstRoot)) {
          this._defaultJurisdiction = firstRoot;
        }
      }
    }
    _parseModuleFilename(file) {
      const stem = String(file || "").replace(/\.csl$/i, "");
      if (!stem.toLowerCase().startsWith("juris-")) return null;
      const body = stem.slice(6);
      if (!body) return null;
      const dashIdx = body.indexOf("-");
      const jurisdictionPart = dashIdx === -1 ? body : body.slice(0, dashIdx);
      const variantPart = dashIdx === -1 ? "" : body.slice(dashIdx + 1);
      if (!jurisdictionPart) return null;
      return {
        fileName: file,
        id: stem,
        jurisdiction: jurisdictionPart.toLowerCase().replace(/\+/g, ":"),
        variant: variantPart.toLowerCase()
      };
    }
    _hasModuleForJurisdiction(jurisdiction) {
      return this._byJur.has(String(jurisdiction || "").toLowerCase());
    }
    hasJurisdiction(jur) {
      return this._hasModuleForJurisdiction(jur);
    }
    _normalizeVariantName(variantName) {
      return String(variantName || "").trim().toLowerCase();
    }
    _getJurisdictionVariantMap(jurisdiction) {
      return this._byJur.get(String(jurisdiction || "").toLowerCase()) || null;
    }
    _getModuleForJurisdiction(jurisdiction, variantName = "") {
      const byVariant = this._getJurisdictionVariantMap(jurisdiction);
      if (!byVariant) return null;
      const variant = this._normalizeVariantName(variantName);
      if (variant && byVariant.has(variant)) {
        return byVariant.get(variant);
      }
      if (byVariant.has("")) {
        return byVariant.get("");
      }
      if (!variant && byVariant.size) {
        return byVariant.values().next().value || null;
      }
      return null;
    }
    loadJurisdictionStyleSync(jurisdiction, variantName = "IndigoTemp") {
      const variant = this._normalizeVariantName(variantName);
      const jur = String(jurisdiction || this._defaultJurisdiction || "us").trim().toLowerCase() || "us";
      const chain = Jurisdiction.trimChain(jur);
      if (variant) {
        for (const j of chain) {
          const byVariant = this._getJurisdictionVariantMap(j);
          if (byVariant?.has(variant)) {
            return byVariant.get(variant);
          }
        }
      }
      for (const j of chain) {
        const xml = this._getModuleForJurisdiction(j, "");
        if (xml) return xml;
      }
      return this._getModuleForJurisdiction(this._defaultJurisdiction, variant) || null;
    }
  };

  // lib/services/locale.mjs
  function getLocaleCandidates(rawLocale) {
    const locale = String(rawLocale || "").trim().replace(/_/g, "-");
    if (!locale) {
      return ["us"];
    }
    const parts = locale.split("-").filter(Boolean);
    const candidates = [];
    const push = (value) => {
      const code = String(value || "").trim().toLowerCase();
      if (code && !candidates.includes(code)) {
        candidates.push(code);
      }
    };
    push(parts.join("-"));
    if (parts.length >= 2) {
      push(`${parts[1]}-${parts[0]}`);
    }
    for (let index = 1; index < parts.length; index += 1) {
      const part = parts[index];
      if (/^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)) {
        push(part);
        break;
      }
    }
    push(parts[0]);
    push("us");
    return candidates;
  }
  function filePrefixMatches(fileName, prefix) {
    const file = String(fileName || "").toLowerCase();
    const stem = String(prefix || "").toLowerCase();
    const fileStem = file.replace(/\.[^.]+$/, "");
    return fileStem === stem || fileStem.startsWith(`${stem}-`) || fileStem.startsWith(`${stem}+`);
  }
  function selectLocaleFiles(fileNames, prefix, rawLocale, extension) {
    const files = Array.isArray(fileNames) ? fileNames.slice() : [];
    const normalizedExtension = String(extension || "").trim().toLowerCase();
    const candidates = getLocaleCandidates(rawLocale);
    const matchingFiles = (candidate) => {
      const lowerCandidate = String(candidate || "").trim().toLowerCase();
      const exactName = normalizedExtension ? `${prefix}-${lowerCandidate}${normalizedExtension}` : `${prefix}-${lowerCandidate}`;
      const exact = [];
      const variants = [];
      for (const file of files) {
        const lower = String(file || "").toLowerCase();
        if (normalizedExtension && !lower.endsWith(normalizedExtension)) continue;
        if (!filePrefixMatches(lower, `${prefix}-${lowerCandidate}`)) continue;
        if (lower === exactName) {
          exact.push(file);
        } else {
          variants.push(file);
        }
      }
      exact.sort((a, b) => a.localeCompare(b));
      variants.sort((a, b) => a.localeCompare(b));
      return exact.concat(variants);
    };
    for (const candidate of candidates) {
      const matches = matchingFiles(candidate);
      if (matches.length) {
        return matches;
      }
    }
    return [];
  }

  // lib/services/abbrevService.mjs
  var AbbrevService = class {
    constructor({ dataStore, locale }) {
      this.dataStore = dataStore;
      this.locale = locale;
      this._localeCandidates = getLocaleCandidates(locale);
      this._autoDatasets = /* @__PURE__ */ new Map();
      this._autoDatasetsByRoot = /* @__PURE__ */ new Map();
      this._autoDomainsByRoot = /* @__PURE__ */ new Map();
      this._primaryDatasets = /* @__PURE__ */ new Map();
      this._primaryDatasetsByRoot = /* @__PURE__ */ new Map();
      this._mapDatasets = /* @__PURE__ */ new Map();
      this._mapDatasetsByRoot = /* @__PURE__ */ new Map();
      this._defaultAutoDataset = null;
      this._defaultPrimaryDataset = null;
      this._defaultMapDataset = null;
      this._autoUS = null;
      this._primaryUS = null;
      this._secondaryDatasets = {};
      this._secondaryDatasetOrder = [];
      this._secondaryDatasetMeta = /* @__PURE__ */ new Map();
      this._defaultSecondaryDataset = "secondary-us-bluebook";
      this._jurisUSMap = null;
      this._primaryJur = null;
      this._defaultJurisdiction = "us";
      this._userSecondaryOverrides = {};
      this._secondaryOverridesPref = "extensions.indigobook-cslm.secondaryContainerTitleOverrides";
      this._userJurisdictionOverrides = {};
      this._jurisdictionOverridesPref = "extensions.indigobook-cslm.jurisdictionOverrides";
    }
    async preload() {
      const listing = await this.dataStore.loadJSON("juris-abbrevs/DIRECTORY_LISTING.json");
      const listingEntries = Array.isArray(listing) ? listing : [];
      const listingFiles = this._expandListingFiles(listingEntries);
      const fileNames = listingFiles.map((item) => item.filename);
      const fileMetaByName = new Map(listingFiles.map((item) => [item.filename, item.name]));
      const mapListing = await this.dataStore.loadJSONAny(["juris-maps/DIRECTORY_LISTING.json"]);
      const mapListingEntries = Array.isArray(mapListing) ? mapListing : [];
      const mapFileMetaByName = new Map(
        mapListingEntries.map((item) => [String(item?.filename || "").trim(), String(item?.name || "").trim()]).filter(([filename]) => Boolean(filename))
      );
      const autoFiles = fileNames.filter((file) => /^auto-.*\.json$/i.test(file));
      this._autoDatasets = await this._loadDatasetGroup("juris-abbrevs", autoFiles, fileMetaByName);
      this._autoDatasetsByRoot = this._groupDatasetsByRoot(this._autoDatasets);
      this._autoDomainsByRoot = this._groupDatasetDomainsByRoot(this._autoDatasets);
      this._defaultAutoDataset = this._pickLocaleDataset(Array.from(this._autoDatasets.keys()), "auto") || null;
      this._autoUS = this._defaultAutoDataset ? this._autoDatasets.get(this._defaultAutoDataset)?.data || null : null;
      this._defaultJurisdiction = this._jurisdictionRootFromFilename(this._defaultAutoDataset) || this._defaultJurisdiction;
      const primaryFiles = fileNames.filter((file) => /^primary-.*\.json$/i.test(file));
      this._primaryDatasets = await this._loadDatasetGroup("juris-abbrevs", primaryFiles, fileMetaByName);
      this._primaryDatasetsByRoot = this._groupDatasetsByRoot(this._primaryDatasets);
      this._defaultPrimaryDataset = this._primaryDatasets.has("primary-us") ? "primary-us" : Array.from(this._primaryDatasets.keys())[0] || null;
      this._primaryUS = this._defaultPrimaryDataset ? this._primaryDatasets.get(this._defaultPrimaryDataset)?.data || null : null;
      const mapFiles = Array.from(/* @__PURE__ */ new Set([
        ...mapListingEntries.map((item) => String(item?.filename || "").trim()).filter((file) => /^juris-.*-map\.json$/i.test(file)),
        ...fileNames.filter((file) => /^juris-.*-map\.json$/i.test(file))
      ])).sort((a, b) => a.localeCompare(b));
      this._mapDatasets = await this._loadDatasetGroup("juris-maps", mapFiles, mapFileMetaByName);
      this._mapDatasetsByRoot = this._groupDatasetsByRoot(this._mapDatasets);
      this._defaultMapDataset = this._mapDatasets.has("juris-us-map") ? "juris-us-map" : Array.from(this._mapDatasets.keys())[0] || null;
      this._jurisUSMap = this._defaultMapDataset ? this._mapDatasets.get(this._defaultMapDataset)?.data || null : null;
      const secondaryFiles = fileNames.filter((file) => /^secondary-.*\.json$/i.test(file));
      this._secondaryDatasetMeta = new Map(
        secondaryFiles.map((file) => {
          const dataset = this._datasetNameFromFilename(file);
          return [dataset, {
            filename: file,
            name: fileMetaByName.get(file) || dataset
          }];
        })
      );
      this._secondaryDatasets = {};
      for (const file of secondaryFiles) {
        const dataset = this._datasetNameFromFilename(file);
        this._secondaryDatasets[dataset] = await this.dataStore.loadJSON(`juris-abbrevs/${file}`);
      }
      this._secondaryDatasetOrder = this._buildSecondaryDatasetOrder(Object.keys(this._secondaryDatasets));
      this._defaultSecondaryDataset = this._secondaryDatasetOrder.find((dataset) => this._secondaryDatasets?.[dataset]) || this._secondaryDatasetOrder[0] || "secondary-us-bluebook";
      this._primaryJur = await this.dataStore.loadJSONAny(["juris-maps/primary-jurisdictions.json", "data/primary-jurisdictions.json"]);
      this._userSecondaryOverrides = this._loadSecondaryOverrides();
      this._userJurisdictionOverrides = this._loadJurisdictionOverrides();
    }
    _buildLocalePathCandidates(basePath, suffix) {
      const candidates = [];
      const seen = /* @__PURE__ */ new Set();
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
      const seen = /* @__PURE__ */ new Set();
      for (const item of Array.isArray(listingEntries) ? listingEntries : []) {
        const filename = String(item?.filename || "").trim();
        const name = String(item?.name || "").trim();
        if (filename && !seen.has(filename)) {
          seen.add(filename);
          rows.push({ filename, name });
        }
        const variants = item?.variants;
        if (!variants || typeof variants !== "object" || Array.isArray(variants) || !filename) continue;
        for (const variantName of Object.keys(variants)) {
          const variant = String(variantName || "").trim();
          if (!variant) continue;
          const variantFile = filename.replace(/\.json$/i, `-${variant}.json`);
          if (!variantFile || seen.has(variantFile)) continue;
          seen.add(variantFile);
          rows.push({ filename: variantFile, name });
        }
      }
      return rows;
    }
    async _loadDatasetGroup(rootDir, fileNames, metaByFileName = /* @__PURE__ */ new Map()) {
      const datasets = /* @__PURE__ */ new Map();
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
          data
        });
      }
      return datasets;
    }
    _inferDatasetDisplayName(dataset, data) {
      const explicitName = String(data?.name || "").trim();
      if (explicitName) return explicitName;
      const localizedJurisdictions = this._getLocalizedMapJurisdictions(data);
      if (Array.isArray(localizedJurisdictions)) {
        for (const item of localizedJurisdictions) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const label = String(item[1] || "").trim();
          if (label) return label;
        }
      }
      return this._formatDatasetLabel(dataset);
    }
    _getLocalizedMapJurisdictions(mapData) {
      const jurisdictions = mapData?.jurisdictions;
      if (!jurisdictions || typeof jurisdictions !== "object" || Array.isArray(jurisdictions)) return null;
      for (const candidate of this._localeCandidates || []) {
        const rows = jurisdictions?.[candidate];
        if (Array.isArray(rows) && rows.length) return rows;
      }
      return Array.isArray(jurisdictions?.default) ? jurisdictions.default : null;
    }
    _groupDatasetsByRoot(datasets) {
      const byRoot = /* @__PURE__ */ new Map();
      for (const info of datasets?.values?.() || []) {
        const root = String(info?.root || "").trim().toLowerCase();
        if (!root) continue;
        if (!byRoot.has(root)) byRoot.set(root, []);
        byRoot.get(root).push(info);
      }
      for (const infos of byRoot.values()) {
        infos.sort((a, b) => String(a.fileName || "").localeCompare(String(b.fileName || "")));
      }
      return byRoot;
    }
    _groupDatasetDomainsByRoot(datasets) {
      const byRoot = /* @__PURE__ */ new Map();
      for (const info of datasets?.values?.() || []) {
        const root = String(info?.root || "").trim().toLowerCase();
        const domain = String(info?.domain || "").trim();
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
      const exactCandidates = selectLocaleFiles(names.map((name) => `${name}.json`), prefix, this.locale, ".json").map((file) => this._datasetNameFromFilename(file));
      if (exactCandidates.length) {
        return exactCandidates[0];
      }
      const exactPrefix = `${prefix}-`;
      const lowerLocale = this._localeCandidates[0] || "";
      for (const name of names) {
        if (name.toLowerCase() === `${prefix}-${lowerLocale}`.toLowerCase()) return name;
        if (name.toLowerCase().startsWith(exactPrefix)) return name;
      }
      return names[0];
    }
    _buildSecondaryDatasetOrder(loadedDatasets = []) {
      const core = ["secondary-us-bluebook", "secondary-science"];
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
      return String(fileName || "").trim().replace(/\.json$/i, "");
    }
    _datasetBodyFromFilename(fileName) {
      return this._datasetNameFromFilename(fileName).replace(/^auto-/i, "").replace(/^primary-/i, "").replace(/^secondary-/i, "").replace(/^juris-/i, "").replace(/-map$/i, "");
    }
    _jurisdictionRootFromFilename(fileName) {
      const body = this._datasetBodyFromFilename(fileName);
      const root = body.split("-")[0];
      return root ? root.toLowerCase().replace(/\+/g, ":") : null;
    }
    _datasetDomainFromFilename(fileName) {
      const body = this._datasetBodyFromFilename(fileName);
      const dashIdx = body.indexOf("-");
      if (dashIdx === -1) return null;
      const domain = body.slice(dashIdx + 1).trim();
      return domain || null;
    }
    _normalizeDatasetDomain(rawDomain) {
      return String(rawDomain || "").trim().toLowerCase() || null;
    }
    _splitJurisdictionDomain(rawJurisdiction) {
      const input = String(rawJurisdiction || "").trim();
      const atIdx = input.indexOf("@");
      const jurisdiction = (atIdx === -1 ? input : input.slice(0, atIdx)).trim().toLowerCase();
      const domain = atIdx === -1 ? "" : input.slice(atIdx + 1).trim();
      return {
        jurisdiction,
        domain,
        domainKey: this._normalizeDatasetDomain(domain)
      };
    }
    _jurisdictionRoot(rawJurisdiction) {
      const jurisdiction = this._splitJurisdictionDomain(rawJurisdiction).jurisdiction;
      if (!jurisdiction || jurisdiction === "default") {
        return this._defaultJurisdiction || "us";
      }
      return jurisdiction.split(":")[0] || (this._defaultJurisdiction || "us");
    }
    _jurisdictionMapCode(rawJurisdiction) {
      const jurisdiction = this._splitJurisdictionDomain(rawJurisdiction).jurisdiction;
      if (!jurisdiction || jurisdiction === "default") {
        return this._defaultJurisdiction || "us";
      }
      const parts = jurisdiction.split(":").filter(Boolean);
      return parts[parts.length - 1] || (this._defaultJurisdiction || "us");
    }
    _pickDatasetInfoForRoot(byRoot, root, fallbackDatasetName = null, preferredDomain = null) {
      const normalizedRoot = String(root || "").trim().toLowerCase();
      if (!normalizedRoot) return null;
      const entries = byRoot?.get?.(normalizedRoot) || [];
      if (Array.isArray(entries) && entries.length) {
        const normalizedDomain = this._normalizeDatasetDomain(preferredDomain);
        if (normalizedDomain) {
          const exactDomain = entries.find((entry) => this._normalizeDatasetDomain(entry?.domain) === normalizedDomain);
          if (exactDomain) return exactDomain;
        }
        const fallback = String(fallbackDatasetName || "").trim().toLowerCase();
        if (fallback.startsWith("juris-") && fallback.endsWith("-map")) {
          const exactMap = entries.find((entry) => String(entry.dataset || "").toLowerCase() === `juris-${normalizedRoot}-map`);
          if (exactMap) return exactMap;
        } else if (fallback.startsWith("primary-")) {
          const exactPrimary = entries.find((entry) => String(entry.dataset || "").toLowerCase() === `primary-${normalizedRoot}`);
          if (exactPrimary) return exactPrimary;
        } else if (fallback.startsWith("auto-")) {
          const exactAuto = entries.find((entry) => String(entry.dataset || "").toLowerCase() === `auto-${normalizedRoot}`);
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
      const dataset = String(rawDataset || "").trim();
      if (!dataset) return this._defaultAutoDataset || "auto-us";
      return dataset.replace(/^jurisdiction:/i, "");
    }
    _getJurisdictionDatasetInfo(rawDataset) {
      const dataset = this._normalizeJurisdictionDatasetName(rawDataset);
      if (this._autoDatasets.has(dataset)) {
        return { kind: "auto", ...this._autoDatasets.get(dataset) };
      }
      if (this._primaryDatasets.has(dataset)) {
        return { kind: "primary", ...this._primaryDatasets.get(dataset) };
      }
      if (this._mapDatasets.has(dataset)) {
        return { kind: "map", ...this._mapDatasets.get(dataset) };
      }
      return null;
    }
    _getJurisdictionOverrideBucket(rawDataset) {
      const dataset = this._normalizeJurisdictionDatasetName(rawDataset);
      if (!dataset) return {};
      const bucket = this._userJurisdictionOverrides?.[dataset];
      return bucket && typeof bucket === "object" && !Array.isArray(bucket) ? bucket : {};
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
      return (s || "").toString().trim().toLowerCase().replace(/[“”]/g, '"').replace(/[’]/g, "'").replace(/[^a-z0-9\s\.-]/g, " ").replace(/\s+/g, " ").trim();
    }
    parseDirective(val) {
      if (!val) return { value: val, directive: null };
      const m = /^!([a-z-]+)\>\>\>(.+)$/.exec(val);
      if (!m) return { value: val, directive: null };
      return { value: m[2], directive: m[1] };
    }
    lookupForCiteProc(category, key, jur, options = {}) {
      const parsedJurisdiction = this._splitJurisdictionDomain(jur || this._defaultJurisdiction || "default");
      const preferredJur = parsedJurisdiction.jurisdiction || (this._defaultJurisdiction || "default");
      const effectiveJur = preferredJur === "default" ? this._defaultJurisdiction || "us" : preferredJur;
      const preferredJurWithDomain = parsedJurisdiction.domain ? `${effectiveJur}@${parsedJurisdiction.domain}` : effectiveJur;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(preferredJurWithDomain) || this._getAutoDatasetInfoForJurisdiction(effectiveJur) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset) || { kind: "auto", dataset: this._defaultAutoDataset || "auto-us", data: this._autoUS };
      const primaryData = this._primaryUS?.xdata || null;
      const primaryOverrides = this._getJurisdictionOverrideBucket(this._defaultPrimaryDataset);
      const autoOverrides = this._getJurisdictionOverrideBucket(autoInfo?.dataset);
      const noHints = !!options.noHints;
      const normalizedKey = this.normalizeKey(key);
      const normalizedKeyNoDots = normalizedKey.replace(/\./g, " ").replace(/\s+/g, " ").trim();
      const containerTitleKeys = [normalizedKey];
      if (normalizedKeyNoDots && normalizedKeyNoDots !== normalizedKey) {
        containerTitleKeys.push(normalizedKeyNoDots);
      }
      let hit = null;
      if (category === "institution-part" || category === "institution-entire") {
        hit = this._lookupInstitutionCategoryValue(
          category,
          key,
          normalizedKey,
          effectiveJur,
          autoInfo?.data?.xdata,
          autoOverrides
        );
        if (hit?.value) return { jurisdiction: preferredJurWithDomain, value: hit.value };
        return null;
      }
      if (category === "place") {
        const upper = effectiveJur.toUpperCase();
        const value = this._lookupAutoUSPlaceOverride(upper, autoInfo?.dataset) || this._primaryJur?.xdata?.default?.place?.[upper] || autoInfo?.data?.xdata?.default?.place?.[upper] || null;
        return value ? { jurisdiction: preferredJurWithDomain, value } : null;
      }
      if (category === "container-title") {
        for (const containerTitleKey of containerTitleKeys) {
          hit = lookupJurChainWithOverrides(
            primaryData,
            primaryOverrides,
            effectiveJur,
            "container-title",
            containerTitleKey
          );
          if (hit?.value) return { jurisdiction: preferredJurWithDomain, value: hit.value };
          const secondaryValue = this._lookupSecondaryContainerTitle(containerTitleKey);
          if (secondaryValue) return { jurisdiction: "default", value: secondaryValue };
        }
        if (!noHints) {
          const fallback = this.abbreviateContainerTitleFallback(key, preferredJur);
          if (fallback) return { jurisdiction: preferredJur === "default" ? "default" : preferredJurWithDomain, value: fallback };
        }
      }
      if (category === "title") {
        hit = lookupJurChainWithOverrides(
          primaryData,
          primaryOverrides,
          effectiveJur,
          "title",
          normalizedKey
        );
        if (hit?.value) return { jurisdiction: preferredJurWithDomain, value: hit.value };
        if (!noHints) {
          const fallback = this.abbreviateTitleFallback(key, preferredJur);
          if (fallback) return { jurisdiction: preferredJur === "default" ? "default" : preferredJurWithDomain, value: fallback };
        }
      }
      return null;
    }
    lookupSync(listname, key, jur) {
      return this.lookupForCiteProc(listname, key, jur)?.value || null;
    }
    listAutoUSPlaceJurisdictions() {
      const place = this._getAutoDatasetInfoForJurisdiction(this._defaultJurisdiction)?.data?.xdata?.default?.place || this._autoUS?.xdata?.default?.place || {};
      const keys = new Set(Object.keys(place));
      for (const key of this._listAutoUSPlaceOverrideKeys(this._defaultAutoDataset)) {
        keys.add(key);
      }
      return Array.from(keys).map((key) => {
        const code = String(key || "").trim().toLowerCase();
        return {
          code,
          label: this.formatJurisdictionDisplay(code)
        };
      }).sort((a, b) => a.label.localeCompare(b.label) || a.code.localeCompare(b.code));
    }
    listJurisdictionMenuOptions() {
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      for (const info of this._autoDatasets.values()) {
        const place = info?.data?.xdata?.default?.place;
        if (!place || typeof place !== "object" || Array.isArray(place)) continue;
        for (const [rawCode, rawLabel] of Object.entries(place)) {
          const code = String(rawCode || "").trim().toLowerCase().replace(/\+/g, ":");
          if (!code || seen.has(code)) continue;
          seen.add(code);
          const display = this.formatJurisdictionDisplay(code) || String(rawLabel || "").trim() || code;
          const parts = this._buildJurisdictionDisplayParts(code, info);
          rows.push({
            code,
            label: display,
            root: parts?.root || code.split(":")[0] || code,
            rootLabel: parts?.rootLabel || display,
            depth: parts?.depth || code.split(":").filter(Boolean).length
          });
        }
      }
      return rows.sort((a, b) => {
        return a.rootLabel.localeCompare(b.rootLabel) || a.root.localeCompare(b.root) || a.depth - b.depth || a.label.localeCompare(b.label) || a.code.localeCompare(b.code);
      });
    }
    listCourtOptionsForJurisdiction(rawJurisdiction) {
      const mapInfo = this._getMapDatasetInfoForJurisdiction(rawJurisdiction) || { data: this._jurisUSMap };
      const mapData = mapInfo?.data || null;
      const mapJurisdiction = this._jurisdictionMapCode(rawJurisdiction);
      const selectionJurisdiction = String(rawJurisdiction || this._defaultJurisdiction || "us").trim().toLowerCase();
      const jurisdictions = this._getLocalizedMapJurisdictions(mapData);
      const courts = Array.isArray(mapData?.courts) ? mapData.courts : [];
      const row = Array.isArray(jurisdictions) ? jurisdictions.find((item) => Array.isArray(item) && String(item[0] || "").trim().toLowerCase() === mapJurisdiction) : null;
      if (!row || !courts.length) {
        return this.listInstitutionPartOptionsForJurisdictionTree(rawJurisdiction);
      }
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      for (const ref of row.slice(2)) {
        const index = Number(ref);
        if (!Number.isFinite(index) || index < 0 || index >= courts.length) continue;
        const court = courts[index];
        if (!Array.isArray(court) || court.length < 2) continue;
        const key = this.normalizeKey(court[0]);
        const label = String(court[1] ?? "").trim();
        if (!key || !label || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          key,
          label,
          abbreviation: court[0] || "",
          jurisdiction: selectionJurisdiction,
          isChild: false
        });
      }
      return rows.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    }
    formatJurisdictionDisplay(rawJurisdiction) {
      const jurisdiction = (rawJurisdiction || "").toString().trim().toLowerCase();
      if (!jurisdiction) return "";
      const parts = this._buildJurisdictionDisplayParts(jurisdiction);
      if (!parts?.labels?.length) return "";
      return parts.labels.join("|");
    }
    _buildJurisdictionDisplayParts(rawJurisdiction, rawAutoInfo = null) {
      const jurisdiction = (rawJurisdiction || "").toString().trim().toLowerCase();
      if (!jurisdiction) return null;
      const parts = jurisdiction.split(":").filter(Boolean);
      if (!parts.length) return null;
      const autoInfo = rawAutoInfo || this._getAutoDatasetInfoForJurisdiction(jurisdiction) || { data: this._autoUS };
      const rootCode = parts[0].toLowerCase();
      const rootLabel = String(
        autoInfo?.data?.name || this._lookupJurisdictionPlaceLabel(rootCode, autoInfo) || parts[0]
      ).trim();
      const labels = [rootLabel || parts[0].toUpperCase()];
      let chain = rootCode;
      for (let index = 1; index < parts.length; index += 1) {
        chain = `${chain}:${parts[index]}`;
        const label = this._lookupJurisdictionPlaceLabel(chain, autoInfo) || parts[index].replace(/\./g, " ");
        labels.push(this._normalizeJurisdictionDisplayLabel(chain, label));
      }
      return {
        code: jurisdiction,
        root: rootCode,
        rootLabel: labels[0],
        labels,
        depth: parts.length
      };
    }
    listInstitutionPartOptionsForJurisdiction(rawJurisdiction) {
      const jurisdiction = (rawJurisdiction || this._defaultJurisdiction || "us").toString().trim().toLowerCase() || "us";
      const normalizedJurisdiction = jurisdiction === "default" ? this._defaultJurisdiction || "us" : jurisdiction;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(normalizedJurisdiction) || { data: this._autoUS };
      const rows = [];
      const entries = this._listInstitutionPartEntriesForJurisdiction(normalizedJurisdiction, autoInfo);
      for (const [key, value] of entries.entries()) {
        rows.push({
          key,
          label: this.formatInstitutionPartDisplay(key, normalizedJurisdiction),
          abbreviation: value,
          jurisdiction: normalizedJurisdiction,
          isChild: false
        });
      }
      return rows.sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    }
    listInstitutionPartOptionsForJurisdictionTree(rawJurisdiction) {
      const jurisdiction = (rawJurisdiction || this._defaultJurisdiction || "us").toString().trim().toLowerCase() || "us";
      const normalizedJurisdiction = jurisdiction === "default" ? this._defaultJurisdiction || "us" : jurisdiction;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(normalizedJurisdiction) || { data: this._autoUS };
      const rows = [];
      const exactEntries = this._listInstitutionPartEntriesForJurisdiction(normalizedJurisdiction, autoInfo);
      for (const [key, value] of exactEntries.entries()) {
        rows.push({
          key,
          label: this.formatInstitutionPartDisplay(key, normalizedJurisdiction),
          abbreviation: value,
          jurisdiction: normalizedJurisdiction,
          isChild: false
        });
      }
      const childPrefix = `${normalizedJurisdiction}:`;
      const childJurisdictions = /* @__PURE__ */ new Set();
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
            isChild: true
          });
        }
      }
      return rows.sort((a, b) => {
        if (!a.isChild && b.isChild) return -1;
        if (a.isChild && !b.isChild) return 1;
        return a.label.localeCompare(b.label) || a.key.localeCompare(b.key);
      });
    }
    formatInstitutionPartDisplay(rawKey, rawJurisdiction = this._defaultJurisdiction || "us") {
      const key = this.normalizeKey(rawKey);
      if (!key) return "";
      const mapInfo = this._getMapDatasetInfoForJurisdiction(rawJurisdiction) || { data: this._jurisUSMap };
      const mapped = this._lookupCourtDisplayLabel(key, mapInfo?.data);
      if (mapped) return mapped;
      const lookupJurisdiction = (rawJurisdiction || this._defaultJurisdiction || "us").toString().trim().toLowerCase() || "us";
      for (const category of ["institution-part", "institution-entire"]) {
        const hit = this.lookupForCiteProc(category, key, lookupJurisdiction, { noHints: true });
        const value = this.parseDirective(hit?.value).value;
        if (value) return value;
      }
      return key.split(".").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    }
    _listInstitutionPartEntriesForJurisdiction(rawJurisdiction, autoInfo = null) {
      const jurisdiction = (rawJurisdiction || "us").toString().trim().toLowerCase();
      if (!jurisdiction) return /* @__PURE__ */ new Map();
      const entries = /* @__PURE__ */ new Map();
      for (const category of ["institution-entire", "institution-part"]) {
        const baseEntries = autoInfo?.data?.xdata?.[jurisdiction]?.[category];
        if (baseEntries && typeof baseEntries === "object" && !Array.isArray(baseEntries)) {
          for (const [rawKey, rawValue] of Object.entries(baseEntries)) {
            const key = this.normalizeKey(rawKey);
            const value = String(rawValue ?? "").trim();
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
      if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return [];
      const datasetRoot = this._jurisdictionRootFromFilename(rawDataset) || "us";
      const rows = [];
      for (const [overrideKey, overrideValue] of Object.entries(bucket)) {
        const parsed = this._parseJurisdictionDatasetOverrideKey(overrideKey);
        if (!parsed) continue;
        if (parsed.category !== "institution-part" && parsed.category !== "institution-entire") continue;
        let jurisdiction = (parsed.jurisdiction || "").toString().trim().toLowerCase();
        if (rawDataset && datasetRoot !== "us" && jurisdiction === "us") {
          jurisdiction = datasetRoot;
        }
        const key = this.normalizeKey(parsed.key);
        const value = String(overrideValue ?? "").trim();
        if (!jurisdiction || !key || !value) continue;
        rows.push({
          jurisdiction: jurisdiction === "default" ? "us" : jurisdiction,
          key,
          value,
          category: parsed.category
        });
      }
      return rows.sort((a, b) => {
        const rank = (category) => category === "institution-part" ? 1 : 0;
        return rank(a.category) - rank(b.category);
      });
    }
    abbreviateContainerTitleFallback(title, jur) {
      return this._abbreviateByWords(title, jur, ["container-title"]);
    }
    abbreviateTitleFallback(title, jur) {
      return this._abbreviateByWords(title, jur, ["title", "container-title"]);
    }
    _abbreviateByWords(title, jur, categories) {
      const source = (title || "").toString().trim();
      if (!source) return null;
      if (/^(?:[A-Za-z]\.){2,}[A-Za-z]?\.?$/.test(source)) return null;
      const segments = this._tokenizeWordAndSeparatorSegments(source);
      const hasWord = segments.some((segment) => segment.type === "word");
      if (!hasWord) return null;
      const output = [];
      for (let index = 0; index < segments.length; ) {
        const segment = segments[index];
        if (segment.type !== "word") {
          output.push(segment.text);
          index += 1;
          continue;
        }
        const phraseWords = [];
        let bestMatch = null;
        for (let scan = index; scan < segments.length && phraseWords.length < 4; scan += 1) {
          if (segments[scan].type !== "word") continue;
          phraseWords.push(segments[scan].text);
          const normalized = this.normalizeKey(phraseWords.join(" "));
          const hit = this._lookupFallbackPhrase(normalized, jur, categories);
          if (hit?.value) {
            bestMatch = {
              value: this.parseDirective(hit.value).value,
              endIndex: scan
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
      const abbreviated = output.join("").trim();
      return abbreviated && abbreviated !== source ? abbreviated : null;
    }
    _tokenizeWordAndSeparatorSegments(source) {
      const segments = [];
      const matcher = /([A-Za-z0-9]+|[^A-Za-z0-9]+)/g;
      let match;
      while ((match = matcher.exec(source)) !== null) {
        const text = match[0];
        segments.push({
          type: /^[A-Za-z0-9]+$/.test(text) ? "word" : "sep",
          text
        });
      }
      return segments;
    }
    _abbreviateSingleToken(token, jur, categories) {
      const parts = token.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
      if (!parts) return token;
      const prefix = parts[1] || "";
      const core = parts[2] || "";
      const suffix = parts[3] || "";
      if (!core) return token;
      const compoundParts = core.split(/([-\u2010-\u2015])/);
      const abbreviatedCore = compoundParts.map((part) => /^[-\u2010-\u2015]$/.test(part) ? part : this._abbreviateCoreWord(part, jur, categories)).join("");
      const safeSuffix = abbreviatedCore.endsWith(".") && suffix.startsWith(".") ? suffix.slice(1) : suffix;
      return `${prefix}${abbreviatedCore}${safeSuffix}`;
    }
    _abbreviateCoreWord(word, jur, categories) {
      const normalized = this.normalizeKey(word);
      if (!normalized) return word;
      const hit = this._lookupFallbackPhrase(normalized, jur, categories) || this._lookupSupplementalWord(normalized);
      if (!hit?.value) return word;
      return this.parseDirective(hit.value).value;
    }
    _lookupFallbackPhrase(normalized, jur, categories) {
      const normalizedJur = jur === "default" ? this._defaultJurisdiction || "us" : jur;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(normalizedJur) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset) || { data: this._autoUS };
      const primaryData = this._primaryUS?.xdata || null;
      const primaryOverrides = this._getJurisdictionOverrideBucket(this._defaultPrimaryDataset);
      for (const category of categories) {
        const primaryHit = lookupJurChainWithOverrides(
          primaryData,
          primaryOverrides,
          normalizedJur,
          category,
          normalized
        );
        if (primaryHit?.value) return primaryHit;
        const secondaryValue = category === "container-title" ? this._lookupSecondaryContainerTitle(normalized) : this._lookupSecondaryCategoryValue(category, normalized) || this._lookupSecondaryContainerTitle(normalized) || null;
        if (secondaryValue) return { jurisdiction: "default", value: secondaryValue };
      }
      return null;
    }
    _lookupJurisdictionPlaceLabel(rawJurisdiction) {
      const jurisdiction = (rawJurisdiction || "").toString().trim().toUpperCase();
      if (!jurisdiction) return null;
      const autoInfo = this._getAutoDatasetInfoForJurisdiction(jurisdiction) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset) || { data: this._autoUS };
      return this._lookupAutoUSPlaceOverride(jurisdiction, autoInfo?.dataset) || this._primaryJur?.xdata?.default?.place?.[jurisdiction] || autoInfo?.data?.xdata?.default?.place?.[jurisdiction] || null;
    }
    _lookupAutoUSPlaceOverride(rawJurisdiction, rawDataset = this._defaultAutoDataset) {
      const jurisdiction = (rawJurisdiction || "").toString().trim().toUpperCase();
      if (!jurisdiction) return null;
      const overrideKey = this._makeJurisdictionDatasetOverrideKey("default", "place", jurisdiction);
      if (!overrideKey) return null;
      const bucket = this._getJurisdictionOverrideBucket(rawDataset);
      if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, overrideKey)) return null;
      return bucket[overrideKey] || null;
    }
    _listAutoUSPlaceOverrideKeys(rawDataset = this._defaultAutoDataset) {
      const bucket = this._getJurisdictionOverrideBucket(rawDataset);
      if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return [];
      const keys = [];
      for (const overrideKey of Object.keys(bucket)) {
        const parsed = this._parseJurisdictionDatasetOverrideKey(overrideKey);
        if (!parsed) continue;
        if (parsed.jurisdiction !== "default" || parsed.category !== "place") continue;
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
        const value = String(item[1] ?? "").trim();
        if (value) return value;
      }
      return null;
    }
    _normalizeJurisdictionDisplayLabel(jurisdiction, label) {
      return String(label || "").trim();
    }
    listSecondaryContainerTitleAbbreviations(rawDataset = this._defaultSecondaryDataset) {
      const dataset = this._normalizeSecondaryDataset(rawDataset);
      const base = this._secondaryDatasets?.[dataset]?.xdata?.default?.["container-title"] || {};
      const user = this._userSecondaryOverrides?.[dataset] || {};
      const merged = { ...base, ...user };
      return Object.keys(merged).sort((a, b) => a.localeCompare(b)).map((key) => ({
        key,
        value: merged[key],
        source: Object.prototype.hasOwnProperty.call(user, key) ? "user" : "base"
      }));
    }
    listSecondaryDatasetOptions() {
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      for (const dataset of this._getSecondaryLookupOrder()) {
        if (!this._secondaryDatasets?.[dataset] || seen.has(dataset)) continue;
        seen.add(dataset);
        rows.push({
          dataset,
          label: this._secondaryDatasetMeta.get(dataset)?.name || this._formatDatasetLabel(dataset),
          isDefault: dataset === this._defaultSecondaryDataset
        });
      }
      for (const dataset of Object.keys(this._secondaryDatasets || {}).sort((a, b) => a.localeCompare(b))) {
        if (seen.has(dataset)) continue;
        seen.add(dataset);
        rows.push({
          dataset,
          label: this._secondaryDatasetMeta.get(dataset)?.name || this._formatDatasetLabel(dataset),
          isDefault: dataset === this._defaultSecondaryDataset
        });
      }
      return rows;
    }
    listPrimaryDatasetOptions() {
      const rows = [];
      const seen = /* @__PURE__ */ new Set();
      for (const info of this._primaryDatasets.values()) {
        if (!info || seen.has(info.dataset)) continue;
        seen.add(info.dataset);
        rows.push({
          dataset: info.dataset,
          label: this._formatJurisdictionDatasetLabel({ ...info, kind: "primary" }),
          isDefault: info.dataset === this._defaultPrimaryDataset
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
      const seen = /* @__PURE__ */ new Set();
      const pushInfo = (info) => {
        if (!info || seen.has(info.dataset)) return;
        seen.add(info.dataset);
        rows.push({
          value: `jurisdiction:${info.dataset}`,
          label: this._formatJurisdictionDatasetLabel(info),
          dataset: info.dataset,
          kind: info.kind,
          isDefault: info.dataset === this._defaultAutoDataset || info.dataset === this._defaultMapDataset
        });
      };
      for (const info of this._autoDatasets.values()) pushInfo({ kind: "auto", ...info });
      for (const info of this._primaryDatasets.values()) pushInfo({ kind: "primary", ...info });
      for (const info of this._mapDatasets.values()) pushInfo({ kind: "map", ...info });
      return rows;
    }
    upsertSecondaryContainerTitleAbbreviation(rawDataset, rawKey, rawValue) {
      const dataset = this._normalizeSecondaryDataset(rawDataset);
      const key = this.normalizeKey(rawKey);
      const value = (rawValue || "").toString().trim();
      if (!key || !value) return false;
      if (!this._userSecondaryOverrides[dataset] || typeof this._userSecondaryOverrides[dataset] !== "object") {
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
      const info = this._getJurisdictionDatasetInfo(rawDataset) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset);
      const rows = [];
      if (info?.kind === "primary") {
        this._collectXDataRows(rows, info.dataset, info.data?.xdata);
      } else if (info?.kind === "map") {
        this._collectJurisMapRows(rows, info);
      } else {
        this._collectXDataRows(rows, info?.dataset || this._defaultAutoDataset || "auto-us", info?.data?.xdata);
      }
      this._collectOverrideOnlyJurisdictionRows(rows, info?.dataset || null);
      return rows.sort((a, b) => {
        return a.dataset.localeCompare(b.dataset) || a.jurisdiction.localeCompare(b.jurisdiction) || a.category.localeCompare(b.category) || a.key.localeCompare(b.key);
      }).map((row) => ({
        ...row,
        source: this._getJurisdictionOverrideValue(row.id) != null ? "user" : "base",
        value: this._getJurisdictionOverrideValue(row.id) ?? row.value
      }));
    }
    upsertJurisdictionPreferenceEntry(dataset, jurisdiction, category, key, value) {
      const ds = (dataset || "").toString().trim();
      const normalizedJurisdiction = this._normalizeOverrideJurisdictionForCategory(ds, jurisdiction, category);
      const id = this._makeJurisdictionDatasetOverrideKey(normalizedJurisdiction, category, key);
      const val = (value || "").toString().trim();
      if (!ds || !id || !val) return false;
      if (!this._userJurisdictionOverrides[ds] || typeof this._userJurisdictionOverrides[ds] !== "object") {
        this._userJurisdictionOverrides[ds] = {};
      }
      this._userJurisdictionOverrides[ds][id] = val;
      this._saveJurisdictionOverrides();
      return true;
    }
    removeJurisdictionPreferenceEntry(dataset, jurisdiction, category, key) {
      const ds = (dataset || "").toString().trim();
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
      const importKind = (kind || "").toString().trim().toLowerCase();
      const xdata = payload?.xdata && typeof payload.xdata === "object" && !Array.isArray(payload.xdata) ? payload.xdata : payload;
      const summary = this._createImportSummary();
      if (!xdata || typeof xdata !== "object" || Array.isArray(xdata)) {
        summary.error = "Import file did not contain an xdata object.";
        return summary;
      }
      if (importKind === "journals") {
        return this._importSecondaryOverrides(rawDataset, xdata, summary);
      }
      if (importKind === "abbrev" || importKind === "jurisdiction") {
        return this._importJurisdictionOverrides(rawDataset, xdata, summary);
      }
      summary.error = `Unsupported import target: ${importKind || "unknown"}.`;
      return summary;
    }
    _importSecondaryOverrides(rawDataset, xdata, summary) {
      const dataset = this._normalizeSecondaryDataset(rawDataset);
      const defaultRows = xdata?.default;
      const containerTitles = defaultRows?.["container-title"];
      if (!defaultRows || typeof defaultRows !== "object" || Array.isArray(defaultRows)) {
        summary.error = "Import file did not contain xdata.default entries for journal abbreviations.";
        return summary;
      }
      const existingRows = this.listSecondaryContainerTitleAbbreviations(dataset);
      const existingByKey = new Map(existingRows.map((row) => [this.normalizeKey(row.key), String(row.value ?? "").trim()]));
      let changed = false;
      for (const [jurisdiction, categories] of Object.entries(xdata)) {
        if (String(jurisdiction || "").trim().toLowerCase() !== "default") {
          this._recordImportSkip(summary, "outside_selected_dataset_scope", jurisdiction);
          continue;
        }
        if (!categories || typeof categories !== "object" || Array.isArray(categories)) {
          this._recordImportSkip(summary, "invalid_category_block", jurisdiction);
          continue;
        }
        for (const [category, entries] of Object.entries(categories)) {
          const normalizedCategory = String(category || "").trim().toLowerCase();
          if (normalizedCategory !== "container-title") {
            this._recordImportSkip(summary, "unsupported_category", `default::${normalizedCategory}`);
            continue;
          }
          if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
            this._recordImportSkip(summary, "invalid_entries_block", `default::${normalizedCategory}`);
            continue;
          }
          for (const [rawKey, rawValue] of Object.entries(entries)) {
            const key = this.normalizeKey(rawKey);
            const value = String(rawValue ?? "").trim();
            const context = `default::container-title::${String(rawKey || "").trim()}`;
            if (!key || !value) {
              this._recordImportSkip(summary, "blank_key_or_value", context);
              continue;
            }
            const existingValue = existingByKey.get(key);
            if (existingValue === value) {
              this._recordImportSkip(summary, "unchanged", context);
              continue;
            }
            if (!this._userSecondaryOverrides[dataset] || typeof this._userSecondaryOverrides[dataset] !== "object") {
              this._userSecondaryOverrides[dataset] = {};
            }
            this._userSecondaryOverrides[dataset][key] = value;
            existingByKey.set(key, value);
            changed = true;
            if (typeof existingValue === "string") {
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
      const info = this._getJurisdictionDatasetInfo(rawDataset) || this._getJurisdictionDatasetInfo(this._defaultAutoDataset);
      if (!info) {
        summary.error = "Selected dataset could not be resolved.";
        return summary;
      }
      if (info.kind === "map") {
        summary.error = "Map datasets do not accept abbrev imports.";
        return summary;
      }
      const dataset = info.dataset;
      const root = String(info.root || this._jurisdictionRootFromFilename(dataset) || "").trim().toLowerCase();
      const categories = this._getImportableJurisdictionCategories(info);
      const existingRows = this.listJurisdictionPreferenceEntries(dataset);
      const existingByID = new Map(
        existingRows.map((row) => {
          const id = this._makeJurisdictionDatasetOverrideKey(row.jurisdiction, row.category, row.key);
          return id ? [id, String(row.value ?? "").trim()] : null;
        }).filter(Boolean)
      );
      if (!this._userJurisdictionOverrides[dataset] || typeof this._userJurisdictionOverrides[dataset] !== "object") {
        this._userJurisdictionOverrides[dataset] = {};
      }
      const bucket = this._userJurisdictionOverrides[dataset];
      let changed = false;
      for (const [rawJurisdiction, categoryRows] of Object.entries(xdata)) {
        const jurisdiction = String(rawJurisdiction || "").trim().toLowerCase();
        if (!this._isImportJurisdictionInScope(jurisdiction, root)) {
          this._recordImportSkip(summary, "outside_selected_dataset_scope", jurisdiction);
          continue;
        }
        if (!categoryRows || typeof categoryRows !== "object" || Array.isArray(categoryRows)) {
          this._recordImportSkip(summary, "invalid_category_block", jurisdiction);
          continue;
        }
        for (const [rawCategory, entries] of Object.entries(categoryRows)) {
          const category = String(rawCategory || "").trim().toLowerCase();
          const categoryContext = `${jurisdiction || "default"}::${category}`;
          if (!categories.has(category)) {
            this._recordImportSkip(summary, "unsupported_category", categoryContext);
            continue;
          }
          if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
            this._recordImportSkip(summary, "invalid_entries_block", categoryContext);
            continue;
          }
          for (const [rawKey, rawValue] of Object.entries(entries)) {
            const key = String(rawKey || "").trim();
            const value = String(rawValue ?? "").trim();
            const context = `${jurisdiction || "default"}::${category}::${key}`;
            if (!key || !value) {
              this._recordImportSkip(summary, "blank_key_or_value", context);
              continue;
            }
            const normalizedJurisdiction = this._normalizeOverrideJurisdictionForCategory(dataset, jurisdiction, category);
            const id = this._makeJurisdictionDatasetOverrideKey(normalizedJurisdiction, category, key);
            if (!id) {
              this._recordImportSkip(summary, "invalid_override_key", context);
              continue;
            }
            const existingValue = existingByID.get(id);
            if (existingValue === value) {
              this._recordImportSkip(summary, "unchanged", context);
              continue;
            }
            bucket[id] = value;
            existingByID.set(id, value);
            changed = true;
            if (typeof existingValue === "string") {
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
        skipReasons: /* @__PURE__ */ new Map(),
        error: ""
      };
    }
    _recordImportSkip(summary, reason, context = "") {
      if (!summary?.skipReasons) return;
      summary.skipped += 1;
      const current = summary.skipReasons.get(reason) || { reason, count: 0, examples: [] };
      current.count += 1;
      const example = String(context || "").trim();
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
        error: summary.error || "",
        skipReasons: Array.from(summary.skipReasons.values()).sort((a, b) => a.reason.localeCompare(b.reason))
      };
    }
    _isImportJurisdictionInScope(jurisdiction, root) {
      const jur = String(jurisdiction || "").trim().toLowerCase();
      const normalizedRoot = String(root || "").trim().toLowerCase();
      if (!jur) return false;
      if (jur === "default") return true;
      if (!normalizedRoot) return true;
      return jur === normalizedRoot || jur.startsWith(`${normalizedRoot}:`);
    }
    _getImportableJurisdictionCategories(info) {
      const categories = /* @__PURE__ */ new Set([
        "container-title",
        "institution-entire",
        "institution-part",
        "place",
        "title"
      ]);
      for (const row of this.listJurisdictionPreferenceEntries(info?.dataset || null)) {
        const category = String(row?.category || "").trim().toLowerCase();
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
        return this._secondaryDatasets?.[dataset]?.xdata?.default?.["container-title"]?.[normalizedKey] || null;
      }
      for (const name of this._getSecondaryLookupOrder()) {
        const bucket = this._userSecondaryOverrides?.[name] || {};
        if (Object.prototype.hasOwnProperty.call(bucket, normalizedKey)) {
          return bucket[normalizedKey];
        }
        const value = this._secondaryDatasets?.[name]?.xdata?.default?.["container-title"]?.[normalizedKey];
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
      const dataset = (rawDataset || "").toString().trim() || this._defaultSecondaryDataset;
      if (this._secondaryDatasets?.[dataset]) return dataset;
      return this._defaultSecondaryDataset;
    }
    _formatDatasetLabel(dataset) {
      return String(dataset || "").replace(/^secondary-/i, "").replace(/-/g, " ").replace(/\b([a-z])/g, (match) => match.toUpperCase());
    }
    _formatJurisdictionDatasetLabel(info) {
      const name = String(info?.name || "").trim();
      if (!name) return this._formatDatasetLabel(info?.dataset);
      return `${name} (${info.dataset})`;
    }
    _loadSecondaryOverrides() {
      try {
        const raw = Zotero?.Prefs?.get?.(this._secondaryOverridesPref);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const looksFlat = Object.values(parsed).some((v) => typeof v === "string" || typeof v === "number");
        if (looksFlat) {
          const migrated = {};
          for (const [k, v] of Object.entries(parsed)) {
            const key = this.normalizeKey(k);
            const value = (v || "").toString().trim();
            if (key && value) migrated[key] = value;
          }
          return { [this._defaultSecondaryDataset]: migrated };
        }
        const cleaned = {};
        for (const [dataset, bucket] of Object.entries(parsed)) {
          const ds = (dataset || "").toString().trim();
          if (!ds || !bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
          cleaned[ds] = {};
          for (const [k, v] of Object.entries(bucket)) {
            const key = this.normalizeKey(k);
            const value = (v || "").toString().trim();
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
      } catch (e) {
      }
    }
    _makeJurisdictionOverrideID(dataset, jurisdiction, category, key) {
      const ds = (dataset || "").toString().trim();
      const inner = this._makeJurisdictionDatasetOverrideKey(jurisdiction, category, key);
      if (!ds || !inner) return null;
      return `${ds}::${inner}`;
    }
    _makeJurisdictionDatasetOverrideKey(jurisdiction, category, key) {
      const jur = (jurisdiction || "").toString().trim();
      const cat = (category || "").toString().trim();
      const k = (key || "").toString().trim();
      if (!jur || !cat || !k) return null;
      return `${jur}::${cat}::${k}`;
    }
    _normalizeOverrideJurisdictionForCategory(dataset, jurisdiction, category) {
      const ds = (dataset || "").toString().trim().toLowerCase();
      const jur = (jurisdiction || "").toString().trim().toLowerCase();
      const cat = (category || "").toString().trim().toLowerCase();
      if (!jur) return jur;
      if (jur !== "default") return jur;
      if (cat === "place" || cat === "courts" || cat === "jurisdictions") {
        return "default";
      }
      if (ds.startsWith("auto-")) {
        return this._jurisdictionRootFromFilename(ds) || "us";
      }
      return "us";
    }
    _normalizeLegacyOverrideJurisdictionForCategory(dataset, jurisdiction, category) {
      const ds = (dataset || "").toString().trim().toLowerCase();
      const jur = (jurisdiction || "").toString().trim().toLowerCase();
      const cat = (category || "").toString().trim().toLowerCase();
      if (!jur) return jur;
      if (cat === "place" || cat === "courts" || cat === "jurisdictions") return jur;
      if (ds.startsWith("auto-")) {
        const root = this._jurisdictionRootFromFilename(ds) || "us";
        if (jur === root && root !== "us") return "us";
      }
      return jur;
    }
    _getJurisdictionOverrideValue(id) {
      if (!id) return null;
      const parts = id.split("::");
      if (parts.length < 4) return null;
      const ds = parts.shift();
      const inner = parts.join("::");
      const bucket = this._userJurisdictionOverrides?.[ds];
      if (!bucket || !Object.prototype.hasOwnProperty.call(bucket, inner)) return null;
      return bucket[inner];
    }
    _collectXDataRows(rows, dataset, xdata) {
      if (!xdata || typeof xdata !== "object") return;
      for (const [jurisdiction, byCategory] of Object.entries(xdata)) {
        if (!byCategory || typeof byCategory !== "object") continue;
        for (const [category, entries] of Object.entries(byCategory)) {
          if (!entries || typeof entries !== "object" || Array.isArray(entries)) continue;
          for (const [key, value] of Object.entries(entries)) {
            if (value == null) continue;
            const row = {
              dataset,
              jurisdiction: String(jurisdiction),
              category: String(category),
              key: String(key),
              value: String(value)
            };
            row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
            rows.push(row);
          }
        }
      }
    }
    _collectJurisMapRows(rows, mapInfo = this._jurisUSMap) {
      const mapData = mapInfo?.data || mapInfo || this._jurisUSMap;
      const dataset = mapInfo?.dataset || this._defaultMapDataset || "juris-us-map";
      const courts = mapData?.courts;
      if (Array.isArray(courts)) {
        for (const item of courts) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const code = String(item[0] ?? "").trim();
          const name = String(item[1] ?? "").trim();
          if (!code || !name) continue;
          const row = {
            dataset,
            jurisdiction: "default",
            category: "courts",
            key: code,
            value: name
          };
          row.id = this._makeJurisdictionOverrideID(row.dataset, row.jurisdiction, row.category, row.key);
          rows.push(row);
        }
      }
      const jurisdictions = this._getLocalizedMapJurisdictions(mapData);
      if (Array.isArray(jurisdictions)) {
        for (const item of jurisdictions) {
          if (!Array.isArray(item) || item.length < 2) continue;
          const code = String(item[0] ?? "").trim();
          const name = String(item[1] ?? "").trim();
          if (!code || !name) continue;
          const row = {
            dataset,
            jurisdiction: "default",
            category: "jurisdictions",
            key: code,
            value: name
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
        if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
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
            id
          });
          seen.add(id);
        }
      }
    }
    _parseJurisdictionDatasetOverrideKey(overrideKey) {
      const parts = String(overrideKey || "").split("::");
      if (parts.length < 3) return null;
      const jurisdiction = String(parts[0] || "").trim();
      const category = String(parts[1] || "").trim();
      const key = String(parts.slice(2).join("::") || "").trim();
      if (!jurisdiction || !category || !key) return null;
      return { jurisdiction, category, key };
    }
    _normalizeListedOverrideJurisdiction(dataset, jurisdiction, category) {
      const ds = (dataset || "").toString().trim().toLowerCase();
      const jur = (jurisdiction || "").toString().trim().toLowerCase();
      const cat = (category || "").toString().trim().toLowerCase();
      if (!jur) return jur;
      if (cat === "place" || cat === "courts" || cat === "jurisdictions") return jur;
      if (ds.startsWith("auto-")) {
        const root = this._jurisdictionRootFromFilename(ds) || "us";
        if (jur === "us" && root !== "us") return root;
      }
      return jur;
    }
    _loadJurisdictionOverrides() {
      try {
        const raw = Zotero?.Prefs?.get?.(this._jurisdictionOverridesPref);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const cleaned = {};
        for (const [dataset, bucket] of Object.entries(parsed)) {
          const ds = (dataset || "").toString().trim();
          if (!ds || !bucket || typeof bucket !== "object" || Array.isArray(bucket)) continue;
          const outBucket = {};
          for (const [id, value] of Object.entries(bucket)) {
            const key = (id || "").toString().trim();
            const val = (value || "").toString().trim();
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
      } catch (e) {
      }
    }
    _lookupSupplementalWord(normalized) {
      const supplemental = {
        "association": "Ass\u2019n",
        "broadcasting": "Broad.",
        "company": "Co.",
        "companies": "Cos.",
        "corporation": "Corp.",
        "corporations": "Corps.",
        "incorporated": "Inc.",
        "international": "Int\u2019l",
        "limited": "Ltd.",
        "ltd": "Ltd.",
        "online": "Online",
        "production": "Prod.",
        "productions": "Prods.",
        "professional": "Pro.",
        "public": "Pub.",
        "services": "Servs.",
        "service": "Serv.",
        "technology": "Tech.",
        "technologies": "Techs.",
        "university": "U."
      };
      const value = supplemental[normalized] || null;
      return value ? { jurisdiction: "default", value } : null;
    }
    _lookupInstitutionCategoryValue(category, rawKey, normalizedKey, jurisdiction, xdata, overrides) {
      const categoryName = String(category || "").trim().toLowerCase();
      if (!categoryName || !xdata) return null;
      const lookupKeys = [];
      for (const candidate of [rawKey, normalizedKey]) {
        const value = String(candidate || "").trim();
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
          lookupKey
        );
        if (hit?.value != null) return hit;
      }
      return null;
    }
  };
  function lookupJurChainWithOverrides(xdata, overrides, jur, variable, key) {
    if (!xdata) return null;
    const parts = (jur || "us").toLowerCase().split(":");
    for (let i = parts.length; i >= 1; i--) {
      const jj = parts.slice(0, i).join(":");
      const overrideKey = `${jj}::${variable}::${String(key ?? "")}`;
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, overrideKey)) {
        return { jurisdiction: jj, value: overrides[overrideKey] };
      }
      if (jj === "us") {
        const defaultOverrideKey2 = `default::${variable}::${String(key ?? "")}`;
        if (overrides && Object.prototype.hasOwnProperty.call(overrides, defaultOverrideKey2)) {
          return { jurisdiction: "us", value: overrides[defaultOverrideKey2] };
        }
      }
      const obj2 = xdata?.[jj]?.[variable];
      if (obj2 && obj2[key] != null) return { jurisdiction: jj, value: obj2[key] };
    }
    const usOverrideKey = `us::${variable}::${String(key ?? "")}`;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, usOverrideKey)) {
      return { jurisdiction: "us", value: overrides[usOverrideKey] };
    }
    const defaultOverrideKey = `default::${variable}::${String(key ?? "")}`;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, defaultOverrideKey)) {
      return { jurisdiction: "us", value: overrides[defaultOverrideKey] };
    }
    const obj = xdata?.["us"]?.[variable];
    if (obj && obj[key] != null) return { jurisdiction: "us", value: obj[key] };
    return null;
  }

  // lib/services/patcher.mjs
  var Patcher = class {
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
      this._commenterCreatorTypeID = "9001";
      this._commenterCreatorTypeName = "commenter";
      this._commenterCreatorTypeLabel = "Commenter";
      this._translatorCreatorTypeID = "9002";
      this._translatorCreatorTypeName = "ibcslm-translator";
      this._translatorCreatorTypeLabel = "Translator";
      this._commenterRowID = "ibcslm-commenter-row";
      this._extraPersonTypes = [
        {
          key: "commenter",
          creatorTypeID: this._commenterCreatorTypeID,
          creatorTypeName: this._commenterCreatorTypeName,
          label: this._commenterCreatorTypeLabel,
          storage: "creator",
          mlzType: "commenter",
          cslField: "commenter"
        },
        {
          key: "translator",
          creatorTypeID: this._translatorCreatorTypeID,
          creatorTypeName: this._translatorCreatorTypeName,
          label: this._translatorCreatorTypeLabel,
          storage: "creator",
          mlzType: "translator",
          cslField: "translator"
        }
      ];
      this._jurisdictionRowID = "ibcslm-jurisdiction-row";
      this._customCourtRowID = "ibcslm-custom-court-row";
      this._syncInFlight = /* @__PURE__ */ new Set();
      this._journalAbbrByContainerTitleKey = /* @__PURE__ */ new Map();
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
      creatorTypes.getID = function(creatorType) {
        const extraPersonType = self._getExtraPersonConfigByCreatorType(creatorType);
        if (extraPersonType) return extraPersonType.creatorTypeID;
        return self._orig.creatorTypesGetID?.apply(this, arguments);
      };
      creatorTypes.getName = function(creatorTypeID) {
        const extraPersonType = self._getExtraPersonConfigByCreatorType(creatorTypeID);
        if (extraPersonType) return extraPersonType.creatorTypeName;
        return self._orig.creatorTypesGetName?.apply(this, arguments);
      };
      creatorTypes.getLocalizedString = function(creatorType) {
        const extraPersonType = self._getExtraPersonConfigByCreatorType(creatorType);
        if (extraPersonType) return extraPersonType.label;
        return self._orig.creatorTypesGetLocalizedString?.apply(this, arguments);
      };
      creatorTypes.getTypesForItemType = function(itemTypeID) {
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
        const ctor = mainWindow?.customElements?.get?.("info-box");
        return ctor?.prototype || null;
      } catch (e) {
      }
      return null;
    }
    _patchInfoBoxPrototype(protoOverride = null) {
      const proto = protoOverride || this._getInfoBoxPrototype();
      if (!proto) return;
      if (!this._orig.infoBoxProtoRender && typeof proto.render === "function") {
        this._orig.infoBoxProtoRender = proto.render;
      }
      if (!this._orig.infoBoxProtoModifyCreator && typeof proto.modifyCreator === "function") {
        this._orig.infoBoxProtoModifyCreator = proto.modifyCreator;
      }
      if (!this._orig.infoBoxProtoRemoveCreator && typeof proto.removeCreator === "function") {
        this._orig.infoBoxProtoRemoveCreator = proto.removeCreator;
      }
      const self = this;
      if (this._orig.infoBoxProtoRender) {
        proto.render = function(...args) {
          const result = self._orig.infoBoxProtoRender.apply(this, args);
          try {
            try {
              const itemID = this.item?.id;
              const customRows = this.querySelectorAll?.("[data-custom-row-id]")?.length || 0;
              Zotero.debug(`[IndigoBook CSL-M] info-box proto render: item=${String(itemID || "")} customRows=${String(customRows)}`);
            } catch (e) {
            }
            self._ensureExtraPersonMenuItems(this);
            self._removeCommenterField(this);
            self._renderExtraPersonCreatorRows(this);
          } catch (e) {
            try {
              Zotero.debug(`[IndigoBook CSL-M] info-box commenter render patch failed: ${String(e)}`);
            } catch (_) {
            }
          }
          return result;
        };
      }
      if (this._orig.infoBoxProtoModifyCreator) {
        proto.modifyCreator = function(index, fields) {
          const nativeCount = this.item?.numCreators?.() || 0;
          const extraPersonType = self._getExtraPersonConfigByCreatorType(fields?.creatorTypeID);
          const existingExtraPersonType = self._getExtraPersonConfigByIndex(this, index);
          if (extraPersonType) {
            const nextPerson = self._extraPersonFromCreatorFields(fields);
            self._setStoredExtraPerson(this.item, extraPersonType, nextPerson);
            self._markExtraPersonCreatorRow(self._getCreatorTypeLabel(this, index)?.closest?.(".meta-row"), extraPersonType);
            return true;
          }
          if (existingExtraPersonType) {
            self._setStoredExtraPerson(this.item, existingExtraPersonType, null);
            const nativeIndex2 = self._getNativeCreatorIndex(this, index);
            return self._orig.infoBoxProtoModifyCreator.call(this, Math.min(nativeIndex2, nativeCount), fields);
          }
          const nativeIndex = self._getNativeCreatorIndex(this, index);
          return self._orig.infoBoxProtoModifyCreator.call(this, nativeIndex, fields);
        };
      }
      if (this._orig.infoBoxProtoRemoveCreator) {
        proto.removeCreator = async function(index) {
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
      } catch (e) {
      }
    }
    _registerCaseReporterSync() {
      if (!Zotero?.Notifier?.registerObserver) return;
      if (this._itemObserverID) return;
      const self = this;
      this._itemObserverID = Zotero.Notifier.registerObserver({
        async notify(event, type, ids) {
          try {
            Zotero.debug(`[IndigoBook CSL-M] case reporter sync notifier: event=${String(event)} type=${String(type)} ids=${Array.isArray(ids) ? ids.length : 0}`);
          } catch (e) {
          }
          const isSyncEvent = ["add", "modify", "refresh", "redraw", "select"].includes(event);
          if (!isSyncEvent) return;
          if (type === "item" && Array.isArray(ids) && ids.length) {
            for (const id of ids) {
              await self._syncCaseReporterFromFieldsAndMLZ(id);
            }
            return;
          }
          await self._syncCaseReporterFromActiveSelection();
        }
      }, ["item", "itempane", "tab"], "indigobook-cslm-case-reporter-sync");
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
      itemDetails.render = async function(...args) {
        try {
          const itemID = this.item?.id;
          if (itemID != null) {
            try {
              Zotero.debug(`[IndigoBook CSL-M] case reporter item-pane render sync: item=${String(itemID)}`);
            } catch (e) {
            }
            await self._syncCaseReporterFromFieldsAndMLZ(itemID);
          }
        } catch (e) {
          try {
            Zotero.debug(`[IndigoBook CSL-M] case reporter item-pane render sync failed: ${String(e)}`);
          } catch (_) {
          }
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
      infoBox.render = function(...args) {
        const result = self._orig.infoBoxRender.apply(this, args);
        try {
          try {
            const itemID = this.item?.id;
            const customRows = this.querySelectorAll?.("[data-custom-row-id]")?.length || 0;
            Zotero.debug(`[IndigoBook CSL-M] info-box instance render: item=${String(itemID || "")} customRows=${String(customRows)}`);
          } catch (e) {
          }
          self._ensureExtraPersonMenuItems(this);
          self._removeCommenterField(this);
          self._renderExtraPersonCreatorRows(this);
          self._renderJurisdictionField(this);
          self._renderCourtField(this);
          self._renderCustomCourtField(this);
        } catch (e) {
          try {
            Zotero.debug(`[IndigoBook CSL-M] custom info row render failed: ${String(e)}`);
          } catch (_) {
          }
        }
        return result;
      };
    }
    _scheduleItemPaneRenderPatch() {
      if (this._orig.itemDetailsRender && this._orig.itemDetailsOwner && (this._orig.infoBoxRender && this._orig.infoBoxOwner)) return;
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
        if (itemTypeName !== "case") return;
        const reporter = String(item.getField?.("reporter") || "").trim();
        const rawCourt = String(item.getField?.("court") || "").trim();
        const hasCourtKeyAlready = this._looksLikeCourtKey(rawCourt);
        const parsedCourt = hasCourtKeyAlready ? null : this.caseCourtMapper?.mapCaseCourt?.(rawCourt) || null;
        const mappedCourt = this.abbrevService.normalizeKey(parsedCourt?.courtKey || "");
        const mappedJurisdiction = String(parsedCourt?.jurisdiction || "").trim().toLowerCase();
        const court = this.abbrevService.normalizeKey(rawCourt || "");
        const extra = String(item.getField?.("extra") || "");
        const mlzFields = this.Jurisdiction.getMLZExtraFields?.(extra) || null;
        const mlzReporter = String(mlzFields?.reporter || "").trim();
        const mlzCourt = this.abbrevService.normalizeKey(mlzFields?.court || "");
        const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(extra) || "";
        const derivedJurisdiction = this.Jurisdiction.fromItem(item);
        const inferredJurisdiction = mappedJurisdiction || derivedJurisdiction;
        const upgradedCourt = this._upgradeGenericCourtKey(court, inferredJurisdiction);
        try {
          Zotero.debug(`[IndigoBook CSL-M] case court mapping: raw="${rawCourt}" mappedCourt="${mappedCourt}" mappedJurisdiction="${mappedJurisdiction}" derivedJurisdiction="${derivedJurisdiction}" inferredJurisdiction="${inferredJurisdiction}" upgradedCourt="${upgradedCourt}"`);
        } catch (e) {
        }
        let nextExtra = extra;
        let changed = false;
        const targetCourt = mappedCourt || upgradedCourt;
        if (targetCourt && (!hasCourtKeyAlready || court !== targetCourt)) {
          item.setField("court", targetCourt);
          changed = true;
        }
        const effectiveCourt = targetCourt || court;
        const effectiveJurisdiction = inferredJurisdiction;
        const canRewriteJurisdiction = !mlzJurisdiction || /^us(?::|$)/.test(mlzJurisdiction);
        if (reporter && reporter !== mlzReporter) {
          nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, "reporter", reporter) || nextExtra;
        }
        if (!reporter && mlzReporter) {
          item.setField("reporter", mlzReporter);
          changed = true;
        }
        if (canRewriteJurisdiction && effectiveJurisdiction && effectiveJurisdiction !== mlzJurisdiction) {
          const displayJurisdiction = this.abbrevService.formatJurisdictionDisplay(effectiveJurisdiction);
          nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(nextExtra, effectiveJurisdiction, displayJurisdiction) || nextExtra;
        }
        if (effectiveCourt && effectiveCourt !== mlzCourt) {
          nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, "court", effectiveCourt) || nextExtra;
        }
        if (!effectiveCourt && mlzCourt) {
          item.setField("court", mlzCourt);
          changed = true;
        }
        if (nextExtra !== extra) {
          item.setField("extra", nextExtra);
          changed = true;
        }
        if (!changed) return;
        await item.saveTx({ skipDateModifiedUpdate: true });
        try {
          Zotero.debug(`[IndigoBook CSL-M] case sync: wrote reporter/jurisdiction/court mlz state (item ${normalizedID})`);
        } catch (e) {
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
        try {
          Zotero.debug(`[IndigoBook CSL-M] case reporter sync failed for item ${normalizedID}: ${String(e)}`);
        } catch (_) {
        }
      } finally {
        this._syncInFlight.delete(normalizedID);
      }
    }
    _looksLikeCourtKey(value) {
      const normalized = this.abbrevService.normalizeKey(value || "");
      if (!normalized) return false;
      return /^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(normalized);
    }
    _upgradeGenericCourtKey(courtKey, jurisdiction) {
      const key = this.abbrevService.normalizeKey(courtKey || "");
      const jur = String(jurisdiction || "").trim().toLowerCase();
      if (!key) return "";
      if ((key === "court.appeal" || key === "court.appeals") && jur === "us:c") {
        return "court.appeals.federal.circuit";
      }
      if (key === "court.appeal") {
        return "court.appeals";
      }
      return "";
    }
    async _syncCaseReporterFromActiveSelection() {
      try {
        const pane = Zotero.getActiveZoteroPane?.();
        if (!pane?.getSelectedItems) return;
        const selected = pane.getSelectedItems();
        if (!Array.isArray(selected) || !selected.length) return;
        for (const entry of selected) {
          const id = typeof entry === "number" || typeof entry === "string" ? entry : entry?.id;
          if (id == null) continue;
          await this._syncCaseReporterFromFieldsAndMLZ(id);
        }
      } catch (e) {
        try {
          Zotero.debug(`[IndigoBook CSL-M] case reporter selection sync failed: ${String(e)}`);
        } catch (_) {
        }
      }
    }
    _getActiveItemDetails() {
      try {
        const mainWindow = Zotero.getMainWindow?.();
        const fromMainWindow = mainWindow?.ZoteroPane?.itemPane?._itemDetails;
        if (fromMainWindow) return fromMainWindow;
        const activePane = Zotero.getActiveZoteroPane?.();
        return activePane?.itemPane?._itemDetails || null;
      } catch (e) {
      }
      return null;
    }
    _getActiveInfoBox() {
      try {
        const itemDetails = this._getActiveItemDetails();
        if (itemDetails?.getPane) {
          const pane = itemDetails.getPane("info");
          if (pane) return pane;
        }
        const mainWindow = Zotero.getMainWindow?.();
        return mainWindow?.document?.getElementById?.("zotero-editpane-info-box") || null;
      } catch (e) {
      }
      return null;
    }
    _renderJurisdictionField(infoBox) {
      const item = infoBox?.item;
      const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
      if (!item || item.deleted || itemTypeName !== "case") {
        this._removeJurisdictionField(infoBox);
        return;
      }
      const table = this._getInfoTable(infoBox);
      if (!table) return;
      const row = this._getOrCreateJurisdictionRow(infoBox);
      const beforeRow = this._findInfoFieldRow(infoBox, "court");
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
        try {
          Zotero.debug(`[IndigoBook CSL-M] ${extraPersonType.key} creator row skipped: item=${String(item?.id || "")} no stored value`);
        } catch (e) {
        }
        return;
      }
      if (typeof infoBox.addCreatorRow !== "function") {
        try {
          Zotero.debug(`[IndigoBook CSL-M] ${extraPersonType.key} creator row skipped: item=${String(item?.id || "")} addCreatorRow unavailable`);
        } catch (e) {
        }
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
      const row = label?.closest(".meta-row") || null;
      if (!row) return;
      this._markExtraPersonCreatorRow(row, extraPersonType);
      row.setAttribute("data-ibcslm-rendered-extra-person-row", extraPersonType.key);
      try {
        Zotero.debug(`[IndigoBook CSL-M] ${extraPersonType.key} creator row rendered: item=${String(item?.id || "")} rowIndex=${String(rowIndex)}`);
      } catch (e) {
      }
    }
    _getCreatorTypeLabel(infoBox, rowIndex) {
      return infoBox?.querySelector?.(`.meta-label[fieldname="creator-${rowIndex}-typeID"]`) || infoBox?.querySelector?.(`.meta-label[fieldname="creator-${rowIndex}"]`) || null;
    }
    _getCreatorRowIndex(row) {
      const fieldName = String(row?.querySelector?.(".meta-label")?.getAttribute?.("fieldname") || "");
      const match = fieldName.match(/^creator-(\d+)(?:-|$)/);
      return match ? Number(match[1]) : null;
    }
    _getCreatorRows(infoBox) {
      if (!infoBox?.querySelectorAll) return [];
      const labels = Array.from(infoBox.querySelectorAll('.meta-label[fieldname^="creator-"]'));
      const rows = [];
      for (const label of labels) {
        const row = label.closest?.(".meta-row") || null;
        if (row && !rows.includes(row)) rows.push(row);
      }
      return rows;
    }
    _getExtraPersonCreatorRows(infoBox, extraPersonType = null) {
      return this._getCreatorRows(infoBox).filter((row) => {
        const rowTypeKey = row.getAttribute?.("data-ibcslm-extra-person-type") || "";
        if (rowTypeKey) return !extraPersonType || rowTypeKey === extraPersonType.key;
        if (!extraPersonType && row.getAttribute?.("data-ibcslm-commenter-row") === "true") return true;
        const label = row.querySelector?.(".meta-label");
        const rowConfig = this._getExtraPersonConfigByCreatorType(label?.getAttribute?.("typeid"));
        return rowConfig && (!extraPersonType || rowConfig.key === extraPersonType.key);
      });
    }
    _getExtraPersonConfigByIndex(infoBox, rowIndex) {
      const row = this._getCreatorTypeLabel(infoBox, rowIndex)?.closest?.(".meta-row") || null;
      if (!row) return null;
      const rowTypeKey = row.getAttribute?.("data-ibcslm-extra-person-type") || "";
      if (rowTypeKey) return this._extraPersonTypes.find((config) => config.key === rowTypeKey) || null;
      if (row.getAttribute?.("data-ibcslm-commenter-row") === "true") {
        return this._extraPersonTypes.find((config) => config.key === "commenter") || null;
      }
      const label = row.querySelector?.(".meta-label");
      return this._getExtraPersonConfigByCreatorType(label?.getAttribute?.("typeid"));
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
      row.setAttribute("data-ibcslm-extra-person-type", extraPersonType.key);
      if (extraPersonType.key === "commenter") row.setAttribute("data-ibcslm-commenter-row", "true");
      const plusButton = row.querySelector(".zotero-clicky-plus");
      const optionsButton = row.querySelector(".zotero-clicky-options");
      const grippy = row.querySelector(".zotero-clicky-grippy");
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
        const values = Array.from(row.querySelectorAll("input, textarea, editable-text")).map((node) => {
          return String(node.value ?? node.getAttribute?.("value") ?? "").trim();
        });
        if (values.some(Boolean)) continue;
        row.parentNode?.removeChild(row);
        if (typeof infoBox._creatorCount === "number" && infoBox._creatorCount > 0) {
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
          return String(node?.getAttribute?.("typeid") || "") === extraPersonType.creatorTypeID;
        });
        if (existing) continue;
        const menuitem = doc.createXULElement("menuitem");
        menuitem.setAttribute("label", extraPersonType.label);
        menuitem.setAttribute("typeid", extraPersonType.creatorTypeID);
        menu.appendChild(menuitem);
      }
    }
    _removeExtraPersonCreatorRows(infoBox, extraPersonType = null) {
      for (const row of this._getExtraPersonCreatorRows(infoBox, extraPersonType)) {
        row.parentNode?.removeChild(row);
        if (typeof infoBox._creatorCount === "number" && infoBox._creatorCount > 0) {
          infoBox._creatorCount -= 1;
        }
      }
    }
    _renderCourtField(infoBox) {
      const item = infoBox?.item;
      const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
      const row = this._findInfoFieldRow(infoBox, "court");
      if (!row) return;
      if (!item || item.deleted || itemTypeName !== "case") {
        this._removeCustomCourtField(infoBox);
        this._restoreCourtField(row, item);
        return;
      }
      this._updateCourtRow(infoBox, row, item);
    }
    _renderCustomCourtField(infoBox) {
      const item = infoBox?.item;
      const itemTypeName = item ? Zotero?.ItemTypes?.getName?.(item.itemTypeID) : null;
      const courtRow = this._findInfoFieldRow(infoBox, "court");
      if (!courtRow) {
        this._removeCustomCourtField(infoBox);
        return;
      }
      if (!item || item.deleted || itemTypeName !== "case" || !infoBox.editable) {
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
      return infoBox?._infoTable || infoBox?.querySelector?.("#info-table") || null;
    }
    _findInfoFieldRow(infoBox, fieldName) {
      const table = this._getInfoTable(infoBox);
      if (!table) return null;
      for (const row of table.querySelectorAll(".meta-row")) {
        const labelWrapper = row.querySelector(".meta-label");
        if (labelWrapper?.getAttribute("fieldname") === fieldName) return row;
      }
      return null;
    }
    _getOrCreateJurisdictionRow(infoBox) {
      let row = infoBox.querySelector(`#${this._jurisdictionRowID}`);
      if (row) return row;
      const doc = infoBox.ownerDocument;
      row = doc.createElement("div");
      row.id = this._jurisdictionRowID;
      row.className = "meta-row";
      const labelWrapper = doc.createElement("div");
      labelWrapper.className = "meta-label";
      labelWrapper.setAttribute("fieldname", "jurisdiction");
      let label;
      if (typeof infoBox.createLabelElement === "function") {
        label = infoBox.createLabelElement({
          id: "itembox-field-jurisdiction-label",
          text: "Jurisdiction"
        });
      } else {
        label = doc.createElement("label");
        label.id = "itembox-field-jurisdiction-label";
        label.textContent = "Jurisdiction";
      }
      labelWrapper.appendChild(label);
      const dataWrapper = doc.createElement("div");
      dataWrapper.className = "meta-data";
      row.appendChild(labelWrapper);
      row.appendChild(dataWrapper);
      return row;
    }
    _getOrCreateCustomCourtRow(infoBox) {
      let row = infoBox.querySelector(`#${this._customCourtRowID}`);
      if (row) return row;
      const doc = infoBox.ownerDocument;
      row = doc.createElement("div");
      row.id = this._customCourtRowID;
      row.className = "meta-row";
      const labelWrapper = doc.createElement("div");
      labelWrapper.className = "meta-label";
      labelWrapper.setAttribute("fieldname", "custom-court");
      let label;
      if (typeof infoBox.createLabelElement === "function") {
        label = infoBox.createLabelElement({
          id: "itembox-field-custom-court-label",
          text: "Custom Court"
        });
      } else {
        label = doc.createElement("label");
        label.id = "itembox-field-custom-court-label";
        label.textContent = "Custom Court";
      }
      labelWrapper.appendChild(label);
      const dataWrapper = doc.createElement("div");
      dataWrapper.className = "meta-data";
      row.appendChild(labelWrapper);
      row.appendChild(dataWrapper);
      return row;
    }
    _updateCustomCourtRow(row, item) {
      const dataWrapper = row.querySelector(".meta-data");
      if (!dataWrapper) return;
      dataWrapper.textContent = "";
      const doc = row.ownerDocument;
      const container = doc.createElement("div");
      container.style.display = "flex";
      container.style.alignItems = "center";
      container.style.gap = "6px";
      const customInput = doc.createElement("input");
      customInput.id = "itembox-field-court-custom";
      customInput.className = "value";
      customInput.placeholder = "Enter custom court key";
      customInput.style.maxWidth = "220px";
      const currentCourt = String(item?.getField?.("court") || "").trim();
      customInput.value = currentCourt;
      const saveCustomCourtValue = async () => {
        const rawCustomValue = String(customInput.value || "").trim();
        if (!rawCustomValue) return;
        await this._saveCourtFromMenu(item, rawCustomValue);
      };
      const setButton = doc.createElement("button");
      setButton.type = "button";
      setButton.textContent = "Set";
      setButton.addEventListener("click", () => {
        saveCustomCourtValue();
      });
      customInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        saveCustomCourtValue();
      });
      container.appendChild(customInput);
      container.appendChild(setButton);
      dataWrapper.appendChild(container);
    }
    _updateJurisdictionRow(infoBox, row, item) {
      const dataWrapper = row.querySelector(".meta-data");
      if (!dataWrapper) return;
      const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
      const displayValue = this.abbrevService.formatJurisdictionDisplay(currentJurisdiction);
      dataWrapper.textContent = "";
      if (infoBox.editable) {
        dataWrapper.appendChild(this._buildJurisdictionMenuList(infoBox, item, currentJurisdiction, displayValue));
        return;
      }
      if (typeof infoBox.createValueElement === "function") {
        const valueElem = infoBox.createValueElement({
          editable: false,
          text: displayValue,
          id: "itembox-field-jurisdiction-value",
          attributes: {
            "aria-labelledby": "itembox-field-jurisdiction-label",
            fieldname: "jurisdiction",
            title: currentJurisdiction
          }
        });
        valueElem.value = displayValue;
        dataWrapper.appendChild(valueElem);
        return;
      }
      const input = row.ownerDocument.createElement("input");
      input.className = "value";
      input.readOnly = true;
      input.value = displayValue;
      input.title = currentJurisdiction;
      dataWrapper.appendChild(input);
    }
    _updateCourtRow(infoBox, row, item) {
      const dataWrapper = row.querySelector(".meta-data");
      if (!dataWrapper) return;
      const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
      const currentCourtKey = this._getDisplayedCourtKey(item);
      const displayValue = this._formatCourtDisplay(currentCourtKey, currentJurisdiction);
      dataWrapper.textContent = "";
      if (infoBox.editable) {
        dataWrapper.appendChild(this._buildCourtMenuList(infoBox, item, currentJurisdiction, currentCourtKey, displayValue));
        return;
      }
      if (typeof infoBox.createValueElement === "function") {
        const valueElem = infoBox.createValueElement({
          editable: false,
          text: displayValue,
          id: "itembox-field-court-value",
          attributes: {
            "aria-labelledby": "itembox-field-court-label",
            fieldname: "court",
            title: currentCourtKey
          }
        });
        valueElem.value = displayValue;
        dataWrapper.appendChild(valueElem);
        return;
      }
      const input = row.ownerDocument.createElement("input");
      input.className = "value";
      input.readOnly = true;
      input.value = displayValue;
      input.title = currentCourtKey;
      dataWrapper.appendChild(input);
    }
    _restoreCourtField(row, item) {
      const dataWrapper = row?.querySelector(".meta-data");
      if (!dataWrapper) return;
      const courtValue = String(item?.getField?.("court") || "");
      const currentJurisdiction = this._getDisplayedJurisdictionCode(item);
      const displayValue = this._formatCourtDisplay(courtValue, currentJurisdiction);
      dataWrapper.textContent = "";
      const infoBox = row.closest("#zotero-editpane-info-box");
      if (infoBox && typeof infoBox.createValueElement === "function") {
        const valueElem = infoBox.createValueElement({
          editable: false,
          text: displayValue,
          id: "itembox-field-court-value",
          attributes: {
            "aria-labelledby": "itembox-field-court-label",
            fieldname: "court",
            title: courtValue
          }
        });
        valueElem.value = displayValue;
        dataWrapper.appendChild(valueElem);
        return;
      }
      const input = row.ownerDocument.createElement("input");
      input.className = "value";
      input.readOnly = true;
      input.value = displayValue;
      input.title = courtValue;
      dataWrapper.appendChild(input);
    }
    _buildJurisdictionMenuList(infoBox, item, currentJurisdiction, displayValue) {
      const doc = infoBox.ownerDocument;
      return this._buildFilteredPickerControl(doc, {
        fieldName: "jurisdiction",
        inputId: "itembox-field-jurisdiction-input",
        listId: "itembox-field-jurisdiction-list",
        currentValue: currentJurisdiction,
        displayValue,
        options: this._getJurisdictionOptions(currentJurisdiction),
        minChars: 2,
        onSelect: async (option) => {
          await this._saveJurisdictionFromMenu(item, option.code);
        },
        formatOptionText: (option) => option.label
      });
    }
    _buildCourtMenuList(infoBox, item, currentJurisdiction, currentCourtKey, displayValue) {
      const doc = infoBox.ownerDocument;
      const menulist = doc.createXULElement("menulist");
      menulist.id = "itembox-field-court-menu";
      menulist.className = "zotero-clicky keyboard-clickable";
      menulist.setAttribute("aria-labelledby", "itembox-field-court-label");
      menulist.setAttribute("fieldname", "court");
      menulist.setAttribute("tooltiptext", currentCourtKey);
      menulist.style.flex = "1";
      const popup = menulist.appendChild(doc.createXULElement("menupopup"));
      const options = this._getCourtOptions(currentJurisdiction, currentCourtKey);
      const hasCourt = !!String(currentCourtKey || "").trim();
      const noEntryValue = `${currentJurisdiction}||__no_entry__`;
      const compoundCurrentValue = hasCourt ? `${currentJurisdiction}||${currentCourtKey}` : noEntryValue;
      if (!hasCourt) {
        const placeholder = doc.createXULElement("menuitem");
        placeholder.setAttribute("value", noEntryValue);
        placeholder.setAttribute("label", "no entry");
        placeholder.setAttribute("tooltiptext", "no entry");
        popup.appendChild(placeholder);
      }
      for (const option of options) {
        const menuitem = doc.createXULElement("menuitem");
        menuitem.setAttribute("value", `${option.jurisdiction}||${option.key}`);
        menuitem.setAttribute("label", option.label);
        menuitem.setAttribute("tooltiptext", option.abbreviation || option.key);
        popup.appendChild(menuitem);
      }
      menulist.value = compoundCurrentValue;
      if (!hasCourt && menulist.selectedItem) {
        menulist.setAttribute("label", "no entry");
      } else if (!menulist.selectedItem && options.length) {
        const fallbackIndex = options.findIndex((option) => !option.isChild && option.key === currentCourtKey && option.jurisdiction === currentJurisdiction);
        menulist.selectedIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
      }
      if (menulist.selectedItem && displayValue) {
        menulist.setAttribute("label", menulist.selectedItem.getAttribute("label"));
      }
      const saveCourtValue = async () => {
        const selectedValue = String(menulist.value || "").trim();
        if (!selectedValue) return;
        if (selectedValue.endsWith("||__no_entry__")) {
          const extra = String(item.getField?.("extra") || "");
          let nextExtra = this.Jurisdiction.updateMLZExtraField?.(extra, "court", "") || extra;
          if (nextExtra === extra && String(item.getField?.("court") || "").trim() === "") return;
          item.setField("extra", nextExtra);
          item.setField("court", "");
          await item.saveTx({ skipDateModifiedUpdate: true });
          try {
            const infoBox2 = this._getActiveInfoBox?.();
            if (infoBox2) {
              this._renderCourtField(infoBox2);
              this._renderCustomCourtField(infoBox2);
            }
          } catch (e) {
          }
          return;
        }
        await this._saveCourtFromMenu(item, selectedValue);
      };
      menulist.addEventListener("command", saveCourtValue);
      menulist.addEventListener("change", saveCourtValue);
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
      formatOptionText
    }) {
      let currentDisplayValue = String(displayValue || "");
      let currentRawValue = String(currentValue || "");
      const wrapper = doc.createElement("div");
      wrapper.style.display = "flex";
      wrapper.style.alignItems = "center";
      wrapper.style.gap = "0";
      wrapper.style.width = "100%";
      wrapper.style.position = "relative";
      if (fieldName === "jurisdiction") {
        wrapper.style.maxWidth = "22em";
      }
      const input = doc.createElement("input");
      input.id = inputId;
      input.className = "value";
      input.setAttribute("fieldname", fieldName);
      input.setAttribute("aria-labelledby", `itembox-field-${fieldName}-label`);
      input.autocomplete = "off";
      input.spellcheck = false;
      input.style.flex = "1";
      input.style.minWidth = "0";
      input.value = currentDisplayValue;
      input.title = currentRawValue;
      input.style.boxSizing = "border-box";
      input.style.width = "100%";
      input.style.maxWidth = fieldName === "jurisdiction" ? "22em" : "100%";
      input.style.whiteSpace = "nowrap";
      input.style.overflow = "hidden";
      input.style.textOverflow = "ellipsis";
      const normalizedOptions = Array.isArray(options) ? options.map((option) => ({
        ...option,
        displayText: String(typeof formatOptionText === "function" ? formatOptionText(option) : option.label || option.code || "").trim(),
        searchText: this._normalizeMenuSearchText(`${String(option.label || "")} ${String(option.code || "")} ${String(option.abbreviation || "")}`)
      })).filter((option) => option.displayText) : [];
      const popup = doc.createElement("div");
      popup.id = listId;
      popup.style.position = "absolute";
      popup.style.left = "0";
      popup.style.right = "0";
      popup.style.top = "100%";
      popup.style.zIndex = "2000";
      popup.style.maxHeight = "220px";
      popup.style.overflowY = "auto";
      popup.style.border = "1px solid ThreeDShadow";
      popup.style.background = "Field";
      popup.style.color = "FieldText";
      popup.style.display = "none";
      popup.style.boxShadow = "0 2px 8px rgba(0,0,0,0.2)";
      popup.style.marginTop = "2px";
      const hidePopup = () => {
        popup.style.display = "none";
        while (popup.firstChild) popup.removeChild(popup.firstChild);
      };
      const renderOptions = () => {
        const query = this._normalizeMenuSearchText(String(input.value || ""));
        hidePopup();
        if (query.length < Math.max(1, Number(minChars) || 2)) return;
        const matches = normalizedOptions.filter((option) => option.searchText.includes(query));
        if (!matches.length) {
          const empty = doc.createElement("div");
          empty.textContent = "No matches";
          empty.style.padding = "4px 8px";
          empty.style.opacity = "0.7";
          popup.appendChild(empty);
          popup.style.display = "block";
          return;
        }
        for (const option of matches.slice(0, 100)) {
          const row = doc.createElement("button");
          row.type = "button";
          row.textContent = option.displayText;
          row.title = option.displayText;
          row.style.display = "block";
          row.style.width = "100%";
          row.style.boxSizing = "border-box";
          row.style.textAlign = "left";
          row.style.padding = "2px 8px";
          row.style.border = "0";
          row.style.margin = "0";
          row.style.background = "transparent";
          row.style.color = "inherit";
          row.style.whiteSpace = "nowrap";
          row.style.overflow = "hidden";
          row.style.textOverflow = "ellipsis";
          row.style.lineHeight = "1.2";
          row.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
          });
          row.addEventListener("click", async () => {
            input.value = option.displayText;
            input.title = option.displayText;
            currentDisplayValue = option.displayText;
            currentRawValue = option.code;
            hidePopup();
            await onSelect?.(option);
          });
          popup.appendChild(row);
        }
        popup.style.display = "block";
      };
      const resolveSelectedOption = async () => {
        const raw = String(input.value || "").trim();
        if (!raw) return;
        const normalizedRaw = this._normalizeMenuSearchText(raw);
        const exact = normalizedOptions.find((option) => {
          return this._normalizeMenuSearchText(option.displayText) === normalizedRaw || this._normalizeMenuSearchText(option.code) === normalizedRaw;
        });
        const uniquePrefix = !exact ? normalizedOptions.filter((option) => option.searchText.includes(normalizedRaw)) : [];
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
      input.addEventListener("input", renderOptions);
      input.addEventListener("focus", () => {
        if (typeof input.select === "function") input.select();
        renderOptions();
      });
      input.addEventListener("change", resolveSelectedOption);
      input.addEventListener("blur", resolveSelectedOption);
      input.addEventListener("keydown", (event) => {
        const key = String(event.key || "");
        if (key === "Escape") {
          hidePopup();
          return;
        }
        if (key !== "Enter") return;
        event.preventDefault();
        resolveSelectedOption();
      });
      wrapper.appendChild(input);
      wrapper.appendChild(popup);
      return wrapper;
    }
    _attachMenuSearchFilter(menulist, popup, { minChars = 2, displayValue = "" } = {}) {
      if (!menulist || !popup) return;
      const searchField = menulist.inputField || menulist;
      const state = {
        timer: null,
        minChars: Math.max(1, Number(minChars) || 2)
      };
      const clearTimer = () => {
        if (!state.timer) return;
        clearTimeout(state.timer);
        state.timer = null;
      };
      const setAllVisible = () => {
        this._removeMenuNoResultsItem(popup);
        for (const node of Array.from(popup.children || [])) {
          if (node?.localName !== "menuitem") continue;
          node.hidden = false;
        }
      };
      const applyFilter = (rawQuery = "") => {
        const normalizedQuery = this._normalizeMenuSearchText(rawQuery);
        if (!normalizedQuery || normalizedQuery.length < state.minChars) {
          setAllVisible();
          return;
        }
        let visibleCount = 0;
        for (const node of Array.from(popup.children || [])) {
          if (node?.localName !== "menuitem") continue;
          const haystack = String(node._ibcslmSearchText || node.getAttribute("label") || node.getAttribute("value") || "").trim();
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
        if (searchField && "value" in searchField) searchField.value = "";
        applyFilter("");
      };
      const onInput = () => {
        clearTimer();
        const query = String(searchField?.value || "");
        applyFilter(query);
      };
      const onKeyDown = (event) => {
        if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
        if (String(event.key || "") === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          resetSearch();
        }
      };
      if (searchField?.addEventListener) {
        searchField.addEventListener("input", onInput);
        searchField.addEventListener("keydown", onKeyDown, true);
      } else {
        menulist.addEventListener("keydown", onKeyDown, true);
      }
      popup.addEventListener("popuphidden", resetSearch);
      popup.addEventListener("popupshown", onInput);
      popup.addEventListener("command", resetSearch);
      if (displayValue) {
        menulist.setAttribute("label", displayValue);
        if (searchField && "value" in searchField) {
          searchField.value = "";
        }
      }
      setAllVisible();
    }
    _normalizeMenuSearchText(value) {
      return this.abbrevService.normalizeKey(value || "");
    }
    _showMenuNoResultsItem(popup) {
      if (!popup) return;
      this._removeMenuNoResultsItem(popup);
      const doc = popup.ownerDocument;
      const item = doc.createXULElement("menuitem");
      item.setAttribute("label", "No matches");
      item.setAttribute("disabled", "true");
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
        label: this.abbrevService.formatJurisdictionDisplay(currentJurisdiction) || currentJurisdiction
      }, ...options];
    }
    _getCourtOptions(currentJurisdiction, currentCourtKey) {
      const options = this.abbrevService.listInstitutionPartOptionsForJurisdictionTree(currentJurisdiction);
      if (!currentCourtKey) return options;
      const hasExact = options.some((option) => !option.isChild && option.key === currentCourtKey && option.jurisdiction === currentJurisdiction);
      if (hasExact) return options;
      return [{
        key: currentCourtKey,
        label: this._formatCourtDisplay(currentCourtKey, currentJurisdiction),
        abbreviation: "",
        jurisdiction: currentJurisdiction || "us",
        isChild: false
      }, ...options];
    }
    _getDisplayedJurisdictionCode(item) {
      const mlzJurisdiction = this.Jurisdiction.getMLZJurisdiction?.(item) || "";
      if (mlzJurisdiction) return mlzJurisdiction;
      return this.Jurisdiction.fromItem(item);
    }
    _getDisplayedCourtKey(item) {
      return this.abbrevService.normalizeKey(item?.getField?.("court") || "");
    }
    _formatCourtDisplay(courtKey, jurisdiction) {
      const key = this.abbrevService.normalizeKey(courtKey || "");
      if (!key) return "";
      return this.abbrevService.formatInstitutionPartDisplay(key, jurisdiction) || String(courtKey || "");
    }
    _getStoredExtraPerson(item, extraPersonType) {
      const creators = this.Jurisdiction.getMLZExtraCreatorsByType?.(item, extraPersonType.mlzType) || [];
      return creators[0] || null;
    }
    _setStoredExtraPerson(item, extraPersonType, person) {
      if (!item?.setField) return;
      const extra = String(item.getField?.("extra") || "");
      const nextExtra = this.Jurisdiction.updateMLZExtraCreators?.call(
        this.Jurisdiction,
        extra,
        extraPersonType.mlzType,
        person ? [person] : []
      ) || extra;
      if (nextExtra !== extra) {
        item.setField("extra", nextExtra);
      }
    }
    _formatStoredExtraPerson(person) {
      if (!person || typeof person !== "object") return "";
      if (person.name) return String(person.name).trim();
      const firstName = String(person.firstName || "").trim();
      const lastName = String(person.lastName || "").trim();
      return `${firstName}${firstName && lastName ? " " : ""}${lastName}`.trim();
    }
    _extraPersonFromCreatorFields(fields) {
      if (!fields || typeof fields !== "object") return null;
      const fieldMode = Number(fields.fieldMode) || 0;
      const firstName = String(fields.firstName || "").trim();
      const lastName = String(fields.lastName || "").trim();
      if (!firstName && !lastName) return null;
      if (fieldMode === 1) {
        return { name: lastName || firstName };
      }
      return { firstName, lastName };
    }
    _extraPersonToCreatorData(person) {
      if (!person || typeof person !== "object") return null;
      if (person.name) {
        return {
          firstName: "",
          lastName: String(person.name || "").trim(),
          fieldMode: 1
        };
      }
      return {
        firstName: String(person.firstName || "").trim(),
        lastName: String(person.lastName || "").trim(),
        fieldMode: 0
      };
    }
    _getExtraPersonConfigByCreatorType(value) {
      const normalized = String(value || "").trim().toLowerCase();
      if (!normalized) return null;
      return this._extraPersonTypes.find((config) => {
        if (normalized === String(config.creatorTypeID).toLowerCase()) return true;
        if (normalized === String(config.creatorTypeName).toLowerCase()) return true;
        return config.key === "commenter" && normalized === String(config.label).toLowerCase();
      }) || null;
    }
    _itemTypeSupportsExtraPerson(itemTypeID) {
      return Zotero?.ItemTypes?.getName?.(itemTypeID) === "case";
    }
    async _saveJurisdictionFromMenu(item, selectedCode) {
      try {
        const current = this.Jurisdiction.getMLZJurisdiction?.(item) || "";
        if (current === selectedCode) return;
        const extra = String(item.getField?.("extra") || "");
        const displayValue = this.abbrevService.formatJurisdictionDisplay(selectedCode);
        let nextExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, selectedCode, displayValue) || extra;
        nextExtra = this.Jurisdiction.updateMLZExtraField?.(nextExtra, "court", "") || nextExtra;
        if (nextExtra === extra && String(item.getField?.("court") || "").trim() === "") return;
        item.setField("extra", nextExtra);
        item.setField("court", "");
        await item.saveTx({ skipDateModifiedUpdate: true });
        try {
          const infoBox = this._getActiveInfoBox?.();
          if (infoBox) {
            const courtRow = this._findInfoFieldRow(infoBox, "court");
            if (courtRow) this._renderCourtField(infoBox);
            this._renderCustomCourtField(infoBox);
          }
        } catch (e) {
        }
        try {
          Zotero.debug(`[IndigoBook CSL-M] jurisdiction row saved: item=${String(item.id)} jurisdiction=${selectedCode}`);
        } catch (e) {
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
        try {
          Zotero.debug(`[IndigoBook CSL-M] jurisdiction row save failed: ${String(e)}`);
        } catch (_) {
        }
      }
    }
    async _saveCourtFromMenu(item, selectedValue) {
      try {
        const sep = selectedValue.indexOf("||");
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
          const extra = String(item.getField?.("extra") || "");
          const displayValue = this.abbrevService.formatJurisdictionDisplay(targetJurisdiction);
          const updatedExtra = this.Jurisdiction.updateMLZJurisdiction?.(extra, targetJurisdiction, displayValue) || extra;
          item.setField("extra", updatedExtra);
          const targetOptions = this.abbrevService.listInstitutionPartOptionsForJurisdictionTree(targetJurisdiction);
          if (!targetOptions.length) {
            item.setField("court", "");
            await item.saveTx({ skipDateModifiedUpdate: true });
            try {
              Zotero.debug(`[IndigoBook CSL-M] court row cleared for jurisdiction with no institution-part: item=${String(item.id)} jurisdiction=${targetJurisdiction}`);
            } catch (e) {
            }
            return;
          }
        }
        item.setField("court", normalizedKey);
        await item.saveTx({ skipDateModifiedUpdate: true });
        try {
          Zotero.debug(`[IndigoBook CSL-M] court row saved: item=${String(item.id)} court=${normalizedKey} jurisdiction=${targetJurisdiction || "unchanged"}`);
        } catch (e) {
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
        try {
          Zotero.debug(`[IndigoBook CSL-M] court row save failed: ${String(e)}`);
        } catch (_) {
        }
      }
    }
    _patchRetrieveItem() {
      const sysProto = Zotero?.Cite?.System?.prototype;
      if (!sysProto?.retrieveItem) return;
      this._orig.retrieveItem = sysProto.retrieveItem;
      const self = this;
      sysProto.retrieveItem = function(id) {
        const cslItem = self._orig.retrieveItem.call(this, id);
        if (cslItem && typeof cslItem.then === "function") {
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
      if (!cslItem || typeof cslItem !== "object") {
        try {
          this._logRetrieveItemDetails(id, null, "non-object return");
          this._warnRetrieveItem(`retrieveItem returned non-object for id ${id}`);
        } catch (e) {
        }
        return cslItem;
      }
      cslItem = { ...cslItem };
      const normalizedID = this._normalizeItemID(id);
      if (normalizedID != null) cslItem.id = String(normalizedID);
      this._logRetrieveItemDetails(id, cslItem.id, "ok");
      try {
        const zotItem = this._getZoteroItemByAnyID(id);
        if (zotItem) {
          this._hydrateCSLItemFromZotero(cslItem, zotItem);
          const jur = this.Jurisdiction.fromItem(zotItem);
          cslItem.jurisdiction = jur;
          cslItem.country = jur.split(":")[0];
          this._decorateShortForms(cslItem, jur);
          this._logCitationItemData(cslItem, zotItem, "retrieveItem");
          this._logRenderProbeFromItem(cslItem, jur, "retrieveItem");
        } else {
          this._logField("missing-zotero-item", `id=${String(id)}`);
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
        if (typeof id === "string" && /^\d+$/.test(id)) {
          zotItem = Zotero.Items.get(Number(id));
          if (zotItem) return zotItem;
        }
        if (typeof id === "object" && id && id.id != null) {
          zotItem = Zotero.Items.get(id.id);
          if (zotItem) return zotItem;
        }
      } catch (e) {
      }
      return null;
    }
    _hydrateCSLItemFromZotero(cslItem, zotItem) {
      try {
        const mlzFields = this.Jurisdiction.getMLZExtraFields?.(zotItem) || null;
        const commenterCreators = this.Jurisdiction.getMLZExtraCreatorsByType?.(zotItem, "commenter") || [];
        const translatorCreators = this.Jurisdiction.getMLZExtraCreatorsByType?.(zotItem, "translator") || [];
        if (!cslItem.title) {
          const title = zotItem.getField?.("title");
          if (title) cslItem.title = title;
        }
        if (!cslItem["container-title"]) {
          const containerTitle = zotItem.getField?.("publicationTitle") || zotItem.getField?.("reporter") || zotItem.getField?.("report") || mlzFields?.reporter || "";
          if (containerTitle) cslItem["container-title"] = containerTitle;
          else this._logField("missing-container-title-source", `itemType=${String(cslItem.type)} title=${String(cslItem.title || "")}`);
        }
        const journalAbbr = String(
          zotItem.getField?.("journalAbbreviation") || zotItem.getField?.("journalAbbr") || ""
        ).trim();
        if (journalAbbr) {
          const normalizedContainerTitle = this.abbrevService.normalizeKey(cslItem["container-title"] || "");
          if (normalizedContainerTitle) {
            this._journalAbbrByContainerTitleKey.set(normalizedContainerTitle, journalAbbr);
          }
          const hadShort = !!String(cslItem["container-title-short"] || "").trim();
          cslItem["container-title-short"] = journalAbbr;
          this._logShortForm(
            "container-title",
            cslItem["container-title"] || "",
            cslItem["container-title-short"],
            hadShort ? "journal-abbr-override" : "journal-abbr"
          );
        }
        if (!cslItem.authority) {
          const court = String(zotItem.getField?.("court") || "").trim();
          if (court) {
            cslItem.authority = [{ literal: this.abbrevService.normalizeKey(court) || court }];
          }
        }
        if (!cslItem.commenter && commenterCreators.length) {
          cslItem.commenter = commenterCreators.map((creator) => this._extraPersonToCSLCreator(creator)).filter((creator) => creator.literal || creator.given || creator.family);
        }
        if (!cslItem.translator && translatorCreators.length) {
          cslItem.translator = translatorCreators.map((creator) => this._extraPersonToCSLCreator(creator)).filter((creator) => creator.literal || creator.given || creator.family);
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
      const seen = /* @__PURE__ */ new Set();
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
        const relatedURIs = relatedPredicate ? zotItem?.getRelationsByPredicate?.(relatedPredicate) || [] : [];
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
      if (typeof value === "object") {
        const directURI = this._getItemURI(value);
        if (directURI) return directURI;
        if ("key" in value && libraryID != null) {
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
      } catch (e) {
      }
      return null;
    }
    _extraPersonToCSLCreator(person) {
      const literalName = String(person?.name || "").trim();
      if (literalName) return { literal: literalName };
      return {
        given: String(person?.firstName || "").trim(),
        family: String(person?.lastName || "").trim()
      };
    }
    _decorateShortForms(cslItem, jur) {
      try {
        if (!cslItem["container-title-short"] && cslItem["container-title"]) {
          const hit = this.abbrevService.lookupForCiteProc("container-title", cslItem["container-title"], jur, { noHints: false });
          if (hit?.value) {
            cslItem["container-title-short"] = this.abbrevService.parseDirective(hit.value).value;
            this._logShortForm("container-title", cslItem["container-title"], cslItem["container-title-short"], "hit");
          } else {
            this._logShortForm("container-title", cslItem["container-title"], null, "miss");
          }
        }
        if (!cslItem["title-short"] && cslItem.title) {
          const hit = this.abbrevService.lookupForCiteProc("title", cslItem.title, jur, { noHints: false });
          if (hit?.value) {
            cslItem["title-short"] = this.abbrevService.parseDirective(hit.value).value;
            this._logShortForm("title", cslItem.title, cslItem["title-short"], "hit");
          } else {
            this._logShortForm("title", cslItem.title, null, "miss");
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
      try {
        Zotero.debug(msg);
      } catch (e) {
      }
    }
    _logField(stage, detail) {
      if (this._fieldLogCount >= this._maxFieldLogs) return;
      this._fieldLogCount += 1;
      const msg = `[IndigoBook CSL-M] field[${this._fieldLogCount}] ${stage}: ${detail}`;
      try {
        Zotero.debug(msg);
      } catch (e) {
      }
    }
    _isHarvardCRCL(text) {
      const normalized = this.abbrevService.normalizeKey(text || "");
      return normalized.includes("harvard civil rights") && normalized.includes("civil liberties") && normalized.includes("law review");
    }
    _logRenderProbeFromItem(cslItem, jur, stage) {
      try {
        const source = String(cslItem?.["container-title"] || "");
        if (!this._isHarvardCRCL(source)) return;
        const msg = `[IndigoBook CSL-M] renderProbe item(${stage}): jur=${String(jur)} type=${String(cslItem?.type || "")} container-title=${source} container-title-short=${String(cslItem?.["container-title-short"] || "")} title=${String(cslItem?.title || "")} title-short=${String(cslItem?.["title-short"] || "")}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _logRenderProbeFromAbbreviation(category, key, jurisdiction, noHints, stage) {
      try {
        if (category !== "container-title") return;
        if (!this._isHarvardCRCL(key)) return;
        const normalized = this.abbrevService.normalizeKey(key || "");
        const msg = `[IndigoBook CSL-M] renderProbe abbr(${stage}): category=${String(category)} jur=${String(jurisdiction)} noHints=${String(!!noHints)} key=${String(key)} normalized=${normalized}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _normalizeItemID(id) {
      if (id == null) return null;
      if (Array.isArray(id)) return null;
      if (typeof id === "object") {
        if ("id" in id) return id.id;
        return String(id);
      }
      return id;
    }
    _logRetrieveItemDetails(inputID, outputID, stage) {
      if (this._retrieveItemLogCount >= this._maxRetrieveItemLogs) return;
      this._retrieveItemLogCount += 1;
      const inType = Array.isArray(inputID) ? "array" : typeof inputID;
      const outType = Array.isArray(outputID) ? "array" : typeof outputID;
      const msg = `[IndigoBook CSL-M] retrieveItem[${this._retrieveItemLogCount}] ${stage}: inputID(${inType})=${String(inputID)} => cslItem.id(${outType})=${String(outputID)}`;
      try {
        Zotero.debug(msg);
      } catch (e) {
      }
      try {
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _warnRetrieveItem(reason) {
      if (this._didWarnRetrieveItem) return;
      this._didWarnRetrieveItem = true;
      try {
        Zotero.debug(`[IndigoBook CSL-M] retrieveItem patch warning: ${reason}`);
      } catch (e) {
      }
    }
    _patchAbbreviations() {
      const sysProto = Zotero?.Cite?.System?.prototype;
      if (!sysProto) return;
      if (sysProto.getAbbreviation) this._orig.getAbbreviation = sysProto.getAbbreviation;
      if (sysProto.normalizeAbbrevsKey) this._orig.normalizeAbbrevsKey = sysProto.normalizeAbbrevsKey;
      const self = this;
      sysProto.normalizeAbbrevsKey = function(_familyVar, key) {
        return self.abbrevService.normalizeKey(key);
      };
      sysProto.getAbbreviation = function(styleID, obj, jurisdiction, category, key, noHints) {
        let origJurisdiction = jurisdiction || "default";
        if (self._orig.getAbbreviation) {
          origJurisdiction = self._orig.getAbbreviation.call(this, styleID, obj, jurisdiction, category, key, noHints) || origJurisdiction;
        }
        self._logRenderProbeFromAbbreviation(category, key, jurisdiction || origJurisdiction || "default", noHints, "pre");
        try {
          const jur = (jurisdiction || origJurisdiction || "default").toLowerCase();
          if (category === "container-title") {
            const normalizedContainerTitle = self.abbrevService.normalizeKey(key);
            const journalAbbr = self._journalAbbrByContainerTitleKey.get(normalizedContainerTitle);
            if (journalAbbr) {
              if (!obj[jur]) obj[jur] = self._newAbbreviationSegments(this);
              if (!obj[jur][category]) obj[jur][category] = {};
              obj[jur][category][key] = journalAbbr;
              self._logRenderProbeFromAbbreviation(category, key, jur, noHints, "journal-abbr");
              self._logAbbreviation(category, key, jur, journalAbbr, "journal-abbr");
              return jur;
            }
          }
          const hit = self.abbrevService.lookupForCiteProc(category, key, jur, { noHints });
          if (hit?.value) {
            const targetJur = hit.jurisdiction || jur || "default";
            if (!obj[targetJur]) obj[targetJur] = self._newAbbreviationSegments(this);
            if (!obj[targetJur][category]) obj[targetJur][category] = {};
            obj[targetJur][category][key] = hit.value;
            self._logRenderProbeFromAbbreviation(category, key, targetJur, noHints, "hit");
            self._logAbbreviation(category, key, targetJur, obj[targetJur][category][key], "hit");
            return targetJur;
          }
          const resolvedJur = (origJurisdiction || jur || "default").toLowerCase();
          if (!obj[resolvedJur]) obj[resolvedJur] = self._newAbbreviationSegments(this);
          if (!obj.default) obj.default = self._newAbbreviationSegments(this);
          self._logRenderProbeFromAbbreviation(category, key, resolvedJur, noHints, "miss");
          self._logAbbreviation(category, key, resolvedJur, null, "miss");
          return resolvedJur;
        } catch (e) {
          self._logAbbreviation(category, key, origJurisdiction, String(e), "error");
        }
        const fallbackJur = (origJurisdiction || jurisdiction || "default").toLowerCase();
        try {
          if (!obj[fallbackJur]) obj[fallbackJur] = self._newAbbreviationSegments(this);
          if (!obj.default) obj.default = self._newAbbreviationSegments(this);
        } catch (e) {
        }
        return fallbackJur;
      };
    }
    _newAbbreviationSegments(sysObj) {
      if (typeof sysObj?.AbbreviationSegments === "function") {
        return new sysObj.AbbreviationSegments();
      }
      return {
        "container-title": {},
        "collection-title": {},
        "institution-entire": {},
        "institution-part": {},
        nickname: {},
        number: {},
        title: {},
        place: {},
        hereinafter: {},
        classic: {},
        "container-phrase": {},
        "title-phrase": {}
      };
    }
    _logAbbreviation(category, key, jurisdiction, value, stage) {
      if (this._abbrevLogCount >= this._maxAbbrevLogs) return;
      this._abbrevLogCount += 1;
      const msg = `[IndigoBook CSL-M] getAbbreviation[${this._abbrevLogCount}] ${stage}: category=${category} jurisdiction=${jurisdiction} key=${String(key)} value=${String(value)}`;
      try {
        Zotero.debug(msg);
      } catch (e) {
      }
    }
    _patchLoadJurisdictionStyle() {
      const sysProto = Zotero?.Cite?.System?.prototype;
      if (!sysProto) return;
      if (sysProto.loadJurisdictionStyle) this._orig.loadJurisdictionStyle = sysProto.loadJurisdictionStyle;
      if (sysProto.retrieveStyleModule) this._orig.retrieveStyleModule = sysProto.retrieveStyleModule;
      const self = this;
      sysProto.loadJurisdictionStyle = function(jurisdiction, variantName) {
        const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
        if (xml) {
          self._logJurisdictionModuleLoad("loadJurisdictionStyle", jurisdiction, variantName, xml);
          return xml;
        }
        if (self._orig.loadJurisdictionStyle) return self._orig.loadJurisdictionStyle.call(this, jurisdiction, variantName);
        return null;
      };
      sysProto.retrieveStyleModule = function(jurisdiction, variantName) {
        const xml = self.moduleLoader.loadJurisdictionStyleSync(jurisdiction, variantName);
        if (xml) {
          self._logJurisdictionModuleLoad("retrieveStyleModule", jurisdiction, variantName, xml);
          return xml;
        }
        if (self._orig.retrieveStyleModule) return self._orig.retrieveStyleModule.call(this, jurisdiction, variantName);
        return null;
      };
    }
    _patchGetCiteProcFallback() {
      const proto = Zotero?.Style?.prototype;
      if (!proto?.getCiteProc) return;
      this._orig.getCiteProc = proto.getCiteProc;
      const self = this;
      proto.getCiteProc = function(...args) {
        const styleXML = self._getStyleXMLSync(this);
        if (!styleXML) {
          const citeproc = self._orig.getCiteProc.apply(this, args);
          return self._instrumentCiteProcEngine(citeproc);
        }
        let effectiveXML = styleXML;
        const hasIndigoPref = effectiveXML.includes('jurisdiction-preference="IndigoTemp"');
        const hasEmptyCitation = self._hasEmptyCitationLayout(effectiveXML);
        if (hasEmptyCitation && (hasIndigoPref || self._looksLikeJurisStyle(effectiveXML))) {
          const baseUS = self.moduleLoader?._byFile?.get("juris-us.csl") || null;
          if (baseUS) {
            effectiveXML = baseUS;
            try {
              Zotero.debug("[IndigoBook CSL-M] Replaced empty IndigoTemp citation layout with base juris-us.csl");
            } catch (e) {
            }
          }
        }
        let patched = effectiveXML.replace(/\[HINT:[^\]]+\]/g, "");
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
      if (!citeproc || typeof citeproc !== "object") return citeproc;
      if (citeproc.__indigoRenderProbeInstrumented) return citeproc;
      citeproc.__indigoRenderProbeInstrumented = true;
      this._logCiteprocEngineDetails(citeproc);
      this._instrumentParallelLifecycle(citeproc);
      try {
        const availableAbbrevDomains = this.abbrevService?.getAvailableAbbrevDomains?.();
        if (citeproc.opt && availableAbbrevDomains && Object.keys(availableAbbrevDomains).length) {
          citeproc.opt.availableAbbrevDomains = {
            ...citeproc.opt.availableAbbrevDomains || {},
            ...availableAbbrevDomains
          };
        }
      } catch (e) {
      }
      try {
        const methodList = [
          "processCitationCluster",
          "previewCitationCluster",
          "appendCitationCluster",
          "makeBibliography",
          "updateItems"
        ];
        const available = methodList.filter((name) => typeof citeproc[name] === "function").join(",");
        Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc instrumentation: methods=${available || "none"}`);
      } catch (e) {
      }
      this._instrumentParallelTracker(citeproc);
      const wrap = (methodName) => {
        const orig = citeproc?.[methodName];
        if (typeof orig !== "function") return;
        const self = this;
        citeproc[methodName] = function(...args) {
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
      wrap("processCitationCluster");
      wrap("previewCitationCluster");
      wrap("appendCitationCluster");
      wrap("makeBibliography");
      wrap("updateItems");
      return citeproc;
    }
    _instrumentParallelLifecycle(citeproc) {
      const wrap = (methodName) => {
        const orig = citeproc?.[methodName];
        if (typeof orig !== "function") return;
        const marker = `__indigoParallelLifecycle_${methodName}`;
        if (citeproc[marker]) return;
        citeproc[marker] = true;
        const self = this;
        citeproc[methodName] = function(...args) {
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
      wrap("retrieveAllStyleModules");
      wrap("loadStyleModule");
      wrap("buildTokenLists");
      wrap("configureTokenList");
    }
    _logCiteprocEngineDetails(citeproc) {
      try {
        const ctorName = String(citeproc?.constructor?.name || "unknown");
        const prefRs = Zotero.Prefs?.get?.("cite.useCiteprocRs");
        const parallelEnabled = citeproc?.opt?.parallel?.enable;
        const trackRepeat = Object.keys(citeproc?.opt?.track_repeat || {});
        const hasParallelTracker = !!citeproc?.parallel;
        const msg = `[IndigoBook CSL-M] citeproc engine: ctor=${ctorName} citeprocRsPref=${String(!!prefRs)} hasParallelTracker=${String(hasParallelTracker)} parallelEnabled=${String(!!parallelEnabled)} trackRepeat=${trackRepeat.join("|") || "none"}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _logParallelLifecycle(citeproc, stage, args, resultOrError = void 0) {
      try {
        const parallel = citeproc?.opt?.parallel || {};
        const trackRepeat = Object.keys(citeproc?.opt?.track_repeat || {});
        const argSummary = this._summarizeParallelLifecycleArgs(stage, args);
        let tail = "";
        if (stage.endsWith(":error")) {
          tail = ` error=${String(resultOrError)}`;
        } else if (stage.endsWith(":after")) {
          tail = ` result=${this._summarizeParallelLifecycleResult(resultOrError)}`;
        }
        const msg = `[IndigoBook CSL-M] citeproc parallel lifecycle(${stage}): enabled=${String(!!parallel.enable)} parallelKeys=${Object.keys(parallel).join("|") || "none"} trackRepeat=${trackRepeat.join("|") || "none"} ${argSummary}${tail}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _summarizeParallelLifecycleArgs(stage, args) {
      try {
        if (stage.startsWith("retrieveAllStyleModules")) {
          return `jurisdictions=${JSON.stringify(args?.[0] || null)}`;
        }
        if (stage.startsWith("loadStyleModule")) {
          const xml = typeof args?.[1] === "string" ? args[1] : "";
          return `jurisdiction=${String(args?.[0] || "")} hasXml=${String(!!xml)} xmlParallelAttrs=${String(/parallel-(first|last|last-to-first|delimiter-override)\s*=/.test(xml))} skipFallback=${String(!!args?.[2])}`;
        }
        if (stage.startsWith("buildTokenLists")) {
          const node = args?.[0];
          const target = args?.[1];
          const nodeName = String(node?.name || node?.nodeName || node?.tokentype || "");
          const targetKeys = target && typeof target === "object" ? Object.keys(target).slice(0, 6).join("|") : "none";
          return `node=${nodeName || "unknown"} targetKeys=${targetKeys}`;
        }
        if (stage.startsWith("configureTokenList")) {
          const tokens = args?.[0];
          const tokenCount = Array.isArray(tokens) ? tokens.length : -1;
          const tokenNames = Array.isArray(tokens) ? tokens.slice(0, 5).map((token) => String(token?.name || token?.tokentype || "")).join("|") : "none";
          return `tokenCount=${String(tokenCount)} tokenNames=${tokenNames || "none"}`;
        }
      } catch (e) {
      }
      return "args=unavailable";
    }
    _summarizeParallelLifecycleResult(result) {
      if (Array.isArray(result)) return `array(${result.length})`;
      if (result && typeof result === "object") return `object(${Object.keys(result).slice(0, 6).join("|")})`;
      return String(result);
    }
    _logJurisdictionModuleLoad(hookName, jurisdiction, variantName, xml) {
      try {
        const hasParallelFirst = /parallel-first\s*=/.test(xml);
        const hasParallelLast = /parallel-last\s*=/.test(xml);
        const hasParallelLastToFirst = /parallel-last-to-first\s*=/.test(xml);
        const hasParallelDelimiter = /parallel-delimiter-override\s*=/.test(xml);
        const msg = `[IndigoBook CSL-M] jurisdiction module(${hookName}): jurisdiction=${String(jurisdiction || "")} variant=${String(variantName || "")} parallel-first=${String(hasParallelFirst)} parallel-last=${String(hasParallelLast)} parallel-last-to-first=${String(hasParallelLastToFirst)} parallel-delimiter=${String(hasParallelDelimiter)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _logCitationBranchProbe(methodName, citation) {
      try {
        const items = this._extractCitationItems(citation);
        if (!Array.isArray(items) || !items.length) return;
        for (const citationItem of items) {
          const itemID = citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null;
          const pos = citationItem?.position;
          const nearNote = !!(citationItem?.["near-note"] || citationItem?.nearNote);
          const hasLocator = citationItem?.locator != null && String(citationItem.locator).trim() !== "";
          const label = String(citationItem?.label || "");
          let branch = "full";
          if (pos === 2 || pos === "ibid-with-locator") branch = "ibid-with-locator";
          else if (pos === 1 || pos === "ibid") branch = "ibid";
          else if (nearNote || pos === 3 || pos === "subsequent") branch = "short";
          const msg = `[IndigoBook CSL-M] renderProbe citeproc(${methodName}): branch=${branch} position=${String(pos)} near-note=${String(nearNote)} locator=${String(citationItem?.locator || "")} label=${label} has-locator=${String(hasLocator)} itemID=${String(itemID)}`;
          Zotero.debug(msg);
          Zotero.logError(msg);
        }
      } catch (e) {
      }
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
        const ids = items.map((citationItem) => citationItem?.id ?? citationItem?.itemID ?? citationItem?.itemId ?? null).filter((id) => id != null).map((id) => String(id)).join(",");
        Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc start(${methodName}): args=${String(args?.length || 0)} ids=${ids || "none"}`);
      } catch (e) {
      }
    }
    _logCiteprocMethodEnd(methodName, result) {
      try {
        let shape = typeof result;
        if (Array.isArray(result)) shape = `array(${result.length})`;
        if (result && typeof result === "object" && !Array.isArray(result)) {
          shape = `object(${Object.keys(result).slice(0, 6).join("|")})`;
        }
        Zotero.debug(`[IndigoBook CSL-M] renderProbe citeproc end(${methodName}): result=${shape}`);
      } catch (e) {
      }
    }
    _logCiteprocMethodError(methodName, error) {
      try {
        const msg = `[IndigoBook CSL-M] renderProbe citeproc error(${methodName}): ${String(error)} stack=${String(error?.stack || "")}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _instrumentParallelTracker(citeproc) {
      try {
        const startCitation = citeproc?.parallel?.StartCitation;
        if (typeof startCitation !== "function") return;
        if (citeproc.parallel.__indigoStartCitationInstrumented) return;
        citeproc.parallel.__indigoStartCitationInstrumented = true;
        const self = this;
        citeproc.parallel.StartCitation = function(...args) {
          try {
            self._logParallelStartCitation(args?.[0], this?.state);
          } catch (e) {
          }
          return startCitation.apply(this, args);
        };
      } catch (e) {
      }
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
          "container-title": cslItem?.["container-title"] ?? null,
          "container-title-short": cslItem?.["container-title-short"] ?? null,
          "title-short": cslItem?.["title-short"] ?? null,
          seeAlso: Array.isArray(cslItem?.seeAlso) ? cslItem.seeAlso : []
        };
        const msg = `[IndigoBook CSL-M] citation itemData[${this._citationDataLogCount}] ${stage}: ${JSON.stringify(payload)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
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
          "near-note": citationItem?.["near-note"] ?? citationItem?.nearNote ?? null,
          prefix: citationItem?.prefix ?? null,
          suffix: citationItem?.suffix ?? null
        }));
        const msg = `[IndigoBook CSL-M] citation request(${methodName}): items=${JSON.stringify(payload)} arg-shape=${String(args?.length || 0)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
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
            seeAlso: Array.isArray(entry?.[0]?.seeAlso) ? entry[0].seeAlso : []
          },
          citationItem: {
            id: entry?.[1]?.id ?? entry?.[1]?.itemID ?? entry?.[1]?.itemId ?? null,
            locator: entry?.[1]?.locator ?? null,
            position: entry?.[1]?.position ?? null,
            parallel: entry?.[1]?.parallel ?? null
          }
        }));
        const suppressRepeats = Array.isArray(state?.tmp?.suppress_repeats) ? state.tmp.suppress_repeats : [];
        const msg = `[IndigoBook CSL-M] parallel StartCitation: sortedItems=${JSON.stringify(payload)} suppressRepeats=${JSON.stringify(suppressRepeats)}`;
        Zotero.debug(msg);
        Zotero.logError(msg);
      } catch (e) {
      }
    }
    _summarizeParallelValue(value) {
      if (value == null) return null;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
      }
      if (Array.isArray(value)) {
        return value.map((entry) => this._summarizeParallelValue(entry));
      }
      if (typeof value === "object") {
        const out = {};
        for (const key of ["literal", "family", "given", "name", "year"]) {
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
          if (typeof Zotero?.File?.getContents === "function") {
            return Zotero.File.getContents(styleObj.file);
          }
          this._warnNoSyncStyleRead("Zotero.File.getContents is unavailable");
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
      } catch (e) {
      }
    }
    _hasEmptyCitationLayout(xml) {
      if (!xml) return false;
      return /<citation>\s*<layout>\s*<\/layout>\s*<\/citation>/i.test(xml);
    }
    _looksLikeJurisStyle(xml) {
      if (!xml) return false;
      return /<macro\s+name="juris-[^"]+"/i.test(xml) || /class="legal"/i.test(xml) || /jurisdiction-preference=/i.test(xml);
    }
    _tempSetXML(styleObj, xml) {
      const prev = { _xml: styleObj._xml, _style: styleObj._style };
      if ("_xml" in styleObj) styleObj._xml = xml;
      if ("_style" in styleObj) styleObj._style = xml;
      return () => {
        if ("_xml" in styleObj) styleObj._xml = prev._xml;
        if ("_style" in styleObj) styleObj._style = prev._style;
      };
    }
  };

  // lib/services/prefsUI.mjs
  var PrefsUI = class {
    constructor({ pluginID, rootURI }) {
      this.pluginID = pluginID;
      this.rootURI = rootURI;
      this._paneID = null;
      this._registerTimer = null;
      this._registerAttempts = 0;
      this._maxRegisterAttempts = 20;
    }
    async register() {
      this._registerAttempts = 0;
      await this._tryRegister();
    }
    async _tryRegister() {
      try {
        if (this._paneID) return;
        if (!Zotero?.PreferencePanes?.register) {
          this._scheduleRetry("PreferencePanes service not ready");
          return;
        }
        const spec = this.rootURI?.spec || String(this.rootURI || "");
        const base = spec.endsWith("/") ? spec : `${spec}/`;
        const pane = await Zotero.PreferencePanes.register({
          pluginID: this.pluginID,
          src: `${base}content/prefs-abbrev.xhtml`,
          scripts: [`${base}content/prefs-abbrev.js`],
          stylesheets: [`${base}content/prefs-abbrev.css`],
          label: "Phoenix",
          image: `${base}content/ui/icon48.svg`
        });
        this._paneID = pane?.id || pane || null;
        try {
          Zotero.debug(`[IndigoBook CSL-M] prefs pane registered: paneID=${String(this._paneID)}`);
        } catch (_) {
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
        try {
          Zotero.debug(`[IndigoBook CSL-M] prefs pane register failed: ${String(e)}`);
        } catch (_) {
        }
        this._scheduleRetry(String(e));
      }
    }
    _scheduleRetry(reason) {
      if (this._registerAttempts >= this._maxRegisterAttempts) {
        try {
          Zotero.debug(`[IndigoBook CSL-M] prefs pane registration gave up after ${this._registerAttempts} attempts: ${reason}`);
        } catch (_) {
        }
        return;
      }
      this._registerAttempts += 1;
      if (this._registerTimer) clearTimeout(this._registerTimer);
      this._registerTimer = setTimeout(async () => {
        this._registerTimer = null;
        try {
          await this._tryRegister();
        } catch (e) {
          try {
            Zotero.logError(e);
          } catch (_) {
          }
        }
      }, 1e3);
    }
    unregister() {
      try {
        if (this._registerTimer) {
          clearTimeout(this._registerTimer);
          this._registerTimer = null;
        }
        if (!this._paneID) return;
        if (Zotero?.PreferencePanes?.unregister) {
          try {
            Zotero.debug(`[IndigoBook CSL-M] prefs pane unregistering: paneID=${String(this._paneID)}`);
          } catch (_) {
          }
          Zotero.PreferencePanes.unregister(this._paneID);
          try {
            Zotero.debug(`[IndigoBook CSL-M] prefs pane unregistered: paneID=${String(this._paneID)}`);
          } catch (_) {
          }
        }
      } catch (e) {
        try {
          Zotero.logError(e);
        } catch (_) {
        }
      } finally {
        this._paneID = null;
      }
    }
  };

  // lib/services/caseCourtMapper.mjs
  var CaseCourtMapper = class {
    constructor({ dataStore }) {
      this.dataStore = dataStore;
      this._config = null;
    }
    async preload() {
      this._config = await this.dataStore.loadJSONAny([
        "juris-maps/case-jurisdiction-map.json",
        "data/case-jurisdiction-map.json"
      ]);
    }
    mapCaseCourt(rawCourt) {
      const source = String(rawCourt || "").trim();
      if (!source) return { courtKey: "", jurisdiction: "" };
      const courtLine = source.replace(/\s+/g, " ").replace(/\.$/, "").trim();
      const courtKey = this._mapCourtKey(courtLine);
      const jurisdiction = this._mapJurisdiction(courtLine);
      return { courtKey, jurisdiction };
    }
    _mapCourtKey(courtLine) {
      const haystack = this._normalizeForPattern(courtLine || "");
      const aliases = Array.isArray(this._config?.courtKeyAliases) ? this._config.courtKeyAliases : [];
      for (const alias of aliases) {
        const needle = this._normalizeForPattern(alias?.pattern || "");
        const value = String(alias?.value || "").trim();
        if (!needle || !value) continue;
        if (haystack.includes(needle)) return value;
      }
      const rules = Array.isArray(this._config?.courtKeyRules) ? this._config.courtKeyRules : [];
      for (const rule of rules) {
        const needle = this._normalizeForPattern(rule?.pattern || "");
        const value = String(rule?.value || "").trim();
        if (!needle || !value) continue;
        if (haystack.includes(needle)) return value;
      }
      return "";
    }
    _mapJurisdiction(courtLine) {
      const normalized = String(courtLine || "").replace(/,\s*[a-zA-Z]+\s*Division\.?$/i, "").trim();
      const exactUSSupreme = /^Supreme Court of the United States$/i;
      if (exactUSSupreme.test(normalized)) return "us";
      const circuitMatch = normalized.match(/^United States Court of Appeals,\s+(.+?)\s+Circuit$/i);
      if (circuitMatch) {
        const circuitName = String(circuitMatch[1] || "").trim().toLowerCase();
        const ordinalMap = {
          federal: "federal",
          "district of columbia": "0",
          "d.c.": "0",
          first: "1",
          second: "2",
          third: "3",
          fourth: "4",
          fifth: "5",
          sixth: "6",
          seventh: "7",
          eighth: "8",
          ninth: "9",
          tenth: "10",
          eleventh: "11"
        };
        const token = ordinalMap[circuitName];
        if (token === "federal") return "us:c";
        return token ? `us:c${token}` : "";
      }
      if (/\b(fed|federal)\.?\s+cir(cuit)?\.?\b/i.test(normalized)) {
        return "us:c";
      }
      const numberedCircuit = normalized.match(/\b(1|2|3|4|5|6|7|8|9|10|11)(st|nd|rd|th)?\s+cir(cuit)?\.?\b/i);
      if (numberedCircuit) {
        return `us:c${String(numberedCircuit[1])}`;
      }
      const dcCircuit = /\b(d\.c\.|district of columbia)\s+cir(cuit)?\.?\b/i;
      if (dcCircuit.test(normalized)) {
        return "us:c0";
      }
      const districtMatch = normalized.match(/^United States District Court,\s+(.+)$/i);
      if (districtMatch) {
        return this._mapFederalDistrict(String(districtMatch[1] || "").trim());
      }
      return this._mapStateOrTerritoryJurisdiction(normalized);
    }
    _mapFederalDistrict(rawDistrictText) {
      const districtText = String(rawDistrictText || "").trim();
      if (!districtText) return "";
      let partMatch = districtText.match(/^(N|S|E|W|M|C)\.D\.\s+(.+)$/i);
      let districtToken = "";
      let stateName = "";
      if (partMatch) {
        const part = String(partMatch[1] || "").toUpperCase();
        districtToken = `${part.toLowerCase()}d`;
        stateName = String(partMatch[2] || "").trim();
      } else {
        partMatch = districtText.match(/^D\.\s+(.+)$/i);
        if (!partMatch) return "";
        districtToken = "d";
        stateName = String(partMatch[1] || "").trim();
      }
      const state = this._lookupStateInfo(stateName);
      if (!state?.code) return "";
      if (state.code === "dc") {
        return "us:dc.d";
      }
      if (!state.circuit) {
        return `us:${state.code}.${districtToken}`;
      }
      return `us:c${state.circuit}:${state.code}.${districtToken}`;
    }
    _mapStateOrTerritoryJurisdiction(courtLine) {
      const states = this._config?.states;
      if (!states || typeof states !== "object") return "";
      for (const [name, info] of Object.entries(states)) {
        const pattern = new RegExp(`(?:^|\\s|,)${this._escapeRegex(name)}(?:$|\\s|[.,])`, "i");
        if (!pattern.test(courtLine)) continue;
        const code = String(info?.code || "").trim().toLowerCase();
        if (!code) continue;
        return `us:${code}`;
      }
      return "";
    }
    _lookupStateInfo(rawName) {
      const states = this._config?.states;
      if (!states || typeof states !== "object") return null;
      const name = String(rawName || "").trim().replace(/\.$/, "");
      if (!name) return null;
      if (states[name]) return states[name];
      const synonyms = {
        "D.C.": "District of Columbia",
        DC: "District of Columbia",
        "Virgin Islands": "U.S. Virgin Islands"
      };
      const canonical = synonyms[name] || name;
      return states[canonical] || null;
    }
    _escapeRegex(value) {
      return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    _normalizeForPattern(value) {
      return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    }
  };

  // lib/main.mjs
  var _ctx;
  var LEGACY_COMMENTER_INFO_ROW_ID = "indigobook-cslm-commenter-row";
  var BUNDLED_STYLE_FILES = [
    "jm-indigobook.csl",
    "jm-indigobook-law-review.csl"
  ];
  var BUNDLED_TRANSLATOR_FILES = [
    "Lexis+.js",
    "Westlaw.js"
  ];
  function _extractStyleID(styleXML) {
    if (!styleXML) return "";
    const match = styleXML.match(/<id>\s*([^<]+?)\s*<\/id>/i);
    return match ? String(match[1]).trim() : "";
  }
  function _styleInstallSourceURL(rootURI, relPath) {
    const base = rootURI?.spec || "";
    return base ? `${base}${relPath}` : relPath;
  }
  function _diagnostic(message) {
    try {
      Zotero.debug(message);
    } catch (e) {
    }
    try {
      Zotero.logError(message);
    } catch (e) {
    }
  }
  function _unregisterLegacyCommenterInfoRow() {
    try {
      Zotero?.ItemPaneManager?.unregisterInfoRow?.(LEGACY_COMMENTER_INFO_ROW_ID);
    } catch (e) {
    }
  }
  async function _installStyleIfMissing({ rootURI, dataStore, relPath }) {
    const styleXML = await dataStore.loadText(relPath);
    const styleID = _extractStyleID(styleXML);
    if (!styleID) {
      try {
        Zotero.debug(`[IndigoBook CSL-M] style install skipped (missing id): ${relPath}`);
      } catch (e) {
      }
      return;
    }
    if (Zotero?.Styles?.get?.(styleID)) {
      try {
        Zotero.debug(`[IndigoBook CSL-M] style already installed: ${styleID}`);
      } catch (e) {
      }
      return;
    }
    const installFn = Zotero?.Styles?.install;
    if (typeof installFn !== "function") {
      try {
        Zotero.debug(`[IndigoBook CSL-M] style install unavailable (no Zotero.Styles.install): ${styleID}`);
      } catch (e) {
      }
      return;
    }
    const sourceURL = _styleInstallSourceURL(rootURI, relPath);
    let installed = false;
    try {
      await installFn.call(Zotero.Styles, styleXML, sourceURL);
      installed = !!Zotero?.Styles?.get?.(styleID);
    } catch (e) {
    }
    try {
      Zotero.debug(`[IndigoBook CSL-M] style ${installed ? "installed" : "install failed"}: ${styleID}`);
    } catch (e) {
    }
  }
  async function _ensureBundledStylesInstalled({ rootURI, dataStore }) {
    for (const file of BUNDLED_STYLE_FILES) {
      const relPath = `styles/${file}`;
      try {
        await _installStyleIfMissing({ rootURI, dataStore, relPath });
      } catch (e) {
        try {
          Zotero.debug(`[IndigoBook CSL-M] style install error (${relPath}): ${String(e)}`);
        } catch (_) {
        }
      }
    }
  }
  function _extractTranslatorMetadata(code) {
    const match = code.match(/^\s*(\{[\s\S]*?\})\s*(?=\n[^}]|\nfunction|\nvar |\nconst |\nlet |\/\*)/m);
    if (!match) return null;
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      return null;
    }
  }
  async function _installTranslatorIfMissing({ dataStore, relPath }) {
    const code = await dataStore.loadText(relPath);
    const metadata = _extractTranslatorMetadata(code);
    if (!metadata?.translatorID) {
      try {
        Zotero.debug(`[IndigoBook CSL-M] translator install skipped (missing translatorID): ${relPath}`);
      } catch (e) {
      }
      return;
    }
    const saveFn = Zotero?.Translators?.save;
    if (typeof saveFn !== "function") {
      try {
        Zotero.debug(`[IndigoBook CSL-M] translator install unavailable (no Zotero.Translators.save): ${metadata.label}`);
      } catch (e) {
      }
      return;
    }
    let installed = false;
    try {
      await saveFn.call(Zotero.Translators, metadata, code);
      installed = !!Zotero?.Translators?.get?.(metadata.translatorID);
    } catch (e) {
    }
    try {
      Zotero.debug(`[IndigoBook CSL-M] translator ${installed ? "installed" : "install failed"}: ${metadata.label}`);
    } catch (e) {
    }
  }
  async function _ensureBundledTranslatorsInstalled({ dataStore }) {
    for (const file of BUNDLED_TRANSLATOR_FILES) {
      const relPath = `translators/${file}`;
      try {
        await _installTranslatorIfMissing({ dataStore, relPath });
      } catch (e) {
        try {
          Zotero.debug(`[IndigoBook CSL-M] translator install error (${relPath}): ${String(e)}`);
        } catch (_) {
        }
      }
    }
  }
  async function activate({ id, version, rootURI }) {
    _diagnostic(`[IndigoBook CSL-M] activate begin id=${String(id)} version=${String(version)}`);
    const locale = Zotero?.locale || "en-US";
    _ctx = {
      id,
      version,
      rootURI,
      data: new DataStore(rootURI),
      modules: null,
      abbrevs: null,
      caseCourtMapper: null,
      patcher: null,
      prefsUI: null
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
    _ctx.patcher = new Patcher({
      moduleLoader: _ctx.modules,
      abbrevService: _ctx.abbrevs,
      jurisdiction: Jurisdiction,
      caseCourtMapper: _ctx.caseCourtMapper
    });
    _ctx.patcher.patch();
    _ctx.prefsUI = new PrefsUI({
      pluginID: id,
      rootURI
    });
    await _ctx.prefsUI.register();
    _unregisterLegacyCommenterInfoRow();
    try {
      delete Zotero.IndigoBookCSLMCommenterRowID;
    } catch (e) {
    }
    Zotero.IndigoBookCSLMBridge = {
      listPrimaryDatasetOptions() {
        return _ctx?.abbrevs?.listPrimaryDatasetOptions?.() || [];
      },
      listSecondaryDatasetOptions() {
        return _ctx?.abbrevs?.listSecondaryDatasetOptions?.() || [];
      },
      listJurisdictionDatasetOptions() {
        return _ctx?.abbrevs?.listJurisdictionDatasetOptions?.() || [];
      },
      listPrimaryAbbreviations(dataset = "primary-us") {
        return _ctx?.abbrevs?.listPrimaryAbbreviations?.(dataset) || [];
      },
      listSecondaryAbbreviations(dataset = "secondary-us-bluebook") {
        return _ctx?.abbrevs?.listSecondaryContainerTitleAbbreviations?.(dataset) || [];
      },
      upsertSecondaryAbbreviation(datasetOrKey, keyOrValue, maybeValue) {
        const hasDataset = typeof maybeValue !== "undefined";
        const dataset = hasDataset ? datasetOrKey : "secondary-us-bluebook";
        const key = hasDataset ? keyOrValue : datasetOrKey;
        const value = hasDataset ? maybeValue : keyOrValue;
        return !!_ctx?.abbrevs?.upsertSecondaryContainerTitleAbbreviation?.(dataset, key, value);
      },
      removeSecondaryAbbreviation(datasetOrKey, maybeKey) {
        const hasDataset = typeof maybeKey !== "undefined";
        const dataset = hasDataset ? datasetOrKey : "secondary-us-bluebook";
        const key = hasDataset ? maybeKey : datasetOrKey;
        return !!_ctx?.abbrevs?.removeSecondaryContainerTitleAbbreviation?.(dataset, key);
      },
      resetSecondaryAbbreviations(dataset = "secondary-us-bluebook") {
        _ctx?.abbrevs?.resetSecondaryContainerTitleOverrides?.(dataset);
        return true;
      },
      upsertPrimaryAbbreviation(dataset, jurisdiction, category, key, value) {
        return !!_ctx?.abbrevs?.upsertPrimaryAbbreviation?.(dataset, jurisdiction, category, key, value);
      },
      removePrimaryAbbreviation(dataset, jurisdiction, category, key) {
        return !!_ctx?.abbrevs?.removePrimaryAbbreviation?.(dataset, jurisdiction, category, key);
      },
      resetPrimaryAbbreviations(dataset = "primary-us") {
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
          error: "Import bridge unavailable.",
          skipReasons: []
        };
      }
    };
    _diagnostic(`[IndigoBook CSL-M] activated v${version}`);
  }
  async function deactivate() {
    try {
      _diagnostic("[IndigoBook CSL-M] deactivate begin");
      try {
        delete Zotero.IndigoBookCSLMBridge;
      } catch (e) {
      }
      _unregisterLegacyCommenterInfoRow();
      try {
        delete Zotero.IndigoBookCSLMCommenterRowID;
      } catch (e) {
      }
      _ctx?.prefsUI?.unregister?.();
      _ctx?.patcher?.unpatch();
    } finally {
      _diagnostic("[IndigoBook CSL-M] deactivate complete");
      _ctx = null;
    }
  }
  return __toCommonJS(main_exports);
})();
