const TUBE_SIMULATOR_TAP_OPERATING_POINT = 19;
const TUBE_SIMULATOR_TELEMETRY_VERSION = 2;
// Twenty floats per channel plus one shared trailing word carrying the automatic output safety
// reduction in dB. The channel stride stays twenty; the extra word lives past both channels.
const TUBE_SIMULATOR_TELEMETRY_BYTES = 164;
const TUBE_SIMULATOR_TELEMETRY_SAFETY_INDEX = 40;
const TUBE_SIMULATOR_PARAMETER_FIELDS = Object.freeze([
    'dr', 'tp', 'bi', 'pv', 'sz', 'su', 'og', 'mx', 'iv', 'nf',
    'os', 'pt', 'pb', 'kr', 'st', 'zp', 'sl'
]);
const TUBE_SIMULATOR_TELEMETRY_FIELDS = Object.freeze([
    'vk1', 'vk2', 'vbPlus', 'vgk1', 'vak1', 'ia1', 'vgk2', 'vak2', 'ia2',
    'ltpBalanceV', 'powerPlatePushV', 'powerPlatePullV', 'powerIaPushA',
    'powerIaPullA', 'powerBPlusV', 'screenPushV', 'screenPullV',
    'transformerFluxWb', 'speakerVrms100ms', 'speakerRealPower100ms'
]);
const TUBE_SIMULATOR_ENUM_ABI = Object.freeze({
    os: Object.freeze({
        values: Object.freeze(['Line', 'Power']),
        // Display only. The serialized values above are the parameter ABI; these
        // labels are kept short so the select does not wrap in the plugin UI.
        labels: Object.freeze(['Line', 'Push-Pull Power'])
    }),
    pt: Object.freeze({
        values: Object.freeze(['EL84', 'EL34']),
        labels: Object.freeze(['EL84 ×2', 'EL34 ×2'])
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
    })
});
const TUBE_SIMULATOR_CANONICAL_PRESETS = Object.freeze([
    Object.freeze({
        id: 'line-default', label: 'Line Default',
        params: Object.freeze({
            dr: 0, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 9,
            mx: 100, iv: 2.828, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8'
        })
    }),
    Object.freeze({
        id: 'power-el84-pentode-10w', label: 'EL84 Pentode 10 W',
        params: Object.freeze({
            dr: 0, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 0,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '15'
        })
    }),
    Object.freeze({
        id: 'power-el84-distributed-10w', label: 'EL84 Distributed 10 W',
        params: Object.freeze({
            dr: 0, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 0,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: 'EL84', pb: 330.107,
            kr: 270, st: '20', zp: '6.6', sl: '15'
        })
    }),
    Object.freeze({
        id: 'power-el34-distributed-20-37w', label: 'EL34 Distributed 20–37 W',
        params: Object.freeze({
            dr: 0, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 0,
            mx: 100, iv: 2.828, nf: 4, os: 'Power', pt: 'EL34', pb: 443.775,
            kr: 470, st: '43', zp: '6.6', sl: '8'
        })
    })
]);
// Listening (THD-matched) calibration bank. Entries share the canonical
// 17-field record shape ({ id, label, params }); while the array is empty the
// "Listening (THD-matched)" option group is omitted from the Preset dropdown
// entirely.
//
// GENERATED VALUES - do not hand-edit dr / iv / og.
// Every circuit value is inherited verbatim from the canonical preset named in
// the comment above each entry; only dr / iv / og are calibrated. Regenerate
// with:
//     node tests/tools/tube-simulator-lineamp/calibrate-listening-presets.mjs
// Measurement conditions: plugins/dsp/effetune-dsp.wasm, 96 kHz, stereo,
// 1 kHz sine at 0 dBFS peak, input reference iv = 2.828 Vpk unless the circuit
// cannot reach its THD target at dr = 0 dB, 3 s of settling discarded (the
// measured steady-state floor of this kernel; at 0.5 s the slow bias/supply
// exponentials still read several percent low), 4608 samples (48 whole periods)
// analysed with a rectangular-window DFT, THD taken over harmonics 2..10,
// og = -20*log10(G) with G the measured 1 kHz gain. The THD-vs-drive response
// is non-monotonic, so the solver takes the lowest-drive crossing of a 2 dB
// coarse grid; every record in the harness output echoes that grid pitch.
// Regression guard: tests/esm/dsp-tube-simulator-listening-presets-v1.test.mjs.
const TUBE_SIMULATOR_LISTENING_PRESETS = Object.freeze([
    // line-default; measured THD 0.9763 % (target 1.0 %, unreachable: 0.9763 %
    // is the circuit maximum at the iv ceiling of 20 Vpk), gain +0.0004 dB.
    Object.freeze({
        id: 'listening-line-12au7-thd1', label: 'Line 12AU7 @1%',
        params: Object.freeze({
            dr: 0, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: -7.749,
            mx: 100, iv: 20, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8'
        })
    }),
    // line-default with tp=12AT7; measured THD 0.9972 %, gain +0.0002 dB.
    Object.freeze({
        id: 'listening-line-12at7-thd1', label: 'Line 12AT7 @1%',
        params: Object.freeze({
            dr: -3.6973, tp: '12AT7', bi: 0, pv: 250, sz: 10, su: 10, og: -9.42,
            mx: 100, iv: 2.828, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8'
        })
    }),
    // line-default with tp=12AX7; measured THD 1.0004 %, gain -0.0001 dB.
    Object.freeze({
        id: 'listening-line-12ax7-thd1', label: 'Line 12AX7 @1%',
        params: Object.freeze({
            dr: -4.4805, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: -11.276,
            mx: 100, iv: 2.828, nf: 30, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8'
        })
    }),
    // line-default with nf=0; measured THD 3.0008 % (target 3.0 %),
    // gain -0.0005 dB.
    Object.freeze({
        id: 'listening-line-12au7-open-loop-thd3', label: 'Line 12AU7 Open-Loop @3%',
        params: Object.freeze({
            dr: -16.793, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 26.427,
            mx: 100, iv: 2.828, nf: 0, os: 'Line', pt: 'EL84', pb: 320,
            kr: 270, st: '0', zp: '8.0', sl: '8'
        })
    }),
    // power-el84-pentode-10w; measured THD 1.9994 % (target 2.0 %),
    // gain -0.0003 dB.
    Object.freeze({
        id: 'listening-power-el84-pentode-thd2', label: 'EL84 Pentode @2%',
        params: Object.freeze({
            dr: -55.9648, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 4.626,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: 'EL84', pb: 329.696,
            kr: 270, st: '0', zp: '8.0', sl: '15'
        })
    }),
    // power-el84-distributed-10w; measured THD 1.9997 % (target 2.0 %),
    // gain +0.0001 dB.
    Object.freeze({
        id: 'listening-power-el84-distributed-thd2', label: 'EL84 Distributed @2%',
        params: Object.freeze({
            dr: -52.9414, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 4.908,
            mx: 100, iv: 2.828, nf: 3, os: 'Power', pt: 'EL84', pb: 330.107,
            kr: 270, st: '20', zp: '6.6', sl: '15'
        })
    }),
    // power-el34-distributed-20-37w; measured THD 2.0000 % (target 2.0 %),
    // gain +0.0002 dB.
    Object.freeze({
        id: 'listening-power-el34-distributed-thd2', label: 'EL34 Distributed @2%',
        params: Object.freeze({
            dr: -43.6504, tp: '12AX7', bi: 0, pv: 250, sz: 10, su: 10, og: 5.212,
            mx: 100, iv: 2.828, nf: 4, os: 'Power', pt: 'EL34', pb: 443.775,
            kr: 470, st: '43', zp: '6.6', sl: '8'
        })
    })
]);
const TUBE_SIMULATOR_PRESET_GROUPS = Object.freeze([
    // Listening first: this is a listening application, so the bank a listener reaches for
    // belongs above the bank that describes circuits. Custom stays at the top of the dropdown.
    Object.freeze({
        label: 'Listening (THD-matched)',
        presets: TUBE_SIMULATOR_LISTENING_PRESETS
    }),
    Object.freeze({ label: 'Circuit', presets: TUBE_SIMULATOR_CANONICAL_PRESETS })
]);
const TUBE_SIMULATOR_SELECTABLE_PRESETS = Object.freeze(
    TUBE_SIMULATOR_PRESET_GROUPS.flatMap(group => [...(group.presets || [])])
);
let tubeSimulatorInstanceSerial = 0;
const TUBE_SIMULATOR_POWER_TUBE_COMPONENTS = Object.freeze({
    EL84: Object.freeze({
        gridRc: Object.freeze({
            couplingCapacitanceF: 4.7e-8,
            gridLeakResistanceOhm: 470000,
            gridStopperResistanceOhm: 1500
        }),
        cathodeRc: Object.freeze({ capacitanceF: 0.00005 }),
        powerSupplyRc: Object.freeze({
            theveninResistanceOhm: 120,
            capacitanceF: 0.000032
        }),
        outputTubeLutId: 'el84-ia-ig2-lut-v1',
        nfbTapTurnsRatio: 0.1
    }),
    EL34: Object.freeze({
        gridRc: Object.freeze({
            couplingCapacitanceF: 1e-7,
            gridLeakResistanceOhm: 220000,
            gridStopperResistanceOhm: 5600
        }),
        cathodeRc: Object.freeze({ capacitanceF: 0.0001 }),
        powerSupplyRc: Object.freeze({
            theveninResistanceOhm: 80,
            capacitanceF: 0.000032
        }),
        outputTubeLutId: 'el34-ia-ig2-lut-v1',
        nfbTapTurnsRatio: 0.12
    })
});
const TUBE_SIMULATOR_POWER_PROFILE_ROWS = Object.freeze([
    ['EL84', '0', '6.0', 4.099889133756051, 77.8978935413649, 55, 0.024, 6e-10, 220000, 900, 0.26, 0.002],
    ['EL84', '0', '6.6', 4.299999999999997, 81.7, 55, 0.024, 6e-10, 220000, 900, 0.26, 0.002],
    ['EL84', '0', '8.0', 4.734144190043352, 89.94873961082367, 55, 0.024, 6e-10, 220000, 900, 0.26, 0.002],
    ['EL84', '20', '6.0', 28.699223936292327, 53.29855873882862, 55, 0.024, 6e-10, 220000, 900, 0.23, 0.002],
    ['EL84', '20', '6.6', 30.1, 55.9, 55, 0.024, 6e-10, 220000, 900, 0.23, 0.002],
    ['EL84', '20', '8.0', 33.13900933030345, 61.543874470563566, 55, 0.024, 6e-10, 220000, 900, 0.23, 0.002],
    ['EL84', '43', '6.0', 62.47450108580644, 19.52328158931451, 55, 0.024, 6e-10, 220000, 900, 0.085, 0.003],
    ['EL84', '43', '6.6', 65.52380952380952, 20.476190476190474, 55, 0.024, 6e-10, 220000, 900, 0.23, 0.002],
    ['EL84', '43', '8.0', 72.13934003875582, 22.543543762111195, 55, 0.024, 6e-10, 220000, 900, 0.23, 0.002],
    ['EL34', '0', '6.0', 2.002271437415743, 38.04315731089913, 42, 0.018, 7.5e-10, 180000, 820, 0.26, 0.002],
    ['EL34', '0', '6.6', 2.1000000000000014, 39.9, 42, 0.018, 7.5e-10, 180000, 820, 0.26, 0.002],
    ['EL34', '0', '8.0', 2.3120239067653614, 43.92845422854178, 42, 0.018, 7.5e-10, 180000, 820, 0.26, 0.002],
    ['EL34', '20', '6.0', 14.015900061910205, 26.02952868640467, 42, 0.018, 7.5e-10, 180000, 820, 0.23, 0.002],
    ['EL34', '20', '6.6', 14.7, 27.3, 42, 0.018, 7.5e-10, 180000, 820, 0.23, 0.002],
    ['EL34', '20', '8.0', 16.184167347357498, 30.056310787949645, 42, 0.018, 7.5e-10, 180000, 820, 0.085, 0.003],
    ['EL34', '43', '6.0', 30.510802855858955, 9.534625892455923, 42, 0.018, 7.5e-10, 180000, 820, 0.23, 0.002],
    ['EL34', '43', '6.6', 32, 10, 42, 0.018, 7.5e-10, 180000, 820, 0.23, 0.002],
    ['EL34', '43', '8.0', 35.23084048404354, 11.009637651263604, 42, 0.018, 7.5e-10, 180000, 820, 0.23, 0.002]
]);
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
// __TUBE_PHASE_C_REFERENCE_TABLES_INJECT_START__
const TUBE_SIMULATOR_PHASE_C_REFERENCE_TABLES = Object.freeze({"profiles":[{"circuitProfileId":"power-v1-el84-0-6_0","key":{"pt":"EL84","st":"0","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":4.099889133756051,"primaryTapToPlateResistanceOhm":77.8978935413649,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-0-6_6","key":{"pt":"EL84","st":"0","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":4.299999999999997,"primaryTapToPlateResistanceOhm":81.7,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-0-8_0","key":{"pt":"EL84","st":"0","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":4.734144190043352,"primaryTapToPlateResistanceOhm":89.94873961082367,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-20-6_0","key":{"pt":"EL84","st":"20","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":28.699223936292327,"primaryTapToPlateResistanceOhm":53.29855873882862,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-20-6_6","key":{"pt":"EL84","st":"20","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.1,"primaryTapToPlateResistanceOhm":55.9,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-20-8_0","key":{"pt":"EL84","st":"20","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":33.13900933030345,"primaryTapToPlateResistanceOhm":61.543874470563566,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-43-6_0","key":{"pt":"EL84","st":"43","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":62.47450108580644,"primaryTapToPlateResistanceOhm":19.52328158931451,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.085,"feedbackDampingCoupling":0.003},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"sentinelProfile":true},{"circuitProfileId":"power-v1-el84-43-6_6","key":{"pt":"EL84","st":"43","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":65.52380952380952,"primaryTapToPlateResistanceOhm":20.476190476190474,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"sentinelProfile":false},{"circuitProfileId":"power-v1-el84-43-8_0","key":{"pt":"EL84","st":"43","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":4.7e-8,"gridLeakResistanceOhm":470000,"gridStopperResistanceOhm":1500},"cathodeRc":{"capacitanceF":0.00005},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":120,"capacitanceF":0.000032},"outputTubeLutId":"el84-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":72.13934003875582,"primaryTapToPlateResistanceOhm":22.543543762111195,"magnetizingInductanceH":55,"leakageInductanceH":0.024,"interwindingCapacitanceF":6e-10,"coreLossResistanceOhm":220000,"resonanceHz":900,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.1,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-0-6_0","key":{"pt":"EL34","st":"0","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":2.002271437415743,"primaryTapToPlateResistanceOhm":38.04315731089913,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-0-6_6","key":{"pt":"EL34","st":"0","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":2.1000000000000014,"primaryTapToPlateResistanceOhm":39.9,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-0-8_0","key":{"pt":"EL34","st":"0","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":2.3120239067653614,"primaryTapToPlateResistanceOhm":43.92845422854178,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.26,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-20-6_0","key":{"pt":"EL34","st":"20","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.015900061910205,"primaryTapToPlateResistanceOhm":26.02952868640467,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-20-6_6","key":{"pt":"EL34","st":"20","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":14.7,"primaryTapToPlateResistanceOhm":27.3,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-20-8_0","key":{"pt":"EL34","st":"20","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":16.184167347357498,"primaryTapToPlateResistanceOhm":30.056310787949645,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.085,"feedbackDampingCoupling":0.003},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.2,"sentinelProfile":true},{"circuitProfileId":"power-v1-el34-43-6_0","key":{"pt":"EL34","st":"43","zp":"6.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":30.510802855858955,"primaryTapToPlateResistanceOhm":9.534625892455923,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-43-6_6","key":{"pt":"EL34","st":"43","zp":"6.6"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":32,"primaryTapToPlateResistanceOhm":10,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"sentinelProfile":false},{"circuitProfileId":"power-v1-el34-43-8_0","key":{"pt":"EL34","st":"43","zp":"8.0"},"ltpRc":{"tube":"12AX7","plateResistanceOhm":100000,"tailResistanceOhm":47000,"inputCouplingCapacitanceF":1e-7,"gridLeakResistanceOhm":1000000,"tailSupplyV":-100,"preVolumeResistanceOhm":1000000,"preVolumeWiperPosition":0.024},"gridRc":{"couplingCapacitanceF":1e-7,"gridLeakResistanceOhm":220000,"gridStopperResistanceOhm":5600},"cathodeRc":{"capacitanceF":0.0001},"screenSupplyRc":{"seriesResistanceOhm":1000,"capacitanceF":0.000016},"powerSupplyRc":{"theveninResistanceOhm":80,"capacitanceF":0.000032},"outputTubeLutId":"el34-ia-ig2-lut-v2","optCoefficients":{"order":2,"primaryCenterToTapResistanceOhm":35.23084048404354,"primaryTapToPlateResistanceOhm":11.009637651263604,"magnetizingInductanceH":42,"leakageInductanceH":0.018,"interwindingCapacitanceF":7.5e-10,"coreLossResistanceOhm":180000,"resonanceHz":820,"dampingRatio":0.23,"feedbackDampingCoupling":0.002},"nfbTapNode":"fixed-secondary-feedback-winding","nfbTapTurnsRatio":0.12,"nfbPolarity":1,"screenTapTurnsRatio":0.43,"sentinelProfile":false}],"speakers":[{"id":"speaker-two-branch-4-ohm-v1","sl":"4","topology":"series-voice-rl-parallel-resonance-rlc","voiceResistanceOhm":3.2,"voiceInductanceH":0.00035,"resonanceResistanceOhm":24,"resonanceInductanceH":0.014,"resonanceCapacitanceF":0.00075},{"id":"speaker-two-branch-8-ohm-v1","sl":"8","topology":"series-voice-rl-parallel-resonance-rlc","voiceResistanceOhm":6.4,"voiceInductanceH":0.0006,"resonanceResistanceOhm":48,"resonanceInductanceH":0.022,"resonanceCapacitanceF":0.0005},{"id":"speaker-two-branch-15-ohm-v1","sl":"15","topology":"series-voice-rl-parallel-resonance-rlc","voiceResistanceOhm":12,"voiceInductanceH":0.0009,"resonanceResistanceOhm":70,"resonanceInductanceH":0.032,"resonanceCapacitanceF":0.00033},{"id":"speaker-two-branch-16-ohm-v1","sl":"16","topology":"series-voice-rl-parallel-resonance-rlc","voiceResistanceOhm":12.8,"voiceInductanceH":0.001,"resonanceResistanceOhm":80,"resonanceInductanceH":0.035,"resonanceCapacitanceF":0.0003}],"axes":[{"controlVoltageV":[0,0.4000000000000001,1.6000000000000003,3.5999999999999996,6.400000000000001,10,14.399999999999999,19.599999999999998,25.600000000000005,32.400000000000006,40],"plateCathodeV":[0,7.000000000000002,28.000000000000007,63,112.00000000000003,175,252,342.99999999999994,448.0000000000001,567,700],"screenCathodeV":[0,80,160,240,320,400]},{"controlVoltageV":[0,0.9000000000000001,3.6000000000000005,8.1,14.400000000000002,22.5,32.4,44.099999999999994,57.60000000000001,72.9,90],"plateCathodeV":[0,9.000000000000002,36.00000000000001,81,144.00000000000003,225,324,440.99999999999994,576.0000000000001,729,900],"screenCathodeV":[0,120,240,360,480,600]}],"tubeModels":[{"inverseScreenAmplificationFactor":0.04840507695187201,"inversePlateAmplificationFactor":0.002328830926874709},{"inverseScreenAmplificationFactor":0.09181180107864813,"inversePlateAmplificationFactor":0.006060606060606061}],"luts":[[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.0017819109029218324,0.00020364696033392375,0,0.001985557863255756,0,0.001985557863255756,0,0.001985557863255756,0,0.001985557863255756,0,0.001985557863255756,0.0017819109029218324,0.00020364696033392375,0.0014090788420838842,0.000576479021171872,0.0008740557866623498,0.0011115020765934064,0.0006117264910453819,0.0013738313722103743,0.00046705180677536587,0.0015185060564803902,0.0003767971585173662,0.00160876070473839,0.0017819109029218324,0.00020364696033392375,0.0017812468748718308,0.00020431098838392535,0.0017339151219827253,0.00025164274127303086,0.0015893466273603023,0.0003962112358954538,0.0014090788420838842,0.000576479021171872,0.0012395511877036863,0.0007460066755520698,0.0017819109029218324,0.00020364696033392375,0.0017819108884605582,0.00020364697479519794,0.0017816838988694715,0.00020387396438628462,0.0017762356220826546,0.00020932224117310152,0.0017536922576555651,0.00023186560560019102,0.0017087026755677386,0.0002768551876880176,0.0017819109029218324,0.00020364696033392375,0.001781910902921828,0.00020364696033392808,0.0017819107791508867,0.0002036470841048695,0.0017818729673600093,0.0002036848958957469,0.0017812468748718308,0.00020431098838392535,0.001778214779817417,0.00020734308343833916,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.001781910902913948,0.00020364696034180806,0.0017819108424135723,0.00020364702084218382,0.0017819056021470393,0.0002036522611087168,0.001781833305777437,0.0002037245574783191,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109028987667,0.0002036469603569895,0.0017819108884605582,0.00020364697479519794,0.0017819102133994535,0.0002036476498563026,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218302,0.00020364696033392591,0.001781910902908347,0.00020364696034740905,0.0017819109003259987,0.00020364696292975745,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.001781910902921828,0.00020364696033392808,0.001781910902917692,0.0002036469603380641,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218296,0.00020364696033392657,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.0017819109029218324,0.00020364696033392375,0.010320699011351428,0.0011795084584401636,0,0.011500207469791591,0,0.011500207469791591,0,0.011500207469791591,0,0.011500207469791591,0,0.011500207469791591,0.010320699011351428,0.0011795084584401636,0.00816128269295926,0.003338924776832331,0.005062467870015513,0.006437739599776078,0.0035430755718466496,0.007957131897944942,0.002705130269157947,0.008795077200633643,0.0021823818772384487,0.009317825592553142,0.010320699011351428,0.0011795084584401636,0.010316853008934626,0.0011833544608569647,0.010042710921107945,0.0014574965486836462,0.009205380661174259,0.0022948268086173326,0.00816128269295926,0.003338924776832331,0.007179390785743522,0.004320816684048069,0.010320699011351428,0.0011795084584401636,0.010320698927592773,0.001179508542198818,0.010319384220306078,0.001180823249485513,0.010287828195391998,0.0012123792743995929,0.010157258659859277,0.001342948809932314,0.009896682255835043,0.0016035252139565484,0.010320699011351428,0.0011795084584401636,0.010320699011351402,0.0011795084584401896,0.010320698294479066,0.0011795091753125254,0.01032047929132235,0.0011797281784692408,0.010316853008934626,0.0011833544608569647,0.010299291333780667,0.0012009161360109245,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011305761,0.0011795084584858301,0.010320698660891964,0.001179508808899627,0.01032066830964739,0.001179539160144202,0.010320249574305988,0.001179957895485603,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011217831,0.0011795084585737598,0.010320698927592773,0.001179508542198818,0.010320695017687702,0.0011795124521038897,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351415,0.0011795084584401757,0.010320699011273322,0.0011795084585182695,0.010320698996316546,0.0011795084734750449,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351402,0.0011795084584401896,0.010320699011327447,0.0011795084584641444,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351412,0.0011795084584401792,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.010320699011351428,0.0011795084584401636,0.028835802141207557,0.003295520244709433,0,0.03213132238591699,0,0.03213132238591699,0,0.03213132238591699,0,0.03213132238591699,0,0.03213132238591699,0.028835802141207557,0.003295520244709433,0.022802441258464617,0.009328881127452372,0.014144421970394486,0.017986900415522505,0.009899273881424593,0.022232048504492397,0.007558073452373253,0.024573248933543738,0.006097526140369892,0.026033796245547098,0.028835802141207557,0.003295520244709433,0.028825056496498462,0.0033062658894185276,0.02805910963626611,0.004072212749650878,0.025719627622912442,0.0064116947630045475,0.022802441258464617,0.009328881127452372,0.020059057236763704,0.012072265149153286,0.028835802141207557,0.003295520244709433,0.02883580190718775,0.00329552047872924,0.028832128644441585,0.0032991937414754043,0.028743961816808633,0.0033873605691083566,0.02837915345565501,0.0037521689302619787,0.027651108812472815,0.004480213573444174,0.028835802141207557,0.003295520244709433,0.028835802141207487,0.0032955202447095024,0.028835800138282217,0.0032955222476347724,0.02883518824836193,0.0032961341375550603,0.028825056496498462,0.0033062658894185276,0.02877598956901121,0.003355332816905778,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141079968,0.003295520244837022,0.028835801162031653,0.0032955212238853365,0.028835716361333336,0.003295606024583654,0.028834546424157486,0.0032967759617595037,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802140834293,0.003295520245082697,0.02883580190718775,0.00329552047872924,0.028835790983000455,0.0032955314029165343,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207522,0.0032955202447094677,0.02883580214098933,0.003295520244927661,0.028835802099200437,0.003295520286716553,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207487,0.0032955202447095024,0.028835802141140555,0.003295520244776435,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.02883580214120751,0.003295520244709478,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.028835802141207557,0.003295520244709433,0.059776741872027785,0.006831627642517456,0,0.06660836951454524,0,0.06660836951454524,0,0.06660836951454524,0,0.06660836951454524,0,0.06660836951454524,0.059776741872027785,0.006831627642517456,0.0472695588104155,0.01933881070412974,0.029321447584946654,0.037286921929598586,0.020521237336581472,0.04608713217796377,0.01566791877680091,0.05094045073774433,0.012640197916671137,0.05396817159787411,0.059776741872027785,0.006831627642517456,0.059754466104324895,0.006853903410220345,0.05816665496844636,0.008441714546098877,0.053316898691798606,0.013291470822746634,0.0472695588104155,0.01933881070412974,0.041582511933134024,0.025025857581411216,0.059776741872027785,0.006831627642517456,0.05977674138690372,0.006831628127641522,0.059769126697430876,0.006839242817114365,0.05958635648451008,0.007022013030035162,0.05883010718266477,0.007778262331880469,0.05732086750576248,0.009287502008782762,0.059776741872027785,0.006831627642517456,0.05977674187202764,0.0068316276425176015,0.05977673771995494,0.006831631794590301,0.059775469269518225,0.006832900245027015,0.059754466104324895,0.006853903410220345,0.059652750152589064,0.0069556193619561765,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741871763295,0.0068316276427819456,0.05977673984219193,0.006831629672353311,0.05977656404997955,0.006831805464565688,0.05977413876518169,0.006834230749363547,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.05977674187125401,0.006831627643291233,0.05977674138690372,0.006831628127641522,0.05977671874101647,0.00683165077352877,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.05977674187202771,0.006831627642517532,0.059776741871575396,0.006831627642969844,0.059776741784946845,0.006831627729598395,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.05977674187202764,0.0068316276425176015,0.05977674187188889,0.006831627642656352,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027694,0.006831627642517546,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.059776741872027785,0.006831627642517456,0.10522197188614804,0.012025368215559773,0,0.11724734010170781,0,0.11724734010170781,0,0.11724734010170781,0,0.11724734010170781,0,0.11724734010170781,0.10522197188614804,0.012025368215559773,0.08320621085150884,0.034041129250198976,0.051613059474694314,0.0656342806270135,0.036122494978421925,0.08112484512328588,0.027579444068336796,0.08966789603337103,0.022249900348712322,0.09499743975299549,0.10522197188614804,0.012025368215559773,0.1051827609802075,0.012064579121500316,0.10238781743748986,0.014859522664217958,0.09385103703402506,0.023396303067682755,0.08320621085150884,0.034041129250198976,0.07319559020046033,0.04405174990124748,0.10522197188614804,0.012025368215559773,0.10522197103220872,0.012025369069499095,0.10520856727990405,0.012038772821803767,0.10488684612877892,0.01236049397292889,0.10355565877587768,0.013691681325830138,0.10089902059388293,0.01634831950782488,0.10522197188614804,0.012025368215559773,0.10522197188614778,0.012025368215560037,0.10522196457746445,0.012025375524243362,0.10521973178838945,0.012027608313318366,0.1051827609802075,0.012064579121500316,0.10500371554081515,0.01224362456089266,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188568247,0.012025368216025345,0.10522196831313077,0.012025371788577044,0.10522165887500066,0.01202568122670715,0.10521738976897674,0.012029950332731076,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.105221971884786,0.012025368216921808,0.10522197103220872,0.012025369069499095,0.10522193116980007,0.012025408931907747,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614792,0.012025368215559898,0.10522197188535173,0.01202536821635608,0.10522197173286388,0.012025368368843936,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614778,0.012025368215560037,0.10522197188590354,0.012025368215804272,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614787,0.01202536821555994,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.10522197188614804,0.012025368215559773,0.16701487945457694,0.01908741479480877,0,0.1861022942493857,0,0.1861022942493857,0,0.1861022942493857,0,0.1861022942493857,0,0.1861022942493857,0.16701487945457694,0.01908741479480877,0.13207008979334942,0.05403220445603629,0.08192346856771633,0.10417882568166938,0.057335878013648145,0.12876641623573756,0.04377581453692466,0.14232647971246104,0.03531643019043002,0.1507858640589557,0.16701487945457694,0.01908741479480877,0.16695264145797248,0.01914965279141323,0.16251633266712015,0.023585961582265558,0.1489662221297737,0.03713607211961201,0.13207008979334942,0.05403220445603629,0.11618060804984613,0.06992168619953958,0.16701487945457694,0.01908741479480877,0.16701487809915117,0.019087416150234543,0.16699360282712122,0.019108691422264484,0.16648294694118812,0.019619347308197588,0.1643700033107758,0.0217322909386099,0.16015322141848845,0.025949072830897257,0.16701487945457694,0.01908741479480877,0.16701487945457652,0.019087414794809188,0.1670148678537783,0.0190874263956074,0.1670113238316361,0.019090970417749598,0.16695264145797248,0.01914965279141323,0.1666684493644299,0.01943384488495581,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945383794,0.019087414795547764,0.16701487378326096,0.019087420466124744,0.16701438262375246,0.019087911625633253,0.16700760643228613,0.01909468781709958,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945241503,0.01908741479697068,0.16701487809915117,0.019087416150234543,0.1670148148270488,0.019087479422336906,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457674,0.019087414794808966,0.16701487945331298,0.019087414796072733,0.16701487921127472,0.019087415038110983,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457652,0.019087414794809188,0.16701487945418886,0.01908741479519685,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.1670148794545767,0.01908741479480902,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.16701487945457694,0.01908741479480877,0.24683187758968456,0.02820935743882108,0,0.27504123502850564,0,0.27504123502850564,0,0.27504123502850564,0,0.27504123502850564,0,0.27504123502850564,0.24683187758968456,0.02820935743882108,0.1951868500794066,0.07985438494909905,0.12107498224868357,0.15396625277982207,0.08473689571599453,0.19030433931251112,0.06469643022498263,0.21034480480352302,0.05219427635511773,0.2228469586733879,0.24683187758968456,0.02820935743882108,0.2467398958356668,0.028301339192838837,0.2401834594750878,0.03485777555341785,0.2201577034681769,0.05488353156032874,0.1951868500794066,0.07985438494909905,0.1717037291414149,0.10333750588709073,0.24683187758968456,0.02820935743882108,0.24683187558649602,0.028209359442009613,0.24680043278715666,0.028240802241348978,0.24604573265781055,0.028995502370695092,0.24292300583706836,0.03211822919143728,0.2366910090517607,0.03835022597674495,0.24683187758968456,0.02820935743882108,0.24683187758968395,0.02820935743882169,0.24683186044482347,0.028209374583682167,0.2468266227220383,0.028214612306467324,0.2467398958356668,0.028301339192838837,0.2463198873413677,0.028721347687137938,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.2468318775885924,0.028209357439913235,0.24683186920802674,0.028209365820478893,0.24683114332166212,0.02821009170684352,0.24682112876446816,0.02822010626403748,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758648947,0.028209357442016164,0.24683187558649602,0.028209359442009613,0.2468317820764335,0.02820945295207214,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968425,0.028209357438821386,0.24683187758781655,0.028209357440689087,0.24683187723010738,0.028209357798398255,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968395,0.02820935743882169,0.24683187758911102,0.028209357439394622,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968417,0.02820935743882147,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.24683187758968456,0.02820935743882108,0.34622256350126285,0.03956829297157288,0,0.38579085647283573,0,0.38579085647283573,0,0.38579085647283573,0,0.38579085647283573,0,0.38579085647283573,0.34622256350126285,0.03956829297157288,0.27378186422324974,0.11200899224958599,0.1698277027236006,0.21596315374923514,0.1188575217448205,0.2669333347280152,0.0907474518307929,0.2950434046420428,0.0732111116936114,0.31257974477922434,0.34622256350126285,0.03956829297157288,0.34609354386659347,0.03969731260624226,0.3368970566609741,0.04889379981186165,0.3088076192330863,0.07698323723974942,0.27378186422324974,0.11200899224958599,0.24084290022250984,0.1449479562503259,0.34622256350126285,0.03956829297157288,0.34622256069145935,0.039568295781376384,0.3461784569610286,0.03961239951180712,0.34511986511297205,0.040670991359863684,0.3407397238785859,0.04505113259424981,0.33199831687795706,0.053792539594878674,0.34622256350126285,0.03956829297157288,0.346222563501262,0.039568292971573715,0.3462225394527574,0.03956831702007835,0.3462151926796125,0.03957566379322325,0.34609354386659347,0.03969731260624226,0.34550441243426583,0.0402864440385699,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.3462225634997309,0.039568292973104824,0.3462225517446004,0.039568304728235304,0.3462215335688266,0.03956932290400911,0.34620748649477007,0.03958336997806566,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.3462225634967812,0.03956829297605452,0.34622256069145935,0.039568295781376384,0.34622242952811905,0.039568426944716684,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.3462225635012624,0.03956829297157333,0.34622256349864267,0.039568292974193064,0.34622256299689635,0.039568293475939376,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.346222563501262,0.039568292971573715,0.3462225635004584,0.03956829297237735,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.3462225635012623,0.03956829297157344,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.34622256350126285,0.03956829297157288,0.4666358367095902,0.0533298099096674,0,0.5199656466192576,0,0.5199656466192576,0,0.5199656466192576,0,0.5199656466192576,0,0.5199656466192576,0.4666358367095902,0.0533298099096674,0.36900087618715116,0.15096477043210643,0.2288923383718342,0.2910733082474234,0.16019516044170334,0.35977048617755425,0.12230864645588246,0.39765700016337513,0.09867331584662306,0.4212923307726345,0.4666358367095902,0.0533298099096674,0.46646194513947686,0.05350370147978073,0.4540669976277223,0.0658986489915353,0.41620829193185194,0.10375735468740566,0.36900087618715116,0.15096477043210643,0.324606019678106,0.1953596269411516,0.4666358367095902,0.0533298099096674,0.4666358329225609,0.053329813696696704,0.4665763902884834,0.05338925633077418,0.46514962916767033,0.05481601745158726,0.4592461119354479,0.060719534683809695,0.44746451766698925,0.07250112895226835,0.4666358367095902,0.0533298099096674,0.466635836709589,0.05332980990966857,0.46663580429721835,0.053329842322039245,0.46662590237864054,0.05333974424061705,0.46646194513947686,0.05350370147978073,0.46566791878811475,0.05429772783114284,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.46663583670752545,0.05332980991173214,0.46663582086406025,0.053329825755197346,0.4666344485753817,0.05333119804387587,0.466615516048023,0.05335013057123461,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.46663583670354986,0.05332980991570774,0.4666358329225609,0.053329813696696704,0.4666356561417225,0.053329990477535116,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.46663583670958964,0.05332980990966796,0.46663583670605874,0.053329809913198856,0.4666358360298093,0.0533298105894483,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.466635836709589,0.05332980990966857,0.46663583670850595,0.05332980991075165,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.46663583670958947,0.053329809909668124,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.4666358367095902,0.0533298099096674,0.6094380473440844,0.06965006255360962,0,0.679088109897694,0,0.679088109897694,0,0.679088109897694,0,0.679088109897694,0,0.679088109897694,0.6094380473440844,0.06965006255360962,0.48192435248326027,0.1971637574144337,0.29893910577675353,0.38014900412094044,0.2092188771054959,0.46986923279219805,0.15973814440608533,0.5193499654916086,0.12886981282570698,0.550218297071987,0.6094380473440844,0.06965006255360962,0.6092109406141625,0.06987716928353149,0.5930228298557569,0.08606528004193703,0.54357841547696,0.13550969442073402,0.48192435248326027,0.1971637574144337,0.4239435620369588,0.25514454786073515,0.6094380473440844,0.06965006255360962,0.6094380423981296,0.06965006749956437,0.6093604088346711,0.06972770106302284,0.6074970232069704,0.07159108669072356,0.5997868823831595,0.0793012275145345,0.5843998262663395,0.09468828363135451,0.6094380473440844,0.06965006255360962,0.6094380473440829,0.06965006255361106,0.6094380050127178,0.06965010488497614,0.6094250728599592,0.0696630370377348,0.6092109406141625,0.06987716928353149,0.6081739223848596,0.0709141875128344,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473413877,0.06965006255630624,0.6094380266494268,0.06965008324826716,0.6094362344061681,0.06965187549152585,0.6094115080529884,0.06967660184470559,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473361956,0.06965006256149842,0.6094380423981296,0.06965006749956437,0.6094378115179432,0.06965029837975079,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440836,0.06965006255361039,0.6094380473394722,0.06965006255822181,0.6094380464562735,0.06965006344142044,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440829,0.06965006255361106,0.6094380473426683,0.0696500625550257,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440834,0.06965006255361061,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962,0.6094380473440844,0.06965006255360962],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0.006264764795991247,0.0005011811836792999,0,0.006765945979670547,0,0.006765945979670547,0,0.006765945979670547,0,0.006765945979670547,0,0.006765945979670547,0.006264764795991247,0.0005011811836792999,0.004120083953303734,0.002645862026366813,0.002349882249897071,0.004416063729773476,0.0016100403118149244,0.005155905667855622,0.0012194597236916305,0.005546486255978917,0.0009800624343285207,0.005785883545342026,0.006264764795991247,0.0005011811836792999,0.006242014059609222,0.0005239319200613249,0.005752232816280637,0.0010137131633899095,0.00490165563069334,0.0018642903489772067,0.004120083953303734,0.002645862026366813,0.003500131010150358,0.0032658149695201887,0.006264764795991247,0.0005011811836792999,0.0062647562335630775,0.0005011897461074692,0.0062544155875768805,0.0005115303920936662,0.006155365720911795,0.0006105802587587517,0.005914586068807649,0.0008513599108628976,0.005572633096595191,0.001193312883075356,0.006264764795991247,0.0005011811836792999,0.006264764795854053,0.000501181183816494,0.006264723335608787,0.0005012226440617596,0.006261983129952779,0.0005039628497177677,0.006242014059609222,0.0005239319200613249,0.006184775238162038,0.0005811707415085089,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764761717154,0.000501181217953393,0.006264740289109382,0.0005012056905611649,0.006264109514867273,0.0005018364648032734,0.006260059530561971,0.0005058864491085755,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795985396,0.0005011811836851511,0.00626476472057156,0.0005011812590989869,0.0062647562335630775,0.0005011897461074692,0.006264618356008944,0.0005013276236616026,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795910153,0.0005011811837603939,0.006264764745148928,0.000501181234521619,0.0062647623717984775,0.0005011836078720692,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.0062647647959912164,0.0005011811836793303,0.006264764795854053,0.000501181183816494,0.006264764774638452,0.0005011812050320944,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.0062647647959910785,0.0005011811836794682,0.0062647647958911715,0.0005011811837793752,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795991247,0.0005011811836792999,0.006264764795990997,0.0005011811836795497,0.030134945481475956,0.0024107956385180755,0,0.03254574111999403,0,0.03254574111999403,0,0.03254574111999403,0,0.03254574111999403,0,0.03254574111999403,0.030134945481475956,0.0024107956385180755,0.019818542172781905,0.012727198947212127,0.011303468812404436,0.021242272307589596,0.007744660589742767,0.024801080530251263,0.005865879005356734,0.0266798621146373,0.004714323520306963,0.027831417599687068,0.030134945481475956,0.0024107956385180755,0.030025509257952537,0.002520231862041495,0.027669549928880696,0.004876191191113335,0.02357807994554435,0.008967661174449682,0.019818542172781905,0.012727198947212127,0.01683642732068688,0.01570931379930715,0.030134945481475956,0.0024107956385180755,0.030134904294246354,0.002410836825747678,0.030085163431949863,0.0024605776880441688,0.02960871101448484,0.002937030105509192,0.02845050604981479,0.00409523507017924,0.026805634372997017,0.005740106746997015,0.030134945481475956,0.0024107956385180755,0.030134945480816022,0.0024107956391780094,0.030134746047593638,0.002410995072400394,0.030121565034300902,0.00242417608569313,0.030025509257952537,0.002520231862041495,0.029750177490535098,0.002795563629458934,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945316609763,0.002410795803384269,0.030134827597792693,0.0024109135222013384,0.030131793430028052,0.00241394768996598,0.030112312083127493,0.0024334290368665384,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.03013494548144781,0.002410795638546223,0.030134945118690085,0.0024107960013039463,0.030134904294246354,0.002410836825747678,0.030134241071809082,0.0024115000481849495,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481085876,0.002410795638908156,0.030134945236912822,0.002410795883081209,0.030134933820556622,0.00241080729943741,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.03013494548147581,0.0024107956385182212,0.030134945480816022,0.0024107956391780094,0.030134945378764152,0.00241079574122988,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475148,0.002410795638518884,0.03013494548099457,0.0024107956389994613,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481475956,0.0024107956385180755,0.030134945481474756,0.002410795638519276,0.07552865110690239,0.006042292088552198,0,0.08157094319545459,0,0.08157094319545459,0,0.08157094319545459,0,0.08157094319545459,0,0.08157094319545459,0.07552865110690239,0.006042292088552198,0.049672157467004714,0.031898785728449876,0.028330422988640913,0.05324052020681368,0.01941081220749595,0.06216013098795864,0.014701932316527057,0.06686901087892753,0.01181573388241912,0.06975520931303547,0.07552865110690239,0.006042292088552198,0.07525436588046858,0.006316577314986013,0.0693495126496273,0.012221430545827291,0.05909486629309973,0.022476076902354862,0.049672157467004714,0.031898785728449876,0.04219794078514446,0.03937300241031013,0.07552865110690239,0.006042292088552198,0.07552854787738447,0.006042395318070118,0.07540387998188562,0.0061670632135689685,0.07420972456422022,0.007361218631234373,0.07130686022220178,0.010264082973252805,0.0671842398885973,0.01438670330685729,0.07552865110690239,0.006042292088552198,0.07552865110524837,0.006042292090206222,0.0755281512562514,0.006042791939203193,0.07549511505398468,0.006075828141469911,0.07525436588046858,0.006316577314986013,0.07456428874020292,0.007006654455251671,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865069369039,0.006042292501764204,0.07552835564940473,0.00604258754604986,0.07552075097002556,0.0060501922254290325,0.0754719239411514,0.006099019254303187,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110683185,0.006042292088622739,0.07552865019763486,0.006042292997819734,0.07552854787738447,0.006042395318070118,0.07552688561135841,0.00604405758409618,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110592472,0.006042292089529874,0.07552865049394215,0.006042292701512436,0.07552862188058411,0.00604232131487048,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690202,0.006042292088552573,0.07552865110524837,0.006042292090206222,0.0755286508494709,0.006042292345983691,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690037,0.006042292088554224,0.07552865110569587,0.006042292089758719,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110690239,0.006042292088552198,0.07552865110689938,0.0060422920885552095,0.14495595106022505,0.011596476084818008,0,0.15655242714504305,0,0.15655242714504305,0,0.15655242714504305,0,0.15655242714504305,0,0.15655242714504305,0.14495595106022505,0.011596476084818008,0.09533170156384417,0.061220725581198884,0.05437225937537772,0.10218016776966533,0.0372535812986585,0.11929884584638456,0.028216213981484408,0.12833621316355864,0.02267696982932168,0.13387545731572137,0.14495595106022505,0.011596476084818008,0.1444295379007578,0.012122889244285256,0.13309683695345575,0.0234555901915873,0.1134159344931061,0.04313649265193696,0.09533170156384417,0.061220725581198884,0.0809870499426233,0.07556537720241975,0.14495595106022505,0.011596476084818008,0.1449557529402702,0.011596674204772867,0.14471648806404283,0.011835939081000224,0.14242464342304156,0.014127783722001491,0.13685341375947296,0.01969901338557009,0.1289412063711532,0.02761122077388986,0.14495595106022505,0.011596476084818008,0.1449559510570506,0.011596476087992441,0.14495499173782964,0.011597435407213419,0.14489158806188934,0.011660839083153712,0.1444295379007578,0.012122889244285256,0.1431051293921172,0.013447297752925857,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.1449559502671811,0.011596476877861944,0.14495538401286032,0.011597043132182738,0.14494078897487458,0.01161163817016847,0.14484707925936705,0.01170534788567601,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106008966,0.0115964760849534,0.14495594931514239,0.01159647782990067,0.1449557529402702,0.011596674204772867,0.14495256268929665,0.0115998644557464,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.1449559510583487,0.011596476086694368,0.14495594988382068,0.011596477261222371,0.14495589496854724,0.01159653217649581,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022433,0.01159647608481873,0.1449559510570506,0.011596476087992441,0.14495595056615787,0.011596476578885184,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022116,0.011596476084821894,0.14495595105790948,0.011596476087133573,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106022505,0.011596476084818008,0.14495595106021927,0.011596476084823781,0.24035011510519608,0.01922800920841569,0,0.25957812431361177,0,0.25957812431361177,0,0.25957812431361177,0,0.25957812431361177,0,0.25957812431361177,0.24035011510519608,0.01922800920841569,0.15806860826655167,0.1015095160470601,0.09015413788684036,0.16942398642677142,0.06176981688384261,0.19780830742976915,0.046785042136455575,0.2127930821771562,0.03760047289434867,0.2219776514192631,0.24035011510519608,0.01922800920841569,0.2394772743384291,0.02010084997518266,0.2206866282337711,0.03889149607984066,0.1880539067958367,0.07152421751777507,0.15806860826655167,0.1015095160470601,0.1342838747451805,0.12529424956843127,0.24035011510519608,0.01922800920841569,0.24034978660434042,0.019228337709271348,0.23995306373700548,0.01962506057660629,0.23615297744017577,0.023425146873435998,0.2269153733189082,0.03266275099470356,0.21379621579133118,0.04578190852228059,0.24035011510519608,0.01922800920841569,0.2403501150999326,0.019228009213679176,0.24034852446164903,0.019229599851962736,0.24024339541590178,0.019334728897709985,0.2394772743384291,0.02010084997518266,0.23728128490046657,0.022296839413145197,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011379025728,0.01922801052335449,0.24034917488923124,0.019228949424380526,0.24032497499240618,0.019253149321205587,0.24016959578414343,0.01940852852946834,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.2403501151049716,0.01922800920864018,0.24035011221169073,0.019228012101921044,0.24034978660434042,0.019228337709271348,0.24034449687885423,0.01923362743475754,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510208487,0.019228009211526897,0.24035011315461094,0.01922801115900083,0.2403500221001065,0.019228102213505266,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.2403501151051949,0.019228009208416857,0.2403501150999326,0.019228009213679176,0.2403501142859879,0.019228010027623865,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.2403501151051896,0.01922800920842216,0.24035011510135665,0.01922800921225512,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.24035011510519608,0.01922800920841569,0.2403501151051865,0.019228009208425267,0.36331001362610493,0.02906480109008841,0,0.39237481471619334,0,0.39237481471619334,0,0.39237481471619334,0,0.39237481471619334,0,0.39237481471619334,0.36331001362610493,0.02906480109008841,0.23893439034986674,0.1534404243663266,0.13627578688606842,0.25609902783012495,0.09337042756950069,0.29900438714669264,0.07071964283709263,0.3216551718791007,0.05683637103154638,0.33553844368464697,0.36331001362610493,0.02906480109008841,0.36199063921794733,0.030384175498246013,0.33358695033542424,0.058787864380769106,0.2842597658442339,0.10811504887195944,0.23893439034986674,0.1534404243663266,0.20298170584226605,0.1893931088739273,0.36331001362610493,0.02906480109008841,0.363309517068613,0.029065297647580368,0.3627098360979001,0.02966497861829326,0.356965676567636,0.03540913814855734,0.34300223794934626,0.04937257676684709,0.32317149520965205,0.0692033195065413,0.36331001362610493,0.02906480109008841,0.3633100136181487,0.029064801098044657,0.3633076092306317,0.02906720548556163,0.3631486975736674,0.02922611714252593,0.36199063921794733,0.030384175498246013,0.3586712110068156,0.03370360370937775,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001163846105,0.029064803077732293,0.3633085924082501,0.029066222307943257,0.3632720121684553,0.02910280254773806,0.3630371430391168,0.029337671677076516,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.3633100136257656,0.02906480109042775,0.36331000925232104,0.0290648054638723,0.363309517068613,0.029065297647580368,0.36330152119044323,0.02907329352575011,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.3633100136214021,0.02906480109479126,0.3633100106776266,0.02906480403856676,0.36330987304085766,0.029064941675335687,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610316,0.029064801090090187,0.3633100136181487,0.029064801098044657,0.3633100123878008,0.029064802328392536,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362609516,0.02906480109009818,0.3633100136203013,0.029064801095892046,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362610493,0.02906480109008841,0.36331001362609044,0.0290648010901029,0.5152118418589741,0.04121694734871795,0,0.556428789207692,0,0.556428789207692,0,0.556428789207692,0,0.556428789207692,0,0.556428789207692,0.5152118418589741,0.04121694734871795,0.33883411609539155,0.21759467311230046,0.19325341039074367,0.36317537881694834,0.1324090945997142,0.42401969460797784,0.10028789759481951,0.4561408916128725,0.080599956801298,0.475828832406394,0.5152118418589741,0.04121694734871795,0.5133408300689494,0.04308795913874264,0.47306140942018554,0.08336737978750647,0.4031102695609413,0.1533185196467507,0.33883411609539155,0.21759467311230046,0.287849425032077,0.268579364175615,0.5152118418589741,0.04121694734871795,0.5152111376881822,0.041217651519509846,0.5143607269484255,0.042068062259266514,0.5062149040959764,0.05021388511171565,0.48641327832350995,0.07001551088418206,0.45829119770597976,0.09813759150171225,0.5152118418589741,0.04121694734871795,0.5152118418476913,0.0412169473600007,0.5152084321731029,0.04122035703458915,0.5149830787162568,0.041445710491435195,0.5133408300689494,0.04308795913874264,0.5086335314577531,0.04779525774993887,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118390402858,0.04121695016740623,0.5152098264224565,0.04121896278523551,0.5151579517919386,0.041270837415753436,0.5148248826438725,0.041603906563819515,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418584929,0.04121694734919912,0.5152118356564881,0.041216953551203916,0.5152111376881822,0.041217651519509846,0.5151997986912797,0.04122899051641227,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.515211841852305,0.04121694735538706,0.5152118376777214,0.041216951529970625,0.5152116424942952,0.041217146713396824,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589715,0.0412169473487205,0.5152118418476913,0.0412169473600007,0.5152118401029285,0.04121694910476348,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589602,0.041216947348731825,0.5152118418507439,0.04121694735694814,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589741,0.04121694734871795,0.5152118418589535,0.041216947348738486,0.6972711386085182,0.05578169108868147,0,0.7530528296971997,0,0.7530528296971997,0,0.7530528296971997,0,0.7530528296971997,0,0.7530528296971997,0.6972711386085182,0.05578169108868147,0.4585671965084886,0.29448563318871107,0.2615429509867854,0.49150987871041424,0.17919821062447028,0.5738546190727294,0.13572641555031498,0.6173264141468847,0.10908138960443721,0.6439714400927624,0.6972711386085182,0.05578169108868147,0.694738971419827,0.05831385827737268,0.6402260988179144,0.1128267308792853,0.54555647561859,0.20749635407860967,0.4585671965084886,0.29448563318871107,0.3895661551872143,0.36348667450998534,0.6972711386085182,0.05578169108868147,0.6972701856064131,0.05578264409078659,0.6961192670587036,0.05693356263849603,0.68509497236327,0.06795785733392967,0.6582960888227656,0.09475674087443409,0.620236569263832,0.1328162604333677,0.6972711386085182,0.05578169108868147,0.6972711385932485,0.05578169110395115,0.6972665240493087,0.055786305647891,0.6969615379277213,0.05609129176947836,0.694738971419827,0.05831385827737268,0.6883682648565692,0.06468456484063045,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711347937962,0.055781694903403456,0.6972684109815477,0.055784418715651984,0.6971982055247871,0.055854624172412604,0.69674744045062,0.056305389246579685,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386078669,0.05578169108933273,0.6972711302142731,0.05578169948292655,0.6972701856064131,0.05578264409078659,0.6972548397726445,0.0557979899245552,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711385994924,0.05578169109770725,0.6972711329497453,0.05578169674745437,0.6972708687947731,0.0557819609024266,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085148,0.055781691088684915,0.6972711385932485,0.05578169110395115,0.6972711362319426,0.055781693465257076,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386084994,0.055781691088700236,0.6972711385973798,0.0557816910998199,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386085182,0.05578169108868147,0.6972711386084904,0.05578169108870923,0.9105812147454422,0.07284649717963532,0,0.9834277119250775,0,0.9834277119250775,0,0.9834277119250775,0,0.9834277119250775,0,0.9834277119250775,0.9105812147454422,0.07284649717963532,0.5988526581960699,0.3845750537290076,0.3415545041673768,0.6418732077577007,0.23401875579745435,0.7494089561276231,0.17724801372316637,0.8061796982019112,0.1424517074524958,0.8409760044725817,0.9105812147454422,0.07284649717963532,0.9072744037404459,0.07615330818463162,0.8360848836175104,0.14734282830756706,0.7124538085319069,0.2709739033931706,0.5988526581960699,0.3845750537290076,0.5087427302985627,0.47468498162651485,0.9105812147454422,0.07284649717963532,0.9105799701997175,0.07284774172536002,0.9090769611818227,0.07435075074325481,0.894680100190971,0.0887476117341065,0.8596828680140705,0.12374484391100704,0.8099801316843235,0.17344758024075402,0.9105812147454422,0.07284649717963532,0.9105812147255011,0.07284649719957637,0.9105751884943931,0.07285252343068438,0.9101769006294606,0.07325081129561695,0.9072744037404459,0.07615330818463162,0.8989547624991138,0.08447294942596373,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812097637156,0.0728465021613619,0.9105776526793495,0.07285005924572796,0.9104859698797052,0.0729417420453723,0.9098973061790693,0.07353040574600822,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147445916,0.07284649718048586,0.9105812037832189,0.07284650814185856,0.9105799701997175,0.07284774172536002,0.9105599297489076,0.07286778217616985,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147336553,0.07284649719142222,0.9105812073555302,0.07284650456954733,0.910580862389932,0.07284684953514553,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454377,0.07284649717963976,0.9105812147255011,0.07284649719957637,0.9105812116418215,0.07284650028325601,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454178,0.07284649717965974,0.9105812147308963,0.07284649719418124,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454422,0.07284649717963532,0.9105812147454059,0.07284649717967162,1.1561387938771825,0.09249110351017453,0,1.248629897387357,0,1.248629897387357,0,1.248629897387357,0,1.248629897387357,0,1.248629897387357,1.1561387938771825,0.09249110351017453,0.7603460062049501,0.488283891182407,0.43366193602157954,0.8149679613657775,0.2971268874110738,0.9515030099762833,0.22504670806361327,1.0235831893237437,0.18086683820499724,1.06776305918236,1.1561387938771825,0.09249110351017453,1.1519402309977966,0.09668966638956045,1.0615529436270215,0.18707695376033562,0.9045821213427431,0.344047776044614,0.7603460062049501,0.488283891182407,0.6459360209463503,0.6026938764410068,1.1561387938771825,0.09249110351017453,1.15613721371325,0.09249268367410712,1.1542288863669397,0.09440101102041742,1.1359496058019063,0.11268029158545079,1.0915146260957274,0.15711527129162972,1.02840849047362,0.22022140691373715,1.1561387938771825,0.09249110351017453,1.156138793851864,0.09249110353549317,1.156131142519449,0.09249875486790815,1.1556254478660535,0.0930044495213036,1.1519402309977966,0.09668966638956045,1.1413770216601942,0.10725287572716291,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387875520275,0.0924911098353296,1.1561342712242557,0.09249562616310136,1.156017864208952,0.09261203317840505,1.1552704548292816,0.09335944255807549,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938761027,0.09249110351125434,1.1561387799587628,0.09249111742859428,1.15613721371325,0.09249268367410712,1.156111768928916,0.0925181284584411,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.156138793862217,0.09249110352514012,1.1561387844944238,0.09249111289293332,1.1561383465015196,0.09249155088583749,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.156138793877177,0.09249110351018008,1.156138793851864,0.09249110353549317,1.1561387899366047,0.0924911074507524,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771515,0.09249110351020562,1.156138793858714,0.09249110352864309,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771825,0.09249110351017453,1.1561387938771364,0.09249110351022072]],"a0":[{"key":["power-v1","12AX7","EL84","0","6.0","4",352800],"detector":{"real":224.76695368000605,"imaginary":11.186545879809728},"anchor":{"b0":0.09106584441917089,"b1":-0.09086281064275105,"a1":-1.9645482165974153,"a2":0.9647512503738352}},{"key":["power-v1","12AX7","EL84","0","6.0","8",352800],"detector":{"real":317.9226581136335,"imaginary":15.88385722728667},"anchor":{"b0":0.09076851415737153,"b1":-0.09059203687901606,"a1":-1.973210468449191,"a2":0.9733869457275464}},{"key":["power-v1","12AX7","EL84","0","6.0","15",352800],"detector":{"real":435.3839864476783,"imaginary":21.794375539615565},"anchor":{"b0":0.09062782581386082,"b1":-0.09056522241014116,"a1":-1.9772677850368465,"a2":0.9773303884405663}},{"key":["power-v1","12AX7","EL84","0","6.0","16",352800],"detector":{"real":449.6551099642532,"imaginary":22.502893785436118},"anchor":{"b0":0.08901079707598844,"b1":-0.08894860909840827,"a1":-1.9600640510010594,"a2":0.9601262389786396}},{"key":["power-v1","12AX7","EL84","0","6.0","4",384000],"detector":{"real":225.53890829771427,"imaginary":10.996662102346981},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AX7","EL84","0","6.0","8",384000],"detector":{"real":319.01471097185095,"imaginary":15.615353081176657},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AX7","EL84","0","6.0","15",384000],"detector":{"real":436.8796119677524,"imaginary":21.42668754726903},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AX7","EL84","0","6.0","16",384000],"detector":{"real":451.19974641489404,"imaginary":22.12315275190878},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AX7","EL84","0","6.6","4",352800],"detector":{"real":234.1822032952259,"imaginary":11.690940952400515},"anchor":{"b0":0.09123395907010444,"b1":-0.09113544051325231,"a1":-1.9732739978904328,"a2":0.9733725164472851}},{"key":["power-v1","12AX7","EL84","0","6.6","8",352800],"detector":{"real":331.24009183598,"imaginary":16.599856736425103},"anchor":{"b0":0.08803062152104829,"b1":-0.08794564728903569,"a1":-1.9664838720235824,"a2":0.9665688462555949}},{"key":["power-v1","12AX7","EL84","0","6.6","15",352800],"detector":{"real":453.6217405751061,"imaginary":22.776671092421594},"anchor":{"b0":0.0914736702575168,"b1":-0.09131200930708867,"a1":-1.9736786376927133,"a2":0.9738402986431416}},{"key":["power-v1","12AX7","EL84","0","6.6","16",352800],"detector":{"real":468.4906666338672,"imaginary":23.51714156846898},"anchor":{"b0":0.09002021969865129,"b1":-0.08988920063149629,"a1":-1.9760768435809488,"a2":0.9762078626481038}},{"key":["power-v1","12AX7","EL84","0","6.6","4",384000],"detector":{"real":234.98206550932073,"imaginary":11.4941015719721},"anchor":{"b0":0.0816353096475607,"b1":-0.08159494159891893,"a1":-1.9754685096334144,"a2":0.9755088776820561}},{"key":["power-v1","12AX7","EL84","0","6.6","8",384000],"detector":{"real":332.3716250876818,"imaginary":16.32151620431253},"anchor":{"b0":0.08254212859440731,"b1":-0.08234173371626302,"a1":-1.9663074125568647,"a2":0.9665078074350091}},{"key":["power-v1","12AX7","EL84","0","6.6","15",384000],"detector":{"real":455.1714369454662,"imaginary":22.395512406680464},"anchor":{"b0":0.08321758275967428,"b1":-0.08290184934900587,"a1":-1.961683432557481,"a2":0.9619991659681494}},{"key":["power-v1","12AX7","EL84","0","6.6","16",384000],"detector":{"real":470.0911458482731,"imaginary":23.12348845454606},"anchor":{"b0":0.08171831547524447,"b1":-0.08160954112627197,"a1":-1.9701817114059952,"a2":0.9702904857549677}},{"key":["power-v1","12AX7","EL84","0","8.0","4",352800],"detector":{"real":253.85760821915372,"imaginary":12.707026080934224},"anchor":{"b0":0.08932635874451385,"b1":-0.08914670788239311,"a1":-1.9710486726544416,"a2":0.9712283235165624}},{"key":["power-v1","12AX7","EL84","0","8.0","8",352800],"detector":{"real":359.0700494137902,"imaginary":18.04240307216442},"anchor":{"b0":0.08992831902000697,"b1":-0.08989426380504151,"a1":-1.9770702953184722,"a2":0.9771043505334377}},{"key":["power-v1","12AX7","EL84","0","8.0","15",352800],"detector":{"real":491.73388952144586,"imaginary":24.755863597242477},"anchor":{"b0":0.09496284871133766,"b1":-0.09489463732852434,"a1":-1.9761941907651819,"a2":0.9762624021479953}},{"key":["power-v1","12AX7","EL84","0","8.0","16",352800],"detector":{"real":507.8520659024325,"imaginary":25.560695216172025},"anchor":{"b0":0.0889793237253196,"b1":-0.08893209804989036,"a1":-1.971769916823554,"a2":0.9718171424989833}},{"key":["power-v1","12AX7","EL84","0","8.0","4",384000],"detector":{"real":254.71369326372192,"imaginary":12.495750110849235},"anchor":{"b0":0.08182535221243627,"b1":-0.08169140882863912,"a1":-1.9578920027018578,"a2":0.958025946085655}},{"key":["power-v1","12AX7","EL84","0","8.0","8",384000],"detector":{"real":360.2811204398516,"imaginary":17.743646207703193},"anchor":{"b0":0.08117728435092253,"b1":-0.08101996359023242,"a1":-1.9713183243981158,"a2":0.9714756451588059}},{"key":["power-v1","12AX7","EL84","0","8.0","15",384000],"detector":{"real":493.39251812218936,"imaginary":24.346745202174173},"anchor":{"b0":0.08240952825181315,"b1":-0.08213665195973965,"a1":-1.9639621234178486,"a2":0.9642349997099221}},{"key":["power-v1","12AX7","EL84","0","8.0","16",384000],"detector":{"real":509.56504685219215,"imaginary":25.13816612791057},"anchor":{"b0":0.08098391242427597,"b1":-0.08090202034512534,"a1":-1.9641136896352693,"a2":0.96419558171442}},{"key":["power-v1","12AX7","EL84","20","6.0","4",352800],"detector":{"real":166.9615013071403,"imaginary":6.627514031415738},"anchor":{"b0":0.09062886110336568,"b1":-0.09038044399020354,"a1":-1.9651297597323876,"a2":0.9653781768455497}},{"key":["power-v1","12AX7","EL84","20","6.0","8",352800],"detector":{"real":236.15992375189123,"imaginary":9.419604169049403},"anchor":{"b0":0.08831219700940648,"b1":-0.08807631577515501,"a1":-1.9676625016968785,"a2":0.9678983829311301}},{"key":["power-v1","12AX7","EL84","20","6.0","15",352800],"detector":{"real":323.4130883562306,"imaginary":12.93099271612598},"anchor":{"b0":0.08831504751251598,"b1":-0.08817568166723645,"a1":-1.9763702281173443,"a2":0.9765095939626237}},{"key":["power-v1","12AX7","EL84","20","6.0","16",352800],"detector":{"real":334.01395840834397,"imaginary":13.350494853781422},"anchor":{"b0":0.09300492267692528,"b1":-0.09294832723043356,"a1":-1.9751460042762403,"a2":0.975202599722732}},{"key":["power-v1","12AX7","EL84","20","6.0","4",384000],"detector":{"real":167.41216409519478,"imaginary":6.520851489352578},"anchor":{"b0":0.08476144383204906,"b1":-0.08465346255973628,"a1":-1.9743968283866171,"a2":0.9745048096589299}},{"key":["power-v1","12AX7","EL84","20","6.0","8",384000],"detector":{"real":236.7974713031283,"imaginary":9.268759170356244},"anchor":{"b0":0.08888412714459573,"b1":-0.08872755592374584,"a1":-1.9704760936446966,"a2":0.9706326648655463}},{"key":["power-v1","12AX7","EL84","20","6.0","15",384000],"detector":{"real":324.2862511606161,"imaginary":12.724407073665695},"anchor":{"b0":0.08202113520293912,"b1":-0.08189559981866683,"a1":-1.9775743789941453,"a2":0.9776999143784176}},{"key":["power-v1","12AX7","EL84","20","6.0","16",384000],"detector":{"real":334.915733537089,"imaginary":13.137140211881459},"anchor":{"b0":0.08114774834428222,"b1":-0.08112066295429304,"a1":-1.9743967503772795,"a2":0.9744238357672688}},{"key":["power-v1","12AX7","EL84","20","6.6","4",352800],"detector":{"real":170.4323019750051,"imaginary":6.7104911747843055},"anchor":{"b0":0.09240990367820504,"b1":-0.09202621667141125,"a1":-1.960003732063135,"a2":0.9603874190699289}},{"key":["power-v1","12AX7","EL84","20","6.6","8",352800],"detector":{"real":241.06923815333423,"imaginary":9.537912152873878},"anchor":{"b0":0.10172510230419676,"b1":-0.10167984620839832,"a1":-1.9695792890935515,"a2":0.9696245451893499}},{"key":["power-v1","12AX7","EL84","20","6.6","15",352800],"detector":{"real":330.13623978072394,"imaginary":13.093658853096853},"anchor":{"b0":0.08867373404889912,"b1":-0.08859858405119614,"a1":-1.963291018633963,"a2":0.9633661686316659}},{"key":["power-v1","12AX7","EL84","20","6.6","16",352800],"detector":{"real":340.9574806872131,"imaginary":13.518402434949431},"anchor":{"b0":0.09852118467616859,"b1":-0.09846697793788523,"a1":-1.9746149007839953,"a2":0.9746691075222786}},{"key":["power-v1","12AX7","EL84","20","6.6","4",384000],"detector":{"real":170.8833475985372,"imaginary":6.602524767581263},"anchor":{"b0":0.08239818383092243,"b1":-0.08208143411281797,"a1":-1.9601315706136524,"a2":0.9604483203317569}},{"key":["power-v1","12AX7","EL84","20","6.6","8",384000],"detector":{"real":241.70732888138176,"imaginary":9.385221069155111},"anchor":{"b0":0.08548843393057654,"b1":-0.08532080698864132,"a1":-1.9716106419624821,"a2":0.9717782689044173}},{"key":["power-v1","12AX7","EL84","20","6.6","15",384000],"detector":{"real":331.0101475756299,"imaginary":12.884543214389941},"anchor":{"b0":0.0856364260521629,"b1":-0.08556229509099565,"a1":-1.9776770877188317,"a2":0.977751218679999}},{"key":["power-v1","12AX7","EL84","20","6.6","16",384000],"detector":{"real":341.8600249868211,"imaginary":13.302435290518334},"anchor":{"b0":0.08800791131803534,"b1":-0.08794122608569174,"a1":-1.9748856096727867,"a2":0.9749522949051302}},{"key":["power-v1","12AX7","EL84","20","8.0","4",352800],"detector":{"real":176.61304054245903,"imaginary":6.812089704728311},"anchor":{"b0":0.09222606074942535,"b1":-0.09214675961280455,"a1":-1.966576112391608,"a2":0.9666554135282286}},{"key":["power-v1","12AX7","EL84","20","8.0","8",352800],"detector":{"real":249.81166817325683,"imaginary":9.683293199800397},"anchor":{"b0":0.09708640237574646,"b1":-0.09700972277230238,"a1":-1.9724165951880566,"a2":0.9724932747915005}},{"key":["power-v1","12AX7","EL84","20","8.0","15",352800],"detector":{"real":342.1087309713618,"imaginary":13.293905765986915},"anchor":{"b0":0.09059982992601454,"b1":-0.09031789085082598,"a1":-1.9626645006027543,"a2":0.9629464396779429}},{"key":["power-v1","12AX7","EL84","20","8.0","16",352800],"detector":{"real":353.32240370789145,"imaginary":13.725052201661743},"anchor":{"b0":0.08934457202174585,"b1":-0.08927511833948162,"a1":-1.9773606727218795,"a2":0.9774301264041436}},{"key":["power-v1","12AX7","EL84","20","8.0","4",384000],"detector":{"real":177.0605923845625,"imaginary":6.701453788815353},"anchor":{"b0":0.08247900723130916,"b1":-0.08243460516756343,"a1":-1.9790521695404655,"a2":0.9790965716042113}},{"key":["power-v1","12AX7","EL84","20","8.0","8",384000],"detector":{"real":250.4448204090789,"imaginary":9.526821526500378},"anchor":{"b0":0.08412104103513633,"b1":-0.08403645146256745,"a1":-1.9622447883704055,"a2":0.9623293779429742}},{"key":["power-v1","12AX7","EL84","20","8.0","15",384000],"detector":{"real":342.9758775183089,"imaginary":13.079608604899589},"anchor":{"b0":0.08526715557209867,"b1":-0.08493238414040091,"a1":-1.9595969314422914,"a2":0.9599317028739892}},{"key":["power-v1","12AX7","EL84","20","8.0","16",384000],"detector":{"real":354.21796494185185,"imaginary":13.503734239675376},"anchor":{"b0":0.08596771808336288,"b1":-0.08583724510830247,"a1":-1.969812592264889,"a2":0.9699430652399494}},{"key":["power-v1","12AX7","EL84","43","6.0","4",352800],"detector":{"real":133.81206109344464,"imaginary":4.5258847937317945},"anchor":{"b0":0.09116535380891776,"b1":-0.09096848027478778,"a1":-1.9695355287136929,"a2":0.9697324022478229}},{"key":["power-v1","12AX7","EL84","43","6.0","8",352800],"detector":{"real":189.27166685431368,"imaginary":6.437943011875877},"anchor":{"b0":0.10803016483780878,"b1":-0.1077926150187118,"a1":-1.9670555780394579,"a2":0.9672931278585549}},{"key":["power-v1","12AX7","EL84","43","6.0","15",352800],"detector":{"real":259.2013407749545,"imaginary":8.841515067624732},"anchor":{"b0":0.0895376876364845,"b1":-0.08947089792668274,"a1":-1.9768908896110455,"a2":0.9769576793208473}},{"key":["power-v1","12AX7","EL84","43","6.0","16",352800],"detector":{"real":267.6974506266574,"imaginary":9.127836591054134},"anchor":{"b0":0.0965056871402557,"b1":-0.0964400985529168,"a1":-1.9730818328280786,"a2":0.9731474214154177}},{"key":["power-v1","12AX7","EL84","43","6.0","4",384000],"detector":{"real":134.11626083010944,"imaginary":4.459419182430647},"anchor":{"b0":0.08120763728033754,"b1":-0.08097941695209404,"a1":-1.9640872493036121,"a2":0.9643154696318555}},{"key":["power-v1","12AX7","EL84","43","6.0","8",384000],"detector":{"real":189.70202178302506,"imaginary":6.343934471298237},"anchor":{"b0":0.08575918611001986,"b1":-0.08572295493389578,"a1":-1.9722204004833455,"a2":0.9722566316594695}},{"key":["power-v1","12AX7","EL84","43","6.0","15",384000],"detector":{"real":259.7907434067989,"imaginary":8.712756098978538},"anchor":{"b0":0.08138315026750588,"b1":-0.08125290945189656,"a1":-1.977165657880616,"a2":0.9772958986962252}},{"key":["power-v1","12AX7","EL84","43","6.0","16",384000],"detector":{"real":268.3061667040519,"imaginary":8.994860702229241},"anchor":{"b0":0.08410755757533557,"b1":-0.0840786994932251,"a1":-1.9779228823794113,"a2":0.9779517404615217}},{"key":["power-v1","12AX7","EL84","43","6.6","4",352800],"detector":{"real":134.58647278229583,"imaginary":4.4841313567759755},"anchor":{"b0":0.0892228870231092,"b1":-0.0891645132938036,"a1":-1.9771964095554484,"a2":0.9772547832847539}},{"key":["power-v1","12AX7","EL84","43","6.6","8",352800],"detector":{"real":190.36705879594726,"imaginary":6.379093677492253},"anchor":{"b0":0.0906294635664459,"b1":-0.09052893380020623,"a1":-1.9650976889031204,"a2":0.9651982186693602}},{"key":["power-v1","12AX7","EL84","43","6.6","15",352800],"detector":{"real":260.70145683273154,"imaginary":8.761066897506561},"anchor":{"b0":0.08917477684000845,"b1":-0.08902781375433452,"a1":-1.9757332002414132,"a2":0.9758801633270872}},{"key":["power-v1","12AX7","EL84","43","6.6","16",352800],"detector":{"real":269.24673582068516,"imaginary":9.044731427795556},"anchor":{"b0":0.09781292626280383,"b1":-0.09777518966212387,"a1":-1.972769029445152,"a2":0.972806766045832}},{"key":["power-v1","12AX7","EL84","43","6.6","4",384000],"detector":{"real":134.88395120135948,"imaginary":4.4187927550897275},"anchor":{"b0":0.08193851528138267,"b1":-0.08167560308370836,"a1":-1.9615323230144965,"a2":0.9617952352121708}},{"key":["power-v1","12AX7","EL84","43","6.6","8",384000],"detector":{"real":190.78790657014204,"imaginary":6.286677058764091},"anchor":{"b0":0.0830363218573152,"b1":-0.08299660348714125,"a1":-1.9769535664663007,"a2":0.9769932848364746}},{"key":["power-v1","12AX7","EL84","43","6.6","15",384000],"detector":{"real":261.27783959213565,"imaginary":8.634486362919946},"anchor":{"b0":0.08190295138294981,"b1":-0.08183552370420134,"a1":-1.9739944758834957,"a2":0.9740619035622442}},{"key":["power-v1","12AX7","EL84","43","6.6","16",384000],"detector":{"real":269.842005201045,"imaginary":8.914005568175469},"anchor":{"b0":0.08861859523855917,"b1":-0.08852727694878056,"a1":-1.9727763818253998,"a2":0.9728677001151783}},{"key":["power-v1","12AX7","EL84","43","8.0","4",352800],"detector":{"real":135.2325949965377,"imaginary":4.346162436299575},"anchor":{"b0":0.10452134217072252,"b1":-0.1044467896953359,"a1":-1.9679301055937675,"a2":0.9680046580691541}},{"key":["power-v1","12AX7","EL84","43","8.0","8",352800],"detector":{"real":191.28101543099032,"imaginary":6.1841159964751045},"anchor":{"b0":0.09810392360082835,"b1":-0.0978730040704156,"a1":-1.969102597657244,"a2":0.9693335171876568}},{"key":["power-v1","12AX7","EL84","43","8.0","15",352800],"detector":{"real":261.9531202549788,"imaginary":8.494170877684798},"anchor":{"b0":0.08888457486211689,"b1":-0.0887730101760064,"a1":-1.968564388623041,"a2":0.9686759533091516}},{"key":["power-v1","12AX7","EL84","43","8.0","16",352800],"detector":{"real":270.5394221470442,"imaginary":8.769070353959775},"anchor":{"b0":0.11046191640385211,"b1":-0.11031667564914997,"a1":-1.9660222395509321,"a2":0.9661674803056342}},{"key":["power-v1","12AX7","EL84","43","8.0","4",384000],"detector":{"real":135.5140776046742,"imaginary":4.286004634566405},"anchor":{"b0":0.08678634781343371,"b1":-0.0867149915971098,"a1":-1.9710295158577154,"a2":0.9711008720740392}},{"key":["power-v1","12AX7","EL84","43","8.0","8",384000],"detector":{"real":191.6792363972212,"imaginary":6.099022574883717},"anchor":{"b0":0.08686669442014322,"b1":-0.08681669863662474,"a1":-1.9724667782408687,"a2":0.9725167740243872}},{"key":["power-v1","12AX7","EL84","43","8.0","15",384000],"detector":{"real":262.49851539579,"imaginary":8.377615933804321},"anchor":{"b0":0.0853213018287839,"b1":-0.08524152021549183,"a1":-1.9779190674205176,"a2":0.9779988490338096}},{"key":["power-v1","12AX7","EL84","43","8.0","16",384000],"detector":{"real":271.1026883350686,"imaginary":8.648699174502344},"anchor":{"b0":0.08180508376808629,"b1":-0.08160216118276133,"a1":-1.9711164448521492,"a2":0.9713193674374743}},{"key":["power-v1","12AX7","EL34","0","6.0","4",352800],"detector":{"real":207.08687061181547,"imaginary":5.510593861790939},"anchor":{"b0":0.09022347588881122,"b1":-0.09012024737989871,"a1":-1.971602646406963,"a2":0.9717058749158755}},{"key":["power-v1","12AX7","EL34","0","6.0","8",352800],"detector":{"real":292.9162810300563,"imaginary":7.850618217542938},"anchor":{"b0":0.0906163670804294,"b1":-0.09053720084266213,"a1":-1.977281682088239,"a2":0.9773608483260063}},{"key":["power-v1","12AX7","EL34","0","6.0","15",352800],"detector":{"real":401.1395192522838,"imaginary":10.789787861643338},"anchor":{"b0":0.0913097397935134,"b1":-0.09116925147781403,"a1":-1.9711064036722328,"a2":0.9712468919879321}},{"key":["power-v1","12AX7","EL34","0","6.0","16",352800],"detector":{"real":414.2880442952466,"imaginary":11.1380623483091},"anchor":{"b0":0.09763305431116932,"b1":-0.09755292552308165,"a1":-1.9683838962964535,"a2":0.9684640250845412}},{"key":["power-v1","12AX7","EL34","0","6.0","4",384000],"detector":{"real":207.47533403503763,"imaginary":5.421598144491633},"anchor":{"b0":0.08732686847589864,"b1":-0.08728513962030986,"a1":-1.977685098814753,"a2":0.9777268276703416}},{"key":["power-v1","12AX7","EL34","0","6.0","8",384000],"detector":{"real":293.46586000987514,"imaginary":7.724721490934366},"anchor":{"b0":0.09652857595188945,"b1":-0.0963731219380784,"a1":-1.975063733522012,"a2":0.9752191875358229}},{"key":["power-v1","12AX7","EL34","0","6.0","15",384000],"detector":{"real":401.89221649665654,"imaginary":10.617333987551598},"anchor":{"b0":0.0834299685779945,"b1":-0.08331796926908484,"a1":-1.9696795301793668,"a2":0.9697915294882766}},{"key":["power-v1","12AX7","EL34","0","6.0","16",384000],"detector":{"real":415.0654048103095,"imaginary":10.959963441718628},"anchor":{"b0":0.10167131431604222,"b1":-0.10149220471993621,"a1":-1.970562354059759,"a2":0.9707414636558649}},{"key":["power-v1","12AX7","EL34","0","6.6","4",352800],"detector":{"real":213.9248019790405,"imaginary":5.757491571731748},"anchor":{"b0":0.0894778870152966,"b1":-0.08939466228363965,"a1":-1.9721695117627942,"a2":0.9722527364944511}},{"key":["power-v1","12AX7","EL34","0","6.6","8",352800],"detector":{"real":302.58825009772556,"imaginary":8.201698161710334},"anchor":{"b0":0.10248204582149681,"b1":-0.10243069941718198,"a1":-1.9660309042657476,"a2":0.9660822506700623}},{"key":["power-v1","12AX7","EL34","0","6.6","15",352800],"detector":{"real":414.38496084118094,"imaginary":11.271855995740658},"anchor":{"b0":0.0958411591378572,"b1":-0.09568466603632186,"a1":-1.9729817754746042,"a2":0.9731382685761395}},{"key":["power-v1","12AX7","EL34","0","6.6","16",352800],"detector":{"real":427.9676459561697,"imaginary":11.63575359555542},"anchor":{"b0":0.09836031586785973,"b1":-0.09822873954440046,"a1":-1.9742993558144866,"a2":0.9744309321379458}},{"key":["power-v1","12AX7","EL34","0","6.6","4",384000],"detector":{"real":214.322464631521,"imaginary":5.666152738125362},"anchor":{"b0":0.08726311529428168,"b1":-0.08721883399342645,"a1":-1.9778311773768391,"a2":0.9778754586776942}},{"key":["power-v1","12AX7","EL34","0","6.6","8",384000],"detector":{"real":303.1508446264796,"imaginary":8.07248570848482},"anchor":{"b0":0.08189691958819544,"b1":-0.0817713284300099,"a1":-1.9775476244329762,"a2":0.9776732155911617}},{"key":["power-v1","12AX7","EL34","0","6.6","15",384000],"detector":{"real":415.15548444133714,"imaginary":11.094859491394242},"anchor":{"b0":0.09058334167266552,"b1":-0.09042769947683701,"a1":-1.9748152036992828,"a2":0.9749708458951114}},{"key":["power-v1","12AX7","EL34","0","6.6","16",384000],"detector":{"real":428.76341672961587,"imaginary":11.452963458065174},"anchor":{"b0":0.08802958903836897,"b1":-0.08782832847160144,"a1":-1.9687471678155226,"a2":0.9689484283822901}},{"key":["power-v1","12AX7","EL34","0","8.0","4",352800],"detector":{"real":227.5099619378965,"imaginary":6.2183079397546015},"anchor":{"b0":0.08906712574877376,"b1":-0.08901513848551111,"a1":-1.9769846201087833,"a2":0.9770366073720459}},{"key":["power-v1","12AX7","EL34","0","8.0","8",352800],"detector":{"real":321.80390062099235,"imaginary":8.857185657156142},"anchor":{"b0":0.09320992467403023,"b1":-0.09313934739340984,"a1":-1.972913524187166,"a2":0.9729841014677865}},{"key":["power-v1","12AX7","EL34","0","8.0","15",352800],"detector":{"real":440.7001638464483,"imaginary":12.172059165391437},"anchor":{"b0":0.11358584942551288,"b1":-0.1135162260585117,"a1":-1.971526906006298,"a2":0.9715965293732993}},{"key":["power-v1","12AX7","EL34","0","8.0","16",352800],"detector":{"real":455.14540946426564,"imaginary":12.565109671698078},"anchor":{"b0":0.09884905188474136,"b1":-0.09875968712964392,"a1":-1.9728343196896407,"a2":0.9729236844447381}},{"key":["power-v1","12AX7","EL34","0","8.0","4",384000],"detector":{"real":227.92428738019655,"imaginary":6.12265980877549},"anchor":{"b0":0.0891379489526823,"b1":-0.08906972358248061,"a1":-1.9761598316304763,"a2":0.9762280570006779}},{"key":["power-v1","12AX7","EL34","0","8.0","8",384000],"detector":{"real":322.3900711089806,"imaginary":8.721874637495063},"anchor":{"b0":0.0854159159686499,"b1":-0.08531814855653133,"a1":-1.9771834926756922,"a2":0.9772812600878107}},{"key":["power-v1","12AX7","EL34","0","8.0","15",384000],"detector":{"real":441.5029781358434,"imaginary":11.986706325831978},"anchor":{"b0":0.0870759594108087,"b1":-0.08698210091908393,"a1":-1.9737823394567122,"a2":0.973876197948437}},{"key":["power-v1","12AX7","EL34","0","8.0","16",384000],"detector":{"real":455.9745288887695,"imaginary":12.373690057028606},"anchor":{"b0":0.0889029620287372,"b1":-0.08869679138798614,"a1":-1.9674436238619957,"a2":0.9676497945027468}},{"key":["power-v1","12AX7","EL34","20","6.0","4",352800],"detector":{"real":135.5422658323451,"imaginary":2.9748318601685497},"anchor":{"b0":0.10688635020409079,"b1":-0.10669044588786225,"a1":-1.971775013588827,"a2":0.9719709179050556}},{"key":["power-v1","12AX7","EL34","20","6.0","8",352800],"detector":{"real":191.7194061953471,"imaginary":4.244496495074697},"anchor":{"b0":0.09304139235452485,"b1":-0.09286209923591027,"a1":-1.9731840759380228,"a2":0.9733633690566373}},{"key":["power-v1","12AX7","EL34","20","6.0","15",352800],"detector":{"real":262.5537393912486,"imaginary":5.837974649288313},"anchor":{"b0":0.0920243113231295,"b1":-0.0918623721579221,"a1":-1.9729061717256617,"a2":0.9730681108908691}},{"key":["power-v1","12AX7","EL34","20","6.0","16",352800],"detector":{"real":271.1596923830587,"imaginary":6.025802426138528},"anchor":{"b0":0.09652091606536424,"b1":-0.09638879428787066,"a1":-1.9746211496138029,"a2":0.9747532713912964}},{"key":["power-v1","12AX7","EL34","20","6.0","4",384000],"detector":{"real":135.74267140370935,"imaginary":2.9297922142233706},"anchor":{"b0":0.09076713211023404,"b1":-0.09062387983586605,"a1":-1.9758156788338526,"a2":0.9759589311082204}},{"key":["power-v1","12AX7","EL34","20","6.0","8",384000],"detector":{"real":192.00294144180418,"imaginary":4.180764563873046},"anchor":{"b0":0.08569707937557547,"b1":-0.08564616785013127,"a1":-1.972783579868472,"a2":0.9728344913939162}},{"key":["power-v1","12AX7","EL34","20","6.0","15",384000],"detector":{"real":262.9420722724584,"imaginary":5.750658146307423},"anchor":{"b0":0.08917935165287158,"b1":-0.08904564440271563,"a1":-1.9768717897529027,"a2":0.9770054970030586}},{"key":["power-v1","12AX7","EL34","20","6.0","16",384000],"detector":{"real":271.5607487827745,"imaginary":5.935630198173562},"anchor":{"b0":0.09195027400060528,"b1":-0.09177004231524172,"a1":-1.971983175418642,"a2":0.9721634071040056}},{"key":["power-v1","12AX7","EL34","20","6.6","4",352800],"detector":{"real":136.56158042914836,"imaginary":3.0195709613458273},"anchor":{"b0":0.09589555003836614,"b1":-0.09577738896247708,"a1":-1.9714438563979004,"a2":0.9715620174737893}},{"key":["power-v1","12AX7","EL34","20","6.6","8",352800],"detector":{"real":193.16118207397184,"imaginary":4.308054474996925},"anchor":{"b0":0.08960673498294908,"b1":-0.08948068101835789,"a1":-1.9762245870592974,"a2":0.9763506410238886}},{"key":["power-v1","12AX7","EL34","20","6.6","15",352800],"detector":{"real":264.52820238770806,"imaginary":5.92520539840645},"anchor":{"b0":0.08846585584471645,"b1":-0.08842148762240176,"a1":-1.9776820218652373,"a2":0.9777263900875519}},{"key":["power-v1","12AX7","EL34","20","6.6","16",352800],"detector":{"real":273.1988746157156,"imaginary":6.115865811651287},"anchor":{"b0":0.10390517953737105,"b1":-0.10371845633923095,"a1":-1.970417506720703,"a2":0.9706042299188432}},{"key":["power-v1","12AX7","EL34","20","6.6","4",384000],"detector":{"real":136.7596112501256,"imaginary":2.972885140270714},"anchor":{"b0":0.10178234127351535,"b1":-0.10163220622976318,"a1":-1.9696183895663755,"a2":0.9697685246101276}},{"key":["power-v1","12AX7","EL34","20","6.6","8",384000],"detector":{"real":193.44135920590176,"imaginary":4.2419928310797435},"anchor":{"b0":0.1043206754924586,"b1":-0.10422566159762561,"a1":-1.9718001947244561,"a2":0.971895208619289}},{"key":["power-v1","12AX7","EL34","20","6.6","15",384000],"detector":{"real":264.9119368280742,"imaginary":5.834697449027535},"anchor":{"b0":0.09245075222874775,"b1":-0.09239601763591933,"a1":-1.9766817811217767,"a2":0.9767365157146052}},{"key":["power-v1","12AX7","EL34","20","6.6","16",384000],"detector":{"real":273.5951817767674,"imaginary":6.022397684235293},"anchor":{"b0":0.08399956741898919,"b1":-0.08394861546479936,"a1":-1.9778597394585002,"a2":0.9779106914126899}},{"key":["power-v1","12AX7","EL34","20","8.0","4",352800],"detector":{"real":137.6996779087609,"imaginary":3.0751032266378306},"anchor":{"b0":0.7601598450005749,"b1":-0.42993124661573345,"a1":-0.8506896008739129,"a2":0.1809181992587543}},{"key":["power-v1","12AX7","EL34","20","8.0","8",352800],"detector":{"real":194.7709697039247,"imaginary":4.386910942643022},"anchor":{"b0":0.7601598450005749,"b1":-0.42993124661573345,"a1":-0.8506896008739129,"a2":0.1809181992587543}},{"key":["power-v1","12AX7","EL34","20","8.0","15",352800],"detector":{"real":266.73275055613533,"imaginary":6.033409293352416},"anchor":{"b0":0.7601598450005749,"b1":-0.42993124661573345,"a1":-0.8506896008739129,"a2":0.1809181992587543}},{"key":["power-v1","12AX7","EL34","20","8.0","16",352800],"detector":{"real":275.4756840667774,"imaginary":6.227586752296282},"anchor":{"b0":0.7601598450005749,"b1":-0.42993124661573345,"a1":-0.8506896008739129,"a2":0.1809181992587543}},{"key":["power-v1","12AX7","EL34","20","8.0","4",384000],"detector":{"real":137.89132196838264,"imaginary":3.025370597833728},"anchor":{"b0":1.3541803194871547,"b1":-1.1880302066855217,"a1":-1.184769694376778,"a2":0.35091980717841104}},{"key":["power-v1","12AX7","EL34","20","8.0","8",384000],"detector":{"real":195.042114142118,"imaginary":4.316537598794559},"anchor":{"b0":1.3541803194871547,"b1":-1.1880302066855217,"a1":-1.184769694376778,"a2":0.35091980717841104}},{"key":["power-v1","12AX7","EL34","20","8.0","15",384000],"detector":{"real":267.1041159200829,"imaginary":5.936994651884919},"anchor":{"b0":1.3541803194871547,"b1":-1.1880302066855217,"a1":-1.184769694376778,"a2":0.35091980717841104}},{"key":["power-v1","12AX7","EL34","20","8.0","16",384000],"detector":{"real":275.85921655202856,"imaginary":6.128018629754451},"anchor":{"b0":1.3541803194871547,"b1":-1.1880302066855217,"a1":-1.184769694376778,"a2":0.35091980717841104}},{"key":["power-v1","12AX7","EL34","43","6.0","4",352800],"detector":{"real":100.37458254577234,"imaginary":1.9259857779973577},"anchor":{"b0":1.0230297703833793,"b1":-0.6672042992009216,"a1":-0.7464982538266305,"a2":0.10232372500908815}},{"key":["power-v1","12AX7","EL34","43","6.0","8",352800],"detector":{"real":141.97612379732675,"imaginary":2.7514171732563235},"anchor":{"b0":1.0230297703833793,"b1":-0.6672042992009216,"a1":-0.7464982538266305,"a2":0.10232372500908815}},{"key":["power-v1","12AX7","EL34","43","6.0","15",352800],"detector":{"real":194.43191941324628,"imaginary":3.78669176161852},"anchor":{"b0":1.0230297703833793,"b1":-0.6672042992009216,"a1":-0.7464982538266305,"a2":0.10232372500908815}},{"key":["power-v1","12AX7","EL34","43","6.0","16",352800],"detector":{"real":200.80497684960196,"imaginary":3.908198503469682},"anchor":{"b0":1.0230297703833793,"b1":-0.6672042992009216,"a1":-0.7464982538266305,"a2":0.10232372500908815}},{"key":["power-v1","12AX7","EL34","43","6.0","4",384000],"detector":{"real":100.50315521433421,"imaginary":1.911452222895722},"anchor":{"b0":1.5331600380084363,"b1":-1.1800202530719144,"a1":-0.8068579349444072,"a2":0.15999771988092912}},{"key":["power-v1","12AX7","EL34","43","6.0","8",384000],"detector":{"real":142.15803089683737,"imaginary":2.7308362181693324},"anchor":{"b0":1.5331600380084363,"b1":-1.1800202530719144,"a1":-0.8068579349444072,"a2":0.15999771988092912}},{"key":["power-v1","12AX7","EL34","43","6.0","15",384000],"detector":{"real":194.68106135873498,"imaginary":3.7584750991813287},"anchor":{"b0":1.5331600380084363,"b1":-1.1800202530719144,"a1":-0.8068579349444072,"a2":0.15999771988092912}},{"key":["power-v1","12AX7","EL34","43","6.0","16",384000],"detector":{"real":201.06228174862207,"imaginary":3.879062189994278},"anchor":{"b0":1.5331600380084363,"b1":-1.1800202530719144,"a1":-0.8068579349444072,"a2":0.15999771988092912}},{"key":["power-v1","12AX7","EL34","43","6.6","4",352800],"detector":{"real":99.62206056704726,"imaginary":1.8834140715383485},"anchor":{"b0":0.8190818007412457,"b1":-0.5341925667001787,"a1":-0.833102836027328,"a2":0.11799207006839511}},{"key":["power-v1","12AX7","EL34","43","6.6","8",352800],"detector":{"real":140.91171707818896,"imaginary":2.6909971764662495},"anchor":{"b0":0.9054759382742175,"b1":-0.64380775424855,"a1":-0.9639514814073181,"a2":0.22561966543298567}},{"key":["power-v1","12AX7","EL34","43","6.6","15",352800],"detector":{"real":192.97425243209906,"imaginary":3.7038079642502666},"anchor":{"b0":0.8049385598717416,"b1":-0.34237643111265703,"a1":-0.6397615962500036,"a2":0.10232372500908817}},{"key":["power-v1","12AX7","EL34","43","6.6","16",352800],"detector":{"real":199.29952999765993,"imaginary":3.822617547393496},"anchor":{"b0":0.8049385598717416,"b1":-0.34237643111265703,"a1":-0.6397615962500036,"a2":0.10232372500908817}},{"key":["power-v1","12AX7","EL34","43","6.6","4",384000],"detector":{"real":99.7467616380906,"imaginary":1.8787744620717872},"anchor":{"b0":1.2208725083746101,"b1":-0.8898364179031846,"a1":-0.8455137556996483,"a2":0.17654984617107378}},{"key":["power-v1","12AX7","EL34","43","6.6","8",384000],"detector":{"real":141.08814493378145,"imaginary":2.6844102371536542},"anchor":{"b0":1.3541803194871547,"b1":-1.1880302066855217,"a1":-1.184769694376778,"a2":0.35091980717841104}},{"key":["power-v1","12AX7","EL34","43","6.6","15",384000],"detector":{"real":193.21588875518938,"imaginary":3.694755449063008},"anchor":{"b0":1.3541803194871547,"b1":-1.1880302066855217,"a1":-1.184769694376778,"a2":0.35091980717841104}},{"key":["power-v1","12AX7","EL34","43","6.6","16",384000],"detector":{"real":199.549083571045,"imaginary":3.813273608308008},"anchor":{"b0":1.3541803194871547,"b1":-1.1880302066855217,"a1":-1.184769694376778,"a2":0.35091980717841104}},{"key":["power-v1","12AX7","EL34","43","8.0","4",352800],"detector":{"real":97.47538832555068,"imaginary":1.60625500269966},"anchor":{"b0":0.9694043680698614,"b1":-0.41233110747938906,"a1":-0.5007989973837561,"a2":0.05787225797422844}},{"key":["power-v1","12AX7","EL34","43","8.0","8",352800],"detector":{"real":137.87539273989364,"imaginary":2.2983833210151743},"anchor":{"b0":0.9786174669258455,"b1":-0.5280323682006036,"a1":-0.6299606866671384,"a2":0.0805457853923804}},{"key":["power-v1","12AX7","EL34","43","8.0","15",352800],"detector":{"real":188.81614378840837,"imaginary":3.165734476443313},"anchor":{"b0":0.8976762749909118,"b1":-0.09185358030935267,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","EL34","43","8.0","16",352800],"detector":{"real":195.00512136016783,"imaginary":3.2669630772723464},"anchor":{"b0":0.8976762749909118,"b1":-0.09185358030935267,"a1":-0.20464745001817633,"a2":0.010470144699735494}},{"key":["power-v1","12AX7","EL34","43","8.0","4",384000],"detector":{"real":97.59173527508737,"imaginary":1.6751012454642713},"anchor":{"b0":1.0100607434147812,"b1":-0.36965901065582685,"a1":-0.39937221789698824,"a2":0.03977395065594256}},{"key":["power-v1","12AX7","EL34","43","8.0","8",384000],"detector":{"real":138.0399829011802,"imaginary":2.3957387641874512},"anchor":{"b0":1.0572779685758549,"b1":-0.6263154478504581,"a1":-0.6638177041167581,"a2":0.09478022484215486}},{"key":["power-v1","12AX7","EL34","43","8.0","15",384000],"detector":{"real":189.041554676225,"imaginary":3.299027641628987},"anchor":{"b0":1.0572779685758549,"b1":-0.6263154478504581,"a1":-0.6638177041167581,"a2":0.09478022484215486}},{"key":["power-v1","12AX7","EL34","43","8.0","16",384000],"detector":{"real":195.2379197291082,"imaginary":3.4046307260926105},"anchor":{"b0":1.0572984856482297,"b1":-0.5889637903706544,"a1":-0.6279103944211185,"a2":0.09624508969869379}},{"key":["power-v1","12AT7","EL84","0","6.0","4",352800],"detector":{"real":165.87433284385776,"imaginary":12.403835844144226},"anchor":{"b0":0.09006768954362983,"b1":-0.0899869364890218,"a1":-1.9666487674439175,"a2":0.9667295204985256}},{"key":["power-v1","12AT7","EL84","0","6.0","8",352800],"detector":{"real":234.6205950006915,"imaginary":17.589732859373374},"anchor":{"b0":0.08935099602100599,"b1":-0.0892789178557256,"a1":-1.9628587945473421,"a2":0.9629308727126226}},{"key":["power-v1","12AT7","EL84","0","6.0","15",352800],"detector":{"real":321.3039448220013,"imaginary":24.119549739098495},"anchor":{"b0":0.08875161751070502,"b1":-0.08810086374650189,"a1":-1.941797108030158,"a2":0.942447861794361}},{"key":["power-v1","12AT7","EL84","0","6.0","16",352800],"detector":{"real":331.83583260948626,"imaginary":24.905813956260697},"anchor":{"b0":0.09093958518937431,"b1":-0.09075545420176034,"a1":-1.969622680473781,"a2":0.9698068114613951}},{"key":["power-v1","12AT7","EL84","0","6.0","4",384000],"detector":{"real":166.5017793281691,"imaginary":12.281111924943545},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.0","8",384000],"detector":{"real":235.50820482660336,"imaginary":17.416220164995867},"anchor":{"b0":0.033526279142781425,"b1":-0.002097155725996535,"a1":-1.6365075957935935,"a2":0.6679367192103786}},{"key":["power-v1","12AT7","EL84","0","6.0","15",384000],"detector":{"real":322.51956687864464,"imaginary":23.881956083168316},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.0","16",384000],"detector":{"real":333.09129102331127,"imaginary":24.660430178233646},"anchor":{"b0":0.03621293631458846,"b1":-0.0029664162582577524,"a1":-1.5874863658436258,"a2":0.6207328858999566}},{"key":["power-v1","12AT7","EL84","0","6.6","4",352800],"detector":{"real":172.82118171459456,"imaginary":12.950125257591573},"anchor":{"b0":0.08861915111621385,"b1":-0.08849105762174776,"a1":-1.9690085988300554,"a2":0.9691366923245214}},{"key":["power-v1","12AT7","EL84","0","6.6","8",352800],"detector":{"real":244.4465432189637,"imaginary":18.36432219995102},"anchor":{"b0":0.08921195600533176,"b1":-0.08890056484002673,"a1":-1.954450409594325,"a2":0.9547618007596299}},{"key":["power-v1","12AT7","EL84","0","6.6","15",352800],"detector":{"real":334.76020059985734,"imaginary":25.181622368228773},"anchor":{"b0":0.08924727304496023,"b1":-0.08919672439358142,"a1":-1.9643146667238898,"a2":0.9643652153752686}},{"key":["power-v1","12AT7","EL84","0","6.6","16",352800],"detector":{"real":345.7331660691698,"imaginary":26.002518017404878},"anchor":{"b0":0.08863999088612358,"b1":-0.08847533351632196,"a1":-1.9727106583386091,"a2":0.9728753157084108}},{"key":["power-v1","12AT7","EL84","0","6.6","4",384000],"detector":{"real":173.47165122831566,"imaginary":12.823002751895713},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.6","8",384000],"detector":{"real":245.36672269241237,"imaginary":18.184590297915253},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.6","15",384000],"detector":{"real":336.0204285422247,"imaginary":24.93551221643797},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","6.6","16",384000],"detector":{"real":347.03469207986706,"imaginary":25.748338536773307},"anchor":{"b0":0.03334042004560261,"b1":-0.003411853236667646,"a1":-1.6490307749315232,"a2":0.6789593417404582}},{"key":["power-v1","12AT7","EL84","0","8.0","4",352800],"detector":{"real":187.33861281735415,"imaginary":14.06378501410127},"anchor":{"b0":0.08833914623457272,"b1":-0.08828459562468455,"a1":-1.961956818374167,"a2":0.962011368984055}},{"key":["power-v1","12AT7","EL84","0","8.0","8",352800],"detector":{"real":264.98068499511174,"imaginary":19.943488322211866},"anchor":{"b0":0.08962174621876576,"b1":-0.08957919531553513,"a1":-1.9700267946084773,"a2":0.970069345511708}},{"key":["power-v1","12AT7","EL84","0","8.0","15",352800],"detector":{"real":362.8809184340193,"imaginary":27.346950896817734},"anchor":{"b0":0.09048969586978148,"b1":-0.0903155225856748,"a1":-1.9723115637927329,"a2":0.9724857370768396}},{"key":["power-v1","12AT7","EL84","0","8.0","16",352800],"detector":{"real":374.7756418868556,"imaginary":28.238443007542962},"anchor":{"b0":0.0896196953638189,"b1":-0.08958452686477007,"a1":-1.9707953928216675,"a2":0.9708305613207164}},{"key":["power-v1","12AT7","EL84","0","8.0","4",384000],"detector":{"real":188.03565225549062,"imaginary":13.927534556897722},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","0","8.0","8",384000],"detector":{"real":265.96674507404526,"imaginary":19.750849702813685},"anchor":{"b0":0.03411018829809996,"b1":-0.0020865219911296784,"a1":-1.6394122534867437,"a2":0.671435919793714}},{"key":["power-v1","12AT7","EL84","0","8.0","15",384000],"detector":{"real":364.2313733150703,"imaginary":27.083166038108768},"anchor":{"b0":0.03300268419609719,"b1":-0.002907693772218918,"a1":-1.649978180674176,"a2":0.6800731710980543}},{"key":["power-v1","12AT7","EL84","0","8.0","16",384000],"detector":{"real":376.1703515172413,"imaginary":27.966009523972},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AT7","EL84","20","6.0","4",352800],"detector":{"real":123.22444224983593,"imaginary":7.977822132547856},"anchor":{"b0":0.09174406204475492,"b1":-0.09156626884681465,"a1":-1.9732877026902007,"a2":0.9734654958881411}},{"key":["power-v1","12AT7","EL84","20","6.0","8",352800],"detector":{"real":174.29488330118915,"imaginary":11.317732138719672},"anchor":{"b0":0.09516015102023573,"b1":-0.0950194169213795,"a1":-1.9719405771136405,"a2":0.9720813112124967}},{"key":["power-v1","12AT7","EL84","20","6.0","15",352800],"detector":{"real":238.69041690148455,"imaginary":15.522275235103898},"anchor":{"b0":0.0930141396852882,"b1":-0.0924434358487812,"a1":-1.9520604743614016,"a2":0.9526311781979085}},{"key":["power-v1","12AT7","EL84","20","6.0","16",352800],"detector":{"real":246.51431813900723,"imaginary":16.027851387005544},"anchor":{"b0":0.09503310660808832,"b1":-0.09493990861035459,"a1":-1.970020421108066,"a2":0.9701136191057997}},{"key":["power-v1","12AT7","EL84","20","6.0","4",384000],"detector":{"real":123.599910093332,"imaginary":7.9115743134492185},"anchor":{"b0":0.08065708767153582,"b1":-0.07991221340458365,"a1":-1.9398180729021854,"a2":0.9405629471691377}},{"key":["power-v1","12AT7","EL84","20","6.0","8",384000],"detector":{"real":174.82604244674565,"imaginary":11.224058527723876},"anchor":{"b0":0.08570568917359007,"b1":-0.08553958546752376,"a1":-1.97012953902668,"a2":0.9702956427327463}},{"key":["power-v1","12AT7","EL84","20","6.0","15",384000],"detector":{"real":239.41786767062254,"imaginary":15.393994745635556},"anchor":{"b0":0.08225231024998471,"b1":-0.08175729695880268,"a1":-1.9551887702552981,"a2":0.9556837835464802}},{"key":["power-v1","12AT7","EL84","20","6.0","16",384000],"detector":{"real":247.26560725157816,"imaginary":15.895366782858718},"anchor":{"b0":0.08146274488021853,"b1":-0.08128105484568253,"a1":-1.9694294616261658,"a2":0.9696111516607019}},{"key":["power-v1","12AT7","EL84","20","6.6","4",352800],"detector":{"real":125.78546495917695,"imaginary":8.103709349795341},"anchor":{"b0":0.08926660539237426,"b1":-0.08911989072071659,"a1":-1.9757736903219643,"a2":0.9759204049936221}},{"key":["power-v1","12AT7","EL84","20","6.6","8",352800],"detector":{"real":177.91733421995806,"imaginary":11.496488912797917},"anchor":{"b0":0.09331821301341069,"b1":-0.09328450050341648,"a1":-1.9692679569480476,"a2":0.9693016694580417}},{"key":["power-v1","12AT7","EL84","20","6.6","15",352800],"detector":{"real":243.65123729628058,"imaginary":15.76755473906709},"anchor":{"b0":0.08791680185401202,"b1":-0.0876964666827925,"a1":-1.956041746712456,"a2":0.9562620818836756}},{"key":["power-v1","12AT7","EL84","20","6.6","16",352800],"detector":{"real":251.637745508766,"imaginary":16.28110389711363},"anchor":{"b0":0.08972359969326527,"b1":-0.08963083433458997,"a1":-1.9713316340318348,"a2":0.9714243993905102}},{"key":["power-v1","12AT7","EL84","20","6.6","4",384000],"detector":{"real":126.16214377504552,"imaginary":8.036737101737037},"anchor":{"b0":0.08659507864944399,"b1":-0.08647527480004343,"a1":-1.97120675820068,"a2":0.9713265620500806}},{"key":["power-v1","12AT7","EL84","20","6.6","8",384000],"detector":{"real":178.45020743084635,"imaginary":11.401789427874453},"anchor":{"b0":0.08429742226603042,"b1":-0.08425448896663446,"a1":-1.9579036704168864,"a2":0.9579466037162825}},{"key":["power-v1","12AT7","EL84","20","6.6","15",384000],"detector":{"real":244.38103620612804,"imaginary":15.63786824205788},"anchor":{"b0":0.08163738258127985,"b1":-0.08158656520390961,"a1":-1.9622854064933049,"a2":0.9623362238706751}},{"key":["power-v1","12AT7","EL84","20","6.6","16",384000],"detector":{"real":252.39145959461268,"imaginary":16.147167396977334},"anchor":{"b0":0.08352530252908208,"b1":-0.08333581823504865,"a1":-1.9595019049298292,"a2":0.9596913892238625}},{"key":["power-v1","12AT7","EL84","20","8.0","4",352800],"detector":{"real":130.34620957009696,"imaginary":8.294026133857},"anchor":{"b0":0.0879548587395308,"b1":-0.08786300409750358,"a1":-1.9688887330350302,"a2":0.9689805876770574}},{"key":["power-v1","12AT7","EL84","20","8.0","8",352800],"detector":{"real":184.36831042688408,"imaginary":11.766920478812267},"anchor":{"b0":0.08804785895293024,"b1":-0.08799833858781295,"a1":-1.962027920383178,"a2":0.9620774407482953}},{"key":["power-v1","12AT7","EL84","20","8.0","15",352800],"detector":{"real":252.48563097311896,"imaginary":16.138752933818143},"anchor":{"b0":0.0895573726209339,"b1":-0.08948829031213382,"a1":-1.95327764242771,"a2":0.9533467247365103}},{"key":["power-v1","12AT7","EL84","20","8.0","16",352800],"detector":{"real":260.76171416803066,"imaginary":16.6643504566553},"anchor":{"b0":0.09189984287900217,"b1":-0.09167077220017462,"a1":-1.959493663233351,"a2":0.9597227339121787}},{"key":["power-v1","12AT7","EL84","20","8.0","4",384000],"detector":{"real":130.7219892647832,"imaginary":8.22549430784324},"anchor":{"b0":0.08241504317896624,"b1":-0.08222882155066574,"a1":-1.9650313345215005,"a2":0.9652175561498009}},{"key":["power-v1","12AT7","EL84","20","8.0","8",384000],"detector":{"real":184.8999142736454,"imaginary":11.67001220584939},"anchor":{"b0":0.08367999994869549,"b1":-0.08351356948924116,"a1":-1.9741892471146898,"a2":0.9743556775741441}},{"key":["power-v1","12AT7","EL84","20","8.0","15",384000],"detector":{"real":253.21369288366463,"imaginary":16.006038927407136},"anchor":{"b0":0.08138608636634467,"b1":-0.08132381775352072,"a1":-1.973647771282257,"a2":0.9737100398950811}},{"key":["power-v1","12AT7","EL84","20","8.0","16",384000],"detector":{"real":261.5136341240742,"imaginary":16.527287587949033},"anchor":{"b0":0.08299386428555787,"b1":-0.08284013088341992,"a1":-1.971311247687686,"a2":0.9714649810898238}},{"key":["power-v1","12AT7","EL84","43","6.0","4",352800],"detector":{"real":98.76335379143818,"imaginary":5.816650250376477},"anchor":{"b0":0.09195697149945102,"b1":-0.09178201253029221,"a1":-1.972839927828073,"a2":0.9730148867972318}},{"key":["power-v1","12AT7","EL84","43","6.0","8",352800],"detector":{"real":139.69603898691298,"imaginary":8.254201806167034},"anchor":{"b0":0.1005240417486018,"b1":-0.10047028575148619,"a1":-1.9727446504975332,"a2":0.9727984064946488}},{"key":["power-v1","12AT7","EL84","43","6.0","15",352800],"detector":{"real":191.3086827603799,"imaginary":11.322299056902457},"anchor":{"b0":0.08984899746616627,"b1":-0.08981418159070537,"a1":-1.9622794732958329,"a2":0.9623142891712937}},{"key":["power-v1","12AT7","EL84","43","6.0","16",352800],"detector":{"real":197.57946934784835,"imaginary":11.690846734496924},"anchor":{"b0":0.09523614857861257,"b1":-0.09519111166637235,"a1":-1.9714708000193344,"a2":0.9715158369315745}},{"key":["power-v1","12AT7","EL84","43","6.0","4",384000],"detector":{"real":99.02218001902021,"imaginary":5.777372450913472},"anchor":{"b0":0.08436566156253708,"b1":-0.0843281661190211,"a1":-1.9745124207145346,"a2":0.9745499161580505}},{"key":["power-v1","12AT7","EL84","43","6.0","8",384000],"detector":{"real":140.06219390093912,"imaginary":8.198658427091846},"anchor":{"b0":0.08485041566011432,"b1":-0.08473052425762212,"a1":-1.9770845388090583,"a2":0.9772044302115506}},{"key":["power-v1","12AT7","EL84","43","6.0","15",384000],"detector":{"real":191.810153435529,"imaginary":11.246228451054545},"anchor":{"b0":0.0852559543403032,"b1":-0.08512445815151988,"a1":-1.9737848531539455,"a2":0.9739163493427286}},{"key":["power-v1","12AT7","EL84","43","6.0","16",384000],"detector":{"real":198.09737280036236,"imaginary":11.612284252984628},"anchor":{"b0":0.09023413479343846,"b1":-0.09010197527841529,"a1":-1.9752777137224218,"a2":0.9754098732374451}},{"key":["power-v1","12AT7","EL84","43","6.6","4",352800],"detector":{"real":99.33469961474404,"imaginary":5.80062912747828},"anchor":{"b0":0.09662114393454149,"b1":-0.09652934258284833,"a1":-1.9681380846975065,"a2":0.9682298860491998}},{"key":["power-v1","12AT7","EL84","43","6.6","8",352800],"detector":{"real":140.5041937661569,"imaginary":8.231694990538674},"anchor":{"b0":0.08865863185289777,"b1":-0.08859879341009924,"a1":-1.9715365408254146,"a2":0.9715963792682131}},{"key":["power-v1","12AT7","EL84","43","6.6","15",352800],"detector":{"real":192.41543083032312,"imaginary":11.29158312951962},"anchor":{"b0":0.08858311128122391,"b1":-0.08847105250367339,"a1":-1.9692214872134235,"a2":0.969333545990974}},{"key":["power-v1","12AT7","EL84","43","6.6","16",352800],"detector":{"real":198.72249350753478,"imaginary":11.659109098115003},"anchor":{"b0":0.09163253202985963,"b1":-0.09140356343272435,"a1":-1.967001211387791,"a2":0.9672301799849264}},{"key":["power-v1","12AT7","EL84","43","6.6","4",384000],"detector":{"real":99.58878734617561,"imaginary":5.762215608323107},"anchor":{"b0":0.08789679600441351,"b1":-0.08786545497777634,"a1":-1.9753515692623496,"a2":0.9753829102889867}},{"key":["power-v1","12AT7","EL84","43","6.6","8",384000],"detector":{"real":140.86364621908402,"imaginary":8.17737264523466},"anchor":{"b0":0.08725126591429143,"b1":-0.08722102140889573,"a1":-1.9556927069411332,"a2":0.955722951446529}},{"key":["power-v1","12AT7","EL84","43","6.6","15",384000],"detector":{"real":192.90772259947414,"imaginary":11.217183414106968},"anchor":{"b0":0.08151441986553735,"b1":-0.08147651379073492,"a1":-1.9771114402982735,"a2":0.9771493463730759}},{"key":["power-v1","12AT7","EL84","43","6.6","16",384000],"detector":{"real":199.23091719842404,"imaginary":11.582272517625075},"anchor":{"b0":0.08140770295614166,"b1":-0.08137671818675772,"a1":-1.9756787487574583,"a2":0.9757097335268422}},{"key":["power-v1","12AT7","EL84","43","8.0","4",352800],"detector":{"real":99.8114995184881,"imaginary":5.711699593599274},"anchor":{"b0":0.09170464911463018,"b1":-0.09164568182377276,"a1":-1.9722733330488587,"a2":0.9723323003397161}},{"key":["power-v1","12AT7","EL84","43","8.0","8",352800],"detector":{"real":141.17863618653703,"imaginary":8.106036057621424},"anchor":{"b0":0.0901104536315616,"b1":-0.09002287450062535,"a1":-1.9758430589427896,"a2":0.9759306380737257}},{"key":["power-v1","12AT7","EL84","43","8.0","15",352800],"detector":{"real":193.33907716957268,"imaginary":11.119585647686105},"anchor":{"b0":0.08914298093070318,"b1":-0.08909612879190419,"a1":-1.9770195040905203,"a2":0.9770663562293194}},{"key":["power-v1","12AT7","EL84","43","8.0","16",352800],"detector":{"real":199.6764123940397,"imaginary":11.481461550758716},"anchor":{"b0":0.08973491283392881,"b1":-0.08952095857599578,"a1":-1.9695776212049085,"a2":0.9697915754628416}},{"key":["power-v1","12AT7","EL84","43","8.0","4",384000],"detector":{"real":100.05394816999618,"imaginary":5.677105197685034},"anchor":{"b0":0.08253913002274912,"b1":-0.08231407836990776,"a1":-1.9699910613951146,"a2":0.970216113047956}},{"key":["power-v1","12AT7","EL84","43","8.0","8",384000],"detector":{"real":141.5216245453361,"imaginary":8.057112258466061},"anchor":{"b0":0.08276008389807168,"b1":-0.08260805131347534,"a1":-1.9674752599265073,"a2":0.9676272925111036}},{"key":["power-v1","12AT7","EL84","43","8.0","15",384000],"detector":{"real":193.80882117341213,"imaginary":11.052576653953148},"anchor":{"b0":0.08505557257116686,"b1":-0.0849461953132879,"a1":-1.9745431179021986,"a2":0.9746524951600776}},{"key":["power-v1","12AT7","EL84","43","8.0","16",384000],"detector":{"real":200.16154939340012,"imaginary":11.412258292849918},"anchor":{"b0":0.08366277359591054,"b1":-0.08363288021566297,"a1":-1.9745467316893826,"a2":0.97457662506963}},{"key":["power-v1","12AT7","EL34","0","6.0","4",352800],"detector":{"real":152.85887511717266,"imaginary":7.903198246883945},"anchor":{"b0":0.09698675645184551,"b1":-0.0969285967635892,"a1":-1.973881768191605,"a2":0.9739399278798614}},{"key":["power-v1","12AT7","EL34","0","6.0","8",352800],"detector":{"real":216.21186346924753,"imaginary":11.220201138351253},"anchor":{"b0":0.0903811258012506,"b1":-0.09033410596631113,"a1":-1.9713344382036952,"a2":0.9713814580386347}},{"key":["power-v1","12AT7","EL34","0","6.0","15",352800],"detector":{"real":296.0945472673219,"imaginary":15.394231321165885},"anchor":{"b0":0.09752202258172557,"b1":-0.09742250410838663,"a1":-1.9709235489327006,"a2":0.9710230674060396}},{"key":["power-v1","12AT7","EL34","0","6.0","16",352800],"detector":{"real":305.80001495977433,"imaginary":15.894839434905228},"anchor":{"b0":0.0883005846949472,"b1":-0.08814586629763961,"a1":-1.9741220010648013,"a2":0.9742767194621089}},{"key":["power-v1","12AT7","EL34","0","6.0","4",384000],"detector":{"real":153.19889604008293,"imaginary":7.852222495003975},"anchor":{"b0":0.08138518264415393,"b1":-0.08127239326474738,"a1":-1.977561091909194,"a2":0.9776738812886004}},{"key":["power-v1","12AT7","EL34","0","6.0","8",384000],"detector":{"real":216.69289174252475,"imaginary":11.148102326066672},"anchor":{"b0":0.0890256211296907,"b1":-0.08892395788256376,"a1":-1.9768037087584,"a2":0.976905372005527}},{"key":["power-v1","12AT7","EL34","0","6.0","15",384000],"detector":{"real":296.7533487386303,"imaginary":15.295473896388941},"anchor":{"b0":0.08362432545791254,"b1":-0.0835616789946525,"a1":-1.9766405624077832,"a2":0.9767032088710432}},{"key":["power-v1","12AT7","EL34","0","6.0","16",384000],"detector":{"real":306.4804041752574,"imaginary":15.792849030749153},"anchor":{"b0":0.08344608010919406,"b1":-0.08330610605682544,"a1":-1.9739091102431539,"a2":0.9740490842955225}},{"key":["power-v1","12AT7","EL34","0","6.6","4",352800],"detector":{"real":157.90437416691648,"imaginary":8.212352163821345},"anchor":{"b0":0.09074000880925716,"b1":-0.09066128559228545,"a1":-1.9770101652648546,"a2":0.9770888884818262}},{"key":["power-v1","12AT7","EL34","0","6.6","8",352800],"detector":{"real":223.34847725387078,"imaginary":11.658855270223507},"anchor":{"b0":0.0975427448899278,"b1":-0.09739805024779104,"a1":-1.9663713635461564,"a2":0.9665160581882931}},{"key":["power-v1","12AT7","EL34","0","6.6","15",352800],"detector":{"real":305.8678799939697,"imaginary":15.995895934627022},"anchor":{"b0":0.10124723364815504,"b1":-0.10117969461555842,"a1":-1.974740760193651,"a2":0.9748082992262477}},{"key":["power-v1","12AT7","EL34","0","6.6","16",352800],"detector":{"real":315.89370192212607,"imaginary":16.51609384236877},"anchor":{"b0":0.10129173014534067,"b1":-0.10124388918819233,"a1":-1.9722476074257398,"a2":0.9722954483828883}},{"key":["power-v1","12AT7","EL34","0","6.6","4",384000],"detector":{"real":158.25295374925267,"imaginary":8.160147082895392},"anchor":{"b0":0.08184656718595472,"b1":-0.08174813979407397,"a1":-1.9686445656403364,"a2":0.9687429930322171}},{"key":["power-v1","12AT7","EL34","0","6.6","8",384000],"detector":{"real":223.8416139766198,"imaginary":11.585017125118108},"anchor":{"b0":0.08329276084238314,"b1":-0.08316699125409205,"a1":-1.977122160138373,"a2":0.9772479297266642}},{"key":["power-v1","12AT7","EL34","0","6.6","15",384000],"detector":{"real":306.5432651792906,"imaginary":15.894755361331933},"anchor":{"b0":0.08576370133420275,"b1":-0.08558358930127125,"a1":-1.9662612915794806,"a2":0.9664414036124122}},{"key":["power-v1","12AT7","EL34","0","6.6","16",384000],"detector":{"real":316.59121818361217,"imaginary":16.411642402265574},"anchor":{"b0":0.08472533658464283,"b1":-0.08460386950093947,"a1":-1.9757141064509738,"a2":0.9758355735346773}},{"key":["power-v1","12AT7","EL34","0","8.0","4",352800],"detector":{"real":167.9287152477241,"imaginary":8.804715781705122},"anchor":{"b0":0.09365278512012382,"b1":-0.09349539429266046,"a1":-1.967203394734283,"a2":0.9673607855617465}},{"key":["power-v1","12AT7","EL34","0","8.0","8",352800],"detector":{"real":237.5274275858316,"imaginary":12.499448293223848},"anchor":{"b0":0.09228437914727604,"b1":-0.09222084010503509,"a1":-1.97004926195853,"a2":0.9701128010007709}},{"key":["power-v1","12AT7","EL34","0","8.0","15",352800],"detector":{"real":325.28544034877496,"imaginary":17.148932257015815},"anchor":{"b0":0.0925881545484988,"b1":-0.09251805736489498,"a1":-1.971499750643492,"a2":0.9715698478270958}},{"key":["power-v1","12AT7","EL34","0","8.0","16",352800],"detector":{"real":335.9477382019801,"imaginary":17.706663108936528},"anchor":{"b0":0.08876575914159081,"b1":-0.08867926101128684,"a1":-1.9774343758215946,"a2":0.9775208739518986}},{"key":["power-v1","12AT7","EL34","0","8.0","4",384000],"detector":{"real":168.29311084853873,"imaginary":8.750315538001558},"anchor":{"b0":0.09120665937682947,"b1":-0.09108111962648605,"a1":-1.9755391621344867,"a2":0.97566470188483}},{"key":["power-v1","12AT7","EL34","0","8.0","8",384000],"detector":{"real":238.04294051134332,"imaginary":12.422503800208517},"anchor":{"b0":0.08261277010336296,"b1":-0.08247696989417472,"a1":-1.9757776101492865,"a2":0.9759134103584748}},{"key":["power-v1","12AT7","EL34","0","8.0","15",384000],"detector":{"real":325.9914719111831,"imaginary":17.043535055413713},"anchor":{"b0":0.08719898018843313,"b1":-0.08705546444247406,"a1":-1.9760358834010652,"a2":0.9761793991470243}},{"key":["power-v1","12AT7","EL34","0","8.0","16",384000],"detector":{"real":336.6769050527854,"imaginary":17.597815893762746},"anchor":{"b0":0.08683837830583076,"b1":-0.08674954633485533,"a1":-1.974431432843208,"a2":0.9745202648141835}},{"key":["power-v1","12AT7","EL34","20","6.0","4",352800],"detector":{"real":100.051273910005,"imaginary":4.709349683783379},"anchor":{"b0":0.10058152388439101,"b1":-0.100378900952135,"a1":-1.9703113218687132,"a2":0.9705139448009693}},{"key":["power-v1","12AT7","EL34","20","6.0","8",352800],"detector":{"real":141.518060605914,"imaginary":6.688308930844946},"anchor":{"b0":0.09308970511833659,"b1":-0.09295460334815082,"a1":-1.9748366519332392,"a2":0.974971753703425}},{"key":["power-v1","12AT7","EL34","20","6.0","15",352800],"detector":{"real":193.80409615762107,"imaginary":9.178093173277297},"anchor":{"b0":0.08894424739415598,"b1":-0.08890577473925078,"a1":-1.9762446893526393,"a2":0.9762831620075445}},{"key":["power-v1","12AT7","EL34","20","6.0","16",352800],"detector":{"real":200.15664747718603,"imaginary":9.476325363110988},"anchor":{"b0":0.09620894919224715,"b1":-0.09605840855419047,"a1":-1.9746084877738939,"a2":0.9747590284119505}},{"key":["power-v1","12AT7","EL34","20","6.0","4",384000],"detector":{"real":100.23416168127254,"imaginary":4.685552227489641},"anchor":{"b0":0.08433767987899865,"b1":-0.0842436954585078,"a1":-1.9762868910876923,"a2":0.9763808755081831}},{"key":["power-v1","12AT7","EL34","20","6.0","8",384000],"detector":{"real":141.776798714426,"imaginary":6.654640516089315},"anchor":{"b0":0.09537045413977424,"b1":-0.09513246871314904,"a1":-1.9677891089184716,"a2":0.9680270943450968}},{"key":["power-v1","12AT7","EL34","20","6.0","15",384000],"detector":{"real":194.1584592084395,"imaginary":9.131964594630494},"anchor":{"b0":0.08670437222286921,"b1":-0.08664585253394685,"a1":-1.9736285274178256,"a2":0.9736870471067478}},{"key":["power-v1","12AT7","EL34","20","6.0","16",384000],"detector":{"real":200.52262198972477,"imaginary":9.428688564736403},"anchor":{"b0":0.08280826733991652,"b1":-0.08276496158421158,"a1":-1.975120253654492,"a2":0.9751635594101968}},{"key":["power-v1","12AT7","EL34","20","6.6","4",352800],"detector":{"real":100.8025897897134,"imaginary":4.761531342886926},"anchor":{"b0":0.0976628908545942,"b1":-0.09761722839255726,"a1":-1.975297766746396,"a2":0.975343429208433}},{"key":["power-v1","12AT7","EL34","20","6.6","8",352800],"detector":{"real":142.5807588221736,"imaginary":6.762321684074998},"anchor":{"b0":0.09335444939046057,"b1":-0.0932385384238165,"a1":-1.9738430465476964,"a2":0.9739589575143406}},{"key":["power-v1","12AT7","EL34","20","6.6","15",352800],"detector":{"real":195.25942149923677,"imaginary":9.279591597150151},"anchor":{"b0":0.0900502378774056,"b1":-0.08993318296016556,"a1":-1.973689685522902,"a2":0.973806740440142}},{"key":["power-v1","12AT7","EL34","20","6.6","16",352800],"detector":{"real":201.6596762070153,"imaginary":9.581131119773328},"anchor":{"b0":0.09247611575036901,"b1":-0.09237153868141698,"a1":-1.9743853824780098,"a2":0.9744899595469618}},{"key":["power-v1","12AT7","EL34","20","6.6","4",384000],"detector":{"real":100.98403482884189,"imaginary":4.736591888440847},"anchor":{"b0":0.08213964816411311,"b1":-0.08203524515325154,"a1":-1.9768637627384529,"a2":0.9769681657493144}},{"key":["power-v1","12AT7","EL34","20","6.6","8",384000],"detector":{"real":142.83745682193714,"imaginary":6.727037039195727},"anchor":{"b0":0.08131071676593599,"b1":-0.08126134483857839,"a1":-1.9758264452655778,"a2":0.9758758171929353}},{"key":["power-v1","12AT7","EL34","20","6.6","15",384000],"detector":{"real":195.610991188005,"imaginary":9.231248903739036},"anchor":{"b0":0.08130935732531266,"b1":-0.08110607802459117,"a1":-1.9711277200758985,"a2":0.9713309993766199}},{"key":["power-v1","12AT7","EL34","20","6.6","16",384000],"detector":{"real":202.0227657632649,"imaginary":9.531207711479567},"anchor":{"b0":0.08916310484922728,"b1":-0.08907577573509878,"a1":-1.9767994038596688,"a2":0.9768867329737972}},{"key":["power-v1","12AT7","EL34","20","8.0","4",352800],"detector":{"real":101.6407000218018,"imaginary":4.824149830438461},"anchor":{"b0":0.09834856261091854,"b1":-0.09826131670919303,"a1":-1.9690962309714461,"a2":0.9691834768731716}},{"key":["power-v1","12AT7","EL34","20","8.0","8",352800],"detector":{"real":143.76622212392755,"imaginary":6.851120407023078},"anchor":{"b0":0.09018936897402721,"b1":-0.09009222599252752,"a1":-1.9748702321689984,"a2":0.974967375150498}},{"key":["power-v1","12AT7","EL34","20","8.0","15",352800],"detector":{"real":196.8828682260821,"imaginary":9.401355116487716},"anchor":{"b0":0.08998902676412479,"b1":-0.08994511643157485,"a1":-1.976337190232191,"a2":0.9763811005647408}},{"key":["power-v1","12AT7","EL34","20","8.0","16",352800],"detector":{"real":203.33633729001855,"imaginary":9.70686397820408},"anchor":{"b0":0.09129292181798973,"b1":-0.09111461026945383,"a1":-1.9693198341049691,"a2":0.9694981456535049}},{"key":["power-v1","12AT7","EL34","20","8.0","4",384000],"detector":{"real":101.817821300289,"imaginary":4.79704146776054},"anchor":{"b0":0.08587554184833802,"b1":-0.08583901017946945,"a1":-1.9758291590920412,"a2":0.9758656907609097}},{"key":["power-v1","12AT7","EL34","20","8.0","8",384000],"detector":{"real":144.01680527392375,"imaginary":6.812766324724276},"anchor":{"b0":0.08438055825023523,"b1":-0.08428056210055077,"a1":-1.9761644386801607,"a2":0.9762644348298452}},{"key":["power-v1","12AT7","EL34","20","8.0","15",384000],"detector":{"real":197.22606436816383,"imaginary":9.348807648878767},"anchor":{"b0":0.08338974822435911,"b1":-0.08321952146647923,"a1":-1.9708986752667272,"a2":0.9710689020246072}},{"key":["power-v1","12AT7","EL34","20","8.0","16",384000],"detector":{"real":203.69077865884822,"imaginary":9.652598126396253},"anchor":{"b0":0.08614762684232405,"b1":-0.086101435300528,"a1":-1.9771576195314955,"a2":0.9772038110732916}},{"key":["power-v1","12AT7","EL34","43","6.0","4",352800],"detector":{"real":74.09373658077772,"imaginary":3.284126944599172},"anchor":{"b0":0.11032072959971129,"b1":-0.11011411027159942,"a1":-1.9712059289769426,"a2":0.9714125483050544}},{"key":["power-v1","12AT7","EL34","43","6.0","8",352800],"detector":{"real":104.80233787292467,"imaginary":4.665350178702622},"anchor":{"b0":0.09690936913377787,"b1":-0.09673839698012635,"a1":-1.9725488664797934,"a2":0.9727198386334448}},{"key":["power-v1","12AT7","EL34","43","6.0","15",352800],"detector":{"real":143.52321991773672,"imaginary":6.402871485683308},"anchor":{"b0":0.09978632172350949,"b1":-0.09973809295190654,"a1":-1.9741348607831612,"a2":0.9741830895547642}},{"key":["power-v1","12AT7","EL34","43","6.0","16",352800],"detector":{"real":148.22764881976937,"imaginary":6.610814077377191},"anchor":{"b0":0.09243363844781428,"b1":-0.09239905382255172,"a1":-1.972176315460039,"a2":0.9722109000853015}},{"key":["power-v1","12AT7","EL34","43","6.0","4",384000],"detector":{"real":74.21430824295939,"imaginary":3.2803219004292825},"anchor":{"b0":0.09461319070680095,"b1":-0.09446213324979764,"a1":-1.9753978774318184,"a2":0.9755489348888217}},{"key":["power-v1","12AT7","EL34","43","6.0","8",384000],"detector":{"real":104.97291525133205,"imaginary":4.659958219186614},"anchor":{"b0":0.08564236795432928,"b1":-0.08560152247768756,"a1":-1.9775158467355651,"a2":0.9775566922122069}},{"key":["power-v1","12AT7","EL34","43","6.0","15",384000],"detector":{"real":143.75683923841973,"imaginary":6.395469329836464},"anchor":{"b0":0.09086940089091157,"b1":-0.09072264431591931,"a1":-1.9734898043125253,"a2":0.9736365608875175}},{"key":["power-v1","12AT7","EL34","43","6.0","16",384000],"detector":{"real":148.46892322927064,"imaginary":6.6031724676085215},"anchor":{"b0":0.08357924693410147,"b1":-0.0833551850234117,"a1":-1.9693070318837853,"a2":0.9695310937944751}},{"key":["power-v1","12AT7","EL34","43","6.6","4",352800],"detector":{"real":73.53827623146138,"imaginary":3.2389107144664937},"anchor":{"b0":0.0914107850922311,"b1":-0.09137243032999251,"a1":-1.9743577451204253,"a2":0.974396099882664}},{"key":["power-v1","12AT7","EL34","43","6.6","8",352800],"detector":{"real":104.01666918193338,"imaginary":4.60124286488097},"anchor":{"b0":0.09176209206712393,"b1":-0.09172683362701266,"a1":-1.9716181375517094,"a2":0.9716533959918208}},{"key":["power-v1","12AT7","EL34","43","6.6","15",352800],"detector":{"real":142.44727728989972,"imaginary":6.314974934164051},"anchor":{"b0":0.09076051324304339,"b1":-0.09058350161282862,"a1":-1.9731041343787916,"a2":0.9732811460090064}},{"key":["power-v1","12AT7","EL34","43","6.6","16",352800],"detector":{"real":147.1164382596671,"imaginary":6.520050945440122},"anchor":{"b0":0.10443020616021968,"b1":-0.10421997617378312,"a1":-1.9705617803522655,"a2":0.9707720103387021}},{"key":["power-v1","12AT7","EL34","43","6.6","4",384000],"detector":{"real":73.65563402532706,"imaginary":3.2423516173283984},"anchor":{"b0":0.08539965604638514,"b1":-0.08527362390857261,"a1":-1.9772697389316491,"a2":0.9773957710694616}},{"key":["power-v1","12AT7","EL34","43","6.6","8",384000],"detector":{"real":104.18269840226583,"imaginary":4.606099570499827},"anchor":{"b0":0.0843848090961469,"b1":-0.08433354486961138,"a1":-1.973348494191416,"a2":0.9733997584179516}},{"key":["power-v1","12AT7","EL34","43","6.6","15",384000],"detector":{"real":142.674666597911,"imaginary":6.321607615641344},"anchor":{"b0":0.0865649032431803,"b1":-0.08650286719189516,"a1":-1.9763429425148522,"a2":0.9764049785661375}},{"key":["power-v1","12AT7","EL34","43","6.6","16",384000],"detector":{"real":147.3512786263461,"imaginary":6.526904250288483},"anchor":{"b0":0.08168100955935301,"b1":-0.08151214504708176,"a1":-1.9714872649460509,"a2":0.9716561294583221}},{"key":["power-v1","12AT7","EL34","43","8.0","4",352800],"detector":{"real":71.95711147333236,"imaginary":2.994757199652584},"anchor":{"b0":0.0967388673986583,"b1":-0.009150351252425457,"a1":-0.9678203436222714,"a2":0.0554088597685043}},{"key":["power-v1","12AT7","EL34","43","8.0","8",352800],"detector":{"real":101.78022821191516,"imaginary":4.255467438765271},"anchor":{"b0":0.09251177333764819,"b1":-0.008575672760151495,"a1":-0.9811685496088394,"a2":0.0651046501863361}},{"key":["power-v1","12AT7","EL34","43","8.0","15",352800],"detector":{"real":139.38458024550587,"imaginary":5.841150642506923},"anchor":{"b0":0.09661794198529926,"b1":-0.018187367540990495,"a1":-1.0424360377611972,"a2":0.12086661220550608}},{"key":["power-v1","12AT7","EL34","43","8.0","16",352800],"detector":{"real":143.95334704479905,"imaginary":6.030737010034732},"anchor":{"b0":0.10921258747465327,"b1":-0.006906867276495432,"a1":-0.9713216450060919,"a2":0.0736273652042497}},{"key":["power-v1","12AT7","EL34","43","8.0","4",384000],"detector":{"real":72.06643484432028,"imaginary":3.0522670420486695},"anchor":{"b0":0.10144422491128045,"b1":-0.012065312611093042,"a1":-0.9835283977939445,"a2":0.07290731009413193}},{"key":["power-v1","12AT7","EL34","43","8.0","8",384000],"detector":{"real":101.93487753507029,"imaginary":4.336801632315026},"anchor":{"b0":0.11569754367843142,"b1":-0.04254409064387011,"a1":-1.0172637025474485,"a2":0.09041715558200977}},{"key":["power-v1","12AT7","EL34","43","8.0","15",384000],"detector":{"real":139.59637459404425,"imaginary":5.952516449927671},"anchor":{"b0":0.10652963071296438,"b1":-0.03138552153485044,"a1":-1.0071294451448778,"a2":0.08227355432299176}},{"key":["power-v1","12AT7","EL34","43","8.0","16",384000],"detector":{"real":144.17208281056944,"imaginary":6.145756347764994},"anchor":{"b0":0.1358191028475969,"b1":-0.02823401756029901,"a1":-1.0004504801684788,"a2":0.10803556545577674}},{"key":["power-v1","12AU7","EL84","0","6.0","4",352800],"detector":{"real":12.65511304430348,"imaginary":0.9496914209414329},"anchor":{"b0":0.08982421895096719,"b1":-0.08975829005943015,"a1":-1.9720223639348953,"a2":0.9720882928264323}},{"key":["power-v1","12AU7","EL84","0","6.0","8",352800],"detector":{"real":17.89999661488111,"imaginary":1.3467340215501318},"anchor":{"b0":0.08807158738805183,"b1":-0.08789453128704641,"a1":-1.9659845100413151,"a2":0.9661615661423204}},{"key":["power-v1","12AU7","EL84","0","6.0","15",352800],"detector":{"real":24.513361180614492,"imaginary":1.8466722038267802},"anchor":{"b0":0.09120959800714631,"b1":-0.09106843604943202,"a1":-1.9755268285647252,"a2":0.9756679905224396}},{"key":["power-v1","12AU7","EL84","0","6.0","16",352800],"detector":{"real":25.316874496869307,"imaginary":1.9068723452800713},"anchor":{"b0":0.08884586551534385,"b1":-0.08880254290185036,"a1":-1.9773032800706396,"a2":0.9773466026841331}},{"key":["power-v1","12AU7","EL84","0","6.0","4",384000],"detector":{"real":12.696616264874132,"imaginary":0.9439731705646193},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.0","8",384000],"detector":{"real":17.95870875403039,"imaginary":1.338649843550883},"anchor":{"b0":0.03410615843442524,"b1":-0.003163710971482071,"a1":-1.6284423787076867,"a2":0.65938482617063}},{"key":["power-v1","12AU7","EL84","0","6.0","15",384000],"detector":{"real":24.593770164949067,"imaginary":1.8356020365914731},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.0","16",384000],"detector":{"real":25.39991851264028,"imaginary":1.8954392952771721},"anchor":{"b0":0.036094570412117485,"b1":-0.005117502063894248,"a1":-1.640643841152659,"a2":0.6716209095008823}},{"key":["power-v1","12AU7","EL84","0","6.6","4",352800],"detector":{"real":13.18508699406421,"imaginary":0.9915148324546341},"anchor":{"b0":0.09089123154241834,"b1":-0.09079994200641178,"a1":-1.974131712616923,"a2":0.9742230021529298}},{"key":["power-v1","12AU7","EL84","0","6.6","8",352800],"detector":{"real":18.64961655227218,"imaginary":1.4060353892326074},"anchor":{"b0":0.08839360600442299,"b1":-0.08806385520423597,"a1":-1.9494556233464315,"a2":0.9497853741466186}},{"key":["power-v1","12AU7","EL84","0","6.6","15",352800],"detector":{"real":25.539936645443245,"imaginary":1.9279825187652808},"anchor":{"b0":0.0893214112754719,"b1":-0.08821309294255049,"a1":-1.932601802410113,"a2":0.9337101207430344}},{"key":["power-v1","12AU7","EL84","0","6.6","16",352800],"detector":{"real":26.37709973750202,"imaginary":1.9908339989725976},"anchor":{"b0":0.09136882338063398,"b1":-0.0909026095600375,"a1":-1.9567979621631966,"a2":0.9572641759837931}},{"key":["power-v1","12AU7","EL84","0","6.6","4",384000],"detector":{"real":13.228078425569475,"imaginary":0.9856131366613106},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.6","8",384000],"detector":{"real":18.710434048596213,"imaginary":1.3976917929057173},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.6","15",384000],"detector":{"real":25.62322897351097,"imaginary":1.916557057817796},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","6.6","16",384000],"detector":{"real":26.46312156760927,"imaginary":1.979034038308637},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","8.0","4",352800],"detector":{"real":14.292608886010985,"imaginary":1.0767852195949201},"anchor":{"b0":0.05314895486128553,"b1":-0.00543839904174662,"a1":-1.5596300590350092,"a2":0.607340614854548}},{"key":["power-v1","12AU7","EL84","0","8.0","8",352800],"detector":{"real":20.21614781124191,"imaginary":1.5269474288327918},"anchor":{"b0":0.05145165166666046,"b1":-0.005264724656402758,"a1":-1.5193931275576185,"a2":0.5655800545678762}},{"key":["power-v1","12AU7","EL84","0","8.0","15",352800],"detector":{"real":27.685240866632032,"imaginary":2.093774494627569},"anchor":{"b0":0.05145165166666046,"b1":-0.005264724656402758,"a1":-1.5193931275576185,"a2":0.5655800545678762}},{"key":["power-v1","12AU7","EL84","0","8.0","16",352800],"detector":{"real":28.59272400575696,"imaginary":2.162031470644992},"anchor":{"b0":0.047632690745048126,"b1":-0.005006579209540753,"a1":-1.519056591351823,"a2":0.5616827028873305}},{"key":["power-v1","12AU7","EL84","0","8.0","4",384000],"detector":{"real":14.338592942307805,"imaginary":1.0705058443471844},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","8.0","8",384000],"detector":{"real":20.281198915980053,"imaginary":1.5180697984036857},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","8.0","15",384000],"detector":{"real":27.774331378880802,"imaginary":2.081617696168307},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL84","0","8.0","16",384000],"detector":{"real":28.684734043230986,"imaginary":2.1494761783969953},"anchor":{"b0":0.03157661930906451,"b1":-0.0019466240819103699,"a1":-1.652606458773521,"a2":0.6822364540006752}},{"key":["power-v1","12AU7","EL84","20","6.0","4",352800],"detector":{"real":9.40058740078567,"imaginary":0.6112823771557269},"anchor":{"b0":0.08877478679265763,"b1":-0.08873982806426318,"a1":-1.975428492944606,"a2":0.9754634516730005}},{"key":["power-v1","12AU7","EL84","20","6.0","8",352800],"detector":{"real":13.296665532566834,"imaginary":0.8671841780710022},"anchor":{"b0":0.08989298503282325,"b1":-0.08974692698319958,"a1":-1.9639858566852464,"a2":0.9641319147348701}},{"key":["power-v1","12AU7","EL84","20","6.0","15",352800],"detector":{"real":18.209292741108218,"imaginary":1.189335864431634},"anchor":{"b0":0.08800036204048187,"b1":-0.08777846491343298,"a1":-1.9701628162926617,"a2":0.9703847134197104}},{"key":["power-v1","12AU7","EL84","20","6.0","16",352800],"detector":{"real":18.806165149866455,"imaginary":1.2280748306165958},"anchor":{"b0":0.08922681339281177,"b1":-0.08918922670318502,"a1":-1.9564339278883636,"a2":0.9564715145779902}},{"key":["power-v1","12AU7","EL84","20","6.0","4",384000],"detector":{"real":9.424508664380735,"imaginary":0.6089899336977032},"anchor":{"b0":0.08253187896990227,"b1":-0.08245156234535045,"a1":-1.9712884938045874,"a2":0.9713688104291391}},{"key":["power-v1","12AU7","EL84","20","6.0","8",384000],"detector":{"real":13.330506171432651,"imaginary":0.863942753847871},"anchor":{"b0":0.0847513749235303,"b1":-0.08469616874267609,"a1":-1.9790927851751237,"a2":0.979147991355978}},{"key":["power-v1","12AU7","EL84","20","6.0","15",384000],"detector":{"real":18.25563932542026,"imaginary":1.1848961858574267},"anchor":{"b0":0.0854465383154784,"b1":-0.08538414184617511,"a1":-1.9677636342864657,"a2":0.9678260307557691}},{"key":["power-v1","12AU7","EL84","20","6.0","16",384000],"detector":{"real":18.854030510218692,"imaginary":1.2234897748299385},"anchor":{"b0":0.08152461572998122,"b1":-0.0814211246066322,"a1":-1.9375341172096592,"a2":0.9376376083330081}},{"key":["power-v1","12AU7","EL84","20","6.6","4",352800],"detector":{"real":9.595915847446145,"imaginary":0.6209505454452947},"anchor":{"b0":0.09041165379123407,"b1":-0.09032598553449747,"a1":-1.9756213247552417,"a2":0.9757069930119782}},{"key":["power-v1","12AU7","EL84","20","6.6","8",352800],"detector":{"real":13.572948797311197,"imaginary":0.8809124179844713},"anchor":{"b0":0.09166727163090502,"b1":-0.0916315682427379,"a1":-1.976347633497535,"a2":0.9763833368857022}},{"key":["power-v1","12AU7","EL84","20","6.6","15",352800],"detector":{"real":18.58765297744417,"imaginary":1.2081726951165328},"anchor":{"b0":0.08962458588904794,"b1":-0.08958850521908927,"a1":-1.9768974159693151,"a2":0.9769334966392738}},{"key":["power-v1","12AU7","EL84","20","6.6","16",352800],"detector":{"real":19.19692738819289,"imaginary":1.2475239640693208},"anchor":{"b0":0.08953446908563391,"b1":-0.08947830964599966,"a1":-1.9746732109836604,"a2":0.9747293704232947}},{"key":["power-v1","12AU7","EL84","20","6.6","4",384000],"detector":{"real":9.6198303955545,"imaginary":0.6186625494254631},"anchor":{"b0":0.08259914167568574,"b1":-0.08254923010417732,"a1":-1.958941231931302,"a2":0.9589911435028106}},{"key":["power-v1","12AU7","EL84","20","6.6","8",384000],"detector":{"real":13.606779946169018,"imaginary":0.8776770805856879},"anchor":{"b0":0.08163653672646763,"b1":-0.08147789645419579,"a1":-1.9747608753106776,"a2":0.9749195155829493}},{"key":["power-v1","12AU7","EL84","20","6.6","15",384000],"detector":{"real":18.6339866517394,"imaginary":1.203741306550779},"anchor":{"b0":0.0876469742694822,"b1":-0.0876032364671594,"a1":-1.9771621990557906,"a2":0.9772059368581134}},{"key":["power-v1","12AU7","EL84","20","6.6","16",384000],"detector":{"real":19.244779389306863,"imaginary":1.24294751479227},"anchor":{"b0":0.08552122271632713,"b1":-0.08535587785092418,"a1":-1.9690815074433583,"a2":0.9692468523087613}},{"key":["power-v1","12AU7","EL84","20","8.0","4",352800],"detector":{"real":9.94374068629046,"imaginary":0.6355887721739738},"anchor":{"b0":0.09173915355234472,"b1":-0.09106825903801032,"a1":-1.9474744908984105,"a2":0.9481453854127448}},{"key":["power-v1","12AU7","EL84","20","8.0","8",352800],"detector":{"real":14.064931907078494,"imaginary":0.9017118590359371},"anchor":{"b0":0.09036820270974258,"b1":-0.0902163871544734,"a1":-1.9685020295011781,"a2":0.9686538450564474}},{"key":["power-v1","12AU7","EL84","20","8.0","15",352800],"detector":{"real":19.261407277058,"imaginary":1.2367217421550691},"anchor":{"b0":0.08828981972156377,"b1":-0.08812155070411139,"a1":-1.9739892646929689,"a2":0.9741575337104212}},{"key":["power-v1","12AU7","EL84","20","8.0","16",352800],"detector":{"real":19.892766088810475,"imaginary":1.2769997641926727},"anchor":{"b0":0.0940285773493412,"b1":-0.09382192423675986,"a1":-1.9686361501428045,"a2":0.9688428032553859}},{"key":["power-v1","12AU7","EL84","20","8.0","4",384000],"detector":{"real":9.967410036838228,"imaginary":0.6332897111213763},"anchor":{"b0":0.08105498810994809,"b1":-0.08076142617590608,"a1":-1.951534780703201,"a2":0.9518283426372431}},{"key":["power-v1","12AU7","EL84","20","8.0","8",384000],"detector":{"real":14.098416455294362,"imaginary":0.8984606546873167},"anchor":{"b0":0.08198597482615835,"b1":-0.08184316444716229,"a1":-1.942759619929531,"a2":0.9429024303085269}},{"key":["power-v1","12AU7","EL84","20","8.0","15",384000],"detector":{"real":19.307266302618885,"imaginary":1.232268331263875},"anchor":{"b0":0.08081347288496364,"b1":-0.08018332938662429,"a1":-1.9347778299809626,"a2":0.9354079734793019}},{"key":["power-v1","12AU7","EL84","20","8.0","16",384000],"detector":{"real":19.940127876787553,"imaginary":1.272400560897789},"anchor":{"b0":0.08081350796579839,"b1":-0.08073540366320174,"a1":-1.9461406313002798,"a2":0.9462187356028765}},{"key":["power-v1","12AU7","EL84","43","6.0","4",352800],"detector":{"real":7.534202250144624,"imaginary":0.4459425087247568},"anchor":{"b0":0.09211018320053288,"b1":-0.09195940968490564,"a1":-1.9706624979967589,"a2":0.9708132715123862}},{"key":["power-v1","12AU7","EL84","43","6.0","8",352800],"detector":{"real":10.65676804096602,"imaginary":0.6328109750852395},"anchor":{"b0":0.09249195200653801,"b1":-0.09243723394200574,"a1":-1.9762725791534708,"a2":0.976327297218003}},{"key":["power-v1","12AU7","EL84","43","6.0","15",352800],"detector":{"real":14.594058770738263,"imaginary":0.8680205961017785},"anchor":{"b0":0.08856127440888471,"b1":-0.08841212343296677,"a1":-1.9750395965514493,"a2":0.9751887475273674}},{"key":["power-v1","12AU7","EL84","43","6.0","16",352800],"detector":{"real":15.072428261585898,"imaginary":0.8962761561891575},"anchor":{"b0":0.08814283618776243,"b1":-0.08804597858959762,"a1":-1.9742539994315051,"a2":0.9743508570296698}},{"key":["power-v1","12AU7","EL84","43","6.0","4",384000],"detector":{"real":7.550164730678002,"imaginary":0.4451850279318926},"anchor":{"b0":0.082271354961994,"b1":-0.08208895278662752,"a1":-1.9626441115217446,"a2":0.962826513697111}},{"key":["power-v1","12AU7","EL84","43","6.0","8",384000],"detector":{"real":10.679349941890136,"imaginary":0.6317396085570861},"anchor":{"b0":0.08257281719075418,"b1":-0.08246739478621723,"a1":-1.978743004289856,"a2":0.9788484266943929}},{"key":["power-v1","12AU7","EL84","43","6.0","15",384000],"detector":{"real":14.624986017864204,"imaginary":0.8665522984074555},"anchor":{"b0":0.08833695389268491,"b1":-0.08822682444501713,"a1":-1.9711857972007962,"a2":0.9712959266484641}},{"key":["power-v1","12AU7","EL84","43","6.0","16",384000],"detector":{"real":15.104368966000331,"imaginary":0.8947599578085988},"anchor":{"b0":0.09080936604329053,"b1":-0.0905585268942962,"a1":-1.966283276359634,"a2":0.9665341155086283}},{"key":["power-v1","12AU7","EL84","43","6.6","4",352800],"detector":{"real":7.577742741179115,"imaginary":0.4447417235182177},"anchor":{"b0":0.08835485352133113,"b1":-0.08822915641192954,"a1":-1.9749475000738221,"a2":0.9750731971832237}},{"key":["power-v1","12AU7","EL84","43","6.6","8",352800],"detector":{"real":10.718354980949,"imaginary":0.6311243020863148},"anchor":{"b0":0.09536085695616534,"b1":-0.09523014825426451,"a1":-1.9750862266316134,"a2":0.9752169353335142}},{"key":["power-v1","12AU7","EL84","43","6.6","15",352800],"detector":{"real":14.678400574349453,"imaginary":0.8657188823821373},"anchor":{"b0":0.08925254925256411,"b1":-0.0890900005707974,"a1":-1.9738654204456425,"a2":0.9740279691274092}},{"key":["power-v1","12AU7","EL84","43","6.6","16",352800],"detector":{"real":15.159534543904119,"imaginary":0.8938978500252144},"anchor":{"b0":0.08871046605559511,"b1":-0.08864498436572613,"a1":-1.9716484589106966,"a2":0.9717139406005657}},{"key":["power-v1","12AU7","EL84","43","6.6","4",384000],"detector":{"real":7.593321158916973,"imaginary":0.444065809864596},"anchor":{"b0":0.08317919183626998,"b1":-0.08304739124048159,"a1":-1.9670274327382495,"a2":0.9671592333340381}},{"key":["power-v1","12AU7","EL84","43","6.6","8",384000],"detector":{"real":10.740393637039366,"imaginary":0.6301681632064327},"anchor":{"b0":0.08600799491903466,"b1":-0.08591171739915739,"a1":-1.9757924330027508,"a2":0.975888710522628}},{"key":["power-v1","12AU7","EL84","43","6.6","15",384000],"detector":{"real":14.708583825841737,"imaginary":0.8644082360241269},"anchor":{"b0":0.08224442525379312,"b1":-0.08221542324430688,"a1":-1.9691453724227244,"a2":0.9691743744322106}},{"key":["power-v1","12AU7","EL84","43","6.6","16",384000],"detector":{"real":15.19070691560924,"imaginary":0.8925444844094201},"anchor":{"b0":0.09139781154065003,"b1":-0.09131554626108934,"a1":-1.9759550217973079,"a2":0.9760372870768684}},{"key":["power-v1","12AU7","EL84","43","8.0","4",352800],"detector":{"real":7.614023949862068,"imaginary":0.4379862840604018},"anchor":{"b0":0.0889890086393235,"b1":-0.08892744913077782,"a1":-1.9568139056100602,"a2":0.956875465118606}},{"key":["power-v1","12AU7","EL84","43","8.0","8",352800],"detector":{"real":10.76967540465225,"imaginary":0.6215787238549679},"anchor":{"b0":0.09353091834680975,"b1":-0.0928861096929009,"a1":-1.941560511275977,"a2":0.942205319929886}},{"key":["power-v1","12AU7","EL84","43","8.0","15",352800],"detector":{"real":14.748683640620568,"imaginary":0.8526532787224886},"anchor":{"b0":0.09089512762812492,"b1":-0.09043054538292929,"a1":-1.9535566227706624,"a2":0.9540212050158582}},{"key":["power-v1","12AU7","EL84","43","8.0","16",352800],"detector":{"real":15.232121176021513,"imaginary":0.8804030645844299},"anchor":{"b0":0.09279068989880133,"b1":-0.09269391127059964,"a1":-1.959925236675908,"a2":0.9600220153041097}},{"key":["power-v1","12AU7","EL84","43","8.0","4",384000],"detector":{"real":7.628695137421646,"imaginary":0.43761831116161115},"anchor":{"b0":0.08285193011328591,"b1":-0.08275932090465453,"a1":-1.9789304332283644,"a2":0.9790230424369958}},{"key":["power-v1","12AU7","EL84","43","8.0","8",384000],"detector":{"real":10.790430750366966,"imaginary":0.6210578719725964},"anchor":{"b0":0.08842917155892926,"b1":-0.08838328643143765,"a1":-1.9766608954584748,"a2":0.9767067805859663}},{"key":["power-v1","12AU7","EL84","43","8.0","15",384000],"detector":{"real":14.777109463569586,"imaginary":0.8519386240725809},"anchor":{"b0":0.08418635424501418,"b1":-0.08406511623667104,"a1":-1.9763330003554413,"a2":0.9764542383637845}},{"key":["power-v1","12AU7","EL84","43","8.0","16",384000],"detector":{"real":15.261478449255154,"imaginary":0.8796652451543093},"anchor":{"b0":0.08351469686096519,"b1":-0.08340657052180395,"a1":-1.9785705983991981,"a2":0.9786787247383595}},{"key":["power-v1","12AU7","EL34","0","6.0","4",352800],"detector":{"real":11.660476113999227,"imaginary":0.6064034439391455},"anchor":{"b0":0.09001383126790265,"b1":-0.08993179882501204,"a1":-1.9731294707762745,"a2":0.9732115032191652}},{"key":["power-v1","12AU7","EL34","0","6.0","8",352800],"detector":{"real":16.49320743180165,"imaginary":0.8608949164561661},"anchor":{"b0":0.10103698913465396,"b1":-0.10084286754176934,"a1":-1.9719687840458249,"a2":0.9721629056387096}},{"key":["power-v1","12AU7","EL34","0","6.0","15",352800],"detector":{"real":22.58686709345955,"imaginary":1.1811439940870923},"anchor":{"b0":0.0954745177792865,"b1":-0.09543146728933412,"a1":-1.9716023241082854,"a2":0.9716453745982376}},{"key":["power-v1","12AU7","EL34","0","6.0","16",352800],"detector":{"real":23.327225693925993,"imaginary":1.2195556391621454},"anchor":{"b0":0.09939203097961155,"b1":-0.09926091041730022,"a1":-1.970854865362915,"a2":0.9709859859252263}},{"key":["power-v1","12AU7","EL34","0","6.0","4",384000],"detector":{"real":11.680568436480131,"imaginary":0.6060281376211549},"anchor":{"b0":0.08701003173649911,"b1":-0.08698012741169348,"a1":-1.9753684159784544,"a2":0.9753983203032601}},{"key":["power-v1","12AU7","EL34","0","6.0","8",384000],"detector":{"real":16.52163249667995,"imaginary":0.8603627888319575},"anchor":{"b0":0.08461292229971855,"b1":-0.08458400429175243,"a1":-1.97803964481769,"a2":0.9780685628256561}},{"key":["power-v1","12AU7","EL34","0","6.0","15",384000],"detector":{"real":22.62579737607083,"imaginary":1.180412686102575},"anchor":{"b0":0.08537421048459794,"b1":-0.08502281151836537,"a1":-1.9625004272827014,"a2":0.962851826248934}},{"key":["power-v1","12AU7","EL34","0","6.0","16",384000],"detector":{"real":23.367431640025742,"imaginary":1.2188007834717913},"anchor":{"b0":0.08189324361193207,"b1":-0.08175286918440958,"a1":-1.973113854730182,"a2":0.9732542291577045}},{"key":["power-v1","12AU7","EL34","0","6.6","4",352800],"detector":{"real":12.045339168411791,"imaginary":0.6301072872504604},"anchor":{"b0":0.09602932901749349,"b1":-0.09598283067940477,"a1":-1.9740153103836782,"a2":0.9740618087217668}},{"key":["power-v1","12AU7","EL34","0","6.6","8",352800],"detector":{"real":17.037577505983844,"imaginary":0.8945273839787823},"anchor":{"b0":0.09719643925603601,"b1":-0.09702994059791625,"a1":-1.9666188564576266,"a2":0.9667853551157464}},{"key":["power-v1","12AU7","EL34","0","6.6","15",352800],"detector":{"real":23.33236214351727,"imaginary":1.227274442522364},"anchor":{"b0":0.10623429161385581,"b1":-0.1061675330628622,"a1":-1.970382935033649,"a2":0.9704496935846426}},{"key":["power-v1","12AU7","EL34","0","6.6","16",352800],"detector":{"real":24.09715685391408,"imaginary":1.2671881210351126},"anchor":{"b0":0.09010462835679334,"b1":-0.0900053124270092,"a1":-1.9750630495074937,"a2":0.9751623654372777}},{"key":["power-v1","12AU7","EL34","0","6.6","4",384000],"detector":{"real":12.06588944985148,"imaginary":0.6297526262897608},"anchor":{"b0":0.08834932162303752,"b1":-0.08829405218106538,"a1":-1.9773462055250786,"a2":0.9774014749670505}},{"key":["power-v1","12AU7","EL34","0","6.6","8",384000],"detector":{"real":17.06665049201244,"imaginary":0.8940243998038577},"anchor":{"b0":0.0887663484925104,"b1":-0.08865879168144938,"a1":-1.9744575879305875,"a2":0.9745651447416485}},{"key":["power-v1","12AU7","EL34","0","6.6","15",384000],"detector":{"real":23.372179765415066,"imaginary":1.22658284782409},"anchor":{"b0":0.08412622696629252,"b1":-0.08401767791647068,"a1":-1.9736182360485726,"a2":0.9737267850983944}},{"key":["power-v1","12AU7","EL34","0","6.6","16",384000],"detector":{"real":24.138279195068385,"imaginary":1.2664743307737936},"anchor":{"b0":0.08267501187659256,"b1":-0.08264228153739718,"a1":-1.9693833725442316,"a2":0.9694161028834269}},{"key":["power-v1","12AU7","EL34","0","8.0","4",352800],"detector":{"real":12.809972680662074,"imaginary":0.6755358440245512},"anchor":{"b0":0.09346017661046702,"b1":-0.0923503041677018,"a1":-1.8650135404870087,"a2":0.8661234129297739}},{"key":["power-v1","12AU7","EL34","0","8.0","8",352800],"detector":{"real":18.119114882449416,"imaginary":0.9589916590951132},"anchor":{"b0":0.0943491542854144,"b1":-0.09308003488699676,"a1":-1.870153834656636,"a2":0.8714229540550537}},{"key":["power-v1","12AU7","EL34","0","8.0","15",352800],"detector":{"real":24.813488545615257,"imaginary":1.3156989280209062},"anchor":{"b0":0.09155827780700225,"b1":-0.09147333106538719,"a1":-1.8651899613916885,"a2":0.8652749081333037}},{"key":["power-v1","12AU7","EL34","0","8.0","16",352800],"detector":{"real":25.62683218469909,"imaginary":1.3584909856337797},"anchor":{"b0":0.1081539562210639,"b1":-0.10723953822490671,"a1":-1.8601042414081146,"a2":0.8610186594042719}},{"key":["power-v1","12AU7","EL34","0","8.0","4",384000],"detector":{"real":12.831342349836657,"imaginary":0.6752421829524237},"anchor":{"b0":0.09044255814940481,"b1":-0.09012625624712725,"a1":-1.964096311956466,"a2":0.9644126138587438}},{"key":["power-v1","12AU7","EL34","0","8.0","8",384000],"detector":{"real":18.1493471999839,"imaginary":0.9585747466748361},"anchor":{"b0":0.08625757318070926,"b1":-0.08619047009502391,"a1":-1.9770033373954792,"a2":0.9770704404811645}},{"key":["power-v1","12AU7","EL34","0","8.0","15",384000],"detector":{"real":24.85489400134249,"imaginary":1.315124989586182},"anchor":{"b0":0.08206763024736391,"b1":-0.08198069580194392,"a1":-1.9657985582211424,"a2":0.9658854926665623}},{"key":["power-v1","12AU7","EL34","0","8.0","16",384000],"detector":{"real":25.669594371083658,"imaginary":1.3578988014407505},"anchor":{"b0":0.08156886122405081,"b1":-0.08144235946579091,"a1":-1.9758156468678663,"a2":0.9759421486261262}},{"key":["power-v1","12AU7","EL34","20","6.0","4",352800],"detector":{"real":7.631896780692719,"imaginary":0.36161514225387636},"anchor":{"b0":0.08792147342947307,"b1":-0.08776959368402197,"a1":-1.9677553059683197,"a2":0.9679071857137708}},{"key":["power-v1","12AU7","EL34","20","6.0","8",352800],"detector":{"real":10.794976638929105,"imaginary":0.5135590355071932},"anchor":{"b0":0.09319532095355654,"b1":-0.09311964120253716,"a1":-1.9697276222522988,"a2":0.9698033020033181}},{"key":["power-v1","12AU7","EL34","20","6.0","15",352800],"detector":{"real":14.783347208259945,"imaginary":0.7047266899099509},"anchor":{"b0":0.08818707971213628,"b1":-0.08794178641727006,"a1":-1.9545807389258139,"a2":0.9548260322206802}},{"key":["power-v1","12AU7","EL34","20","6.0","16",352800],"detector":{"real":15.267918917882206,"imaginary":0.7276273608914412},"anchor":{"b0":0.090955807424926,"b1":-0.09085683929770262,"a1":-1.9611459870956198,"a2":0.9612449552228433}},{"key":["power-v1","12AU7","EL34","20","6.0","4",384000],"detector":{"real":7.642021927529044,"imaginary":0.3621211109279061},"anchor":{"b0":0.08850378829720248,"b1":-0.0882851459312488,"a1":-1.9670959776935188,"a2":0.9673146200594726}},{"key":["power-v1","12AU7","EL34","20","6.0","8",384000],"detector":{"real":10.80930151123546,"imaginary":0.5142731236170212},"anchor":{"b0":0.0900191047959714,"b1":-0.08977995378430043,"a1":-1.9689350404384305,"a2":0.9691741914501013}},{"key":["power-v1","12AU7","EL34","20","6.0","15",384000],"detector":{"real":14.802966461306614,"imaginary":0.7057023188552728},"anchor":{"b0":0.08613544107730803,"b1":-0.0860990085283085,"a1":-1.9728184916605334,"a2":0.9728549242095328}},{"key":["power-v1","12AU7","EL34","20","6.0","16",384000],"detector":{"real":15.288181011114276,"imaginary":0.7286353341463122},"anchor":{"b0":0.08501660545059143,"b1":-0.0849749104421254,"a1":-1.974234459724289,"a2":0.9742761547327551}},{"key":["power-v1","12AU7","EL34","20","6.6","4",352800],"detector":{"real":7.6891855165909195,"imaginary":0.3656179691978928},"anchor":{"b0":0.09087962986648546,"b1":-0.09072392946423927,"a1":-1.9593256641580603,"a2":0.9594813645603066}},{"key":["power-v1","12AU7","EL34","20","6.6","8",352800],"detector":{"real":10.876008592805318,"imaginary":0.5192365019836757},"anchor":{"b0":0.09613815485836591,"b1":-0.09606206024227419,"a1":-1.9696935806258944,"a2":0.9697696752419862}},{"key":["power-v1","12AU7","EL34","20","6.6","15",352800],"detector":{"real":14.894317505203317,"imaginary":0.7125124506081999},"anchor":{"b0":0.09744022667013483,"b1":-0.09723969928293097,"a1":-1.9712356460401241,"a2":0.9714361734273279}},{"key":["power-v1","12AU7","EL34","20","6.6","16",352800],"detector":{"real":15.38252668390174,"imaginary":0.7356668154889383},"anchor":{"b0":0.09357762270536389,"b1":-0.09349264591948744,"a1":-1.9743789436360308,"a2":0.9744639204219074}},{"key":["power-v1","12AU7","EL34","20","6.6","4",384000],"detector":{"real":7.699170711885273,"imaginary":0.3660541738571572},"anchor":{"b0":0.04544326975879502,"b1":-0.005596098324528933,"a1":-1.552537675754123,"a2":0.592384847188389}},{"key":["power-v1","12AU7","EL34","20","6.6","8",384000],"detector":{"real":10.890135560445882,"imaginary":0.5198516870953297},"anchor":{"b0":0.04544326975879502,"b1":-0.005596098324528933,"a1":-1.552537675754123,"a2":0.592384847188389}},{"key":["power-v1","12AU7","EL34","20","6.6","15",384000],"detector":{"real":14.913665688183062,"imaginary":0.7133526338794095},"anchor":{"b0":0.03924784848092864,"b1":-0.002345968473044665,"a1":-1.5534413858980625,"a2":0.5903432659059464}},{"key":["power-v1","12AU7","EL34","20","6.6","16",384000],"detector":{"real":15.402508783952738,"imaginary":0.7365349247016472},"anchor":{"b0":0.05048756566770173,"b1":-0.0073492723534165595,"a1":-1.561579384359726,"a2":0.6047176776740113}},{"key":["power-v1","12AU7","EL34","20","8.0","4",352800],"detector":{"real":7.753072134574564,"imaginary":0.37042399555881733},"anchor":{"b0":0.09021481759053895,"b1":-0.09014497571646578,"a1":-1.9729456652504056,"a2":0.9730155071244787}},{"key":["power-v1","12AU7","EL34","20","8.0","8",352800],"detector":{"real":10.966372910928788,"imaginary":0.5260516956162419},"anchor":{"b0":0.0915258128327883,"b1":-0.09142093098662737,"a1":-1.973844716973363,"a2":0.973949598819524}},{"key":["power-v1","12AU7","EL34","20","8.0","15",352800],"detector":{"real":15.018067977716525,"imaginary":0.7218575877470074},"anchor":{"b0":0.10033031880739511,"b1":-0.09998805274864041,"a1":-1.9616908367271755,"a2":0.96203310278593}},{"key":["power-v1","12AU7","EL34","20","8.0","16",352800],"detector":{"real":15.510333480583151,"imaginary":0.7453165813490049},"anchor":{"b0":0.08911706263054063,"b1":-0.08873345812908515,"a1":-1.9600488997197332,"a2":0.9604325042211886}},{"key":["power-v1","12AU7","EL34","20","8.0","4",384000],"detector":{"real":7.762693254511054,"imaginary":0.3707141536119272},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL34","20","8.0","8",384000],"detector":{"real":10.979984886866687,"imaginary":0.5264603403482683},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL34","20","8.0","15",384000],"detector":{"real":15.036710991524249,"imaginary":0.7224148002283706},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL34","20","8.0","16",384000],"detector":{"real":15.52958735989537,"imaginary":0.7458924538648126},"anchor":{"b0":0.036245422693190636,"b1":-0.004463432105167809,"a1":-1.6434499160677545,"a2":0.6752319066557773}},{"key":["power-v1","12AU7","EL34","43","6.0","4",352800],"detector":{"real":5.651758552271654,"imaginary":0.2523039083777186},"anchor":{"b0":0.08944162412297745,"b1":-0.08622169751162424,"a1":-1.8767769729655286,"a2":0.8799968995768819}},{"key":["power-v1","12AU7","EL34","43","6.0","8",352800],"detector":{"real":7.994163897335215,"imaginary":0.35840572793268},"anchor":{"b0":0.0919587675138037,"b1":-0.08983616755675018,"a1":-1.8823902424176948,"a2":0.8845128423747485}},{"key":["power-v1","12AU7","EL34","43","6.0","15",352800],"detector":{"real":10.947733911099085,"imaginary":0.49187961179616313},"anchor":{"b0":0.09006571280515886,"b1":-0.0876736086261123,"a1":-1.8783145255107416,"a2":0.8807066296897881}},{"key":["power-v1","12AU7","EL34","43","6.0","16",352800],"detector":{"real":11.306580694998997,"imaginary":0.5078551737072378},"anchor":{"b0":0.09855266171520342,"b1":-0.09764205851831406,"a1":-1.885115981371237,"a2":0.8860265845681264}},{"key":["power-v1","12AU7","EL34","43","6.0","4",384000],"detector":{"real":5.658123102651185,"imaginary":0.2537416393795569},"anchor":{"b0":0.0827103186238874,"b1":-0.08266853812834611,"a1":-1.9719172979489632,"a2":0.9719590784445044}},{"key":["power-v1","12AU7","EL34","43","6.0","8",384000],"detector":{"real":8.003168378397389,"imaginary":0.3604379169152863},"anchor":{"b0":0.08454442334268115,"b1":-0.08450689665789157,"a1":-1.9765013882313807,"a2":0.9765389149161702}},{"key":["power-v1","12AU7","EL34","43","6.0","15",384000],"detector":{"real":10.96006635836995,"imaginary":0.49466074113412567},"anchor":{"b0":0.08104976051938924,"b1":-0.08094607615113976,"a1":-1.966265243866185,"a2":0.9663689282344345}},{"key":["power-v1","12AU7","EL34","43","6.0","16",384000],"detector":{"real":11.319317203317915,"imaginary":0.5107277459106254},"anchor":{"b0":0.0834490009176401,"b1":-0.08341146571165378,"a1":-1.975402187917811,"a2":0.9754397231237971}},{"key":["power-v1","12AU7","EL34","43","6.6","4",352800],"detector":{"real":5.609374019896222,"imaginary":0.24884456529702542},"anchor":{"b0":0.08844206004641382,"b1":-0.0883172753658198,"a1":-1.9611228476993836,"a2":0.9612476323799775}},{"key":["power-v1","12AU7","EL34","43","6.6","8",352800],"detector":{"real":7.934213256417002,"imaginary":0.3535012238740321},"anchor":{"b0":0.08822275868581622,"b1":-0.08815841132440899,"a1":-1.9752356679214547,"a2":0.975300015282862}},{"key":["power-v1","12AU7","EL34","43","6.6","15",352800],"detector":{"real":10.865633842040536,"imaginary":0.48515515341331533},"anchor":{"b0":0.09178863845605204,"b1":-0.09173199946243041,"a1":-1.9747360769757805,"a2":0.9747927159694022}},{"key":["power-v1","12AU7","EL34","43","6.6","16",352800],"detector":{"real":11.221789447440143,"imaginary":0.500911432957575},"anchor":{"b0":0.08951478573753528,"b1":-0.08925748758128314,"a1":-1.9678049629626,"a2":0.9680622611188521}},{"key":["power-v1","12AU7","EL34","43","6.6","4",384000],"detector":{"real":5.61551416635489,"imaginary":0.25082290759583975},"anchor":{"b0":0.08507766546113561,"b1":-0.0842760205487845,"a1":-1.8656709801727291,"a2":0.8664726250850803}},{"key":["power-v1","12AU7","EL34","43","6.6","8",384000],"detector":{"real":7.942900130627687,"imaginary":0.3562979555910597},"anchor":{"b0":0.08664549274731166,"b1":-0.0858539705139392,"a1":-1.8870839296281985,"a2":0.8878754518615708}},{"key":["power-v1","12AU7","EL34","43","6.6","15",384000],"detector":{"real":10.877531232582454,"imaginary":0.4889832282275669},"anchor":{"b0":0.08342289835910398,"b1":-0.08149154836189426,"a1":-1.876994754524143,"a2":0.8789261045213528}},{"key":["power-v1","12AU7","EL34","43","6.6","16",384000],"detector":{"real":11.234076723411642,"imaginary":0.5048652816659029},"anchor":{"b0":0.09098507249516102,"b1":-0.08957574644654376,"a1":-1.8899050023856838,"a2":0.891314328434301}},{"key":["power-v1","12AU7","EL34","43","8.0","4",352800],"detector":{"real":5.488739871712618,"imaginary":0.23018822765247904},"anchor":{"b0":0.08777010063520166,"b1":-0.0877333724928441,"a1":-1.9470357849914222,"a2":0.9470725131337796}},{"key":["power-v1","12AU7","EL34","43","8.0","8",352800],"detector":{"real":7.763585192309981,"imaginary":0.327079820721622},"anchor":{"b0":0.09023006710536433,"b1":-0.09016223849275419,"a1":-1.9708820587806497,"a2":0.9709498873932599}},{"key":["power-v1","12AU7","EL34","43","8.0","15",352800],"detector":{"real":10.631966985485494,"imaginary":0.44894938751097896},"anchor":{"b0":0.09063302322485414,"b1":-0.09057218230130648,"a1":-1.9607778234164737,"a2":0.9608386643400213}},{"key":["power-v1","12AU7","EL34","43","8.0","16",352800],"detector":{"real":10.980463118265424,"imaginary":0.46352202495873407},"anchor":{"b0":0.09122339446786111,"b1":-0.09115366563767571,"a1":-1.9445228807152812,"a2":0.9445926095454668}},{"key":["power-v1","12AU7","EL34","43","8.0","4",384000],"detector":{"real":5.494328333954217,"imaginary":0.2362591990485195},"anchor":{"b0":0.09059590011115083,"b1":-0.08485628937945751,"a1":-1.7895297013765599,"a2":0.7952693121082534}},{"key":["power-v1","12AU7","EL34","43","8.0","8",384000],"detector":{"real":7.771490495259672,"imaginary":0.3356652746514667},"anchor":{"b0":0.09059590011115083,"b1":-0.08485628937945751,"a1":-1.7895297013765599,"a2":0.7952693121082534}},{"key":["power-v1","12AU7","EL34","43","8.0","15",384000],"detector":{"real":10.642793284348809,"imaginary":0.46070493280060976},"anchor":{"b0":0.09059590011115083,"b1":-0.08485628937945751,"a1":-1.7895297013765599,"a2":0.7952693121082534}},{"key":["power-v1","12AU7","EL34","43","8.0","16",384000],"detector":{"real":10.991644259061735,"imaginary":0.47566323217762585},"anchor":{"b0":0.09059590011115083,"b1":-0.08485628937945751,"a1":-1.7895297013765599,"a2":0.7952693121082534}}],"el34Dc":{"supplyGroundV":443.775,"centerTapGroundV":432.7883259568532,"plateGroundV":430.00029753434393,"screenTapGroundV":430.62597709173843,"screenGroundV":425.62053079635257,"cathodeGroundV":31.759498956373246,"plateCathodeV":398.2407985779707,"screenCathodeV":393.8610318399793,"iaA":0.0625679557394508,"ig2A":0.005005446295385893,"quiescentPlateDissipationW":24.91711265907001,"maximumDcResidualA":0}});
// __TUBE_PHASE_C_REFERENCE_TABLES_INJECT_END__

