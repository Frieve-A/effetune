// Tape Artifacts — analogue reel-to-reel record / reproduce chain.
//
// Signal chain (host rate; only the saturation stage runs 2x oversampled):
//   input trim -> record pre-emphasis -> record amp band limit
//   -> tape saturation, 2x (split-ceiling algebraic sigmoid with short-time memory)
//   -> makeup (the exact inverse of the input trim)
//   -> bias-dependent HF loss -> playback wavelength loss x head trim
//   -> transport wow/flutter (fractional delay) -> head bump
//   -> reproduce post-emphasis -> DC block -> hiss + modulation noise
//   -> output gain -> dry/wet mix (against a delay-aligned dry tap)
//
// The record pre-emphasis and the reproduce post-emphasis are exact digital
// inverses of each other, the head alignment trim is the bounded exact inverse
// of the playback loss — so their product is simply one pole per loss term —
// and the makeup is the exact inverse of the input trim, so the gain of the
// linear chain does not depend on the Record Level setting. That invariance is
// the designed property, not unity itself — the chain is not flat at 0.000 dB.
// On Standard tape at 96 kHz and at the reference bias, 1 kHz measures
// -0.030 / +0.001 / +0.019 dB at 7.5 / 15 / 30 ips; on Master, whose thicker
// coating puts the thickness corner lower, it is -0.043 / -0.003 / +0.018 dB.
// Bias is what that condition is carrying, and it is the largest term of the
// four: swept across its own range it moves those same figures by 0.47 dB at
// 7.5 ips, 0.21 dB at 15 ips and 0.09 dB at 30 ips on Standard, and by 0.60 dB
// on Master at 7.5 ips. It does not move them monotonically - the extremes are
// the sensitivity peak and the top of the control, so on Standard at 7.5 ips
// the figure runs from +0.162 dB at bs = -5.0 to -0.307 dB at bs = +6, and the
// two ends of the control are only 0.44 dB apart between them. The host rate
// moves each of them by less than 0.007 dB across 44.1 - 192 kHz, so it is the
// one term of the four not worth stating beside the speed, the formulation and
// the bias.
//
// Measuring the Record Level invariance means measuring through the saturator,
// so what a measurement returns is a property of the test amplitude rather than
// of the chain: a 1 kHz tone at 1e-4 peak (-80 dBFS, small enough that the
// saturator is linear) moves by less than 1e-7 dB across the whole Record Level
// range anywhere on the rate x speed x tape grid, while the same sweep at
// -20 dBFS moves 0.03 dB and at full scale 2.49 dB. The saturator is outside
// the claim. It is the one stage allowed to change the level, and the loudness
// a high Record Level setting costs is its compression, not a leftover trim.
// Everything else a stage changes is either character (what the saturator is
// fed) or a deliberate residual — the bounded part of the loss, which is what
// those few hundredths of a dB are. The trim is folded into the reproduce side
// deliberately: driving the nonlinearity with the full record trim put audible
// folded products in band.
//
// What Record Level does move, one dB for one dB, is the signal-to-noise ratio.
// The noise is a property of the tape and of the machine, so it is fixed in the
// flux domain the datasheet columns are written in, not at some absolute
// digital level: the hiss amplitude carries the makeup with it, and recording
// hotter therefore buries it exactly as it does on the machine. Base Hiss is
// consequently a flux level (dB re 320 nWb/m, which is what the BNIEC column
// already is) rather than a dBFS floor, and the dBFS the floor actually lands
// on is the status line's business. The modulation noise takes no such
// correction: it is injected as (1 + n), and (makeup·s)(1 + n) is
// makeup·(s(1 + n)) exactly, so a multiplicative index is already invariant
// under any linear gain.

// Published tape speeds. `v` is metres/second, `bumpDb` the head contour ripple
// height (v1 §3.4: 1.5 dB at 19.05 cm/s, 0.8 dB at 38.1 cm/s; 76.2 cm/s follows
// the same power law).
const TAPE_ARTIFACTS_SPEEDS = {
    '7.5': { v: 0.1905, bumpDb: 1.5 },
    '15': { v: 0.381, bumpDb: 0.8 },
    '30': { v: 0.762, bumpDb: 0.43 }
};

// Formulations. `coating` is the coating thickness in metres, `headroomDb` the
// extra saturation headroom, `bniecDb` the bias noise level, `dcnDb` the DC
// noise level and `deltaS10Db` the sensitivity drop that defines the
// recommended bias. The two noise figures are dB relative to the 320 nWb/m IEC
// reference flux and are indexed by the tape speed selector, i.e. they are the
// datasheet's own 19.05 / 38.1 / 76.2 cm/s columns read off one by one. No
// speed law is fitted to them: the published BNIEC column is not monotonic in
// speed on either formulation (on both, 38.1 cm/s is the noisiest of the three
// and 76.2 cm/s the quietest, so the column rises and then falls as the speed
// goes up), and any power law therefore disagrees with the source it claims to
// come from. The DCN columns do fall monotonically with speed, but they are
// read off one by one for the same reason.
const TAPE_ARTIFACTS_TAPES = {
    // RTM SM468 technical data: coating thickness, BNIEC (bias noise, IEC 94,
    // A-weighted), DCN (DC noise, weighted) and dS10 columns.
    Standard: {
        coating: 14.5e-6,
        headroomDb: 0.0,
        bniecDb: { '7.5': -64.0, '15': -62.5, '30': -64.5 },
        dcnDb: { '7.5': -56.0, '15': -57.0, '30': -60.0 },
        deltaS10Db: { '7.5': 5.0, '15': 4.0, '30': 1.5 }
    },
    // RTM SM900 technical data, same columns. It differs from SM468 on dS10
    // only at 19.05 cm/s.
    Master: {
        coating: 17.5e-6,
        headroomDb: 3.0,
        bniecDb: { '7.5': -63.0, '15': -62.0, '30': -66.0 },
        dcnDb: { '7.5': -58.0, '15': -59.0, '30': -59.5 },
        deltaS10Db: { '7.5': 6.5, '15': 4.0, '30': 1.5 }
    }
};

// Published wow-and-flutter tolerance of the reference deck, peak weighted
// according to DIN 45507 / IEC Publ. 386, at 19.05 / 38.1 / 76.2 cm/s (Studer
// A820 MCH MkII operating and service manual, electrical data). The 38.1 cm/s
// entry is the scale the transport depths are set to and is what Base
// Wow/Flutter names; the other two are the figures TRANSPORT_DEPTH_EXPONENT is
// fitted to reproduce. The processor is handed the reference entry from here,
// so the two cannot drift apart.
const TAPE_ARTIFACTS_WOW_FLUTTER_PERCENT = { '7.5': 0.06, '15': 0.04, '30': 0.03 };

// The bottom of the Hiss control, and the value at or below which the noise
// generator is switched off outright. The control is a flux level now, so what
// the last step before off measures at the output depends on the Record Level:
// 26.5 dB under the datasheet floor of the reference configuration either way,
// which lands between about -76 and -107 dBFS across the Record Level range
// (the loud end measured at -76.2 dBFS A-weighted: Master, 15 ips, hs -88.9,
// rl -12).
//
// The loud end is NOT below a 16 bit dither floor — that comparison was true
// of the old -110 dBFS constant and did not survive the change of unit, since
// 16 bit TPDF dither sits near -93 dBFS RMS. The threshold is justified on
// audibility instead: -76 dBFS A-weighted is about 24 dB SPL(A) on a
// 0 dBFS = 100 dB SPL calibration, so the last step into the hard off is
// inaudible, which is all the threshold has to buy.
const TAPE_ARTIFACTS_HISS_OFF_DB = -89;
// The IEC reference flux the datasheet noise columns - and therefore the Hiss
// control and the Record Level readout - are quoted against.
const TAPE_ARTIFACTS_REFERENCE_FLUX = '320 nWb/m';

