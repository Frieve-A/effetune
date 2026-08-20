const TUBE_SIMULATOR_TAP_OPERATING_POINT = 19;
const TUBE_SIMULATOR_TELEMETRY_VERSION = 2;
// Twenty floats per channel plus one shared trailing word carrying the automatic output safety
// reduction in dB. The channel stride stays twenty; the extra word lives past both channels.
const TUBE_SIMULATOR_TELEMETRY_BYTES = 164;
const TUBE_SIMULATOR_TELEMETRY_SAFETY_INDEX = 40;
const TUBE_SIMULATOR_PARAMETER_FIELDS = Object.freeze([
    'dr', 'tp', 'bi', 'pv', 'sz', 'su', 'og', 'mx', 'iv', 'nf',
    'os', 'pt', 'pb', 'kr', 'st', 'zp', 'sl', 'sd', 'sb', 'sr', 'sp'
]);
const TUBE_SIMULATOR_TELEMETRY_FIELDS = Object.freeze([
    'vk1', 'vk2', 'vbPlus', 'vgk1', 'vak1', 'ia1', 'vgk2', 'vak2', 'ia2',
    'ltpBalanceV', 'powerPlatePushV', 'powerPlatePullV', 'powerIaPushA',
    'powerIaPullA', 'powerBPlusV', 'screenPushV', 'screenPullV',
    'transformerFluxWb', 'speakerVrms100ms', 'speakerRealPower100ms'
]);
const TUBE_SIMULATOR_ENUM_ABI = Object.freeze({
    tp: Object.freeze({
        // Bypass is appended so the existing three-value enum ABI remains stable.
        values: Object.freeze(['12AX7', '12AT7', '12AU7', 'Bypass']),
        labels: Object.freeze(['12AX7', '12AT7', '12AU7', 'Bypass'])
    }),
    os: Object.freeze({
        values: Object.freeze(['Line', 'Power', 'SingleEnded']),
        // Display only. The serialized values above are the parameter ABI; these
        // labels are kept short so the select does not wrap in the plugin UI.
        labels: Object.freeze(['Line', 'Push-Pull Power', 'SE Triode'])
    }),
    pt: Object.freeze({
        values: Object.freeze(['EL84', 'EL34', '6L6GC', 'KT88']),
        labels: Object.freeze(['EL84 ×2', 'EL34 ×2', '6L6GC ×2', 'KT88 ×2'])
    }),
    st: Object.freeze({
        values: Object.freeze(['0', '20', '43']),
        labels: Object.freeze(['0%', '20%', '43%']),
        physical: Object.freeze([0, 0.2, 0.43])
    }),
    zp: Object.freeze({
        values: Object.freeze(['6.0', '6.6', '8.0']),
        labels: Object.freeze(['6.0 kΩ', '6.6 kΩ', '8.0 kΩ']),
        physical: Object.freeze([6000, 6600, 8000])
    }),
    sl: Object.freeze({
        values: Object.freeze(['4', '8', '15', '16']),
        labels: Object.freeze(['4 Ω', '8 Ω', '15 Ω', '16 Ω']),
        physical: Object.freeze([4, 8, 15, 16])
    }),
    sd: Object.freeze({
        values: Object.freeze(['300B', '2A3']),
        labels: Object.freeze(['300B', '2A3'])
    }),
    sp: Object.freeze({
        values: Object.freeze(['2.5', '3.5', '5.0']),
        labels: Object.freeze(['2.5 kΩ', '3.5 kΩ', '5.0 kΩ']),
        physical: Object.freeze([2500, 3500, 5000])
    })
});
const TUBE_SIMULATOR_DEFAULT_SE_PARAMETERS = Object.freeze({
    sd: '300B', sb: 400, sr: 1000, sp: '3.5'
});
const TUBE_SIMULATOR_CANONICAL_PRESETS = Object.freeze([
    Object.freeze({
        id: 'line-default', label: 'Line Default',
        params: Object.freeze({
            dr: 0, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 9,
            mx: 100, iv: 2.828, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    Object.freeze({
        id: 'power-el84-pentode-10w', label: 'EL84 Pentode 10 W',
        params: Object.freeze({
            dr: 0, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -19.675,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '15', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    Object.freeze({
        id: 'power-el84-distributed-10w', label: 'EL84 Distributed 10 W',
        params: Object.freeze({
            dr: 0, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -17.331,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: 'EL84', pb: 330.107,
            kr: 270, st: '20', zp: '6.6', sl: '15', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    Object.freeze({
        id: 'power-el34-distributed-20-37w', label: 'EL34 Distributed 20–37 W',
        params: Object.freeze({
            dr: 0, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -17.23,
            mx: 100, iv: 2.828, nf: 4, os: 'Power', pt: 'EL34', pb: 443.775,
            kr: 470, st: '43', zp: '6.6', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    Object.freeze({
        id: 'power-6l6gc-pentode', label: '6L6GC Pentode',
        params: Object.freeze({
            dr: 0, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -15.267,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: '6L6GC', pb: 391.454,
            kr: 483.871, st: '0', zp: '6.6', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    Object.freeze({
        id: 'power-kt88-distributed', label: 'KT88 Distributed',
        params: Object.freeze({
            dr: 0, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -16.166,
            mx: 100, iv: 2.828, nf: 4, os: 'Power', pt: 'KT88', pb: 379.29,
            kr: 400, st: '43', zp: '6.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    Object.freeze({
        id: 'se-300b', label: '300B Single-Ended',
        params: Object.freeze({
            dr: -42, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 38.795,
            mx: 100, iv: 2.828, nf: 3, os: 'SingleEnded', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    Object.freeze({
        id: 'se-2a3', label: '2A3 Single-Ended',
        params: Object.freeze({
            dr: -42, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 37.461,
            mx: 100, iv: 2.828, nf: 3, os: 'SingleEnded', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '2A3', sb: 300,
            sr: 750, sp: '2.5'
        })
    })
]);
// Level-matched calibration bank. Entries share the canonical 21-field record shape
// ({ id, label, params }) and are assigned to Pre or Pre+Power below.
//
// GENERATED VALUES - do not hand-edit dr / iv / og.
// Every circuit value is inherited verbatim from the canonical preset named in
// the comment above each entry; only dr / iv / og are calibrated. Regenerate
// with:
//     node tests/tools/tube-simulator-lineamp/calibrate-listening-presets.mjs
// Measurement conditions: plugins/dsp/effetune-dsp.wasm, 96 kHz, stereo,
// 1 kHz sine at -12 dBFS peak for THD, input reference iv = 2.828 Vpk unless the circuit
// cannot reach its THD target at dr = 0 dB, 3 s of settling discarded (the
// measured steady-state floor of this kernel; at 0.5 s the slow bias/supply
// exponentials still read several percent low), 4608 samples (48 whole periods)
// analysed with a rectangular-window DFT, THD taken over harmonics 2..10,
// Output Trim is then calibrated to 0 dB AC RMS gain with the same -12 dBFS peak sine,
// after the same 3 s settling period. The THD-vs-drive response
// is non-monotonic, so the solver takes the lowest-drive crossing of a 2 dB
// coarse grid; every record in the harness output echoes that grid pitch.
// Regression guard: tests/esm/dsp-tube-simulator-listening-presets-v1.test.mjs.
const TUBE_SIMULATOR_LISTENING_PRESETS = Object.freeze([
    // line-default with tp=12AT7; measured THD 0.0100 %, gain -0.0003 dB.
    Object.freeze({
        id: 'listening-line-12at7-thd0p01', label: 'Line 12AT7 @0.01%',
        params: Object.freeze({
            dr: -13.748, tp: '12AT7', bi: 0, pv: 250, sz: 10, su: 10, og: 0.619,
            mx: 100, iv: 2.828, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // line-default with tp=12AT7; measured THD 0.1000 %, gain -0.0003 dB.
    Object.freeze({
        id: 'listening-line-12at7-thd0p1', label: 'Line 12AT7 @0.1%',
        params: Object.freeze({
            dr: 0, tp: '12AT7', bi: 0, pv: 250, sz: 10, su: 10, og: -17.268,
            mx: 100, iv: 4.5552, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // line-default with tp=12AX7; measured THD 0.0100 %, gain +0.0005 dB.
    Object.freeze({
        id: 'listening-line-12ax7-thd0p01', label: 'Line 12AX7 @0.01%',
        params: Object.freeze({
            dr: -24.2637, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 8.508,
            mx: 100, iv: 2.828, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // line-default with tp=12AX7; measured THD 0.1000 %, gain 0.0000 dB.
    Object.freeze({
        id: 'listening-line-12ax7-thd0p1', label: 'Line 12AX7 @0.1%',
        params: Object.freeze({
            dr: -4.4922, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -11.264,
            mx: 100, iv: 2.828, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // line-default with nf=0; measured THD 0.1000 %, gain +0.0003 dB.
    Object.freeze({
        id: 'listening-line-12au7-open-loop-thd0p1', label: 'Line 12AU7 Open-Loop @0.1%',
        params: Object.freeze({
            dr: -19.2715, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 28.495,
            mx: 100, iv: 2.828, nf: 0, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // line-default; measured THD 0.9763 % in the legacy calibration bounded at
    // 20 Vpk. Keep that established drive point for preset compatibility; gain +0.0004 dB.
    Object.freeze({
        id: 'listening-line-12au7-thd1', label: 'Line 12AU7 @1%',
        params: Object.freeze({
            dr: 0, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: -7.749,
            mx: 100, iv: 20, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // line-default with tp=12AT7; measured THD 0.9974 %, gain -0.0002 dB.
    Object.freeze({
        id: 'listening-line-12at7-thd1', label: 'Line 12AT7 @1%',
        params: Object.freeze({
            dr: 0, tp: '12AT7', bi: 0, pv: 250, sz: 10, su: 10, og: -21.421,
            mx: 100, iv: 7.3556, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // line-default with tp=12AX7; measured THD 1.0003 %, gain +0.0003 dB.
    Object.freeze({
        id: 'listening-line-12ax7-thd1', label: 'Line 12AX7 @1%',
        params: Object.freeze({
            dr: 0, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -23.276,
            mx: 100, iv: 6.7213, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // line-default with nf=0; measured THD 1.0002 % (target 1.0 %),
    // -12 dBFS AC RMS gain +0.0004 dB.
    Object.freeze({
        id: 'listening-line-12au7-open-loop-thd1', label: 'Line 12AU7 Open-Loop @1%',
        params: Object.freeze({
            dr: -9.2656, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 18.592,
            mx: 100, iv: 2.828, nf: 0, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // power-el84-distributed-10w; measured THD 0.1000 %, gain +0.0002 dB.
    Object.freeze({
        id: 'listening-power-el84-distributed-thd0p1', label: 'EL84 Distributed @0.1%',
        params: Object.freeze({
            dr: -58.4941, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 9.942,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: 'EL84', pb: 330.107,
            kr: 270, st: '20', zp: '6.6', sl: '15', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // power-el34-distributed-20-37w; measured THD 0.1000 %, gain -0.0005 dB.
    Object.freeze({
        id: 'listening-power-el34-distributed-thd0p1', label: 'EL34 Distributed @0.1%',
        params: Object.freeze({
            dr: -56.4687, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 17.953,
            mx: 100, iv: 2.828, nf: 4, os: 'Power', pt: 'EL34', pb: 443.775,
            kr: 470, st: '43', zp: '6.6', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // power-6l6gc-pentode; measured THD 0.1000 %, gain +0.0005 dB.
    Object.freeze({
        id: 'listening-power-6l6gc-pentode-thd0p1', label: '6L6GC Pentode @0.1%',
        params: Object.freeze({
            dr: -58.5078, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 17.309,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: '6L6GC', pb: 391.454,
            kr: 483.871, st: '0', zp: '6.6', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // power-kt88-distributed; measured THD 0.1000 %, gain +0.0002 dB.
    Object.freeze({
        id: 'listening-power-kt88-distributed-thd0p1', label: 'KT88 Distributed @0.1%',
        params: Object.freeze({
            dr: -56.4668, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 21.702,
            mx: 100, iv: 2.828, nf: 4, os: 'Power', pt: 'KT88', pb: 379.29,
            kr: 400, st: '43', zp: '6.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // se-300b; measured THD 0.1000 %, gain -0.0004 dB.
    Object.freeze({
        id: 'listening-se-300b-thd0p1', label: '300B SE @0.1%',
        params: Object.freeze({
            dr: -15.3125, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 12.116,
            mx: 100, iv: 2.828, nf: 3, os: 'SingleEnded', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // se-2a3; measured THD 0.1000 %, gain +0.0002 dB.
    Object.freeze({
        id: 'listening-se-2a3-thd0p1', label: '2A3 SE @0.1%',
        params: Object.freeze({
            dr: -23.375, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 18.838,
            mx: 100, iv: 2.828, nf: 3, os: 'SingleEnded', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '2A3', sb: 300,
            sr: 750, sp: '2.5'
        })
    }),
    // power-el84-pentode-10w; measured THD 2.0099 % (target 2.0 %),
    // -12 dBFS AC RMS gain -0.0056 dB.
    // PINNED: dr and og are held at the params.json defaults so a fresh instance opens on
    // this preset instead of Custom. The latest calibration asks for dr -44.0137 / og -7.361;
    // the 0.0078 dB / 0.011 dB difference sits inside the calibration tolerance (+/-0.02 dB
    // RMS gain, +/-0.05 pt THD), so the pin costs no audible accuracy. Do not re-derive these
    // two values from the calibration harness without moving the params.json defaults with them.
    Object.freeze({
        id: 'listening-power-el84-pentode-thd2', label: 'EL84 Pentode @2%',
        params: Object.freeze({
            dr: -44.0059, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -7.372,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '15', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // power-el84-distributed-10w; measured THD 2.0007 % (target 2.0 %),
    // -12 dBFS AC RMS gain -0.0003 dB.
    Object.freeze({
        id: 'listening-power-el84-distributed-thd2', label: 'EL84 Distributed @2%',
        params: Object.freeze({
            dr: -40.9844, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -7.077,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: 'EL84', pb: 330.107,
            kr: 270, st: '20', zp: '6.6', sl: '15', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // power-el34-distributed-20-37w; measured THD 2.0002 % (target 2.0 %),
    // -12 dBFS AC RMS gain -0.0002 dB.
    Object.freeze({
        id: 'listening-power-el34-distributed-thd2', label: 'EL34 Distributed @2%',
        params: Object.freeze({
            dr: -31.6973, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -6.761,
            mx: 100, iv: 2.828, nf: 4, os: 'Power', pt: 'EL34', pb: 443.775,
            kr: 470, st: '43', zp: '6.6', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // power-6l6gc-pentode; measured THD 2.0000 % (target 2.0 %),
    // -12 dBFS AC RMS gain -0.0002 dB.
    Object.freeze({
        id: 'listening-power-6l6gc-pentode-thd2', label: '6L6GC Pentode @2%',
        params: Object.freeze({
            dr: -35.2441, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -5.095,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: '6L6GC', pb: 391.454,
            kr: 483.871, st: '0', zp: '6.6', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // power-kt88-distributed; measured THD 2.0004 % (target 2.0 %),
    // -12 dBFS AC RMS gain +0.0001 dB.
    Object.freeze({
        id: 'listening-power-kt88-distributed-thd2', label: 'KT88 Distributed @2%',
        params: Object.freeze({
            dr: -31.543, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -3.143,
            mx: 100, iv: 2.828, nf: 4, os: 'Power', pt: 'KT88', pb: 379.29,
            kr: 400, st: '43', zp: '6.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // se-300b; measured THD 1.9999 % (target 2.0 %),
    // -12 dBFS AC RMS gain -0.0003 dB.
    Object.freeze({
        id: 'listening-se-300b-thd2', label: '300B SE @2%',
        params: Object.freeze({
            dr: -2.4844, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: -0.437,
            mx: 100, iv: 2.828, nf: 3, os: 'SingleEnded', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '300B', sb: 400,
            sr: 1000, sp: '3.5'
        })
    }),
    // se-2a3; measured THD 2.0000 % (target 2.0 %),
    // -12 dBFS AC RMS gain -0.0003 dB.
    Object.freeze({
        id: 'listening-se-2a3-thd2', label: '2A3 SE @2%',
        params: Object.freeze({
            dr: -4.2559, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: -0.065,
            mx: 100, iv: 2.828, nf: 3, os: 'SingleEnded', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '8', sd: '2A3', sb: 300,
            sr: 750, sp: '2.5'
        })
    })
]);
// Power-only drive and trim are calibrated with the same THD and level contract
// as the Pre+Power bank. The two legacy direct-drive SE records remain here for
// programmatic ID compatibility; the selectable SE records use distinct target IDs.
const TUBE_SIMULATOR_POWER_ONLY_CALIBRATION = Object.freeze({
    'power-el84-pentode-10w': Object.freeze({ dr: -9.7187, iv: 2.828, og: -7.474 }),
    'power-el84-distributed-10w': Object.freeze({ dr: -6.541, iv: 2.828, og: -7.311 }),
    'power-el34-distributed-20-37w': Object.freeze({ dr: 0, iv: 5.2733, og: -9.499 }),
    'power-6l6gc-pentode': Object.freeze({ dr: 0, iv: 3.3755, og: -7.171 }),
    'power-kt88-distributed': Object.freeze({ dr: 0, iv: 7.5026, og: -10.747 }),
    'se-300b': Object.freeze({ dr: 0, iv: 20, og: 21.555 }),
    'se-2a3': Object.freeze({ dr: 0, iv: 20, og: 20.221 })
});
const TUBE_SIMULATOR_POWER_ONLY_LABELS = Object.freeze({
    'power-el84-pentode-10w': 'EL84 Pentode 10 W @2%',
    'power-el84-distributed-10w': 'EL84 Distributed 10 W @2%',
    'power-el34-distributed-20-37w': 'EL34 Distributed 20–37 W @2%',
    'power-6l6gc-pentode': '6L6GC Pentode @2%',
    'power-kt88-distributed': 'KT88 Distributed @2%',
    'se-300b': '300B Single-Ended @0.23%',
    'se-2a3': '2A3 Single-Ended @0.45%'
});
const TUBE_SIMULATOR_POWER_ONLY_LOW_DISTORTION_CALIBRATION = Object.freeze({
    'power-el84-pentode-10w': Object.freeze({ dr: -26.5898, iv: 2.828, og: 8.692 }),
    'power-el84-distributed-10w': Object.freeze({ dr: -21.7715, iv: 2.828, og: 7.368 }),
    'power-el34-distributed-20-37w': Object.freeze({ dr: -8.248, iv: 2.828, og: 3.862 }),
    'power-6l6gc-pentode': Object.freeze({ dr: -19.3086, iv: 2.828, og: 12.257 }),
    'power-kt88-distributed': Object.freeze({ dr: 0, iv: 3.1228, og: -3.474 })
});
const TUBE_SIMULATOR_SE_POWER_CALIBRATION = Object.freeze([
    Object.freeze({
        base: 'se-300b', id: 'power-only-se-300b-thd0p1', label: '300B SE @0.1%',
        params: Object.freeze({ dr: 0, iv: 35.0937, og: 16.672 })
    }),
    Object.freeze({
        base: 'se-300b', id: 'power-only-se-300b-thd1', label: '300B SE @1%',
        params: Object.freeze({ dr: 0, iv: 294.0743, og: -1.74 })
    }),
    Object.freeze({
        base: 'se-2a3', id: 'power-only-se-2a3-thd0p1', label: '2A3 SE @0.1%',
        params: Object.freeze({ dr: 0, iv: 17.932, og: 21.17 })
    }),
    Object.freeze({
        base: 'se-2a3', id: 'power-only-se-2a3-thd1', label: '2A3 SE @1%',
        params: Object.freeze({ dr: 0, iv: 165.7852, og: 1.892 })
    })
]);
const TUBE_SIMULATOR_POWER_ONLY_PRESETS = Object.freeze(
    TUBE_SIMULATOR_CANONICAL_PRESETS
        .filter(preset => preset.params.os !== 'Line')
        .map(preset => Object.freeze({
            id: preset.id.startsWith('power-')
                ? `power-only-${preset.id.slice('power-'.length)}`
                : `power-only-${preset.id}`,
            label: TUBE_SIMULATOR_POWER_ONLY_LABELS[preset.id],
            params: Object.freeze({
                ...preset.params,
                tp: 'Bypass',
                // The shorter direct-drive KT88 loop is stable at 2 dB; the canonical
                // driver-and-power circuit keeps its original 4 dB feedback setting.
                nf: preset.id === 'power-kt88-distributed' ? 2 : preset.params.nf,
                ...TUBE_SIMULATOR_POWER_ONLY_CALIBRATION[preset.id]
            })
        }))
);
const TUBE_SIMULATOR_POWER_ONLY_LOW_DISTORTION_PRESETS = Object.freeze(
    TUBE_SIMULATOR_CANONICAL_PRESETS
        .filter(preset => preset.params.os === 'Power')
        .map(preset => Object.freeze({
            id: `power-only-${preset.id.slice('power-'.length)}-thd0p1`,
            label: `${preset.label} @0.1%`,
            params: Object.freeze({
                ...preset.params,
                tp: 'Bypass',
                nf: preset.id === 'power-kt88-distributed' ? 2 : preset.params.nf,
                ...TUBE_SIMULATOR_POWER_ONLY_LOW_DISTORTION_CALIBRATION[preset.id]
            })
        }))
);
const TUBE_SIMULATOR_SE_POWER_PRESETS = Object.freeze(
    TUBE_SIMULATOR_SE_POWER_CALIBRATION.map(calibration => {
        const preset = TUBE_SIMULATOR_CANONICAL_PRESETS.find(
            candidate => candidate.id === calibration.base);
        return Object.freeze({
            id: calibration.id,
            label: calibration.label,
            params: Object.freeze({
                ...preset.params,
                tp: 'Bypass',
                ...calibration.params
            })
        });
    })
);
const TUBE_SIMULATOR_PRE_PRESETS = Object.freeze([
    ...TUBE_SIMULATOR_LISTENING_PRESETS.filter(preset =>
        preset.params.os === 'Line' && preset.id !== 'listening-line-12au7-thd1')
]);
const TUBE_SIMULATOR_SELECTABLE_POWER_PRESETS = Object.freeze([
    ...TUBE_SIMULATOR_POWER_ONLY_LOW_DISTORTION_PRESETS,
    ...TUBE_SIMULATOR_SE_POWER_PRESETS,
    ...TUBE_SIMULATOR_POWER_ONLY_PRESETS.filter(preset => preset.params.os === 'Power')
]);
const TUBE_SIMULATOR_PRE_AND_POWER_PRESETS = Object.freeze([
    ...TUBE_SIMULATOR_LISTENING_PRESETS.filter(preset => preset.params.os !== 'Line')
]);
const TUBE_SIMULATOR_PRESET_GROUPS = Object.freeze([
    // Group by the active signal path. Canonical circuit records remain the single source for
    // circuit constants, but only listening-calibrated records are exposed in the preset menu.
    Object.freeze({ label: 'Pre', presets: TUBE_SIMULATOR_PRE_PRESETS }),
    Object.freeze({ label: 'Power', presets: TUBE_SIMULATOR_SELECTABLE_POWER_PRESETS }),
    Object.freeze({ label: 'Pre+Power', presets: TUBE_SIMULATOR_PRE_AND_POWER_PRESETS })
]);
const TUBE_SIMULATOR_SELECTABLE_PRESETS = Object.freeze(
    TUBE_SIMULATOR_PRESET_GROUPS.flatMap(group => [...(group.presets || [])])
);
let tubeSimulatorInstanceSerial = 0;
const TUBE_SIMULATOR_SPEAKER_PROFILES = Object.freeze({
    '4': Object.freeze({
        id: 'speaker-two-branch-4-ohm-v1', voiceResistanceOhm: 3.2,
        voiceInductanceH: 0.00035, resonanceResistanceOhm: 24,
        resonanceInductanceH: 0.014, resonanceCapacitanceF: 0.00075
    }),
    '8': Object.freeze({
        id: 'speaker-two-branch-8-ohm-v1', voiceResistanceOhm: 6.4,
        voiceInductanceH: 0.0006, resonanceResistanceOhm: 48,
        resonanceInductanceH: 0.022, resonanceCapacitanceF: 0.0005
    }),
    '15': Object.freeze({
        id: 'speaker-two-branch-15-ohm-v1', voiceResistanceOhm: 12,
        voiceInductanceH: 0.0009, resonanceResistanceOhm: 70,
        resonanceInductanceH: 0.032, resonanceCapacitanceF: 0.00033
    }),
    '16': Object.freeze({
        id: 'speaker-two-branch-16-ohm-v1', voiceResistanceOhm: 12.8,
        voiceInductanceH: 0.001, resonanceResistanceOhm: 80,
        resonanceInductanceH: 0.035, resonanceCapacitanceF: 0.0003
    })
});
const TUBE_SIMULATOR_SE_TUBE_MODELS = Object.freeze({
    '300B': Object.freeze({
        mu: 3.85, ka: 0.000906, alpha: 1.5, v0: 9.35, sc: 0.75, vs: 35,
        standingCurrentA: 0.06, windingResistanceOhm: 120,
        magnetizingInductanceH: 12, leakageInductanceH: 0.018,
        coreLossResistanceOhm: 60000, resonanceHz: 850,
        cathodeCapacitanceF: 100e-6, powerTheveninResistanceOhm: 150,
        powerCapacitanceF: 47e-6, nfbTapTurnsRatio: 0.1,
        fluxSaturationWbT: 2.160045343568232, coerciveCurrentA: 0.0006761234037828132
    }),
    '2A3': Object.freeze({
        mu: 4.2, ka: 0.000846, alpha: 1.5, v0: -2.62, sc: 0.75, vs: 30,
        standingCurrentA: 0.06, windingResistanceOhm: 105,
        magnetizingInductanceH: 10, leakageInductanceH: 0.015,
        coreLossResistanceOhm: 50000, resonanceHz: 900,
        cathodeCapacitanceF: 100e-6, powerTheveninResistanceOhm: 120,
        powerCapacitanceF: 47e-6, nfbTapTurnsRatio: 0.1,
        fluxSaturationWbT: 1.4642621489401626, coerciveCurrentA: 0.0005291502622129182
    })
});
const TUBE_SIMULATOR_SE_HUD_PROFILES = Object.freeze({
    '300B': Object.freeze({
        ...TUBE_SIMULATOR_SE_TUBE_MODELS['300B'],
        iaMax: 0.16,
        vgkSteps: Object.freeze([-120, -100, -80, -60, -40, -20, 0])
    }),
    '2A3': Object.freeze({
        ...TUBE_SIMULATOR_SE_TUBE_MODELS['2A3'],
        iaMax: 0.18,
        vgkSteps: Object.freeze([-60, -50, -40, -30, -20, -10, 0])
    })
});
// __TUBE_PHASE_C_REFERENCE_TABLES_INJECT_START__
const TUBE_SIMULATOR_PHASE_C_REFERENCE_TABLES = Object.freeze({"profiles":[{"circuitProfileId":"power-v1-el84-0-6_0","key":{"pt":"EL84","st":"0","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":4.099889133756051,"primaryTapToPlateResistanceOhm":77.8978935413649,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":2.926028027510595,"coerciveCurrentA":0.0014142135623730952,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-0-6_6","key":{"pt":"EL84","st":"0","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":4.299999999999997,"primaryTapToPlateResistanceOhm":81.7,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":3.068844085246968,"coerciveCurrentA":0.001348399724926484,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-0-8_0","key":{"pt":"EL84","st":"0","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":4.734144190043352,"primaryTapToPlateResistanceOhm":89.94873961082367,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":3.3786861386792637,"coerciveCurrentA":0.0012247448713915891,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-20-6_0","key":{"pt":"EL84","st":"20","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":28.699223936292327,"primaryTapToPlateResistanceOhm":53.29855873882862,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":2.926028027510595,"coerciveCurrentA":0.0014142135623730952,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-20-6_6","key":{"pt":"EL84","st":"20","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.1,"primaryTapToPlateResistanceOhm":55.9,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":3.068844085246968,"coerciveCurrentA":0.001348399724926484,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-20-8_0","key":{"pt":"EL84","st":"20","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":33.13900933030345,"primaryTapToPlateResistanceOhm":61.543874470563566,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":3.3786861386792637,"coerciveCurrentA":0.0012247448713915891,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-43-6_0","key":{"pt":"EL84","st":"43","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":62.47450108580644,"primaryTapToPlateResistanceOhm":19.52328158931451,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.085,"feedbackDampingCoupling":0.003},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":2.926028027510595,"coerciveCurrentA":0.0014142135623730952,"sentinelProfile":true},{"circuitProfileId":"power-v1-el84-43-6_6","key":{"pt":"EL84","st":"43","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":65.52380952380952,"primaryTapToPlateResistanceOhm":20.476190476190474,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":3.068844085246968,"coerciveCurrentA":0.001348399724926484,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-43-8_0","key":{"pt":"EL84","st":"43","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":72.13934003875582,"primaryTapToPlateResistanceOhm":22.543543762111195,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":3.3786861386792637,"coerciveCurrentA":0.0012247448713915891,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-0-6_0","key":{"pt":"EL34","st":"0","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":2.002271437415743,"primaryTapToPlateResistanceOhm":38.04315731089913,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":4.778183760322199,"coerciveCurrentA":0.0023094010767585028,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-0-6_6","key":{"pt":"EL34","st":"0","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":2.1000000000000014,"primaryTapToPlateResistanceOhm":39.9,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":5.011401406008849,"coerciveCurrentA":0.0022019275302527213,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-0-8_0","key":{"pt":"EL34","st":"0","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":2.3120239067653614,"primaryTapToPlateResistanceOhm":43.92845422854178,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":5.517371360519039,"coerciveCurrentA":0.002,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-20-6_0","key":{"pt":"EL34","st":"20","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.015900061910205,"primaryTapToPlateResistanceOhm":26.02952868640467,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":4.778183760322199,"coerciveCurrentA":0.0023094010767585028,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-20-6_6","key":{"pt":"EL34","st":"20","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.7,"primaryTapToPlateResistanceOhm":27.3,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":5.011401406008849,"coerciveCurrentA":0.0022019275302527213,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-20-8_0","key":{"pt":"EL34","st":"20","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":16.184167347357498,"primaryTapToPlateResistanceOhm":30.056310787949645,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.085,"feedbackDampingCoupling":0.003},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":5.517371360519039,"coerciveCurrentA":0.002,"sentinelProfile":true},{"circuitProfileId":"power-v1-el34-43-6_0","key":{"pt":"EL34","st":"43","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.510802855858955,"primaryTapToPlateResistanceOhm":9.534625892455923,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":4.778183760322199,"coerciveCurrentA":0.0023094010767585028,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-43-6_6","key":{"pt":"EL34","st":"43","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":32,"primaryTapToPlateResistanceOhm":10,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":5.011401406008849,"coerciveCurrentA":0.0022019275302527213,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-43-8_0","key":{"pt":"EL34","st":"43","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":35.23084048404354,"primaryTapToPlateResistanceOhm":11.009637651263604,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":5.517371360519039,"coerciveCurrentA":0.002,"sentinelProfile":false},{"circuitProfileId":"power-v1-6l6gc-0-6_0","key":{"pt":"6L6GC","st":"0","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":60,"capacitanceF":0.000032},"outputTubeLutId":"6l6gc-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":0,"primaryTapToPlateResistanceOhm":70.5,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":200000,"resonanceHz":850,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.11,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":4.778183760322199,"coerciveCurrentA":0.0023094010767585028,"sentinelProfile":false},{"circuitProfileId":"power-v1-6l6gc-0-6_6","key":{"pt":"6L6GC","st":"0","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":60,"capacitanceF":0.000032},"outputTubeLutId":"6l6gc-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":0,"primaryTapToPlateResistanceOhm":70.5,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":200000,"resonanceHz":850,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.11,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":5.011401406008849,"coerciveCurrentA":0.0022019275302527213,"sentinelProfile":false},{"circuitProfileId":"power-v1-6l6gc-0-8_0","key":{"pt":"6L6GC","st":"0","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":60,"capacitanceF":0.000032},"outputTubeLutId":"6l6gc-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":0,"primaryTapToPlateResistanceOhm":70.5,"magnetizingInductanceH":220,"leakageInductanceH":0.0102,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":200000,"resonanceHz":850,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.11,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":5.517371360519039,"coerciveCurrentA":0.002,"sentinelProfile":false},{"circuitProfileId":"power-v1-6l6gc-20-6_0","key":{"pt":"6L6GC","st":"20","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":60,"capacitanceF":0.000032},"outputTubeLutId":"6l6gc-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.100000000000001,"primaryTapToPlateResistanceOhm":56.400000000000006,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":200000,"resonanceHz":850,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.11,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":4.778183760322199,"coerciveCurrentA":0.0023094010767585028,"sentinelProfile":false},{"circuitProfileId":"power-v1-6l6gc-20-6_6","key":{"pt":"6L6GC","st":"20","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":60,"capacitanceF":0.000032},"outputTubeLutId":"6l6gc-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.100000000000001,"primaryTapToPlateResistanceOhm":56.400000000000006,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":200000,"resonanceHz":850,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.11,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":5.011401406008849,"coerciveCurrentA":0.0022019275302527213,"sentinelProfile":false},{"circuitProfileId":"power-v1-6l6gc-20-8_0","key":{"pt":"6L6GC","st":"20","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":60,"capacitanceF":0.000032},"outputTubeLutId":"6l6gc-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.100000000000001,"primaryTapToPlateResistanceOhm":56.400000000000006,"magnetizingInductanceH":220,"leakageInductanceH":0.0102,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":200000,"resonanceHz":850,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.11,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":5.517371360519039,"coerciveCurrentA":0.002,"sentinelProfile":false},{"circuitProfileId":"power-v1-6l6gc-43-6_0","key":{"pt":"6L6GC","st":"43","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":60,"capacitanceF":0.000032},"outputTubeLutId":"6l6gc-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.315,"primaryTapToPlateResistanceOhm":40.185,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":200000,"resonanceHz":850,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.11,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":4.778183760322199,"coerciveCurrentA":0.0023094010767585028,"sentinelProfile":false},{"circuitProfileId":"power-v1-6l6gc-43-6_6","key":{"pt":"6L6GC","st":"43","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":60,"capacitanceF":0.000032},"outputTubeLutId":"6l6gc-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.315,"primaryTapToPlateResistanceOhm":40.185,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":200000,"resonanceHz":850,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.11,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":5.011401406008849,"coerciveCurrentA":0.0022019275302527213,"sentinelProfile":false},{"circuitProfileId":"power-v1-6l6gc-43-8_0","key":{"pt":"6L6GC","st":"43","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":60,"capacitanceF":0.000032},"outputTubeLutId":"6l6gc-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.315,"primaryTapToPlateResistanceOhm":40.185,"magnetizingInductanceH":220,"leakageInductanceH":0.0102,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":200000,"resonanceHz":850,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.11,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":5.517371360519039,"coerciveCurrentA":0.002,"sentinelProfile":false},{"circuitProfileId":"power-v1-kt88-0-6_0","key":{"pt":"KT88","st":"0","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":5e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":10000},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":100,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":50,"capacitanceF":0.000032},"outputTubeLutId":"kt88-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":0,"primaryTapToPlateResistanceOhm":70.5,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":9e-10,"coreLossResistanceOhm":160000,"resonanceHz":800,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":5.85205605502119,"coerciveCurrentA":0.0028284271247461905,"sentinelProfile":false},{"circuitProfileId":"power-v1-kt88-0-6_6","key":{"pt":"KT88","st":"0","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":5e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":10000},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":100,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":50,"capacitanceF":0.000032},"outputTubeLutId":"kt88-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":0,"primaryTapToPlateResistanceOhm":70.5,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":9e-10,"coreLossResistanceOhm":160000,"resonanceHz":800,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":6.137688170493936,"coerciveCurrentA":0.002696799449852968,"sentinelProfile":false},{"circuitProfileId":"power-v1-kt88-0-8_0","key":{"pt":"KT88","st":"0","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":5e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":10000},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":100,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":50,"capacitanceF":0.000032},"outputTubeLutId":"kt88-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":0,"primaryTapToPlateResistanceOhm":70.5,"magnetizingInductanceH":220,"leakageInductanceH":0.0102,"interwindingCapacitanceF":9e-10,"coreLossResistanceOhm":160000,"resonanceHz":800,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0,"fluxSaturationWbT":6.757372277358527,"coerciveCurrentA":0.0024494897427831783,"sentinelProfile":false},{"circuitProfileId":"power-v1-kt88-20-6_0","key":{"pt":"KT88","st":"20","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":5e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":10000},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":100,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":50,"capacitanceF":0.000032},"outputTubeLutId":"kt88-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.100000000000001,"primaryTapToPlateResistanceOhm":56.400000000000006,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":9e-10,"coreLossResistanceOhm":160000,"resonanceHz":800,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":5.85205605502119,"coerciveCurrentA":0.0028284271247461905,"sentinelProfile":false},{"circuitProfileId":"power-v1-kt88-20-6_6","key":{"pt":"KT88","st":"20","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":5e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":10000},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":100,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":50,"capacitanceF":0.000032},"outputTubeLutId":"kt88-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.100000000000001,"primaryTapToPlateResistanceOhm":56.400000000000006,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":9e-10,"coreLossResistanceOhm":160000,"resonanceHz":800,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":6.137688170493936,"coerciveCurrentA":0.002696799449852968,"sentinelProfile":false},{"circuitProfileId":"power-v1-kt88-20-8_0","key":{"pt":"KT88","st":"20","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":5e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":10000},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":100,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":50,"capacitanceF":0.000032},"outputTubeLutId":"kt88-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.100000000000001,"primaryTapToPlateResistanceOhm":56.400000000000006,"magnetizingInductanceH":220,"leakageInductanceH":0.0102,"interwindingCapacitanceF":9e-10,"coreLossResistanceOhm":160000,"resonanceHz":800,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"fluxSaturationWbT":6.757372277358527,"coerciveCurrentA":0.0024494897427831783,"sentinelProfile":false},{"circuitProfileId":"power-v1-kt88-43-6_0","key":{"pt":"KT88","st":"43","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":5e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":10000},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":100,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":50,"capacitanceF":0.000032},"outputTubeLutId":"kt88-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.315,"primaryTapToPlateResistanceOhm":40.185,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":9e-10,"coreLossResistanceOhm":160000,"resonanceHz":800,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":5.85205605502119,"coerciveCurrentA":0.0028284271247461905,"sentinelProfile":false},{"circuitProfileId":"power-v1-kt88-43-6_6","key":{"pt":"KT88","st":"43","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":5e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":10000},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":100,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":50,"capacitanceF":0.000032},"outputTubeLutId":"kt88-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.315,"primaryTapToPlateResistanceOhm":40.185,"magnetizingInductanceH":328,"leakageInductanceH":0.0102,"interwindingCapacitanceF":9e-10,"coreLossResistanceOhm":160000,"resonanceHz":800,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":6.137688170493936,"coerciveCurrentA":0.002696799449852968,"sentinelProfile":false},{"circuitProfileId":"power-v1-kt88-43-8_0","key":{"pt":"KT88","st":"43","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":5e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":10000},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":100,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":50,"capacitanceF":0.000032},"outputTubeLutId":"kt88-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.315,"primaryTapToPlateResistanceOhm":40.185,"magnetizingInductanceH":220,"leakageInductanceH":0.0102,"interwindingCapacitanceF":9e-10,"coreLossResistanceOhm":160000,"resonanceHz":800,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"fluxSaturationWbT":6.757372277358527,"coerciveCurrentA":0.0024494897427831783,"sentinelProfile":false}],"speakers":[{"id":"speaker-two-branch-4-ohm-v1","sl":"4","topology":"series-voice-rl-parallel-resonance-rlc","voiceResistanceOhm":3.2,"voiceInductanceH":0.00035,"resonanceResistanceOhm":24,"resonanceInductanceH":0.014,"resonanceCapacitanceF":0.00075},{"id":"speaker-two-branch-8-ohm-v1","sl":"8","topology":"series-voice-rl-parallel-resonance-rlc","voiceResistanceOhm":6.4,"voiceInductanceH":0.0006,"resonanceResistanceOhm":48,"resonanceInductanceH":0.022,"resonanceCapacitanceF":0.0005},{"id":"speaker-two-branch-15-ohm-v1","sl":"15","topology":"series-voice-rl-parallel-resonance-rlc","voiceResistanceOhm":12,"voiceInductanceH":0.0009,"resonanceResistanceOhm":70,"resonanceInductanceH":0.032,"resonanceCapacitanceF":0.00033},{"id":"speaker-two-branch-16-ohm-v1","sl":"16","topology":"series-voice-rl-parallel-resonance-rlc","voiceResistanceOhm":12.8,"voiceInductanceH":0.001,"resonanceResistanceOhm":80,"resonanceInductanceH":0.035,"resonanceCapacitanceF":0.0003}],"axes":[{"controlVoltageV":[0,0.4000000000000001,1.6000000000000003,3.5999999999999996,6.400000000000001,10,14.399999999999999,19.599999999999998,25.600000000000005,32.400000000000006,40],"plateCathodeV":[0,7.000000000000002,28.000000000000007,63,112.00000000000003,175,252,342.99999999999994,448.0000000000001,567,700],"screenCathodeV":[0,80,160,240,320,400]},{"controlVoltageV":[0,0.9000000000000001,3.6000000000000005,8.1,14.400000000000002,22.5,32.4,44.099999999999994,57.60000000000001,72.9,90],"plateCathodeV":[0,9.000000000000002,36.00000000000001,81,144.00000000000003,225,324,440.99999999999994,576.0000000000001,729,900],"screenCathodeV":[0,120,240,360,480,600]},{"controlVoltageV":[0,0.8000000000000002,3.2000000000000006,7.199999999999999,12.800000000000002,20,28.799999999999997,39.199999999999996,51.20000000000001,64.80000000000001,80],"plateCathodeV":[0,9.000000000000002,36.00000000000001,81,144.00000000000003,225,324,440.99999999999994,576.0000000000001,729,900],"screenCathodeV":[0,120,240,360,480,600]},{"controlVoltageV":[0,1.2000000000000002,4.800000000000001,10.799999999999999,19.200000000000003,30,43.199999999999996,58.79999999999999,76.80000000000001,97.2,120],"plateCathodeV":[0,9.500000000000002,38.00000000000001,85.5,152.00000000000003,237.5,342,465.49999999999994,608.0000000000001,769.5,950],"screenCathodeV":[0,130,260,390,520,650]}],"tubeModels":[{"inverseScreenAmplificationFactor":0.04840507695187201,"inversePlateAmplificationFactor":0.002328830926874709,"standingPlateCurrentA":0.035,"standingScreenCurrentA":0.004,"fixedScreenGroundV":300,"fixedScreenSupplyDropV":20},{"inverseScreenAmplificationFactor":0.09181180107864813,"inversePlateAmplificationFactor":0.006060606060606061,"standingPlateCurrentA":0.0625,"standingScreenCurrentA":0.005,"fixedScreenGroundV":425,"fixedScreenSupplyDropV":20},{"inverseScreenAmplificationFactor":0.12795599802258936,"inversePlateAmplificationFactor":0.005827505827505828,"standingPlateCurrentA":0.044,"standingScreenCurrentA":0.0025,"fixedScreenGroundV":292.5,"fixedScreenSupplyDropV":93.81279402599057},{"inverseScreenAmplificationFactor":0.17617017185779946,"inversePlateAmplificationFactor":0.007246376811594203,"standingPlateCurrentA":0.08517482517482518,"standingScreenCurrentA":0.0018251748251748253,"fixedScreenGroundV":300,"fixedScreenSupplyDropV":20}],"luts":[[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0017819109029218324,0.00020364696033392375,0,0.001985557863255756,0,0.001985557863255756,0,0.001985557863255756,0,0.001985557863255756,0,0.001985557863255756,0.0017819109029218324,0.00020364696033392375,0.0014090788420838842,0.000576479021171872,0.0008740557866623498,0.0011115020765934064,0.0006117264910453819,0.0013738313722103743,0.00046705180677536587,0.0015185060564803902,0.0003767971585173662,0.00160876070473839,0.0017819109029218324,0.00020364696033392375,0.0017812468748718308,0.00020431098838392535,0.0017339151219827253,0.00025164274127303086,0.0015893466273603023,0.0003962112358954538,0.0014090788420838842,0.000576479021171872,0.0012395511877036863,0.0007460066755520698,0.0017819109029218324,0.00020364696033392375,0.0017819108884605582,0.00020364697479519794,0.0017816838988694715,0.00020387396438628462,0.0017762356220826546,0.00020932224117310152,0.0017536922576555651,0.00023186560560019102,0.0017087026755677386,0.0002768551876880176,0.0017819109029218324,0.00020364696033392375,0.001781910902921828,0.00020364696033392808,0.0017819107791508867,0.0002036470841048695,0.0017818729673600093,0.0002036848958957469,0.0017812468748718308,0.00020431098838392535,0.001778214779817417,0.00020734308343833916,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.001781910902913948,0.00020364696034180806,0.0017819108424135723,0.00020364702084218382,0.0017819056021470393,0.0002036522611087168,0.001781833305777437,0.0002037245574783191,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109028987667,0.0002036469603569895,0.0017819108884605582,0.00020364697479519794,0.0017819102133994535,0.0002036476498563026,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218302,0.00020364696033392591,0.001781910902908347,0.00020364696034740905,0.0017819109003259987,0.00020364696292975745,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.001781910902921828,0.00020364696033392808,0.001781910902917692,0.0002036469603380641,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218296,0.00020364696033392657,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.010320699011351428,0.0011795084584401636,0,0.011500207469791591,0,0.011500207469791591,0,0.011500207469791591,0,0.011500207469791591,0,0.011500207469791591,0.010320699011351428,0.0011795084584401636,0.00816128269295926,0.003338924776832331,0.005062467870015513,0.006437739599776078,0.0035430755718466496,0.007957131897944942,0.002705130269157947,0.008795077200633643,0.0021823818772384487,0.009317825592553142,0.010320699011351428,0.0011795084584401636,0.010316853008934626,0.0011833544608569647,0.010042710921107945,0.0014574965486836462,0.009205380661174259,0.0022948268086173326,0.00816128269295926,0.003338924776832331,0.007179390785743522,0.004320816684048069,0.010320699011351428,0.0011795084584401636,0.010320698927592773,0.001179508542198818,0.010319384220306078,0.001180823249485513,0.010287828195391998,0.0012123792743995929,0.010157258659859277,0.001342948809932314,0.009896682255835043,0.0016035252139565484,0.010320699011351428,0.0011795084584401636,0.010320699011351402,0.0011795084584401896,0.010320698294479066,0.0011795091753125254,0.01032047929132235,0.0011797281784692408,0.010316853008934626,0.0011833544608569647,0.010299291333780667,0.0012009161360109245,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011305761,0.0011795084584858301,0.010320698660891964,0.001179508808899627,0.01032066830964739,0.001179539160144202,0.010320249574305988,0.001179957895485603,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011217831,0.0011795084585737598,0.010320698927592773,0.001179508542198818,0.010320695017687702,0.0011795124521038897,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351415,0.0011795084584401757,0.010320699011273322,0.0011795084585182695,0.010320698996316546,0.0011795084734750449,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351402,0.0011795084584401896,0.010320699011327447,0.0011795084584641444,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351412,0.0011795084584401792,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.028835802141207557,0.003295520244709433,0,0.03213132238591699,0,0.03213132238591699,0,0.03213132238591699,0,0.03213132238591699,0,0.03213132238591699,0.028835802141207557,0.003295520244709433,0.022802441258464617,0.009328881127452372,0.014144421970394486,0.017986900415522505,0.009899273881424593,0.022232048504492397,0.007558073452373253,0.024573248933543738,0.006097526140369892,0.026033796245547098,0.028835802141207557,0.003295520244709433,0.028825056496498462,0.0033062658894185276,0.02805910963626611,0.004072212749650878,0.025719627622912442,0.0064116947630045475,0.022802441258464617,0.009328881127452372,0.020059057236763704,0.012072265149153286,0.028835802141207557,0.003295520244709433,0.02883580190718775,0.00329552047872924,0.028832128644441585,0.0032991937414754043,0.028743961816808633,0.0033873605691083566,0.02837915345565501,0.0037521689302619787,0.027651108812472815,0.004480213573444174,0.028835802141207557,0.003295520244709433,0.028835802141207487,0.0032955202447095024,0.028835800138282217,0.0032955222476347724,0.02883518824836193,0.0032961341375550603,0.028825056496498462,0.0033062658894185276,0.02877598956901121,0.003355332816905778,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141079968,0.003295520244837022,0.028835801162031653,0.0032955212238853365,0.028835716361333336,0.003295606024583654,0.028834546424157486,0.0032967759617595037,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802140834293,0.003295520245082697,0.02883580190718775,0.00329552047872924,0.028835790983000455,0.0032955314029165343,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207522,0.0032955202447094677,0.02883580214098933,0.003295520244927661,0.028835802099200437,0.003295520286716553,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207487,0.0032955202447095024,0.028835802141140555,0.003295520244776435,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.02883580214120751,0.003295520244709478,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.059776741872027785,0.006831627642517456,0,0.06660836951454524,0,0.06660836951454524,0,0.06660836951454524,0,0.06660836951454524,0,0.06660836951454524,0.059776741872027785,0.006831627642517456,0.0472695588104155,0.01933881070412974,0.029321447584946654,0.037286921929598586,0.020521237336581472,0.04608713217796377,0.01566791877680091,0.05094045073774433,0.012640197916671137,0.05396817159787411,0.059776741872027785,0.006831627642517456,0.059754466104324895,0.006853903410220345,0.05816665496844636,0.008441714546098877,0.053316898691798606,0.013291470822746634,0.0472695588104155,0.01933881070412974,0.041582511933134024,0.025025857581411216,0.059776741872027785,0.006831627642517456,0.05977674138690372,0.006831628127641522,0.059769126697430876,0.006839242817114365,0.05958635648451008,0.007022013030035162,0.05883010718266477,0.007778262331880469,0.05732086750576248,0.009287502008782762,0.059776741872027785,0.006831627642517456,0.05977674187202764,0.0068316276425176015,0.05977673771995494,0.006831631794590301,0.059775469269518225,0.006832900245027015,0.059754466104324895,0.006853903410220345,0.059652750152589064,0.0069556193619561765,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741871763295,0.0068316276427819456,0.05977673984219193,0.006831629672353311,0.05977656404997955,0.006831805464565688,0.05977413876518169,0.006834230749363547,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.05977674187125401,0.006831627643291233,0.05977674138690372,0.006831628127641522,0.05977671874101647,0.00683165077352877,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.05977674187202771,0.006831627642517532,0.059776741871575396,0.006831627642969844,0.059776741784946845,0.006831627729598395,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.05977674187202764,0.0068316276425176015,0.05977674187188889,0.006831627642656352,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027694,0.006831627642517546,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.10522197188614804,0.012025368215559773,0,0.11724734010170781,0,0.11724734010170781,0,0.11724734010170781,0,0.11724734010170781,0,0.11724734010170781,0.10522197188614804,0.012025368215559773,0.08320621085150884,0.034041129250198976,0.051613059474694314,0.0656342806270135,0.036122494978421925,0.08112484512328588,0.027579444068336796,0.08966789603337103,0.022249900348712322,0.09499743975299549,0.10522197188614804,0.012025368215559773,0.1051827609802075,0.012064579121500316,0.10238781743748986,0.014859522664217958,0.09385103703402506,0.023396303067682755,0.08320621085150884,0.034041129250198976,0.07319559020046033,0.04405174990124748,0.10522197188614804,0.012025368215559773,0.10522197103220872,0.012025369069499095,0.10520856727990405,0.012038772821803767,0.10488684612877892,0.01236049397292889,0.10355565877587768,0.013691681325830138,0.10089902059388293,0.01634831950782488,0.10522197188614804,0.012025368215559773,0.10522197188614778,0.012025368215560037,0.10522196457746445,0.012025375524243362,0.10521973178838945,0.012027608313318366,0.1051827609802075,0.012064579121500316,0.10500371554081515,0.01224362456089266,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188568247,0.012025368216025345,0.10522196831313077,0.012025371788577044,0.10522165887500066,0.01202568122670715,0.10521738976897674,0.012029950332731076,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.105221971884786,0.012025368216921808,0.10522197103220872,0.012025369069499095,0.10522193116980007,0.012025408931907747,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614792,0.012025368215559898,0.10522197188535173,0.01202536821635608,0.10522197173286388,0.012025368368843936,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614778,0.012025368215560037,0.10522197188590354,0.012025368215804272,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614787,0.01202536821555994,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.16701487945457694,0.01908741479480877,0,0.1861022942493857,0,0.1861022942493857,0,0.1861022942493857,0,0.1861022942493857,0,0.1861022942493857,0.16701487945457694,0.01908741479480877,0.13207008979334942,0.05403220445603629,0.08192346856771633,0.10417882568166938,0.057335878013648145,0.12876641623573756,0.04377581453692466,0.14232647971246104,0.03531643019043002,0.1507858640589557,0.16701487945457694,0.01908741479480877,0.16695264145797248,0.01914965279141323,0.16251633266712015,0.023585961582265558,0.1489662221297737,0.03713607211961201,0.13207008979334942,0.05403220445603629,0.11618060804984613,0.06992168619953958,0.16701487945457694,0.01908741479480877,0.16701487809915117,0.019087416150234543,0.16699360282712122,0.019108691422264484,0.16648294694118812,0.019619347308197588,0.1643700033107758,0.0217322909386099,0.16015322141848845,0.025949072830897257,0.16701487945457694,0.01908741479480877,0.16701487945457652,0.019087414794809188,0.1670148678537783,0.0190874263956074,0.1670113238316361,0.019090970417749598,0.16695264145797248,0.01914965279141323,0.1666684493644299,0.01943384488495581,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945383794,0.019087414795547764,0.16701487378326096,0.019087420466124744,0.16701438262375246,0.019087911625633253,0.16700760643228613,0.01909468781709958,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945241503,0.01908741479697068,0.16701487809915117,0.019087416150234543,0.1670148148270488,0.019087479422336906,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457674,0.019087414794808966,0.16701487945331298,0.019087414796072733,0.16701487921127472,0.019087415038110983,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457652,0.019087414794809188,0.16701487945418886,0.01908741479519685,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.1670148794545767,0.01908741479480902,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.24683187758968456,0.02820935743882108,0,0.27504123502850564,0,0.27504123502850564,0,0.27504123502850564,0,0.27504123502850564,0,0.27504123502850564,0.24683187758968456,0.02820935743882108,0.1951868500794066,0.07985438494909905,0.12107498224868357,0.15396625277982207,0.08473689571599453,0.19030433931251112,0.06469643022498263,0.21034480480352302,0.05219427635511773,0.2228469586733879,0.24683187758968456,0.02820935743882108,0.2467398958356668,0.028301339192838837,0.2401834594750878,0.03485777555341785,0.2201577034681769,0.05488353156032874,0.1951868500794066,0.07985438494909905,0.1717037291414149,0.10333750588709073,0.24683187758968456,0.02820935743882108,0.24683187558649602,0.028209359442009613,0.24680043278715666,0.028240802241348978,0.24604573265781055,0.028995502370695092,0.24292300583706836,0.03211822919143728,0.2366910090517607,0.03835022597674495,0.24683187758968456,0.02820935743882108,0.24683187758968395,0.02820935743882169,0.24683186044482347,0.028209374583682167,0.2468266227220383,0.028214612306467324,0.2467398958356668,0.028301339192838837,0.2463198873413677,0.028721347687137938,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.2468318775885924,0.028209357439913235,0.24683186920802674,0.028209365820478893,0.24683114332166212,0.02821009170684352,0.24682112876446816,0.02822010626403748,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758648947,0.028209357442016164,0.24683187558649602,0.028209359442009613,0.2468317820764335,0.02820945295207214,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968425,0.028209357438821386,0.24683187758781655,0.028209357440689087,0.24683187723010738,0.028209357798398255,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968395,0.02820935743882169,0.24683187758911102,0.028209357439394622,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968417,0.02820935743882147,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.34622256350126285,0.03956829297157288,0,0.38579085647283573,0,0.38579085647283573,0,0.38579085647283573,0,0.38579085647283573,0,0.38579085647283573,0.34622256350126285,0.03956829297157288,0.27378186422324974,0.11200899224958599,0.1698277027236006,0.21596315374923514,0.1188575217448205,0.2669333347280152,0.0907474518307929,0.2950434046420428,0.0732111116936114,0.31257974477922434,0.34622256350126285,0.03956829297157288,0.34609354386659347,0.03969731260624226,0.3368970566609741,0.04889379981186165,0.3088076192330863,0.07698323723974942,0.27378186422324974,0.11200899224958599,0.24084290022250984,0.1449479562503259,0.34622256350126285,0.03956829297157288,0.34622256069145935,0.039568295781376384,0.3461784569610286,0.03961239951180712,0.34511986511297205,0.040670991359863684,0.3407397238785859,0.04505113259424981,0.33199831687795706,0.053792539594878674,0.34622256350126285,0.03956829297157288,0.346222563501262,0.039568292971573715,0.3462225394527574,0.03956831702007835,0.3462151926796125,0.03957566379322325,0.34609354386659347,0.03969731260624226,0.34550441243426583,0.0402864440385699,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.3462225634997309,0.039568292973104824,0.3462225517446004,0.039568304728235304,0.3462215335688266,0.03956932290400911,0.34620748649477007,0.03958336997806566,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.3462225634967812,0.03956829297605452,0.34622256069145935,0.039568295781376384,0.34622242952811905,0.039568426944716684,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.3462225635012624,0.03956829297157333,0.34622256349864267,0.039568292974193064,0.34622256299689635,0.039568293475939376,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.346222563501262,0.039568292971573715,0.3462225635004584,0.03956829297237735,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.3462225635012623,0.03956829297157344,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.4666358367095902,0.0533298099096674,0,0.5199656466192576,0,0.5199656466192576,0,0.5199656466192576,0,0.5199656466192576,0,0.5199656466192576,0.4666358367095902,0.0533298099096674,0.36900087618715116,0.15096477043210643,0.2288923383718342,0.2910733082474234,0.16019516044170334,0.35977048617755425,0.12230864645588246,0.39765700016337513,0.09867331584662306,0.4212923307726345,0.4666358367095902,0.0533298099096674,0.46646194513947686,0.05350370147978073,0.4540669976277223,0.0658986489915353,0.41620829193185194,0.10375735468740566,0.36900087618715116,0.15096477043210643,0.324606019678106,0.1953596269411516,0.4666358367095902,0.0533298099096674,0.4666358329225609,0.053329813696696704,0.4665763902884834,0.05338925633077418,0.46514962916767033,0.05481601745158726,0.4592461119354479,0.060719534683809695,0.44746451766698925,0.07250112895226835,0.4666358367095902,0.0533298099096674,0.466635836709589,0.05332980990966857,0.46663580429721835,0.053329842322039245,0.46662590237864054,0.05333974424061705,0.46646194513947686,0.05350370147978073,0.46566791878811475,0.05429772783114284,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.46663583670752545,0.05332980991173214,0.46663582086406025,0.053329825755197346,0.4666344485753817,0.05333119804387587,0.466615516048023,0.05335013057123461,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.46663583670354986,0.05332980991570774,0.4666358329225609,0.053329813696696704,0.4666356561417225,0.053329990477535116,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.46663583670958964,0.05332980990966796,0.46663583670605874,0.053329809913198856,0.4666358360298093,0.0533298105894483,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.466635836709589,0.05332980990966857,0.46663583670850595,0.05332980991075165,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.46663583670958947,0.053329809909668124,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.6094380473440844,0.06965006255360962,0,0.679088109897694,0,0.679088109897694,0,0.679088109897694,0,0.679088109897694,0,0.679088109897694,0.6094380473440844,0.06965006255360962,0.48192435248326027,0.1971637574144337,0.29893910577675353,0.38014900412094044,0.2092188771054959,0.46986923279219805,0.15973814440608533,0.5193499654916086,0.12886981282570698,0.550218297071987,0.6094380473440844,0.06965006255360962,0.6092109406141625,0.06987716928353149,0.5930228298557569,0.08606528004193703,0.54357841547696,0.13550969442073402,0.48192435248326027,0.1971637574144337,0.4239435620369588,0.25514454786073515,0.6094380473440844,0.06965006255360962,0.6094380423981296,0.06965006749956437,0.6093604088346711,0.06972770106302284,0.6074970232069704,0.07159108669072356,0.5997868823831595,0.0793012275145345,0.5843998262663395,0.09468828363135451,0.6094380473440844,0.06965006255360962,0.6094380473440829,0.06965006255361106,0.6094380050127178,0.06965010488497614,0.6094250728599592,0.0696630370377348,0.6092109406141625,0.06987716928353149,0.6081739223848596,0.0709141875128344,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473413877,0.06965006255630624,0.6094380266494268,0.06965008324826716,0.6094362344061681,0.06965187549152585,0.6094115080529884,0.06967660184470559,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473361956,0.06965006256149842,0.6094380423981296,0.06965006749956437,0.6094378115179432,0.06965029837975079,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440836,0.06965006255361039,0.6094380473394722,0.06965006255822181,0.6094380464562735,0.06965006344142044,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440829,0.06965006255361106,0.6094380473426683,0.0696500625550257,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440834,0.06965006255361061,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.006264764795991247,0.0005011811836792999,0,0.006765945979670547,0,0.006765945979670547,0,0.006765945979670547,0,0.006765945979670547,0,0.006765945979670547,0.006264764795991247,0.0005011811836792999,0.004120083953303734,0.002645862026366813,0.002349882249897071,0.004416063729773476,0.0016100403118149244,0.005155905667855622,0.0012194597236916305,0.005546486255978917,0.0009800624343285207,0.005785883545342026,0.006264764795991247,0.0005011811836792999,0.006242014059609222,0.0005239319200613249,0.005752232816280637,0.0010137131633899095,0.00490165563069334,0.0018642903489772067,0.004120083953303734,0.002645862026366813,0.003500131010150358,0.0032658149695201887,0.006264764795991247,0.0005011811836792999,0.0062647562335630775,0.0005011897461074692,0.0062544155875768805,0.0005115303920936662,0.006155365720911795,0.0006105802587587517,0.005914586068807649,0.0008513599108628976,0.005572633096595191,0.001193312883075356,0.006264764795991247,0.0005011811836792999,0.006264764795854053,0.000501181183816494,0.006264723335608787,0.0005012226440617596,0.006261983129952779,0.0005039628497177677,0.006242014059609222,0.0005239319200613249,0.006184775238162038,0.0005811707415085089,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764761717154,0.000501181217953393,0.006264740289109382,0.0005012056905611649,0.006264109514867273,0.0005018364648032734,0.006260059530561971,0.0005058864491085755,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795985396,0.0005011811836851511,0.00626476472057156,0.0005011812590989869,0.0062647562335630775,0.0005011897461074692,0.006264618356008944,0.0005013276236616026,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795910153,0.0005011811837603939,0.006264764745148928,0.000501181234521619,0.0062647623717984775,0.0005011836078720692,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.0062647647959912164,0.0005011811836793303,0.006264764795854053,0.000501181183816494,0.006264764774638452,0.0005011812050320944,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.0062647647959910785,0.0005011811836794682,0.0062647647958911715,0.0005011811837793752,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795990997,0.0005011811836795497,0.030134945481475956,0.0024107956385180755,0,0.03254574111999403,0,0.03254574111999403,0,0.03254574111999403,0,0.03254574111999403,0,0.03254574111999403,0.030134945481475956,0.0024107956385180755,0.019818542172781905,0.012727198947212127,0.011303468812404436,0.021242272307589596,0.007744660589742767,0.024801080530251263,0.005865879005356734,0.0266798621146373,0.004714323520306963,0.027831417599687068,0.030134945481475956,0.0024107956385180755,0.030025509257952537,0.002520231862041495,0.027669549928880696,0.004876191191113335,0.02357807994554435,0.008967661174449682,0.019818542172781905,0.012727198947212127,0.01683642732068688,0.01570931379930715,0.030134945481475956,0.0024107956385180755,0.030134904294246354,0.002410836825747678,0.030085163431949863,0.0024605776880441688,0.02960871101448484,0.002937030105509192,0.02845050604981479,0.00409523507017924,0.026805634372997017,0.005740106746997015,0.030134945481475956,0.0024107956385180755,0.030134945480816022,0.0024107956391780094,0.030134746047593638,0.002410995072400394,0.030121565034300902,0.00242417608569313,0.030025509257952537,0.002520231862041495,0.029750177490535098,0.002795563629458934,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945316609763,0.002410795803384269,0.030134827597792693,0.0024109135222013384,0.030131793430028052,0.00241394768996598,0.030112312083127493,0.0024334290368665384,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.03013494548144781,0.002410795638546223,0.030134945118690085,0.0024107960013039463,0.030134904294246354,0.002410836825747678,0.030134241071809082,0.0024115000481849495,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481085876,0.002410795638908156,0.030134945236912822,0.002410795883081209,0.030134933820556622,0.00241080729943741,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.03013494548147581,0.0024107956385182212,0.030134945480816022,0.0024107956391780094,0.030134945378764152,0.00241079574122988,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475148,0.002410795638518884,0.03013494548099457,0.0024107956389994613,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481474756,0.002410795638519276,0.07552865110690239,0.006042292088552198,0,0.08157094319545459,0,0.08157094319545459,0,0.08157094319545459,0,0.08157094319545459,0,0.08157094319545459,0.07552865110690239,0.006042292088552198,0.049672157467004714,0.031898785728449876,0.028330422988640913,0.05324052020681368,0.01941081220749595,0.06216013098795864,0.014701932316527057,0.06686901087892753,0.01181573388241912,0.06975520931303547,0.07552865110690239,0.006042292088552198,0.07525436588046858,0.006316577314986013,0.0693495126496273,0.012221430545827291,0.05909486629309973,0.022476076902354862,0.049672157467004714,0.031898785728449876,0.04219794078514446,0.03937300241031013,0.07552865110690239,0.006042292088552198,0.07552854787738447,0.006042395318070118,0.07540387998188562,0.0061670632135689685,0.07420972456422022,0.007361218631234373,0.07130686022220178,0.010264082973252805,0.0671842398885973,0.01438670330685729,0.07552865110690239,0.006042292088552198,0.07552865110524837,0.006042292090206222,0.0755281512562514,0.006042791939203193,0.07549511505398468,0.006075828141469911,0.07525436588046858,0.006316577314986013,0.07456428874020292,0.007006654455251671,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865069369039,0.006042292501764204,0.07552835564940473,0.00604258754604986,0.07552075097002556,0.0060501922254290325,0.0754719239411514,0.006099019254303187,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110683185,0.006042292088622739,0.07552865019763486,0.006042292997819734,0.07552854787738447,0.006042395318070118,0.07552688561135841,0.00604405758409618,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110592472,0.006042292089529874,0.07552865049394215,0.006042292701512436,0.07552862188058411,0.00604232131487048,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690202,0.006042292088552573,0.07552865110524837,0.006042292090206222,0.0755286508494709,0.006042292345983691,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690037,0.006042292088554224,0.07552865110569587,0.006042292089758719,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110689938,0.0060422920885552095,0.14495595106022505,0.011596476084818008,0,0.15655242714504305,0,0.15655242714504305,0,0.15655242714504305,0,0.15655242714504305,0,0.15655242714504305,0.14495595106022505,0.011596476084818008,0.09533170156384417,0.061220725581198884,0.05437225937537772,0.10218016776966533,0.0372535812986585,0.11929884584638456,0.028216213981484408,0.12833621316355864,0.02267696982932168,0.13387545731572137,0.14495595106022505,0.011596476084818008,0.1444295379007578,0.012122889244285256,0.13309683695345575,0.0234555901915873,0.1134159344931061,0.04313649265193696,0.09533170156384417,0.061220725581198884,0.0809870499426233,0.07556537720241975,0.14495595106022505,0.011596476084818008,0.1449557529402702,0.011596674204772867,0.14471648806404283,0.011835939081000224,0.14242464342304156,0.014127783722001491,0.13685341375947296,0.01969901338557009,0.1289412063711532,0.02761122077388986,0.14495595106022505,0.011596476084818008,0.1449559510570506,0.011596476087992441,0.14495499173782964,0.011597435407213419,0.14489158806188934,0.011660839083153712,0.1444295379007578,0.012122889244285256,0.1431051293921172,0.013447297752925857,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.1449559502671811,0.011596476877861944,0.14495538401286032,0.011597043132182738,0.14494078897487458,0.01161163817016847,0.14484707925936705,0.01170534788567601,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106008966,0.0115964760849534,0.14495594931514239,0.01159647782990067,0.1449557529402702,0.011596674204772867,0.14495256268929665,0.0115998644557464,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.1449559510583487,0.011596476086694368,0.14495594988382068,0.011596477261222371,0.14495589496854724,0.01159653217649581,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022433,0.01159647608481873,0.1449559510570506,0.011596476087992441,0.14495595056615787,0.011596476578885184,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022116,0.011596476084821894,0.14495595105790948,0.011596476087133573,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106021927,0.011596476084823781,0.24035011510519608,0.01922800920841569,0,0.25957812431361177,0,0.25957812431361177,0,0.25957812431361177,0,0.25957812431361177,0,0.25957812431361177,0.24035011510519608,0.01922800920841569,0.15806860826655167,0.1015095160470601,0.09015413788684036,0.16942398642677142,0.06176981688384261,0.19780830742976915,0.046785042136455575,0.2127930821771562,0.03760047289434867,0.2219776514192631,0.24035011510519608,0.01922800920841569,0.2394772743384291,0.02010084997518266,0.2206866282337711,0.03889149607984066,0.1880539067958367,0.07152421751777507,0.15806860826655167,0.1015095160470601,0.1342838747451805,0.12529424956843127,0.24035011510519608,0.01922800920841569,0.24034978660434042,0.019228337709271348,0.23995306373700548,0.01962506057660629,0.23615297744017577,0.023425146873435998,0.2269153733189082,0.03266275099470356,0.21379621579133118,0.04578190852228059,0.24035011510519608,0.01922800920841569,0.2403501150999326,0.019228009213679176,0.24034852446164903,0.019229599851962736,0.24024339541590178,0.019334728897709985,0.2394772743384291,0.02010084997518266,0.23728128490046657,0.022296839413145197,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011379025728,0.01922801052335449,0.24034917488923124,0.019228949424380526,0.24032497499240618,0.019253149321205587,0.24016959578414343,0.01940852852946834,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.2403501151049716,0.01922800920864018,0.24035011221169073,0.019228012101921044,0.24034978660434042,0.019228337709271348,0.24034449687885423,0.01923362743475754,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510208487,0.019228009211526897,0.24035011315461094,0.01922801115900083,0.2403500221001065,0.019228102213505266,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.2403501151051949,0.019228009208416857,0.2403501150999326,0.019228009213679176,0.2403501142859879,0.019228010027623865,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.2403501151051896,0.01922800920842216,0.24035011510135665,0.01922800921225512,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.2403501151051865,0.019228009208425267,0.36331001362610493,0.02906480109008841,0,0.39237481471619334,0,0.39237481471619334,0,0.39237481471619334,0,0.39237481471619334,0,0.39237481471619334,0.36331001362610493,0.02906480109008841,0.23893439034986674,0.1534404243663266,0.13627578688606842,0.25609902783012495,0.09337042756950069,0.29900438714669264,0.07071964283709263,0.3216551718791007,0.05683637103154638,0.33553844368464697,0.36331001362610493,0.02906480109008841,0.36199063921794733,0.030384175498246013,0.33358695033542424,0.058787864380769106,0.2842597658442339,0.10811504887195944,0.23893439034986674,0.1534404243663266,0.20298170584226605,0.1893931088739273,0.36331001362610493,0.02906480109008841,0.363309517068613,0.029065297647580368,0.3627098360979001,0.02966497861829326,0.356965676567636,0.03540913814855734,0.34300223794934626,0.04937257676684709,0.32317149520965205,0.0692033195065413,0.36331001362610493,0.02906480109008841,0.3633100136181487,0.029064801098044657,0.3633076092306317,0.02906720548556163,0.3631486975736674,0.02922611714252593,0.36199063921794733,0.030384175498246013,0.3586712110068156,0.03370360370937775,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001163846105,0.029064803077732293,0.3633085924082501,0.029066222307943257,0.3632720121684553,0.02910280254773806,0.3630371430391168,0.029337671677076516,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.3633100136257656,0.02906480109042775,0.36331000925232104,0.0290648054638723,0.363309517068613,0.029065297647580368,0.36330152119044323,0.02907329352575011,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.3633100136214021,0.02906480109479126,0.3633100106776266,0.02906480403856676,0.36330987304085766,0.029064941675335687,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610316,0.029064801090090187,0.3633100136181487,0.029064801098044657,0.3633100123878008,0.029064802328392536,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362609516,0.02906480109009818,0.3633100136203013,0.029064801095892046,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362609044,0.0290648010901029,0.5152118418589741,0.04121694734871795,0,0.556428789207692,0,0.556428789207692,0,0.556428789207692,0,0.556428789207692,0,0.556428789207692,0.5152118418589741,0.04121694734871795,0.33883411609539155,0.21759467311230046,0.19325341039074367,0.36317537881694834,0.1324090945997142,0.42401969460797784,0.10028789759481951,0.4561408916128725,0.080599956801298,0.475828832406394,0.5152118418589741,0.04121694734871795,0.5133408300689494,0.04308795913874264,0.47306140942018554,0.08336737978750647,0.4031102695609413,0.1533185196467507,0.33883411609539155,0.21759467311230046,0.287849425032077,0.268579364175615,0.5152118418589741,0.04121694734871795,0.5152111376881822,0.041217651519509846,0.5143607269484255,0.042068062259266514,0.5062149040959764,0.05021388511171565,0.48641327832350995,0.07001551088418206,0.45829119770597976,0.09813759150171225,0.5152118418589741,0.04121694734871795,0.5152118418476913,0.0412169473600007,0.5152084321731029,0.04122035703458915,0.5149830787162568,0.041445710491435195,0.5133408300689494,0.04308795913874264,0.5086335314577531,0.04779525774993887,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118390402858,0.04121695016740623,0.5152098264224565,0.04121896278523551,0.5151579517919386,0.041270837415753436,0.5148248826438725,0.041603906563819515,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418584929,0.04121694734919912,0.5152118356564881,0.041216953551203916,0.5152111376881822,0.041217651519509846,0.5151997986912797,0.04122899051641227,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.515211841852305,0.04121694735538706,0.5152118376777214,0.041216951529970625,0.5152116424942952,0.041217146713396824,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589715,0.0412169473487205,0.5152118418476913,0.0412169473600007,0.5152118401029285,0.04121694910476348,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589602,0.041216947348731825,0.5152118418507439,0.04121694735694814,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589535,0.041216947348738486,0.6972711386085182,0.05578169108868147,0,0.7530528296971997,0,0.7530528296971997,0,0.7530528296971997,0,0.7530528296971997,0,0.7530528296971997,0.6972711386085182,0.05578169108868147,0.4585671965084886,0.29448563318871107,0.2615429509867854,0.49150987871041424,0.17919821062447028,0.5738546190727294,0.13572641555031498,0.6173264141468847,0.10908138960443721,0.6439714400927624,0.6972711386085182,0.05578169108868147,0.694738971419827,0.05831385827737268,0.6402260988179144,0.1128267308792853,0.54555647561859,0.20749635407860967,0.4585671965084886,0.29448563318871107,0.3895661551872143,0.36348667450998534,0.6972711386085182,0.05578169108868147,0.6972701856064131,0.05578264409078659,0.6961192670587036,0.05693356263849603,0.68509497236327,0.06795785733392967,0.6582960888227656,0.09475674087443409,0.620236569263832,0.1328162604333677,0.6972711386085182,0.05578169108868147,0.6972711385932485,0.05578169110395115,0.6972665240493087,0.055786305647891,0.6969615379277213,0.05609129176947836,0.694738971419827,0.05831385827737268,0.6883682648565692,0.06468456484063045,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711347937962,0.055781694903403456,0.6972684109815477,0.055784418715651984,0.6971982055247871,0.055854624172412604,0.69674744045062,0.056305389246579685,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386078669,0.05578169108933273,0.6972711302142731,0.05578169948292655,0.6972701856064131,0.05578264409078659,0.6972548397726445,0.0557979899245552,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711385994924,0.05578169109770725,0.6972711329497453,0.05578169674745437,0.6972708687947731,0.0557819609024266,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085148,0.055781691088684915,0.6972711385932485,0.05578169110395115,0.6972711362319426,0.055781693465257076,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386084994,0.055781691088700236,0.6972711385973798,0.0557816910998199,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386084904,0.05578169108870923,0.9105812147454422,0.07284649717963532,0,0.9834277119250775,0,0.9834277119250775,0,0.9834277119250775,0,0.9834277119250775,0,0.9834277119250775,0.9105812147454422,0.07284649717963532,0.5988526581960699,0.3845750537290076,0.3415545041673768,0.6418732077577007,0.23401875579745435,0.7494089561276231,0.17724801372316637,0.8061796982019112,0.1424517074524958,0.8409760044725817,0.9105812147454422,0.07284649717963532,0.9072744037404459,0.07615330818463162,0.8360848836175104,0.14734282830756706,0.7124538085319069,0.2709739033931706,0.5988526581960699,0.3845750537290076,0.5087427302985627,0.47468498162651485,0.9105812147454422,0.07284649717963532,0.9105799701997175,0.07284774172536002,0.9090769611818227,0.07435075074325481,0.894680100190971,0.0887476117341065,0.8596828680140705,0.12374484391100704,0.8099801316843235,0.17344758024075402,0.9105812147454422,0.07284649717963532,0.9105812147255011,0.07284649719957637,0.9105751884943931,0.07285252343068438,0.9101769006294606,0.07325081129561695,0.9072744037404459,0.07615330818463162,0.8989547624991138,0.08447294942596373,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812097637156,0.0728465021613619,0.9105776526793495,0.07285005924572796,0.9104859698797052,0.0729417420453723,0.9098973061790693,0.07353040574600822,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147445916,0.07284649718048586,0.9105812037832189,0.07284650814185856,0.9105799701997175,0.07284774172536002,0.9105599297489076,0.07286778217616985,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147336553,0.07284649719142222,0.9105812073555302,0.07284650456954733,0.910580862389932,0.07284684953514553,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454377,0.07284649717963976,0.9105812147255011,0.07284649719957637,0.9105812116418215,0.07284650028325601,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454178,0.07284649717965974,0.9105812147308963,0.07284649719418124,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454059,0.07284649717967162,1.1561387938771825,0.09249110351017453,0,1.248629897387357,0,1.248629897387357,0,1.248629897387357,0,1.248629897387357,0,1.248629897387357,1.1561387938771825,0.09249110351017453,0.7603460062049501,0.488283891182407,0.43366193602157954,0.8149679613657775,0.2971268874110738,0.9515030099762833,0.22504670806361327,1.0235831893237437,0.18086683820499724,1.06776305918236,1.1561387938771825,0.09249110351017453,1.1519402309977966,0.09668966638956045,1.0615529436270215,0.18707695376033562,0.9045821213427431,0.344047776044614,0.7603460062049501,0.488283891182407,0.6459360209463503,0.6026938764410068,1.1561387938771825,0.09249110351017453,1.15613721371325,0.09249268367410712,1.1542288863669397,0.09440101102041742,1.1359496058019063,0.11268029158545079,1.0915146260957274,0.15711527129162972,1.02840849047362,0.22022140691373715,1.1561387938771825,0.09249110351017453,1.156138793851864,0.09249110353549317,1.156131142519449,0.09249875486790815,1.1556254478660535,0.0930044495213036,1.1519402309977966,0.09668966638956045,1.1413770216601942,0.10725287572716291,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387875520275,0.0924911098353296,1.1561342712242557,0.09249562616310136,1.156017864208952,0.09261203317840505,1.1552704548292816,0.09335944255807549,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938761027,0.09249110351125434,1.1561387799587628,0.09249111742859428,1.15613721371325,0.09249268367410712,1.156111768928916,0.0925181284584411,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.156138793862217,0.09249110352514012,1.1561387844944238,0.09249111289293332,1.1561383465015196,0.09249155088583749,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.156138793877177,0.09249110351018008,1.156138793851864,0.09249110353549317,1.1561387899366047,0.0924911074507524,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771515,0.09249110351020562,1.156138793858714,0.09249110352864309,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771364,0.09249110351022072],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.000499467266285379,0.000028378821948032876,0,0.0005278460882334119,0,0.0005278460882334119,0,0.0005278460882334119,0,0.0005278460882334119,0,0.0005278460882334119,0.000499467266285379,0.000028378821948032876,0.00029870251462751473,0.00022914357360589717,0.00016581092700669137,0.00036203516122672053,0.0001129085740508408,0.0004149375141825711,0.00008532493802213346,0.00044252115021127845,0.00006850143386520447,0.00045934465436820745,0.000499467266285379,0.000028378821948032876,0.0004954846283844596,0.000032361459848952276,0.0004400272887071367,0.00008781879952627519,0.0003625915302746168,0.0001652545579587951,0.00029870251462751473,0.00022914357360589717,0.0002507694111135436,0.0002770766771198683,0.000499467266285379,0.000028378821948032876,0.0004994632403672465,0.00002838284786616538,0.0004974658802402898,0.000030380207993122065,0.00048381934403515076,0.000044026744198261136,0.00045662879685087824,0.00007121729138253365,0.0004225857687292636,0.00010526031950414832,0.000499467266285379,0.000028378821948032876,0.0004994672660289236,0.000028378822204488323,0.000499451260848013,0.000028394827385398854,0.0004988327841306487,0.000029013304102763196,0.0004954846283844596,0.000032361459848952276,0.00048754883142875904,0.00004029725680465286,0.000499467266285379,0.000028378821948032876,0.0004994672662853779,0.00002837882194803396,0.0004994672341532634,0.00002837885408014853,0.0004994571628863143,0.000028388925347097626,0.0004992881395966617,0.000028557948636750226,0.0004984625095991039,0.000029383578634308016,0.000499467266285379,0.000028378821948032876,0.000499467266285379,0.000028378821948032876,0.0004994672662691536,0.000028378821964258286,0.0004994672022170767,0.000028378886016335188,0.0004994632403672465,0.00002838284786616538,0.0004994189848952699,0.000028427103338142003,0.000499467266285379,0.000028378821948032876,0.000499467266285379,0.000028378821948032876,0.000499467266285377,0.000028378821948034936,0.000499467266123493,0.000028378822109918897,0.0004994672209130294,0.000028378867320382525,0.0004994659317199914,0.000028380156513420547,0.000499467266285379,0.000028378821948032876,0.000499467266285379,0.000028378821948032876,0.000499467266285379,0.000028378821948032876,0.0004994672662852161,0.00002837882194819583,0.0004994672660289236,0.000028378822204488323,0.0004994672450472144,0.00002837884318619753,0.000499467266285379,0.000028378821948032876,0.000499467266285379,0.000028378821948032876,0.000499467266285379,0.000028378821948032876,0.0004994672662853789,0.000028378821948032984,0.0004994672662846521,0.000028378821948759833,0.0004994672660907846,0.000028378822142627325,0.000499467266285379,0.000028378821948032876,0.000499467266285379,0.000028378821948032876,0.000499467266285379,0.000028378821948032876,0.000499467266285379,0.000028378821948032876,0.0004994672662853779,0.00002837882194803396,0.0004994672662843525,0.000028378821949059398,0.004336408206232626,0.00024638682989958083,0,0.004582795036132207,0,0.004582795036132207,0,0.004582795036132207,0,0.004582795036132207,0,0.004582795036132207,0.004336408206232626,0.00024638682989958083,0.0025933552068114645,0.0019894398293207427,0.0014395815563697603,0.003143213479762447,0.000980279790324315,0.003602515245807892,0.0007407968177519403,0.003841998218380267,0.0005947340296411929,0.0039880610064910145,0.004336408206232626,0.00024638682989958083,0.004301830677650138,0.0002809643584820694,0.003820346346031962,0.0007624486901002454,0.0031480439130417578,0.0014347511230904495,0.0025933552068114645,0.0019894398293207427,0.0021771967967237466,0.0024055982394084606,0.004336408206232626,0.00024638682989958083,0.0043363732529421795,0.00024642178319002773,0.004319032038752602,0.00026376299737960497,0.004200551898849292,0.00038224313728291506,0.003964481749910913,0.0006183132862212946,0.003668917903235863,0.0009138771328963441,0.004336408206232626,0.00024638682989958083,0.004336408204006063,0.0002463868321261444,0.0043362692459551,0.00024652579017710695,0.004330899589736208,0.0002518954463959994,0.004301830677650138,0.0002809643584820694,0.004232931557798641,0.00034986347833356607,0.004336408206232626,0.00024638682989958083,0.004336408206232617,0.00024638682989959037,0.004336407927259449,0.00024638710887275785,0.004336320487846312,0.000246474548285895,0.0043348530163426335,0.00024794201978957375,0.00432768484149236,0.000255110194639847,0.004336408206232626,0.00024638682989958083,0.004336408206232626,0.00024638682989958083,0.0043364082060917564,0.0002463868300404508,0.004336407649987341,0.0002463873861448659,0.0043363732529421795,0.00024642178319002773,0.004335989023975029,0.0002468060121571785,0.004336408206232626,0.00024638682989958083,0.004336408206232626,0.00024638682989958083,0.004336408206232608,0.00024638682989959904,0.004336408204827121,0.0002463868313050859,0.0043364078123068524,0.0002463872238253548,0.004336396619446686,0.00024639841668552126,0.004336408206232626,0.00024638682989958083,0.004336408206232626,0.00024638682989958083,0.004336408206232626,0.00024638682989958083,0.004336408206231212,0.0002463868299009955,0.004336408204006063,0.0002463868321261444,0.004336408021841461,0.00024638701429074636,0.004336408206232626,0.00024638682989958083,0.004336408206232626,0.00024638682989958083,0.004336408206232626,0.00024638682989958083,0.0043364082062326255,0.0002463868298995817,0.004336408206226315,0.0002463868299058926,0.0043364082045431445,0.0002463868315890627,0.004336408206232626,0.00024638682989958083,0.004336408206232626,0.00024638682989958083,0.004336408206232626,0.00024638682989958083,0.004336408206232626,0.00024638682989958083,0.004336408206232617,0.00024638682989959037,0.004336408206223714,0.00024638682990849297,0.015352867045065383,0.000872321991196896,0,0.01622518903626228,0,0.01622518903626228,0,0.01622518903626228,0,0.01622518903626228,0,0.01622518903626228,0.015352867045065383,0.000872321991196896,0.009181662748811005,0.007043526287451274,0.005096776683455889,0.011128412352806389,0.0034706385035851994,0.01275455053267708,0.0026227593227976997,0.013602429713464578,0.0021056302935534535,0.014119558742708826,0.015352867045065383,0.000872321991196896,0.015230446789907924,0.0009947422463543552,0.013525772189165442,0.0026994168470968367,0.011145514294408826,0.005079674741853453,0.009181662748811005,0.007043526287451274,0.007708271768095806,0.008516917268166474,0.015352867045065383,0.000872321991196896,0.015352743294441478,0.0008724457418208004,0.015291347470249949,0.0009338415660123302,0.014871873622561475,0.0013533154137008035,0.014036077397300551,0.002189111638961728,0.01298964628991354,0.003235542746348739,0.015352867045065383,0.000872321991196896,0.01535286703718233,0.0008723219990799495,0.015352375062169875,0.000872813974092404,0.01533336402490455,0.0008918250113577296,0.015230446789907924,0.0009947422463543552,0.014986512414661217,0.0012386766216010616,0.015352867045065383,0.000872321991196896,0.01535286704506535,0.0008723219911969289,0.015352866057372828,0.0008723229788894504,0.01535255648188534,0.0008726325543769384,0.015347360962041057,0.0008778280742212218,0.015321982346791264,0.0009032066894710152,0.015352867045065383,0.000872321991196896,0.015352867045065383,0.000872321991196896,0.015352867044566638,0.0008723219916956411,0.015352865075702838,0.0008723239605594405,0.015352743294441478,0.0008724457418208004,0.015351382948282404,0.0008738060879798747,0.015352867045065383,0.000872321991196896,0.015352867045065383,0.000872321991196896,0.01535286704506532,0.0008723219911969584,0.015352867040089252,0.0008723219961730266,0.015352865650388096,0.0008723233858741828,0.015352826022547306,0.0008723630137149729,0.015352867045065383,0.000872321991196896,0.015352867045065383,0.000872321991196896,0.015352867045065383,0.000872321991196896,0.015352867045060373,0.0008723219912019058,0.01535286703718233,0.0008723219990799495,0.01535286639223638,0.0008723226440258986,0.015352867045065383,0.000872321991196896,0.015352867045065383,0.000872321991196896,0.015352867045065383,0.000872321991196896,0.015352867045065381,0.0008723219911968977,0.015352867045043036,0.0008723219912192427,0.015352867039083845,0.0008723219971784341,0.015352867045065383,0.000872321991196896,0.015352867045065383,0.000872321991196896,0.015352867045065383,0.000872321991196896,0.015352867045065383,0.000872321991196896,0.01535286704506535,0.0008723219911969289,0.015352867045033828,0.0008723219912284506,0.03764898603052285,0.0021391469335524313,0,0.03978813296407528,0,0.03978813296407528,0,0.03978813296407528,0,0.03978813296407528,0,0.03978813296407528,0.03764898603052285,0.0021391469335524313,0.022515683328220043,0.01727244963585524,0.01249854334000768,0.0272895896240676,0.008510854692802912,0.03127727827127237,0.006431647510239587,0.033356485453835696,0.005163520616360688,0.03462461234771459,0.03764898603052285,0.0021391469335524313,0.03734878161510341,0.0024393513489718716,0.0331685024502051,0.006619630513870184,0.027331527768819003,0.012456605195256279,0.022515683328220043,0.01727244963585524,0.018902568182519994,0.020885564781555288,0.03764898603052285,0.0021391469335524313,0.0376486825637178,0.0021394504003574843,0.037498124982483325,0.002290007981591957,0.03646947248484648,0.0033186604792288035,0.03441989566529562,0.005368237298779659,0.03185379058353626,0.007934342380539021,0.03764898603052285,0.0021391469335524313,0.037648986011191675,0.002139146952883607,0.03764777956810082,0.002140353395974459,0.037601159853729096,0.0021869731103461854,0.03734878161510341,0.0024393513489718716,0.0367505948491352,0.0030375381149400846,0.03764898603052285,0.0021391469335524313,0.037648986030522774,0.0021391469335525076,0.03764898360845907,0.00213914935561621,0.03764822445362697,0.0021399085104483115,0.03763548376789937,0.0021526491961759084,0.03757324919449958,0.0022148837695757026,0.03764898603052285,0.0021391469335524313,0.03764898603052285,0.0021391469335524313,0.03764898602929981,0.002139146934775474,0.03764898120116409,0.0021391517629111914,0.0376486825637178,0.0021394504003574843,0.03764534666213085,0.0021427863019444285,0.03764898603052285,0.0021391469335524313,0.03764898603052285,0.0021391469335524313,0.0376489860305227,0.002139146933552584,0.03764898601832016,0.0021391469457551215,0.03764898261043294,0.002139150353642344,0.03764888543327248,0.0021392475308028014,0.03764898603052285,0.0021391469335524313,0.03764898603052285,0.0021391469335524313,0.03764898603052285,0.0021391469335524313,0.03764898603051057,0.002139146933564713,0.037648986011191675,0.002139146952883607,0.03764898442962642,0.0021391485344488606,0.03764898603052285,0.0021391469335524313,0.03764898603052285,0.0021391469335524313,0.03764898603052285,0.0021391469335524313,0.037648986030522844,0.0021391469335524382,0.037648986030468054,0.0021391469336072277,0.03764898601585465,0.0021391469482206285,0.03764898603052285,0.0021391469335524313,0.03764898603052285,0.0021391469335524313,0.03764898603052285,0.0021391469335524313,0.03764898603052285,0.0021391469335524313,0.037648986030522774,0.0021391469335525076,0.037648986030445475,0.002139146933629807,0.07549573874459967,0.004289530610488618,0,0.07978526935508828,0,0.07978526935508828,0,0.07978526935508828,0,0.07978526935508828,0,0.07978526935508828,0.07549573874459967,0.004289530610488618,0.04514963948365948,0.034635629871428805,0.025062740386163115,0.05472252896892517,0.017066416127653028,0.06271885322743526,0.012897079877177758,0.06688818947791053,0.010354164734717744,0.06943110462037054,0.07549573874459967,0.004289530610488618,0.07489375296739688,0.004891516387691405,0.06651123601310764,0.013274033341980643,0.05480662555567037,0.024978643799417916,0.04514963948365948,0.034635629871428805,0.037904429828536694,0.04188083952655159,0.07549573874459967,0.004289530610488618,0.07549513021690615,0.004290139138182131,0.07519322418921975,0.00459204516586853,0.07313051577636603,0.00665475357872225,0.06902059589750523,0.010764673457583057,0.06387490621846226,0.015910363136626027,0.07549573874459967,0.004289530610488618,0.07549573870583577,0.004289530649252513,0.07549331948231874,0.00429194987276954,0.07539983516447545,0.004385434190612839,0.07489375296739688,0.004891516387691405,0.07369423721503636,0.006091032140051925,0.07549573874459967,0.004289530610488618,0.07549573874459951,0.00428953061048877,0.07549573388774923,0.0042895354673390534,0.07549421159031407,0.004291057764774217,0.07546866329320089,0.004316606061887399,0.07534386723387372,0.004441402121214563,0.07549573874459967,0.004289530610488618,0.07549573874459967,0.004289530610488618,0.07549573874214716,0.004289530612941128,0.07549572906051397,0.004289540294574318,0.07549513021690615,0.004290139138182131,0.07548844089054606,0.004296828464542227,0.07549573874459967,0.004289530610488618,0.07549573874459967,0.004289530610488618,0.07549573874459936,0.004289530610488923,0.07549573872013018,0.0042895306349581,0.07549573188645442,0.004289537468633864,0.07549553702167076,0.00428973233341752,0.07549573874459967,0.004289530610488618,0.07549573874459967,0.004289530610488618,0.07549573874459967,0.004289530610488618,0.07549573874457503,0.004289530610513251,0.07549573870583577,0.004289530649252513,0.07549573553439745,0.004289533820690833,0.07549573874459967,0.004289530610488618,0.07549573874459967,0.004289530610488618,0.07549573874459967,0.004289530610488618,0.07549573874459965,0.004289530610488632,0.07549573874448978,0.004289530610598502,0.07549573871518622,0.004289530639902062,0.07549573874459967,0.004289530610488618,0.07549573874459967,0.004289530610488618,0.07549573874459967,0.004289530610488618,0.07549573874459967,0.004289530610488618,0.07549573874459951,0.00428953061048877,0.0754957387444445,0.004289530610643785,0.13329461836119708,0.007573557861431657,0,0.14086817622262873,0,0.14086817622262873,0,0.14086817622262873,0,0.14086817622262873,0,0.14086817622262873,0.13329461836119708,0.007573557861431657,0.07971580998073904,0.06115236624188969,0.0442505559970872,0.09661762022554153,0.030132315576441904,0.11073586064618683,0.022770971829522688,0.11809720439310605,0.018281223016204894,0.12258695320642383,0.13329461836119708,0.007573557861431657,0.13223175751944058,0.008636418703188153,0.11743165864090388,0.023436517581724853,0.09676610042617381,0.04410207579645492,0.07971580998073904,0.06115236624188969,0.0669237309576626,0.07394444526496613,0.13329461836119708,0.007573557861431657,0.1332935439500049,0.007574632272623838,0.13276050129871642,0.008107674923912317,0.12911860130205688,0.011749574920571854,0.12186216258303002,0.01900601363959871,0.11277697773182216,0.028091198490806574,0.13329461836119708,0.007573557861431657,0.13329461829275588,0.007573557929872854,0.13329034693279843,0.007577829289830307,0.133125291835956,0.007742884386672727,0.13223175751944058,0.008636418703188153,0.13011390296118477,0.010754273261443958,0.13329461836119708,0.007573557861431657,0.1332946183611968,0.007573557861431934,0.13329460978598426,0.007573566436644474,0.13329192203089998,0.0075762541917287485,0.13324681418017745,0.007621362042451285,0.1330264753454616,0.007841700877167124,0.13329461836119708,0.007573557861431657,0.13329461836119708,0.007573557861431657,0.13329461835686693,0.007573557865761804,0.13329460126305975,0.007573574959568979,0.1332935439500049,0.007574632272623838,0.13328173333368284,0.007586442888945888,0.13329461836119708,0.007573557861431657,0.13329461836119708,0.007573557861431657,0.13329461836119652,0.007573557861432212,0.13329461831799397,0.0075735579046347645,0.1332946062525156,0.007573569970113131,0.13329426220095186,0.00757391402167687,0.13329461836119708,0.007573557861431657,0.13329461836119708,0.007573557861431657,0.13329461836119708,0.007573557861431657,0.13329461836115358,0.00757355786147515,0.13329461829275588,0.007573557929872854,0.13329461269329201,0.007573563529336719,0.13329461836119708,0.007573557861431657,0.13329461836119708,0.007573557861431657,0.13329461836119708,0.007573557861431657,0.13329461836119705,0.0075735578614316845,0.13329461836100306,0.007573557861625668,0.13329461830926495,0.007573557913363782,0.13329461836119708,0.007573557861431657,0.13329461836119708,0.007573557861431657,0.13329461836119708,0.007573557861431657,0.13329461836119708,0.007573557861431657,0.1332946183611968,0.007573557861431934,0.13329461836092313,0.007573557861705604,0.21555360244092653,0.012247363775052644,0,0.22780096621597917,0,0.22780096621597917,0,0.22780096621597917,0,0.22780096621597917,0,0.22780096621597917,0.21555360244092653,0.012247363775052644,0.12891015574449297,0.0988908104714862,0.07155852856219116,0.156242437653788,0.048727617455557155,0.17907334876042202,0.03682342970242021,0.19097753651355898,0.029562960055078077,0.1982380061609011,0.21555360244092653,0.012247363775052644,0.21383482724841882,0.013966138967560354,0.18990126812222988,0.037899698093749296,0.15648254818886387,0.0713184180271153,0.12891015574449297,0.0988908104714862,0.10822380883841394,0.11957715737756523,0.21555360244092653,0.012247363775052644,0.21555186498741322,0.012249101228565956,0.21468987021858807,0.013111095997391103,0.20880047518028033,0.01900049103569884,0.19706593161048983,0.030735034605489348,0.18237408322533646,0.04542688299064271,0.21555360244092653,0.012247363775052644,0.21555360233024878,0.012247363885730389,0.2155466950219308,0.012254271194048372,0.21527978086468244,0.012521185351296732,0.21383482724841882,0.013966138967560354,0.2104099989613462,0.01739096725463296,0.21555360244092653,0.012247363775052644,0.21555360244092608,0.012247363775053088,0.21555358857376494,0.01224737764221423,0.2155492421470448,0.012251724068934378,0.21547629726869072,0.012324668947288453,0.2151199825864885,0.01268098362949066,0.21555360244092653,0.012247363775052644,0.21555360244092653,0.012247363775052644,0.21555360243392416,0.012247363782055015,0.21555357479115989,0.012247391424819287,0.21555186498741322,0.012249101228565956,0.21553276578501054,0.012268200430968629,0.21555360244092653,0.012247363775052644,0.21555360244092653,0.012247363775052644,0.21555360244092564,0.012247363775053532,0.21555360237106186,0.012247363844917314,0.21555358285971654,0.012247383356262631,0.21555302648651184,0.012247939729467333,0.21555360244092653,0.012247363775052644,0.21555360244092653,0.012247363775052644,0.21555360244092653,0.012247363775052644,0.2155536024408562,0.012247363775122977,0.21555360233024878,0.012247363885730389,0.215553593275235,0.012247372940744183,0.21555360244092653,0.012247363775052644,0.21555360244092653,0.012247363775052644,0.21555360244092653,0.012247363775052644,0.2155536024409265,0.012247363775052672,0.21555360244061278,0.012247363775366393,0.21555360235694598,0.012247363859033189,0.21555360244092653,0.012247363775052644,0.21555360244092653,0.012247363775052644,0.21555360244092653,0.012247363775052644,0.21555360244092653,0.012247363775052644,0.21555360244092608,0.012247363775053088,0.21555360244048352,0.012247363775495651,0.32687101437757626,0.018572216725998625,0,0.3454432311035749,0,0.3454432311035749,0,0.3454432311035749,0,0.3454432311035749,0,0.3454432311035749,0.32687101437757626,0.018572216725998625,0.1954826683229365,0.14996056278063838,0.10851318907973455,0.23693004202384033,0.07389180958024352,0.27155142152333134,0.055839993780619504,0.2896032373229554,0.044830031285862666,0.30061319981771223,0.32687101437757626,0.018572216725998625,0.3242646195676543,0.0211786115359206,0.28797115631464715,0.05747207478892774,0.23729415180105692,0.10814907930251796,0.1954826683229365,0.14996056278063838,0.16411336101196458,0.1813298700916103,0.32687101437757626,0.018572216725998625,0.32686837965848137,0.01857485144509352,0.3255612286701268,0.019882002433448065,0.3166303988976599,0.028812832205914962,0.29883583589114987,0.04660739521242502,0.2765567399709008,0.06888649113267409,0.32687101437757626,0.018572216725998625,0.3268710142097417,0.018572216893833204,0.32686053979014973,0.01858269131342516,0.3264557843124239,0.018987446791150997,0.3242646195676543,0.0211786115359206,0.31907112206361127,0.02637210903996362,0.32687101437757626,0.018572216725998625,0.3268710143775756,0.01857221672599929,0.32687099334905656,0.018572237754518328,0.32686440231603814,0.01857882878753675,0.32675378683055684,0.018689444273018052,0.32621346210255336,0.019229769001021524,0.32687101437757626,0.018572216725998625,0.32687101437757626,0.018572216725998625,0.3268710143669577,0.018572216736617186,0.32687097244876057,0.018572258654814322,0.32686837965848137,0.01857485144509352,0.3268394171378254,0.018603813965749505,0.32687101437757626,0.018572216725998625,0.32687101437757626,0.018572216725998625,0.32687101437757493,0.018572216725999957,0.3268710142716317,0.01857221683194321,0.32687098468412695,0.018572246419447935,0.3268701409855214,0.01857309011805347,0.32687101437757626,0.018572216725998625,0.32687101437757626,0.018572216725998625,0.32687101437757626,0.018572216725998625,0.3268710143774696,0.018572216726105262,0.3268710142097417,0.018572216893833204,0.3268710004784864,0.018572230625088504,0.32687101437757626,0.018572216725998625,0.32687101437757626,0.018572216725998625,0.32687101437757626,0.018572216725998625,0.3268710143775762,0.01857221672599868,0.3268710143771005,0.01857221672647441,0.326871014250226,0.018572216853348866,0.32687101437757626,0.018572216725998625,0.32687101437757626,0.018572216725998625,0.32687101437757626,0.018572216725998625,0.32687101437757626,0.018572216725998625,0.3268710143775756,0.01857221672599929,0.32687101437690447,0.01857221672667042,0.47192387252216383,0.026813856393304747,0,0.4987377289154686,0,0.4987377289154686,0,0.4987377289154686,0,0.4987377289154686,0,0.4987377289154686,0.47192387252216383,0.026813856393304747,0.28223040217130546,0.21650732674416312,0.15666719335072118,0.3420705355647474,0.10668216939082337,0.3920555595246452,0.08061964795729314,0.41811808095817543,0.06472388507742037,0.4340138438380482,0.47192387252216383,0.026813856393304747,0.4681608593520844,0.03057686956338418,0.41576174480161127,0.08297598411385732,0.3425962233392184,0.15614150557625017,0.28223040217130546,0.21650732674416312,0.2369405956929882,0.2617971332224804,0.47192387252216383,0.026813856393304747,0.4719200686154741,0.026817660299994495,0.47003285399789746,0.02870487491757112,0.45713886344604526,0.04159886546942332,0.4314477537590557,0.06728997515641288,0.3992820469190124,0.09945568199645616,0.47192387252216383,0.026813856393304747,0.4719238722798507,0.02681385663561786,0.47190874971333724,0.026828979202131342,0.4713243792305746,0.027413349684894006,0.4681608593520844,0.03057686956338418,0.4606626862310776,0.03807504268439099,0.47192387252216383,0.026813856393304747,0.47192387252216283,0.026813856393305746,0.4719238421619911,0.026813886753477456,0.47191432628052976,0.02682340263493882,0.4717546238720165,0.026983105043452082,0.4709745236892443,0.027763205226224275,0.47192387252216383,0.026813856393304747,0.47192387252216383,0.026813856393304747,0.47192387250683315,0.026813856408635428,0.4719238119869429,0.026813916928525694,0.4719200686154741,0.026817660299994495,0.4718782536355438,0.02685947527992477,0.47192387252216383,0.026813856393304747,0.47192387252216383,0.026813856393304747,0.4719238725221619,0.02681385639330669,0.4719238723692051,0.026813856546263504,0.47192382965189705,0.026813899263571528,0.4719226115521095,0.026815117363359064,0.47192387252216383,0.026813856393304747,0.47192387252216383,0.026813856393304747,0.47192387252216383,0.026813856393304747,0.47192387252200985,0.026813856393458735,0.4719238722798507,0.02681385663561786,0.47192385245518936,0.026813876460279218,0.47192387252216383,0.026813856393304747,0.47192387252216383,0.026813856393304747,0.47192387252216383,0.026813856393304747,0.4719238725221638,0.026813856393304802,0.47192387252147694,0.026813856393991642,0.4719238723383004,0.02681385657716817,0.47192387252216383,0.026813856393304747,0.47192387252216383,0.026813856393304747,0.47192387252216383,0.026813856393304747,0.47192387252216383,0.026813856393304747,0.47192387252216283,0.026813856393305746,0.4719238725211939,0.026813856394274693,0.655459052326809,0.03724199160947772,0,0.6927010439362867,0,0.6927010439362867,0,0.6927010439362867,0,0.6927010439362867,0,0.6927010439362867,0.655459052326809,0.03724199160947772,0.39199218924092466,0.30070885469536207,0.2175963880266343,0.47510465590965245,0.14817176608456725,0.5445292778517195,0.11197330994635488,0.5807277339899318,0.08989555062985889,0.6028054933064279,0.655459052326809,0.03724199160947772,0.6502325715531801,0.04246847238310658,0.5774549988009053,0.11524604513538139,0.4758347880994759,0.21686625583681085,0.39199218924092466,0.30070885469536207,0.3290887945139537,0.36361224942233306,0.655459052326809,0.03724199160947772,0.6554537690486805,0.03724727488760626,0.6528326007272667,0.039868443209020055,0.6349240283495662,0.05777701558672055,0.5992414291229983,0.09345961481328846,0.5545662072273173,0.13813483670896942,0.655459052326809,0.03724199160947772,0.6554590519902583,0.0372419919460284,0.6554380481299054,0.03726299580638137,0.6546264110309125,0.03807463290537427,0.6502325715531801,0.04246847238310658,0.6398182955772458,0.05288274835904094,0.655459052326809,0.03724199160947772,0.6554590523268077,0.03724199160947905,0.6554590101593087,0.03724203377697799,0.6554457934711777,0.037255250465109024,0.655223981447177,0.03747706248910976,0.6541404937147444,0.03856055022154237,0.655459052326809,0.03724199160947772,0.655459052326809,0.03724199160947772,0.6554590523055162,0.03724199163077058,0.6554589682489294,0.03724207568735738,0.6554537690486805,0.03724727488760626,0.6553956918698939,0.03730535206639285,0.655459052326809,0.03724199160947772,0.655459052326809,0.03724199160947772,0.6554590523268063,0.037241991609480385,0.6554590521143633,0.03724199182192345,0.6554589927839334,0.03724205115235335,0.6554573009548507,0.03724374298143607,0.655459052326809,0.03724199160947772,0.655459052326809,0.03724199160947772,0.655459052326809,0.03724199160947772,0.6554590523265952,0.03724199160969155,0.6554590519902583,0.0372419919460284,0.6554590244556187,0.037242019480668076,0.655459052326809,0.03724199160947772,0.655459052326809,0.03724199160947772,0.655459052326809,0.03724199160947772,0.6554590523268089,0.03724199160947783,0.655459052325855,0.037241991610431735,0.6554590520714395,0.037241991864847224,0.655459052326809,0.03724199160947772,0.655459052326809,0.03724199160947772,0.655459052326809,0.03724199160947772,0.655459052326809,0.03724199160947772,0.6554590523268077,0.03724199160947905,0.6554590523254619,0.037241991610824865],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0000373441724108575,8.002322659469464e-7,0,0.00003814440467680445,0,0.00003814440467680445,0,0.00003814440467680445,0,0.00003814440467680445,0,0.00003814440467680445,0.0000373441724108575,8.002322659469464e-7,0.000021904439142046578,0.00001623996553475787,0.000012102509533034592,0.000026041895143769855,0.000008232663745290318,0.000029911740931514133,0.000006219077870106827,0.00003192532680669762,0.000004991980323983749,0.0000331524243528207,0.0000373441724108575,8.002322659469464e-7,0.00003700132479485576,0.0000011430798819486908,0.00003259473595776039,0.000005549668719044058,0.000026686334845732137,0.000011458069831072312,0.000021904439142046578,0.00001623996553475787,0.000018351347810078245,0.000019793056866726204,0.0000373441724108575,8.002322659469464e-7,0.000037343758501760476,8.006461750439728e-7,0.000037168760560408775,9.756441163956745e-7,0.000036045440696342704,0.0000020989639804617447,0.00003388804230406054,0.0000042563623727439074,0.00003124866740668114,0.00000689573727012331,0.0000373441724108575,8.002322659469464e-7,0.000037344172377079136,8.002322997253126e-7,0.000037342584096262394,8.018205805420547e-7,0.00003728688644740005,8.575182294043987e-7,0.00003700132479485576,0.0000011430798819486908,0.000036347628723635535,0.0000017967759531689143,0.0000373441724108575,8.002322659469464e-7,0.00003734417241085731,8.002322659471362e-7,0.00003734416867170643,8.002360050980183e-7,0.00003734315789135082,8.012467854536258e-7,0.000037327464745321495,8.169399314829543e-7,0.00003725452467574239,8.898800010620557e-7,0.0000373441724108575,8.002322659469464e-7,0.0000373441724108575,8.002322659469464e-7,0.00003734417240856367,8.002322682407794e-7,0.00003734416508611801,8.002395906864417e-7,0.000037343758501760476,8.006461750439728e-7,0.00003733951494814273,8.048897286617188e-7,0.0000373441724108575,8.002322659469464e-7,0.0000373441724108575,8.002322659469464e-7,0.00003734417241085714,8.002322659473124e-7,0.00003734417238928208,8.002322875223664e-7,0.00003734416717747353,8.002374993309173e-7,0.00003734403126249299,8.003734143114611e-7,0.0000373441724108575,8.002322659469464e-7,0.0000373441724108575,8.002322659469464e-7,0.0000373441724108575,8.002322659469464e-7,0.00003734417241083158,8.002322659728724e-7,0.000037344172377079136,8.002322997253126e-7,0.0000373441699130354,8.002347637690521e-7,0.0000373441724108575,8.002322659469464e-7,0.0000373441724108575,8.002322659469464e-7,0.0000373441724108575,8.002322659469464e-7,0.00003734417241085749,8.0023226594696e-7,0.00003734417241074621,8.002322660582398e-7,0.000037344172385044946,8.00232291759503e-7,0.0000373441724108575,8.002322659469464e-7,0.0000373441724108575,8.002322659469464e-7,0.0000373441724108575,8.002322659469464e-7,0.0000373441724108575,8.002322659469464e-7,0.00003734417241085731,8.002322659471362e-7,0.00003734417241070173,8.002322661027192e-7,0.0012534642939072789,0.0000268599491551559,0,0.0012803242430624348,0,0.0012803242430624348,0,0.0012803242430624348,0,0.0012803242430624348,0,0.0012803242430624348,0.0012534642939072789,0.0000268599491551559,0.0007352266918797121,0.0005450975511827226,0.00040622304865753963,0.0008741011944048951,0.00027633093417987,0.0010039933088825648,0.000208744538918779,0.0010715797041436557,0.0001675567749409295,0.0011127674681215053,0.0012534642939072789,0.0000268599491551559,0.0012419565480619196,0.000038367695000515126,0.0010940485504107647,0.00018627569265167003,0.0008957319363342868,0.000384592306728148,0.0007352266918797121,0.0005450975511827226,0.0006159665013307072,0.0006643577417317275,0.0012534642939072789,0.0000268599491551559,0.0012534504009692232,0.000026873842093211526,0.0012475765615766045,0.000032747681485830295,0.0012098721153579964,0.00007045212770443831,0.0011374586254376139,0.0001428656176248209,0.0010488675018828612,0.00023145674117957355,0.0012534642939072789,0.0000268599491551559,0.0012534642927735015,0.000026859950288933218,0.001253410981823922,0.000026913261238512747,0.0012515414795804278,0.000028782763482006982,0.0012419565480619196,0.000038367695000515126,0.001220015114326899,0.00006030912873553583,0.0012534642939072789,0.0000268599491551559,0.0012534642939072726,0.00002685994915516219,0.0012534641684019577,0.000026860074660477098,0.001253430241365878,0.000026894001696556704,0.0012529034979160457,0.00002742074514638904,0.0012504552505213347,0.000029868992541100042,0.0012534642939072789,0.0000268599491551559,0.0012534642939072789,0.0000268599491551559,0.001253464293830286,0.000026859949232148784,0.0012534640480509958,0.000026860195011438933,0.0012534504009692232,0.000026873842093211526,0.001253307965279911,0.000027016277782523695,0.0012534642939072789,0.0000268599491551559,0.0012534642939072789,0.0000268599491551559,0.0012534642939072667,0.000026859949155168044,0.0012534642931830958,0.000026859949879338985,0.0012534641182477444,0.000026860124814690346,0.001253459556235411,0.00002686468682702378,0.0012534642939072789,0.0000268599491551559,0.0012534642939072789,0.0000268599491551559,0.0012534642939072789,0.0000268599491551559,0.0012534642939064085,0.0000268599491560263,0.0012534642927735015,0.000026859950288933218,0.001253464210067402,0.000026860032995032783,0.0012534642939072789,0.0000268599491551559,0.0012534642939072789,0.0000268599491551559,0.0012534642939072789,0.0000268599491551559,0.0012534642939072784,0.000026859949155156335,0.0012534642939035431,0.000026859949158891628,0.0012534642930408756,0.000026859950021559205,0.0012534642939072789,0.0000268599491551559,0.0012534642939072789,0.0000268599491551559,0.0012534642939072789,0.0000268599491551559,0.0012534642939072789,0.0000268599491551559,0.0012534642939072726,0.00002685994915516219,0.0012534642939020504,0.000026859949160384358,0.009788133570845542,0.0002097457193752615,0,0.009997879290220803,0,0.009997879290220803,0,0.009997879290220803,0,0.009997879290220803,0,0.009997879290220803,0.009788133570845542,0.0002097457193752615,0.005741286050148837,0.004256593240071966,0.003172140984903245,0.006825738305317559,0.0021578309862164864,0.007840048304004317,0.0016300579434556396,0.008367821346765164,0.0013084282510429787,0.008689451039177825,0.009788133570845542,0.0002097457193752615,0.009698271136006971,0.0002996081542138325,0.008543277536075271,0.0014546017541455323,0.006994649850920019,0.0030032294393007846,0.005741286050148837,0.004256593240071966,0.004809999311107109,0.005187879979113694,0.009788133570845542,0.0002097457193752615,0.009788025082766511,0.00020985420745429223,0.009742157063367706,0.00025572222685309696,0.009447728129415325,0.0005501511608054788,0.008882260955665728,0.0011156183345550751,0.008190464823330629,0.0018074144668901743,0.009788133570845542,0.0002097457193752615,0.009788133561992027,0.00020974572822877666,0.009787717263978745,0.00021016202624205872,0.009773118573166999,0.00022476071705380442,0.009698271136006971,0.0002996081542138325,0.009526933440008645,0.000470945850212158,0.009788133570845542,0.0002097457193752615,0.009788133570845493,0.00020974571937531009,0.009788132590791419,0.00020974669942938444,0.009787867659143646,0.00021001163107715708,0.009783754390604934,0.0002141248996158692,0.009764636356983726,0.00023324293323707772,0.009788133570845542,0.0002097457193752615,0.009788133570845542,0.0002097457193752615,0.009788133570244315,0.00020974571997648891,0.009788131650986995,0.00020974763923380796,0.009788025082766511,0.00020985420745429223,0.00978691282168415,0.00021096646853665385,0.009788133570845542,0.0002097457193752615,0.009788133570845542,0.0002097457193752615,0.009788133570845447,0.00020974571937535692,0.009788133565190494,0.00020974572503030912,0.009788132199143935,0.00020974709107686798,0.009788096575005067,0.00020978271521573597,0.009788133570845542,0.0002097457193752615,0.009788133570845542,0.0002097457193752615,0.009788133570845542,0.0002097457193752615,0.009788133570838745,0.00020974571938205816,0.009788133561992027,0.00020974572822877666,0.009788132916151254,0.00020974637406954988,0.009788133570845542,0.0002097457193752615,0.009788133570845542,0.0002097457193752615,0.009788133570845542,0.0002097457193752615,0.009788133570845538,0.00020974571937526498,0.00978813357081637,0.00020974571940443262,0.009788133564079914,0.0002097457261408895,0.009788133570845542,0.0002097457193752615,0.009788133570845542,0.0002097457193752615,0.009788133570845542,0.0002097457193752615,0.009788133570845542,0.0002097457193752615,0.009788133570845493,0.00020974571937531009,0.009788133570804713,0.00020974571941608997,0.04207276891330085,0.0009015593338564457,0,0.042974328247157294,0,0.042974328247157294,0,0.042974328247157294,0,0.042974328247157294,0,0.042974328247157294,0.04207276891330085,0.0009015593338564457,0.02467802462080659,0.018296303626350704,0.01363495437125669,0.029339373875900604,0.009275100690029082,0.03369922755712821,0.007006550398389712,0.03596777784876758,0.0056240752179488535,0.03735025302920844,0.04207276891330085,0.0009015593338564457,0.041686509221646156,0.0012878190255111374,0.036721948973816386,0.006252379273340908,0.030065413868457316,0.012908914378699978,0.02467802462080659,0.018296303626350704,0.02067503350098481,0.022299294746172482,0.04207276891330085,0.0009015593338564457,0.04207230259417618,0.0009020256529811144,0.04187514605082611,0.0010991821963311846,0.0406095890976124,0.002364739149544895,0.03817901644992335,0.004795311797233942,0.03520543843321719,0.007768889813940104,0.04207276891330085,0.0009015593338564457,0.042072768875245393,0.0009015593719119003,0.04207097948302009,0.0009033487641372032,0.04200822928243141,0.0009660989647258811,0.041686509221646156,0.0012878190255111374,0.04095004079917323,0.002024287447984066,0.04207276891330085,0.0009015593338564457,0.04207276891330064,0.0009015593338566538,0.04207276470069072,0.0009015635464665744,0.04207162593323175,0.0009027023139255436,0.04205394568852983,0.0009203825586274611,0.041971769796180176,0.0010025584509771174,0.04207276891330085,0.0009015593338564457,0.04207276891330085,0.0009015593338564457,0.04207276891071657,0.0009015593364407257,0.04207276066108766,0.0009015675860696362,0.04207230259417618,0.0009020256529811144,0.04206752171300504,0.0009068065341522533,0.04207276891330085,0.0009015593338564457,0.04207276891330085,0.0009015593338564457,0.04207276891330044,0.000901559333856855,0.04207276888899351,0.0009015593581637865,0.042072763017254954,0.0009015652299023402,0.042072609892437905,0.0009017183547193885,0.04207276891330085,0.0009015593338564457,0.04207276891330085,0.0009015593338564457,0.04207276891330085,0.0009015593338564457,0.042072768913271635,0.0009015593338856584,0.042072768875245393,0.0009015593719119003,0.042072766099199334,0.00090156214795796,0.04207276891330085,0.0009015593338564457,0.04207276891330085,0.0009015593338564457,0.04207276891330085,0.0009015593338564457,0.042072768913300834,0.0009015593338564595,0.04207276891317546,0.0009015593339818315,0.042072768884219854,0.0009015593629374402,0.04207276891330085,0.0009015593338564457,0.04207276891330085,0.0009015593338564457,0.04207276891330085,0.0009015593338564457,0.04207276891330085,0.0009015593338564457,0.04207276891330064,0.0009015593338566538,0.04207276891312536,0.0009015593340319372,0.1303850130688967,0.002793964565762058,0,0.13317897763465875,0,0.13317897763465875,0,0.13317897763465875,0,0.13317897763465875,0,0.13317897763465875,0.1303850130688967,0.002793964565762058,0.0764780794277887,0.05670089820687005,0.04225521043203989,0.09092376720261885,0.02874386820550945,0.1044351094291493,0.02171354985321913,0.11146542778143961,0.01742920990781037,0.11574976772684838,0.1303850130688967,0.002793964565762058,0.12918798049307154,0.00399099714158721,0.11380263102561655,0.019376346609042194,0.0931737910627818,0.04000518657187695,0.0764780794277887,0.05670089820687005,0.06407266702081879,0.06910631061383996,0.1303850130688967,0.002793964565762058,0.13038356792927944,0.0027954097053793092,0.12977257276197085,0.003406404872687896,0.1258505665772998,0.007328411057358958,0.11831813515860959,0.014860842476049158,0.1091029107133498,0.024076066921308953,0.1303850130688967,0.002793964565762058,0.13038501295096147,0.0027939646836972754,0.1303794675605651,0.002799510074093653,0.1301850024484473,0.002993975186211445,0.12918798049307154,0.00399099714158721,0.12690563855625156,0.006273339078407186,0.1303850130688967,0.002793964565762058,0.13038501306889605,0.0027939645657626966,0.1303850000138675,0.0027939776207912548,0.1303814709328525,0.002797506701806257,0.1303266792232488,0.002852298411409937,0.13007201319877018,0.003106964435888565,0.1303850130688967,0.002793964565762058,0.1303850130688967,0.002793964565762058,0.1303850130608879,0.0027939645737708463,0.13038498749499336,0.0027939901396653866,0.13038356792927944,0.0027954097053793092,0.1303687518078289,0.002810225826829854,0.1303850130688967,0.002793964565762058,0.1303850130688967,0.002793964565762058,0.1303850130688954,0.002793964565763335,0.13038501299356736,0.0027939646410913843,0.13038499479683996,0.002793982837818787,0.13038452025756458,0.0027944573770941616,0.1303850130688967,0.002793964565762058,0.1303850130688967,0.002793964565762058,0.1303850130688967,0.002793964565762058,0.13038501306880615,0.002793964565852597,0.13038501295096147,0.0027939646836972754,0.13038500434789563,0.0027939732867631184,0.1303850130688967,0.002793964565762058,0.1303850130688967,0.002793964565762058,0.1303850130688967,0.002793964565762058,0.13038501306889663,0.0027939645657621137,0.1303850130685081,0.0027939645661506363,0.13038501297877364,0.002793964655885106,0.1303850130688967,0.002793964565762058,0.1303850130688967,0.002793964565762058,0.1303850130688967,0.002793964565762058,0.1303850130688967,0.002793964565762058,0.13038501306889605,0.0027939645657626966,0.13038501306835282,0.0027939645663059287,0.3285405765608266,0.007040155212017674,0,0.33558073177284425,0,0.33558073177284425,0,0.33558073177284425,0,0.33558073177284425,0,0.33558073177284425,0.3285405765608266,0.007040155212017674,0.19270736504197372,0.14287336673087053,0.10647351924339468,0.22910721252944957,0.0724280100185781,0.2631527217542662,0.05471320683297631,0.28086752493986794,0.04391764465357617,0.2916630871192681,0.3285405765608266,0.007040155212017674,0.3255243267375752,0.010056405035269056,0.28675674551291014,0.048823986259934116,0.23477676088392907,0.10080397088891518,0.19270736504197372,0.14287336673087053,0.1614485474161543,0.17413218435668995,0.3285405765608266,0.007040155212017674,0.32853693513769144,0.00704379663515281,0.3269973662883378,0.008583365484506444,0.3171148027723447,0.018465929000499537,0.29813478886619355,0.03744594290665071,0.27491451928825306,0.0606662124845912,0.3285405765608266,0.007040155212017674,0.3285405762636567,0.007040155509187573,0.32852660314116966,0.007054128631674594,0.3280365952901724,0.0075441364826718815,0.3255243267375752,0.010056405035269056,0.31977334418074127,0.015807387592102984,0.3285405765608266,0.007040155212017674,0.3285405765608249,0.007040155212019339,0.3285405436651224,0.007040188107721834,0.32853165118366223,0.007049080589182022,0.328393588537962,0.007187143234882232,0.3277518880806522,0.007828843692192056,0.3285405765608266,0.007040155212017674,0.3285405765608266,0.007040155212017674,0.3285405765406463,0.0070401552321979755,0.3285405121204071,0.007040219652437174,0.32853693513769144,0.00704379663515281,0.32849960188159716,0.0070811298912470955,0.3285405765608266,0.007040155212017674,0.3285405765608266,0.007040155212017674,0.32854057656082336,0.007040155212020893,0.3285405763710138,0.00704015540183045,0.32854053051939963,0.007040201253444622,0.3285393347883608,0.007041396984483472,0.3285405765608266,0.007040155212017674,0.3285405765608266,0.007040155212017674,0.3285405765608266,0.007040155212017674,0.3285405765605985,0.007040155212245769,0.3285405762636567,0.007040155509187573,0.3285405545858875,0.007040177186956764,0.3285405765608266,0.007040155212017674,0.3285405765608266,0.007040155212017674,0.3285405765608266,0.007040155212017674,0.32854057656082647,0.007040155212017785,0.3285405765598474,0.007040155212996835,0.328540576333737,0.007040155439107243,0.3285405765608266,0.007040155212017674,0.3285405765608266,0.007040155212017674,0.3285405765608266,0.007040155212017674,0.3285405765608266,0.007040155212017674,0.3285405765608249,0.007040155212019339,0.3285405765594562,0.007040155213388077,0.7176871870122365,0.01537901115026219,0,0.7330661981624987,0,0.7330661981624987,0,0.7330661981624987,0,0.7330661981624987,0,0.7330661981624987,0.7176871870122365,0.01537901115026219,0.42096354788586837,0.31210265027663037,0.2325882584032588,0.5004779397592399,0.15821684893617277,0.574849349226326,0.1195193845321188,0.6135468136303799,0.09593679776656923,0.6371294003959295,0.7176871870122365,0.01537901115026219,0.7110982783494594,0.02196791981303936,0.626411642051288,0.10665455611121077,0.5128629007060741,0.22020329745642464,0.42096354788586837,0.31210265027663037,0.35267958392000687,0.38038661424249187,0.7176871870122365,0.01537901115026219,0.7176792324309366,0.015386965731562174,0.7143160897461861,0.01875010841631264,0.6927279215981044,0.04033827656439437,0.6512666417393079,0.08179955642319081,0.6005426485890354,0.13252354957346335,0.7176871870122365,0.01537901115026219,0.7176871863630776,0.015379011799421138,0.7176566624896601,0.015409535672838648,0.716586254810105,0.016479943352393778,0.7110982783494594,0.02196791981303936,0.6985354267925028,0.03453077136999594,0.7176871870122365,0.01537901115026219,0.717687187012233,0.015379011150265742,0.7176871151525422,0.015379083009956496,0.7176676897894059,0.015398508373092867,0.7173660960171502,0.01570010214534856,0.7159643203189028,0.01710187784359596,0.7176871870122365,0.01537901115026219,0.7176871870122365,0.01537901115026219,0.7176871869681533,0.015379011194345482,0.7176870462440432,0.015379151918455514,0.7176792324309366,0.015386965731562174,0.7175976790355272,0.015468519126971558,0.7176871870122365,0.01537901115026219,0.7176871870122365,0.01537901115026219,0.7176871870122296,0.015379011150269184,0.7176871865975961,0.015379011564902623,0.717687086436099,0.015379111726399719,0.7176844743969572,0.015381723765541588,0.7176871870122365,0.01537901115026219,0.7176871870122365,0.01537901115026219,0.7176871870122365,0.01537901115026219,0.7176871870117383,0.015379011150760458,0.7176871863630776,0.015379011799421138,0.7176871390086311,0.015379059153867614,0.7176871870122365,0.01537901115026219,0.7176871870122365,0.01537901115026219,0.7176871870122365,0.01537901115026219,0.7176871870122363,0.015379011150262412,0.7176871870100976,0.015379011152401145,0.717687186516166,0.015379011646332708,0.7176871870122365,0.01537901115026219,0.7176871870122365,0.01537901115026219,0.7176871870122365,0.01537901115026219,0.7176871870122365,0.01537901115026219,0.717687187012233,0.015379011150265742,0.7176871870092429,0.015379011153255795,1.4121805404717442,0.030261011581537378,0,1.4424415520532816,0,1.4424415520532816,0,1.4424415520532816,0,1.4424415520532816,0,1.4424415520532816,1.4121805404717442,0.030261011581537378,0.8283226192837588,0.6141189327695228,0.45765985293213207,0.9847816991211495,0.3113205297318639,1.1311210223214176,0.235176205037279,1.2072653470160026,0.18877316102734354,1.253668391025938,1.4121805404717442,0.030261011581537378,1.3992156599988803,0.043225892054401305,1.23257924516172,0.2098623068915617,1.0091513704210269,0.43329018163225475,0.8283226192837588,0.6141189327695228,0.6939614562535216,0.74848009579976,1.4121805404717442,0.030261011581537378,1.4121648883810805,0.030276663672201165,1.4055472912716678,0.03689426078161384,1.3630686299344505,0.07937292211883107,1.28148599385118,0.1609555582021016,1.1816772786363499,0.26076427341693176,1.4121805404717442,0.030261011581537378,1.4121805391944056,0.030261012858876057,1.4121204779019092,0.030321074151372418,1.4100142554100015,0.032427296643280146,1.3992156599988803,0.043225892054401305,1.3744959564530697,0.06794559560021196,1.4121805404717442,0.030261011581537378,1.4121805404717371,0.030261011581544484,1.412180399074679,0.030261152978602546,1.412142176126981,0.03029937592630061,1.4115487353299117,0.030892816723369965,1.4087904857763531,0.03365106627692849,1.4121805404717442,0.030261011581537378,1.4121805404717442,0.030261011581537378,1.4121805403850023,0.030261011668279325,1.4121802634846292,0.0302612885686524,1.4121648883810805,0.030276663672201165,1.412004417189605,0.030437134863676718,1.4121805404717442,0.030261011581537378,1.4121805404717442,0.030261011581537378,1.4121805404717305,0.030261011581551145,1.4121805396558635,0.030261012397418074,1.4121803425698354,0.03026120948344624,1.4121752029060461,0.030266349147235472,1.4121805404717442,0.030261011581537378,1.4121805404717442,0.030261011581537378,1.4121805404717442,0.030261011581537378,1.4121805404707637,0.030261011582517927,1.4121805391944056,0.030261012858876057,1.4121804460158884,0.03026110603739318,1.4121805404717442,0.030261011581537378,1.4121805404717442,0.030261011581537378,1.4121805404717442,0.030261011581537378,1.4121805404717438,0.030261011581537822,1.4121805404675356,0.03026101158574601,1.412180539495635,0.03026101255764657,1.4121805404717442,0.030261011581537378,1.4121805404717442,0.030261011581537378,1.4121805404717442,0.030261011581537378,1.4121805404717442,0.030261011581537378,1.4121805404717371,0.030261011581544484,1.4121805404658536,0.030261011587428,2.565529040157772,0.05497562228909514,0,2.620504662446867,0,2.620504662446867,0,2.620504662446867,0,2.620504662446867,0,2.620504662446867,2.565529040157772,0.05497562228909514,1.5048258161680519,1.1156788462788152,0.831437347819206,1.789067314627661,0.5655805592375522,2.0549241032093146,0.4272480510003955,2.1932566114464715,0.3429469623312087,2.2775577001156586,2.565529040157772,0.05497562228909514,2.541975552199217,0.07852911024765019,2.239244740408183,0.3812599220386841,1.8333400528697905,0.7871646095770766,1.5048258161680519,1.1156788462788152,1.2607299263406113,1.3597747361062558,2.565529040157772,0.05497562228909514,2.5655006047757607,0.05500405767110639,2.553478319328752,0.06702634311811506,2.476306714052806,0.1441979483940612,2.3280943459838226,0.2924103164630445,2.1467703934111966,0.4737342690356705,2.565529040157772,0.05497562228909514,2.565529037837212,0.05497562460965488,2.565419923608774,0.05508473883809328,2.5615935184055,0.05891114404136699,2.541975552199217,0.07852911024765019,2.4970669052568915,0.12343775718997563,2.565529040157772,0.05497562228909514,2.565529040157759,0.05497562228910802,2.565528783279656,0.05497587916721125,2.5654593430915855,0.05504531935528156,2.5643812305168385,0.056123431930028556,2.5593702782151637,0.061134384231703365,2.565529040157772,0.05497562228909514,2.565529040157772,0.05497562228909514,2.5655290400001864,0.05497562244668064,2.5655285369512293,0.054976125495637795,2.5655006047757607,0.05500405767110639,2.5652090744154132,0.055295588031453846,2.565529040157772,0.05497562228909514,2.565529040157772,0.05497562228909514,2.565529040157747,0.05497562228912001,2.5655290386755496,0.05497562377131748,2.56552868062648,0.05497598182038699,2.5655193433241097,0.05498531912275739,2.565529040157772,0.05497562228909514,2.565529040157772,0.05497562228909514,2.565529040157772,0.05497562228909514,2.5655290401559907,0.05497562229087638,2.565529037837212,0.05497562460965488,2.565528868558437,0.05497579388842988,2.565529040157772,0.05497562228909514,2.565529040157772,0.05497562228909514,2.565529040157772,0.05497562228909514,2.565529040157771,0.05497562228909603,2.565529040150126,0.05497562229674102,2.5655290383844602,0.05497562406240686,2.565529040157772,0.05497562228909514,2.565529040157772,0.05497562228909514,2.565529040157772,0.05497562228909514,2.565529040157772,0.05497562228909514,2.565529040157759,0.05497562228910802,2.5655290401470707,0.054975622299796356,4.376397916773197,0.09377995535942585,0,4.470177872132623,0,4.470177872132623,0,4.470177872132623,0,4.470177872132623,0,4.470177872132623,4.376397916773197,0.09377995535942585,2.567001372387267,1.9031764997453555,1.4183042249639224,3.0518736471687005,0.9647934373264494,3.505384434806173,0.7288194563677798,3.741358415764843,0.5850147661621086,3.885163105970514,4.376397916773197,0.09377995535942585,4.336219289277238,0.1339585828553842,3.819807089950169,0.6503707821824536,3.1273961286451852,1.3427817434874374,2.567001372387267,1.9031764997453555,2.1506113307964627,2.31956654133616,4.376397916773197,0.09377995535942585,4.376349410385372,0.09382846174725046,4.355841240662255,0.11433663147036732,4.224198352479268,0.2459795196533543,3.9713708503523657,0.49880702178025693,3.6620600782353128,0.8081177938973099,4.376397916773197,0.09377995535942585,4.376397912814679,0.0937799593179438,4.376211780724746,0.09396609140787682,4.369684522019732,0.10049335011289084,4.336219289277238,0.1339585828553842,4.259612045372718,0.21056582675990487,4.376397916773197,0.09377995535942585,4.376397916773175,0.09377995535944805,4.376397478578643,0.09378039355397938,4.376279024298978,0.09389884783364444,4.37443993008008,0.09573794205254238,4.365892016230409,0.10428585590221395,4.376397916773197,0.09377995535942585,4.376397916773197,0.09377995535942585,4.376397916504381,0.09377995562824193,4.376397058380237,0.09378081375238523,4.376349410385372,0.09382846174725046,4.375852104433372,0.09432576769925038,4.376397916773197,0.09377995535942585,4.376397916773197,0.09377995535942585,4.376397916773154,0.09377995535946848,4.3763979142447536,0.09377995788786908,4.376397303468115,0.09378056866450724,4.37638137546652,0.09379649666610224,4.376397916773197,0.09377995535942585,4.376397916773197,0.09377995535942585,4.376397916773197,0.09377995535942585,4.376397916770158,0.0937799553624643,4.376397912814679,0.0937799593179438,4.376397624051127,0.09378024808149554,4.376397916773197,0.09377995535942585,4.376397916773197,0.09377995535942585,4.376397916773197,0.09377995535942585,4.376397916773195,0.09377995535942762,4.376397916760154,0.09377995537246875,4.3763979137482,0.09377995838442299,4.376397916773197,0.09377995535942585,4.376397916773197,0.09377995535942585,4.376397916773197,0.09377995535942585,4.376397916773197,0.09377995535942585,4.376397916773175,0.09377995535944805,4.376397916754942,0.09377995537768058]],"a0":[{"key":["power-v1","12AX7","EL84","0","6.0","4",352800],"detector":{"real":228.61008062323538,"imaginary":9.360402890290604},"anchor":{"b0":0.09106584441917089,"b1":-0.09086281064275105,"a1":-1.9645482165974153,"a2":0.9647512503738352}},{"key":["power-v1","12AX7","EL84","0","6.0","8",352800],"detector":{"real":323.35913293309824,"imaginary":13.301876699933521},"anchor":{"b0":0.09076851415737153,"b1":-0.09059203687901606,"a1":-1.973210468449191,"a2":0.9733869457275464}},{"key":["power-v1","12AX7","EL84","0","6.0","15",352800],"detector":{"real":442.82942480824704,"imaginary":18.25914251111656},"anchor":{"b0":0.09062782581386082,"b1":-0.09056522241014116,"a1":-1.9772677850368465,"a2":0.9773303884405663}},{"key":["power-v1","12AX7","EL84","0","6.0","16",352800],"detector":{"real":457.34454424815004,"imaginary":18.85168436514381},"anchor":{"b0":0.08901079707598844,"b1":-0.08894860909840827,"a1":-1.9600640510010594,"a2":0.9601262389786396}},{"key":["power-v1","12AX7","EL84","0","6.0","4",384000],"detector":{"real":229.24110913943036,"imaginary":8.886795336587763},"anchor":{"b0":0.08421823088884388,"b1":-0.08418267510870928,"a1":-1.972280187823972,"a2":0.9723157436041066}},{"key":["power-v1","12AX7","EL84","0","6.0","8",384000],"detector":{"real":324.251927411983,"imaginary":12.632013011582863},"anchor":{"b0":0.08302525295137891,"b1":-0.08290247782820068,"a1":-1.9629209998549486,"a2":0.9630437749781269}},{"key":["power-v1","12AX7","EL84","0","6.0","15",384000],"detector":{"real":444.0522242768297,"imaginary":17.341775181681598},"anchor":{"b0":0.08227934504071595,"b1":-0.08202128607216272,"a1":-1.9653070651886244,"a2":0.9655651241571775}},{"key":["power-v1","12AX7","EL84","0","6.0","16",384000],"detector":{"real":458.60740475871614,"imaginary":17.904250893908806},"anchor":{"b0":0.08217934108044399,"b1":-0.08170127028294967,"a1":-1.956265469327053,"a2":0.9567435401245472}},{"key":["power-v1","12AX7","EL84","0","6.6","4",352800],"detector":{"real":238.16321177040305,"imaginary":9.79800116791127},"anchor":{"b0":0.08900444666327954,"b1":-0.08870708022201594,"a1":-1.9645670287930126,"a2":0.9648643952342763}},{"key":["power-v1","12AX7","EL84","0","6.6","8",352800],"detector":{"real":336.8716136638585,"imaginary":13.923431526403926},"anchor":{"b0":0.08803062152104829,"b1":-0.08794564728903569,"a1":-1.9664838720235824,"a2":0.9665688462555949}},{"key":["power-v1","12AX7","EL84","0","6.6","15",352800],"detector":{"real":461.33430291970194,"imaginary":19.11212434128487},"anchor":{"b0":0.0914736702575168,"b1":-0.09131200930708867,"a1":-1.9736786376927133,"a2":0.9738402986431416}},{"key":["power-v1","12AX7","EL84","0","6.6","16",352800],"detector":{"real":476.4559788499508,"imaginary":19.73237623889115},"anchor":{"b0":0.09002021969865129,"b1":-0.08988920063149629,"a1":-1.9760768435809488,"a2":0.9762078626481038}},{"key":["power-v1","12AX7","EL84","0","6.6","4",384000],"detector":{"real":238.81699553162363,"imaginary":9.307253055205262},"anchor":{"b0":0.0816353096475607,"b1":-0.08159494159891893,"a1":-1.9754685096334144,"a2":0.9755088776820561}},{"key":["power-v1","12AX7","EL84","0","6.6","8",384000],"detector":{"real":337.7966034732777,"imaginary":13.229323836391695},"anchor":{"b0":0.03420004468329998,"b1":-0.004236967041808807,"a1":-1.6535213663229604,"a2":0.6834844439644516}},{"key":["power-v1","12AX7","EL84","0","6.6","15",384000],"detector":{"real":462.6011982243566,"imaginary":18.161554612326906},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AX7","EL84","0","6.6","16",384000],"detector":{"real":477.764379829378,"imaginary":18.750652326750703},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AX7","EL84","0","8.0","4",352800],"detector":{"real":258.1155930526206,"imaginary":10.678117750460437},"anchor":{"b0":0.08932635874451385,"b1":-0.08914670788239311,"a1":-1.9710486726544416,"a2":0.9712283235165624}},{"key":["power-v1","12AX7","EL84","0","8.0","8",352800],"detector":{"real":365.0933823856005,"imaginary":15.173729469267899},"anchor":{"b0":0.08992831902000697,"b1":-0.08989426380504151,"a1":-1.9770702953184722,"a2":0.9771043505334377}},{"key":["power-v1","12AX7","EL84","0","8.0","15",352800],"detector":{"real":499.9830513219064,"imaginary":20.828089945847893},"anchor":{"b0":0.09496284871133766,"b1":-0.09489463732852434,"a1":-1.9761941907651819,"a2":0.9762624021479953}},{"key":["power-v1","12AX7","EL84","0","8.0","16",352800],"detector":{"real":516.3715624801871,"imaginary":21.504067883664685},"anchor":{"b0":0.0889793237253196,"b1":-0.08893209804989036,"a1":-1.971769916823554,"a2":0.9718171424989833}},{"key":["power-v1","12AX7","EL84","0","8.0","4",384000],"detector":{"real":258.81511241215986,"imaginary":10.152467144501822},"anchor":{"b0":0.08182535221243627,"b1":-0.08169140882863912,"a1":-1.9578920027018578,"a2":0.958025946085655}},{"key":["power-v1","12AX7","EL84","0","8.0","8",384000],"detector":{"real":366.08308152389867,"imaginary":14.430254192723726},"anchor":{"b0":0.08117728435092253,"b1":-0.08101996359023242,"a1":-1.9713183243981158,"a2":0.9714756451588059}},{"key":["power-v1","12AX7","EL84","0","8.0","15",384000],"detector":{"real":501.3385756135237,"imaginary":19.809910152877553},"anchor":{"b0":0.08240952825181315,"b1":-0.08213665195973965,"a1":-1.9639621234178486,"a2":0.9642349997099221}},{"key":["power-v1","12AX7","EL84","0","8.0","16",384000],"detector":{"real":517.7714959783855,"imaginary":20.452518365542407},"anchor":{"b0":0.08098391242427597,"b1":-0.08090202034512534,"a1":-1.9641136896352693,"a2":0.96419558171442}},{"key":["power-v1","12AX7","EL84","20","6.0","4",352800],"detector":{"real":169.16991810475074,"imaginary":5.492875503089632},"anchor":{"b0":0.09062886110336568,"b1":-0.09038044399020354,"a1":-1.9651297597323876,"a2":0.9653781768455497}},{"key":["power-v1","12AX7","EL84","20","6.0","8",352800],"detector":{"real":239.28396601727377,"imaginary":7.815291928433686},"anchor":{"b0":0.08831219700940648,"b1":-0.08807631577515501,"a1":-1.9676625016968785,"a2":0.9678983829311301}},{"key":["power-v1","12AX7","EL84","20","6.0","15",352800],"detector":{"real":327.6915870301131,"imaginary":10.73434409908469},"anchor":{"b0":0.08831504751251598,"b1":-0.08817568166723645,"a1":-1.9763702281173443,"a2":0.9765095939626237}},{"key":["power-v1","12AX7","EL84","20","6.0","16",352800],"detector":{"real":338.4326664261847,"imaginary":11.081787966798224},"anchor":{"b0":0.09300492267692528,"b1":-0.09294832723043356,"a1":-1.9751460042762403,"a2":0.975202599722732}},{"key":["power-v1","12AX7","EL84","20","6.0","4",384000],"detector":{"real":169.53389055883318,"imaginary":5.2232009202004495},"anchor":{"b0":0.08476144383204906,"b1":-0.08465346255973628,"a1":-1.9743968283866171,"a2":0.9745048096589299}},{"key":["power-v1","12AX7","EL84","20","6.0","8",384000],"detector":{"real":239.7989370434961,"imaginary":7.433846398757089},"anchor":{"b0":0.08888412714459573,"b1":-0.08872755592374584,"a1":-1.9704760936446966,"a2":0.9706326648655463}},{"key":["power-v1","12AX7","EL84","20","6.0","15",384000],"detector":{"real":328.39691499008023,"imaginary":10.211939803021885},"anchor":{"b0":0.08202113520293912,"b1":-0.08189559981866683,"a1":-1.9775743789941453,"a2":0.9776999143784176}},{"key":["power-v1","12AX7","EL84","20","6.0","16",384000],"detector":{"real":339.1611012371489,"imaginary":10.54226542729985},"anchor":{"b0":0.08114774834428222,"b1":-0.08112066295429304,"a1":-1.9743967503772795,"a2":0.9744238357672688}},{"key":["power-v1","12AX7","EL84","20","6.6","4",352800],"detector":{"real":172.640351860732,"imaginary":5.570952329505276},"anchor":{"b0":0.09695469579603674,"b1":-0.09687397941965215,"a1":-1.9657463812213454,"a2":0.96582709759773}},{"key":["power-v1","12AX7","EL84","20","6.6","8",352800],"detector":{"real":244.19276284375425,"imaginary":7.926668562416305},"anchor":{"b0":0.10172510230419676,"b1":-0.10167984620839832,"a1":-1.9695792890935515,"a2":0.9696245451893499}},{"key":["power-v1","12AX7","EL84","20","6.6","15",352800],"detector":{"real":334.4140306282835,"imaginary":10.887517896654012},"anchor":{"b0":0.08867373404889912,"b1":-0.08859858405119614,"a1":-1.963291018633963,"a2":0.9633661686316659}},{"key":["power-v1","12AX7","EL84","20","6.6","16",352800],"detector":{"real":345.3754574688426,"imaginary":11.239892061747284},"anchor":{"b0":0.09852118467616859,"b1":-0.09846697793788523,"a1":-1.9746149007839953,"a2":0.9746691075222786}},{"key":["power-v1","12AX7","EL84","20","6.6","4",384000],"detector":{"real":173.00435329853772,"imaginary":5.300059870013859},"anchor":{"b0":0.08239818383092243,"b1":-0.08208143411281797,"a1":-1.9601315706136524,"a2":0.9604483203317569}},{"key":["power-v1","12AX7","EL84","20","6.6","8",384000],"detector":{"real":244.70777638488144,"imaginary":7.543498332763219},"anchor":{"b0":0.08548843393057654,"b1":-0.08532080698864132,"a1":-1.9716106419624821,"a2":0.9717782689044173}},{"key":["power-v1","12AX7","EL84","20","6.6","15",384000],"detector":{"real":335.1194178791748,"imaginary":10.362749948909485},"anchor":{"b0":0.0856364260521629,"b1":-0.08556229509099565,"a1":-1.9776770877188317,"a2":0.977751218679999}},{"key":["power-v1","12AX7","EL84","20","6.6","16",384000],"detector":{"real":346.10395333139394,"imaginary":10.69792872698167},"anchor":{"b0":0.08658231037744273,"b1":-0.08644566233136329,"a1":-1.9721876102619864,"a2":0.9723242583080659}},{"key":["power-v1","12AX7","EL84","20","8.0","4",352800],"detector":{"real":178.7989890364865,"imaginary":5.67227382184022},"anchor":{"b0":0.09222606074942535,"b1":-0.09214675961280455,"a1":-1.966576112391608,"a2":0.9666554135282286}},{"key":["power-v1","12AX7","EL84","20","8.0","8",352800],"detector":{"real":252.90393098154567,"imaginary":8.071651788991032},"anchor":{"b0":0.09708640237574646,"b1":-0.09700972277230238,"a1":-1.9724165951880566,"a2":0.9724932747915005}},{"key":["power-v1","12AX7","EL84","20","8.0","15",352800],"detector":{"real":346.34370977810465,"imaginary":11.087215840087463},"anchor":{"b0":0.09059982992601454,"b1":-0.09031789085082598,"a1":-1.9626645006027543,"a2":0.9629464396779429}},{"key":["power-v1","12AX7","EL84","20","8.0","16",352800],"detector":{"real":357.69616520239333,"imaginary":11.445975464463482},"anchor":{"b0":0.08934457202174585,"b1":-0.08927511833948162,"a1":-1.9773606727218795,"a2":0.9774301264041436}},{"key":["power-v1","12AX7","EL84","20","8.0","4",384000],"detector":{"real":179.1595357237725,"imaginary":5.400472994391393},"anchor":{"b0":0.08247900723130916,"b1":-0.08243460516756343,"a1":-1.9790521695404655,"a2":0.9790965716042113}},{"key":["power-v1","12AX7","EL84","20","8.0","8",384000],"detector":{"real":253.41406110777982,"imaginary":7.687192204527285},"anchor":{"b0":0.08412104103513633,"b1":-0.08403645146256745,"a1":-1.9622447883704055,"a2":0.9623293779429742}},{"key":["power-v1","12AX7","EL84","20","8.0","15",384000],"detector":{"real":347.0424106759997,"imaginary":10.560678194605723},"anchor":{"b0":0.08526715557209867,"b1":-0.08493238414040091,"a1":-1.9595969314422914,"a2":0.9599317028739892}},{"key":["power-v1","12AX7","EL84","20","8.0","16",384000],"detector":{"real":358.41775543762,"imaginary":10.902184937937072},"anchor":{"b0":0.08596771808336288,"b1":-0.08583724510830247,"a1":-1.969812592264889,"a2":0.9699430652399494}},{"key":["power-v1","12AX7","EL84","43","6.0","4",352800],"detector":{"real":135.2873502223427,"imaginary":3.73600684180464},"anchor":{"b0":0.09116535380891776,"b1":-0.09096848027478778,"a1":-1.9695355287136929,"a2":0.9697324022478229}},{"key":["power-v1","12AX7","EL84","43","6.0","8",352800],"detector":{"real":191.35863022175965,"imaginary":5.321085194636105},"anchor":{"b0":0.10803016483780878,"b1":-0.1077926150187118,"a1":-1.9670555780394579,"a2":0.9672931278585549}},{"key":["power-v1","12AX7","EL84","43","6.0","15",352800],"detector":{"real":262.0595251956287,"imaginary":7.312284905674363},"anchor":{"b0":0.0895376876364845,"b1":-0.08947089792668274,"a1":-1.9768908896110455,"a2":0.9769576793208473}},{"key":["power-v1","12AX7","EL84","43","6.0","16",352800],"detector":{"real":270.6492988825913,"imaginary":7.5484436209803905},"anchor":{"b0":0.0965056871402557,"b1":-0.0964400985529168,"a1":-1.9730818328280786,"a2":0.9731474214154177}},{"key":["power-v1","12AX7","EL84","43","6.0","4",384000],"detector":{"real":135.53107968932449,"imaginary":3.5590365707571903},"anchor":{"b0":0.08120763728033754,"b1":-0.08097941695209404,"a1":-1.9640872493036121,"a2":0.9643154696318555}},{"key":["power-v1","12AX7","EL84","43","6.0","8",384000],"detector":{"real":191.70348168086426,"imaginary":5.070753774131399},"anchor":{"b0":0.08575918611001986,"b1":-0.08572295493389578,"a1":-1.9722204004833455,"a2":0.9722566316594695}},{"key":["power-v1","12AX7","EL84","43","6.0","15",384000],"detector":{"real":262.53185364676295,"imaginary":6.9694340025931165},"anchor":{"b0":0.08138315026750588,"b1":-0.08125290945189656,"a1":-1.977165657880616,"a2":0.9772958986962252}},{"key":["power-v1","12AX7","EL84","43","6.0","16",384000],"detector":{"real":271.1371005123286,"imaginary":7.194359995202764},"anchor":{"b0":0.08410755757533557,"b1":-0.0840786994932251,"a1":-1.9779228823794113,"a2":0.9779517404615217}},{"key":["power-v1","12AX7","EL84","43","6.6","4",352800],"detector":{"real":136.02725561734925,"imaginary":3.712639865610406},"anchor":{"b0":0.0892228870231092,"b1":-0.0891645132938036,"a1":-1.9771964095554484,"a2":0.9772547832847539}},{"key":["power-v1","12AX7","EL84","43","6.6","8",352800],"detector":{"real":192.40520910994383,"imaginary":5.288233691169867},"anchor":{"b0":0.0906294635664459,"b1":-0.09052893380020623,"a1":-1.9650976889031204,"a2":0.9651982186693602}},{"key":["power-v1","12AX7","EL84","43","6.6","15",352800],"detector":{"real":263.4927896323615,"imaginary":7.267433594383124},"anchor":{"b0":0.08917477684000845,"b1":-0.08902781375433452,"a1":-1.9757332002414132,"a2":0.9758801633270872}},{"key":["power-v1","12AX7","EL84","43","6.6","16",352800],"detector":{"real":272.12954167693835,"imaginary":7.502102866209684},"anchor":{"b0":0.09781292626280383,"b1":-0.09777518966212387,"a1":-1.972769029445152,"a2":0.972806766045832}},{"key":["power-v1","12AX7","EL84","43","6.6","4",384000],"detector":{"real":136.26534602171452,"imaginary":3.538280000964018},"anchor":{"b0":0.08193851528138267,"b1":-0.08167560308370836,"a1":-1.9615323230144965,"a2":0.9617952352121708}},{"key":["power-v1","12AX7","EL84","43","6.6","8",384000],"detector":{"real":192.742083875148,"imaginary":5.04159267730614},"anchor":{"b0":0.0830363218573152,"b1":-0.08299660348714125,"a1":-1.9769535664663007,"a2":0.9769932848364746}},{"key":["power-v1","12AX7","EL84","43","6.6","15",384000],"detector":{"real":263.9541939486175,"imaginary":6.929635084226945},"anchor":{"b0":0.08190295138294981,"b1":-0.08183552370420134,"a1":-1.9739944758834957,"a2":0.9740619035622442}},{"key":["power-v1","12AX7","EL84","43","6.6","16",384000],"detector":{"real":272.6060610362147,"imaginary":7.15323756461931},"anchor":{"b0":0.08107475102431885,"b1":-0.08103316137630939,"a1":-1.964686095604712,"a2":0.9647276852527216}},{"key":["power-v1","12AX7","EL84","43","8.0","4",352800],"detector":{"real":136.59206240011036,"imaginary":3.6307594012972992},"anchor":{"b0":0.10452134217072252,"b1":-0.1044467896953359,"a1":-1.9679301055937675,"a2":0.9680046580691541}},{"key":["power-v1","12AX7","EL84","43","8.0","8",352800],"detector":{"real":193.20413239541406,"imaginary":5.172569257857175},"anchor":{"b0":0.09810392360082835,"b1":-0.0978730040704156,"a1":-1.969102597657244,"a2":0.9693335171876568}},{"key":["power-v1","12AX7","EL84","43","8.0","15",352800],"detector":{"real":264.58690782199915,"imaginary":7.109139753188531},"anchor":{"b0":0.08888457486211689,"b1":-0.0887730101760064,"a1":-1.968564388623041,"a2":0.9686759533091516}},{"key":["power-v1","12AX7","EL84","43","8.0","16",352800],"detector":{"real":273.25952018895987,"imaginary":7.33860589167301},"anchor":{"b0":0.11046191640385211,"b1":-0.11031667564914997,"a1":-1.9660222395509321,"a2":0.9661674803056342}},{"key":["power-v1","12AX7","EL84","43","8.0","4",384000],"detector":{"real":136.81688453124195,"imaginary":3.462162210189097},"anchor":{"b0":0.08678634781343371,"b1":-0.0867149915971098,"a1":-1.9710295158577154,"a2":0.9711008720740392}},{"key":["power-v1","12AX7","EL84","43","8.0","8",384000],"detector":{"real":193.52223826753635,"imaginary":4.934075361170708},"anchor":{"b0":0.08686669442014322,"b1":-0.08681669863662474,"a1":-1.9724667782408687,"a2":0.9725167740243872}},{"key":["power-v1","12AX7","EL84","43","8.0","15",384000],"detector":{"real":265.0226075299777,"imaginary":6.7824956308357685},"anchor":{"b0":0.0853213018287839,"b1":-0.08524152021549183,"a1":-1.9779190674205176,"a2":0.9779988490338096}},{"key":["power-v1","12AX7","EL84","43","8.0","16",384000],"detector":{"real":273.709492672513,"imaginary":7.001260977243166},"anchor":{"b0":0.08180508376808629,"b1":-0.08160216118276133,"a1":-1.9711164448521492,"a2":0.9713193674374743}},{"key":["power-v1","12AX7","EL34","0","6.0","4",352800],"detector":{"real":208.9493480778098,"imaginary":4.4505177691785605},"anchor":{"b0":0.09153405461311324,"b1":-0.09138560465932268,"a1":-1.9721702298552077,"a2":0.9723186798089983}},{"key":["power-v1","12AX7","EL34","0","6.0","8",352800],"detector":{"real":295.5509830151652,"imaginary":6.351678633313196},"anchor":{"b0":0.0906163670804294,"b1":-0.09053720084266213,"a1":-1.977281682088239,"a2":0.9773608483260063}},{"key":["power-v1","12AX7","EL34","0","6.0","15",352800],"detector":{"real":404.7478665892862,"imaginary":8.737379671188354},"anchor":{"b0":0.0913097397935134,"b1":-0.09116925147781403,"a1":-1.9711064036722328,"a2":0.9712468919879321}},{"key":["power-v1","12AX7","EL34","0","6.0","16",352800],"detector":{"real":418.01463702209355,"imaginary":9.018332860417791},"anchor":{"b0":0.0940569884595319,"b1":-0.09394586249684879,"a1":-1.9667819005660347,"a2":0.9668930265287179}},{"key":["power-v1","12AX7","EL34","0","6.0","4",384000],"detector":{"real":209.25685611309635,"imaginary":4.2239963027089145},"anchor":{"b0":0.08732686847589864,"b1":-0.08728513962030986,"a1":-1.977685098814753,"a2":0.9777268276703416}},{"key":["power-v1","12AX7","EL34","0","6.0","8",384000],"detector":{"real":295.98609052880676,"imaginary":6.03123251637738},"anchor":{"b0":0.09652857595188945,"b1":-0.0963731219380784,"a1":-1.975063733522012,"a2":0.9752191875358229}},{"key":["power-v1","12AX7","EL34","0","6.0","15",384000],"detector":{"real":405.34382358997374,"imaginary":8.298479659558236},"anchor":{"b0":0.0834299685779945,"b1":-0.08331796926908484,"a1":-1.9696795301793668,"a2":0.9697915294882766}},{"key":["power-v1","12AX7","EL34","0","6.0","16",384000],"detector":{"real":418.6301160903452,"imaginary":8.565056495934652},"anchor":{"b0":0.10167131431604222,"b1":-0.10149220471993621,"a1":-1.970562354059759,"a2":0.9707414636558649}},{"key":["power-v1","12AX7","EL34","0","6.6","4",352800],"detector":{"real":215.83085935591964,"imaginary":4.6716223787310485},"anchor":{"b0":0.0894778870152966,"b1":-0.08939466228363965,"a1":-1.9721695117627942,"a2":0.9722527364944511}},{"key":["power-v1","12AX7","EL34","0","6.6","8",352800],"detector":{"real":305.2846014280481,"imaginary":6.6662867499308955},"anchor":{"b0":0.10248204582149681,"b1":-0.10243069941718198,"a1":-1.9660309042657476,"a2":0.9660822506700623}},{"key":["power-v1","12AX7","EL34","0","6.6","15",352800],"detector":{"real":418.07773987360235,"imaginary":9.169508898337462},"anchor":{"b0":0.0958411591378572,"b1":-0.09568466603632186,"a1":-1.9729817754746042,"a2":0.9731382685761395}},{"key":["power-v1","12AX7","EL34","0","6.6","16",352800],"detector":{"real":431.7814369881973,"imaginary":9.464447065709924},"anchor":{"b0":0.09836031586785973,"b1":-0.09822873954440046,"a1":-1.9742993558144866,"a2":0.9744309321379458}},{"key":["power-v1","12AX7","EL34","0","6.6","4",384000],"detector":{"real":216.1455987703916,"imaginary":4.439531532557575},"anchor":{"b0":0.08726311529428168,"b1":-0.08721883399342645,"a1":-1.9778311773768391,"a2":0.9778754586776942}},{"key":["power-v1","12AX7","EL34","0","6.6","8",384000],"detector":{"real":305.72994169537986,"imaginary":6.337961179151574},"anchor":{"b0":0.08189691958819544,"b1":-0.0817713284300099,"a1":-1.9775476244329762,"a2":0.9776732155911617}},{"key":["power-v1","12AX7","EL34","0","6.6","15",384000],"detector":{"real":418.6877131278742,"imaginary":8.719815706119714},"anchor":{"b0":0.09058334167266552,"b1":-0.09042769947683701,"a1":-1.9748152036992828,"a2":0.9749708458951114}},{"key":["power-v1","12AX7","EL34","0","6.6","16",384000],"detector":{"real":432.4113913983723,"imaginary":9.000024352190096},"anchor":{"b0":0.08802958903836897,"b1":-0.08782832847160144,"a1":-1.9687471678155226,"a2":0.9689484283822901}},{"key":["power-v1","12AX7","EL34","0","8.0","4",352800],"detector":{"real":229.49449727313666,"imaginary":5.084688252173459},"anchor":{"b0":0.08906712574877376,"b1":-0.08901513848551111,"a1":-1.9769846201087833,"a2":0.9770366073720459}},{"key":["power-v1","12AX7","EL34","0","8.0","8",352800],"detector":{"real":324.61126952744627,"imaginary":7.2542540593409415},"anchor":{"b0":0.09320992467403023,"b1":-0.09313934739340984,"a1":-1.972913524187166,"a2":0.9729841014677865}},{"key":["power-v1","12AX7","EL34","0","8.0","15",352800],"detector":{"real":444.5449872807205,"imaginary":9.9772595360897},"anchor":{"b0":0.11358584942551288,"b1":-0.1135162260585117,"a1":-1.971526906006298,"a2":0.9715965293732993}},{"key":["power-v1","12AX7","EL34","0","8.0","16",352800],"detector":{"real":459.1162275224903,"imaginary":10.298318240254494},"anchor":{"b0":0.09884905188474136,"b1":-0.09875968712964392,"a1":-1.9728343196896407,"a2":0.9729236844447381}},{"key":["power-v1","12AX7","EL34","0","8.0","4",384000],"detector":{"real":229.8222600081134,"imaginary":4.842475620153139},"anchor":{"b0":0.0891379489526823,"b1":-0.08906972358248061,"a1":-1.9761598316304763,"a2":0.9762280570006779}},{"key":["power-v1","12AX7","EL34","0","8.0","8",384000],"detector":{"real":325.07503948012607,"imaginary":6.911607108025056},"anchor":{"b0":0.0854159159686499,"b1":-0.08531814855653133,"a1":-1.9771834926756922,"a2":0.9772812600878107}},{"key":["power-v1","12AX7","EL34","0","8.0","15",384000],"detector":{"real":445.1802043890001,"imaginary":9.507948579293545},"anchor":{"b0":0.0870759594108087,"b1":-0.08698210091908393,"a1":-1.9737823394567122,"a2":0.973876197948437}},{"key":["power-v1","12AX7","EL34","0","8.0","16",384000],"detector":{"real":459.77225246022863,"imaginary":9.81363550791763},"anchor":{"b0":0.0889029620287372,"b1":-0.08869679138798614,"a1":-1.9674436238619957,"a2":0.9676497945027468}},{"key":["power-v1","12AX7","EL34","20","6.0","4",352800],"detector":{"real":136.49028938056563,"imaginary":2.3961980103425837},"anchor":{"b0":0.10688635020409079,"b1":-0.10669044588786225,"a1":-1.971775013588827,"a2":0.9719709179050556}},{"key":["power-v1","12AX7","EL34","20","6.0","8",352800],"detector":{"real":193.0605118469741,"imaginary":3.4262938328133097},"anchor":{"b0":0.09304139235452485,"b1":-0.09286209923591027,"a1":-1.9731840759380228,"a2":0.9733633690566373}},{"key":["power-v1","12AX7","EL34","20","6.0","15",352800],"detector":{"real":264.39045364030966,"imaginary":4.717646093741313},"anchor":{"b0":0.0920243113231295,"b1":-0.0918623721579221,"a1":-1.9729061717256617,"a2":0.9730681108908691}},{"key":["power-v1","12AX7","EL34","20","6.0","16",352800],"detector":{"real":273.05659458849493,"imaginary":4.868727459235106},"anchor":{"b0":0.09652091606536424,"b1":-0.09638879428787066,"a1":-1.9746211496138029,"a2":0.9747532713912964}},{"key":["power-v1","12AX7","EL34","20","6.0","4",384000],"detector":{"real":136.64723130280456,"imaginary":2.2820657372900843},"anchor":{"b0":0.09076713211023404,"b1":-0.09062387983586605,"a1":-1.9758156788338526,"a2":0.9759589311082204}},{"key":["power-v1","12AX7","EL34","20","6.0","8",384000],"detector":{"real":193.28258803172497,"imaginary":3.264820311639666},"anchor":{"b0":3.2662066523559803,"b1":-3.2451207015018255,"a1":-1.1519395801633816,"a2":0.1730255310175364}},{"key":["power-v1","12AX7","EL34","20","6.0","15",384000],"detector":{"real":264.6946324939447,"imaginary":4.496466237353012},"anchor":{"b0":0.08917935165287158,"b1":-0.08904564440271563,"a1":-1.9768717897529027,"a2":0.9770054970030586}},{"key":["power-v1","12AX7","EL34","20","6.0","16",384000],"detector":{"real":273.37073678102263,"imaginary":4.640305505422692},"anchor":{"b0":0.09195027400060528,"b1":-0.09177004231524172,"a1":-1.971983175418642,"a2":0.9721634071040056}},{"key":["power-v1","12AX7","EL34","20","6.6","4",352800],"detector":{"real":137.49769655649243,"imaginary":2.444694091043812},"anchor":{"b0":0.09589555003836614,"b1":-0.09577738896247708,"a1":-1.9714438563979004,"a2":0.9715620174737893}},{"key":["power-v1","12AX7","EL34","20","6.6","8",352800],"detector":{"real":194.48544402597457,"imaginary":3.495162791714222},"anchor":{"b0":0.08960673498294908,"b1":-0.08948068101835789,"a1":-1.9762245870592974,"a2":0.9763506410238886}},{"key":["power-v1","12AX7","EL34","20","6.6","15",352800],"detector":{"real":266.3418489579623,"imaginary":4.812147689996044},"anchor":{"b0":0.08846585584471645,"b1":-0.08842148762240176,"a1":-1.9776820218652373,"a2":0.9777263900875519}},{"key":["power-v1","12AX7","EL34","20","6.6","16",352800],"detector":{"real":275.07195319880435,"imaginary":4.966300410404342},"anchor":{"b0":0.10390517953737105,"b1":-0.10371845633923095,"a1":-1.970417506720703,"a2":0.9706042299188432}},{"key":["power-v1","12AX7","EL34","20","6.6","4",384000],"detector":{"real":137.65266244787708,"imaginary":2.329940502752699},"anchor":{"b0":0.10178234127351535,"b1":-0.10163220622976318,"a1":-1.9696183895663755,"a2":0.9697685246101276}},{"key":["power-v1","12AX7","EL34","20","6.6","8",384000],"detector":{"real":194.70472566277132,"imaginary":3.3328090917224795},"anchor":{"b0":0.1043206754924586,"b1":-0.10422566159762561,"a1":-1.9718001947244561,"a2":0.971895208619289}},{"key":["power-v1","12AX7","EL34","20","6.6","15",384000],"detector":{"real":266.64220094444914,"imaginary":4.589761898725305},"anchor":{"b0":0.09245075222874775,"b1":-0.09239601763591933,"a1":-1.9766817811217767,"a2":0.9767365157146052}},{"key":["power-v1","12AX7","EL34","20","6.6","16",384000],"detector":{"real":275.38214313747056,"imaginary":4.736633030192375},"anchor":{"b0":0.08399956741898919,"b1":-0.08394861546479936,"a1":-1.9778597394585002,"a2":0.9779106914126899}},{"key":["power-v1","12AX7","EL34","20","8.0","4",352800],"detector":{"real":138.60417196667547,"imaginary":2.5138053550322765},"anchor":{"b0":0.8060294797087555,"b1":-0.4720518104702626,"a1":-0.8418753919447692,"a2":0.1758530611832621}},{"key":["power-v1","12AX7","EL34","20","8.0","8",352800],"detector":{"real":196.05049953247382,"imaginary":3.5932178892658477},"anchor":{"b0":0.7869779661308111,"b1":-0.419197321693576,"a1":-0.7847553093976116,"a2":0.1525359538348466}},{"key":["power-v1","12AX7","EL34","20","8.0","15",352800],"detector":{"real":268.4851350684269,"imaginary":4.9466376823456395},"anchor":{"b0":0.7620814243335907,"b1":-0.35277530215310005,"a1":-0.7195538028188925,"a2":0.1288599249993831}},{"key":["power-v1","12AX7","EL34","20","8.0","16",352800],"detector":{"real":277.2854928772933,"imaginary":5.105169903718823},"anchor":{"b0":0.734688552950321,"b1":-0.6709313520235995,"a1":-1.0627386182381444,"a2":0.12649581916486594}},{"key":["power-v1","12AX7","EL34","20","8.0","4",384000],"detector":{"real":138.75389398909113,"imaginary":2.3978551313811867},"anchor":{"b0":1.2891774664875688,"b1":-1.0591305341220376,"a1":-1.0373490225959094,"a2":0.26739595496144075}},{"key":["power-v1","12AX7","EL34","20","8.0","8",384000],"detector":{"real":196.26236458982962,"imaginary":3.42916968194568},"anchor":{"b0":1.3778125376769472,"b1":-1.2481034225678094,"a1":-1.2056242666128147,"a2":0.3353333817219525}},{"key":["power-v1","12AX7","EL34","20","8.0","15",384000],"detector":{"real":268.77533104302887,"imaginary":4.721929536450038},"anchor":{"b0":1.3541803194871547,"b1":-1.1880302066855217,"a1":-1.184769694376778,"a2":0.35091980717841104}},{"key":["power-v1","12AX7","EL34","20","8.0","16",384000],"detector":{"real":277.58519372834377,"imaginary":4.873104237580116},"anchor":{"b0":1.3650155109636675,"b1":-1.234785253432988,"a1":-1.1983050620715425,"a2":0.3285353196022221}},{"key":["power-v1","12AX7","EL34","43","6.0","4",352800],"detector":{"real":100.97809684887703,"imaginary":1.5934142493016217},"anchor":{"b0":0.8190818007412457,"b1":-0.26200854015077335,"a1":-0.5007989973837561,"a2":0.05787225797422844}},{"key":["power-v1","12AX7","EL34","43","6.0","8",352800],"detector":{"real":142.82986561135323,"imaginary":2.2811686980110246},"anchor":{"b0":0.8863047435514028,"b1":-0.6951112394963151,"a1":-0.9621217255768834,"a2":0.1533152296319709}},{"key":["power-v1","12AX7","EL34","43","6.0","15",352800],"detector":{"real":195.60115638119876,"imaginary":3.1428122010622133},"anchor":{"b0":0.8190818007412457,"b1":-0.3483921850778281,"a1":-0.6062629996957107,"a2":0.07695261535912837}},{"key":["power-v1","12AX7","EL34","43","6.0","16",352800],"detector":{"real":202.01252995224286,"imaginary":3.24319846787253},"anchor":{"b0":1.0228744077553655,"b1":-0.8943900719313519,"a1":-1.1903864972714695,"a2":0.3188708330954832}},{"key":["power-v1","12AX7","EL34","43","6.0","4",384000],"detector":{"real":101.07819341774336,"imaginary":1.5219040669510546},"anchor":{"b0":1.4202142898502583,"b1":-1.12798094778329,"a1":-0.9160760268361721,"a2":0.2083093689031403}},{"key":["power-v1","12AX7","EL34","43","6.0","8",384000],"detector":{"real":142.971509592679,"imaginary":2.1799877859145034},"anchor":{"b0":1.6648412067115215,"b1":-1.5593668922570796,"a1":-1.3504638133115545,"a2":0.4559381277659963}},{"key":["power-v1","12AX7","EL34","43","6.0","15",384000],"detector":{"real":195.79516991760136,"imaginary":3.004210691300338},"anchor":{"b0":1.6648412067115215,"b1":-1.5593668922570796,"a1":-1.3504638133115545,"a2":0.4559381277659963}},{"key":["power-v1","12AX7","EL34","43","6.0","16",384000],"detector":{"real":202.2128980039008,"imaginary":3.1000599181641175},"anchor":{"b0":1.6648412067115215,"b1":-1.5593668922570796,"a1":-1.3504638133115545,"a2":0.4559381277659963}},{"key":["power-v1","12AX7","EL34","43","6.6","4",352800],"detector":{"real":100.20694262281674,"imaginary":1.6013552981014436},"anchor":{"b0":0.5746551995630436,"b1":-0.37478129259419585,"a1":-1.0775294372055302,"a2":0.2774033441743779}},{"key":["power-v1","12AX7","EL34","43","6.6","8",352800],"detector":{"real":141.73909024847356,"imaginary":2.2921922128695225},"anchor":{"b0":0.4884788382763336,"b1":-0.16620318333782783,"a1":-0.8365853206350337,"a2":0.15886097557353937}},{"key":["power-v1","12AX7","EL34","43","6.6","15",352800],"detector":{"real":194.10736921274645,"imaginary":3.1577649783764024},"anchor":{"b0":0.5195021220778919,"b1":-0.23312105170389263,"a1":-0.923126897313324,"a2":0.2095079676873234}},{"key":["power-v1","12AX7","EL34","43","6.6","16",352800],"detector":{"real":200.46978024185037,"imaginary":3.2586614222816737},"anchor":{"b0":0.4771611764862085,"b1":-0.0863271408060735,"a1":-0.7452255985619582,"a2":0.13605963424209325}},{"key":["power-v1","12AX7","EL34","43","6.6","4",384000],"detector":{"real":100.30400170608296,"imaginary":1.529902801502847},"anchor":{"b0":1.0789455626723845,"b1":-0.9465651666755436,"a1":-1.2676167538441663,"a2":0.39999714984100715}},{"key":["power-v1","12AX7","EL34","43","6.6","8",384000],"detector":{"real":141.87643758344637,"imaginary":2.191092634791896},"anchor":{"b0":1.1807518055836648,"b1":-1.1059464807678663,"a1":-1.444897319149017,"a2":0.5197026439648156}},{"key":["power-v1","12AX7","EL34","43","6.6","15",384000],"detector":{"real":194.2954981900127,"imaginary":3.019274581937918},"anchor":{"b0":1.147009389021883,"b1":-1.0743417805483657,"a1":-1.4141098052222663,"a2":0.48677741369578376}},{"key":["power-v1","12AX7","EL34","43","6.6","16",384000],"detector":{"real":200.664070918551,"imaginary":3.115637634748661},"anchor":{"b0":1.147009389021883,"b1":-1.0743417805483657,"a1":-1.4141098052222663,"a2":0.48677741369578376}},{"key":["power-v1","12AX7","EL34","43","8.0","4",352800],"detector":{"real":98.01951918569543,"imaginary":1.601792200480719},"anchor":{"b0":0.07042920515761333,"b1":-0.012741924972340776,"a1":-1.432788545356921,"a2":0.4904758255421935}},{"key":["power-v1","12AX7","EL34","43","8.0","8",352800],"detector":{"real":138.64504960275724,"imaginary":2.292218209513159},"anchor":{"b0":0.07042920515761333,"b1":-0.012741924972340776,"a1":-1.432788545356921,"a2":0.4904758255421935}},{"key":["power-v1","12AX7","EL34","43","8.0","15",352800],"detector":{"real":189.87016794556158,"imaginary":3.157392806293456},"anchor":{"b0":0.07042920515761333,"b1":-0.012741924972340776,"a1":-1.432788545356921,"a2":0.4904758255421935}},{"key":["power-v1","12AX7","EL34","43","8.0","16",352800],"detector":{"real":196.09369384014153,"imaginary":3.2583339921418397},"anchor":{"b0":0.07169575645553286,"b1":-0.014984529365726893,"a1":-1.4315853527805684,"a2":0.4882965798703743}},{"key":["power-v1","12AX7","EL34","43","8.0","4",384000],"detector":{"real":98.11010043293369,"imaginary":1.530291942761951},"anchor":{"b0":0.08543744531319246,"b1":-0.008941410273938834,"a1":-1.007183427884918,"a2":0.08367946292417183}},{"key":["power-v1","12AX7","EL34","43","8.0","8",384000],"detector":{"real":138.77323333662744,"imaginary":2.191050593706888},"anchor":{"b0":0.11704860867663357,"b1":-0.02332342317995431,"a1":-1.0748649343483472,"a2":0.1685901198450265}},{"key":["power-v1","12AX7","EL34","43","8.0","15",384000],"detector":{"real":190.04574730434192,"imaginary":3.0188092732256995},"anchor":{"b0":0.23528848170692707,"b1":-0.04268015091303489,"a1":-1.1219867740142941,"a2":0.3145951048081864}},{"key":["power-v1","12AX7","EL34","43","8.0","16",384000],"detector":{"real":196.2750235630097,"imaginary":3.115214008108577},"anchor":{"b0":0.12269423090165434,"b1":-0.025505624740518467,"a1":-1.0851853454491076,"a2":0.18237395161024347}},{"key":["power-v1","12AX7","6L6GC","0","6.0","4",352800],"detector":{"real":107.12890467793743,"imaginary":2.0122819049564726},"anchor":{"b0":1.4022716496679937,"b1":-0.5964489549864345,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","6L6GC","0","6.0","8",352800],"detector":{"real":151.5298738096923,"imaginary":2.8753084652877097},"anchor":{"b0":1.4022716496679937,"b1":-0.5964489549864345,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","6L6GC","0","6.0","15",352800],"detector":{"real":207.5154930865863,"imaginary":3.9576159607925145},"anchor":{"b0":1.4022716496679937,"b1":-0.5964489549864345,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","6L6GC","0","6.0","16",352800],"detector":{"real":214.31740058918038,"imaginary":4.084549401438794},"anchor":{"b0":1.4022716496679937,"b1":-0.5964489549864345,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","6L6GC","0","6.0","4",384000],"detector":{"real":107.24524304694896,"imaginary":1.928830471205985},"anchor":{"b0":1.9485194013230354,"b1":-1.1968797346209563,"a1":-0.2651092557950589,"a2":0.016748922497137914}},{"key":["power-v1","12AX7","6L6GC","0","6.0","8",384000],"detector":{"real":151.69449716942876,"imaginary":2.757238287884083},"anchor":{"b0":1.8862772701672212,"b1":-1.117402072442941,"a1":-0.24628942214026633,"a2":0.015164619864546577}},{"key":["power-v1","12AX7","6L6GC","0","6.0","15",384000],"detector":{"real":207.74097987904634,"imaginary":3.795884642318634},"anchor":{"b0":1.8862772701672212,"b1":-1.117402072442941,"a1":-0.24628942214026633,"a2":0.015164619864546577}},{"key":["power-v1","12AX7","6L6GC","0","6.0","16",384000],"detector":{"real":214.5502730898752,"imaginary":3.917523003300982},"anchor":{"b0":1.8862772701672212,"b1":-1.117402072442941,"a1":-0.24628942214026633,"a2":0.015164619864546577}},{"key":["power-v1","12AX7","6L6GC","0","6.6","4",352800],"detector":{"real":111.53345874195986,"imaginary":2.119938238363466},"anchor":{"b0":1.1848256782928834,"b1":-0.3790029836113242,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","6L6GC","0","6.6","8",352800],"detector":{"real":157.759945816407,"imaginary":3.0287775305999753},"anchor":{"b0":1.1848256782928834,"b1":-0.3790029836113242,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","6L6GC","0","6.6","15",352800],"detector":{"real":216.04738031344505,"imaginary":4.16860828894824},"anchor":{"b0":1.1848256782928834,"b1":-0.3790029836113242,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","6L6GC","0","6.6","16",352800],"detector":{"real":223.12894521666954,"imaginary":4.302342899573698},"anchor":{"b0":1.1848256782928834,"b1":-0.3790029836113242,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","6L6GC","0","6.6","4",384000],"detector":{"real":111.6541190870364,"imaginary":2.0330484194618297},"anchor":{"b0":1.6267202078818115,"b1":-0.8758813016693388,"a1":-0.26428665723413813,"a2":0.015125563446611017}},{"key":["power-v1","12AX7","6L6GC","0","6.6","8",384000],"detector":{"real":157.93068521523116,"imaginary":2.9058421489928254},"anchor":{"b0":1.6827756682861028,"b1":-1.0518746380057893,"a1":-0.4076188609873327,"a2":0.03851989126764644}},{"key":["power-v1","12AX7","6L6GC","0","6.6","15",384000],"detector":{"real":216.28124427539225,"imaginary":4.000212548252135},"anchor":{"b0":1.5881270386913031,"b1":-0.8958167082790237,"a1":-0.32583876135310064,"a2":0.018149091765380064}},{"key":["power-v1","12AX7","6L6GC","0","6.6","16",384000],"detector":{"real":223.3704692642104,"imaginary":4.128434063686095},"anchor":{"b0":1.5393313060965659,"b1":-0.9118765405343174,"a1":-0.41575915270152386,"a2":0.04321391826377226}},{"key":["power-v1","12AX7","6L6GC","0","8.0","4",352800],"detector":{"real":120.66145167410424,"imaginary":2.3388349995397775},"anchor":{"b0":0.8190818007412457,"b1":-0.26200854015077335,"a1":-0.5007989973837561,"a2":0.05787225797422844}},{"key":["power-v1","12AX7","6L6GC","0","8.0","8",352800],"detector":{"real":170.6711413023712,"imaginary":3.34087089252198},"anchor":{"b0":0.8190818007412457,"b1":-0.26200854015077335,"a1":-0.5007989973837561,"a2":0.05787225797422844}},{"key":["power-v1","12AX7","6L6GC","0","8.0","15",352800],"detector":{"real":233.7288558965281,"imaginary":4.597712074659193},"anchor":{"b0":0.8190818007412457,"b1":-0.26200854015077335,"a1":-0.5007989973837561,"a2":0.05787225797422844}},{"key":["power-v1","12AX7","6L6GC","0","8.0","16",352800],"detector":{"real":241.3899824470816,"imaginary":4.745274284023593},"anchor":{"b0":0.7920203342874659,"b1":-0.37846132857715903,"a1":-0.6263594950455746,"a2":0.03991850075588147}},{"key":["power-v1","12AX7","6L6GC","0","8.0","4",384000],"detector":{"real":120.79084097528029,"imaginary":2.2448361226637505},"anchor":{"b0":1.1532783265730793,"b1":-0.5258235610108309,"a1":-0.41575915270152386,"a2":0.04321391826377226}},{"key":["power-v1","12AX7","6L6GC","0","8.0","8",384000],"detector":{"real":170.85423327594387,"imaginary":3.207877117170936},"anchor":{"b0":1.1532783265730793,"b1":-0.5258235610108309,"a1":-0.41575915270152386,"a2":0.04321391826377226}},{"key":["power-v1","12AX7","6L6GC","0","8.0","15",384000],"detector":{"real":233.9796397181705,"imaginary":4.415538417654725},"anchor":{"b0":1.1532783265730793,"b1":-0.5258235610108309,"a1":-0.41575915270152386,"a2":0.04321391826377226}},{"key":["power-v1","12AX7","6L6GC","0","8.0","16",384000],"detector":{"real":241.64898051763902,"imaginary":4.557136268773911},"anchor":{"b0":1.1532783265730793,"b1":-0.5258235610108309,"a1":-0.41575915270152386,"a2":0.04321391826377226}},{"key":["power-v1","12AX7","6L6GC","20","6.0","4",352800],"detector":{"real":76.50753111179066,"imaginary":1.3157684344848948},"anchor":{"b0":0.7622201079849845,"b1":-0.26512069772390984,"a1":-0.5426390914749664,"a2":0.03973850173604108}},{"key":["power-v1","12AX7","6L6GC","20","6.0","8",352800],"detector":{"real":108.21710619345384,"imaginary":1.8818233271857399},"anchor":{"b0":0.7584763634459522,"b1":-0.24262202449804013,"a1":-0.5276685254460446,"a2":0.04352286439395661}},{"key":["power-v1","12AX7","6L6GC","20","6.0","15",352800],"detector":{"real":148.20001506177766,"imaginary":2.5913601894865},"anchor":{"b0":0.7584763634459522,"b1":-0.24262202449804013,"a1":-0.5276685254460446,"a2":0.04352286439395661}},{"key":["power-v1","12AX7","6L6GC","20","6.0","16",352800],"detector":{"real":153.0576868300407,"imaginary":2.6743078555113486},"anchor":{"b0":0.7584763634459522,"b1":-0.24262202449804013,"a1":-0.5276685254460446,"a2":0.04352286439395661}},{"key":["power-v1","12AX7","6L6GC","20","6.0","4",384000],"detector":{"real":76.57899600322945,"imaginary":1.2604755465336652},"anchor":{"b0":1.07009116997831,"b1":-0.37551618703210876,"a1":-0.33102428742089507,"a2":0.025599270367096267}},{"key":["power-v1","12AX7","6L6GC","20","6.0","8",384000],"detector":{"real":108.31823724726601,"imaginary":1.8035877816290007},"anchor":{"b0":1.07009116997831,"b1":-0.37551618703210876,"a1":-0.33102428742089507,"a2":0.025599270367096267}},{"key":["power-v1","12AX7","6L6GC","20","6.0","15",384000],"detector":{"real":148.33853871566535,"imaginary":2.4841898700221288},"anchor":{"b0":1.0750972680569058,"b1":-0.2327826315801323,"a1":-0.1641095626070648,"a2":0.006424199083838212}},{"key":["power-v1","12AX7","6L6GC","20","6.0","16",384000],"detector":{"real":153.20074726963617,"imaginary":2.5636294564823463},"anchor":{"b0":1.07009116997831,"b1":-0.37551618703210876,"a1":-0.33102428742089507,"a2":0.025599270367096267}},{"key":["power-v1","12AX7","6L6GC","20","6.6","4",352800],"detector":{"real":77.7951632699037,"imaginary":1.3536570488352158},"anchor":{"b0":0.503654887842014,"b1":-0.5028955307929631,"a1":-1.0682224113796326,"a2":0.0689817684286835}},{"key":["power-v1","12AX7","6L6GC","20","6.6","8",352800],"detector":{"real":110.03841057304396,"imaginary":1.9357639740963568},"anchor":{"b0":0.5356409028117533,"b1":-0.1586897271150163,"a1":-0.6772057258378541,"a2":0.05415690153459102}},{"key":["power-v1","12AX7","6L6GC","20","6.6","15",352800],"detector":{"real":150.6942327215816,"imaginary":2.6654704007643963},"anchor":{"b0":0.5654953932496395,"b1":-0.05798642340565872,"a1":-0.5720469092974314,"a2":0.07955587914141213}},{"key":["power-v1","12AX7","6L6GC","20","6.6","16",352800],"detector":{"real":155.6336598333694,"imaginary":2.750813724033276},"anchor":{"b0":0.49480078797624427,"b1":-0.48978604565879685,"a1":-1.0714181199949249,"a2":0.07643286231237219}},{"key":["power-v1","12AX7","6L6GC","20","6.6","4",384000],"detector":{"real":77.86694893791034,"imaginary":1.2967708596776466},"anchor":{"b0":0.8267087388037888,"b1":-0.14706402899932436,"a1":-0.3486825786404309,"a2":0.02832728844489533}},{"key":["power-v1","12AX7","6L6GC","20","6.6","8",384000],"detector":{"real":110.13999620294838,"imaginary":1.8552743169652406},"anchor":{"b0":0.8293101980711155,"b1":-0.17750347193503088,"a1":-0.37439491014809706,"a2":0.02620163628418168}},{"key":["power-v1","12AX7","6L6GC","20","6.6","15",384000],"detector":{"real":150.83337951936414,"imaginary":2.5552124543147015},"anchor":{"b0":0.8768552889298669,"b1":-0.7692702036425689,"a1":-1.0004504801684788,"a2":0.10803556545577674}},{"key":["power-v1","12AX7","6L6GC","20","6.6","16",384000],"detector":{"real":155.77736389691717,"imaginary":2.63694661805337},"anchor":{"b0":0.8214836393005345,"b1":-0.8203436763133811,"a1":-1.0710016261852693,"a2":0.07214158917242264}},{"key":["power-v1","12AX7","6L6GC","20","8.0","4",352800],"detector":{"real":79.93070958095245,"imaginary":1.4210657605042913},"anchor":{"b0":0.16179236892505544,"b1":-0.014129866505580738,"a1":-0.9928698778515765,"a2":0.14053238027105122}},{"key":["power-v1","12AX7","6L6GC","20","8.0","8",352800],"detector":{"real":113.05905430684375,"imaginary":2.0316897662604676},"anchor":{"b0":0.15992359602228626,"b1":-0.05115648753462929,"a1":-1.048126690047799,"a2":0.15689379853545599}},{"key":["power-v1","12AX7","6L6GC","20","8.0","15",352800],"detector":{"real":154.8309061907412,"imaginary":2.797235694902224},"anchor":{"b0":0.12815520172071626,"b1":-0.02579663667073687,"a1":-1.0094101960794124,"a2":0.11176876112939188}},{"key":["power-v1","12AX7","6L6GC","20","8.0","16",352800],"detector":{"real":159.90592528431222,"imaginary":2.886842541115508},"anchor":{"b0":0.11973172834907424,"b1":-0.020101619090529994,"a1":-0.9947505670860939,"a2":0.09438067634463812}},{"key":["power-v1","12AX7","6L6GC","20","8.0","4",384000],"detector":{"real":80.00255560403609,"imaginary":1.361003902464961},"anchor":{"b0":0.44581578052189846,"b1":-0.09267599558537651,"a1":-0.8068579349444072,"a2":0.15999771988092912}},{"key":["power-v1","12AX7","6L6GC","20","8.0","8",384000],"detector":{"real":113.16072720212833,"imaginary":1.946706847831299},"anchor":{"b0":0.3712263468297472,"b1":-0.1692562455509653,"a1":-0.892810123563373,"a2":0.09478022484215488}},{"key":["power-v1","12AX7","6L6GC","20","8.0","15",384000],"detector":{"real":154.9701734897346,"imaginary":2.680823365972057},"anchor":{"b0":0.43305899740258197,"b1":-0.04867691431081711,"a1":-0.7559467086528263,"a2":0.14032879174459117}},{"key":["power-v1","12AX7","6L6GC","20","8.0","16",384000],"detector":{"real":160.049753544596,"imaginary":2.766619382430073},"anchor":{"b0":0.3712263468297472,"b1":-0.1692562455509653,"a1":-0.892810123563373,"a2":0.09478022484215488}},{"key":["power-v1","12AX7","6L6GC","43","6.0","4",352800],"detector":{"real":58.85141097361189,"imaginary":0.9598559465900202},"anchor":{"b0":0.13598010652960985,"b1":-0.01835578637245729,"a1":-0.9418898577722865,"a2":0.05951417792943913}},{"key":["power-v1","12AX7","6L6GC","43","6.0","8",352800],"detector":{"real":83.24318367201661,"imaginary":1.3736167634966447},"anchor":{"b0":0.14553343418329606,"b1":-0.02632964684438436,"a1":-0.9695322157981329,"a2":0.08873600313704458}},{"key":["power-v1","12AX7","6L6GC","43","6.0","15",352800],"detector":{"real":113.9990023666946,"imaginary":1.89209569980059},"anchor":{"b0":0.14553343418329606,"b1":-0.02632964684438436,"a1":-0.9695322157981329,"a2":0.08873600313704458}},{"key":["power-v1","12AX7","6L6GC","43","6.0","16",352800],"detector":{"real":117.73563851891063,"imaginary":1.9525826196021094},"anchor":{"b0":0.14553343418329606,"b1":-0.02632964684438436,"a1":-0.9695322157981329,"a2":0.08873600313704458}},{"key":["power-v1","12AX7","6L6GC","43","6.0","4",384000],"detector":{"real":58.90120731209294,"imaginary":0.9190968977501525},"anchor":{"b0":0.40761515281161104,"b1":-0.05019565022079402,"a1":-0.7155295582585222,"a2":0.07294906084933915}},{"key":["power-v1","12AX7","6L6GC","43","6.0","8",384000],"detector":{"real":83.31365423574155,"imaginary":1.3159435752997526},"anchor":{"b0":0.45354210787126337,"b1":-0.10886645208606943,"a1":-0.7735516620625655,"a2":0.11822731784775951}},{"key":["power-v1","12AX7","6L6GC","43","6.0","15",384000],"detector":{"real":114.09553040650746,"imaginary":1.8130906505243711},"anchor":{"b0":0.3870865959738998,"b1":-0.13030464393624103,"a1":-0.7929916796452583,"a2":0.04977363168291715}},{"key":["power-v1","12AX7","6L6GC","43","6.0","16",384000],"detector":{"real":117.83532774427877,"imaginary":1.8709916470183676},"anchor":{"b0":0.40761515281161104,"b1":-0.05019565022079402,"a1":-0.7155295582585222,"a2":0.07294906084933915}},{"key":["power-v1","12AX7","6L6GC","43","6.6","4",352800],"detector":{"real":58.93240006243647,"imaginary":0.9738496360557881},"anchor":{"b0":0.0909244932727493,"b1":-0.09078349454903421,"a1":-1.9388764264574347,"a2":0.93901742518115}},{"key":["power-v1","12AX7","6L6GC","43","6.6","8",352800],"detector":{"real":83.3577363698964,"imaginary":1.3934324835295635},"anchor":{"b0":0.08897728377012261,"b1":-0.08882587802250788,"a1":-1.971121698292474,"a2":0.9712731040400887}},{"key":["power-v1","12AX7","6L6GC","43","6.6","15",352800],"detector":{"real":114.1558763415337,"imaginary":1.9192477756424489},"anchor":{"b0":0.09465861379533877,"b1":-0.09446233993707573,"a1":-1.9718929547287134,"a2":0.9720892285869763}},{"key":["power-v1","12AX7","6L6GC","43","6.6","16",352800],"detector":{"real":117.89765474740257,"imaginary":1.9806226869511931},"anchor":{"b0":0.09799382546038547,"b1":-0.09779950776739679,"a1":-1.9642751349513787,"a2":0.9644694526443676}},{"key":["power-v1","12AX7","6L6GC","43","6.6","4",384000],"detector":{"real":58.981517258613955,"imaginary":0.9322091940617948},"anchor":{"b0":0.04682974348496125,"b1":-0.005766835230944004,"a1":-1.591390370527117,"a2":0.6324532787811343}},{"key":["power-v1","12AX7","6L6GC","43","6.6","8",384000],"detector":{"real":83.4272463936886,"imaginary":1.3345122411787083},"anchor":{"b0":0.03747443327133084,"b1":-0.004370333365177671,"a1":-1.6124024205950638,"a2":0.6455065205012169}},{"key":["power-v1","12AX7","6L6GC","43","6.6","15",384000],"detector":{"real":114.25108936295774,"imaginary":1.838534750374298},"anchor":{"b0":0.04682974348496125,"b1":-0.005766835230944004,"a1":-1.591390370527117,"a2":0.6324532787811343}},{"key":["power-v1","12AX7","6L6GC","43","6.6","16",384000],"detector":{"real":117.99598584552123,"imaginary":1.897267756892248},"anchor":{"b0":0.04506290464473774,"b1":-0.010555348669010253,"a1":-1.6078710516227352,"a2":0.6423786075984628}},{"key":["power-v1","12AX7","6L6GC","43","8.0","4",352800],"detector":{"real":58.67297659289296,"imaginary":0.9947120677204175},"anchor":{"b0":0.08908229813741729,"b1":-0.08883581572589479,"a1":-1.9663577254633877,"a2":0.9666042078749102}},{"key":["power-v1","12AX7","6L6GC","43","8.0","8",352800],"detector":{"real":82.99078453577425,"imaginary":1.4228715413500153},"anchor":{"b0":0.08935249715684696,"b1":-0.08921901156598787,"a1":-1.9763176913697205,"a2":0.9764511769605796}},{"key":["power-v1","12AX7","6L6GC","43","8.0","15",352800],"detector":{"real":113.65334224454655,"imaginary":1.9595153527003044},"anchor":{"b0":0.08900356100009611,"b1":-0.08886195233869132,"a1":-1.975021945118534,"a2":0.9751635537799389}},{"key":["power-v1","12AX7","6L6GC","43","8.0","16",352800],"detector":{"real":117.37864938099344,"imaginary":2.022216864303333},"anchor":{"b0":0.09128066592693657,"b1":-0.0911172305463497,"a1":-1.962038785516001,"a2":0.9622022208965879}},{"key":["power-v1","12AX7","6L6GC","43","8.0","4",384000],"detector":{"real":58.72038314264975,"imaginary":0.951418709407343},"anchor":{"b0":0.08505355744203129,"b1":-0.08492069678627721,"a1":-1.976942536432251,"a2":0.9770753970880051}},{"key":["power-v1","12AX7","6L6GC","43","8.0","8",384000],"detector":{"real":83.05787519449267,"imaginary":1.361612920442823},"anchor":{"b0":0.08144134835423339,"b1":-0.08140096227274064,"a1":-1.9554907905903125,"a2":0.9555311766718051}},{"key":["power-v1","12AX7","6L6GC","43","8.0","15",384000],"detector":{"real":113.74524227237265,"imaginary":1.8755998460742362},"anchor":{"b0":0.08328095279438655,"b1":-0.08323488191262157,"a1":-1.9787670294903907,"a2":0.9788131003721557}},{"key":["power-v1","12AX7","6L6GC","43","8.0","16",384000],"detector":{"real":117.4735588100061,"imaginary":1.93555447272808},"anchor":{"b0":0.08426092661648686,"b1":-0.08417581595273378,"a1":-1.966090196273465,"a2":0.9661753069372179}},{"key":["power-v1","12AX7","KT88","0","6.0","4",352800],"detector":{"real":170.04789187802416,"imaginary":4.636585098208903},"anchor":{"b0":0.517565716758786,"b1":-0.5166661619973449,"a1":-1.0647538967028851,"a2":0.06565345146432616}},{"key":["power-v1","12AX7","KT88","0","6.0","8",352800],"detector":{"real":240.52606379527464,"imaginary":6.604334100765157},"anchor":{"b0":0.6332073661801432,"b1":-0.6283156920025671,"a1":-1.0548832242913202,"a2":0.05977489846889635}},{"key":["power-v1","12AX7","KT88","0","6.0","15",352800],"detector":{"real":329.3927642894704,"imaginary":9.076135260746707},"anchor":{"b0":0.6298496199668885,"b1":-0.6262137438960317,"a1":-1.0666481000922419,"a2":0.0702839761630986}},{"key":["power-v1","12AX7","KT88","0","6.0","16",352800],"detector":{"real":340.18958187441575,"imaginary":9.369204146032256},"anchor":{"b0":0.6382620292766752,"b1":-0.6194992876824708,"a1":-1.0471592771679243,"a2":0.0659220187621287}},{"key":["power-v1","12AX7","KT88","0","6.0","4",384000],"detector":{"real":170.40288784303584,"imaginary":4.365303341433026},"anchor":{"b0":0.8768552889298669,"b1":-0.10798009120558659,"a1":-0.24628942214026633,"a2":0.015164619864546577}},{"key":["power-v1","12AX7","KT88","0","6.0","8",384000],"detector":{"real":241.0283381474764,"imaginary":6.220612011917769},"anchor":{"b0":0.8768552889298669,"b1":-0.10798009120558659,"a1":-0.24628942214026633,"a2":0.015164619864546577}},{"key":["power-v1","12AX7","KT88","0","6.0","15",384000],"detector":{"real":330.08070447156973,"imaginary":8.55061107289101},"anchor":{"b0":0.8768552889298669,"b1":-0.10798009120558659,"a1":-0.24628942214026633,"a2":0.015164619864546577}},{"key":["power-v1","12AX7","KT88","0","6.0","16",384000],"detector":{"real":340.90005898731454,"imaginary":8.826459883287372},"anchor":{"b0":0.9310899545802253,"b1":-0.2244836495454727,"a1":-0.3143106886640298,"a2":0.02091699369878233}},{"key":["power-v1","12AX7","KT88","0","6.6","4",352800],"detector":{"real":175.84602997481173,"imaginary":4.800868255785169},"anchor":{"b0":0.4750955678190633,"b1":-0.4668815946986583,"a1":-1.095165790878723,"a2":0.10337976399912792}},{"key":["power-v1","12AX7","KT88","0","6.6","8",352800],"detector":{"real":248.72730058017498,"imaginary":6.838277115701992},"anchor":{"b0":0.454029218226824,"b1":-0.4428733788106243,"a1":-1.0588820001145633,"a2":0.07003783953076302}},{"key":["power-v1","12AX7","KT88","0","6.6","15",352800],"detector":{"real":340.6240949725833,"imaginary":9.397593963453145},"anchor":{"b0":0.43723010951737834,"b1":-0.40709667780419034,"a1":-1.060926175841007,"a2":0.091059607554195}},{"key":["power-v1","12AX7","KT88","0","6.6","16",352800],"detector":{"real":351.7890526969457,"imaginary":9.701048672764461},"anchor":{"b0":0.44609337334406474,"b1":-0.4073923146007027,"a1":-1.0285136134495982,"a2":0.06721467219296026}},{"key":["power-v1","12AX7","KT88","0","6.6","4",384000],"detector":{"real":176.20919735350847,"imaginary":4.522875764392204},"anchor":{"b0":0.7680826679413144,"b1":-0.7445815748659231,"a1":-1.0570827858576977,"a2":0.08058387893308887}},{"key":["power-v1","12AX7","KT88","0","6.6","8",384000],"detector":{"real":249.24113744751557,"imaginary":6.44506155089937},"anchor":{"b0":0.7255235711242828,"b1":-0.7235443326546304,"a1":-1.0691378021057891,"a2":0.07111704057544142}},{"key":["power-v1","12AX7","KT88","0","6.6","15",384000],"detector":{"real":341.32787229374406,"imaginary":8.859067104300753},"anchor":{"b0":0.7195251262351142,"b1":-0.7191871488846625,"a1":-1.0839264632728027,"a2":0.08426444062325435}},{"key":["power-v1","12AX7","KT88","0","6.6","16",384000],"detector":{"real":352.51588569448955,"imaginary":9.144875691973663},"anchor":{"b0":0.7327858707723115,"b1":-0.7292032974629772,"a1":-1.0556750117523672,"a2":0.059257585061701507}},{"key":["power-v1","12AX7","KT88","0","8.0","4",352800],"detector":{"real":187.37150701612157,"imaginary":5.099257623088885},"anchor":{"b0":0.2038100666756379,"b1":-0.1118447237781255,"a1":-0.9791838807151093,"a2":0.07114922361262173}},{"key":["power-v1","12AX7","KT88","0","8.0","8",352800],"detector":{"real":265.0296396564974,"imaginary":7.2634592282681805},"anchor":{"b0":0.20770587048763958,"b1":-0.13007989569153602,"a1":-0.979735532413845,"a2":0.05736150720994858}},{"key":["power-v1","12AX7","KT88","0","8.0","15",352800],"detector":{"real":362.9496308424507,"imaginary":9.982016559883748},"anchor":{"b0":0.20539519358806363,"b1":-0.07850646451868233,"a1":-0.9467180322329142,"a2":0.07360676130229546}},{"key":["power-v1","12AX7","KT88","0","8.0","16",352800],"detector":{"real":374.8463732428017,"imaginary":10.304327287168437},"anchor":{"b0":0.20743532370289505,"b1":-0.08823153636398336,"a1":-0.9695322157981329,"a2":0.08873600313704458}},{"key":["power-v1","12AX7","KT88","0","8.0","4",384000],"detector":{"real":187.7491108887912,"imaginary":4.8093806300476505},"anchor":{"b0":0.4154292632183497,"b1":-0.3177476902723145,"a1":-0.9601087315437997,"a2":0.05779030448983492}},{"key":["power-v1","12AX7","KT88","0","8.0","8",384000],"detector":{"real":265.5639041376608,"imaginary":6.853430861354748},"anchor":{"b0":0.43680160205876756,"b1":-0.43149181921995927,"a1":-1.0949607166132331,"a2":0.10027049945204146}},{"key":["power-v1","12AX7","KT88","0","8.0","15",384000],"detector":{"real":363.6813880662239,"imaginary":9.420461280931525},"anchor":{"b0":0.43081682701659013,"b1":-0.1942489380475732,"a1":-0.817890631179106,"a2":0.054458520148122934}},{"key":["power-v1","12AX7","KT88","0","8.0","16",384000],"detector":{"real":375.60210262306646,"imaginary":9.724371776442704},"anchor":{"b0":0.3690110721980247,"b1":-0.3638155629420006,"a1":-1.0559498979177608,"a2":0.061145407173784916}},{"key":["power-v1","12AX7","KT88","20","6.0","4",352800],"detector":{"real":97.07672898215648,"imaginary":1.8673925961257825},"anchor":{"b0":0.08087200088639446,"b1":-0.027797457060277336,"a1":-1.335302302112967,"a2":0.3883768459390843}},{"key":["power-v1","12AX7","KT88","20","6.0","8",352800],"detector":{"real":137.31143103409767,"imaginary":2.6676460057160605},"anchor":{"b0":0.06864377763480861,"b1":-0.007133674895202267,"a1":-1.2902604175928165,"a2":0.35177052033242284}},{"key":["power-v1","12AX7","KT88","20","6.0","15",352800],"detector":{"real":188.04376561658074,"imaginary":3.6713549713530944},"anchor":{"b0":0.11318984163250867,"b1":-0.008189759345202793,"a1":-1.3178213318739398,"a2":0.4228214141612456}},{"key":["power-v1","12AX7","KT88","20","6.0","16",352800],"detector":{"real":194.20743331786335,"imaginary":3.789167079951107},"anchor":{"b0":0.12290684650726126,"b1":-0.039315540155769824,"a1":-1.3731595471062725,"a2":0.45675085345776395}},{"key":["power-v1","12AX7","KT88","20","6.0","4",384000],"detector":{"real":97.21584592502074,"imaginary":1.75220343770345},"anchor":{"b0":0.1358191028475969,"b1":-0.02823401756029901,"a1":-1.0004504801684788,"a2":0.10803556545577674}},{"key":["power-v1","12AX7","KT88","20","6.0","8",384000],"detector":{"real":137.5082785352982,"imaginary":2.504695894191776},"anchor":{"b0":0.12953234801428104,"b1":-0.011303908538531937,"a1":-0.970723159260443,"a2":0.08895159873619203}},{"key":["power-v1","12AX7","KT88","20","6.0","15",384000],"detector":{"real":188.31338605689558,"imaginary":3.4481716238148055},"anchor":{"b0":0.12432350976309574,"b1":-0.01812163629048305,"a1":-0.9847463524916721,"a2":0.09094822596428474}},{"key":["power-v1","12AX7","KT88","20","6.0","16",384000],"detector":{"real":194.48588554109745,"imaginary":3.558672958331561},"anchor":{"b0":0.1358191028475969,"b1":-0.02823401756029901,"a1":-1.0004504801684788,"a2":0.10803556545577674}},{"key":["power-v1","12AX7","KT88","20","6.6","4",352800],"detector":{"real":96.95943998215704,"imaginary":1.8523311831391938},"anchor":{"b0":0.044260954384258595,"b1":-0.008759185969828148,"a1":-1.6138468681504665,"a2":0.6493486365648969}},{"key":["power-v1","12AX7","KT88","20","6.6","8",352800],"detector":{"real":137.14553358229674,"imaginary":2.646310604135298},"anchor":{"b0":0.04610921930914921,"b1":-0.007323872512767461,"a1":-1.6022677590993428,"a2":0.6410531058957247}},{"key":["power-v1","12AX7","KT88","20","6.6","15",352800],"detector":{"real":187.81657663194176,"imaginary":3.6421148892929924},"anchor":{"b0":0.05443994462986234,"b1":-0.01741429293808127,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AX7","KT88","20","6.6","16",352800],"detector":{"real":193.97279722454826,"imaginary":3.758971587475895},"anchor":{"b0":0.05443994462986234,"b1":-0.01741429293808127,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AX7","KT88","20","6.6","4",384000],"detector":{"real":97.09435244732455,"imaginary":1.7381388270985654},"anchor":{"b0":0.08011800990248585,"b1":-0.024337410043738662,"a1":-1.2861491490531682,"a2":0.3419297489119154}},{"key":["power-v1","12AX7","KT88","20","6.6","8",384000],"detector":{"real":137.33643368828868,"imaginary":2.484768928800966},"anchor":{"b0":0.06910377529537826,"b1":-0.008786462592621898,"a1":-1.2581091168108611,"a2":0.3184264295136174}},{"key":["power-v1","12AX7","KT88","20","6.6","15",384000],"detector":{"real":188.07805203068634,"imaginary":3.4208596687557384},"anchor":{"b0":0.09437020345275501,"b1":-0.017895824990591027,"a1":-1.310843017425491,"a2":0.3873173958876549}},{"key":["power-v1","12AX7","KT88","20","6.6","16",384000],"detector":{"real":194.24283740679897,"imaginary":3.5304690110400285},"anchor":{"b0":0.0768999691751756,"b1":-0.008079117405424956,"a1":-1.279603445660906,"a2":0.34842429743065667}},{"key":["power-v1","12AX7","KT88","20","8.0","4",352800],"detector":{"real":96.03468458782065,"imaginary":1.8078652394325476},"anchor":{"b0":0.09932792833134793,"b1":-0.09927526926621058,"a1":-1.9723671969269352,"a2":0.9724198559920726}},{"key":["power-v1","12AX7","KT88","20","8.0","8",352800],"detector":{"real":135.83750867169107,"imaginary":2.5831644266198315},"anchor":{"b0":0.08899825636978842,"b1":-0.08883767567774574,"a1":-1.9679610651028845,"a2":0.9681216457949272}},{"key":["power-v1","12AX7","KT88","20","8.0","15",352800],"detector":{"real":186.02528202364215,"imaginary":3.555465685966705},"anchor":{"b0":0.08932883990732325,"b1":-0.08927227905869674,"a1":-1.9735513166474656,"a2":0.9736078774960921}},{"key":["power-v1","12AX7","KT88","20","8.0","16",352800],"detector":{"real":192.12278714543297,"imaginary":3.669506362339148},"anchor":{"b0":0.08983065567193356,"b1":-0.08968902962064458,"a1":-1.9520605162827005,"a2":0.9522021423339896}},{"key":["power-v1","12AX7","KT88","20","8.0","4",384000],"detector":{"real":96.16033178051502,"imaginary":1.6961462455546745},"anchor":{"b0":0.08434650229290279,"b1":-0.08423720906125946,"a1":-1.9773308190934802,"a2":0.9774401123251235}},{"key":["power-v1","12AX7","KT88","20","8.0","8",384000],"detector":{"real":136.0153022180462,"imaginary":2.425119497663127},"anchor":{"b0":0.08636078322152634,"b1":-0.0862355182390394,"a1":-1.9688960451828244,"a2":0.9690213101653113}},{"key":["power-v1","12AX7","KT88","20","8.0","15",384000],"detector":{"real":186.26880755341537,"imaginary":3.338997947439475},"anchor":{"b0":0.08368941921962054,"b1":-0.08365598955958288,"a1":-1.970373619240215,"a2":0.9704070489002529}},{"key":["power-v1","12AX7","KT88","20","8.0","16",384000],"detector":{"real":192.37428926330105,"imaginary":3.4459482355718025},"anchor":{"b0":0.08596891239543052,"b1":-0.08586041067520025,"a1":-1.9626840073167773,"a2":0.9627925090370075}},{"key":["power-v1","12AX7","KT88","43","6.0","4",352800],"detector":{"real":65.0746369538868,"imaginary":1.0206058164862315},"anchor":{"b0":0.09003002938753758,"b1":-0.08979950912501931,"a1":-1.9692311748763254,"a2":0.9694616951388436}},{"key":["power-v1","12AX7","KT88","43","6.0","8",352800],"detector":{"real":92.04572187702304,"imaginary":1.4612303295753113},"anchor":{"b0":0.08765771378162585,"b1":-0.08707370481122924,"a1":-1.9502077111164238,"a2":0.9507917200868203}},{"key":["power-v1","12AX7","KT88","43","6.0","15",352800],"detector":{"real":126.05381758229811,"imaginary":2.0132394765578043},"anchor":{"b0":0.08983280639792415,"b1":-0.08978246820462728,"a1":-1.9646044072881137,"a2":0.9646547454814106}},{"key":["power-v1","12AX7","KT88","43","6.0","16",352800],"detector":{"real":130.18558293142434,"imaginary":2.0775353246642916},"anchor":{"b0":0.0915092727479638,"b1":-0.09147626984225177,"a1":-1.9762856756556415,"a2":0.9763186785613537}},{"key":["power-v1","12AX7","KT88","43","6.0","4",384000],"detector":{"real":65.14919349473034,"imaginary":0.9558974224803607},"anchor":{"b0":0.08255572261292604,"b1":-0.08236201250661165,"a1":-1.966246758056966,"a2":0.9664404681632806}},{"key":["power-v1","12AX7","KT88","43","6.0","8",384000],"detector":{"real":92.15122378853752,"imaginary":1.3696844967752058},"anchor":{"b0":0.08155281463954493,"b1":-0.08149336328532672,"a1":-1.9769751846273143,"a2":0.9770346359815325}},{"key":["power-v1","12AX7","KT88","43","6.0","15",384000],"detector":{"real":126.19832605971054,"imaginary":1.8878480669125606},"anchor":{"b0":0.08100238408415442,"b1":-0.08080356749020841,"a1":-1.9715840025963045,"a2":0.9717828191902507}},{"key":["power-v1","12AX7","KT88","43","6.0","16",384000],"detector":{"real":130.3348244938814,"imaginary":1.9480374441296255},"anchor":{"b0":0.08336604141459682,"b1":-0.08332730993580569,"a1":-1.9766154262397104,"a2":0.9766541577185016}},{"key":["power-v1","12AX7","KT88","43","6.6","4",352800],"detector":{"real":64.03023647459895,"imaginary":1.0012661670884222},"anchor":{"b0":0.08825374919176368,"b1":-0.0881394025532382,"a1":-1.9762861145376216,"a2":0.9764004611761471}},{"key":["power-v1","12AX7","KT88","43","6.6","8",352800],"detector":{"real":90.56845621685689,"imaginary":1.4335921864794703},"anchor":{"b0":0.09204146374547882,"b1":-0.09192158589618431,"a1":-1.973903338064646,"a2":0.9740232159139406}},{"key":["power-v1","12AX7","KT88","43","6.6","15",352800],"detector":{"real":124.0307475901857,"imaginary":1.9751952402067434},"anchor":{"b0":0.09115720223020546,"b1":-0.09101573133526536,"a1":-1.9754480848532383,"a2":0.9755895557481785}},{"key":["power-v1","12AX7","KT88","43","6.6","16",352800],"detector":{"real":128.09620115152396,"imaginary":2.0382712998553254},"anchor":{"b0":0.08795311433079238,"b1":-0.08781320692426944,"a1":-1.9647512157908138,"a2":0.9648911231973367}},{"key":["power-v1","12AX7","KT88","43","6.6","4",384000],"detector":{"real":64.10129445053408,"imaginary":0.9375669248336552},"anchor":{"b0":0.08150286247709417,"b1":-0.08144859091106774,"a1":-1.9688902060352649,"a2":0.9689444776012914}},{"key":["power-v1","12AX7","KT88","43","6.6","8",384000],"detector":{"real":90.66900854096038,"imaginary":1.3434735614241298},"anchor":{"b0":0.08745763256273562,"b1":-0.08739110325216286,"a1":-1.9633932719040788,"a2":0.9634598012146515}},{"key":["power-v1","12AX7","KT88","43","6.6","15",384000],"detector":{"real":124.16847743438059,"imaginary":1.8517580886112002},"anchor":{"b0":0.08093841759986002,"b1":-0.08084285052489776,"a1":-1.9556029745932588,"a2":0.9556985416682212}},{"key":["power-v1","12AX7","KT88","43","6.6","16",384000],"detector":{"real":128.23844192762726,"imaginary":1.9107918041250227},"anchor":{"b0":0.08119647704221475,"b1":-0.08103731278924362,"a1":-1.9743647183376174,"a2":0.9745238825905886}},{"key":["power-v1","12AX7","KT88","43","8.0","4",352800],"detector":{"real":61.59520840683851,"imaginary":0.9596257533922872},"anchor":{"b0":0.09404703582915834,"b1":-0.09400792314865346,"a1":-1.9744567417509806,"a2":0.9744958544314856}},{"key":["power-v1","12AX7","KT88","43","8.0","8",352800],"detector":{"real":87.1241978009992,"imaginary":1.3740340526433605},"anchor":{"b0":0.09061435515155751,"b1":-0.09053093356676294,"a1":-1.9768475791646591,"a2":0.9769310007494538}},{"key":["power-v1","12AX7","KT88","43","8.0","15",352800],"detector":{"real":119.31394108898395,"imaginary":1.8931784677746273},"anchor":{"b0":0.08897767090262196,"b1":-0.0889016387441228,"a1":-1.976728059801029,"a2":0.9768040919595283}},{"key":["power-v1","12AX7","KT88","43","8.0","16",352800],"detector":{"real":123.22478805738545,"imaginary":1.9536295895907183},"anchor":{"b0":0.09940444587221658,"b1":-0.09910283758465145,"a1":-1.9651295899696517,"a2":0.9654311982572168}},{"key":["power-v1","12AX7","KT88","43","8.0","4",384000],"detector":{"real":61.65933671313686,"imaginary":0.8980475268479049},"anchor":{"b0":0.08274698040587289,"b1":-0.08271645458394555,"a1":-1.9672137248490582,"a2":0.9672442506709855}},{"key":["power-v1","12AX7","KT88","43","8.0","8",384000],"detector":{"real":87.2149470022884,"imaginary":1.2869148876846361},"anchor":{"b0":0.08242090523506006,"b1":-0.0823145024301332,"a1":-1.9638804868990447,"a2":0.9639868897039714}},{"key":["power-v1","12AX7","KT88","43","8.0","15",384000],"detector":{"real":119.43824485024574,"imaginary":1.773848976420287},"anchor":{"b0":0.08766841182281623,"b1":-0.08760756206835181,"a1":-1.977487994047593,"a2":0.9775488438020573}},{"key":["power-v1","12AX7","KT88","43","8.0","16",384000],"detector":{"real":123.35316273639128,"imaginary":1.8303923529769415},"anchor":{"b0":0.08143727200480545,"b1":-0.08141051182996988,"a1":-1.9720149211081561,"a2":0.9720416812829917}},{"key":["power-v1","12AT7","EL84","0","6.0","4",352800],"detector":{"real":169.02594263958017,"imaginary":10.888450751149108},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AT7","EL84","0","6.0","8",352800],"detector":{"real":239.07885671839358,"imaginary":15.447122028209387},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AT7","EL84","0","6.0","15",352800],"detector":{"real":327.4096902534158,"imaginary":21.185892178532313},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AT7","EL84","0","6.0","16",352800],"detector":{"real":338.14167010762725,"imaginary":21.87591626208448},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AT7","EL84","0","6.0","4",384000],"detector":{"real":169.53648763300677,"imaginary":10.533260354236866},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.0","8",384000],"detector":{"real":239.80117615233436,"imaginary":14.944758888274452},"anchor":{"b0":0.033526279142781425,"b1":-0.002097155725996535,"a1":-1.6365075957935935,"a2":0.6679367192103786}},{"key":["power-v1","12AT7","EL84","0","6.0","15",384000],"detector":{"real":328.39899483161463,"imaginary":20.49792335033284},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.0","16",384000],"detector":{"real":339.163386954003,"imaginary":21.165398363318936},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.6","4",352800],"detector":{"real":176.08773659914996,"imaginary":11.378358715754286},"anchor":{"b0":0.08861915111621385,"b1":-0.08849105762174776,"a1":-1.9690085988300554,"a2":0.9691366923245214}},{"key":["power-v1","12AT7","EL84","0","6.6","8",352800],"detector":{"real":249.06740640174593,"imaginary":16.14199288864004},"anchor":{"b0":0.08921195600533176,"b1":-0.08890056484002673,"a1":-1.954450409594325,"a2":0.9547618007596299}},{"key":["power-v1","12AT7","EL84","0","6.6","15",352800],"detector":{"real":341.0886347213709,"imaginary":22.13881407343797},"anchor":{"b0":0.08924727304496023,"b1":-0.08919672439358142,"a1":-1.9643146667238898,"a2":0.9643652153752686}},{"key":["power-v1","12AT7","EL84","0","6.6","16",352800],"detector":{"real":352.26898999819355,"imaginary":22.859888800127592},"anchor":{"b0":0.08863999088612358,"b1":-0.08847533351632196,"a1":-1.9727106583386091,"a2":0.9728753157084108}},{"key":["power-v1","12AT7","EL84","0","6.6","4",384000],"detector":{"real":176.61695864827652,"imaginary":11.010285419584005},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.6","8",384000],"detector":{"real":249.8161505609185,"imaginary":15.62140831060509},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.6","15",384000],"detector":{"real":342.1141314034449,"imaginary":21.42589114920063},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.6","16",384000],"detector":{"real":353.32808467890396,"imaginary":22.123599067741623},"anchor":{"b0":0.03334042004560261,"b1":-0.003411853236667646,"a1":-1.6490307749315232,"a2":0.6789593417404582}},{"key":["power-v1","12AT7","EL84","0","8.0","4",352800],"detector":{"real":190.83708024860127,"imaginary":12.376763111232847},"anchor":{"b0":0.08833914623457272,"b1":-0.08828459562468455,"a1":-1.961956818374167,"a2":0.962011368984055}},{"key":["power-v1","12AT7","EL84","0","8.0","8",352800],"detector":{"real":269.9296123370974,"imaginary":17.558196682542217},"anchor":{"b0":0.08962174621876576,"b1":-0.08957919531553513,"a1":-1.9700267946084773,"a2":0.970069345511708}},{"key":["power-v1","12AT7","EL84","0","8.0","15",352800],"detector":{"real":369.6586484487282,"imaginary":24.081013472773883},"anchor":{"b0":0.09048969586978148,"b1":-0.0903155225856748,"a1":-1.9723115637927329,"a2":0.9724857370768396}},{"key":["power-v1","12AT7","EL84","0","8.0","16",352800],"detector":{"real":381.77548555363546,"imaginary":24.865364995401205},"anchor":{"b0":0.0896196953638189,"b1":-0.08958452686477007,"a1":-1.9707953928216675,"a2":0.9708305613207164}},{"key":["power-v1","12AT7","EL84","0","8.0","4",384000],"detector":{"real":191.40399100615375,"imaginary":11.982439841315005},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","8.0","8",384000],"detector":{"real":270.7316794808316,"imaginary":17.000484360400087},"anchor":{"b0":0.03411018829809996,"b1":-0.0020865219911296784,"a1":-1.6394122534867437,"a2":0.671435919793714}},{"key":["power-v1","12AT7","EL84","0","8.0","15",384000],"detector":{"real":370.75717812974665,"imaginary":23.317244084199068},"anchor":{"b0":0.03300268419609719,"b1":-0.002907693772218918,"a1":-1.649978180674176,"a2":0.6800731710980543}},{"key":["power-v1","12AT7","EL84","0","8.0","16",384000],"detector":{"real":382.9100058914009,"imaginary":24.076562436159954},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","20","6.0","4",352800],"detector":{"real":125.08577363174301,"imaginary":7.010603633011467},"anchor":{"b0":0.09174406204475492,"b1":-0.09156626884681465,"a1":-1.9732877026902007,"a2":0.9734654958881411}},{"key":["power-v1","12AT7","EL84","20","6.0","8",352800],"detector":{"real":176.92793896919846,"imaginary":9.950136240226767},"anchor":{"b0":0.09516015102023573,"b1":-0.0950194169213795,"a1":-1.9719405771136405,"a2":0.9720813112124967}},{"key":["power-v1","12AT7","EL84","20","6.0","15",352800],"detector":{"real":242.2964923146307,"imaginary":13.649738198165647},"anchor":{"b0":0.0930141396852882,"b1":-0.0924434358487812,"a1":-1.9520604743614016,"a2":0.9526311781979085}},{"key":["power-v1","12AT7","EL84","20","6.0","16",352800],"detector":{"real":250.23856688305798,"imaginary":14.09388868897276},"anchor":{"b0":0.09503310660808832,"b1":-0.09493990861035459,"a1":-1.970020421108066,"a2":0.9701136191057997}},{"key":["power-v1","12AT7","EL84","20","6.0","4",384000],"detector":{"real":125.3873793188172,"imaginary":6.807110629483359},"anchor":{"b0":0.0823076604216148,"b1":-0.08214450034133823,"a1":-1.9505633439158265,"a2":0.9507265039961031}},{"key":["power-v1","12AT7","EL84","20","6.0","8",384000],"detector":{"real":177.35465969522596,"imaginary":9.662312224268756},"anchor":{"b0":0.08570568917359007,"b1":-0.08553958546752376,"a1":-1.97012953902668,"a2":0.9702956427327463}},{"key":["power-v1","12AT7","EL84","20","6.0","15",384000],"detector":{"real":242.88094288313818,"imaginary":13.255559316303327},"anchor":{"b0":0.08225231024998471,"b1":-0.08175729695880268,"a1":-1.9551887702552981,"a2":0.9556837835464802}},{"key":["power-v1","12AT7","EL84","20","6.0","16",384000],"detector":{"real":250.84216495913955,"imaginary":13.686792284472258},"anchor":{"b0":0.08146274488021853,"b1":-0.08128105484568253,"a1":-1.9694294616261658,"a2":0.9696111516607019}},{"key":["power-v1","12AT7","EL84","20","6.6","4",352800],"detector":{"real":127.65118608067219,"imaginary":7.129885533281095},"anchor":{"b0":0.08926660539237426,"b1":-0.08911989072071659,"a1":-1.9757736903219643,"a2":0.9759204049936221}},{"key":["power-v1","12AT7","EL84","20","6.6","8",352800],"detector":{"real":180.55660084351274,"imaginary":10.119551168777399},"anchor":{"b0":0.09331821301341069,"b1":-0.09328450050341648,"a1":-1.9692679569480476,"a2":0.9693016694580417}},{"key":["power-v1","12AT7","EL84","20","6.6","15",352800],"detector":{"real":247.26581963219138,"imaginary":13.88222512237802},"anchor":{"b0":0.08791680185401202,"b1":-0.0876964666827925,"a1":-1.956041746712456,"a2":0.9562620818836756}},{"key":["power-v1","12AT7","EL84","20","6.6","16",352800],"detector":{"real":255.3707798093265,"imaginary":14.33392927379694},"anchor":{"b0":0.08972359969326527,"b1":-0.08963083433458997,"a1":-1.9713316340318348,"a2":0.9714243993905102}},{"key":["power-v1","12AT7","EL84","20","6.6","4",384000],"detector":{"real":127.95351590294477,"imaginary":6.925385064213609},"anchor":{"b0":0.08265583251998841,"b1":-0.08225745789728368,"a1":-1.9585859168278714,"a2":0.9589842914505762}},{"key":["power-v1","12AT7","EL84","20","6.6","8",384000],"detector":{"real":180.98434713256643,"imaginary":9.830300826320734},"anchor":{"b0":0.08429742226603042,"b1":-0.08425448896663446,"a1":-1.9579036704168864,"a2":0.9579466037162825}},{"key":["power-v1","12AT7","EL84","20","6.6","15",384000],"detector":{"real":247.85167559838777,"imaginary":13.486091695667566},"anchor":{"b0":0.08163738258127985,"b1":-0.08158656520390961,"a1":-1.9622854064933049,"a2":0.9623362238706751}},{"key":["power-v1","12AT7","EL84","20","6.6","16",384000],"detector":{"real":255.97582928333188,"imaginary":13.924814420476553},"anchor":{"b0":0.08352530252908208,"b1":-0.08333581823504865,"a1":-1.9595019049298292,"a2":0.9596913892238625}},{"key":["power-v1","12AT7","EL84","20","8.0","4",352800],"detector":{"real":132.20383227292228,"imaginary":7.314511457259225},"anchor":{"b0":0.0879548587395308,"b1":-0.08786300409750358,"a1":-1.9688887330350302,"a2":0.9689805876770574}},{"key":["power-v1","12AT7","EL84","20","8.0","8",352800],"detector":{"real":186.99612364875009,"imaginary":10.381931028165265},"anchor":{"b0":0.08804785895293024,"b1":-0.08799833858781295,"a1":-1.962027920383178,"a2":0.9620774407482953}},{"key":["power-v1","12AT7","EL84","20","8.0","15",352800],"detector":{"real":256.0845292432741,"imaginary":14.242395217527404},"anchor":{"b0":0.0895573726209339,"b1":-0.08948829031213382,"a1":-1.95327764242771,"a2":0.9533467247365103}},{"key":["power-v1","12AT7","EL84","20","8.0","16",352800],"detector":{"real":264.4785501466356,"imaginary":14.705786362229931},"anchor":{"b0":0.09189984287900217,"b1":-0.09167077220017462,"a1":-1.959493663233351,"a2":0.9597227339121787}},{"key":["power-v1","12AT7","EL84","20","8.0","4",384000],"detector":{"real":132.50487966102324,"imaginary":7.109139829131549},"anchor":{"b0":0.08241504317896624,"b1":-0.08222882155066574,"a1":-1.9650313345215005,"a2":0.9652175561498009}},{"key":["power-v1","12AT7","EL84","20","8.0","8",384000],"detector":{"real":187.4220580709876,"imaginary":10.09144557091441},"anchor":{"b0":0.08367999994869549,"b1":-0.08351356948924116,"a1":-1.9741892471146898,"a2":0.9743556775741441}},{"key":["power-v1","12AT7","EL84","20","8.0","15",384000],"detector":{"real":256.66790517393713,"imaginary":13.844567676412803},"anchor":{"b0":0.08138608636634467,"b1":-0.08132381775352072,"a1":-1.973647771282257,"a2":0.9737100398950811}},{"key":["power-v1","12AT7","EL84","20","8.0","16",384000],"detector":{"real":265.0810381410961,"imaginary":14.294922322118925},"anchor":{"b0":0.08299386428555787,"b1":-0.08284013088341992,"a1":-1.971311247687686,"a2":0.9714649810898238}},{"key":["power-v1","12AT7","EL84","43","6.0","4",352800],"detector":{"real":100.03621143172083,"imaginary":5.127227931851495},"anchor":{"b0":0.09195697149945102,"b1":-0.09178201253029221,"a1":-1.972839927828073,"a2":0.9730148867972318}},{"key":["power-v1","12AT7","EL84","43","6.0","8",352800],"detector":{"real":141.4966422368263,"imaginary":7.279380323877119},"anchor":{"b0":0.1005240417486018,"b1":-0.10047028575148619,"a1":-1.9727446504975332,"a2":0.9727984064946488}},{"key":["power-v1","12AT7","EL84","43","6.0","15",352800],"detector":{"real":193.77468633239607,"imaginary":9.987545927347442},"anchor":{"b0":0.08984899746616627,"b1":-0.08981418159070537,"a1":-1.9622794732958329,"a2":0.9623142891712937}},{"key":["power-v1","12AT7","EL84","43","6.0","16",352800],"detector":{"real":200.126284616475,"imaginary":10.312310473117565},"anchor":{"b0":0.09523614857861257,"b1":-0.09519111166637235,"a1":-1.9714708000193344,"a2":0.9715158369315745}},{"key":["power-v1","12AT7","EL84","43","6.0","4",384000],"detector":{"real":100.24237712759542,"imaginary":4.992913657913613},"anchor":{"b0":0.08436566156253708,"b1":-0.0843281661190211,"a1":-1.9745124207145346,"a2":0.9745499161580505}},{"key":["power-v1","12AT7","EL84","43","6.0","8",384000],"detector":{"real":141.78833621813467,"imaginary":7.089395757887858},"anchor":{"b0":0.08485041566011432,"b1":-0.08473052425762212,"a1":-1.9770845388090583,"a2":0.9772044302115506}},{"key":["power-v1","12AT7","EL84","43","6.0","15",384000],"detector":{"real":194.17420239350326,"imaginary":9.727351164787951},"anchor":{"b0":0.0852559543403032,"b1":-0.08512445815151988,"a1":-1.9737848531539455,"a2":0.9739163493427286}},{"key":["power-v1","12AT7","EL84","43","6.0","16",384000],"detector":{"real":200.53888916588383,"imaginary":10.043590228909716},"anchor":{"b0":0.09023413479343846,"b1":-0.09010197527841529,"a1":-1.9752777137224218,"a2":0.9754098732374451}},{"key":["power-v1","12AT7","EL84","43","6.6","4",352800],"detector":{"real":100.58291286300826,"imaginary":5.1238751739827615},"anchor":{"b0":0.09662114393454149,"b1":-0.09652934258284833,"a1":-1.9681380846975065,"a2":0.9682298860491998}},{"key":["power-v1","12AT7","EL84","43","6.6","8",352800],"detector":{"real":142.26993473120532,"imaginary":7.274786020616714},"anchor":{"b0":0.08865863185289777,"b1":-0.08859879341009924,"a1":-1.9715365408254146,"a2":0.9715963792682131}},{"key":["power-v1","12AT7","EL84","43","6.6","15",352800],"detector":{"real":194.83368916921148,"imaginary":9.981355978942052},"anchor":{"b0":0.08858311128122391,"b1":-0.08847105250367339,"a1":-1.9692214872134235,"a2":0.969333545990974}},{"key":["power-v1","12AT7","EL84","43","6.6","16",352800],"detector":{"real":201.2199988677884,"imaginary":10.305903420561227},"anchor":{"b0":0.09163253202985963,"b1":-0.09140356343272435,"a1":-1.967001211387791,"a2":0.9672301799849264}},{"key":["power-v1","12AT7","EL84","43","6.6","4",384000],"detector":{"real":100.78509250820166,"imaginary":4.9914490371876195},"anchor":{"b0":0.08789679600441351,"b1":-0.08786545497777634,"a1":-1.9753515692623496,"a2":0.9753829102889867}},{"key":["power-v1","12AT7","EL84","43","6.6","8",384000],"detector":{"real":142.5559903238411,"imaginary":7.0874707550411244},"anchor":{"b0":0.08725126591429143,"b1":-0.08722102140889573,"a1":-1.9556927069411332,"a2":0.955722951446529}},{"key":["power-v1","12AT7","EL84","43","6.6","15",384000],"detector":{"real":195.22548340504315,"imaginary":9.724815748865566},"anchor":{"b0":0.08151441986553735,"b1":-0.08147651379073492,"a1":-1.9771114402982735,"a2":0.9771493463730759}},{"key":["power-v1","12AT7","EL84","43","6.6","16",384000],"detector":{"real":201.62462853861842,"imaginary":10.040957627362108},"anchor":{"b0":0.08140770295614166,"b1":-0.08137671818675772,"a1":-1.9756787487574583,"a2":0.9757097335268422}},{"key":["power-v1","12AT7","EL84","43","8.0","4",352800],"detector":{"real":100.99984595483038,"imaginary":5.0752333056782435},"anchor":{"b0":0.09170464911463018,"b1":-0.09164568182377276,"a1":-1.9722733330488587,"a2":0.9723323003397161}},{"key":["power-v1","12AT7","EL84","43","8.0","8",352800],"detector":{"real":142.85968650362096,"imaginary":7.2060964886962715},"anchor":{"b0":0.0901104536315616,"b1":-0.09002287450062535,"a1":-1.9758430589427896,"a2":0.9759306380737257}},{"key":["power-v1","12AT7","EL84","43","8.0","15",352800],"detector":{"real":195.64134662520738,"imaginary":9.887365291747097},"anchor":{"b0":0.08914298093070318,"b1":-0.08909612879190419,"a1":-1.9770195040905203,"a2":0.9770663562293194}},{"key":["power-v1","12AT7","EL84","43","8.0","16",352800],"detector":{"real":202.05412816336457,"imaginary":10.20882107647826},"anchor":{"b0":0.08973491283392881,"b1":-0.08952095857599578,"a1":-1.9695776212049085,"a2":0.9697915754628416}},{"key":["power-v1","12AT7","EL84","43","8.0","4",384000],"detector":{"real":101.19242006652273,"imaginary":4.947007762714628},"anchor":{"b0":0.08253913002274912,"b1":-0.08231407836990776,"a1":-1.9699910613951146,"a2":0.970216113047956}},{"key":["power-v1","12AT7","EL84","43","8.0","8",384000],"detector":{"real":143.13215443958475,"imaginary":7.024719978421394},"anchor":{"b0":0.08276008389807168,"b1":-0.08260805131347534,"a1":-1.9674752599265073,"a2":0.9676272925111036}},{"key":["power-v1","12AT7","EL84","43","8.0","15",384000],"detector":{"real":196.01453214428219,"imaginary":9.638955990531866},"anchor":{"b0":0.08505557257116686,"b1":-0.0849461953132879,"a1":-1.9745431179021986,"a2":0.9746524951600776}},{"key":["power-v1","12AT7","EL84","43","8.0","16",384000],"detector":{"real":202.43953921754976,"imaginary":9.952273054448911},"anchor":{"b0":0.08366277359591054,"b1":-0.08363288021566297,"a1":-1.9745467316893826,"a2":0.97457662506963}},{"key":["power-v1","12AT7","EL34","0","6.0","4",352800],"detector":{"real":154.51606534494658,"imaginary":6.952098974347991},"anchor":{"b0":0.09698675645184551,"b1":-0.0969285967635892,"a1":-1.973881768191605,"a2":0.9739399278798614}},{"key":["power-v1","12AT7","EL34","0","6.0","8",352800],"detector":{"real":218.55616361876397,"imaginary":9.875350079581837},"anchor":{"b0":0.08848383128011786,"b1":-0.0882573550703062,"a1":-1.9697777117261224,"a2":0.970004187935934}},{"key":["power-v1","12AT7","EL34","0","6.0","15",352800],"detector":{"real":299.3051771206179,"imaginary":13.552804768141025},"anchor":{"b0":0.0961957339538654,"b1":-0.09612138529829958,"a1":-1.9696663504634442,"a2":0.96974069911901}},{"key":["power-v1","12AT7","EL34","0","6.0","16",352800],"detector":{"real":309.11585671664915,"imaginary":13.993012239347811},"anchor":{"b0":0.0883005846949472,"b1":-0.08814586629763961,"a1":-1.9741220010648013,"a2":0.9742767194621089}},{"key":["power-v1","12AT7","EL34","0","6.0","4",384000],"detector":{"real":154.78361520906458,"imaginary":6.778905263329148},"anchor":{"b0":0.08138518264415393,"b1":-0.08127239326474738,"a1":-1.977561091909194,"a2":0.9776738812886004}},{"key":["power-v1","12AT7","EL34","0","6.0","8",384000],"detector":{"real":218.93471698268007,"imaginary":9.630357058024963},"anchor":{"b0":0.0890256211296907,"b1":-0.08892395788256376,"a1":-1.9768037087584,"a2":0.976905372005527}},{"key":["power-v1","12AT7","EL34","0","6.0","15",384000],"detector":{"real":299.82366462685883,"imaginary":13.21725889361008},"anchor":{"b0":0.08362432545791254,"b1":-0.0835616789946525,"a1":-1.9766405624077832,"a2":0.9767032088710432}},{"key":["power-v1","12AT7","EL34","0","6.0","16",384000],"detector":{"real":309.6513296908334,"imaginary":13.646474133276369},"anchor":{"b0":0.08344608010919406,"b1":-0.08330610605682544,"a1":-1.9739091102431539,"a2":0.9740490842955225}},{"key":["power-v1","12AT7","EL34","0","6.6","4",352800],"detector":{"real":159.60306700811356,"imaginary":7.2366464740370615},"anchor":{"b0":0.09074000880925716,"b1":-0.09066128559228545,"a1":-1.9770101652648546,"a2":0.9770888884818262}},{"key":["power-v1","12AT7","EL34","0","6.6","8",352800],"detector":{"real":225.75148826198043,"imaginary":10.279210571499423},"anchor":{"b0":0.0975427448899278,"b1":-0.09739805024779104,"a1":-1.9663713635461564,"a2":0.9665160581882931}},{"key":["power-v1","12AT7","EL34","0","6.6","15",352800],"detector":{"real":309.15891731534714,"imaginary":14.10682812031852},"anchor":{"b0":0.10124723364815504,"b1":-0.10117969461555842,"a1":-1.974740760193651,"a2":0.9748082992262477}},{"key":["power-v1","12AT7","EL34","0","6.6","16",352800],"detector":{"real":319.29258603353077,"imaginary":14.565062708394855},"anchor":{"b0":0.10129173014534067,"b1":-0.10124388918819233,"a1":-1.9722476074257398,"a2":0.9722954483828883}},{"key":["power-v1","12AT7","EL34","0","6.6","4",384000],"detector":{"real":159.87730448193955,"imaginary":7.059155505516894},"anchor":{"b0":0.08184656718595472,"b1":-0.08174813979407397,"a1":-1.9686445656403364,"a2":0.9687429930322171}},{"key":["power-v1","12AT7","EL34","0","6.6","8",384000],"detector":{"real":226.139504277735,"imaginary":10.028137974997271},"anchor":{"b0":0.08329276084238314,"b1":-0.08316699125409205,"a1":-1.977122160138373,"a2":0.9772479297266642}},{"key":["power-v1","12AT7","EL34","0","6.6","15",384000],"detector":{"real":309.690365738177,"imaginary":13.762955037831244},"anchor":{"b0":0.09266407641043821,"b1":-0.09263300107617971,"a1":-1.9740592063745548,"a2":0.9740902817088132}},{"key":["power-v1","12AT7","EL34","0","6.6","16",384000],"detector":{"real":319.8414444628634,"imaginary":14.209924727019102},"anchor":{"b0":0.08472533658464283,"b1":-0.08460386950093947,"a1":-1.9757141064509738,"a2":0.9758355735346773}},{"key":["power-v1","12AT7","EL34","0","8.0","4",352800],"detector":{"real":169.70383593704466,"imaginary":7.782624475902745},"anchor":{"b0":0.09365278512012382,"b1":-0.09349539429266046,"a1":-1.967203394734283,"a2":0.9673607855617465}},{"key":["power-v1","12AT7","EL34","0","8.0","8",352800],"detector":{"real":240.0385559353014,"imaginary":11.054213317541695},"anchor":{"b0":0.09228437914727604,"b1":-0.09222084010503509,"a1":-1.97004926195853,"a2":0.9701128010007709}},{"key":["power-v1","12AT7","EL34","0","8.0","15",352800],"detector":{"real":328.7245498797852,"imaginary":15.170054569223323},"anchor":{"b0":0.0925881545484988,"b1":-0.09251805736489498,"a1":-1.971499750643492,"a2":0.9715698478270958}},{"key":["power-v1","12AT7","EL34","0","8.0","16",352800],"detector":{"real":339.4995469186444,"imaginary":15.662876412033853},"anchor":{"b0":0.08876575914159081,"b1":-0.08867926101128684,"a1":-1.9774343758215946,"a2":0.9775208739518986}},{"key":["power-v1","12AT7","EL34","0","8.0","4",384000],"detector":{"real":169.99036661156822,"imaginary":7.5972872645837},"anchor":{"b0":0.09120665937682947,"b1":-0.09108111962648605,"a1":-1.9755391621344867,"a2":0.97566470188483}},{"key":["power-v1","12AT7","EL34","0","8.0","8",384000],"detector":{"real":240.44396677881363,"imaginary":10.792040022752985},"anchor":{"b0":0.08261277010336296,"b1":-0.08247696989417472,"a1":-1.9757776101492865,"a2":0.9759134103584748}},{"key":["power-v1","12AT7","EL34","0","8.0","15",384000],"detector":{"real":329.27982398332654,"imaginary":14.810976208376506},"anchor":{"b0":0.08719898018843313,"b1":-0.08705546444247406,"a1":-1.9760358834010652,"a2":0.9761793991470243}},{"key":["power-v1","12AT7","EL34","0","8.0","16",384000],"detector":{"real":340.0730113776839,"imaginary":15.292035199020821},"anchor":{"b0":0.08683837830583076,"b1":-0.08674954633485533,"a1":-1.974431432843208,"a2":0.9745202648141835}},{"key":["power-v1","12AT7","EL34","20","6.0","4",352800],"detector":{"real":100.93480571022465,"imaginary":4.1697413476379745},"anchor":{"b0":0.10058152388439101,"b1":-0.100378900952135,"a1":-1.9703113218687132,"a2":0.9705139448009693}},{"key":["power-v1","12AT7","EL34","20","6.0","8",352800],"detector":{"real":142.7679342558533,"imaginary":5.925289429086567},"anchor":{"b0":0.09308970511833659,"b1":-0.09295460334815082,"a1":-1.9748366519332392,"a2":0.974971753703425}},{"key":["power-v1","12AT7","EL34","20","6.0","15",352800],"detector":{"real":195.5158632660568,"imaginary":8.133324214138018},"anchor":{"b0":0.08894424739415598,"b1":-0.08890577473925078,"a1":-1.9762446893526393,"a2":0.9762831620075445}},{"key":["power-v1","12AT7","EL34","20","6.0","16",352800],"detector":{"real":201.92450817301835,"imaginary":8.397288452764759},"anchor":{"b0":0.09620894919224715,"b1":-0.09605840855419047,"a1":-1.9746084877738939,"a2":0.9747590284119505}},{"key":["power-v1","12AT7","EL34","20","6.0","4",384000],"detector":{"real":101.07714626843163,"imaginary":4.08146857481859},"anchor":{"b0":0.08433767987899865,"b1":-0.0842436954585078,"a1":-1.9762868910876923,"a2":0.9763808755081831}},{"key":["power-v1","12AT7","EL34","20","6.0","8",384000],"detector":{"real":142.96933704550972,"imaginary":5.800410951626937},"anchor":{"b0":0.09537045413977424,"b1":-0.09513246871314904,"a1":-1.9677891089184716,"a2":0.9680270943450968}},{"key":["power-v1","12AT7","EL34","20","6.0","15",384000],"detector":{"real":195.79171913960204,"imaginary":7.962277922288424},"anchor":{"b0":0.08670437222286921,"b1":-0.08664585253394685,"a1":-1.9736285274178256,"a2":0.9736870471067478}},{"key":["power-v1","12AT7","EL34","20","6.0","16",384000],"detector":{"real":202.20940056707715,"imaginary":8.220640502525832},"anchor":{"b0":0.08280826733991652,"b1":-0.08276496158421158,"a1":-1.975120253654492,"a2":0.9751635594101968}},{"key":["power-v1","12AT7","EL34","20","6.6","4",352800],"detector":{"real":101.67871010357987,"imaginary":4.223786874860923},"anchor":{"b0":0.0976628908545942,"b1":-0.09761722839255726,"a1":-1.975297766746396,"a2":0.975343429208433}},{"key":["power-v1","12AT7","EL34","20","6.6","8",352800],"detector":{"real":143.8201486715018,"imaginary":6.0019365127368},"anchor":{"b0":0.09335444939046057,"b1":-0.0932385384238165,"a1":-1.9738430465476964,"a2":0.9739589575143406}},{"key":["power-v1","12AT7","EL34","20","6.6","15",352800],"detector":{"real":196.95683088975073,"imaginary":8.238428822746126},"anchor":{"b0":0.0900502378774056,"b1":-0.08993318296016556,"a1":-1.973689685522902,"a2":0.973806740440142}},{"key":["power-v1","12AT7","EL34","20","6.6","16",352800],"detector":{"real":203.41270860755725,"imaginary":8.505818763034693},"anchor":{"b0":0.09247611575036901,"b1":-0.09237153868141698,"a1":-1.9743853824780098,"a2":0.9744899595469618}},{"key":["power-v1","12AT7","EL34","20","6.6","4",384000],"detector":{"real":101.81983071292925,"imaginary":4.135024989409672},"anchor":{"b0":0.08213964816411311,"b1":-0.08203524515325154,"a1":-1.9768637627384529,"a2":0.9769681657493144}},{"key":["power-v1","12AT7","EL34","20","6.6","8",384000],"detector":{"real":144.01982630084103,"imaginary":5.876365431296532},"anchor":{"b0":0.08131071676593599,"b1":-0.08126134483857839,"a1":-1.9758264452655778,"a2":0.9758758171929353}},{"key":["power-v1","12AT7","EL34","20","6.6","15",384000],"detector":{"real":197.23032462104996,"imaginary":8.06643333683291},"anchor":{"b0":0.08130935732531266,"b1":-0.08110607802459117,"a1":-1.9711277200758985,"a2":0.9713309993766199}},{"key":["power-v1","12AT7","EL34","20","6.6","16",384000],"detector":{"real":203.6951613890589,"imaginary":8.328190698274339},"anchor":{"b0":0.08916310484922728,"b1":-0.08907577573509878,"a1":-1.9767994038596688,"a2":0.9768867329737972}},{"key":["power-v1","12AT7","EL34","20","8.0","4",352800],"detector":{"real":102.49496888061395,"imaginary":4.295333598138367},"anchor":{"b0":0.09834856261091854,"b1":-0.09826131670919303,"a1":-1.9690962309714461,"a2":0.9691834768731716}},{"key":["power-v1","12AT7","EL34","20","8.0","8",352800],"detector":{"real":144.97470138980026,"imaginary":6.103358069868385},"anchor":{"b0":0.09018936897402721,"b1":-0.09009222599252752,"a1":-1.9748702321689984,"a2":0.974967375150498}},{"key":["power-v1","12AT7","EL34","20","8.0","15",352800],"detector":{"real":198.537944789783,"imaginary":8.377474956464361},"anchor":{"b0":0.08998902676412479,"b1":-0.08994511643157485,"a1":-1.976337190232191,"a2":0.9763811005647408}},{"key":["power-v1","12AT7","EL34","20","8.0","16",352800],"detector":{"real":205.0456494927563,"imaginary":8.649401264491889},"anchor":{"b0":0.09129292181798973,"b1":-0.09111461026945383,"a1":-1.9693198341049691,"a2":0.9694981456535049}},{"key":["power-v1","12AT7","EL34","20","8.0","4",384000],"detector":{"real":102.632535000521,"imaginary":4.205651011938234},"anchor":{"b0":0.08587554184833802,"b1":-0.08583901017946945,"a1":-1.9758291590920412,"a2":0.9758656907609097}},{"key":["power-v1","12AT7","EL34","20","8.0","8",384000],"detector":{"real":145.1693518227934,"imaginary":5.976483196486417},"anchor":{"b0":0.08438055825023523,"b1":-0.08428056210055077,"a1":-1.9761644386801607,"a2":0.9762644348298452}},{"key":["power-v1","12AT7","EL34","20","8.0","15",384000],"detector":{"real":198.80455430475328,"imaginary":8.203692887115098},"anchor":{"b0":0.08338974822435911,"b1":-0.08321952146647923,"a1":-1.9708986752667272,"a2":0.9710689020246072}},{"key":["power-v1","12AT7","EL34","20","8.0","16",384000],"detector":{"real":205.32099232094276,"imaginary":8.469928178429246},"anchor":{"b0":0.08614762684232405,"b1":-0.086101435300528,"a1":-1.9771576195314955,"a2":0.9772038110732916}},{"key":["power-v1","12AT7","EL34","43","6.0","4",352800],"detector":{"real":74.67392181481699,"imaginary":2.9545771818682924},"anchor":{"b0":0.11032072959971129,"b1":-0.11011411027159942,"a1":-1.9712059289769426,"a2":0.9714125483050544}},{"key":["power-v1","12AT7","EL34","43","6.0","8",352800],"detector":{"real":105.62308064923907,"imaginary":4.199369579172809},"anchor":{"b0":0.09690936913377787,"b1":-0.09673839698012635,"a1":-1.9725488664797934,"a2":0.9727198386334448}},{"key":["power-v1","12AT7","EL34","43","6.0","15",352800],"detector":{"real":144.64726519541563,"imaginary":5.764832469937848},"anchor":{"b0":0.09978632172350949,"b1":-0.09973809295190654,"a1":-1.9741348607831612,"a2":0.9741830895547642}},{"key":["power-v1","12AT7","EL34","43","6.0","16",352800],"detector":{"real":149.38852905389487,"imaginary":5.951846623958246},"anchor":{"b0":0.09243363844781428,"b1":-0.09239905382255172,"a1":-1.972176315460039,"a2":0.9722109000853015}},{"key":["power-v1","12AT7","EL34","43","6.0","4",384000],"detector":{"real":74.76740066982188,"imaginary":2.89877210877261},"anchor":{"b0":0.09461319070680095,"b1":-0.09446213324979764,"a1":-1.9753978774318184,"a2":0.9755489348888217}},{"key":["power-v1","12AT7","EL34","43","6.0","8",384000],"detector":{"real":105.7553501036541,"imaginary":4.120417463307397},"anchor":{"b0":0.08564236795432928,"b1":-0.08560152247768756,"a1":-1.9775158467355651,"a2":0.9775566922122069}},{"key":["power-v1","12AT7","EL34","43","6.0","15",384000],"detector":{"real":144.82843261800997,"imaginary":5.656686265396514},"anchor":{"b0":0.09086940089091157,"b1":-0.09072264431591931,"a1":-1.9734898043125253,"a2":0.9736365608875175}},{"key":["power-v1","12AT7","EL34","43","6.0","16",384000],"detector":{"real":149.5756309700907,"imaginary":5.840159569535856},"anchor":{"b0":0.08357924693410147,"b1":-0.0833551850234117,"a1":-1.9693070318837853,"a2":0.9695310937944751}},{"key":["power-v1","12AT7","EL34","43","6.6","4",352800],"detector":{"real":74.10291065125149,"imaginary":2.9472351861106207},"anchor":{"b0":0.0914107850922311,"b1":-0.09137243032999251,"a1":-1.9743577451204253,"a2":0.974396099882664}},{"key":["power-v1","12AT7","EL34","43","6.6","8",352800],"detector":{"real":104.81540552303754,"imaginary":4.188830009993923},"anchor":{"b0":0.09176209206712393,"b1":-0.09172683362701266,"a1":-1.9716181375517094,"a2":0.9716533959918208}},{"key":["power-v1","12AT7","EL34","43","6.6","15",352800],"detector":{"real":143.54117843931851,"imaginary":5.750292409871455},"anchor":{"b0":0.09076051324304339,"b1":-0.09058350161282862,"a1":-1.9731041343787916,"a2":0.9732811460090064}},{"key":["power-v1","12AT7","EL34","43","6.6","16",352800],"detector":{"real":148.24618722721752,"imaginary":5.936844798041136},"anchor":{"b0":0.0881538885165406,"b1":-0.08787237622941514,"a1":-1.9623856633696621,"a2":0.9626671756567877}},{"key":["power-v1","12AT7","EL34","43","6.6","4",384000],"detector":{"real":74.1940401592593,"imaginary":2.8914937361530257},"anchor":{"b0":0.08539965604638514,"b1":-0.08527362390857261,"a1":-1.9772697389316491,"a2":0.9773957710694616}},{"key":["power-v1","12AT7","EL34","43","6.6","8",384000],"detector":{"real":104.94435168191775,"imaginary":4.109967595303485},"anchor":{"b0":0.0843848090961469,"b1":-0.08433354486961138,"a1":-1.973348494191416,"a2":0.9733997584179516}},{"key":["power-v1","12AT7","EL34","43","6.6","15",384000],"detector":{"real":143.71779446631368,"imaginary":5.642268864424379},"anchor":{"b0":0.0865649032431803,"b1":-0.08650286719189516,"a1":-1.9763429425148522,"a2":0.9764049785661375}},{"key":["power-v1","12AT7","EL34","43","6.6","16",384000],"detector":{"real":148.42858861893276,"imaginary":5.825284471893028},"anchor":{"b0":0.08168100955935301,"b1":-0.08151214504708176,"a1":-1.9714872649460509,"a2":0.9716561294583221}},{"key":["power-v1","12AT7","EL34","43","8.0","4",352800],"detector":{"real":72.48395383299409,"imaginary":2.909743120442242},"anchor":{"b0":0.08935306719116504,"b1":-0.08919876430943735,"a1":-1.9750977074174847,"a2":0.9752520102992124}},{"key":["power-v1","12AT7","EL34","43","8.0","8",352800],"detector":{"real":102.52545283815907,"imaginary":4.135360454841333},"anchor":{"b0":0.08969262204309693,"b1":-0.089169817074633,"a1":-1.9528285187947765,"a2":0.9533513237632404}},{"key":["power-v1","12AT7","EL34","43","8.0","15",352800],"detector":{"real":140.40516016472478,"imaginary":5.6767656418571395},"anchor":{"b0":0.09020908903594277,"b1":-0.09016582641905545,"a1":-1.9754616914257936,"a2":0.9755049540426809}},{"key":["power-v1","12AT7","EL34","43","8.0","16",352800],"detector":{"real":145.00737687527183,"imaginary":5.860950235280079},"anchor":{"b0":0.0925287001572067,"b1":-0.09249372111545379,"a1":-1.969937746789077,"a2":0.9699727258308299}},{"key":["power-v1","12AT7","EL34","43","8.0","4",384000],"detector":{"real":72.56996903166605,"imaginary":2.8540266703322867},"anchor":{"b0":0.08233442140964982,"b1":-0.0822574014194136,"a1":-1.9747468983671514,"a2":0.9748239183573876}},{"key":["power-v1","12AT7","EL34","43","8.0","8",384000],"detector":{"real":102.64716435488366,"imaginary":4.056532914637207},"anchor":{"b0":0.08355238548831213,"b1":-0.08341063061549922,"a1":-1.9761606297473315,"a2":0.9763023846201444}},{"key":["power-v1","12AT7","EL34","43","8.0","15",384000],"detector":{"real":140.5718681384711,"imaginary":5.568789850037388},"anchor":{"b0":0.08515725684453719,"b1":-0.08493467103347778,"a1":-1.969912167921219,"a2":0.9701347537322784}},{"key":["power-v1","12AT7","EL34","43","8.0","16",384000],"detector":{"real":145.17954552745744,"imaginary":5.7494391233396565},"anchor":{"b0":0.08279511886638866,"b1":-0.08229806895039954,"a1":-1.9554076937934166,"a2":0.9559047437094058}},{"key":["power-v1","12AT7","6L6GC","0","6.0","4",352800],"detector":{"real":79.21850800530689,"imaginary":3.3711668171803044},"anchor":{"b0":0.09369344627669804,"b1":-0.09357666938214047,"a1":-1.9724001242182545,"a2":0.9725169011128121}},{"key":["power-v1","12AT7","6L6GC","0","6.0","8",352800],"detector":{"real":112.05114009777772,"imaginary":4.789852518751421},"anchor":{"b0":0.09478667522827883,"b1":-0.09463223739806864,"a1":-1.9737184728368116,"a2":0.9738729106670218}},{"key":["power-v1","12AT7","6L6GC","0","6.0","15",352800],"detector":{"real":153.4502328697192,"imaginary":6.574328931451794},"anchor":{"b0":0.08838099296527269,"b1":-0.08803127473568007,"a1":-1.9618789264502956,"a2":0.9622286446798883}},{"key":["power-v1","12AT7","6L6GC","0","6.0","16",352800],"detector":{"real":158.4800475079804,"imaginary":6.787758189865932},"anchor":{"b0":0.1031744911633472,"b1":-0.10307351732884805,"a1":-1.9737224563393858,"a2":0.9738234301738848}},{"key":["power-v1","12AT7","6L6GC","0","6.0","4",384000],"detector":{"real":79.3251809378715,"imaginary":3.306429269090845},"anchor":{"b0":0.08679382933733079,"b1":-0.08675223059791802,"a1":-1.9724976848608566,"a2":0.9725392836002694}},{"key":["power-v1","12AT7","6L6GC","0","6.0","8",384000],"detector":{"real":112.20207660654383,"imaginary":4.698266788113236},"anchor":{"b0":0.0819027832490573,"b1":-0.08180653290709884,"a1":-1.9768471903257316,"a2":0.9769434406676901}},{"key":["power-v1","12AT7","6L6GC","0","6.0","15",384000],"detector":{"real":153.6569670968946,"imaginary":6.448881275957795},"anchor":{"b0":0.08866870358769591,"b1":-0.0885248224474961,"a1":-1.97422420331969,"a2":0.9743680844598898}},{"key":["power-v1","12AT7","6L6GC","0","6.0","16",384000],"detector":{"real":158.69355387335892,"imaginary":6.658202621626644},"anchor":{"b0":0.08423471632105374,"b1":-0.08419766615114455,"a1":-1.9779179856236513,"a2":0.9779550357935605}},{"key":["power-v1","12AT7","6L6GC","0","6.6","4",352800],"detector":{"real":82.47502019229607,"imaginary":3.528279909362685},"anchor":{"b0":0.09047393352644136,"b1":-0.09040765448896013,"a1":-1.9700770537642835,"a2":0.9701433328017647}},{"key":["power-v1","12AT7","6L6GC","0","6.6","8",352800],"detector":{"real":116.65733012081786,"imaginary":5.012965583882182},"anchor":{"b0":0.08853490716288308,"b1":-0.0884585373707104,"a1":-1.9679557492250344,"a2":0.9680321190172072}},{"key":["power-v1","12AT7","6L6GC","0","6.6","15",352800],"detector":{"real":159.75825028764172,"imaginary":6.880482745618394},"anchor":{"b0":0.09053668505563658,"b1":-0.09039534006239087,"a1":-1.9708693941042994,"a2":0.971010739097545}},{"key":["power-v1","12AT7","6L6GC","0","6.6","16",352800],"detector":{"real":164.99483057205205,"imaginary":7.103862206793605},"anchor":{"b0":0.0914930384143369,"b1":-0.09141587847474263,"a1":-1.9732355844426586,"a2":0.9733127443822529}},{"key":["power-v1","12AT7","6L6GC","0","6.6","4",384000],"detector":{"real":82.58574667172998,"imaginary":3.4608789521891534},"anchor":{"b0":0.09110585206900737,"b1":-0.09097333564320723,"a1":-1.974262006924232,"a2":0.9743945233500322}},{"key":["power-v1","12AT7","6L6GC","0","6.6","8",384000],"detector":{"real":116.81400232305951,"imaginary":4.917611704425949},"anchor":{"b0":0.08098474566092016,"b1":-0.08080677981482305,"a1":-1.9714616055488983,"a2":0.9716395713949955}},{"key":["power-v1","12AT7","6L6GC","0","6.6","15",384000],"detector":{"real":159.97284076455273,"imaginary":6.749873771849838},"anchor":{"b0":0.08414779195561504,"b1":-0.08411566641146086,"a1":-1.9724858836480261,"a2":0.9725180091921805}},{"key":["power-v1","12AT7","6L6GC","0","6.6","16",384000],"detector":{"real":165.21645048172243,"imaginary":6.9689762820156815},"anchor":{"b0":0.08243830443458218,"b1":-0.08240906084069226,"a1":-1.97902855118865,"a2":0.97905779478254}},{"key":["power-v1","12AT7","6L6GC","0","8.0","4",352800],"detector":{"real":89.22384844791401,"imaginary":3.8507992091077456},"anchor":{"b0":0.09526935309921658,"b1":-0.0951623418244975,"a1":-1.9755531398329942,"a2":0.9756601511077132}},{"key":["power-v1","12AT7","6L6GC","0","8.0","8",352800],"detector":{"real":126.20324514425943,"imaginary":5.470985817473289},"anchor":{"b0":0.09766977829368126,"b1":-0.09757253990355128,"a1":-1.9753460016579627,"a2":0.9754432400480927}},{"key":["power-v1","12AT7","6L6GC","0","8.0","15",352800],"detector":{"real":172.83105031799002,"imaginary":7.508986058097383},"anchor":{"b0":0.09107445868647394,"b1":-0.09098934149364017,"a1":-1.9760704739616062,"a2":0.97615559115444}},{"key":["power-v1","12AT7","6L6GC","0","8.0","16",352800],"detector":{"real":178.4961336718293,"imaginary":7.752790749292275},"anchor":{"b0":0.09124875245662836,"b1":-0.09115978737410489,"a1":-1.9734035614493743,"a2":0.9734925265318977}},{"key":["power-v1","12AT7","6L6GC","0","8.0","4",384000],"detector":{"real":89.34280983013248,"imaginary":3.7778900757471314},"anchor":{"b0":0.08421286315992339,"b1":-0.08414639831418375,"a1":-1.9741036609626048,"a2":0.9741701258083445}},{"key":["power-v1","12AT7","6L6GC","0","8.0","8",384000],"detector":{"real":126.37156983369299,"imaginary":5.367839118694577},"anchor":{"b0":0.08364310015742427,"b1":-0.08357805501938143,"a1":-1.973471375758427,"a2":0.9735364208964699}},{"key":["power-v1","12AT7","6L6GC","0","8.0","15",384000],"detector":{"real":173.06160108791727,"imaginary":7.3677028779658915},"anchor":{"b0":0.08111002454061438,"b1":-0.08100712120585542,"a1":-1.977789021627872,"a2":0.977891924962631}},{"key":["power-v1","12AT7","6L6GC","0","8.0","16",384000],"detector":{"real":178.73423672665027,"imaginary":7.606881067205772},"anchor":{"b0":0.08838774358391062,"b1":-0.08825684441608667,"a1":-1.9731911575650902,"a2":0.973322056732914}},{"key":["power-v1","12AT7","6L6GC","20","6.0","4",352800],"detector":{"real":56.57513078450391,"imaginary":2.3195305147228393},"anchor":{"b0":0.0975122162675601,"b1":-0.013735937905146309,"a1":-1.1924903822076476,"a2":0.2762666605700613}},{"key":["power-v1","12AT7","6L6GC","20","6.0","8",352800],"detector":{"real":80.0230900037385,"imaginary":3.2962170131784694},"anchor":{"b0":0.07760356723071529,"b1":-0.013786990423692422,"a1":-1.200256689670015,"a2":0.26407326647703794}},{"key":["power-v1","12AT7","6L6GC","20","6.0","15",352800],"detector":{"real":109.58892172564374,"imaginary":4.52461795895165},"anchor":{"b0":0.07431532494647905,"b1":-0.008796732457180347,"a1":-1.1936766358758102,"a2":0.2591952283651088}},{"key":["power-v1","12AT7","6L6GC","20","6.0","16",352800],"detector":{"real":113.1810414869414,"imaginary":4.671451865226472},"anchor":{"b0":0.10227269848575311,"b1":-0.034970281304884054,"a1":-1.25577194178946,"a2":0.3230743589703289}},{"key":["power-v1","12AT7","6L6GC","20","6.0","4",384000],"detector":{"real":56.64281785955092,"imaginary":2.27643747879767},"anchor":{"b0":0.08112676278809605,"b1":-0.0067225515363674195,"a1":-1.0133779171930062,"a2":0.08778212844473486}},{"key":["power-v1","12AT7","6L6GC","20","6.0","8",384000],"detector":{"real":80.11886679794657,"imaginary":3.235249057817603},"anchor":{"b0":0.16770771438560994,"b1":-0.054255418302859036,"a1":-0.9561418275665661,"a2":0.06959412364931694}},{"key":["power-v1","12AT7","6L6GC","20","6.0","15",384000],"detector":{"real":109.72010691479828,"imaginary":4.441105749527873},"anchor":{"b0":0.14271936451717515,"b1":-0.010209347823782607,"a1":-0.9369035654762828,"a2":0.0694135821696754}},{"key":["power-v1","12AT7","6L6GC","20","6.0","16",384000],"detector":{"real":113.31652374097013,"imaginary":4.585205341630689},"anchor":{"b0":0.10535139762452944,"b1":-0.0168119712475022,"a1":-0.992143604840257,"a2":0.08068303121728429}},{"key":["power-v1","12AT7","6L6GC","20","6.6","4",352800],"detector":{"real":57.52687064074679,"imaginary":2.3703489042093286},"anchor":{"b0":0.05145165166666046,"b1":-0.005264724656402758,"a1":-1.5193931275576185,"a2":0.5655800545678762}},{"key":["power-v1","12AT7","6L6GC","20","6.6","8",352800],"detector":{"real":81.36928187070869,"imaginary":3.368355626687906},"anchor":{"b0":0.05145165166666046,"b1":-0.005264724656402758,"a1":-1.5193931275576185,"a2":0.5655800545678762}},{"key":["power-v1","12AT7","6L6GC","20","6.6","15",352800],"detector":{"real":111.43248395714419,"imaginary":4.623587125784332},"anchor":{"b0":0.05145165166666046,"b1":-0.005264724656402758,"a1":-1.5193931275576185,"a2":0.5655800545678762}},{"key":["power-v1","12AT7","6L6GC","20","6.6","16",352800],"detector":{"real":115.08503251143863,"imaginary":4.773640263316114},"anchor":{"b0":0.05145165166666046,"b1":-0.005264724656402758,"a1":-1.5193931275576185,"a2":0.5655800545678762}},{"key":["power-v1","12AT7","6L6GC","20","6.6","4",384000],"detector":{"real":57.59507106589388,"imaginary":2.3260415122854874},"anchor":{"b0":0.09082273444337066,"b1":-0.011184339391628313,"a1":-1.2282255762767567,"a2":0.307863971328499}},{"key":["power-v1","12AT7","6L6GC","20","6.6","8",384000],"detector":{"real":81.46578550972195,"imaginary":3.305669592594605},"anchor":{"b0":0.07365158530236346,"b1":-0.011706812452617631,"a1":-1.2450230891748468,"a2":0.3069678620245927}},{"key":["power-v1","12AT7","6L6GC","20","6.6","15",384000],"detector":{"real":111.56466492146377,"imaginary":4.537721631358994},"anchor":{"b0":0.09082273444337066,"b1":-0.011184339391628313,"a1":-1.2282255762767567,"a2":0.307863971328499}},{"key":["power-v1","12AT7","6L6GC","20","6.6","16",384000],"detector":{"real":115.22154316149921,"imaginary":4.684963332482094},"anchor":{"b0":0.09082273444337066,"b1":-0.011184339391628313,"a1":-1.2282255762767567,"a2":0.307863971328499}},{"key":["power-v1","12AT7","6L6GC","20","8.0","4",352800],"detector":{"real":59.10517632747565,"imaginary":2.4580833487648146},"anchor":{"b0":0.09014549257803527,"b1":-0.09008623745190879,"a1":-1.9712891200368716,"a2":0.971348375162998}},{"key":["power-v1","12AT7","6L6GC","20","8.0","8",352800],"detector":{"real":83.60172110247741,"imaginary":3.492880342223983},"anchor":{"b0":0.09341751062221874,"b1":-0.09335542178089913,"a1":-1.9748557548328067,"a2":0.9749178436741265}},{"key":["power-v1","12AT7","6L6GC","20","8.0","15",352800],"detector":{"real":114.4897299095432,"imaginary":4.7944143874201695},"anchor":{"b0":0.09204655268109309,"b1":-0.09183915342085888,"a1":-1.9672318484317985,"a2":0.9674392476920327}},{"key":["power-v1","12AT7","6L6GC","20","8.0","16",352800],"detector":{"real":118.24248986028974,"imaginary":4.9500257537231915},"anchor":{"b0":0.08952091793706801,"b1":-0.08935988570500618,"a1":-1.9721111483335982,"a2":0.9722721805656601}},{"key":["power-v1","12AT7","6L6GC","20","8.0","4",384000],"detector":{"real":59.17389636069845,"imaginary":2.4113673560608966},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","6L6GC","20","8.0","8",384000],"detector":{"real":83.69896109364473,"imaginary":3.426786702628419},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","6L6GC","20","8.0","15",384000],"detector":{"real":114.62292012112029,"imaginary":4.703881417281063},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","6L6GC","20","8.0","16",384000],"detector":{"real":118.38004273452249,"imaginary":4.85652847459277},"anchor":{"b0":0.03891234392369181,"b1":-0.010303042712140106,"a1":-1.661708045427655,"a2":0.6903173466392066}},{"key":["power-v1","12AT7","6L6GC","43","6.0","4",352800],"detector":{"real":43.518978700775335,"imaginary":1.7463457793554498},"anchor":{"b0":0.08802488529217144,"b1":-0.08779141917030091,"a1":-1.9622516923026532,"a2":0.9624851584245236}},{"key":["power-v1","12AT7","6L6GC","43","6.0","8",352800],"detector":{"real":61.55573451910789,"imaginary":2.4819310913183084},"anchor":{"b0":0.08771934691261295,"b1":-0.08767396105544066,"a1":-1.9417234036497537,"a2":0.9417687895069259}},{"key":["power-v1","12AT7","6L6GC","43","6.0","15",352800],"detector":{"real":84.29850858333674,"imaginary":3.4070436644752573},"anchor":{"b0":0.08885906146194894,"b1":-0.08871881536678367,"a1":-1.9630611457929508,"a2":0.9632013918881162}},{"key":["power-v1","12AT7","6L6GC","43","6.0","16",352800],"detector":{"real":87.06165499631159,"imaginary":3.517585906831779},"anchor":{"b0":0.08916860976450086,"b1":-0.08911471626180263,"a1":-1.9643458878957618,"a2":0.96439978139846}},{"key":["power-v1","12AT7","6L6GC","43","6.0","4",384000],"detector":{"real":43.56726417906654,"imaginary":1.7144899496079338},"anchor":{"b0":0.08509678049473088,"b1":-0.08504767474533978,"a1":-1.927099146195327,"a2":0.9271482519447183}},{"key":["power-v1","12AT7","6L6GC","43","6.0","8",384000],"detector":{"real":61.624059695263,"imaginary":2.4368599964426334},"anchor":{"b0":0.08838432617159125,"b1":-0.08822438935986797,"a1":-1.9390917593743302,"a2":0.9392516961860535}},{"key":["power-v1","12AT7","6L6GC","43","6.0","15",384000],"detector":{"real":84.39209429388029,"imaginary":3.345305214856894},"anchor":{"b0":0.08290034029045121,"b1":-0.08249149099882469,"a1":-1.923555845920819,"a2":0.9239646952124456}},{"key":["power-v1","12AT7","6L6GC","43","6.0","16",384000],"detector":{"real":87.15830599121317,"imaginary":3.453826233961014},"anchor":{"b0":0.08502256221556977,"b1":-0.08392694542195549,"a1":-1.9229710091541314,"a2":0.9240666259477457}},{"key":["power-v1","12AT7","6L6GC","43","6.6","4",352800],"detector":{"real":43.57851772319981,"imaginary":1.7582369436113547},"anchor":{"b0":0.08898646106441292,"b1":-0.08883793656662198,"a1":-1.9685480408773768,"a2":0.9686965653751677}},{"key":["power-v1","12AT7","6L6GC","43","6.6","8",352800],"detector":{"real":61.639947243606215,"imaginary":2.498766884525377},"anchor":{"b0":0.0944755516378538,"b1":-0.09439449116889334,"a1":-1.9762749937706188,"a2":0.9763560542395794}},{"key":["power-v1","12AT7","6L6GC","43","6.6","15",352800],"detector":{"real":84.4138334094667,"imaginary":3.430110868077558},"anchor":{"b0":0.09522510380164426,"b1":-0.09506303323858138,"a1":-1.9742119042146915,"a2":0.9743739747777544}},{"key":["power-v1","12AT7","6L6GC","43","6.6","16",352800],"detector":{"real":87.1807601725905,"imaginary":3.54140759230492},"anchor":{"b0":0.0969317132980922,"b1":-0.096701422800546,"a1":-1.9690775785916559,"a2":0.969307869089202}},{"key":["power-v1","12AT7","6L6GC","43","6.6","4",384000],"detector":{"real":43.62634353177144,"imaginary":1.725727351730076},"anchor":{"b0":0.0816565409196833,"b1":-0.08160451945388318,"a1":-1.9736907208729717,"a2":0.9737427423387718}},{"key":["power-v1","12AT7","6L6GC","43","6.6","8",384000],"detector":{"real":61.70762255530563,"imaginary":2.4527709563951037},"anchor":{"b0":0.08791941133660154,"b1":-0.08786226753807447,"a1":-1.9765944365696506,"a2":0.9766515803681776}},{"key":["power-v1","12AT7","6L6GC","43","6.6","15",384000],"detector":{"real":84.50652916068812,"imaginary":3.367105806532216},"anchor":{"b0":0.08364735162080392,"b1":-0.08329465206775646,"a1":-1.9608651464653375,"a2":0.9612178460183849}},{"key":["power-v1","12AT7","6L6GC","43","6.6","16",384000],"detector":{"real":87.27649205809266,"imaginary":3.4763398835024573},"anchor":{"b0":0.08131766440208953,"b1":-0.08117695771987209,"a1":-1.9735338073503246,"a2":0.9736745140325421}},{"key":["power-v1","12AT7","6L6GC","43","8.0","4",352800],"detector":{"real":43.385985662853386,"imaginary":1.7693275799160266},"anchor":{"b0":0.08934934139890024,"b1":-0.0892287014860085,"a1":-1.9739263590489156,"a2":0.9740469989618072}},{"key":["power-v1","12AT7","6L6GC","43","8.0","8",352800],"detector":{"real":61.36761381540515,"imaginary":2.514402036866206},"anchor":{"b0":0.08837239025392227,"b1":-0.08807333631407455,"a1":-1.96396288247373,"a2":0.9642619364135778}},{"key":["power-v1","12AT7","6L6GC","43","8.0","15",352800],"detector":{"real":84.0408783099338,"imaginary":3.451486961736723},"anchor":{"b0":0.09073860743538092,"b1":-0.0904048556606318,"a1":-1.957020223461118,"a2":0.9573539752358673}},{"key":["power-v1","12AT7","6L6GC","43","8.0","16",352800],"detector":{"real":86.79558079749035,"imaginary":3.5634893812103923},"anchor":{"b0":0.09059730181898926,"b1":-0.0905036164323408,"a1":-1.964573743107045,"a2":0.9646674284936934}},{"key":["power-v1","12AT7","6L6GC","43","8.0","4",384000],"detector":{"real":43.43255274015611,"imaginary":1.7356041299732432},"anchor":{"b0":0.08418062324608248,"b1":-0.08412614968404,"a1":-1.9709825322599008,"a2":0.9710370058219434}},{"key":["power-v1","12AT7","6L6GC","43","8.0","8",384000],"detector":{"real":61.43350891115118,"imaginary":2.466689063437978},"anchor":{"b0":0.08289707298850792,"b1":-0.08273145216169901,"a1":-1.9738804699958927,"a2":0.9740460908227017}},{"key":["power-v1","12AT7","6L6GC","43","8.0","15",384000],"detector":{"real":84.13113646390045,"imaginary":3.386130261320093},"anchor":{"b0":0.08087091263051109,"b1":-0.08079768964142889,"a1":-1.9620092596277585,"a2":0.9620824826168408}},{"key":["power-v1","12AT7","6L6GC","43","8.0","16",384000],"detector":{"real":86.88879515838555,"imaginary":3.495992944684288},"anchor":{"b0":0.08396321659695155,"b1":-0.08392284582745338,"a1":-1.9777261359398128,"a2":0.977766506709311}},{"key":["power-v1","12AT7","KT88","0","6.0","4",352800],"detector":{"real":125.7486810685525,"imaginary":6.39394129957667},"anchor":{"b0":0.05145165166666046,"b1":-0.005264724656402758,"a1":-1.5193931275576185,"a2":0.5655800545678762}},{"key":["power-v1","12AT7","KT88","0","6.0","8",352800],"detector":{"real":177.86576732859106,"imaginary":9.078066509897722},"anchor":{"b0":0.045796561956547334,"b1":-0.005067660015380717,"a1":-1.5286035909441558,"a2":0.5693324928853224}},{"key":["power-v1","12AT7","KT88","0","6.0","15",352800],"detector":{"real":243.5809365172307,"imaginary":12.455586910095736},"anchor":{"b0":0.05242364725800591,"b1":-0.008703863100357102,"a1":-1.505025570182836,"a2":0.5487453543404847}},{"key":["power-v1","12AT7","KT88","0","6.0","16",352800],"detector":{"real":251.56509596350057,"imaginary":12.860578784544694},"anchor":{"b0":0.05145165166666046,"b1":-0.005264724656402758,"a1":-1.5193931275576185,"a2":0.5655800545678762}},{"key":["power-v1","12AT7","KT88","0","6.0","4",384000],"detector":{"real":126.04395872900467,"imaginary":6.1890284008387875},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","KT88","0","6.0","8",384000],"detector":{"real":178.28353755384498,"imaginary":8.788231778206532},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","KT88","0","6.0","15",384000],"detector":{"real":244.1531297643527,"imaginary":12.058652759108881},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","KT88","0","6.0","16",384000],"detector":{"real":252.1560350088788,"imaginary":12.45063707084442},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","KT88","0","6.6","4",352800],"detector":{"real":130.03556461964916,"imaginary":6.6171064792922065},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AT7","KT88","0","6.6","8",352800],"detector":{"real":183.92936700031234,"imaginary":9.3948870172609},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AT7","KT88","0","6.6","15",352800],"detector":{"real":251.88482287403167,"imaginary":12.890262436916345},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AT7","KT88","0","6.6","16",352800],"detector":{"real":260.14116938491884,"imaginary":13.309390356380241},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AT7","KT88","0","6.6","4",384000],"detector":{"real":130.33801733284807,"imaginary":6.407079663082069},"anchor":{"b0":0.04830394419666783,"b1":-0.008785905675822037,"a1":-1.4872716847555418,"a2":0.5267897232763875}},{"key":["power-v1","12AT7","KT88","0","6.6","8",384000],"detector":{"real":184.35728921190622,"imaginary":9.097818341952653},"anchor":{"b0":0.05703566860971629,"b1":-0.007023640931635376,"a1":-1.4696906162867347,"a2":0.5197026439648156}},{"key":["power-v1","12AT7","KT88","0","6.6","15",384000],"detector":{"real":252.47092097312262,"imaginary":12.483420550629251},"anchor":{"b0":0.05703566860971629,"b1":-0.007023640931635376,"a1":-1.4696906162867347,"a2":0.5197026439648156}},{"key":["power-v1","12AT7","KT88","0","6.6","16",384000],"detector":{"real":260.74646882046306,"imaginary":12.889216305910995},"anchor":{"b0":0.05966733221607507,"b1":-0.008736145536256871,"a1":-1.4361284657357398,"a2":0.48705965241555804}},{"key":["power-v1","12AT7","KT88","0","8.0","4",352800],"detector":{"real":138.55717873384512,"imaginary":7.040120439729315},"anchor":{"b0":0.08939394208315324,"b1":-0.08911908532391441,"a1":-1.9659566240215594,"a2":0.9662314807807981}},{"key":["power-v1","12AT7","KT88","0","8.0","8",352800],"detector":{"real":195.98280383386657,"imaginary":9.995533609608414},"anchor":{"b0":0.09403738926447025,"b1":-0.09374809145876929,"a1":-1.965695875582634,"a2":0.9659851733883349}},{"key":["power-v1","12AT7","KT88","0","8.0","15",352800],"detector":{"real":268.3915841672403,"imaginary":13.714418859854224},"anchor":{"b0":0.0954885651774806,"b1":-0.09511693323276167,"a1":-1.9592785986854486,"a2":0.9596502306301676}},{"key":["power-v1","12AT7","KT88","0","8.0","16",352800],"detector":{"real":277.18899335903126,"imaginary":14.160338927802918},"anchor":{"b0":0.08785134413341186,"b1":-0.08779312885205322,"a1":-1.963755897070745,"a2":0.9638141123521036}},{"key":["power-v1","12AT7","KT88","0","8.0","4",384000],"detector":{"real":138.87255571130405,"imaginary":6.820996708486286},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","KT88","0","8.0","8",384000],"detector":{"real":196.42901318662388,"imaginary":9.68559618117679},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","KT88","0","8.0","15",384000],"detector":{"real":269.00272979120115,"imaginary":13.289951348085904},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","KT88","0","8.0","16",384000],"detector":{"real":277.8201607770151,"imaginary":13.721961890971999},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","KT88","20","6.0","4",352800],"detector":{"real":71.79018229073228,"imaginary":3.0825028903833003},"anchor":{"b0":0.0879452348264187,"b1":-0.08771071613968102,"a1":-1.9582582222111025,"a2":0.9584927408978401}},{"key":["power-v1","12AT7","KT88","20","6.0","8",352800],"detector":{"real":101.54408843593977,"imaginary":4.37953582222917},"anchor":{"b0":0.09560262079769684,"b1":-0.09547781613062356,"a1":-1.9643943470630156,"a2":0.9645191517300888}},{"key":["power-v1","12AT7","KT88","20","6.0","15",352800],"detector":{"real":139.0611771288959,"imaginary":6.011027637993049},"anchor":{"b0":0.08993896995865065,"b1":-0.08979127527651411,"a1":-1.9753193267883977,"a2":0.9754670214705342}},{"key":["power-v1","12AT7","KT88","20","6.0","16",352800],"detector":{"real":143.61934587799598,"imaginary":6.206186539844102},"anchor":{"b0":0.09790574750527085,"b1":-0.09779390767819299,"a1":-1.9748701817120822,"a2":0.97498202153916}},{"key":["power-v1","12AT7","KT88","20","6.0","4",384000],"detector":{"real":71.91196145158564,"imaginary":2.9946277458382853},"anchor":{"b0":0.08263442390720943,"b1":-0.08245379744937252,"a1":-1.9677752777103703,"a2":0.9679559041682072}},{"key":["power-v1","12AT7","KT88","20","6.0","8",384000],"detector":{"real":101.71639534464613,"imaginary":4.255230926132173},"anchor":{"b0":0.08534853106115999,"b1":-0.08524380455648534,"a1":-1.9774956537738502,"a2":0.9776003802785248}},{"key":["power-v1","12AT7","KT88","20","6.0","15",384000],"detector":{"real":139.2971800857638,"imaginary":5.840778940748871},"anchor":{"b0":0.08161677899304079,"b1":-0.08158625375363392,"a1":-1.9756026327868401,"a2":0.975633158026247}},{"key":["power-v1","12AT7","KT88","20","6.0","16",384000],"detector":{"real":143.863079952064,"imaginary":6.030360378512994},"anchor":{"b0":0.0827203135906093,"b1":-0.08247527901608943,"a1":-1.9681279639312823,"a2":0.9683729985058022}},{"key":["power-v1","12AT7","KT88","20","6.6","4",352800],"detector":{"real":71.70298478865067,"imaginary":3.069897980848742},"anchor":{"b0":0.09508890662243193,"b1":-0.09504174990881631,"a1":-1.9734724637289511,"a2":0.9735196204425668}},{"key":["power-v1","12AT7","KT88","20","6.6","8",352800],"detector":{"real":101.42075379076213,"imaginary":4.361682971225187},"anchor":{"b0":0.09122019018652676,"b1":-0.09107590394951327,"a1":-1.9735905356438863,"a2":0.9737348218808998}},{"key":["power-v1","12AT7","KT88","20","6.6","15",352800],"detector":{"real":138.89227620208806,"imaginary":5.986562396937326},"anchor":{"b0":0.09016673222064929,"b1":-0.09012246631025371,"a1":-1.9689090568918142,"a2":0.9689533228022098}},{"key":["power-v1","12AT7","KT88","20","6.6","16",352800],"detector":{"real":143.44490844210952,"imaginary":6.1809216607925075},"anchor":{"b0":0.0896656354978746,"b1":-0.0896131111895928,"a1":-1.9772189222964565,"a2":0.9772714466047383}},{"key":["power-v1","12AT7","KT88","20","6.6","4",384000],"detector":{"real":71.82167771659542,"imaginary":2.982753558948601},"anchor":{"b0":0.08486725903042591,"b1":-0.08479834174481093,"a1":-1.9783353096556353,"a2":0.9784042269412504}},{"key":["power-v1","12AT7","KT88","20","6.6","8",384000],"detector":{"real":101.58869507256843,"imaginary":4.238410899695081},"anchor":{"b0":0.08236698127107779,"b1":-0.08233812079887666,"a1":-1.9762636608729316,"a2":0.9762925213451327}},{"key":["power-v1","12AT7","KT88","20","6.6","15",384000],"detector":{"real":139.12230036729903,"imaginary":5.817727621952395},"anchor":{"b0":0.0845890763291451,"b1":-0.08441201402996401,"a1":-1.9730630628514039,"a2":0.9732401251505851}},{"key":["power-v1","12AT7","KT88","20","6.6","16",384000],"detector":{"real":143.68246778531523,"imaginary":6.006555854585837},"anchor":{"b0":0.08369124227512735,"b1":-0.0834953916842165,"a1":-1.9705404566465141,"a2":0.9707363072374249}},{"key":["power-v1","12AT7","KT88","20","8.0","4",352800],"detector":{"real":71.0182309934874,"imaginary":3.021964816593142},"anchor":{"b0":0.09014234092228013,"b1":-0.09010524931915259,"a1":-1.9688725766364064,"a2":0.9689096682395338}},{"key":["power-v1","12AT7","KT88","20","8.0","8",352800],"detector":{"real":100.45220433195705,"imaginary":4.293697595856704},"anchor":{"b0":0.08777420595487187,"b1":-0.08760821026781915,"a1":-1.9600005625356842,"a2":0.9601665582227369}},{"key":["power-v1","12AT7","KT88","20","8.0","15",352800],"detector":{"real":137.56588408495975,"imaginary":5.893330770912987},"anchor":{"b0":0.09090288304851589,"b1":-0.09081259419984267,"a1":-1.9630913410802153,"a2":0.9631816299288886}},{"key":["power-v1","12AT7","KT88","20","8.0","16",352800],"detector":{"real":142.07503920249079,"imaginary":6.084651923374351},"anchor":{"b0":0.08910658583633475,"b1":-0.08906869645843504,"a1":-1.9652397416437932,"a2":0.965277631021693}},{"key":["power-v1","12AT7","KT88","20","8.0","4",384000],"detector":{"real":71.12998739028868,"imaginary":2.936656185915738},"anchor":{"b0":0.08194842688208812,"b1":-0.08117040682368705,"a1":-1.9360641474838092,"a2":0.9368421675422102}},{"key":["power-v1","12AT7","KT88","20","8.0","8",384000],"detector":{"real":100.61033332502039,"imaginary":4.1730207856938355},"anchor":{"b0":0.08626205313216972,"b1":-0.08613227268171951,"a1":-1.9771996172778803,"a2":0.9773293977283305}},{"key":["power-v1","12AT7","KT88","20","8.0","15",384000],"detector":{"real":137.7824701387002,"imaginary":5.728049201039337},"anchor":{"b0":0.08288151495211665,"b1":-0.08258685495991859,"a1":-1.9646652940816054,"a2":0.9649599540738035}},{"key":["power-v1","12AT7","KT88","20","8.0","16",384000],"detector":{"real":142.2987199710839,"imaginary":5.913955933583458},"anchor":{"b0":0.08137264432229671,"b1":-0.08114533495215226,"a1":-1.96361680941654,"a2":0.9638441187866845}},{"key":["power-v1","12AT7","KT88","43","6.0","4",352800],"detector":{"real":48.124902274055344,"imaginary":1.898025581871938},"anchor":{"b0":0.10088802996531514,"b1":-0.10082182597130933,"a1":-1.9567662094126188,"a2":0.9568324134066246}},{"key":["power-v1","12AT7","KT88","43","6.0","8",352800],"detector":{"real":68.07062534437644,"imaginary":2.6977242202597678},"anchor":{"b0":0.0997486719423328,"b1":-0.09965254289594343,"a1":-1.9727702313816138,"a2":0.9728663604280031}},{"key":["power-v1","12AT7","KT88","43","6.0","15",352800],"detector":{"real":93.22043876826041,"imaginary":3.703424425707283},"anchor":{"b0":0.08849558703681056,"b1":-0.08844008115445579,"a1":-1.9544790397299003,"a2":0.9545345456122551}},{"key":["power-v1","12AT7","KT88","43","6.0","16",352800],"detector":{"real":96.27602831585524,"imaginary":3.823561507194567},"anchor":{"b0":0.08905734679808316,"b1":-0.08890246905559844,"a1":-1.9716906137219128,"a2":0.9718454914643975}},{"key":["power-v1","12AT7","KT88","43","6.0","4",384000],"detector":{"real":48.19275895699347,"imaginary":1.8482972615744329},"anchor":{"b0":0.08255249387576825,"b1":-0.0824395264787351,"a1":-1.975270349661881,"a2":0.9753833170589142}},{"key":["power-v1","12AT7","KT88","43","6.0","8",384000],"detector":{"real":68.16664025274206,"imaginary":2.6273757311761305},"anchor":{"b0":0.08568829624181708,"b1":-0.08564533808017782,"a1":-1.9719429395643115,"a2":0.9719858977259509}},{"key":["power-v1","12AT7","KT88","43","6.0","15",384000],"detector":{"real":93.35194910791462,"imaginary":3.607070460740791},"anchor":{"b0":0.08173954939818284,"b1":-0.08158294488323639,"a1":-1.9715063625702816,"a2":0.971662967085228}},{"key":["power-v1","12AT7","KT88","43","6.0","16",384000],"detector":{"real":96.41184649070087,"imaginary":3.7240515516002204},"anchor":{"b0":0.08535013045586809,"b1":-0.08519027464224765,"a1":-1.9741186126363464,"a2":0.9742784684499669}},{"key":["power-v1","12AT7","KT88","43","6.6","4",352800],"detector":{"real":47.35219523196172,"imaginary":1.8657153090084473},"anchor":{"b0":0.09095314838063465,"b1":-0.09071528440648846,"a1":-1.9631591393838383,"a2":0.9633970033579844}},{"key":["power-v1","12AT7","KT88","43","6.6","8",352800],"detector":{"real":66.97766466711923,"imaginary":2.6518131548194},"anchor":{"b0":0.08805556695521087,"b1":-0.08796525279345385,"a1":-1.9722926987937397,"a2":0.9723830129554966}},{"key":["power-v1","12AT7","KT88","43","6.6","15",352800],"detector":{"real":91.72366605292669,"imaginary":3.6404065829235757},"anchor":{"b0":0.09390447424345963,"b1":-0.09376620899849121,"a1":-1.9734017132757398,"a2":0.9735399785207083}},{"key":["power-v1","12AT7","KT88","43","6.6","16",352800],"detector":{"real":94.73019421424637,"imaginary":3.75849813361993},"anchor":{"b0":0.08808416160683873,"b1":-0.08781786498009672,"a1":-1.9673007049618374,"a2":0.9675670015885794}},{"key":["power-v1","12AT7","KT88","43","6.6","4",384000],"detector":{"real":47.417296113753906,"imaginary":1.816758475190719},"anchor":{"b0":0.0830207456596748,"b1":-0.08289026266480665,"a1":-1.976124898382917,"a2":0.9762553813777852}},{"key":["power-v1","12AT7","KT88","43","6.6","8",384000],"detector":{"real":67.06978095627588,"imaginary":2.5825556735277337},"anchor":{"b0":0.0869978282293237,"b1":-0.08689876779584481,"a1":-1.968706451877496,"a2":0.9688055123109747}},{"key":["power-v1","12AT7","KT88","43","6.6","15",384000],"detector":{"real":91.84983709212199,"imaginary":3.5455465943828637},"anchor":{"b0":0.09195485264701019,"b1":-0.09189219333939976,"a1":-1.9758448033458658,"a2":0.9759074626534762}},{"key":["power-v1","12AT7","KT88","43","6.6","16",384000],"detector":{"real":94.86049807892954,"imaginary":3.660531197686695},"anchor":{"b0":0.08516967769485233,"b1":-0.08500551754963007,"a1":-1.9743737293961559,"a2":0.9745378895413781}},{"key":["power-v1","12AT7","KT88","43","8.0","4",352800],"detector":{"real":45.55076872513072,"imaginary":1.7927544667194026},"anchor":{"b0":0.09294433406401251,"b1":-0.09288980160966524,"a1":-1.9619104875983444,"a2":0.9619650200526918}},{"key":["power-v1","12AT7","KT88","43","8.0","8",352800],"detector":{"real":64.42962407541421,"imaginary":2.54812472656858},"anchor":{"b0":0.09437204015304668,"b1":-0.09431178072769561,"a1":-1.9700352676226225,"a2":0.9700955270479735}},{"key":["power-v1","12AT7","KT88","43","8.0","15",352800],"detector":{"real":88.2342102776763,"imaginary":3.4980725985754506},"anchor":{"b0":0.09137235152642723,"b1":-0.091294589748527,"a1":-1.9767096281523155,"a2":0.9767873899302156}},{"key":["power-v1","12AT7","KT88","43","8.0","16",352800],"detector":{"real":91.12636061390143,"imaginary":3.6115456478738754},"anchor":{"b0":0.09105670145807229,"b1":-0.09101796646458764,"a1":-1.9654588739784016,"a2":0.9654976089718862}},{"key":["power-v1","12AT7","KT88","43","8.0","4",384000],"detector":{"real":45.61033797990152,"imaginary":1.7454274768595344},"anchor":{"b0":0.08392311500581548,"b1":-0.08389471694922607,"a1":-1.9671104556432193,"a2":0.9671388536998087}},{"key":["power-v1","12AT7","KT88","43","8.0","8",384000],"detector":{"real":64.51391491434029,"imaginary":2.4811721171651393},"anchor":{"b0":0.08295129817013455,"b1":-0.08292038873162738,"a1":-1.97710036732626,"a2":0.9771312767647671}},{"key":["power-v1","12AT7","KT88","43","8.0","15",384000],"detector":{"real":88.34966384057145,"imaginary":3.4063689623659},"anchor":{"b0":0.08128341442231954,"b1":-0.0810143325385749,"a1":-1.9501854943622887,"a2":0.9504545762460335}},{"key":["power-v1","12AT7","KT88","43","8.0","16",384000],"detector":{"real":91.24559583545731,"imaginary":3.5168385096208605},"anchor":{"b0":0.08257902966679923,"b1":-0.08251809467241877,"a1":-1.9747655523987377,"a2":0.9748264873931182}},{"key":["power-v1","12AU7","EL84","0","6.0","4",352800],"detector":{"real":12.864356775316764,"imaginary":0.8525610786240252},"anchor":{"b0":0.08982421895096719,"b1":-0.08975829005943015,"a1":-1.9720223639348953,"a2":0.9720882928264323}},{"key":["power-v1","12AU7","EL84","0","6.0","8",352800],"detector":{"real":18.195991542350683,"imaginary":1.2094028675117203},"anchor":{"b0":0.08807158738805183,"b1":-0.08789453128704641,"a1":-1.9659845100413151,"a2":0.9661615661423204}},{"key":["power-v1","12AU7","EL84","0","6.0","15",352800],"detector":{"real":24.918735917053034,"imaginary":1.658640118120139},"anchor":{"b0":0.09120959800714631,"b1":-0.09106843604943202,"a1":-1.9755268285647252,"a2":0.9756679905224396}},{"key":["power-v1","12AU7","EL84","0","6.0","16",352800],"detector":{"real":25.7355339220078,"imaginary":1.712671585877832},"anchor":{"b0":0.08884586551534385,"b1":-0.08880254290185036,"a1":-1.9773032800706396,"a2":0.9773466026841331}},{"key":["power-v1","12AU7","EL84","0","6.0","4",384000],"detector":{"real":12.898323291204735,"imaginary":0.831428605142711},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.0","8",384000],"detector":{"real":18.24404742101699,"imaginary":1.1795135657928122},"anchor":{"b0":0.03410615843442524,"b1":-0.003163710971482071,"a1":-1.6284423787076867,"a2":0.65938482617063}},{"key":["power-v1","12AU7","EL84","0","6.0","15",384000],"detector":{"real":24.98455424517954,"imaginary":1.61770693736122},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.0","16",384000],"detector":{"real":25.803508632093138,"imaginary":1.6703969066189748},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.6","4",352800],"detector":{"real":13.401795444892066,"imaginary":0.8908582839384008},"anchor":{"b0":0.09089123154241834,"b1":-0.09079994200641178,"a1":-1.974131712616923,"a2":0.9742230021529298}},{"key":["power-v1","12AU7","EL84","0","6.6","8",352800],"detector":{"real":18.956170991708593,"imaginary":1.2637185576009755},"anchor":{"b0":0.08839360600442299,"b1":-0.08806385520423597,"a1":-1.9494556233464315,"a2":0.9497853741466186}},{"key":["power-v1","12AU7","EL84","0","6.6","15",352800],"detector":{"real":25.959772967778594,"imaginary":1.7331240978350457},"anchor":{"b0":0.0893214112754719,"b1":-0.08821309294255049,"a1":-1.932601802410113,"a2":0.9337101207430344}},{"key":["power-v1","12AU7","EL84","0","6.6","16",352800],"detector":{"real":26.810694653688763,"imaginary":1.789582998709299},"anchor":{"b0":0.09136882338063398,"b1":-0.0909026095600375,"a1":-1.9567979621631966,"a2":0.9572641759837931}},{"key":["power-v1","12AU7","EL84","0","6.6","4",384000],"detector":{"real":13.436976664875486,"imaginary":0.8689919077454439},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.6","8",384000],"detector":{"real":19.005945510371113,"imaginary":1.2327911970315857},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.6","15",384000],"detector":{"real":26.027945227093134,"imaginary":1.690769131079383},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.6","16",384000],"detector":{"real":26.88110037965161,"imaginary":1.745839939966753},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","8.0","4",352800],"detector":{"real":14.524289844298854,"imaginary":0.9689627161403388},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AU7","EL84","0","8.0","8",352800],"detector":{"real":20.543882361324794,"imaginary":1.3744985968227488},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AU7","EL84","0","8.0","15",352800],"detector":{"real":28.134084131770088,"imaginary":1.885043299742992},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AU7","EL84","0","8.0","16",352800],"detector":{"real":29.05627646053908,"imaginary":1.9464525357590214},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AU7","EL84","0","8.0","4",384000],"detector":{"real":14.561908186743167,"imaginary":0.94561519946549},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","8.0","8",384000],"detector":{"real":20.597104991182608,"imaginary":1.341476291736617},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","8.0","15",384000],"detector":{"real":28.206979085046203,"imaginary":1.8398193058475136},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","8.0","16",384000],"detector":{"real":29.13155966019764,"imaginary":1.8997464437003093},"anchor":{"b0":0.03157661930906451,"b1":-0.0019466240819103699,"a1":-1.652606458773521,"a2":0.6822364540006752}},{"key":["power-v1","12AU7","EL84","20","6.0","4",352800],"detector":{"real":9.519719943838203,"imaginary":0.5515925209564798},"anchor":{"b0":0.08877478679265763,"b1":-0.08873982806426318,"a1":-1.975428492944606,"a2":0.9754634516730005}},{"key":["power-v1","12AU7","EL84","20","6.0","8",352800],"detector":{"real":13.465190922233488,"imaginary":0.7827870244141183},"anchor":{"b0":0.08989298503282325,"b1":-0.08974692698319958,"a1":-1.9639858566852464,"a2":0.9641319147348701}},{"key":["power-v1","12AU7","EL84","20","6.0","15",352800],"detector":{"real":18.440094633175796,"imaginary":1.0737786199654333},"anchor":{"b0":0.08800036204048187,"b1":-0.08777846491343298,"a1":-1.9701628162926617,"a2":0.9703847134197104}},{"key":["power-v1","12AU7","EL84","20","6.0","16",352800],"detector":{"real":19.044530665741828,"imaginary":1.1087268223815556},"anchor":{"b0":0.08922681339281177,"b1":-0.08918922670318502,"a1":-1.9564339278883636,"a2":0.9564715145779902}},{"key":["power-v1","12AU7","EL84","20","6.0","4",384000],"detector":{"real":9.539062346220465,"imaginary":0.5405291037629735},"anchor":{"b0":0.08253187896990227,"b1":-0.08245156234535045,"a1":-1.9712884938045874,"a2":0.9713688104291391}},{"key":["power-v1","12AU7","EL84","20","6.0","8",384000],"detector":{"real":13.492557189930602,"imaginary":0.7671379420850266},"anchor":{"b0":0.0847513749235303,"b1":-0.08469616874267609,"a1":-1.9790927851751237,"a2":0.979147991355978}},{"key":["power-v1","12AU7","EL84","20","6.0","15",384000],"detector":{"real":18.477576343329282,"imaginary":1.0523460299177239},"anchor":{"b0":0.0854465383154784,"b1":-0.08538414184617511,"a1":-1.9677636342864657,"a2":0.9678260307557691}},{"key":["power-v1","12AU7","EL84","20","6.0","16",384000],"detector":{"real":19.083240276905133,"imaginary":1.086591968928309},"anchor":{"b0":0.08152461572998122,"b1":-0.0814211246066322,"a1":-1.9375341172096592,"a2":0.9376376083330081}},{"key":["power-v1","12AU7","EL84","20","6.6","4",352800],"detector":{"real":9.714923736048563,"imaginary":0.5610685493448887},"anchor":{"b0":0.09041165379123407,"b1":-0.09032598553449747,"a1":-1.9756213247552417,"a2":0.9757069930119782}},{"key":["power-v1","12AU7","EL84","20","6.6","8",352800],"detector":{"real":13.741297851021173,"imaginary":0.7962433585205664},"anchor":{"b0":0.09166727163090502,"b1":-0.0916315682427379,"a1":-1.976347633497535,"a2":0.9763833368857022}},{"key":["power-v1","12AU7","EL84","20","6.6","15",352800],"detector":{"real":18.81821341255705,"imaginary":1.0922430042979026},"anchor":{"b0":0.08962458588904794,"b1":-0.08958850521908927,"a1":-1.9768974159693151,"a2":0.9769334966392738}},{"key":["power-v1","12AU7","EL84","20","6.6","16",352800],"detector":{"real":19.435043452561715,"imaginary":1.1277913244143747},"anchor":{"b0":0.08953446908563391,"b1":-0.08947830964599966,"a1":-1.9746732109836604,"a2":0.9747293704232947}},{"key":["power-v1","12AU7","EL84","20","6.6","4",384000],"detector":{"real":9.73424585710861,"imaginary":0.5500221196308233},"anchor":{"b0":0.08259914167568574,"b1":-0.08254923010417732,"a1":-1.958941231931302,"a2":0.9589911435028106}},{"key":["power-v1","12AU7","EL84","20","6.6","8",384000],"detector":{"real":13.76863556753362,"imaginary":0.7806182981342812},"anchor":{"b0":0.08163653672646763,"b1":-0.08147789645419579,"a1":-1.9747608753106776,"a2":0.9749195155829493}},{"key":["power-v1","12AU7","EL84","20","6.6","15",384000],"detector":{"real":18.855656160787287,"imaginary":1.0708432355220134},"anchor":{"b0":0.0876469742694822,"b1":-0.0876032364671594,"a1":-1.9771621990557906,"a2":0.9772059368581134}},{"key":["power-v1","12AU7","EL84","20","6.6","16",384000],"detector":{"real":19.47371286527726,"imaginary":1.1056903950235681},"anchor":{"b0":0.08552122271632713,"b1":-0.08535587785092418,"a1":-1.9690815074433583,"a2":0.9692468523087613}},{"key":["power-v1","12AU7","EL84","20","8.0","4",352800],"detector":{"real":10.061321664478356,"imaginary":0.5758388547798289},"anchor":{"b0":0.09173915355234472,"b1":-0.09106825903801032,"a1":-1.9474744908984105,"a2":0.9481453854127448}},{"key":["power-v1","12AU7","EL84","20","8.0","8",352800],"detector":{"real":14.231262693189741,"imaginary":0.817229314686487},"anchor":{"b0":0.09036820270974258,"b1":-0.0902163871544734,"a1":-1.9685020295011781,"a2":0.9686538450564474}},{"key":["power-v1","12AU7","EL84","20","8.0","15",352800],"detector":{"real":19.48920366637615,"imaginary":1.1210472439948544},"anchor":{"b0":0.08828981972156377,"b1":-0.08812155070411139,"a1":-1.9739892646929689,"a2":0.9741575337104212}},{"key":["power-v1","12AU7","EL84","20","8.0","16",352800],"detector":{"real":20.12802753237958,"imaginary":1.1575306407791635},"anchor":{"b0":0.0940285773493412,"b1":-0.09382192423675986,"a1":-1.9686361501428045,"a2":0.9688428032553859}},{"key":["power-v1","12AU7","EL84","20","8.0","4",384000],"detector":{"real":10.080412647087917,"imaginary":0.5648943339452343},"anchor":{"b0":0.08336386947390913,"b1":-0.08330323811340033,"a1":-1.9776617510650962,"a2":0.9777223824256049}},{"key":["power-v1","12AU7","EL84","20","8.0","8",384000],"detector":{"real":14.258273591390289,"imaginary":0.8017480643475459},"anchor":{"b0":0.09167037828647195,"b1":-0.09163387675710748,"a1":-1.9713766380520696,"a2":0.9714131395814343}},{"key":["power-v1","12AU7","EL84","20","8.0","15",384000],"detector":{"real":19.526198848636785,"imaginary":1.099844189831933},"anchor":{"b0":0.08466131799625404,"b1":-0.0846110635007285,"a1":-1.9789381939176534,"a2":0.978988448413179}},{"key":["power-v1","12AU7","EL84","20","8.0","16",384000],"detector":{"real":20.166234730414974,"imaginary":1.1356329714917561},"anchor":{"b0":0.08234975053788333,"b1":-0.08224489287220704,"a1":-1.9784748569028672,"a2":0.9785797145685434}},{"key":["power-v1","12AU7","EL84","43","6.0","4",352800],"detector":{"real":7.613121549903589,"imaginary":0.4048174770640601},"anchor":{"b0":0.09211018320053288,"b1":-0.09195940968490564,"a1":-1.9706624979967589,"a2":0.9708132715123862}},{"key":["power-v1","12AU7","EL84","43","6.0","8",352800],"detector":{"real":10.768407996126825,"imaginary":0.5746622906970572},"anchor":{"b0":0.09249195200653801,"b1":-0.09243723394200574,"a1":-1.9762725791534708,"a2":0.976327297218003}},{"key":["power-v1","12AU7","EL84","43","6.0","15",352800],"detector":{"real":14.746954109557285,"imaginary":0.7884023790981755},"anchor":{"b0":0.08856127440888471,"b1":-0.08841212343296677,"a1":-1.9750395965514493,"a2":0.9751887475273674}},{"key":["power-v1","12AU7","EL84","43","6.0","16",352800],"detector":{"real":15.230334087518255,"imaginary":0.8140462297117936},"anchor":{"b0":0.08814283618776243,"b1":-0.08804597858959762,"a1":-1.9742539994315051,"a2":0.9743508570296698}},{"key":["power-v1","12AU7","EL84","43","6.0","4",384000],"detector":{"real":7.625926389587326,"imaginary":0.39815996176001195},"anchor":{"b0":0.082271354961994,"b1":-0.08208895278662752,"a1":-1.9626441115217446,"a2":0.962826513697111}},{"key":["power-v1","12AU7","EL84","43","6.0","8",384000],"detector":{"real":10.786525125119608,"imaginary":0.5652446143789132},"anchor":{"b0":0.08257281719075418,"b1":-0.08246739478621723,"a1":-1.978743004289856,"a2":0.9788484266943929}},{"key":["power-v1","12AU7","EL84","43","6.0","15",384000],"detector":{"real":14.771768138673881,"imaginary":0.7755033349890372},"anchor":{"b0":0.08833695389268491,"b1":-0.08822682444501713,"a1":-1.9711857972007962,"a2":0.9712959266484641}},{"key":["power-v1","12AU7","EL84","43","6.0","16",384000],"detector":{"real":15.255961045068913,"imaginary":0.800724671791763},"anchor":{"b0":0.09080936604329053,"b1":-0.0905585268942962,"a1":-1.966283276359634,"a2":0.9665341155086283}},{"key":["power-v1","12AU7","EL84","43","6.6","4",352800],"detector":{"real":7.654692647144722,"imaginary":0.4046686038022264},"anchor":{"b0":0.08835485352133113,"b1":-0.08822915641192954,"a1":-1.9749475000738221,"a2":0.9750731971832237}},{"key":["power-v1","12AU7","EL84","43","6.6","8",352800],"detector":{"real":10.827209056552043,"imaginary":0.5744629588901151},"anchor":{"b0":0.09536085695616534,"b1":-0.09523014825426451,"a1":-1.9750862266316134,"a2":0.9752169353335142}},{"key":["power-v1","12AU7","EL84","43","6.6","15",352800],"detector":{"real":14.827480545476684,"imaginary":0.788137131656646},"anchor":{"b0":0.08925254925256411,"b1":-0.0890900005707974,"a1":-1.9738654204456425,"a2":0.9740279691274092}},{"key":["power-v1","12AU7","EL84","43","6.6","16",352800],"detector":{"real":15.313499958503817,"imaginary":0.8137711608761004},"anchor":{"b0":0.08871046605559511,"b1":-0.08864498436572613,"a1":-1.9716484589106966,"a2":0.9717139406005657}},{"key":["power-v1","12AU7","EL84","43","6.6","4",384000],"detector":{"real":7.667177552851507,"imaginary":0.39817730111747807},"anchor":{"b0":0.08317919183626998,"b1":-0.08304739124048159,"a1":-1.9670274327382495,"a2":0.9671592333340381}},{"key":["power-v1","12AU7","EL84","43","6.6","8",384000],"detector":{"real":10.844873569207484,"imaginary":0.5652803076022832},"anchor":{"b0":0.08600799491903466,"b1":-0.08591171739915739,"a1":-1.9757924330027508,"a2":0.975888710522628}},{"key":["power-v1","12AU7","EL84","43","6.6","15",384000],"detector":{"real":14.851674720628196,"imaginary":0.775559875541356},"anchor":{"b0":0.08224442525379312,"b1":-0.08221542324430688,"a1":-1.9691453724227244,"a2":0.9691743744322106}},{"key":["power-v1","12AU7","EL84","43","6.6","16",384000],"detector":{"real":15.33848675700955,"imaginary":0.8007819891442719},"anchor":{"b0":0.09139781154065003,"b1":-0.09131554626108934,"a1":-1.9759550217973079,"a2":0.9760372870768684}},{"key":["power-v1","12AU7","EL84","43","8.0","4",352800],"detector":{"real":7.6863522461883464,"imaginary":0.401081612062662},"anchor":{"b0":0.0890535227640836,"b1":-0.0889494594441539,"a1":-1.9630419406474022,"a2":0.963146003967332}},{"key":["power-v1","12AU7","EL84","43","8.0","8",352800],"detector":{"real":10.871991496261439,"imaginary":0.5693978566618753},"anchor":{"b0":0.09446131894309732,"b1":-0.09425745638057477,"a1":-1.9707419260654007,"a2":0.9709457886279232}},{"key":["power-v1","12AU7","EL84","43","8.0","15",352800],"detector":{"real":14.88880952247896,"imaginary":0.781206485821045},"anchor":{"b0":0.09666322746905637,"b1":-0.09653526914545699,"a1":-1.9687739130362414,"a2":0.9689018713598407}},{"key":["power-v1","12AU7","EL84","43","8.0","16",352800],"detector":{"real":15.376839040398822,"imaginary":0.8066125555740254},"anchor":{"b0":0.09279068989880133,"b1":-0.09269391127059964,"a1":-1.959925236675908,"a2":0.9600220153041097}},{"key":["power-v1","12AU7","EL84","43","8.0","4",384000],"detector":{"real":7.698092670913179,"imaginary":0.3949314890612273},"anchor":{"b0":0.08285193011328591,"b1":-0.08275932090465453,"a1":-1.9789304332283644,"a2":0.9790230424369958}},{"key":["power-v1","12AU7","EL84","43","8.0","8",384000],"detector":{"real":10.888602922239127,"imaginary":0.5606975024193813},"anchor":{"b0":0.08842917155892926,"b1":-0.08838328643143765,"a1":-1.9766608954584748,"a2":0.9767067805859663}},{"key":["power-v1","12AU7","EL84","43","8.0","15",384000],"detector":{"real":14.911561451322706,"imaginary":0.7692896122052265},"anchor":{"b0":0.08418635424501418,"b1":-0.08406511623667104,"a1":-1.9763330003554413,"a2":0.9764542383637845}},{"key":["power-v1","12AU7","EL84","43","8.0","16",384000],"detector":{"real":15.400336340748499,"imaginary":0.7943053983085973},"anchor":{"b0":0.08351469686096519,"b1":-0.08340657052180395,"a1":-1.9785705983991981,"a2":0.9786787247383595}},{"key":["power-v1","12AU7","EL34","0","6.0","4",352800],"detector":{"real":11.758988700075163,"imaginary":0.5519002387745011},"anchor":{"b0":0.09001383126790265,"b1":-0.08993179882501204,"a1":-1.9731294707762745,"a2":0.9732115032191652}},{"key":["power-v1","12AU7","EL34","0","6.0","8",352800],"detector":{"real":16.632565031318737,"imaginary":0.7838284759494409},"anchor":{"b0":0.10103698913465396,"b1":-0.10084286754176934,"a1":-1.9719687840458249,"a2":0.9721629056387096}},{"key":["power-v1","12AU7","EL34","0","6.0","15",352800],"detector":{"real":22.7777236378048,"imaginary":1.0756220960378022},"anchor":{"b0":0.0954745177792865,"b1":-0.09543146728933412,"a1":-1.9716023241082854,"a2":0.9716453745982376}},{"key":["power-v1","12AU7","EL34","0","6.0","16",352800],"detector":{"real":23.524336595003874,"imaginary":1.1105723439442678},"anchor":{"b0":0.09939203097961155,"b1":-0.09926091041730022,"a1":-1.970854865362915,"a2":0.9709859859252263}},{"key":["power-v1","12AU7","EL34","0","6.0","4",384000],"detector":{"real":11.774908167788073,"imaginary":0.5442725886237864},"anchor":{"b0":0.08701003173649911,"b1":-0.08698012741169348,"a1":-1.9753684159784544,"a2":0.9753983203032601}},{"key":["power-v1","12AU7","EL34","0","6.0","8",384000],"detector":{"real":16.65508969920249,"imaginary":0.7730369926763478},"anchor":{"b0":0.08461292229971855,"b1":-0.08458400429175243,"a1":-1.97803964481769,"a2":0.9780685628256561}},{"key":["power-v1","12AU7","EL34","0","6.0","15",384000],"detector":{"real":22.808574799622622,"imaginary":1.0608399286231112},"anchor":{"b0":0.08537421048459794,"b1":-0.08502281151836537,"a1":-1.9625004272827014,"a2":0.962851826248934}},{"key":["power-v1","12AU7","EL34","0","6.0","16",384000],"detector":{"real":23.556198450065885,"imaginary":1.0953063095285867},"anchor":{"b0":0.08189324361193207,"b1":-0.08175286918440958,"a1":-1.973113854730182,"a2":0.9732542291577045}},{"key":["power-v1","12AU7","EL34","0","6.6","4",352800],"detector":{"real":12.146095030675927,"imaginary":0.574318802313311},"anchor":{"b0":0.09602932901749349,"b1":-0.09598283067940477,"a1":-1.9740153103836782,"a2":0.9740618087217668}},{"key":["power-v1","12AU7","EL34","0","6.6","8",352800],"detector":{"real":17.18010851112263,"imaginary":0.8156436123522884},"anchor":{"b0":0.09719643925603601,"b1":-0.09702994059791625,"a1":-1.9666188564576266,"a2":0.9667853551157464}},{"key":["power-v1","12AU7","EL34","0","6.6","15",352800],"detector":{"real":23.527564687483643,"imaginary":1.1192641989458452},"anchor":{"b0":0.09244942250638824,"b1":-0.09223274937753775,"a1":-1.9652468712552227,"a2":0.9654635443840732}},{"key":["power-v1","12AU7","EL34","0","6.6","16",352800],"detector":{"real":24.298756215904678,"imaginary":1.1556349098345495},"anchor":{"b0":0.09010462835679334,"b1":-0.0900053124270092,"a1":-1.9750630495074937,"a2":0.9751623654372777}},{"key":["power-v1","12AU7","EL34","0","6.6","4",384000],"detector":{"real":12.162374236297799,"imaginary":0.566546433961603},"anchor":{"b0":0.08834932162303752,"b1":-0.08829405218106538,"a1":-1.9773462055250786,"a2":0.9774014749670505}},{"key":["power-v1","12AU7","EL34","0","6.6","8",384000],"detector":{"real":17.20314219555065,"imaginary":0.8046473237057394},"anchor":{"b0":0.0887663484925104,"b1":-0.08865879168144938,"a1":-1.9744575879305875,"a2":0.9745651447416485}},{"key":["power-v1","12AU7","EL34","0","6.6","15",384000],"detector":{"real":23.559113098353034,"imaginary":1.1042013951520946},"anchor":{"b0":0.08412622696629252,"b1":-0.08401767791647068,"a1":-1.9736182360485726,"a2":0.9737267850983944}},{"key":["power-v1","12AU7","EL34","0","6.6","16",384000],"detector":{"real":24.331338117773168,"imaginary":1.1400789770090543},"anchor":{"b0":0.08267501187659256,"b1":-0.08264228153739718,"a1":-1.9693833725442316,"a2":0.9694161028834269}},{"key":["power-v1","12AU7","EL34","0","8.0","4",352800],"detector":{"real":12.914730275422578,"imaginary":0.6173904226924816},"anchor":{"b0":0.08909643582895602,"b1":-0.0882650594308148,"a1":-1.9175084621557617,"a2":0.9183398385539029}},{"key":["power-v1","12AU7","EL34","0","8.0","8",352800],"detector":{"real":18.267306847558547,"imaginary":0.876775109234527},"anchor":{"b0":0.08803297152834624,"b1":-0.08696098041634913,"a1":-1.9220282049906336,"a2":0.9231001961026307}},{"key":["power-v1","12AU7","EL34","0","8.0","15",352800],"detector":{"real":25.01644397644761,"imaginary":1.20312520389001},"anchor":{"b0":0.09440335604824877,"b1":-0.09433178038149156,"a1":-1.9207815168501847,"a2":0.9208530925169419}},{"key":["power-v1","12AU7","EL34","0","8.0","16",352800],"detector":{"real":25.836438452281588,"imaginary":1.2422246666841807},"anchor":{"b0":0.09629608096857836,"b1":-0.09606332239716525,"a1":-1.9273335954530264,"a2":0.9275663540244395}},{"key":["power-v1","12AU7","EL34","0","8.0","4",384000],"detector":{"real":12.931649202568513,"imaginary":0.6093834550169426},"anchor":{"b0":0.09044255814940481,"b1":-0.09012625624712725,"a1":-1.964096311956466,"a2":0.9644126138587438}},{"key":["power-v1","12AU7","EL34","0","8.0","8",384000],"detector":{"real":18.291245904907747,"imaginary":0.865446692257678},"anchor":{"b0":0.08625757318070926,"b1":-0.08619047009502391,"a1":-1.9770033373954792,"a2":0.9770704404811645}},{"key":["power-v1","12AU7","EL34","0","8.0","15",384000],"detector":{"real":25.049232454921366,"imaginary":1.1876073541491734},"anchor":{"b0":0.08206763024736391,"b1":-0.08198069580194392,"a1":-1.9657985582211424,"a2":0.9658854926665623}},{"key":["power-v1","12AU7","EL34","0","8.0","16",384000],"detector":{"real":25.87030107232542,"imaginary":1.2261988006026299},"anchor":{"b0":0.08156886122405081,"b1":-0.08144235946579091,"a1":-1.9758156468678663,"a2":0.9759421486261262}},{"key":["power-v1","12AU7","EL34","20","6.0","4",352800],"detector":{"real":7.6811584452980455,"imaginary":0.3324119113335457},"anchor":{"b0":0.08792147342947307,"b1":-0.08776959368402197,"a1":-1.9677553059683197,"a2":0.9679071857137708}},{"key":["power-v1","12AU7","EL34","20","6.0","8",352800],"detector":{"real":10.86466361188869,"imaginary":0.47226535444389145},"anchor":{"b0":0.09319532095355654,"b1":-0.09311964120253716,"a1":-1.9697276222522988,"a2":0.9698033020033181}},{"key":["power-v1","12AU7","EL34","20","6.0","15",352800],"detector":{"real":14.878787069952322,"imaginary":0.6481853636186572},"anchor":{"b0":0.08818707971213628,"b1":-0.08794178641727006,"a1":-1.9545807389258139,"a2":0.9548260322206802}},{"key":["power-v1","12AU7","EL34","20","6.0","16",352800],"detector":{"real":15.366486325885484,"imaginary":0.6692314001465034},"anchor":{"b0":0.090955807424926,"b1":-0.09085683929770262,"a1":-1.9611459870956198,"a2":0.9612449552228433}},{"key":["power-v1","12AU7","EL34","20","6.0","4",384000],"detector":{"real":7.689089526726917,"imaginary":0.32934518351605196},"anchor":{"b0":0.08850378829720248,"b1":-0.0882851459312488,"a1":-1.9670959776935188,"a2":0.9673146200594726}},{"key":["power-v1","12AU7","EL34","20","6.0","8",384000],"detector":{"real":10.875886005011543,"imaginary":0.46792532944064325},"anchor":{"b0":0.0900191047959714,"b1":-0.08977995378430043,"a1":-1.9689350404384305,"a2":0.9691741914501013}},{"key":["power-v1","12AU7","EL34","20","6.0","15",384000],"detector":{"real":14.894158149684696,"imaginary":0.6422390059389166},"anchor":{"b0":0.08613544107730803,"b1":-0.0860990085283085,"a1":-1.9728184916605334,"a2":0.9728549242095328}},{"key":["power-v1","12AU7","EL34","20","6.0","16",384000],"detector":{"real":15.382360921514575,"imaginary":0.6630906517782067},"anchor":{"b0":0.08501660545059143,"b1":-0.0849749104421254,"a1":-1.974234459724289,"a2":0.9742761547327551}},{"key":["power-v1","12AU7","EL34","20","6.6","4",352800],"detector":{"real":7.737748272332199,"imaginary":0.3366486245734595},"anchor":{"b0":0.09087962986648546,"b1":-0.09072392946423927,"a1":-1.9593256641580603,"a2":0.9594813645603066}},{"key":["power-v1","12AU7","EL34","20","6.6","8",352800],"detector":{"real":10.94470703116212,"imaginary":0.47827336975266993},"anchor":{"b0":0.09613815485836591,"b1":-0.09606206024227419,"a1":-1.9696935806258944,"a2":0.9697696752419862}},{"key":["power-v1","12AU7","EL34","20","6.6","15",352800],"detector":{"real":14.988403369284276,"imaginary":0.6564236603106718},"anchor":{"b0":0.09744022667013483,"b1":-0.09723969928293097,"a1":-1.9712356460401241,"a2":0.9714361734273279}},{"key":["power-v1","12AU7","EL34","20","6.6","16",352800],"detector":{"real":15.479695666256465,"imaginary":0.6777382545955662},"anchor":{"b0":0.09357762270536389,"b1":-0.09349264591948744,"a1":-1.9743789436360308,"a2":0.9744639204219074}},{"key":["power-v1","12AU7","EL34","20","6.6","4",384000],"detector":{"real":7.745563756947305,"imaginary":0.33357215886690605},"anchor":{"b0":0.04544326975879502,"b1":-0.005596098324528933,"a1":-1.552537675754123,"a2":0.592384847188389}},{"key":["power-v1","12AU7","EL34","20","6.6","8",384000],"detector":{"real":10.955765807176679,"imaginary":0.473919487424702},"anchor":{"b0":0.05892346032294556,"b1":-0.006165567137968101,"a1":-1.5248364460671338,"a2":0.5775943392521112}},{"key":["power-v1","12AU7","EL34","20","6.6","15",384000],"detector":{"real":15.003550534708998,"imaginary":0.6504583074357295},"anchor":{"b0":0.03924784848092864,"b1":-0.002345968473044665,"a1":-1.5534413858980625,"a2":0.5903432659059464}},{"key":["power-v1","12AU7","EL34","20","6.6","16",384000],"detector":{"real":15.495339020470267,"imaginary":0.6715779030959053},"anchor":{"b0":0.04544326975879502,"b1":-0.005596098324528933,"a1":-1.552537675754123,"a2":0.592384847188389}},{"key":["power-v1","12AU7","EL34","20","8.0","4",352800],"detector":{"real":7.799823101567919,"imaginary":0.342241724392785},"anchor":{"b0":0.09021481759053895,"b1":-0.09014497571646578,"a1":-1.9729456652504056,"a2":0.9730155071244787}},{"key":["power-v1","12AU7","EL34","20","8.0","8",352800],"detector":{"real":11.032508368580896,"imaginary":0.4862015285616629},"anchor":{"b0":0.0915258128327883,"b1":-0.09142093098662737,"a1":-1.973844716973363,"a2":0.973949598819524}},{"key":["power-v1","12AU7","EL34","20","8.0","15",352800],"detector":{"real":15.108643735389629,"imaginary":0.6672925652151769},"anchor":{"b0":0.10033031880739511,"b1":-0.09998805274864041,"a1":-1.9616908367271755,"a2":0.96203310278593}},{"key":["power-v1","12AU7","EL34","20","8.0","16",352800],"detector":{"real":15.603877386145289,"imaginary":0.6889618038898723},"anchor":{"b0":0.08911706263054063,"b1":-0.08873345812908515,"a1":-1.9600488997197332,"a2":0.9604325042211886}},{"key":["power-v1","12AU7","EL34","20","8.0","4",384000],"detector":{"real":7.8073417981392845,"imaginary":0.33912602277099857},"anchor":{"b0":0.08444184968644755,"b1":-0.06938797538989909,"a1":-1.7546115381966914,"a2":0.7696654124932398}},{"key":["power-v1","12AU7","EL34","20","8.0","8",384000],"detector":{"real":11.04314741777143,"imaginary":0.4817918921511624},"anchor":{"b0":0.08444184968644755,"b1":-0.06938797538989909,"a1":-1.7546115381966914,"a2":0.7696654124932398}},{"key":["power-v1","12AU7","EL34","20","8.0","15",384000],"detector":{"real":15.12321613018215,"imaginary":0.6612509976513763},"anchor":{"b0":0.08444184968644755,"b1":-0.06938797538989909,"a1":-1.7546115381966914,"a2":0.7696654124932398}},{"key":["power-v1","12AU7","EL34","20","8.0","16",384000],"detector":{"real":15.618927080443202,"imaginary":0.6827226707613685},"anchor":{"b0":0.08444184968644755,"b1":-0.06938797538989909,"a1":-1.7546115381966914,"a2":0.7696654124932398}},{"key":["power-v1","12AU7","EL34","43","6.0","4",352800],"detector":{"real":5.682630618038299,"imaginary":0.2360737040364926},"anchor":{"b0":0.09379674811388967,"b1":-0.09373142233154869,"a1":-1.9768995019433993,"a2":0.9769648277257403}},{"key":["power-v1","12AU7","EL34","43","6.0","8",352800],"detector":{"real":8.037835864365992,"imaginary":0.33545702109829717},"anchor":{"b0":0.09176107857169535,"b1":-0.09168271270495154,"a1":-1.9673487278961332,"a2":0.967427093762877}},{"key":["power-v1","12AU7","EL34","43","6.0","15",352800],"detector":{"real":11.007544421062404,"imaginary":0.4604578902164946},"anchor":{"b0":0.08950200880250167,"b1":-0.08939413823640414,"a1":-1.9636731607327382,"a2":0.9637810312988359}},{"key":["power-v1","12AU7","EL34","43","6.0","16",352800],"detector":{"real":11.368351155826645,"imaginary":0.47540266777940754},"anchor":{"b0":0.09053147949442994,"b1":-0.09040467291807791,"a1":-1.9718377619883034,"a2":0.9719645685646554}},{"key":["power-v1","12AU7","EL34","43","6.0","4",384000],"detector":{"real":5.687598053193817,"imaginary":0.2345366530879559},"anchor":{"b0":0.0827103186238874,"b1":-0.08266853812834611,"a1":-1.9719172979489632,"a2":0.9719590784445044}},{"key":["power-v1","12AU7","EL34","43","6.0","8",384000],"detector":{"real":8.044864967910028,"imaginary":0.3332809890995422},"anchor":{"b0":0.08454442334268115,"b1":-0.08450689665789157,"a1":-1.9765013882313807,"a2":0.9765389149161702}},{"key":["power-v1","12AU7","EL34","43","6.0","15",384000],"detector":{"real":11.017172245919857,"imaginary":0.4574755882241793},"anchor":{"b0":0.08477536460640239,"b1":-0.08461679835217942,"a1":-1.9733120242987,"a2":0.9734705905529228}},{"key":["power-v1","12AU7","EL34","43","6.0","16",384000],"detector":{"real":11.378294385259622,"imaginary":0.47232297368380094},"anchor":{"b0":0.0834490009176401,"b1":-0.08341146571165378,"a1":-1.975402187917811,"a2":0.9754397231237971}},{"key":["power-v1","12AU7","EL34","43","6.6","4",352800],"detector":{"real":5.639161761039086,"imaginary":0.23543823733403016},"anchor":{"b0":0.08844206004641382,"b1":-0.0883172753658198,"a1":-1.9611228476993836,"a2":0.9612476323799775}},{"key":["power-v1","12AU7","EL34","43","6.6","8",352800],"detector":{"real":7.976350760161727,"imaginary":0.33454647693138767},"anchor":{"b0":0.08822275868581622,"b1":-0.08815841132440899,"a1":-1.9752356679214547,"a2":0.975300015282862}},{"key":["power-v1","12AU7","EL34","43","6.6","15",352800],"detector":{"real":10.923342432890585,"imaginary":0.4592026960346285},"anchor":{"b0":0.09178863845605204,"b1":-0.09173199946243041,"a1":-1.9747360769757805,"a2":0.9747927159694022}},{"key":["power-v1","12AU7","EL34","43","6.6","16",352800],"detector":{"real":11.281389241018811,"imaginary":0.4741075005437774},"anchor":{"b0":0.08951478573753528,"b1":-0.08925748758128314,"a1":-1.9678049629626,"a2":0.9680622611188521}},{"key":["power-v1","12AU7","EL34","43","6.6","4",384000],"detector":{"real":5.643965885216134,"imaginary":0.2338857099424758},"anchor":{"b0":0.09086874877289089,"b1":-0.09074017316718741,"a1":-1.9696280103336468,"a2":0.9697565859393502}},{"key":["power-v1","12AU7","EL34","43","6.6","8",384000],"detector":{"real":7.983148772506679,"imaginary":0.3323485333065318},"anchor":{"b0":0.08358441803657439,"b1":-0.08345595509708649,"a1":-1.972547040928716,"a2":0.9726755038682038}},{"key":["power-v1","12AU7","EL34","43","6.6","15",384000],"detector":{"real":10.932653807183216,"imaginary":0.45619051293244584},"anchor":{"b0":0.08582209270593899,"b1":-0.0857561869405837,"a1":-1.975652686467287,"a2":0.9757185922326422}},{"key":["power-v1","12AU7","EL34","43","6.6","16",384000],"detector":{"real":11.291005618802712,"imaginary":0.47099693993460595},"anchor":{"b0":0.08388431847308762,"b1":-0.08372840279586496,"a1":-1.97206810800275,"a2":0.9722240236799726}},{"key":["power-v1","12AU7","EL34","43","8.0","4",352800],"detector":{"real":5.515931818625982,"imaginary":0.23235914320012743},"anchor":{"b0":0.09967975432610796,"b1":-0.09959222079755231,"a1":-1.973843100202751,"a2":0.9739306337313066}},{"key":["power-v1","12AU7","EL34","43","8.0","8",352800],"detector":{"real":7.802046735048591,"imaginary":0.33015772955354883},"anchor":{"b0":0.09023006710536433,"b1":-0.09016223849275419,"a1":-1.9708820587806497,"a2":0.9709498873932599}},{"key":["power-v1","12AU7","EL34","43","8.0","15",352800],"detector":{"real":10.684638583071353,"imaginary":0.4531694243878559},"anchor":{"b0":0.09063302322485414,"b1":-0.09057218230130648,"a1":-1.9607778234164737,"a2":0.9608386643400213}},{"key":["power-v1","12AU7","EL34","43","8.0","16",352800],"detector":{"real":11.034861208358818,"imaginary":0.4678797097487078},"anchor":{"b0":0.09993260537468823,"b1":-0.09965256547508942,"a1":-1.957797564124607,"a2":0.9580776040242058}},{"key":["power-v1","12AU7","EL34","43","8.0","4",384000],"detector":{"real":5.520391564552622,"imaginary":0.23075047633258977},"anchor":{"b0":0.0848420812917642,"b1":-0.0847569867296198,"a1":-1.971385796361102,"a2":0.9714708909232463}},{"key":["power-v1","12AU7","EL34","43","8.0","8",384000],"detector":{"real":7.80835768638525,"imaginary":0.3278804516407719},"anchor":{"b0":0.08276278304586619,"b1":-0.08264230321199204,"a1":-1.9778624893313301,"a2":0.9779829691652042}},{"key":["power-v1","12AU7","EL34","43","8.0","15",384000],"detector":{"real":10.693282805820816,"imaginary":0.4500486509746867},"anchor":{"b0":0.08311925878836839,"b1":-0.08291238549330823,"a1":-1.9646957868028974,"a2":0.9649026600979574}},{"key":["power-v1","12AU7","EL34","43","8.0","16",384000],"detector":{"real":11.043788563141105,"imaginary":0.46465700227093537},"anchor":{"b0":0.08427193983793174,"b1":-0.08377241574102533,"a1":-1.9471511969237065,"a2":0.9476507210206131}},{"key":["power-v1","12AU7","6L6GC","0","6.0","4",352800],"detector":{"real":6.028486524330916,"imaginary":0.2684215256136342},"anchor":{"b0":0.09281560284604706,"b1":-0.08690928344994102,"a1":-1.8454217561353734,"a2":0.8513280755314795}},{"key":["power-v1","12AU7","6L6GC","0","6.0","8",352800],"detector":{"real":8.52702931607483,"imaginary":0.3813056990420209},"anchor":{"b0":0.09335691174101225,"b1":-0.09296262819476483,"a1":-1.861258173404733,"a2":0.8616524569509805}},{"key":["power-v1","12AU7","6L6GC","0","6.0","15",352800],"detector":{"real":11.677474960107833,"imaginary":0.5233106988753058},"anchor":{"b0":0.09109343811265473,"b1":-0.08916701449537263,"a1":-1.8787997543731487,"a2":0.8807261779904308}},{"key":["power-v1","12AU7","6L6GC","0","6.0","16",352800],"detector":{"real":12.060241307424029,"imaginary":0.54030667841393},"anchor":{"b0":0.09066457433086841,"b1":-0.09013678839222734,"a1":-1.8648439451537546,"a2":0.8653717310923957}},{"key":["power-v1","12AU7","6L6GC","0","6.0","4",384000],"detector":{"real":6.034321346819924,"imaginary":0.2663606366960141},"anchor":{"b0":0.058188894593956195,"b1":-0.004216843879727207,"a1":-1.4064861590525268,"a2":0.46045820976675583}},{"key":["power-v1","12AU7","6L6GC","0","6.0","8",384000],"detector":{"real":8.535285504250718,"imaginary":0.3783886315521238},"anchor":{"b0":0.05192397850531442,"b1":-0.0034919684618315875,"a1":-1.3813135353234913,"a2":0.42974554536697424}},{"key":["power-v1","12AU7","6L6GC","0","6.0","15",384000],"detector":{"real":11.688783428435531,"imaginary":0.5193136249545751},"anchor":{"b0":0.07350738672324603,"b1":-0.014451147905556346,"a1":-1.4038616530669823,"a2":0.462917891884672}},{"key":["power-v1","12AU7","6L6GC","0","6.0","16",384000],"detector":{"real":12.071920189320215,"imaginary":0.5361789650182857},"anchor":{"b0":0.05354884126085163,"b1":-0.00669159299332776,"a1":-1.4412887076814065,"a2":0.48814595594893023}},{"key":["power-v1","12AU7","6L6GC","0","6.6","4",352800],"detector":{"real":6.276300059479519,"imaginary":0.28086804610871513},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AU7","6L6GC","0","6.6","8",352800],"detector":{"real":8.877550130601907,"imaginary":0.3989778823249834},"anchor":{"b0":0.044294239180563244,"b1":-0.00981879570332603,"a1":-1.6285984387558052,"a2":0.6630738822330423}},{"key":["power-v1","12AU7","6L6GC","0","6.6","15",352800],"detector":{"real":12.157501039957614,"imaginary":0.5475585109511891},"anchor":{"b0":0.08988028912065803,"b1":-0.08008249873127657,"a1":-1.791395955629942,"a2":0.8011937460193232}},{"key":["power-v1","12AU7","6L6GC","0","6.6","16",352800],"detector":{"real":12.556001819518107,"imaginary":0.5653428280126246},"anchor":{"b0":0.04124610700238894,"b1":-0.004220455310607872,"a1":-1.6151589850767927,"a2":0.6521846367685737}},{"key":["power-v1","12AU7","6L6GC","0","6.6","4",384000],"detector":{"real":6.282348592892703,"imaginary":0.2787218860753873},"anchor":{"b0":0.08680994220743618,"b1":-0.08668351897129373,"a1":-1.871243449180748,"a2":0.8713698724168903}},{"key":["power-v1","12AU7","6L6GC","0","6.6","8",384000],"detector":{"real":8.88610888428642,"imaginary":0.3959402699528959},"anchor":{"b0":0.08202667469376441,"b1":-0.07918806773385453,"a1":-1.889438685785524,"a2":0.8922772927454341}},{"key":["power-v1","12AU7","6L6GC","0","6.6","15",384000],"detector":{"real":12.169223847787428,"imaginary":0.5433961853163944},"anchor":{"b0":0.08433241452948331,"b1":-0.08196019721837434,"a1":-1.896923973448327,"a2":0.899296190759436}},{"key":["power-v1","12AU7","6L6GC","0","6.6","16",384000],"detector":{"real":12.568108616122192,"imaginary":0.5610444761557951},"anchor":{"b0":0.08962668458479481,"b1":-0.08720768832939639,"a1":-1.9015843058702635,"a2":0.9040033021256619}},{"key":["power-v1","12AU7","6L6GC","0","8.0","4",352800],"detector":{"real":6.789870218720153,"imaginary":0.30642854533602054},"anchor":{"b0":0.09032900847760192,"b1":-0.09021568775436585,"a1":-1.976250382187096,"a2":0.976363702910332}},{"key":["power-v1","12AU7","6L6GC","0","8.0","8",352800],"detector":{"real":9.603971952678066,"imaginary":0.4352713951875174},"anchor":{"b0":0.09079128993947214,"b1":-0.09039853145636541,"a1":-1.960179414381162,"a2":0.9605721728642687}},{"key":["power-v1","12AU7","6L6GC","0","8.0","15",352800],"detector":{"real":13.152310337970896,"imaginary":0.5973571048303746},"anchor":{"b0":0.09097899973286808,"b1":-0.0908817448880829,"a1":-1.9747353219614867,"a2":0.974832576806272}},{"key":["power-v1","12AU7","6L6GC","0","8.0","16",352800],"detector":{"real":13.583419197274685,"imaginary":0.6167603638749968},"anchor":{"b0":0.09384149524193604,"b1":-0.09363902090920284,"a1":-1.9715364651855112,"a2":0.9717389395182444}},{"key":["power-v1","12AU7","6L6GC","0","8.0","4",384000],"detector":{"real":6.796349497986006,"imaginary":0.3041067237996012},"anchor":{"b0":0.08161851581547827,"b1":-0.08142123095651313,"a1":-1.9695652729132445,"a2":0.9697625577722095}},{"key":["power-v1","12AU7","6L6GC","0","8.0","8",384000],"detector":{"real":9.61314010752987,"imaginary":0.43198518836908606},"anchor":{"b0":0.08445015511848288,"b1":-0.08439092651966323,"a1":-1.9688092783418762,"a2":0.9688685069406959}},{"key":["power-v1","12AU7","6L6GC","0","8.0","15",384000],"detector":{"real":13.164867955698718,"imaginary":0.5928541601777946},"anchor":{"b0":0.0815640421678942,"b1":-0.08149852889667465,"a1":-1.9796242368203696,"a2":0.9796897500915891}},{"key":["power-v1","12AU7","6L6GC","0","8.0","16",384000],"detector":{"real":13.596388157218726,"imaginary":0.6121102125836382},"anchor":{"b0":0.084533967606097,"b1":-0.08449268000941762,"a1":-1.9752107588840082,"a2":0.9752520464806878}},{"key":["power-v1","12AU7","6L6GC","20","6.0","4",352800],"detector":{"real":4.305284346030933,"imaginary":0.18504316812276944},"anchor":{"b0":0.09080307204144779,"b1":-0.0907603806356467,"a1":-1.9754053374191534,"a2":0.9754480288249545}},{"key":["power-v1","12AU7","6L6GC","20","6.0","8",352800],"detector":{"real":6.089637319070561,"imaginary":0.2629030777119034},"anchor":{"b0":0.09088715414278875,"b1":-0.09068896058785464,"a1":-1.9602051032712093,"a2":0.9604032968261434}},{"key":["power-v1","12AU7","6L6GC","20","6.0","15",352800],"detector":{"real":8.339551230880458,"imaginary":0.3608405630390815},"anchor":{"b0":0.09081237764875608,"b1":-0.0907599699923956,"a1":-1.9681520120685794,"a2":0.96820441972494}},{"key":["power-v1","12AU7","6L6GC","20","6.0","16",352800],"detector":{"real":8.612906324417866,"imaginary":0.37255599764448416},"anchor":{"b0":0.09674430268365704,"b1":-0.0966380595388181,"a1":-1.968759233084627,"a2":0.9688654762294662}},{"key":["power-v1","12AU7","6L6GC","20","6.0","4",384000],"detector":{"real":4.308805427862539,"imaginary":0.18381645744817066},"anchor":{"b0":0.08406157812447512,"b1":-0.08401541554411576,"a1":-1.9785697444122916,"a2":0.9786159069926509}},{"key":["power-v1","12AU7","6L6GC","20","6.0","8",384000],"detector":{"real":6.094619904541046,"imaginary":0.26116651096118265},"anchor":{"b0":0.08163049763203115,"b1":-0.08131954773309766,"a1":-1.9639184756895876,"a2":0.9642294255885211}},{"key":["power-v1","12AU7","6L6GC","20","6.0","15",384000],"detector":{"real":8.346376054306601,"imaginary":0.3584606744263517},"anchor":{"b0":0.08460213487969682,"b1":-0.08450437919644532,"a1":-1.9490611115227998,"a2":0.9491588672060514}},{"key":["power-v1","12AU7","6L6GC","20","6.0","16",384000],"detector":{"real":8.619954629263834,"imaginary":0.37009841523249887},"anchor":{"b0":0.08386054719703369,"b1":-0.0837241723354293,"a1":-1.9652332189977832,"a2":0.9653695938593877}},{"key":["power-v1","12AU7","6L6GC","20","6.6","4",352800],"detector":{"real":4.377703330500924,"imaginary":0.1890574723869511},"anchor":{"b0":0.0935669233551253,"b1":-0.0934202160136111,"a1":-1.9698514380909316,"a2":0.9699981454324458}},{"key":["power-v1","12AU7","6L6GC","20","6.6","8",352800],"detector":{"real":6.192070561810349,"imaginary":0.26860089371854406},"anchor":{"b0":0.09537037263912924,"b1":-0.09519572315622717,"a1":-1.9729972443752866,"a2":0.9731718938581886}},{"key":["power-v1","12AU7","6L6GC","20","6.6","15",352800],"detector":{"real":8.479829964932845,"imaginary":0.36865705736032817},"anchor":{"b0":0.09183875744849805,"b1":-0.0917215371116803,"a1":-1.968894470668606,"a2":0.9690116910054237}},{"key":["power-v1","12AU7","6L6GC","20","6.6","16",352800],"detector":{"real":8.75778315317326,"imaginary":0.3806267873664308},"anchor":{"b0":0.09479035930517263,"b1":-0.09472845534462715,"a1":-1.9700107511554417,"a2":0.9700726551159872}},{"key":["power-v1","12AU7","6L6GC","20","6.6","4",384000],"detector":{"real":4.38123562225986,"imaginary":0.18777283549386278},"anchor":{"b0":0.08877607260672461,"b1":-0.08872735371325688,"a1":-1.9742283051001532,"a2":0.9742770239936209}},{"key":["power-v1","12AU7","6L6GC","20","6.6","8",384000],"detector":{"real":6.197069045997818,"imaginary":0.2667821968519373},"anchor":{"b0":0.08125139600258117,"b1":-0.08106121592511048,"a1":-1.9720122501754374,"a2":0.9722024302529081}},{"key":["power-v1","12AU7","6L6GC","20","6.6","15",384000],"detector":{"real":8.486676520985105,"imaginary":0.36616465770979006},"anchor":{"b0":0.08205313832242052,"b1":-0.08189609517278323,"a1":-1.974656095956647,"a2":0.9748131391062842}},{"key":["power-v1","12AU7","6L6GC","20","6.6","16",384000],"detector":{"real":8.764853976703455,"imaginary":0.378053043848349},"anchor":{"b0":0.08570657305124268,"b1":-0.08565344490615072,"a1":-1.9725567650286546,"a2":0.9726098931737466}},{"key":["power-v1","12AU7","6L6GC","20","8.0","4",352800],"detector":{"real":4.497795302230584,"imaginary":0.19597984565341178},"anchor":{"b0":0.09568678035813236,"b1":-0.09562970663724188,"a1":-1.9661095446343637,"a2":0.9661666183552543}},{"key":["power-v1","12AU7","6L6GC","20","8.0","8",352800],"detector":{"real":6.361935027427012,"imaginary":0.27842485584500987},"anchor":{"b0":0.0923703328470604,"b1":-0.09225474945962192,"a1":-1.96914118948286,"a2":0.9692567728702985}},{"key":["power-v1","12AU7","6L6GC","20","8.0","15",352800],"detector":{"real":8.712453179405372,"imaginary":0.382133046438881},"anchor":{"b0":0.08900431971756369,"b1":-0.08872415652671375,"a1":-1.9664110894869922,"a2":0.9666912526778421}},{"key":["power-v1","12AU7","6L6GC","20","8.0","16",352800],"detector":{"real":8.998031396635623,"imaginary":0.39454136766782594},"anchor":{"b0":0.09449140997118645,"b1":-0.09434018553291006,"a1":-1.9750610078097948,"a2":0.9752122322480713}},{"key":["power-v1","12AU7","6L6GC","20","8.0","4",384000],"detector":{"real":4.50132053588265,"imaginary":0.19456932058900772},"anchor":{"b0":0.08674228778221747,"b1":-0.08660469762955807,"a1":-1.9765309172159913,"a2":0.9766685073686506}},{"key":["power-v1","12AU7","6L6GC","20","8.0","8",384000],"detector":{"real":6.3669235797641175,"imaginary":0.27642799938014145},"anchor":{"b0":0.08338077012067739,"b1":-0.08334461870253591,"a1":-1.9741483182375272,"a2":0.9741844696556687}},{"key":["power-v1","12AU7","6L6GC","20","8.0","15",384000],"detector":{"real":8.719286224516571,"imaginary":0.3793966662654808},"anchor":{"b0":0.08105076924685661,"b1":-0.08088071410284424,"a1":-1.9684297478841486,"a2":0.968599803028161}},{"key":["power-v1","12AU7","6L6GC","20","8.0","16",384000],"detector":{"real":9.0050882239351,"imaginary":0.39171560611226114},"anchor":{"b0":0.08100327051800307,"b1":-0.08082134403168098,"a1":-1.963513812256045,"a2":0.9636957387423669}},{"key":["power-v1","12AU7","6L6GC","43","6.0","4",352800],"detector":{"real":3.311709404148144,"imaginary":0.13947637478997088},"anchor":{"b0":0.09775227675359448,"b1":-0.09746405719084648,"a1":-1.9572239626361791,"a2":0.957512182198927}},{"key":["power-v1","12AU7","6L6GC","43","6.0","8",352800],"detector":{"real":4.684269544673311,"imaginary":0.19818136832286237},"anchor":{"b0":0.09400469812362149,"b1":-0.09383255569455039,"a1":-1.9622026941965143,"a2":0.9623748366255853}},{"key":["power-v1","12AU7","6L6GC","43","6.0","15",352800],"detector":{"real":6.4149484557477,"imaginary":0.27202094329821164},"anchor":{"b0":0.09352901315221657,"b1":-0.09327279154539275,"a1":-1.9664575302834604,"a2":0.9667137518902841}},{"key":["power-v1","12AU7","6L6GC","43","6.0","16",352800],"detector":{"real":6.625218489251633,"imaginary":0.280850947479047},"anchor":{"b0":0.09095002533016926,"b1":-0.09052195572729693,"a1":-1.949939992499539,"a2":0.9503680621024113}},{"key":["power-v1","12AU7","6L6GC","43","6.0","4",384000],"detector":{"real":3.3141302185543116,"imaginary":0.13863384660300235},"anchor":{"b0":0.0811695573878003,"b1":-0.08110392396839351,"a1":-1.9748466357841798,"a2":0.9749122692035866}},{"key":["power-v1","12AU7","6L6GC","43","6.0","8",384000],"detector":{"real":4.68769534009876,"imaginary":0.19698834576669927},"anchor":{"b0":0.08561516415098015,"b1":-0.0855053963619559,"a1":-1.96948418423927,"a2":0.9695939520282943}},{"key":["power-v1","12AU7","6L6GC","43","6.0","15",384000],"detector":{"real":6.419640912461138,"imaginary":0.2703857765183914},"anchor":{"b0":0.08463284826546182,"b1":-0.08453990875905194,"a1":-1.96375569270786,"a2":0.96384863221427}},{"key":["power-v1","12AU7","6L6GC","43","6.0","16",384000],"detector":{"real":6.630064710896529,"imaginary":0.27916240521137525},"anchor":{"b0":0.08151910468807236,"b1":-0.0812719261251379,"a1":-1.9637166274093554,"a2":0.9639638059722897}},{"key":["power-v1","12AU7","6L6GC","43","6.6","4",352800],"detector":{"real":3.316234585534175,"imaginary":0.14039337388940587},"anchor":{"b0":0.09284475604490605,"b1":-0.09269678618392604,"a1":-1.9738135626233513,"a2":0.9739615324843314}},{"key":["power-v1","12AU7","6L6GC","43","6.6","8",352800],"detector":{"real":4.690670043557204,"imaginary":0.1994796777409993},"anchor":{"b0":0.09523131482933175,"b1":-0.09506654441318686,"a1":-1.9712708569534938,"a2":0.9714356273696387}},{"key":["power-v1","12AU7","6L6GC","43","6.6","15",352800],"detector":{"real":6.4237134361339665,"imaginary":0.27379967688341},"anchor":{"b0":0.08882106175004705,"b1":-0.08866813085585248,"a1":-1.974791540529216,"a2":0.9749444714234106}},{"key":["power-v1","12AU7","6L6GC","43","6.6","16",352800],"detector":{"real":6.634270901421459,"imaginary":0.28268790841819463},"anchor":{"b0":0.08868719475548317,"b1":-0.0886208860072336,"a1":-1.976897842739728,"a2":0.9769641514879776}},{"key":["power-v1","12AU7","6L6GC","43","6.6","4",384000],"detector":{"real":3.318618304916548,"imaginary":0.13950322725915962},"anchor":{"b0":0.08758507273571162,"b1":-0.08753148159383499,"a1":-1.9759878220686649,"a2":0.9760414132105415}},{"key":["power-v1","12AU7","6L6GC","43","6.6","8",384000],"detector":{"real":4.694043372222848,"imaginary":0.1982192922610747},"anchor":{"b0":0.08681327633553895,"b1":-0.08670181335333704,"a1":-1.975655829676534,"a2":0.975767292658736}},{"key":["power-v1","12AU7","6L6GC","43","6.6","15",384000],"detector":{"real":6.428334163290678,"imaginary":0.2720723098004471},"anchor":{"b0":0.08155359240080341,"b1":-0.08151026754205805,"a1":-1.975117317945398,"a2":0.9751606428041434}},{"key":["power-v1","12AU7","6L6GC","43","6.6","16",384000],"detector":{"real":6.6390429122026955,"imaginary":0.2809040566490432},"anchor":{"b0":0.08272563136857257,"b1":-0.08258011560633632,"a1":-1.9604088024566488,"a2":0.960554318218885}},{"key":["power-v1","12AU7","6L6GC","43","8.0","4",352800],"detector":{"real":3.301572030270999,"imaginary":0.14121433098362587},"anchor":{"b0":0.09211326374340652,"b1":-0.09197288724126595,"a1":-1.9704757111999411,"a2":0.9706160877020816}},{"key":["power-v1","12AU7","6L6GC","43","8.0","8",352800],"detector":{"real":4.669930023911104,"imaginary":0.20063691772434242},"anchor":{"b0":0.0882557946764189,"b1":-0.08815634711774963,"a1":-1.962666150122816,"a2":0.9627655976814853}},{"key":["power-v1","12AU7","6L6GC","43","8.0","15",352800],"detector":{"real":6.395310597503903,"imaginary":0.2753817625144816},"anchor":{"b0":0.0917537838952632,"b1":-0.09160261297400037,"a1":-1.9748231214160314,"a2":0.9749742923372943}},{"key":["power-v1","12AU7","6L6GC","43","8.0","16",352800],"detector":{"real":6.604937006076453,"imaginary":0.284322155636699},"anchor":{"b0":0.08976906748134267,"b1":-0.08966578410429141,"a1":-1.9708346708059117,"a2":0.9709379541829628}},{"key":["power-v1","12AU7","6L6GC","43","8.0","4",384000],"detector":{"real":3.3038647709726923,"imaginary":0.14022482497403813},"anchor":{"b0":0.08241942286942379,"b1":-0.08214549980233181,"a1":-1.9638199479280396,"a2":0.9640938709951314}},{"key":["power-v1","12AU7","6L6GC","43","8.0","8",384000],"detector":{"real":4.673174737607726,"imaginary":0.19923606226955368},"anchor":{"b0":0.09745743344591515,"b1":-0.09715776717615439,"a1":-1.9652099267529968,"a2":0.9655095930227575}},{"key":["power-v1","12AU7","6L6GC","43","8.0","15",384000],"detector":{"real":6.39975503275154,"imaginary":0.27346200296059664},"anchor":{"b0":0.0830772202754711,"b1":-0.0830400120456348,"a1":-1.9768312119187228,"a2":0.976868420148559}},{"key":["power-v1","12AU7","6L6GC","43","8.0","16",384000],"detector":{"real":6.6095270365378,"imaginary":0.28233974096798337},"anchor":{"b0":0.08201394980527077,"b1":-0.08174892138380728,"a1":-1.9628672257007793,"a2":0.9631322541222428}},{"key":["power-v1","12AU7","KT88","0","6.0","4",352800],"detector":{"real":9.570199431525205,"imaginary":0.504793719792162},"anchor":{"b0":0.09015632010705488,"b1":-0.08955831058542074,"a1":-1.9017174873162057,"a2":0.9023154968378397}},{"key":["power-v1","12AU7","KT88","0","6.0","8",352800],"detector":{"real":13.536605159991929,"imaginary":0.7166052932879668},"anchor":{"b0":0.09195625998258412,"b1":-0.09177701537785322,"a1":-1.9139823194266645,"a2":0.9141615640313953}},{"key":["power-v1","12AU7","KT88","0","6.0","15",352800],"detector":{"real":18.53790317655653,"imaginary":0.9831538954033368},"anchor":{"b0":0.08906483643504495,"b1":-0.08683842163839979,"a1":-1.9043371193090524,"a2":0.9065635341056976}},{"key":["power-v1","12AU7","KT88","0","6.0","16",352800],"detector":{"real":19.145543833972674,"imaginary":1.0151303023993},"anchor":{"b0":0.09410955852546213,"b1":-0.0940686018024598,"a1":-1.9052289389845676,"a2":0.9052698957075699}},{"key":["power-v1","12AU7","KT88","0","6.0","4",384000],"detector":{"real":9.589063064578648,"imaginary":0.49366712093526793},"anchor":{"b0":0.08159736753867503,"b1":-0.08155388545893091,"a1":-1.9712656347818027,"a2":0.9713091168615469}},{"key":["power-v1","12AU7","KT88","0","6.0","8",384000],"detector":{"real":13.563294290670814,"imaginary":0.7008667255555249},"anchor":{"b0":0.08198366699937674,"b1":-0.08194974275312472,"a1":-1.9642535958199752,"a2":0.9642875200662272}},{"key":["power-v1","12AU7","KT88","0","6.0","15",384000],"detector":{"real":18.57445751234231,"imaginary":0.9615987309783328},"anchor":{"b0":0.08198020726341089,"b1":-0.08194283457046443,"a1":-1.9761458223041304,"a2":0.976183194997077}},{"key":["power-v1","12AU7","KT88","0","6.0","16",384000],"detector":{"real":19.183295788879104,"imaginary":0.9928689015529912},"anchor":{"b0":0.08170591434810008,"b1":-0.0814186203784628,"a1":-1.9571683221436005,"a2":0.9574556161132377}},{"key":["power-v1","12AU7","KT88","0","6.6","4",352800],"detector":{"real":9.896433020379128,"imaginary":0.5224125867553921},"anchor":{"b0":0.0920962980618,"b1":-0.09205395794248707,"a1":-1.973257039936021,"a2":0.9732993800553338}},{"key":["power-v1","12AU7","KT88","0","6.6","8",352800],"detector":{"real":13.99804739656546,"imaginary":0.7416149466091754},"anchor":{"b0":0.08816535663358911,"b1":-0.08795012664871354,"a1":-1.9706330444068874,"a2":0.9708482743917629}},{"key":["power-v1","12AU7","KT88","0","6.6","15",352800],"detector":{"real":19.169831944861624,"imaginary":1.0174647576037505},"anchor":{"b0":0.09131373323804633,"b1":-0.09115531042597286,"a1":-1.971099052553686,"a2":0.9712574753657595}},{"key":["power-v1","12AU7","KT88","0","6.6","16",352800],"detector":{"real":19.798186157155435,"imaginary":1.0505572568633024},"anchor":{"b0":0.0890433810492299,"b1":-0.08900013625787466,"a1":-1.9609074632490877,"a2":0.9609507080404429}},{"key":["power-v1","12AU7","KT88","0","6.6","4",384000],"detector":{"real":9.91571847835291,"imaginary":0.5110501865902025},"anchor":{"b0":0.08368917565851137,"b1":-0.0830237673810374,"a1":-1.9297347323633702,"a2":0.9304001406408442}},{"key":["power-v1","12AU7","KT88","0","6.6","8",384000],"detector":{"real":14.025333458251323,"imaginary":0.7255428064031563},"anchor":{"b0":0.09130460558415344,"b1":-0.09125665709807186,"a1":-1.9258597558259685,"a2":0.9259077043120502}},{"key":["power-v1","12AU7","KT88","0","6.6","15",384000],"detector":{"real":19.20720393213249,"imaginary":0.9954525649964255},"anchor":{"b0":0.08449187368551402,"b1":-0.08340609740526533,"a1":-1.926121831898445,"a2":0.9272076081786936}},{"key":["power-v1","12AU7","KT88","0","6.6","16",384000],"detector":{"real":19.83678251092188,"imaginary":1.0278239434822434},"anchor":{"b0":0.08243543023986734,"b1":-0.08238902924894552,"a1":-1.9229436940342999,"a2":0.9229900950252218}},{"key":["power-v1","12AU7","KT88","0","8.0","4",352800],"detector":{"real":10.544925019750258,"imaginary":0.555874983945606},"anchor":{"b0":0.0895517108159352,"b1":-0.0895178600079784,"a1":-1.9397133059978495,"a2":0.9397471568058063}},{"key":["power-v1","12AU7","KT88","0","8.0","8",352800],"detector":{"real":14.915309594105182,"imaginary":0.7891219390876385},"anchor":{"b0":0.09250051444547706,"b1":-0.09237376624892008,"a1":-1.974369523926506,"a2":0.9744962721230631}},{"key":["power-v1","12AU7","KT88","0","8.0","15",352800],"detector":{"real":20.425990233137547,"imaginary":1.0826450690186236},"anchor":{"b0":0.09185700112755713,"b1":-0.09166513969087274,"a1":-1.951990637486762,"a2":0.9521824989234464}},{"key":["power-v1","12AU7","KT88","0","8.0","16",352800],"detector":{"real":21.095519188120566,"imaginary":1.1178571670403268},"anchor":{"b0":0.09586118631828812,"b1":-0.09579699407182592,"a1":-1.969518698345941,"a2":0.9695828905924033}},{"key":["power-v1","12AU7","KT88","0","8.0","4",384000],"detector":{"real":10.564946783772498,"imaginary":0.5441264124373514},"anchor":{"b0":0.08229517044443337,"b1":-0.08197201204293834,"a1":-1.9640040117246658,"a2":0.9643271701261606}},{"key":["power-v1","12AU7","KT88","0","8.0","8",384000],"detector":{"real":14.943637448528348,"imaginary":0.7725034248907591},"anchor":{"b0":0.0826081040738005,"b1":-0.0825391234046153,"a1":-1.973695724807755,"a2":0.9737647054769402}},{"key":["power-v1","12AU7","KT88","0","8.0","15",384000],"detector":{"real":20.464789210116667,"imaginary":1.0598844453021297},"anchor":{"b0":0.08159402590055029,"b1":-0.0814355294922528,"a1":-1.9736886788317483,"a2":0.9738471752400457}},{"key":["power-v1","12AU7","KT88","0","8.0","16",384000],"detector":{"real":21.13558923191012,"imaginary":1.0943508821063208},"anchor":{"b0":0.08584622509691159,"b1":-0.08581705178257008,"a1":-1.9748092415772938,"a2":0.9748384148916353}},{"key":["power-v1","12AU7","KT88","20","6.0","4",352800],"detector":{"real":5.46338131736141,"imaginary":0.2452135670083436},"anchor":{"b0":0.09551879524402226,"b1":-0.09542559299482277,"a1":-1.97401311408915,"a2":0.9741063163383495}},{"key":["power-v1","12AU7","KT88","20","6.0","8",352800],"detector":{"real":7.727712229471214,"imaginary":0.34832570599827856},"anchor":{"b0":0.09006600187612977,"b1":-0.08946833129367911,"a1":-1.9507774570321708,"a2":0.9513751276146214}},{"key":["power-v1","12AU7","KT88","20","6.0","15",352800],"detector":{"real":10.5828372500286,"imaginary":0.478040227211824},"anchor":{"b0":0.09085891653240342,"b1":-0.09075042113372621,"a1":-1.9765142228962929,"a2":0.97662271829497}},{"key":["power-v1","12AU7","KT88","20","6.0","16",352800],"detector":{"real":10.92972338189523,"imaginary":0.49356705001678414},"anchor":{"b0":0.09068008813845212,"b1":-0.09057475786048422,"a1":-1.9705587873752446,"a2":0.9706641176532124}},{"key":["power-v1","12AU7","KT88","20","6.0","4",384000],"detector":{"real":5.470591539053236,"imaginary":0.24111172874974995},"anchor":{"b0":0.08166858361748855,"b1":-0.08163817188560193,"a1":-1.9743361817420073,"a2":0.9743665934738939}},{"key":["power-v1","12AU7","KT88","20","6.0","8",384000],"detector":{"real":7.737914297394946,"imaginary":0.3425225766705102},"anchor":{"b0":0.08187802893495265,"b1":-0.08185036946257183,"a1":-1.9761206420149315,"a2":0.9761483014873124}},{"key":["power-v1","12AU7","KT88","20","6.0","15",384000],"detector":{"real":10.59681075129644,"imaginary":0.47009139317477916},"anchor":{"b0":0.0848463815459564,"b1":-0.08471883944881181,"a1":-1.9772405211446182,"a2":0.977368063241763}},{"key":["power-v1","12AU7","KT88","20","6.0","16",384000],"detector":{"real":10.944154615041933,"imaginary":0.48535797615854126},"anchor":{"b0":0.08455257604248682,"b1":-0.08448427612253037,"a1":-1.9789114555517482,"a2":0.9789797554717047}},{"key":["power-v1","12AU7","KT88","20","6.6","4",352800],"detector":{"real":5.456724069388138,"imaginary":0.24425709698718306},"anchor":{"b0":0.09096966985421033,"b1":-0.09090885410404907,"a1":-1.9774256253264402,"a2":0.9774864410766014}},{"key":["power-v1","12AU7","KT88","20","6.6","8",352800],"detector":{"real":7.718296008617568,"imaginary":0.34697099956324007},"anchor":{"b0":0.08969331437675256,"b1":-0.08958585297323708,"a1":-1.9601954876780774,"a2":0.9603029490815929}},{"key":["power-v1","12AU7","KT88","20","6.6","15",352800],"detector":{"real":10.569942124098109,"imaginary":0.4761837900636064},"anchor":{"b0":0.08925817266269558,"b1":-0.08920489904241187,"a1":-1.974723695349975,"a2":0.9747769689702586}},{"key":["power-v1","12AU7","KT88","20","6.6","16",352800],"detector":{"real":10.916405615345585,"imaginary":0.4916499277846225},"anchor":{"b0":0.08889277051871304,"b1":-0.08871558609445623,"a1":-1.9733776066087896,"a2":0.9735547910330463}},{"key":["power-v1","12AU7","KT88","20","6.6","4",384000],"detector":{"real":5.463701267256273,"imaginary":0.2402092761795796},"anchor":{"b0":0.08130423319167308,"b1":-0.0811526754722607,"a1":-1.9570265175625559,"a2":0.9571780752819682}},{"key":["power-v1","12AU7","KT88","20","6.6","8",384000],"detector":{"real":7.728168445280303,"imaginary":0.34124430131951816},"anchor":{"b0":0.08389119371007253,"b1":-0.0834445486364245,"a1":-1.9577178665745074,"a2":0.9581645116481553}},{"key":["power-v1","12AU7","KT88","20","6.6","15",384000],"detector":{"real":10.583464201193035,"imaginary":0.46833948865904096},"anchor":{"b0":0.08149411190255265,"b1":-0.08134612036587603,"a1":-1.9725750765408407,"a2":0.9727230680775174}},{"key":["power-v1","12AU7","KT88","20","6.6","16",384000],"detector":{"real":10.930370600353708,"imaginary":0.4835488013066584},"anchor":{"b0":0.10070285658227837,"b1":-0.10048841770137795,"a1":-1.9706183705162161,"a2":0.9708328093971166}},{"key":["power-v1","12AU7","KT88","20","8.0","4",352800],"detector":{"real":5.404571161560623,"imaginary":0.24053868344207402},"anchor":{"b0":0.10141716951298597,"b1":-0.10126540962352892,"a1":-1.973026907092635,"a2":0.973178666982092}},{"key":["power-v1","12AU7","KT88","20","8.0","8",352800],"detector":{"real":7.64452839854338,"imaginary":0.34169736232126896},"anchor":{"b0":0.09270059302466686,"b1":-0.09264419573549382,"a1":-1.9748745704172201,"a2":0.9749309677063932}},{"key":["power-v1","12AU7","KT88","20","8.0","15",352800],"detector":{"real":10.468920154761163,"imaginary":0.4689519240397648},"anchor":{"b0":0.09154173468848542,"b1":-0.09141588701072545,"a1":-1.976586152516615,"a2":0.976712000194375}},{"key":["power-v1","12AU7","KT88","20","8.0","16",352800],"detector":{"real":10.812072268059794,"imaginary":0.48418239084021863},"anchor":{"b0":0.09358905772239588,"b1":-0.09344492317083117,"a1":-1.9757630683761576,"a2":0.9759072029277223}},{"key":["power-v1","12AU7","KT88","20","8.0","4",384000],"detector":{"real":5.411038891978564,"imaginary":0.236609081722109},"anchor":{"b0":0.08338952401416515,"b1":-0.08327394516226357,"a1":-1.9784929625166479,"a2":0.9786085413685495}},{"key":["power-v1","12AU7","KT88","20","8.0","8",384000],"detector":{"real":7.653680167508261,"imaginary":0.3361376575488765},"anchor":{"b0":0.0823493847692755,"b1":-0.0822388044541862,"a1":-1.977109559832893,"a2":0.9772201401479822}},{"key":["power-v1","12AU7","KT88","20","8.0","15",384000],"detector":{"real":10.481455286406385,"imaginary":0.4613363559674112},"anchor":{"b0":0.08682797072234205,"b1":-0.08662328374162587,"a1":-1.9704771653725146,"a2":0.9706818523532309}},{"key":["power-v1","12AU7","KT88","20","8.0","16",384000],"detector":{"real":10.825017973212503,"imaginary":0.47631749510921473},"anchor":{"b0":0.08887425288749418,"b1":-0.08872847984086848,"a1":-1.9717696419165334,"a2":0.971915414963159}},{"key":["power-v1","12AU7","KT88","43","6.0","4",352800],"detector":{"real":3.6623258154517337,"imaginary":0.15164040391096711},"anchor":{"b0":0.09075705153867601,"b1":-0.09048018572464764,"a1":-1.9566133264452708,"a2":0.9568901922592993}},{"key":["power-v1","12AU7","KT88","43","6.0","8",352800],"detector":{"real":5.180202008852783,"imaginary":0.21548191890097296},"anchor":{"b0":0.09263694984915676,"b1":-0.09259221886048453,"a1":-1.9749983767297894,"a2":0.9750431077184615}},{"key":["power-v1","12AU7","KT88","43","6.0","15",352800],"detector":{"real":7.094111562501628,"imaginary":0.29577882521653726},"anchor":{"b0":0.09354778545566746,"b1":-0.09340265814065261,"a1":-1.9662938623610633,"a2":0.9664389896760782}},{"key":["power-v1","12AU7","KT88","43","6.0","16",352800],"detector":{"real":7.326643314292019,"imaginary":0.3053784333637202},"anchor":{"b0":0.09099664064215614,"b1":-0.09094739592823163,"a1":-1.9700495395425648,"a2":0.9700987842564893}},{"key":["power-v1","12AU7","KT88","43","6.0","4",384000],"detector":{"real":3.6661115515937546,"imaginary":0.14959970536526376},"anchor":{"b0":0.08325866527368558,"b1":-0.08306436080322661,"a1":-1.9708469579086432,"a2":0.9710412623791022}},{"key":["power-v1","12AU7","KT88","43","6.0","8",384000],"detector":{"real":5.185558914757085,"imaginary":0.21259436714717647},"anchor":{"b0":0.08113097033980869,"b1":-0.08082945054242313,"a1":-1.9649879615181904,"a2":0.965289481315576}},{"key":["power-v1","12AU7","KT88","43","6.0","15",384000],"detector":{"real":7.101448966795701,"imaginary":0.29182309256068556},"anchor":{"b0":0.08686796898090851,"b1":-0.08670006796514042,"a1":-1.9733608537655982,"a2":0.9735287547813664}},{"key":["power-v1","12AU7","KT88","43","6.0","16",384000],"detector":{"real":7.3342210329014526,"imaginary":0.301293261794435},"anchor":{"b0":0.08130439289150801,"b1":-0.08097261204457028,"a1":-1.9608363375237583,"a2":0.9611681183706962}},{"key":["power-v1","12AU7","KT88","43","6.6","4",352800],"detector":{"real":3.603509853217248,"imaginary":0.1490750371754454},"anchor":{"b0":0.09628156689362077,"b1":-0.09621696990661963,"a1":-1.9726834500470525,"a2":0.9727480470340536}},{"key":["power-v1","12AU7","KT88","43","6.6","8",352800],"detector":{"real":5.097009436827065,"imaginary":0.21183734683945857},"anchor":{"b0":0.08856133732773447,"b1":-0.08848335279984869,"a1":-1.9767420484172495,"a2":0.9768200329451353}},{"key":["power-v1","12AU7","KT88","43","6.6","15",352800],"detector":{"real":6.980182157415694,"imaginary":0.29077673563635464},"anchor":{"b0":0.0932386926846513,"b1":-0.09300375140213919,"a1":-1.9653261622506344,"a2":0.9655611035331464}},{"key":["power-v1","12AU7","KT88","43","6.6","16",352800],"detector":{"real":7.208979514634561,"imaginary":0.3002139108546618},"anchor":{"b0":0.09321645248557361,"b1":-0.09309504480114354,"a1":-1.974044842830177,"a2":0.9741662505146069}},{"key":["power-v1","12AU7","KT88","43","6.6","4",384000],"detector":{"real":3.607107493538178,"imaginary":0.14706582874527788},"anchor":{"b0":0.08959911212977115,"b1":-0.0894347021866283,"a1":-1.9736775465613823,"a2":0.9738419565045251}},{"key":["power-v1","12AU7","KT88","43","6.6","8",384000],"detector":{"real":5.102100235628694,"imaginary":0.208994308202337},"anchor":{"b0":0.0848365889264249,"b1":-0.08479084726577511,"a1":-1.9766016536046562,"a2":0.9766473952653059}},{"key":["power-v1","12AU7","KT88","43","6.6","15",384000],"detector":{"real":6.987155142591225,"imaginary":0.28688195773285996},"anchor":{"b0":0.08987299129955667,"b1":-0.08982293610648903,"a1":-1.964356818607146,"a2":0.9644068738002137}},{"key":["power-v1","12AU7","KT88","43","6.6","16",384000],"detector":{"real":7.216180896502882,"imaginary":0.29619169234975895},"anchor":{"b0":0.0812821438890869,"b1":-0.08121070277488553,"a1":-1.9717990454670877,"a2":0.9718704865812893}},{"key":["power-v1","12AU7","KT88","43","8.0","4",352800],"detector":{"real":3.4663976664250242,"imaginary":0.1432693370395497},"anchor":{"b0":0.09444124982715664,"b1":-0.09433023910319781,"a1":-1.9722773164026997,"a2":0.9723883271266583}},{"key":["power-v1","12AU7","KT88","43","8.0","8",352800],"detector":{"real":4.903070169576009,"imaginary":0.2035882887985232},"anchor":{"b0":0.0896515537042831,"b1":-0.08955077554588113,"a1":-1.9734818403266745,"a2":0.9735826184850764}},{"key":["power-v1","12AU7","KT88","43","8.0","15",352800],"detector":{"real":6.714588944663223,"imaginary":0.2794543424374348},"anchor":{"b0":0.09426796982778048,"b1":-0.09392986659062777,"a1":-1.9566934412182835,"a2":0.9570315444554361}},{"key":["power-v1","12AU7","KT88","43","8.0","16",352800],"detector":{"real":6.93468061496647,"imaginary":0.2885239675759455},"anchor":{"b0":0.09142576296635223,"b1":-0.09136590099378566,"a1":-1.9752980517323606,"a2":0.9753579137049272}},{"key":["power-v1","12AU7","KT88","43","8.0","4",384000],"detector":{"real":3.4696250006975626,"imaginary":0.14132058783796153},"anchor":{"b0":0.08402704072404642,"b1":-0.08391490591097349,"a1":-1.9776780483896264,"a2":0.9777901832026993}},{"key":["power-v1","12AU7","KT88","43","8.0","8",384000],"detector":{"real":4.907637062949203,"imaginary":0.20083072194571994},"anchor":{"b0":0.0830976148293884,"b1":-0.08306755012949027,"a1":-1.9754338949485646,"a2":0.9754639596484628}},{"key":["power-v1","12AU7","KT88","43","8.0","15",384000],"detector":{"real":6.720844403935795,"imaginary":0.2756765699820548},"anchor":{"b0":0.08513910526020135,"b1":-0.08510957641481702,"a1":-1.9736511722737053,"a2":0.9736807011190897}},{"key":["power-v1","12AU7","KT88","43","8.0","16",384000],"detector":{"real":6.941140979276828,"imaginary":0.2846225964777403},"anchor":{"b0":0.08248452152940954,"b1":-0.08243197615141652,"a1":-1.9791838546202376,"a2":0.9792363999982305}}],"seA0":[{"key":["single-ended-v1","12AX7","300B","2.5","4",352800],"detector":{"real":24.96157080214843,"imaginary":0.14571310878047358},"a0":24.96199609848418},{"key":["single-ended-v1","12AX7","300B","2.5","8",352800],"detector":{"real":35.307306293775575,"imaginary":0.21286375400513555},"a0":35.307947953686764},{"key":["single-ended-v1","12AX7","300B","2.5","15",352800],"detector":{"real":48.352328269649426,"imaginary":0.29616231424235545},"a0":48.353235271409886},{"key":["single-ended-v1","12AX7","300B","2.5","16",352800],"detector":{"real":49.937204296731046,"imaginary":0.30522020340604794},"a0":49.93813705321837},{"key":["single-ended-v1","12AX7","300B","2.5","4",384000],"detector":{"real":24.98077454727613,"imaginary":0.1378877430241333},"a0":24.981155097623393},{"key":["single-ended-v1","12AX7","300B","2.5","8",384000],"detector":{"real":35.334481449912346,"imaginary":0.20178555100974183},"a0":35.33505761623711},{"key":["single-ended-v1","12AX7","300B","2.5","15",384000],"detector":{"real":48.389550707849615,"imaginary":0.28098068280026045},"a0":48.39036647775728},{"key":["single-ended-v1","12AX7","300B","2.5","16",384000],"detector":{"real":49.97564589296551,"imaginary":0.28954272369257095},"a0":49.97648464435973},{"key":["single-ended-v1","12AX7","300B","3.5","4",352800],"detector":{"real":22.67830171854805,"imaginary":0.19346085336829358},"a0":22.679126877798566},{"key":["single-ended-v1","12AX7","300B","3.5","8",352800],"detector":{"real":32.07768203889059,"imaginary":0.2797832334181151},"a0":32.07890215774016},{"key":["single-ended-v1","12AX7","300B","3.5","15",352800],"detector":{"real":43.9294405438464,"imaginary":0.38738117023824564},"a0":43.931148524326005},{"key":["single-ended-v1","12AX7","300B","3.5","16",352800],"detector":{"real":45.369346220686744,"imaginary":0.3994885122978869},"a0":45.37110498504528},{"key":["single-ended-v1","12AX7","300B","3.5","4",384000],"detector":{"real":22.694820515460222,"imaginary":0.18627258831570292},"a0":22.695584938619934},{"key":["single-ended-v1","12AX7","300B","3.5","8",384000],"detector":{"real":32.101058311491144,"imaginary":0.26960682316112833},"a0":32.10219046353145},{"key":["single-ended-v1","12AX7","300B","3.5","15",384000],"detector":{"real":43.961460006494285,"imaginary":0.37343537604503096},"a0":43.96304607147552},{"key":["single-ended-v1","12AX7","300B","3.5","16",384000],"detector":{"real":45.402414360904366,"imaginary":0.3850871125948739},"a0":45.4040474174224},{"key":["single-ended-v1","12AX7","300B","5.0","4",352800],"detector":{"real":20.10432525737882,"imaginary":0.21787673575568406},"a0":20.10550582120389},{"key":["single-ended-v1","12AX7","300B","5.0","8",352800],"detector":{"real":28.436867825859082,"imaginary":0.3136219368015697},"a0":28.438597195794003},{"key":["single-ended-v1","12AX7","300B","5.0","15",352800],"detector":{"real":38.94344406123979,"imaginary":0.43324262141734166},"a0":38.94585388099643},{"key":["single-ended-v1","12AX7","300B","5.0","16",352800],"detector":{"real":40.219921502317526,"imaginary":0.44692013024687754},"a0":40.22240449370729},{"key":["single-ended-v1","12AX7","300B","5.0","4",384000],"detector":{"real":20.11826360198293,"imaginary":0.21144926946949816},"a0":20.11937477041547},{"key":["single-ended-v1","12AX7","300B","5.0","8",384000],"detector":{"real":28.4565929835078,"imaginary":0.30452249845547485},"a0":28.458222329953973},{"key":["single-ended-v1","12AX7","300B","5.0","15",384000],"detector":{"real":38.97046267950157,"imaginary":0.4207726676183021},"a0":38.972734200877404},{"key":["single-ended-v1","12AX7","300B","5.0","16",384000],"detector":{"real":40.247824947180035,"imaginary":0.43404275894083155},"a0":40.25016529277161},{"key":["single-ended-v1","12AX7","2A3","2.5","4",352800],"detector":{"real":26.442468413637396,"imaginary":0.32521804810610283},"a0":26.44446827949137},{"key":["single-ended-v1","12AX7","2A3","2.5","8",352800],"detector":{"real":37.40194003745833,"imaginary":0.4671685667063374},"a0":37.404857505882134},{"key":["single-ended-v1","12AX7","2A3","2.5","15",352800],"detector":{"real":51.22083638707264,"imaginary":0.6447013916063223},"a0":51.22489355846046},{"key":["single-ended-v1","12AX7","2A3","2.5","16",352800],"detector":{"real":52.899739763804035,"imaginary":0.6651450700633219},"a0":52.90392126338481},{"key":["single-ended-v1","12AX7","2A3","2.5","4",384000],"detector":{"real":26.46299242066695,"imaginary":0.317282370001668},"a0":26.46489440671529},{"key":["single-ended-v1","12AX7","2A3","2.5","8",384000],"detector":{"real":37.43098360783841,"imaginary":0.455933937620241},"a0":37.43376029209117},{"key":["single-ended-v1","12AX7","2A3","2.5","15",384000],"detector":{"real":51.26061804501096,"imaginary":0.6293051319861404},"a0":51.26448075720311},{"key":["single-ended-v1","12AX7","2A3","2.5","16",384000],"detector":{"real":52.940824458782316,"imaginary":0.6492458638859682},"a0":52.94480535961367},{"key":["single-ended-v1","12AX7","2A3","3.5","4",352800],"detector":{"real":24.159336698074945,"imaginary":0.3446804610290876},"a0":24.16179534536219},{"key":["single-ended-v1","12AX7","2A3","3.5","8",352800],"detector":{"real":34.17251792851419,"imaginary":0.4940795659967847},"a0":34.176089539210885},{"key":["single-ended-v1","12AX7","2A3","3.5","15",352800],"detector":{"real":46.79823061998141,"imaginary":0.6811298331531543},"a0":46.803187145861955},{"key":["single-ended-v1","12AX7","2A3","3.5","16",352800],"detector":{"real":48.33217223026903,"imaginary":0.7028269564029861},"a0":48.33728207323035},{"key":["single-ended-v1","12AX7","2A3","3.5","4",384000],"detector":{"real":24.17709832868801,"imaginary":0.3372768695970227},"a0":24.17945076468475},{"key":["single-ended-v1","12AX7","2A3","3.5","8",384000],"detector":{"real":34.197652947023805,"imaginary":0.4835980529744318},"a0":34.201072120065575},{"key":["single-ended-v1","12AX7","2A3","3.5","15",384000],"detector":{"real":46.83265912451491,"imaginary":0.6667657687950274},"a0":46.83740532163846},{"key":["single-ended-v1","12AX7","2A3","3.5","16",384000],"detector":{"real":48.36772837217018,"imaginary":0.687993661458879},"a0":48.37262121450774},{"key":["single-ended-v1","12AX7","2A3","5.0","4",352800],"detector":{"real":21.52116831632779,"imaginary":0.34371138818204416},"a0":21.52391282313876},{"key":["single-ended-v1","12AX7","2A3","5.0","8",352800],"detector":{"real":30.44091309429071,"imaginary":0.49199465700934053},"a0":30.44488871315981},{"key":["single-ended-v1","12AX7","2A3","5.0","15",352800],"detector":{"real":41.68790373456522,"imaginary":0.6777830848506652},"a0":41.693413241092244},{"key":["single-ended-v1","12AX7","2A3","5.0","16",352800],"detector":{"real":43.05434122601372,"imaginary":0.6994391465506248},"a0":43.06002221929004},{"key":["single-ended-v1","12AX7","2A3","5.0","4",384000],"detector":{"real":21.53623033939563,"imaginary":0.3369985463853176},"a0":21.538866851618973},{"key":["single-ended-v1","12AX7","2A3","5.0","8",384000],"detector":{"real":30.46222838858587,"imaginary":0.48249103820468336},"a0":30.466049235178406},{"key":["single-ended-v1","12AX7","2A3","5.0","15",384000],"detector":{"real":41.7171005662003,"imaginary":0.6647589867487765},"a0":41.72239667326091},{"key":["single-ended-v1","12AX7","2A3","5.0","16",384000],"detector":{"real":43.084494261548826,"imaginary":0.6859895976175933},"a0":43.089955064973935},{"key":["single-ended-v1","12AT7","300B","2.5","4",352800],"detector":{"real":18.462652387762287,"imaginary":0.547671749827588},"a0":18.470773604180838},{"key":["single-ended-v1","12AT7","300B","2.5","8",352800],"detector":{"real":26.114684626483303,"imaginary":0.7796621349049719},"a0":26.126320563471776},{"key":["single-ended-v1","12AT7","300B","2.5","15",352800],"detector":{"real":35.763218482090096,"imaginary":1.0711655381325},"a0":35.77925644570878},{"key":["single-ended-v1","12AT7","300B","2.5","16",352800],"detector":{"real":36.93546439474449,"imaginary":1.105795294657272},"a0":36.95201365675658},{"key":["single-ended-v1","12AT7","300B","2.5","4",384000],"detector":{"real":18.48158181432807,"imaginary":0.541097636755992},"a0":18.489501156391565},{"key":["single-ended-v1","12AT7","300B","2.5","8",384000],"detector":{"real":26.141469094077593,"imaginary":0.7703577699073283},"a0":26.15281739106268},{"key":["single-ended-v1","12AT7","300B","2.5","15",384000],"detector":{"real":35.79990455338098,"imaginary":1.0584168256003161},"a0":35.81554707397198},{"key":["single-ended-v1","12AT7","300B","2.5","16",384000],"detector":{"real":36.97335226885725,"imaginary":1.0926298670122903},"a0":36.989493346399044},{"key":["single-ended-v1","12AT7","300B","3.5","4",352800],"detector":{"real":16.772611663952354,"imaginary":0.5428897995005062},"a0":16.781395393832785},{"key":["single-ended-v1","12AT7","300B","3.5","8",352800],"detector":{"real":23.724177206675698,"imaginary":0.7724407447898252},"a0":23.736748910454487},{"key":["single-ended-v1","12AT7","300B","3.5","15",352800],"detector":{"real":32.489487215947484,"imaginary":1.0609611358027906},"a0":32.50680571952432},{"key":["single-ended-v1","12AT7","300B","3.5","16",352800],"detector":{"real":33.55442803868011,"imaginary":1.095300424657435},"a0":33.57229995134704},{"key":["single-ended-v1","12AT7","300B","3.5","4",384000],"detector":{"real":16.789135460006,"imaginary":0.5368764621151743},"a0":16.79771728033319},{"key":["single-ended-v1","12AT7","300B","3.5","8",384000],"detector":{"real":23.74755821149002,"imaginary":0.7639298404739534},"a0":23.75984237761845},{"key":["single-ended-v1","12AT7","300B","3.5","15",384000],"detector":{"real":32.52151188543289,"imaginary":1.0492995451143303},"a0":32.538435193624935},{"key":["single-ended-v1","12AT7","300B","3.5","16",384000],"detector":{"real":33.58750168174298,"imaginary":1.083257597057064},"a0":33.60496564858636},{"key":["single-ended-v1","12AT7","300B","5.0","4",352800],"detector":{"real":14.86798573716885,"imaginary":0.5156823032288986},"a0":14.876926030552138},{"key":["single-ended-v1","12AT7","300B","5.0","8",352800],"detector":{"real":21.030151943979654,"imaginary":0.7334410225080299},"a0":21.042937687508577},{"key":["single-ended-v1","12AT7","300B","5.0","15",352800],"detector":{"real":28.800101049178696,"imaginary":1.007197204554777},"a0":28.817707519019738},{"key":["single-ended-v1","12AT7","300B","5.0","16",352800],"detector":{"real":29.74411203309251,"imaginary":1.0398238130942907},"a0":29.7622820731112},{"key":["single-ended-v1","12AT7","300B","5.0","4",384000],"detector":{"real":14.882125251826004,"imaginary":0.5103200741387036},"a0":14.890872324652648},{"key":["single-ended-v1","12AT7","300B","5.0","8",384000],"detector":{"real":21.050159519289835,"imaginary":0.7258515214571449},"a0":21.062670206285578},{"key":["single-ended-v1","12AT7","300B","5.0","15",384000],"detector":{"real":28.827505362304525,"imaginary":0.9967980591804372},"a0":28.84473386572464},{"key":["single-ended-v1","12AT7","300B","5.0","16",384000],"detector":{"real":29.772413989521734,"imaginary":1.029084715052634},"a0":29.790193858285384},{"key":["single-ended-v1","12AT7","2A3","2.5","4",352800],"detector":{"real":19.555007082008096,"imaginary":0.7065283671252501},"a0":19.567766461988946},{"key":["single-ended-v1","12AT7","2A3","2.5","8",352800],"detector":{"real":27.65974249027599,"imaginary":1.0046554491781012},"a0":27.67798199291166},{"key":["single-ended-v1","12AT7","2A3","2.5","15",352800],"detector":{"real":37.87910184548656,"imaginary":1.3794910639150968},"a0":37.90421285577851},{"key":["single-ended-v1","12AT7","2A3","2.5","16",352800],"detector":{"real":39.12070541403067,"imaginary":1.4241985974157814},"a0":39.14662097469269},{"key":["single-ended-v1","12AT7","2A3","2.5","4",384000],"detector":{"real":19.575187391797687,"imaginary":0.6998645357997979},"a0":19.58769439705616},{"key":["single-ended-v1","12AT7","2A3","2.5","8",384000],"detector":{"real":27.68829689995723,"imaginary":0.9952238734266254},"a0":27.706177213365603},{"key":["single-ended-v1","12AT7","2A3","2.5","15",384000],"detector":{"real":37.918212181691196,"imaginary":1.3665678623246322},"a0":37.9428296622444},{"key":["single-ended-v1","12AT7","2A3","2.5","16",384000],"detector":{"real":39.161096928945106,"imaginary":1.4108528980085722},"a0":39.186503015426794},{"key":["single-ended-v1","12AT7","2A3","3.5","4",352800],"detector":{"real":17.865549287489262,"imaginary":0.6808399244375372},"a0":17.878517677548555},{"key":["single-ended-v1","12AT7","2A3","3.5","8",352800],"detector":{"real":25.27006528234042,"imaginary":0.9678626088967678},"a0":25.2885934247725},{"key":["single-ended-v1","12AT7","2A3","3.5","15",352800],"detector":{"real":34.60651140388586,"imaginary":1.3287895206804772},"a0":34.632012836933875},{"key":["single-ended-v1","12AT7","2A3","3.5","16",352800],"detector":{"real":35.74084672675176,"imaginary":1.371879115699067},"a0":35.767166187066785},{"key":["single-ended-v1","12AT7","2A3","3.5","4",384000],"detector":{"real":17.88327236419758,"imaginary":0.6746492331081864},"a0":17.89599346333716},{"key":["single-ended-v1","12AT7","2A3","3.5","8",384000],"detector":{"real":25.29514322372869,"imaginary":0.959100586785246},"a0":25.313319510576232},{"key":["single-ended-v1","12AT7","2A3","3.5","15",384000],"detector":{"real":34.64086034160814,"imaginary":1.3167836490681},"a0":34.6658783876199},{"key":["single-ended-v1","12AT7","2A3","3.5","16",384000],"detector":{"real":35.77632082138826,"imaginary":1.3594808086235683},"a0":35.802141270933994},{"key":["single-ended-v1","12AT7","2A3","5.0","4",352800],"detector":{"real":15.913872092247182,"imaginary":0.633733551232628},"a0":15.926485587924336},{"key":["single-ended-v1","12AT7","2A3","5.0","8",352800],"detector":{"real":22.509492875120834,"imaginary":0.9007038402488595},"a0":22.5275062291181},{"key":["single-ended-v1","12AT7","2A3","5.0","15",352800],"detector":{"real":30.825994540526107,"imaginary":1.236453798333292},"a0":30.850782119874342},{"key":["single-ended-v1","12AT7","2A3","5.0","16",352800],"detector":{"real":31.83641245002362,"imaginary":1.276567661209295},"a0":31.86199589921611},{"key":["single-ended-v1","12AT7","2A3","5.0","4",384000],"detector":{"real":15.929113048502415,"imaginary":0.6281383074173672},"a0":15.941493036890085},{"key":["single-ended-v1","12AT7","2A3","5.0","8",384000],"detector":{"real":22.531058955372206,"imaginary":0.8927844336955015},"a0":22.548740135437882},{"key":["single-ended-v1","12AT7","2A3","5.0","15",384000],"detector":{"real":30.855533534566156,"imaginary":1.2256025207981651},"a0":30.879864819032537},{"key":["single-ended-v1","12AT7","2A3","5.0","16",384000],"detector":{"real":31.86691901648406,"imaginary":1.2653616572463908},"a0":31.89203141423862},{"key":["single-ended-v1","12AU7","300B","2.5","4",352800],"detector":{"real":1.4049887845638074,"imaginary":0.04447694685133755},"a0":1.4056925992375793},{"key":["single-ended-v1","12AU7","300B","2.5","8",352800],"detector":{"real":1.9872997542793256,"imaginary":0.06329157282214144},"a0":1.9883073546484127},{"key":["single-ended-v1","12AU7","300B","2.5","15",352800],"detector":{"real":2.7215424052977917,"imaginary":0.08693783170487755},"a0":2.722930636357752},{"key":["single-ended-v1","12AU7","300B","2.5","16",352800],"detector":{"real":2.810749134265666,"imaginary":0.0897508565768322},"a0":2.8121816996829105},{"key":["single-ended-v1","12AU7","300B","2.5","4",384000],"detector":{"real":1.4059029714294577,"imaginary":0.04465358993259471},"a0":1.4066119252189093},{"key":["single-ended-v1","12AU7","300B","2.5","8",384000],"detector":{"real":1.988593453724175,"imaginary":0.06354087085822943},"a0":1.9896083449925674},{"key":["single-ended-v1","12AU7","300B","2.5","15",384000],"detector":{"real":2.723314379103841,"imaginary":0.08727861211878056},"a0":2.724712602012755},{"key":["single-ended-v1","12AU7","300B","2.5","16",384000],"detector":{"real":2.8125791195083876,"imaginary":0.09010296950314106},"a0":2.8140220057078196},{"key":["single-ended-v1","12AU7","300B","3.5","4",352800],"detector":{"real":1.276366569785494,"imaginary":0.04386079717379244},"a0":1.277119959124713},{"key":["single-ended-v1","12AU7","300B","3.5","8",352800],"detector":{"real":1.8053679227393193,"imaginary":0.06238518303766834},"a0":1.8064454731651125},{"key":["single-ended-v1","12AU7","300B","3.5","15",352800],"detector":{"real":2.4723920477869883,"imaginary":0.08567259224398403},"a0":2.473875953038499},{"key":["single-ended-v1","12AU7","300B","3.5","16",352800],"detector":{"real":2.553432209342413,"imaginary":0.08844752022283017},"a0":2.554963602782013},{"key":["single-ended-v1","12AU7","300B","3.5","4",384000],"detector":{"real":1.2771440199472608,"imaginary":0.04401724824639231},"a0":1.2779023303172405},{"key":["single-ended-v1","12AU7","300B","3.5","8",384000],"detector":{"real":1.8064680930367578,"imaginary":0.06260596108437924},"a0":1.8075526209555168},{"key":["single-ended-v1","12AU7","300B","3.5","15",384000],"detector":{"real":2.4738989243321354,"imaginary":0.08597439102322803},"a0":2.475392389849236},{"key":["single-ended-v1","12AU7","300B","3.5","16",384000],"detector":{"real":2.554988477283033,"imaginary":0.08875927906361118},"a0":2.556529743356991},{"key":["single-ended-v1","12AU7","300B","5.0","4",352800],"detector":{"real":1.1314187369749773,"imaginary":0.041504059664418155},"a0":1.1321797319095057},{"key":["single-ended-v1","12AU7","300B","5.0","8",352800],"detector":{"real":1.6003444902697177,"imaginary":0.05901249209689214},"a0":1.6014321595872016},{"key":["single-ended-v1","12AU7","300B","5.0","15",352800],"detector":{"real":2.191618699655431,"imaginary":0.08102681040463593},"a0":2.193116018062818},{"key":["single-ended-v1","12AU7","300B","5.0","16",352800],"detector":{"real":2.2634557217738465,"imaginary":0.08365320072167486},"a0":2.26500102923194},{"key":["single-ended-v1","12AU7","300B","5.0","4",384000],"detector":{"real":1.1320678162134301,"imaginary":0.041639702334549056},"a0":1.1328333528444308},{"key":["single-ended-v1","12AU7","300B","5.0","8",384000],"detector":{"real":1.601263014819845,"imaginary":0.059203774092648424},"a0":1.6023571167179784},{"key":["single-ended-v1","12AU7","300B","5.0","15",384000],"detector":{"real":2.1928768576567297,"imaginary":0.08128823616694554},"a0":2.194382986214026},{"key":["single-ended-v1","12AU7","300B","5.0","16",384000],"detector":{"real":2.2647551076239933,"imaginary":0.0839232959815005},"a0":2.26630951485391},{"key":["single-ended-v1","12AU7","2A3","2.5","4",352800],"detector":{"real":1.4880977686806873,"imaginary":0.0567314245898305},"a0":1.4891787749254393},{"key":["single-ended-v1","12AU7","2A3","2.5","8",352800],"detector":{"real":2.104851484984836,"imaginary":0.08064763068056019},"a0":2.1063959300609314},{"key":["single-ended-v1","12AU7","2A3","2.5","15",352800],"detector":{"real":2.8825238711643286,"imaginary":0.11072191803661462},"a0":2.8846495820057405},{"key":["single-ended-v1","12AU7","2A3","2.5","16",352800],"detector":{"real":2.9770075113891212,"imaginary":0.11431241269633188},"a0":2.9792014115470113},{"key":["single-ended-v1","12AU7","2A3","2.5","4",384000],"detector":{"real":1.4890712869148404,"imaginary":0.056937786541245886},"a0":1.4901594575918495},{"key":["single-ended-v1","12AU7","2A3","2.5","8",384000],"detector":{"real":2.1062290496414664,"imaginary":0.08093892034300568},"a0":2.107783650752583},{"key":["single-ended-v1","12AU7","2A3","2.5","15",384000],"detector":{"real":2.884410749520507,"imaginary":0.11112025240086491},"a0":2.8865503776035304},{"key":["single-ended-v1","12AU7","2A3","2.5","16",384000],"detector":{"real":2.978956178328939,"imaginary":0.11472387068826756},"a0":2.981164450162026},{"key":["single-ended-v1","12AU7","2A3","3.5","4",352800],"detector":{"real":1.3595225821377155,"imaginary":0.05452455330475371},"a0":1.3606155144843397},{"key":["single-ended-v1","12AU7","2A3","3.5","8",352800],"detector":{"real":1.9229865593763686,"imaginary":0.07749127390252698},"a0":1.924547272756167},{"key":["single-ended-v1","12AU7","2A3","3.5","15",352800],"detector":{"real":2.633465419299307,"imaginary":0.10637544878515362},"a0":2.6356129933564825},{"key":["single-ended-v1","12AU7","2A3","3.5","16",352800],"detector":{"real":2.7197854603817997,"imaginary":0.10982680267991057},"a0":2.722001997995433},{"key":["single-ended-v1","12AU7","2A3","3.5","4",384000],"detector":{"real":1.3603561689877761,"imaginary":0.054704670039757236},"a0":1.361455657532502},{"key":["single-ended-v1","12AU7","2A3","3.5","8",384000],"detector":{"real":1.9241661548225684,"imaginary":0.077745488439183},"a0":1.9257361585475086},{"key":["single-ended-v1","12AU7","2A3","3.5","15",384000],"detector":{"real":2.635081209605457,"imaginary":0.10672297836734147},"a0":2.6372415087222016},{"key":["single-ended-v1","12AU7","2A3","3.5","16",384000],"detector":{"real":2.721454134133553,"imaginary":0.1101858047113784},"a0":2.7236838134689023},{"key":["single-ended-v1","12AU7","2A3","5.0","4",352800],"detector":{"real":1.2109965474219568,"imaginary":0.0506466289838157},"a0":1.2120551633054182},{"key":["single-ended-v1","12AU7","2A3","5.0","8",352800],"detector":{"real":1.712902264329456,"imaginary":0.07196586548330491},"a0":1.7144133844962066},{"key":["single-ended-v1","12AU7","2A3","5.0","15",352800],"detector":{"real":2.3457617029674824,"imaginary":0.09878086532960736},"a0":2.347840630550585},{"key":["single-ended-v1","12AU7","2A3","5.0","16",352800],"detector":{"real":2.422651392794522,"imaginary":0.10198715488180893},"a0":2.4247971360033653},{"key":["single-ended-v1","12AU7","2A3","5.0","4",384000],"detector":{"real":1.2116963765745152,"imaginary":0.05080039292865966},"a0":1.212760812743187},{"key":["single-ended-v1","12AU7","2A3","5.0","8",384000],"detector":{"real":1.7138926395481193,"imaginary":0.07218286782345026},"a0":1.7154120048269563},{"key":["single-ended-v1","12AU7","2A3","5.0","15",384000],"detector":{"real":2.3471182045406143,"imaginary":0.0990775085876886},"a0":2.3492084238725823},{"key":["single-ended-v1","12AU7","2A3","5.0","16",384000],"detector":{"real":2.4240523349257947,"imaginary":0.10229359055880834},"a0":2.426209739723384}],"el34Dc":{"supplyGroundV":443.775,"centerTapGroundV":432.7883205995142,"plateGroundV":430.0002922120234,"screenTapGroundV":430.6259717615592,"screenGroundV":425.62052552904356,"cathodeGroundV":31.75949855746367,"plateCathodeV":398.24079365455975,"screenCathodeV":393.8610269715799,"iaA":0.06256795495357728,"ig2A":0.005005446232515629,"quiescentPlateDissipationW":24.91711203805536,"maximumDcResidualA":0}});
// __TUBE_PHASE_C_REFERENCE_TABLES_INJECT_END__

function tubeSimulatorEffectivePrimaryImpedanceOhm(
    primaryImpedanceOhm,
    assumedSpeakerLoadOhm,
    actualSpeakerLoadOhm
) {
    return primaryImpedanceOhm * actualSpeakerLoadOhm / assumedSpeakerLoadOhm;
}

function deriveTubeSimulatorPrivateCircuit(circuitFields) {
    if (circuitFields.os === 'Line') {
        return Object.freeze({ circuitProfileId: 'line-v2' });
    }
    if (circuitFields.os === 'SingleEnded') {
        const tube = TUBE_SIMULATOR_SE_TUBE_MODELS[circuitFields.sd];
        const speakerRlc = TUBE_SIMULATOR_SPEAKER_PROFILES[circuitFields.sl];
        const primaryImpedanceOhm = Number(circuitFields.sp) * 1000;
        const speakerLoadOhm = Number(circuitFields.sl);
        if (!tube || !speakerRlc || !Number.isFinite(primaryImpedanceOhm)) {
            throw new TypeError('Invalid Tube Simulator single-ended circuit selection.');
        }
        return Object.freeze({
            circuitProfileId:
                `se-triode-v1-${circuitFields.sd.toLowerCase()}-${circuitFields.sp}`,
            outputTubeModel: tube,
            speakerRlc,
            nfbTapNode: 'single-ended-secondary-feedback-winding',
            nfbTapTurnsRatio: tube.nfbTapTurnsRatio,
            nfbPolarity: 1,
            primaryImpedanceOhm,
            speakerLoadOhm,
            selectedSpeakerTurnsRatio: Math.sqrt(primaryImpedanceOhm / speakerLoadOhm)
        });
    }
    if (circuitFields.os !== 'Power') {
        throw new TypeError('Invalid Tube Simulator output circuit.');
    }
    const profile = TUBE_SIMULATOR_PHASE_C_REFERENCE_TABLES.profiles.find(candidate =>
        candidate.key.pt === circuitFields.pt && candidate.key.st === circuitFields.st &&
        candidate.key.zp === circuitFields.zp);
    const speakerRlc = TUBE_SIMULATOR_SPEAKER_PROFILES[circuitFields.sl];
    if (!profile || !speakerRlc) {
        throw new TypeError('Invalid Tube Simulator power circuit selection.');
    }
    const primaryImpedanceOhm = Number(circuitFields.zp) * 1000;
    const speakerLoadOhm = Number(circuitFields.sl);
    return Object.freeze({
        circuitProfileId: profile.circuitProfileId,
        ltpRc: Object.freeze({ ...profile.ltpRc }),
        gridRc: Object.freeze({ ...profile.gridRc }),
        cathodeRc: Object.freeze({ ...profile.cathodeRc }),
        screenSupplyRc: Object.freeze({ ...profile.screenSupplyRc }),
        powerSupplyRc: Object.freeze({ ...profile.powerSupplyRc }),
        outputTubeLutId: profile.outputTubeLutId,
        optCoefficients: Object.freeze({ ...profile.optCoefficients }),
        speakerRlc,
        nfbTapNode: profile.nfbTapNode,
        nfbTapTurnsRatio: profile.nfbTapTurnsRatio,
        nfbPolarity: profile.nfbPolarity,
        screenTapRatio: profile.screenTapTurnsRatio,
        primaryImpedanceOhm,
        speakerLoadOhm,
        selectedSpeakerTurnsRatio: Math.sqrt(primaryImpedanceOhm / speakerLoadOhm)
    });
}
const TUBE_SIMULATOR_TRAJECTORY_FRAMES = 96;
// Operating points are kept on screen for half a second and faded out with a 220 ms time constant,
// the same persistence the Phase Select EQ phase map uses. One telemetry frame contributes a single
// dot per trace, so the six newest frames alone showed too little of the excursion to read the shape
// of the loop; ageing the older ones out instead of dropping them keeps the newest point the
// brightest, so the present operating point still stands out against its own trail.
const TUBE_SIMULATOR_TRAJECTORY_HISTORY_MS = 500;
const TUBE_SIMULATOR_TRAJECTORY_FADE_MS = 220;
// Below this the dot is indistinguishable from the panel background, so it is skipped rather than
// filled: at the 60 Hz telemetry rate the window holds thirty frames per trace and the tail of the
// exponential is pure overdraw.
const TUBE_SIMULATOR_TRAJECTORY_MINIMUM_OPACITY = 0.02;
const TUBE_SIMULATOR_HUD_CURVE_POINTS = 96;
const TUBE_SIMULATOR_HUD_COLORS = Object.freeze({
    background: '#1a1a1a',
    grid: '#333',
    ticks: '#666',
    axes: '#fff',
    characteristics: '#555',
    loadLine: '#888',
    left: '#69c8ff',
    right: '#ffb347'
});
// Operating-point groups the graph can show, in signal-chain order. Only one is on screen at a
// time: the panels within a group share an axis and are worth comparing against each other, while
// the driver and the output valves work at voltages an order of magnitude apart. Push / Pull and
// SE Triode are decided by Output Circuit, so at most two of the three are ever selectable.
const TUBE_SIMULATOR_HUD_VIEWS = Object.freeze([
    Object.freeze({ id: 'driver', label: 'Stage 1 / Stage 2' }),
    Object.freeze({ id: 'pushPull', label: 'Push / Pull' }),
    Object.freeze({ id: 'singleEnded', label: 'SE Triode' })
]);
const TUBE_SIMULATOR_NO_STAGE_MESSAGE = 'No tube stage is active.';
const TUBE_SIMULATOR_TUBE_ROWS = Object.freeze([
    Object.freeze({
        mu: 100, ka: 0.0010637222, alpha: 1.45, v0: -0.5866, sc: 0.15, vs: 25,
        cga: 1.7e-12, cgk: 1.6e-12, cak: 0.46e-12,
        cathodeResistanceScale: 1, plateResistanceScale: 1
    }),
    Object.freeze({
        mu: 60, ka: 0.0027035449, alpha: 1.4, v0: -0.3788, sc: 0.15, vs: 22,
        cga: 1.5e-12, cgk: 2.2e-12, cak: 0.5e-12,
        cathodeResistanceScale: 0.5, plateResistanceScale: 0.47
    }),
    Object.freeze({
        mu: 17, ka: 0.00097874385, alpha: 1.3, v0: 0.0014, sc: 0.5, vs: 18,
        cga: 1.5e-12, cgk: 1.6e-12, cak: 0.5e-12,
        cathodeResistanceScale: 0.4, plateResistanceScale: 0.22
    })
]);
const TUBE_SIMULATOR_HUD_PROFILES = Object.freeze({
    '12AX7': Object.freeze({
        ...TUBE_SIMULATOR_TUBE_ROWS[0],
        iaMax: 0.006,
        plateResistance: 100000,
        vgkSteps: Object.freeze([-4, -3, -2, -1, 0])
    }),
    '12AT7': Object.freeze({
        ...TUBE_SIMULATOR_TUBE_ROWS[1],
        iaMax: 0.012,
        plateResistance: 47000,
        vgkSteps: Object.freeze([-6, -4.5, -3, -1.5, 0])
    }),
    '12AU7': Object.freeze({
        ...TUBE_SIMULATOR_TUBE_ROWS[2],
        iaMax: 0.032,
        plateResistance: 22000,
        vgkSteps: Object.freeze([-12, -9, -6, -3, 0])
    })
});

function evaluateTubeSimulatorHudPlateCurrent(profile, vgk, vak) {
    if (vak <= 0) return 0;
    const z = (vgk + vak / profile.mu - profile.v0) / profile.sc;
    const softplus = z > 32
        ? z
        : (z < -32 ? Math.exp(z) : Math.log1p(Math.exp(z)));
    const amplitude = profile.ka * Math.pow(profile.sc * softplus, profile.alpha);
    return amplitude * (1 - Math.exp(-vak / profile.vs));
}

function tubeSimulatorHudTicks(minimum, maximum, count) {
    return Array.from({ length: count }, (_, index) =>
        minimum + (maximum - minimum) * index / (count - 1));
}

// One plate curve per grid voltage the profile lists, sampled across the whole supply voltage.
function tubeSimulatorHudPlateCurves(profile, plateVoltage) {
    return profile.vgkSteps.map(vgk => {
        const xValues = new Float32Array(TUBE_SIMULATOR_HUD_CURVE_POINTS);
        const yValues = new Float32Array(TUBE_SIMULATOR_HUD_CURVE_POINTS);
        for (let index = 0; index < TUBE_SIMULATOR_HUD_CURVE_POINTS; index++) {
            const vak = plateVoltage * index / (TUBE_SIMULATOR_HUD_CURVE_POINTS - 1);
            xValues[index] = vak;
            yValues[index] = evaluateTubeSimulatorHudPlateCurrent(profile, vgk, vak);
        }
        return { vgk, xValues, yValues };
    });
}

function solveTubeSimulatorSeHudQuiescent(profile, bPlusSource, cathodeResistance) {
    let current = profile.standingCurrentA;
    for (let iteration = 0; iteration < 16; ++iteration) {
        const cathode = current * cathodeResistance;
        const bPlus = bPlusSource - current * profile.powerTheveninResistanceOhm;
        const plate = bPlus - current * profile.windingResistanceOhm;
        const vak = plate - cathode;
        const z = (vak <= 0 ? -Infinity :
            (-cathode + vak / profile.mu - profile.v0) / profile.sc);
        const softplus = z > 32 ? z : (z < -32 ? Math.exp(z) : Math.log1p(Math.exp(z)));
        const exponential = Math.exp(z >= 0 ? -z : z);
        const sigmoid = z >= 0 ? 1 / (1 + exponential) : exponential / (1 + exponential);
        const u = Number.isFinite(z) ? profile.sc * softplus : 0;
        const amplitude = profile.ka * Math.pow(u, profile.alpha);
        const amplitudeDerivative = u > 0
            ? profile.ka * profile.alpha * Math.pow(u, profile.alpha - 1) * sigmoid
            : 0;
        const kneeExponential = vak > 0 ? Math.exp(-vak / profile.vs) : 1;
        const knee = 1 - kneeExponential;
        const tubeCurrent = amplitude * knee;
        const gridDerivative = amplitudeDerivative * knee;
        const plateDerivative = amplitudeDerivative * knee / profile.mu +
            amplitude * kneeExponential / profile.vs;
        const residual = current - tubeCurrent;
        const derivative = 1 + gridDerivative * cathodeResistance +
            plateDerivative * (profile.powerTheveninResistanceOhm +
                profile.windingResistanceOhm + cathodeResistance);
        if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;
        current -= residual / derivative;
        current = current < 0 ? 0 : (current > 0.25 ? 0.25 : current);
    }
    const cathodeV = current * cathodeResistance;
    const plateV = bPlusSource - current * (profile.powerTheveninResistanceOhm +
        profile.windingResistanceOhm);
    return { currentA: current, plateCathodeV: plateV - cathodeV };
}

const TUBE_SIMULATOR_RATE_CONFIGS = Object.freeze({
    44100: Object.freeze({
        factor: 8, firLength: 513, slowWindow: 22,
        internalRate: 352800, slowDt: 22 / 352800, firCutoffHz: 22050
    }),
    48000: Object.freeze({
        factor: 8, firLength: 513, slowWindow: 24,
        internalRate: 384000, slowDt: 1 / 16000, firCutoffHz: 24000
    }),
    88200: Object.freeze({
        factor: 4, firLength: 257, slowWindow: 22,
        internalRate: 352800, slowDt: 22 / 352800, firCutoffHz: 34000
    }),
    96000: Object.freeze({
        factor: 4, firLength: 257, slowWindow: 24,
        internalRate: 384000, slowDt: 1 / 16000, firCutoffHz: 34000
    }),
    176400: Object.freeze({
        factor: 2, firLength: 129, slowWindow: 22,
        internalRate: 352800, slowDt: 22 / 352800, firCutoffHz: 34000
    }),
    192000: Object.freeze({
        factor: 2, firLength: 129, slowWindow: 24,
        internalRate: 384000, slowDt: 1 / 16000, firCutoffHz: 34000
    })
});
const TUBE_SIMULATOR_SUPPORTED_SAMPLE_RATES = Object.freeze(
    Object.keys(TUBE_SIMULATOR_RATE_CONFIGS).map(Number)
);
const TUBE_SIMULATOR_FEEDBACK_FADE_MILLISECONDS = 5;
const TUBE_SIMULATOR_FEEDBACK_WARMUP_MILLISECONDS = 50;
// BEGIN GENERATED TUBE FEEDBACK CALIBRATION
const TUBE_SIMULATOR_FEEDBACK_TABLE_BINARY64_SHA256 =
    '654e88252e2b220a87154bfb8374aa06529f2d08cfe9b4dd6ba01dba6a01c256';
const TUBE_SIMULATOR_FEEDBACK_CALIBRATION = Object.freeze([{"detectorReal":2168.661768361552,"detectorImaginary":-52.4199847320852,"knots":[[1,0,0,0],[0.6821173908958682,-0.6809036562653015,-1.913588466396866,0.9148022010274328],[0.33189010853261963,-0.3317719137643843,-1.8663184130352963,0.8664366078035318],[1.801860496151221,-1.8013210336950025,-1.8720418801852234,0.8725813426414419],[0.30333128042381946,-0.30290087887355255,-1.9100139496155992,0.910444351165866],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.06273956759968516,-0.006419746262259282,-1.1121584962761486,0.16847831761357449],[0.0687597029826057,-0.007035748939698725,-1.0335640220264826,0.09528797606938944],[0.07535749663470553,-0.013633542591798562,-1.0335640220264826,0.09528797606938944],[0.07535749663470553,-0.013633542591798562,-1.0335640220264826,0.09528797606938944],[0.09075461165151967,-0.0290306576086127,-1.0335640220264826,0.09528797606938944],[0.09075461165151967,-0.0290306576086127,-1.0335640220264826,0.09528797606938944],[0.09165330706364126,-0.07948252609448524,-1.617192562651773,0.629363343620929],[0.03499207411680072,-0.006330703037540452,-1.1459261251419535,0.17458749622121383],[0.03499207411680072,-0.006330703037540452,-1.1459261251419535,0.17458749622121383],[0.03499207411680072,-0.006330703037540452,-1.1459261251419535,0.17458749622121383],[0.04628787776931567,-0.026179500434600742,-1.3903527263201556,0.41046110365487065],[0.06390669796787346,-0.048061068409667174,-1.08467189438856,0.10051752394676623],[0.07638828949355621,-0.06624457324566352,-1.4076929698164282,0.4178366860643209],[0.06390669796787346,-0.048061068409667174,-1.08467189438856,0.10051752394676623],[0.03328183561337139,-0.018823542402329675,-1.163266368638226,0.1777246618492678],[0.01765183062052822,-0.017034156455157483,-1.9473560952626712,0.9479737694280418],[0.037736794939420094,-0.030475461707202403,-1.1720529879628296,0.17931432119504723],[0.023220284981602057,-0.020136828294586642,-1.643319425472649,0.6464028821596643],[0.037736794939420094,-0.030475461707202403,-1.1720529879628296,0.17931432119504723],[0.031334500207784256,-0.025305099776746685,-1.3110155868290772,0.3170449872601146],[0.017335060691455954,-0.011305660260418382,-1.3110155868290772,0.3170449872601146],[0.018318886913023923,-0.010360797059890823,-1.0934585137131634,0.1014166035662965],[0.018318886913023923,-0.010360797059890823,-1.0934585137131634,0.1014166035662965],[0.018318886913023923,-0.010360797059890823,-1.0934585137131634,0.1014166035662965],[0.018318886913023923,-0.010360797059890823,-1.0934585137131634,0.1014166035662965],[0.018318886913023923,-0.010360797059890823,-1.0934585137131634,0.1014166035662965],[0.018318886913023923,-0.010360797059890823,-1.0934585137131634,0.1014166035662965],[0.018318886913023923,-0.010360797059890823,-1.0934585137131634,0.1014166035662965],[0.014646965904834122,-0.009552526138405926,-1.4164795891410318,0.4215740289074599],[0.018318886913023923,-0.010360797059890823,-1.0934585137131634,0.1014166035662965],[0.013879197984429652,-0.007849797553392079,-1.3110155868290772,0.3170449872601146],[0.013879197984429652,-0.007849797553392079,-1.3110155868290772,0.3170449872601146],[0.0059589189702290235,-0.005520224130364201,-1.9579454491476214,0.9583841439874862],[0.004531536797572272,-0.004219949673316454,-1.9646963387589436,0.9650079258831994],[0.004531536797572272,-0.004219949673316454,-1.9646963387589436,0.9650079258831994],[0.004531536797572272,-0.004219949673316454,-1.9646963387589436,0.9650079258831994],[0.004531536797572272,-0.004219949673316454,-1.9646963387589436,0.9650079258831994],[0.004531536797572272,-0.004219949673316454,-1.9646963387589436,0.9650079258831994],[0.004472075810325384,-0.004315588602114526,-1.973482958083547,0.9736394452917578],[0.004472075810325384,-0.004315588602114526,-1.973482958083547,0.9736394452917578],[0.004472075810325384,-0.004315588602114526,-1.973482958083547,0.9736394452917578],[0.004472075810325384,-0.004315588602114526,-1.973482958083547,0.9736394452917578],[0.004472075810325384,-0.004315588602114526,-1.973482958083547,0.9736394452917578],[0.004472075810325384,-0.004315588602114526,-1.973482958083547,0.9736394452917578],[0.004472075810325384,-0.004315588602114526,-1.973482958083547,0.9736394452917578],[0.004472075810325384,-0.004315588602114526,-1.973482958083547,0.9736394452917578],[0.004472075810325384,-0.004315588602114526,-1.973482958083547,0.9736394452917578],[0.0022459935086745204,-0.0021674015373531284,-1.9822695774081505,0.9823481693794719],[0.0022459935086745204,-0.0021674015373531284,-1.9822695774081505,0.9823481693794719],[0.0022459935086745204,-0.0021674015373531284,-1.9822695774081505,0.9823481693794719],[0.0011429946307544945,-0.0010644026594331024,-1.9822695774081505,0.9823481693794719],[0.0011429946307544945,-0.0010644026594331024,-1.9822695774081505,0.9823481693794719]]},{"detectorReal":2168.9234982245544,"detectorImaginary":-47.09667421035303,"knots":[[1,0,0,0],[0.6288990430374193,-0.6278708508017817,-1.920416697432366,0.9214448896680035],[1.257283779660102,-1.2562555874244643,-1.920416697432366,0.9214448896680035],[1.257283779660102,-1.2562555874244643,-1.920416697432366,0.9214448896680035],[1.257283779660102,-1.2562555874244643,-1.920416697432366,0.9214448896680035],[1.1831386592186288,-1.1827345658331834,-1.8825752219378655,0.882979315323311],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.10088391579193967,-0.059762103040174486,-1.2875658284150069,0.32868764116677207],[0.10088391579193967,-0.059762103040174486,-1.2875658284150069,0.32868764116677207],[0.10088391579193967,-0.059762103040174486,-1.2875658284150069,0.32868764116677207],[0.10088391579193967,-0.059762103040174486,-1.2875658284150069,0.32868764116677207],[0.09072585939121589,-0.06982855599214385,-1.3187245505210936,0.33962185392016575],[0.029084069703239093,-0.003581549360348992,-1.1756843196934446,0.20118684003633477],[0.07852532581105466,-0.053022805468164555,-1.1756843196934446,0.20118684003633477],[0.07852532581105466,-0.053022805468164555,-1.1756843196934446,0.20118684003633477],[0.07852532581105466,-0.053022805468164555,-1.1756843196934446,0.20118684003633477],[0.07604681434793295,-0.058530602733898644,-1.423742871108679,0.4412590827227133],[0.07852532581105466,-0.053022805468164555,-1.1756843196934446,0.20118684003633477],[0.04977520926776653,-0.03775427125520084,-1.4970480752890125,0.5090690133015782],[0.04573404601644724,-0.035199913392233675,-1.334690483374181,0.3452246159983946],[0.04573404601644724,-0.035199913392233675,-1.334690483374181,0.3452246159983946],[0.04573404601644724,-0.035199913392233675,-1.334690483374181,0.3452246159983946],[0.04573404601644724,-0.035199913392233675,-1.334690483374181,0.3452246159983946],[0.04573404601644724,-0.035199913392233675,-1.334690483374181,0.3452246159983946],[0.014418978379681827,-0.01109778894232892,-1.5842369915101977,0.5875581809475506],[0.013131760760082122,-0.005987270415222818,-1.1149968553919418,0.12214134573680116],[0.016284271278698192,-0.010995659544015293,-1.3427719515002197,0.3480605632349026],[0.016284271278698192,-0.010995659544015293,-1.3427719515002197,0.3480605632349026],[0.016284271278698192,-0.010995659544015293,-1.3427719515002197,0.3480605632349026],[0.013131760760082122,-0.005987270415222818,-1.1149968553919418,0.12214134573680116],[0.016284271278698192,-0.010995659544015293,-1.3427719515002197,0.3480605632349026],[0.016284271278698192,-0.010995659544015293,-1.3427719515002197,0.3480605632349026],[0.013131760760082122,-0.005987270415222818,-1.1149968553919418,0.12214134573680116],[0.013131760760082122,-0.005987270415222818,-1.1149968553919418,0.12214134573680116],[0.016284271278698192,-0.010995659544015293,-1.3427719515002197,0.3480605632349026],[0.016284271278698192,-0.010995659544015293,-1.3427719515002197,0.3480605632349026],[0.016284271278698192,-0.010995659544015293,-1.3427719515002197,0.3480605632349026],[0.0067639971153843036,-0.006349167444798527,-1.9580195911148546,0.9584344207854404],[0.004157449244445712,-0.0038940582933031675,-1.9675413523915402,0.9678047433426827],[0.023754489095606172,-0.01560325637657847,-1.1525831784118636,0.1607344111308914],[0.004140581379202621,-0.0038782590744364715,-1.9596568876644915,0.9599192099692576],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.002334384174865678,-0.0022151200068081657,-1.977610555642248,0.9777298198103057],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902],[0.0020872278378178876,-0.001954993649706387,-1.9756228205175788,0.9757550547056902]]},{"detectorReal":1602.953381534547,"detectorImaginary":1.2813849752760256,"knots":[[1,0,0,0],[0.7952165607825199,-0.7949324128515372,-1.9034147214829154,0.9036988694138981],[0.6530275520716565,-0.6528633426778708,-1.869198781173625,0.8693629905674107],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.5080248451021709,-0.5071014107117675,-1.927069654175979,0.9279930885663826],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[0.12407496058681748,-0.1237445549036331,-1.957048695951447,0.9573791016346314],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[0.13978153333040744,-0.13965711689720522,-1.961452365478665,0.9615767819118675],[0.17511158607617092,-0.1747999989519151,-1.9646963387589436,0.9650079258831994],[0.17511158607617092,-0.1747999989519151,-1.9646963387589436,0.9650079258831994],[0.17581296415044878,-0.17565647694223793,-1.973482958083547,0.9736394452917578],[0.06641743236871435,-0.06641075959560684,-1.9797271119595257,0.9797337847326332],[0.053153359139397977,-0.0530591853841204,-1.9803056534274264,0.980399827182704],[0.04789177993053976,-0.047888747979925955,-1.9864629899446478,0.9864660218952616],[0.04431027221432697,-0.04430238148697019,-1.990244710950327,0.9902526016776837],[0.04431027221432697,-0.04430238148697019,-1.990244710950327,0.9902526016776837],[0.0710510863395273,-0.07104475970594244,-1.9946650763263771,0.994671402959962],[0.11937072294401219,-0.11936820280788382,-1.9966026849200862,0.9966052050562145],[0.0710510863395273,-0.07104475970594244,-1.9946650763263771,0.994671402959962],[0.08372071283858436,-0.08371910352668029,-1.9967856136058164,0.9967872229177205],[0.009591156850223447,-0.00897388253254064,-1.9494122762361719,0.9500295505538546],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.00827164077915745,-0.007214367996946675,-1.9305138728540367,0.9315711456362475],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.0057635116817264555,-0.005182532121884061,-1.9473204772013832,0.9479014567612256],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004965844327395906,-0.004402239831863768,-1.9525192883059739,0.9530828928015062],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.006108482699860607,-0.005613337656626045,-1.954578609923872,0.9550737549671067],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418]]},{"detectorReal":1603.047612121858,"detectorImaginary":5.623383976667833,"knots":[[1,0,0,0],[0.9038747374677052,-0.9030370093943993,-1.8877164944809546,0.8885542225542604],[1.257283779660102,-1.2562555874244643,-1.920416697432366,0.9214448896680035],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.12338625286470875,-0.12267752639666307,-1.9329096742855563,0.933618400753602],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[1.033095850286373,-1.0323865193952662,-1.9445013223978846,0.9452106532889915],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[1.0046761361354715,-1.0044792355009515,-1.9369285431471,0.9371254437816198],[0.36223998510090244,-0.36193284574966633,-1.9454113274492615,0.9457184668004975],[0.32147894322244636,-0.3213737566963327,-1.9645375997620853,0.9646427862881989],[0.32147894322244636,-0.3213737566963327,-1.9645375997620853,0.9646427862881989],[0.32147894322244636,-0.3213737566963327,-1.9645375997620853,0.9646427862881989],[0.17287246797716468,-0.172682123938082,-1.9636853492909823,0.963875693330065],[0.363504570385871,-0.36334721493691147,-1.9621831600397863,0.9623405154887459],[1.2368978509299582,-1.2366119854560842,-1.9629501024207316,0.9632359678946056],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.0649093294265478,-0.06490401926167345,-1.9834434805012116,0.9834487906660858],[0.04072594976483613,-0.04071928654203715,-1.9910343558063825,0.9910410190291815],[0.07166672159320175,-0.07166158911432322,-1.9937624415578357,0.9937675740367142],[0.06529211302169283,-0.06528677154168984,-1.995097948166606,0.9951032896466091],[0.16313195864543,-0.16312886491296671,-1.9960193070305738,0.9960224007630373],[0.20260390137597373,-0.20259979901567451,-1.9959053898853971,0.9959094922456964],[0.10643592585339737,-0.10643114144037588,-1.9952200525335195,0.995224836946541],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.006201759855817962,-0.005811793770176848,-1.9603255986760781,0.9607155647617194],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.004862273725147023,-0.004283324000282001,-1.9446741209474048,0.9452530706722698],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048]]},{"detectorReal":122.20942385204616,"detectorImaginary":0.16832259909744487,"knots":[[1,0,0,0],[0.6821173908958682,-0.6809036562653015,-1.913588466396866,0.9148022010274328],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.1243529319906607,-0.12430928800662891,-1.9056038731091647,0.9056475170931966],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[0.3425772051021316,-0.34196763580654577,-1.9223750857214696,0.9229846550170554],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[0.19280189715923524,-0.1927113901457465,-1.9444043744959494,0.9444948815094382],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[0.1522562215314666,-0.15212326476532434,-1.9551975574222644,0.9553305141884068],[1.7419920034287786,-1.7416817912980505,-1.9561427145872745,0.9564529267180026],[0.1525246372825464,-0.15252019670200873,-1.9666355946570033,0.9666400352375409],[0.8787517905969384,-0.8785953033887276,-1.973482958083547,0.9736394452917578],[0.1372039402077767,-0.1371093496257445,-1.9738192428009422,0.9739138333829744],[0.17581296415044878,-0.17565647694223793,-1.973482958083547,0.9736394452917578],[0.0888959769993073,-0.08889184290582737,-1.983230031320229,0.9832341654137088],[0.2454637748534837,-0.24545430652096292,-1.9785840152505207,0.9785934835830415],[0.18129288967966795,-0.1811547766962036,-1.9739710216268067,0.9741091346102712],[0.08861659888924742,-0.08860870816189063,-1.990244710950327,0.9902526016776837],[0.08861659888924742,-0.08860870816189063,-1.990244710950327,0.9902526016776837],[0.09343339613535795,-0.09342685322087284,-1.991443720621003,0.991450263535488],[0.13329648867922061,-0.13328826968629717,-1.9933745428711926,0.9933827618641162],[0.0710510863395273,-0.07104475970594244,-1.9946650763263771,0.994671402959962],[0.0710510863395273,-0.07104475970594244,-1.9946650763263771,0.994671402959962],[0.12625250132460075,-0.12624799566126713,-1.9952445546019353,0.9952490602652689],[0.08906415292714037,-0.08906238972817003,-1.9969418429202448,0.9969436061192151],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008983083675143133,-0.008365409509772397,-1.9473560952626712,0.9479737694280418],[0.008478767007036918,-0.008052073632677443,-1.9586741948653394,0.959100888239699],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.005441640881841223,-0.004896410029822713,-1.9530470569517693,0.9535922878037877],[0.006145829330413877,-0.005370928499334226,-1.9345531276417032,0.9353280284727828],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.0053060460246289525,-0.004618027869969346,-1.9475381364257167,0.9482261545803763],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418],[0.004651458282543398,-0.0040337841171726625,-1.9473560952626712,0.9479737694280418]]},{"detectorReal":122.21371561084491,"detectorImaginary":0.5093514959642457,"knots":[[1,0,0,0],[0.6859514546605767,-0.685671597978227,-1.8925404079069046,0.8928202645892543],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.5657586632356703,-0.5654262746540184,-1.933350598142919,0.933682986724571],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.6312134077041103,-0.6306972086285069,-1.9284981655584046,0.929014364634008],[0.3168213040620175,-0.31648283354754064,-1.9528257198642898,0.9531641903787665],[0.5943864136940846,-0.5941362249893581,-1.93101615470929,0.9312663434140165],[0.28255916138279263,-0.2820317841869932,-1.9531657984935524,0.9536931756893517],[0.32147894322244636,-0.3213737566963327,-1.9645375997620853,0.9646427862881989],[0.32147894322244636,-0.3213737566963327,-1.9645375997620853,0.9646427862881989],[0.15216118240570667,-0.15207782913881474,-1.9627828494053723,0.9628662026722642],[0.11200273540089269,-0.11195078018128776,-1.9726190453780919,0.9726710005976967],[0.32147894322244636,-0.3213737566963327,-1.9645375997620853,0.9646427862881989],[0.45995644955668596,-0.45972166619373883,-1.9684040723231582,0.9686388556861054],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.16169729168010616,-0.16156505749199465,-1.9756228205175788,0.9757550547056902],[0.2628280174771636,-0.2628235546832887,-1.9919018708349303,0.9919063336288051],[0.10349408065986827,-0.10349070668567759,-1.9942888980172953,0.9942922719914858],[0.032623372965339716,-0.03261269873816348,-1.993465712838805,0.9934763870659812],[0.032623372965339716,-0.03261269873816348,-1.993465712838805,0.9934763870659812],[0.03267276499741495,-0.03267009207241989,-1.9967301834944073,0.9967328564194023],[0.032623372965339716,-0.03261269873816348,-1.993465712838805,0.9934763870659812],[0.03267276499741495,-0.03267009207241989,-1.9967301834944073,0.9967328564194023],[0.03267276499741495,-0.03267009207241989,-1.9967301834944073,0.9967328564194023],[0.025691627599600024,-0.025690620874694217,-1.9975137526156073,0.9975147593405129],[0.008380118837549416,-0.007351926601911825,-1.920416697432366,0.9214448896680035],[0.008380118837549416,-0.007351926601911825,-1.920416697432366,0.9214448896680035],[0.008380118837549416,-0.007351926601911825,-1.920416697432366,0.9214448896680035],[0.008380118837549416,-0.007351926601911825,-1.920416697432366,0.9214448896680035],[0.008380118837549416,-0.007351926601911825,-1.920416697432366,0.9214448896680035],[0.008380118837549416,-0.007351926601911825,-1.920416697432366,0.9214448896680035],[0.008380118837549416,-0.007351926601911825,-1.920416697432366,0.9214448896680035],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.008247425898903652,-0.007724918653651761,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0045852675964173735,-0.004076436732156973,-1.9539285077736048,0.9544373386378652],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048],[0.0042586129878486876,-0.0037361057425967965,-1.951575419538453,0.9520979267837048]]}]);
// END GENERATED TUBE FEEDBACK CALIBRATION

const TUBE_SIMULATOR_REFERENCE_PROCESSOR = `
    if (!parameters.enabled || parameters.fr !== true) return data;
    const RATE_CONFIGS = ${JSON.stringify(TUBE_SIMULATOR_RATE_CONFIGS)};
    const SE_TUBE_MODELS = ${JSON.stringify(TUBE_SIMULATOR_SE_TUBE_MODELS)};
    const tubeSimulatorEffectivePrimaryImpedanceOhm =
        ${tubeSimulatorEffectivePrimaryImpedanceOhm.toString()};
    // Core-magnetics constants shared by the nonlinear transformer model. The flux-ratio clamp
    // keeps the Frohlich division away from its pole - a real core cannot be driven through
    // saturation either, so the clamp is a numerical guard, not a fidelity loss. The
    // excess-current clamp is equally unreachable in normal operation. The hysteresis sign state
    // follows the primary voltage through a first-order lag of 0.1 ms with a 0.05 V soft-sign
    // knee, and is flushed to zero once it decays below the denormal guard. These mirror the
    // kernel constants of the same names bit for bit.
    const FLUX_RATIO_LIMIT = 1 - 1 / 1048576;
    const EXCESS_CURRENT_LIMIT_A = 2;
    const HYSTERESIS_TIME_CONSTANT_S = 1e-4;
    const HYSTERESIS_VOLTAGE_EPSILON_V = 0.05;
    const HYSTERESIS_SIGN_FLUSH_THRESHOLD = 1e-30;
    const rateConfig = RATE_CONFIGS[parameters.sampleRate];
    if (!rateConfig || parameters.channelCount !== 2 || parameters.blockSize < 1 ||
        data.length !== parameters.blockSize * 2) return data;
    const K = {
        channels: 2,
        factor: rateConfig.factor,
        firLength: rateConfig.firLength,
        upsampleHistory: 64,
        downsampleHistory: rateConfig.firLength - 1,
        slowWindow: rateConfig.slowWindow,
        dryDelayFrames: 64,
        hostRate: parameters.sampleRate,
        feedbackFadeMilliseconds:
            ${TUBE_SIMULATOR_FEEDBACK_FADE_MILLISECONDS},
        feedbackWarmupMilliseconds:
            ${TUBE_SIMULATOR_FEEDBACK_WARMUP_MILLISECONDS},
        feedbackDetectorWindowMilliseconds: 10,
        // Output-stage equipment protection. It sits behind the amplifier model as a linear
        // scalar on the wet path, so nothing about the model's overload character changes -
        // only its level. What it suppresses is digital full-scale overshoot; the distortion
        // the model generates is real amplifier behaviour and stays.
        //
        // One-way ramp. Only ever downward, so no release constant exists.
        safetyRampMilliseconds: 20,
        // The frozen Float32 goldens are a baseline of the whole plug-in, safety mechanism
        // included: four of the eight cases run past full scale at their detection point
        // and are recorded with the reduction applied. They are no longer a recording of
        // the amplifier model alone. Running a case with Auto Gain Reduction off
        // reproduces the pre-mechanism bytes exactly, which is how the two are told apart.
        // The quantity measured is the instantaneous magnitude of every sample, not an averaged
        // level. An average reads lower than the true peak by the crest factor of the material,
        // so a programme measurement can sit well inside the threshold while the samples
        // themselves run past full scale. That is exactly what a 100 ms RMS window did here:
        // with a Circuit preset and full-scale music the reduction stayed at 0.0 dB while the
        // output reached about +6 dBFS.
        //
        // The threshold is a policy value, not a fitted one: 1 is digital full scale, the level
        // past which a converter cannot reproduce the sample at all.
        safetyPeakThreshold: 1,
        feedbackTrialMilliseconds: 100,
        feedbackGrowthRatio: 1.15,
        feedbackNonDecayRatio: 1 / 1.15,
        feedbackGrowthWindows: 3,
        // The feedback detector watches two different physical failures, and
        // the two output stages fail in different ways, so the thresholds
        // belong to the stage rather than to the detector. The line stage
        // diverges: nothing in its loop limits the travelling wave, so the wet
        // output and the plate tap run away past full scale within tens of
        // milliseconds, and a floor above full scale compared window against
        // window at 10 ms identifies that and nothing else. The power stage
        // clips instead, so an unstable loop settles into a limit cycle at 0.2
        // to 0.5 of the 25 V output reference with the secondary tap at 1.1 to
        // 7.4 per cent of it. Measured on the three canonical power circuits
        // (0.9 FS noise for one second, then silence, 10 ms windows):
        //   quiescent residual      output <= 9.2e-7   tap <= 3.6e-8
        //   established limit cycle output >= 2.0e-1   tap >= 4.7e-3
        //   post-burst thump        output <= 6.9e-1   tap <= 2.7e-2
        // The first two lines place the power floors with two decades of
        // margin either side; the third is why a floor alone cannot decide,
        // because the low-frequency thump that follows a loud passage is
        // louder than the weakest limit cycle. Only time separates them. The
        // thump is a stable circuit ringing down - 12.3 dB/s at the slowest
        // still-stable setting measured - and a limit cycle rings down at
        // nothing, but 1.15 over 10 ms is a decay rate of 121 dB/s, so at the
        // 10 ms window every ring-down reads as "not decaying". The power
        // stage therefore evaluates the post-input predicates over a coarse
        // window accumulated from 25 of the 10 ms windows: over 250 ms the
        // slowest stable ring-down loses 3.1 dB where the ratio asks for
        // 1.22 dB, and a limit cycle loses nothing.
        //
        // The post-input branch also has to decide that the input is no longer
        // what is driving the loop, and comparing the input against zero only
        // decides that on a file. A live input never reaches bit-exact zero: an
        // ADC noise floor sits at -90 to -110 dBFS, 24-bit dither at 2^-23,
        // an upstream effect leaves a tail, and one non-zero sample was enough
        // to hold the branch shut for good. A level floor on the input cannot
        // stand in for it either - a canonical circuit fed a steady 2.0e-6 puts
        // 2.79e-4 through the output floor, so an input floor loose enough to
        // cover dither false-latches a shipped preset.
        //
        // What narrows the two states down is the loop's own return ratio. The
        // secondary tap is the signal the loop subtracts from the input, so
        // while the input is driving a stable loop the tap is the input times
        // T/(1+T) and cannot much exceed it. Over 1026 takes of the shipped
        // power presets - six sample rates, five stopping signals, five
        // residual floors, and steady sine, noise and programme material from
        // -120 dBFS to full scale - the coarse tap stayed at or below 0.383 of
        // the coarse input for as long as the input was actually driving the
        // stage, and the largest driven ratio measured anywhere is 0.713. That
        // bound holds over the driven interval only. Once the input decays to a
        // residual the numerator is the circuit's own tail and the denominator
        // is whatever is left of the input, so the ratio diverges as the
        // residual falls, on stable presets as much as on oscillating ones:
        // coarse window 3 of the shipped power-el34-distributed-20-37w preset
        // at its canonical nf = 4 reads 43.8, more than fourteen times the
        // gate, and the three canonical power circuits - all of them stable -
        // read 1.17e4 to 2.09e4 against a 1e-9 residual and 98 to 175 against a
        // 24-bit dither floor, against the 262 to 291 an oscillating stage
        // reads on a -90 dBFS ADC floor. Below roughly -60 dBFS of residual the
        // ratio does not separate the two states at all and the gate is simply
        // true.
        //
        // What separates them there is the coarse non-decay test, on its own.
        // Against the 1.2140 dB it asks for over 250 ms, the worst coarse
        // window of a shipped power preset loses 12.43 to 14.05 dB - 10.2 to
        // 11.6 times the requirement - and 5.57 dB at nf = 10, still 4.6 times.
        // Shorten the coarse window span or loosen the non-decay ratio and
        // shipped presets false-latch immediately. The gate cannot stand in
        // for it.
        //
        // The gate value has a band of its own, measured at [0.72, 8.30]. Below
        // the largest driven ratio, 0.713, driven windows start passing it.
        // Above 8.30 the capture of power-el84-pentode-10w at nf = 16 with a
        // -60 dBFS residual is lost: its three qualifying coarse windows read
        // 8.30 / 9.14 / 9.27, so gates 3 and 8 latch and leave a -64.77 dBFS
        // tail while gates 12 and 16 do not latch and leave the limit cycle
        // audible at -7.31 dBFS. Three sits near the logarithmic centre of that
        // band, 4.2 times above the lower edge and 2.77 times below the upper.
        // A drive ratio of zero selects the bit-exact-zero test instead, which
        // is what the line stage keeps.
        //
        // The growth branch had the same blind spot in its own form: it compared
        // the output and the tap against their own previous windows and never
        // looked at the input, so anything that made the input grow by 15 per
        // cent per 10 ms window for three windows satisfied it. That is an
        // ordinary swell. Measured on the shipped line presets at every sample
        // rate, a 1 kHz tone rising from silence to 0.3 FS or more over 50 ms to
        // 500 ms latched the fault and left the plugin in permanent dry bypass,
        // as did tremolo'd programme material at any attack time at all - 646 of
        // 2652 takes. The predicates now ask whether the loop is growing faster
        // than it is being driven, which is what "running away" means and what
        // the branch was always meant to say: the window ratio has to beat the
        // input's own window ratio by the same factor. A swell moves both
        // together, so the ratio of ratios sits at 1.00 against a threshold of
        // 1.15; a loop that has come off its leash owes nothing to the input. It
        // is written as a product so that a silent window, where both inputs are
        // zero, keeps the plain ratio test the line stage was calibrated on.
        lineFeedbackDetector: {
            growthOutputRms: 0.05,
            growthFeedbackRms: 0.01,
            sustainedOutputRms: 1,
            sustainedFeedbackRms: 0.5,
            sustainedDriveRatio: 0,
            sustainedWindowSpan: 1,
            sustainedWindows: 3
        },
        powerFeedbackDetector: {
            growthOutputRms: 0.05,
            growthFeedbackRms: 0.01,
            sustainedOutputRms: 1e-5,
            sustainedFeedbackRms: 4e-7,
            sustainedDriveRatio: 3,
            sustainedWindowSpan: 25,
            sustainedWindows: 3
        },
        detectorTraceCapacity: 1024,
        internalRate: rateConfig.internalRate,
        canonicalNfZeroA0: rateConfig.internalRate === 352800
            ? 122.20953976980046
            : 122.21477702125433,
        fastDt: 1 / rateConfig.internalRate,
        slowDt: rateConfig.slowDt,
        firCutoffHz: rateConfig.firCutoffHz,
        gridOn: -0.05,
        gridScale: 0.04,
        gridK: 0.00049032711558883520,
        gridAlpha: 1.5,
        gridLeakResistance: 470000,
        baseCathodeResistance: 1500,
        basePlateResistance: 100000,
        couplingCapacitance: 22e-9,
        cathodeCapacitance: 22e-6,
        outputCapacitance: 220e-9,
        outputLoadResistance: 100000,
        gmin: 1e-9,
        gamma: 2 - 1.41421356237309504880168872420969808,
        pi: 3.141592653589793238462643383279502884,
        minimumMillerCapacitance: 0.25e-12,
        maximumMillerCapacitance: 2e-9,
        maximumGridVoltage: 500,
        maximumCouplingEquivalentVoltage: 2000,
        minimumLocalPlateGain: -1000,
        maximumLocalPlateGain: 100,
        maximumOutputVoltage: 1000,
        controlSmoothingMilliseconds: 5,
        minimumPhysicalPlateVoltage: -100,
        maximumPhysicalPlateVoltage: 600,
        gridFastPathResidualTolerance: 1e-9,
        gridFallbackResidualTolerance: 1e-12,
        gridMaximumNewtonCorrections: 3,
        gridFallbackMaximumIterations: 64,
        plateFastPathResidualTolerance: 1e-9,
        plateFallbackResidualTolerance: 1e-12,
        plateFallbackMaximumIterations: 32
    };
    const TUBES = ${JSON.stringify(TUBE_SIMULATOR_TUBE_ROWS)};
    const FEEDBACK_TABLE =
        ${JSON.stringify(TUBE_SIMULATOR_FEEDBACK_CALIBRATION)};
    const FEEDBACK_TABLE_BINARY64_SHA256 =
        '${TUBE_SIMULATOR_FEEDBACK_TABLE_BINARY64_SHA256}';
    const POWER_TABLES =
        ${JSON.stringify(TUBE_SIMULATOR_PHASE_C_REFERENCE_TABLES)};
    // Reciprocal width of every bracket of a generated axis. The axes are fixed by the generated
    // tables, so the reciprocals the analytic derivatives need are constants instead of divisions
    // taken eight times per sample and channel. Entry zero is unused: a bracket whose upper index
    // is zero is a clamped bracket and carries no slope.
    const powerLutInverseStep = axis => axis.map(
        (value, index) => index === 0 ? 0 : 1 / (value - axis[index - 1])
    );
    // One entry per output valve. An EL84 cuts off near -15 V of grid and an EL34 near -39 V, and
    // their plate and screen swings scale by the same factor, so the two valves carry separate
    // axes rather than sharing one set whose knots would sit outside the operating box of
    // whichever valve is selected.
    const POWER_TUBE_TABLES = POWER_TABLES.axes.map((axes, index) => ({
        controlVoltageV: axes.controlVoltageV,
        plateCathodeV: axes.plateCathodeV,
        screenCathodeV: axes.screenCathodeV,
        controlVoltageInverseStep: powerLutInverseStep(axes.controlVoltageV),
        plateCathodeInverseStep: powerLutInverseStep(axes.plateCathodeV),
        screenCathodeInverseStep: powerLutInverseStep(axes.screenCathodeV),
        inverseScreenAmplificationFactor:
            POWER_TABLES.tubeModels[index].inverseScreenAmplificationFactor,
        inversePlateAmplificationFactor:
            POWER_TABLES.tubeModels[index].inversePlateAmplificationFactor,
        values: POWER_TABLES.luts[index]
    }));
    const FAST_KCL_STAGE_NODES = [
        ['stage1.grid', 'stage1.coupling', 'stage1.miller', 'stage1.plate'],
        ['stage2.grid', 'stage2.coupling', 'stage2.miller', 'stage2.plate']
    ];

    function observeFastKcl(state, residual, node, channel) {
        const absoluteResidual = residual >= 0 ? residual : -residual;
        if (absoluteResidual > state.observedMaximumFastKclResidual) {
            state.observedMaximumFastKclResidual = absoluteResidual;
        }
        if (absoluteResidual <= state.maximumFastKclResidual) return;
        state.maximumFastKclResidual = absoluteResidual;
        state.maximumFastKclNode = node;
        state.maximumFastKclChannel = channel;
        state.maximumFastKclHostFrame = state.currentFastKclHostFrame;
        state.maximumFastKclInternalFrame = state.currentFastKclInternalFrame;
        state.maximumFastKclInternalPhase = state.currentFastKclInternalPhase;
    }

    function clamp(value, low, high) {
        return value < low ? low : (value > high ? high : value);
    }

    function polynomialExp(value) {
        if (value < -700) return 0;
        if (value > 700) return Infinity;
        const inverseLn2 = 1.44269504088896340735992468100189214;
        const ln2 = 0.693147180559945309417232121458176568;
        const scaled = value * inverseLn2;
        const exponent = Math.trunc(scaled + (scaled >= 0 ? 0.5 : -0.5));
        const reduced = value - exponent * ln2;
        let polynomial = 2.7557319223985892511e-7;
        polynomial = 2.7557319223985890653e-6 + reduced * polynomial;
        polynomial = 2.4801587301587301584e-5 + reduced * polynomial;
        polynomial = 1.9841269841269841270e-4 + reduced * polynomial;
        polynomial = 1.3888888888888888889e-3 + reduced * polynomial;
        polynomial = 8.3333333333333333333e-3 + reduced * polynomial;
        polynomial = 4.1666666666666666667e-2 + reduced * polynomial;
        polynomial = 1.6666666666666666667e-1 + reduced * polynomial;
        polynomial = 0.5 + reduced * polynomial;
        polynomial = 1 + reduced * polynomial;
        polynomial = 1 + reduced * polynomial;
        return polynomial * 2 ** exponent;
    }

    function polynomialLog(value) {
        let exponent = Math.floor(Math.log2(value));
        let mantissa = value / (2 ** exponent);
        if (mantissa > 1.41421356237309504880168872420969808) {
            mantissa *= 0.5;
            ++exponent;
        }
        const ratio = (mantissa - 1) / (mantissa + 1);
        const squared = ratio * ratio;
        let series = 1 / 13;
        series = 1 / 11 + squared * series;
        series = 1 / 9 + squared * series;
        series = 1 / 7 + squared * series;
        series = 1 / 5 + squared * series;
        series = 1 / 3 + squared * series;
        series = 1 + squared * series;
        return 2 * ratio * series +
            exponent * 0.693147180559945309417232121458176568;
    }

    function polynomialPowPositive(value, exponent) {
        return value > 0 ? polynomialExp(exponent * polynomialLog(value)) : 0;
    }

    function exactSoftplus(value) {
        if (value > 32) return value;
        if (value < -32) return Math.exp(value);
        return Math.log1p(Math.exp(value));
    }

    function directGrid(vgk) {
        const z = (vgk - K.gridOn) / K.gridScale;
        const softplus = exactSoftplus(z);
        const exponential = Math.exp(z >= 0 ? -z : z);
        const sigmoid = z >= 0 ? 1 / (1 + exponential) : exponential / (1 + exponential);
        const u = K.gridScale * softplus;
        const powered = Math.pow(u, K.gridAlpha);
        const derivative = u > 0
            ? K.gridK * K.gridAlpha * Math.pow(u, K.gridAlpha - 1) * sigmoid
            : 0;
        return { current: K.gridK * powered, derivative };
    }

    function makeHermiteTable(segments, minimum, maximum, generator) {
        const inverseStep = segments / (maximum - minimum);
        const step = 1 / inverseStep;
        const coefficient0 = new Float64Array(segments);
        const coefficient1 = new Float64Array(segments);
        const coefficient2 = new Float64Array(segments);
        const coefficient3 = new Float64Array(segments);
        for (let index = 0; index < segments; ++index) {
            const first = generator(minimum + index * step);
            const second = generator(minimum + (index + 1) * step);
            const delta = second[0] - first[0];
            coefficient0[index] = first[0];
            coefficient1[index] = step * first[1];
            coefficient2[index] = 3 * delta - step * (2 * first[1] + second[1]);
            coefficient3[index] = -2 * delta + step * (first[1] + second[1]);
        }
        return {
            minimum,
            maximum,
            inverseStep,
            coefficient0,
            coefficient1,
            coefficient2,
            coefficient3
        };
    }

    function evaluateHermite(table, input) {
        const limited = input < table.minimum
            ? table.minimum
            : (input > table.maximum ? table.maximum : input);
        const position = (limited - table.minimum) * table.inverseStep;
        let index = Math.trunc(position);
        if (index >= table.coefficient0.length) index = table.coefficient0.length - 1;
        const t = position - index;
        const a = table.coefficient0[index];
        const b = table.coefficient1[index];
        const c = table.coefficient2[index];
        const d = table.coefficient3[index];
        return [
            ((d * t + c) * t + b) * t + a,
            ((3 * d * t + 2 * c) * t + b) * table.inverseStep
        ];
    }

    function makeTubeTables(tube) {
        const plateMinimum = tube.sc > 0.25 ? -24 * tube.sc : -6;
        const plateMaximum = 2 + 350 / tube.mu - tube.v0;
        return {
            mu: tube.mu,
            v0: tube.v0,
            plateAmplitude: makeHermiteTable(512, plateMinimum, plateMaximum, s => {
                const z = s / tube.sc;
                const softplus = exactSoftplus(z);
                const exponential = Math.exp(z >= 0 ? -z : z);
                const sigmoid = z >= 0
                    ? 1 / (1 + exponential)
                    : exponential / (1 + exponential);
                const u = tube.sc * softplus;
                const powered = Math.pow(u, tube.alpha);
                return [
                    tube.ka * powered,
                    u > 0
                        ? tube.ka * tube.alpha * Math.pow(u, tube.alpha - 1) * sigmoid
                        : 0
                ];
            }),
            plateFactor: makeHermiteTable(256, 0, 350, vak => {
                const exponential = Math.exp(-vak / tube.vs);
                return [1 - exponential, exponential / tube.vs];
            }),
            gridCurrent: makeHermiteTable(512, -2, 2, vgk => {
                const grid = directGrid(vgk);
                return [grid.current, grid.derivative];
            })
        };
    }

    function effectiveDriverTubeIndex(tubeIndex) {
        // Bypass owns no tube model. Its dormant driver state is seeded with a valid table so
        // resets and diagnostics stay finite, but that circuit is never advanced.
        return tubeIndex === 3 ? 0 : tubeIndex;
    }

    function evaluateGrid(state, vgk) {
        const table = state.tables[effectiveDriverTubeIndex(state.tubeIndex)].gridCurrent;
        if (vgk <= table.minimum) return { current: 0, derivative: 0 };
        const grid = evaluateHermite(table, vgk);
        return { current: grid[0], derivative: grid[1] };
    }

    function evaluatePlate(state, vgk, vak) {
        return evaluatePlateTables(
            state.tables[effectiveDriverTubeIndex(state.tubeIndex)], vgk, vak);
    }

    function evaluatePlateTables(tables, vgk, vak) {
        const s = vgk + vak / tables.mu - tables.v0;
        const amplitude = s <= tables.plateAmplitude.minimum
            ? [0, 0]
            : evaluateHermite(tables.plateAmplitude, s);
        const factor = vak <= 0 ? [0, 0] : evaluateHermite(tables.plateFactor, vak);
        return {
            current: amplitude[0] * factor[0],
            gridDerivative: amplitude[1] * factor[0],
            plateDerivative: amplitude[1] * factor[0] / tables.mu +
                amplitude[0] * factor[1]
        };
    }

    // __TUBE_FIR_COEFFICIENTS_INJECT_START__
    const FIR_COEFFICIENT_TABLES = Object.freeze({
        'fir-513-3a180cb03f5f71f3': Object.freeze([
            0x9af753ba, 0xbb1a5f87, 0x975e2632, 0xbe0cbf61, 0x31845e68, 0xbe235e51, 0x5d2fa171, 0xbe31979f,
            0xed276d52, 0xbe399823, 0x14c5b9d7, 0xbe3efc15, 0xcad92320, 0xbe3e75a7, 0x3027d4c4, 0xbe34d510,
            0xb954ec4e, 0x3b618cb9, 0x97082ff7, 0x3e4001a5, 0x9a47a727, 0x3e520c01, 0xa1ff5076, 0x3e5c86e6,
            0xdab0d7cc, 0x3e6288fc, 0x31e35f38, 0x3e646b00, 0xdbae8ed7, 0x3e6284a1, 0x4c5377e4, 0x3e579e60,
            0x265f3936, 0xbb8b70f8, 0x9795b532, 0xbe602754, 0xf6f3734a, 0xbe71567e, 0x10be75e7, 0xbe7a360b,
            0xf08b8424, 0xbe805a18, 0x372cf985, 0xbe815a8b, 0x5334c177, 0xbe7e69f4, 0xc5155fa5, 0xbe72c991,
            0x02227e39, 0xbad3efc0, 0xbbd952f8, 0x3e784478, 0xc437b645, 0x3e896146, 0x39e63384, 0x3e92b908,
            0xd371bd9b, 0x3e96d494, 0x5fc77641, 0x3e97b588, 0xf902e592, 0x3e945a8d, 0x03d3fabc, 0x3e88a914,
            0x8253a04a, 0xbba15f12, 0x7302372e, 0xbe8eb895, 0x789a471a, 0xbe9f979f, 0x8f9ccfa5, 0xbea6eed8,
            0x797b8538, 0xbeab893f, 0xc8352333, 0xbeac2d11, 0xacd7d330, 0xbea7d8ef, 0x9436cebc, 0xbe9c806b,
            0xa4bb163a, 0x3bc3d198, 0x7c259163, 0x3ea14d11, 0xd342f7df, 0x3eb1936a, 0xa7b1a1e9, 0x3eb937c5,
            0xa8d6013b, 0x3ebdefcf, 0x03878e70, 0x3ebe4c05, 0xbaa69032, 0x3eb95edb, 0x7836f6ae, 0x3eae02ad,
            0xe457f90e, 0x3bc79f3d, 0x56d4856d, 0xbeb1dc6b, 0x828c39f4, 0xbec1f96d, 0xe607b5ac, 0xbec98de4,
            0xe6efb47f, 0xbece1124, 0xf2f44f49, 0xbece2a81, 0xa71dc6f4, 0xbec90c72, 0xdf0515f3, 0xbebd6319,
            0x599fb05e, 0xbba6fd84, 0xd7765fdc, 0x3ec1372a, 0x08b4cd20, 0x3ed13177, 0x2b291223, 0x3ed8433f,
            0xc074345f, 0x3edc573c, 0xb6042425, 0x3edc3bb2, 0x0a311a59, 0x3ed7481f, 0x962cbd65, 0x3ecb2133,
            0x76f9e5e1, 0xbbdf8bdc, 0x9245955d, 0xbecf5f39, 0x42a35478, 0xbedf2212, 0x1cc36e5b, 0xbee5d4bd,
            0xee2fc9bc, 0xbee95876, 0x577c585a, 0xbee91961, 0x9e21d339, 0xbee4939c, 0x2c458fb4, 0xbed7d722,
            0x4ed0347f, 0x3bfdde76, 0x4fda1ed6, 0x3edb4346, 0xde1b9bd1, 0x3eeae8b8, 0xf88c6185, 0x3ef2c4dd,
            0x708acc2c, 0x3ef5ad5a, 0xa9302e57, 0x3ef55b4b, 0x1cda5b5a, 0x3ef16ba4, 0x94539357, 0x3ee4157e,
            0x854ea9a1, 0xbc13435a, 0x1228218b, 0xbee6bf22, 0xb064adda, 0xbef6589c, 0x56265ff0, 0xbeff0765,
            0x1bdab76c, 0xbf01d643, 0x6259c168, 0xbf017ea4, 0x174d93b5, 0xbefc6a47, 0x2b75a3ff, 0xbef04f16,
            0x32407746, 0xbbe8f241, 0x80d59898, 0x3ef250b1, 0x9952fa96, 0x3f01eb1b, 0x5d80851a, 0x3f08c787,
            0x32332f42, 0x3f0c5fe7, 0x2c095bfa, 0x3f0bb85c, 0x1e95737c, 0x3f066c8f, 0xae1c61d9, 0x3ef9a44f,
            0x956094ad, 0xbc0863e1, 0xd2b73fc6, 0xbefc9486, 0xc110de08, 0xbf0bdbaa, 0x516b51b8, 0xbf13314f,
            0xc3925c0e, 0xbf15e609, 0xbc6628cf, 0xbf155165, 0x3fb03820, 0xbf112f5a, 0x6a9d1213, 0xbf03955b,
            0x6c34aafe, 0x3c264828, 0x92d45652, 0x3f05ae42, 0x7f97b064, 0x3f151028, 0xdfaadc18, 0x3f1ced8d,
            0x78b573dd, 0x3f20733c, 0x7e470164, 0x3f1fed1b, 0x98e4d251, 0x3f19a7e4, 0x1c7c1309, 0x3f0d2560,
            0x3e50820b, 0xbc18ca50, 0xf275a3ec, 0xbf100928, 0x89aba7f9, 0xbf1f10a8, 0xfac7dd46, 0xbf2544fa,
            0xa3edadca, 0xbf281ea9, 0x4882dba0, 0xbf2756a2, 0x34e0c8b9, 0xbf22b394, 0x0052cd9a, 0xbf152fa0,
            0x450778da, 0xbc17faed, 0xe6901b34, 0x3f172f38, 0x99c4d3cc, 0x3f26656c, 0xe41e02b3, 0x3f2e9618,
            0xf8d47261, 0x3f314bfe, 0x434d1261, 0x3f30b163, 0x98715671, 0x3f2aaf0d, 0x5a7b9e1c, 0x3f1e26e7,
            0x906ae735, 0xbc26ad17, 0x7eb02050, 0xbf206a70, 0x048f9ce3, 0xbf2fa335, 0xf23806a0, 0xbf358d1e,
            0xd0298f9f, 0xbf38510a, 0xa3187c83, 0xbf37697d, 0x47dde613, 0xbf32ab25, 0x820bbd04, 0xbf250bda,
            0x9a6f4dcd, 0x3c45b816, 0xd969b1f4, 0x3f26d025, 0xf50594ea, 0x3f35ef40, 0x713e6adc, 0x3f3dd15d,
            0x5c95dc8b, 0x3f40c917, 0x1ada46bb, 0x3f402069, 0x96fa3052, 0x3f39aa02, 0x4905fc24, 0x3f2cdf64,
            0xe0299723, 0xbc32eae2, 0xa8b0cd33, 0xbf2f2b32, 0x568802a3, 0xbf3de895, 0xc9cfbeb0, 0xbf4449e6,
            0x9fcb76b5, 0xbf46cc47, 0xb808aa01, 0xbf45dc6a, 0x8a094346, 0xbf415cae, 0x88215204, 0xbf337f07,
            0x2e9d66f3, 0xbc3d299d, 0x4415fa53, 0x3f34f84e, 0xb0617fd7, 0x3f441611, 0x33e2aaaa, 0x3f4b3413,
            0x367a20de, 0x3f4e83dd, 0x088afd21, 0x3f4d3612, 0x2b3aca04, 0x3f472929, 0xfc2f6342, 0x3f39f708,
            0xd015eb0d, 0xbc3d1041, 0xf90577e9, 0xbf3bd69a, 0xfcbacd55, 0xbf4a9fa0, 0xc2f923c3, 0xbf520041,
            0xf7be43a2, 0xbf54297f, 0x44ac7dc8, 0xbf5345b0, 0x35a05ace, 0xbf4e844f, 0x62423a82, 0xbf4114eb,
            0x85a47cbf, 0x3c5fd4be, 0xa6ddeee1, 0x3f4243a4, 0xde74198b, 0x3f5171bb, 0x719afeed, 0x3f578f17,
            0xf0b02836, 0x3f5a5ab4, 0x4ca68697, 0x3f592915, 0x5567060d, 0x3f53e593, 0xc3e5fa4a, 0x3f463faf,
            0x35a04fa6, 0xbc44b397, 0x54d086ac, 0xbf47bcaa, 0xbc9f71a3, 0xbf56a5d4, 0x5e7693c0, 0xbf5e8e4a,
            0x5e7f2526, 0xbf611303, 0x9967579c, 0xbf604929, 0x66a065ba, 0xbf59bc19, 0xcf58fccb, 0xbf4cc0b3,
            0xd6fe1ee6, 0x3c480f08, 0x0929ecad, 0x3f4ea0ec, 0xf51d263d, 0x3f5d33dc, 0xbbb0cd25, 0x3f63afcf,
            0x0fbb3712, 0x3f65fcf6, 0x68907287, 0x3f64f606, 0xc42872bd, 0x3f608d8b, 0x36de2ac1, 0x3f527c5b,
            0x22201d6d, 0xbc4b7cd2, 0xdf464764, 0xbf53ad67, 0xbebd2da4, 0xbf62c18a, 0xe2e4a7de, 0xbf694879,
            0xb7bfd857, 0xbf6c3c05, 0x34ea11e0, 0xbf6ae9d4, 0x296be26e, 0xbf6540d5, 0x8a22ffe5, 0xbf57bc87,
            0x4b0e46c8, 0x3c4ee336, 0xa1ce4759, 0x3f59468d, 0xe15c6d42, 0x3f681976, 0xeeb10f63, 0x3f703fd9,
            0x24be3571, 0x3f7227b2, 0x27d60df1, 0x3f7150d1, 0x1cb34da2, 0x3f6b5de8, 0x078f76c9, 0x3f5e96ac,
            0xd4deca99, 0xbc511307, 0x30b87e2a, 0xbf60514a, 0xb2dd2628, 0xbf6f2704, 0xec14ef3c, 0xbf750833,
            0x554664cd, 0xbf77883e, 0x02bf7a6b, 0xbf767ad1, 0xcd6cfd2b, 0xbf71cb91, 0x726a02a8, 0xbf63ed9f,
            0xf5235cc9, 0x3c52941c, 0x03df4397, 0x3f655ae0, 0x5e100fd9, 0x3f746f91, 0xa7a867b4, 0x3f7bab47,
            0x5b52746f, 0x3f7f0cd2, 0xd60f0453, 0x3f7dc1d4, 0x6614f1b7, 0x3f77a381, 0xf3580e66, 0x3f6a92b1,
            0x6c263ed2, 0xbc53e695, 0x18bdc43f, 0xbf6cb8d1, 0x0e04a3d6, 0xbf7b9eb3, 0x065a6df2, 0xbf82cc18,
            0xc0b97d9a, 0xbf853747, 0xd6b83bd3, 0xbf8475d2, 0x1dbb4dc4, 0xbf805d57, 0x40916e54, 0xbf72888a,
            0x1a8152d0, 0x3c54fd4e, 0xcd6d3473, 0x3f746035, 0xc76d65ea, 0x3f83c92b, 0x8ce035de, 0x3f8b388d,
            0x3b9598a7, 0x3f8f166f, 0x78bc2bfa, 0x3f8e5f79, 0xac45686d, 0x3f88a54e, 0xca810947, 0x3f7c5ce6,
            0xe22a9857, 0xbc55cd12, 0xd1a9b8f3, 0xbf8031cf, 0x4678f0b7, 0xbf9015ee, 0xb2a95fae, 0xbf96b4c0,
            0x7edd2f6a, 0xbf9ab42d, 0x0c3609ec, 0xbf9afcbe, 0x1065b1ba, 0xbf96c6f6, 0xa48d0162, 0xbf8b746d,
            0x473cafae, 0x3c564d53, 0x9816bf57, 0x3f91b767, 0x520774c9, 0x3fa3200c, 0x120763ee, 0x3fae0662,
            0xec455353, 0x3fb45555, 0xf3e5a541, 0x3fb91171, 0xbb694f6d, 0x3fbccbe7, 0x5cccb05d, 0x3fbf2e1f,
            0x00802691, 0x3fc00000,
        ]),
        'fir-257-427296a3968eee3e': Object.freeze([
            0x5a7a5d62, 0x3e24888c, 0x4fdebd61, 0x3e3b5411, 0x6c08ec58, 0x3e4402ab, 0x34e6c4f2, 0x3e38ce8e,
            0xab7afc12, 0xbe44ed65, 0xc9058cca, 0xbe644a1e, 0xd7b84a0c, 0xbe7283e6, 0x11e24c43, 0xbe763302,
            0xe938d0ed, 0xbe6c9437, 0xd9079a00, 0x3e636f09, 0x51644648, 0x3e8792de, 0x3341d4c5, 0x3e953aee,
            0x16cd732b, 0x3e993685, 0x3598933f, 0x3e91d5e5, 0xc3535f11, 0xbe6f304c, 0xb4e2f735, 0xbea25843,
            0x01641629, 0xbeb1534b, 0x2406dd55, 0xbeb51fe8, 0xbed7c773, 0xbeb04fe0, 0x27268b12, 0xbe6ebf85,
            0x136aae10, 0x3eb66650, 0x37695232, 0x3ec7018e, 0x54df5b4f, 0x3ecd3b9f, 0x4ca8fd6e, 0x3ec86777,
            0xd0d83e13, 0x3ea84f9f, 0x1f28e3b7, 0xbec6b566, 0xa926adce, 0xbeda5aa4, 0xe6cd348d, 0xbee19e1d,
            0xd14b50b3, 0xbedf9071, 0xde375e1f, 0xbec8ab9a, 0xe7fb04e5, 0x3ed362df, 0xdd7e1b19, 0x3eeade9b,
            0x9899d4e6, 0x3ef31096, 0x89e3657b, 0x3ef23bb4, 0x84750313, 0x3ee259f2, 0xd7f3591f, 0xbedb1cbf,
            0x25a114ab, 0xbef8d34f, 0x443fcdc5, 0xbf02e142, 0x83bfd081, 0xbf03380d, 0xfd5d6683, 0xbef6f225,
            0x8d96c5b7, 0x3edaff5d, 0x941575d6, 0x3f04feb8, 0x28f4725a, 0x3f1154d9, 0x78691fb4, 0x3f12c164,
            0x0a2d332c, 0x3f097285, 0x7fd80999, 0xbea71b3a, 0x7fc8f414, 0xbf1050fe, 0x0a3075a7, 0xbf1dc2d7,
            0x8d0e7f3a, 0xbf21205a, 0x3011c807, 0xbf19c061, 0x50e93acb, 0xbef2af3c, 0x6cc2532b, 0x3f173f08,
            0x812c24f1, 0x3f280c8e, 0x79919334, 0x3f2d8034, 0xa4983ded, 0x3f283279, 0x9dfd3ed5, 0x3f0fca62,
            0xdca18f49, 0xbf1dfc98, 0x0dc5af37, 0xbf325dee, 0x555da2d4, 0xbf381cbe, 0x8410e653, 0xbf355d0f,
            0x0aad2712, 0xbf230895, 0x38dc69d7, 0x3f20f079, 0x0a475a9b, 0x3f3a9451, 0x5b1f817b, 0x3f42cb25,
            0x8e2d7f55, 0x3f41e042, 0x441c0c1c, 0x3f3369b5, 0x0261fdf3, 0xbf1e5cf8, 0xf32f55d4, 0xbf423b39,
            0x9beae854, 0xbf4c0b85, 0x5d0f7bcf, 0xbf4c8a90, 0x544ff913, 0xbf41e955, 0xf3833369, 0x3f08d04d,
            0xb62c9dd6, 0x3f47ab4a, 0xb281b64c, 0x3f541840, 0xc817edb6, 0x3f55db0d, 0xae433d29, 0x3f4ec122,
            0x6e980fce, 0x3f1e16e7, 0x3ce1d5b1, 0xbf4cee28, 0xc19f1361, 0xbf5bb97d, 0x07b80d63, 0xbf6020db,
            0x280861e7, 0xbf58f936, 0xc9e56fde, 0xbf3bbc58, 0x9b569f06, 0x3f50742c, 0xff0f3300, 0x3f6273ec,
            0xc8213dcd, 0x3f670993, 0x54b2530f, 0x3f636595, 0xca40d98d, 0x3f4f1281, 0xa343e2e2, 0xbf50f871,
            0xcf563b01, 0xbf67bdad, 0xcd434be5, 0xbf6ffbab, 0x21c79c04, 0xbf6d1335, 0x0be48541, 0xbf5d39fa,
            0x38bbb9be, 0x3f4da607, 0x8ad859fe, 0x3f6d907a, 0x62a976ae, 0x3f75ae44, 0x30aa8407, 0x3f7532cc,
            0x6ba9e662, 0x3f6912a8, 0x035400f1, 0xbf409c82, 0xc405381a, 0xbf71d6b9, 0xc46e54b5, 0xbf7cdfe0,
            0x1e96680d, 0xbf7e55dd, 0x879f53cf, 0xbf74627a, 0x0675f010, 0xbf34b05b, 0x7334f902, 0x3f74e1c9,
            0xcbc3e532, 0x3f830be6, 0x8586eb89, 0x3f858b1f, 0x983b6c1f, 0x3f8020e1, 0x291af748, 0x3f5e01b2,
            0x46922643, 0xbf77baee, 0xbbcda028, 0xbf893b63, 0x54a8dc99, 0xbf8ee817, 0xf1f8a6ad, 0xbf898843,
            0x4ee33ce6, 0xbf72cd46, 0x60cd94fb, 0x3f7a31ff, 0xe739e1f5, 0x3f9139dc, 0xadcf20b0, 0x3f9723ae,
            0x43936e5e, 0x3f951d37, 0xca12f889, 0x3f84a183, 0x6f12ec75, 0xbf7c1a2c, 0xcfb78e9c, 0xbf99cd48,
            0x44df1eb2, 0xbfa397bc, 0x8e80420e, 0xbfa43e49, 0xc131bdae, 0xbf993527, 0x08fbda95, 0x3f7d4f03,
            0x5b653697, 0x3faaa5ec, 0x7ccd98b0, 0x3fba3bfd, 0xd0f9f315, 0x3fc3081c, 0x0ec7b5fd, 0x3fc72e14,
            0xe483e635, 0x3fc8abd3,
        ]),
        'fir-257-9520743e7f9af8a3': Object.freeze([
            0xfb3b7d9d, 0x3e24b4af, 0x736155a9, 0x3e3b605d, 0xd69bc7aa, 0x3e4547e7, 0xc04565e1, 0x3e41c725,
            0x03008df9, 0xbe31b7c9, 0x7dea98b6, 0xbe6030eb, 0xfeb3610c, 0xbe718d2b, 0x7ae87237, 0xbe798121,
            0x09177544, 0xbe7994b8, 0xeb75d512, 0xbe664569, 0xc54c3392, 0x3e75064e, 0x59e69d50, 0x3e909fcf,
            0xf8d9406b, 0x3e9bb291, 0xb45b52bc, 0x3ea058c0, 0xa0679e4b, 0x3e995e26, 0x35a783bb, 0x3e5e2340,
            0x79082884, 0xbea1ff80, 0xf784f772, 0xbeb3b38a, 0xae9d702c, 0xbebb7a27, 0x73f34fff, 0xbebb69dc,
            0x9b0bed25, 0xbeaf6d0b, 0xd73cc01c, 0x3ea0321a, 0x13031f03, 0x3ec3bd1a, 0xeac6f373, 0x3ed12acd,
            0xd4410ee5, 0x3ed4ac13, 0xde3e27df, 0x3ed16068, 0xa8de95f6, 0x3eb7768d, 0x19f7022a, 0xbec8f4cf,
            0x43d58e56, 0xbee07e5a, 0x6753757f, 0xbee832a3, 0x4d47f2cd, 0xbee96b06, 0xd91ea733, 0xbee16305,
            0x0ef2fb22, 0xbbdf92aa, 0x154d0f8e, 0x3ee7400e, 0xb91f032c, 0x3ef6bb53, 0x1473f8fc, 0x3efcf5a8,
            0x34b42f1e, 0x3efa6f5a, 0xd8d2d5e6, 0x3eeacf53, 0x20b3abfa, 0xbee0ea80, 0x85b620d9, 0xbf00d756,
            0x82c001cb, 0xbf0afb7a, 0xad650974, 0xbf0e3dce, 0xe071a9d3, 0xbf07857d, 0x6e943e66, 0xbeea2f12,
            0xbe339699, 0x3f01498b, 0xf75a6a7c, 0x3f14990e, 0xbf845bdf, 0x3f1c5059, 0xd60c9e22, 0x3f1bf7c4,
            0x4ed1d98e, 0x3f11b064, 0xf4bb9ac3, 0xbed49fea, 0x8addbcd7, 0xbf185518, 0x62932a34, 0xbf26230d,
            0x17480e79, 0xbf2ab280, 0xaa57c63c, 0xbf2706b7, 0x4e74442b, 0xbf1526a1, 0x128ea60f, 0x3f107a5a,
            0x651ad0f2, 0x3f2c406a, 0xa29c46cd, 0x3f35647a, 0x618a9a03, 0x3f36d6f9, 0xbaa02f27, 0x3f30c742,
            0x20a5cb86, 0x3f0e3dfd, 0x8c298698, 0xbf2a24b1, 0xfe1c2fe2, 0xbf3cc37c, 0xa39b3c8e, 0xbf42dbb2,
            0x6f550e73, 0xbf41cda1, 0xdcc5c99b, 0xbf351761, 0x2734db98, 0x3f097232, 0x3b7a2f0a, 0x3f3ec19f,
            0xef4c50fc, 0x3f4a741b, 0xba1e4df1, 0x3f4e9b19, 0xd51c45ef, 0x3f493d72, 0xf60ed639, 0x3f35124c,
            0xb28e73a3, 0xbf344a98, 0x171cbe3a, 0xbf4edf00, 0x287b7a00, 0xbf565c23, 0xefd246f3, 0xbf56fad9,
            0x082f6116, 0xbf50158a, 0x87252000, 0xbf26463b, 0xc6036d9e, 0x3f4afe32, 0x1b53e104, 0x3f5bd0a5,
            0xe58b00a5, 0x3f6190b8, 0x6a4bdbec, 0x3f5ff940, 0xfe198268, 0x3f51d5be, 0x4eae8d2c, 0xbf30ebae,
            0x7c40ddd0, 0xbf5c199e, 0x18bd13f7, 0xbf6716b7, 0x1d2a39ee, 0xbf69d912, 0x68fdd177, 0xbf648981,
            0x907a6eab, 0xbf4f1641, 0xbeef1d76, 0x3f52984d, 0x7a158954, 0x3f69ac9a, 0x8c23b6ed, 0x3f71f444,
            0xf51eac49, 0x3f71e95f, 0xeccbc0f4, 0x3f680e39, 0x45653da8, 0x3f37026d, 0xd0329da5, 0xbf6611f7,
            0x0dd65536, 0xbf7594ac, 0x28935f83, 0xbf7a82c5, 0x86dfbaa3, 0xbf7779e1, 0xe1d2c2e5, 0xbf68cf25,
            0x83d8b2a1, 0x3f50b553, 0x229252d5, 0x3f759f0b, 0x14788eba, 0x3f81310b, 0x3fdf4789, 0x3f82d883,
            0x6e66c494, 0x3f7d3000, 0xb9b5978c, 0x3f64021a, 0xed9bc50a, 0xbf6e41b7, 0x3b6d4863, 0xbf837428,
            0x8067fdd3, 0xbf8ab7bf, 0x4e32c340, 0xbf8a5313, 0xf5fee28e, 0xbf814020, 0xd4b3cbb7, 0xbf418038,
            0x6b3db6b5, 0x3f820a93, 0x6a4c993b, 0x3f913960, 0xca94706c, 0x3f952ba6, 0x2c4e200d, 0x3f92cfcf,
            0x25ac6960, 0x3f836b10, 0xece46b6a, 0xbf723b6e, 0x4abc3390, 0xbf947f5c, 0xe6539567, 0xbfa0ad3f,
            0x87f01176, 0xbfa31735, 0x6e732b20, 0xbf9f19fb, 0x403f4d59, 0xbf84d6b0, 0x45de98f6, 0x3f96b177,
            0x2932bc84, 0x3fb00a4d, 0x6acd7f13, 0x3fbaeab7, 0x0f45d63a, 0x3fc23c86, 0x18289122, 0x3fc58158,
            0xada161fb, 0x3fc6aaaa,
        ]),
        'fir-129-c8c27b42c6d1a746': Object.freeze([
            0x9b4abc8f, 0x3e34ca5a, 0xf3c7f171, 0x3e4635bb, 0x3bb337fe, 0xbe452fdf, 0x82bd9ec3, 0xbe799947,
            0x449a9b03, 0xbe91b788, 0x569ddc27, 0xbe9e1725, 0x895ae36a, 0xbe9dcf7b, 0x414963a1, 0x3e6f3799,
            0x4a920948, 0x3eb5bc0f, 0xa7566c88, 0x3eca29ff, 0x54d51adc, 0x3ed3ae73, 0xaf42cc62, 0x3ed2bf9e,
            0x15ad5fc6, 0x3ea85f73, 0x6b862de2, 0xbede9f29, 0x62b2f208, 0xbef2e376, 0x8988142a, 0xbefbe903,
            0x692519b5, 0xbefb1b5e, 0xfa2a4e67, 0xbee2abb2, 0xb5d29761, 0x3efb312c, 0x3c920f9c, 0x3f12897d,
            0xaf535c8f, 0x3f1be20a, 0xfa8c99cc, 0x3f1c0c79, 0xb9e9d7ef, 0x3f0aa165, 0x80efa2e5, 0xbf111cee,
            0x46e5bab9, 0xbf2bf89c, 0xd746f3c7, 0xbf35de09, 0x763396cf, 0xbf36ed4c, 0x269273af, 0xbf2a6ba5,
            0xc69e16c0, 0x3f1e8cd1, 0x78b999d5, 0x3f41443c, 0xbcd94c2e, 0x3f4c8e8e, 0x777fb626, 0x3f4f5393,
            0xee664e09, 0x3f44af21, 0x1edd3cdc, 0xbf1e74e5, 0x87f113c8, 0xbf521734, 0xa1feb29c, 0xbf602016,
            0xb6e213e5, 0xbf629450, 0x0c79259f, 0xbf5b457b, 0xf597976d, 0xbf1e1bca, 0xa23b0381, 0x3f6076e5,
            0x541e728c, 0x3f7035d1, 0x5f47a635, 0x3f73b7f1, 0x21d0c64b, 0x3f6fa2fa, 0x092676e2, 0x3f4f6c5b,
            0xc4cf60a7, 0xbf6a711b, 0x963f4c99, 0xbf7dd052, 0x5427ef52, 0xbf834c3d, 0x88b86fc4, 0xbf80cb1e,
            0x3f097608, 0xbf69f844, 0xc8bcc414, 0x3f72ef5c, 0x7ea6700f, 0x3f89fbc6, 0x6f622751, 0x3f9226f5,
            0x2f15e707, 0x3f912cfd, 0x343897c1, 0x3f8159ba, 0xae843cd2, 0xbf785c44, 0x736bca7d, 0xbf96fc56,
            0x48e9817d, 0xbfa1e286, 0xa364a395, 0xbfa2e124, 0x841ec8ef, 0xbf97f319, 0xdc25e608, 0x3f7c4928,
            0xbf684c9d, 0x3faa0cad, 0x38e7ef7d, 0x3fb9e6c0, 0xc5a95155, 0x3fc2ec8a, 0xd0141778, 0x3fc725aa,
            0xdaa4b1ff, 0x3fc8abd3,
        ]),
        'fir-129-949d2adf6bc40fec': Object.freeze([
            0x0033b5d4, 0xbe34b4b0, 0xb5c4eadf, 0xbe482150, 0x7f669dac, 0x3e31c184, 0xfad88406, 0x3e7597b2,
            0x26fcc7e2, 0x3e90b628, 0x68ab9868, 0x3ea0222f, 0x48eaaac8, 0x3ea500f9, 0xaa0f6db5, 0x3e9a825e,
            0x779d5f9d, 0xbea2a209, 0x300935af, 0xbec418fe, 0x5c55f173, 0xbed422b1, 0x3fb2168a, 0xbedc049b,
            0x8ad4d946, 0xbeda0e84, 0xd8ad8b11, 0xbeb7939d, 0x8bd3d15f, 0x3ee263dc, 0xd9a401b6, 0x3ef81129,
            0xf38fde76, 0x3f0310dd, 0xb499aac9, 0x3f058604, 0xc4fa641d, 0x3efd797f, 0x396e6612, 0xbee0ff74,
            0xd89280d3, 0xbf110157, 0x8619b0b3, 0xbf20b197, 0x67b39b07, 0xbf262726, 0x79ca7fb2, 0xbf24b5a9,
            0xe20e5b38, 0xbf125022, 0x5554df8e, 0x3f196d63, 0xfacac54b, 0x3f343ec9, 0xfbcecf1a, 0x3f403afc,
            0xa22be21c, 0x3f4274cd, 0xeb24f52e, 0x3f3c1934, 0xc42e18d7, 0x3f0e4e99, 0x9094828a, 0xbf404eaf,
            0x739aef3c, 0xbf51cda1, 0x9b2e50df, 0xbf584db5, 0xbe1b815e, 0xbf57cebc, 0x5c47f34c, 0xbf4bb5c2,
            0xa70c94df, 0x3f34776b, 0x590c5afd, 0x3f5cecfe, 0x0ed7acd5, 0x3f6904d8, 0x76980a47, 0x3f6db7cb,
            0x60350071, 0x3f68d753, 0x6d0149f7, 0x3f525037, 0x7ed3581b, 0xbf5dacc7, 0x65790e18, 0xbf745f46,
            0x363a295e, 0xbf7dc552, 0xb2954491, 0xbf7f1acb, 0x9386ebb1, 0xbf758ac8, 0x199fd185, 0xbf370595,
            0x884c55af, 0x3f78eb57, 0xf632dfe2, 0x3f88e68b, 0x3b45a05e, 0x3f8feeed, 0x8003cdd2, 0x3f8d83ba,
            0xef056c22, 0x3f7f97a2, 0x7c7dacd0, 0xbf6eaa93, 0x81c39d8d, 0xbf91c4ac, 0x5b275808, 0xbf9db68c,
            0xa6bcaded, 0xbfa16d33, 0x1c89f2ce, 0xbf9d0190, 0xb845b739, 0xbf83cc73, 0xcdc4a338, 0x3f95e6b7,
            0x74b551e1, 0x3faf5c1e, 0x81a0ed6b, 0x3fba9342, 0xfe06d152, 0x3fc2221a, 0x795998a9, 0x3fc5798a,
            0xb3121514, 0x3fc6aaaa,
        ]),
    });
    const FIR_COEFFICIENT_TABLE_BY_RATE = Object.freeze({
        44100: 'fir-513-3a180cb03f5f71f3',
        48000: 'fir-513-3a180cb03f5f71f3',
        88200: 'fir-257-427296a3968eee3e',
        96000: 'fir-257-9520743e7f9af8a3',
        176400: 'fir-129-c8c27b42c6d1a746',
        192000: 'fir-129-949d2adf6bc40fec',
    });
    // __TUBE_FIR_COEFFICIENTS_INJECT_END__

    function designFir() {
        const tableId = FIR_COEFFICIENT_TABLE_BY_RATE[K.hostRate];
        const halfWords = FIR_COEFFICIENT_TABLES[tableId];
        if (!halfWords || halfWords.length !== (K.firLength + 1)) {
            throw new Error(
                'Canonical FIR coefficients are unavailable for ' + K.hostRate + ' Hz'
            );
        }
        const coefficients = new Float64Array(K.firLength);
        const words = new Uint32Array(coefficients.buffer);
        const halfLength = halfWords.length / 2;
        for (let index = 0; index < halfLength; ++index) {
            const mirror = K.firLength - 1 - index;
            const low = halfWords[2 * index];
            const high = halfWords[2 * index + 1];
            words[2 * index] = low;
            words[2 * index + 1] = high;
            words[2 * mirror] = low;
            words[2 * mirror + 1] = high;
        }
        return coefficients;
    }

    function makeStage() {
        return {
            gridVoltage: 0,
            plateVoltage: 125,
            couplingCharge: 0,
            millerVoltage: 0,
            millerCapacitance: 100e-12,
            localPlateGain: -40,
            outputResistance: 50000,
            previousVak: 124
        };
    }

    function makeFastChannel() {
        return {
            stage: [makeStage(), makeStage()],
            outputCouplingCharge: 0,
            outputLoadCurrent: 0
        };
    }

    function cloneStage(stage) {
        return { ...stage };
    }

    function cloneFastChannel(channel) {
        return {
            stage: [cloneStage(channel.stage[0]), cloneStage(channel.stage[1])],
            outputCouplingCharge: channel.outputCouplingCharge,
            outputLoadCurrent: channel.outputLoadCurrent
        };
    }

    function makeSlowValue() {
        return { voltage: 0, capacitorCurrent: 0 };
    }

    // Fast-rate publication of a slow-integrated node voltage. The slow grid integrates the real
    // capacitors once per window, but handing that result to the fast solves as a held constant
    // makes the node a staircase clocked at the slow rate; the steps intermodulate with the audio
    // and put sidebands around 16 kHz and its harmonics. The fast path therefore reads 'applied',
    // which traces a quadratic B-spline through the published slow values: each window advances by
    // a per-sample slope that itself advances by a constant curvature, so the published voltage is
    // continuous with a continuous first derivative and its images fall off as sinc^3 instead of
    // the staircase's sinc. The spline of three points never leaves their convex hull, so no
    // overshoot is introduced, and the slope is re-derived from the current applied value at every
    // window boundary, so rounding never accumulates. The only cost is two additions per sample
    // per node and a group delay of 1.5 slow windows - about 94 microseconds against bias time
    // constants of milliseconds to seconds.
    function makeRamp() {
        return { applied: 0, slope: 0, curvature: 0, previous1: 0, previous2: 0 };
    }

    function seedRamp(ramp, value) {
        ramp.applied = value;
        ramp.slope = 0;
        ramp.curvature = 0;
        ramp.previous1 = value;
        ramp.previous2 = value;
    }

    function retargetRamp(ramp, target, inverseWindow, window) {
        const end = 0.5 * (ramp.previous1 + target);
        const curvature =
            (target - 2 * ramp.previous1 + ramp.previous2) * inverseWindow * inverseWindow;
        ramp.curvature = curvature;
        ramp.slope = (end - ramp.applied) * inverseWindow - curvature * (window - 1) * 0.5;
        ramp.previous2 = ramp.previous1;
        ramp.previous1 = target;
    }

    function advanceRamp(ramp) {
        ramp.applied += ramp.slope;
        ramp.slope += ramp.curvature;
        return ramp.applied;
    }

    function finiteRamp(ramp) {
        return Number.isFinite(ramp.applied) && Number.isFinite(ramp.slope) &&
            Number.isFinite(ramp.curvature) && Number.isFinite(ramp.previous1) &&
            Number.isFinite(ramp.previous2);
    }

    function makeSlowState() {
        return {
            cathode: [makeSlowValue(), makeSlowValue()],
            supply: makeSlowValue(),
            // Spline publication of the two cathode nodes and the supply node (see makeRamp).
            cathodeRamp: [makeRamp(), makeRamp()],
            supplyRamp: makeRamp()
        };
    }

    function cloneSlowState(slow) {
        return {
            cathode: [{ ...slow.cathode[0] }, { ...slow.cathode[1] }],
            supply: { ...slow.supply },
            cathodeRamp: [{ ...slow.cathodeRamp[0] }, { ...slow.cathodeRamp[1] }],
            supplyRamp: { ...slow.supplyRamp }
        };
    }

    function makeAccumulator() {
        return { uK1: 0, uK2: 0, uP: 0, count: 0 };
    }

    function makePowerState() {
        return {
            ltpInputCapV: 0, ltpCathodeV: 0,
            ltpPlateAV: 0, ltpPlateBV: 0, ltpGridAV: 0,
            gridCouplingPushV: 0, gridCouplingPullV: 0,
            ltpBalanceV: 0,
            gridPushV: 0, gridPullV: 0,
            cathodePushV: 0, cathodePullV: 0,
            bPlusV: 0, screenTapV: 0, screenV: 0,
            // Screen terminal of each valve. On a distributed tap the two swing in opposite
            // directions with the plates they are tapped from, so their mean carries none of the
            // signal and cannot show that the tap turns ratio reaches the screen at all.
            screenPushV: 0, screenPullV: 0,
            optCurrentA: 0, magnetizingCurrentA: 0, optCapacitorV: 0,
            primaryVoltageV: 0,
            speakerVoiceCurrentA: 0, speakerResonanceCurrentA: 0,
            speakerCapacitorV: 0, feedbackV: 0,
            speakerLoadVoltageV: 0, speakerLoadCurrentA: 0,
            platePushV: 0, platePullV: 0,
            iaPushA: 0, iaPullA: 0, ig2PushA: 0, ig2PullA: 0,
            slowAccumulatorPushA: 0, slowAccumulatorPullA: 0,
            slowAccumulatorScreenA: 0,
            // Both phase-inverter triodes hang on the same reservoir node as the output valves, so
            // their plate current has to reach the reservoir KCL through the same window average.
            slowAccumulatorLtpA: 0,
            // Spline publication of the four slow-integrated supply nodes (see makeRamp). The
            // screen ramp is meaningful for a pentode connection only; a distributed tap computes
            // its screen terminals inside the fast solve.
            cathodePushRamp: makeRamp(), cathodePullRamp: makeRamp(),
            bPlusRamp: makeRamp(), screenRamp: makeRamp(),
            vrmsSquareSum: 0, realPowerSum: 0,
            publishedVrms: 0, publishedRealPower: 0,
            // Nonlinear core magnetics. The flux linkage integrates the same primary voltage as
            // the linear magnetizing branch; the reset seeds the single-ended flux at the
            // gapped-core bias point and the push-pull flux at zero. The sign state is the
            // smoothed sign of the primary voltage that orients the coercive offset, and the
            // excess current records the committed injection of the last sample.
            fluxLinkageWbT: 0, hysteresisSignState: 0, excessCurrentA: 0,
            slowCounter: 0, powerWindowSamples: 0
        };
    }

    // Power-branch circuit constants. Called from exactly one place - applyCircuitAndControlTargets,
    // which every commit path already goes through - so a commit pays for it once, and never at all
    // while the branch is Line, where none of the results are read.
    function applyPowerParameters(state, decoded) {
        if (decoded.outputStage === 2) {
            state.powerSpeaker = POWER_TABLES.speakers[decoded.speakerLoad];
            state.powerPrimaryOhm = [2500, 3500, 5000][decoded.sePrimaryImpedance];
            state.powerSpeakerScale = decoded.actualLoadOhm / Number(state.powerSpeaker.sl);
            state.powerSelectedTurnsRatio = Math.sqrt(
                state.powerPrimaryOhm / Number(state.powerSpeaker.sl)
            );
            refreshSeOptCoefficients(state, decoded);
            solveSeQuiescent(state, decoded);
            return;
        }
        if (decoded.outputStage !== 1) return;
        state.powerProfileIndex = decoded.powerTube * 9 +
            decoded.screenTap * 3 + decoded.primaryImpedance;
        state.powerProfile = POWER_TABLES.profiles[state.powerProfileIndex];
        state.powerSpeaker = POWER_TABLES.speakers[decoded.speakerLoad];
        state.powerPrimaryOhm = [6000, 6600, 8000][decoded.primaryImpedance];
        state.powerSpeakerScale =
            decoded.actualLoadOhm / Number(state.powerSpeaker.sl);
        // The turns ratio stays on the assumed load. A different speaker does not rewind the
        // transformer; it is exactly that mismatch that changes the impedance reflected to the
        // valves.
        state.powerSelectedTurnsRatio = Math.sqrt(
            state.powerPrimaryOhm / Number(state.powerSpeaker.sl)
        );
        refreshPowerLtpCoefficients(state);
        refreshPowerOptCoefficients(state);
        solvePowerLtpQuiescent(state, decoded);
    }

    function refreshSeOptCoefficients(state, decoded) {
        const model = SE_TUBE_MODELS[['300B', '2A3'][decoded.seTube]];
        const speaker = state.powerSpeaker;
        const dt = K.fastDt;
        const scale = state.powerSpeakerScale;
        const speakerLoadOhm = Number(speaker.sl) * scale;
        const voiceResistanceOhm = speaker.voiceResistanceOhm * scale;
        const voiceInductanceH = speaker.voiceInductanceH * scale;
        const resonanceResistanceOhm = speaker.resonanceResistanceOhm * scale;
        const resonanceInductanceH = speaker.resonanceInductanceH * scale;
        const resonanceCapacitanceF = speaker.resonanceCapacitanceF / scale;
        const reflectedLoad = tubeSimulatorEffectivePrimaryImpedanceOhm(
            state.powerPrimaryOhm,
            Number(speaker.sl),
            decoded.actualLoadOhm
        );
        // Winding DCR belongs to the tube's DC KVL. The transformer port is the reflected
        // speaker/leakage series branch in parallel with magnetizing inductance and core loss.
        const effectiveResistanceOhm = reflectedLoad;
        const seriesCapacitanceF = 1 / (2 * K.pi * model.resonanceHz * 2 * K.pi *
            model.resonanceHz * model.leakageInductanceH);
        const leakageOverDt = model.leakageInductanceH / dt;
        const capacitorReactance = dt / (4 * seriesCapacitanceF);
        const seriesCoefficient = leakageOverDt + effectiveResistanceOhm * 0.5 +
            capacitorReactance;
        const magnetizingOverDt = model.magnetizingInductanceH / dt;
        const magnetizingCoefficient = magnetizingOverDt + model.coreLossResistanceOhm * 0.5;
        const voiceStepRaw = dt / voiceInductanceH;
        const resonanceStepRaw = dt / resonanceInductanceH;
        state.powerOpt = {
            distributedScreenTap: false,
            screenTapTurnsRatio: 0,
            centerToTapResistanceOhm: 0,
            tapToPlateResistanceOhm: model.windingResistanceOhm,
            screenSeriesResistanceOhm: 0,
            leakageInductanceH: model.leakageInductanceH,
            magnetizingInductanceH: model.magnetizingInductanceH,
            coreLossResistanceOhm: model.coreLossResistanceOhm,
            effectiveResistanceOhm,
            seriesCapacitanceF,
            inverseSeriesCoefficient: 1 / seriesCoefficient,
            seriesHistoryCoefficient: leakageOverDt - effectiveResistanceOhm * 0.5 -
                capacitorReactance,
            capacitorStep: dt / (2 * seriesCapacitanceF),
            inverseMagnetizingCoefficient: 1 / magnetizingCoefficient,
            magnetizingHistoryCoefficient: magnetizingOverDt -
                model.coreLossResistanceOhm * 0.5,
            magnetizingStep: dt / (2 * model.magnetizingInductanceH),
            inverseCoreLossResistanceOhm: 1 / model.coreLossResistanceOhm,
            inverseFastDt: 1 / dt,
            // Nonlinear core magnetics: the Frohlich saturation curve and the coercive offset in
            // flux-linkage form. The bias operating point depends on the quiescent solve;
            // solveSeQuiescent, which every single-ended commit runs right after this refresh,
            // fills in the last three.
            fluxSaturationWbT: model.fluxSaturationWbT,
            coerciveCurrentA: model.coerciveCurrentA,
            inverseMagnetizingInductance: 1 / model.magnetizingInductanceH,
            inverseFluxReference: 2 / model.fluxSaturationWbT,
            fluxStep: 0.5 * dt,
            hysteresisRate: dt / HYSTERESIS_TIME_CONSTANT_S,
            fluxBiasWbT: 0,
            biasCurrentA: 0,
            biasSlope: 0,
            turnsRatio: state.powerSelectedTurnsRatio,
            halfPrimaryTurnsRatio: state.powerSelectedTurnsRatio,
            windingResistanceOhm: model.windingResistanceOhm,
            inverseWindingResistanceOhm: 1 / model.windingResistanceOhm,
            centerToTapResistanceShare: 0,
            primaryDriveOhm: state.powerPrimaryOhm,
            halfPrimaryReflectedOhm: reflectedLoad,
            plateLoadFactor: 1,
            speakerLoadOhm,
            voiceStep: voiceStepRaw > 0.25 ? 0.25 : voiceStepRaw,
            voiceStepLimited: voiceStepRaw > 0.25,
            voiceResistanceOhm,
            resonanceStep: resonanceStepRaw > 0.25 ? 0.25 : resonanceStepRaw,
            resonanceStepLimited: resonanceStepRaw > 0.25,
            resonanceResistanceOhm,
            speakerCapacitorStep: dt / resonanceCapacitanceF,
            nfbTapGain: model.nfbTapTurnsRatio
        };
    }

    function solveSeQuiescent(state, decoded) {
        const model = SE_TUBE_MODELS[['300B', '2A3'][decoded.seTube]];
        let current = model.standingCurrentA;
        let evaluation = { current: 0, gridDerivative: 0, plateDerivative: 0 };
        let residual = 0;
        for (let iteration = 0; iteration < 16; ++iteration) {
            const cathode = current * decoded.seCathodeResistor;
            const bPlus = decoded.seBPlus - current * model.powerTheveninResistanceOhm;
            const plate = bPlus - current * model.windingResistanceOhm;
            evaluation = evaluateSeTriode(model, -cathode, plate - cathode);
            residual = current - evaluation.current;
            const currentDerivative =
                -evaluation.gridDerivative * decoded.seCathodeResistor -
                evaluation.plateDerivative * (model.powerTheveninResistanceOhm +
                    model.windingResistanceOhm + decoded.seCathodeResistor);
            const derivative = 1 - currentDerivative;
            if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;
            current -= residual / derivative;
            current = current < 0 ? 0 : (current > 0.25 ? 0.25 : current);
        }
        const cathode = current * decoded.seCathodeResistor;
        const bPlus = decoded.seBPlus - current * model.powerTheveninResistanceOhm;
        const plate = bPlus - current * model.windingResistanceOhm;
        evaluation = evaluateSeTriode(model, -cathode, plate - cathode);
        residual = current - evaluation.current;
        state.seQuiescent = { currentA: current, cathodeV: cathode, bPlusV: bPlus, plateV: plate,
            residualA: residual };
        // Bias flux linkage of the gapped core, carried by the standing current. It solves
        // i_an(bias) == ia on the Frohlich inverse curve, and that equation is linear in the
        // bias: (bias/Lm)/(1 - bias/sat) == ia multiplies through the denominator to
        // bias == Lm*ia/(1 + Lm*ia/sat). The linearised difference injection has value and slope
        // zero at this point, so the existing magnetizing-branch seed keeps KCL closed at reset.
        const opt = state.powerOpt;
        const linearFlux = model.magnetizingInductanceH * current;
        const fluxBias = linearFlux / (1 + linearFlux / model.fluxSaturationWbT);
        opt.fluxBiasWbT = fluxBias;
        opt.biasCurrentA = seAnhystereticCurrent(opt, fluxBias);
        opt.biasSlope = seAnhystereticSlope(opt, fluxBias);
    }

    // Output-transformer, screen-tap and speaker coefficients. Every one of these is fixed by the
    // circuit profile, the selected speaker and the sample rate, so they are recomputed on a
    // parameter commit instead of once per sample. Nothing here may depend on a runtime control.
    function refreshPowerOptCoefficients(state) {
        const profile = state.powerProfile;
        const speaker = state.powerSpeaker;
        const opt = profile.optCoefficients;
        const dt = K.fastDt;
        // The measured profile of the assumed speaker, scaled to the load actually connected by
        // k = actual / assumed: resistances and inductances up, capacitance down. That is
        // ordinary impedance scaling - it moves the impedance level while leaving the resonance
        // frequency and Q where they were measured - so at k == 1 it reproduces the measured
        // profile exactly and every A0 record stays valid at its design point.
        const scale = state.powerSpeakerScale;
        const speakerLoadOhm = Number(speaker.sl) * scale;
        const voiceResistanceOhm = speaker.voiceResistanceOhm * scale;
        const voiceInductanceH = speaker.voiceInductanceH * scale;
        const resonanceResistanceOhm = speaker.resonanceResistanceOhm * scale;
        const resonanceInductanceH = speaker.resonanceInductanceH * scale;
        const resonanceCapacitanceF = speaker.resonanceCapacitanceF / scale;
        const reflectedLoad = speakerLoadOhm *
            state.powerSelectedTurnsRatio * state.powerSelectedTurnsRatio;
        const winding = opt.primaryCenterToTapResistanceOhm +
            opt.primaryTapToPlateResistanceOhm;
        // The output impedance is the winding resistance plus the reflected load. Damping comes
        // from the negative feedback loop that is already closed through the secondary tap; it must
        // not be injected a second time by dividing the reflected load by a feedback loop gain.
        const effectiveResistanceOhm = winding + reflectedLoad;
        const seriesCapacitanceF = 1 / (2 * K.pi * opt.resonanceHz * 2 * K.pi *
            opt.resonanceHz * opt.leakageInductanceH);
        const leakageOverDt = opt.leakageInductanceH / dt;
        const capacitorReactance = dt / (4 * seriesCapacitanceF);
        const seriesCoefficient = leakageOverDt + effectiveResistanceOhm * 0.5 +
            capacitorReactance;
        const magnetizingOverDt = opt.magnetizingInductanceH / dt;
        const magnetizingCoefficient = magnetizingOverDt + opt.coreLossResistanceOhm * 0.5;
        const voiceStepRaw = dt / voiceInductanceH;
        const resonanceStepRaw = dt / resonanceInductanceH;
        // Half-primary winding resistance and the impedance the half primary reflects from the
        // speaker, plus the ampere-turn drive resistance of the primary. Together they turn the
        // trapezoidal companion of the transformer series branch into the plate load line of one
        // output tube.
        const inverseSeriesCoefficient = 1 / seriesCoefficient;
        const inverseWindingResistanceOhm = winding !== 0 ? 1 / winding : 0;
        // The screen taps off part-way along the half primary, so only the centre-to-tap section
        // carries the screen current. Expressed as a share of the whole half-primary resistance
        // this is the weight the screen current enters the plate residual with once that residual
        // is written as a current through the whole winding.
        const centerToTapResistanceShare = winding !== 0
            ? opt.primaryCenterToTapResistanceOhm / winding
            : 0;
        const primaryDriveOhm = state.powerPrimaryOhm * 0.5;
        const halfPrimaryReflectedOhm = 0.5 * state.powerSelectedTurnsRatio *
            state.powerSelectedTurnsRatio * speakerLoadOhm;
        const inverseMagnetizingInductance = 1 / opt.magnetizingInductanceH;
        state.powerOpt = {
            distributedScreenTap: profile.screenTapTurnsRatio > 0,
            screenTapTurnsRatio: profile.screenTapTurnsRatio,
            centerToTapResistanceOhm: opt.primaryCenterToTapResistanceOhm,
            tapToPlateResistanceOhm: opt.primaryTapToPlateResistanceOhm,
            screenSeriesResistanceOhm: profile.screenSupplyRc.seriesResistanceOhm,
            leakageInductanceH: opt.leakageInductanceH,
            magnetizingInductanceH: opt.magnetizingInductanceH,
            coreLossResistanceOhm: opt.coreLossResistanceOhm,
            effectiveResistanceOhm,
            seriesCapacitanceF,
            inverseSeriesCoefficient,
            seriesHistoryCoefficient: leakageOverDt - effectiveResistanceOhm * 0.5 -
                capacitorReactance,
            capacitorStep: dt / (2 * seriesCapacitanceF),
            inverseMagnetizingCoefficient: 1 / magnetizingCoefficient,
            magnetizingHistoryCoefficient: magnetizingOverDt - opt.coreLossResistanceOhm * 0.5,
            inverseFastDt: 1 / dt,
            // Nonlinear core magnetics of the push-pull transformer, in the same flux-linkage
            // form as the single-ended core. The two standing currents magnetize the core in
            // opposite directions, so the bias flux is zero and the linearised-difference
            // constants collapse to the origin: zero bias current and the linear slope 1/Lm,
            // which turns the shared excess-current expression into
            // i_x = (flux/Lm)*(x/(1-x)) + i_c*r*s.
            fluxSaturationWbT: profile.fluxSaturationWbT,
            coerciveCurrentA: profile.coerciveCurrentA,
            inverseMagnetizingInductance,
            inverseFluxReference: 2 / profile.fluxSaturationWbT,
            fluxStep: 0.5 * dt,
            hysteresisRate: dt / HYSTERESIS_TIME_CONSTANT_S,
            fluxBiasWbT: 0,
            biasCurrentA: 0,
            biasSlope: inverseMagnetizingInductance,
            turnsRatio: state.powerSelectedTurnsRatio,
            halfPrimaryTurnsRatio: 0.5 * state.powerSelectedTurnsRatio,
            windingResistanceOhm: winding,
            inverseWindingResistanceOhm,
            centerToTapResistanceShare,
            primaryDriveOhm,
            halfPrimaryReflectedOhm,
            // Jacobian weight of the plate node once the half-primary emf is part of its KVL. A
            // change of the plate current moves the transformer branch current by
            // primaryDriveOhm/seriesCoefficient, which moves the emf by that times
            // halfPrimaryReflectedOhm, so the plate residual sees the tube conductance through this
            // factor instead of once. The branch current itself is not a second current through the
            // winding resistance - it is the load component of the very plate current already on
            // the left-hand side - so it contributes only through the emf.
            plateLoadFactor: 1 + inverseSeriesCoefficient * primaryDriveOhm *
                halfPrimaryReflectedOhm * inverseWindingResistanceOhm,
            speakerLoadOhm,
            voiceStep: voiceStepRaw > 0.25 ? 0.25 : voiceStepRaw,
            voiceStepLimited: voiceStepRaw > 0.25,
            voiceResistanceOhm,
            resonanceStep: resonanceStepRaw > 0.25 ? 0.25 : resonanceStepRaw,
            resonanceStepLimited: resonanceStepRaw > 0.25,
            resonanceResistanceOhm,
            speakerCapacitorStep: dt / resonanceCapacitanceF,
            nfbTapGain: profile.nfbTapTurnsRatio * profile.nfbPolarity
        };
    }

    function refreshPowerLtpCoefficients(state) {
        const profile = state.powerProfile;
        // Pre-power volume. The wiper splits the track into R_upper towards the driver output node
        // and R_lower towards ground; the source impedance the phase-inverter grid network sees is
        // their parallel combination, which is why the divider is kept as two resistors instead of
        // a scalar gain. The table generator rejects wiper positions outside the open interval, so
        // both sections are strictly positive here.
        const preVolumeUpper = profile.ltpRc.preVolumeResistanceOhm *
            (1 - profile.ltpRc.preVolumeWiperPosition);
        const preVolumeLower = profile.ltpRc.preVolumeResistanceOhm *
            profile.ltpRc.preVolumeWiperPosition;
        const inverseLtpGridLeak = 1 / profile.ltpRc.gridLeakResistanceOhm;
        const inverseGridStopper = 1 / profile.gridRc.gridStopperResistanceOhm;
        const preVolumeSourceConductance = 1 / preVolumeUpper;
        const wiperConductance = preVolumeSourceConductance + 1 / preVolumeLower +
            inverseLtpGridLeak;
        state.powerLtp = {
            dtOverInputCapacitance: K.fastDt / profile.ltpRc.inputCouplingCapacitanceF,
            dtOverGridCapacitance: K.fastDt / profile.gridRc.couplingCapacitanceF,
            preVolumeSourceConductance,
            inverseWiperConductanceOpen: 1 / wiperConductance,
            inverseWiperConductanceConducting: 1 / (wiperConductance + inverseGridStopper),
            inverseLtpGridLeak,
            inverseGridLeak: 1 / profile.gridRc.gridLeakResistanceOhm,
            inverseGridStopper,
            inverseTailResistance: 1 / profile.ltpRc.tailResistanceOhm,
            tailSupplyOverTailResistance:
                profile.ltpRc.tailSupplyV / profile.ltpRc.tailResistanceOhm,
            inversePlateResistance: 1 / profile.ltpRc.plateResistanceOhm
        };
    }

    // Quiescent point of the 12AX7 long-tailed pair with both grids at their DC return (0 V).
    // Solved once per parameter commit, never inside the sample loop.
    // Zero-signal anode and screen current of one output valve, the published row the reset seed
    // and the reservoir sag are both built from. One definition so the two can never disagree.
    function powerStandingCurrent(decoded) {
        const model = POWER_TABLES.tubeModels[decoded.powerTube];
        return { ia: model.standingPlateCurrentA, ig2: model.standingScreenCurrentA };
    }

    // Reservoir voltage the running branch actually presents to the valves. The supply parameter is
    // the unloaded rail; both output valves' cathode current crosses the reservoir Thevenin
    // resistance before anything downstream sees it, so the centre tap rests one such drop below.
    // Solving the phase inverter - and seeding the reservoir node - at the unloaded rail instead
    // put the output-tube coupling capacitors a full drop (9-11 V) above their equilibrium and
    // drove both output valves into cut-off for the ~100 ms the 22 ms grid network needs to relax.
    function powerSaggedBPlus(state, decoded) {
        const standing = powerStandingCurrent(decoded);
        return decoded.powerBPlus - 2 * (standing.ia + standing.ig2) *
            state.powerProfile.powerSupplyRc.theveninResistanceOhm;
    }

    function solvePowerLtpQuiescent(state, decoded) {
        const profile = state.powerProfile;
        const tables = state.tables[0];
        const bPlus = powerSaggedBPlus(state, decoded);
        const inversePlateResistance = 1 / profile.ltpRc.plateResistanceOhm;
        const inverseTailResistance = 1 / profile.ltpRc.tailResistanceOhm;
        const tailSupply = profile.ltpRc.tailSupplyV;
        const plateVoltage = cathode => {
            let plate = bPlus * 0.7;
            for (let iteration = 0; iteration < 32; ++iteration) {
                const evaluation = evaluatePlateTables(tables, -cathode, plate - cathode);
                const residual = (bPlus - plate) * inversePlateResistance -
                    evaluation.current;
                const derivative = -inversePlateResistance - evaluation.plateDerivative;
                if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-15) break;
                const step = residual / derivative;
                plate -= step;
                plate = plate < 0 ? 0 : (plate > bPlus ? bPlus : plate);
                if (Math.abs(step) < 1e-12) break;
            }
            return plate;
        };
        // (Vk - Vtail)/Rtail - 2*Ia(Vk) is strictly increasing in Vk, so a bisection is exact and
        // cannot stall the way a secant can when one triode is cut off.
        let lower = tailSupply;
        let upper = 40;
        for (let iteration = 0; iteration < 80; ++iteration) {
            const cathode = 0.5 * (lower + upper);
            const plate = plateVoltage(cathode);
            const evaluation = evaluatePlateTables(tables, -cathode, plate - cathode);
            const residual = (cathode - tailSupply) * inverseTailResistance -
                2 * evaluation.current;
            if (residual > 0) {
                upper = cathode;
            } else {
                lower = cathode;
            }
        }
        const cathode = 0.5 * (lower + upper);
        const plate = plateVoltage(cathode);
        // The driver signal reaching the phase inverter is taken after the driver output coupling
        // capacitor, whose charge solveDc pre-sets to the stage-two plate voltage, so its DC value
        // is zero. Both coupling capacitors therefore rest at (source DC - grid DC).
        state.powerLtpQuiescent = {
            inputCapacitorV: 0,
            cathodeV: cathode,
            plateV: plate,
            gridCouplingV: plate
        };
    }

    function resetPowerState(state, channel) {
        const power = makePowerState();
        if (state.parameters.outputStage === 2) {
            const quiescent = state.seQuiescent;
            const ia = quiescent.currentA;
            power.cathodePushV = quiescent.cathodeV;
            power.cathodePullV = power.cathodePushV;
            power.bPlusV = quiescent.bPlusV;
            power.platePushV = quiescent.plateV;
            power.platePullV = power.platePushV;
            power.iaPushA = ia;
            power.iaPullA = ia;
            power.magnetizingCurrentA = ia;
            power.primaryVoltageV = 0;
            // Seed the flux linkage at the gapped-core bias point solveSeQuiescent derived from
            // the standing current (the closed form is linear, see there). The excess injection
            // is zero at this point, so the magnetizing seed above closes KCL and the start is
            // glitch-free. The hysteresis sign and the committed excess current start from the
            // zeroed state.
            power.fluxLinkageWbT = state.powerOpt.fluxBiasWbT;
            const dcResidual = Math.abs(quiescent.residualA);
            if (dcResidual > state.maximumDcResidual) state.maximumDcResidual = dcResidual;
            seedRamp(power.cathodePushRamp, power.cathodePushV);
            seedRamp(power.cathodePullRamp, power.cathodePullV);
            seedRamp(power.bPlusRamp, power.bPlusV);
            seedRamp(power.screenRamp, 0);
            state.power[channel] = power;
            return;
        }
        const profile = state.powerProfile;
        const quiescent = state.powerLtpQuiescent;
        power.ltpInputCapV = quiescent.inputCapacitorV;
        power.ltpCathodeV = quiescent.cathodeV;
        power.ltpPlateAV = quiescent.plateV;
        power.ltpPlateBV = quiescent.plateV;
        power.gridCouplingPushV = quiescent.gridCouplingV;
        power.gridCouplingPullV = quiescent.gridCouplingV;
        const standing = powerStandingCurrent(state.parameters);
        const ia = standing.ia;
        const ig2 = standing.ig2;
        power.cathodePushV = (ia + ig2) * state.parameters.cathodeResistor;
        power.cathodePullV = power.cathodePushV;
        power.bPlusV = powerSaggedBPlus(state, state.parameters);
        power.screenTapV = power.bPlusV - (ia + ig2) *
            profile.optCoefficients.primaryCenterToTapResistanceOhm;
        power.platePushV = power.screenTapV - ia *
            profile.optCoefficients.primaryTapToPlateResistanceOhm;
        power.platePullV = power.platePushV;
        power.screenV = profile.screenTapTurnsRatio > 0
            ? power.screenTapV - ig2 * profile.screenSupplyRc.seriesResistanceOhm
            : POWER_TABLES.tubeModels[state.parameters.powerTube].fixedScreenGroundV;
        power.screenPushV = power.screenV;
        power.screenPullV = power.screenV;
        power.iaPushA = ia;
        power.iaPullA = ia;
        power.ig2PushA = ig2;
        power.ig2PullA = ig2;
        seedRamp(power.cathodePushRamp, power.cathodePushV);
        seedRamp(power.cathodePullRamp, power.cathodePullV);
        seedRamp(power.bPlusRamp, power.bPlusV);
        seedRamp(power.screenRamp, power.screenV);
        state.power[channel] = power;
    }

    function evaluateSeTriode(model, vgk, vak) {
        if (vak <= 0) return { current: 0, gridDerivative: 0, plateDerivative: 0 };
        const z = (vgk + vak / model.mu - model.v0) / model.sc;
        const softplus = z > 32 ? z : (z < -32 ? Math.exp(z) : Math.log1p(Math.exp(z)));
        const sigmoid = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
        const u = model.sc * softplus;
        const amplitude = model.ka * Math.pow(u, model.alpha);
        const amplitudeDerivative = u > 0
            ? model.ka * model.alpha * Math.pow(u, model.alpha - 1) * sigmoid
            : 0;
        const knee = 1 - Math.exp(-vak / model.vs);
        return {
            current: amplitude * knee,
            gridDerivative: amplitudeDerivative * knee,
            plateDerivative: amplitudeDerivative * knee / model.mu +
                amplitude * Math.exp(-vak / model.vs) / model.vs
        };
    }

    // Anhysteretic magnetizing current of the Frohlich inverse characteristic,
    // i_an(flux) = (flux/Lm)/(1 - |flux|/sat). Its small-signal slope at the origin is exactly
    // the linear magnetizing inductance, and the slope grows monotonically towards saturation.
    // The ratio clamp is the numerical guard of the division; the operation order mirrors the
    // kernel verbatim, and the whole magnetics path stays in +,-,*,/ so both implementations
    // agree bit for bit.
    function seAnhystereticCurrent(opt, flux) {
        let ratio = Math.abs(flux) / opt.fluxSaturationWbT;
        ratio = ratio > FLUX_RATIO_LIMIT ? FLUX_RATIO_LIMIT : ratio;
        return flux * opt.inverseMagnetizingInductance / (1 - ratio);
    }

    // d(i_an)/d(flux) = 1/(Lm*(1 - |flux|/sat)^2).
    function seAnhystereticSlope(opt, flux) {
        let ratio = Math.abs(flux) / opt.fluxSaturationWbT;
        ratio = ratio > FLUX_RATIO_LIMIT ? FLUX_RATIO_LIMIT : ratio;
        const margin = 1 - ratio;
        return opt.inverseMagnetizingInductance / (margin * margin);
    }

    // Excess magnetizing current of the nonlinear core, injected on top of the linear
    // magnetizing branch as the bias-point linearised difference
    //   i_x(flux) = i_an(flux) - i_an(bias) - i_an'(bias)*(flux - bias) + i_c*r(flux)*s
    // with the Rayleigh-style loop scaling r(flux) = min(1, |flux - bias|/(sat/2)). Value and
    // slope of the non-hysteretic part are zero at the bias point, so the small-signal response -
    // and with it the frozen break-loop calibration - stays exactly the linear model. The current
    // clamp is a pure numerical guard that normal operation never reaches.
    function seExcessMagnetizingCurrent(opt, flux, signState) {
        const swing = flux - opt.fluxBiasWbT;
        let loopScale = Math.abs(swing) * opt.inverseFluxReference;
        loopScale = loopScale > 1 ? 1 : loopScale;
        let current = seAnhystereticCurrent(opt, flux) - opt.biasCurrentA -
            opt.biasSlope * swing + opt.coerciveCurrentA * loopScale * signState;
        current = current > EXCESS_CURRENT_LIMIT_A
            ? EXCESS_CURRENT_LIMIT_A
            : (current < -EXCESS_CURRENT_LIMIT_A ? -EXCESS_CURRENT_LIMIT_A : current);
        return current;
    }

    // Newton slope of the excess current, d(i_x)/d(flux) = i_an'(flux) - i_an'(bias). Zero at
    // the bias point, positive towards saturation; near flux zero it can go as low as
    // 1/Lm - i_an'(bias), which the linear branch conductance keeps effectively non-negative.
    // The hysteresis and clamp branches are deliberately left out of the slope - the residual
    // itself is exact and both implementations share this choice.
    function seExcessMagnetizingSlope(opt, flux) {
        return seAnhystereticSlope(opt, flux) - opt.biasSlope;
    }

    // Stored-energy increment of the excess current for the energy audit,
    //   W_x(flux) = integral from bias to flux of
    //               (i_an(u) - i_an(bias) - i_an'(bias)*(u - bias)) du
    // returned as W_x(new) - W_x(old). The linear branch already carries 0.5*Lm*i^2 in the
    // audit, so only this excess may be added - adding the full magnetization energy would
    // double count. With W_an(flux) = -(sat/Lm)*(sat*ln(1 - |flux|/sat) + |flux|) the difference
    // needs a single logarithm:
    // W_an(new) - W_an(old) = -(sat/Lm)*(sat*ln((1 - x_new)/(1 - x_old)) + |new| - |old|).
    // The audit feeds a telemetry maximum only, so the transcendental is outside the parity path.
    function seExcessEnergyDelta(opt, oldFlux, newFlux) {
        let oldRatio = Math.abs(oldFlux) / opt.fluxSaturationWbT;
        oldRatio = oldRatio > FLUX_RATIO_LIMIT ? FLUX_RATIO_LIMIT : oldRatio;
        let newRatio = Math.abs(newFlux) / opt.fluxSaturationWbT;
        newRatio = newRatio > FLUX_RATIO_LIMIT ? FLUX_RATIO_LIMIT : newRatio;
        const anhysteretic =
            -(opt.fluxSaturationWbT * opt.inverseMagnetizingInductance) *
            (opt.fluxSaturationWbT * Math.log((1 - newRatio) / (1 - oldRatio)) +
                Math.abs(newFlux) - Math.abs(oldFlux));
        const oldSwing = oldFlux - opt.fluxBiasWbT;
        const newSwing = newFlux - opt.fluxBiasWbT;
        return anhysteretic - opt.biasCurrentA * (newFlux - oldFlux) -
            0.5 * opt.biasSlope * (newSwing * newSwing - oldSwing * oldSwing);
    }

    function updateSeSlow(state, power, model) {
        const inverseWindow = 1 / K.slowWindow;
        const meanCurrent = power.slowAccumulatorPushA * inverseWindow;
        power.slowAccumulatorPushA = 0;
        const previousCathode = power.cathodePushV;
        const previousBPlus = power.bPlusV;
        power.cathodePushV = trapezoidPowerRc(
            previousCathode,
            meanCurrent,
            state.parameters.seCathodeResistor,
            model.cathodeCapacitanceF
        );
        power.cathodePullV = power.cathodePushV;
        const supplySource = state.parameters.seBPlus /
            model.powerTheveninResistanceOhm - meanCurrent;
        power.bPlusV = trapezoidPowerRc(
            previousBPlus,
            supplySource,
            model.powerTheveninResistanceOhm,
            model.powerCapacitanceF
        );
        retargetRamp(power.cathodePushRamp, power.cathodePushV, inverseWindow, K.slowWindow);
        retargetRamp(power.cathodePullRamp, power.cathodePullV, inverseWindow, K.slowWindow);
        retargetRamp(power.bPlusRamp, power.bPlusV, inverseWindow, K.slowWindow);
        ++state.slowPublishCount;
    }

    function advanceSingleEnded(state, channel, input) {
        const power = state.power[channel];
        const model = SE_TUBE_MODELS[
            ['300B', '2A3'][state.parameters.seTube]
        ];
        advanceRamp(power.cathodePushRamp);
        advanceRamp(power.cathodePullRamp);
        advanceRamp(power.bPlusRamp);
        const cathode = power.cathodePushRamp.applied;
        const grid = input;
        let plate = power.platePushV;
        let evaluation = evaluateSeTriode(model, grid - cathode, plate - cathode);
        const opt = state.powerOpt;
        const seriesHistory = -power.optCapacitorV +
            opt.seriesHistoryCoefficient * power.optCurrentA;
        const magnetizingHistory = power.magnetizingCurrentA +
            opt.magnetizingStep * power.primaryVoltageV;
        const transformerConductance = opt.inverseSeriesCoefficient +
            opt.magnetizingStep + opt.inverseCoreLossResistanceOhm;
        // The nonlinear core is coupled implicitly: the excess magnetizing current is evaluated
        // at the end-of-step flux linkage, itself the trapezoid of the primary voltage the same
        // Newton is solving for, so d(flux)/d(plate) = (dt/2) * d(primaryVoltage)/d(plate)
        // enters the Jacobian through the flux chain rule on the same side as the transformer
        // conductance.
        let residual = 0;
        for (let iteration = 0; iteration < 4; ++iteration) {
            const primaryVoltage = power.bPlusRamp.applied - plate -
                model.windingResistanceOhm * evaluation.current;
            const fluxLinkage = power.fluxLinkageWbT +
                opt.fluxStep * (power.primaryVoltageV + primaryVoltage);
            const transformerCurrent = primaryVoltage * transformerConductance +
                seriesHistory * opt.inverseSeriesCoefficient + magnetizingHistory +
                seExcessMagnetizingCurrent(opt, fluxLinkage, power.hysteresisSignState);
            residual = evaluation.current - transformerCurrent;
            const derivative = evaluation.plateDerivative + transformerConductance *
                (1 + model.windingResistanceOhm * evaluation.plateDerivative) +
                seExcessMagnetizingSlope(opt, fluxLinkage) * opt.fluxStep *
                    (1 + model.windingResistanceOhm * evaluation.plateDerivative);
            if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) break;
            plate -= residual / derivative;
            evaluation = evaluateSeTriode(model, grid - cathode, plate - cathode);
        }
        const primaryVoltage = power.bPlusRamp.applied - plate -
            model.windingResistanceOhm * evaluation.current;
        power.platePushV = plate;
        power.platePullV = plate;
        power.iaPushA = evaluation.current;
        power.iaPullA = evaluation.current;
        const output = advancePowerOutputLoad(state, channel, primaryVoltage);
        power.slowAccumulatorPushA += evaluation.current;
        ++power.slowCounter;
        if (power.slowCounter >= K.slowWindow) {
            power.slowCounter = 0;
            updateSeSlow(state, power, model);
        }
        power.vrmsSquareSum += power.speakerLoadVoltageV * power.speakerLoadVoltageV;
        power.realPowerSum += power.speakerLoadVoltageV * power.speakerLoadCurrentA;
        ++power.powerWindowSamples;
        if (power.powerWindowSamples >= K.internalRate / 10) {
            const inverse = 1 / power.powerWindowSamples;
            power.publishedVrms = Math.sqrt(power.vrmsSquareSum * inverse);
            power.publishedRealPower = power.realPowerSum * inverse;
            power.vrmsSquareSum = 0;
            power.realPowerSum = 0;
            power.powerWindowSamples = 0;
        }
        if (!finitePowerState(power) || !Number.isFinite(output)) {
            ++state.finiteFaults;
            ++state.observedFiniteFaults;
            state.blockFiniteFault = true;
            resetPowerState(state, channel);
            return 0;
        }
        return output / 25;
    }

    function decodeParameters(source) {
        const tubeIndex = ['12AX7', '12AT7', '12AU7', 'Bypass'].indexOf(source.tp);
        const outputStage = ['Line', 'Power', 'SingleEnded'].indexOf(source.os ?? 'Line');
        const powerTube = ['EL84', 'EL34', '6L6GC', 'KT88'].indexOf(source.pt ?? 'EL84');
        const screenTap = ['0', '20', '43'].indexOf(source.st ?? '0');
        const primaryImpedance = ['6.0', '6.6', '8.0'].indexOf(source.zp ?? '8.0');
        const speakerLoad = ['4', '8', '15', '16'].indexOf(source.sl ?? '8');
        const seTube = ['300B', '2A3'].indexOf(source.sd ?? '300B');
        const sePrimaryImpedance = ['2.5', '3.5', '5.0'].indexOf(source.sp ?? '3.5');
        const autoGainSource = source.ag ?? true;
        const decoded = {
            driveDb: Number(source.dr),
            tubeIndex,
            biasPercent: Number(source.bi),
            plateV: Number(source.pv),
            sourceZKOhm: Number(source.sz),
            supplyKOhm: Number(source.su),
            outputDb: Number(source.og),
            mixPercent: Number(source.mx),
            inputReference: Number(source.iv),
            feedbackDb: Number(source.nf ?? 0),
            outputStage,
            powerTube,
            powerBPlus: Number(source.pb ?? 320),
            cathodeResistor: Number(source.kr ?? 270),
            screenTap,
            primaryImpedance,
            speakerLoad,
            actualLoadOhm: Number(source.rl ?? 8),
            safetyTrimDb: Number(source.sg ?? 0),
            // The kernel reads this out of the packed Float32 record and tests it against zero,
            // so a numeric 0 has to mean off here too. It cannot arrive from the UI, but a
            // parity case event carrying "ag": 0 would otherwise leave the two engines running
            // different mechanisms without any test noticing.
            autoGainReduction: autoGainSource !== false && autoGainSource !== 0,
            seTube,
            seBPlus: Number(source.sb ?? 400),
            seCathodeResistor: Number(source.sr ?? 1000),
            sePrimaryImpedance
        };
        if (!Number.isFinite(decoded.driveDb) || decoded.driveDb < -96 ||
            decoded.driveDb > 0 || tubeIndex < 0 ||
            !Number.isFinite(decoded.biasPercent) || decoded.biasPercent < -50 ||
            decoded.biasPercent > 50 || !Number.isFinite(decoded.plateV) ||
            decoded.plateV < 150 || decoded.plateV > 300 ||
            !Number.isFinite(decoded.sourceZKOhm) || decoded.sourceZKOhm < 0.6 ||
            decoded.sourceZKOhm > 100 || !Number.isFinite(decoded.supplyKOhm) ||
            decoded.supplyKOhm < 0.1 || decoded.supplyKOhm > 47 ||
            !Number.isFinite(decoded.outputDb) || decoded.outputDb < -48 ||
            decoded.outputDb > 48 || !Number.isFinite(decoded.mixPercent) ||
            decoded.mixPercent < 0 || decoded.mixPercent > 100 ||
            !Number.isFinite(decoded.inputReference) || decoded.inputReference < 0.1 ||
            decoded.inputReference > 300 ||
            !Number.isFinite(decoded.feedbackDb) || decoded.feedbackDb < 0 ||
            decoded.feedbackDb > 30 || outputStage < 0 || powerTube < 0 ||
            !Number.isFinite(decoded.powerBPlus) || decoded.powerBPlus < 300 ||
            decoded.powerBPlus > 470 ||
            !Number.isFinite(decoded.cathodeResistor) ||
            decoded.cathodeResistor < 270 || decoded.cathodeResistor > 500 ||
            screenTap < 0 || primaryImpedance < 0 || speakerLoad < 0 || seTube < 0 ||
            sePrimaryImpedance < 0 || !Number.isFinite(decoded.seBPlus) ||
            decoded.seBPlus < 250 || decoded.seBPlus > 450 ||
            !Number.isFinite(decoded.seCathodeResistor) ||
            decoded.seCathodeResistor < 700 || decoded.seCathodeResistor > 1300 ||
            !Number.isFinite(decoded.actualLoadOhm) ||
            decoded.actualLoadOhm < 2 || decoded.actualLoadOhm > 32 ||
            !Number.isFinite(decoded.safetyTrimDb) ||
            decoded.safetyTrimDb < -96 || decoded.safetyTrimDb > 0 ||
            typeof decoded.autoGainReduction !== 'boolean') {
            return null;
        }
        return decoded;
    }

    function feedbackCalibration(tubeIndex, feedbackDb) {
        const group = FEEDBACK_TABLE[
            tubeIndex * 2 + (K.internalRate === 352800 ? 0 : 1)
        ];
        if (feedbackDb === 0) {
            return {
                feedbackDb: 0,
                q: 0,
                b0: 1,
                b1: 0,
                a1: 0,
                a2: 0,
                a0: K.canonicalNfZeroA0,
                beta: 0,
                makeup: 1
            };
        }
        const position = feedbackDb * 2;
        const low = Math.floor(position);
        const high = low < 60 ? low + 1 : low;
        const fraction = position - low;
        const left = group.knots[low];
        const right = group.knots[high];
        const b0 = left[0] + fraction * (right[0] - left[0]);
        const b1 = left[1] + fraction * (right[1] - left[1]);
        const a1 = left[2] + fraction * (right[2] - left[2]);
        const a2 = left[3] + fraction * (right[3] - left[3]);
        const angle = 2 * K.pi * 1000 / K.internalRate;
        const z1Real = Math.cos(angle);
        const z1Imaginary = -Math.sin(angle);
        const z2Real = Math.cos(2 * angle);
        const z2Imaginary = -Math.sin(2 * angle);
        const numeratorReal = b0 + b1 * z1Real;
        const numeratorImaginary = b1 * z1Imaginary;
        const denominatorReal = 1 + a1 * z1Real + a2 * z2Real;
        const denominatorImaginary =
            a1 * z1Imaginary + a2 * z2Imaginary;
        const denominatorMagnitudeSquared =
            denominatorReal * denominatorReal +
            denominatorImaginary * denominatorImaginary;
        const responseReal =
            (numeratorReal * denominatorReal +
                numeratorImaginary * denominatorImaginary) /
            denominatorMagnitudeSquared;
        const responseImaginary =
            (numeratorImaginary * denominatorReal -
                numeratorReal * denominatorImaginary) /
            denominatorMagnitudeSquared;
        const detectorReal =
            group.detectorReal * responseReal -
            group.detectorImaginary * responseImaginary;
        const detectorImaginary =
            group.detectorReal * responseImaginary +
            group.detectorImaginary * responseReal;
        const a0 = Math.hypot(detectorReal, detectorImaginary);
        const q = Math.pow(10, feedbackDb / 20) - 1;
        const beta = q / a0;
        const responseMagnitude =
            Math.hypot(responseReal, responseImaginary);
        const makeup = Math.hypot(
            1 + beta * detectorReal,
            beta * detectorImaginary
        ) / responseMagnitude;
        return {
            feedbackDb,
            q,
            b0,
            b1,
            a1,
            a2,
            a0,
            beta,
            makeup
        };
    }

    function applyCircuitAndControlTargets(
        state,
        decoded,
        tubeIndex,
        resetControls
    ) {
        applyPowerParameters(state, decoded);
        const tube = TUBES[effectiveDriverTubeIndex(tubeIndex)];
        state.cathodeResistance = K.baseCathodeResistance *
            tube.cathodeResistanceScale * Math.pow(2, -decoded.biasPercent / 50);
        state.plateResistance = K.basePlateResistance * tube.plateResistanceScale;
        state.sourceResistance = 1000 * decoded.sourceZKOhm;
        state.supplyResistance = 1000 * decoded.supplyKOhm;
        state.supplyCapacitance = 22e-6 * 10000 / state.supplyResistance;
        state.supplyVoltage = decoded.plateV;
        const drive = decoded.inputReference * Math.pow(10, decoded.driveDb / 20);
        const output = Math.pow(10, decoded.outputDb / 20);
        const mix = decoded.mixPercent / 100;
        const inputReference = decoded.inputReference;
        const safetyUser = Math.pow(10, decoded.safetyTrimDb / 20);
        state.controls.driveTarget = drive;
        state.controls.outputTarget = output;
        state.controls.mixTarget = mix;
        state.controls.inputReferenceTarget = inputReference;
        state.controls.safetyUserTarget = safetyUser;
        if (resetControls) {
            state.controls.drive = drive;
            state.controls.output = output;
            state.controls.mix = mix;
            state.controls.inputReference = inputReference;
            state.controls.safetyUser = safetyUser;
        }
    }

    function applyParameters(state, decoded, resetControls) {
        state.tubeIndex = decoded.tubeIndex;
        state.parameters = decoded;
        applyCircuitAndControlTargets(
            state,
            decoded,
            decoded.tubeIndex,
            resetControls
        );
        const driverBypassed = decoded.tubeIndex === 3;
        const calibrationDriverIndex = effectiveDriverTubeIndex(decoded.tubeIndex);
        const calibration = feedbackCalibration(
            calibrationDriverIndex,
            driverBypassed && decoded.outputStage === 0 ? 0 : decoded.feedbackDb
        );
        if (decoded.outputStage === 1) {
            // The Power branch carries its own compensator. Its plant is a different circuit from
            // the Line branch - a phase inverter, a push-pull pair, an output transformer and a
            // loudspeaker - and borrowing the Line ladder left a +16.8 dB hump at 1 kHz on the
            // first anchor knot, which on its own put the twenty-kilohertz tilt outside the
            // envelope and stopped the half-decibel walk at zero feedback for every key. The
            // ladder below is derived from the measured Power plant by
            // tests/tools/tube-simulator-lineamp/derive-power-anchors.mjs, on the same two-pole
            // one-zero form and the same acceptance envelope the Line branch uses.
            const driver = ['12AX7', '12AT7', '12AU7'][calibrationDriverIndex];
            const powerTube = ['EL84', 'EL34', '6L6GC', 'KT88'][decoded.powerTube];
            const screenTap = ['0', '20', '43'][decoded.screenTap];
            const primary = ['6.0', '6.6', '8.0'][decoded.primaryImpedance];
            const speakerLoad = ['4', '8', '15', '16'][decoded.speakerLoad];
            const family = K.internalRate === 352800 ? 352800 : 384000;
            const record = POWER_TABLES.a0.find(candidate =>
                candidate.key[1] === driver && candidate.key[2] === powerTube &&
                candidate.key[3] === screenTap && candidate.key[4] === primary &&
                candidate.key[5] === speakerLoad && candidate.key[6] === family
            );
            if (record !== undefined && driverBypassed) {
                // The generated response includes the selected driver's gain and the fixed
                // interstage divider. Bypass injects Input Reference directly at the phase-
                // inverter coupling capacitor, so remove both factors. The shorter plant uses an
                // identity compensator; the existing detector still latches unsafe feedback.
                const driverGroup = FEEDBACK_TABLE[
                    calibrationDriverIndex * 2 + (K.internalRate === 352800 ? 0 : 1)
                ];
                const driverA0 = Math.hypot(
                    driverGroup.detectorReal, driverGroup.detectorImaginary);
                const divider = state.powerLtp.preVolumeSourceConductance *
                    state.powerLtp.inverseWiperConductanceOpen;
                calibration.b0 = 1;
                calibration.b1 = 0;
                calibration.a1 = 0;
                calibration.a2 = 0;
                calibration.a0 = Math.hypot(
                    record.detector.real, record.detector.imaginary) / driverA0 / divider;
                calibration.beta = calibration.q / calibration.a0;
            } else if (record !== undefined) {
                // Ladder knot: the compensator is the anchor blended towards the identity filter
                // along v = log1p(q)/log1p(q30), the same rule the Line ladder knots were
                // generated with, so the sixty-one knots the design fixture records are
                // reproduced exactly at every setting.
                const v = Math.log1p(calibration.q) / 3.4538776394910684;
                const b0 = 1 + v * (record.anchor.b0 - 1);
                const b1 = v * record.anchor.b1;
                const a1 = v * record.anchor.a1;
                const a2 = v * record.anchor.a2;
                const angle = 2 * K.pi * 1000 / K.internalRate;
                const z1Real = Math.cos(angle);
                const z1Imaginary = -Math.sin(angle);
                const z2Real = Math.cos(2 * angle);
                const z2Imaginary = -Math.sin(2 * angle);
                const numeratorReal = b0 + b1 * z1Real;
                const numeratorImaginary = b1 * z1Imaginary;
                const denominatorReal = 1 + a1 * z1Real + a2 * z2Real;
                const denominatorImaginary = a1 * z1Imaginary + a2 * z2Imaginary;
                const denominatorMagnitudeSquared =
                    denominatorReal * denominatorReal +
                    denominatorImaginary * denominatorImaginary;
                const responseReal =
                    (numeratorReal * denominatorReal +
                        numeratorImaginary * denominatorImaginary) /
                    denominatorMagnitudeSquared;
                const responseImaginary =
                    (numeratorImaginary * denominatorReal -
                        numeratorReal * denominatorImaginary) /
                    denominatorMagnitudeSquared;
                const detectedReal = record.detector.real * responseReal -
                    record.detector.imaginary * responseImaginary;
                const detectedImaginary = record.detector.real * responseImaginary +
                    record.detector.imaginary * responseReal;
                calibration.b0 = b0;
                calibration.b1 = b1;
                calibration.a1 = a1;
                calibration.a2 = a2;
                calibration.a0 = Math.hypot(detectedReal, detectedImaginary);
                calibration.beta = calibration.q / calibration.a0;
            }
            // The Power branch takes its output level from the transformer secondary, so the loop
            // is not asked to hand back the gain it removed.
            calibration.makeup = 1;
        } else if (decoded.outputStage === 2) {
            calibration.feedbackDb = decoded.feedbackDb;
            calibration.q = Math.pow(10, decoded.feedbackDb / 20) - 1;
            calibration.b0 = 1;
            calibration.b1 = 0;
            calibration.a1 = 0;
            calibration.a2 = 0;
            const driver = ['12AX7', '12AT7', '12AU7'][calibrationDriverIndex];
            const seTube = ['300B', '2A3'][decoded.seTube];
            const primary = ['2.5', '3.5', '5.0'][decoded.sePrimaryImpedance];
            const speakerLoad = ['4', '8', '15', '16'][decoded.speakerLoad];
            const family = K.internalRate === 352800 ? 352800 : 384000;
            const record = (POWER_TABLES.seA0 || []).find(candidate =>
                candidate.key[1] === driver && candidate.key[2] === seTube &&
                candidate.key[3] === primary && candidate.key[4] === speakerLoad &&
                candidate.key[5] === family
            );
            if (driverBypassed && record !== undefined) {
                const driverGroup = FEEDBACK_TABLE[
                    calibrationDriverIndex * 2 + (K.internalRate === 352800 ? 0 : 1)
                ];
                calibration.a0 = record.a0 / Math.hypot(
                    driverGroup.detectorReal, driverGroup.detectorImaginary);
            } else {
                calibration.a0 = record === undefined ? 1 : record.a0;
            }
            calibration.beta = calibration.q / calibration.a0;
            calibration.makeup = 1;
        }
        state.controls.feedbackDb = calibration.feedbackDb;
        state.controls.feedbackQ = calibration.q;
        state.controls.feedbackB0 = calibration.b0;
        state.controls.feedbackB1 = calibration.b1;
        state.controls.feedbackA1 = calibration.a1;
        state.controls.feedbackA2 = calibration.a2;
        state.controls.feedbackA0 = calibration.a0;
        state.controls.feedbackBeta = calibration.beta;
        state.controls.feedbackMakeup = calibration.makeup;
    }

    function trBdf2Step(state, capacitance, conductance, drive) {
        const derivative1 = 2 / (K.gamma * K.slowDt);
        const history1 = -capacitance * derivative1 * state.voltage -
            state.capacitorCurrent;
        const stageVoltage = (drive - history1) /
            (conductance + capacitance * derivative1);
        const derivative2 = (2 - K.gamma) / ((1 - K.gamma) * K.slowDt);
        const coefficient1 = -1 / (K.gamma * (1 - K.gamma) * K.slowDt);
        const coefficient0 = (1 - K.gamma) / (K.gamma * K.slowDt);
        const history2 = capacitance *
            (coefficient1 * stageVoltage + coefficient0 * state.voltage);
        const voltage = (drive - history2) /
            (conductance + capacitance * derivative2);
        return {
            voltage,
            capacitorCurrent: capacitance * derivative2 * voltage + history2
        };
    }

    function solveDc(state, slow, fast) {
        let p = state.supplyVoltage;
        const vk = [1, 1];
        const vg = [0, 0];
        const va = [140, 140];
        const plate = [{}, {}];
        const grid = [{}, {}];
        for (let iteration = 0; iteration < 8192; ++iteration) {
            for (let stageIndex = 0; stageIndex < 2; ++stageIndex) {
                for (let gridIteration = 0; gridIteration < 8; ++gridIteration) {
                    grid[stageIndex] = evaluateGrid(state, vg[stageIndex] - vk[stageIndex]);
                    const residual = vg[stageIndex] / K.gridLeakResistance +
                        grid[stageIndex].current;
                    vg[stageIndex] -= residual /
                        (1 / K.gridLeakResistance + grid[stageIndex].derivative);
                }
                plate[stageIndex] = evaluatePlate(
                    state,
                    vg[stageIndex] - vk[stageIndex],
                    va[stageIndex] - vk[stageIndex]
                );
            }
            const targetP = (state.supplyVoltage / state.supplyResistance -
                plate[0].current - plate[1].current) /
                (1 / state.supplyResistance + K.gmin);
            p += 0.025 * (targetP - p);
            for (let stageIndex = 0; stageIndex < 2; ++stageIndex) {
                const targetVk = (plate[stageIndex].current + grid[stageIndex].current) /
                    (1 / state.cathodeResistance + K.gmin);
                const targetVa = p - state.plateResistance * plate[stageIndex].current;
                vk[stageIndex] += 0.025 * (targetVk - vk[stageIndex]);
                va[stageIndex] += 0.025 * (targetVa - va[stageIndex]);
            }
        }
        slow.cathode[0] = { voltage: vk[0], capacitorCurrent: 0 };
        slow.cathode[1] = { voltage: vk[1], capacitorCurrent: 0 };
        slow.supply = { voltage: p, capacitorCurrent: 0 };
        seedRamp(slow.cathodeRamp[0], vk[0]);
        seedRamp(slow.cathodeRamp[1], vk[1]);
        seedRamp(slow.supplyRamp, p);
        const tube = TUBES[effectiveDriverTubeIndex(state.tubeIndex)];
        for (let stageIndex = 0; stageIndex < 2; ++stageIndex) {
            const stage = fast.stage[stageIndex];
            plate[stageIndex] = evaluatePlate(
                state,
                vg[stageIndex] - vk[stageIndex],
                va[stageIndex] - vk[stageIndex]
            );
            const denominator = 1 +
                state.plateResistance * plate[stageIndex].plateDerivative;
            stage.gridVoltage = vg[stageIndex];
            stage.plateVoltage = va[stageIndex];
            stage.couplingCharge = stageIndex === 0
                ? K.couplingCapacitance * -vg[stageIndex]
                : K.couplingCapacitance * (va[0] - vg[stageIndex]);
            stage.millerVoltage = vg[stageIndex];
            stage.localPlateGain = -state.plateResistance *
                plate[stageIndex].gridDerivative / denominator;
            stage.millerCapacitance = tube.cgk + tube.cga * (1 - stage.localPlateGain);
            stage.outputResistance = state.plateResistance / denominator;
            stage.previousVak = va[stageIndex] - vk[stageIndex];
        }
        fast.outputCouplingCharge = K.outputCapacitance * va[1];
        fast.outputLoadCurrent = 0;
        const gridResidual0 = vg[0] / K.gridLeakResistance + grid[0].current;
        const gridResidual1 = vg[1] / K.gridLeakResistance + grid[1].current;
        const cathodeResidual0 =
            (1 / state.cathodeResistance + K.gmin) * vk[0] -
            plate[0].current - grid[0].current;
        const cathodeResidual1 =
            (1 / state.cathodeResistance + K.gmin) * vk[1] -
            plate[1].current - grid[1].current;
        const plateResidual0 =
            (p - va[0]) / state.plateResistance - plate[0].current;
        const plateResidual1 =
            (p - va[1]) / state.plateResistance - plate[1].current;
        const supplyResidual =
            (1 / state.supplyResistance + K.gmin) * p +
            plate[0].current + plate[1].current -
            state.supplyVoltage / state.supplyResistance;
        const residuals = [
            gridResidual0,
            gridResidual1,
            cathodeResidual0,
            cathodeResidual1,
            plateResidual0,
            plateResidual1,
            supplyResidual
        ];
        for (const residual of residuals) {
            const absoluteResidual = residual >= 0 ? residual : -residual;
            if (absoluteResidual > state.maximumDcResidual) {
                state.maximumDcResidual = absoluteResidual;
            }
            if (absoluteResidual > state.observedMaximumDcResidual) {
                state.observedMaximumDcResidual = absoluteResidual;
            }
        }
    }

    function resetFeedbackDetector(state) {
        const detector = state.feedbackDetector;
        detector.inputEnergy = 0;
        detector.outputEnergy = 0;
        detector.feedbackEnergy = 0;
        detector.previousInputRms = 0;
        detector.previousOutputRms = 0;
        detector.previousFeedbackRms = 0;
        detector.samples = 0;
        detector.growthCount = 0;
        detector.sustainedCount = 0;
        detector.hasPrevious = false;
        detector.sustainedInputEnergy = 0;
        detector.sustainedOutputEnergy = 0;
        detector.sustainedFeedbackEnergy = 0;
        detector.sustainedPreviousInputRms = 0;
        detector.sustainedPreviousOutputRms = 0;
        detector.sustainedPreviousFeedbackRms = 0;
        detector.sustainedSpan = 0;
        detector.sustainedHasPrevious = false;
    }

    function resetRuntimeState(state, preserveDryPath, preserveTimeline) {
        const dryIndex = state.dryIndex;
        const processedHostFrames = state.processedHostFrames;
        const faultWet = state.fault.wet;
        state.slowPublishCount = 0;
        state.finiteFaults = 0;
        state.safetyLimits = 0;
        state.stepSafetyHit = false;
        state.blockFiniteFault = false;
        state.blockSafetyHit = false;
        state.maximumFastKclResidual = 0;
        state.maximumFastKclNode = null;
        state.maximumFastKclChannel = -1;
        state.maximumFastKclHostFrame = -1;
        state.maximumFastKclInternalFrame = -1;
        state.maximumFastKclInternalPhase = -1;
        state.currentFastKclHostFrame = 0;
        state.currentFastKclInternalFrame = 0;
        state.currentFastKclInternalPhase = 0;
        state.maximumSlowKclResidual = 0;
        state.maximumDcResidual = 0;
        state.maximumEnergyResidual = 0;
        state.diagnostic = null;
        state.detectorProbe.inputEnergy = 0;
        state.detectorProbe.outputEnergy = 0;
        state.detectorProbe.feedbackEnergy = 0;
        state.detectorProbe.inputSamples = 0;
        state.detectorProbe.outputSamples = 0;
        state.detectorProbe.feedbackSamples = 0;
        resetFeedbackDetector(state);
        // The reduction the detector has already committed survives: the mechanism only ever
        // attenuates, and neither a model reset nor a fault rebuild is the user asking for the
        // protection to be given up.
        if (!preserveTimeline) {
            state.feedbackDetector.windows.length = 0;
            state.feedbackDetector.overflow = false;
            state.centralReset.count = 0;
            state.centralReset.reason = 0;
            state.fault.detectionFrame = null;
            state.fault.muteCompleteFrame = null;
            state.fault.trialObservationStartFrame = null;
            state.fault.pendingParameters = null;
            state.fault.resetPending = false;
            state.fault.trialAfterReset = false;
            state.fault.clearPending = false;
        }
        state.dryIndex = preserveDryPath ? dryIndex : 0;
        state.processedHostFrames =
            preserveTimeline ? processedHostFrames : 0;
        if (preserveTimeline) {
            state.fault.wet = faultWet;
        } else if (state.fault.state === 0) {
            state.fault.wet = 1;
            state.fault.muteRemaining = 0;
        }
        state.controls.drive = 1;
        state.controls.driveTarget = 1;
        state.controls.output = 1;
        state.controls.outputTarget = 1;
        state.controls.mix = 1;
        state.controls.mixTarget = 1;
        state.controls.safetyUser = 1;
        state.controls.safetyUserTarget = 1;
        state.controls.feedbackDb = 0;
        state.controls.feedbackQ = 0;
        state.controls.feedbackB0 = 1;
        state.controls.feedbackB1 = 0;
        state.controls.feedbackA1 = 0;
        state.controls.feedbackA2 = 0;
        state.controls.feedbackA0 = 1;
        state.controls.feedbackBeta = 0;
        state.controls.feedbackMakeup = 1;
        state.controls.plateReference = 0;
        state.controls.coefficient = 1 - Math.exp(
            -1000 / (K.controlSmoothingMilliseconds * K.hostRate)
        );
        applyParameters(state, state.parameters, true);
        state.telemetry.fill(0);
        for (let channel = 0; channel < K.channels; ++channel) {
            state.fast[channel] = makeFastChannel();
            state.slow[channel] = makeSlowState();
            state.accumulator[channel] = makeAccumulator();
            resetPowerState(state, channel);
            solveDc(state, state.slow[channel], state.fast[channel]);
            state.recoveryFast[channel] = cloneFastChannel(state.fast[channel]);
            state.recoverySlow[channel] = cloneSlowState(state.slow[channel]);
            state.upsampleState[channel].fill(0);
            state.downsampleState[channel].fill(0);
            if (!preserveDryPath) state.dryDelay[channel].fill(0);
            state.feedback[channel].s1 = 0;
            state.feedback[channel].s2 = 0;
            state.feedback[channel].transport.fill(0);
            state.feedback[channel].transportIndex = 0;
            state.bypassDrive[channel] = 0;
        }
        state.controls.plateReference = state.fast[0].stage[1].plateVoltage;
    }

    function cancelFeedbackTransition(state) {
        state.feedbackTransition.active = false;
        state.feedbackTransition.phase = 0;
        state.feedbackTransition.progress = 0;
        state.feedbackTransition.currentTrace = -1;
        state.feedbackTransition.activeGeneration = 0;
        state.feedbackTransition.stateGeneration = 0;
        state.feedbackTransition.pendingGeneration = 0;
        state.feedbackTransition.queuedGeneration = 0;
        state.feedbackTransition.nextGeneration = 1;
        state.feedbackTransition.resetCount = 0;
        state.feedbackTransition.atomicCommitCount = 0;
        state.pendingParameters = null;
        state.queuedParameters = null;
    }

    // Clears the accumulated reduction. Reached from a committed safety-trim change or from a
    // commit that changes two or more values at once (a preset load); a model reset and a fault
    // recovery deliberately do not clear it.
    function resetSafetyReduction(state) {
        const safety = state.outputSafety;
        safety.gain = 1;
        safety.target = 1;
        safety.step = 0;
        safety.remaining = 0;
    }

    // Lowers the standing target to whatever would have brought this one sample back to full
    // scale. A sample at or below full scale needs nothing, and taking the minimum against the
    // standing target is what makes the law monotone - the reduction only ever deepens.
    function observeSafetyPeak(safety, sample) {
        const magnitude = sample < 0 ? -sample : sample;
        if (magnitude > K.safetyPeakThreshold) {
            const candidate = K.safetyPeakThreshold / magnitude;
            if (candidate < safety.target) {
                safety.target = candidate;
            }
        }
    }

    // Observes one frame of the post-model wet chain and returns the reduction to apply to it.
    //
    // The measurement is open loop - it sees the chain before the reduction is applied - so
    // 1 / |sample| is exactly the gain that would have brought that sample to full scale, and no
    // result of the reduction re-enters the measurement. Only a comparison and a division run per
    // sample: no log, no pow, nothing the two engines could round apart. Both channels of the
    // frame are observed, left then right, before the ramp is re-armed at most once for the frame.
    function advanceSafetyReduction(state, left, right) {
        const safety = state.outputSafety;
        if (!state.parameters.autoGainReduction) {
            // Frozen: nothing is observed, nothing is decided, and whatever reduction is already
            // in force stays in force, mid-ramp or not.
            return safety.gain;
        }
        const standingTarget = safety.target;
        observeSafetyPeak(safety, left);
        observeSafetyPeak(safety, right);
        if (safety.target < standingTarget) {
            // Re-armed only when the target actually drops. The step is divided once, here, and
            // only added from now on.
            safety.remaining = safety.rampFrames;
            safety.step = (safety.target - safety.gain) / safety.remaining;
        }
        if (safety.remaining !== 0) {
            safety.gain += safety.step;
            --safety.remaining;
            if (safety.remaining === 0) {
                safety.gain = safety.target;
            }
        }
        return safety.gain;
    }

    function resetModel(state) {
        cancelFeedbackTransition(state);
        state.observedFiniteFaults = 0;
        state.observedSafetyLimits = 0;
        state.observedMaximumFastKclResidual = 0;
        state.observedMaximumSlowKclResidual = 0;
        state.observedMaximumDcResidual = 0;
        resetRuntimeState(state, false, false);
    }

    function createState(decoded, formalDebug) {
        const state = {
            tables: TUBES.map(makeTubeTables),
            coefficients: designFir(),
            tubeIndex: decoded.tubeIndex,
            parameters: decoded,
            cathodeResistance: K.baseCathodeResistance,
            plateResistance: K.basePlateResistance,
            sourceResistance: 10000,
            supplyResistance: 10000,
            supplyCapacitance: 22e-6,
            supplyVoltage: 250,
            fast: [makeFastChannel(), makeFastChannel()],
            // Carried between the two halves of one driver sample; nothing here survives a sample
            // boundary. It exists so the Power branch can read this sample's feedback tap before
            // the compensator runs.
            driverSplit: [
                { second: null, iCout: 0, output: 0 },
                { second: null, iCout: 0, output: 0 }
            ],
            slow: [makeSlowState(), makeSlowState()],
            accumulator: [makeAccumulator(), makeAccumulator()],
            power: [makePowerState(), makePowerState()],
            // A one-fast-sample causal handoff replaces the skipped driver's inherent delay.
            // This lets the power tap be observed before the current input closes the NFB loop.
            bypassDrive: [0, 0],
            // Same defaults the kernel's members carry, so a branch that never commits Power
            // parameters still has a profile for the reset seed to read.
            powerProfileIndex: 2,
            powerProfile: POWER_TABLES.profiles[2],
            powerSpeaker: POWER_TABLES.speakers[1],
            powerSpeakerScale: 1,
            powerPrimaryOhm: 8000,
            powerSelectedTurnsRatio: Math.sqrt(1000),
            powerLtpQuiescent: {
                inputCapacitorV: 0, cathodeV: 0, plateV: 0, gridCouplingV: 0
            },
            recoveryFast: [makeFastChannel(), makeFastChannel()],
            recoverySlow: [makeSlowState(), makeSlowState()],
            controls: {},
            // Output-stage safety reduction. Monotone: gain and target only ever move downward,
            // and nothing outside a safety-trim change restores them.
            outputSafety: {
                gain: 1,
                target: 1,
                step: 0,
                remaining: 0,
                rampFrames: Math.max(1, Math.ceil(
                    K.hostRate * K.safetyRampMilliseconds / 1000
                ))
            },
            // Last committed parameter set, held as a copy because the applied record is mutated
            // in place. The safety-reduction reset rule is a value difference against this, not a
            // write edge: the host recommits the whole parameter block every process call, so an
            // edge-driven reset would fire on writes that carry identical values.
            //
            // Allocated once here and overwritten field by field on every commit, because the
            // commit runs on the audio thread.
            committedParameters: {
                driveDb: decoded.driveDb,
                tubeIndex: decoded.tubeIndex,
                biasPercent: decoded.biasPercent,
                plateV: decoded.plateV,
                sourceZKOhm: decoded.sourceZKOhm,
                supplyKOhm: decoded.supplyKOhm,
                outputDb: decoded.outputDb,
                mixPercent: decoded.mixPercent,
                inputReference: decoded.inputReference,
                feedbackDb: decoded.feedbackDb,
                outputStage: decoded.outputStage,
                powerTube: decoded.powerTube,
                powerBPlus: decoded.powerBPlus,
                cathodeResistor: decoded.cathodeResistor,
                screenTap: decoded.screenTap,
                primaryImpedance: decoded.primaryImpedance,
                speakerLoad: decoded.speakerLoad,
                actualLoadOhm: decoded.actualLoadOhm,
                safetyTrimDb: decoded.safetyTrimDb,
                autoGainReduction: decoded.autoGainReduction,
                seTube: decoded.seTube,
                seBPlus: decoded.seBPlus,
                seCathodeResistor: decoded.seCathodeResistor,
                sePrimaryImpedance: decoded.sePrimaryImpedance
            },
            feedback: [
                {
                    s1: 0,
                    s2: 0,
                    transport: new Float64Array(1),
                    transportIndex: 0
                },
                {
                    s1: 0,
                    s2: 0,
                    transport: new Float64Array(1),
                    transportIndex: 0
                }
            ],
            upsampleState: [
                new Float64Array(K.upsampleHistory),
                new Float64Array(K.upsampleHistory)
            ],
            downsampleState: [
                new Float64Array(K.downsampleHistory),
                new Float64Array(K.downsampleHistory)
            ],
            dryDelay: [
                new Float64Array(K.dryDelayFrames),
                new Float64Array(K.dryDelayFrames)
            ],
            telemetry: new Float64Array(10),
            slowPublishCount: 0,
            finiteFaults: 0,
            safetyLimits: 0,
            observedFiniteFaults: 0,
            observedSafetyLimits: 0,
            observedMaximumFastKclResidual: 0,
            observedMaximumSlowKclResidual: 0,
            observedMaximumDcResidual: 0,
            stepSafetyHit: false,
            blockFiniteFault: false,
            blockSafetyHit: false,
            maximumFastKclResidual: 0,
            maximumFastKclNode: null,
            maximumFastKclChannel: -1,
            maximumFastKclHostFrame: -1,
            maximumFastKclInternalFrame: -1,
            maximumFastKclInternalPhase: -1,
            currentFastKclHostFrame: 0,
            currentFastKclInternalFrame: 0,
            currentFastKclInternalPhase: 0,
            maximumSlowKclResidual: 0,
            maximumDcResidual: 0,
            maximumEnergyResidual: 0,
            diagnostic: null,
            detectorProbe: {
                enabled: false,
                inputEnergy: 0,
                outputEnergy: 0,
                feedbackEnergy: 0,
                inputSamples: 0,
                outputSamples: 0,
                feedbackSamples: 0
            },
            feedbackDetector: {
                inputEnergy: 0,
                outputEnergy: 0,
                feedbackEnergy: 0,
                previousInputRms: 0,
                previousOutputRms: 0,
                previousFeedbackRms: 0,
                samples: 0,
                growthCount: 0,
                sustainedCount: 0,
                hasPrevious: false,
                sustainedInputEnergy: 0,
                sustainedOutputEnergy: 0,
                sustainedFeedbackEnergy: 0,
                sustainedPreviousInputRms: 0,
                sustainedPreviousOutputRms: 0,
                sustainedPreviousFeedbackRms: 0,
                sustainedSpan: 0,
                sustainedHasPrevious: false,
                windows: [],
                overflow: false
            },
            runtimeEvent: {
                generation: 0,
                latched: 0,
                cause: 0
            },
            fault: {
                state: 0,
                wet: 1,
                muteRemaining: 0,
                trialRemaining: 0,
                returnRemaining: 0,
                clearPending: false,
                resetPending: false,
                trialAfterReset: false,
                pendingParameters: null,
                detectionOffset: null,
                detectionFrame: null,
                muteCompleteFrame: null,
                trialObservationStartFrame: null
            },
            centralReset: {
                count: 0,
                reason: 0
            },
            dryIndex: 0,
            processedHostFrames: 0,
            pendingParameters: null,
            queuedParameters: null,
            feedbackTransition: {
                active: false,
                phase: 0,
                progress: 0,
                fadeOutFrames: Math.ceil(
                    K.hostRate * K.feedbackFadeMilliseconds / 1000
                ),
                warmupFrames: Math.ceil(
                    K.hostRate * K.feedbackWarmupMilliseconds / 1000
                ),
                fadeInFrames: Math.ceil(
                    K.hostRate * K.feedbackFadeMilliseconds / 1000
                ),
                activeGeneration: 0,
                stateGeneration: 0,
                pendingGeneration: 0,
                queuedGeneration: 0,
                nextGeneration: 1,
                resetCount: 0,
                atomicCommitCount: 0,
                traceCount: 0,
                currentTrace: -1,
                startFrames: new Int32Array(16),
                resetFrames: new Int32Array(16),
                fadeInFramesTrace: new Int32Array(16),
                endFrames: new Int32Array(16),
                resetCounts: new Int32Array(16),
                generations: new Int32Array(16),
                atomicControlCommits: new Int32Array(16),
                boundaryCount: 0,
                boundaryOverflow: false,
                boundaryFrames: formalDebug ? new Int32Array(64) : null,
                boundaryStates: formalDebug
                    ? new Float64Array(64 * 12)
                    : null,
                boundaryParameters: formalDebug
                    ? new Float64Array(64 * 17)
                    : null,
                boundaryCalibrations: formalDebug
                    ? new Float64Array(64 * 9)
                    : null,
                boundaryCentralResets: formalDebug
                    ? new Float64Array(64 * 2)
                    : null,
                warmupWetFrames: 0,
                warmupAlignedDryMismatches: 0,
                oldStateNewNfProcessCount: 0,
                transitionOwnedAllocationCount: 0
            }
        };
        resetModel(state);
        state.reset = () => {
            if (state.runtimeEvent.latched === 0) {
                cancelFeedbackTransition(state);
                resetModel(state);
            }
        };
        state.beginBreakLoopImpulse = (amplitude, captureSamples) => {
            if (!Number.isFinite(amplitude) || amplitude === 0 ||
                !Number.isInteger(captureSamples) || captureSamples < 1) {
                throw new Error('Invalid break-loop impulse configuration');
            }
            const plateReference = state.controls.plateReference;
            for (let channel = 0; channel < K.channels; ++channel) {
                state.feedback[channel].transport.fill(plateReference);
                state.feedback[channel].transportIndex = 0;
            }
            state.diagnostic = {
                kind: 'break-loop-impulse',
                amplitude,
                captureSamples,
                sample: 0,
                detectorResponse: [],
                outputResponse: []
            };
        };
        state.breakLoopImpulse = () => {
            if (!state.diagnostic ||
                state.diagnostic.kind !== 'break-loop-impulse') {
                return null;
            }
            return {
                amplitude: state.diagnostic.amplitude,
                captureSamples: state.diagnostic.captureSamples,
                sample: state.diagnostic.sample,
                detectorResponse:
                    Array.from(state.diagnostic.detectorResponse),
                outputResponse:
                    Array.from(state.diagnostic.outputResponse)
            };
        };
        state.endDiagnostic = () => {
            state.diagnostic = null;
        };
        state.beginDetectorProbe = () => {
            state.detectorProbe.enabled = true;
            state.detectorProbe.inputEnergy = 0;
            state.detectorProbe.outputEnergy = 0;
            state.detectorProbe.feedbackEnergy = 0;
            state.detectorProbe.inputSamples = 0;
            state.detectorProbe.outputSamples = 0;
            state.detectorProbe.feedbackSamples = 0;
        };
        state.readDetectorProbe = () => {
            const probe = state.detectorProbe;
            if (!probe.enabled) return null;
            const result = {
                inputRms: probe.inputSamples === 0
                    ? 0
                    : Math.sqrt(probe.inputEnergy / probe.inputSamples),
                outputRms: probe.outputSamples === 0
                    ? 0
                    : Math.sqrt(probe.outputEnergy / probe.outputSamples),
                feedbackRms: probe.feedbackSamples === 0
                    ? 0
                    : Math.sqrt(
                        probe.feedbackEnergy / probe.feedbackSamples
                    ),
                inputSamples: probe.inputSamples,
                outputSamples: probe.outputSamples,
                feedbackSamples: probe.feedbackSamples
            };
            probe.inputEnergy = 0;
            probe.outputEnergy = 0;
            probe.feedbackEnergy = 0;
            probe.inputSamples = 0;
            probe.outputSamples = 0;
            probe.feedbackSamples = 0;
            return result;
        };
        state.endDetectorProbe = () => {
            state.detectorProbe.enabled = false;
            state.detectorProbe.inputEnergy = 0;
            state.detectorProbe.outputEnergy = 0;
            state.detectorProbe.feedbackEnergy = 0;
            state.detectorProbe.inputSamples = 0;
            state.detectorProbe.outputSamples = 0;
            state.detectorProbe.feedbackSamples = 0;
        };
        state.checkpoint = () => ({
            accumulator: [
                state.accumulator[0].uK1,
                state.accumulator[0].uK2,
                state.accumulator[0].uP,
                state.accumulator[0].count,
                state.accumulator[1].uK1,
                state.accumulator[1].uK2,
                state.accumulator[1].uP,
                state.accumulator[1].count
            ],
            slowState: [
                state.slow[0].cathode[0].voltage,
                state.slow[0].cathode[1].voltage,
                state.slow[0].supply.voltage,
                state.slow[1].cathode[0].voltage,
                state.slow[1].cathode[1].voltage,
                state.slow[1].supply.voltage
            ],
            slowPublishCount: state.slowPublishCount,
            controls: [
                state.controls.drive,
                state.controls.output,
                state.controls.mix
            ],
            controlTargets: [
                state.controls.driveTarget,
                state.controls.outputTarget,
                state.controls.mixTarget
            ],
            // The kernel hashes all four output-safety scalars into its state digest, so the
            // checkpoint has to carry them too. Without them the five-path digest comparison
            // cannot see a JavaScript/C++ divergence in this mechanism at all.
            outputSafety: [
                state.outputSafety.gain,
                state.outputSafety.target,
                state.outputSafety.step,
                state.outputSafety.remaining
            ],
            safetyUserTarget: state.controls.safetyUserTarget,
            firCoefficients: Array.from(state.coefficients),
            telemetry: Array.from(state.telemetry),
            dryIndex: state.dryIndex,
            processedHostFrames: state.processedHostFrames,
            finiteFaults: state.finiteFaults,
            safetyLimits: state.safetyLimits,
            observedFiniteFaults: state.observedFiniteFaults,
            observedSafetyLimits: state.observedSafetyLimits,
            observedMaximumFastKclResidual:
                state.observedMaximumFastKclResidual,
            observedMaximumSlowKclResidual:
                state.observedMaximumSlowKclResidual,
            observedMaximumDcResidual: state.observedMaximumDcResidual,
            maximumFastKclResidual: state.maximumFastKclResidual,
            maximumFastKclObservation: {
                residualA: state.maximumFastKclResidual,
                node: state.maximumFastKclNode,
                channel: state.maximumFastKclChannel,
                hostFrame: state.maximumFastKclHostFrame,
                internalFrame: state.maximumFastKclInternalFrame,
                internalPhase: state.maximumFastKclInternalPhase
            },
            maximumSlowKclResidual: state.maximumSlowKclResidual,
            maximumDcResidual: state.maximumDcResidual,
            maximumEnergyResidual: state.maximumEnergyResidual,
            powerState: state.power.map(power => ({
                ...power,
                cathodePushRamp: { ...power.cathodePushRamp },
                cathodePullRamp: { ...power.cathodePullRamp },
                bPlusRamp: { ...power.bPlusRamp },
                screenRamp: { ...power.screenRamp }
            })),
            powerProfileIndex: state.powerProfileIndex,
            feedback: state.feedback.map(filter => ({
                s1: filter.s1,
                s2: filter.s2,
                transport: Array.from(filter.transport),
                transportIndex: filter.transportIndex
            })),
            fastState: state.fast.map(channel => ({
                stage: channel.stage.map(stage => ({ ...stage })),
                outputCouplingCharge: channel.outputCouplingCharge,
                outputLoadCurrent: channel.outputLoadCurrent
            })),
            plateReference: state.controls.plateReference,
            activeParameters: { ...state.parameters },
            feedbackDb: state.controls.feedbackDb,
            feedbackQ: state.controls.feedbackQ,
            feedbackCalibration: {
                b0: state.controls.feedbackB0,
                b1: state.controls.feedbackB1,
                a1: state.controls.feedbackA1,
                a2: state.controls.feedbackA2,
                a0: state.controls.feedbackA0,
                beta: state.controls.feedbackBeta,
                makeup: state.controls.feedbackMakeup,
                binary64Sha256: FEEDBACK_TABLE_BINARY64_SHA256
            },
            runtimeEvent: [
                state.runtimeEvent.generation,
                state.runtimeEvent.latched,
                state.runtimeEvent.cause
            ],
            fault: {
                state: state.fault.state,
                wet: state.fault.wet,
                muteRemaining: state.fault.muteRemaining,
                trialRemaining: state.fault.trialRemaining,
                returnRemaining: state.fault.returnRemaining,
                detectionFrame: state.fault.detectionFrame,
                muteCompleteFrame: state.fault.muteCompleteFrame,
                trialObservationStartFrame:
                    state.fault.trialObservationStartFrame
            },
            detectorWindows: state.feedbackDetector.windows.map(
                window => ({
                    ...window,
                    previousRms: [...window.previousRms],
                    rms: [...window.rms],
                    runtimeEvent: [...window.runtimeEvent]
                })
            ),
            detectorTraceOverflow: state.feedbackDetector.overflow,
            centralReset: [
                state.centralReset.count,
                state.centralReset.reason
            ],
            feedbackTransition: {
                active: state.feedbackTransition.active,
                phase: state.feedbackTransition.phase,
                progress: state.feedbackTransition.progress,
                fadeOutFrames: state.feedbackTransition.fadeOutFrames,
                warmupFrames: state.feedbackTransition.warmupFrames,
                fadeInFrames: state.feedbackTransition.fadeInFrames,
                cycleFrames:
                    state.feedbackTransition.fadeOutFrames +
                    state.feedbackTransition.warmupFrames +
                    state.feedbackTransition.fadeInFrames,
                activeGeneration:
                    state.feedbackTransition.activeGeneration,
                stateGeneration:
                    state.feedbackTransition.stateGeneration,
                pendingGeneration:
                    state.feedbackTransition.pendingGeneration,
                queuedGeneration:
                    state.feedbackTransition.queuedGeneration,
                nextGeneration:
                    state.feedbackTransition.nextGeneration,
                pendingParameters: state.pendingParameters
                    ? { ...state.pendingParameters }
                    : null,
                queuedParameters: state.queuedParameters
                    ? { ...state.queuedParameters }
                    : null,
                warmupWetFrames:
                    state.feedbackTransition.warmupWetFrames,
                warmupAlignedDryMismatches:
                    state.feedbackTransition.warmupAlignedDryMismatches,
                oldStateNewNfProcessCount:
                    state.feedbackTransition.oldStateNewNfProcessCount,
                resetCount: state.feedbackTransition.resetCount,
                atomicCommitCount:
                    state.feedbackTransition.atomicCommitCount,
                transitionOwnedAllocationCount:
                    state.feedbackTransition.transitionOwnedAllocationCount,
                traceCount: state.feedbackTransition.traceCount,
                startFrames: Array.from(
                    state.feedbackTransition.startFrames.subarray(
                        0,
                        state.feedbackTransition.traceCount
                    )
                ),
                resetFrames: Array.from(
                    state.feedbackTransition.resetFrames.subarray(
                        0,
                        state.feedbackTransition.traceCount
                    )
                ),
                fadeInStartFrames: Array.from(
                    state.feedbackTransition.fadeInFramesTrace.subarray(
                        0,
                        state.feedbackTransition.traceCount
                    )
                ),
                endFrames: Array.from(
                    state.feedbackTransition.endFrames.subarray(
                        0,
                        state.feedbackTransition.traceCount
                    )
                ),
                resetCounts: Array.from(
                    state.feedbackTransition.resetCounts.subarray(
                        0,
                        state.feedbackTransition.traceCount
                    )
                ),
                generations: Array.from(
                    state.feedbackTransition.generations.subarray(
                        0,
                        state.feedbackTransition.traceCount
                    )
                ),
                atomicControlCommits: Array.from(
                    state.feedbackTransition.atomicControlCommits.subarray(
                        0,
                        state.feedbackTransition.traceCount
                    )
                ),
                ...(state.feedbackTransition.boundaryFrames
                    ? {
                        boundaryOverflow:
                            state.feedbackTransition.boundaryOverflow,
                        boundaries: Array.from(
                            {
                                length:
                                    state.feedbackTransition.boundaryCount
                            },
                            (_, index) => ({
                                index,
                                frame: state.feedbackTransition
                                    .boundaryFrames[index],
                                transition: Array.from(
                                    state.feedbackTransition
                                        .boundaryStates.subarray(
                                            index * 12,
                                            index * 12 + 12
                                        )
                                ),
                                appliedParameters: Array.from(
                                    state.feedbackTransition
                                        .boundaryParameters.subarray(
                                            index * 17,
                                            index * 17 + 17
                                        )
                                ),
                                feedbackCalibration: Array.from(
                                    state.feedbackTransition
                                        .boundaryCalibrations.subarray(
                                            index * 9,
                                            index * 9 + 9
                                        )
                                ),
                                centralReset: Array.from(
                                    state.feedbackTransition
                                        .boundaryCentralResets.subarray(
                                            index * 2,
                                            index * 2 + 2
                                        )
                                )
                            })
                        )
                    }
                    : {})
            },
            diagnostic: state.diagnostic ? {
                kind: state.diagnostic.kind,
                sample: state.diagnostic.sample,
                captureSamples: state.diagnostic.captureSamples
            } : null
        });
        return state;
    }

    function captureTransitionBoundary(state) {
        const transition = state.feedbackTransition;
        if (!transition.boundaryFrames) return;
        const index = transition.boundaryCount;
        if (index >= transition.boundaryFrames.length) {
            transition.boundaryOverflow = true;
            return;
        }
        transition.boundaryCount = index + 1;
        transition.boundaryFrames[index] = state.processedHostFrames;
        const stateOffset = index * 12;
        const boundaryStates = transition.boundaryStates;
        boundaryStates[stateOffset] = transition.phase;
        boundaryStates[stateOffset + 1] = transition.progress;
        boundaryStates[stateOffset + 2] =
            transition.activeGeneration;
        boundaryStates[stateOffset + 3] =
            transition.stateGeneration;
        boundaryStates[stateOffset + 4] =
            transition.pendingGeneration;
        boundaryStates[stateOffset + 5] =
            transition.queuedGeneration;
        boundaryStates[stateOffset + 6] = transition.nextGeneration;
        boundaryStates[stateOffset + 7] = transition.resetCount;
        boundaryStates[stateOffset + 8] =
            transition.atomicCommitCount;
        boundaryStates[stateOffset + 9] =
            transition.warmupWetFrames;
        boundaryStates[stateOffset + 10] =
            transition.warmupAlignedDryMismatches;
        boundaryStates[stateOffset + 11] =
            transition.oldStateNewNfProcessCount;
        const parameters = state.parameters;
        const parameterOffset = index * 17;
        const boundaryParameters = transition.boundaryParameters;
        boundaryParameters[parameterOffset] = parameters.driveDb;
        boundaryParameters[parameterOffset + 1] =
            parameters.tubeIndex;
        boundaryParameters[parameterOffset + 2] =
            parameters.biasPercent;
        boundaryParameters[parameterOffset + 3] = parameters.plateV;
        boundaryParameters[parameterOffset + 4] =
            parameters.sourceZKOhm;
        boundaryParameters[parameterOffset + 5] =
            parameters.supplyKOhm;
        boundaryParameters[parameterOffset + 6] =
            parameters.outputDb;
        boundaryParameters[parameterOffset + 7] =
            parameters.mixPercent;
        boundaryParameters[parameterOffset + 8] =
            parameters.inputReference;
        boundaryParameters[parameterOffset + 9] =
            parameters.feedbackDb;
        boundaryParameters[parameterOffset + 10] = parameters.outputStage;
        boundaryParameters[parameterOffset + 11] = parameters.powerTube;
        boundaryParameters[parameterOffset + 12] = parameters.powerBPlus;
        boundaryParameters[parameterOffset + 13] = parameters.cathodeResistor;
        boundaryParameters[parameterOffset + 14] = parameters.screenTap;
        boundaryParameters[parameterOffset + 15] = parameters.primaryImpedance;
        boundaryParameters[parameterOffset + 16] = parameters.speakerLoad;
        const controls = state.controls;
        const calibrationOffset = index * 9;
        const boundaryCalibrations =
            transition.boundaryCalibrations;
        boundaryCalibrations[calibrationOffset] =
            controls.feedbackDb;
        boundaryCalibrations[calibrationOffset + 1] =
            controls.feedbackQ;
        boundaryCalibrations[calibrationOffset + 2] =
            controls.feedbackB0;
        boundaryCalibrations[calibrationOffset + 3] =
            controls.feedbackB1;
        boundaryCalibrations[calibrationOffset + 4] =
            controls.feedbackA1;
        boundaryCalibrations[calibrationOffset + 5] =
            controls.feedbackA2;
        boundaryCalibrations[calibrationOffset + 6] =
            controls.feedbackA0;
        boundaryCalibrations[calibrationOffset + 7] =
            controls.feedbackBeta;
        boundaryCalibrations[calibrationOffset + 8] =
            controls.feedbackMakeup;
        const resetOffset = index * 2;
        transition.boundaryCentralResets[resetOffset] =
            state.centralReset.count;
        transition.boundaryCentralResets[resetOffset + 1] =
            state.centralReset.reason;
    }

    function beginFeedbackTransition(state, decoded, generation) {
        const transition = state.feedbackTransition;
        let trace = transition.traceCount;
        if (trace < transition.startFrames.length) {
            ++transition.traceCount;
        } else {
            trace = transition.startFrames.length - 1;
        }
        transition.startFrames[trace] = state.processedHostFrames;
        transition.resetFrames[trace] = -1;
        transition.fadeInFramesTrace[trace] = -1;
        transition.endFrames[trace] = -1;
        transition.resetCounts[trace] = 0;
        transition.atomicControlCommits[trace] = 0;
        transition.currentTrace = trace;
        transition.progress = 0;
        transition.phase = 1;
        transition.active = true;
        transition.pendingGeneration = generation ??
            transition.nextGeneration++;
        transition.generations[trace] =
            transition.pendingGeneration;
        state.pendingParameters = decoded;
        captureTransitionBoundary(state);
    }

    function applyFeedbackTransitionReset(state) {
        const transition = state.feedbackTransition;
        if (!transition.active || transition.phase !== 1 ||
            !state.pendingParameters) {
            return;
        }
        const committed = state.pendingParameters;
        state.parameters = committed;
        state.pendingParameters = null;
        transition.activeGeneration =
            transition.pendingGeneration;
        transition.pendingGeneration = 0;
        dispatchCentralReset(state, 1);
        transition.stateGeneration =
            transition.activeGeneration;
        transition.phase = 2;
        transition.progress = 0;
        transition.resetFrames[transition.currentTrace] =
            state.processedHostFrames;
        transition.resetCounts[transition.currentTrace] = 1;
        transition.atomicControlCommits[transition.currentTrace] =
            state.parameters === committed &&
            state.parameters.driveDb === committed.driveDb &&
            state.parameters.tubeIndex === committed.tubeIndex &&
            state.parameters.biasPercent === committed.biasPercent &&
            state.parameters.plateV === committed.plateV &&
            state.parameters.sourceZKOhm === committed.sourceZKOhm &&
            state.parameters.supplyKOhm === committed.supplyKOhm &&
            state.parameters.outputDb === committed.outputDb &&
            state.parameters.mixPercent === committed.mixPercent &&
            state.parameters.inputReference === committed.inputReference &&
            state.parameters.feedbackDb === committed.feedbackDb &&
            state.tubeIndex === committed.tubeIndex &&
            state.supplyVoltage === committed.plateV &&
            state.sourceResistance === 1000 * committed.sourceZKOhm &&
            state.supplyResistance === 1000 * committed.supplyKOhm &&
            state.controls.driveTarget ===
                committed.inputReference *
                    Math.pow(10, committed.driveDb / 20) &&
            state.controls.outputTarget ===
                Math.pow(10, committed.outputDb / 20) &&
            state.controls.mixTarget === committed.mixPercent / 100 &&
            state.controls.drive === state.controls.driveTarget &&
            state.controls.output === state.controls.outputTarget &&
            state.controls.mix === state.controls.mixTarget &&
            state.controls.feedbackDb === committed.feedbackDb &&
            Number.isFinite(state.controls.feedbackQ) &&
            Number.isFinite(state.controls.feedbackB0) &&
            Number.isFinite(state.controls.feedbackB1) &&
            Number.isFinite(state.controls.feedbackA1) &&
            Number.isFinite(state.controls.feedbackA2) &&
            Number.isFinite(state.controls.feedbackA0) &&
            Number.isFinite(state.controls.feedbackBeta) &&
            Number.isFinite(state.controls.feedbackMakeup)
                ? 1
                : 0;
        ++transition.resetCount;
        transition.atomicCommitCount +=
            transition.atomicControlCommits[transition.currentTrace];
        captureTransitionBoundary(state);
    }

    function finishFeedbackTransition(state) {
        const transition = state.feedbackTransition;
        transition.endFrames[transition.currentTrace] =
            state.processedHostFrames;
        transition.active = false;
        transition.phase = 0;
        transition.progress = 0;
        transition.currentTrace = -1;
        state.pendingParameters = null;
        transition.pendingGeneration = 0;
        captureTransitionBoundary(state);
        if (state.queuedParameters) {
            const queued = state.queuedParameters;
            const generation = transition.queuedGeneration;
            state.queuedParameters = null;
            transition.queuedGeneration = 0;
            beginFeedbackTransition(state, queued, generation);
        }
    }

    function resetClassChanged(left, right) {
        if (left.outputStage !== right.outputStage) return true;
        if (left.feedbackDb !== right.feedbackDb || left.tubeIndex !== right.tubeIndex) return true;
        if (left.outputStage === 1) {
            return left.powerTube !== right.powerTube || left.screenTap !== right.screenTap;
        }
        return left.outputStage === 2 && left.seTube !== right.seTube;
    }

    // Number of active parameter values that differ. Used only by the safety-reduction reset rule,
    // which needs to tell one control write from a whole-record write. A stage change retains the
    // original all-field count so loading a cross-topology preset still clears the reduction.
    // Written out rather than looped over a field list because a list literal would allocate on
    // the audio thread every commit.
    function changedParameterCount(left, right) {
        let count = 0;
        if (left.driveDb !== right.driveDb) ++count;
        if (left.tubeIndex !== right.tubeIndex) ++count;
        if (left.biasPercent !== right.biasPercent) ++count;
        if (left.plateV !== right.plateV) ++count;
        if (left.sourceZKOhm !== right.sourceZKOhm) ++count;
        if (left.supplyKOhm !== right.supplyKOhm) ++count;
        if (left.outputDb !== right.outputDb) ++count;
        if (left.mixPercent !== right.mixPercent) ++count;
        if (left.inputReference !== right.inputReference) ++count;
        if (left.feedbackDb !== right.feedbackDb) ++count;
        if (left.safetyTrimDb !== right.safetyTrimDb) ++count;
        if (left.autoGainReduction !== right.autoGainReduction) ++count;
        const stageChanged = left.outputStage !== right.outputStage;
        if (stageChanged) ++count;
        if (stageChanged || left.outputStage === 1) {
            if (left.powerTube !== right.powerTube) ++count;
            if (left.powerBPlus !== right.powerBPlus) ++count;
            if (left.cathodeResistor !== right.cathodeResistor) ++count;
            if (left.screenTap !== right.screenTap) ++count;
            if (left.primaryImpedance !== right.primaryImpedance) ++count;
        }
        if (stageChanged || left.outputStage !== 0) {
            if (left.speakerLoad !== right.speakerLoad) ++count;
            if (left.actualLoadOhm !== right.actualLoadOhm) ++count;
        }
        if (stageChanged || left.outputStage === 2) {
            if (left.seTube !== right.seTube) ++count;
            if (left.seBPlus !== right.seBPlus) ++count;
            if (left.seCathodeResistor !== right.seCathodeResistor) ++count;
            if (left.sePrimaryImpedance !== right.sePrimaryImpedance) ++count;
        }
        return count;
    }

    // Overwrites the pre-allocated commit snapshot in place. Field by field for the same reason:
    // this runs on the audio thread, where nothing may allocate.
    function copyDecodedParameters(target, source) {
        target.driveDb = source.driveDb;
        target.tubeIndex = source.tubeIndex;
        target.biasPercent = source.biasPercent;
        target.plateV = source.plateV;
        target.sourceZKOhm = source.sourceZKOhm;
        target.supplyKOhm = source.supplyKOhm;
        target.outputDb = source.outputDb;
        target.mixPercent = source.mixPercent;
        target.inputReference = source.inputReference;
        target.feedbackDb = source.feedbackDb;
        target.outputStage = source.outputStage;
        target.powerTube = source.powerTube;
        target.powerBPlus = source.powerBPlus;
        target.cathodeResistor = source.cathodeResistor;
        target.screenTap = source.screenTap;
        target.primaryImpedance = source.primaryImpedance;
        target.speakerLoad = source.speakerLoad;
        target.actualLoadOhm = source.actualLoadOhm;
        target.safetyTrimDb = source.safetyTrimDb;
        target.autoGainReduction = source.autoGainReduction;
        target.seTube = source.seTube;
        target.seBPlus = source.seBPlus;
        target.seCathodeResistor = source.seCathodeResistor;
        target.sePrimaryImpedance = source.sePrimaryImpedance;
    }

    function trialEligibleChanged(left, right) {
        if (resetClassChanged(left, right) ||
            left.biasPercent !== right.biasPercent ||
            left.plateV !== right.plateV ||
            left.sourceZKOhm !== right.sourceZKOhm ||
            left.supplyKOhm !== right.supplyKOhm ||
            left.inputReference !== right.inputReference) return true;
        if (left.outputStage === 1) {
            return left.powerBPlus !== right.powerBPlus ||
                left.cathodeResistor !== right.cathodeResistor ||
                left.primaryImpedance !== right.primaryImpedance ||
                left.speakerLoad !== right.speakerLoad ||
                left.actualLoadOhm !== right.actualLoadOhm;
        }
        if (left.outputStage === 2) {
            return left.seBPlus !== right.seBPlus ||
                left.seCathodeResistor !== right.seCathodeResistor ||
                left.sePrimaryImpedance !== right.sePrimaryImpedance ||
                left.speakerLoad !== right.speakerLoad ||
                left.actualLoadOhm !== right.actualLoadOhm;
        }
        return false;
    }

    function fastAutomationOnlyChanged(left, right) {
        return left.tubeIndex === right.tubeIndex &&
            left.biasPercent === right.biasPercent &&
            left.plateV === right.plateV &&
            left.sourceZKOhm === right.sourceZKOhm &&
            left.supplyKOhm === right.supplyKOhm &&
            left.feedbackDb === right.feedbackDb &&
            left.outputStage === right.outputStage &&
            left.powerTube === right.powerTube &&
            left.powerBPlus === right.powerBPlus &&
            left.cathodeResistor === right.cathodeResistor &&
            left.screenTap === right.screenTap &&
            left.primaryImpedance === right.primaryImpedance &&
            left.speakerLoad === right.speakerLoad &&
            left.actualLoadOhm === right.actualLoadOhm &&
            left.autoGainReduction === right.autoGainReduction &&
            left.seTube === right.seTube &&
            left.seBPlus === right.seBPlus &&
            left.seCathodeResistor === right.seCathodeResistor &&
            left.sePrimaryImpedance === right.sePrimaryImpedance;
    }

    function applyFastAutomationParameters(state, decoded) {
        state.parameters.driveDb = decoded.driveDb;
        state.parameters.outputDb = decoded.outputDb;
        state.parameters.mixPercent = decoded.mixPercent;
        state.parameters.inputReference = decoded.inputReference;
        state.parameters.safetyTrimDb = decoded.safetyTrimDb;
        const controls = state.controls;
        controls.driveTarget = decoded.inputReference *
            Math.pow(10, decoded.driveDb / 20);
        controls.outputTarget = Math.pow(10, decoded.outputDb / 20);
        controls.mixTarget = decoded.mixPercent / 100;
        controls.inputReferenceTarget = decoded.inputReference;
        controls.safetyUserTarget = Math.pow(10, decoded.safetyTrimDb / 20);
    }

    function copyNonResetParameters(target, source) {
        target.driveDb = source.driveDb;
        target.biasPercent = source.biasPercent;
        target.plateV = source.plateV;
        target.sourceZKOhm = source.sourceZKOhm;
        target.supplyKOhm = source.supplyKOhm;
        target.outputDb = source.outputDb;
        target.mixPercent = source.mixPercent;
        target.inputReference = source.inputReference;
        target.powerBPlus = source.powerBPlus;
        target.cathodeResistor = source.cathodeResistor;
        target.primaryImpedance = source.primaryImpedance;
        target.speakerLoad = source.speakerLoad;
        target.actualLoadOhm = source.actualLoadOhm;
        // The safety trim and its automatic companion sit outside the amplifier model, so they
        // never belong to the reset class: moving the trim must not mute the output for a
        // transition.
        target.safetyTrimDb = source.safetyTrimDb;
        target.autoGainReduction = source.autoGainReduction;
        target.seBPlus = source.seBPlus;
        target.seCathodeResistor = source.seCathodeResistor;
        target.sePrimaryImpedance = source.sePrimaryImpedance;
    }

    function applyNonResetParameters(state, decoded) {
        copyNonResetParameters(state.parameters, decoded);
        applyCircuitAndControlTargets(
            state,
            state.parameters,
            state.tubeIndex,
            false
        );
    }

    function commitParameters(state, source) {
        const decoded = decodeParameters(source);
        if (!decoded) return;
        // The accumulated reduction is cleared on exactly two conditions: the safety trim value
        // changed, or two or more active parameter values changed in one commit.
        //
        // The count is the discriminator between a knob and a preset. A control commits one key
        // at a time, so an ordinary move differs in exactly one value and protection is kept; a
        // preset writes the active circuit at once and normally differs in at least two. Inactive
        // topology fields are excluded so editing dimmed controls cannot surrender protection;
        // cross-topology presets retain the original all-field count.
        const previousCommit = state.committedParameters;
        const trimChanged = decoded.safetyTrimDb !== previousCommit.safetyTrimDb;
        const changedCount = changedParameterCount(decoded, previousCommit);
        copyDecodedParameters(state.committedParameters, decoded);
        if (trimChanged || changedCount >= 2) {
            resetSafetyReduction(state);
        }
        const circuitChanged =
            trialEligibleChanged(decoded, state.parameters);
        const hostControlChanged =
            decoded.driveDb !== state.parameters.driveDb ||
            decoded.outputDb !== state.parameters.outputDb ||
            decoded.mixPercent !== state.parameters.mixPercent;
        // These five lanes only retarget existing smoothers. Keep them out of applyParameters(),
        // whose power branch recomputes coefficients and solves its quiescent point.
        if (fastAutomationOnlyChanged(decoded, state.parameters)) {
            applyFastAutomationParameters(state, decoded);
            return;
        }
        if (state.runtimeEvent.latched === 1 &&
            state.runtimeEvent.cause === 1 &&
            state.fault.state === 1 && circuitChanged) {
            state.fault.pendingParameters = decoded;
            if (hostControlChanged) {
                state.parameters.driveDb = decoded.driveDb;
                state.parameters.outputDb = decoded.outputDb;
                state.parameters.mixPercent = decoded.mixPercent;
                applyCircuitAndControlTargets(
                    state,
                    state.parameters,
                    state.tubeIndex,
                    false
                );
            }
            return;
        }
        if (state.runtimeEvent.latched === 1 &&
            state.runtimeEvent.cause === 1 && circuitChanged) {
            applyParameters(state, decoded, false);
            state.fault.resetPending = true;
            state.fault.trialAfterReset = true;
            state.fault.state = 2;
            state.fault.wet = 0;
            return;
        }
        const transition = state.feedbackTransition;
        if (!transition.active) {
            if (resetClassChanged(decoded, state.parameters)) {
                beginFeedbackTransition(state, decoded);
            } else {
                applyParameters(state, decoded, false);
            }
            return;
        }

        const resetClassChange =
            resetClassChanged(decoded, state.parameters);
        if (transition.phase === 1) {
            state.pendingParameters = decoded;
            if (!resetClassChange) {
                applyNonResetParameters(state, decoded);
            }
            return;
        }
        if (resetClassChange) {
            state.queuedParameters = decoded;
            if (transition.queuedGeneration === 0) {
                transition.queuedGeneration =
                    transition.nextGeneration++;
            }
        } else {
            applyNonResetParameters(state, decoded);
            if (state.queuedParameters) {
                state.queuedParameters = null;
                transition.queuedGeneration = 0;
            }
        }
    }

    function safetyBound(state, value, low, high) {
        if (value < low) {
            ++state.safetyLimits;
            ++state.observedSafetyLimits;
            state.stepSafetyHit = true;
            return low;
        }
        if (value > high) {
            ++state.safetyLimits;
            ++state.observedSafetyLimits;
            state.stepSafetyHit = true;
            return high;
        }
        return value;
    }

    function plateLoadLineResidual(
        state,
        vak,
        plate,
        delayedP,
        vk,
        delayedOutputLoadCurrent
    ) {
        return (delayedP - (vak + vk)) / state.plateResistance -
            plate.current - delayedOutputLoadCurrent;
    }

    function plateCandidateNeedsFallback(
        state,
        vak,
        plate,
        delayedP,
        vk,
        delayedOutputLoadCurrent
    ) {
        const plateVoltage = vak + vk;
        if (!Number.isFinite(vak) || !Number.isFinite(plateVoltage) ||
            vak < K.minimumPhysicalPlateVoltage ||
            vak > K.maximumPhysicalPlateVoltage ||
            plateVoltage < K.minimumPhysicalPlateVoltage ||
            plateVoltage > K.maximumPhysicalPlateVoltage) {
            return true;
        }
        const residual = plateLoadLineResidual(
            state,
            vak,
            plate,
            delayedP,
            vk,
            delayedOutputLoadCurrent
        );
        const absoluteResidual = residual >= 0 ? residual : -residual;
        return !Number.isFinite(residual) ||
            absoluteResidual > K.plateFastPathResidualTolerance;
    }

    function solvePlateFallback(
        state,
        vgk,
        delayedP,
        vk,
        delayedOutputLoadCurrent,
        fastVak,
        fastPlate
    ) {
        let lowerVak = K.minimumPhysicalPlateVoltage;
        const lowerPlateVak = K.minimumPhysicalPlateVoltage - vk;
        if (lowerPlateVak > lowerVak) lowerVak = lowerPlateVak;
        let upperVak = K.maximumPhysicalPlateVoltage;
        const upperPlateVak = K.maximumPhysicalPlateVoltage - vk;
        if (upperPlateVak < upperVak) upperVak = upperPlateVak;
        if (!Number.isFinite(lowerVak) || !Number.isFinite(upperVak) ||
            lowerVak > upperVak) {
            return { vak: fastVak, plate: fastPlate, converged: false };
        }

        const lowerPlate = evaluatePlate(state, vgk, lowerVak);
        const upperPlate = evaluatePlate(state, vgk, upperVak);
        const lowerResidual = plateLoadLineResidual(
            state,
            lowerVak,
            lowerPlate,
            delayedP,
            vk,
            delayedOutputLoadCurrent
        );
        const upperResidual = plateLoadLineResidual(
            state,
            upperVak,
            upperPlate,
            delayedP,
            vk,
            delayedOutputLoadCurrent
        );
        if (!Number.isFinite(lowerResidual) || !Number.isFinite(upperResidual)) {
            return { vak: fastVak, plate: fastPlate, converged: false };
        }
        const absoluteLowerResidual =
            lowerResidual >= 0 ? lowerResidual : -lowerResidual;
        if (absoluteLowerResidual <= K.plateFallbackResidualTolerance) {
            return { vak: lowerVak, plate: lowerPlate, converged: true };
        }
        const absoluteUpperResidual =
            upperResidual >= 0 ? upperResidual : -upperResidual;
        if (absoluteUpperResidual <= K.plateFallbackResidualTolerance) {
            return { vak: upperVak, plate: upperPlate, converged: true };
        }
        if (lowerResidual < 0 || upperResidual > 0) {
            return { vak: fastVak, plate: fastPlate, converged: false };
        }

        let candidateVak = 0.5 * (lowerVak + upperVak);
        for (let iteration = 0;
            iteration < K.plateFallbackMaximumIterations;
            ++iteration) {
            const candidatePlate = evaluatePlate(state, vgk, candidateVak);
            const candidateResidual = plateLoadLineResidual(
                state,
                candidateVak,
                candidatePlate,
                delayedP,
                vk,
                delayedOutputLoadCurrent
            );
            if (!Number.isFinite(candidateResidual)) {
                return { vak: fastVak, plate: fastPlate, converged: false };
            }
            const absoluteCandidateResidual =
                candidateResidual >= 0 ? candidateResidual : -candidateResidual;
            if (absoluteCandidateResidual <= K.plateFallbackResidualTolerance) {
                return { vak: candidateVak, plate: candidatePlate, converged: true };
            }

            if (candidateResidual > 0) {
                lowerVak = candidateVak;
            } else {
                upperVak = candidateVak;
            }
            const derivative =
                -1 / state.plateResistance - candidatePlate.plateDerivative;
            const newtonVak = candidateVak - candidateResidual / derivative;
            candidateVak = Number.isFinite(newtonVak) &&
                newtonVak > lowerVak && newtonVak < upperVak
                ? newtonVak
                : 0.5 * (lowerVak + upperVak);
        }

        const candidatePlate = evaluatePlate(state, vgk, candidateVak);
        const candidateResidual = plateLoadLineResidual(
            state,
            candidateVak,
            candidatePlate,
            delayedP,
            vk,
            delayedOutputLoadCurrent
        );
        const absoluteCandidateResidual =
            candidateResidual >= 0 ? candidateResidual : -candidateResidual;
        return Number.isFinite(candidateResidual) &&
            absoluteCandidateResidual <= K.plateFallbackResidualTolerance
            ? { vak: candidateVak, plate: candidatePlate, converged: true }
            : { vak: fastVak, plate: fastPlate, converged: false };
    }

    function advanceStage(
        state,
        stage,
        sourceVoltage,
        sourceResistance,
        delayedP,
        vk,
        delayedOutputLoadCurrent,
        channel,
        stageIndex
    ) {
        const oldCharge = stage.couplingCharge;
        const cm = safetyBound(
            state,
            stage.millerCapacitance,
            K.minimumMillerCapacitance,
            K.maximumMillerCapacitance
        );
        const millerConductance = cm / K.fastDt;
        const seriesResistance = sourceResistance + K.fastDt / K.couplingCapacitance;
        const passiveNumerator = sourceVoltage - oldCharge / K.couplingCapacitance +
            seriesResistance * millerConductance * stage.millerVoltage;
        const passiveDenominator = 1 + seriesResistance *
            (1 / K.gridLeakResistance + millerConductance);
        const passiveGrid = passiveNumerator / passiveDenominator;
        const passiveVgk = passiveGrid - vk;
        const lambda = seriesResistance / passiveDenominator;
        const upper = evaluateGrid(state, passiveVgk);
        let lowerVgk = passiveVgk - lambda * upper.current;
        if (passiveVgk > K.gridOn - 2 && lowerVgk < K.gridOn - 2) {
            lowerVgk = K.gridOn - 2;
        }
        let predictorVgk = passiveVgk;
        const overdrive = passiveVgk - K.gridOn;
        if (overdrive > 0 && lambda * upper.current > 1e-18) {
            const loading = lambda * K.gridK * Math.sqrt(overdrive);
            predictorVgk = K.gridOn + overdrive *
                polynomialPowPositive(1 + 1.5 * loading, -2 / 3);
        }
        predictorVgk = clamp(predictorVgk, lowerVgk, passiveVgk);
        const physicalResidualScale = passiveDenominator / sourceResistance;
        let vgk = predictorVgk;
        let grid = evaluateGrid(state, vgk);
        let gridEquationResidual =
            vgk + lambda * grid.current - passiveVgk;
        let absoluteGridResidual =
            physicalResidualScale * gridEquationResidual;
        absoluteGridResidual = absoluteGridResidual >= 0
            ? absoluteGridResidual
            : -absoluteGridResidual;
        for (let correction = 0;
            correction < K.gridMaximumNewtonCorrections &&
                absoluteGridResidual > K.gridFastPathResidualTolerance;
            ++correction) {
            vgk -= gridEquationResidual /
                (1 + lambda * grid.derivative);
            vgk = clamp(vgk, lowerVgk, passiveVgk);
            grid = evaluateGrid(state, vgk);
            gridEquationResidual =
                vgk + lambda * grid.current - passiveVgk;
            absoluteGridResidual =
                physicalResidualScale * gridEquationResidual;
            absoluteGridResidual = absoluteGridResidual >= 0
                ? absoluteGridResidual
                : -absoluteGridResidual;
        }
        if (absoluteGridResidual > K.gridFastPathResidualTolerance) {
            let fallbackLow = lowerVgk;
            let fallbackHigh = passiveVgk;
            for (let iteration = 0;
                iteration < K.gridFallbackMaximumIterations &&
                    absoluteGridResidual > K.gridFallbackResidualTolerance;
                ++iteration) {
                vgk = 0.5 * (fallbackLow + fallbackHigh);
                grid = evaluateGrid(state, vgk);
                gridEquationResidual =
                    vgk + lambda * grid.current - passiveVgk;
                if (gridEquationResidual > 0) {
                    fallbackHigh = vgk;
                } else {
                    fallbackLow = vgk;
                }
                absoluteGridResidual =
                    physicalResidualScale * gridEquationResidual;
                absoluteGridResidual = absoluteGridResidual >= 0
                    ? absoluteGridResidual
                    : -absoluteGridResidual;
            }
            if (absoluteGridResidual > K.gridFallbackResidualTolerance) {
                ++state.safetyLimits;
                ++state.observedSafetyLimits;
                state.stepSafetyHit = true;
            }
        }
        const gridVoltage = safetyBound(
            state,
            vgk + vk,
            -K.maximumGridVoltage,
            K.maximumGridVoltage
        );
        vgk = gridVoltage - vk;
        grid = evaluateGrid(state, vgk);
        const iM = millerConductance * (gridVoltage - stage.millerVoltage);
        const seriesCurrent = gridVoltage / K.gridLeakResistance + grid.current + iM;
        const nextCharge = safetyBound(
            state,
            oldCharge + K.fastDt * seriesCurrent,
            -K.couplingCapacitance * K.maximumCouplingEquivalentVoltage,
            K.couplingCapacitance * K.maximumCouplingEquivalentVoltage
        );
        const platePredictor = evaluatePlate(state, vgk, stage.previousVak);
        const plateDenominator = 1 +
            state.plateResistance * platePredictor.plateDerivative;
        let vak = (delayedP - vk - state.plateResistance *
            (platePredictor.current -
                platePredictor.plateDerivative * stage.previousVak +
                delayedOutputLoadCurrent)) / plateDenominator;
        let plate = evaluatePlate(state, vgk, vak);
        const predictorPlateResidual = plateLoadLineResidual(
            state,
            vak,
            plate,
            delayedP,
            vk,
            delayedOutputLoadCurrent
        );
        const absolutePredictorPlateResidual =
            predictorPlateResidual >= 0 ? predictorPlateResidual : -predictorPlateResidual;
        if (Number.isFinite(predictorPlateResidual) &&
            absolutePredictorPlateResidual > K.plateFastPathResidualTolerance) {
            const plateResidualDerivative =
                -1 / state.plateResistance - plate.plateDerivative;
            vak -= predictorPlateResidual / plateResidualDerivative;
            plate = evaluatePlate(state, vgk, vak);
        }
        if (plateCandidateNeedsFallback(
            state,
            vak,
            plate,
            delayedP,
            vk,
            delayedOutputLoadCurrent
        )) {
            const fallback = solvePlateFallback(
                state,
                vgk,
                delayedP,
                vk,
                delayedOutputLoadCurrent,
                vak,
                plate
            );
            if (fallback.converged) {
                vak = fallback.vak;
                plate = fallback.plate;
            } else {
                ++state.safetyLimits;
                ++state.observedSafetyLimits;
                state.stepSafetyHit = true;
            }
        }
        const plateVoltage = vak + vk;
        const derivativeDenominator = 1 +
            state.plateResistance * plate.plateDerivative;
        const localGain = safetyBound(
            state,
            -state.plateResistance * plate.gridDerivative / derivativeDenominator,
            K.minimumLocalPlateGain,
            K.maximumLocalPlateGain
        );
        const tube = TUBES[effectiveDriverTubeIndex(state.tubeIndex)];
        const nextCm = safetyBound(
            state,
            tube.cgk + tube.cga * (1 - localGain),
            K.minimumMillerCapacitance,
            K.maximumMillerCapacitance
        );
        const iCgk = tube.cgk / cm * iM;
        const iCga = tube.cga * (1 - stage.localPlateGain) / cm * iM;
        const iCak = tube.cak * (vak - stage.previousVak) / K.fastDt;
        const couplingCurrent = (nextCharge - oldCharge) / K.fastDt;
        stage.gridVoltage = gridVoltage;
        stage.plateVoltage = plateVoltage;
        stage.couplingCharge = nextCharge;
        stage.millerVoltage = gridVoltage;
        stage.millerCapacitance = nextCm;
        stage.localPlateGain = localGain;
        stage.outputResistance = state.plateResistance / derivativeDenominator;
        stage.previousVak = vak;
        const sourceBranchCurrent =
            (sourceVoltage - stage.gridVoltage -
                stage.couplingCharge / K.couplingCapacitance) / sourceResistance;
        const committedSeriesCurrent =
            stage.gridVoltage / K.gridLeakResistance + grid.current + iM;
        const gridResidual = sourceBranchCurrent -
            stage.gridVoltage / K.gridLeakResistance - grid.current - iM;
        const couplingResidual = couplingCurrent - committedSeriesCurrent;
        const millerResidual = iM - iCgk - iCga;
        const plateResidual =
            (delayedP - stage.plateVoltage) / state.plateResistance -
            plate.current - delayedOutputLoadCurrent;
        const nodes = FAST_KCL_STAGE_NODES[stageIndex];
        observeFastKcl(state, gridResidual, nodes[0], channel);
        observeFastKcl(state, couplingResidual, nodes[1], channel);
        observeFastKcl(state, millerResidual, nodes[2], channel);
        observeFastKcl(state, plateResidual, nodes[3], channel);
        return {
            plateCurrent: plate.current,
            gridCurrent: grid.current,
            iCgk,
            iCga,
            iCak,
            couplingCurrent
        };
    }

    function updateSlow(state, channel, iRa1, iRa2, first, second) {
        const accumulator = state.accumulator[channel];
        accumulator.uK1 += first.plateCurrent + first.gridCurrent + first.iCgk + first.iCak;
        accumulator.uK2 += second.plateCurrent + second.gridCurrent +
            second.iCgk + second.iCak;
        accumulator.uP += state.supplyVoltage / state.supplyResistance - iRa1 - iRa2;
        ++accumulator.count;
        if (accumulator.count !== K.slowWindow) return;
        const inverseCount = 1 / K.slowWindow;
        const slow = state.slow[channel];
        slow.cathode[0] = trBdf2Step(
            slow.cathode[0],
            K.cathodeCapacitance,
            1 / state.cathodeResistance + K.gmin,
            accumulator.uK1 * inverseCount
        );
        slow.cathode[1] = trBdf2Step(
            slow.cathode[1],
            K.cathodeCapacitance,
            1 / state.cathodeResistance + K.gmin,
            accumulator.uK2 * inverseCount
        );
        slow.supply = trBdf2Step(
            slow.supply,
            state.supplyCapacitance,
            1 / state.supplyResistance + K.gmin,
            accumulator.uP * inverseCount
        );
        retargetRamp(slow.cathodeRamp[0], slow.cathode[0].voltage, inverseCount, K.slowWindow);
        retargetRamp(slow.cathodeRamp[1], slow.cathode[1].voltage, inverseCount, K.slowWindow);
        retargetRamp(slow.supplyRamp, slow.supply.voltage, inverseCount, K.slowWindow);
        const uK1 = accumulator.uK1 * inverseCount;
        const uK2 = accumulator.uK2 * inverseCount;
        const uP = accumulator.uP * inverseCount;
        const residual1 =
            (1 / state.cathodeResistance + K.gmin) *
                slow.cathode[0].voltage +
            slow.cathode[0].capacitorCurrent - uK1;
        const residual2 =
            (1 / state.cathodeResistance + K.gmin) *
                slow.cathode[1].voltage +
            slow.cathode[1].capacitorCurrent - uK2;
        const residualP =
            (1 / state.supplyResistance + K.gmin) * slow.supply.voltage +
            slow.supply.capacitorCurrent - uP;
        const residuals = [residual1, residual2, residualP];
        for (const candidate of residuals) {
            const absoluteResidual = candidate >= 0 ? candidate : -candidate;
            if (absoluteResidual > state.maximumSlowKclResidual) {
                state.maximumSlowKclResidual = absoluteResidual;
            }
            if (absoluteResidual > state.observedMaximumSlowKclResidual) {
                state.observedMaximumSlowKclResidual = absoluteResidual;
            }
        }
        state.accumulator[channel] = makeAccumulator();
        ++state.slowPublishCount;
    }

    function bracketPowerAxis(axis, value) {
        if (value <= axis[0]) return [0, 0, 0];
        const last = axis.length - 1;
        if (value >= axis[last]) return [last, last, 0];
        let upper = 1;
        while (value > axis[upper]) ++upper;
        return [
            upper - 1,
            upper,
            (value - axis[upper - 1]) / (axis[upper] - axis[upper - 1])
        ];
    }

    // The screen shields the cathode from the anode, so the cathode current of a pentode follows
    // a single composite control voltage Vc = Vgk + Vg2k/mu(g1-g2) + Vak/mu(g1-a) and cuts off
    // exactly at Vc = 0. Carrying Vc as the first table axis puts a knot on that cut-off plane.
    // Bracketing the grid voltage instead would leave the plane running diagonally through the
    // cells, and the interpolated table would still pass tens of milliamps where the valve is
    // already cut off.
    function interpolatePowerTube(state, vgk, vak, vg2k) {
        const tube = POWER_TUBE_TABLES[state.parameters.powerTube];
        const vc = vgk + vg2k * tube.inverseScreenAmplificationFactor +
            vak * tube.inversePlateAmplificationFactor;
        const control = bracketPowerAxis(tube.controlVoltageV, vc);
        const plate = bracketPowerAxis(tube.plateCathodeV, vak);
        const screen = bracketPowerAxis(tube.screenCathodeV, vg2k);
        const values = tube.values;
        const plateCount = tube.plateCathodeV.length;
        const screenCount = tube.screenCathodeV.length;
        let ia = 0;
        let ig2 = 0;
        // Exact plate and screen partial derivatives of the bounded trilinear model, taken from
        // the same eight taps. Each terminal reaches the model through its own axis and its share
        // of the composite control voltage, so both paths are accumulated.
        let iaPlateDerivative = 0;
        let iaScreenDerivative = 0;
        let iaControlDerivative = 0;
        let ig2PlateDerivative = 0;
        let ig2ScreenDerivative = 0;
        let ig2ControlDerivative = 0;
        const plateInverseStep = plate[1] === plate[0] ? 0 : tube.plateCathodeInverseStep[plate[1]];
        const screenInverseStep =
            screen[1] === screen[0] ? 0 : tube.screenCathodeInverseStep[screen[1]];
        const controlInverseStep =
            control[1] === control[0] ? 0 : tube.controlVoltageInverseStep[control[1]];
        for (let cx = 0; cx < 2; ++cx) {
            const ci = cx === 0 ? control[0] : control[1];
            const cw = cx === 0 ? 1 - control[2] : control[2];
            const controlSlope = cx === 0 ? -controlInverseStep : controlInverseStep;
            for (let px = 0; px < 2; ++px) {
                const pi = px === 0 ? plate[0] : plate[1];
                const pw = px === 0 ? 1 - plate[2] : plate[2];
                const plateSlope = px === 0 ? -plateInverseStep : plateInverseStep;
                const controlPlateWeight = cw * pw;
                const plateSlopeWeight = cw * plateSlope;
                const controlSlopeWeight = pw * controlSlope;
                for (let sx = 0; sx < 2; ++sx) {
                    const si = sx === 0 ? screen[0] : screen[1];
                    const sw = sx === 0 ? 1 - screen[2] : screen[2];
                    const screenSlope = sx === 0 ? -screenInverseStep : screenInverseStep;
                    const index = ((ci * plateCount + pi) * screenCount + si) * 2;
                    const iaValue = values[index];
                    const ig2Value = values[index + 1];
                    const screenScaled = iaValue * sw;
                    ia += screenScaled * controlPlateWeight;
                    ig2 += ig2Value * controlPlateWeight * sw;
                    iaPlateDerivative += screenScaled * plateSlopeWeight;
                    iaControlDerivative += screenScaled * controlSlopeWeight;
                    iaScreenDerivative += iaValue * controlPlateWeight * screenSlope;
                    ig2PlateDerivative += ig2Value * plateSlopeWeight * sw;
                    ig2ControlDerivative += ig2Value * controlSlopeWeight * sw;
                    ig2ScreenDerivative += ig2Value * controlPlateWeight * screenSlope;
                }
            }
        }
        return {
            ia,
            ig2,
            iaPlateDerivative:
                iaPlateDerivative + iaControlDerivative * tube.inversePlateAmplificationFactor,
            iaScreenDerivative:
                iaScreenDerivative + iaControlDerivative * tube.inverseScreenAmplificationFactor,
            ig2PlateDerivative:
                ig2PlateDerivative + ig2ControlDerivative * tube.inversePlateAmplificationFactor,
            ig2ScreenDerivative:
                ig2ScreenDerivative + ig2ControlDerivative * tube.inverseScreenAmplificationFactor
        };
    }

    // Screen terminal voltage of a distributed (ultra-linear) tap. The turns ratio alpha divides
    // the induced emf of the half primary; the terminal voltage then follows from KVL with the IR
    // drop of the centre-to-tap winding section. At DC the induced emf is zero and the expression
    // collapses to the pure IR drop, which is what the frozen EL34 DC oracle assumes.
    function screenTapVoltage(opt, induced, ia, ig2, bPlus) {
        return bPlus - opt.screenTapTurnsRatio * induced -
            (ia + ig2) * opt.centerToTapResistanceOhm;
    }

    // Plate node of one output tube. The plate sits at the far end of the whole half primary, so
    // its KVL carries the full induced emf of that winding section, exactly as the screen tap
    // carries the alpha-weighted share of the same emf. Without it the plate could only move by the
    // winding IR drop and the load line stood almost vertical.
    //
    // The resistive part of that KVL is resolved per winding section, the same way the screen tap
    // and the reset seed resolve it: the centre-to-tap section carries the anode and the screen
    // current, the tap-to-plate section carries the anode current alone. Writing the residual as a
    // current through the whole half primary makes the screen term enter with the centre-to-tap
    // share of the winding. The transformer branch current is the load component of that same anode
    // current, not a second current through the winding, so it appears only through the emf.
    //
    // The emf is taken in the same sample. A distributed screen depends on that emf and on both
    // valve currents, so its terminal voltage and the plate voltage are solved together. Keeping
    // those two KVL equations in one Newton step avoids a high-transconductance screen fixed point
    // outside the Jacobian. A fixed screen remains the original scalar plate solve.
    function solvePowerPlate(state, channel, push, oppositeDrive) {
        const power = state.power[channel];
        const opt = state.powerOpt;
        const direction = push ? 1 : -1;
        const cathode = push ? power.cathodePushRamp.applied : power.cathodePullRamp.applied;
        const grid = push ? power.gridPushV : power.gridPullV;
        const inverseResistance = opt.inverseWindingResistanceOhm;
        let plate = push ? power.platePushV : power.platePullV;
        let evaluation = { ia: push ? power.iaPushA : power.iaPullA,
            ig2: push ? power.ig2PushA : power.ig2PullA };
        let residual = 0;
        const signedDriveOhm = direction * opt.primaryDriveOhm;
        const signedReflectedOhm = direction * opt.halfPrimaryReflectedOhm;
        const history = power.optCapacitorV -
            opt.seriesHistoryCoefficient * power.optCurrentA;
        let drive = evaluation.ia + opt.screenTapTurnsRatio * evaluation.ig2;
        let seriesCurrent = 0;
        let induced = 0;
        let screen = power.screenRamp.applied;
        if (!opt.distributedScreenTap) {
            for (let iteration = 0; iteration < 3; ++iteration) {
                seriesCurrent = (signedDriveOhm * (drive - oppositeDrive) - history) *
                    opt.inverseSeriesCoefficient;
                induced = signedReflectedOhm * seriesCurrent;
                evaluation = interpolatePowerTube(
                    state, grid - cathode, plate - cathode, screen - cathode
                );
                residual = (power.bPlusRamp.applied - induced - plate) * inverseResistance -
                    evaluation.ia - evaluation.ig2 * opt.centerToTapResistanceShare;
                const derivative = -inverseResistance -
                    opt.plateLoadFactor * evaluation.iaPlateDerivative;
                if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-12) {
                    ++state.safetyLimits;
                    ++state.observedSafetyLimits;
                    state.stepSafetyHit = true;
                    break;
                }
                plate -= residual / derivative;
                drive = evaluation.ia + opt.screenTapTurnsRatio * evaluation.ig2;
            }
            seriesCurrent = (signedDriveOhm * (drive - oppositeDrive) - history) *
                opt.inverseSeriesCoefficient;
            induced = signedReflectedOhm * seriesCurrent;
            evaluation = interpolatePowerTube(
                state, grid - cathode, plate - cathode, screen - cathode
            );
            drive = evaluation.ia + opt.screenTapTurnsRatio * evaluation.ig2;
            const screenTap = screenTapVoltage(
                opt, induced, evaluation.ia, evaluation.ig2, power.bPlusRamp.applied
            );
            residual = (power.bPlusRamp.applied - induced - plate) * inverseResistance -
                evaluation.ia - evaluation.ig2 * opt.centerToTapResistanceShare;
            return {
                plate, screen, screenTap, ia: evaluation.ia, ig2: evaluation.ig2, drive, residual
            };
        }
        screen = push ? power.screenPushV : power.screenPullV;
        const emfDriveGain = opt.primaryDriveOhm * opt.halfPrimaryReflectedOhm *
            opt.inverseSeriesCoefficient;
        for (let iteration = 0; iteration < 3; ++iteration) {
            evaluation = interpolatePowerTube(
                state, grid - cathode, plate - cathode, screen - cathode
            );
            drive = evaluation.ia + opt.screenTapTurnsRatio * evaluation.ig2;
            seriesCurrent = (signedDriveOhm * (drive - oppositeDrive) - history) *
                opt.inverseSeriesCoefficient;
            induced = signedReflectedOhm * seriesCurrent;
            residual = (power.bPlusRamp.applied - induced - plate) * inverseResistance -
                evaluation.ia - evaluation.ig2 * opt.centerToTapResistanceShare;
            const screenResidual = screen - power.bPlusRamp.applied +
                opt.screenTapTurnsRatio * induced +
                opt.centerToTapResistanceOhm * evaluation.ia +
                (opt.centerToTapResistanceOhm + opt.screenSeriesResistanceOhm) * evaluation.ig2;
            const inducedPlateDerivative = emfDriveGain *
                (evaluation.iaPlateDerivative +
                    opt.screenTapTurnsRatio * evaluation.ig2PlateDerivative);
            const inducedScreenDerivative = emfDriveGain *
                (evaluation.iaScreenDerivative +
                    opt.screenTapTurnsRatio * evaluation.ig2ScreenDerivative);
            const j11 = (-1 - inducedPlateDerivative) * inverseResistance -
                evaluation.iaPlateDerivative -
                opt.centerToTapResistanceShare * evaluation.ig2PlateDerivative;
            const j12 = -inducedScreenDerivative * inverseResistance -
                evaluation.iaScreenDerivative -
                opt.centerToTapResistanceShare * evaluation.ig2ScreenDerivative;
            const j21 = opt.screenTapTurnsRatio * inducedPlateDerivative +
                opt.centerToTapResistanceOhm * evaluation.iaPlateDerivative +
                (opt.centerToTapResistanceOhm + opt.screenSeriesResistanceOhm) *
                    evaluation.ig2PlateDerivative;
            const j22 = 1 + opt.screenTapTurnsRatio * inducedScreenDerivative +
                opt.centerToTapResistanceOhm * evaluation.iaScreenDerivative +
                (opt.centerToTapResistanceOhm + opt.screenSeriesResistanceOhm) *
                    evaluation.ig2ScreenDerivative;
            const determinant = j11 * j22 - j12 * j21;
            if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
                ++state.safetyLimits;
                ++state.observedSafetyLimits;
                state.stepSafetyHit = true;
                break;
            }
            plate += (-residual * j22 + j12 * screenResidual) / determinant;
            screen += (j21 * residual - j11 * screenResidual) / determinant;
        }
        evaluation = interpolatePowerTube(
            state, grid - cathode, plate - cathode, screen - cathode
        );
        drive = evaluation.ia + opt.screenTapTurnsRatio * evaluation.ig2;
        seriesCurrent = (signedDriveOhm * (drive - oppositeDrive) - history) *
            opt.inverseSeriesCoefficient;
        induced = signedReflectedOhm * seriesCurrent;
        const screenTap = screenTapVoltage(
            opt, induced, evaluation.ia, evaluation.ig2, power.bPlusRamp.applied
        );
        residual = (power.bPlusRamp.applied - induced - plate) * inverseResistance -
            evaluation.ia - evaluation.ig2 * opt.centerToTapResistanceShare;
        return {
            plate, screen, screenTap, ia: evaluation.ia, ig2: evaluation.ig2, drive, residual
        };
    }

    function trapezoidPowerRc(previous, sourceCurrent, resistance, capacitance) {
        const conductance = 1 / resistance;
        const coefficient = 2 * capacitance / K.slowDt;
        return ((coefficient - conductance) * previous + 2 * sourceCurrent) /
            (coefficient + conductance);
    }

    // Bias, reservoir and screen nodes of the output stage. Their capacitors integrate the valve
    // currents continuously, so the drive of one slow step is the mean of the fast currents over
    // that step, not the single sample that happens to sit on the boundary. Sampling the
    // instantaneous current would decimate the valve currents by slowWindow with no anti-aliasing
    // and fold every harmonic above the slow Nyquist back onto the bias nodes, which is exactly
    // what the driver stage avoids by accumulating in updateSlow.
    function updatePowerSlow(state, channel) {
        const power = state.power[channel];
        const profile = state.powerProfile;
        const inverseWindow = 1 / K.slowWindow;
        const meanPush = power.slowAccumulatorPushA * inverseWindow;
        const meanPull = power.slowAccumulatorPullA * inverseWindow;
        const meanScreen = power.slowAccumulatorScreenA * inverseWindow;
        const meanLtp = power.slowAccumulatorLtpA * inverseWindow;
        power.slowAccumulatorPushA = 0;
        power.slowAccumulatorPullA = 0;
        power.slowAccumulatorScreenA = 0;
        power.slowAccumulatorLtpA = 0;
        const previousPush = power.cathodePushV;
        const previousPull = power.cathodePullV;
        const previousBPlus = power.bPlusV;
        const previousScreen = power.screenV;
        power.cathodePushV = trapezoidPowerRc(
            previousPush, meanPush,
            state.parameters.cathodeResistor, profile.cathodeRc.capacitanceF
        );
        power.cathodePullV = trapezoidPowerRc(
            previousPull, meanPull,
            state.parameters.cathodeResistor, profile.cathodeRc.capacitanceF
        );
        const totalSupply = meanPush + meanPull + meanLtp;
        const supplySource = state.parameters.powerBPlus /
            profile.powerSupplyRc.theveninResistanceOhm - totalSupply;
        power.bPlusV = trapezoidPowerRc(
            previousBPlus, supplySource,
            profile.powerSupplyRc.theveninResistanceOhm,
            profile.powerSupplyRc.capacitanceF
        );
        if (profile.screenTapTurnsRatio === 0) {
            const tubeModel = POWER_TABLES.tubeModels[state.parameters.powerTube];
            const screenSource = (state.parameters.powerBPlus -
                tubeModel.fixedScreenSupplyDropV) /
                profile.screenSupplyRc.seriesResistanceOhm - meanScreen;
            power.screenV = trapezoidPowerRc(
                previousScreen, screenSource,
                profile.screenSupplyRc.seriesResistanceOhm,
                profile.screenSupplyRc.capacitanceF
            );
            retargetRamp(power.screenRamp, power.screenV, inverseWindow, K.slowWindow);
        }
        retargetRamp(power.cathodePushRamp, power.cathodePushV, inverseWindow, K.slowWindow);
        retargetRamp(power.cathodePullRamp, power.cathodePullV, inverseWindow, K.slowWindow);
        retargetRamp(power.bPlusRamp, power.bPlusV, inverseWindow, K.slowWindow);
        ++state.slowPublishCount;
    }

    function advancePowerOutputLoad(state, channel, source) {
        const power = state.power[channel];
        const opt = state.powerOpt;
        const oldCurrent = power.optCurrentA;
        const oldCapacitor = power.optCapacitorV;
        const rightHand = source - oldCapacitor +
            opt.seriesHistoryCoefficient * oldCurrent;
        const newCurrent = rightHand * opt.inverseSeriesCoefficient;
        const newCapacitor = oldCapacitor + opt.capacitorStep * (newCurrent + oldCurrent);
        const oldMagnetizing = power.magnetizingCurrentA;
        const oldPrimaryVoltage = power.primaryVoltageV;
        const newMagnetizing = state.parameters.outputStage === 2
            ? oldMagnetizing + opt.magnetizingStep * (oldPrimaryVoltage + source)
            : (source + opt.magnetizingHistoryCoefficient * oldMagnetizing) *
                opt.inverseMagnetizingCoefficient;
        const midpointCurrent = 0.5 * (oldCurrent + newCurrent);
        const midpointMagnetizing = 0.5 * (oldMagnetizing + newMagnetizing);
        const oldEnergy = 0.5 * opt.leakageInductanceH * oldCurrent * oldCurrent +
            0.5 * opt.seriesCapacitanceF * oldCapacitor * oldCapacitor +
            0.5 * opt.magnetizingInductanceH * oldMagnetizing * oldMagnetizing;
        const newEnergy = 0.5 * opt.leakageInductanceH * newCurrent * newCurrent +
            0.5 * opt.seriesCapacitanceF * newCapacitor * newCapacitor +
            0.5 * opt.magnetizingInductanceH * newMagnetizing * newMagnetizing;
        const midpointPrimaryVoltage = 0.5 * (oldPrimaryVoltage + source);
        // Nonlinear core magnetics of the output transformer, shared by both topologies. The
        // flux linkage integrates the primary voltage with the same trapezoid as the linear
        // magnetizing branch, so on the single-ended core the value committed here is
        // bit-identical to the one the Newton in advanceSingleEnded injected; on the push-pull
        // core the committed excess current is the injection the next sample's advancePower
        // subtracts from the differential ampere-turn drive (the one-sample-delayed explicit
        // coupling). The audit terms follow the linearised-difference split: the midpoint excess
        // current is the power drawn from the primary, the coercive part of it is dissipation -
        // written so the hysteresis contribution cancels exactly against the midpoint current
        // and only the trapezoid-versus-closed-form error of the anhysteretic part reaches the
        // residual - and the closed-form W_x increment is the stored side (the linear branch's
        // 0.5*Lm*i^2 is already counted above).
        const oldFlux = power.fluxLinkageWbT;
        const signState = power.hysteresisSignState;
        const newFlux = oldFlux + opt.fluxStep * (oldPrimaryVoltage + source);
        const oldExcess = seExcessMagnetizingCurrent(opt, oldFlux, signState);
        const newExcess = seExcessMagnetizingCurrent(opt, newFlux, signState);
        let oldLoop = Math.abs(oldFlux - opt.fluxBiasWbT) * opt.inverseFluxReference;
        oldLoop = oldLoop > 1 ? 1 : oldLoop;
        let newLoop = Math.abs(newFlux - opt.fluxBiasWbT) * opt.inverseFluxReference;
        newLoop = newLoop > 1 ? 1 : newLoop;
        const hysteresisPower = opt.coerciveCurrentA * (0.5 * (oldLoop + newLoop)) *
            signState * midpointPrimaryVoltage;
        const magneticsResidual = midpointPrimaryVoltage * (0.5 * (oldExcess + newExcess)) -
            hysteresisPower -
            seExcessEnergyDelta(opt, oldFlux, newFlux) * opt.inverseFastDt;
        // Smoothed sign of the primary voltage orienting the coercive offset: a first-order
        // lag towards the soft sign v/(|v| + v_eps), clamped to [-1, 1] and flushed once it
        // decays into denormal territory during long silence.
        let sign = signState + opt.hysteresisRate *
            (source / (Math.abs(source) + HYSTERESIS_VOLTAGE_EPSILON_V) - signState);
        sign = sign > 1 ? 1 : (sign < -1 ? -1 : sign);
        const newSign = Math.abs(sign) < HYSTERESIS_SIGN_FLUSH_THRESHOLD ? 0 : sign;
        const residual = state.parameters.outputStage === 2
            ? midpointPrimaryVoltage * (midpointCurrent + midpointMagnetizing +
                midpointPrimaryVoltage * opt.inverseCoreLossResistanceOhm) -
                opt.effectiveResistanceOhm * midpointCurrent * midpointCurrent -
                midpointPrimaryVoltage * midpointPrimaryVoltage *
                    opt.inverseCoreLossResistanceOhm -
                (newEnergy - oldEnergy) * opt.inverseFastDt + magneticsResidual
            : source * (midpointCurrent + midpointMagnetizing) -
                opt.effectiveResistanceOhm * midpointCurrent * midpointCurrent -
                opt.coreLossResistanceOhm * midpointMagnetizing * midpointMagnetizing -
                (newEnergy - oldEnergy) * opt.inverseFastDt + magneticsResidual;
        state.maximumEnergyResidual = Math.max(
            state.maximumEnergyResidual, Math.abs(residual)
        );
        power.optCurrentA = newCurrent;
        power.optCapacitorV = newCapacitor;
        power.magnetizingCurrentA = newMagnetizing;
        power.primaryVoltageV = source;
        power.fluxLinkageWbT = newFlux;
        power.excessCurrentA = newExcess;
        power.hysteresisSignState = newSign;
        const secondaryCurrent = newCurrent * opt.turnsRatio;
        if (opt.voiceStepLimited) {
            ++state.safetyLimits;
            ++state.observedSafetyLimits;
            state.stepSafetyHit = true;
        }
        const loadVoltage = secondaryCurrent * opt.speakerLoadOhm;
        power.speakerVoiceCurrentA += opt.voiceStep *
            (loadVoltage - opt.voiceResistanceOhm * power.speakerVoiceCurrentA -
                power.speakerCapacitorV);
        if (opt.resonanceStepLimited) {
            ++state.safetyLimits;
            ++state.observedSafetyLimits;
            state.stepSafetyHit = true;
        }
        power.speakerResonanceCurrentA += opt.resonanceStep *
            (loadVoltage - opt.resonanceResistanceOhm *
                power.speakerResonanceCurrentA - power.speakerCapacitorV);
        power.speakerCapacitorV += opt.speakerCapacitorStep *
            (power.speakerVoiceCurrentA + power.speakerResonanceCurrentA);
        const output = loadVoltage + power.speakerCapacitorV * 0.02;
        power.speakerLoadVoltageV = loadVoltage;
        power.speakerLoadCurrentA = secondaryCurrent;
        power.feedbackV = output * opt.nfbTapGain;
        return output;
    }

    function finitePowerState(power) {
        return Object.values(power).every(value =>
            typeof value === 'object' ? finiteRamp(value) : Number.isFinite(value));
    }

    function advancePower(state, channel, input, driverBypassed = false) {
        const power = state.power[channel];
        advanceRamp(power.cathodePushRamp);
        advanceRamp(power.cathodePullRamp);
        advanceRamp(power.bPlusRamp);
        advanceRamp(power.screenRamp);
        const ltp = state.powerLtp;
        const ltpTables = state.tables[0];

        // (0) Previous-sample operating point. Both triodes are linearised about it, so the tail
        // and plate nodes below are exact solutions of a companion model rather than an iteration.
        const ltpCathode0 = power.ltpCathodeV;
        const vgkA0 = power.ltpGridAV - ltpCathode0;
        const vakA0 = power.ltpPlateAV - ltpCathode0;
        const vgkB0 = -ltpCathode0;
        const vakB0 = power.ltpPlateBV - ltpCathode0;
        const triodeA = evaluatePlateTables(ltpTables, vgkA0, vakA0);
        const triodeB = evaluatePlateTables(ltpTables, vgkB0, vakB0);

        // (1) Fixed pre-power volume and LTP input AC coupling, solved as one network. The 1 MOhm
        // potentiometer hangs off the driver output-coupling node, its lower section returns to
        // ground and its wiper drives the phase-inverter input capacitor; the capacitor holds its
        // voltage across the step, so the wiper node is the only unknown and follows from a single
        // node equation. The grid-stopper branch is the one breakpoint of a piecewise-linear
        // network, so it is resolved by re-solving that same equation once with the branch closed -
        // a case selection with a guaranteed consistent result, not an iteration. Grid conduction
        // charges the capacitor and shifts the grid negative; the grid-leak return relaxes it with
        // tau = (Rth + Rgl)*Cin, where Rth is the parallel combination of the two pot sections.
        const wiperSource = input * ltp.preVolumeSourceConductance +
            power.ltpInputCapV * ltp.inverseLtpGridLeak;
        // With the common driver bypassed, Input Reference is already the physical voltage at
        // the power-stage input. Inject it at the phase-inverter coupling capacitor instead of
        // attenuating it through the fixed interstage volume network.
        let wiper = driverBypassed
            ? input
            : wiperSource * ltp.inverseWiperConductanceOpen;
        let ltpGridA = wiper - power.ltpInputCapV;
        let ltpGridCurrent = 0;
        if (ltpGridA > ltpCathode0) {
            if (!driverBypassed) {
                wiper = (wiperSource +
                    ltp.inverseGridStopper * (power.ltpInputCapV + ltpCathode0)) *
                    ltp.inverseWiperConductanceConducting;
            }
            ltpGridA = wiper - power.ltpInputCapV;
            ltpGridCurrent = (ltpGridA - ltpCathode0) * ltp.inverseGridStopper;
        }
        power.ltpInputCapV += ltp.dtOverInputCapacitance *
            (ltpGridA * ltp.inverseLtpGridLeak + ltpGridCurrent);

        // (2) Output-tube grid networks seen from the LTP plates. Each coupling capacitor holds its
        // voltage across the step, so the grid node is an affine function of the plate it hangs on
        // and the whole network reduces to a conductance plus a source current. The grid-stopper
        // branch is switched by the diode state observed on the previous sample, exactly like the
        // existing output-tube Ig1 clamp; every other term is exact.
        // Triode A is the driven side and inverts, so it feeds the pull output tube; triode B
        // follows the tail and feeds the push output tube. That keeps the Power forward polarity,
        // and with it the sign of the fixed secondary feedback tap, unchanged.
        const pushStopper = power.gridPushV > power.cathodePushRamp.applied
            ? ltp.inverseGridStopper
            : 0;
        const pullStopper = power.gridPullV > power.cathodePullRamp.applied
            ? ltp.inverseGridStopper
            : 0;
        const pushLoadConductance = ltp.inverseGridLeak + pushStopper;
        const pullLoadConductance = ltp.inverseGridLeak + pullStopper;
        const pushLoadSource = -power.gridCouplingPushV * ltp.inverseGridLeak -
            pushStopper * (power.gridCouplingPushV + power.cathodePushRamp.applied);
        const pullLoadSource = -power.gridCouplingPullV * ltp.inverseGridLeak -
            pullStopper * (power.gridCouplingPullV + power.cathodePullRamp.applied);

        // (3) Tail and both plate nodes solved simultaneously. Substituting each plate equation
        // into the tail equation leaves one scalar unknown, so the three-node companion system is
        // solved in closed form with three divisions and no iteration. Keeping the grid-network
        // conductance in the same sample is what makes the solve unconditionally stable: a
        // one-sample-delayed grid current would close a loop of gain Rgs^-1 / (Ra^-1 + gp) which
        // exceeds one during grid conduction.
        const transconductanceA = triodeA.gridDerivative + triodeA.plateDerivative;
        const transconductanceB = triodeB.gridDerivative + triodeB.plateDerivative;
        const sourceA = triodeA.current +
            triodeA.gridDerivative * (ltpGridA - vgkA0) -
            triodeA.plateDerivative * vakA0;
        const sourceB = triodeB.current +
            triodeB.gridDerivative * (0 - vgkB0) -
            triodeB.plateDerivative * vakB0;
        const inversePlateDenominatorA = 1 /
            (ltp.inversePlateResistance + triodeA.plateDerivative + pullLoadConductance);
        const inversePlateDenominatorB = 1 /
            (ltp.inversePlateResistance + triodeB.plateDerivative + pushLoadConductance);
        const bPlusOverPlateResistance = power.bPlusRamp.applied * ltp.inversePlateResistance;
        const plateSourceA = bPlusOverPlateResistance - sourceA - pullLoadSource;
        const plateSourceB = bPlusOverPlateResistance - sourceB - pushLoadSource;
        const tailConductance = ltp.inverseTailResistance + transconductanceA +
            transconductanceB -
            triodeA.plateDerivative * transconductanceA * inversePlateDenominatorA -
            triodeB.plateDerivative * transconductanceB * inversePlateDenominatorB;
        const tailSource = ltp.tailSupplyOverTailResistance + sourceA + sourceB +
            triodeA.plateDerivative * plateSourceA * inversePlateDenominatorA +
            triodeB.plateDerivative * plateSourceB * inversePlateDenominatorB;
        const ltpCathode = tailSource / tailConductance;
        const ltpPlateA = (plateSourceA + transconductanceA * ltpCathode) *
            inversePlateDenominatorA;
        const ltpPlateB = (plateSourceB + transconductanceB * ltpCathode) *
            inversePlateDenominatorB;
        power.ltpCathodeV = ltpCathode;
        power.ltpPlateAV = ltpPlateA;
        power.ltpPlateBV = ltpPlateB;
        power.ltpGridAV = ltpGridA;
        power.ltpBalanceV = ltpPlateA - ltpPlateB;
        // Both phase-inverter plate loads return to the same reservoir node the output valves feed
        // from, so the current they draw belongs in that node's KCL. Leaving it out left the
        // reservoir balance short by roughly two milliamps - 2.7 per cent of the EL84 standing
        // current.
        power.slowAccumulatorLtpA +=
            (power.bPlusRamp.applied - ltpPlateA + power.bPlusRamp.applied - ltpPlateB) *
            ltp.inversePlateResistance;

        // (4) Advance the two output-tube coupling capacitors on the solved grid currents. Grid
        // conduction charges them and shifts the output-tube bias negative with tau = Rgl*Cg.
        const gridPush = ltpPlateB - power.gridCouplingPushV;
        const pushLoad = pushLoadConductance * ltpPlateB + pushLoadSource;
        power.gridCouplingPushV += ltp.dtOverGridCapacitance * pushLoad;
        power.gridPushV = gridPush;
        const gridPull = ltpPlateA - power.gridCouplingPullV;
        const pullLoad = pullLoadConductance * ltpPlateA + pullLoadSource;
        power.gridCouplingPullV += ltp.dtOverGridCapacitance * pullLoad;
        power.gridPullV = gridPull;

        const opt = state.powerOpt;
        // Screen current only flows in the centre-to-tap winding section, so its ampere-turn
        // contribution to the primary is scaled by the tap turns ratio. It vanishes for a pentode
        // connection, where the screen is fed from its own supply and never crosses the primary.
        // Each plate solve needs the opposite half primary's drive; that one term is carried over
        // from the previous sample so the two solves stay sequential.
        const previousPushDrive = power.iaPushA + opt.screenTapTurnsRatio * power.ig2PushA;
        const previousPullDrive = power.iaPullA + opt.screenTapTurnsRatio * power.ig2PullA;
        // One-sample-delayed coupling of the nonlinear core: the excess magnetizing current
        // committed at the end of the previous sample is subtracted from the differential
        // ampere-turn drive, so the primary emf collapses when the core saturates. Both plate
        // load lines see the same correction through their opposite-drive terms - the push side
        // adds it, the pull side subtracts it - which keeps signedDriveOhm*(drive - opposite)
        // equal to the corrected differential drive for either solve.
        const excessPrevious = power.excessCurrentA;
        const push = solvePowerPlate(state, channel, true, previousPullDrive + excessPrevious);
        const pull = solvePowerPlate(state, channel, false, previousPushDrive - excessPrevious);
        power.platePushV = push.plate;
        power.platePullV = pull.plate;
        power.iaPushA = push.ia;
        power.iaPullA = pull.ia;
        power.ig2PushA = push.ig2;
        power.ig2PullA = pull.ig2;
        power.screenTapV = 0.5 * (push.screenTap + pull.screenTap);
        // For a distributed tap the mean of the two fast-computed screen terminals is the meter
        // reading this field publishes. For a pentode connection screenV is the slow reservoir
        // state itself, and the solver's applied ramp must not be written back into the
        // integrator.
        if (opt.distributedScreenTap) {
            power.screenV = 0.5 * (push.screen + pull.screen);
        }
        power.screenPushV = push.screen;
        power.screenPullV = pull.screen;
        const primarySource = (push.drive - pull.drive - excessPrevious) * opt.primaryDriveOhm;
        const output = advancePowerOutputLoad(state, channel, primarySource);
        power.slowAccumulatorPushA += push.ia + push.ig2;
        power.slowAccumulatorPullA += pull.ia + pull.ig2;
        power.slowAccumulatorScreenA += push.ig2 + pull.ig2;
        ++power.slowCounter;
        if (power.slowCounter >= K.slowWindow) {
            power.slowCounter = 0;
            updatePowerSlow(state, channel);
        }
        power.vrmsSquareSum += power.speakerLoadVoltageV * power.speakerLoadVoltageV;
        power.realPowerSum += power.speakerLoadVoltageV * power.speakerLoadCurrentA;
        ++power.powerWindowSamples;
        if (power.powerWindowSamples >= K.internalRate / 10) {
            const inverse = 1 / power.powerWindowSamples;
            power.publishedVrms = Math.sqrt(power.vrmsSquareSum * inverse);
            power.publishedRealPower = power.realPowerSum * inverse;
            power.vrmsSquareSum = 0;
            power.realPowerSum = 0;
            power.powerWindowSamples = 0;
        }
        if (!finitePowerState(power) || !Number.isFinite(output)) {
            ++state.finiteFaults;
            ++state.observedFiniteFaults;
            state.blockFiniteFault = true;
            resetPowerState(state, channel);
            return 0;
        }
        return output / 25;
    }

    function finiteStage(stage) {
        return Number.isFinite(stage.gridVoltage) &&
            Number.isFinite(stage.plateVoltage) &&
            Number.isFinite(stage.couplingCharge) &&
            Number.isFinite(stage.millerVoltage) &&
            Number.isFinite(stage.millerCapacitance) &&
            Number.isFinite(stage.localPlateGain) &&
            Number.isFinite(stage.outputResistance) &&
            Number.isFinite(stage.previousVak);
    }

    function finitePhysicalChannel(state, channel) {
        const fast = state.fast[channel];
        const slow = state.slow[channel];
        const accumulator = state.accumulator[channel];
        return finiteStage(fast.stage[0]) && finiteStage(fast.stage[1]) &&
            Number.isFinite(fast.outputCouplingCharge) &&
            Number.isFinite(fast.outputLoadCurrent) &&
            Number.isFinite(slow.cathode[0].voltage) &&
            Number.isFinite(slow.cathode[0].capacitorCurrent) &&
            Number.isFinite(slow.cathode[1].voltage) &&
            Number.isFinite(slow.cathode[1].capacitorCurrent) &&
            Number.isFinite(slow.supply.voltage) &&
            Number.isFinite(slow.supply.capacitorCurrent) &&
            finiteRamp(slow.cathodeRamp[0]) &&
            finiteRamp(slow.cathodeRamp[1]) &&
            finiteRamp(slow.supplyRamp) &&
            Number.isFinite(accumulator.uK1) &&
            Number.isFinite(accumulator.uK2) &&
            Number.isFinite(accumulator.uP) &&
            accumulator.count >= 0 && accumulator.count < K.slowWindow;
    }

    function physicalRangesValid(state, channel) {
        const fast = state.fast[channel];
        const slow = state.slow[channel];
        if (slow.supply.voltage < 0 || slow.supply.voltage > 400) return false;
        for (let stageIndex = 0; stageIndex < 2; ++stageIndex) {
            const cathode = slow.cathode[stageIndex].voltage;
            const plate = fast.stage[stageIndex].plateVoltage;
            const vak = plate - cathode;
            if (cathode < -100 || cathode > 300 || plate < -100 ||
                plate > 600 || vak < -100 || vak > 600) return false;
        }
        return true;
    }

    function restorePhysicalChannel(state, channel) {
        state.fast[channel] = cloneFastChannel(state.recoveryFast[channel]);
        state.slow[channel] = cloneSlowState(state.recoverySlow[channel]);
        state.accumulator[channel] = makeAccumulator();
    }

    function restoreRuntimeBaseline(state) {
        const finiteFaults = state.finiteFaults;
        const safetyLimits = state.safetyLimits;
        const slowPublishCount = state.slowPublishCount;
        // A non-finite fault must not hand back the headroom the detector already took away, so
        // the reduction is carried across the rebuild exactly like the fault counters. A value
        // that is itself non-finite is the one thing that cannot be carried: it would poison
        // every later block, so it falls back to unity and the detector measures again.
        const safety = state.outputSafety;
        const gain = Number.isFinite(safety.gain) ? safety.gain : 1;
        const target = Number.isFinite(safety.target) ? safety.target : 1;
        const step = Number.isFinite(safety.step) ? safety.step : 0;
        const remaining = Number.isFinite(safety.step) ? safety.remaining : 0;
        cancelFeedbackTransition(state);
        resetRuntimeState(state, false, true);
        state.finiteFaults = finiteFaults;
        state.safetyLimits = safetyLimits;
        state.slowPublishCount = slowPublishCount;
        safety.gain = gain;
        safety.target = target;
        safety.step = step;
        safety.remaining = remaining;
    }

    // Driver output half. The second stage is driven by the first stage's plate through the
    // one-sample-delayed Thevenin coupling and the output coupling capacitor hangs off the second
    // plate, so the value returned here is fixed by state that is already settled when the sample
    // begins and carries no dependence on this sample's input. Evaluating it before the feedback
    // compensator is therefore the same closed-form companion solve used elsewhere, with the
    // current-sample sensitivity of the detector to the compensator output identically zero.
    function advanceDriverOutput(state, channel) {
        state.stepSafetyHit = false;
        const fast = state.fast[channel];
        const slow = state.slow[channel];
        // The output half runs first in the sample, so the ramps advance here and the input half
        // reads the same values.
        advanceRamp(slow.cathodeRamp[0]);
        advanceRamp(slow.cathodeRamp[1]);
        advanceRamp(slow.supplyRamp);
        const delayedPlate1 = fast.stage[0].plateVoltage;
        const delayedResistance1 = fast.stage[0].outputResistance;
        const delayedOutputLoadCurrent = fast.outputLoadCurrent;
        const second = advanceStage(
            state,
            fast.stage[1],
            delayedPlate1,
            delayedResistance1,
            slow.supplyRamp.applied,
            slow.cathodeRamp[1].applied,
            delayedOutputLoadCurrent,
            channel,
            1
        );
        const oldOutputCharge = fast.outputCouplingCharge;
        const outputDenominator = 1 +
            K.fastDt / (K.outputCapacitance * K.outputLoadResistance);
        const output = safetyBound(
            state,
            (fast.stage[1].plateVoltage -
                oldOutputCharge / K.outputCapacitance) / outputDenominator,
            -K.maximumOutputVoltage,
            K.maximumOutputVoltage
        );
        fast.outputCouplingCharge = safetyBound(
            state,
            fast.outputCouplingCharge +
                K.fastDt * output / K.outputLoadResistance,
            -K.outputCapacitance * K.maximumCouplingEquivalentVoltage,
            K.outputCapacitance * K.maximumCouplingEquivalentVoltage
        );
        fast.outputLoadCurrent = output / K.outputLoadResistance;
        const iCout = (fast.outputCouplingCharge - oldOutputCharge) / K.fastDt;
        const outputResidual = iCout - fast.outputLoadCurrent;
        observeFastKcl(state, outputResidual, 'output', channel);
        const split = state.driverSplit[channel];
        split.second = second;
        split.iCout = iCout;
        split.output = output;
        const diagnostic = state.diagnostic;
        if (channel === 0 && diagnostic &&
            diagnostic.kind === 'break-loop-impulse' &&
            diagnostic.sample < diagnostic.captureSamples) {
            diagnostic.outputResponse.push(output * 0.001);
        }
        // The driver plate voltage leaves this function in volts. The internal loop applies the
        // Line headroom scale on the Line branch only; the Power phase inverter needs real volts.
        return output;
    }

    // Driver input half: the first stage, the shared supply and cathode accumulators, and the
    // per-sample validity checks. Splitting the channel here only reorders the two stages; neither
    // reads anything the other writes within a sample, so every committed value is unchanged.
    function advanceDriverInput(state, channel, input) {
        const fast = state.fast[channel];
        const slow = state.slow[channel];
        const split = state.driverSplit[channel];
        const second = split.second;
        const first = advanceStage(
            state,
            fast.stage[0],
            input,
            state.sourceResistance,
            slow.supplyRamp.applied,
            slow.cathodeRamp[0].applied,
            0,
            channel,
            0
        );
        const iRa1 = first.plateCurrent - first.iCga + first.iCak +
            second.couplingCurrent;
        const iRa2 = second.plateCurrent - second.iCga + second.iCak +
            split.iCout;
        updateSlow(state, channel, iRa1, iRa2, first, second);
        if (!finitePhysicalChannel(state, channel)) {
            ++state.finiteFaults;
            ++state.observedFiniteFaults;
            state.blockFiniteFault = true;
            restorePhysicalChannel(state, channel);
            return false;
        }
        if (!physicalRangesValid(state, channel)) {
            ++state.safetyLimits;
            ++state.observedSafetyLimits;
            state.stepSafetyHit = true;
        }
        if (state.stepSafetyHit) {
            state.blockSafetyHit = true;
            restorePhysicalChannel(state, channel);
            return false;
        }
        const output = split.output;
        state.telemetry[0] += output >= 0 ? output : -output;
        state.telemetry[1] = slow.cathode[0].voltage;
        state.telemetry[2] = slow.cathode[1].voltage;
        state.telemetry[3] = slow.supply.voltage;
        state.telemetry[4] = first.plateCurrent;
        state.telemetry[5] = second.plateCurrent;
        state.telemetry[6] = first.gridCurrent;
        state.telemetry[7] = second.gridCurrent;
        state.telemetry[8] = iRa1;
        state.telemetry[9] = iRa2;
        return true;
    }

    function advanceChannel(state, channel, input) {
        const output = advanceDriverOutput(state, channel);
        return advanceDriverInput(state, channel, input) ? output : 0;
    }

    function applyFeedback(state, channel, input) {
        const diagnostic = state.diagnostic;
        const breakLoop = channel === 0 && diagnostic &&
            diagnostic.kind === 'break-loop-impulse';
        const probe = state.detectorProbe;
        if (state.controls.feedbackDb === 0 && !breakLoop) {
            if (probe.enabled) {
                probe.inputEnergy += input * input;
                ++probe.inputSamples;
                ++probe.feedbackSamples;
            }
            return input;
        }
        const filter = state.feedback[channel];
        if (breakLoop) {
            const detected = filter.transport[filter.transportIndex] -
                state.controls.plateReference;
            if (diagnostic.sample < diagnostic.captureSamples) {
                diagnostic.detectorResponse.push(detected);
            }
            return diagnostic.sample === 0 ? diagnostic.amplitude : 0;
        }
        const detected = filter.transport[filter.transportIndex] -
            (state.parameters.outputStage === 0 ? state.controls.plateReference : 0);
        if (probe.enabled) {
            const feedback = state.controls.feedbackBeta * detected;
            probe.inputEnergy += input * input;
            probe.feedbackEnergy += feedback * feedback;
            ++probe.inputSamples;
            ++probe.feedbackSamples;
        }
        const error = input - state.controls.feedbackBeta * detected;
        const output = state.controls.feedbackB0 * error + filter.s1;
        filter.s1 = state.controls.feedbackB1 * error -
            state.controls.feedbackA1 * output + filter.s2;
        filter.s2 = -state.controls.feedbackA2 * output;
        return output;
    }

    function observeFeedback(state, channel) {
        const diagnostic = state.diagnostic;
        const breakLoop = channel === 0 && diagnostic &&
            diagnostic.kind === 'break-loop-impulse';
        if (state.controls.feedbackDb === 0 && !breakLoop) return;
        const filter = state.feedback[channel];
        filter.transport[filter.transportIndex] =
            state.parameters.outputStage !== 0
                ? state.power[channel].feedbackV
                : state.fast[channel].stage[1].plateVoltage;
    }

    // The break-loop capture index advances once per internal sample, after every diagnostic hook
    // of that sample has run. It is kept out of observeFeedback because the Power branch observes
    // the tap before the compensator injects, and the Line branch after.
    function advanceBreakLoopSample(state) {
        const diagnostic = state.diagnostic;
        if (diagnostic && diagnostic.kind === 'break-loop-impulse') {
            ++diagnostic.sample;
        }
    }

    function smoothstep(position) {
        return position * position * (3 - 2 * position);
    }

    function faultBoundaryRemainingFrames(state) {
        const fault = state.fault;
        if (fault.state === 1 && fault.muteRemaining !== 0) {
            return fault.muteRemaining;
        }
        if (fault.state === 3 && fault.trialRemaining !== 0) {
            return fault.trialRemaining;
        }
        if (fault.state === 4 && fault.returnRemaining !== 0) {
            return fault.returnRemaining;
        }
        return Number.MAX_SAFE_INTEGER;
    }

    function detectorWindowRemainingFrames(state) {
        const faultState = state.fault.state;
        if (faultState !== 0 && faultState !== 3 && faultState !== 4) {
            return Number.MAX_SAFE_INTEGER;
        }
        const windowSamples =
            K.internalRate * K.feedbackDetectorWindowMilliseconds / 1000;
        if (state.feedbackDetector.samples >= windowSamples) return 1;
        return Math.ceil(
            (windowSamples - state.feedbackDetector.samples) / K.factor
        );
    }

    function dispatchCentralReset(state, reason) {
        state.centralReset.reason = reason;
        ++state.centralReset.count;
        resetRuntimeState(state, true, true);
    }

    function clearFeedbackFault(state) {
        state.runtimeEvent.latched = 0;
        state.runtimeEvent.cause = 0;
        ++state.runtimeEvent.generation;
        state.fault.state = 0;
        state.fault.wet = 1;
        state.fault.muteRemaining = 0;
        state.fault.trialRemaining = 0;
        state.fault.returnRemaining = 0;
        state.fault.clearPending = false;
        resetFeedbackDetector(state);
    }

    function handleFaultBoundary(state) {
        const fault = state.fault;
        if (fault.clearPending && state.runtimeEvent.cause === 1) {
            fault.clearPending = false;
            clearFeedbackFault(state);
            return;
        }
        if (!fault.resetPending || state.runtimeEvent.cause !== 1) return;
        if (fault.pendingParameters) {
            applyParameters(state, fault.pendingParameters, false);
            fault.pendingParameters = null;
            fault.trialAfterReset = true;
        }
        fault.resetPending = false;
        dispatchCentralReset(state, 2);
        fault.wet = 0;
        if (fault.trialAfterReset) {
            fault.state = 3;
            fault.trialRemaining = Math.max(
                1,
                Math.ceil(K.hostRate * K.feedbackTrialMilliseconds / 1000)
            );
            fault.trialObservationStartFrame = state.processedHostFrames;
        } else {
            fault.state = 2;
        }
        fault.trialAfterReset = false;
    }

    function latchFeedbackFault(state, hostFrameOffset) {
        const firstDetection = state.runtimeEvent.latched === 0;
        if (firstDetection) {
            state.runtimeEvent.latched = 1;
            state.runtimeEvent.cause = 1;
            ++state.runtimeEvent.generation;
        }
        const fault = state.fault;
        if (fault.detectionOffset !== null) return;
        const transition = state.feedbackTransition;
        if (transition.active) {
            if (state.pendingParameters) {
                fault.pendingParameters = state.pendingParameters;
            } else if (state.queuedParameters) {
                fault.pendingParameters = state.queuedParameters;
            }
            cancelFeedbackTransition(state);
        }
        fault.detectionOffset = hostFrameOffset;
        if (firstDetection) {
            fault.detectionFrame =
                state.processedHostFrames + hostFrameOffset;
        }
    }

    function evaluateFeedbackDetectorWindow(
        state,
        inputRms,
        outputRms,
        feedbackRms,
        hostFrameOffset
    ) {
        const detector = state.feedbackDetector;
        const hadPrevious = detector.hasPrevious;
        const previousInput = detector.previousInputRms;
        const previousOutput = detector.previousOutputRms;
        const previousFeedback = detector.previousFeedbackRms;
        const ratiosAvailable =
            hadPrevious && previousOutput > 0 && previousFeedback > 0;
        const outputGrowing = ratiosAvailable &&
            outputRms / previousOutput >= K.feedbackGrowthRatio &&
            outputRms * previousInput >=
                K.feedbackGrowthRatio * previousOutput * inputRms;
        const feedbackGrowing = ratiosAvailable &&
            feedbackRms / previousFeedback >= K.feedbackGrowthRatio &&
            feedbackRms * previousInput >=
                K.feedbackGrowthRatio * previousFeedback * inputRms;
        const profile = state.parameters.outputStage === 0
            ? K.lineFeedbackDetector
            : K.powerFeedbackDetector;
        const growthLevels =
            outputRms >= profile.growthOutputRms &&
            feedbackRms >= profile.growthFeedbackRms;
        const growthQualifies =
            growthLevels && outputGrowing && feedbackGrowing;
        detector.growthCount =
            growthQualifies ? detector.growthCount + 1 : 0;
        detector.previousInputRms = inputRms;
        detector.previousOutputRms = outputRms;
        detector.previousFeedbackRms = feedbackRms;
        detector.hasPrevious = true;
        // The post-input branch runs on the coarse window of the stage's
        // profile. A span of one leaves every quantity below equal to the 10 ms
        // window it was accumulated from - sqrt(x * x) is exactly x for every
        // finite double - so the line stage keeps the behaviour it was
        // calibrated for, bit for bit.
        detector.sustainedInputEnergy += inputRms * inputRms;
        detector.sustainedOutputEnergy += outputRms * outputRms;
        detector.sustainedFeedbackEnergy += feedbackRms * feedbackRms;
        detector.sustainedSpan += 1;
        let inputStopped = false;
        let inputNotGrowing = false;
        let inputNotDriving = false;
        let outputNonDecaying = false;
        let feedbackNonDecaying = false;
        let sustainedLevels = false;
        let sustainedQualifies = false;
        if (detector.sustainedSpan >= profile.sustainedWindowSpan) {
            const span = detector.sustainedSpan;
            const coarseInput =
                Math.sqrt(detector.sustainedInputEnergy / span);
            const coarseOutput =
                Math.sqrt(detector.sustainedOutputEnergy / span);
            const coarseFeedback =
                Math.sqrt(detector.sustainedFeedbackEnergy / span);
            const coarseRatiosAvailable = detector.sustainedHasPrevious &&
                detector.sustainedPreviousOutputRms > 0 &&
                detector.sustainedPreviousFeedbackRms > 0;
            inputStopped = coarseInput === 0;
            inputNotGrowing = detector.sustainedHasPrevious && (
                detector.sustainedPreviousInputRms === 0
                    ? inputStopped
                    : coarseInput / detector.sustainedPreviousInputRms <= 1
            );
            // Written as a product rather than a quotient so that a silent
            // window, where both sides are zero, is decided the same way as
            // every other and never forms 0/0.
            inputNotDriving = profile.sustainedDriveRatio > 0
                ? coarseFeedback >=
                    profile.sustainedDriveRatio * coarseInput
                : inputStopped && inputNotGrowing;
            outputNonDecaying = coarseRatiosAvailable &&
                coarseOutput / detector.sustainedPreviousOutputRms >=
                    K.feedbackNonDecayRatio;
            feedbackNonDecaying = coarseRatiosAvailable &&
                coarseFeedback / detector.sustainedPreviousFeedbackRms >=
                    K.feedbackNonDecayRatio;
            sustainedLevels =
                coarseOutput >= profile.sustainedOutputRms &&
                coarseFeedback >= profile.sustainedFeedbackRms;
            sustainedQualifies =
                sustainedLevels && inputNotDriving &&
                outputNonDecaying && feedbackNonDecaying;
            detector.sustainedCount =
                sustainedQualifies ? detector.sustainedCount + 1 : 0;
            detector.sustainedPreviousInputRms = coarseInput;
            detector.sustainedPreviousOutputRms = coarseOutput;
            detector.sustainedPreviousFeedbackRms = coarseFeedback;
            detector.sustainedHasPrevious = true;
            detector.sustainedInputEnergy = 0;
            detector.sustainedOutputEnergy = 0;
            detector.sustainedFeedbackEnergy = 0;
            detector.sustainedSpan = 0;
        }
        const selectedBranch =
            detector.growthCount >= K.feedbackGrowthWindows
                ? 1
                : detector.sustainedCount >= profile.sustainedWindows ? 2 : 0;
        if (selectedBranch !== 0) {
            latchFeedbackFault(state, hostFrameOffset);
        }
        const predicates = [
            ratiosAvailable,
            growthLevels,
            sustainedLevels,
            inputStopped,
            inputNotGrowing,
            outputGrowing,
            feedbackGrowing,
            outputNonDecaying,
            feedbackNonDecaying,
            growthQualifies,
            sustainedQualifies,
            hadPrevious,
            inputNotDriving
        ];
        let predicateBits = 0;
        for (let index = 0; index < predicates.length; ++index) {
            if (predicates[index]) predicateBits |= 1 << index;
        }
        const endFrame =
            state.processedHostFrames + hostFrameOffset + 1;
        const windowFrames = Math.ceil(
            K.hostRate * K.feedbackDetectorWindowMilliseconds / 1000
        );
        if (detector.windows.length < K.detectorTraceCapacity) {
            detector.windows.push({
                index: detector.windows.length,
                startFrame: Math.max(0, endFrame - windowFrames),
                endFrame,
                previousRms: hadPrevious
                    ? [previousInput, previousOutput, previousFeedback]
                    : [0, 0, 0],
                rms: [inputRms, outputRms, feedbackRms],
                predicateBits,
                growthCount: detector.growthCount,
                sustainedCount: detector.sustainedCount,
                selectedBranch,
                runtimeEvent: [
                    state.runtimeEvent.generation,
                    state.runtimeEvent.latched,
                    state.runtimeEvent.cause
                ],
                faultState: state.fault.state
            });
        } else {
            detector.overflow = true;
        }
    }

    function observeFeedbackDetector(
        state,
        inputLeft,
        inputRight,
        left,
        right,
        outputGain,
        hostFrameOffset
    ) {
        const faultState = state.fault.state;
        if ((faultState !== 0 && faultState !== 3 && faultState !== 4) ||
            state.fault.detectionOffset !== null) {
            return;
        }
        const detector = state.feedbackDetector;
        const scale = state.controls.feedbackMakeup * outputGain;
        const feedbackLeft = state.controls.feedbackBeta *
            (state.parameters.outputStage !== 0
                ? state.power[0].feedbackV
                : state.fast[0].stage[1].plateVoltage -
                    state.controls.plateReference);
        const feedbackRight = state.controls.feedbackBeta *
            (state.parameters.outputStage !== 0
                ? state.power[1].feedbackV
                : state.fast[1].stage[1].plateVoltage -
                    state.controls.plateReference);
        detector.inputEnergy +=
            inputLeft * inputLeft + inputRight * inputRight;
        const wetLeft = left * scale;
        const wetRight = right * scale;
        detector.outputEnergy +=
            wetLeft * wetLeft + wetRight * wetRight;
        detector.feedbackEnergy +=
            feedbackLeft * feedbackLeft + feedbackRight * feedbackRight;
        ++detector.samples;
        const windowSamples =
            K.internalRate * K.feedbackDetectorWindowMilliseconds / 1000;
        if (detector.samples < windowSamples) return;
        const denominator = 2 * detector.samples;
        evaluateFeedbackDetectorWindow(
            state,
            Math.sqrt(detector.inputEnergy / denominator),
            Math.sqrt(detector.outputEnergy / denominator),
            Math.sqrt(detector.feedbackEnergy / denominator),
            hostFrameOffset
        );
        detector.inputEnergy = 0;
        detector.outputEnergy = 0;
        detector.feedbackEnergy = 0;
        detector.samples = 0;
    }

    function prepareFaultWet(state, frameCount, blockStartState) {
        const fault = state.fault;
        const values = new Float64Array(frameCount);
        const fadeFrames = state.feedbackTransition.fadeOutFrames;
        let faultState = blockStartState;
        for (let frame = 0; frame < frameCount; ++frame) {
            if (frame === fault.detectionOffset) {
                if (faultState === 0) {
                    faultState = 1;
                    fault.muteRemaining = fadeFrames + 1;
                } else if (faultState === 3 || faultState === 4) {
                    faultState = 2;
                    fault.wet = 0;
                    fault.trialRemaining = 0;
                    fault.returnRemaining = 0;
                    fault.clearPending = false;
                    fault.resetPending = false;
                    fault.trialAfterReset = false;
                }
            }
            if (faultState === 0) {
                fault.wet = 1;
            } else if (faultState === 1 && fault.muteRemaining !== 0) {
                const progress =
                    fadeFrames + 1 - fault.muteRemaining;
                fault.wet = 1 - smoothstep(progress / fadeFrames);
                --fault.muteRemaining;
                if (fault.muteRemaining === 0) {
                    faultState = 2;
                    fault.wet = 0;
                    fault.muteCompleteFrame =
                        state.processedHostFrames + frame;
                    fault.resetPending = true;
                    fault.trialAfterReset =
                        fault.pendingParameters !== null;
                }
            } else if (faultState === 2 || faultState === 3) {
                fault.wet = 0;
                if (faultState === 3 &&
                    fault.detectionOffset === null &&
                    fault.trialRemaining !== 0) {
                    --fault.trialRemaining;
                    if (fault.trialRemaining === 0) {
                        faultState = 4;
                        fault.returnRemaining = fadeFrames;
                    }
                }
            } else if (faultState === 4 &&
                fault.returnRemaining !== 0) {
                const progress =
                    fadeFrames - fault.returnRemaining;
                fault.wet = smoothstep(progress / fadeFrames);
                --fault.returnRemaining;
                if (fault.returnRemaining === 0) {
                    fault.clearPending = true;
                }
            }
            values[frame] = fault.wet;
        }
        fault.state = faultState;
        return values;
    }

    function processSegment(
        state,
        audio,
        blockFrames,
        frameOffset,
        frameCount,
        transitionPhase,
        transitionProgress
    ) {
        state.fault.detectionOffset = null;
        const blockStartFaultState = state.fault.state;
        const driveGain = new Float64Array(frameCount);
        const outputGain = new Float64Array(frameCount);
        const wetMix = new Float64Array(frameCount);
        const inputReference = new Float64Array(frameCount);
        const safetyUser = new Float64Array(frameCount);
        for (let frame = 0; frame < frameCount; ++frame) {
            state.controls.drive += state.controls.coefficient *
                (state.controls.driveTarget - state.controls.drive);
            state.controls.output += state.controls.coefficient *
                (state.controls.outputTarget - state.controls.output);
            state.controls.mix += state.controls.coefficient *
                (state.controls.mixTarget - state.controls.mix);
            state.controls.inputReference += state.controls.coefficient *
                (state.controls.inputReferenceTarget - state.controls.inputReference);
            state.controls.safetyUser += state.controls.coefficient *
                (state.controls.safetyUserTarget - state.controls.safetyUser);
            driveGain[frame] = state.controls.drive;
            outputGain[frame] = state.controls.output;
            wetMix[frame] = state.controls.mix;
            inputReference[frame] = state.controls.inputReference;
            safetyUser[frame] = state.controls.safetyUser;
        }

        const internalFrames = frameCount * K.factor;
        const internalInput = [
            new Float64Array(internalFrames),
            new Float64Array(internalFrames)
        ];
        const internalOutput = [
            new Float64Array(internalFrames),
            new Float64Array(internalFrames)
        ];
        for (let channel = 0; channel < K.channels; ++channel) {
            const hostWork = new Float64Array(K.upsampleHistory + frameCount);
            hostWork.set(state.upsampleState[channel]);
            const audioOffset = channel * blockFrames + frameOffset;
            for (let frame = 0; frame < frameCount; ++frame) {
                hostWork[K.upsampleHistory + frame] =
                    audio[audioOffset + frame] * driveGain[frame];
            }
            for (let frame = 0; frame < frameCount; ++frame) {
                const current = K.upsampleHistory + frame;
                for (let phase = 0; phase < K.factor; ++phase) {
                    let value = 0;
                    let history = 0;
                    for (let tap = phase; tap < K.firLength; tap += K.factor) {
                        value += state.coefficients[tap] * hostWork[current - history];
                        ++history;
                    }
                    internalInput[channel][frame * K.factor + phase] =
                        value * K.factor;
                }
            }
            state.upsampleState[channel].set(
                hostWork.subarray(frameCount, frameCount + K.upsampleHistory)
            );
        }

        for (let index = 0; index < internalFrames; ++index) {
            const hostFrame = Math.floor(index / K.factor);
            if (state.feedbackTransition.stateGeneration !==
                state.feedbackTransition.activeGeneration) {
                ++state.feedbackTransition.oldStateNewNfProcessCount;
            }
            state.currentFastKclHostFrame =
                state.processedHostFrames + hostFrame;
            state.currentFastKclInternalFrame =
                state.processedHostFrames * K.factor + index;
            state.currentFastKclInternalPhase = index % K.factor;
            if (state.parameters.outputStage !== 0) {
                for (let channel = 0; channel < K.channels; ++channel) {
                    if (state.parameters.tubeIndex === 3) {
                        // The skipped driver used to provide the causal sample boundary. Retain
                        // that boundary explicitly: advance the power plant from the previous
                        // compensated input, observe this sample's tap, then store the new input.
                        state.stepSafetyHit = false;
                        const powered = state.parameters.outputStage === 1
                            ? advancePower(state, channel, state.bypassDrive[channel], true)
                            : advanceSingleEnded(state, channel, state.bypassDrive[channel]);
                        if (state.stepSafetyHit) {
                            state.blockSafetyHit = true;
                        }
                        observeFeedback(state, channel);
                        state.bypassDrive[channel] = applyFeedback(
                            state, channel, internalInput[channel][index]);
                        internalOutput[channel][index] = powered;
                        continue;
                    }
                    // The whole forward path of this sample is evaluated before the compensator,
                    // so the tap it subtracts is this sample's. See advanceDriverOutput.
                    const driver = advanceDriverOutput(state, channel);
                    const driverSafetyHit = state.stepSafetyHit;
                    const powered = state.parameters.outputStage === 1
                        ? advancePower(state, channel, driver)
                        : advanceSingleEnded(state, channel, driver);
                    observeFeedback(state, channel);
                    const error = applyFeedback(
                        state, channel, internalInput[channel][index]);
                    state.stepSafetyHit = driverSafetyHit;
                    internalOutput[channel][index] =
                        advanceDriverInput(state, channel, error) ? powered : 0;
                }
            } else {
                if (state.parameters.tubeIndex === 3) {
                    // With neither Pre nor Power selected the wet circuit is an aligned pass-
                    // through. Input Volume remains useful; Input Reference is only calibration.
                    for (let channel = 0; channel < K.channels; ++channel) {
                        internalOutput[channel][index] = applyFeedback(
                            state, channel, internalInput[channel][index]) /
                            inputReference[hostFrame];
                    }
                } else {
                    const driverLeft = advanceChannel(
                        state,
                        0,
                        applyFeedback(state, 0, internalInput[0][index])
                    );
                    internalOutput[0][index] = driverLeft * 0.001;
                    observeFeedback(state, 0);
                    const driverRight = advanceChannel(
                        state,
                        1,
                        applyFeedback(state, 1, internalInput[1][index])
                    );
                    internalOutput[1][index] = driverRight * 0.001;
                    observeFeedback(state, 1);
                }
            }
            advanceBreakLoopSample(state);
            observeFeedbackDetector(
                state,
                internalInput[0][index],
                internalInput[1][index],
                internalOutput[0][index],
                internalOutput[1][index],
                outputGain[hostFrame],
                hostFrame
            );
            if (state.detectorProbe.enabled) {
                const scale = state.controls.feedbackMakeup *
                    outputGain[hostFrame];
                const left = internalOutput[0][index] * scale;
                const right = internalOutput[1][index] * scale;
                state.detectorProbe.outputEnergy +=
                    left * left + right * right;
                state.detectorProbe.outputSamples += 2;
            }
        }

        const faultWet =
            prepareFaultWet(state, frameCount, blockStartFaultState);
        // The mix is split in two because the detector is stereo linked and has to see both
        // channels of one frame at once, while the decimation walks channels on the outside.
        // The first pass stages the wet chain and the aligned dry sample per channel; the second
        // pass runs the detector once per frame and writes the output.
        const wetChain = [
            new Float64Array(frameCount),
            new Float64Array(frameCount)
        ];
        const alignedDry = [
            new Float64Array(frameCount),
            new Float64Array(frameCount)
        ];
        for (let channel = 0; channel < K.channels; ++channel) {
            const internalWork = new Float64Array(K.downsampleHistory + internalFrames);
            internalWork.set(state.downsampleState[channel]);
            internalWork.set(internalOutput[channel], K.downsampleHistory);
            const audioOffset = channel * blockFrames + frameOffset;
            for (let frame = 0; frame < frameCount; ++frame) {
                const current = K.downsampleHistory + frame * K.factor;
                let wet = 0;
                for (let tap = 0; tap < K.firLength; ++tap) {
                    wet += state.coefficients[tap] * internalWork[current - tap];
                }
                const dryIndex = (state.dryIndex + frame) &
                    (K.dryDelayFrames - 1);
                const dry = state.dryDelay[channel][dryIndex];
                state.dryDelay[channel][dryIndex] = audio[audioOffset + frame];
                alignedDry[channel][frame] = dry;
                wetChain[channel][frame] =
                    wet * state.controls.feedbackMakeup *
                        outputGain[frame] * safetyUser[frame];
            }
            state.downsampleState[channel].set(
                internalWork.subarray(
                    internalFrames,
                    internalFrames + K.downsampleHistory
                )
            );
        }
        for (let frame = 0; frame < frameCount; ++frame) {
            // The detector sees the wet chain before the automatic reduction and without the dry
            // path mixed in. Open loop by construction: no result of the reduction re-enters the
            // measurement, so the monotone law measures the true excess.
            const safetyAuto = advanceSafetyReduction(
                state, wetChain[0][frame], wetChain[1][frame]);
            const mix = wetMix[frame];
            let bridgeWet = 1;
            if (transitionPhase === 1) {
                const position =
                    (transitionProgress + frame + 1) /
                    state.feedbackTransition.fadeOutFrames;
                const weight =
                    position * position * (3 - 2 * position);
                bridgeWet = 1 - weight;
            } else if (transitionPhase === 2) {
                bridgeWet = 0;
            } else if (transitionPhase === 3) {
                const position =
                    (transitionProgress + frame + 1) /
                    state.feedbackTransition.fadeInFrames;
                bridgeWet =
                    position * position * (3 - 2 * position);
            }
            for (let channel = 0; channel < K.channels; ++channel) {
                const audioOffset = channel * blockFrames + frameOffset;
                const dry = alignedDry[channel][frame];
                // The dry path is never attenuated, so mx = 0 stays a bit-transparent bypass.
                const normal =
                    wetChain[channel][frame] * safetyAuto * mix +
                    dry * (1 - mix);
                if (transitionPhase === 2) {
                    audio[audioOffset + frame] = dry;
                    if (channel === 0) {
                        ++state.feedbackTransition.warmupWetFrames;
                    }
                    if (audio[audioOffset + frame] !== dry) {
                        ++state.feedbackTransition
                            .warmupAlignedDryMismatches;
                    }
                } else {
                    const processed =
                        dry + bridgeWet * (normal - dry);
                    audio[audioOffset + frame] =
                        processed * faultWet[frame] +
                        dry * (1 - faultWet[frame]);
                }
            }
        }
        state.dryIndex = (state.dryIndex + frameCount) & (K.dryDelayFrames - 1);
        state.processedHostFrames += frameCount;
        return !state.blockFiniteFault && !state.blockSafetyHit;
    }

    function processBlock(state, audio, frameCount) {
        state.blockFiniteFault = false;
        state.blockSafetyHit = false;
        let frameOffset = 0;
        while (frameOffset < frameCount) {
            const transition = state.feedbackTransition;
            if (transition.active) {
                if (transition.phase === 1 &&
                    transition.progress === transition.fadeOutFrames) {
                    applyFeedbackTransitionReset(state);
                } else if (transition.phase === 2 &&
                    transition.progress === transition.warmupFrames) {
                    transition.phase = 3;
                    transition.progress = 0;
                    transition.fadeInFramesTrace[
                        transition.currentTrace
                    ] = state.processedHostFrames;
                    captureTransitionBoundary(state);
                } else if (transition.phase === 3 &&
                    transition.progress === transition.fadeInFrames) {
                    finishFeedbackTransition(state);
                }
            }
            handleFaultBoundary(state);
            let segmentFrames = frameCount - frameOffset;
            let transitionPhase = 0;
            let transitionProgress = 0;
            if (transition.active) {
                transitionPhase = transition.phase;
                transitionProgress = transition.progress;
                const phaseFrames = transition.phase === 1
                    ? transition.fadeOutFrames
                    : transition.phase === 2
                        ? transition.warmupFrames
                        : transition.fadeInFrames;
                const untilBoundary =
                    phaseFrames - transition.progress;
                if (segmentFrames > untilBoundary) {
                    segmentFrames = untilBoundary;
                }
            }
            const faultRemaining = faultBoundaryRemainingFrames(state);
            if (segmentFrames > faultRemaining) {
                segmentFrames = faultRemaining;
            }
            const detectorRemaining =
                detectorWindowRemainingFrames(state);
            if (segmentFrames > detectorRemaining) {
                segmentFrames = detectorRemaining;
            }
            if (segmentFrames === 0) return false;
            if (!processSegment(
                state,
                audio,
                frameCount,
                frameOffset,
                segmentFrames,
                transitionPhase,
                transitionProgress
            )) {
                restoreRuntimeBaseline(state);
                audio.fill(0);
                return false;
            }
            frameOffset += segmentFrames;
            if (transition.active) {
                transition.progress += segmentFrames;
                if (transition.phase === 1 &&
                    transition.progress === transition.fadeOutFrames) {
                    applyFeedbackTransitionReset(state);
                } else if (transition.phase === 2 &&
                    transition.progress === transition.warmupFrames) {
                    transition.phase = 3;
                    transition.progress = 0;
                    transition.fadeInFramesTrace[
                        transition.currentTrace
                    ] = state.processedHostFrames;
                    captureTransitionBoundary(state);
                } else if (transition.phase === 3 &&
                    transition.progress === transition.fadeInFrames) {
                    finishFeedbackTransition(state);
                }
            }
        }
        handleFaultBoundary(state);
        return true;
    }

    const decoded = decodeParameters(parameters);
    if (!decoded) return data;
    if (!context.__tubeSimulatorReferenceV1) {
        context.__tubeSimulatorReferenceV1 = createState(
            decoded,
            context.__tubeSimulatorFormalDebugV1 === true
        );
    } else {
        commitParameters(context.__tubeSimulatorReferenceV1, parameters);
    }
    processBlock(context.__tubeSimulatorReferenceV1, data, parameters.blockSize);
    return data;
`;

class TubeSimulatorPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: TUBE_SIMULATOR_SUPPORTED_SAMPLE_RATES,
        supportedChannelModes: Object.freeze(['stereo-pair'])
    });

    constructor() {
        super('Tube Simulator', 'Physical tube line and push-pull power amplifier simulation');

        // Opening circuit: the complete, level-matched EL84 Pentode @2% preset.
        this.dr = -44.0059;
        this.tp = '12AX7';
        this.bi = 0;
        this.pv = 250;
        this.sz = 10;
        this.su = 10;
        this.og = -7.372;
        this.mx = 100;
        this.iv = 2.828;
        this.nf = 3;
        this.os = 'Power';
        this.pt = 'EL84';
        this.pb = 329.696;
        this.kr = 270;
        this.st = '0';
        this.zp = '8.0';
        this.sl = '15';
        // Assumed load above is the tap the amplifier is designed around; this is the load
        // actually connected to it.
        this.rl = 15;
        // Output-stage equipment protection. Attenuation only, applied behind the amplifier
        // model, so it changes the level of the result and nothing about its character.
        this.sg = 0;
        this.ag = true;
        this.sd = '300B';
        this.sb = 400;
        this.sr = 1000;
        this.sp = '3.5';
        this.fr = false;
        this.temporalCapability = 'must-process';

        this.executionState = { state: 'pending', reason: null };
        this.executionStateReceived = false;
        this.latestTelemetry = null;
        this.circuitFault = { latched: false, cause: 'none' };
        this.latestTelemetryRevision = 0;
        this.hudTelemetryRevision = 0;
        this.lastTelemetryAt = 0;
        this.trajectoryIndex = 0;
        this.trajectoryCount = 0;
        // One ring per valve position - the two driver stages and the two output-tube sides - each
        // holding the left and right channel as an (x, y) pair. Every telemetry frame writes all
        // four, whatever the graph is showing, so switching the view shows a filled trail at once
        // instead of starting from an empty ring. A position the current circuit does not have is
        // simply never drawn.
        this.trajectories = Object.fromEntries(
            ['stage1', 'stage2', 'push', 'pull'].flatMap(position =>
                ['LeftX', 'LeftY', 'RightX', 'RightY'].map(component => [
                    `${position}${component}`,
                    new Float32Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES)
                ])));
        // Arrival time of each ring slot, in the same clock the HUD draws against. Float64 because
        // performance.now() past the first few hours of an uptime no longer survives a float32.
        // Held outside this.trajectories so the fill(0) over its traces keeps meaning "no signal".
        this.trajectoryTimes = new Float64Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES);
        this.hudAxes = null;
        this.hudCharacteristics = null;
        this.hudViewAxes = null;
        this.hudAxesRevision = 0;
        this.hudVisible = true;
        // Operating-point group on screen, or null when the circuit has no valve to show.
        this.hudView = null;
        this.hudViewRow = null;
        // Set while the Output Safety Trim control is held, so telemetry cannot repaint it.
        this._safetyTrimFocused = false;
        // Reduction, in dB and unquantised, that has already been folded into the stored trim.
        // Null until one has been, and released again by handleDspTubeTelemetry() as soon as a
        // frame reports a different reduction.
        this._adoptedSafetyReductionDb = null;
        this.hudCssWidth = 0;
        this.hudDpr = 1;
        this.animationFrameId = null;
        this.hudGraph = null;
        this.hudCanvas = null;
        this.hudObserver = null;
        this.hudStatus = null;
        this.presetControl = null;
        this.presetTrigger = null;
        this.presetList = null;
        this._presetOptionButtons = [];
        this._presetDocumentPointerDown = null;
        this._presetViewportChange = null;
        this.selectedTab = 'input';
        this._controls = {};
        // Parameter key whose own control originated the setParameters() call
        // currently in flight; that row is left alone while it is being edited.
        this._syncOriginKey = null;
        this._powerRows = [];
        this._ppRows = [];
        this._seRows = [];
        this.hudValues = {};
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspTubeTelemetry = frame => this.handleDspTubeTelemetry(frame);

        this._syncHudView();
        this._recalculateHudAxes();
        this.registerProcessor(TUBE_SIMULATOR_REFERENCE_PROCESSOR);
    }

    getTemporalCapability() {
        return this.enabled !== false && this.mx > 0 ? 'must-process' : 'reset-on-resume';
    }

    static getCanonicalPresets() {
        return TUBE_SIMULATOR_CANONICAL_PRESETS.map(preset => ({
            id: preset.id,
            label: preset.label,
            params: { ...TUBE_SIMULATOR_DEFAULT_SE_PARAMETERS, ...preset.params }
        }));
    }

    derivePrivateCircuit(parameters = this.getParameters()) {
        return deriveTubeSimulatorPrivateCircuit(parameters);
    }

    applyCanonicalPreset(id) {
        // Keep the menu limited to the listening-calibrated presets, while retaining the legacy
        // canonical IDs for saved integrations that apply a circuit programmatically.
        const preset = TUBE_SIMULATOR_SELECTABLE_PRESETS.find(candidate => candidate.id === id) ||
            TUBE_SIMULATOR_LISTENING_PRESETS.find(candidate => candidate.id === id) ||
            TUBE_SIMULATOR_POWER_ONLY_PRESETS.find(candidate => candidate.id === id) ||
            TUBE_SIMULATOR_CANONICAL_PRESETS.find(candidate => candidate.id === id);
        if (!preset) return false;
        // A preset describes a circuit, not a protection setting, so it always lands on 0 dB of
        // safety trim. Writing sg: 0 does not clear the accumulated automatic reduction by itself,
        // because 0 dB is already the usual value and the engine clears only on a changed trim or
        // on a commit that differs in two or more values. A preset load that actually moves the
        // circuit differs in several of them and so clears it. Re-selecting the preset the circuit
        // is already on after moving one single control differs in that one value alone and keeps
        // the reduction, which errs towards keeping the protection in force.
        //
        // It also lands on a matched speaker: a preset carries the tap the amplifier was designed
        // around, so the load actually connected follows it. Leaving the actual load on its own
        // default would hand the user a mismatch nobody asked for the moment they picked a preset
        // built around a 15 ohm tap.
        this.setParameters({
            ...TUBE_SIMULATOR_DEFAULT_SE_PARAMETERS,
            ...preset.params,
            rl: Number(preset.params.sl ?? this.sl),
            sg: 0
        });
        return true;
    }

    _matchingCanonicalPresetId() {
        // A preset also lands the actual load on its assumed load, so the match requires that
        // too; only the protection settings (sg, ag) stay outside the comparison.
        return TUBE_SIMULATOR_SELECTABLE_PRESETS.find(preset =>
            TUBE_SIMULATOR_PARAMETER_FIELDS.every(key =>
                this[key] === (preset.params[key] ?? TUBE_SIMULATOR_DEFAULT_SE_PARAMETERS[key])) &&
            this.rl === Number(preset.params.sl))?.id || '';
    }

    _syncPresetControl() {
        // No preset match resolves to the inert "Custom" option (value '').
        const select = this.presetControl;
        if (!select) return;
        select.value = this._matchingCanonicalPresetId();
        const preset = TUBE_SIMULATOR_SELECTABLE_PRESETS.find(
            candidate => candidate.id === select.value);
        if (this.presetTrigger) {
            this.presetTrigger.textContent = preset?.label || 'Custom';
        }
        for (const option of this._presetOptionButtons) {
            const selected = option.presetId === select.value;
            option.classList.toggle('selected', selected);
            option.setAttribute('aria-selected', String(selected));
        }
    }

    _setPresetListOpen(open, focusSelected = false) {
        const list = this.presetList;
        const trigger = this.presetTrigger;
        if (!list || !trigger) return;
        const shouldOpen = Boolean(open);
        list.hidden = !shouldOpen;
        trigger.setAttribute('aria-expanded', String(shouldOpen));
        if (!shouldOpen) return;
        this._positionPresetList();
        if (focusSelected) {
            const selected = this._presetOptionButtons.find(option =>
                option.presetId === this.presetControl?.value) || this._presetOptionButtons[0];
            selected?.focus?.();
            selected?.scrollIntoView?.({ block: 'nearest' });
        }
    }

    _positionPresetList() {
        const list = this.presetList;
        const trigger = this.presetTrigger;
        if (!list || !trigger || list.hidden || !document.body?.contains(list)) return;
        const rect = trigger.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
        if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
            !Number.isFinite(rect.bottom) || viewportWidth <= 0 || viewportHeight <= 0) return;

        const gap = 4;
        const availableBelow = viewportHeight - rect.bottom - gap;
        const availableAbove = rect.top - gap;
        const openAbove = availableBelow < 240 && availableAbove > availableBelow;
        const maxHeight = Math.max(120, Math.min(480,
            openAbove ? availableAbove : availableBelow));
        const width = Math.min(Math.max(rect.width, 240), viewportWidth - gap * 2);
        const left = Math.min(Math.max(gap, rect.left), viewportWidth - width - gap);

        list.style.left = `${left}px`;
        list.style.width = `${width}px`;
        list.style.maxHeight = `${maxHeight}px`;
        if (openAbove) {
            list.style.top = 'auto';
            list.style.bottom = `${viewportHeight - rect.top + gap}px`;
        } else {
            list.style.top = `${rect.bottom + gap}px`;
            list.style.bottom = 'auto';
        }
    }

    _handlePresetListKeydown(event) {
        const options = this._presetOptionButtons;
        if (event.key === 'Escape') {
            event.preventDefault?.();
            this._setPresetListOpen(false);
            this.presetTrigger?.focus?.();
            return;
        }
        const current = options.indexOf(event.target);
        let next = -1;
        if (event.key === 'ArrowDown') next = Math.min(options.length - 1, current + 1);
        else if (event.key === 'ArrowUp') next = Math.max(0, current - 1);
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = options.length - 1;
        if (next < 0) return;
        event.preventDefault?.();
        options[next]?.focus?.();
        options[next]?.scrollIntoView?.({ block: 'nearest' });
    }

    _disposePresetList() {
        if (this._presetDocumentPointerDown) {
            document.removeEventListener?.('pointerdown', this._presetDocumentPointerDown, true);
        }
        if (this._presetViewportChange) {
            document.removeEventListener?.('scroll', this._presetViewportChange, true);
            window.removeEventListener?.('resize', this._presetViewportChange);
        }
        this.presetList?.remove?.();
        this.presetTrigger = null;
        this.presetList = null;
        this._presetOptionButtons = [];
        this._presetDocumentPointerDown = null;
        this._presetViewportChange = null;
    }

    _logSliderPosition(minimum, maximum, value) {
        const logMinimum = Math.log10(minimum);
        const position =
            ((Math.log10(value) - logMinimum) / (Math.log10(maximum) - logMinimum)) * 100;
        return Number.isFinite(position) ? position : 0;
    }

    /**
     * Applies one parameter on behalf of its own control, tagging the call with
     * the originating key so that _syncControlsFromState() leaves that row
     * untouched. Without the tag the unconditional state -> DOM write-back would
     * stamp the clamped value into the number input on every keystroke, which
     * breaks the PluginBase contract of "type freely, clamp on blur/Enter"
     * (e.g. typing "180" into Plate would land on 1 -> 150 -> 1508 -> 300).
     * Preset application, setSerializedParameters and any external
     * setParameters leave the tag null, so those still refresh every row.
     */
    _commitParameter(key, value) {
        this._syncOriginKey = key;
        try {
            this.setParameters({ [key]: value });
        } finally {
            this._syncOriginKey = null;
        }
    }

    _syncControlsFromState() {
        const controls = this._controls;
        if (!controls) return;
        for (const key of Object.keys(controls)) {
            if (key === this._syncOriginKey) continue;
            const entry = controls[key];
            const row = entry?.row;
            if (!row?.querySelectorAll) continue;
            // The Output Safety Trim row shows the total attenuation in force - the user's own
            // setting plus whatever the detector has taken - so it never reads back a level that
            // is not actually being applied.
            const value = key === 'sg' ? this._effectiveSafetyTrimDb() : this[key];
            if (entry.kind === 'enum') {
                for (const input of row.querySelectorAll('input[type="radio"]')) {
                    input.checked = input.value === String(value);
                }
                continue;
            }
            if (entry.kind === 'checkbox') {
                // Without this branch the box would keep whatever the user last clicked after a
                // preset load or an external setParameters, and disagree with the state.
                for (const input of row.querySelectorAll('input[type="checkbox"]')) {
                    input.checked = value !== false;
                }
                continue;
            }
            const slider = row.querySelector?.('input[type="range"]');
            const number = row.querySelector?.('input[type="number"]');
            const decimals = entry.step < 0.1 ? 2 : (entry.step < 1 ? 1 : 0);
            if (slider) {
                slider.value = entry.kind === 'log'
                    ? this._logSliderPosition(entry.min, entry.max, value)
                    : value;
                window.uiManager?.refreshRangeFillStyling?.(slider);
            }
            if (number) {
                number.value = entry.kind === 'log' ? value.toFixed(decimals) : value;
            }
        }
        this._syncPowerSectionVisibility();
    }

    // Total attenuation currently applied after the amplifier model: the stored setting plus the
    // automatic reduction. The control's range is -96 dB so that it can express any reduction the
    // detector realistically reaches - a single large transient was measured at -30.7 dB on its
    // own - because adopting a clamped value would write a smaller trim than the reduction it
    // replaces and the level would jump up by the difference. The clamp remains only as a last
    // resort, and beyond it the HUD line is the source of truth.
    _effectiveSafetyTrimDb() {
        const effective = this.sg + this._safetyReductionDb();
        const clamped = effective < -96 ? -96 : (effective > 0 ? 0 : effective);
        // Quantised to the control's own 0.1 dB step so the row shows a value the control could
        // have produced. The HUD line still carries the unrounded reduction.
        return Math.round(clamped * 10) / 10;
    }

    /**
     * Adopts the displayed (effective) value as the stored setting when the user takes hold of
     * the Output Safety Trim control. Snapping the control back to the stored sg on touch would
     * raise the level by exactly the amount being suppressed, which is the event this mechanism
     * exists to prevent. Because sg then changes, the engine's reset rule clears the accumulated
     * reduction and effective becomes equal to sg, so the displayed number does not move.
     */
    _adoptEffectiveSafetyTrim() {
        // A given reduction is folded into the stored setting once and once only. A real pointer
        // interaction raises pointerdown and focus back to back, and the commit needs a frame or
        // two to reach the worklet, so at 60 Hz several further frames still report the reduction
        // that has already been folded in. Subtracting it a second time would drop the level by
        // exactly the amount this mechanism exists to keep steady - the jump it prevents, in
        // reverse. The block therefore keys on the reduction itself rather than on the telemetry
        // revision, which only covered the frame the interaction started in and let a second grab
        // a frame later straight through. Comparing the raw reported figure rather than the
        // quantised trim keeps two different reductions that round to the same displayed value
        // from being mistaken for one.
        const reduction = this._safetyReductionDb();
        if (reduction === this._adoptedSafetyReductionDb) return;
        this._adoptedSafetyReductionDb = reduction;
        const effective = this._effectiveSafetyTrimDb();
        if (effective === this.sg) return;
        this._commitParameter('sg', effective);
    }

    /**
     * Wires the Output Safety Trim row so that the automatic reduction and the user cannot fight
     * over it. Taking hold of the control adopts the displayed value, and telemetry repaints are
     * suppressed for as long as the control is held.
     */
    _prepareSafetyTrimRow(row) {
        this._safetyTrimFocused = false;
        for (const input of row?.querySelectorAll?.('input') || []) {
            input.addEventListener('pointerdown', () => this._adoptEffectiveSafetyTrim());
            input.addEventListener('focus', () => {
                this._safetyTrimFocused = true;
                this._adoptEffectiveSafetyTrim();
            });
            input.addEventListener('blur', () => {
                this._safetyTrimFocused = false;
            });
        }
        this._syncSafetyTrimControl();
        return row;
    }

    // Repaints the Output Safety Trim row from telemetry. Skipped while the user has hold of the
    // control, so an arriving frame cannot move the number out from under a drag.
    _syncSafetyTrimControl() {
        if (this._safetyTrimFocused) return;
        const entry = this._controls?.sg;
        const row = entry?.row;
        if (!row?.querySelector) return;
        const value = this._effectiveSafetyTrimDb();
        const slider = row.querySelector('input[type="range"]');
        const number = row.querySelector('input[type="number"]');
        if (slider) {
            slider.value = value;
            window.uiManager?.refreshRangeFillStyling?.(slider);
        }
        if (number) number.value = value;
    }

    _createHudViewControl() {
        const row = this.createRadioGroup(
            'Graph',
            TUBE_SIMULATOR_HUD_VIEWS.map(view => ({ value: view.id, label: view.label })),
            this.hudView,
            value => this._selectHudView(value)
        );
        row.classList?.add('tube-simulator-hud-view');
        this.hudViewRow = row;
        this._syncHudViewControl();
        return row;
    }

    _selectHudView(view) {
        if (view === this.hudView || !this._hudViewAvailable(view)) return;
        this.hudView = view;
        this._applyHudViewAxes();
        this._syncHudViewControl();
        this._refreshHudState();
    }

    // The row states which operating points the current circuit has: a group that is not in the
    // signal path cannot be selected, and none can be while the effect is bypassed.
    _syncHudViewControl() {
        const row = this.hudViewRow;
        if (!row?.querySelectorAll) return;
        const active = this._activeHudView();
        for (const input of row.querySelectorAll('input[type="radio"]')) {
            input.checked = input.value === this.hudView;
            input.disabled = active === null || !this._hudViewAvailable(input.value);
        }
        const label = TUBE_SIMULATOR_HUD_VIEWS.find(view => view.id === active)?.label;
        this.hudCanvas?.setAttribute?.(
            'aria-label',
            label
                ? `${label} plate curves, load lines, and operating-point trajectories for the left and right channels`
                : TUBE_SIMULATOR_NO_STAGE_MESSAGE
        );
    }

    _syncPowerSectionVisibility() {
        for (const row of this._powerRows || []) {
            if (row) row.hidden = this.os === 'Line';
        }
        for (const row of this._ppRows || []) {
            if (row) row.hidden = this.os !== 'Power';
        }
        for (const row of this._seRows || []) {
            if (row) row.hidden = this.os !== 'SingleEnded';
        }
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            dr: this.dr,
            tp: this.tp,
            bi: this.bi,
            pv: this.pv,
            sz: this.sz,
            su: this.su,
            og: this.og,
            mx: this.mx,
            iv: this.iv,
            nf: this.nf,
            os: this.os,
            pt: this.pt,
            pb: this.pb,
            kr: this.kr,
            st: this.st,
            zp: this.zp,
            sl: this.sl,
            rl: this.rl,
            sg: this.sg,
            ag: this.ag,
            sd: this.sd,
            sb: this.sb,
            sr: this.sr,
            sp: this.sp,
            fr: this.fr,
            enabled: this.enabled
        };
    }

    getSerializableParameters() {
        const params = super.getSerializableParameters();
        delete params.fr;
        return params;
    }

    getWorkletPluginData(parameters = this.getParameters()) {
        const runtimeParameters = { ...parameters };
        delete runtimeParameters.fr;
        const payload = super.getWorkletPluginData(runtimeParameters);
        payload.executionCapabilities = this.constructor.executionCapabilities;
        return payload;
    }

    setParameters(params) {
        const previousAxisSignature = this._hudAxisSignature();
        const setNumber = (key, minimum, maximum) => {
            if (params[key] === undefined || params[key] === null) return;
            this[key] = this.parseFiniteNumber(params[key], minimum, maximum, this[key]);
        };

        setNumber('dr', -96, 0);
        setNumber('bi', -50, 50);
        setNumber('pv', 150, 300);
        setNumber('sz', 0.6, 100);
        setNumber('su', 0.1, 47);
        setNumber('og', -48, 48);
        setNumber('mx', 0, 100);
        setNumber('iv', 0.1, 300);
        setNumber('nf', 0, 30);
        setNumber('pb', 300, 470);
        setNumber('kr', 270, 500);
        setNumber('rl', 2, 32);
        setNumber('sg', -96, 0);
        setNumber('sb', 250, 450);
        setNumber('sr', 700, 1300);

        if (params.ag !== undefined) {
            this.ag = params.ag !== false;
        }

        if (params.tp !== undefined && TUBE_SIMULATOR_ENUM_ABI.tp.values.includes(params.tp)) {
            this.tp = params.tp;
        }
        for (const key of ['os', 'pt', 'st', 'zp', 'sl', 'sd', 'sp']) {
            if (params[key] !== undefined && TUBE_SIMULATOR_ENUM_ABI[key].values.includes(params[key])) {
                this[key] = params[key];
            }
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled !== false;
        }

        // Output Circuit and Driver Type lead the signature, so a change that moves the selection
        // to another group always reaches the axis rebuild below.
        this._syncHudView();
        if (previousAxisSignature !== this._hudAxisSignature()) {
            this._recalculateHudAxes();
            this._clearTrajectories();
        }
        this.updateParameters();
        this._syncPresetControl();
        this._syncControlsFromState();
        this._syncHudViewControl();
        this._updateHudValues();
        this._refreshHudState();
    }

    setEnabled(enabled) {
        super.setEnabled(enabled);
        this._syncHudViewControl();
        this._refreshHudState();
    }

    _setSectionEnabled(enabled) {
        super._setSectionEnabled(enabled);
        this._refreshHudState();
    }

    setPowerUiEnabled(enabled) {
        super.setPowerUiEnabled(enabled);
        this._refreshHudState();
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
        this.ensureDspTelemetrySubscription();
    }

    ensureDspTelemetrySubscription() {
        const hub = window.dspTelemetryHub;
        const tapId = this.id;
        const validTapId = Number.isInteger(tapId) && tapId >= 0 && tapId <= 0xffffffff;
        const validHub = hub && typeof hub.subscribe === 'function';
        if (!validTapId || !validHub) {
            if (this._dspTelemetryUnsubscribe &&
                (hub !== this._dspTelemetryHub || tapId !== this._dspTelemetryTapId)) {
                this.disposeDspTelemetrySubscription();
            }
            return false;
        }
        if (this._dspTelemetryUnsubscribe &&
            hub === this._dspTelemetryHub && tapId === this._dspTelemetryTapId) {
            return true;
        }

        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(
                tapId,
                TUBE_SIMULATOR_TAP_OPERATING_POINT,
                this._boundDspTubeTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(
                    tapId,
                    TUBE_SIMULATOR_TAP_OPERATING_POINT,
                    this._boundDspTubeTelemetry
                );
                return false;
            }
            this._dspTelemetryHub = hub;
            this._dspTelemetryTapId = tapId;
            this._dspTelemetryUnsubscribe = unsubscribe;
            return true;
        } catch (error) {
            console.warn('Tube Simulator telemetry subscription failed.', error);
            return false;
        }
    }

    disposeDspTelemetrySubscription() {
        const unsubscribe = this._dspTelemetryUnsubscribe;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        if (!unsubscribe) return;
        try {
            unsubscribe();
        } catch (error) {
            console.warn('Tube Simulator telemetry cleanup failed.', error);
        }
    }

    parseDspTubeTelemetryFrame(frame) {
        if (frame?.frameType !== TUBE_SIMULATOR_TAP_OPERATING_POINT ||
            frame.formatVersion !== TUBE_SIMULATOR_TELEMETRY_VERSION) {
            return null;
        }
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            payload.byteLength !== TUBE_SIMULATOR_TELEMETRY_BYTES) {
            return null;
        }

        const channels = [{}, {}];
        for (let channel = 0; channel < channels.length; channel++) {
            const offset = channel * TUBE_SIMULATOR_TELEMETRY_FIELDS.length;
            for (let field = 0; field < TUBE_SIMULATOR_TELEMETRY_FIELDS.length; field++) {
                const value = payload.getFloat32((offset + field) * 4, true);
                if (!Number.isFinite(value)) return null;
                channels[channel][TUBE_SIMULATOR_TELEMETRY_FIELDS[field]] = value;
            }
        }
        const safetyReductionDb = payload.getFloat32(
            TUBE_SIMULATOR_TELEMETRY_SAFETY_INDEX * 4, true);
        if (!Number.isFinite(safetyReductionDb)) return null;
        return {
            left: channels[0],
            right: channels[1],
            safetyReductionDb
        };
    }

    handleDspTubeTelemetry(frame) {
        const telemetry = this.parseDspTubeTelemetryFrame(frame);
        if (!telemetry) return;
        this.latestTelemetry = telemetry;
        this.latestTelemetryRevision++;
        // The adopted reduction blocks folding one and the same figure in twice while it is still
        // being reported. Once the kernel reports a different one the block has done its job, so
        // it is released here: an identical reduction accumulating again after that is a new
        // reduction and has to be adoptable.
        if (this._adoptedSafetyReductionDb !== this._safetyReductionDb()) {
            this._adoptedSafetyReductionDb = null;
        }
        this.lastTelemetryAt = performance.now();
        // The safety trim row tracks the reduction even when the graph is paused: the parameter
        // rows stay on screen and readable while the HUD canvas is hidden.
        this._syncSafetyTrimControl();
        if (!this._canUpdateHud()) return;
        this._applyLatestTelemetry();
        this._refreshHudState({ drawOnce: false });
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message?.pluginId !== this.id ||
            message.pluginType !== this.constructor.name ||
            message.validated !== true) {
            return;
        }
        if (message.type === 'dspExecutionState') {
            this.executionState = {
                state: message.state,
                reason: message.reason ?? null
            };
            this.executionStateReceived = true;
        } else if (message.type === 'tubeSimulatorCircuitFault') {
            this.circuitFault = {
                latched: message.latched,
                cause: message.cause
            };
        } else {
            return;
        }
        this._refreshHudState();
    }

    // True when the current circuit really runs the valves of that group. The driver is skipped
    // when Driver Type is Bypass, and the output groups belong to their own Output Circuit.
    _hudViewAvailable(view) {
        if (view === 'driver') return this.tp !== 'Bypass';
        if (view === 'pushPull') return this.os === 'Power';
        if (view === 'singleEnded') return this.os === 'SingleEnded';
        return false;
    }

    _availableHudViews() {
        return TUBE_SIMULATOR_HUD_VIEWS
            .filter(view => this._hudViewAvailable(view.id))
            .map(view => view.id);
    }

    // Keeps the selection on a group the circuit actually has. When a setting drops the selected
    // one, the last available group in chain order takes over: that is the output stage the change
    // moved to, and it falls back to the driver only when there is no output valve left to show.
    _syncHudView() {
        const available = this._availableHudViews();
        if (available.includes(this.hudView)) return;
        this.hudView = available.length === 0 ? null : available[available.length - 1];
    }

    // Group being drawn, or null when nothing is: a bypassed effect runs no valve at all, so the
    // trail last left on screen would no longer stand for anything.
    _activeHudView() {
        return this.enabled === false ? null : this.hudView;
    }

    _hudAxisSignature() {
        const parts = [this.os, this.tp];
        for (const view of this._availableHudViews()) {
            if (view === 'driver') {
                parts.push(`${this.tp}:${this.bi}:${this.pv}:${this.sz}:${this.su}`);
            } else if (view === 'pushPull') {
                parts.push(`${this.pt}:${this.pb}:${this.st}:${this.zp}:${this.sl}`);
            } else {
                parts.push(`${this.sd}:${this.sb}:${this.sr}:${this.sp}:${this.sl}:${this.rl}`);
            }
        }
        return parts.join('|');
    }

    _recalculateHudAxes() {
        this.hudViewAxes = {
            driver: this._hudViewAvailable('driver') ? this._driverHudAxes() : null,
            pushPull: this._hudViewAvailable('pushPull') ? this._pushPullHudAxes() : null,
            singleEnded: this._hudViewAvailable('singleEnded') ? this._singleEndedHudAxes() : null
        };
        this._applyHudViewAxes();
        this.hudAxesRevision++;
    }

    // Points the drawing state at the selected group. Every group has its own supply voltage and
    // load line, so the axes travel with the selection rather than with the circuit.
    _applyHudViewAxes() {
        const selected = this.hudView ? this.hudViewAxes?.[this.hudView] : null;
        this.hudAxes = selected?.axes ?? null;
        this.hudCharacteristics = selected?.characteristics ?? null;
    }

    _driverHudAxes() {
        const profile = TUBE_SIMULATOR_HUD_PROFILES[this.tp];
        const plateScale = this.pv / 250;
        const loadLineCurrent = this.pv / profile.plateResistance;
        const currentMaximum = Math.max(profile.iaMax * plateScale, loadLineCurrent * 1.1);
        return {
            axes: {
                xMin: 0,
                xMax: this.pv,
                yMin: 0,
                yMax: currentMaximum,
                xTicks: tubeSimulatorHudTicks(0, this.pv, 5),
                yTicks: tubeSimulatorHudTicks(0, currentMaximum, 5)
            },
            characteristics: {
                plateCurves: tubeSimulatorHudPlateCurves(profile, this.pv),
                loadLine: {
                    xValues: new Float32Array([0, this.pv]),
                    yValues: new Float32Array([loadLineCurrent, 0])
                }
            }
        };
    }

    _pushPullHudAxes() {
        const primaryImpedanceOhm = Number(this.zp) * 1000;
        const loadLineCurrent = 2 * this.pb / primaryImpedanceOhm;
        return {
            axes: {
                xMin: 0,
                xMax: this.pb,
                yMin: 0,
                yMax: loadLineCurrent * 1.25,
                xTicks: tubeSimulatorHudTicks(0, this.pb, 5),
                yTicks: tubeSimulatorHudTicks(0, loadLineCurrent * 1.25, 5)
            },
            characteristics: {
                plateCurves: [],
                loadLine: {
                    xValues: new Float32Array([0, this.pb]),
                    yValues: new Float32Array([loadLineCurrent, 0])
                }
            }
        };
    }

    _singleEndedHudAxes() {
        const profile = TUBE_SIMULATOR_SE_HUD_PROFILES[this.sd];
        const primaryImpedanceOhm = tubeSimulatorEffectivePrimaryImpedanceOhm(
            Number(this.sp) * 1000,
            Number(this.sl),
            this.rl
        );
        const quiescent = solveTubeSimulatorSeHudQuiescent(profile, this.sb, this.sr);
        const loadLineTop = quiescent.currentA +
            quiescent.plateCathodeV / primaryImpedanceOhm;
        const loadLineEnd = Math.min(
            this.sb,
            quiescent.plateCathodeV + quiescent.currentA * primaryImpedanceOhm
        );
        const loadLineEndCurrent = quiescent.currentA +
            (quiescent.plateCathodeV - loadLineEnd) / primaryImpedanceOhm;
        const currentMaximum = Math.max(profile.iaMax, loadLineTop * 1.1);
        return {
            axes: {
                xMin: 0,
                xMax: this.sb,
                yMin: 0,
                yMax: currentMaximum,
                xTicks: tubeSimulatorHudTicks(0, this.sb, 5),
                yTicks: tubeSimulatorHudTicks(0, currentMaximum, 5)
            },
            characteristics: {
                plateCurves: tubeSimulatorHudPlateCurves(profile, this.sb),
                loadLine: {
                    xValues: new Float32Array([0, loadLineEnd]),
                    yValues: new Float32Array([loadLineTop, loadLineEndCurrent])
                }
            }
        };
    }

    _clearTrajectories() {
        this.trajectoryIndex = 0;
        this.trajectoryCount = 0;
        for (const values of Object.values(this.trajectories)) values.fill(0);
        this.trajectoryTimes.fill(0);
    }

    _appendTrajectory(telemetry, now = performance.now()) {
        const index = this.trajectoryIndex;
        this.trajectoryTimes[index] = now;
        const traces = this.trajectories;
        const left = telemetry.left;
        const right = telemetry.right;
        traces.stage1LeftX[index] = left.vak1;
        traces.stage1LeftY[index] = left.ia1;
        traces.stage1RightX[index] = right.vak1;
        traces.stage1RightY[index] = right.ia1;
        traces.stage2LeftX[index] = left.vak2;
        traces.stage2LeftY[index] = left.ia2;
        traces.stage2RightX[index] = right.vak2;
        traces.stage2RightY[index] = right.ia2;
        traces.pushLeftX[index] = left.powerPlatePushV;
        traces.pushLeftY[index] = left.powerIaPushA;
        traces.pushRightX[index] = right.powerPlatePushV;
        traces.pushRightY[index] = right.powerIaPushA;
        traces.pullLeftX[index] = left.powerPlatePullV;
        traces.pullLeftY[index] = left.powerIaPullA;
        traces.pullRightX[index] = right.powerPlatePullV;
        traces.pullRightY[index] = right.powerIaPullA;
        this.trajectoryIndex = (index + 1) % TUBE_SIMULATOR_TRAJECTORY_FRAMES;
        this.trajectoryCount = Math.min(
            this.trajectoryCount + 1,
            TUBE_SIMULATOR_TRAJECTORY_FRAMES
        );
    }

    _formatStereo(left, right, unit = 'V', digits = 2) {
        if (!Number.isFinite(left) || !Number.isFinite(right)) return 'L — / R —';
        return `L ${left.toFixed(digits)} / R ${right.toFixed(digits)} ${unit}`;
    }

    /**
     * Fixed-column form for the readouts that change sign. Without it the leading digit and the
     * decimal point move whenever the sign flips or the magnitude crosses a power of ten, and the
     * unit at the end of the line moves with them, which makes the number unreadable while it is
     * changing. An explicit sign is always emitted and the integer part is padded with spaces to
     * a width the quantity cannot exceed, so every column stays put. U+2212 is used for the minus
     * because it is the same advance width as the plus; the ASCII hyphen is narrower.
     *
     * The reading element sets font-variant-numeric: tabular-nums and white-space: pre-wrap, so
     * equal-width digits and the padding spaces both survive to the screen.
     */
    _formatFixedNumber(value, digits, integerDigits) {
        const sign = value < 0 ? '\u2212' : '+';
        const text = Math.abs(value).toFixed(digits);
        const point = text.indexOf('.');
        const whole = point < 0 ? text : text.slice(0, point);
        const fraction = point < 0 ? '' : text.slice(point);
        return `${sign}${whole.padStart(integerDigits, ' ')}${fraction}`;
    }

    _formatStereoFixed(left, right, unit, digits, integerDigits) {
        if (!Number.isFinite(left) || !Number.isFinite(right)) return 'L — / R —';
        return `L ${this._formatFixedNumber(left, digits, integerDigits)} / ` +
            `R ${this._formatFixedNumber(right, digits, integerDigits)} ${unit}`;
    }

    _updateHudValues() {
        if (this.hudValues.inputReference) {
            const vrms = this.iv / Math.SQRT2;
            const dbuFs = 20 * Math.log10(vrms / 0.775);
            this.hudValues.inputReference.textContent =
                `${this.iv.toFixed(3)} Vpk · ${vrms.toFixed(3)} Vrms · ${dbuFs.toFixed(1)} dBuFS`;
        }
        if (this.hudValues.stage1ExternalInput) {
            const stage1Input = this.iv * Math.pow(10, this.dr / 20);
            this.hudValues.stage1ExternalInput.textContent = this.tp === 'Bypass'
                ? `Driver bypassed · ${stage1Input.toFixed(3)} Vpk`
                : `${stage1Input.toFixed(3)} Vpk`;
        }
        const telemetry = this.latestTelemetry;
        if (!telemetry) return;
        const { left, right } = telemetry;
        if (this.hudValues.stage1Bias) {
            this.hudValues.stage1Bias.textContent = this.tp === 'Bypass'
                ? 'L — / R —'
                : this._formatStereo(left.vk1, right.vk1);
        }
        if (this.hudValues.stage2Bias) {
            this.hudValues.stage2Bias.textContent = this.tp === 'Bypass'
                ? 'L — / R —'
                : this._formatStereo(left.vk2, right.vk2);
        }
        if (this.hudValues.bPlus) {
            this.hudValues.bPlus.textContent = this.tp === 'Bypass'
                ? 'L — / R —'
                : this._formatStereo(left.vbPlus, right.vbPlus);
        }
        // One stage per cell. Packed into a single cell the four stereo pairs wrapped, which
        // pushed the label onto two lines and made the row taller than every other one.
        //
        // Three integer digits: the sag is a plate voltage measured against B+, and both are
        // bounded by the Plate supply, whose range tops out at 300 V. The sign flips - it is a
        // few hundred millivolts positive on some Power branches and well over a hundred volts
        // negative on others - so the sign column is always occupied.
        if (this.hudValues.plateSag1) {
            this.hudValues.plateSag1.textContent = this.tp === 'Bypass'
                ? 'L — / R —'
                : this._formatStereoFixed(
                    left.vak1 + left.vk1 - left.vbPlus,
                    right.vak1 + right.vk1 - right.vbPlus,
                    'V', 2, 3);
        }
        if (this.hudValues.plateSag2) {
            this.hudValues.plateSag2.textContent = this.tp === 'Bypass'
                ? 'L — / R —'
                : this._formatStereoFixed(
                    left.vak2 + left.vk2 - left.vbPlus,
                    right.vak2 + right.vk2 - right.vbPlus,
                    'V', 2, 3);
        }
        // Three integer digits: the balance is the difference of the two long-tailed-pair plate
        // voltages, each bounded by the Power stage supply, whose range tops out at 470 V.
        // Measured swings reach about +/-95 V and cross zero continuously, which is what made the
        // unpadded form unreadable.
        if (this.hudValues.ltpBalance) {
            this.hudValues.ltpBalance.textContent =
                this._formatStereoFixed(left.ltpBalanceV, right.ltpBalanceV, 'V', 2, 3);
        }
        if (this.hudValues.powerBPlus) {
            this.hudValues.powerBPlus.textContent =
                this._formatStereo(left.powerBPlusV, right.powerBPlusV);
        }
        if (this.hudValues.speakerVrms) {
            this.hudValues.speakerVrms.textContent =
                this._formatStereo(left.speakerVrms100ms, right.speakerVrms100ms, 'Vrms');
        }
        if (this.hudValues.speakerPower) {
            this.hudValues.speakerPower.textContent = this._formatStereo(
                left.speakerRealPower100ms,
                right.speakerRealPower100ms,
                'W'
            );
        }
        // Magnitude of the flux linkage, two integer digits: both cores read their flux-linkage
        // state directly. The single-ended reading carries the standing bias flux of the gapped
        // core (0.43-0.54 Wb-turns at the default supply and cathode bias) and swings towards
        // saturation figures of 1.5-2.2 Wb-turns, so a second integer column is needed and the
        // sign column carries no information; the push-pull reading swings about zero towards a
        // saturation flux of 2.9-6.8 Wb-turns depending on the selected profile.
        //
        // Three fraction digits: every other telemetry readout on this HUD - everything
        // _formatStereo and _formatStereoFixed render - prints two, and those are volt- and
        // watt-scale quantities (the two cathode biases, the LTP balance, both supplies, the
        // speaker volts and the speaker watts) whose ranges top out between a few units and a
        // few hundred, so two digits there resolve a part in a thousand or better over most of
        // their travel. The sag readouts take the same two digits without that guarantee, since
        // they collapse to a few hundred millivolts on some Power branches as the note above
        // records. The flux reading is a two-orders-of-magnitude smaller number - 0.43 Wb-turns
        // at the quiet end of the gapped-core standing bias - where two digits would quantise the
        // display to about 2 % of the reading. One extra digit restores the same relative
        // resolution the voltage readouts get; the six digits this used to print were far below
        // anything the animation rate lets a reader follow.
        if (this.hudValues.transformerFlux) {
            this.hudValues.transformerFlux.textContent = this._formatStereoFixed(
                Math.abs(left.transformerFluxWb),
                Math.abs(right.transformerFluxWb),
                'Wb',
                3,
                2
            );
        }
    }

    _canUpdateHud() {
        return Boolean(this.hudCanvas) &&
            this.hudVisible &&
            this.canRunAnimation?.() !== false;
    }

    _applyLatestTelemetry() {
        if (!this.latestTelemetry ||
            this.hudTelemetryRevision === this.latestTelemetryRevision) {
            return;
        }
        // Stamped with the arrival time rather than with now: a frame first applied when the HUD
        // becomes visible again is as old as its telemetry, and has to fade from there instead of
        // re-entering the trail at full brightness.
        this._appendTrajectory(this.latestTelemetry, this.lastTelemetryAt || performance.now());
        this._updateHudValues();
        this.hudTelemetryRevision = this.latestTelemetryRevision;
    }

    _hudStatusText() {
        if (this.enabled === false) return TUBE_SIMULATOR_NO_STAGE_MESSAGE;
        if (!this._sectionEnabled || !this._powerUiEnabled) return 'Tube Simulator display is paused.';
        if (!this.executionStateReceived || this.executionState.state === 'pending') {
            return 'Loading Tube Simulator processing…';
        }
        if (this.executionState.state !== 'active') {
            const unsupportedChannelModeMessage =
                this.channel === null || ['34', '56', '78'].includes(this.channel)
                    ? 'Tube Simulator does not have enough output channels for the selected Stereo or channel pair. The effect is bypassed.'
                    : 'Tube Simulator supports Stereo and channel pairs only. Select Stereo or a channel pair. The effect is bypassed.';
            const messages = {
                unsupportedSampleRate:
                    'Tube Simulator does not support this sample rate. The effect is bypassed.',
                unsupportedChannelMode: unsupportedChannelModeMessage,
                wasmUnavailable: 'Tube Simulator requires WebAssembly processing. The effect is bypassed.',
                rolloutDisabled: 'Tube Simulator processing is unavailable in this build. The effect is bypassed.',
                runtimeFallback: 'Tube Simulator was bypassed after its processing engine stopped.',
                engineStopped: 'Tube Simulator is bypassed because audio processing has stopped.'
            };
            return messages[this.executionState.reason] || 'Tube Simulator is bypassed.';
        }
        if (this.circuitFault.latched) {
            if (this.circuitFault.cause === 'feedbackOscillation') {
                return 'With the current circuit settings, feedback oscillation was detected in the simulated tube circuit. The circuit output was muted and the effect was bypassed. Reduce Negative Feedback or restore the default circuit settings.';
            }
            return 'The simulated tube circuit could not be processed safely, so the effect was bypassed. Restore the default circuit settings, then reload the effect.';
        }
        // The safety reduction is applied automatically, so it is always stated - including when
        // it is zero, so that the mechanism is visible before it has ever acted.
        const reduction = this._safetyReductionDb();
        const safety = reduction < 0
            ? `Output safety reduction: ${(-reduction).toFixed(1)} dB applied automatically. It is never restored on its own; move Output Safety Trim to clear it.`
            : 'Output safety reduction: 0.0 dB.';
        // Line with the driver bypassed leaves no valve in the circuit at all, so there is no
        // operating point to plot and nothing the graph could stand for.
        if (this.hudView === null) return `${TUBE_SIMULATOR_NO_STAGE_MESSAGE} ${safety}`;
        return this.latestTelemetry
            ? `Tube Simulator is active. ${safety}`
            : `Tube Simulator is active. Waiting for measurements… ${safety}`;
    }

    // Reduction currently reported by the kernel, in dB and never positive. Zero until the first
    // telemetry frame arrives, which is also the truth: nothing has been reduced yet.
    _safetyReductionDb() {
        const reported = this.latestTelemetry?.safetyReductionDb;
        if (!Number.isFinite(reported) || reported > 0) return 0;
        return reported;
    }

    _refreshHudState({ drawOnce = true } = {}) {
        if (this.hudStatus) this.hudStatus.textContent = this._hudStatusText();
        const canAnimate = this._canUpdateHud();
        if (canAnimate) {
            this._applyLatestTelemetry();
            if (drawOnce) this._drawHud();
            this.startAnimation();
        } else {
            this.stopAnimation();
            if (drawOnce) this._drawHud();
        }
    }

    startAnimation() {
        if (!this.hudCanvas || !this.hudVisible ||
            this.canRunAnimation?.() === false || this.animationFrameId !== null) {
            return;
        }
        this.animationFrameId = this.requestPowerAnimationFrame(() => {
            this.animationFrameId = null;
            this._drawHud();
            this.startAnimation();
        });
    }

    stopAnimation() {
        if (this.animationFrameId === null) return;
        if (typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this.animationFrameId);
        } else {
            window.cancelAnimationFrame?.(this.animationFrameId);
        }
        this.animationFrameId = null;
    }

    // Panels of the selected group, left to right. Push-pull shows the two sides of the output
    // pair; every other group shows the valves in chain order, each panel carrying both channels.
    _hudPanels() {
        const traces = this.trajectories;
        const panel = (title, position) => ({
            title,
            leftX: traces[`${position}LeftX`],
            leftY: traces[`${position}LeftY`],
            rightX: traces[`${position}RightX`],
            rightY: traces[`${position}RightY`]
        });
        const view = this._activeHudView();
        if (view === 'driver') return [panel('Stage 1', 'stage1'), panel('Stage 2', 'stage2')];
        if (view === 'pushPull') return [panel('Push', 'push'), panel('Pull', 'pull')];
        if (view === 'singleEnded') return [panel('Output', 'push')];
        return [];
    }

    _drawHud() {
        const canvas = this.hudCanvas;
        const context = canvas?.getContext?.('2d');
        if (!context) return;
        const width = canvas.width || canvas.clientWidth || 720;
        const height = canvas.height || canvas.clientHeight || 300;
        const rect = canvas.getBoundingClientRect?.();
        const cssWidth = this.hudCssWidth || canvas.clientWidth || rect?.width || width || 1;
        const dpr = width / cssWidth || this.hudDpr || 1;
        const narrow = cssWidth < 560;
        context.setTransform?.(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);
        context.fillStyle = TUBE_SIMULATOR_HUD_COLORS.background;
        context.fillRect(0, 0, width, height);

        const panels = this._hudPanels();
        if (panels.length === 0 || !this.hudAxes) return;
        const gap = (narrow ? 12 : 20) * dpr;
        // The right margin holds the half of the last x tick label that sits outside the panel:
        // the labels are centred on their tick, and the rightmost one is on the panel edge. Three
        // digits of the tick font are about 20 device pixels wide, so half of that plus a hair
        // keeps the highest plate voltage off the edge of the canvas.
        const margin = {
            left: (narrow ? 48 : 58) * dpr,
            right: (narrow ? 16 : 18) * dpr,
            top: (narrow ? 24 : 26) * dpr,
            bottom: (narrow ? 44 : 48) * dpr
        };
        const panelWidth =
            (width - margin.left - margin.right - gap * (panels.length - 1)) / panels.length;
        const panelHeight = height - margin.top - margin.bottom;
        if (panelWidth <= 0 || panelHeight <= 0) return;
        // One clock reading for the whole frame: both panels have to age their trails by the same
        // amount, or the two halves of a push-pull pair fade out of step with each other.
        const now = performance.now();
        panels.forEach((panel, index) => {
            this._drawOperatingPointPanel(context, {
                ...panel,
                x: margin.left + index * (panelWidth + gap),
                y: margin.top,
                width: panelWidth,
                height: panelHeight,
                dpr,
                narrow,
                now,
                showYLabels: index === 0
            });
        });
        this._drawChannelLegend(context, {
            x: width - margin.right,
            y: margin.top - 5 * dpr,
            dpr,
            narrow
        });

        context.fillStyle = TUBE_SIMULATOR_HUD_COLORS.axes;
        context.font = `${(narrow ? 13 : 14) * dpr}px Arial`;
        context.textAlign = 'center';
        context.textBaseline = 'bottom';
        context.fillText('Vak (V)', width / 2, height - 6 * dpr);
        context.save();
        context.translate((narrow ? 14 : 18) * dpr, height / 2);
        context.rotate(-Math.PI / 2);
        context.fillText('Ia (mA)', 0, 0);
        context.restore();
    }

    /**
     * Names the two trace colours once for the whole graph, on the title row and right-aligned to
     * the last panel. Every panel overlays both channels, so without it the colours are unlabelled;
     * each word is drawn in its own colour, which is the legend itself - no swatches to align.
     */
    _drawChannelLegend(context, legend) {
        const font = `600 ${(legend.narrow ? 12 : 13) * legend.dpr}px Arial`;
        context.font = font;
        context.textAlign = 'right';
        context.textBaseline = 'bottom';
        context.fillStyle = TUBE_SIMULATOR_HUD_COLORS.right;
        context.fillText('Right', legend.x, legend.y);
        const rightWidth = context.measureText('Right').width;
        context.fillStyle = TUBE_SIMULATOR_HUD_COLORS.left;
        context.fillText('Left', legend.x - rightWidth - 8 * legend.dpr, legend.y);
    }

    _drawOperatingPointPanel(context, panel) {
        const axes = this.hudAxes;
        const tickFont = (panel.narrow ? 11 : 12) * panel.dpr;
        const titleFont = (panel.narrow ? 12 : 13) * panel.dpr;
        const mapX = value => panel.x +
            (value - axes.xMin) / (axes.xMax - axes.xMin) * panel.width;
        const mapY = value => panel.y + panel.height -
            (value - axes.yMin) / (axes.yMax - axes.yMin) * panel.height;

        context.strokeStyle = TUBE_SIMULATOR_HUD_COLORS.grid;
        context.lineWidth = panel.dpr;
        context.fillStyle = TUBE_SIMULATOR_HUD_COLORS.ticks;
        context.font = `${tickFont}px Arial`;
        context.textBaseline = 'top';
        const xTicks = panel.narrow
            ? axes.xTicks.filter((_, index) => index % 2 === 0)
            : axes.xTicks;
        for (const tick of xTicks) {
            const x = mapX(tick);
            context.beginPath();
            context.moveTo(x, panel.y);
            context.lineTo(x, panel.y + panel.height);
            context.stroke();
            context.textAlign = 'center';
            context.fillText(tick.toFixed(0), x, panel.y + panel.height + 4 * panel.dpr);
        }
        context.textBaseline = 'middle';
        for (const tick of axes.yTicks) {
            const y = mapY(tick);
            context.beginPath();
            context.moveTo(panel.x, y);
            context.lineTo(panel.x + panel.width, y);
            context.stroke();
            if (panel.showYLabels) {
                context.textAlign = 'right';
                context.fillText(
                    (tick * 1000).toFixed(1),
                    panel.x - 5 * panel.dpr,
                    y
                );
            }
        }
        context.fillStyle = TUBE_SIMULATOR_HUD_COLORS.axes;
        context.font = `600 ${titleFont}px Arial`;
        context.textAlign = 'left';
        context.textBaseline = 'bottom';
        context.fillText(panel.title, panel.x, panel.y - 5 * panel.dpr);
        context.save();
        context.beginPath();
        context.rect?.(panel.x, panel.y, panel.width, panel.height);
        context.clip?.();
        this._drawPlateCharacteristics(context, mapX, mapY, panel.dpr);
        this._drawTrajectory(
            context,
            panel.leftX,
            panel.leftY,
            mapX,
            mapY,
            TUBE_SIMULATOR_HUD_COLORS.left,
            panel.dpr,
            panel.narrow,
            panel.now
        );
        this._drawTrajectory(
            context,
            panel.rightX,
            panel.rightY,
            mapX,
            mapY,
            TUBE_SIMULATOR_HUD_COLORS.right,
            panel.dpr,
            panel.narrow,
            panel.now
        );
        context.restore();
    }

    _drawPlateCharacteristics(context, mapX, mapY, dpr) {
        const characteristics = this.hudCharacteristics;
        if (!characteristics) return;
        context.strokeStyle = TUBE_SIMULATOR_HUD_COLORS.characteristics;
        context.lineWidth = 0.75 * dpr;
        context.setLineDash?.([]);
        for (const curve of characteristics.plateCurves) {
            context.beginPath();
            for (let index = 0; index < curve.xValues.length; index++) {
                const x = mapX(curve.xValues[index]);
                const y = mapY(curve.yValues[index]);
                if (index === 0) context.moveTo(x, y);
                else context.lineTo(x, y);
            }
            context.stroke();
        }
        const loadLine = characteristics.loadLine;
        context.strokeStyle = TUBE_SIMULATOR_HUD_COLORS.loadLine;
        context.lineWidth = dpr;
        context.setLineDash?.([6 * dpr, 4 * dpr]);
        context.beginPath();
        context.moveTo(mapX(loadLine.xValues[0]), mapY(loadLine.yValues[0]));
        context.lineTo(mapX(loadLine.xValues[1]), mapY(loadLine.yValues[1]));
        context.stroke();
        context.setLineDash?.([]);
    }

    _drawTrajectory(context, xValues, yValues, mapX, mapY, color, dpr = 1, narrow = false,
        now = performance.now()) {
        if (this.trajectoryCount === 0) return;
        const first = (this.trajectoryIndex - this.trajectoryCount +
            TUBE_SIMULATOR_TRAJECTORY_FRAMES) % TUBE_SIMULATOR_TRAJECTORY_FRAMES;
        // Points, not a polyline. The samples are telemetry frames, not a continuous curve, so
        // joining them drew segments through operating points the valve never passed through -
        // and across the whole plot whenever the ring wrapped.
        // Twice the size Stereo Meter uses: it plots a dense cloud of audio samples, while these
        // are sparse telemetry frames that were hard to see at one device pixel.
        const size = (narrow ? 4 : 2) * dpr;
        const offset = size * 0.5;
        context.fillStyle = color;
        // Oldest first, so the newest point is filled last and sits on top of its own trail. Each
        // age gets its own alpha, so one path per point rather than one for the whole window.
        for (let index = 0; index < this.trajectoryCount; index++) {
            const ringIndex = (first + index) % TUBE_SIMULATOR_TRAJECTORY_FRAMES;
            const age = now - this.trajectoryTimes[ringIndex];
            // A negative age is a clock that ran backwards, not a future sample; treat it as fresh
            // rather than letting Math.exp hand back an opacity above one.
            if (age > TUBE_SIMULATOR_TRAJECTORY_HISTORY_MS) continue;
            const opacity = age > 0 ? Math.exp(-age / TUBE_SIMULATOR_TRAJECTORY_FADE_MS) : 1;
            if (opacity < TUBE_SIMULATOR_TRAJECTORY_MINIMUM_OPACITY) continue;
            context.globalAlpha = opacity;
            context.beginPath();
            context.rect(
                mapX(xValues[ringIndex]) - offset,
                mapY(yValues[ringIndex]) - offset,
                size,
                size
            );
            context.fill();
        }
        context.globalAlpha = 1;
    }

    _createPresetControl() {
        this._disposePresetList();
        this.presetControl = null;
        const row = document.createElement('div');
        row.className = 'parameter-row tube-simulator-preset-row';
        const selectId = `${this.id}-${this.name}-preset-select`;
        const triggerId = `${this.id}-${this.name}-preset-trigger`;
        const listId = `${this.id}-${this.name}-preset-list`;

        const labelElement = document.createElement('label');
        labelElement.textContent = 'Preset:';
        labelElement.htmlFor = triggerId;

        const select = document.createElement('select');
        select.id = selectId;
        select.name = selectId;
        select.autocomplete = 'off';
        select.hidden = true;
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');

        const control = document.createElement('div');
        control.className = 'tube-simulator-preset-control';
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.id = triggerId;
        trigger.className = 'tube-simulator-preset-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-controls', listId);
        trigger.setAttribute('aria-expanded', 'false');

        const list = document.createElement('div');
        list.id = listId;
        list.className = 'tube-simulator-preset-list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-labelledby', triggerId);
        list.hidden = true;

        const selectPreset = id => {
            select.value = id;
            this._setPresetListOpen(false);
            if (!id) this._syncPresetControl();
            else this.applyCanonicalPreset(id);
            trigger.focus?.();
        };
        const addListOption = (id, label, grouped = false) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = grouped
                ? 'tube-simulator-preset-option grouped'
                : 'tube-simulator-preset-option';
            option.textContent = label;
            option.presetId = id;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            option.addEventListener('click', () => selectPreset(id));
            option.addEventListener('keydown', event => this._handlePresetListKeydown(event));
            list.appendChild(option);
            this._presetOptionButtons.push(option);
        };

        const custom = document.createElement('option');
        custom.value = '';
        custom.textContent = 'Custom';
        select.appendChild(custom);
        addListOption('', 'Custom');

        for (const group of TUBE_SIMULATOR_PRESET_GROUPS) {
            const presets = group.presets || [];
            if (presets.length === 0) continue;
            const optionGroup = document.createElement('optgroup');
            optionGroup.label = group.label;
            const groupLabel = document.createElement('div');
            groupLabel.className = 'tube-simulator-preset-group';
            groupLabel.textContent = group.label;
            list.appendChild(groupLabel);
            for (const preset of presets) {
                const option = document.createElement('option');
                option.value = preset.id;
                option.textContent = preset.label;
                optionGroup.appendChild(option);
                addListOption(preset.id, preset.label, true);
            }
            select.appendChild(optionGroup);
        }

        select.addEventListener('change', event => {
            // "Custom" is a status-only option: selecting it changes no
            // parameter, so the dropdown snaps straight back to whatever the
            // current state actually matches instead of lying about it.
            selectPreset(event.target.value);
        });
        trigger.addEventListener('click', () => {
            this._setPresetListOpen(list.hidden);
        });
        trigger.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault?.();
                this._setPresetListOpen(false);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault?.();
                this._setPresetListOpen(true, true);
            }
        });

        this._presetDocumentPointerDown = event => {
            if (trigger.contains(event.target) || list.contains(event.target)) return;
            this._setPresetListOpen(false);
        };
        this._presetViewportChange = event => {
            if (event?.type === 'scroll' && list.contains(event.target)) return;
            this._setPresetListOpen(false);
        };
        document.addEventListener?.('pointerdown', this._presetDocumentPointerDown, true);
        document.addEventListener?.('scroll', this._presetViewportChange, true);
        window.addEventListener?.('resize', this._presetViewportChange);

        row.appendChild(labelElement);
        control.appendChild(select);
        control.appendChild(trigger);
        row.appendChild(control);
        if (document.body) document.body.appendChild(list);
        else control.appendChild(list);
        this.presetControl = select;
        this.presetTrigger = trigger;
        this.presetList = list;
        this._syncPresetControl();
        return row;
    }

    _createTabbedControls(instanceId) {
        const panel = document.createElement('div');
        panel.className = 'tube-simulator-panel';
        const tabs = document.createElement('div');
        tabs.className = 'tube-simulator-tabs';
        tabs.setAttribute('role', 'tablist');
        const contents = document.createElement('div');
        contents.className = 'tube-simulator-tab-contents';

        // `modelKey` defaults to the parameter key so PluginBase keeps the row in step with the
        // model; pass null for a row that is deliberately drawn from something other than the
        // stored value and maintains itself.
        const linear = (key, label, min, max, step, unit, modelKey = key) => {
            const row = this.createParameterControl(
                label, min, max, step, this[key],
                value => this._commitParameter(key, value), unit, modelKey
            );
            this._controls[key] = { kind: 'linear', row, min, max, step };
            return row;
        };
        const logarithmic = (key, label, min, max, step, unit) => {
            const row = this.createLogarithmicParameterControl(
                label, min, max, step, this[key],
                value => this._commitParameter(key, value), unit, key
            );
            this._controls[key] = { kind: 'log', row, min, max, step };
            return row;
        };
        const enumeration = (key, label, options) => {
            const row = this.createRadioGroup(
                label, options, this[key],
                value => this._commitParameter(key, value), key
            );
            this._controls[key] = { kind: 'enum', row };
            return row;
        };
        const checkbox = (key, label) => {
            const row = this.createCheckboxControl(
                label, this[key],
                value => this._commitParameter(key, value), key
            );
            this._controls[key] = { kind: 'checkbox', row };
            return row;
        };
        const abiOptions = key => TUBE_SIMULATOR_ENUM_ABI[key].values.map((value, index) => ({
            value,
            label: TUBE_SIMULATOR_ENUM_ABI[key].labels[index]
        }));

        const definitions = [
            { id: 'input', label: 'Input', create: content => {
                content.appendChild(linear('dr', 'Input Volume', -96, 0, 0.1, 'dB'));
                content.appendChild(logarithmic('iv', 'Input Reference', 0.1, 300, 0.001, 'Vpk'));
                content.appendChild(logarithmic('sz', 'Source Z', 0.6, 100, 0.1, 'kΩ'));
            } },
            { id: 'driver', label: 'Driver', create: content => {
                content.appendChild(enumeration('tp', 'Driver Type', abiOptions('tp')));
                content.appendChild(linear('bi', 'Bias', -50, 50, 1, '%'));
                content.appendChild(linear('pv', 'Plate', 150, 300, 1, 'V'));
                content.appendChild(logarithmic('su', 'Supply', 0.1, 47, 0.1, 'kΩ'));
                content.appendChild(linear('nf', 'Negative Feedback', 0, 30, 0.5, 'dB'));
            } },
            // The Power tab is split along the boundary the circuit itself has: the valves and
            // the supply that feeds them on one side, and everything they drive - the transformer
            // and the speaker hanging off its secondary - on the other. Output Circuit stays with
            // the valves because it is the branch switch rather than a component value, and it is
            // the one row that is never hidden.
            { id: 'power', label: 'Power', create: content => {
                content.appendChild(enumeration('os', 'Output Circuit', abiOptions('os')));
                // Topology-specific rows leave the layout when inactive, while their values stay
                // live and serialized so switching circuits restores the previous settings.
                this._ppRows = [
                    enumeration('pt', 'Power Tubes', abiOptions('pt')),
                    linear('pb', 'Output B+', 300, 470, 0.001, 'V'),
                    linear('kr', 'Cathode Resistor', 270, 500, 1, 'Ω / valve')
                ];
                this._seRows = [
                    enumeration('sd', 'SE Triode', abiOptions('sd')),
                    linear('sb', 'SE B+', 250, 450, 0.001, 'V'),
                    linear('sr', 'SE Cathode Resistor', 700, 1300, 1, 'Ω')
                ];
                for (const row of this._ppRows) content.appendChild(row);
                for (const row of this._seRows) content.appendChild(row);
            } },
            { id: 'transformer', label: 'Transformer', create: content => {
                // Assumed Speaker Load picks the secondary tap the amplifier is designed around,
                // so it belongs with the transformer; Actual Speaker Load is what is really
                // hanging off that tap.
                const ppRows = [
                    enumeration('st', 'Screen Tap', abiOptions('st')),
                    enumeration('zp', 'Push-Pull Primary', abiOptions('zp'))
                ];
                const seRows = [
                    enumeration('sp', 'SE Primary', abiOptions('sp'))
                ];
                const rows = [
                    enumeration('sl', 'Assumed Speaker Load', abiOptions('sl')),
                    logarithmic('rl', 'Actual Speaker Load', 2, 32, 0.1, 'Ω')
                ];
                for (const row of ppRows) content.appendChild(row);
                for (const row of seRows) content.appendChild(row);
                for (const row of rows) content.appendChild(row);
                this._powerRows.push(...rows);
                this._ppRows.push(...ppRows);
                this._seRows.push(...seRows);
            } },
            { id: 'output', label: 'Output', create: content => {
                content.appendChild(linear('og', 'Output Trim', -48, 48, 0.1, 'dB'));
                content.appendChild(
                    this._prepareSafetyTrimRow(
                        // Left unregistered on purpose: this row shows the effective trim rather
                        // than the stored sg, and _syncSafetyTrimControl()/_syncControlsFromState()
                        // already keep it painted. A generic sync would write the raw setting over
                        // the attenuation actually in force.
                        linear('sg', 'Output Safety Trim', -96, 0, 0.1, 'dB', null)));
                content.appendChild(checkbox('ag', 'Auto Gain Reduction'));
                content.appendChild(linear('mx', 'Wet/Dry Mix', 0, 100, 1, '%'));
            } }
        ];

        for (const definition of definitions) {
            const active = definition.id === this.selectedTab;
            const tab = document.createElement('button');
            const content = document.createElement('div');
            tab.type = 'button';
            tab.id = `${instanceId}-${definition.id}-tab`;
            tab.className = `tube-simulator-tab ${active ? 'active' : ''}`;
            tab.textContent = definition.label;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.setAttribute('aria-controls', `${instanceId}-${definition.id}-panel`);
            content.id = `${instanceId}-${definition.id}-panel`;
            content.className =
                `tube-simulator-tab-content plugin-parameter-ui ${active ? 'active' : ''}`;
            content.setAttribute('role', 'tabpanel');
            content.setAttribute('aria-labelledby', tab.id);
            content.hidden = !active;
            definition.create(content);
            tab.addEventListener('click', () => {
                for (const item of tabs.querySelectorAll('.tube-simulator-tab')) {
                    const selected = item === tab;
                    item.classList.toggle('active', selected);
                    item.setAttribute('aria-selected', selected ? 'true' : 'false');
                }
                for (const item of contents.querySelectorAll('.tube-simulator-tab-content')) {
                    const selected = item === content;
                    item.classList.toggle('active', selected);
                    item.hidden = !selected;
                }
                this.selectedTab = definition.id;
            });
            tabs.appendChild(tab);
            contents.appendChild(content);
        }

        panel.appendChild(tabs);
        panel.appendChild(contents);
        return panel;
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'tube-simulator-plugin-ui plugin-parameter-ui';
        const instanceId =
            `tube-simulator-${Date.now()}-${++tubeSimulatorInstanceSerial}`;
        container.setAttribute('data-instance-id', instanceId);
        this._controls = {};
        this._powerRows = [];
        this._ppRows = [];
        this._seRows = [];
        this.hudViewRow = null;

        this.hudGraph?.dispose?.();
        this.hudGraph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '2.8 / 1',
            mobileAspectRatio: '1.35 / 1',
            className: 'tube-simulator-hud',
            onResize: ({ cssWidth, dpr }) => {
                this.hudCssWidth = cssWidth;
                this.hudDpr = dpr;
                this._drawHud();
            }
        });
        this.hudCanvas = this.hudGraph.canvas;
        this.hudCanvas.setAttribute('role', 'img');
        const values = document.createElement('div');
        values.className = 'tube-simulator-values';
        const addValue = (key, label) => {
            const item = document.createElement('div');
            item.className = 'tube-simulator-value';
            const heading = document.createElement('span');
            heading.className = 'tube-simulator-value-label';
            heading.textContent = label;
            const reading = document.createElement('span');
            reading.className = 'tube-simulator-value-reading';
            reading.textContent = 'L — / R —';
            item.appendChild(heading);
            item.appendChild(reading);
            values.appendChild(item);
            this.hudValues[key] = reading;
        };
        addValue('stage1Bias', 'STAGE 1 BIAS');
        addValue('stage2Bias', 'STAGE 2 BIAS');
        addValue('bPlus', 'B+');
        addValue('plateSag1', 'STAGE 1 PLATE − B+ SAG');
        addValue('plateSag2', 'STAGE 2 PLATE − B+ SAG');
        addValue('inputReference', 'INPUT REFERENCE (0 dBFS)');
        addValue('stage1ExternalInput', 'STAGE 1 EXTERNAL INPUT (0 dBFS)');
        addValue('ltpBalance', 'POWER LTP BALANCE');
        addValue('powerBPlus', 'POWER B+');
        addValue('speakerVrms', 'SPEAKER OUTPUT (100 ms)');
        addValue('speakerPower', 'SPEAKER REAL POWER (100 ms)');
        addValue('transformerFlux', 'TRANSFORMER FLUX');

        const status = document.createElement('div');
        status.className = 'tube-simulator-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        this.hudStatus = status;
        status.textContent = this._hudStatusText();

        // Settings first, then the read-outs, matching every other plug-in in
        // the app: parameter controls on top and the graph panel underneath.
        container.appendChild(this._createPresetControl());
        container.appendChild(this._createTabbedControls(instanceId));
        container.appendChild(this._createHudViewControl());
        container.appendChild(this.hudGraph.container);
        container.appendChild(values);
        container.appendChild(status);
        this._syncPowerSectionVisibility();

        this.hudObserver?.disconnect();
        const Observer = typeof IntersectionObserver === 'function'
            ? IntersectionObserver
            : window.IntersectionObserver;
        if (typeof Observer === 'function') {
            this.hudObserver = new Observer(entries => {
                const entry = entries[0];
                this.hudVisible = Boolean(entry?.isIntersecting);
                this._refreshHudState();
            });
            this.hudObserver.observe(this.hudGraph.container);
        }
        this._updateHudValues();
        this._refreshHudState();
        return container;
    }

    cleanup() {
        this.stopAnimation();
        this.disposeDspTelemetrySubscription();
        this.hudObserver?.disconnect();
        this.hudObserver = null;
        this.hudGraph?.dispose?.();
        this.hudGraph = null;
        this.hudCanvas = null;
        this.hudStatus = null;
        this.hudViewRow = null;
        this._disposePresetList();
        this.presetControl = null;
        this._controls = {};
        this._powerRows = [];
        this._ppRows = [];
        this._seRows = [];
        this.hudValues = {};
        super.cleanup();
    }
}

window.TubeSimulatorPlugin = TubeSimulatorPlugin;
