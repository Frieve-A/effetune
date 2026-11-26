import { closeStandardSelect } from '../ui/standard-select.js';
import { getThemePreset } from '../theme-registry.mjs';

function dismissTransientUi(win) {
    const doc = win.document;
    const dialogs = doc.querySelectorAll('dialog[open]');
    const modal = doc.activeElement?.closest('dialog[open]') ?? dialogs[dialogs.length - 1];
    const popovers = doc.querySelectorAll(':popover-open');
    const popover = Array.from(popovers).findLast(element => !modal || modal.contains(element));
    const select = doc.querySelector('.standard-select-list:not([hidden])');
    const topLayer = popover ?? modal;
    if (topLayer?.contains(select)) {
        closeStandardSelect(doc);
        return true;
    }
    if (popover) {
        popover.hidePopover();
        return true;
    }
    if (modal) {
        if (modal.dispatchEvent(new Event('cancel', { cancelable: true }))) modal.close();
        return true;
    }
    // Use the same close controls as a tap, including their cleanup and focus restoration.
    const controls = doc.querySelectorAll([
        '.config-dialog #close-btn', '.audio-config-dialog #cancel-button', '#remote-control-close',
        '.backup-restore-close', '.diagnostic-dialog .backup-restore-actions button:last-child',
        '.ir-library-header button', '.library-dialog-backdrop :is(.library-dialog-close, .library-prompt-cancel)',
        '.midi-mapping-close', '.routing-dialog-close', '.double-blind-test .dbt-close-button',
        '.mobile-number-keypad-overlay:not([hidden]) .mobile-number-keypad-cancel',
        '.standard-select-list:not([hidden])', '#pipelineMenu.show',
        '.mobile-overflow-menu.mobile-open', '#pluginList.mobile-open',
        '.player-speed-popup', '.player-library-context-menu'
    ].join(','));
    const ui = win.uiManager;
    const player = ui?.audioPlayer?.ui;
    let front, frontZ = -Infinity;
    // Backdrops are siblings in the app layer. An open select inside a backdrop
    // shares its stacking level and follows the backdrop's close button in DOM order.
    for (const control of controls) {
        if (control.closest('[inert]') || !control.getClientRects().length) continue;
        const layer = control.closest('.modal-overlay, .library-dialog-backdrop, .backup-restore-overlay, ' +
            '.mobile-number-keypad-overlay, .routing-dialog, .preset-dialog') ?? control;
        const z = Number(win.getComputedStyle(layer).zIndex) || 0;
        if (z < frontZ) continue;
        front = control;
        frontZ = z;
    }
    if (front && front === select) closeStandardSelect(doc);
    else if (front?.id === 'pipelineMenu') ui.hidePipelineMenu();
    else if (front?.id === 'pluginList') ui.mobileNav.closePluginList();
    else if (front && front === ui?.mobileMenu?.panel) ui.mobileMenu.close();
    else if (front && front === player?.playerPopup) player.closePlayerPopup();
    else if (front) front.click();
    else if (player?.videoExpanded) {
        player.setVideoExpanded(false);
        player.videoExpandButton?.focus();
    } else if (ui?.visualizerView?.expanded) ui.visualizerView.setExpanded(false);
    else return win.app?.uiManager?.handleMeasurementBack?.() ?? false;
    return true;
}

export function installAndroidWindowUi(win, bridge) {
    win.effetuneHandleBack = () => dismissTransientUi(win);
    const { body, documentElement } = win.document;
    let lastExpanded, lastLight;
    const publish = expanded => {
        const light = getThemePreset(documentElement.dataset.theme).colorScheme === 'light';
        if (lastExpanded === expanded && lastLight === light) return;
        lastExpanded = expanded;
        lastLight = light;
        void bridge.request('window.systemBars', { expanded, light })
            .catch(error => console.warn('Unable to update Android system bars:', error));
    };
    const sync = () => publish(body.classList.contains('visualizer-expanded'));
    const observer = new win.MutationObserver(sync);
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    observer.observe(documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    win.addEventListener('pagehide', () => {
        publish(false);
        lastLight = undefined; // Another page can change the host appearance before pageshow.
    });
    win.addEventListener('pageshow', sync);
    sync();
}
