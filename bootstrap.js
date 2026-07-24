// Services is available as a global in the Zotero extension bootstrap context.

function logError(prefix, e) {
  try { Zotero.logError(e); } catch (_) {}
  try { Zotero.debug(prefix + ": " + e); } catch (_) {}
}

function logDiagnostic(message) {
  try { Zotero.debug(message); } catch (_) {}
  try { Zotero.logError(message); } catch (_) {}
}

async function startup({ id, version, rootURI }, reason) {
  try {
    logDiagnostic(`[Citation Phoenix] bootstrap startup begin id=${String(id)} version=${String(version)} reason=${String(reason)}`);
    // 1) Normalize rootURI into a string base
    var base = (rootURI && typeof rootURI === "object" && rootURI.spec)
      ? rootURI.spec
      : String(rootURI);

    // Ensure trailing slash
    if (base.slice(-1) !== "/") base += "/";

    // 2) Provide an object with .spec so your DataStore works unchanged
    var root = { spec: base };

    // 3) Load your bundled classic script
    var scope = { Zotero, rootURI: root };
    Services.scriptloader.loadSubScript(base + "content/citation-phoenix.js", scope);

    // 4) Grab the global produced by esbuild --global-name
    Zotero.CitationPhoenix = scope.CitationPhoenix;
    Zotero.IndigoBookCSLM = Zotero.CitationPhoenix;

    if (!Zotero.CitationPhoenix || typeof Zotero.CitationPhoenix.activate !== "function") {
      throw new Error("Bundle loaded but CitationPhoenix.activate not found");
    }

    // 5) Activate using the root object (with .spec)
    await Zotero.CitationPhoenix.activate({ id, version, rootURI: root });
    logDiagnostic(`[Citation Phoenix] bootstrap startup success id=${String(id)} version=${String(version)}`);
  } catch (e) {
    logError("Citation Phoenix plugin startup failed", e);
  }
}



async function shutdown({ id }, reason) {
  try {
    logDiagnostic(`[Citation Phoenix] bootstrap shutdown begin id=${String(id)} reason=${String(reason)}`);
    if (Zotero?.CitationPhoenix?.deactivate) {
      await Zotero.CitationPhoenix.deactivate();
    }
    logDiagnostic(`[Citation Phoenix] bootstrap shutdown success id=${String(id)}`);
  } catch (e) {
    logError("Citation Phoenix plugin shutdown failed", e);
  } finally {
    try { delete Zotero.CitationPhoenix; } catch (_) {}
    try { delete Zotero.IndigoBookCSLM; } catch (_) {}
  }
}



function install() {}
function uninstall() {}