function deriveTubeSimulatorPrivateCircuit(fields17) {
    if (fields17.os === 'Line') {
        return Object.freeze({ circuitProfileId: 'line-v2' });
    }
    if (fields17.os !== 'Power') {
        throw new TypeError('Invalid Tube Simulator output circuit.');
    }
    const row = TUBE_SIMULATOR_POWER_PROFILE_ROWS.find(candidate =>
        candidate[0] === fields17.pt && candidate[1] === fields17.st &&
        candidate[2] === fields17.zp);
    const speakerRlc = TUBE_SIMULATOR_SPEAKER_PROFILES[fields17.sl];
    const tube = TUBE_SIMULATOR_POWER_TUBE_COMPONENTS[fields17.pt];
    if (!row || !speakerRlc || !tube) {
        throw new TypeError('Invalid Tube Simulator power circuit selection.');
    }
    const primaryImpedanceOhm = Number(fields17.zp) * 1000;
    const speakerLoadOhm = Number(fields17.sl);
    return Object.freeze({
        circuitProfileId:
            `power-v1-${fields17.pt.toLowerCase()}-${fields17.st}-${fields17.zp.replace('.', '_')}`,
        ltpRc: Object.freeze({
            tube: '12AX7', plateResistanceOhm: 100000, tailResistanceOhm: 47000,
            inputCouplingCapacitanceF: 1e-7
        }),
        gridRc: tube.gridRc,
        cathodeRc: tube.cathodeRc,
        screenSupplyRc: Object.freeze({
            seriesResistanceOhm: 1000,
            capacitanceF: 0.000016
        }),
        powerSupplyRc: tube.powerSupplyRc,
        outputTubeLutId: tube.outputTubeLutId,
        optCoefficients: Object.freeze({
            order: 2,
            primaryCenterToTapResistanceOhm: row[3],
            primaryTapToPlateResistanceOhm: row[4],
            magnetizingInductanceH: row[5],
            leakageInductanceH: row[6],
            interwindingCapacitanceF: row[7],
            coreLossResistanceOhm: row[8],
            resonanceHz: row[9],
            dampingRatio: row[10],
            feedbackDampingCoupling: row[11]
        }),
        speakerRlc,
        nfbTapNode: 'fixed-secondary-feedback-winding',
        nfbTapTurnsRatio: tube.nfbTapTurnsRatio,
        nfbPolarity: -1,
        screenTapRatio: Number(fields17.st) / 100,
        primaryImpedanceOhm,
        speakerLoadOhm,
        selectedSpeakerTurnsRatio: Math.sqrt(primaryImpedanceOhm / speakerLoadOhm)
    });
}
const TUBE_SIMULATOR_TRAJECTORY_FRAMES = 96;
const TUBE_SIMULATOR_VISIBLE_TRAJECTORY_FRAMES = 6;
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

    function evaluateGrid(state, vgk) {
        const table = state.tables[state.tubeIndex].gridCurrent;
        if (vgk <= table.minimum) return { current: 0, derivative: 0 };
        const grid = evaluateHermite(table, vgk);
        return { current: grid[0], derivative: grid[1] };
    }

    function evaluatePlate(state, vgk, vak) {
        return evaluatePlateTables(state.tables[state.tubeIndex], vgk, vak);
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
            slowCounter: 0, powerWindowSamples: 0
        };
    }

    // Power-branch circuit constants. Called from exactly one place - applyCircuitAndControlTargets,
    // which every commit path already goes through - so a commit pays for it once, and never at all
    // while the branch is Line, where none of the results are read.
    function applyPowerParameters(state, decoded) {
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
        return decoded.powerTube === 1 ? { ia: 0.0625, ig2: 0.005 } : { ia: 0.035, ig2: 0.004 };
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
            : (state.parameters.powerTube === 1 ? 425 : 300);
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

    function decodeParameters(source) {
        const tubeIndex = ['12AX7', '12AT7', '12AU7'].indexOf(source.tp);
        const outputStage = ['Line', 'Power'].indexOf(source.os ?? 'Line');
        const powerTube = ['EL84', 'EL34'].indexOf(source.pt ?? 'EL84');
        const screenTap = ['0', '20', '43'].indexOf(source.st ?? '0');
        const primaryImpedance = ['6.0', '6.6', '8.0'].indexOf(source.zp ?? '8.0');
        const speakerLoad = ['4', '8', '15', '16'].indexOf(source.sl ?? '8');
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
            autoGainReduction: autoGainSource !== false && autoGainSource !== 0
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
            decoded.inputReference > 20 ||
            !Number.isFinite(decoded.feedbackDb) || decoded.feedbackDb < 0 ||
            decoded.feedbackDb > 30 || outputStage < 0 || powerTube < 0 ||
            !Number.isFinite(decoded.powerBPlus) || decoded.powerBPlus < 300 ||
            decoded.powerBPlus > 470 ||
            !Number.isFinite(decoded.cathodeResistor) ||
            decoded.cathodeResistor < 270 || decoded.cathodeResistor > 500 ||
            screenTap < 0 || primaryImpedance < 0 || speakerLoad < 0 ||
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
        const tube = TUBES[tubeIndex];
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
        const safetyUser = Math.pow(10, decoded.safetyTrimDb / 20);
        state.controls.driveTarget = drive;
        state.controls.outputTarget = output;
        state.controls.mixTarget = mix;
        state.controls.safetyUserTarget = safetyUser;
        if (resetControls) {
            state.controls.drive = drive;
            state.controls.output = output;
            state.controls.mix = mix;
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
        const calibration = feedbackCalibration(
            decoded.tubeIndex,
            decoded.feedbackDb
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
            const driver = ['12AX7', '12AT7', '12AU7'][decoded.tubeIndex];
            const powerTube = ['EL84', 'EL34'][decoded.powerTube];
            const screenTap = ['0', '20', '43'][decoded.screenTap];
            const primary = ['6.0', '6.6', '8.0'][decoded.primaryImpedance];
            const speakerLoad = ['4', '8', '15', '16'][decoded.speakerLoad];
            const family = K.internalRate === 352800 ? 352800 : 384000;
            const record = POWER_TABLES.a0.find(candidate =>
                candidate.key[1] === driver && candidate.key[2] === powerTube &&
                candidate.key[3] === screenTap && candidate.key[4] === primary &&
                candidate.key[5] === speakerLoad && candidate.key[6] === family
            );
            if (record !== undefined) {
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
        const tube = TUBES[state.tubeIndex];
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
                autoGainReduction: decoded.autoGainReduction
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
        return left.feedbackDb !== right.feedbackDb ||
            left.tubeIndex !== right.tubeIndex ||
            left.outputStage !== right.outputStage ||
            left.powerTube !== right.powerTube ||
            left.screenTap !== right.screenTap;
    }

    // Number of the twenty parameter values that differ. Used only by the safety-reduction
    // reset rule, which needs to tell one control write from a whole-record write. Written out
    // term by term rather than looped over a field list, because a list literal would allocate on
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
        if (left.outputStage !== right.outputStage) ++count;
        if (left.powerTube !== right.powerTube) ++count;
        if (left.powerBPlus !== right.powerBPlus) ++count;
        if (left.cathodeResistor !== right.cathodeResistor) ++count;
        if (left.screenTap !== right.screenTap) ++count;
        if (left.primaryImpedance !== right.primaryImpedance) ++count;
        if (left.speakerLoad !== right.speakerLoad) ++count;
        if (left.actualLoadOhm !== right.actualLoadOhm) ++count;
        if (left.safetyTrimDb !== right.safetyTrimDb) ++count;
        if (left.autoGainReduction !== right.autoGainReduction) ++count;
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
    }

    function trialEligibleChanged(left, right) {
        return resetClassChanged(left, right) ||
            left.biasPercent !== right.biasPercent ||
            left.plateV !== right.plateV ||
            left.sourceZKOhm !== right.sourceZKOhm ||
            left.supplyKOhm !== right.supplyKOhm ||
            left.inputReference !== right.inputReference ||
            left.powerBPlus !== right.powerBPlus ||
            left.cathodeResistor !== right.cathodeResistor ||
            left.primaryImpedance !== right.primaryImpedance ||
            left.speakerLoad !== right.speakerLoad ||
            left.actualLoadOhm !== right.actualLoadOhm;
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
        // changed, or two or more of the twenty parameter values changed in one commit.
        //
        // The count is the discriminator between a knob and a preset. A control commits one key
        // at a time, so an ordinary move differs in exactly one value and protection is kept; a
        // preset writes the whole circuit at once and always differs in at least two. That second
        // condition is what makes a preset load clear the reduction even though the preset
        // carries the default safety trim of 0 dB, which on its own would be no change at all.
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
        const tube = TUBES[state.tubeIndex];
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
        // Exact partial derivative of the bounded trilinear model with respect to Vak, taken from
        // the same eight taps. The plate reaches the model through the plate axis and through its
        // share of the control voltage, so both paths are accumulated; above the knee the control
        // path is the whole of the plate resistance. It replaces the shifted finite-difference
        // interpolation the Newton step used to need.
        let iaPlateDerivative = 0;
        let iaControlDerivative = 0;
        const plateInverseStep = plate[1] === plate[0] ? 0 : tube.plateCathodeInverseStep[plate[1]];
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
                // The two derivative weights differ from the interpolation weight only by which
                // axis factor is replaced with that axis slope, so both are hoisted out of the
                // screen loop and the inner body keeps a single extra multiply-add over a plain
                // trilinear tap.
                const controlPlateWeight = cw * pw;
                const plateSlopeWeight = cw * plateSlope;
                const controlSlopeWeight = pw * controlSlope;
                for (let sx = 0; sx < 2; ++sx) {
                    const si = sx === 0 ? screen[0] : screen[1];
                    const sw = sx === 0 ? 1 - screen[2] : screen[2];
                    const index = ((ci * plateCount + pi) * screenCount + si) * 2;
                    const iaValue = values[index];
                    const screenScaled = iaValue * sw;
                    ia += screenScaled * controlPlateWeight;
                    ig2 += values[index + 1] * controlPlateWeight * sw;
                    iaPlateDerivative += screenScaled * plateSlopeWeight;
                    iaControlDerivative += screenScaled * controlSlopeWeight;
                }
            }
        }
        return {
            ia,
            ig2,
            iaPlateDerivative:
                iaPlateDerivative + iaControlDerivative * tube.inversePlateAmplificationFactor
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
    // The emf is taken in the same sample. The trapezoidal companion of the transformer series
    // branch is a resistor in series with a history source, so the branch current is an affine
    // function of the ampere-turn drive the two tubes produce, and substituting it leaves the plate
    // voltage as the only unknown - the existing three-step Newton keeps solving one scalar
    // equation and gains no iteration. A one-sample-late emf would instead close a loop of gain
    // halfPrimaryReflectedOhm/rp around the tube, which passes one for an ultra-linear connection
    // and for any tube driven into its knee. The opposite tube's share of the drive is the only
    // term left on the previous sample; its fixed-point gain is Zr*G/(1 + (Rw + Zr)*G), below one
    // for every tube conductance G, so the sequential push-then-pull structure stays stable
    // unconditionally.
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
        for (let iteration = 0; iteration < 3; ++iteration) {
            seriesCurrent = (signedDriveOhm * (drive - oppositeDrive) - history) *
                opt.inverseSeriesCoefficient;
            induced = signedReflectedOhm * seriesCurrent;
            screen = opt.distributedScreenTap
                ? screenTapVoltage(
                    opt, induced, evaluation.ia, evaluation.ig2, power.bPlusRamp.applied
                ) - evaluation.ig2 * opt.screenSeriesResistanceOhm
                : power.screenRamp.applied;
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
        screen = opt.distributedScreenTap
            ? screenTapVoltage(
                opt, induced, evaluation.ia, evaluation.ig2, power.bPlusRamp.applied
            ) - evaluation.ig2 * opt.screenSeriesResistanceOhm
            : power.screenRamp.applied;
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
            const screenSource = (state.parameters.powerBPlus - 20) /
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
        const newMagnetizing = (source +
            opt.magnetizingHistoryCoefficient * oldMagnetizing) *
            opt.inverseMagnetizingCoefficient;
        const midpointCurrent = 0.5 * (oldCurrent + newCurrent);
        const midpointMagnetizing = 0.5 * (oldMagnetizing + newMagnetizing);
        const oldEnergy = 0.5 * opt.leakageInductanceH * oldCurrent * oldCurrent +
            0.5 * opt.seriesCapacitanceF * oldCapacitor * oldCapacitor +
            0.5 * opt.magnetizingInductanceH * oldMagnetizing * oldMagnetizing;
        const newEnergy = 0.5 * opt.leakageInductanceH * newCurrent * newCurrent +
            0.5 * opt.seriesCapacitanceF * newCapacitor * newCapacitor +
            0.5 * opt.magnetizingInductanceH * newMagnetizing * newMagnetizing;
        const residual = source * (midpointCurrent + midpointMagnetizing) -
            opt.effectiveResistanceOhm * midpointCurrent * midpointCurrent -
            opt.coreLossResistanceOhm * midpointMagnetizing * midpointMagnetizing -
            (newEnergy - oldEnergy) * opt.inverseFastDt;
        state.maximumEnergyResidual = Math.max(
            state.maximumEnergyResidual, Math.abs(residual)
        );
        power.optCurrentA = newCurrent;
        power.optCapacitorV = newCapacitor;
        power.magnetizingCurrentA = newMagnetizing;
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

    function advancePower(state, channel, input) {
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
        let wiper = wiperSource * ltp.inverseWiperConductanceOpen;
        let ltpGridA = wiper - power.ltpInputCapV;
        let ltpGridCurrent = 0;
        if (ltpGridA > ltpCathode0) {
            wiper = (wiperSource +
                ltp.inverseGridStopper * (power.ltpInputCapV + ltpCathode0)) *
                ltp.inverseWiperConductanceConducting;
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
        const push = solvePowerPlate(state, channel, true, previousPullDrive);
        const pull = solvePowerPlate(state, channel, false, previousPushDrive);
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
        const primarySource = (push.drive - pull.drive) * opt.primaryDriveOhm;
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
            (state.parameters.outputStage === 1 ? 0 : state.controls.plateReference);
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
            state.parameters.outputStage === 1
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
            (state.parameters.outputStage === 1
                ? state.power[0].feedbackV
                : state.fast[0].stage[1].plateVoltage -
                    state.controls.plateReference);
        const feedbackRight = state.controls.feedbackBeta *
            (state.parameters.outputStage === 1
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
        const safetyUser = new Float64Array(frameCount);
        for (let frame = 0; frame < frameCount; ++frame) {
            state.controls.drive += state.controls.coefficient *
                (state.controls.driveTarget - state.controls.drive);
            state.controls.output += state.controls.coefficient *
                (state.controls.outputTarget - state.controls.output);
            state.controls.mix += state.controls.coefficient *
                (state.controls.mixTarget - state.controls.mix);
            state.controls.safetyUser += state.controls.coefficient *
                (state.controls.safetyUserTarget - state.controls.safetyUser);
            driveGain[frame] = state.controls.drive;
            outputGain[frame] = state.controls.output;
            wetMix[frame] = state.controls.mix;
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
            if (state.parameters.outputStage === 1) {
                // The whole forward path of this sample is evaluated before the compensator, so
                // the tap the compensator subtracts is this sample's, not the previous one's.
                // See advanceDriverOutput.
                for (let channel = 0; channel < K.channels; ++channel) {
                    const driver = advanceDriverOutput(state, channel);
                    const driverSafetyHit = state.stepSafetyHit;
                    const powered = advancePower(state, channel, driver);
                    observeFeedback(state, channel);
                    const error = applyFeedback(
                        state, channel, internalInput[channel][index]);
                    state.stepSafetyHit = driverSafetyHit;
                    internalOutput[channel][index] =
                        advanceDriverInput(state, channel, error) ? powered : 0;
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

        // Opening circuit: the EL84 Pentode @2% listening preset.
        this.dr = -55.9648;
        this.tp = '12AX7';
        this.bi = 0;
        this.pv = 250;
        this.sz = 10;
        this.su = 10;
        this.og = 4.626;
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
        this.trajectories = {
            stage1LeftX: new Float32Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES),
            stage1LeftY: new Float32Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES),
            stage1RightX: new Float32Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES),
            stage1RightY: new Float32Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES),
            stage2LeftX: new Float32Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES),
            stage2LeftY: new Float32Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES),
            stage2RightX: new Float32Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES),
            stage2RightY: new Float32Array(TUBE_SIMULATOR_TRAJECTORY_FRAMES)
        };
        this.hudAxes = null;
        this.hudCharacteristics = null;
        this.hudAxesRevision = 0;
        this.hudVisible = true;
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
        this.selectedTab = 'input';
        this._controls = {};
        // Parameter key whose own control originated the setParameters() call
        // currently in flight; that row is left alone while it is being edited.
        this._syncOriginKey = null;
        this._powerDimmableRows = [];
        this.hudValues = {};
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspTubeTelemetry = frame => this.handleDspTubeTelemetry(frame);

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
            params: { ...preset.params }
        }));
    }

    derivePrivateCircuit(parameters = this.getParameters()) {
        return deriveTubeSimulatorPrivateCircuit(parameters);
    }

    applyCanonicalPreset(id) {
        const preset = TUBE_SIMULATOR_SELECTABLE_PRESETS.find(candidate => candidate.id === id);
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
            TUBE_SIMULATOR_PARAMETER_FIELDS.every(key => this[key] === preset.params[key]) &&
            this.rl === Number(preset.params.sl))?.id || '';
    }

    _syncPresetControl() {
        // No preset match resolves to the inert "Custom" option (value '').
        const select = this.presetControl;
        if (!select) return;
        select.value = this._matchingCanonicalPresetId();
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
        this._syncPowerSectionDimming();
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

    _syncPowerSectionDimming() {
        const dimmed = this.os !== 'Power';
        for (const row of this._powerDimmableRows || []) {
            row?.classList?.toggle?.('tube-simulator-dimmed', dimmed);
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
        setNumber('iv', 0.1, 20);
        setNumber('nf', 0, 30);
        setNumber('pb', 300, 470);
        setNumber('kr', 270, 500);
        setNumber('rl', 2, 32);
        setNumber('sg', -96, 0);

        if (params.ag !== undefined) {
            this.ag = params.ag !== false;
        }

        if (params.tp !== undefined && ['12AX7', '12AT7', '12AU7'].includes(params.tp)) {
            this.tp = params.tp;
        }
        for (const key of ['os', 'pt', 'st', 'zp', 'sl']) {
            if (params[key] !== undefined && TUBE_SIMULATOR_ENUM_ABI[key].values.includes(params[key])) {
                this[key] = params[key];
            }
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled !== false;
        }

        if (previousAxisSignature !== this._hudAxisSignature()) {
            this._recalculateHudAxes();
            this._clearTrajectories();
        }
        this.updateParameters();
        this._syncPresetControl();
        this._syncControlsFromState();
        this._updateHudValues();
        this._refreshHudState();
    }

    setEnabled(enabled) {
        super.setEnabled(enabled);
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

    _hudAxisSignature() {
        return this.os === 'Power'
            ? `${this.os}:${this.pt}:${this.pb}:${this.st}:${this.zp}:${this.sl}`
            : `${this.os}:${this.tp}:${this.bi}:${this.pv}:${this.sz}:${this.su}`;
    }

    _recalculateHudAxes() {
        if (this.os === 'Power') {
            const primaryImpedanceOhm = Number(this.zp) * 1000;
            const loadLineCurrent = 2 * this.pb / primaryImpedanceOhm;
            const makeTicks = (minimum, maximum, count) =>
                Array.from({ length: count }, (_, index) =>
                    minimum + (maximum - minimum) * index / (count - 1));
            this.hudAxes = {
                xMin: 0,
                xMax: this.pb,
                yMin: 0,
                yMax: loadLineCurrent * 1.25,
                xTicks: makeTicks(0, this.pb, 5),
                yTicks: makeTicks(0, loadLineCurrent * 1.25, 5)
            };
            this.hudCharacteristics = {
                plateCurves: [],
                loadLine: {
                    xValues: new Float32Array([0, this.pb]),
                    yValues: new Float32Array([loadLineCurrent, 0])
                }
            };
            this.hudAxesRevision++;
            return;
        }
        const profile = TUBE_SIMULATOR_HUD_PROFILES[this.tp] ||
            TUBE_SIMULATOR_HUD_PROFILES['12AX7'];
        const plateScale = this.pv / 250;
        const loadLineCurrent = this.pv / profile.plateResistance;
        const currentMaximum = Math.max(profile.iaMax * plateScale, loadLineCurrent * 1.1);
        const makeTicks = (minimum, maximum, count) =>
            Array.from({ length: count }, (_, index) =>
                minimum + (maximum - minimum) * index / (count - 1));
        this.hudAxes = {
            xMin: 0,
            xMax: this.pv,
            yMin: 0,
            yMax: currentMaximum,
            xTicks: makeTicks(0, this.pv, 5),
            yTicks: makeTicks(0, currentMaximum, 5)
        };
        this.hudCharacteristics = {
            plateCurves: profile.vgkSteps.map(vgk => {
                const xValues = new Float32Array(TUBE_SIMULATOR_HUD_CURVE_POINTS);
                const yValues = new Float32Array(TUBE_SIMULATOR_HUD_CURVE_POINTS);
                for (let index = 0; index < TUBE_SIMULATOR_HUD_CURVE_POINTS; index++) {
                    const vak = this.pv * index / (TUBE_SIMULATOR_HUD_CURVE_POINTS - 1);
                    xValues[index] = vak;
                    yValues[index] = evaluateTubeSimulatorHudPlateCurrent(profile, vgk, vak);
                }
                return { vgk, xValues, yValues };
            }),
            loadLine: {
                xValues: new Float32Array([0, this.pv]),
                yValues: new Float32Array([loadLineCurrent, 0])
            }
        };
        this.hudAxesRevision++;
    }

    _clearTrajectories() {
        this.trajectoryIndex = 0;
        this.trajectoryCount = 0;
        for (const values of Object.values(this.trajectories)) values.fill(0);
    }

    _appendTrajectory(telemetry) {
        const index = this.trajectoryIndex;
        const traces = this.trajectories;
        if (this.os === 'Power') {
            traces.stage1LeftX[index] = telemetry.left.powerPlatePushV;
            traces.stage1LeftY[index] = telemetry.left.powerIaPushA;
            traces.stage1RightX[index] = telemetry.right.powerPlatePushV;
            traces.stage1RightY[index] = telemetry.right.powerIaPushA;
            traces.stage2LeftX[index] = telemetry.left.powerPlatePullV;
            traces.stage2LeftY[index] = telemetry.left.powerIaPullA;
            traces.stage2RightX[index] = telemetry.right.powerPlatePullV;
            traces.stage2RightY[index] = telemetry.right.powerIaPullA;
        } else {
            traces.stage1LeftX[index] = telemetry.left.vak1;
            traces.stage1LeftY[index] = telemetry.left.ia1;
            traces.stage1RightX[index] = telemetry.right.vak1;
            traces.stage1RightY[index] = telemetry.right.ia1;
            traces.stage2LeftX[index] = telemetry.left.vak2;
            traces.stage2LeftY[index] = telemetry.left.ia2;
            traces.stage2RightX[index] = telemetry.right.vak2;
            traces.stage2RightY[index] = telemetry.right.ia2;
        }
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
            this.hudValues.stage1ExternalInput.textContent = `${stage1Input.toFixed(3)} Vpk`;
        }
        const telemetry = this.latestTelemetry;
        if (!telemetry) return;
        const { left, right } = telemetry;
        if (this.hudValues.stage1Bias) {
            this.hudValues.stage1Bias.textContent = this._formatStereo(left.vk1, right.vk1);
        }
        if (this.hudValues.stage2Bias) {
            this.hudValues.stage2Bias.textContent = this._formatStereo(left.vk2, right.vk2);
        }
        if (this.hudValues.bPlus) {
            this.hudValues.bPlus.textContent = this._formatStereo(left.vbPlus, right.vbPlus);
        }
        // One stage per cell. Packed into a single cell the four stereo pairs wrapped, which
        // pushed the label onto two lines and made the row taller than every other one.
        //
        // Three integer digits: the sag is a plate voltage measured against B+, and both are
        // bounded by the Plate supply, whose range tops out at 300 V. The sign flips - it is a
        // few hundred millivolts positive on some Power branches and well over a hundred volts
        // negative on others - so the sign column is always occupied.
        if (this.hudValues.plateSag1) {
            this.hudValues.plateSag1.textContent = this._formatStereoFixed(
                left.vak1 + left.vk1 - left.vbPlus,
                right.vak1 + right.vk1 - right.vbPlus,
                'V', 2, 3);
        }
        if (this.hudValues.plateSag2) {
            this.hudValues.plateSag2.textContent = this._formatStereoFixed(
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
        // One integer digit: core flux swings symmetrically about zero and stays well inside a
        // weber - the largest measured here is 0.29 Wb on an EL34 at 470 V - so only the sign
        // column and the six decimals ever move, and both are now fixed.
        if (this.hudValues.transformerFlux) {
            this.hudValues.transformerFlux.textContent = this._formatStereoFixed(
                left.transformerFluxWb,
                right.transformerFluxWb,
                'Wb',
                6,
                1
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
        this._appendTrajectory(this.latestTelemetry);
        this._updateHudValues();
        this.hudTelemetryRevision = this.latestTelemetryRevision;
    }

    _hudStatusText() {
        if (this.enabled === false) return 'Tube Simulator is disabled.';
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
            // The app never sets the document lang attribute; its resolved UI language lives on
            // uiManager. Hosts without the app shell (tests, node) have none and read as English.
            const japanese = globalThis.window?.uiManager?.userLanguage === 'ja';
            if (this.circuitFault.cause === 'feedbackOscillation') {
                return japanese
                    ? '現在の回路設定で、真空管回路モデルにNegative Feedbackによる帰還発振が検出されました。回路出力をミュートし、エフェクトをバイパスしました。Negative Feedbackを下げるか、回路設定を初期値に戻してください。'
                    : 'With the current circuit settings, feedback oscillation was detected in the simulated tube circuit. The circuit output was muted and the effect was bypassed. Reduce Negative Feedback or restore the default circuit settings.';
            }
            return japanese
                ? '真空管回路モデルを安全に処理できなかったため、エフェクトをバイパスしました。回路設定を初期値に戻してから、エフェクトを読み込み直してください。'
                : 'The simulated tube circuit could not be processed safely, so the effect was bypassed. Restore the default circuit settings, then reload the effect.';
        }
        // The safety reduction is applied automatically, so it is always stated - including when
        // it is zero, so that the mechanism is visible before it has ever acted. The language
        // follows the app's resolved UI language on uiManager; hosts without the app shell
        // (tests, node) have none and read as English.
        const japanese = globalThis.window?.uiManager?.userLanguage === 'ja';
        const reduction = this._safetyReductionDb();
        const safety = reduction < 0
            ? (japanese
                ? `出力保護のため出力を ${(-reduction).toFixed(1)} dB 自動的に下げています。この低減は自動では戻りません。Output Safety Trim を操作すると解除されます。`
                : `Output safety reduction: ${(-reduction).toFixed(1)} dB applied automatically. It is never restored on its own; move Output Safety Trim to clear it.`)
            : (japanese
                ? '出力保護による自動低減: 0.0 dB。'
                : 'Output safety reduction: 0.0 dB.');
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

    _drawHud() {
        const canvas = this.hudCanvas;
        const context = canvas?.getContext?.('2d');
        if (!context || !this.hudAxes) return;
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

        const gap = (narrow ? 12 : 20) * dpr;
        const margin = {
            left: (narrow ? 48 : 58) * dpr,
            right: 8 * dpr,
            top: (narrow ? 24 : 26) * dpr,
            bottom: (narrow ? 44 : 48) * dpr
        };
        const panelWidth = (width - margin.left - margin.right - gap) / 2;
        const panelHeight = height - margin.top - margin.bottom;
        if (panelWidth <= 0 || panelHeight <= 0) return;
        this._drawOperatingPointPanel(context, {
            x: margin.left,
            y: margin.top,
            width: panelWidth,
            height: panelHeight,
            dpr,
            narrow,
            showYLabels: true,
            title: this.os === 'Power' ? 'Push' : 'Stage 1',
            leftX: this.trajectories.stage1LeftX,
            leftY: this.trajectories.stage1LeftY,
            rightX: this.trajectories.stage1RightX,
            rightY: this.trajectories.stage1RightY
        });
        this._drawOperatingPointPanel(context, {
            x: margin.left + panelWidth + gap,
            y: margin.top,
            width: panelWidth,
            height: panelHeight,
            dpr,
            narrow,
            showYLabels: false,
            title: this.os === 'Power' ? 'Pull' : 'Stage 2',
            leftX: this.trajectories.stage2LeftX,
            leftY: this.trajectories.stage2LeftY,
            rightX: this.trajectories.stage2RightX,
            rightY: this.trajectories.stage2RightY
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
            panel.narrow
        );
        this._drawTrajectory(
            context,
            panel.rightX,
            panel.rightY,
            mapX,
            mapY,
            TUBE_SIMULATOR_HUD_COLORS.right,
            panel.dpr,
            panel.narrow
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

    _drawTrajectory(context, xValues, yValues, mapX, mapY, color, dpr = 1, narrow = false) {
        if (this.trajectoryCount === 0) return;
        const visibleCount = Math.min(
            this.trajectoryCount,
            TUBE_SIMULATOR_VISIBLE_TRAJECTORY_FRAMES
        );
        const first = (this.trajectoryIndex - visibleCount +
            TUBE_SIMULATOR_TRAJECTORY_FRAMES) % TUBE_SIMULATOR_TRAJECTORY_FRAMES;
        // Points, not a polyline. The samples are telemetry frames, not a continuous curve, so
        // joining them drew segments through operating points the valve never passed through -
        // and across the whole plot whenever the ring wrapped. Every point goes into one path and
        // is filled once, the way Stereo Meter plots its samples.
        // Twice the size Stereo Meter uses: it plots a dense cloud of audio samples, while these
        // are sparse telemetry frames that were hard to see at one device pixel.
        const size = (narrow ? 4 : 2) * dpr;
        const offset = size * 0.5;
        context.beginPath();
        for (let index = 0; index < visibleCount; index++) {
            const ringIndex = (first + index) % TUBE_SIMULATOR_TRAJECTORY_FRAMES;
            context.rect(
                mapX(xValues[ringIndex]) - offset,
                mapY(yValues[ringIndex]) - offset,
                size,
                size
            );
        }
        context.fillStyle = color;
        context.fill();
    }

    _createPresetControl() {
        const row = document.createElement('div');
        row.className = 'parameter-row tube-simulator-preset-row';
        const selectId = `${this.id}-${this.name}-preset-select`;

        const labelElement = document.createElement('label');
        labelElement.textContent = 'Preset:';
        labelElement.htmlFor = selectId;

        const select = document.createElement('select');
        select.id = selectId;
        select.name = selectId;
        select.autocomplete = 'off';

        const custom = document.createElement('option');
        custom.value = '';
        custom.textContent = 'Custom';
        select.appendChild(custom);

        for (const group of TUBE_SIMULATOR_PRESET_GROUPS) {
            const presets = group.presets || [];
            if (presets.length === 0) continue;
            const optionGroup = document.createElement('optgroup');
            optionGroup.label = group.label;
            for (const preset of presets) {
                const option = document.createElement('option');
                option.value = preset.id;
                option.textContent = preset.label;
                optionGroup.appendChild(option);
            }
            select.appendChild(optionGroup);
        }

        select.value = this._matchingCanonicalPresetId();
        select.addEventListener('change', event => {
            // "Custom" is a status-only option: selecting it changes no
            // parameter, so the dropdown snaps straight back to whatever the
            // current state actually matches instead of lying about it.
            const id = event.target.value;
            if (!id) {
                this._syncPresetControl();
                return;
            }
            this.applyCanonicalPreset(id);
        });

        row.appendChild(labelElement);
        row.appendChild(select);
        this.presetControl = select;
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

        const linear = (key, label, min, max, step, unit) => {
            const row = this.createParameterControl(
                label, min, max, step, this[key],
                value => this._commitParameter(key, value), unit
            );
            this._controls[key] = { kind: 'linear', row, min, max, step };
            return row;
        };
        const logarithmic = (key, label, min, max, step, unit) => {
            const row = this.createLogarithmicParameterControl(
                label, min, max, step, this[key],
                value => this._commitParameter(key, value), unit
            );
            this._controls[key] = { kind: 'log', row, min, max, step };
            return row;
        };
        const enumeration = (key, label, options) => {
            const row = this.createRadioGroup(
                label, options, this[key],
                value => this._commitParameter(key, value)
            );
            this._controls[key] = { kind: 'enum', row };
            return row;
        };
        const checkbox = (key, label) => {
            const row = this.createCheckboxControl(
                label, this[key],
                value => this._commitParameter(key, value)
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
                content.appendChild(logarithmic('iv', 'Input Reference', 0.1, 20, 0.001, 'Vpk'));
                content.appendChild(logarithmic('sz', 'Source Z', 0.6, 100, 0.1, 'kΩ'));
            } },
            { id: 'driver', label: 'Driver', create: content => {
                content.appendChild(enumeration('tp', 'Tube', ['12AX7', '12AT7', '12AU7']));
                content.appendChild(linear('bi', 'Bias', -50, 50, 1, '%'));
                content.appendChild(linear('pv', 'Plate', 150, 300, 1, 'V'));
                content.appendChild(logarithmic('su', 'Supply', 0.1, 47, 0.1, 'kΩ'));
                content.appendChild(linear('nf', 'Negative Feedback', 0, 30, 0.5, 'dB'));
            } },
            // The Power tab is split along the boundary the circuit itself has: the valves and
            // the supply that feeds them on one side, and everything they drive - the transformer
            // and the speaker hanging off its secondary - on the other. Output Circuit stays with
            // the valves because it is the branch switch rather than a component value, and it is
            // the one row that is never dimmed.
            { id: 'power', label: 'Power', create: content => {
                content.appendChild(enumeration('os', 'Output Circuit', abiOptions('os')));
                // Dimmed (but never disabled) while Output Circuit is Line:
                // the values stay live and serialized.
                this._powerDimmableRows = [
                    enumeration('pt', 'Power Tubes', abiOptions('pt')),
                    linear('pb', 'Output B+', 300, 470, 0.001, 'V'),
                    linear('kr', 'Cathode Resistor', 270, 500, 1, 'Ω / valve')
                ];
                for (const row of this._powerDimmableRows) content.appendChild(row);
            } },
            { id: 'transformer', label: 'Transformer', create: content => {
                // Assumed Speaker Load picks the secondary tap the amplifier is designed around,
                // so it belongs with the transformer; Actual Speaker Load is what is really
                // hanging off that tap.
                const rows = [
                    enumeration('st', 'Screen Tap', abiOptions('st')),
                    enumeration('zp', 'Transformer Primary', abiOptions('zp')),
                    enumeration('sl', 'Assumed Speaker Load', abiOptions('sl')),
                    logarithmic('rl', 'Actual Speaker Load', 2, 32, 0.1, 'Ω')
                ];
                for (const row of rows) content.appendChild(row);
                this._powerDimmableRows.push(...rows);
            } },
            { id: 'output', label: 'Output', create: content => {
                content.appendChild(linear('og', 'Output Trim', -48, 48, 0.1, 'dB'));
                content.appendChild(
                    this._prepareSafetyTrimRow(
                        linear('sg', 'Output Safety Trim', -96, 0, 0.1, 'dB')));
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
        this._powerDimmableRows = [];

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
        this.hudCanvas.setAttribute(
            'aria-label',
            'Tube plate curves, load lines, and operating-point trajectories for the left and right channels'
        );
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
        container.appendChild(this.hudGraph.container);
        container.appendChild(values);
        container.appendChild(status);
        this._syncPowerSectionDimming();

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
        this.presetControl = null;
        this._controls = {};
        this._powerDimmableRows = [];
        this.hudValues = {};
        super.cleanup();
    }
}

window.TubeSimulatorPlugin = TubeSimulatorPlugin;
