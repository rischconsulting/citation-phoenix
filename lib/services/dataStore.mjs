export class DataStore {
  constructor(rootURI) {
    this.rootURI = rootURI;
    this.cache = new Map();
  }

  async init() {
    await Promise.all([
      this.loadJSON('style-modules/index.json').catch(() => null),
      this.loadJSON('juris-abbrevs/DIRECTORY_LISTING.json').catch(() => null),
      this.loadJSON('juris-maps/DIRECTORY_LISTING.json').catch(() => null),
      this.loadJSON('juris-maps/versions.json').catch(() => null),
      this.loadJSON('juris-maps/primary-jurisdictions.json').catch(() => null),
    ]);
  }

  async loadText(relPath) {
    if (this.cache.has(relPath)) return this.cache.get(relPath);

    const url = this.rootURI.spec + relPath;
    const text = await this._loadURLText(url);

    this.cache.set(relPath, text);
    return text;
  }

  async _loadURLText(url) {
    if (/^https?:/i.test(url)) {
      const req = await Zotero.HTTP.request('GET', url);
      return req.response;
    }

    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.open('GET', url, true);
      req.overrideMimeType?.('text/plain; charset=UTF-8');
      req.onloadend = () => {
        if (req.status === 0 || (req.status >= 200 && req.status < 300)) {
          resolve(req.responseText);
        } else {
          reject(new Error(`Failed to load ${url}: ${req.status}`));
        }
      };
      req.onerror = () => reject(new Error(`Failed to load ${url}`));
      req.send(null);
    });
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
        // Try the next path in the fallback chain.
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
        // Try the next path in the fallback chain.
      }
    }
    return null;
  }
}