const TAPE_ARTIFACTS_REFERENCE_PROCESSOR = `
    if (!parameters.enabled) return data;

    const blockSize = parameters.blockSize;
    const channelCount = parameters.channelCount;
    const sampleRate = parameters.sampleRate;
    if (!(blockSize > 0) || !(channelCount > 0) || !(sampleRate > 0)) return data;

    const targetMix = parameters.mx * 0.01;
    // mx = 0 must be a bit-for-bit dry path.
    if (!(targetMix > 0) && (!context.tapeArtifacts ||
        !context.tapeArtifacts.automationInitialized ||
        (context.tapeArtifacts.mix === 0 && context.tapeArtifacts.mixTarget === 0))) return data;

    const SPEEDS = ${JSON.stringify(TAPE_ARTIFACTS_SPEEDS)};
    const TAPES = ${JSON.stringify(TAPE_ARTIFACTS_TAPES)};

    const TWO_PI = 6.283185307179586;
    // Record pre-emphasis. This is the shape the record amplifier actually
    // impresses on the tape: flat through the midrange, lifting the top octaves
    // so that they survive the playback wavelength losses. It is NOT the NAB
    // reproducing characteristic - the 3180 us term of that curve models the
    // playback head's differentiation and the reproduce amplifier's integrator,
    // neither of which is applied to the signal on its way onto the tape.
    // Driving the saturator through the full NAB tilt made the nonlinearity
    // high-frequency-only (40 Hz compressed 0.06 dB against 19.6 dB at 8 kHz)
    // and turned the input trim into a loudness control.
    const RECORD_PRE_CORNER_HZ = 3000;
    const RECORD_PRE_GAIN = 3.1622776601683795; // +10 dB of top-octave lift
    const EQ_REFERENCE_HZ = 1000;
    // Reproduce head gap and head-to-tape spacing. The two are sourced
    // differently and the difference is worth keeping visible. The 3 um gap is
    // the datasheet's own measurement condition - both sheets state a 7 um
    // record / 3 um playback gap under their measurement conditions, so it is
    // the head the published columns were measured through. The spacing is not
    // a datasheet quantity and neither sheet carries one: 0.25 um is a typical
    // effective magnetic spacing for a lapped contact head in service, chosen
    // to sit inside the published band for one rather than solved for anything
    // here.
    const PLAY_GAP_METERS = 3e-6;
    const SPACING_METERS = 0.25e-6;
    // Effective contact length of the reproduce head (head bump).
    const CONTACT_LENGTH_METERS = 4.8e-3;
    const HEAD_BUMP_Q = 0.72;
    // Record amplifier band limit, 2-pole Butterworth.
    const RECORD_BANDWIDTH_HZ = 20000;
    // Head alignment trim: the bounded inverse of the playback wavelength loss.
    // Because the trim and the loss are the same corner, their product is one
    // pole per term at TRIM_MAX_GAIN times the loss corner, which is all that
    // survives in the reproduce path.
    const TRIM_MAX_GAIN = 7.943282347242816; // +18 dB
    // -3 dB points of the analytic loss terms, as a multiple of v / (2 pi x).
    const THICKNESS_THREE_DB = 0.742;
    const GAP_THREE_DB = 1.3916;
    const SPACING_THREE_DB = 0.3454;
    // Saturation reference. The operating level is a 1 kHz sine whose peak
    // reaches SATURATION_REFERENCE_DBFS at the saturator input, which is what
    // the Record Level control is referred to: a 0 dBFS peak lands Record Level
    // decibels above it. SATURATION_REFERENCE_T is where that peak sits on
    // the normalised transfer, and it is solved for so that the third harmonic
    // at the operating level measures 0.12 % - the third harmonic distortion
    // factor at RLIEC of the Standard tape at 38.1 cm/s.
    // (RTM SM468 technical data, THD column at RLIEC.)
    //
    // MOL1/1 then falls out at +12.95 dB against the published +12.0 dB. MOL is
    // an output quantity, so that is the reproduce level, measured against the
    // reproduce level at RLIEC: driving 13.97 dB above the operating level is
    // what brings the third harmonic to 3 %, and the output there is 1.02 dB
    // below the drive because the tape is already compressing.
    //
    // That agreement is a check and not a second fit. The third harmonic
    // *distortion factor* of this transfer is proportional to the square of the
    // amplitude - THD3 / A^2 measured constant to 5.3 % from -6 to +14 dB about
    // the operating level, while the harmonic amplitude itself goes as A^3 and
    // H3 / A^2 therefore runs over a factor of nine across the same span. So
    // pinning THD3 at the operating level already pins the level at which it
    // reaches 3 %: the A^2 law alone puts that at 13.977 dB of drive against
    // the 13.972 dB measured. Nothing was left free to make MOL land where it
    // does.
    const SATURATION_REFERENCE_DBFS = -18;
    const SATURATION_REFERENCE_PEAK = Math.pow(10, SATURATION_REFERENCE_DBFS / 20);
    const SATURATION_REFERENCE_T = 0.1157;
    // The datasheet noise figures are quoted against an RMS reference flux, so
    // the operating level has to be handed to them as the RMS of that sine
    // rather than as its peak.
    const OPERATING_LEVEL_RMS_DBFS = SATURATION_REFERENCE_DBFS - 20 * Math.log10(Math.SQRT2);
    // The hiss level of the reference configuration - Standard tape at
    // 38.1 cm/s - as a flux, which is to say the datasheet's own BNIEC entry
    // for it and nothing else. Base Hiss is measured in the same unit, so
    // setting the control to this value is what states the reference tape, and
    // the offset between the two is what reaches every other configuration.
    // Read from the serialised table rather than written out, so there is no
    // second place for the column to disagree with itself.
    const HISS_REFERENCE_DB = TAPES.Standard.bniecDb['15'];
    const HISS_OFF_DB = ${TAPE_ARTIFACTS_HISS_OFF_DB};
    // Asymmetry as a ratio, not as a fixed additive offset: the negative
    // excursion sees a ceiling this much higher than the positive one, so the
    // even-order content rises with level instead of vanishing as the tape is
    // driven harder, which is what a fixed pre-offset did. It does not hold a
    // constant ratio to the odd-order content - on a full-scale 1 kHz tone
    // H2 - H3 runs from -11.5 dB at the bottom of the Record Level range to
    // -14.5 dB at the top, and keeps widening past it, because any bounded
    // nonlinearity squares up towards a symmetric limiter and pushes its
    // asymmetry into DC. Third order dominant and widening is the tape
    // behaviour; H2 falling with level was not.
    const SATURATION_ASYMMETRY = 0.12;
    const MEMORY_DEPTH = 0.25;
    const MEMORY_ATTACK_SECONDS = 0.002;
    const MEMORY_RELEASE_SECONDS = 0.015;
    // A single blocker, placed after the reproduce post-emphasis so that it
    // does not sit on top of the head bump. It only has to remove the
    // saturator's asymmetry offset, which the post-emphasis no longer lifts.
    const DC_BLOCK_HZ = 5;
    // Bias. Two linear terms, both wavelength phenomena and so both referred
    // to v, plus the saturation ceiling further down.
    //
    // Erasure of short wavelengths slides a low-pass corner: more bias, duller.
    // On its own that cannot make under-bias *brighter* than the reference,
    // because a unity-DC low-pass is at best flat - the whole negative half of
    // the control was tonally dead (+0.34 dB at 16 kHz at bs = -6 against
    // -1.01 dB at bs = +6, 15 ips / 96 kHz, so a factor of three between the
    // two halves).
    //
    // The second term is the short-wavelength sensitivity, and it is where the
    // reference bias comes from. Raising the bias does two opposing things to
    // it: the recording gets more efficient, and it reaches deeper into the
    // coating, where the shortest wavelengths cancel between layers. The
    // product peaks below the bias the midrange wants, which is why under-bias
    // is the classic bright and dirty setting - and the manufacturer's bias
    // procedure is written around that peak. Record 10 kHz at -20 dB, find the
    // peak of the sensitivity curve S10, then raise the bias until playback has
    // fallen by dS10; that point is the recommended bias, and it is what the
    // datasheet's own bias sweeps plot at 0 dB. (RTM SM468 / SM900 technical
    // data, Ref 1.6; dS10 is a published column per speed.) So the shelf gain
    // is not monotonic in b any more: it is a peak in dB whose height is solved
    // for - per speed, per formulation and per host rate - so that the drop
    // from the peak to bs = 0 is the published dS10. bs = 0 stops being a
    // definition and becomes the point the datasheet procedure lands on.
    //
    // The peak sits at -sqrt(dS10 / BIAS_PEAK_CURVATURE). Nothing published
    // gives its position, so a single curvature carries all six cases and the
    // dS10 column carries every speed and formulation difference; the curvature
    // is set so that all six peaks stay inside the control's own range, which
    // puts 38.1 cm/s at -4.47 dB. Under-biasing past the peak makes the top
    // darker again, as it does on the machine.
    //
    // BIAS_SHELF_HZ moved up from 5 kHz when the shelf took on a
    // datasheet-sized excursion. A shelf swinging 9 dB about a 5 kHz corner
    // leaves 1.1 dB of it at 2 kHz at 38.1 cm/s and 3.0 dB at 19.05 cm/s, which
    // is a tone control, not a bias trim. At 12 kHz the most the shelf leaves at
    // 2 kHz anywhere in the control's range is 0.93 dB at 19.05 cm/s, 0.49 dB at
    // 38.1 cm/s and 0.27 dB at 76.2 cm/s - measured at 96 kHz on Standard tape,
    // which is the configuration the rest of this file's figures are quoted at.
    // These grow slowly with the host rate and with the Master formulation, and
    // 96 kHz is not the worst of the 24 rate x speed x tape cells: the largest
    // of them is 1.12 dB, at 192 kHz on Master at 19.05 cm/s. 76.2 cm/s is the
    // one that pays for the move: 0.17 dB before, 0.27 dB now.
    const BIAS_CORNER_HZ = 60000;
    const BIAS_CORNER_EXPONENT = 1.1;
    const BIAS_SHELF_HZ = 12000;
    // dB of S10 between the peak and bs = 0, per dB of peak offset squared. It
    // is a chord coefficient and not a local curvature: the law between the two
    // points is the hyperbola set up further down, so close to the peak the
    // drop is far steeper than a parabola of this coefficient, and the ratio
    // between the two falls the whole way out to the far end of the chord. At
    // 38.1 cm/s on Standard tape at 96 kHz it is three to four and a half times
    // the parabola between half a decibel and a full decibel off the peak
    // (0.22 dB half a decibel away against 0.05 dB), twice it at two decibels,
    // and exactly once it at bs = 0 where the chord ends - which is the one
    // point the coefficient is defined at. There the chord is exact: the drop
    // from the peak to bs = 0 comes out at dS10 to better than 1e-7 dB in all
    // 24 rate x speed x tape cells, which is the only thing the design asks of
    // it.
    const BIAS_PEAK_CURVATURE = 0.2;
    // The peak is rounded over half a decibel of bias either side, which is as
    // fine as the published sweeps and the meter-and-ear procedure resolve.
    const BIAS_PEAK_WIDTH_DB = 0.5;
    // Far outside the control's range the law is a straight line in dB, and an
    // unbounded shelf gain drags the section's pole down onto DC. The processor
    // does not clamp bs, so the gain is clamped instead: 40 dB keeps the pole
    // within a decade of the corner at any value it can be handed.
    const BIAS_SHELF_LIMIT_DB = 40;
    // The test tone the bias procedure itself uses.
    const BIAS_PROBE_HZ = 10000;
    // Transport modulation, referred to 38.1 cm/s. Base Wow/Flutter is a
    // deviation in percent, peak weighted according to DIN 45507 / IEC Publ.
    // 386 - the quantity a transport's data sheet publishes - and it names the
    // deviation at 38.1 cm/s, so the depths below are the scale at which the
    // reference deck's published figure for that speed comes out. The two are
    // scaled together because no deck publishes wow and flutter separately, so
    // equal scaling is the only assumption the sources support.
    const WOW_FLUTTER_REFERENCE_PERCENT = ${TAPE_ARTIFACTS_WOW_FLUTTER_PERCENT['15']};
    const WOW_RATE_HZ = 0.55;
    const WOW_SECONDS = 59.741e-6;
    const FLUTTER_CORNER_HZ = 10;
    const FLUTTER_SECONDS = 2.8676e-6;
    // A fixed mechanical eccentricity e produces a time error e / v, so the
    // deflection in seconds would scale as 1 / v while the rate scales as v,
    // leaving the percentage deviation independent of the speed selector. Real
    // decks do better than that as they speed up - the same manual publishes
    // 0.06 / 0.04 / 0.03 % at 19.05 / 38.1 / 76.2 cm/s - so the depth carries an
    // exponent, and the exponent's whole job is to carry those three published
    // figures across the speed selector. 38.1 cm/s is the anchor: it is the
    // reference that fixes the overall scale, so it does not depend on the
    // exponent at all, and the other two speeds are what the exponent is fitted
    // to.
    //
    // How closely the output then lands on the published law is set by the
    // measurement, not by the fit. Three DIN 45507 quasi-peak meters, between
    // them four readings of the same processor output - two of the four are two
    // demodulation paths through one instrument - put the 76.2 / 38.1 cm/s ratio
    // at 0.704, 0.714, 0.715 and 0.747 against the published 0.75, a spread of
    // 6 %, and a single 60 s pass of any one of them spreads 10 to 17 %. No
    // residual quoted here would mean anything below that, so none is quoted:
    // this constant is the fit to the published law, and the published law is
    // what the Wow/Flutter readout states.
    const TRANSPORT_DEPTH_EXPONENT = 1.318;
    // Large enough that the deepest case - 19.05 cm/s at the top of the Base
    // Wow/Flutter range - has never been observed to reach the deviation clamp.
    // There the wow term alone is 76 % of the clamp and the flutter term is a
    // random process on top of it, so the margin is small, and what is left of
    // it is an extreme-value estimate rather than a bound: 24 seeds x 60 s at
    // 44.1 / 48 / 96 / 192 kHz put the worst excursion at 89.7 % of the clamp,
    // and the worst of a set of draws can only rise, so spending more
    // seed-minutes keeps pushing it up and it settles on no value at all - when
    // the control stopped at 0.5 % and this delay was half as long, which is
    // the same geometry, families of that size landed anywhere from 91 to 97 %.
    // Quoting any one of those draws would be quoting the protocol rather than
    // the model. What every run agrees on is the part that matters: no clamp
    // hit, at any rate, in any of them.
    //
    // This delay is what the top of the control costs. The deviation the model
    // asks for is fixed by the calibration, so a top of 1 % needs twice the
    // room a top of 0.5 % needed, and it is charged as latency to every setting
    // including the ones that need none. Clamping instead would flat-top the
    // wow sine rather than deepen it.
    const TRANSPORT_BASE_SECONDS = 0.005;
    const DELAY_LENGTH = 4096;
    const DELAY_MASK = 4095;
    // 23-tap Kaiser (beta = 5) half-band, used both ways around the saturation
    // stage. Passband droop 0.5 dB at 0.4 x Nyquist, stopband -25 dB at the
    // first fold point, and better than -55 dB everywhere the fold lands below
    // 15 kHz. That last figure is the worst of the supported host rates and it
    // is rate-dependent: -55.0 dB at 44.1 kHz and -57.7 dB at 48 kHz, against
    // -68 dB at 96 kHz and -70 dB at 192 kHz, because the lower the host rate
    // the further into the transition band a fold onto 15 kHz reaches. Its
    // polyphase form makes the odd branch a pure delay.
    const OS_H1 = 0.31238803284111993;
    const OS_H3 = -0.089587837502923581;
    const OS_H5 = 0.039210420871375766;
    const OS_H7 = -0.016676371213684291;
    const OS_H9 = 0.0057277622021075980;
    const OS_H11 = -0.0010620071979954024;
    const OS_HISTORY = 16;
    const OS_MASK = 15;
    // Group delay of the interpolate / decimate pair, in host samples.
    const OS_LATENCY = 11;
    // Hiss band limits and modulation-noise correlation length.
    const HISS_HIGH_PASS_HZ = 60;
    const HISS_LOW_PASS_HZ = 12000;
    const MODULATION_LENGTH_METERS = 180e-6;
    const NOISE_SPEED_REFERENCE = 0.381;
    // IEC 61672 A-weighting, in its analytic pole-and-zero form. The datasheet
    // bias noise figure is an A-weighted measurement (IEC 651), so the hiss has
    // to be normalised through the same weighting to mean what the datasheet
    // says. The curve is only ever evaluated when a setting changes, so this
    // costs nothing per sample.
    const A_WEIGHTING_F1 = 20.598997;
    const A_WEIGHTING_F2 = 107.65265;
    const A_WEIGHTING_F3 = 737.86223;
    const A_WEIGHTING_F4 = 12194.217;
    const A_WEIGHTING_REFERENCE_HZ = 1000;
    // Points in the noise-shaping integral. Fine enough to resolve the
    // A-weighting curve at the bottom of the band, where it moves fastest.
    const NOISE_INTEGRATION_POINTS = 4096;
    // 2^-31. The draw source is an unsigned 32 bit word, so this scale maps it
    // onto [0, 2) and the -1 at each use site onto [-1, 1) - the range every
    // level calibration in this file assumes (uniformRms = 1/sqrt(3)).
    const RNG_SCALE = 4.656612873077393e-10;

    // Anything below this is 600 dB under full scale; treating it as zero is
    // inaudible and it is the only way a geometric decay ever reaches zero.
    const DENORMAL_THRESHOLD = 1e-30;

    const SECTION_RECORD_EQ = 0;
    const SECTION_BIAS = 1;
    const SECTION_BIAS_SHELF = 2;
    const SECTION_LOSS_A = 3;
    const SECTION_LOSS_B = 4;
    const SECTION_REPRODUCE_EQ = 5;
    const SECTION_HISS_HP = 6;
    const SECTION_HISS_LP = 7;
    const SECTION_MODULATION = 8;
    const SECTION_COUNT = 9;

    const BIQUAD_RECORD_AMP = 0;
    const BIQUAD_HEAD_BUMP = 1;
    const BIQUAD_COUNT = 2;

    // --- first order section helpers ------------------------------------
    // The prototype (1 + s tauZero) / (1 + s tauPole) is realised by matching
    // three things exactly at every host rate: the pole, which is placed at
    // exp(-2 pi f_p / fs) so it decays at the analogue rate; the DC gain; and
    // the magnitude at Nyquist.
    //
    // The plain bilinear substitution used before matches DC only. It squeezes
    // the whole analogue frequency axis into [0, fs/2] and therefore plants a
    // zero at Nyquist that the prototype does not have. Every pole here - the
    // two loss terms, the bias erasure, the modulation-noise colour - sits near
    // or above Nyquist at 44.1 / 48 kHz, and that spurious zero then costs
    // several dB inside the audio band, by a rate-dependent amount: the same
    // settings measured 9 dB apart at 20 kHz between a 48 kHz and a 96 kHz
    // host. Prewarping the corner (which is what the audit asked for) fixes
    // where the pole lands but leaves the spurious zero, and cannot be applied
    // at all once a corner passes Nyquist; measured against the prototype it
    // still left 5.8 dB of error at 20 kHz on a 48 kHz host. Matching DC, pole
    // and Nyquist instead holds every section inside 1 dB of the prototype
    // across 44.1 - 192 kHz (worst measured 0.966 dB).
    //
    // Matching at z = 1 and z = -1 gives
    //   (b0 + b1) / (1 - p) = 1                 (DC)
    //   (b0 - b1) / (1 + p) = |H(fs/2)|         (Nyquist)
    // A corner far above Nyquist degenerates to p -> 0, b0 -> 1, b1 -> 0, i.e.
    // exact passthrough, so no near-Nyquist special case is needed. The pole
    // magnitude is exp(-something positive) < 1, so every section is stable by
    // construction.
    //
    // None of this threatens the exact cancellation of a section against its
    // inverse: invertSection() inverts the digital coefficients algebraically,
    // so the product is one whatever the coefficients are.
    function firstOrder(tauZero, tauPole, twoFs, out, index) {
        const nyquist = twoFs * 0.25;
        const zeroRatio = tauZero > 0 ? TWO_PI * nyquist * tauZero : 0;
        const poleRatio = tauPole > 0 ? TWO_PI * nyquist * tauPole : 0;
        const nyquistMagnitude = Math.sqrt((1 + zeroRatio * zeroRatio)
            / (1 + poleRatio * poleRatio));
        const pole = tauPole > 0 ? Math.exp(-2 / (tauPole * twoFs)) : 0;
        const low = 1 - pole;
        const high = (1 + pole) * nyquistMagnitude;
        out.b0[index] = (low + high) * 0.5;
        out.b1[index] = (low - high) * 0.5;
        out.a1[index] = -pole;
    }

    function scaleSection(out, index, gain) {
        out.b0[index] *= gain;
        out.b1[index] *= gain;
    }

    function invertSection(out, source, target) {
        const inverseB0 = 1 / out.b0[source];
        out.b0[target] = inverseB0;
        out.b1[target] = out.a1[source] * inverseB0;
        out.a1[target] = out.b1[source] * inverseB0;
    }

    function sectionMagnitude(out, index, omega) {
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const b0 = out.b0[index];
        const b1 = out.b1[index];
        const a1 = out.a1[index];
        const numeratorReal = b0 + b1 * cosine;
        const numeratorImag = -b1 * sine;
        const denominatorReal = 1 + a1 * cosine;
        const denominatorImag = -a1 * sine;
        const numeratorSq = numeratorReal * numeratorReal + numeratorImag * numeratorImag;
        const denominatorSq = denominatorReal * denominatorReal + denominatorImag * denominatorImag;
        return Math.sqrt(numeratorSq / (denominatorSq > 1e-300 ? denominatorSq : 1e-300));
    }

    function aWeighting(frequency) {
        const squared = frequency * frequency;
        const topSquared = A_WEIGHTING_F4 * A_WEIGHTING_F4;
        return (topSquared * squared * squared)
            / ((squared + A_WEIGHTING_F1 * A_WEIGHTING_F1)
                * Math.sqrt((squared + A_WEIGHTING_F2 * A_WEIGHTING_F2)
                    * (squared + A_WEIGHTING_F3 * A_WEIGHTING_F3))
                * (squared + topSquared));
    }
    // The curve is defined up to a constant; 1 kHz is its unity point.
    const A_WEIGHTING_UNITY = 1 / aWeighting(A_WEIGHTING_REFERENCE_HZ);

    // RMS gain of a cascade of first order sections fed with white noise,
    // evaluated on a uniform grid up to Nyquist. The weighted flag puts the
    // A-weighting curve into the integrand, so the result is the A-weighted RMS
    // gain rather than the broadband one.
    function cascadeNoiseGain(out, indices, points, rate, weighted) {
        let total = 0;
        for (let k = 0; k < points; k++) {
            const omega = Math.PI * (k + 0.5) / points;
            let magnitude = 1;
            for (let s = 0; s < indices.length; s++) {
                magnitude *= sectionMagnitude(out, indices[s], omega);
            }
            if (weighted) magnitude *= aWeighting(omega * rate / TWO_PI) * A_WEIGHTING_UNITY;
            total += magnitude * magnitude;
        }
        const mean = total / points;
        return mean > 1e-30 ? Math.sqrt(mean) : 1e-15;
    }

    function lowPassBiquad(out, index, frequency, quality, rate) {
        const base = index * 5;
        const omega = TWO_PI * frequency / rate;
        const cosine = Math.cos(omega);
        const alpha = Math.sin(omega) / (2 * quality);
        const a0 = 1 + alpha;
        const inverse = 1 / a0;
        const oneMinusCos = 1 - cosine;
        out[base] = (oneMinusCos * 0.5) * inverse;
        out[base + 1] = oneMinusCos * inverse;
        out[base + 2] = out[base];
        out[base + 3] = (-2 * cosine) * inverse;
        out[base + 4] = (1 - alpha) * inverse;
    }

    function peakingBiquad(out, index, frequency, quality, gainDb, rate) {
        const base = index * 5;
        const amplitude = Math.pow(10, gainDb / 40);
        const omega = TWO_PI * frequency / rate;
        const cosine = Math.cos(omega);
        const alpha = Math.sin(omega) / (2 * quality);
        const a0 = 1 + alpha / amplitude;
        const inverse = 1 / a0;
        out[base] = (1 + alpha * amplitude) * inverse;
        out[base + 1] = (-2 * cosine) * inverse;
        out[base + 2] = (1 - alpha * amplitude) * inverse;
        out[base + 3] = (-2 * cosine) * inverse;
        out[base + 4] = (1 - alpha / amplitude) * inverse;
    }

    // --- denormal guard ---
    // Every recursive state here decays geometrically, and a geometric decay
    // never actually reaches zero: at the bottom of the subnormal range
    // x * a rounds straight back to x for any a near 1, so the state latches
    // at 4.94e-324 and every sample after that is subnormal arithmetic
    // (measured 233.9x realtime on signal against 4.9x after 8 s of silence).
    // One sweep per block is enough - a state can only be subnormal for the
    // single block in which it crosses the threshold, and once it is zero the
    // recursion keeps it zero. Doing it here rather than inside the sample
    // loop keeps the cost off the audio path entirely.
    function flushDenormals(array) {
        for (let i = 0; i < array.length; i++) {
            const value = array[i];
            if (value < DENORMAL_THRESHOLD && value > -DENORMAL_THRESHOLD) array[i] = 0;
        }
    }

    // --- state ---
    let state = context.tapeArtifacts;
    if (!state || state.sampleRate !== sampleRate || state.channelCount !== channelCount) {
        const delays = new Array(channelCount);
        const dry = new Array(channelCount);
        for (let ch = 0; ch < channelCount; ch++) {
            delays[ch] = new Float32Array(DELAY_LENGTH);
            dry[ch] = new Float32Array(DELAY_LENGTH);
        }
        state = {
            sampleRate: sampleRate,
            channelCount: channelCount,
            coefficients: {
                b0: new Float64Array(SECTION_COUNT),
                b1: new Float64Array(SECTION_COUNT),
                a1: new Float64Array(SECTION_COUNT)
            },
            biquadCoefficients: new Float64Array(BIQUAD_COUNT * 5),
            sectionState: new Float64Array(SECTION_COUNT * channelCount),
            biquadState: new Float64Array(BIQUAD_COUNT * 2 * channelCount),
            envelope: new Float64Array(channelCount),
            dcInput: new Float64Array(channelCount),
            dcOutput: new Float64Array(channelCount),
            delayBuffers: delays,
            dryBuffers: dry,
            delayPosition: 0,
            oversampleInput: new Float64Array(OS_HISTORY * channelCount),
            oversampleEven: new Float64Array(OS_HISTORY * channelCount),
            oversampleOdd: new Float64Array(OS_HISTORY * channelCount),
            oversamplePosition: 0,
            wowPhase: 0,
            flutterA: 0,
            flutterB: 0,
            rngState: 0,
            hissGain: 0,
            modulationGain: 0,
            saturationBase: 1,
            memoryScale: 0,
            attackCoefficient: 0,
            releaseCoefficient: 0,
            dcCoefficient: 0,
            wowIncrement: 0,
            wowSamples: 0,
            flutterSamples: 0,
            flutterCoefficient: 0,
            flutterNormalisation: 0,
            baseDelaySamples: 0,
            configurationKey: '',
            inputTrimGain: 1,
            outputGain: 1,
            flutterScale: 1,
            inputTrimGainTarget: 1,
            outputGainTarget: 1,
            flutterScaleTarget: 1,
            mix: targetMix,
            mixTarget: targetMix,
            mixRampRemaining: 0,
            automationInitialized: false
        };
        let seed = Math.floor(((typeof context.__seededRandom === 'function'
            ? context.__seededRandom
            : Math.random)() * 4294967296)) | 0;
        if (seed === 0) seed = 0x1a2b3c4d;
        state.rngState = seed;
        context.tapeArtifacts = state;
    }

    // The datasheet noise figures are indexed by the same key, so resolve the
    // key rather than the entry and fall back once.
    const speedKey = SPEEDS[parameters.sp] ? parameters.sp : '15';
    const speedEntry = SPEEDS[speedKey];
    const tapeEntry = TAPES[parameters.tp] || TAPES.Standard;
    const configurationKey = parameters.sp + '/' + parameters.tp + '/' + parameters.bs + '/' + parameters.hs;
    if (state.configurationKey !== configurationKey) {
        const coefficients = state.coefficients;
        const twoFs = 2 * sampleRate;
        const velocity = speedEntry.v;
        const bias = Math.pow(10, parameters.bs / 20);

        // Record pre-emphasis, normalised to 0 dB at 1 kHz. First order shelf
        // (1 + s/w) / (1 + s/(G w)): flat to the corner, +G above it.
        const recordPreTauZero = 1 / (TWO_PI * RECORD_PRE_CORNER_HZ);
        firstOrder(recordPreTauZero, recordPreTauZero / RECORD_PRE_GAIN, twoFs,
            coefficients, SECTION_RECORD_EQ);
        const referenceOmega = TWO_PI * EQ_REFERENCE_HZ / sampleRate;
        const referenceMagnitude = sectionMagnitude(coefficients, SECTION_RECORD_EQ, referenceOmega);
        scaleSection(coefficients, SECTION_RECORD_EQ, referenceMagnitude > 1e-30 ? 1 / referenceMagnitude : 1);
        // Reproduce post-emphasis is the exact digital inverse.
        invertSection(coefficients, SECTION_RECORD_EQ, SECTION_REPRODUCE_EQ);

        // Playback wavelength loss (thickness, then gap combined with spacing),
        // each already multiplied by its own bounded trim.
        const thicknessHz = THICKNESS_THREE_DB * velocity / (TWO_PI * tapeEntry.coating);
        const gapHz = GAP_THREE_DB * velocity / (Math.PI * PLAY_GAP_METERS);
        const spacingHz = SPACING_THREE_DB * velocity / (TWO_PI * SPACING_METERS);
        const shortHz = 1 / Math.sqrt(1 / (gapHz * gapHz) + 1 / (spacingHz * spacingHz));
        firstOrder(0, 1 / (TWO_PI * thicknessHz * TRIM_MAX_GAIN), twoFs, coefficients, SECTION_LOSS_A);
        firstOrder(0, 1 / (TWO_PI * shortHz * TRIM_MAX_GAIN), twoFs, coefficients, SECTION_LOSS_B);

        // Bias erasure.
        const biasHz = BIAS_CORNER_HZ * (velocity / NOISE_SPEED_REFERENCE) / Math.pow(bias, BIAS_CORNER_EXPONENT);
        firstOrder(0, 1 / (TWO_PI * biasHz), twoFs, coefficients, SECTION_BIAS);
        // Short-wavelength sensitivity, as a shelf of gain g about a corner
        // that scales with v. Zero at w / sqrt(g) and pole at w sqrt(g) put the
        // half-way point on the corner itself; g = 1 collapses the pair onto
        // each other, and is written out as an exact passthrough so that the
        // reference bias cannot depend on this section even to one ulp.
        //
        // The gain the peak needs is not a constant: it depends on where the
        // corner falls against 10 kHz at this speed and on how the section is
        // realised at this host rate. So it is solved rather than fitted, and
        // dS10 comes out right at every rate instead of at one of them.
        // Bisection converges because the section's magnitude at a fixed
        // frequency is monotonic in its gain. The erasure moves with the bias
        // too, so it is evaluated at both ends and divided out of the target
        // first - what is left is the shelf's share of dS10.
        const deltaS10Db = tapeEntry.deltaS10Db[speedKey];
        const shelfOmega = TWO_PI * BIAS_SHELF_HZ * (velocity / NOISE_SPEED_REFERENCE);
        const probeHz = BIAS_PROBE_HZ < sampleRate * 0.45 ? BIAS_PROBE_HZ : sampleRate * 0.45;
        const probeOmega = TWO_PI * probeHz / sampleRate;
        const peakBs = -Math.sqrt(deltaS10Db / BIAS_PEAK_CURVATURE);
        const erasureTau = 1 / (TWO_PI * BIAS_CORNER_HZ * (velocity / NOISE_SPEED_REFERENCE));
        firstOrder(0, erasureTau * Math.pow(Math.pow(10, peakBs / 20), BIAS_CORNER_EXPONENT),
            twoFs, coefficients, SECTION_BIAS_SHELF);
        const peakErasure = sectionMagnitude(coefficients, SECTION_BIAS_SHELF, probeOmega);
        firstOrder(0, erasureTau, twoFs, coefficients, SECTION_BIAS_SHELF);
        const shelfTarget = Math.pow(10, deltaS10Db / 20)
            * sectionMagnitude(coefficients, SECTION_BIAS_SHELF, probeOmega) / peakErasure;
        let shelfLow = 1;
        let shelfHigh = 1e6;
        // Geometric bisection over six decades; thirty halvings leave the gain
        // known to a ten-millionth of a decibel, far inside what dS10 means.
        for (let i = 0; i < 30; i++) {
            const trial = Math.sqrt(shelfLow * shelfHigh);
            const trialRoot = Math.sqrt(trial);
            firstOrder(trialRoot / shelfOmega, 1 / (trialRoot * shelfOmega), twoFs,
                coefficients, SECTION_BIAS_SHELF);
            if (sectionMagnitude(coefficients, SECTION_BIAS_SHELF, probeOmega) < shelfTarget) {
                shelfLow = trial;
            } else {
                shelfHigh = trial;
            }
        }
        // A hyperbola about the peak: a straight line in dB away from it,
        // rounded across it, and exactly zero at bs = 0 because the two radii
        // are then the same expression evaluated twice. That exactness is the
        // whole point - it is what keeps the reference bias a passthrough.
        const peakRadius = Math.sqrt(peakBs * peakBs + BIAS_PEAK_WIDTH_DB * BIAS_PEAK_WIDTH_DB);
        const shelfSlope = 20 * Math.log10(Math.sqrt(shelfLow * shelfHigh))
            / (peakRadius - BIAS_PEAK_WIDTH_DB);
        const biasOffset = parameters.bs - peakBs;
        let shelfGainDb = shelfSlope * (peakRadius
            - Math.sqrt(biasOffset * biasOffset + BIAS_PEAK_WIDTH_DB * BIAS_PEAK_WIDTH_DB));
        if (shelfGainDb > BIAS_SHELF_LIMIT_DB) shelfGainDb = BIAS_SHELF_LIMIT_DB;
        if (shelfGainDb < -BIAS_SHELF_LIMIT_DB) shelfGainDb = -BIAS_SHELF_LIMIT_DB;
        const biasShelfGain = Math.pow(10, shelfGainDb / 20);
        if (biasShelfGain === 1) {
            coefficients.b0[SECTION_BIAS_SHELF] = 1;
            coefficients.b1[SECTION_BIAS_SHELF] = 0;
            coefficients.a1[SECTION_BIAS_SHELF] = 0;
        } else {
            const shelfRoot = Math.sqrt(biasShelfGain);
            firstOrder(shelfRoot / shelfOmega, 1 / (shelfRoot * shelfOmega), twoFs,
                coefficients, SECTION_BIAS_SHELF);
        }

        // Noise shaping.
        const hissHighTau = 1 / (TWO_PI * HISS_HIGH_PASS_HZ);
        firstOrder(hissHighTau, hissHighTau, twoFs, coefficients, SECTION_HISS_HP);
        coefficients.b0[SECTION_HISS_HP] = (1 - coefficients.a1[SECTION_HISS_HP]) * 0.5;
        coefficients.b1[SECTION_HISS_HP] = -coefficients.b0[SECTION_HISS_HP];
        const hissLowHz = HISS_LOW_PASS_HZ < sampleRate * 0.45 ? HISS_LOW_PASS_HZ : sampleRate * 0.45;
        firstOrder(0, 1 / (TWO_PI * hissLowHz), twoFs, coefficients, SECTION_HISS_LP);
        const modulationHz = velocity / (TWO_PI * MODULATION_LENGTH_METERS);
        firstOrder(0, 1 / (TWO_PI * modulationHz), twoFs, coefficients, SECTION_MODULATION);

        // Band limits.
        const recordHz = RECORD_BANDWIDTH_HZ < sampleRate * 0.45 ? RECORD_BANDWIDTH_HZ : sampleRate * 0.45;
        lowPassBiquad(state.biquadCoefficients, BIQUAD_RECORD_AMP, recordHz, 0.7071067811865476, sampleRate);
        const bumpHz = velocity / CONTACT_LENGTH_METERS;
        peakingBiquad(state.biquadCoefficients, BIQUAD_HEAD_BUMP, bumpHz, HEAD_BUMP_Q, speedEntry.bumpDb, sampleRate);

        // Saturation operating point.
        state.saturationBase = (SATURATION_REFERENCE_PEAK / SATURATION_REFERENCE_T)
            * Math.pow(10, tapeEntry.headroomDb / 20) * Math.pow(bias, 0.7);
        state.memoryScale = MEMORY_DEPTH / state.saturationBase;
        // The envelope runs inside the 2x oversampled stage.
        state.attackCoefficient = 1 - Math.exp(-1 / (MEMORY_ATTACK_SECONDS * sampleRate * 2));
        state.releaseCoefficient = 1 - Math.exp(-1 / (MEMORY_RELEASE_SECONDS * sampleRate * 2));
        state.dcCoefficient = Math.exp(-TWO_PI * DC_BLOCK_HZ / sampleRate);

        // Noise levels. Hiss is the datasheet bias noise for this tape and this
        // speed, referred to the operating level, and it is normalised as an
        // A-weighted RMS because that is how BNIEC is measured.
        //
        // Base Hiss then names the flux of the reference configuration
        // outright, in dB re the IEC reference flux - the unit the BNIEC column
        // is already in - and reaches the others through the same ratio the
        // columns already carry: the control is a level, not a trim, but it is
        // applied as the offset of that level from the reference, so every
        // speed and formulation difference stays exactly where the columns put
        // it. The user gain lands on the modulation noise too - one control
        // moves the whole noise family together, which is what a different
        // machine or a different generation of the same tape does.
        //
        // The amplitude below is the flux referred to the operating level, so
        // it is what the tape carries and not yet what the reproduce chain
        // hands out. The makeup is applied to it at the injection point, which
        // is what keeps the floor a property of the tape rather than of the
        // level the material happened to be mastered at.
        //
        // The modulation noise is deliberately not treated the same way. It is
        // injected multiplicatively as (1 + n), so its sidebands land within a
        // few hundred hertz of whatever carries them - the modulation corner is
        // 337 Hz at 38.1 cm/s - and carrier and sidebands therefore see
        // essentially the same weighting. A weighting correction on the
        // modulation index would be correcting for a difference that does not
        // exist, so the index is normalised unweighted. DCN is likewise already
        // a ratio against the recorded signal, so it takes no referral to the
        // operating level either: it is the depth as published.
        const hissEnabled = parameters.hs > HISS_OFF_DB;
        const noiseUserGain = hissEnabled
            ? Math.pow(10, (parameters.hs - HISS_REFERENCE_DB) / 20)
            : 0;
        const hissRms = Math.pow(10, (tapeEntry.bniecDb[speedKey] + OPERATING_LEVEL_RMS_DBFS) / 20)
            * noiseUserGain;
        const modulationDepth = Math.pow(10, tapeEntry.dcnDb[speedKey] / 20) * noiseUserGain;
        const uniformRms = 0.5773502691896258; // RMS of a uniform [-1, 1] draw
        const hissShapeGain = cascadeNoiseGain(coefficients, [SECTION_HISS_HP, SECTION_HISS_LP],
            NOISE_INTEGRATION_POINTS, sampleRate, true);
        const modulationShapeGain = cascadeNoiseGain(coefficients, [SECTION_MODULATION],
            NOISE_INTEGRATION_POINTS, sampleRate, false);
        state.hissGain = hissRms / (uniformRms * hissShapeGain);
        state.modulationGain = modulationDepth / (uniformRms * modulationShapeGain);

        // Transport.
        const speedRatio = velocity / NOISE_SPEED_REFERENCE;
        state.wowIncrement = TWO_PI * WOW_RATE_HZ * speedRatio / sampleRate;
        state.flutterCoefficient = 1 - Math.exp(-TWO_PI * FLUTTER_CORNER_HZ * speedRatio / sampleRate);
        const pole = 1 - state.flutterCoefficient;
        const poleSq = pole * pole;
        const flutterVariance = Math.pow(state.flutterCoefficient, 4) * (1 + poleSq)
            / Math.pow(1 - poleSq, 3);
        state.flutterNormalisation = 1 / (uniformRms * Math.sqrt(flutterVariance > 1e-30 ? flutterVariance : 1e-30));
        const transportDepth = Math.pow(NOISE_SPEED_REFERENCE / velocity, TRANSPORT_DEPTH_EXPONENT);
        state.wowSamples = WOW_SECONDS * sampleRate * transportDepth;
        state.flutterSamples = FLUTTER_SECONDS * sampleRate * transportDepth;
        state.baseDelaySamples = Math.round(TRANSPORT_BASE_SECONDS * sampleRate);
        state.configurationKey = configurationKey;
    }

    const coefficients = state.coefficients;
    const sectionB0 = coefficients.b0;
    const sectionB1 = coefficients.b1;
    const sectionA1 = coefficients.a1;
    const sectionState = state.sectionState;
    const biquadCoefficients = state.biquadCoefficients;
    const biquadState = state.biquadState;
    const envelope = state.envelope;
    const dcInput = state.dcInput;
    const dcOutput = state.dcOutput;
    const delayBuffers = state.delayBuffers;
    const dryBuffers = state.dryBuffers;
    const oversampleInput = state.oversampleInput;
    const oversampleEven = state.oversampleEven;
    const oversampleOdd = state.oversampleOdd;

    // Record Level is where the machine is set, not a gain: it states how far
    // above the operating level a full-scale peak is recorded, and the trim is
    // what puts it there. The makeup below takes it straight back out again, so
    // the control changes how hard the tape is hit and how far the noise sits
    // under the programme, and nothing else.
    const targetInputTrimGain = Math.pow(10,
        (SATURATION_REFERENCE_DBFS + parameters.rl) / 20);
    const targetOutputGain = Math.pow(10, parameters.og / 20);
    const targetFlutterScale = parameters.wf / WOW_FLUTTER_REFERENCE_PERCENT;
    if (!state.automationInitialized) {
        state.inputTrimGain = targetInputTrimGain;
        state.outputGain = targetOutputGain;
        state.flutterScale = targetFlutterScale;
        state.mix = targetMix;
        state.inputTrimGainTarget = targetInputTrimGain;
        state.outputGainTarget = targetOutputGain;
        state.flutterScaleTarget = targetFlutterScale;
        state.mixTarget = targetMix;
        state.mixRampRemaining = 0;
        state.automationInitialized = true;
    } else if (targetInputTrimGain !== state.inputTrimGainTarget ||
        targetOutputGain !== state.outputGainTarget ||
        targetFlutterScale !== state.flutterScaleTarget || targetMix !== state.mixTarget) {
        state.inputTrimGainTarget = targetInputTrimGain;
        state.outputGainTarget = targetOutputGain;
        state.flutterScaleTarget = targetFlutterScale;
        state.mixTarget = targetMix;
        const requestedRampFrames = Math.ceil(sampleRate * 0.005);
        state.mixRampRemaining = requestedRampFrames > 1 ? requestedRampFrames : 1;
    }
    let inputTrimGain = state.inputTrimGain;
    let outputGain = state.outputGain;
    let flutterScale = state.flutterScale;
    let mixRatio = state.mix;
    let mixRampRemaining = state.mixRampRemaining;
    const saturationBase = state.saturationBase;
    const memoryScale = state.memoryScale;
    const attackCoefficient = state.attackCoefficient;
    const releaseCoefficient = state.releaseCoefficient;
    const dcCoefficient = state.dcCoefficient;
    // Negative excursions run against a proportionally higher ceiling. The
    // split is on the ceiling, not on the input gain, so the slope at the
    // origin stays exactly 1 on both sides and the transfer is still smooth
    // through zero.
    const negativeCeilingScale = 1 + SATURATION_ASYMMETRY;
    // The hiss is calibrated as a flux and injected as a digital level, so the
    // makeup is what converts it: the injection point stays where it is - after
    // the reproduce chain, because the datasheet figure is an output-terminal
    // measurement - and the amplitude rides with the trim instead. The
    // modulation index does not, and must not: it is multiplicative and already
    // dimensionless.
    const modulationGain = state.modulationGain;
    const noiseActive = state.hissGain > 0 || modulationGain > 0;
    const wowIncrement = state.wowIncrement;
    const flutterCoefficient = state.flutterCoefficient;
    const flutterNormalisation = state.flutterNormalisation;
    const baseDelaySamples = state.baseDelaySamples;
    const maxDeviation = baseDelaySamples > 8 ? baseDelaySamples - 4 : 1;
    // The dry tap is aligned with the wet path so that Mix is a true blend.
    const dryDelaySamples = (baseDelaySamples + OS_LATENCY) & DELAY_MASK;

    let delayPosition = state.delayPosition;
    let oversamplePosition = state.oversamplePosition;
    let wowPhase = state.wowPhase;
    let flutterA = state.flutterA;
    let flutterB = state.flutterB;
    let rngState = state.rngState;

    for (let i = 0; i < blockSize; i++) {
        if (mixRampRemaining !== 0) {
            const rampScale = 1 / mixRampRemaining;
            inputTrimGain += (targetInputTrimGain - inputTrimGain) * rampScale;
            outputGain += (targetOutputGain - outputGain) * rampScale;
            flutterScale += (targetFlutterScale - flutterScale) * rampScale;
            mixRatio += (targetMix - mixRatio) * rampScale;
            if (--mixRampRemaining === 0) {
                inputTrimGain = targetInputTrimGain;
                outputGain = targetOutputGain;
                flutterScale = targetFlutterScale;
                mixRatio = targetMix;
            }
        }
        const makeupGain = 1 / inputTrimGain;
        const hissGain = state.hissGain * makeupGain;
        const wowSamples = state.wowSamples * flutterScale;
        const flutterSamples = state.flutterSamples * flutterScale;
        // Transport trajectory is shared by every channel; only the delay line
        // state is per channel.
        wowPhase += wowIncrement;
        if (wowPhase >= TWO_PI) wowPhase -= TWO_PI;
        rngState ^= rngState << 13; rngState |= 0;
        rngState ^= rngState >>> 17;
        rngState ^= rngState << 5; rngState |= 0;
        const flutterDraw = (rngState >>> 0) * RNG_SCALE - 1;
        flutterA += flutterCoefficient * (flutterDraw - flutterA);
        flutterB += flutterCoefficient * (flutterA - flutterB);
        let deviation = Math.sin(wowPhase) * wowSamples
            + flutterB * flutterNormalisation * flutterSamples;
        if (deviation > maxDeviation) deviation = maxDeviation;
        else if (deviation < -maxDeviation) deviation = -maxDeviation;
        const readPosition = delayPosition - baseDelaySamples - deviation;
        const readFloor = Math.floor(readPosition);
        const fraction = readPosition - readFloor;
        const index1 = readFloor & DELAY_MASK;
        const index0 = (readFloor - 1) & DELAY_MASK;
        const index2 = (readFloor + 1) & DELAY_MASK;
        const index3 = (readFloor + 2) & DELAY_MASK;

        for (let ch = 0; ch < channelCount; ch++) {
            const offset = ch * blockSize;
            // Sanitise before the sample can reach any state. A single NaN or
            // infinity from upstream otherwise enters every recursive state
            // here - sections, biquads, DC blocker, envelope, oversampling
            // histories - and never leaves; the output guard below then maps
            // the NaN to zero and the channel is silent for good, and the
            // denormal sweep cannot clean it either because its comparisons are
            // false on both sides for NaN. Comparisons are the guard: NaN fails
            // both, each infinity fails one, and every finite value - denormals
            // and signed zero included - passes through bit for bit.
            const raw = data[offset + i];
            const input = raw > -Infinity && raw < Infinity ? raw : 0;
            const dryLine = dryBuffers[ch];
            dryLine[delayPosition] = input;
            const dry = dryLine[(delayPosition - dryDelaySamples) & DELAY_MASK];
            let x = input * inputTrimGain;

            // Record chain.
            let index = SECTION_RECORD_EQ * channelCount + ch;
            let y = sectionB0[SECTION_RECORD_EQ] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_RECORD_EQ] * x - sectionA1[SECTION_RECORD_EQ] * y;
            x = y;

            let base = BIQUAD_RECORD_AMP * 5;
            let stateBase = (BIQUAD_RECORD_AMP * channelCount + ch) * 2;
            y = biquadCoefficients[base] * x + biquadState[stateBase];
            biquadState[stateBase] = biquadCoefficients[base + 1] * x
                - biquadCoefficients[base + 3] * y + biquadState[stateBase + 1];
            biquadState[stateBase + 1] = biquadCoefficients[base + 2] * x
                - biquadCoefficients[base + 4] * y;
            x = y;

            // --- 2x oversampled tape saturation ---------------------------
            // Interpolate: the odd half-band branch is a pure delay, the even
            // branch is the 12-tap symmetric sum.
            const osBase = ch * OS_HISTORY;
            oversampleInput[osBase + oversamplePosition] = x;
            const g0 = x;
            const g1 = oversampleInput[osBase + ((oversamplePosition - 1) & OS_MASK)];
            const g2 = oversampleInput[osBase + ((oversamplePosition - 2) & OS_MASK)];
            const g3 = oversampleInput[osBase + ((oversamplePosition - 3) & OS_MASK)];
            const g4 = oversampleInput[osBase + ((oversamplePosition - 4) & OS_MASK)];
            const g5 = oversampleInput[osBase + ((oversamplePosition - 5) & OS_MASK)];
            const g6 = oversampleInput[osBase + ((oversamplePosition - 6) & OS_MASK)];
            const g7 = oversampleInput[osBase + ((oversamplePosition - 7) & OS_MASK)];
            const g8 = oversampleInput[osBase + ((oversamplePosition - 8) & OS_MASK)];
            const g9 = oversampleInput[osBase + ((oversamplePosition - 9) & OS_MASK)];
            const g10 = oversampleInput[osBase + ((oversamplePosition - 10) & OS_MASK)];
            const g11 = oversampleInput[osBase + ((oversamplePosition - 11) & OS_MASK)];
            const upperEven = 2 * (OS_H11 * (g0 + g11) + OS_H9 * (g1 + g10) + OS_H7 * (g2 + g9)
                + OS_H5 * (g3 + g8) + OS_H3 * (g4 + g7) + OS_H1 * (g5 + g6));
            const upperOdd = g5;

            // The ceiling is pulled down by a short-time envelope; that is the
            // whole of the model's memory and it settles in a few tens of ms.
            let level = envelope[ch];
            let magnitude = upperEven < 0 ? -upperEven : upperEven;
            level += (magnitude > level ? attackCoefficient : releaseCoefficient) * (magnitude - level);
            let memory = level * memoryScale;
            if (memory > 1) memory = 1;
            let ceiling = saturationBase / (1 + memory);
            if (upperEven < 0) ceiling *= negativeCeilingScale;
            let t = upperEven / ceiling;
            const satEven = upperEven / Math.sqrt(1 + t * t);

            magnitude = upperOdd < 0 ? -upperOdd : upperOdd;
            level += (magnitude > level ? attackCoefficient : releaseCoefficient) * (magnitude - level);
            envelope[ch] = level;
            memory = level * memoryScale;
            if (memory > 1) memory = 1;
            ceiling = saturationBase / (1 + memory);
            if (upperOdd < 0) ceiling *= negativeCeilingScale;
            t = upperOdd / ceiling;
            const satOdd = upperOdd / Math.sqrt(1 + t * t);

            // Decimate.
            oversampleEven[osBase + oversamplePosition] = satEven;
            oversampleOdd[osBase + oversamplePosition] = satOdd;
            const e1 = oversampleEven[osBase + ((oversamplePosition - 1) & OS_MASK)];
            const e2 = oversampleEven[osBase + ((oversamplePosition - 2) & OS_MASK)];
            const e3 = oversampleEven[osBase + ((oversamplePosition - 3) & OS_MASK)];
            const e4 = oversampleEven[osBase + ((oversamplePosition - 4) & OS_MASK)];
            const e5 = oversampleEven[osBase + ((oversamplePosition - 5) & OS_MASK)];
            const e6 = oversampleEven[osBase + ((oversamplePosition - 6) & OS_MASK)];
            const e7 = oversampleEven[osBase + ((oversamplePosition - 7) & OS_MASK)];
            const e8 = oversampleEven[osBase + ((oversamplePosition - 8) & OS_MASK)];
            const e9 = oversampleEven[osBase + ((oversamplePosition - 9) & OS_MASK)];
            const e10 = oversampleEven[osBase + ((oversamplePosition - 10) & OS_MASK)];
            const e11 = oversampleEven[osBase + ((oversamplePosition - 11) & OS_MASK)];
            x = 0.5 * oversampleOdd[osBase + ((oversamplePosition - 6) & OS_MASK)]
                + OS_H11 * (satEven + e11) + OS_H9 * (e1 + e10) + OS_H7 * (e2 + e9)
                + OS_H5 * (e3 + e8) + OS_H3 * (e4 + e7) + OS_H1 * (e5 + e6);

            // Makeup, here and not at the output: everything between this point
            // and the hiss injection is linear, so the placement cannot change
            // the signal level, and it puts the whole reproduce chain at the
            // level the machine's own output stage works at. The hiss is not
            // covered by that - it is injected downstream - so it carries the
            // same factor explicitly, at hissGain above.
            x *= makeupGain;

            index = SECTION_BIAS * channelCount + ch;
            y = sectionB0[SECTION_BIAS] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_BIAS] * x - sectionA1[SECTION_BIAS] * y;
            x = y;

            index = SECTION_BIAS_SHELF * channelCount + ch;
            y = sectionB0[SECTION_BIAS_SHELF] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_BIAS_SHELF] * x
                - sectionA1[SECTION_BIAS_SHELF] * y;
            x = y;

            index = SECTION_LOSS_A * channelCount + ch;
            y = sectionB0[SECTION_LOSS_A] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_LOSS_A] * x - sectionA1[SECTION_LOSS_A] * y;
            x = y;

            index = SECTION_LOSS_B * channelCount + ch;
            y = sectionB0[SECTION_LOSS_B] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_LOSS_B] * x - sectionA1[SECTION_LOSS_B] * y;
            x = y;

            // Transport modulation.
            const line = delayBuffers[ch];
            line[delayPosition] = x;
            const y0 = line[index0];
            const y1 = line[index1];
            const y2 = line[index2];
            const y3 = line[index3];
            const c1 = 0.5 * (y2 - y0);
            const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
            const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
            x = ((c3 * fraction + c2) * fraction + c1) * fraction + y1;

            base = BIQUAD_HEAD_BUMP * 5;
            stateBase = (BIQUAD_HEAD_BUMP * channelCount + ch) * 2;
            y = biquadCoefficients[base] * x + biquadState[stateBase];
            biquadState[stateBase] = biquadCoefficients[base + 1] * x
                - biquadCoefficients[base + 3] * y + biquadState[stateBase + 1];
            biquadState[stateBase + 1] = biquadCoefficients[base + 2] * x
                - biquadCoefficients[base + 4] * y;
            x = y;

            index = SECTION_REPRODUCE_EQ * channelCount + ch;
            y = sectionB0[SECTION_REPRODUCE_EQ] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_REPRODUCE_EQ] * x
                - sectionA1[SECTION_REPRODUCE_EQ] * y;
            x = y;

            // DC block. It sits here rather than straight after the saturator
            // because at 18 Hz, ahead of the head bump, it cancelled the bump
            // outright (7.5 ips: +1.50 dB designed, -0.08 dB in chain) and
            // took 5 dB out of 20 Hz. The stages ahead of it are linear, so
            // the same offset is removed either way.
            const blocked = x - dcInput[ch] + dcCoefficient * dcOutput[ch];
            dcInput[ch] = x;
            dcOutput[ch] = blocked;
            x = blocked;

            if (noiseActive) {
                rngState ^= rngState << 13; rngState |= 0;
                rngState ^= rngState >>> 17;
                rngState ^= rngState << 5; rngState |= 0;
                const hissDraw = (rngState >>> 0) * RNG_SCALE - 1;
                index = SECTION_HISS_HP * channelCount + ch;
                y = sectionB0[SECTION_HISS_HP] * hissDraw + sectionState[index];
                sectionState[index] = sectionB1[SECTION_HISS_HP] * hissDraw
                    - sectionA1[SECTION_HISS_HP] * y;
                let hiss = y;
                index = SECTION_HISS_LP * channelCount + ch;
                y = sectionB0[SECTION_HISS_LP] * hiss + sectionState[index];
                sectionState[index] = sectionB1[SECTION_HISS_LP] * hiss
                    - sectionA1[SECTION_HISS_LP] * y;
                hiss = y * hissGain;

                rngState ^= rngState << 13; rngState |= 0;
                rngState ^= rngState >>> 17;
                rngState ^= rngState << 5; rngState |= 0;
                const modulationDraw = (rngState >>> 0) * RNG_SCALE - 1;
                index = SECTION_MODULATION * channelCount + ch;
                y = sectionB0[SECTION_MODULATION] * modulationDraw + sectionState[index];
                sectionState[index] = sectionB1[SECTION_MODULATION] * modulationDraw
                    - sectionA1[SECTION_MODULATION] * y;
                let modulation = y * modulationGain;
                if (modulation > 0.5) modulation = 0.5;
                else if (modulation < -0.5) modulation = -0.5;
                x = (x + hiss) * (1 + modulation);
            }

            x *= outputGain;
            if (!(x > -16 && x < 16)) x = x > 0 ? 16 : (x < 0 ? -16 : 0);
            data[offset + i] = dry + mixRatio * (x - dry);
        }

        delayPosition = (delayPosition + 1) & DELAY_MASK;
        oversamplePosition = (oversamplePosition + 1) & OS_MASK;
    }

    flushDenormals(sectionState);
    flushDenormals(biquadState);
    flushDenormals(dcInput);
    flushDenormals(dcOutput);
    flushDenormals(envelope);
    flushDenormals(oversampleInput);
    flushDenormals(oversampleEven);
    flushDenormals(oversampleOdd);

    state.delayPosition = delayPosition;
    state.oversamplePosition = oversamplePosition;
    state.wowPhase = wowPhase;
    state.flutterA = flutterA;
    state.flutterB = flutterB;
    state.rngState = rngState;
    state.inputTrimGain = inputTrimGain;
    state.outputGain = outputGain;
    state.flutterScale = flutterScale;
    state.mix = mixRatio;
    state.mixRampRemaining = mixRampRemaining;

    return data;
`;

