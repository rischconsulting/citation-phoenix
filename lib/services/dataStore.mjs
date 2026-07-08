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

    // Zotero.HTTP.request handles https:, jar:, resource:, and file: URIs.
    // Zotero.File.getContentsAsync(uri) is deprecated in Zotero 8.
    const req = await Zotero.HTTP.request('GET', url);
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
