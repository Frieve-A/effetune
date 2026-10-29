import { isAndroidHost, getAndroidBridge } from './bridge.js';

export function ensureAndroidNetworkAccess({ request = false, windowRef = globalThis.window } = {}) {
    if (!isAndroidHost(windowRef)) return;
    return getAndroidBridge().request('network.ensurePermission', { request });
}