class TapeArtifactsPlugin extends PluginBase {
    constructor() {
        super('Tape Artifacts', 'Reel-to-reel tape record and reproduce chain');

        this.sp = '15';   // sp: Speed - 7.5 / 15 / 30 ips
        this.tp = 'Standard'; // tp: Tape formulation - Standard | Master
        this.bs = 0;      // bs: Bias - Range: -6 to +6 dB
        this.rl = 6;      // rl: Record Level - tape flux at a 0 dBFS peak - Range: -12 to +18 dB
        this.wf = 0.16;   // wf: Base Wow/Flutter - DIN 45507 weighted deviation at 15 ips - Range: 0 to 1 %
        this.hs = -62.5;  // hs: Base Hiss - A-weighted flux at 15 ips / Standard - Range: -89 to -39 dB re 320 nWb/m (off at -89)
        this.og = 0;      // og: Output - Range: -24 to +24 dB
        this.mx = 100;    // mx: Mix - Range: 0 to 100 %

        this.temporalCapability = 'must-process';

        this.registerProcessor(TAPE_ARTIFACTS_REFERENCE_PROCESSOR);
    }

    getTemporalCapability() {
        return this.enabled !== false && this.mx > 0 ? 'must-process' : 'reset-on-resume';
    }

    getParameters() {
        return {
            type: this.constructor.name,
            sp: this.sp,
            tp: this.tp,
            bs: this.bs,
            rl: this.rl,
            wf: this.wf,
            hs: this.hs,
            og: this.og,
            mx: this.mx,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.sp !== undefined) {
            this.sp = this.isAllowedEnum(String(params.sp), ['7.5', '15', '30'], this.sp);
        }
        if (params.tp !== undefined) {
            this.tp = this.isAllowedEnum(String(params.tp), ['Standard', 'Master'], this.tp);
        }
        if (params.bs !== undefined) {
            this.bs = this.parseFiniteNumber(params.bs, -6, 6, this.bs);
        }
        if (params.rl !== undefined) {
            this.rl = this.parseFiniteNumber(params.rl, -12, 18, this.rl);
        }
        if (params.wf !== undefined) {
            this.wf = this.parseFiniteNumber(params.wf, 0, 1, this.wf);
        }
        if (params.hs !== undefined) {
            this.hs = this.parseFiniteNumber(params.hs, TAPE_ARTIFACTS_HISS_OFF_DB, -39, this.hs);
        }
        if (params.og !== undefined) {
            this.og = this.parseFiniteNumber(params.og, -24, 24, this.og);
        }
        if (params.mx !== undefined) {
            this.mx = this.parseFiniteNumber(params.mx, 0, 100, this.mx);
        }
        // Coerced rather than assigned, as the newer plugins in this directory
        // do: a restored state carrying the string "false" would otherwise be
        // stored as a string and read as enabled by every `enabled !== false`
        // test, getTemporalCapability()'s included. Booleans are unaffected.
        if (params.enabled !== undefined) {
            this.enabled = params.enabled !== false;
        }

        this._refreshEffectiveValues();
        this.updateParameters();
    }

