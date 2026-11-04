// Named desktop settings live outside Chromium's process-exclusive storage.
// Resources keep using their existing shared stores.
export function getSettingsStorage(windowRef = globalThis.window) {
    return windowRef?.electronAPI?.settingsStorage || windowRef?.localStorage || globalThis.localStorage;
}
