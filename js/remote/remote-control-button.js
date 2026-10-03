// Effect Pipeline toolbar icon for the LAN remote control (Electron only).
// Shows off / listening / N devices connected and opens the Remote Control window.

export function describeRemoteState(status) {
    const s = status && typeof status === 'object' ? status : {};
    const clients = Number.isFinite(s.clients) ? Math.max(0, Math.floor(s.clients)) : 0;
    if (s.error && !s.enabled) {
        return { state: 'error', clients: 0, title: `Remote Control: ${s.error}` };
    }
    if (!s.enabled) {
        return { state: 'off', clients: 0, title: 'Remote Control' };
    }
    const port = s.port ? ` (port ${s.port})` : '';
    if (clients > 0) {
        const noun = clients === 1 ? 'device' : 'devices';
        return { state: 'connected', clients, title: `Remote Control: ${clients} ${noun} connected${port}` };
    }
    return { state: 'listening', clients: 0, title: `Remote Control: listening${port}` };
}

export function initRemoteControlButton(api, doc = document) {
    const button = doc.getElementById('remoteControlButton');
    const badge = doc.getElementById('remoteControlBadge');
    if (!api || !button || typeof api.openPanel !== 'function') return null;

    const render = status => {
        const view = describeRemoteState(status);
        button.dataset.state = view.state;
        button.title = view.title;
        button.setAttribute('aria-label', view.title);
        if (badge) {
            badge.hidden = view.clients < 1;
            badge.textContent = view.clients > 99 ? '99+' : String(view.clients);
        }
    };

    const onClick = () => { api.openPanel().catch(() => {}); };
    button.addEventListener('click', onClick);
    button.hidden = false;
    render(null);
    const dispose = api.onStatus?.(render) || null;
    api.getStatus?.().then(render).catch(() => {});
    return () => {
        button.removeEventListener('click', onClick);
        dispose?.();
    };
}