    // Speed, Tape and Record Level are what stand between a Base value and the
    // number the machine actually holds, and all three arrive through
    // setParameters, so the two readouts are refreshed from there.
    //
    // The class cannot see inside the processor string, so both figures are
    // taken from the module-scope tables the string is built out of rather than
    // written down a second time. The two readouts stand on different ground
    // even so, and the difference matters.
    //
    // The hiss figure is exact. The datasheet columns are serialised whole into
    // the processor string, the processor reaches the other five configurations
    // from the reference by exactly this difference of columns, and the
    // expression below is algebraically the expression the processor evaluates,
    // on the one copy of those numbers. What is displayed is what the noise
    // generator is calibrated to, and the readout cannot drift from the DSP.
    // The Record Level term is the makeup and nothing else: the injected flux
    // is the datasheet column referred to the operating level, the operating
    // level is SATURATION_REFERENCE_DBFS below full scale as an RMS sine, and
    // the makeup is 18 - rl decibels, so the two constants cancel and what is
    // left of the whole chain of definitions is a single -rl.
    //
    // The wow/flutter figure is not that. Only the 38.1 cm/s entry of
    // TAPE_ARTIFACTS_WOW_FLUTTER_PERCENT is interpolated into the processor
    // string; the 19.05 and 76.2 cm/s entries are read here and nowhere else,
    // and the processor reaches those two speeds through
    // TRANSPORT_DEPTH_EXPONENT instead. So this readout is the published
    // tolerance law itself - the law that exponent is fitted to reproduce - and
    // the two are independent statements of the same quantity rather than one
    // number used twice. Retuning the exponent moves the DSP and leaves this
    // readout where it is.
    //
    // How closely they agree cannot presently be stated tighter than the
    // instruments allow. Three DIN 45507 quasi-peak meters produced four
    // readings of the 76.2 / 38.1 cm/s ratio on the same output - 0.704, 0.714,
    // 0.715 and 0.747 against the published 0.75, two of the four being two
    // demodulation paths through one instrument - which is a 6 % spread, and a
    // single 60 s pass of any one of them spreads 10 to 17 %. The readout names
    // the scale the setting is on; where in that band the output actually falls
    // is below the resolution of the measurement.
    //
    // Both helpers resolve the speed key the way the processor does, so an
    // unrecognised Speed reads out of the same column the DSP would use.
    _effectiveWowFlutterPercent() {
        const speedKey = TAPE_ARTIFACTS_SPEEDS[this.sp] ? this.sp : '15';
        const reference = TAPE_ARTIFACTS_WOW_FLUTTER_PERCENT['15'];
        return this.wf * (TAPE_ARTIFACTS_WOW_FLUTTER_PERCENT[speedKey] / reference);
    }

