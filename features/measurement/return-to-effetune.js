import { isAndroidHost } from '../../js/android/bridge.js';

const TAB_KEY = 'effetune_feature_return_tab';
export const TRANSIENT_PIPELINE_STATE_STORAGE_KEY = 'effetune_transient_pipeline_state';

export function featureReturnTab(win = window) {
    try {
        return win.sessionStorage?.getItem(TAB_KEY);
    } catch {
        return null;
    }
}

export function saveFeatureReturnTab(tab) {
    try {
        if (tab) window.sessionStorage?.setItem(TAB_KEY, tab);
        else window.sessionStorage?.removeItem(TAB_KEY);
    } catch {
        // Page navigation is still available when session storage is disabled.
    }
}

export async function returnToEffeTune(mainPath) {
    if (window.electronAPI) {
        const result = await window.electronAPI.navigateToMain();
        if (!result?.success) console.error('Failed to return to EffeTune:', result?.error);
        return;
    }
    const main = new URL(mainPath, window.location.href);
    const android = isAndroidHost();
    if (android) {
        const navigation = window.navigation;
        const previous = navigation?.currentEntry
            ? navigation.entries()[navigation.currentEntry.index - 1]?.url
            : document.referrer;
        if (previous && window.history.length > 1) {
            const source = new URL(previous);
            if (source.origin === main.origin && source.pathname === main.pathname) {
                window.history.back();
                return;
            }
        }
    }
    if (!featureReturnTab()) saveFeatureReturnTab('effects');
    try {
        if (window.sessionStorage?.getItem(TRANSIENT_PIPELINE_STATE_STORAGE_KEY)) {
            main.searchParams.set('restorePipeline', 'transient');
        }
    } catch {
        // A direct visit can return without a saved pipeline.
    }
    if (android) window.location.replace(main.href);
    else window.location.href = main.href;
}
