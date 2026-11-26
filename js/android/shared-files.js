import { getAndroidBridge } from './bridge.js';
import { AndroidDocumentFile } from './library-io.js';

export function installAndroidSharedFiles(uiManager, bridge = getAndroidBridge()) {
    async function receive() {
        try {
            const { files = [] } = await bridge.request('documents.takeShared');
            const music = [];
            for (const record of files) {
                const file = new AndroidDocumentFile(record);
                if (/\.effetune_backup$/i.test(record.name)) {
                    await uiManager.stateManager.openBackupRestore(file);
                } else if (/\.effetune_preset$/i.test(record.name)) {
                    if (file.size > 4 * 1024 * 1024) throw new RangeError('Preset too large');
                    await uiManager.loadPreset(JSON.parse(await file.text()));
                } else {
                    music.push({ uri: record.uri, name: record.name, type: record.mimeType, size: record.size });
                }
            }
            if (music.length) {
                try { await uiManager.createAudioPlayer(music, false, { waitForLoad: true }); }
                catch (error) { if (error?.code !== 'visible-start-required') throw error; }
            }
        } catch (error) {
            console.error('Android shared file import failed:', error);
            uiManager.setError('error.musicSelectionUnavailable', true);
        }
    }
    bridge.on('shared-document', () => void receive());
    void receive();
}