    _effectiveHissDbFs() {
        const speedKey = TAPE_ARTIFACTS_SPEEDS[this.sp] ? this.sp : '15';
        const reference = TAPE_ARTIFACTS_TAPES.Standard.bniecDb['15'];
        const tape = TAPE_ARTIFACTS_TAPES[this.tp] || TAPE_ARTIFACTS_TAPES.Standard;
        return this.hs + (tape.bniecDb[speedKey] - reference) - this.rl;
    }

    // The three readouts share one line, so each names the value it came from:
    // the line stands on its own away from the sliders it belongs to. Record
    // Level is a statement of the convention rather than a measurement - there
    // is no meter, and none is wanted - so its segment is static.
    _statusText() {
        const speed = `${this.sp} ips`;
        const signed = value => `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
        const recordLevel = `Record Level ${signed(this.rl)} dB → tape peak`
            + ` ${signed(this.rl)} dB re ${TAPE_ARTIFACTS_REFERENCE_FLUX} at 0 dBFS in`;
        const wowFlutter = `Wow/Flutter Base ${this.wf.toFixed(3)}% →`
            + ` ${this._effectiveWowFlutterPercent().toFixed(3)}% at ${speed}`;
        const base = `Hiss Base ${this.hs.toFixed(1)} dB re ${TAPE_ARTIFACTS_REFERENCE_FLUX}`;
        const hiss = this.hs <= TAPE_ARTIFACTS_HISS_OFF_DB
            ? `${base} → off`
            : `${base} → ${this._effectiveHissDbFs().toFixed(1)} dBFS at ${speed}, ${this.tp}`;
        return `${recordLevel} · ${wowFlutter} · ${hiss}`;
    }

    _refreshEffectiveValues() {
        if (this.statusElement) this.statusElement.textContent = this._statusText();
    }

    setSp(value) { this.setParameters({ sp: value }); }
    setTp(value) { this.setParameters({ tp: value }); }
    setBs(value) { this.setParameters({ bs: value }); }
    setRl(value) { this.setParameters({ rl: value }); }
    setWf(value) { this.setParameters({ wf: value }); }
    setHs(value) { this.setParameters({ hs: value }); }
    setOg(value) { this.setParameters({ og: value }); }
    setMx(value) { this.setParameters({ mx: value }); }

    createUI() {
        const container = document.createElement('div');
        container.className = 'tape-artifacts-plugin-ui plugin-parameter-ui';

        container.appendChild(this.createRadioGroup('Speed', [
            { value: '7.5', label: '7.5 ips' },
            { value: '15', label: '15 ips' },
            { value: '30', label: '30 ips' }
        ], this.sp, this.setSp.bind(this)));

        container.appendChild(this.createRadioGroup('Tape', [
            { value: 'Standard', label: 'Standard' },
            { value: 'Master', label: 'Master' }
        ], this.tp, this.setTp.bind(this)));

        container.appendChild(this.createParameterControl('Bias', -6, 6, 0.1, this.bs, this.setBs.bind(this), 'dB'));
        container.appendChild(this.createParameterControl('Record Level', -12, 18, 0.1, this.rl, this.setRl.bind(this), 'dB'));
        container.appendChild(this.createParameterControl('Wow/Flutter', 0, 1, 0.001,
            this.wf, this.setWf.bind(this), '%'));
        container.appendChild(this.createParameterControl('Hiss', TAPE_ARTIFACTS_HISS_OFF_DB, -39, 0.1,
            this.hs, this.setHs.bind(this), `dB re ${TAPE_ARTIFACTS_REFERENCE_FLUX}`));
        container.appendChild(this.createParameterControl('Output', -24, 24, 0.1, this.og, this.setOg.bind(this), 'dB'));
        container.appendChild(this.createParameterControl('Mix', 0, 100, 1, this.mx, this.setMx.bind(this), '%'));

        // Base Wow/Flutter and Base Hiss are stated at the reference
        // configuration, so the last line reports what the pair comes to once
        // the Speed, Tape and Record Level settings are applied, and states the
        // Record Level convention alongside them. All of them arrive through
        // setParameters, which refreshes it.
        const status = document.createElement('div');
        status.className = 'tape-artifacts-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        this.statusElement = status;
        status.textContent = this._statusText();
        container.appendChild(status);

        return container;
    }
}

// Register the plugin
window.TapeArtifactsPlugin = TapeArtifactsPlugin;
