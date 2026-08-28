const CASSETTE_ARTIFACTS_SYSTEM_PRESETS = Object.freeze([
    Object.freeze({
        id: 'flagship-deck-metal', label: 'Flagship Deck Metal',
        params: Object.freeze({
            dg: 'Reference', tp: 'Type IV', nr: 'Dolby C', bs: 0, rl: 6,
            wf: 0.04, hs: -70, dp: 0, az: 0, dl: 0, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'hifi-chrome', label: 'Hi-Fi Chrome',
        params: Object.freeze({
            dg: 'Hi-Fi', tp: 'Type II', nr: 'Dolby B', bs: 0, rl: 8,
            wf: 0.1, hs: -64, dp: 0.5, az: 1, dl: 0, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'pocket-cassette-player', label: 'Pocket Cassette Player',
        params: Object.freeze({
            dg: 'Portable', tp: 'Type I', nr: 'Off', bs: 0, rl: 12,
            wf: 0.4, hs: -54, dp: 4, az: 4, dl: 0, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'worn-mixtape', label: 'Worn Mixtape',
        params: Object.freeze({
            dg: 'Consumer', tp: 'Type I', nr: 'Off', bs: -3, rl: 15,
            wf: 0.65, hs: -50, dp: 12, az: -5, dl: 0, og: 0, mx: 100
        })
    }),
    Object.freeze({
        id: 'hot-deck-saturation', label: 'Hot Deck Saturation',
        params: Object.freeze({
            dg: 'Consumer', tp: 'Type II', nr: 'Off', bs: 1, rl: 18,
            wf: 0.2, hs: -58, dp: 1, az: 1, dl: 0, og: 0, mx: 100
        })
    })
]);

// Cassette Artifacts — compact-cassette record / reproduce chain.
//
// W-3 STATUS: the fixed-speed LTI chain (wavelength losses, record/reproduce
// EQ pair, record bandwidth, head bump), the Type I/II/IV saturation
// profiles, the bias law and the Type noise floors are calibrated against
// the W-1 source ledger (calibration-ledger.md, part of the local
// development ledger, not in the repository); every
// literal carries the ledger's confidence label ([A] primary datasheet,
// [B] literature consensus, [C] implementation-time calibration with a
// documented anchor). The W-2 safety, dry-path, state and calibration-table
// contracts are unchanged:
//   - bit-exact early return for enabled=false and mx<=0, before any state
//   - finite guard, denormal flush, seeded xorshift32, temporal capability
//   - a level-declaration trim with exact inverse makeup, delay-aligned dry
//     ring
//   - hard-off branches for wf=0, hs at the bottom of its range and dp=0
//
// W-4 STATUS: the transport is the cassette one now. The fixed-speed unit
// trajectory is two geometry-derived periodic wow components (capstan
// 6.89 Hz, hub 0.42 Hz) plus a broadband flutter process (two one-pole
// stages in the delay domain, so the SPEED spectrum is flat between the
// 1 Hz servo floor and the 40 Hz band top); the open-reel 15 ips reference
// and TRANSPORT_DEPTH_EXPONENT are gone. The `wf` control is calibrated in
// DIN 45507 / IEC Publ. 386 peak-weighted percent against the frozen meter
// convention (4 Hz 2nd-order band-pass weighting, Q 0.63, 2-sigma
// quasi-peak = 95.45th percentile; documented in w4-measurements.md of the
// local development ledger, not in the repository), and W_REF carries the
// ledger's 0.040 %
// [B]. Base delay 3.5 ms and the delay ring were sized from measured
// wf = 1.000 % trajectories (max |deviation| 2.861 ms over six rates x five
// seeds x 60 s), the ring per host rate because every term it has to hold
// scales with the rate; the RNG is split into independent per-family streams
// (transport / noise / dropouts) derived from the one base seed.
//
// W-5 STATUS: the Dolby B/C compander is real. Both modes are matched
// sliding-band encode/decode pairs generated from the one CAL.DOLBY table:
// B is a single sliding band (1.7 kHz quiescent corner fitted to the
// ledger's NR grid, 10 dB band gain, 20/40 ms detector), C is two staggered
// 400 Hz stages (11 dB each, low-level stage referenced 20 dB down, 12.8 kHz
// spectral skew and the 12k/6k + 15k/5k anti-saturation shelves from
// US 5,185,806; the S-type 200 Hz LF sub-stage is deliberately absent). The
// decoder is the complementary feedback expander, each stage solved
// sample-exactly in closed form through its direct term (plan F-2); its
// detector reference is the encoder's mapped through the exact inverse
// makeup, so the matched round trip holds at every Record Level setting
// (plan F-1); after W-A the quiet-floor attenuation is Record Level
// invariant too, and the Dolby Level Error control is what moves it. NR mode changes crossfade old and new
// companders over 20 ms with the new detectors seeded from the old ones,
// and consume no RNG. The status line's effective floor now measures the
// decoder's quiet-state attenuation by running this very processor string
// on a seeded no-signal render (module-scope helpers below the string).
// Frozen W-5 literals and measurements: w5-measurements.md (local
// development ledger, not in the repository).
//
// W-6 STATUS: azimuth, dropouts and the noise family are final; every
// literal in the file is frozen with its ledger label. The azimuth half of
// this note has since been superseded twice — W-D made the angle a signed
// live control with a time-varying part, and R1-01 replaced the in-track
// loss with a one-pole solved in Hz — so the azimuth block further down is
// the description that holds; what survives from W-6 is the geometry and the
// application rule: the L/R inter-track lag (11.0 us at 2 arcmin, from the
// 0.9 mm centre spacing [B]) is a
// +-dt/2 split of the transport read position of channels 0/1 — magnitude
// on every channel, the relative phase only on the 0/1 pair, mono
// magnitude-only (plan section 3). Dropouts are a Poisson deadline
// scheduler in absolute samples on the reserved 0xC2B2AE35 RNG stream:
// dp is the per-track event rate (any single channel meters dp
// events/min; half tape-wide events shared by all channels, half
// track-local), durations are the defect pass time over the ledger's
// 0.1-1 mm window (2.1-21 ms), depths 3-30 dB, and the envelope is a
// raised-cosine — a smooth dB trajectory, never a rectangular gate. The
// recorded signal is dropped ahead of the transport so the later hiss
// injection stays untouched and the floor is exposed relatively (the
// plan's first-shipment model). dp = 0 stays a hard off (no RNG, no
// envelope, bit-identical). D_MAX froze at the ledger's 20 events/min,
// the hiss band shape at the 60 Hz / 12 kHz starting point (the ledger
// §2 calibrates the A-weighted integral, not a per-bin shape), and the
// dcnDb column at the coating-uniformity ordering documented in TYPES.
// Frozen W-6 literals and measurements: w6-measurements.md (local
// development ledger, not in the repository).
//
// W-A..W-E STATUS (the realism pass): five changes, in the order they had to
// be made because each moves the operating point the next one is calibrated
// against.
//   W-A  The hiss and modulation noise were being injected in the MATERIAL
//        domain — after the makeup — so the signal-to-noise ratio was set by
//        the digital level of the incoming file rather than by how hard the
//        tape was driven. The noise level is now solved in the flux domain
//        and carried out through the same makeup as the signal, which is what
//        makes Record Level trade noise against saturation the way a tape
//        machine does. `hs` is consequently named in dB re 250 nWb/m, the
//        datasheet's own unit, not in dBFS.
//   W-B  Input Peak became Record Level: the same one degree of freedom with
//        the sign turned round and the reference fixed at a 0 dBFS peak. The
//        makeup still follows it exactly, so the control changes the tape's
//        operating point and never the output level.
//   W-C  The IEC 3180 us term is implemented honestly. It used to be dropped
//        on the argument that record and reproduce cancel it; they do not,
//        because no deck can supply the divergent LF flux boost the standard
//        asks for. The bounded record-side boost and the exact reproduce
//        high-pass leave a first-order high-pass at 50.049 / G Hz, and — the
//        point — the boost sits ahead of the saturator, so deep bass reaches
//        the ceiling first. The head contour became the alternating ripple a
//        finite contact length actually produces instead of one bump.
//   W-D  Azimuth became a signed control with a bounded time-varying part
//        (the short-term HF drift), and the Dolby level error became its own
//        signed control — the two "these two machines don't quite agree"
//        axes, which a single quality grade cannot express because their
//        sign decides the sound.
//   W-E  Deck Grade collects the mechanisms that have no knob of their own,
//        and the defaults moved from a Dragon with a metal tape to a
//        mass-market deck with a Type I tape.
//
// Signal chain (host rate; only the saturation stage runs 2x oversampled):
//   record-level trim -> Dolby B/C encode -> IEC 3180 us record flux boost
//   (bounded by the Deck Grade) -> record pre-emphasis (second order, two
//   identical first-order shelves) -> record amp band limit -> tape
//   saturation, 2x (split-ceiling algebraic sigmoid with short-time memory)
//   -> makeup (the exact inverse of the record-level trim) -> bias-dependent
//   HF loss -> playback wavelength loss x head trim -> dropout envelope
//   -> transport wow/flutter (fractional delay, the azimuth L/R lag folded
//   into the per-channel read position) -> azimuth in-track loss (time
//   varying) -> head contour (up to three alternating lobes) -> reproduce
//   post-emphasis (the exact inverse pair) -> IEC 3180 us reproduce
//   high-pass -> DC block -> hiss + modulation noise -> Dolby B/C decode
//   -> output gain -> dry/wet mix (against a delay-aligned dry tap)
//
// The 70/120 us record pre-emphasis and reproduce post-emphasis are exact
// digital inverses of each other, the head alignment trim is the bounded
// exact inverse of the playback loss, and the makeup is the exact inverse of
// the record-level trim, so the gain of the linear chain does not depend on
// the Record Level setting. That invariance is inherited from Tape Artifacts
// and must survive every later worker. The 3180 us pair is the deliberate
// exception (W-C): it is asymmetric by construction, and that asymmetry IS
// the low-frequency end of the deck.
//
// Under ideal conditions (bs=0, wf=0, hs off, dp=0, NR Off, mx=100) the
// measured response is therefore the residual tape loss (one pole per loss
// term at the Grade's trim gain times its corner), the record amp band limit,
// the bias erasure pole, the 50.049 / G Hz LF high-pass, the head contour and
// the azimuth in-track loss.

// Module-scope calibration table. The UI helpers and the processor string read
// the same object — the processor through the JSON serialisation below, the
// class directly — so a readout can never drift from the DSP.
//
// The W-3 columns are transcribed from the W-1 source ledger
// (calibration-ledger.md, local development ledger, not in the repository)
// under its
// common convention: 250 nWb/m reference flux ≡ -18 dBFS, full-scale sine =
// 0 dBFS for peak and RMS alike, noise as A-weighted RMS against the
// full-scale sine RMS. Every column is final: W_REF and TRANSPORT are the
// W-4 deliverables, DOLBY the W-5 deliverable, and D_MAX, the azimuth
// columns, the track geometry and DROPOUT the W-6 deliverables. (The azimuth
// entry was AZ_REF, a frozen constant, until W-D made the angle a signed
// control; it is AZ_DEFAULT_ARCMIN / AZ_MAX_ARCMIN now.)
const CASSETTE_ARTIFACTS_CALIBRATION = {
    // Exact by definition: compact cassette runs at 1 7/8 ips = 4.7625 cm/s
    // (IEC 60094-7) [A].
    SPEED_MPS: 0.047625,
    // How the fixed speed is written wherever it is shown. The status line's
    // Wow/Flutter readout is the one and only place it appears (the panel used
    // to head itself with a second, identical statement of it), and it reads
    // the string from here rather than repeating a literal — so there is one
    // place to edit, not two.
    //
    // This is a hand-written label sitting next to SPEED_MPS, NOT derived from
    // it: keeping the two consistent is a manual obligation. Rounding
    // 0.047625 m/s to "4.76 cm/s" is the reason it is written out rather than
    // formatted, and the exact figure is the constant above.
    SPEED_LABEL: '4.76 cm/s (1⅞ ips)',
    // DIN 45507 / IEC Publ. 386 peak-weighted W&F of the reference deck at
    // 4.76 cm/s, in percent. Default of the `wf` control. The TRANSPORT
    // literals below are solved so a rendered trajectory at wf = x measures
    // x percent on the frozen DIN meter, so this default IS a published deck
    // figure; W-E moved it off the Nakamichi Dragon's 0.040 % onto the
    // mass-market cassette deck window (DIN weighted peak 0.15-0.25 % [B]),
    // which also restores the physical ordering against Tape Artifacts'
    // 0.16 % at 15 ips — a cassette cannot run steadier than an open-reel
    // machine at eight times the speed.
    W_REF: 0.20,
    // A-weighted no-signal floors per Type, NR Off, in **dB re 250 nWb/m** —
    // the datasheet bias-noise column itself, not a dBFS figure. W-A moved
    // the hiss injection into the flux domain (the injected amplitude is
    // multiplied by the makeup, see the noise-level block in the processor),
    // so the floor follows Record Level 1 dB/dB and the only
    // level-independent way to name it is against the reference flux.
    // The reference itself is unchanged: 250 nWb/m ≡ -18 dBFS at the
    // saturator (ledger §2). H_II is the Base the `hs` control names
    // (default literal -60.5); the other two are reached as column
    // differences, so the Type spacing is exactly what it always was.
    H_I: -56.5, // TDK AD bias noise, dB re 250 nWb/m [B]
    H_II: -60.5, // TDK SA datasheet bias noise, dB re 250 nWb/m [A]
    H_IV: -58.0, // TDK MA bias noise, dB re 250 nWb/m [B]
    // Top of the Dropouts control, events/min, frozen (W-6) at the ledger
    // §9 recommendation: 3x the BASF Super High Grade QC bound of
    // < 7 dropouts/min [B] — clearly degraded-tape territory. Slider step
    // 0.1 events/min. D_DEFAULT is the W-E mass-market default: a cassette
    // in service drops out occasionally, and the old 0 hid the whole family
    // behind its own hard off, which is half of why nothing moved at the
    // shipped defaults (plan RC-5).
    D_MAX: 20, // [C] ledger §9 recommendation, frozen with the W-6 audit
    D_DEFAULT: 2.0, // [C] W-E, plan §4 "a few events/min"
    // Azimuth (W-D). The head alignment error is no longer a frozen constant
    // but a signed user control in arcmin: it is the alignment state of
    // *this* pair of machines rather than a quality grade, and its sign says
    // which channel leads (plan D-8). AZ_DEFAULT_ARCMIN keeps the ledger §7
    // anchor — 2 arcmin, twice the +-1 arcmin alignment tolerance [B],
    // "slight but measurable": an exact-sinc in-track loss of -0.08 dB at
    // 10 kHz and an 11.0 us L/R lag (40 degrees at 10 kHz) — as the default
    // rather than as a literal. The wobble *size* is the Deck Grade's
    // business (GRADES.azWobbleArcmin below); this column is only its centre.
    //
    // The dB figures quoted here and on AZ_MAX_ARCMIN are the EXACT SINC, the
    // physical quantity being modelled. What the implementation's one-pole
    // renders is close but not identical, and is rate-dependent at the third
    // significant figure: -0.135 dB at 10 kHz / 2 arcmin and -1.75 dB at
    // 16 kHz / 6 arcmin, both at 96 kHz (see the azimuth block in the
    // processor for the full comparison).
    AZ_DEFAULT_ARCMIN: 2.0, // [C] ledger §7 anchor, promoted to a default
    AZ_MAX_ARCMIN: 6, // [C] control span; 6' costs -1.85 dB at 16 kHz (exact sinc)
    // Track geometry the azimuth model reads (ledger §7).
    TRACK_WIDTH_M: 0.6e-3, // [A] IEC 60094-7 / TDK sheet stereo track width
    TRACK_CENTER_SPACING_M: 0.9e-3, // [B] 0.6 mm track + 0.3 mm guard band
    // --- Deck Grade (W-E) ------------------------------------------------
    // One selector for the mechanisms that have no knob of their own. The
    // membership rule is the plan's (D-8): a quantity belongs here only if it
    // is a MONOTONE quality axis — better machine, better number. Anything
    // whose sign or combination decides the sound (bias, azimuth, Dolby level
    // error) stays an independent signed control, and anything that already
    // has a knob (`wf` / `hs` / `dp`) is NOT touched from here, so choosing a
    // Grade can never silently discard the user's own edits.
    //
    //   trimMaxDb           the head-alignment trim budget: the record HF
    //                       equalisation the deck spends flattening the
    //                       playback wavelength loss. The trim and the loss
    //                       share a corner, so their product is one pole per
    //                       loss term at 10^(trimMaxDb/20) times the loss
    //                       corner — this single number is what sets the
    //                       small-signal HF end. SOLVED, not chosen: each
    //                       column is solved so the rendered small-signal
    //                       -3 dB point lands on the deck class's published
    //                       band top (18 / 14 / 10 / 6.5 kHz [B], the
    //                       consensus of Dragon-class 20-20 k, mid-range
    //                       20-18 k, mass-market 30-15 k and portable
    //                       60-12 k nominal ranges translated into a measured
    //                       -3 dB point).
    //
    //                       FULL reproduction conditions — the solve does not
    //                       reproduce without all of them, and the solver is
    //                       a local development file, so this comment is the
    //                       record that survives:
    //                         Type II, bs 0, NR Off, wf 0, dp 0, hs at the
    //                         bottom, rl +9, mono, 96 kHz, block 512,
    //                         **az = AZ_DEFAULT_ARCMIN (+2 arcmin)**,
    //                         tone -60 dBFS, 3.2 s render (about ten wobble
    //                         time constants), seed 0.42, -3 dB measured
    //                         against the same render's 1 kHz level.
    //                       az is load-bearing and was missing from an earlier
    //                       version of this list: solving at az = 0 instead
    //                       moves the answer by 4-5 %. The Grade's wobble is
    //                       not held at its mean either — the render carries
    //                       the live process, so the solved value is against
    //                       the expectation over that distribution.
    //                       Solver: verify/w-e-solve-trim.mjs.
    //   recordBandwidthHz   record amplifier band limit (2-pole Butterworth),
    //                       the bias-trap corner of the class [C]. Every
    //                       column sits ABOVE that class's band edge, on
    //                       purpose: the amp is a real and separate limit —
    //                       it is ahead of the saturator, so it caps the HF
    //                       flux as well as the response — but it must not be
    //                       what SETS the band edge, or trimMaxDb would have
    //                       nothing left to solve for. (At 21 kHz the amp
    //                       alone spent 2.90 dB of the Reference class's 3 dB
    //                       budget at 18 kHz, which made the target
    //                       unreachable at any trim.)
    //   lfBoostMaxDb        ceiling on the IEC 3180 us record-side flux boost
    //                       (W-C). The playback pair is an exact 50.049 Hz
    //                       first-order high-pass, so the recorded/reproduced
    //                       product is a first-order high-pass at
    //                       50.049 / 10^(lfBoostMaxDb/20) Hz: 12.6 / 15.8 /
    //                       19.9 / 28.2 Hz here [C], matching the classes'
    //                       nominal LF ends. This is NOT a bass control: a
    //                       bigger ceiling extends the LF end *and* pushes
    //                       more flux at the saturator, so deep bass hits the
    //                       ceiling first on every Grade.
    //   azWobbleArcmin      standard deviation of the azimuth wobble (W-D),
    //                       the short-term HF drift a real head-to-tape
    //                       contact has. [C], calibrated so the Consumer
    //                       column moves 10 kHz by a fraction of a dB — the
    //                       drift Nakamichi built NAAC to remove.
    //                       Reference is exactly 0, and that is the physical
    //                       statement rather than a rounding: the class this
    //                       column describes is the Dragon, and the Dragon
    //                       carries Nakamichi Auto Azimuth Correction, a
    //                       servo that measures the playback azimuth
    //                       continuously and holds the head on it. A machine
    //                       with an azimuth servo does not drift; that is
    //                       what the servo is for. It also means the whole
    //                       stochastic side of this effect can be switched
    //                       off from the controls — wf 0, hs at the bottom,
    //                       dp 0 and Reference leave a strictly
    //                       deterministic deck.
    //   contactLengthM      effective reproduce-head contact length; sets the
    //                       head-contour lobe spacing v / L [C], ledger §10
    //                       window 0.7-1.0 mm.
    //   headBumpDb          amplitude of the FIRST contour lobe [C]; the
    //                       later lobes alternate in sign and fall as 1 / k
    //                       (see the contour block in the processor).
    //   contourLobes        how many lobes the head is worth [C].
    GRADE_DEFAULT: 'Consumer',
    GRADES: {
        'Reference': {
            trimMaxDb: 29.85, recordBandwidthHz: 30000, lfBoostMaxDb: 12,
            azWobbleArcmin: 0, contactLengthM: 1.00e-3, headBumpDb: 1.2,
            contourLobes: 3
        },
        'Hi-Fi': {
            trimMaxDb: 26.17, recordBandwidthHz: 24000, lfBoostMaxDb: 10,
            azWobbleArcmin: 1.0, contactLengthM: 0.87e-3, headBumpDb: 1.5,
            contourLobes: 3
        },
        'Consumer': {
            trimMaxDb: 21.73, recordBandwidthHz: 18000, lfBoostMaxDb: 8,
            azWobbleArcmin: 2.0, contactLengthM: 0.75e-3, headBumpDb: 2.2,
            contourLobes: 3
        },
        'Portable': {
            trimMaxDb: 17.06, recordBandwidthHz: 12000, lfBoostMaxDb: 5,
            azWobbleArcmin: 4.0, contactLengthM: 0.70e-3, headBumpDb: 3.0,
            contourLobes: 2
        }
    },
    // Dropout event model (W-6), ledger §9. dp is the per-track rate: any
    // single channel meters dp events/min — half of them tape-wide defects
    // shared by every channel, half track-local — so the scheduler's total
    // rate is dp * (1 + N) / 2 for N channels and the shared fraction is
    // 1 / (1 + N). Durations are the defect pass time l / v with l
    // log-uniform over the ledger's 0.1-1 mm defect window (2.1-21 ms at
    // 4.76 cm/s); depths are DEPTH_MIN + SPAN * u^2 dB (3-30 dB), the
    // square-law draw biasing partial loss per the ledger's first-candidate
    // mixture (a few dB up to near-total loss). All [C]: no public dropout
    // statistics beyond the QC bound exist, so the distribution is the
    // anchor-constrained audibility calibration the ledger prescribes.
    DROPOUT: {
        DEFECT_MIN_M: 1.0e-4, // [C] ledger §9 window bottom (2.1 ms)
        DEFECT_MAX_M: 1.0e-3, // [C] ledger §9 window top (21 ms)
        DEPTH_MIN_DB: 3, // [C] partial-loss floor
        DEPTH_SPAN_DB: 27 // [C] up to 30 dB, near-total loss
    },
    // Type profiles, ledger §3/§4 normalised to the TDK reference-deck
    // convention (4.76 cm/s, 0.6 mm track, 1 µm PB gap, 250 nWb/m, MOL =
    // 315 Hz 3 % third-harmonic point, SOL = 10 kHz saturation output;
    // cross-source tolerance ±1.5 dB).
    //   eqUs          IEC reproduce time constant, µs. Only the 70/120 µs
    //                 record/reproduce EQ pair is built from it, and that pair
    //                 is an exact digital inverse. The curve's other term, the
    //                 3180 µs one, is NOT built from this column and is NOT
    //                 symmetric: W-C implements it as a Grade-bounded flux
    //                 boost on the record side (which does reach the tape, and
    //                 sits ahead of the saturator on purpose) against an exact
    //                 50.049 Hz high-pass on the reproduce side. That
    //                 asymmetry is the deck's low-frequency end — see the
    //                 LF_TAU block in the processor. (An earlier version of
    //                 this note argued the 3180 µs term never reaches the
    //                 tape, which is what W-C exists to correct.)
    //   coating       magnetic coating thickness, m (thickness-loss corner).
    //   molLowMidDbfs 315 Hz 3 % THD MOL target in dBFS — documentation and
    //                 verification target, not read by the audio path.
    //   sol10kDbfs    10 kHz saturation-output target in dBFS — same role.
    //                 Measurement convention (frozen with the fit): drive is
    //                 swept upward in 1 dB steps and the saturation output is
    //                 the fundamental where the drive response flattens below
    //                 0.05 dB/dB — the model's fundamental approaches its
    //                 4/pi ceiling asymptote monotonically, so "maximum over
    //                 a sweep" alone would depend on the sweep's top.
    //   headroomDb    fitted low/mid ceiling offset: the rendered 315 Hz 3 %
    //                 third-harmonic point lands on molLowMidDbfs. Fit
    //                 convention: the probe runs at rl = +18, where
    //                 trim = makeup = 1 and material dBFS = internal dBFS, so
    //                 the MOL/SOL columns mean exactly what the -18 dBFS ≡
    //                 250 nWb/m attribution says — the same anchor the hiss
    //                 floors and the Dolby level already use. The -8..-11 dB
    //                 magnitudes against the open-reel-anchored
    //                 SATURATION_REFERENCE_T are the cassette's higher
    //                 reference-level distortion.
    //   preEmphDb     fitted total record pre-emphasis gain (two identical
    //                 shelves of preEmphDb/2 each): the rendered 10 kHz
    //                 saturation ceiling lands on sol10kDbfs. Fitting the HF
    //                 drive separately from the low/mid ceiling is what keeps
    //                 MOL and SOL from collapsing into one broadband number.
    //   dcnDb         modulation (DC) noise depth against the recorded
    //                 signal, frozen (W-6) [C]. No ledger source row exists
    //                 (plan §4 classes the modulation spectrum as literature
    //                 representative); the anchor is the open-reel file's
    //                 sourced DCN columns (SM468/SM900, -56..-60 dB weighted
    //                 at 8x the speed and >4x the track width) shifted ~8 dB
    //                 worse for the slow narrow cassette track, ordered by
    //                 coating uniformity: metal best, chrome mid, ferric
    //                 worst — the same ordering as the coercivity/remanence
    //                 columns of ledger §3.
    //   deltaS10Db    recommended overbias at the 10 kHz probe, dB of
    //                 sensitivity below the S10 peak (ledger §3 anchor:
    //                 2-3 dB @ 10 kHz [B]; S10 curve graphs unreachable, so
    //                 the law is the anchor-constrained substitute [C]).
    // The two fitted columns are solved by rendering the actual processor
    // against the ledger targets — never by hand — and W-E re-solved them
    // because the chain the render goes through changed: the trim budget, the
    // record amp corner, the contour and the azimuth all moved.
    //
    // The fit is done at the DEFAULT Deck Grade and carried unchanged to the
    // other three. That is not a shortcut: MOL and SOL are measured at the
    // deck's output, so a machine of a different class genuinely reaches
    // saturation somewhere else, and pinning all four Grades to one published
    // MOL/SOL pair would be the unphysical choice. Solver:
    // verify/w-e-refit-saturation.mjs.
    TYPES: {
        'Type I': {
            // TDK AD (TDK catalogue transcription) [B]; 120 µs per IEC 60094
            // ferric [B].
            eqUs: 120,
            coating: 5.0e-6, // [C] representative ferric coating (AD sheet value not obtained)
            molLowMidDbfs: -13.0, // -18 + 5.0 [B]
            sol10kDbfs: -23.0, // -18 - 5.0 [B]
            headroomDb: -11.0, // [C] fitted to molLowMidDbfs (renders 2.98 % THD3 there; W-E refit)
            preEmphDb: 11.6, // [C] fitted to sol10kDbfs (renders -23.01; W-E refit)
            dcnDb: -48.0, // [C] frozen (W-6): ferric, worst of the column (see dcnDb note)
            deltaS10Db: 2.5 // [B] anchor, mid of the 2-3 dB overbias window
        },
        'Type II': {
            // TDK SA datasheet original (SA-60/90) [A]; 70 µs from the same
            // sheet's measurement conditions [A].
            eqUs: 70,
            coating: 5.0e-6, // [A] SA-60/90 coating 5.0 µm
            molLowMidDbfs: -13.0, // -18 + 5.0 [A]
            sol10kDbfs: -24.5, // -18 - 6.5 [A]
            headroomDb: -9.2, // [C] fitted to molLowMidDbfs (renders 3.01 % THD3 there; W-E refit)
            preEmphDb: 14.7, // [C] fitted to sol10kDbfs (renders -24.52; W-E refit)
            dcnDb: -50.0, // [C] frozen (W-6): chrome-class mid point (see dcnDb note)
            deltaS10Db: 3.0 // [B] anchor, high-bias decks commonly 3 dB over
        },
        'Type IV': {
            // TDK MA (TDK catalogue transcription) [B]; 70 µs shared with
            // Type II [A/B].
            eqUs: 70,
            coating: 4.0e-6, // [C] representative metal coating (MA sheet value not obtained)
            molLowMidDbfs: -12.0, // -18 + 6.0 [B]: MOL +1 dB over Type II
            sol10kDbfs: -18.0, // -18 + 0.0 [B]: SOL +6.5 dB over Type II
            headroomDb: -7.8, // [C] fitted to molLowMidDbfs (renders 3.00 % THD3 there; W-E refit)
            preEmphDb: 8.9, // [C] fitted to sol10kDbfs (renders -17.98; W-E refit)
            dcnDb: -52.0, // [C] frozen (W-6): metal, most uniform coating (see dcnDb note)
            deltaS10Db: 2.0 // [B/C] metal peaks flatter, low end of the anchor window
        }
    },
    // Dolby B/C sliding-band compander law (W-5). The compander is a
    // level-dependent sliding band, NOT a static EQ; the encoder and the
    // decoder are BOTH generated from this one table (the decoder is the
    // complementary feedback expander around the identical stage model), so
    // there is no second set of hand-typed constants anywhere.
    //
    // Stage model (per stage; B has one, C two staggered):
    //   sidechain: [1-pole spectral-skew LP, C only] -> variable 1-pole
    //   high-pass whose corner slides UP with detector level -> gain
    //   (10^(maxBoostDb/20) - 1); encoder output = mainPath(x) + sidechain(x)
    //   where mainPath is the anti-saturation shelf (C) or unity (B).
    //   Control: a fixed 1-pole high-pass at the quiescent corner feeds a
    //   full-wave rectifier and an attack/release smoother; the corner for
    //   sample n uses the detector through sample n-1 (the plan's allowed
    //   one-sample delay).
    //   Corner law [C fit, anchors below]: corner = quiescent *
    //   (1 + q / 10^(SLIDE_THRESHOLD_DB/20))^p with q the detector level
    //   over the stage reference (Dolby level + refOffsetDb, mapped into
    //   detector units by the full-wave sine mean 2/pi) and p solved so the
    //   corner multiple is SLIDE_AT_REFERENCE at q = 1. Anchors, ledger
    //   section 6: (a) the deep-quiet boost matches NR_GRID within 1 dB,
    //   (b) at Dolby level the response is unity within 0.5 dB (the corner
    //   has slid far above the audio band), (c) monotonic in level.
    //
    // Level domain (plan F-1): the encoder sits after the Record Level
    // trim, where 250 nWb/m = -18 dBFS and Dolby level is LEVEL_DBFS; the
    // decoder sits after the exact inverse makeup, so its detector reference
    // is the encoder's mapped through that same linear gain (the processor
    // multiplies the reference by the makeup, i.e. divides the normalising
    // scale by it). That one mapping is what makes the matched round trip
    // hold at every Record Level setting.
    DOLBY: {
        // Dolby level at the -18 dBFS operating point: 200 nWb/m (ANSI)
        // = 218 nWb/m (DIN) against the 250 nWb/m (DIN) reference above, so
        // 20*log10(218/250) = -1.19 dB; conversion in ledger section 5 [B].
        LEVEL_DBFS: -19.2,
        // Corner-law anchors [C]: sliding onset 40 dB below the stage
        // reference (the classic "companding acts over the -40..0 dB
        // range"), corner multiple 100 at the reference so the band tops
        // out well above audio and the reference row is unity (<= 0.5 dB
        // at 20 kHz needs a multiple of about 100 at a 1.7 kHz quiescent).
        SLIDE_THRESHOLD_DB: -40,
        SLIDE_AT_REFERENCE: 100,
        // Detector-level -> filter-coefficient lookup: TABLE_SIZE entries,
        // square-root-warped index over q in [0, TABLE_MAX_Q] (dense where
        // the law bends, coarse in the slid-out tail), built per mode at
        // configuration time so the audio loop does no pow/exp.
        TABLE_SIZE: 512,
        TABLE_MAX_Q: 4,
        // NR-mode switch crossfade (plan section 3: the predictable gain
        // jump is faded over about 20 ms; the new mode's detectors start
        // from the old mode's settled level).
        FADE_SECONDS: 0.02,
        'Dolby B': {
            // Verification target rows, not read by the audio path: decoder
            // no-signal attenuation (= encoder deep-quiet boost), Hz -> dB
            // (Wikipedia/HandWiki Dolby NR grid, ledger section 6 [B]).
            NR_GRID: [[250, 0], [600, 3], [1200, 6], [2400, 8], [5000, 10]],
            stages: [
                // One sliding band. 1700 Hz quiescent corner [C] is the
                // ledger's "about 1.5 kHz" fit against NR_GRID with the
                // 10 dB [B] band gain (best max deviation 0.8 dB; the
                // ledger's C-type 400 Hz does NOT apply to B — it would
                // put 8.6 dB at the 600 Hz / 3 dB row). Attack/release
                // 20/40 ms [B, weak: Concord DBA-9 measurement].
                { maxBoostDb: 10, cornerHz: 1700, refOffsetDb: 0,
                  attackMs: 20, releaseMs: 40,
                  skewHz: 0, antiSatZeroHz: 0, antiSatPoleHz: 0 }
            ]
        },
        'Dolby C': {
            stages: [
                // Two staggered stages, not B doubled (US 5,185,806 [A]):
                // 400 Hz 1-pole high-shelf band [A], spectral skew 12.8 kHz
                // [A] (1-pole here for both stages; the patent's low-level
                // stage uses 2-pole), anti-saturation shelves 12k/6k (6 dB)
                // and 15k/5k (10 dB) [A]. Detector 8 ms attack / 80 ms
                // release [A, S/SR-generation values used as C
                // representatives -> B handling]. Stage gains 11 dB each
                // [C fit]: the patent caps a stage at 12 dB and the system
                // is nominally 20 dB; the fixed skew and anti-saturation
                // factors already sit inside the sidechain/main paths and
                // cost about 2 dB at the composite's HF plateau, so 11+11
                // lands the measured deep-quiet composite at ~20 dB while
                // staying under the cap (10+10 measured 17.8 dB at 5 kHz).
                // The stagger [C] puts the low-level stage reference 20 dB
                // under Dolby level ("HL near Dolby level, LL about 20 dB
                // down"). The S-type 200 Hz / 10 dB LF sub-stage in the
                // same patent is NOT adopted (no such stage in C — ledger
                // warning).
                { maxBoostDb: 11, cornerHz: 400, refOffsetDb: 0,
                  attackMs: 8, releaseMs: 80,
                  skewHz: 12800, antiSatZeroHz: 12000, antiSatPoleHz: 6000 },
                { maxBoostDb: 11, cornerHz: 400, refOffsetDb: -20,
                  attackMs: 8, releaseMs: 80,
                  skewHz: 12800, antiSatZeroHz: 15000, antiSatPoleHz: 5000 }
            ]
        }
    },
    // IEC 61672 A-weighting constants, shared by the processor's noise
    // normalisation and the class-side status meter (one table, plan §2).
    A_WEIGHTING: { F1: 20.598997, F2: 107.65265, F3: 737.86223, F4: 12194.217 },
    // Transport trajectory (W-4). The fixed-speed unit trajectory is two
    // periodic wow components plus a broadband flutter process, per ledger
    // section 8; the component frequencies come from the ledger's geometric
    // formulae at the exact cassette speed, and the three speed amplitudes
    // are solved literals: the physical ratio capstan : hub : flutter =
    // 1.0 : 0.6 : 0.7 (peak / peak / RMS relative speed) is the [C]
    // audibility-calibration choice, and the absolute scale is the ratio
    // divided by the DIN 45507 meter reading of the unit-ratio trajectory
    // (1.1045 % mean over 3 rates x 3 seeds x 60 s, w4-solve.mjs), so a
    // trajectory rendered at wf measures wf percent peak-weighted. W-8 may
    // retune the ratio but must re-solve the scale under the same meter.
    TRANSPORT: {
        // Capstan rotation, f = v / (pi * d), d = 2.2 mm representative
        // cassette capstan (ledger section 8 window 6.1-7.6 Hz) [C].
        CAPSTAN_HZ: 6.8907,
        // Hub (pack-radius) rotation, f = v / (2 pi * r), r = 18 mm C-90
        // mid-wind pack radius (ledger window 0.30-0.69 Hz) [C].
        HUB_HZ: 0.42110,
        // Broadband flutter band top. The DIN weighting is 20 dB down by
        // here, and scrape flutter (> 1 kHz) is excluded as double counting
        // against the modulation noise (ledger section 8) [C].
        FLUTTER_BAND_HZ: 40,
        // Servo leak: the flutter delay walk is bounded by the deck holding
        // long-term speed, modelled as a 1 Hz leaky integrator [C].
        FLUTTER_FLOOR_HZ: 1.0,
        // Relative speed deviation per DIN percent: peak for the two
        // periodic terms, RMS for the flutter process. ratio / 1.1045
        // (solved, see the block comment).
        CAPSTAN_SPEED_PER_PERCENT: 0.00905396,
        HUB_SPEED_PER_PERCENT: 0.00543237,
        FLUTTER_SPEED_PER_PERCENT: 0.00633777,
        // Base transport delay and ring. Measured max |delay deviation| at
        // wf = 1.000 % — the top of the control — is 2.861 ms (44.1-192 kHz
        // x 5 seeds x 60 s, w4-solve.mjs; the 0.42 Hz hub term owns 2.05 ms
        // of it — cassette wow is lower and larger than open-reel, which is
        // why the open-reel 5 ms / 4096 pair was not copied). 3.5 ms leaves
        // 0.55 ms (about 17 flutter sigma) above the measured peak, so the
        // deviation clamp stays a safety net that normal settings never hit.
        //
        // The RING columns size the delay line. Every term the line has to
        // hold — the base delay, the deepest wow excursion, the azimuth lag —
        // is proportional to the host rate, so ONE ring length is a fixed
        // length in seconds at exactly one rate. It used to be a bare 2048,
        // sized for 192 kHz; at 352.8 and 384 kHz that left the deviation
        // clamp acting as a ceiling on wow (flat-topping the 0.42 Hz hub
        // term from wf ≈ 0.62 % up) instead of as a safety net. The ring is
        // therefore chosen per rate from these columns — see the ring block
        // in the processor for the arithmetic.
        //
        //   PEAK_DEVIATION_SECONDS  the measured peak above, in seconds, so
        //                           the sizing scales with the rate the same
        //                           way the trajectory does. It is the peak
        //                           at the TOP of the wf control, which is
        //                           what a length fixed at configuration
        //                           time has to budget for.
        //   RING_MARGIN_SAMPLES     the cubic interpolator's reach plus the
        //                           floor(): the deepest tap is
        //                           readFloor - 1 = position - base -
        //                           deviation - azLag - 2 and has to stay
        //                           strictly behind the write pointer, so
        //                           3 is the exact requirement and 4 leaves
        //                           one sample of slack.
        //   RING_MIN_LENGTH         the floor, and the reason every rate up
        //                           to and including 192 kHz still picks
        //                           2048 (the requirement there is 1236.9
        //                           samples): the shipped goldens do not
        //                           move. It also covers the dry tap's
        //                           base + oversampler latency (683 samples
        //                           at 192 kHz).
        //   RING_MAX_LENGTH         the native kernel's fixed capacity. The
        //                           requirement is 2469.8 samples at
        //                           384 kHz, the highest rate the
        //                           application offers, and only passes 4096
        //                           above about 637 kHz — where the clamp
        //                           would become a bound again.
        BASE_SECONDS: 0.0035,
        PEAK_DEVIATION_SECONDS: 0.002861,
        RING_MARGIN_SAMPLES: 4,
        RING_MIN_LENGTH: 2048,
        RING_MAX_LENGTH: 4096
    }
};

// The per-Type hiss floors live under their plan symbols (H_I/H_II/H_IV) so
// the ledger can be diffed against the plan; this map is the indirection the
// class and the processor share to resolve a Type to its symbol.
const CASSETTE_ARTIFACTS_TYPE_HISS_KEY = {
    'Type I': 'H_I',
    'Type II': 'H_II',
    'Type IV': 'H_IV'
};

// The bottom of the Hiss control, and the value at or below which the noise
// generator is switched off outright — now in the control's own unit, dB re
// 250 nWb/m (W-A). The value keeps the slider's 50 dB span (-92 to -42); it
// is 31.5 dB below the Type II Base the control is named against.
//
// What that comes to at the output is no longer a single number, because the
// floor follows Record Level: the loudest it can be with the control at the
// bottom is the shipped Type I at the coldest Record Level, measured at
// -75.7 dBFS A-weighted. That is silence for listening purposes — around
// 24 dB SPL(A) on a 0 dBFS = 100 dB SPL calibration — so the last 0.1 step
// into the hard off is inaudible, which is what the threshold has to buy.
const CASSETTE_ARTIFACTS_HISS_OFF_DB = -92;

const CASSETTE_ARTIFACTS_REFERENCE_PROCESSOR = `
    if (!parameters.enabled) return data;

    const blockSize = parameters.blockSize;
    const channelCount = parameters.channelCount;
    const sampleRate = parameters.sampleRate;
    if (!(blockSize > 0) || !(channelCount > 0) || !(sampleRate > 0)) return data;

    const mixRatio = parameters.mx * 0.01;
    // mx = 0 must be a bit-for-bit dry path.
    if (!(mixRatio > 0)) return data;

    const CAL = ${JSON.stringify(CASSETTE_ARTIFACTS_CALIBRATION)};
    const TYPE_HISS_KEY = ${JSON.stringify(CASSETTE_ARTIFACTS_TYPE_HISS_KEY)};
    const TYPES = CAL.TYPES;
    // Fixed transport speed: 1 7/8 ips, exactly.
    const VELOCITY = CAL.SPEED_MPS;

    const TWO_PI = 6.283185307179586;
    // Record pre-emphasis: per Type, built from the IEC reproduce time
    // constant (typeEntry.eqUs: 120 µs Type I [B], 70 µs Type II/IV [A]) and
    // the fitted HF drive (typeEntry.preEmphDb). It is realised as TWO
    // identical first-order shelves of preEmphDb/2 each — a single 6 dB/oct
    // shelf anchored at 70 µs is slope-limited to about +12 dB at 10 kHz and
    // cannot reach the drive the published Type II SOL implies at 4.76 cm/s,
    // and a real deck's record equaliser is a multi-pole network anyway. The
    // reproduce post-emphasis is the exact digital inverse of both sections.
    // The 3180 µs LF term of the IEC curve is deliberately absent: it models
    // the playback head differentiation against the reproduce amplifier's
    // integrator, neither of which shapes the signal on its way onto the
    // tape (same argument as Tape Artifacts' header).
    const EQ_REFERENCE_HZ = 1000;
    // Reproduce head gap and head-to-tape spacing. The gap is the TDK
    // reference deck's 1 µm PB head gap (ledger §7 [A]); its first null,
    // v / gap = 47.6 kHz, is above the audio band, so the low-order section
    // stands and no short FIR is needed (plan §3). The effective magnetic
    // spacing is not a datasheet quantity: 0.2 µm is a representative value
    // for a lapped contact head in service [C] (Tape Artifacts documents
    // 0.25 µm for the open-reel head; the smaller cassette head in pressure
    // contact runs at least as tight).
    const PLAY_GAP_METERS = 1.0e-6; // [A] TDK reference deck
    const SPACING_METERS = 0.2e-6; // [C] representative effective spacing
    // Head bump (contour). The reproduce head's finite contact length puts an
    // alternating ripple on the LF response with lobes at f_k = k v / L: a
    // hump, a dip, a smaller hump. Ledger §10 gives the contact-length window
    // (0.7-1.0 mm, so f_1 = 48-68 Hz — inside the audio band, no artificial
    // move needed) and the "+2 dB class" amplitude; the length and the first
    // lobe's size are per Grade (CAL.GRADES), the alternating law below is
    // shared. Q is fixed per lobe order so every lobe has the same absolute
    // bandwidth: Q_k = k Q_1, which is what a fixed contact length implies.
    // The DC blocker stays after the bump.
    const HEAD_BUMP_Q = 1.0; // [C] ledger §10 recommended initial value
    // Record amplifier band limit, 2-pole Butterworth, per Grade
    // (CAL.GRADES.recordBandwidthHz). A deck's record amp runs out somewhere
    // between the audio band top and its bias trap, and the column keeps the
    // amp from shaping the band the wavelength losses already own. Clamped
    // below Nyquist at 44.1 kHz by the 0.45 fs guard.
    // Head alignment trim: the bounded inverse of the playback wavelength
    // loss — the deck's record calibration flattening the replay response.
    // Because the trim and the loss are the same corner, their product is
    // one pole per term at the trim gain times the loss corner. The budget is
    // per Grade (CAL.GRADES.trimMaxDb) and is SOLVED from the class's -3 dB
    // target, not chosen; see the GRADES comment.
    // -3 dB points of the analytic loss terms, as a multiple of v / (2 pi x).
    const THICKNESS_THREE_DB = 0.742;
    const GAP_THREE_DB = 1.3916;
    const SPACING_THREE_DB = 0.3454;
    // Saturation reference. The operating level is a 1 kHz sine whose peak
    // reaches SATURATION_REFERENCE_DBFS at the saturator input, which is what
    // the Record Level control establishes; -18 dBFS ≡ 250 nWb/m is the
    // ledger's operating-point definition. SATURATION_REFERENCE_T is kept as
    // the transfer's shape anchor (where the reference peak sits on the
    // normalised sigmoid, carried from Tape Artifacts [C]); the absolute
    // per-Type ceilings do NOT come from it — they are the fitted
    // headroomDb / preEmphDb columns, solved by rendering this processor
    // against the TDK MOL/SOL targets (ledger §3), so low/mid and HF
    // headroom are set independently rather than by one broadband number.
    const SATURATION_REFERENCE_DBFS = -18;
    const SATURATION_REFERENCE_PEAK = Math.pow(10, SATURATION_REFERENCE_DBFS / 20);
    const SATURATION_REFERENCE_T = 0.1157; // [C] transfer shape anchor (Tape Artifacts)
    // The A-weighted no-signal floor of the reference configuration —
    // Type II, NR Off — in dB re 250 nWb/m. This is the Base the hs control
    // names: set the control to this value and the tape's floor is the TDK SA
    // datasheet's. What that comes to in dBFS depends on Record Level, which
    // is exactly the point of W-A; the status line does that arithmetic.
    const HISS_REFERENCE_DB = CAL.H_II;
    const HISS_OFF_DB = ${CASSETTE_ARTIFACTS_HISS_OFF_DB};
    // --- IEC 3180 us LF pair (W-C) ----------------------------------------
    // The IEC reproduce curve's LF time constant. Unlike the 70/120 us pair,
    // this one is NOT symmetric between record and reproduce, and that
    // asymmetry is the cassette's LF end.
    //
    // Physics: the reproduce head's output is the flux derivative (proportional
    // to j omega) and the reproduce amplifier integrates with a corner at
    // tau1 = 3180 us, so the product is exactly a first-order high-pass at
    // 1 / (2 pi tau1) = 50.049 Hz. To get a flat reproduced response the
    // standard therefore demands a 6 dB/oct FLUX BOOST below 50 Hz on the
    // record side — +8.6 dB at 20 Hz, +14.2 dB at 10 Hz, divergent at DC.
    // No machine can supply that, and the ceiling it can supply is a property
    // of the deck: hence a bounded record boost
    //     H_rec(s) = G (1 + s tau1) / (1 + s G tau1),  G = 10^(lfBoostMaxDb/20)
    // whose product with the exact playback high-pass is one first-order
    // high-pass at 50.049 / G Hz. One pole and one zero, no free parameters.
    //
    // The boost sits AHEAD of the saturator (record side), which is the whole
    // point: the flux the tape has to hold at 30 Hz is G times what the
    // programme says, so deep bass reaches the ceiling before the midrange
    // does. Putting it on the reproduce side would give the same magnitude
    // response and none of the behaviour.
    const LF_TAU = 3180e-6; // [A] IEC 60094 reproduce LF time constant
    // Dolby B/C compander (W-5). Everything below derives from CAL.DOLBY —
    // see the calibration table for the stage model, the corner law and its
    // anchors. The stereo question: consumer B/C processors are per-channel
    // circuits (one NR IC or IC half per channel, no shared control bus), so
    // the detectors here are per-channel too — an unlinked pair, like the
    // hardware.
    const DOLBY = CAL.DOLBY;
    const DOLBY_TABLE_SIZE = DOLBY.TABLE_SIZE;
    const DOLBY_TABLE_MAX_Q = DOLBY.TABLE_MAX_Q;
    const DOLBY_TABLE_INV_MAX_Q = 1 / DOLBY_TABLE_MAX_Q;
    const DOLBY_SLIDE_Q_THRESHOLD = Math.pow(10, DOLBY.SLIDE_THRESHOLD_DB / 20);
    const DOLBY_SLIDE_EXPONENT = Math.log(DOLBY.SLIDE_AT_REFERENCE)
        / Math.log(1 + 1 / DOLBY_SLIDE_Q_THRESHOLD);
    const DOLBY_REFERENCE_PEAK = Math.pow(10, DOLBY.LEVEL_DBFS / 20);
    // Full-wave-rectified sine mean: maps a sine's peak amplitude onto the
    // detector's units, so q = 1 for a sine sitting at the stage reference.
    const DOLBY_DETECTOR_SINE_MEAN = 0.6366197723675814;
    const DOLBY_INV_REF_ENC = 1 / (DOLBY_REFERENCE_PEAK * DOLBY_DETECTOR_SINE_MEAN);
    // Per-channel state slots per stage: [ctrl LP, detector, skew LP,
    // sliding-band LP, anti-sat state]; a mode bank is 2 directions
    // (encode/decode) x 2 stage slots x 5, per channel, and both mode banks
    // exist so a crossfade can keep the outgoing mode running.
    const DOLBY_SLOTS_PER_STAGE = 5;
    const DOLBY_SLOTS_PER_DIR = 2 * DOLBY_SLOTS_PER_STAGE;
    const DOLBY_SLOTS_PER_MODE = 2 * DOLBY_SLOTS_PER_DIR;
    // Packed per-stage coefficients: [gain, ctrl-HP a, skew a (1 = none),
    // antiSat b0, antiSat b1, antiSat a1 (1,0,0 = unity), attack, release,
    // inverse-reference multiplier 10^(-refOffsetDb/20)].
    const DOLBY_COEF_STRIDE = 9;
    // Asymmetry as a ratio: the negative excursion sees a ceiling this much
    // higher than the positive one, so the even-order content rises with
    // level instead of vanishing as the tape is driven harder. Asymmetry and
    // the short-time memory are individual-coefficient decisions the plan
    // leaves to implementation time; the Tape Artifacts values are carried
    // [C] and the MOL/SOL fit was run with them in place, so their effect is
    // inside the fitted columns. W-8 owns any audibility retune.
    const SATURATION_ASYMMETRY = 0.12; // [C] carried from Tape Artifacts
    const MEMORY_DEPTH = 0.25; // [C] carried from Tape Artifacts
    const MEMORY_ATTACK_SECONDS = 0.002; // [C] carried from Tape Artifacts
    const MEMORY_RELEASE_SECONDS = 0.015; // [C] carried from Tape Artifacts
    // A single blocker, placed after the reproduce post-emphasis so that it
    // does not sit on top of the head bump.
    const DC_BLOCK_HZ = 5;
    // Bias. Same two-term structure as Tape Artifacts: an erasure corner
    // that slides down with overbias, plus a short-wavelength sensitivity
    // shelf solved so the 10 kHz probe drop from the sensitivity peak to
    // bs = 0 equals the Type's deltaS10Db. The manufacturer S10 curve graphs
    // were unreachable (ledger §3), so the law is the ledger's
    // anchor-constrained substitute [C]: bs = 0 sits deltaS10Db (2-3 dB [B])
    // of overbias beyond the 10 kHz sensitivity peak, underbias walks up to
    // the peak and darkens beyond it (the peak reversal is real-deck
    // behaviour and stays unprotected, plan §3), overbias trades HF for
    // low/mid headroom through the erasure corner and the bias^0.7 ceiling
    // term. 40 kHz [C] leaves the erasure pole -0.26 dB at 10 kHz at the
    // recommended point and pulls it to 21 kHz at bs = +6.
    const BIAS_CORNER_HZ = 40000; // [C] erasure corner at the recommended bias
    const BIAS_CORNER_EXPONENT = 1.1; // [C] carried from Tape Artifacts
    const BIAS_SHELF_HZ = 8000; // [C] sensitivity shelf centre below the probe
    // dB of S10 between the peak and bs = 0, per dB of peak offset squared.
    const BIAS_PEAK_CURVATURE = 0.2; // [C] carried from Tape Artifacts
    // The peak is rounded over half a decibel of bias either side.
    const BIAS_PEAK_WIDTH_DB = 0.5; // [C] carried from Tape Artifacts
    // Far outside the control's range the law is a straight line in dB, and
    // an unbounded shelf gain drags the section's pole down onto DC. The
    // processor does not clamp bs, so the gain is clamped instead.
    const BIAS_SHELF_LIMIT_DB = 40;
    // The test tone the bias procedure itself uses.
    const BIAS_PROBE_HZ = 10000;
    // Transport modulation at the fixed cassette speed (W-4). Base
    // Wow/Flutter is a deviation in percent, peak weighted according to
    // DIN 45507 / IEC Publ. 386; the CAL.TRANSPORT literals are solved so
    // the rendered trajectory at wf measures wf percent on the frozen meter
    // (see the calibration table). The trajectory is generated directly in
    // the DELAY domain:
    //   - each periodic speed component a*sin(2 pi f t) is a delay sinusoid
    //     of amplitude a / (2 pi f) (the plan's buffer identity);
    //   - the flutter SPEED process (flat between the servo floor and the
    //     band top) is realised as two cascaded one-pole stages in the
    //     delay domain — white noise -> one-pole at the band top -> leaky
    //     integrator (one-pole at the servo floor) — because the delay is
    //     the integral of the speed and the leak is what bounds the walk.
    //     Its gain is normalised at configuration time so the RMS of the
    //     per-sample delay DIFFERENCE (= the relative speed deviation) is
    //     exactly the calibrated speed RMS at every host rate.
    const CAPSTAN_HZ = CAL.TRANSPORT.CAPSTAN_HZ;
    const HUB_HZ = CAL.TRANSPORT.HUB_HZ;
    const FLUTTER_BAND_HZ = CAL.TRANSPORT.FLUTTER_BAND_HZ;
    const FLUTTER_FLOOR_HZ = CAL.TRANSPORT.FLUTTER_FLOOR_HZ;
    const CAPSTAN_SPEED_PER_PERCENT = CAL.TRANSPORT.CAPSTAN_SPEED_PER_PERCENT;
    const HUB_SPEED_PER_PERCENT = CAL.TRANSPORT.HUB_SPEED_PER_PERCENT;
    const FLUTTER_SPEED_PER_PERCENT = CAL.TRANSPORT.FLUTTER_SPEED_PER_PERCENT;
    // Points in the flutter normalisation integral (kept identical to the
    // solver, w4-solve.mjs, so the solved literals transfer exactly).
    const TRANSPORT_INTEGRATION_POINTS = 1024;
    // Base transport delay, sized from the measured wf = 1.000 %
    // trajectories (see CAL.TRANSPORT). The ring the delay runs in is sized
    // per host rate further down, once the azimuth budget is known.
    const TRANSPORT_BASE_SECONDS = CAL.TRANSPORT.BASE_SECONDS;
    // 23-tap Kaiser (beta = 5) half-band, used both ways around the
    // saturation stage; polyphase, the odd branch a pure delay. W-3 re-checks
    // the alias budget at maximum cassette drive.
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
    // Hiss band limits and modulation-noise correlation length, frozen
    // (W-6). The ledger carries no per-bin cassette hiss spectrum — §2
    // fixes the A-weighted integral only, and the plan says to keep the
    // Tape Artifacts 60 Hz / 12 kHz envelope as the shape in that case and
    // to prefer the integral over any per-bin claim. The calibrated
    // quantity is therefore the A-weighted normalisation through
    // cascadeNoiseGain below, which pins the floor to the H_* columns
    // whatever sits inside the band; the shape literals are representative.
    const HISS_HIGH_PASS_HZ = 60; // [C] representative band shape (see note)
    const HISS_LOW_PASS_HZ = 12000; // [C] representative band shape (see note)
    // Modulation-noise correlation length: the corner v / (2 pi L) is
    // 253 Hz at cassette speed — the same few-hundred-hertz sideband
    // spread as the open-reel file's 337 Hz at 38.1 cm/s (from 180 um),
    // i.e. the defect correlation length scales sub-linearly with speed
    // rather than tracking it (a straight speed scaling, 22.5 um, would
    // claim the spectrum narrows 8x, which no source supports).
    const MODULATION_LENGTH_METERS = 30e-6; // [C] frozen (W-6), corner 253 Hz
    // --- azimuth (W-6, made a live axis by W-D) --------------------------
    // The ledger §7 geometry turns a head azimuth error theta into two
    // effects:
    //   in-track loss   L(f) = sinc(pi f tau_a), tau_a = w tan(theta) / v
    //   inter-track lag dt = s tan(theta) / v   (track centre spacing s)
    // The in-track loss is a one-pole low-pass whose corner is solved in Hz
    // from tau_a, and the lag (11.0 us at 2 arcmin) is a +-dt/2 split of the
    // transport read position of channels 0/1, so the existing cubic
    // interpolator is the fractional delay and the phase costs no extra
    // stage. Application rule (plan §3): magnitude on every channel; the
    // relative phase only on the channel 0/1 pair (stereo and multichannel
    // alike); mono is magnitude-only.
    //
    // Why a one-pole and not the 2-tap FIR this started as: a 2-tap section
    // smears over exactly one sample, so the loss it can represent is capped
    // at g(1-g) = 0.25 and the ANGLE at which it hits that cap moves with the
    // host rate (4.9 arcmin at 96 kHz, 2.5 at 192 kHz). That was true but
    // harmless while the azimuth was a frozen 2 arcmin; W-D opened theta to
    // 22 arcmin and walked straight past it, which killed the top of the
    // Azimuth control and — worse — collapsed the Grade wobble column at high
    // rates, because every Grade's excursions clipped to the same ceiling.
    // The fault is structural: the filter's length was pinned to 1/fs seconds
    // while the loss it models is pinned to tau_a seconds. Solving the corner
    // in Hz takes the host rate out of the SHAPE — there is no longer an
    // angle at which the loss stops responding, at any rate. A residual rate
    // dependence remains, because firstOrder() matches the Nyquist magnitude
    // as well as the pole: worst case 0.46 dB, at az 6 arcmin and 16 kHz
    // across 44.1-192 kHz, against 0.05 dB at the shipped default. A native
    // port therefore still has to verify rate parity rather than assume it.
    //
    // Corner: match the curvature of the sinc, which is the same second-order
    // agreement the 2-tap was solved for, so nothing about the small-angle
    // behaviour changes. |sinc(x)|^2 = 1 - x^2/3 + ... with x = pi f tau_a,
    // and a one-pole is 1 - (f/f_c)^2 + ..., so f_c = sqrt(3) / (pi tau_a),
    // i.e. a pole time constant of tau_a / (2 sqrt(3)).
    //
    // What this cannot do is the sinc's nulls (first null at 1/tau_a, which
    // enters the audio band above about 14 arcmin). Measured against the
    // exact sinc over the whole reachable domain, the pointwise error stays
    // under 0.28 dB to 4 arcmin and 0.71 dB at the control's own +-6 arcmin
    // limit, crossing 1.5 dB only at 7.2 arcmin — an angle reachable only in
    // the wobble tail of the two noisiest Grades. What a listener is exposed
    // to is the expectation over that wobble, since theta(t) moves at 0.5 Hz
    // against audio, and that stays at or under 1.37 dB at the single most
    // extreme legal setting (Portable at az +6) and 0.127 dB at the shipped
    // default (Consumer at az +2; the 0.314 dB figure belongs to Portable at
    // az +2). verify/r1-01-sinc-deviation.mjs is the measurement.
    const AZ_POLE_TAU_RATIO = 0.2886751345948129; // 1 / (2 sqrt(3))
    // The coefficients are a table, not a per-sample solve: the design needs
    // an exp and a sqrt, and the audio loop should carry neither (the same
    // argument the Dolby level tables are built on). |theta| indexes it
    // linearly, so a native port needs one table build and a lerp.
    const AZ_TABLE_SIZE = 512;
    //
    // W-D splits theta into two parts with different owners:
    //   theta(t) = az (signed user control, the static misalignment of this
    //              pair of machines) + wobble(t) (Grade-owned short-term
    //              drift of the head-to-tape contact).
    // The wobble is white noise through two identical one-pole stages — the
    // same idiom as the transport's flutter chain, and with the same
    // closed-form stationary variance, so it is normalised once per rate and
    // measures the Grade's arcmin sigma at every host rate. It must be
    // BOUNDED (a random walk would drift the head off the track), and two
    // cascaded poles at 0.5 Hz are: the process is stationary with a 0.32 s
    // memory, pulling back to the mean alignment the way a real guide does.
    // A 4 sigma hard clamp is the divergence net, nothing more.
    //
    // Because theta moves, the in-track coefficients and the L/R lag move
    // with it. They are updated EVERY SAMPLE — not interpolated across a
    // block — so block splitting cannot change the output and a zipper is
    // structurally impossible. The per-sample cost is a table lookup and
    // three lerps (azLookup below), shared by all channels: THIS STAGE
    // carries no per-sample transcendental. The audio loop as a whole still
    // does — the transport's two sines, the saturator's sqrt, the Dolby
    // detectors' sqrt, the dropout envelope's cosine — and the native port's
    // playbook lists those as the places where V8 and libm can disagree in
    // the last ulp. tan() is dropped here for the small-angle identity
    // (|theta| <= 22 arcmin, relative error < 1.4e-5).
    const AZ_WOBBLE_CORNER_HZ = 0.5; // [C] 0.32 s contact-drift memory
    const AZ_WOBBLE_CLAMP_SIGMA = 4; // [C] divergence net only
    const ARCMIN_TO_RADIANS = 2.908882086657216e-4; // pi / (180 * 60)
    const TRACK_WIDTH_METERS = CAL.TRACK_WIDTH_M; // [A] 0.6 mm stereo track
    const TRACK_SPACING_METERS = CAL.TRACK_CENTER_SPACING_M; // [B] 0.9 mm centres
    // Worst-case |theta| the transport read position has to budget for: the
    // control's own limit plus the largest Grade's clamped wobble. The
    // deviation clamp subtracts the lag this implies, so the cubic
    // interpolator can never read past the write position however the two
    // combine (the pre-W-D clamp only budgeted for the transport and happened
    // to survive because the azimuth was frozen at 2 arcmin).
    let azMaxWobbleArcmin = 0;
    for (const gradeName in CAL.GRADES) {
        const wobble = CAL.GRADES[gradeName].azWobbleArcmin;
        if (wobble > azMaxWobbleArcmin) azMaxWobbleArcmin = wobble;
    }
    const AZ_THETA_MAX_RADIANS = (CAL.AZ_MAX_ARCMIN
        + AZ_WOBBLE_CLAMP_SIGMA * azMaxWobbleArcmin) * ARCMIN_TO_RADIANS;
    // --- transport ring size ---------------------------------------------
    // The delay line has to hold the base delay, the deepest wow excursion,
    // the azimuth lag and the cubic interpolator's reach — and the first
    // three are all proportional to the host rate. A rate-independent length
    // is therefore a fixed length in SECONDS at exactly one rate, which is
    // what the old bare 2048 was: sized for 192 kHz, and at 352.8 / 384 kHz
    // no longer able to hold the trajectory, so the deviation clamp turned
    // from a safety net into a ceiling on wow.
    //
    // Required length, every term at the top of its control:
    //   base           round(BASE_SECONDS * fs)
    //   deepest wow    PEAK_DEVIATION_SECONDS * fs — the measured peak of
    //                  the calibrated trajectory at wf = 1 %, the top of the
    //                  control (CAL.TRANSPORT). The ring is allocated when
    //                  the rate changes and wf moves under it, so the length
    //                  has to budget for the control's top, not for its
    //                  current value.
    //   azimuth lag    the same worst-case half-lag the deviation clamp
    //                  budgets for, at this rate.
    //   margin         RING_MARGIN_SAMPLES (see the calibration table).
    // rounded up to a power of two — the ring is masked, not divided —
    // floored at RING_MIN_LENGTH and capped at the native kernel's
    // RING_MAX_LENGTH. The floor is what holds every rate up to 192 kHz at
    // exactly 2048, so DELAY_MASK there is bit-for-bit what it always was.
    //
    // The two-term deviation clamp further down stays exactly where it is:
    // sizing the ring for the CALIBRATED peak leaves the clamp as the safety
    // net for the flutter tail beyond it, which is what it was written to be.
    const AZ_MAX_HALF_DELAY_SAMPLES = 0.5 * TRACK_SPACING_METERS / VELOCITY
        * sampleRate * AZ_THETA_MAX_RADIANS;
    const RING_REQUIRED_SAMPLES = Math.round(TRANSPORT_BASE_SECONDS * sampleRate)
        + CAL.TRANSPORT.PEAK_DEVIATION_SECONDS * sampleRate
        + AZ_MAX_HALF_DELAY_SAMPLES + CAL.TRANSPORT.RING_MARGIN_SAMPLES;
    let ringLength = CAL.TRANSPORT.RING_MIN_LENGTH;
    while (ringLength < RING_REQUIRED_SAMPLES
        && ringLength < CAL.TRANSPORT.RING_MAX_LENGTH) ringLength *= 2;
    const DELAY_LENGTH = ringLength;
    const DELAY_MASK = DELAY_LENGTH - 1;
    // --- dropouts (W-6) --------------------------------------------------
    // Poisson deadline scheduler in absolute samples (plan §3: no block
    // rounding): a unit-exponential budget is drawn from the reserved
    // dropout RNG stream and drained by the per-sample hazard, so the
    // deadline is exact at every block size and rate changes take effect
    // mid-stream without redrawing. Each fired event consumes exactly four
    // draws — defect length, depth, scope, next deadline — whether or not
    // its slot is free, so the realisation is deterministic under any
    // collision pattern. Concurrency is one event per slot (the tape-wide
    // slot plus one track-local slot per channel); a fired event whose slot
    // is still busy is skipped, which at D_MAX costs under 2 % of events
    // (busy fraction = rate x mean duration) and keeps every envelope
    // strictly smooth — no retriggering discontinuities. The envelope is a
    // raised cosine between 1 and the event's floor, smooth in dB by
    // construction (a rectangular gate is the banned alternative).
    const DROPOUT_DEFECT_MIN_METERS = CAL.DROPOUT.DEFECT_MIN_M;
    const DROPOUT_DEFECT_MAX_METERS = CAL.DROPOUT.DEFECT_MAX_M;
    const DROPOUT_DEPTH_MIN_DB = CAL.DROPOUT.DEPTH_MIN_DB;
    const DROPOUT_DEPTH_SPAN_DB = CAL.DROPOUT.DEPTH_SPAN_DB;
    const DROPOUT_LOG_DEFECT_RATIO = Math.log(DROPOUT_DEFECT_MAX_METERS
        / DROPOUT_DEFECT_MIN_METERS);
    // IEC 61672 A-weighting, in its analytic pole-and-zero form. The floor
    // figures are A-weighted, so the hiss is normalised through the same
    // weighting to mean what the table says. Evaluated only when a setting
    // changes.
    const A_WEIGHTING_F1 = CAL.A_WEIGHTING.F1;
    const A_WEIGHTING_F2 = CAL.A_WEIGHTING.F2;
    const A_WEIGHTING_F3 = CAL.A_WEIGHTING.F3;
    const A_WEIGHTING_F4 = CAL.A_WEIGHTING.F4;
    const A_WEIGHTING_REFERENCE_HZ = 1000;
    // Points in the noise-shaping integral.
    const NOISE_INTEGRATION_POINTS = 4096;
    // 2^-31. The draw source is an unsigned 32 bit word, so this scale maps
    // it onto [0, 2) and the -1 at each use site onto [-1, 1).
    const RNG_SCALE = 4.656612873077393e-10;
    // 2^-32: maps an unsigned 32 bit word onto [0, 1) (phase seeding).
    const RNG_UNIT = 2.3283064365386963e-10;

    // Anything below this is 600 dB under full scale; treating it as zero is
    // inaudible and it is the only way a geometric decay ever reaches zero.
    const DENORMAL_THRESHOLD = 1e-30;

    // The record pre-emphasis and its reproduce inverse are two sections
    // each (see the pre-emphasis note above), so the cassette chain carries
    // two more first-order sections than the open-reel file.
    const SECTION_RECORD_EQ = 0;
    const SECTION_RECORD_EQ_B = 1;
    const SECTION_BIAS = 2;
    const SECTION_BIAS_SHELF = 3;
    const SECTION_LOSS_A = 4;
    const SECTION_LOSS_B = 5;
    const SECTION_REPRODUCE_EQ = 6;
    const SECTION_REPRODUCE_EQ_B = 7;
    const SECTION_HISS_HP = 8;
    const SECTION_HISS_LP = 9;
    const SECTION_MODULATION = 10;
    // Azimuth in-track loss (W-6/W-D/R1-01): an ordinary RECURSIVE first-order
    // section, y = b0 x[n] + z, z = b1 x[n] - a1 y[n] — the same form every
    // other section here uses, and this slot holds its filter state, not a
    // delayed input. (It was a 2-tap FIR until R1-01; porting it as one now
    // would break parity.) The coefficients are time-varying, looked up per
    // sample from the table below.
    const SECTION_AZIMUTH = 11;
    // IEC 3180 us pair (W-C): the bounded record-side flux boost and the
    // exact reproduce high-pass. Deliberately NOT inverses of each other.
    const SECTION_RECORD_LF = 12;
    const SECTION_PLAY_LF = 13;
    // Scratch slot: configuration-time solves (the Dolby anti-saturation
    // shelves) borrow it; its per-channel state is never advanced.
    const SECTION_SCRATCH = 14;
    const SECTION_COUNT = 15;

    const BIQUAD_RECORD_AMP = 0;
    // Head contour (W-C): up to three alternating lobes at k v / L.
    const BIQUAD_HEAD_BUMP = 1;
    const BIQUAD_HEAD_BUMP_2 = 2;
    const BIQUAD_HEAD_BUMP_3 = 3;
    const BIQUAD_COUNT = 4;

    // --- first order section helpers ------------------------------------
    // The prototype (1 + s tauZero) / (1 + s tauPole) is realised by matching
    // three things exactly at every host rate: the pole, the DC gain and the
    // magnitude at Nyquist (see Tape Artifacts for the full derivation; the
    // matching keeps every section inside 1 dB of the prototype across
    // 44.1 - 192 kHz and stable by construction, and invertSection() inverts
    // the digital coefficients algebraically so a section against its inverse
    // is exactly one).
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
    // A-weighting curve into the integrand.
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
    // never actually reaches zero: at the bottom of the subnormal range the
    // state latches and every sample after that is subnormal arithmetic. One
    // sweep per block is enough, and doing it here keeps the cost off the
    // audio path entirely.
    function flushDenormals(array) {
        for (let i = 0; i < array.length; i++) {
            const value = array[i];
            if (value < DENORMAL_THRESHOLD && value > -DENORMAL_THRESHOLD) array[i] = 0;
        }
    }

    // --- RNG stream derivation -------------------------------------------
    // One base seed (context.__seededRandom when the host provides one) is
    // split into independent xorshift32 streams, one per stochastic artifact
    // family, so changing one family's controls can never advance another
    // family's sequence (plan section 3). Derivation rule, frozen: XOR the
    // base seed with the family's odd salt, then one xorshift round, with a
    // zero guard on both sides. Salts:
    //   transport 0x9E3779B9 / noise 0x85EBCA6B / dropouts (W-6) 0xC2B2AE35
    //   / azimuth (W-D) 0x27D4EB2F.
    // Each family is derived from the base seed independently, so adding the
    // azimuth stream does not move one bit of the other three — which is what
    // keeps every earlier seeded measurement valid and is the precondition
    // the native port needs (only the per-family consumption order has to
    // match, never the interleaving between families).
    function deriveRngStream(baseSeed, salt) {
        let s = (baseSeed ^ salt) | 0;
        if (s === 0) s = salt | 0;
        s ^= s << 13; s |= 0;
        s ^= s >>> 17;
        s ^= s << 5; s |= 0;
        if (s === 0) s = 0x1a2b3c4d;
        return s;
    }

    // --- state ---
    let state = context.cassetteArtifacts;
    if (!state || state.sampleRate !== sampleRate || state.channelCount !== channelCount) {
        const delays = new Array(channelCount);
        const dry = new Array(channelCount);
        for (let ch = 0; ch < channelCount; ch++) {
            delays[ch] = new Float32Array(DELAY_LENGTH);
            dry[ch] = new Float32Array(DELAY_LENGTH);
        }
        // Dropout slots (W-6): phase >= 1 means idle; a fresh state is all
        // idle. Slots exist even at dp = 0 (allocation is state creation,
        // not consumption) so enabling dropouts later allocates nothing.
        const dropoutLocalPhase = new Float64Array(channelCount);
        dropoutLocalPhase.fill(1);
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
            capstanPhase: 0,
            hubPhase: 0,
            flutterA: 0,
            flutterB: 0,
            rngTransport: 0,
            rngNoise: 0,
            // Azimuth wobble (W-D): its own stream and the two one-pole
            // stages. The process starts at the mean alignment and settles
            // in a few time constants, which is what a machine that has just
            // been threaded does; no initial draw, so the stream's
            // consumption is exactly one draw per sample while it runs.
            rngAzimuth: 0,
            azWobbleA: 0,
            azWobbleB: 0,
            azCoefficient: 0,
            azWobbleScale: 0,
            azWobbleSdRadians: 0,
            azWobbleClampRadians: 0,
            // In-track loss coefficients over |theta|, interleaved b0/b1/a1,
            // with one duplicated entry at the top for the interpolation.
            azTable: new Float64Array((AZ_TABLE_SIZE + 2) * 3),
            azTableScale: 0,
            azHalfDelayScale: 0,
            // Dropouts (W-6): the reserved RNG stream, the unit-exponential
            // deadline budget (-1 = not drawn yet, the dp = 0 hard-off
            // sentinel) and the event slots — one tape-wide, one per
            // channel. The two event counters are diagnostics only: they
            // are never read by the audio path, and the W-6 verification
            // uses them for the Poisson rate statistics.
            rngDropout: 0,
            dropoutBudget: -1,
            dropoutSharedPhase: 1,
            dropoutSharedIncrement: 0,
            dropoutSharedDepth: 0,
            dropoutLocalPhase: dropoutLocalPhase,
            dropoutLocalIncrement: new Float64Array(channelCount),
            dropoutLocalDepth: new Float64Array(channelCount),
            dropoutSharedEvents: 0,
            dropoutLocalEvents: new Float64Array(channelCount),
            // Dolby B/C: two mode banks (B, C) of per-channel encode/decode
            // stage states, the level->coefficient tables and the packed
            // stage coefficients, plus the mode-crossfade bookkeeping.
            // dolbyMode -1 is the fresh-state sentinel: the first block
            // adopts the current nr without a fade.
            dolbyBank: new Float64Array(2 * DOLBY_SLOTS_PER_MODE * channelCount),
            dolbyTableB: new Float64Array(DOLBY_TABLE_SIZE + 2),
            dolbyTableC: new Float64Array(DOLBY_TABLE_SIZE + 2),
            dolbyCoefB: new Float64Array(DOLBY_COEF_STRIDE),
            dolbyCoefC: new Float64Array(2 * DOLBY_COEF_STRIDE),
            dolbyMode: -1,
            dolbyPrevMode: 0,
            dolbyFade: 0,
            dolbyFadeLength: Math.max(1, Math.round(DOLBY.FADE_SECONDS * sampleRate)),
            hissGain: 0,
            modulationGain: 0,
            saturationBase: 1,
            memoryScale: 0,
            attackCoefficient: 0,
            releaseCoefficient: 0,
            dcCoefficient: 0,
            capstanIncrement: 0,
            hubIncrement: 0,
            capstanDelayPerPercent: 0,
            hubDelayPerPercent: 0,
            flutterCoefficientA: 0,
            flutterCoefficientB: 0,
            flutterDelayPerPercent: 0,
            baseDelaySamples: 0,
            azimuthHalfDelaySamples: 0,
            configurationKey: ''
        };
        let seed = Math.floor(((typeof context.__seededRandom === 'function'
            ? context.__seededRandom
            : Math.random)() * 4294967296)) | 0;
        if (seed === 0) seed = 0x1a2b3c4d;
        state.rngTransport = deriveRngStream(seed, 0x9E3779B9 | 0);
        state.rngNoise = deriveRngStream(seed, 0x85EBCA6B | 0);
        state.rngDropout = deriveRngStream(seed, 0xC2B2AE35 | 0);
        state.rngAzimuth = deriveRngStream(seed, 0x27D4EB2F | 0);
        // The two wow phases are drawn once from the transport stream at
        // state creation — a fixed two-draw prefix ahead of any per-sample
        // consumption — so a fresh state starts at a seed-deterministic
        // point of both cycles without touching any other family's stream.
        let phaseDraw = state.rngTransport;
        phaseDraw ^= phaseDraw << 13; phaseDraw |= 0;
        phaseDraw ^= phaseDraw >>> 17;
        phaseDraw ^= phaseDraw << 5; phaseDraw |= 0;
        state.capstanPhase = TWO_PI * ((phaseDraw >>> 0) * RNG_UNIT);
        phaseDraw ^= phaseDraw << 13; phaseDraw |= 0;
        phaseDraw ^= phaseDraw >>> 17;
        phaseDraw ^= phaseDraw << 5; phaseDraw |= 0;
        state.hubPhase = TWO_PI * ((phaseDraw >>> 0) * RNG_UNIT);
        state.rngTransport = phaseDraw;
        context.cassetteArtifacts = state;
    }

    // Resolve the Type key rather than the entry, because the hiss floor is
    // indexed by the same key through TYPE_HISS_KEY, and fall back once.
    const typeKey = TYPES[parameters.tp] ? parameters.tp : 'Type II';
    const typeEntry = TYPES[typeKey];
    // Deck Grade (W-E): same fall-back rule as the Type. It only enters the
    // configuration block, so a Grade change is one coefficient rebuild and
    // nothing per sample. rl, az and dl are deliberately NOT in the key:
    // none of them touches a coefficient, so dragging them never rebuilds.
    const gradeKey = CAL.GRADES[parameters.dg] ? parameters.dg : CAL.GRADE_DEFAULT;
    const grade = CAL.GRADES[gradeKey];
    const configurationKey = typeKey + '/' + parameters.nr + '/' + parameters.bs
        + '/' + parameters.hs + '/' + gradeKey;
    if (state.configurationKey !== configurationKey) {
        const coefficients = state.coefficients;
        const twoFs = 2 * sampleRate;
        const bias = Math.pow(10, parameters.bs / 20);
        const trimMaxGain = Math.pow(10, grade.trimMaxDb / 20);

        // Record pre-emphasis, normalised to 0 dB at 1 kHz: two identical
        // first-order shelves (1 + s tau2) / (1 + s tau2 / g), tau2 the
        // Type's reproduce time constant and g = preEmphDb / 2 per section
        // (see the constants note). Each section is normalised at 1 kHz and
        // inverted separately, so the reproduce post-emphasis is the exact
        // digital inverse of the whole pair by construction.
        const recordPreTau = typeEntry.eqUs * 1e-6;
        const recordPreGain = Math.pow(10, typeEntry.preEmphDb / 40);
        firstOrder(recordPreTau, recordPreTau / recordPreGain, twoFs,
            coefficients, SECTION_RECORD_EQ);
        const referenceOmega = TWO_PI * EQ_REFERENCE_HZ / sampleRate;
        const referenceMagnitude = sectionMagnitude(coefficients, SECTION_RECORD_EQ, referenceOmega);
        scaleSection(coefficients, SECTION_RECORD_EQ, referenceMagnitude > 1e-30 ? 1 / referenceMagnitude : 1);
        coefficients.b0[SECTION_RECORD_EQ_B] = coefficients.b0[SECTION_RECORD_EQ];
        coefficients.b1[SECTION_RECORD_EQ_B] = coefficients.b1[SECTION_RECORD_EQ];
        coefficients.a1[SECTION_RECORD_EQ_B] = coefficients.a1[SECTION_RECORD_EQ];
        // Reproduce post-emphasis is the exact digital inverse.
        invertSection(coefficients, SECTION_RECORD_EQ, SECTION_REPRODUCE_EQ);
        invertSection(coefficients, SECTION_RECORD_EQ_B, SECTION_REPRODUCE_EQ_B);

        // Playback wavelength loss (thickness, then gap combined with
        // spacing), each already multiplied by its own bounded trim. All
        // three corners follow the fixed cassette speed and geometry.
        const thicknessHz = THICKNESS_THREE_DB * VELOCITY / (TWO_PI * typeEntry.coating);
        const gapHz = GAP_THREE_DB * VELOCITY / (Math.PI * PLAY_GAP_METERS);
        const spacingHz = SPACING_THREE_DB * VELOCITY / (TWO_PI * SPACING_METERS);
        const shortHz = 1 / Math.sqrt(1 / (gapHz * gapHz) + 1 / (spacingHz * spacingHz));
        firstOrder(0, 1 / (TWO_PI * thicknessHz * trimMaxGain), twoFs, coefficients, SECTION_LOSS_A);
        firstOrder(0, 1 / (TWO_PI * shortHz * trimMaxGain), twoFs, coefficients, SECTION_LOSS_B);

        // IEC 3180 us pair (W-C). Record side: the bounded flux boost
        // G (1 + s tau1) / (1 + s G tau1). firstOrder() matches DC gain 1 and
        // Nyquist gain tauZero / tauPole = 1 / G, so scaling by G leaves
        // DC = G and HF = 1 exactly — the boost, and only the boost.
        const lfBoost = Math.pow(10, grade.lfBoostMaxDb / 20);
        firstOrder(LF_TAU, LF_TAU * lfBoost, twoFs, coefficients, SECTION_RECORD_LF);
        scaleSection(coefficients, SECTION_RECORD_LF, lfBoost);
        // Reproduce side: head differentiation against the reproduce
        // integrator, i.e. an exact first-order high-pass at 1 / (2 pi tau1).
        // Same rewrite as the hiss high-pass — take the matched pole and put a
        // zero at DC on it — so the corner is right at every host rate.
        firstOrder(LF_TAU, LF_TAU, twoFs, coefficients, SECTION_PLAY_LF);
        coefficients.b0[SECTION_PLAY_LF] = (1 - coefficients.a1[SECTION_PLAY_LF]) * 0.5;
        coefficients.b1[SECTION_PLAY_LF] = -coefficients.b0[SECTION_PLAY_LF];

        // Bias erasure.
        const biasHz = BIAS_CORNER_HZ / Math.pow(bias, BIAS_CORNER_EXPONENT);
        firstOrder(0, 1 / (TWO_PI * biasHz), twoFs, coefficients, SECTION_BIAS);
        // Short-wavelength sensitivity, as a shelf of gain g about a fixed
        // corner. Zero at w / sqrt(g) and pole at w sqrt(g); g = 1 collapses
        // the pair and is written out as an exact passthrough so that the
        // reference bias cannot depend on this section even to one ulp.
        //
        // The gain the peak needs is solved rather than fitted — dS10 comes
        // out right at every host rate. The erasure moves with the bias too,
        // so it is evaluated at both ends and divided out of the target
        // first; what is left is the shelf's share of dS10.
        const deltaS10Db = typeEntry.deltaS10Db;
        const shelfOmega = TWO_PI * BIAS_SHELF_HZ;
        const probeHz = BIAS_PROBE_HZ < sampleRate * 0.45 ? BIAS_PROBE_HZ : sampleRate * 0.45;
        const probeOmega = TWO_PI * probeHz / sampleRate;
        const peakBs = -Math.sqrt(deltaS10Db / BIAS_PEAK_CURVATURE);
        const erasureTau = 1 / (TWO_PI * BIAS_CORNER_HZ);
        firstOrder(0, erasureTau * Math.pow(Math.pow(10, peakBs / 20), BIAS_CORNER_EXPONENT),
            twoFs, coefficients, SECTION_BIAS_SHELF);
        const peakErasure = sectionMagnitude(coefficients, SECTION_BIAS_SHELF, probeOmega);
        firstOrder(0, erasureTau, twoFs, coefficients, SECTION_BIAS_SHELF);
        const shelfTarget = Math.pow(10, deltaS10Db / 20)
            * sectionMagnitude(coefficients, SECTION_BIAS_SHELF, probeOmega) / peakErasure;
        let shelfLow = 1;
        let shelfHigh = 1e6;
        // Geometric bisection over six decades; thirty halvings leave the
        // gain known to a ten-millionth of a decibel.
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
        // are then the same expression evaluated twice.
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
        const modulationHz = VELOCITY / (TWO_PI * MODULATION_LENGTH_METERS);
        firstOrder(0, 1 / (TWO_PI * modulationHz), twoFs, coefficients, SECTION_MODULATION);

        // Band limits.
        const recordBandwidthHz = grade.recordBandwidthHz;
        const recordHz = recordBandwidthHz < sampleRate * 0.45 ? recordBandwidthHz : sampleRate * 0.45;
        lowPassBiquad(state.biquadCoefficients, BIQUAD_RECORD_AMP, recordHz, 0.7071067811865476, sampleRate);
        // Head contour (W-C): the finite contact length does not put ONE hump
        // on the LF response, it puts an alternating ripple on it, with lobes
        // roughly evenly spaced at f_k = k v / L. Lobe k gets
        // (-1)^(k+1) A / k dB — alternating sign, 1 / k decay — and
        // Q_k = k Q_1, so every lobe has the same absolute bandwidth, which
        // is what one contact length implies. Unused lobes are written out as
        // exact pass-throughs so a two-lobe Grade costs nothing per sample
        // beyond the multiply by 1.
        const bumpHz = VELOCITY / grade.contactLengthM;
        const bumpIndices = [BIQUAD_HEAD_BUMP, BIQUAD_HEAD_BUMP_2, BIQUAD_HEAD_BUMP_3];
        for (let lobe = 0; lobe < bumpIndices.length; lobe++) {
            const order = lobe + 1;
            const lobeHz = bumpHz * order;
            if (order > grade.contourLobes || !(lobeHz < sampleRate * 0.45)) {
                const passBase = bumpIndices[lobe] * 5;
                state.biquadCoefficients[passBase] = 1;
                state.biquadCoefficients[passBase + 1] = 0;
                state.biquadCoefficients[passBase + 2] = 0;
                state.biquadCoefficients[passBase + 3] = 0;
                state.biquadCoefficients[passBase + 4] = 0;
                continue;
            }
            const lobeDb = (order % 2 === 1 ? 1 : -1) * grade.headBumpDb / order;
            peakingBiquad(state.biquadCoefficients, bumpIndices[lobe], lobeHz,
                HEAD_BUMP_Q * order, lobeDb, sampleRate);
        }

        // Saturation operating point.
        state.saturationBase = (SATURATION_REFERENCE_PEAK / SATURATION_REFERENCE_T)
            * Math.pow(10, typeEntry.headroomDb / 20) * Math.pow(bias, 0.7);
        state.memoryScale = MEMORY_DEPTH / state.saturationBase;
        // The envelope runs inside the 2x oversampled stage.
        state.attackCoefficient = 1 - Math.exp(-1 / (MEMORY_ATTACK_SECONDS * sampleRate * 2));
        state.releaseCoefficient = 1 - Math.exp(-1 / (MEMORY_RELEASE_SECONDS * sampleRate * 2));
        state.dcCoefficient = Math.exp(-TWO_PI * DC_BLOCK_HZ / sampleRate);

        // Noise levels (W-A). hs names the Type II / NR Off floor of the
        // TAPE, in dB re 250 nWb/m — the datasheet column, not a dBFS figure
        // — and reaches the other Types through the difference of the
        // H_I/H_II/H_IV columns. hs <= HISS_OFF_DB switches the whole noise
        // family off outright (hard off: the noise branch below is never
        // entered and its RNG stream is never drawn).
        //
        // The level built here is the flux-domain one: it is the floor as it
        // sits ON the tape, so the amplitude below is referred to the
        // saturator's operating point (SATURATION_REFERENCE_DBFS) and NOT to
        // the deck's output. The makeup that turns tape flux back into line
        // level is applied to this gain at its use site, one multiply per
        // block, which is what makes the noise floor a property of the tape
        // and the operating point instead of a property of whatever digital
        // level the material happened to arrive at (plan RC-1). The
        // consequence is the one a real deck has: Record Level moves the
        // signal-to-noise ratio 1 dB for 1 dB, in both directions.
        //
        // The user offset lands on the modulation noise too — one control
        // moves the whole family together. The modulation index is
        // normalised unweighted because carrier and sidebands see essentially
        // the same weighting, and DCN is already a ratio against the recorded
        // signal, so it is ALREADY a flux-domain quantity and must not be
        // multiplied by the makeup as well: it enters as (1 + n) around a
        // signal that has been through the same linear gain.
        //
        // This injection point sits before the Dolby decoder, so with NR on
        // the decoder's quiet-floor attenuation becomes part of the effective
        // floor the status line reports; after W-A that attenuation is
        // Record Level invariant, because the injected floor and the
        // decoder's detector reference now scale together.
        const hissEnabled = parameters.hs > HISS_OFF_DB;
        const typeFloorDb = CAL[TYPE_HISS_KEY[typeKey]];
        const noiseOffsetDb = parameters.hs - HISS_REFERENCE_DB;
        // The ledger's convention counts noise as A-weighted RMS against the
        // RMS of the full-scale sine, so the amplitude-domain RMS the
        // generator has to produce is the table value divided by sqrt(2) —
        // the same mapping Tape Artifacts spells as OPERATING_LEVEL_RMS_DBFS.
        // (W-2's skeleton dropped this term; a floor set to hs then measured
        // hs + 3.01 dB on an A-weighted meter.) The added
        // SATURATION_REFERENCE_DBFS is the flux -> internal-dBFS conversion:
        // 250 nWb/m is -18 dBFS at the saturator, by definition.
        const SINE_RMS = 0.7071067811865476;
        const hissRms = hissEnabled
            ? Math.pow(10, (typeFloorDb + noiseOffsetDb + SATURATION_REFERENCE_DBFS) / 20) * SINE_RMS
            : 0;
        const modulationDepth = hissEnabled
            ? Math.pow(10, (typeEntry.dcnDb + noiseOffsetDb) / 20)
            : 0;
        const uniformRms = 0.5773502691896258; // RMS of a uniform [-1, 1] draw
        const hissShapeGain = cascadeNoiseGain(coefficients, [SECTION_HISS_HP, SECTION_HISS_LP],
            NOISE_INTEGRATION_POINTS, sampleRate, true);
        const modulationShapeGain = cascadeNoiseGain(coefficients, [SECTION_MODULATION],
            NOISE_INTEGRATION_POINTS, sampleRate, false);
        state.hissGain = hissRms / (uniformRms * hissShapeGain);
        state.modulationGain = modulationDepth / (uniformRms * modulationShapeGain);

        // Transport (W-4). The speed is fixed, so there is no depth exponent
        // and no speed ratio. Delay-domain amplitudes per DIN percent: a
        // periodic speed component of peak a becomes a delay sinusoid of
        // amplitude a / (2 pi f) seconds, and the flutter chain's gain is
        // normalised so the RMS of the per-sample delay difference — the
        // relative speed deviation — equals the calibrated speed RMS at this
        // host rate. The normalisation integral matches the offline solver
        // (w4-solve.mjs) point for point, so the solved DIN scale transfers.
        state.capstanIncrement = TWO_PI * CAPSTAN_HZ / sampleRate;
        state.hubIncrement = TWO_PI * HUB_HZ / sampleRate;
        state.capstanDelayPerPercent = CAPSTAN_SPEED_PER_PERCENT * sampleRate
            / (TWO_PI * CAPSTAN_HZ);
        state.hubDelayPerPercent = HUB_SPEED_PER_PERCENT * sampleRate
            / (TWO_PI * HUB_HZ);
        const flutterBandCoefficient = 1 - Math.exp(-TWO_PI * FLUTTER_BAND_HZ / sampleRate);
        const flutterFloorCoefficient = 1 - Math.exp(-TWO_PI * FLUTTER_FLOOR_HZ / sampleRate);
        state.flutterCoefficientA = flutterBandCoefficient;
        state.flutterCoefficientB = flutterFloorCoefficient;
        // Variance of the first difference of the two-pole flutter chain
        // driven by uniform [-1, 1) noise (variance 1/3), by frequency
        // integration over a uniform grid up to Nyquist.
        let flutterDiffVariance = 0;
        const flutterBandPole = 1 - flutterBandCoefficient;
        const flutterFloorPole = 1 - flutterFloorCoefficient;
        for (let k = 0; k < TRANSPORT_INTEGRATION_POINTS; k++) {
            const omega = Math.PI * (k + 0.5) / TRANSPORT_INTEGRATION_POINTS;
            const cosine = Math.cos(omega);
            const bandMagSq = (flutterBandCoefficient * flutterBandCoefficient)
                / (1 - 2 * flutterBandPole * cosine + flutterBandPole * flutterBandPole);
            const floorMagSq = (flutterFloorCoefficient * flutterFloorCoefficient)
                / (1 - 2 * flutterFloorPole * cosine + flutterFloorPole * flutterFloorPole);
            flutterDiffVariance += (2 - 2 * cosine) * bandMagSq * floorMagSq;
        }
        flutterDiffVariance = (flutterDiffVariance / TRANSPORT_INTEGRATION_POINTS) / 3;
        state.flutterDelayPerPercent = FLUTTER_SPEED_PER_PERCENT
            / Math.sqrt(flutterDiffVariance > 1e-30 ? flutterDiffVariance : 1e-30);
        state.baseDelaySamples = Math.round(TRANSPORT_BASE_SECONDS * sampleRate);

        // Azimuth (W-6, retimed by W-D, reshaped by R1-01). The in-track loss
        // is |sinc(pi f tau_a)| with tau_a = w theta / v (small angle), and it
        // is realised as a one-pole matched to the sinc's curvature — see the
        // constants block for why a one-pole and why this corner.
        //
        // The coefficients are tabulated over |theta| rather than solved per
        // sample: firstOrder() costs an exp and a sqrt, and the audio loop
        // should carry neither. The table spans the largest |theta| this Grade
        // can reach — the control's own limit plus its clamped wobble — so
        // az never needs to be part of the configuration key and dragging it
        // rebuilds nothing.
        const azTableMaxRadians = (CAL.AZ_MAX_ARCMIN
            + AZ_WOBBLE_CLAMP_SIGMA * grade.azWobbleArcmin) * ARCMIN_TO_RADIANS;
        state.azTableScale = AZ_TABLE_SIZE / azTableMaxRadians;
        const azTable = state.azTable;
        for (let i = 0; i <= AZ_TABLE_SIZE + 1; i++) {
            // The last entry is duplicated so the lerp's i+1 read stays in
            // bounds at the top of the range.
            const index = i <= AZ_TABLE_SIZE ? i : AZ_TABLE_SIZE;
            const theta = azTableMaxRadians * index / AZ_TABLE_SIZE;
            const tauA = TRACK_WIDTH_METERS * theta / VELOCITY;
            firstOrder(0, tauA * AZ_POLE_TAU_RATIO, twoFs, coefficients, SECTION_SCRATCH);
            azTable[i * 3] = coefficients.b0[SECTION_SCRATCH];
            azTable[i * 3 + 1] = coefficients.b1[SECTION_SCRATCH];
            azTable[i * 3 + 2] = coefficients.a1[SECTION_SCRATCH];
        }
        // The inter-track lag half stays pure geometry: (fs s / (2 v)) theta.
        state.azHalfDelayScale = 0.5 * TRACK_SPACING_METERS / VELOCITY * sampleRate;
        // Azimuth wobble (W-D): white noise through two identical one-pole
        // stages. The stationary variance of that cascade driven by unit-
        // variance white noise is k^4 (1 + p^2) / (1 - p^2)^3 with p = 1 - k
        // (the same closed form the open-reel file uses), so one evaluation
        // per rate normalises the process to the Grade's arcmin sigma exactly
        // — no per-rate re-solving and no Monte Carlo.
        const azCoefficient = 1 - Math.exp(-TWO_PI * AZ_WOBBLE_CORNER_HZ / sampleRate);
        const azPole = 1 - azCoefficient;
        const azPoleSq = azPole * azPole;
        const azUnitVariance = Math.pow(azCoefficient, 4) * (1 + azPoleSq)
            / Math.pow(1 - azPoleSq, 3);
        const azWobbleSdRadians = grade.azWobbleArcmin * ARCMIN_TO_RADIANS;
        state.azCoefficient = azCoefficient;
        state.azWobbleSdRadians = azWobbleSdRadians;
        state.azWobbleScale = azWobbleSdRadians
            / (uniformRms * Math.sqrt(azUnitVariance > 1e-30 ? azUnitVariance : 1e-30));
        state.azWobbleClampRadians = AZ_WOBBLE_CLAMP_SIGMA * azWobbleSdRadians;

        // Dolby B/C (W-5): level->coefficient tables and packed stage
        // coefficients, both modes unconditionally — during a mode crossfade
        // the outgoing mode still runs, so its table has to exist whatever
        // nr currently says. All the pow/exp lives here; the audio loop
        // only interpolates the table.
        const dolbyModeBuilds = [
            [DOLBY['Dolby B'].stages, state.dolbyTableB, state.dolbyCoefB],
            [DOLBY['Dolby C'].stages, state.dolbyTableC, state.dolbyCoefC]
        ];
        for (let mb = 0; mb < 2; mb++) {
            const stages = dolbyModeBuilds[mb][0];
            const table = dolbyModeBuilds[mb][1];
            const coef = dolbyModeBuilds[mb][2];
            // All stages of a mode share the quiescent corner, so one table
            // serves the mode; the stagger lives in the per-stage reference
            // multiplier applied to the lookup argument.
            const quiescentHz = stages[0].cornerHz;
            for (let iT = 0; iT <= DOLBY_TABLE_SIZE + 1; iT++) {
                const idx = iT <= DOLBY_TABLE_SIZE ? iT : DOLBY_TABLE_SIZE;
                const warped = idx / DOLBY_TABLE_SIZE;
                const q = warped * warped * DOLBY_TABLE_MAX_Q;
                const slide = Math.pow(1 + q / DOLBY_SLIDE_Q_THRESHOLD, DOLBY_SLIDE_EXPONENT);
                const argument = TWO_PI * quiescentHz * slide / sampleRate;
                // The one-pole coefficient saturates at 1 as the corner
                // slides past Nyquist, which zeroes the sidechain exactly as
                // the physics wants; poles stay strictly inside the unit
                // circle for every finite argument.
                table[iT] = argument > 30 ? 1 : 1 - Math.exp(-argument);
            }
            for (let st = 0; st < stages.length; st++) {
                const stage = stages[st];
                const cBase = st * DOLBY_COEF_STRIDE;
                coef[cBase] = Math.pow(10, stage.maxBoostDb / 20) - 1;
                coef[cBase + 1] = 1 - Math.exp(-TWO_PI * stage.cornerHz / sampleRate);
                const skewHz = stage.skewHz < sampleRate * 0.45 ? stage.skewHz : sampleRate * 0.45;
                coef[cBase + 2] = stage.skewHz > 0 ? 1 - Math.exp(-TWO_PI * skewHz / sampleRate) : 1;
                if (stage.antiSatZeroHz > 0) {
                    firstOrder(1 / (TWO_PI * stage.antiSatZeroHz),
                        1 / (TWO_PI * stage.antiSatPoleHz), twoFs,
                        coefficients, SECTION_SCRATCH);
                    coef[cBase + 3] = coefficients.b0[SECTION_SCRATCH];
                    coef[cBase + 4] = coefficients.b1[SECTION_SCRATCH];
                    coef[cBase + 5] = coefficients.a1[SECTION_SCRATCH];
                } else {
                    coef[cBase + 3] = 1;
                    coef[cBase + 4] = 0;
                    coef[cBase + 5] = 0;
                }
                coef[cBase + 6] = 1 - Math.exp(-1 / (stage.attackMs * 0.001 * sampleRate));
                coef[cBase + 7] = 1 - Math.exp(-1 / (stage.releaseMs * 0.001 * sampleRate));
                coef[cBase + 8] = Math.pow(10, -stage.refOffsetDb / 20);
            }
        }
        state.configurationKey = configurationKey;
    }

    // --- Dolby mode bookkeeping (W-5) ------------------------------------
    // The NR mode is sample-rate-free state: 0 = Off, 1 = B, 2 = C. A mode
    // change seeds the incoming mode's bank (filters cleared, detectors
    // started from the outgoing mode's settled level — a stable point, not
    // silence) and starts the FADE_SECONDS crossfade during which both
    // modes run. Nothing here touches the transport or noise RNG streams,
    // so an nr change can never advance another family's sequence.
    const nrKey = parameters.nr === 'Dolby B' || parameters.nr === 'Dolby C' ? parameters.nr : 'Off';
    const nrIndex = nrKey === 'Dolby B' ? 1 : (nrKey === 'Dolby C' ? 2 : 0);
    if (state.dolbyMode === -1) {
        state.dolbyMode = nrIndex;
    } else if (state.dolbyMode !== nrIndex) {
        const previousIndex = state.dolbyMode;
        if (nrIndex !== 0) {
            const bank = state.dolbyBank;
            const newModeBase = (nrIndex - 1) * DOLBY_SLOTS_PER_MODE * channelCount;
            const stageCount = nrIndex === 1 ? 1 : 2;
            for (let ch = 0; ch < channelCount; ch++) {
                let encSeed = 0;
                let decSeed = 0;
                if (previousIndex !== 0) {
                    const previousBase = ((previousIndex - 1) * channelCount + ch)
                        * DOLBY_SLOTS_PER_MODE;
                    encSeed = bank[previousBase + 1];
                    decSeed = bank[previousBase + DOLBY_SLOTS_PER_DIR + 1];
                }
                const channelBase = newModeBase + ch * DOLBY_SLOTS_PER_MODE;
                for (let k = 0; k < DOLBY_SLOTS_PER_MODE; k++) bank[channelBase + k] = 0;
                for (let st = 0; st < stageCount; st++) {
                    bank[channelBase + st * DOLBY_SLOTS_PER_STAGE + 1] = encSeed;
                    bank[channelBase + DOLBY_SLOTS_PER_DIR + st * DOLBY_SLOTS_PER_STAGE + 1] = decSeed;
                }
            }
        }
        state.dolbyPrevMode = previousIndex;
        state.dolbyMode = nrIndex;
        state.dolbyFade = state.dolbyFadeLength;
    }
    // dp = 0 is a hard off: no scheduler state, no RNG draws, no envelope.
    // The hazard is the scheduler's per-sample event intensity for the
    // whole tape — dp (1 + N) / 2 events/min over all scopes (see the
    // DROPOUT constants) — so a dp change retargets the very next sample
    // with no state disturbance and no redraw.
    const dropoutsPerMinute = parameters.dp > 0 ? parameters.dp : 0;
    const dropoutsActive = dropoutsPerMinute > 0;
    const dropoutHazardPerSample = dropoutsActive
        ? dropoutsPerMinute * (1 + channelCount) * 0.5 / (60 * sampleRate)
        : 0;
    // wf = 0 is a hard off too: the transport branch below is skipped
    // entirely, the deviation is exactly zero and the transport RNG stream is
    // never drawn, so the wet path reads the ring at the integer base delay.
    const transportActive = parameters.wf > 0;

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

    // Record Level (W-B): how hot this material is laid down on the tape,
    // in dB above the 250 nWb/m operating point, taking a 0 dBFS peak as the
    // programme's peak. rl = 0 puts a full-scale peak exactly at the
    // reference flux; the mass-market default of +9 dB is what a deck fed
    // through a VU meter actually records at (a 300 ms averaging meter
    // reading 0 VU sits 8-12 dB under the true peak, and operators pushed
    // another few dB on top to bury the hiss).
    //
    // The makeup below is the exact inverse, so the CONTROL DOES NOT CHANGE
    // THE LEVEL — it changes where the programme sits on the tape, which
    // moves the saturation and (after W-A) the noise floor in opposite
    // directions. That is the whole dynamic-range trade of a tape machine in
    // one control, and the reason there is no meter: the feedback closes at
    // the ear, not at a display (plan D-4/D-6).
    const inputTrimGain = Math.pow(10, (SATURATION_REFERENCE_DBFS + parameters.rl) / 20);
    const makeupGain = 1 / inputTrimGain;
    const outputGain = Math.pow(10, parameters.og / 20);
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
    // W-A: the hiss level was solved in the flux domain, so it is carried
    // back to line level by the same makeup the signal gets. This multiply
    // supplies the LEVEL the flux-domain figure implies and nothing else — it
    // is not a relocation of the injection point, and must not be read as one.
    //
    // Moving the injection ahead of the makeup would NOT be equivalent. The
    // stages between the makeup and here — bias HF loss, playback wavelength
    // loss and head trim, the dropout envelope, transport, azimuth, the head
    // contour, the reproduce post-emphasis, the 3180 µs high-pass and the DC
    // blocker — are nowhere near unity gain (the ideal-condition response is
    // -3.3 dB at 20 Hz and -7.8 dB at 16 kHz), so hiss injected up there would
    // arrive spectrally tilted by all of it.
    //
    // The injection point is therefore fixed where it is, for two independent
    // reasons: it has to stay AFTER the dropout envelope, so a dropout exposes
    // the floor instead of taking it down with the signal; and it has to stay
    // at the output end of the reproduce chain, because the ledger's H_*
    // columns are A-weighted floors measured there (the same argument is
    // spelled out at the 3180 µs reproduce stage below). Cost: one multiply
    // per block.
    //
    // The modulation index is deliberately NOT scaled: it is a ratio against
    // the recorded signal, and (makeup*s)(1+n) = makeup*(s(1+n)) already.
    const hissGain = state.hissGain * makeupGain;
    const modulationGain = state.modulationGain;
    const noiseActive = hissGain > 0 || modulationGain > 0;
    // wf is DIN percent, and the per-percent amplitudes are pre-computed at
    // configuration time, so the per-block cost of the control is three
    // multiplications and its zero is the transportActive hard off above.
    const capstanDelaySamples = state.capstanDelayPerPercent * parameters.wf;
    const hubDelaySamples = state.hubDelayPerPercent * parameters.wf;
    const flutterDelaySamples = state.flutterDelayPerPercent * parameters.wf;
    const capstanIncrement = state.capstanIncrement;
    const hubIncrement = state.hubIncrement;
    const flutterCoefficientA = state.flutterCoefficientA;
    const flutterCoefficientB = state.flutterCoefficientB;
    const baseDelaySamples = state.baseDelaySamples;
    // The transport deviation clamp answers to two limits, because the azimuth
    // lag and the deviation are both added to the base delay AFTER it.
    //
    // A read that is too shallow overtakes the write pointer: the cubic
    // interpolator reads as far as readFloor + 2, so the shortest total delay
    // must stay behind it. Budgeting only the transport (the pre-W-D form)
    // happened to survive because the azimuth was a frozen 2 arcmin worth
    // about one sample at 192 kHz; at the control's +-6 arcmin plus a Portable
    // deck's clamped wobble it is nine and a half, which would have let the
    // clamp end read past the write pointer.
    //
    // A read that is too deep runs off the far end of the ring: the same
    // interpolator reads as far back as readFloor - 1, so the longest total
    // delay must stay inside DELAY_LENGTH. Both limits are safety nets now:
    // the ring is sized per rate (see the ring block above) to hold the
    // calibrated wf = 1 % peak with the azimuth lag and this margin already
    // in it, so at every rate the application offers the first limit is the
    // binding one and neither ever engages on a calibrated trajectory. What
    // is left for them to catch is the flutter tail beyond the calibrated
    // peak — which is what a safety net is for, and what this pair failed to
    // be while the ring was a rate-independent 2048.
    const azimuthMaxHalfDelay = state.azHalfDelayScale * AZ_THETA_MAX_RADIANS;
    const writePointerRoom = baseDelaySamples - 4 - azimuthMaxHalfDelay;
    const ringCapacityRoom = DELAY_LENGTH - 3 - baseDelaySamples - azimuthMaxHalfDelay;
    const deviationRoom =
        writePointerRoom < ringCapacityRoom ? writePointerRoom : ringCapacityRoom;
    const maxDeviation = baseDelaySamples > 8 ? deviationRoom : 1;
    // The dry tap is aligned with the wet path so that Mix is a true blend.
    const dryDelaySamples = (baseDelaySamples + OS_LATENCY) & DELAY_MASK;
    // Azimuth (W-6/W-D): the relative phase only exists between channels 0
    // and 1, so it is off outright for mono (plan §3); every other channel of
    // a multichannel bus reads at the common position.
    //
    // theta = static control + Grade wobble. When the Grade specifies no
    // wobble the whole family is a hard off in the same sense wf = 0 and
    // dp = 0 are — no draw, no per-sample solve — and the two coefficients
    // are hoisted here once for the block. Otherwise they are re-solved every
    // sample inside the loop.
    //
    // That branch is reachable from the controls, not dead code: the
    // Reference Grade is an azimuth-servo machine and its wobble sigma is
    // exactly 0. So wf = 0, hs at the bottom, dp = 0 and Reference together
    // leave a deck with no stochastic family running at all — the same
    // strictly deterministic configuration the file has always been able to
    // reach, and the one the seeded-determinism gate stands on.
    const azimuthPhaseActive = channelCount > 1;
    const azStaticRadians = parameters.az * ARCMIN_TO_RADIANS;
    const azWobbleActive = state.azWobbleSdRadians > 0;
    const azCoefficient = state.azCoefficient;
    const azWobbleScale = state.azWobbleScale;
    const azWobbleClamp = state.azWobbleClampRadians;
    const azTable = state.azTable;
    const azTableScale = state.azTableScale;
    const azHalfDelayScale = state.azHalfDelayScale;
    let azimuthB0 = 1;
    let azimuthB1 = 0;
    let azimuthA1 = 0;
    let azimuthHalfDelaySamples = 0;
    // Look the in-track loss coefficients up for |theta| and interpolate. The
    // table covers this Grade's whole reachable range, so the clamp is a
    // bounds guard rather than a physical limit — unlike the ceiling the
    // 2-tap form had, which the deck could actually run into.
    const azLookup = theta => {
        let position = (theta < 0 ? -theta : theta) * azTableScale;
        if (position > AZ_TABLE_SIZE) position = AZ_TABLE_SIZE;
        const entry = position | 0;
        const fraction = position - entry;
        const slot = entry * 3;
        azimuthB0 = azTable[slot] + (azTable[slot + 3] - azTable[slot]) * fraction;
        azimuthB1 = azTable[slot + 1] + (azTable[slot + 4] - azTable[slot + 1]) * fraction;
        azimuthA1 = azTable[slot + 2] + (azTable[slot + 5] - azTable[slot + 2]) * fraction;
    };
    if (!azWobbleActive) {
        azLookup(azStaticRadians);
        azimuthHalfDelaySamples = azHalfDelayScale * azStaticRadians;
    }

    // --- Dolby B/C compander (W-5) ---------------------------------------
    // The decoder detector reference is the encoder's mapped through the
    // exact inverse makeup (plan F-1): the inverse-of-the-reference scale
    // is therefore multiplied by the input trim gain, and the matched round
    // trip holds at every Record Level because a signal's level relative to the
    // reference is then identical at both insertion points.
    const dolbyBank = state.dolbyBank;
    const dolbyTableB = state.dolbyTableB;
    const dolbyTableC = state.dolbyTableC;
    const dolbyCoefB = state.dolbyCoefB;
    const dolbyCoefC = state.dolbyCoefC;
    const dolbyMode = state.dolbyMode;
    const dolbyPrevMode = state.dolbyPrevMode;
    const dolbyFadeInv = 1 / state.dolbyFadeLength;
    let dolbyFade = state.dolbyFade;
    // Dolby Level Error (W-D): the one place a playback deck's Dolby
    // calibration can disagree with the recording deck's. It is not a new
    // stage — it is a constant offset on the DECODER's detector reference,
    // which is the physical quantity that drifts (the NR IC's reference
    // current against a tape recorded on another machine). No state, no RNG.
    //
    // Sign, read straight off the recursion below: a larger reference scale
    // makes q larger for the same signal, which slides the band corner up,
    // which expands less. So
    //   dl > 0 — the deck believes the tape is hotter than it is, decodes
    //            with too little cut, and the result is BRIGHT with the hiss
    //            coming up;
    //   dl < 0 — too much cut, and the result is DULL.
    // That two-sidedness is the reason this is its own signed control and
    // not part of the Deck Grade (plan D-7): the tape's own mistracking can
    // only ever darken, so the bright half of the axis was unreachable.
    const dolbyInvRefDec = DOLBY_INV_REF_ENC * inputTrimGain
        * Math.pow(10, parameters.dl / 20);
    // Steady-state hot path (no fade in flight) reads these hoisted views;
    // the per-sample stage recursions are inlined in the channel loop below,
    // and the closure helpers are only entered during the 20 ms crossfade.
    const dolbyCurCoef = dolbyMode === 2 ? dolbyCoefC : dolbyCoefB;
    const dolbyCurTable = dolbyMode === 2 ? dolbyTableC : dolbyTableB;
    const dolbyCurStages = dolbyMode === 2 ? 2 : (dolbyMode === 1 ? 1 : 0);
    const dolbyCurBase = dolbyMode !== 0
        ? (dolbyMode - 1) * channelCount * DOLBY_SLOTS_PER_MODE
        : 0;
    // Per-block hoists of the packed stage coefficients for the unrolled
    // steady-state paths below (W-8). The coefficient array never changes
    // inside a block, but the JIT cannot prove that against the dolbyBank
    // stores — both are Float64Arrays that might alias — so the generic
    // loop re-loaded (and re-bounds-checked) every entry for every stage,
    // direction, channel and sample. The values and every use-site
    // expression are unchanged, so the arithmetic is bit-for-bit identical.
    // Stage 1 constants are only read when the mode has two stages
    // (dolbyCoefB is one stride long); the neutral fallbacks keep the loads
    // in-bounds and are never used.
    //
    // The unrolled bodies also replace the three data-dependent branches of
    // each stage with branchless forms, because noise-driven operands make
    // them unpredictable (measured: about +0.4 %/core on a hiss-dominated
    // block, w8-measurements.md). Each replacement is bit-exact:
    //   - Math.abs(k - clp) — identical except for a -0 rectifier input,
    //     which cannot reach a different downstream bit pattern here: the
    //     detector is never -0 (it starts at +0 and a one-pole with
    //     non-negative drive can neither cross zero nor produce -0), so
    //     mag - detector and the comparison agree for both zero signs;
    //   - q = Math.min(q, MAX) — q is a product of non-negative finites;
    //   - attack * max(delta, 0) + release * min(delta, 0) — one term is
    //     always +0 (delta = magnitude - detector is never -0, see above),
    //     and adding +0 to the other term reproduces the branch's sum
    //     exactly, because that term is never -0 either.
    const dolbyStage1 = dolbyCurStages === 2;
    const dolbyS0Gain = dolbyCurStages !== 0 ? dolbyCurCoef[0] : 0;
    const dolbyS0CtrlA = dolbyCurStages !== 0 ? dolbyCurCoef[1] : 0;
    const dolbyS0SkewA = dolbyCurStages !== 0 ? dolbyCurCoef[2] : 1;
    const dolbyS0AsB0 = dolbyCurStages !== 0 ? dolbyCurCoef[3] : 1;
    const dolbyS0AsB1 = dolbyCurStages !== 0 ? dolbyCurCoef[4] : 0;
    const dolbyS0AsA1 = dolbyCurStages !== 0 ? dolbyCurCoef[5] : 0;
    const dolbyS0Attack = dolbyCurStages !== 0 ? dolbyCurCoef[6] : 0;
    const dolbyS0Release = dolbyCurStages !== 0 ? dolbyCurCoef[7] : 0;
    const dolbyS0RefMul = dolbyCurStages !== 0 ? dolbyCurCoef[8] : 1;
    const dolbyS1Gain = dolbyStage1 ? dolbyCurCoef[DOLBY_COEF_STRIDE] : 0;
    const dolbyS1CtrlA = dolbyStage1 ? dolbyCurCoef[DOLBY_COEF_STRIDE + 1] : 0;
    const dolbyS1SkewA = dolbyStage1 ? dolbyCurCoef[DOLBY_COEF_STRIDE + 2] : 1;
    const dolbyS1AsB0 = dolbyStage1 ? dolbyCurCoef[DOLBY_COEF_STRIDE + 3] : 1;
    const dolbyS1AsB1 = dolbyStage1 ? dolbyCurCoef[DOLBY_COEF_STRIDE + 4] : 0;
    const dolbyS1AsA1 = dolbyStage1 ? dolbyCurCoef[DOLBY_COEF_STRIDE + 5] : 0;
    const dolbyS1Attack = dolbyStage1 ? dolbyCurCoef[DOLBY_COEF_STRIDE + 6] : 0;
    const dolbyS1Release = dolbyStage1 ? dolbyCurCoef[DOLBY_COEF_STRIDE + 7] : 0;
    const dolbyS1RefMul = dolbyStage1 ? dolbyCurCoef[DOLBY_COEF_STRIDE + 8] : 1;

    // One stage of the sliding-band model, encode direction. mode is 1 (B)
    // or 2 (C); per-channel state lives in the mode's bank. The corner for
    // this sample comes from the detector as of the previous sample (the
    // plan's one-sample control delay), so the encode recursion is explicit.
    function dolbyEncodeSample(mode, ch, x) {
        const coef = mode === 1 ? dolbyCoefB : dolbyCoefC;
        const table = mode === 1 ? dolbyTableB : dolbyTableC;
        const stageCount = mode === 1 ? 1 : 2;
        const base = ((mode - 1) * channelCount + ch) * DOLBY_SLOTS_PER_MODE;
        let s = x;
        for (let st = 0; st < stageCount; st++) {
            const c = st * DOLBY_COEF_STRIDE;
            const b = base + st * DOLBY_SLOTS_PER_STAGE;
            const skewA = coef[c + 2];
            let k = s;
            if (skewA < 1) {
                k = dolbyBank[b + 2] + skewA * (s - dolbyBank[b + 2]);
                dolbyBank[b + 2] = k;
            }
            let q = dolbyBank[b + 1] * DOLBY_INV_REF_ENC * coef[c + 8];
            if (q > DOLBY_TABLE_MAX_Q) q = DOLBY_TABLE_MAX_Q;
            const pos = Math.sqrt(q * DOLBY_TABLE_INV_MAX_Q) * DOLBY_TABLE_SIZE;
            const ti = pos | 0;
            const a = table[ti] + (table[ti + 1] - table[ti]) * (pos - ti);
            const lpNew = dolbyBank[b + 3] + a * (k - dolbyBank[b + 3]);
            const hp = k - lpNew;
            dolbyBank[b + 3] = lpNew;
            const m = coef[c + 3] * s + dolbyBank[b + 4];
            dolbyBank[b + 4] = coef[c + 4] * s - coef[c + 5] * m;
            const clp = dolbyBank[b] + coef[c + 1] * (k - dolbyBank[b]);
            dolbyBank[b] = clp;
            let magnitude = k - clp;
            if (magnitude < 0) magnitude = -magnitude;
            const detector = dolbyBank[b + 1];
            dolbyBank[b + 1] = detector
                + (magnitude > detector ? coef[c + 6] : coef[c + 7]) * (magnitude - detector);
            s = m + coef[c] * hp;
        }
        return s;
    }

    // Decode direction: the complementary feedback expander. Each stage is
    // solved sample-exactly through its direct term (plan F-2): with main
    // path m0*z + mState and sidechain g*(1-a)*(ask*z + (1-ask)*skLp -
    // sideLp), u = direct*z + stateTerm gives z in closed form; the states
    // are then advanced with z, so the stage reproduces the encoder's
    // recursion exactly and z equals the encoder's input when the states and
    // detectors match. C inverts its two stages in reverse encode order,
    // each as a single-stage feedback of this same closed form.
    function dolbyDecodeSample(mode, ch, u) {
        const coef = mode === 1 ? dolbyCoefB : dolbyCoefC;
        const table = mode === 1 ? dolbyTableB : dolbyTableC;
        const stageCount = mode === 1 ? 1 : 2;
        const base = ((mode - 1) * channelCount + ch) * DOLBY_SLOTS_PER_MODE
            + DOLBY_SLOTS_PER_DIR;
        let s = u;
        for (let st = stageCount - 1; st >= 0; st--) {
            const c = st * DOLBY_COEF_STRIDE;
            const b = base + st * DOLBY_SLOTS_PER_STAGE;
            const skewA = coef[c + 2];
            let q = dolbyBank[b + 1] * dolbyInvRefDec * coef[c + 8];
            if (q > DOLBY_TABLE_MAX_Q) q = DOLBY_TABLE_MAX_Q;
            const pos = Math.sqrt(q * DOLBY_TABLE_INV_MAX_Q) * DOLBY_TABLE_SIZE;
            const ti = pos | 0;
            const a = table[ti] + (table[ti + 1] - table[ti]) * (pos - ti);
            const oneMinusA = 1 - a;
            const gain = coef[c];
            // The denominator is >= the anti-sat b0 (> 0) because the
            // sidechain term is non-negative, so the division is safe by
            // construction at every table entry.
            const direct = coef[c + 3] + gain * oneMinusA * skewA;
            const stateTerm = dolbyBank[b + 4]
                + gain * oneMinusA * ((1 - skewA) * dolbyBank[b + 2] - dolbyBank[b + 3]);
            const z = (s - stateTerm) / direct;
            let k = z;
            if (skewA < 1) {
                k = dolbyBank[b + 2] + skewA * (z - dolbyBank[b + 2]);
                dolbyBank[b + 2] = k;
            }
            dolbyBank[b + 3] = dolbyBank[b + 3] + a * (k - dolbyBank[b + 3]);
            const m = coef[c + 3] * z + dolbyBank[b + 4];
            dolbyBank[b + 4] = coef[c + 4] * z - coef[c + 5] * m;
            const clp = dolbyBank[b] + coef[c + 1] * (k - dolbyBank[b]);
            dolbyBank[b] = clp;
            let magnitude = k - clp;
            if (magnitude < 0) magnitude = -magnitude;
            const detector = dolbyBank[b + 1];
            dolbyBank[b + 1] = detector
                + (magnitude > detector ? coef[c + 6] : coef[c + 7]) * (magnitude - detector);
            s = z;
        }
        return s;
    }

    let delayPosition = state.delayPosition;
    let oversamplePosition = state.oversamplePosition;
    let capstanPhase = state.capstanPhase;
    let hubPhase = state.hubPhase;
    let flutterA = state.flutterA;
    let flutterB = state.flutterB;
    let rngTransport = state.rngTransport;
    let rngNoise = state.rngNoise;
    let rngDropout = state.rngDropout;
    let rngAzimuth = state.rngAzimuth;
    let azWobbleA = state.azWobbleA;
    let azWobbleB = state.azWobbleB;
    let dropoutBudget = state.dropoutBudget;
    let dropoutSharedPhase = state.dropoutSharedPhase;
    let dropoutSharedIncrement = state.dropoutSharedIncrement;
    let dropoutSharedDepth = state.dropoutSharedDepth;
    const dropoutLocalPhase = state.dropoutLocalPhase;
    const dropoutLocalIncrement = state.dropoutLocalIncrement;
    const dropoutLocalDepth = state.dropoutLocalDepth;
    const dropoutLocalEvents = state.dropoutLocalEvents;

    for (let i = 0; i < blockSize; i++) {
        // NR-mode crossfade weight, shared by the encoder and the decoder:
        // 0 = all outgoing mode at the first faded sample, ramping to all
        // incoming mode when the counter runs out. Sample-based, so the
        // transition is block-size independent.
        const dolbyFadeActive = dolbyFade > 0;
        const dolbyFadeWeight = dolbyFadeActive ? 1 - dolbyFade * dolbyFadeInv : 1;

        // Transport trajectory is shared by every channel; only the delay
        // line state is per channel. With the transport hard off the
        // deviation is exactly zero and this stream's RNG is never drawn.
        let deviation = 0;
        if (transportActive) {
            capstanPhase += capstanIncrement;
            if (capstanPhase >= TWO_PI) capstanPhase -= TWO_PI;
            hubPhase += hubIncrement;
            if (hubPhase >= TWO_PI) hubPhase -= TWO_PI;
            rngTransport ^= rngTransport << 13; rngTransport |= 0;
            rngTransport ^= rngTransport >>> 17;
            rngTransport ^= rngTransport << 5; rngTransport |= 0;
            const flutterDraw = (rngTransport >>> 0) * RNG_SCALE - 1;
            flutterA += flutterCoefficientA * (flutterDraw - flutterA);
            flutterB += flutterCoefficientB * (flutterA - flutterB);
            deviation = Math.sin(capstanPhase) * capstanDelaySamples
                + Math.sin(hubPhase) * hubDelaySamples
                + flutterB * flutterDelaySamples;
            if (deviation > maxDeviation) deviation = maxDeviation;
            else if (deviation < -maxDeviation) deviation = -maxDeviation;
        }

        // Azimuth wobble (W-D), once per sample and ahead of the channels —
        // the head is one piece of metal, so every track sees the same angle.
        // Exactly one draw per sample while the family is live, and none at
        // all when the Grade specifies no wobble: the same hard-off shape the
        // other three families have, and the reason a native port only has to
        // match the per-family order.
        if (azWobbleActive) {
            rngAzimuth ^= rngAzimuth << 13; rngAzimuth |= 0;
            rngAzimuth ^= rngAzimuth >>> 17;
            rngAzimuth ^= rngAzimuth << 5; rngAzimuth |= 0;
            const azDraw = (rngAzimuth >>> 0) * RNG_SCALE - 1;
            azWobbleA += azCoefficient * (azDraw - azWobbleA);
            azWobbleB += azCoefficient * (azWobbleA - azWobbleB);
            let wobble = azWobbleB * azWobbleScale;
            if (wobble > azWobbleClamp) wobble = azWobbleClamp;
            else if (wobble < -azWobbleClamp) wobble = -azWobbleClamp;
            const theta = azStaticRadians + wobble;
            azLookup(theta);
            azimuthHalfDelaySamples = azHalfDelayScale * theta;
        }
        // The common transport read position; the azimuth L/R lag offsets
        // it per channel inside the loop (W-6), so the floor and the ring
        // indices moved in there with it.
        const readPosition = delayPosition - baseDelaySamples - deviation;

        // Dropout scheduler (W-6), once per sample, ahead of the channels:
        // events are tape events, their scope decides who hears them. With
        // dp = 0 this whole family is a hard off — no draw, no state write.
        let sharedDropoutGain = 1;
        if (dropoutsActive) {
            if (dropoutBudget < 0) {
                // First deadline after the control leaves zero (or after
                // state creation): one lazy draw, so dp = 0 renders never
                // touch the stream.
                rngDropout ^= rngDropout << 13; rngDropout |= 0;
                rngDropout ^= rngDropout >>> 17;
                rngDropout ^= rngDropout << 5; rngDropout |= 0;
                dropoutBudget = -Math.log(1 - (rngDropout >>> 0) * RNG_UNIT);
            }
            dropoutBudget -= dropoutHazardPerSample;
            while (dropoutBudget <= 0) {
                // Fixed four-draw event record (see the DROPOUT constants):
                // defect length, depth, scope, next deadline — always all
                // four, busy slot or not.
                rngDropout ^= rngDropout << 13; rngDropout |= 0;
                rngDropout ^= rngDropout >>> 17;
                rngDropout ^= rngDropout << 5; rngDropout |= 0;
                const lengthDraw = (rngDropout >>> 0) * RNG_UNIT;
                rngDropout ^= rngDropout << 13; rngDropout |= 0;
                rngDropout ^= rngDropout >>> 17;
                rngDropout ^= rngDropout << 5; rngDropout |= 0;
                const depthDraw = (rngDropout >>> 0) * RNG_UNIT;
                rngDropout ^= rngDropout << 13; rngDropout |= 0;
                rngDropout ^= rngDropout >>> 17;
                rngDropout ^= rngDropout << 5; rngDropout |= 0;
                const scopeDraw = (rngDropout >>> 0) * RNG_UNIT;
                rngDropout ^= rngDropout << 13; rngDropout |= 0;
                rngDropout ^= rngDropout >>> 17;
                rngDropout ^= rngDropout << 5; rngDropout |= 0;
                dropoutBudget += -Math.log(1 - (rngDropout >>> 0) * RNG_UNIT);
                // Defect pass time l / v, l log-uniform over the ledger
                // window; the increment is the per-sample phase step of the
                // raised-cosine envelope.
                const defectMeters = DROPOUT_DEFECT_MIN_METERS
                    * Math.exp(lengthDraw * DROPOUT_LOG_DEFECT_RATIO);
                const eventIncrement = VELOCITY / (defectMeters * sampleRate);
                const eventDepthDb = DROPOUT_DEPTH_MIN_DB
                    + DROPOUT_DEPTH_SPAN_DB * depthDraw * depthDraw;
                const eventDepth = 1 - Math.pow(10, -eventDepthDb / 20);
                // Scope: [0,1) of (1+N) units is the tape-wide slot, the
                // remaining N units map onto the track-local slots.
                const scope = scopeDraw * (channelCount + 1);
                if (scope < 1) {
                    if (dropoutSharedPhase >= 1) {
                        dropoutSharedPhase = 0;
                        dropoutSharedIncrement = eventIncrement;
                        dropoutSharedDepth = eventDepth;
                        state.dropoutSharedEvents += 1;
                    }
                } else {
                    const eventChannel = (scope - 1) | 0;
                    if (dropoutLocalPhase[eventChannel] >= 1) {
                        dropoutLocalPhase[eventChannel] = 0;
                        dropoutLocalIncrement[eventChannel] = eventIncrement;
                        dropoutLocalDepth[eventChannel] = eventDepth;
                        dropoutLocalEvents[eventChannel] += 1;
                    }
                }
            }
            if (dropoutSharedPhase < 1) {
                sharedDropoutGain = 1 - dropoutSharedDepth
                    * (0.5 - 0.5 * Math.cos(TWO_PI * dropoutSharedPhase));
                const advanced = dropoutSharedPhase + dropoutSharedIncrement;
                dropoutSharedPhase = advanced < 1 ? advanced : 1;
            }
        }

        for (let ch = 0; ch < channelCount; ch++) {
            const offset = ch * blockSize;
            // Sanitise before the sample can reach any state. A single NaN or
            // infinity from upstream otherwise enters every recursive state
            // here and never leaves. Comparisons are the guard: NaN fails
            // both, each infinity fails one, and every finite value —
            // denormals and signed zero included — passes through bit for
            // bit.
            const raw = data[offset + i];
            const input = raw > -Infinity && raw < Infinity ? raw : 0;
            const dryLine = dryBuffers[ch];
            dryLine[delayPosition] = input;
            const dry = dryLine[(delayPosition - dryDelaySamples) & DELAY_MASK];
            let x = input * inputTrimGain;

            // Dolby encoder (W-5), ahead of the record EQ and the
            // saturation, per plan §3. Off is an exact pass-through; during
            // a mode crossfade both companders run and their outputs blend.
            if (dolbyFadeActive) {
                const encodeCurrent = dolbyMode === 0 ? x : dolbyEncodeSample(dolbyMode, ch, x);
                const encodePrevious = dolbyPrevMode === 0 ? x : dolbyEncodeSample(dolbyPrevMode, ch, x);
                x = encodePrevious + dolbyFadeWeight * (encodeCurrent - encodePrevious);
            } else if (dolbyCurStages !== 0) {
                // Inlined dolbyEncodeSample — identical recursion, stages
                // unrolled over the per-block coefficient hoists (W-8).
                const encBase = dolbyCurBase + ch * DOLBY_SLOTS_PER_MODE;
                {
                    let k = x;
                    if (dolbyS0SkewA < 1) {
                        k = dolbyBank[encBase + 2] + dolbyS0SkewA * (x - dolbyBank[encBase + 2]);
                        dolbyBank[encBase + 2] = k;
                    }
                    let q = dolbyBank[encBase + 1] * DOLBY_INV_REF_ENC * dolbyS0RefMul;
                    q = Math.min(q, DOLBY_TABLE_MAX_Q);
                    const pos = Math.sqrt(q * DOLBY_TABLE_INV_MAX_Q) * DOLBY_TABLE_SIZE;
                    const ti = pos | 0;
                    const a = dolbyCurTable[ti]
                        + (dolbyCurTable[ti + 1] - dolbyCurTable[ti]) * (pos - ti);
                    const lpNew = dolbyBank[encBase + 3] + a * (k - dolbyBank[encBase + 3]);
                    const hp = k - lpNew;
                    dolbyBank[encBase + 3] = lpNew;
                    const m = dolbyS0AsB0 * x + dolbyBank[encBase + 4];
                    dolbyBank[encBase + 4] = dolbyS0AsB1 * x - dolbyS0AsA1 * m;
                    const clp = dolbyBank[encBase] + dolbyS0CtrlA * (k - dolbyBank[encBase]);
                    dolbyBank[encBase] = clp;
                    const magnitude = Math.abs(k - clp);
                    const detector = dolbyBank[encBase + 1];
                    const detectorDelta = magnitude - detector;
                    dolbyBank[encBase + 1] = detector
                        + dolbyS0Attack * Math.max(detectorDelta, 0)
                        + dolbyS0Release * Math.min(detectorDelta, 0);
                    x = m + dolbyS0Gain * hp;
                }
                if (dolbyStage1) {
                    const b = encBase + DOLBY_SLOTS_PER_STAGE;
                    let k = x;
                    if (dolbyS1SkewA < 1) {
                        k = dolbyBank[b + 2] + dolbyS1SkewA * (x - dolbyBank[b + 2]);
                        dolbyBank[b + 2] = k;
                    }
                    let q = dolbyBank[b + 1] * DOLBY_INV_REF_ENC * dolbyS1RefMul;
                    q = Math.min(q, DOLBY_TABLE_MAX_Q);
                    const pos = Math.sqrt(q * DOLBY_TABLE_INV_MAX_Q) * DOLBY_TABLE_SIZE;
                    const ti = pos | 0;
                    const a = dolbyCurTable[ti]
                        + (dolbyCurTable[ti + 1] - dolbyCurTable[ti]) * (pos - ti);
                    const lpNew = dolbyBank[b + 3] + a * (k - dolbyBank[b + 3]);
                    const hp = k - lpNew;
                    dolbyBank[b + 3] = lpNew;
                    const m = dolbyS1AsB0 * x + dolbyBank[b + 4];
                    dolbyBank[b + 4] = dolbyS1AsB1 * x - dolbyS1AsA1 * m;
                    const clp = dolbyBank[b] + dolbyS1CtrlA * (k - dolbyBank[b]);
                    dolbyBank[b] = clp;
                    const magnitude = Math.abs(k - clp);
                    const detector = dolbyBank[b + 1];
                    const detectorDelta = magnitude - detector;
                    dolbyBank[b + 1] = detector
                        + dolbyS1Attack * Math.max(detectorDelta, 0)
                        + dolbyS1Release * Math.min(detectorDelta, 0);
                    x = m + dolbyS1Gain * hp;
                }
            }

            // Record chain. The IEC 3180 us flux boost (W-C) comes first,
            // ahead of the record EQ, the band limit and — crucially — the
            // saturator: the standard asks for up to +14 dB of extra flux
            // below 50 Hz, and this is the deck's bounded attempt at it, so
            // the low end is what runs out of tape first.
            let index = SECTION_RECORD_LF * channelCount + ch;
            let y = sectionB0[SECTION_RECORD_LF] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_RECORD_LF] * x
                - sectionA1[SECTION_RECORD_LF] * y;
            x = y;

            index = SECTION_RECORD_EQ * channelCount + ch;
            y = sectionB0[SECTION_RECORD_EQ] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_RECORD_EQ] * x - sectionA1[SECTION_RECORD_EQ] * y;
            x = y;

            index = SECTION_RECORD_EQ_B * channelCount + ch;
            y = sectionB0[SECTION_RECORD_EQ_B] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_RECORD_EQ_B] * x - sectionA1[SECTION_RECORD_EQ_B] * y;
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

            // The ceiling is pulled down by a short-time envelope; that is
            // the whole of the model's memory and it settles in a few tens of
            // ms.
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

            // Makeup, here and not at the output: everything between this
            // point and the hiss injection is linear, so the placement cannot
            // change the signal level, but putting it after the hiss would
            // lift the noise floor with the trim and destroy the hiss
            // calibration. A real machine records at 0 VU and the reproduce
            // chain returns line level; its noise floor is fixed against line
            // level, not against whatever was fed in.
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

            // Dropout envelope (W-6): the recorded signal is dropped here,
            // ahead of the transport, so the hiss injected further down
            // stays untouched and the floor is exposed relatively — the
            // plan's first-shipment model. The tape-wide factor was
            // computed once per sample above; the track-local slot
            // multiplies on top. The multiply is skipped at unity so the
            // idle path stays bit-identical to the hard off.
            if (dropoutsActive) {
                let dropoutGain = sharedDropoutGain;
                const localPhase = dropoutLocalPhase[ch];
                if (localPhase < 1) {
                    dropoutGain *= 1 - dropoutLocalDepth[ch]
                        * (0.5 - 0.5 * Math.cos(TWO_PI * localPhase));
                    const advanced = localPhase + dropoutLocalIncrement[ch];
                    dropoutLocalPhase[ch] = advanced < 1 ? advanced : 1;
                }
                if (dropoutGain < 1) x *= dropoutGain;
            }

            // Transport modulation. The azimuth L/R lag (W-6) rides the
            // same cubic interpolator: channel 0 reads dt/2 early, channel
            // 1 dt/2 late, every other channel at the common position.
            const line = delayBuffers[ch];
            line[delayPosition] = x;
            let channelRead = readPosition;
            if (azimuthPhaseActive) {
                if (ch === 0) channelRead = readPosition + azimuthHalfDelaySamples;
                else if (ch === 1) channelRead = readPosition - azimuthHalfDelaySamples;
            }
            const readFloor = Math.floor(channelRead);
            const fraction = channelRead - readFloor;
            const y0 = line[(readFloor - 1) & DELAY_MASK];
            const y1 = line[readFloor & DELAY_MASK];
            const y2 = line[(readFloor + 1) & DELAY_MASK];
            const y3 = line[(readFloor + 2) & DELAY_MASK];
            const c1 = 0.5 * (y2 - y0);
            const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
            const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
            x = ((c3 * fraction + c2) * fraction + c1) * fraction + y1;

            // Azimuth in-track loss (W-6/W-D/R1-01): every channel, mono
            // included. An ordinary first-order section, with the coefficients
            // looked up for this sample's angle above; the pole magnitude is
            // strictly inside the unit circle at every table entry, so the
            // time-varying coefficients cannot destabilise it.
            index = SECTION_AZIMUTH * channelCount + ch;
            y = azimuthB0 * x + sectionState[index];
            sectionState[index] = azimuthB1 * x - azimuthA1 * y;
            x = y;

            // Head contour (W-C): up to three alternating lobes. Unused ones
            // are exact pass-throughs written in the configuration block.
            base = BIQUAD_HEAD_BUMP * 5;
            stateBase = (BIQUAD_HEAD_BUMP * channelCount + ch) * 2;
            y = biquadCoefficients[base] * x + biquadState[stateBase];
            biquadState[stateBase] = biquadCoefficients[base + 1] * x
                - biquadCoefficients[base + 3] * y + biquadState[stateBase + 1];
            biquadState[stateBase + 1] = biquadCoefficients[base + 2] * x
                - biquadCoefficients[base + 4] * y;
            x = y;

            base = BIQUAD_HEAD_BUMP_2 * 5;
            stateBase = (BIQUAD_HEAD_BUMP_2 * channelCount + ch) * 2;
            y = biquadCoefficients[base] * x + biquadState[stateBase];
            biquadState[stateBase] = biquadCoefficients[base + 1] * x
                - biquadCoefficients[base + 3] * y + biquadState[stateBase + 1];
            biquadState[stateBase + 1] = biquadCoefficients[base + 2] * x
                - biquadCoefficients[base + 4] * y;
            x = y;

            base = BIQUAD_HEAD_BUMP_3 * 5;
            stateBase = (BIQUAD_HEAD_BUMP_3 * channelCount + ch) * 2;
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

            index = SECTION_REPRODUCE_EQ_B * channelCount + ch;
            y = sectionB0[SECTION_REPRODUCE_EQ_B] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_REPRODUCE_EQ_B] * x
                - sectionA1[SECTION_REPRODUCE_EQ_B] * y;
            x = y;

            // IEC 3180 us reproduce side (W-C): the head differentiation
            // against the reproduce integrator, an exact 50.049 Hz
            // first-order high-pass. Against the bounded record boost it
            // leaves one high-pass at 50.049 / G Hz — the deck's LF end.
            //
            // It must sit AHEAD of the hiss injection: the ledger's H_*
            // columns are A-weighted floors measured at the deck's output, so
            // the hiss must not be shaped by a reproduce stage on its way
            // there.
            index = SECTION_PLAY_LF * channelCount + ch;
            y = sectionB0[SECTION_PLAY_LF] * x + sectionState[index];
            sectionState[index] = sectionB1[SECTION_PLAY_LF] * x
                - sectionA1[SECTION_PLAY_LF] * y;
            x = y;

            // DC block. It sits after the reproduce post-emphasis so that it
            // does not cancel the head bump; the stages ahead of it are
            // linear, so the same offset is removed either way. The 50 / G Hz
            // high-pass above subsumes it in the response, but it stays as
            // the insurance against a DC offset out of the saturator: two
            // multiplies.
            const blocked = x - dcInput[ch] + dcCoefficient * dcOutput[ch];
            dcInput[ch] = x;
            dcOutput[ch] = blocked;
            x = blocked;

            if (noiseActive) {
                rngNoise ^= rngNoise << 13; rngNoise |= 0;
                rngNoise ^= rngNoise >>> 17;
                rngNoise ^= rngNoise << 5; rngNoise |= 0;
                const hissDraw = (rngNoise >>> 0) * RNG_SCALE - 1;
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

                rngNoise ^= rngNoise << 13; rngNoise |= 0;
                rngNoise ^= rngNoise >>> 17;
                rngNoise ^= rngNoise << 5; rngNoise |= 0;
                const modulationDraw = (rngNoise >>> 0) * RNG_SCALE - 1;
                index = SECTION_MODULATION * channelCount + ch;
                y = sectionB0[SECTION_MODULATION] * modulationDraw + sectionState[index];
                sectionState[index] = sectionB1[SECTION_MODULATION] * modulationDraw
                    - sectionA1[SECTION_MODULATION] * y;
                let modulation = y * modulationGain;
                if (modulation > 0.5) modulation = 0.5;
                else if (modulation < -0.5) modulation = -0.5;
                x = (x + hiss) * (1 + modulation);
            }

            // Dolby decoder (W-5), after the noise injection and before the
            // output gain, per plan §3: the complementary feedback expander
            // built from the same CAL.DOLBY table as the encoder. Because
            // the injected floor sits ahead of it, the decoder's quiet-state
            // attenuation is what the status line's effective floor reports
            // (Record Level invariant after W-A, and moved on purpose by the
            // Dolby Level Error control.)
            if (dolbyFadeActive) {
                const decodeCurrent = dolbyMode === 0 ? x : dolbyDecodeSample(dolbyMode, ch, x);
                const decodePrevious = dolbyPrevMode === 0 ? x : dolbyDecodeSample(dolbyPrevMode, ch, x);
                x = decodePrevious + dolbyFadeWeight * (decodeCurrent - decodePrevious);
            } else if (dolbyCurStages !== 0) {
                // Inlined dolbyDecodeSample — identical recursion, stages
                // unrolled (reverse encode order) over the per-block
                // coefficient hoists (W-8).
                const decBase = dolbyCurBase + ch * DOLBY_SLOTS_PER_MODE + DOLBY_SLOTS_PER_DIR;
                if (dolbyStage1) {
                    const b = decBase + DOLBY_SLOTS_PER_STAGE;
                    let q = dolbyBank[b + 1] * dolbyInvRefDec * dolbyS1RefMul;
                    q = Math.min(q, DOLBY_TABLE_MAX_Q);
                    const pos = Math.sqrt(q * DOLBY_TABLE_INV_MAX_Q) * DOLBY_TABLE_SIZE;
                    const ti = pos | 0;
                    const a = dolbyCurTable[ti]
                        + (dolbyCurTable[ti + 1] - dolbyCurTable[ti]) * (pos - ti);
                    const oneMinusA = 1 - a;
                    const direct = dolbyS1AsB0 + dolbyS1Gain * oneMinusA * dolbyS1SkewA;
                    const stateTerm = dolbyBank[b + 4]
                        + dolbyS1Gain * oneMinusA
                            * ((1 - dolbyS1SkewA) * dolbyBank[b + 2] - dolbyBank[b + 3]);
                    const z = (x - stateTerm) / direct;
                    let k = z;
                    if (dolbyS1SkewA < 1) {
                        k = dolbyBank[b + 2] + dolbyS1SkewA * (z - dolbyBank[b + 2]);
                        dolbyBank[b + 2] = k;
                    }
                    dolbyBank[b + 3] = dolbyBank[b + 3] + a * (k - dolbyBank[b + 3]);
                    const m = dolbyS1AsB0 * z + dolbyBank[b + 4];
                    dolbyBank[b + 4] = dolbyS1AsB1 * z - dolbyS1AsA1 * m;
                    const clp = dolbyBank[b] + dolbyS1CtrlA * (k - dolbyBank[b]);
                    dolbyBank[b] = clp;
                    const magnitude = Math.abs(k - clp);
                    const detector = dolbyBank[b + 1];
                    const detectorDelta = magnitude - detector;
                    dolbyBank[b + 1] = detector
                        + dolbyS1Attack * Math.max(detectorDelta, 0)
                        + dolbyS1Release * Math.min(detectorDelta, 0);
                    x = z;
                }
                {
                    let q = dolbyBank[decBase + 1] * dolbyInvRefDec * dolbyS0RefMul;
                    q = Math.min(q, DOLBY_TABLE_MAX_Q);
                    const pos = Math.sqrt(q * DOLBY_TABLE_INV_MAX_Q) * DOLBY_TABLE_SIZE;
                    const ti = pos | 0;
                    const a = dolbyCurTable[ti]
                        + (dolbyCurTable[ti + 1] - dolbyCurTable[ti]) * (pos - ti);
                    const oneMinusA = 1 - a;
                    const direct = dolbyS0AsB0 + dolbyS0Gain * oneMinusA * dolbyS0SkewA;
                    const stateTerm = dolbyBank[decBase + 4]
                        + dolbyS0Gain * oneMinusA
                            * ((1 - dolbyS0SkewA) * dolbyBank[decBase + 2] - dolbyBank[decBase + 3]);
                    const z = (x - stateTerm) / direct;
                    let k = z;
                    if (dolbyS0SkewA < 1) {
                        k = dolbyBank[decBase + 2] + dolbyS0SkewA * (z - dolbyBank[decBase + 2]);
                        dolbyBank[decBase + 2] = k;
                    }
                    dolbyBank[decBase + 3] = dolbyBank[decBase + 3] + a * (k - dolbyBank[decBase + 3]);
                    const m = dolbyS0AsB0 * z + dolbyBank[decBase + 4];
                    dolbyBank[decBase + 4] = dolbyS0AsB1 * z - dolbyS0AsA1 * m;
                    const clp = dolbyBank[decBase] + dolbyS0CtrlA * (k - dolbyBank[decBase]);
                    dolbyBank[decBase] = clp;
                    const magnitude = Math.abs(k - clp);
                    const detector = dolbyBank[decBase + 1];
                    const detectorDelta = magnitude - detector;
                    dolbyBank[decBase + 1] = detector
                        + dolbyS0Attack * Math.max(detectorDelta, 0)
                        + dolbyS0Release * Math.min(detectorDelta, 0);
                    x = z;
                }
            }

            x *= outputGain;
            if (!(x > -16 && x < 16)) x = x > 0 ? 16 : (x < 0 ? -16 : 0);
            data[offset + i] = dry + mixRatio * (x - dry);
        }

        delayPosition = (delayPosition + 1) & DELAY_MASK;
        oversamplePosition = (oversamplePosition + 1) & OS_MASK;
        if (dolbyFade > 0) dolbyFade--;
    }

    flushDenormals(sectionState);
    flushDenormals(biquadState);
    flushDenormals(dcInput);
    flushDenormals(dcOutput);
    flushDenormals(envelope);
    flushDenormals(oversampleInput);
    flushDenormals(oversampleEven);
    flushDenormals(oversampleOdd);
    flushDenormals(dolbyBank);

    state.delayPosition = delayPosition;
    state.dolbyFade = dolbyFade;
    state.oversamplePosition = oversamplePosition;
    state.capstanPhase = capstanPhase;
    state.hubPhase = hubPhase;
    state.flutterA = flutterA;
    state.flutterB = flutterB;
    state.rngTransport = rngTransport;
    state.rngNoise = rngNoise;
    state.rngDropout = rngDropout;
    state.rngAzimuth = rngAzimuth;
    state.azWobbleA = azWobbleA;
    state.azWobbleB = azWobbleB;
    state.dropoutBudget = dropoutBudget;
    state.dropoutSharedPhase = dropoutSharedPhase;
    state.dropoutSharedIncrement = dropoutSharedIncrement;
    state.dropoutSharedDepth = dropoutSharedDepth;

    return data;
`;

// --- status-side effective-floor support (W-5) -----------------------------
// The status line's NR quieting term is measured, not re-modelled: the class
// runs the very processor string above on a seeded no-signal render (mono,
// wf/dp hard off, unity output) once with NR Off and once with the current
// mode, A-weights both floors, and reports the difference. Same code, same
// module-scope calibration table — the readout cannot drift from the DSP.
//
// W-A changed which axes the term depends on. It used to move with Input
// Peak, because the injected floor was fixed in the material domain while the
// decoder's detector reference moved with the trim. Now both scale with the
// makeup together, so the RATIO between them — which is all the decoder's
// quiet-state attenuation depends on — is Record Level invariant, measured at
// 0.00 dB over the whole -12..+18 dB span. What DOES move it is the Dolby
// Level Error, which offsets exactly that ratio on purpose, so `dl` takes the
// axis Record Level's predecessor used to occupy.
//
// Both renders draw the identical seeded noise sequence, so the difference
// is far more stable than either absolute floor. Results are cached per
// (type, mode, hs, dl, rate); the two renders are a fixed 40960 samples each
// (0.85 s at 48 kHz, 0.43 s at 96 kHz) and cost about 78 ms per uncached key
// at every host rate — the sample count is fixed, so the cost is too
// (fresh-process medians: 75.7 ms at 48 kHz, 78.0 ms at 96 and at 192 kHz;
// an earlier 140 ms reading at 96 kHz was JIT warm-up inside one process,
// not a rate dependence, R4 F-19). That is still far too much
// for the synchronous path of a slider drag, so the class keeps it off
// that path: cassetteArtifactsNrQuietingDbCached() serves the status line
// from the cache only, and an uncached key is rendered by one scheduled
// task (see _scheduleNrQuietingUpdate) that always measures the latest
// requested key — a drag's intermediate keys are never rendered — and then
// rewrites the status text. None of this ever runs on the audio thread.
//
// The simulation runs at the HOST sample rate, because the quieting term is
// NOT rate-invariant (R3 F-15). The injected hiss is shaped by a single
// 12 kHz one-pole low-pass, so its ultrasonic tail grows with the rate; the
// Dolby detector is wideband, follows that tail, and the decoder's
// quiet-state attenuation moves with it. Measured at the most rate-sensitive
// corner (Type I / Dolby C, hs -60.5, dl 0): 0.689 dB between a fixed 48 kHz
// simulation and the real 96 kHz floor, and 0.661 dB against the real
// 192 kHz floor — both past the 0.272 dB this file's own status-vs-render
// gate allows. The error does NOT keep growing with the rate: 192 kHz is
// slightly smaller than 96 kHz, because the term is flattening out up there.
// (Record Level is deliberately not part of that condition. W-A made the
// quieting term rl-invariant — the injected floor and the decoder's detector
// reference now scale by the same makeup — so quoting an rl would suggest a
// dependence that no longer exists.)
// (The 0.59 dB the ledger records at 48 kHz is a different quantity: the bias
// of the one-pole A-weighting meter above against the analytic weighting on
// this hiss spectrum, 0.595 dB at 48 kHz falling to 0.17 dB at 96 kHz. It says
// nothing about how the quieting term moves with the rate — R4 F-19.)
// EffeTune warns
// below 88.2 kHz (js/app.js), so a fixed 48 kHz simulation would in practice
// never be computed at the rate the user is actually running. The rate is
// therefore read from the live engine the same way the other rate-aware
// plugin UIs read it.
//
// The fallback below only covers offline and headless callers, where there is
// no engine to ask — and it is 96 kHz, the project's reference rate, NOT
// 48 kHz. It used to be 48 kHz, which contradicted the paragraph above it:
// the whole argument for following the engine is that 48 kHz is a rate this
// application steers users away from, so answering with it when nobody is
// there to ask is answering with the one rate we know is least likely to be
// right. That cost 0.262 dB on Dolby B and 0.47-0.50 dB on Dolby C, and the
// two have OPPOSITE SIGNS — B's quieting rises with rate (7.88 dB at
// 44.1 kHz to 8.31 at 192) while C's falls (18.08 to 17.25), because C's skew
// and anti-saturation shelves sit at 12-15 kHz, right where the hiss's
// ultrasonic tail grows. The opposite signs are why the error read as a
// broken C stage rather than as one wrong constant.
const CASSETTE_ARTIFACTS_STATUS_SIM_FALLBACK_RATE = 96000;
const CASSETTE_ARTIFACTS_STATUS_SIM_BLOCK = 4096;
// Trailing-edge debounce for the deferred measurement (R2 F-14): about twice
// the 48 kHz per-key render cost, and far longer than the ~8-16 ms cadence of
// drag input events, so a drag keeps pushing the timer ahead of itself and
// only the final key is ever rendered.
const CASSETTE_ARTIFACTS_STATUS_DEBOUNCE_MS = 150;
// Block counts, not seconds: the render's sample count — and so its cost —
// stays bounded as the host rate rises. 0.34 s / 0.51 s at 48 kHz, half that
// at 96 kHz, which is still ample (the measured status-vs-render agreement
// improves with rate: 0.632 dB at 48 kHz, 0.259 dB at 96, 0.098 dB at 192).
const CASSETTE_ARTIFACTS_STATUS_WARM_BLOCKS = 4;    // detectors and filters settle
const CASSETTE_ARTIFACTS_STATUS_MEASURE_BLOCKS = 6; // measurement window
const CASSETTE_ARTIFACTS_STATUS_STATE = { processor: null, cache: new Map() };

// The rate the status simulation runs at: whatever the audio engine is
// running at right now, resolved through the same candidate chain the other
// rate-aware plugin UIs use (fir_crossover, room_eq, ir_reverb,
// bluetooth_sbc_simulator). Offline and headless callers have no context and
// get the reference-rate fallback above.
function cassetteArtifactsStatusSimRate() {
    const candidates = [
        window.workletNode?.context?.sampleRate,
        window.audioContext?.sampleRate,
        window.uiManager?.audioManager?.audioContext?.sampleRate
    ];
    const rate = candidates.find(value => Number.isFinite(value) && value > 0);
    return rate || CASSETTE_ARTIFACTS_STATUS_SIM_FALLBACK_RATE;
}

// A-weighted RMS in dBFS (full-scale sine RMS = 0 dB, the ledger's noise
// convention), via the IEC 61672 analytic corners from CAL.A_WEIGHTING as a
// cascade of one-pole sections — two high-pass pairs at F1, high-passes at
// F2 and F3, a double low-pass at F4 — normalised to exactly unity at 1 kHz
// by measuring the cascade's own magnitude there, the same convention as the
// processor's spectral normalisation integral.
function cassetteArtifactsAWeightedRmsDbfs(samples, sampleRate) {
    const weighting = CASSETTE_ARTIFACTS_CALIBRATION.A_WEIGHTING;
    const sections = [];
    for (const frequency of [weighting.F1, weighting.F1, weighting.F2, weighting.F3]) {
        const pole = Math.exp(-2 * Math.PI * frequency / sampleRate);
        sections.push({ b0: (1 + pole) * 0.5, b1: -(1 + pole) * 0.5, a1: -pole, z: 0 });
    }
    for (const frequency of [weighting.F4, weighting.F4]) {
        const pole = Math.exp(-2 * Math.PI * frequency / sampleRate);
        sections.push({ b0: 1 - pole, b1: 0, a1: -pole, z: 0 });
    }
    const omega = 2 * Math.PI * 1000 / sampleRate;
    const cosine = Math.cos(omega);
    const sine = Math.sin(omega);
    let magnitude = 1;
    for (const section of sections) {
        const numeratorReal = section.b0 + section.b1 * cosine;
        const numeratorImag = -section.b1 * sine;
        const denominatorReal = 1 + section.a1 * cosine;
        const denominatorImag = -section.a1 * sine;
        magnitude *= Math.sqrt(
            (numeratorReal * numeratorReal + numeratorImag * numeratorImag)
            / (denominatorReal * denominatorReal + denominatorImag * denominatorImag));
    }
    const unityGain = 1 / magnitude;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        let value = samples[i];
        for (const section of sections) {
            const output = section.b0 * value + section.z;
            section.z = section.b1 * value - section.a1 * output;
            value = output;
        }
        value *= unityGain;
        sum += value * value;
    }
    const rms = Math.sqrt(sum / samples.length);
    return 20 * Math.log10(rms > 1e-30 ? rms / 0.7071067811865476 : 1e-30);
}

// The simulation rate is part of the key (R3 F-15): the measured quieting
// term depends on it, so a rate change must miss the cache rather than serve
// the previous engine's figure.
function cassetteArtifactsNrQuietingKey(typeKey, nrMode, hissDb, dolbyLevelErrorDb, simRate) {
    return `${typeKey}|${nrMode}|${hissDb}|${dolbyLevelErrorDb}|${simRate}`;
}

// Cache-only view of the quieting term (R1 F-11): 0 for the exact no-render
// cases (NR Off, hiss hard off), the cached measurement when one exists, and
// null when a render would be needed — the caller decides whether and when
// to schedule that render; this function never blocks.
function cassetteArtifactsNrQuietingDbCached(typeKey, nrMode, hissDb, dolbyLevelErrorDb) {
    if (nrMode !== 'Dolby B' && nrMode !== 'Dolby C') return 0;
    if (hissDb <= CASSETTE_ARTIFACTS_HISS_OFF_DB) return 0;
    const cached = CASSETTE_ARTIFACTS_STATUS_STATE.cache.get(
        cassetteArtifactsNrQuietingKey(typeKey, nrMode, hissDb, dolbyLevelErrorDb,
            cassetteArtifactsStatusSimRate()));
    return cached !== undefined ? cached : null;
}

function cassetteArtifactsNrQuietingDb(typeKey, nrMode, hissDb, dolbyLevelErrorDb) {
    if (nrMode !== 'Dolby B' && nrMode !== 'Dolby C') return 0;
    if (hissDb <= CASSETTE_ARTIFACTS_HISS_OFF_DB) return 0;
    const status = CASSETTE_ARTIFACTS_STATUS_STATE;
    const rate = cassetteArtifactsStatusSimRate();
    const key = cassetteArtifactsNrQuietingKey(typeKey, nrMode, hissDb, dolbyLevelErrorDb, rate);
    const cached = status.cache.get(key);
    if (cached !== undefined) return cached;
    if (!status.processor) {
        status.processor = new Function('context', 'data', 'parameters', 'time',
            CASSETTE_ARTIFACTS_REFERENCE_PROCESSOR);
    }
    const block = CASSETTE_ARTIFACTS_STATUS_SIM_BLOCK;
    const warm = CASSETTE_ARTIFACTS_STATUS_WARM_BLOCKS;
    const measure = CASSETTE_ARTIFACTS_STATUS_MEASURE_BLOCKS;
    const render = (mode) => {
        const context = { __seededRandom: () => 0.5 };
        // rl is pinned to 0 and dg / az to their neutral points on purpose.
        // The floor after W-A scales exactly with the makeup and the
        // decoder's reference scales with it too, so the measured DIFFERENCE
        // — which is all this function returns — cannot depend on rl; and the
        // Grade and the azimuth only shape the SIGNAL path, which is
        // identically zero on a no-signal render, so they cannot reach the
        // injected floor at all. Same argument that already pins wf and dp.
        const parameters = {
            enabled: true, tp: typeKey, nr: mode, bs: 0, rl: 0,
            dg: CASSETTE_ARTIFACTS_CALIBRATION.GRADE_DEFAULT, az: 0,
            dl: dolbyLevelErrorDb,
            wf: 0, hs: hissDb, dp: 0, og: 0, mx: 100,
            blockSize: block, channelCount: 1, sampleRate: rate
        };
        const collected = new Float32Array(measure * block);
        for (let b = 0; b < warm + measure; b++) {
            const data = new Float32Array(block);
            status.processor(context, data, parameters, b * block / rate);
            if (b >= warm) collected.set(data, (b - warm) * block);
        }
        return collected;
    };
    const quieting = cassetteArtifactsAWeightedRmsDbfs(render('Off'), rate)
        - cassetteArtifactsAWeightedRmsDbfs(render(nrMode), rate);
    if (status.cache.size > 64) status.cache.clear();
    status.cache.set(key, quieting);
    return quieting;
}

class CassetteArtifactsPlugin extends PluginBase {
    static getSystemPresetGroups() {
        return [{
            label: '',
            presets: CASSETTE_ARTIFACTS_SYSTEM_PRESETS.map(preset => ({ ...preset }))
        }];
    }

    constructor() {
        super('Cassette Artifacts', 'Compact-cassette record and reproduce chain');

        const calibration = CASSETTE_ARTIFACTS_CALIBRATION;
        // The defaults are a mass-market deck with a Type I tape in it, not a
        // Dragon with a metal tape (plan RC-5): the artifacts have to be
        // present at the shipped settings or the effect does nothing until
        // the user goes looking.
        this.dg = calibration.GRADE_DEFAULT; // dg: Deck Grade - Reference | Hi-Fi | Consumer | Portable
        this.tp = 'Type I';  // tp: Tape Type - Type I | Type II | Type IV
        this.nr = 'Dolby B'; // nr: Noise Reduction - Off | Dolby B | Dolby C
        this.bs = 0;         // bs: Bias - Range: -6 to +6 dB (relative to the Type's recommended point)
        this.rl = 9;         // rl: Record Level - Range: -12 to +18 dB above 250 nWb/m at a 0 dBFS peak
        this.wf = calibration.W_REF; // wf: Wow/Flutter - DIN 45507 weighted deviation at 4.76 cm/s - Range: 0 to 1 % (0 = off)
        this.hs = Math.round(calibration.H_II * 10) / 10; // hs: Hiss - Type II / NR Off A-weighted floor - Range: -92 to -42 dB re 250 nWb/m (off at -92)
        this.dp = calibration.D_DEFAULT; // dp: Dropouts - Range: 0 to D_MAX events/min (0 = off)
        this.az = calibration.AZ_DEFAULT_ARCMIN; // az: Azimuth - Range: -6 to +6 arcmin (signed)
        this.dl = 0;         // dl: Dolby Level Error - Range: -3 to +3 dB (signed)
        this.og = 0;         // og: Output - Range: -24 to +24 dB
        this.mx = 100;       // mx: Mix - Range: 0 to 100 %

        this.temporalCapability = 'must-process';

        // Deferred status support (R1 F-11): the single scheduled measurement
        // task. The measured figures themselves live only in the module-scope
        // cache, keyed exactly (R5 F-21), so there is no per-instance
        // "last figure" to go stale.
        this._nrQuietingTimer = null;

        this.registerProcessor(CASSETTE_ARTIFACTS_REFERENCE_PROCESSOR);
    }

    getTemporalCapability() {
        return this.enabled !== false && this.mx > 0 ? 'must-process' : 'reset-on-resume';
    }

    getParameters() {
        return {
            type: this.constructor.name,
            dg: this.dg,
            tp: this.tp,
            nr: this.nr,
            bs: this.bs,
            rl: this.rl,
            wf: this.wf,
            hs: this.hs,
            dp: this.dp,
            az: this.az,
            dl: this.dl,
            og: this.og,
            mx: this.mx,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.dg !== undefined) {
            this.dg = this.isAllowedEnum(String(params.dg),
                Object.keys(CASSETTE_ARTIFACTS_CALIBRATION.GRADES), this.dg);
        }
        if (params.tp !== undefined) {
            this.tp = this.isAllowedEnum(String(params.tp), ['Type I', 'Type II', 'Type IV'], this.tp);
        }
        if (params.nr !== undefined) {
            this.nr = this.isAllowedEnum(String(params.nr), ['Off', 'Dolby B', 'Dolby C'], this.nr);
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
            this.hs = this.parseFiniteNumber(params.hs, CASSETTE_ARTIFACTS_HISS_OFF_DB, -42, this.hs);
        }
        if (params.dp !== undefined) {
            this.dp = this.parseFiniteNumber(params.dp, 0, CASSETTE_ARTIFACTS_CALIBRATION.D_MAX, this.dp);
        }
        if (params.az !== undefined) {
            const azMax = CASSETTE_ARTIFACTS_CALIBRATION.AZ_MAX_ARCMIN;
            this.az = this.parseFiniteNumber(params.az, -azMax, azMax, this.az);
        }
        if (params.dl !== undefined) {
            this.dl = this.parseFiniteNumber(params.dl, -3, 3, this.dl);
        }
        if (params.og !== undefined) {
            this.og = this.parseFiniteNumber(params.og, -24, 24, this.og);
        }
        if (params.mx !== undefined) {
            this.mx = this.parseFiniteNumber(params.mx, 0, 100, this.mx);
        }
        // Coerced rather than assigned: a restored state carrying the string
        // "false" would otherwise be stored as a string and read as enabled by
        // every `enabled !== false` test, getTemporalCapability()'s included.
        // Booleans are unaffected.
        if (params.enabled !== undefined) {
            this.enabled = params.enabled !== false;
        }

        // Audio first, readout second (R1 F-11): updateParameters() hands
        // the new values to the worklet before any status work, so the
        // audible change never waits behind the status line's measured NR
        // term (which is deferred anyway, see _scheduleNrQuietingUpdate).
        this.updateParameters();
        this._refreshEffectiveValues();
    }

    // The status line is refreshed from setParameters because everything it
    // reports — both Base values, the Type and the NR mode — arrives through
    // it. Both readouts are taken from the same module-scope calibration
    // table the processor string is built out of, so they cannot drift from
    // the DSP.
    //
    // The speed is fixed, so the effective wow/flutter equals the Base value;
    // the arrow readout still states the measurement convention (DIN
    // peak-weighted percent at 4.76 cm/s), per plan §2.
    _effectiveWowFlutterPercent() {
        return this.wf;
    }

    // The no-signal A-weighted floor at the deck's output, in dBFS: the `hs`
    // Base (dB re 250 nWb/m) carried through the Type column difference, the
    // Record Level and the NR decoder, before Output.
    //
    // Derivation, so the line can be checked against a render by hand: the
    // injected flux level is hs + (typeFloor - H_II); converting it to the
    // saturator's internal dBFS adds SATURATION_REFERENCE_DBFS = -18, and the
    // makeup that carries it out to line level adds +18 - rl. The two -18/+18
    // terms cancel and what is left is a single "- rl": every dB of Record
    // Level is a dB of signal-to-noise, which is the whole point of W-A. The
    // Type term is exact against the processor (same table, same expression);
    // the NR term is the decoder's measured quiet-state attenuation — the
    // processor string itself rendered on a seeded no-signal pass (see
    // cassetteArtifactsNrQuietingDb above), NOT the nominal 10/20 dB.
    //
    // Called with no argument this is the exact, synchronous figure (it
    // renders on a cache miss) — the verification entry point. The status
    // line never takes that path: it passes _displayedNrQuietingDb(), the
    // cache-backed value, and leaves the render to the scheduled task
    // (R1 F-11).
    _effectiveHissDbFs(nrQuietingDb) {
        const calibration = CASSETTE_ARTIFACTS_CALIBRATION;
        const typeKey = calibration.TYPES[this.tp] ? this.tp : 'Type II';
        const typeFloor = calibration[CASSETTE_ARTIFACTS_TYPE_HISS_KEY[typeKey]];
        const quieting = nrQuietingDb !== undefined
            ? nrQuietingDb
            : cassetteArtifactsNrQuietingDb(typeKey, this.nr, this.hs, this.dl);
        return this.hs + (typeFloor - calibration.H_II) - this.rl - quieting;
    }

    // The quieting term the status line shows right now: the cached
    // measurement for the exact key on screen, or null while the deferred
    // render scheduled by _refreshEffectiveValues catches up. Never renders,
    // so it never blocks the UI thread (R1 F-11).
    //
    // Cache hit or nothing (R5 F-21). Earlier rounds reused the previous
    // measurement whenever a chosen subset of the key still matched, and every
    // axis left out of that subset had to be re-adjudicated in turn: the NR
    // mode was excluded in R3 F-16 (a carried figure was 8-18 dB out), the
    // level axis in R4 F-20 (4.79 dB), and `hs` — kept in on a Type II /
    // Dolby B reading of a few tenths of a dB — spans a decibel or more once
    // the hiss starts to overrun the Dolby reference. A partial-key guard is
    // simply the wrong shape: the term is a function of the whole key, so the
    // only honest reuse is an exact hit, and the cache already answers that
    // question. The cost is that an hs or dl drag reads "measuring…" until it
    // stops — the trade R3 F-16 already accepted for the mode axis — while any
    // key that has been measured, including one stepped back to, paints its
    // figure immediately.
    //
    // W-A retired the Record Level axis from this key: the injected floor and
    // the decoder's detector reference now scale together, so the measured
    // difference is rl-invariant (0.00 dB across the control). An rl drag
    // therefore never misses the cache, and the effective floor still moves
    // with it — through the exact "- rl" term in _effectiveHissDbFs().
    _displayedNrQuietingDb() {
        const calibration = CASSETTE_ARTIFACTS_CALIBRATION;
        const typeKey = calibration.TYPES[this.tp] ? this.tp : 'Type II';
        return cassetteArtifactsNrQuietingDbCached(typeKey, this.nr, this.hs, this.dl);
    }

    // Both readouts share one line, so each names the Base value it came
    // from: the line stands on its own away from the sliders it belongs to.
    //
    // While the NR term for the current key is still being measured the
    // effective figure reads "measuring…" rather than a number (R3 F-16,
    // widened to every key field by R5 F-21): the line is an aria-live region,
    // and announcing a settled-looking value that is 8-18 dB out and then
    // correcting it is worse than announcing nothing.
    // Everything else about the line — Base → effective, the "→ off" form,
    // the Type and NR labels — is unchanged.
    _statusText() {
        const calibration = CASSETTE_ARTIFACTS_CALIBRATION;
        const typeKey = calibration.TYPES[this.tp] ? this.tp : 'Type II';
        const nrLabel = this.nr === 'Off' ? 'NR Off' : this.nr;
        // Record Level states its convention and nothing else: it is a static
        // line, not a meter (plan D-6). What the user needs from it is the
        // one thing the control's number does not say by itself — that the
        // reference is a 0 dBFS peak, so a quiet master lands correspondingly
        // lower on the tape.
        const recordLevel = `Record Level ${this.rl >= 0 ? '+' : ''}${this.rl.toFixed(1)} dB →`
            + ` tape peak ${this.rl >= 0 ? '+' : ''}${this.rl.toFixed(1)} dB re 250 nWb/m at 0 dBFS in`;
        // The speed comes from the calibration table rather than from a
        // literal here: this line is the only place the transport speed is
        // stated, and reading the string from the table keeps that single
        // statement in one editable place. It does NOT make the label follow
        // SPEED_MPS — the label is a hand-written constant sitting next to
        // it, and keeping the two consistent is a manual obligation.
        const wowFlutter = `Wow/Flutter Base ${this.wf.toFixed(3)}% →`
            + ` ${this._effectiveWowFlutterPercent().toFixed(3)}% at ${calibration.SPEED_LABEL}`;
        const hissOff = this.hs <= CASSETTE_ARTIFACTS_HISS_OFF_DB;
        const quieting = hissOff ? 0 : this._displayedNrQuietingDb();
        const hiss = hissOff
            ? `Hiss Base ${this.hs.toFixed(1)} dB re 250 nWb/m → off`
            : `Hiss Base ${this.hs.toFixed(1)} dB re 250 nWb/m → `
                + (quieting === null
                    ? 'measuring…'
                    : `${this._effectiveHissDbFs(quieting).toFixed(1)} dBFS`)
                + `, ${typeKey}, ${nrLabel}`;
        return `${recordLevel} · ${wowFlutter} · ${hiss}`;
    }

    _refreshEffectiveValues() {
        if (!this.statusElement) return;
        this.statusElement.textContent = this._statusText();
        this._scheduleNrQuietingUpdate();
    }

    // Deferred NR quieting measurement (R1 F-11, retimed by R2 F-14). The
    // measured render costs about 78 ms per uncached key at every host rate
    // (the render's sample count is fixed), so it never runs on the
    // synchronous setParameters path. Deferral alone is not enough,
    // though: a 0 ms timer coalesces only calls from the same task, while
    // drag input events arrive ~8-16 ms apart — each step's timer would
    // expire before the next event and render every intermediate key. The
    // schedule is therefore a trailing-edge debounce: every call cancels
    // any pending timer and starts a fresh one, so nothing renders while a
    // drag keeps moving and, once it stops, the single surviving timer
    // measures the key the controls point at THEN and rewrites the status
    // line from the now cache-backed value. With no status element there is
    // nothing to display, so nothing is scheduled and nothing is rendered.
    _scheduleNrQuietingUpdate() {
        const calibration = CASSETTE_ARTIFACTS_CALIBRATION;
        const typeKey = calibration.TYPES[this.tp] ? this.tp : 'Type II';
        if (cassetteArtifactsNrQuietingDbCached(typeKey, this.nr, this.hs, this.dl) !== null) {
            return;
        }
        if (this._nrQuietingTimer !== null) clearTimeout(this._nrQuietingTimer);
        this._nrQuietingTimer = setTimeout(() => {
            this._nrQuietingTimer = null;
            if (!this.statusElement) return;
            const currentTypeKey = calibration.TYPES[this.tp] ? this.tp : 'Type II';
            // Renders (and caches) the latest requested key; exact no-render
            // cases return 0 without touching the processor. The value then
            // reaches the line below through _displayedNrQuietingDb(), whose
            // lookup is now a cache hit on that same key (R5 F-21).
            cassetteArtifactsNrQuietingDb(currentTypeKey, this.nr, this.hs, this.dl);
            this.statusElement.textContent = this._statusText();
        }, CASSETTE_ARTIFACTS_STATUS_DEBOUNCE_MS);
    }

    // The debounced measurement can now outlive the interaction that asked
    // for it by up to the debounce delay, so removal from the pipeline must
    // cancel it: the base cleanup() knows nothing about the timer, and a
    // late firing would burn ~76 ms rendering a key nobody will look at and
    // rewrite a detached status element (R2 F-14).
    cleanup() {
        if (this._nrQuietingTimer !== null) {
            clearTimeout(this._nrQuietingTimer);
            this._nrQuietingTimer = null;
        }
        super.cleanup();
    }

    setDg(value) { this.setParameters({ dg: value }); }
    setTp(value) { this.setParameters({ tp: value }); }
    setNr(value) { this.setParameters({ nr: value }); }
    setBs(value) { this.setParameters({ bs: value }); }
    setRl(value) { this.setParameters({ rl: value }); }
    setWf(value) { this.setParameters({ wf: value }); }
    setHs(value) { this.setParameters({ hs: value }); }
    setDp(value) { this.setParameters({ dp: value }); }
    setAz(value) { this.setParameters({ az: value }); }
    setDl(value) { this.setParameters({ dl: value }); }
    setOg(value) { this.setParameters({ og: value }); }
    setMx(value) { this.setParameters({ mx: value }); }

    createUI() {
        const container = document.createElement('div');
        container.className = 'cassette-artifacts-plugin-ui plugin-parameter-ui';

        // The transport speed is not a control — compact cassette runs at
        // 1 7/8 ips by definition — and it is not a row of its own either.
        // It used to head the panel as a fixed line, which said the same
        // thing the status line at the bottom already says as part of the
        // Wow/Flutter readout: a constant stated twice is one place for the
        // two to disagree and one row of screen for no information.
        //
        // Row order: the machine's class, then the medium, then the noise
        // reduction, then the two alignment adjustments (bias / record
        // level), then the wear-and-tear controls, then the two compatibility
        // axes that only mean anything with a sign, then output.
        container.appendChild(this.createRadioGroup('Deck Grade',
            Object.keys(CASSETTE_ARTIFACTS_CALIBRATION.GRADES)
                .map(name => ({ value: name, label: name })),
            this.dg, this.setDg.bind(this), 'dg'));

        container.appendChild(this.createRadioGroup('Tape Type', [
            { value: 'Type I', label: 'Type I' },
            { value: 'Type II', label: 'Type II' },
            { value: 'Type IV', label: 'Type IV' }
        ], this.tp, this.setTp.bind(this), 'tp'));

        container.appendChild(this.createRadioGroup('Noise Reduction', [
            { value: 'Off', label: 'Off' },
            { value: 'Dolby B', label: 'Dolby B' },
            { value: 'Dolby C', label: 'Dolby C' }
        ], this.nr, this.setNr.bind(this), 'nr'));

        container.appendChild(this.createParameterControl('Bias', -6, 6, 0.1, this.bs, this.setBs.bind(this), 'dB', 'bs'));
        container.appendChild(this.createParameterControl('Record Level', -12, 18, 0.1,
            this.rl, this.setRl.bind(this), 'dB', 'rl'));
        container.appendChild(this.createParameterControl('Wow/Flutter', 0, 1, 0.001,
            this.wf, this.setWf.bind(this), '%', 'wf'));
        // The unit is spelled out (RS-18): "dB" alone would read as a trim,
        // and the whole point of the W-A unit change is that this number is
        // the tape's own datasheet figure, not a level at the output.
        container.appendChild(this.createParameterControl('Hiss', CASSETTE_ARTIFACTS_HISS_OFF_DB, -42, 0.1,
            this.hs, this.setHs.bind(this), 'dB re 250 nWb/m', 'hs'));
        // Step 0.1 events/min and the D_MAX = 20 top are frozen together
        // (W-6): the ledger's QC anchor gives the range its meaning, and a
        // tenth of an event per minute is the finest distinction the
        // Poisson statistics make observable within a listening session.
        container.appendChild(this.createParameterControl('Dropouts', 0, CASSETTE_ARTIFACTS_CALIBRATION.D_MAX, 0.1,
            this.dp, this.setDp.bind(this), 'events/min', 'dp'));
        container.appendChild(this.createParameterControl('Azimuth',
            -CASSETTE_ARTIFACTS_CALIBRATION.AZ_MAX_ARCMIN,
            CASSETTE_ARTIFACTS_CALIBRATION.AZ_MAX_ARCMIN, 0.1,
            this.az, this.setAz.bind(this), 'arcmin', 'az'));
        container.appendChild(this.createParameterControl('Dolby Level Error', -3, 3, 0.1,
            this.dl, this.setDl.bind(this), 'dB', 'dl'));
        container.appendChild(this.createParameterControl('Output', -24, 24, 0.1, this.og, this.setOg.bind(this), 'dB', 'og'));
        container.appendChild(this.createParameterControl('Mix', 0, 100, 1, this.mx, this.setMx.bind(this), '%', 'mx'));

        // Base Wow/Flutter and Base Hiss are stated at the reference
        // configuration (fixed speed, Type II, NR Off), so the last line
        // reports what the pair comes to once the Type and NR selections are
        // applied. All of that arrives through setParameters, which
        // refreshes it.
        const status = document.createElement('div');
        status.className = 'cassette-artifacts-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        this.statusElement = status;
        // First paint through the same deferred path the updates use: the
        // text shows the cache-backed value at once and the measured NR term
        // arrives from the scheduled render (R1 F-11).
        this._refreshEffectiveValues();
        container.appendChild(status);

        return container;
    }
}

// Register the plugin
window.CassetteArtifactsPlugin = CassetteArtifactsPlugin;
