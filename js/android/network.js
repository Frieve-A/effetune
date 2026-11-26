import { isAndroidHost, getAndroidBridge } from './bridge.js';

// The Android host rejects network operations with these codes when the local network permission is not granted.
export function isLocalNetworkPermissionError(error, windowRef = globalThis.window) {
    return isAndroidHost(windowRef) && ['permission-denied', 'permission-required'].includes(error?.code);
}

export function ensureAndroidNetworkAccess({ request = false, windowRef = globalThis.window } = {}) {
    if (!isAndroidHost(windowRef)) return;
    return getAndroidBridge().request('network.ensurePermission', { request });
}
