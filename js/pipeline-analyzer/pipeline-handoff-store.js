// One-shot hand-off of the live pipeline's processing snapshot from the main app to the
// measurement page. It lives in its own database, holds a single entry, and is consumed
// once by the measurement page.

const DATABASE_NAME = 'effetune_pipeline_handoff';
const DATABASE_VERSION = 1;
const STORE_NAME = 'handoff';
const ENTRY_ID = 'current';

function openDatabase(indexedDB) {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB?.open !== 'function') {
            reject(new Error('IndexedDB is unavailable'));
            return;
        }
        const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Pipeline hand-off store could not be opened'));
        request.onblocked = () => reject(new Error('Pipeline hand-off store open was blocked'));
    });
}

// Runs the requests issued by `operate` in one transaction and resolves with the result of
// the request it returns once the transaction has committed.
async function runTransaction(indexedDB, operate) {
    const database = await openDatabase(indexedDB);
    try {
        return await new Promise((resolve, reject) => {
            const transaction = database.transaction([STORE_NAME], 'readwrite');
            let result;
            transaction.oncomplete = () => resolve(result);
            transaction.onabort = () => reject(transaction.error || new Error('Pipeline hand-off store transaction failed'));
            transaction.onerror = transaction.onabort;
            const request = operate(transaction.objectStore(STORE_NAME));
            request.onsuccess = () => {
                result = request.result;
            };
        });
    } finally {
        database.close();
    }
}

export async function putPipelineHandoff({ snapshot, pluginNames }, { indexedDB = globalThis.indexedDB } = {}) {
    await runTransaction(indexedDB, store => store.put({ id: ENTRY_ID, snapshot, pluginNames }));
}

// Reads and deletes the entry atomically; resolves with null when there is none.
export async function takePipelineHandoffOnce({ indexedDB = globalThis.indexedDB } = {}) {
    const entry = await runTransaction(indexedDB, store => {
        const request = store.get(ENTRY_ID);
        store.delete(ENTRY_ID);
        return request;
    });
    return entry ? { snapshot: entry.snapshot, pluginNames: entry.pluginNames } : null;
}

export async function clearPipelineHandoff({ indexedDB = globalThis.indexedDB } = {}) {
    await runTransaction(indexedDB, store => store.delete(ENTRY_ID));
}
