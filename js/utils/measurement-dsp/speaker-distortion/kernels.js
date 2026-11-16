// Wrapper of the identification compute module in the DSP WebAssembly module
// (one context per worker, typed-array views on its buffers).

const ROWS = 3983;
const PADDED_COLUMNS = 1380;
const LD = 2 * ROWS + 2;
const SLOTS = 24;

export const SDC_COLUMNS = 1376;
/** Stride of one column in COLUMNS: row r holds Re at r and Im at ROWS + r. */
export const SDC_COLUMN_STRIDE = LD;
export const SDC_UNKNOWNS = 1183;
export const SDC_PACKED_LENGTH = SDC_COLUMNS * (SDC_COLUMNS + 1) / 2;
export const SDC_SCORE_SETS = 54;
export const SDC_SCORE_SCALES = 5;

// Buffer ids of et_sdc_buffer with their element type and length. COLUMNS and STATES are
// the internal float32 columns (1380 x 7968) and states (44 x 48000), for reading only. ODD
// holds the 32 odd weights then the 32 bounds read by correct().
export const SDC_BUFFER = Object.freeze({
    IO: 0, DRIVE: 1, G: 2, EXCITED: 3, TERM_MASK: 4, ROWW: 5, CARRIER: 6, GRAM: 7, GRAM_T: 8,
    GRAM_S: 9, WEIGHTS: 10, PRED: 11, MIC: 12, Y: 13, PN: 14, ROWSET: 15, SCORE: 16, OUT: 17,
    COLUMNS: 18, STATES: 19, ODD: 20
});

const LAYOUT = [
    [Float32Array, 48000], [Float32Array, 16002], [Float32Array, 16002], [Uint8Array, 8001],
    [Uint8Array, SDC_COLUMNS], [Float64Array, ROWS], [Float64Array, 2 * ROWS],
    [Float64Array, PADDED_COLUMNS * PADDED_COLUMNS], [Float64Array, SDC_PACKED_LENGTH],
    [Float64Array, SDC_PACKED_LENGTH], [Float64Array, SLOTS * SDC_UNKNOWNS], [Float32Array, SLOTS * 2 * ROWS],
    [Float32Array, 2 * ROWS], [Float32Array, 8002], [Float32Array, 4001], [Uint8Array, 3 * 4001],
    [Float64Array, SLOTS * SDC_SCORE_SCALES * SDC_SCORE_SETS], [Float64Array, SLOTS],
    [Float32Array, PADDED_COLUMNS * LD], [Float32Array, 44 * 48000], [Float64Array, 64]
];

const ET_ERR_STATE = -2;

/**
 * Creates an identification context on `binding` (a DSP engine binding), or returns null
 * when the module lacks the functions or cannot allocate the context.
 */
export function createSdcContext(binding) {
    const handle = binding.createSpeakerDistortionFit();
    return handle ? new SdcContext(binding, handle) : null;
}

class SdcContext {
    constructor(binding, handle) {
        this.binding = binding;
        this.handle = handle;
        this.pointers = LAYOUT.map((_, id) => binding.getSpeakerDistortionFitBuffer(handle, id));
        this.memoryBuffer = null;
        this.views = [];
    }

    /** Typed-array view of buffer `id` (SDC_BUFFER), re-created after memory growth. */
    view(id) {
        const buffer = this.binding.memory.buffer;
        if (buffer !== this.memoryBuffer) {
            this.memoryBuffer = buffer;
            this.views = LAYOUT.map(([Type, length], i) => new Type(buffer, this.pointers[i], length));
        }
        return this.views[id];
    }

    run(name, ...args) {
        const status = this.binding.callSpeakerDistortionFit(name, this.handle, ...args);
        if (status !== 0) throw new Error(`et_sdc_${name} failed with status ${status}`);
    }

    /** 48000-point real transform of IO in place, unnormalized both ways. */
    fft(inverse = false) { this.run('fft', inverse ? 1 : 0); }

    /** States and MIC from DRIVE, G and EXCITED. */
    drive() { this.run('drive'); }

    /** Columns from the states, MIC, G and TERM_MASK. */
    columns() { this.run('columns'); }

    /** Scaled seed GRAM from the columns, ROWW and CARRIER; qRow is the first row of Q. */
    gram(qRow) { this.run('gram', qRow >>> 0); }

    /** Copies the lower triangle of GRAM into the packed buffer `id` (GRAM_T or GRAM_S) and returns it. */
    packGram(id) {
        const gram = this.view(SDC_BUFFER.GRAM);
        const packed = this.view(id);
        for (let i = 0, offset = 0; i < SDC_COLUMNS; offset += ++i) {
            packed.set(gram.subarray(i * PADDED_COLUMNS, i * PADDED_COLUMNS + i + 1), offset);
        }
        return packed;
    }

    /** Scaled system of length 0 (Short) or 1 (Long), N_T or with fold 1 N_T - N_s. */
    system(length, fold) { this.run('system', length, fold ? 1 : 0); }

    /** Ridge solve into WEIGHTS slot `slot`; false when the factorization fails. */
    solve(lambda, slot) {
        const status = this.binding.callSpeakerDistortionFit('solve', this.handle, lambda, slot >>> 0);
        if (status === ET_ERR_STATE) return false;
        if (status !== 0) throw new Error(`et_sdc_solve failed with status ${status}`);
        return true;
    }

    /** Held-out E of the first `count` weight slots against GRAM_S into OUT. */
    heldout(length, count, yy) { this.run('heldout', length, count, yy); }

    /** PRED of the first `count` weight slots. */
    predict(length, count) { this.run('predict', length, count); }

    /** IO = one corrected 48 kHz period from slot 0 at `scale`. */
    correct(length, scale) { this.run('correct', length, scale); }

    /** SCORE of the first `count` weight slots for the record in Y and PN. */
    score(count, predScale) { this.run('score', count, predScale); }

    destroy() {
        if (!this.handle) return;
        this.binding.destroySpeakerDistortionFit(this.handle);
        this.handle = 0;
        this.views = [];
        this.memoryBuffer = null;
    }
}
