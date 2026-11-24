// Both Chromium and the native WASAPI driver capture System Audio from the
// Windows default output and mute it during capture. The guard allows capture
// only when EffeTune plays through a different output device.

const DEFAULT_OUTPUT_DEVICE_ID = 'default';

/**
 * Return the groupId of the `default` entry in an audiooutput device list,
 * or null when the list has no such entry.
 */
export function getDefaultOutputGroupId(outputDevices) {
    const entry = (outputDevices || []).find(device => device.deviceId === DEFAULT_OUTPUT_DEVICE_ID);
    return entry ? (entry.groupId || null) : null;
}

/**
 * Evaluate whether System Audio capture may run with the given output device.
 * @param {string|null|undefined} outputDeviceId - The output device actually applied.
 * @param {Array<{deviceId: string, groupId?: string}>} outputDevices - Enumerated
 *     `audiooutput` devices. Entries other than `default` and the selected one
 *     (for example `communications`) are ignored.
 * @returns {{allowed: boolean, reason: string|null}} `reason` is one of
 *     'default-output-selected', 'same-as-default-output' or
 *     'output-device-unknown' when denied, otherwise null.
 */
export function evaluateSystemAudioGuard(outputDeviceId, outputDevices) {
    if (!outputDeviceId || outputDeviceId === DEFAULT_OUTPUT_DEVICE_ID) {
        return { allowed: false, reason: 'default-output-selected' };
    }
    const devices = outputDevices || [];
    const defaultEntry = devices.find(device => device.deviceId === DEFAULT_OUTPUT_DEVICE_ID);
    const selectedEntry = devices.find(device => device.deviceId === outputDeviceId);
    // Without both entries the relation cannot be established; deny because
    // capturing the output EffeTune plays through would mute it.
    if (!defaultEntry || !selectedEntry) {
        return { allowed: false, reason: 'output-device-unknown' };
    }
    if (selectedEntry.groupId === defaultEntry.groupId) {
        return { allowed: false, reason: 'same-as-default-output' };
    }
    return { allowed: true, reason: null };
}
