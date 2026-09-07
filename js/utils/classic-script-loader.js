const pendingLoads = new Map();
const stylesheetLoads = new Map();
const pendingStylesheets = new Set();

function trackStylesheet(link) {
    if (link.sheet) return;
    const ready = new Promise(resolve => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
    });
    pendingStylesheets.add(ready);
    void ready.then(() => pendingStylesheets.delete(ready));
}

export function waitForStylesheets() {
    return Promise.all(pendingStylesheets);
}

function getDefaultDocument() {
    return typeof document !== 'undefined' ? document : null;
}

function getDefaultGlobal() {
    return typeof window !== 'undefined' ? window : globalThis;
}

export function loadClassicScript(source, {
    documentRef = getDefaultDocument(),
    globalRef = getDefaultGlobal(),
    globalName = null
} = {}) {
    if (globalName && globalRef?.[globalName]) return Promise.resolve(globalRef[globalName]);
    if (pendingLoads.has(source)) return pendingLoads.get(source);
    if (!documentRef?.createElement || !documentRef?.head?.appendChild) {
        return Promise.reject(new Error(`Cannot load ${source} without a document`));
    }

    const load = new Promise((resolve, reject) => {
        const script = documentRef.createElement('script');
        script.src = source;
        script.async = true;
        script.addEventListener('load', () => resolve(
            globalName ? globalRef?.[globalName] : script
        ), { once: true });
        script.addEventListener('error', () => reject(
            new Error(`Failed to load ${source}`)
        ), { once: true });
        documentRef.head.appendChild(script);
    }).catch(error => {
        pendingLoads.delete(source);
        throw error;
    });
    pendingLoads.set(source, load);
    return load;
}

export function loadStylesheet(source, {
    documentRef = getDefaultDocument()
} = {}) {
    if (stylesheetLoads.has(source)) return stylesheetLoads.get(source);
    if (!documentRef?.createElement || !documentRef?.head?.appendChild) return null;

    // The document may already declare the stylesheet (startup view markup adds the
    // Music Library sheet before any module runs); adopt it instead of duplicating.
    const existing = documentRef.querySelector?.(`link[rel="stylesheet"][href="${source}"]`);
    if (existing) {
        trackStylesheet(existing);
        stylesheetLoads.set(source, existing);
        return existing;
    }

    const link = documentRef.createElement('link');
    link.rel = 'stylesheet';
    link.href = source;
    trackStylesheet(link);
    link.addEventListener?.('error', () => {
        if (stylesheetLoads.get(source) === link) stylesheetLoads.delete(source);
        link.remove?.();
    }, { once: true });
    stylesheetLoads.set(source, link);
    documentRef.head.appendChild(link);
    return link;
}
