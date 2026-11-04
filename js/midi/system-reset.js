// Recognize only complete packets in the supported GM/GS/XG host profile.
// Roland: https://support.roland.com/hc/en-us/articles/201924639
// Yamaha: https://usa.yamaha.com/files/download/other_assets/2/317132/PSR8000E.pdf
export function recognizeMidiSystemReset(bytes) {
    if (!bytes || ![6, 9, 11].includes(bytes.length) || bytes[0] !== 0xf0 || bytes.at(-1) !== 0xf7) return 0;
    for (let index = 1; index < bytes.length - 1; index++)
        if (!Number.isInteger(bytes[index]) || bytes[index] < 0 || bytes[index] > 127) return 0;
    if (bytes.length === 6 && bytes[1] === 0x7e && bytes[3] === 9 && (bytes[4] === 1 || bytes[4] === 3)) return 1;
    if (bytes.length === 11 && bytes[1] === 0x41 && bytes[2] >= 0x10 && bytes[2] <= 0x1f &&
        bytes[3] === 0x42 && bytes[4] === 0x12 && bytes[5] === 0x40 && bytes[6] === 0 &&
        bytes[7] === 0x7f && bytes[8] === 0 && ((bytes[5] + bytes[6] + bytes[7] + bytes[8] + bytes[9]) & 127) === 0) return 2;
    if (bytes.length === 9 && bytes[1] === 0x43 && bytes[2] >= 0x10 && bytes[2] <= 0x1f &&
        bytes[3] === 0x4c && bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0x7e && bytes[7] === 0) return 3;
    return 0;
}

// Roland GS USE FOR RHYTHM PART and Yamaha XG MULTI PART / PART MODE.
// GS block 0 is Part10; blocks 1..9/A..F are Parts1..9/11..16.
// Drum setup/map numbers select percussion; SF2 supplies the kit through Program Change.
export function recognizeMidiDrumMode(bytes) {
    if (!bytes || ![9, 11].includes(bytes.length) || bytes[0] !== 0xf0 || bytes.at(-1) !== 0xf7) return null;
    for (let index = 1; index < bytes.length - 1; index++)
        if (!Number.isInteger(bytes[index]) || bytes[index] < 0 || bytes[index] > 127) return null;
    if (bytes.length === 11 && bytes[1] === 0x41 && bytes[2] >= 0x10 && bytes[2] <= 0x1f &&
        bytes[3] === 0x42 && bytes[4] === 0x12 && bytes[5] === 0x40 &&
        bytes[6] >= 0x10 && bytes[6] <= 0x1f && bytes[7] === 0x15 && bytes[8] <= 2 &&
        ((bytes[5] + bytes[6] + bytes[7] + bytes[8] + bytes[9]) & 127) === 0) {
        const part = bytes[6] & 15;
        return { channel: part === 0 ? 9 : part <= 9 ? part - 1 : part, mode: bytes[8] };
    }
    if (bytes.length === 9 && bytes[1] === 0x43 && bytes[2] >= 0x10 && bytes[2] <= 0x1f &&
        bytes[3] === 0x4c && bytes[4] === 8 && bytes[5] < 16 && bytes[6] === 7 && bytes[7] <= 3)
        return { channel: bytes[5], mode: bytes[7] };
    return null;
}
