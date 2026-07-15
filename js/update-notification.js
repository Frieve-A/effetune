function translate(windowRef, key, fallback, params = {}) {
    const translated = windowRef.uiManager?.t?.(key, params);
    return translated && translated !== key ? translated : fallback;
}

export function createUpdateNotification(updateInfo, {
    documentRef = document,
    windowRef = window
} = {}) {
    const container = documentRef.createElement('div');
    container.className = 'update-notification';
    container.setAttribute?.('role', 'status');

    const releaseButton = documentRef.createElement('button');
    releaseButton.type = 'button';
    releaseButton.className = 'update-release-link';
    releaseButton.textContent = translate(
        windowRef,
        'ui.newVersionAvailable',
        `New ${updateInfo.version} available.`,
        { version: updateInfo.version }
    );
    releaseButton.addEventListener('click', () => {
        if (windowRef.electronAPI?.openExternal) windowRef.electronAPI.openExternal(updateInfo.url);
        else windowRef.open(updateInfo.url, '_blank', 'noopener');
    });
    container.appendChild(releaseButton);
    return container;
}
