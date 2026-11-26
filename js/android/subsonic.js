import { ANDROID_ORIGIN, getAndroidBridge } from './bridge.js';
import { ensureAndroidNetworkAccess } from './network.js';
import { networkMusicError } from '../network-music/pwa-connection.js';

export class AndroidSubsonicTransport {
  constructor({ windowRef, fetchImpl }) {
    Object.assign(this, { windowRef, fetchImpl, bridge: getAndroidBridge() });
  }

  async command(action, payload = {}) {
    try {
      return await this.bridge.request(`subsonic.${action}`, payload);
    } catch (error) {
      if (['unreachable', 'subsonicAuthentication', 'unavailable'].includes(error.code)) {
        throw networkMusicError(error.code);
      }
      throw networkMusicError('unavailable');
    }
  }

  async configure(entry) {
    const { action, id, name, url, user, password } = entry;
    if (!['add', 'test', 'remove'].includes(action)) throw networkMusicError('unavailable');
    if (action !== 'remove') await ensureAndroidNetworkAccess({ request: true, windowRef: this.windowRef });
    if (action !== 'add') return this.command(action, { id });
    let endpoint;
    try { endpoint = new URL(url.trim()); } catch { throw networkMusicError('unreachable'); }
    return this.command('add', { name, url: endpoint.href, user, password });
  }

  url(source, method, params) {
    const url = new URL(`/subsonic/${method}`, ANDROID_ORIGIN);
    url.search = new URLSearchParams({ ...params, source });
    return url.href;
  }

  async request(source, method, params) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    timer.unref?.();
    try {
      await ensureAndroidNetworkAccess({ windowRef: this.windowRef });
      const response = await this.fetchImpl(this.url(source, method, params), { mode: 'same-origin', cache: 'no-store',
        credentials: 'omit', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw networkMusicError('unreachable');
      const result = (await response.json())?.['subsonic-response'];
      if (result?.status !== 'ok') {
        throw networkMusicError([40, 41].includes(Number(result?.error?.code)) ? 'subsonicAuthentication' : 'unreachable');
      }
      return result;
    } catch (error) {
      if (error.networkMusic) throw error;
      throw networkMusicError('unreachable');
    } finally { clearTimeout(timer); }
  }
}
