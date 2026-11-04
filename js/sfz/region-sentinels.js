// Published sentinels retain their original opcode text; only the prepared
// region gets safe key/sample geometry. Runtime flags preserve their actions.
// https://sfzformat.com/opcodes/key/ and https://sfzformat.com/opcodes/end/
export function normalizeSfzRegionSentinels(region) {
    const raw = region.opcodes ?? region;
    const noteEnabled = !(Number(raw.lokey) === -1 && Number(raw.hikey) === -1);
    const silentAction = Number(raw.end) === -1;
    if (!noteEnabled) {
        region.lokey = 0;
        region.hikey = 127;
    }
    if (region.pitch_keycenter === -1 && (!noteEnabled || Number(raw.key) === -1))
        region.pitch_keycenter = 60;
    if (silentAction) {
        region.sample = '*silence';
        region.offset = region.end = region.loop_start = region.loop_end = 0;
        region.loop_mode = 0;
    }
    return { noteEnabled, silentAction };
}
