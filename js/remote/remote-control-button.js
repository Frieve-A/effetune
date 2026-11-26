// Effect Pipeline toolbar icon for the LAN remote control (Electron only).
// Shows off / listening / N devices connected and opens the Remote Control dialog.

export function describeRemoteState(status, translate) {
    const t = (key, fallback, params) => {
        const translated = translate?.(key, params);
        return translated && translated !== key ? translated : fallback;
    };
    const s = status && typeof status === 'object' ? status : {};
    const clients = Number.isFinite(s.clients) ? Math.max(0, Math.floor(s.clients)) : 0;
    if (s.error && !s.enabled) {
        return { state: 'error', clients: 0, title: t('ui.remoteControlButton.unavailable', 'Remote Control: unavailable') };
    }
    if (!s.enabled) {
        return { state: 'off', clients: 0, title: t('dialog.remoteControl.title', 'Remote Control') };
    }
    const port = s.port;
    if (clients > 0) {
        const title = clients === 1
            ? port
                ? t('ui.remoteControlButton.connectedOneWithPort', `Remote Control: 1 device connected (port ${port})`, { port })
                : t('ui.remoteControlButton.connectedOne', 'Remote Control: 1 device connected')
            : port
                ? t('ui.remoteControlButton.connectedManyWithPort', `Remote Control: ${clients} devices connected (port ${port})`, { count: clients, port })
                : t('ui.remoteControlButton.connectedMany', `Remote Control: ${clients} devices connected`, { count: clients });
        return { state: 'connected', clients, title };
    }
    const title = port
        ? t('ui.remoteControlButton.listeningWithPort', `Remote Control: listening (port ${port})`, { port })
        : t('ui.remoteControlButton.listening', 'Remote Control: listening');
    return { state: 'listening', clients: 0, title };
}

export function initRemoteControlButton(api, doc = document) {
    const button = doc.getElementById('remoteControlButton');
    const badge = doc.getElementById('remoteControlBadge');
    if (!api || !button || typeof api.openPanel !== 'function') return null;

    let status = null;
    const render = () => {
        const view = describeRemoteState(status, (key, params) => doc.defaultView?.uiManager?.t(key, params));
        button.dataset.state = view.state;
        button.title = view.title;
        button.setAttribute('aria-label', view.title);
        if (badge) {
            badge.hidden = view.clients < 1;
            badge.textContent = view.clients > 99 ? '99+' : String(view.clients);
        }
    };
    const updateStatus = next => {
        status = next;
        render();
    };

    const onClick = () => { api.openPanel().catch(() => {}); };
    button.addEventListener('click', onClick);
    button.addEventListener('remote-control-update-texts', render);
    button.hidden = false;
    render();
    const dispose = api.onStatus?.(updateStatus) || null;
    api.getStatus?.().then(updateStatus).catch(() => {});
    return () => {
        button.removeEventListener('click', onClick);
        button.removeEventListener('remote-control-update-texts', render);
        dispose?.();
    };
}
