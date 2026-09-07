import { CONTROL_COMMANDS, isInternalSender } from './protocol.js';

let creatingOffscreen;
let controlQueue = Promise.resolve();

export async function ensureOffscreen() {
    if (!chrome.offscreen?.createDocument || !chrome.runtime.getContexts || !chrome.tabCapture?.getMediaStreamId) {
        throw new Error('This browser cannot capture tab audio. Update Chrome or Edge and try again.');
    }
    const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('extension/offscreen.html')]
    });
    if (contexts.length) return;
    if (!creatingOffscreen) {
        creatingOffscreen = chrome.offscreen.createDocument({
            url: 'extension/offscreen.html', reasons: ['USER_MEDIA'],
            justification: 'Keep processing the selected tab audio while the editor is closed.'
        }).finally(() => { creatingOffscreen = null; });
    }
    await creatingOffscreen;
}

async function sendOffscreen(command, args = {}) {
    await ensureOffscreen();
    return chrome.runtime.sendMessage({ destination: 'offscreen', command, args });
}

async function handleControl(command, args) {
    if (command === 'openEditor') {
        const url = chrome.runtime.getURL('extension/editor.html');
        const existing = (await chrome.tabs.query({})).find(tab => tab.url === url);
        if (existing) await chrome.tabs.update(existing.id, { active: true });
        else await chrome.tabs.create({ url });
        return { ok: true, result: null };
    }
    if (command === 'start') {
        const state = await sendOffscreen('getState');
        if (!state?.ok || ['processing', 'starting', 'stopping'].includes(state.result.status)) return state;
        if (!Number.isInteger(args.tabId)) throw new Error('Open the tab you want to hear, then start EffeTune from its toolbar button.');
        const tab = await chrome.tabs.get(args.tabId);
        if (tab.incognito || !/^https?:/.test(tab.url || '')) {
            throw new Error('Choose a regular website tab, then start EffeTune from its toolbar button.');
        }
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: args.tabId });
        return sendOffscreen('start', { streamId, tabId: args.tabId, title: tab.title || 'Selected tab' });
    }
    return sendOffscreen(command, args);
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.destination !== 'worker') return false;
    if (isInternalSender(sender, ['extension/offscreen.html']) && ['loadSettings', 'saveSettings'].includes(message.command)) {
        const operation = message.command === 'loadSettings'
            ? chrome.storage.local.get('settings').then(value => value.settings || {})
            : chrome.storage.local.set({ settings: message.args?.settings });
        operation.then(result => respond({ ok: true, result }), error => {
            console.error('Extension settings failed:', error);
            respond({ ok: false, error: 'Your settings could not be saved. Free some browser storage and try again.' });
        });
        return true;
    }
    if (!isInternalSender(sender, ['extension/popup.html', 'extension/editor.html']) ||
        !CONTROL_COMMANDS.has(message.command) || !message.args || typeof message.args !== 'object') return false;
    const operation = controlQueue.then(() => handleControl(message.command, message.args));
    controlQueue = operation.catch(() => {});
    operation.then(respond, error => {
        console.error('Tab audio action failed:', error);
        respond({ ok: false, error: 'Tab audio could not be started. Return to the website, play its audio, and try again.' });
    });
    return true;
});
