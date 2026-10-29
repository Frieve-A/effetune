import { getAndroidBridge } from './bridge.js';
import { AndroidDocumentFile } from './library-io.js';

export function installAndroidSharedFiles(uiManager, bridge = getAndroidBridge()) {
    async function receive() {
        try {
            const record = await bridge.request('documents.takeShared');
            if (!record.uri) return;
            const file = new AndroidDocumentFile(record);
            if (/\.effetune_backup$/i.test(record.name)) {
                await uiManager.stateManager.openBackupRestore(file);
            } else if (/\.effetune_preset$/i.test(record.name)) {
                if (file.size > 4 * 1024 * 1024) throw new RangeError('Preset too large');
                await uiManager.loadPreset(JSON.parse(await file.text()));
            } else {
                await uiManager.createAudioPlayer([{ uri: record.uri, name: record.name,
                    type: record.mimeType, size: record.size }], false);
            }
        } catch (error) {
            console.error('Android shared file import failed:', error);
            uiManager.setError('error.musicSelectionUnavailable', true);
        }
    }
    bridge.on('shared-document', () => void receive());
    void receive();
}
