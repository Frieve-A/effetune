/*
 * Direct Stream Transfer (DST) decoder.
 * Copyright (c) 2014 Peter Ross <pross@xvid.org>
 * Copyright (c) 2026 Yoshiyuki Kobayashi
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Derived from FFmpeg n7.1.1 libavcodec/dstdec.c. Modified 2026-11-01:
 * WebAssembly wrapper returning packed DSD with bounded frame validation.
 * See dst-decoder.NOTICE.txt and dst-decoder.LICENSE.txt in this directory.
 * This library is free software; you may redistribute and/or modify it under
 * the GNU Lesser General Public License, version 2.1 or any later version.
 * It is provided WITHOUT ANY WARRANTY, including MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE.
 */

import { createDsdWasmArena } from './dsd-wasm.js';
import { dsdError } from './dsd-parser.js';

let arena;

export function decodeDstFrame(packet, channelCount, samplesPerFrame) {
    if (!(packet instanceof Uint8Array) || packet.length <= 1 || packet.length > 1024 * 1024 ||
        (channelCount !== 1 && channelCount !== 2) ||
        ![37632, 75264, 150528].includes(samplesPerFrame)) {
        throw dsdError('DSD_CORRUPT', 'Invalid DST frame parameters');
    }
    arena ??= createDsdWasmArena({ packet: [Uint8Array, 1024 * 1024], output: [Uint8Array, 37632] });
    arena.views.packet.set(packet);
    const result = arena.api.dst_decode(arena.offsets.packet, packet.length,
        channelCount, samplesPerFrame, arena.offsets.output);
    if (result !== 0) {
        throw dsdError(result === -2 ? 'DSD_UNSUPPORTED' : 'DSD_CORRUPT',
            result === -2 ? 'Unsupported segmented DST frame' : 'Invalid DST frame');
    }
    return arena.views.output.slice(0, samplesPerFrame / 8 * channelCount);
}
