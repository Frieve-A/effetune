const VINYL_SIMULATOR_TAP_PHYSICS = 15;
const VINYL_SIMULATOR_TELEMETRY_VERSION = 1;
const VINYL_SIMULATOR_TELEMETRY_BYTES = 48;

const VINYL_SIMULATOR_REFERENCE_PROCESSOR = `
    if (!parameters.fr || typeof context.__seededRandom !== 'function') {
        data.measurements = { bypass: true };
        return data;
    }
    if (!parameters.enabled || parameters.channelCount < 1 ||
        parameters.blockSize < 1 || parameters.sampleRate <= 0) return data;

    const PI = 3.14159265358979323846;
    const TWO_PI = 2 * PI;
    const SQRT_HALF = 0.70710678118654752440;
    const SQRT_THREE = 1.73205080756887729353;
    const REFERENCE_VELOCITY = 0.05;
    // The source model's discharge range was calibrated against program peaks at +12 dB.
    const STATIC_REFERENCE_GAIN = 0.251188643150958;
    // An ESD edge is much faster than the audio rate. Its audible residual is limited here
    // by the longest RC decay in a standard 47 kOhm / 100-200 pF moving-magnet input.
    const PHONO_INPUT_RESISTANCE = 47e3;
    const PHONO_INPUT_CAPACITANCE = 200e-12;
    const STATIC_DECAY_SECONDS = PHONO_INPUT_RESISTANCE * PHONO_INPUT_CAPACITANCE;
    const STATIC_LIFETIME_SECONDS = 12 * STATIC_DECAY_SECONDS;
    const CUT_DISPLACEMENT_LIMIT = 25e-6;
    const ROUGH_STEP = 50e-9;
    const CORRELATION_FINE = 0.15e-6;
    const CORRELATION_MID = 2e-6;
    const CORRELATION_WAVE = 30e-6;
    const PATCH_HALF_WIDTH = 2.5e-6;
    const PVC_EFFECTIVE_YOUNG = 3e9 / (1 - 0.4 * 0.4);
    const GROOVE_HALF_WIDTH = 30e-6;
    const GROOVE_DEPTH = 30e-6;
    const RIAA_T1 = 3180e-6;
    const RIAA_T2 = 318e-6;
    const RIAA_T3 = 75e-6;
    const RIAA_T4 = 3.18e-6;
    const MINIMUM_GROOVE_SPEED = TWO_PI * 0.060 * ((100 / 3) / 60);
    const SIGNAL_LENGTH = 1 << 15;
    const SIGNAL_MASK = SIGNAL_LENGTH - 1;
    const ROUGH_LENGTH = 1 << 18;
    const ROUGH_MASK = ROUGH_LENGTH - 1;
    const DUST_TOP_POINTS = 49;
    const DUST_KIND_FLAKE = 0;
    const DUST_KIND_FIBER = 1;
    const DUST_KIND_GRIT = 2;
    const CONTACT_STEPS_PER_CYCLE = 8;
    const MASK_64 = (1n << 64n) - 1n;
    const FLOAT53 = 9007199254740992;
    const FLOAT32 = 4294967296;
    const FALLBACK_SEED = 0x00000000effe7a5en;

    function nextXorShift(value) {
        value ^= (value << 13n) & MASK_64;
        value ^= value >> 7n;
        value ^= (value << 17n) & MASK_64;
        return value & MASK_64;
    }

    function deriveReferenceSeeds() {
        if (context.__vinylReferenceSeeds) return context.__vinylReferenceSeeds;
        const seeds = [];
        if (typeof context.__seededRandom === 'function') {
            for (let index = 0; index < 3; index++) {
                seeds.push(BigInt(Math.floor(context.__seededRandom() * FLOAT32)));
            }
        } else {
            let master = FALLBACK_SEED;
            for (let index = 0; index < 3; index++) {
                master = nextXorShift(master);
                seeds.push((master >> 32n) & 0xffffffffn);
            }
        }
        context.__vinylReferenceSeeds = seeds;
        return seeds;
    }

    function makeRandom(seed) {
        return { state: seed === 0n ? FALLBACK_SEED : seed };
    }

    function random01(random) {
        random.state = nextXorShift(random.state);
        return Number(random.state >> 11n) / FLOAT53;
    }

    function randomSigned(random) {
        return random01(random) * 2 - 1;
    }

    function dustGaussian(state) {
        if (state.dustGaussianSpare !== null) {
            const spare = state.dustGaussianSpare;
            state.dustGaussianSpare = null;
            return spare;
        }
        let u, v, radiusSquared;
        do {
            u = 2 * random01(state.dustRandom) - 1;
            v = 2 * random01(state.dustRandom) - 1;
            radiusSquared = u * u + v * v;
        } while (radiusSquared >= 1 || radiusSquared === 0);
        const multiplier = Math.sqrt(-2 * Math.log(radiusSquared) / radiusSquared);
        state.dustGaussianSpare = v * multiplier;
        return u * multiplier;
    }

    function makeBiquad() {
        return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 };
    }

    function resetBiquad(filter) { filter.z1 = 0; filter.z2 = 0; }

    function processBiquad(filter, input) {
        const output = filter.b0 * input + filter.z1;
        filter.z1 = filter.b1 * input - filter.a1 * output + filter.z2;
        filter.z2 = filter.b2 * input - filter.a2 * output;
        return output;
    }

    function configureLowPass(filter, frequency, q, sampleRate) {
        const bounded = frequency > sampleRate * 0.45 ? sampleRate * 0.45 : frequency;
        const omega = TWO_PI * bounded / sampleRate;
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const alpha = sine / (2 * q);
        const inverseA0 = 1 / (1 + alpha);
        const half = (1 - cosine) * 0.5;
        filter.b0 = half * inverseA0;
        filter.b1 = (1 - cosine) * inverseA0;
        filter.b2 = filter.b0;
        filter.a1 = -2 * cosine * inverseA0;
        filter.a2 = (1 - alpha) * inverseA0;
    }

    function configureHighPass(filter, frequency, q, sampleRate) {
        const omega = TWO_PI * frequency / sampleRate;
        const cosine = Math.cos(omega);
        const sine = Math.sin(omega);
        const alpha = sine / (2 * q);
        const inverseA0 = 1 / (1 + alpha);
        const half = (1 + cosine) * 0.5;
        filter.b0 = half * inverseA0;
        filter.b1 = -(1 + cosine) * inverseA0;
        filter.b2 = filter.b0;
        filter.a1 = -2 * cosine * inverseA0;
        filter.a2 = (1 - alpha) * inverseA0;
    }

    function makeFirstOrder(zeroTime, poleTime, sampleRate) {
        const k = 2 * sampleRate;
        const inverseA0 = 1 / (1 + k * poleTime);
        return {
            b0: (1 + k * zeroTime) * inverseA0,
            b1: (1 - k * zeroTime) * inverseA0,
            a1: (1 - k * poleTime) * inverseA0,
            x1: 0,
            y1: 0
        };
    }

    function processFirstOrder(filter, input) {
        const output = filter.b0 * input + filter.b1 * filter.x1 - filter.a1 * filter.y1;
        filter.x1 = input;
        filter.y1 = output;
        return output;
    }

    function makeRiaa(playback, sampleRate) {
        const first = playback
            ? makeFirstOrder(RIAA_T2, RIAA_T1, sampleRate)
            : makeFirstOrder(RIAA_T1, RIAA_T2, sampleRate);
        const second = playback
            ? makeFirstOrder(RIAA_T4, RIAA_T3, sampleRate)
            : makeFirstOrder(RIAA_T3, RIAA_T4, sampleRate);
        const magnitude = (zeroTime, poleTime) => {
            const omega = TWO_PI * 1000;
            return Math.sqrt((1 + omega * omega * zeroTime * zeroTime) /
                (1 + omega * omega * poleTime * poleTime));
        };
        const recordingGain = magnitude(RIAA_T1, RIAA_T2) * magnitude(RIAA_T3, RIAA_T4);
        return { first, second, gain: playback ? recordingGain : 1 / recordingGain };
    }

    function resetRiaa(filter) {
        filter.first.x1 = 0; filter.first.y1 = 0;
        filter.second.x1 = 0; filter.second.y1 = 0;
    }

    function processRiaa(filter, input) {
        return processFirstOrder(filter.second, processFirstOrder(filter.first, input)) * filter.gain;
    }

    function fastTanh(input) {
        if (input >= 3) return 1;
        if (input <= -3) return -1;
        const squared = input * input;
        return input * (27 + squared) / (27 + 9 * squared);
    }

    function softClipDisplacement(input) {
        const normalized = input / CUT_DISPLACEMENT_LIMIT;
        const absolute = normalized < 0 ? -normalized : normalized;
        if (absolute <= 0.7) return input;
        const sign = normalized < 0 ? -1 : 1;
        return sign * CUT_DISPLACEMENT_LIMIT *
            (0.7 + 0.3 * fastTanh((absolute - 0.7) / 0.3));
    }

    function makeControls() {
        return {
            cut_scale: REFERENCE_VELOCITY,
            side_mix: 0.7,
            groove_speed: TWO_PI * 0.120 * ((100 / 3) / 60),
            rough_sigma: 13.17e-9,
            dust_rate: 2,
            static_rate: 0.08,
            scratch_rate: 0,
            side_radius: 18e-6,
            scan_radius: 8e-6,
            tracking_force: 2e-3 * 9.80665,
            tip_mass: 0.4e-6,
            compliance: 15e-3,
            damping: 0.25,
            hf_cutoff: 16000,
            bass_mono_below: 250,
            output_gain: 1,
            mix: 1
        };
    }

    function makeParticle() {
        return {
            active: false, scratch: false, touched: false, counted: false,
            dying: false, capacity_dying: false,
            order: 0,
            wall: 0, kind: DUST_KIND_FLAKE, scratch_kind: 0,
            center: 0, width: 1e-6, height: 0, felt_height: 0,
            lateral_half: 0, land_x: 0,
            residual: 0.15, yield_depth: 0.5e-6, amplitude: 0, amplitude_rate: 1,
            gouge: 0, burr: 0, wall_left: 1, wall_right: 1, skew: 0,
            lip_offset: 0.9, lip_width: 0.32, gouge_width: 1,
            lip_lead: 0.5, lip_trail: 0.5, scratch_support: 4e-6,
            top: new Float32Array(DUST_TOP_POINTS), top_initialized: false
        };
    }

    function createState(sampleRate) {
        const state = {
            sampleRate,
            latency: Math.ceil(25e-6 * sampleRate / MINIMUM_GROOVE_SPEED) + 4,
            signalLeft: new Float32Array(SIGNAL_LENGTH),
            signalRight: new Float32Array(SIGNAL_LENGTH),
            roughLeft: new Float32Array(ROUGH_LENGTH),
            roughRight: new Float32Array(ROUGH_LENGTH),
            dryLeft: null,
            dryRight: null,
            dust: Array.from({ length: 176 }, makeParticle),
            activeDust: [],
            staticPops: Array.from({ length: 16 }, () => ({ active: false, time: 0, amplitude: 0 })),
            rumbleMid: makeBiquad(), rumbleSide: makeBiquad(), sideHighPass: makeBiquad(),
            hfLeftFirst: makeBiquad(), hfLeftSecond: makeBiquad(),
            hfRightFirst: makeBiquad(), hfRightSecond: makeBiquad(),
            recordingRiaaLeft: makeRiaa(false, sampleRate),
            recordingRiaaRight: makeRiaa(false, sampleRate),
            playbackRiaaLeft: makeRiaa(true, sampleRate),
            playbackRiaaRight: makeRiaa(true, sampleRate),
            controls: makeControls(), targets: makeControls(), controlsInitialized: false,
            initialized: false, lastQuality: -1, lastShape: -1, lastPairChannels: 0,
            substeps: 4, scanPoints: 9, scanHalf: 6.4e-6, scanStep: 1.6e-6,
            leaky: Math.exp(-TWO_PI * 5 / sampleRate),
            roughAFine: Math.exp(-ROUGH_STEP / CORRELATION_FINE),
            roughAMid: Math.exp(-ROUGH_STEP / CORRELATION_MID),
            roughAWave: Math.exp(-ROUGH_STEP / CORRELATION_WAVE),
            roughKFine: Math.sqrt(CORRELATION_FINE / (CORRELATION_FINE + PATCH_HALF_WIDTH)),
            roughKMid: Math.sqrt(CORRELATION_MID / (CORRELATION_MID + PATCH_HALF_WIDTH)),
            roughKWave: Math.sqrt(CORRELATION_WAVE / (CORRELATION_WAVE + PATCH_HALF_WIDTH)),
            derivedSeeds: deriveReferenceSeeds()
        };
        state.dryLeft = new Float32Array(state.latency + 1);
        state.dryRight = new Float32Array(state.latency + 1);
        resetSimulation(state);
        return state;
    }

    function seedStreams(state) {
        state.roughRandom = makeRandom(state.derivedSeeds[0]);
        state.dustRandom = makeRandom(state.derivedSeeds[1]);
        state.staticRandom = makeRandom(state.derivedSeeds[2]);
        state.dustGaussianSpare = null;
    }

    function resetSimulation(state) {
        [state.rumbleMid, state.rumbleSide, state.sideHighPass,
            state.hfLeftFirst, state.hfLeftSecond,
            state.hfRightFirst, state.hfRightSecond].forEach(resetBiquad);
        [state.recordingRiaaLeft, state.recordingRiaaRight,
            state.playbackRiaaLeft, state.playbackRiaaRight].forEach(resetRiaa);
        state.integratorLeft = 0; state.integratorRight = 0;
        state.sampleCounter = 0; state.groovePosition = 0; state.simulationTime = 0;
        state.roughIndex = -1;
        state.roughFineLeft = 0; state.roughFineRight = 0;
        state.roughMidLeft = 0; state.roughMidRight = 0;
        state.roughWaveLeft = 0; state.roughWaveRight = 0;
        state.nextDustOrder = 0;
        for (let index = 0; index < state.dust.length; index++) state.dust[index] = makeParticle();
        for (const pop of state.staticPops) { pop.active = false; pop.time = 0; pop.amplitude = 0; }
        state.activeDust.length = 0;
        state.controlsInitialized = false;
        state.contactInitialized = false;
        seedStreams(state);
        state.tipX = 0; state.tipY = 18e-6 / SQRT_HALF;
        state.tipVx = 0; state.tipVy = 0;
        state.armX = 0; state.armY = state.tipY - 2e-3 * 9.80665 * 15e-3;
        state.armVx = 0; state.armVy = 0; state.restY = state.tipY;
        state.previousIntegralLeft = 0; state.previousIntegralRight = 0;
        state.contactLossTime = 0; state.inLossEpisode = false; state.skipHoldoff = 0;
        state.signalPowerLeft = 0; state.signalPowerRight = 0;
        state.errorPowerLeft = 0; state.errorPowerRight = 0;
        state.meterTipVelocitySquared = 0;
        state.meterForceLeft = 0; state.meterForceRight = 0;
        state.meterPressureLeft = 0; state.meterPressureRight = 0;
        state.meterJitterMeanNs = 0; state.meterJitterVarianceNs2 = 0;
        state.latestForceLeft = 0; state.latestForceRight = 0;
        state.latestPressureLeft = 0; state.latestPressureRight = 0; state.latestJitterNs = 0;
        state.mistrackCount = 0; state.skipCount = 0; state.popCount = 0; state.dustHitCount = 0;
    }

    function reseatStylus(state) {
        const controls = state.controls;
        const sideRadius = controls.side_radius > 1e-9 ? controls.side_radius : 18e-6;
        const scanRadius = controls.scan_radius > 1e-9 ? controls.scan_radius : 8e-6;
        const trackingForce = controls.tracking_force > 1e-6 ? controls.tracking_force : 2e-3 * 9.80665;
        const compliance = controls.compliance > 1e-6 ? controls.compliance : 15e-3;
        const effectiveRadius = state.lastShape === 0 ? sideRadius : Math.sqrt(sideRadius * scanRadius);
        const hertz = (4 / 3) * PVC_EFFECTIVE_YOUNG * Math.sqrt(effectiveRadius);
        const indentation = Math.pow(trackingForce * SQRT_HALF / hertz, 2 / 3);
        state.tipX = 0; state.tipY = (sideRadius - indentation) / SQRT_HALF;
        state.tipVx = 0; state.tipVy = 0;
        state.armX = 0; state.armY = state.tipY - trackingForce * compliance;
        state.armVx = 0; state.armVy = 0; state.restY = state.tipY;
        state.contactInitialized = false;
    }

    function qualityIndex(value) {
        if (value === 'Eco') return 0;
        if (value === 'High') return 2;
        if (value === 'Ultra') return 3;
        return 1;
    }

    function speedValue(value) {
        if (value === '45') return 45;
        if (value === '78') return 78;
        return 100 / 3;
    }

    function updateTargets(state, shape) {
        const target = state.targets;
        const value = key => Math.fround(parameters[key]);
        target.cut_scale = REFERENCE_VELOCITY * Math.pow(10, value('lv') / 20);
        target.side_mix = value('sm') * 0.01;
        target.groove_speed = TWO_PI * value('rd') * 1e-3 * (speedValue(parameters.rp) / 60);
        target.rough_sigma = value('rg') * 1e-9;
        target.dust_rate = value('dr');
        target.static_rate = value('st');
        target.scratch_rate = value('sc');
        target.side_radius = value('rs') * 1e-6;
        target.scan_radius = shape === 0 ? target.side_radius : value('rc') * 1e-6;
        target.tracking_force = value('tf') * 1e-3 * 9.80665;
        target.tip_mass = value('tm') * 1e-6;
        target.compliance = value('cm') * 1e-3;
        target.damping = value('dz');
        target.hf_cutoff = value('hf');
        target.bass_mono_below = value('mb');
        target.output_gain = Math.pow(10, value('og') / 20);
        target.mix = value('mx') * 0.01;
        if (!state.controlsInitialized) {
            Object.assign(state.controls, target);
            state.controlsInitialized = true;
            reseatStylus(state);
        }
    }

    function smoothControls(state, amount) {
        const keys = ['cut_scale', 'side_mix', 'groove_speed', 'rough_sigma', 'dust_rate',
            'static_rate', 'scratch_rate', 'side_radius', 'scan_radius', 'tracking_force',
            'tip_mass', 'compliance', 'damping', 'hf_cutoff', 'bass_mono_below',
            'output_gain', 'mix'];
        for (const key of keys) state.controls[key] += amount * (state.targets[key] - state.controls[key]);
        state.scanHalf = 0.8 * state.controls.scan_radius;
        state.scanStep = state.scanPoints > 1 ? 2 * state.scanHalf / (state.scanPoints - 1) : 0;
    }

    function minimumPhysicsSubsteps(state) {
        const controls = state.controls;
        const targets = state.targets;
        const tipMass = controls.tip_mass < targets.tip_mass ?
            controls.tip_mass : targets.tip_mass;
        const trackingForce = controls.tracking_force > targets.tracking_force ?
            controls.tracking_force : targets.tracking_force;
        const compliance = controls.compliance < targets.compliance ?
            controls.compliance : targets.compliance;
        const controlRadius = state.lastShape === 0 ? controls.side_radius :
            Math.sqrt(controls.side_radius * controls.scan_radius);
        const targetRadius = state.lastShape === 0 ? targets.side_radius :
            Math.sqrt(targets.side_radius * targets.scan_radius);
        const effectiveRadius = controlRadius > targetRadius ? controlRadius : targetRadius;
        const hertz = (4 / 3) * PVC_EFFECTIVE_YOUNG * Math.sqrt(effectiveRadius);
        const indentation = Math.pow(trackingForce * SQRT_HALF / hertz, 2 / 3);
        const contactStiffness = 1.5 * hertz * Math.sqrt(indentation);
        const resonanceHz = Math.sqrt((contactStiffness + 1 / compliance) / tipMass) /
            TWO_PI;
        return Math.ceil(CONTACT_STEPS_PER_CYCLE * resonanceHz / state.sampleRate);
    }

    function configureQuality(state, quality) {
        const table = [[2, 7], [4, 9], [8, 13], [20, 25]];
        state.substeps = table[quality][0];
        state.scanPoints = table[quality][1];
        const minimum = minimumPhysicsSubsteps(state);
        if (state.substeps < minimum) state.substeps = minimum;
    }

    function configureControlFilters(state) {
        const sampleRate = state.sampleRate;
        configureHighPass(state.rumbleMid, 20, 0.7071, sampleRate);
        configureHighPass(state.rumbleSide, 20, 0.7071, sampleRate);
        configureHighPass(state.sideHighPass, state.controls.bass_mono_below, 0.7071, sampleRate);
        configureLowPass(state.hfLeftFirst, state.controls.hf_cutoff, 0.5412, sampleRate);
        configureLowPass(state.hfLeftSecond, state.controls.hf_cutoff, 1.3066, sampleRate);
        configureLowPass(state.hfRightFirst, state.controls.hf_cutoff, 0.5412, sampleRate);
        configureLowPass(state.hfRightSecond, state.controls.hf_cutoff, 1.3066, sampleRate);
    }

    function cutInput(state, left, right) {
        let mid = processBiquad(state.rumbleMid, (left + right) * SQRT_HALF);
        let side = processBiquad(state.rumbleSide, (left - right) * SQRT_HALF);
        const highSide = processBiquad(state.sideHighPass, side);
        side = state.controls.side_mix * side + (1 - state.controls.side_mix) * highSide;
        let cutLeft = (mid + side) * SQRT_HALF;
        let cutRight = (mid - side) * SQRT_HALF;
        cutLeft = processBiquad(state.hfLeftSecond, processBiquad(state.hfLeftFirst, cutLeft));
        cutRight = processBiquad(state.hfRightSecond, processBiquad(state.hfRightFirst, cutRight));
        const velocityLeft = processRiaa(state.recordingRiaaLeft, cutLeft * state.controls.cut_scale);
        const velocityRight = processRiaa(state.recordingRiaaRight, cutRight * state.controls.cut_scale);
        state.integratorLeft = state.leaky * state.integratorLeft + velocityLeft / state.sampleRate;
        state.integratorRight = state.leaky * state.integratorRight + velocityRight / state.sampleRate;
        const position = state.sampleCounter & SIGNAL_MASK;
        state.signalLeft[position] = softClipDisplacement(state.integratorLeft);
        state.signalRight[position] = -softClipDisplacement(state.integratorRight);
    }

    function centerSignal(state, wall, samplePosition) {
        if (samplePosition < 0) return 0;
        const base = Math.floor(samplePosition);
        const fraction = samplePosition - base;
        const signal = wall === 0 ? state.signalLeft : state.signalRight;
        const read = index => index < 0 ? 0 : signal[index & SIGNAL_MASK];
        const p0 = read(base - 1), p1 = read(base), p2 = read(base + 1), p3 = read(base + 2);
        return p1 + 0.5 * fraction * (p2 - p0 + fraction *
            (2 * p0 - 5 * p1 + 4 * p2 - p3 + fraction * (3 * (p1 - p2) + p3 - p0)));
    }

    function ensureRoughness(state, maximumS) {
        const target = Math.ceil(maximumS / ROUGH_STEP) + 2;
        if (target < 0) return;
        const sigma = state.controls.rough_sigma;
        const gainFine = sigma * Math.sqrt(0.60 * (1 - state.roughAFine * state.roughAFine));
        const gainMid = sigma * Math.sqrt(0.30 * (1 - state.roughAMid * state.roughAMid));
        const gainWave = sigma * Math.sqrt(0.10 * (1 - state.roughAWave * state.roughAWave));
        while (state.roughIndex < target) {
            state.roughIndex++;
            state.roughFineLeft = state.roughAFine * state.roughFineLeft + gainFine * SQRT_THREE * randomSigned(state.roughRandom);
            state.roughFineRight = state.roughAFine * state.roughFineRight + gainFine * SQRT_THREE * randomSigned(state.roughRandom);
            state.roughMidLeft = state.roughAMid * state.roughMidLeft + gainMid * SQRT_THREE * randomSigned(state.roughRandom);
            state.roughMidRight = state.roughAMid * state.roughMidRight + gainMid * SQRT_THREE * randomSigned(state.roughRandom);
            state.roughWaveLeft = state.roughAWave * state.roughWaveLeft + gainWave * SQRT_THREE * randomSigned(state.roughRandom);
            state.roughWaveRight = state.roughAWave * state.roughWaveRight + gainWave * SQRT_THREE * randomSigned(state.roughRandom);
            const position = state.roughIndex & ROUGH_MASK;
            state.roughLeft[position] = state.roughKFine * state.roughFineLeft + state.roughKMid * state.roughMidLeft + state.roughKWave * state.roughWaveLeft;
            state.roughRight[position] = state.roughKFine * state.roughFineRight + state.roughKMid * state.roughMidRight + state.roughKWave * state.roughWaveRight;
        }
    }

    function roughShift(state, wall, position) {
        if (position <= 0) return 0;
        const grid = position / ROUGH_STEP;
        const base = Math.floor(grid);
        const fraction = grid - base;
        const rough = wall === 0 ? state.roughLeft : state.roughRight;
        const first = rough[base & ROUGH_MASK];
        const second = rough[(base + 1) & ROUGH_MASK];
        return first + fraction * (second - first);
    }

    function defectShift(state, wall, position) {
        let result = 0;
        for (const index of state.activeDust) {
            const particle = state.dust[index];
            if (particle.scratch) {
                const wallSkew = wall === 0 ? -particle.skew : particle.skew;
                const u = (position - particle.center - wallSkew) / particle.width;
                if (u > 4 || u < -4) continue;
                const gougeU = u / particle.gouge_width;
                const gaussian = Math.exp(-gougeU * gougeU);
                const leadU = (u + particle.lip_offset) / particle.lip_width;
                const trailU = (u - particle.lip_offset) / particle.lip_width;
                const wallGain = wall === 0 ? particle.wall_left : particle.wall_right;
                result += wallGain * particle.amplitude * (-particle.gouge * gaussian +
                    particle.burr * (particle.lip_lead * Math.exp(-leadU * leadU) +
                        particle.lip_trail * Math.exp(-trailU * trailU)));
            } else if (particle.wall === 3 || particle.wall === wall) {
                const u = (position - particle.center) / particle.width;
                if (u <= 4 && u >= -4) {
                    let height = particle.felt_height * particle.amplitude * Math.exp(-u * u);
                    if (particle.top_initialized) {
                        const topPosition = (u + 4) * (DUST_TOP_POINTS - 1) / 8;
                        let topIndex = Math.floor(topPosition);
                        if (topIndex > DUST_TOP_POINTS - 2) topIndex = DUST_TOP_POINTS - 2;
                        const topFraction = topPosition - topIndex;
                        const cap = particle.top[topIndex] * (1 - topFraction) +
                            particle.top[topIndex + 1] * topFraction;
                        if (cap < height) height = cap;
                    }
                    result += height;
                }
            }
        }
        return result;
    }

    function wallShift(state, wall, centerSample, spatialPosition, spatialOffset) {
        const sampleOffset = spatialOffset * state.sampleRate / state.controls.groove_speed;
        return centerSignal(state, wall, centerSample + sampleOffset) +
            roughShift(state, wall, spatialPosition) + defectShift(state, wall, spatialPosition);
    }

    function accumulatePositiveLinearSegment(result, left, right, leftOffset, step, scale) {
        if (left <= 0 && right <= 0) return;
        let area;
        let firstMoment;
        if (left > 0 && right > 0) {
            area = 0.5 * (left + right) * step;
            firstMoment = step * step * (left + 2 * right) / 6;
        } else if (left > 0) {
            const positiveLength = step * left / (left - right);
            area = 0.5 * left * positiveLength;
            firstMoment = area * positiveLength / 3;
        } else {
            const positiveLength = step * right / (right - left);
            area = 0.5 * right * positiveLength;
            firstMoment = area * (step - positiveLength / 3);
        }
        result.integral += scale * area;
        result.firstMoment += scale * (leftOffset * area + firstMoment);
    }

    function accumulateClippedLinearSegment(result, left, right, leftOffset, step) {
        // clamp(p, 0, limit) = max(p, 0) - max(p - limit, 0) for a linear segment.
        accumulatePositiveLinearSegment(result, left, right, leftOffset, step, 1);
        if (left > 5e-6 || right > 5e-6) {
            accumulatePositiveLinearSegment(result, left - 5e-6, right - 5e-6,
                leftOffset, step, -1);
        }
    }

    function wallContact(state, wall, distance, centerSample) {
        const result = { integral: 0, delta: -1, centroid: 0, firstMoment: 0 };
        const base = state.controls.side_radius - distance;
        const inverseCurve = 1 / (2 * state.controls.scan_radius);
        let previousPenetration = 0;
        let previousOffset = 0;
        for (let point = 0; point < state.scanPoints; point++) {
            const offset = -state.scanHalf + point * state.scanStep;
            const penetration = base + wallShift(state, wall, centerSample,
                state.groovePosition + offset, offset) - offset * offset * inverseCurve;
            if (penetration > result.delta) result.delta = penetration;
            if (point !== 0) {
                accumulateClippedLinearSegment(result, previousPenetration, penetration,
                    previousOffset, state.scanStep);
            }
            previousPenetration = penetration;
            previousOffset = offset;
        }
        result.centroid = result.integral > 0 ? result.firstMoment / result.integral : 0;
        return result;
    }

    function crushDust(state, wall, centerSample, base) {
        for (const index of state.activeDust) {
            const particle = state.dust[index];
            if (particle.scratch || (particle.wall !== wall && particle.wall !== 3)) continue;
            const firstPosition = particle.center - 4 * particle.width;
            const pointStep = 8 * particle.width / (DUST_TOP_POINTS - 1);
            let firstPoint = Math.ceil((state.groovePosition - state.scanHalf - firstPosition) /
                pointStep);
            let lastPoint = Math.floor((state.groovePosition + state.scanHalf - firstPosition) /
                pointStep);
            if (firstPoint < 0) firstPoint = 0;
            if (lastPoint > DUST_TOP_POINTS - 1) lastPoint = DUST_TOP_POINTS - 1;
            for (let point = firstPoint; point <= lastPoint; point++) {
                const position = firstPosition + point * pointStep;
                const normalized = (position - particle.center) / particle.width;
                const fullHeight = particle.felt_height * particle.amplitude *
                    Math.exp(-normalized * normalized);
                const existing = particle.top_initialized && particle.top[point] < fullHeight
                    ? particle.top[point] : fullHeight;
                if (existing <= 0) continue;
                const offset = position - state.groovePosition;
                const ballHeight = offset * offset / (2 * state.controls.scan_radius) - base -
                    centerSignal(state, wall, centerSample +
                        offset * state.sampleRate / state.controls.groove_speed) -
                    roughShift(state, wall, position);
                if (existing > ballHeight) particle.touched = true;
                let allowed = ballHeight + particle.yield_depth;
                const floorHeight = particle.residual * fullHeight;
                if (allowed < floorHeight) allowed = floorHeight;
                if (allowed < existing) {
                    if (!particle.top_initialized) {
                        particle.top.fill(Infinity);
                        particle.top_initialized = true;
                    }
                    particle.top[point] = allowed;
                }
            }
        }
    }

    function spawnStaticPop(state) {
        let selected = null;
        for (const pop of state.staticPops) {
            if (!pop.active) { selected = pop; break; }
            if (selected === null || pop.time < selected.time) selected = pop;
        }
        if (!selected) return;
        selected.active = true;
        selected.time = state.simulationTime;
        const sign = random01(state.staticRandom) < 0.5 ? -1 : 1;
        selected.amplitude = sign * (0.5 + 2.5 * random01(state.staticRandom)) *
            REFERENCE_VELOCITY * STATIC_REFERENCE_GAIN;
        state.popCount = (state.popCount + 1) >>> 0;
    }

    function stepPhysics(state, centerSample, spatialStep, dt, output) {
        state.groovePosition += spatialStep;
        state.simulationTime += dt;
        const distanceLeft = (state.tipX + state.tipY) * SQRT_HALF;
        const distanceRight = (-state.tipX + state.tipY) * SQRT_HALF;
        crushDust(state, 0, centerSample, state.controls.side_radius - distanceLeft);
        crushDust(state, 1, centerSample, state.controls.side_radius - distanceRight);
        const left = wallContact(state, 0, distanceLeft, centerSample);
        const right = wallContact(state, 1, distanceRight, centerSample);
        const effectiveRadius = state.lastShape === 0 ? state.controls.side_radius :
            Math.sqrt(state.controls.side_radius * state.controls.scan_radius);
        const foundation = PVC_EFFECTIVE_YOUNG * SQRT_HALF *
            Math.sqrt(effectiveRadius / state.controls.scan_radius);
        if (!state.contactInitialized) {
            state.previousIntegralLeft = left.integral;
            state.previousIntegralRight = right.integral;
            state.contactInitialized = true;
        }
        let forceLeft = foundation * (left.integral + 2e-6 *
            (left.integral - state.previousIntegralLeft) / dt);
        let forceRight = foundation * (right.integral + 2e-6 *
            (right.integral - state.previousIntegralRight) / dt);
        state.previousIntegralLeft = left.integral;
        state.previousIntegralRight = right.integral;
        if (forceLeft < 0 || left.integral <= 0) forceLeft = 0;
        if (forceRight < 0 || right.integral <= 0) forceRight = 0;
        if (forceLeft > 0.25) forceLeft = 0.25;
        if (forceRight > 0.25) forceRight = 0.25;

        const spring = 1 / state.controls.compliance;
        const damping = 2 * state.controls.damping * Math.sqrt(spring * state.controls.tip_mass);
        const springX = spring * (state.armX - state.tipX) + damping * (state.armVx - state.tipVx);
        const springY = spring * (state.armY - state.tipY) + damping * (state.armVy - state.tipVy);
        state.tipVx += ((forceLeft - forceRight) * SQRT_HALF + springX) * dt / state.controls.tip_mass;
        state.tipVy += ((forceLeft + forceRight) * SQRT_HALF + springY) * dt / state.controls.tip_mass;
        state.tipX += state.tipVx * dt;
        state.tipY += state.tipVy * dt;
        state.armVx += (-springX - 0.5 * state.armVx) * dt / 0.012;
        state.armVy += (-springY - state.controls.tracking_force - 0.5 * state.armVy) * dt / 0.012;
        state.armX += state.armVx * dt;
        state.armY += state.armVy * dt;

        const contactLoss = left.delta <= 0 || right.delta <= 0;
        if (contactLoss) {
            state.contactLossTime += dt;
            if (!state.inLossEpisode && state.contactLossTime > 30e-6) {
                state.inLossEpisode = true;
                state.mistrackCount = (state.mistrackCount + 1) >>> 0;
            }
        } else {
            state.contactLossTime = 0;
            state.inLossEpisode = false;
        }
        if (state.skipHoldoff > 0) state.skipHoldoff -= dt;
        const absoluteTipX = state.tipX < 0 ? -state.tipX : state.tipX;
        if (state.tipY - state.controls.side_radius > GROOVE_DEPTH + 6e-6 ||
            absoluteTipX > GROOVE_HALF_WIDTH * 2 ||
            !Number.isFinite(state.tipX) || !Number.isFinite(state.tipY)) {
            if (state.skipHoldoff <= 0) {
                state.skipCount = (state.skipCount + 1) >>> 0;
                state.skipHoldoff = 1.5e-3;
            }
            reseatStylus(state);
        }
        if (state.controls.static_rate > 0 &&
            random01(state.staticRandom) < state.controls.static_rate * dt) spawnStaticPop(state);
        let pickupLeft = (state.tipVx + state.tipVy) * SQRT_HALF;
        let pickupRight = (state.tipVx - state.tipVy) * SQRT_HALF;
        for (const pop of state.staticPops) {
            if (!pop.active) continue;
            const age = state.simulationTime - pop.time;
            if (age > STATIC_LIFETIME_SECONDS) { pop.active = false; continue; }
            const pulse = pop.amplitude * Math.exp(-age / STATIC_DECAY_SECONDS);
            pickupLeft += pulse; pickupRight += pulse;
        }
        output.left += pickupLeft; output.right += pickupRight;
        state.latestForceLeft = forceLeft; state.latestForceRight = forceRight;
        state.latestPressureLeft = left.delta > 0 ? forceLeft /
            (PI * state.controls.side_radius * left.delta) : 0;
        state.latestPressureRight = right.delta > 0 ? forceRight /
            (PI * state.controls.side_radius * right.delta) : 0;
        state.latestJitterNs = 0.5 * (left.centroid + right.centroid) /
            state.controls.groove_speed * 1e9;
    }

    function allocateDust(state) {
        let oldest = null;
        for (let index = 0; index < state.dust.length; index++) {
            const particle = state.dust[index];
            if (!particle.active) {
                state.dust[index] = makeParticle();
                state.dust[index].active = true;
                state.dust[index].order = state.nextDustOrder++;
                return state.dust[index];
            }
            if (oldest === null || particle.order < oldest.order) oldest = particle;
        }
        Object.assign(oldest, makeParticle());
        oldest.active = true;
        oldest.order = state.nextDustOrder++;
        return oldest;
    }

    function spawnDust(state) {
        const particle = allocateDust(state);
        let ahead = state.controls.groove_speed * 2.5;
        if (ahead > 400e-6) ahead = 400e-6;
        if (ahead < 16e-6) ahead = 16e-6;
        particle.center = state.groovePosition + ahead * (0.5 + random01(state.dustRandom));
        particle.amplitude_rate = state.controls.groove_speed /
            (0.25 * (particle.center - state.groovePosition));
        const kind = random01(state.dustRandom);
        if (kind < 0.55) {
            particle.kind = DUST_KIND_FLAKE;
            particle.height = 1.5e-6 * Math.exp(0.8 * dustGaussian(state));
            if (particle.height < 0.3e-6) particle.height = 0.3e-6;
            else if (particle.height > 12e-6) particle.height = 12e-6;
            particle.width = particle.height * (0.7 + 1.6 * random01(state.dustRandom));
            particle.yield_depth = 0.5e-6; particle.residual = 0.15;
        } else if (kind < 0.85) {
            particle.kind = DUST_KIND_FIBER;
            particle.height = (1 + 2 * random01(state.dustRandom)) * 1e-6;
            const length = (10 + 30 * random01(state.dustRandom)) * 1e-6;
            const angle = random01(state.dustRandom) * PI / 2;
            const longitudinal = 0.5 * length * Math.cos(angle);
            particle.width = particle.height > longitudinal ? particle.height : longitudinal;
            const lateral = length * Math.sin(angle);
            particle.lateral_half = (particle.height > lateral ? particle.height : lateral) / 2;
            particle.yield_depth = 0.2e-6; particle.residual = 0.10;
        } else {
            particle.kind = DUST_KIND_GRIT;
            particle.height = 2e-6 * Math.exp(0.6 * dustGaussian(state));
            if (particle.height < 0.5e-6) particle.height = 0.5e-6;
            else if (particle.height > 6e-6) particle.height = 6e-6;
            particle.width = particle.height * (0.8 + 0.6 * random01(state.dustRandom));
            particle.yield_depth = 3e-6; particle.residual = 0.85;
        }
        const landing = random01(state.dustRandom);
        if (landing < 0.4) {
            particle.wall = random01(state.dustRandom) < 0.5 ? 0 : 1;
            particle.land_x = (2 + 30 * random01(state.dustRandom)) * 1e-6;
            particle.felt_height = 0;
        } else if (particle.kind === DUST_KIND_FIBER ||
            random01(state.dustRandom) < Math.exp(-particle.height / 4e-6)) {
            particle.wall = random01(state.dustRandom) < 0.5 ? 0 : 1;
            const wallPosition = (3 + 39 * random01(state.dustRandom)) * 1e-6;
            const particleLateral = particle.kind === DUST_KIND_FIBER ?
                particle.lateral_half : 0.5 * particle.height;
            const lateral = (wallPosition - state.controls.side_radius) /
                (particleLateral + PATCH_HALF_WIDTH);
            particle.felt_height = particle.height * Math.exp(-lateral * lateral);
        } else {
            particle.wall = 3;
            const top = (Math.SQRT2 + 1) * 0.5 * particle.height;
            let clearance = top - (Math.SQRT2 - 1) * state.controls.side_radius;
            if (clearance < 0) clearance = 0;
            particle.felt_height = SQRT_HALF * clearance;
        }
        particle.amplitude = 0;
    }

    function spawnScratch(state) {
        const particle = allocateDust(state);
        particle.scratch = true;
        particle.wall = 2;
        let ahead = state.controls.groove_speed * 2.5;
        if (ahead > 400e-6) ahead = 400e-6;
        if (ahead < 16e-6) ahead = 16e-6;
        const scratchAhead = ahead * (0.5 + random01(state.dustRandom));
        particle.center = state.groovePosition + scratchAhead;
        particle.amplitude_rate = state.controls.groove_speed / (0.25 * scratchAhead);
        const kind = random01(state.dustRandom);
        let wallRight;
        if (kind < 0.28) {
            particle.scratch_kind = 0;
            particle.gouge = (0.2 + 1.3 * random01(state.dustRandom)) * 1e-6;
            particle.burr = (0.1 + 0.9 * random01(state.dustRandom)) * 1e-6;
            particle.width = (18 + 55 * random01(state.dustRandom)) * 1e-6;
            wallRight = 0.65 + 0.30 * random01(state.dustRandom);
        } else if (kind < 0.63) {
            particle.scratch_kind = 1;
            particle.gouge = (4 + 10 * random01(state.dustRandom)) * 1e-6;
            particle.burr = (6 + 14 * random01(state.dustRandom)) * 1e-6;
            particle.width = (10 + 28 * random01(state.dustRandom)) * 1e-6;
            wallRight = 0.35 + 0.55 * random01(state.dustRandom);
        } else if (kind < 0.80) {
            particle.scratch_kind = 2;
            particle.gouge = (1 + 5 * random01(state.dustRandom)) * 1e-6;
            particle.burr = (12 + 18 * random01(state.dustRandom)) * 1e-6;
            particle.width = (8 + 24 * random01(state.dustRandom)) * 1e-6;
            wallRight = 0.25 + 0.55 * random01(state.dustRandom);
        } else if (kind < 0.95) {
            particle.scratch_kind = 3;
            particle.gouge = (8 + 14 * random01(state.dustRandom)) * 1e-6;
            particle.burr = (1 + 6 * random01(state.dustRandom)) * 1e-6;
            particle.width = (10 + 34 * random01(state.dustRandom)) * 1e-6;
            wallRight = 0.30 + 0.55 * random01(state.dustRandom);
        } else {
            particle.scratch_kind = 4;
            particle.gouge = (12 + 16 * random01(state.dustRandom)) * 1e-6;
            particle.burr = (6 + 22 * random01(state.dustRandom)) * 1e-6;
            particle.width = (12 + 30 * random01(state.dustRandom)) * 1e-6;
            wallRight = 0.05 + 0.30 * random01(state.dustRandom);
        }
        let lipLead = 0.45 + 0.95 * random01(state.dustRandom);
        let lipTrail = 0.20 + 0.80 * random01(state.dustRandom);
        if (random01(state.dustRandom) < 0.5) {
            const swap = lipLead; lipLead = lipTrail; lipTrail = swap;
        }
        let wallLeft = 1;
        if (random01(state.dustRandom) < 0.5) {
            const swap = wallLeft; wallLeft = wallRight; wallRight = swap;
        }
        particle.lip_offset = 0.75 + 0.55 * random01(state.dustRandom);
        particle.lip_width = 0.22 + 0.28 * random01(state.dustRandom);
        particle.gouge_width = 0.70 + 0.45 * random01(state.dustRandom);
        particle.lip_lead = lipLead;
        particle.lip_trail = lipTrail;
        particle.wall_left = wallLeft;
        particle.wall_right = wallRight;
        particle.skew = (random01(state.dustRandom) - 0.5) * particle.width * 1.4;
        const absoluteSkew = particle.skew < 0 ? -particle.skew : particle.skew;
        particle.scratch_support = 4 * particle.width + absoluteSkew;
        particle.height = particle.gouge > particle.burr ? particle.gouge : particle.burr;
        particle.amplitude = 0;
    }

    function enforceDustCapacity(state) {
        let activeCount = 0, capacityDyingCount = 0;
        for (const particle of state.dust) {
            if (!particle.active) continue;
            activeCount++;
            if (particle.capacity_dying) capacityDyingCount++;
        }
        const requiredDying = activeCount > 128 ? activeCount - 128 : 0;
        while (capacityDyingCount < requiredDying) {
            let oldest = null;
            for (const particle of state.dust) {
                if (!particle.active || particle.capacity_dying) continue;
                if (oldest === null || particle.order < oldest.order) oldest = particle;
            }
            if (oldest === null) break;
            oldest.capacity_dying = true;
            oldest.dying = true;
            capacityDyingCount++;
        }
    }

    function advanceDefects(state, dt) {
        if (state.controls.dust_rate > 0 && random01(state.dustRandom) < state.controls.dust_rate * dt) spawnDust(state);
        if (state.controls.scratch_rate > 0 && random01(state.dustRandom) < state.controls.scratch_rate * dt) spawnScratch(state);
        enforceDustCapacity(state);
        state.activeDust.length = 0;
        for (let index = 0; index < state.dust.length; index++) {
            const particle = state.dust[index];
            if (!particle.active) continue;
            if (particle.dying) {
                particle.amplitude -= particle.amplitude_rate * dt;
                if (particle.amplitude <= 0) { particle.active = false; continue; }
            } else if (particle.amplitude < 1) {
                particle.amplitude += particle.amplitude_rate * dt;
                if (particle.amplitude > 1) particle.amplitude = 1;
            }
            if (!particle.dying && !particle.scratch && !particle.counted &&
                state.groovePosition > particle.center + 2 * particle.width) {
                particle.counted = true;
                if (particle.touched) {
                    state.dustHitCount = (state.dustHitCount + 1) >>> 0;
                    if (particle.kind === DUST_KIND_GRIT) particle.dying = true;
                }
            }
            if (particle.center < state.groovePosition - 5e-3) { particle.active = false; continue; }
            const distance = particle.center - state.groovePosition;
            const absoluteDistance = distance < 0 ? -distance : distance;
            const support = particle.scratch ? particle.scratch_support : 4 * particle.width;
            if ((particle.scratch || particle.felt_height > 1e-12) &&
                absoluteDistance <= support + state.scanHalf) state.activeDust.push(index);
        }
    }

    function updateStatistics(state, idealLeft, idealRight, pickupLeft, pickupRight, alpha) {
        const idealX = (idealLeft - idealRight) * SQRT_HALF;
        const idealY = state.restY + (idealLeft + idealRight) * SQRT_HALF;
        const errorX = state.tipX - idealX;
        const errorY = state.tipY - idealY;
        const errorLeft = (errorX + errorY) * SQRT_HALF;
        const errorRight = (errorX - errorY) * SQRT_HALF;
        state.signalPowerLeft += alpha * (idealLeft * idealLeft - state.signalPowerLeft);
        state.signalPowerRight += alpha * (idealRight * idealRight - state.signalPowerRight);
        state.errorPowerLeft += alpha * (errorLeft * errorLeft - state.errorPowerLeft);
        state.errorPowerRight += alpha * (errorRight * errorRight - state.errorPowerRight);
        const pickupPower = 0.5 * (pickupLeft * pickupLeft + pickupRight * pickupRight);
        state.meterTipVelocitySquared += alpha * (pickupPower - state.meterTipVelocitySquared);
        state.meterForceLeft += alpha * (state.latestForceLeft - state.meterForceLeft);
        state.meterForceRight += alpha * (state.latestForceRight - state.meterForceRight);
        state.meterPressureLeft += alpha * (state.latestPressureLeft - state.meterPressureLeft);
        state.meterPressureRight += alpha * (state.latestPressureRight - state.meterPressureRight);
        const jitterDelta = state.latestJitterNs - state.meterJitterMeanNs;
        state.meterJitterMeanNs += alpha * jitterDelta;
        state.meterJitterVarianceNs2 += alpha *
            (jitterDelta * jitterDelta - state.meterJitterVarianceNs2);
    }

    function trackingRatioDb(signalPower, errorPower) {
        if (signalPower <= 1e-30 && errorPower <= 1e-30) return 0;
        const ratio = 10 * Math.log10((signalPower + 1e-30) / (errorPower + 1e-30));
        return ratio > 120 ? 120 : (ratio < -120 ? -120 : ratio);
    }

    let state = context.vinylSimulator;
    if (!state || state.sampleRate !== parameters.sampleRate) {
        state = createState(parameters.sampleRate);
        context.vinylSimulator = state;
    }
    const pairChannels = parameters.channelCount >= 2 ? 2 : 1;
    const quality = qualityIndex(parameters.ql);
    const shape = parameters.sh === 'Spherical' ? 0 : 1;
    if (!state.initialized || quality !== state.lastQuality || shape !== state.lastShape ||
        pairChannels !== state.lastPairChannels) {
        resetSimulation(state);
        state.lastQuality = quality;
        state.lastShape = shape;
        state.lastPairChannels = pairChannels;
        state.initialized = true;
    }
    updateTargets(state, shape);
    configureControlFilters(state);
    configureQuality(state, quality);

    const smoothing = 1 - Math.exp(-1 / (state.sampleRate * 0.020));
    const meterAlpha = 1 - Math.exp(-1 / (state.sampleRate * 0.100));
    const inverseSampleRate = 1 / state.sampleRate;
    const frameCount = parameters.blockSize;
    for (let frame = 0; frame < frameCount; frame++) {
        smoothControls(state, smoothing);
        const leftIndex = frame;
        const rightIndex = pairChannels === 2 ? frameCount + frame : frame;
        const inputLeft = data[leftIndex];
        const inputRight = data[rightIndex];
        const dryPosition = state.sampleCounter % state.dryLeft.length;
        state.dryLeft[dryPosition] = inputLeft;
        state.dryRight[dryPosition] = inputRight;
        let dryLeft = 0, dryRight = 0;
        if (state.sampleCounter >= state.latency) {
            const delayedPosition = (state.sampleCounter - state.latency) % state.dryLeft.length;
            dryLeft = state.dryLeft[delayedPosition];
            dryRight = state.dryRight[delayedPosition];
        }
        cutInput(state, inputLeft, inputRight);
        const readSample = state.sampleCounter - state.latency;
        const nextS = state.groovePosition + state.controls.groove_speed * inverseSampleRate;
        ensureRoughness(state, nextS + state.scanHalf + ROUGH_STEP * 4);
        const output = { left: 0, right: 0 };
        for (let substep = 0; substep < state.substeps; substep++) {
            const fraction = (substep + 1) / state.substeps;
            const centerSample = readSample - 1 + fraction;
            stepPhysics(state, centerSample,
                state.controls.groove_speed / (state.sampleRate * state.substeps),
                1 / (state.sampleRate * state.substeps), output);
        }
        state.groovePosition = nextS;
        const pickupLeft = output.left / state.substeps;
        const pickupRight = output.right / state.substeps;
        const deLeft = processRiaa(state.playbackRiaaLeft, pickupLeft);
        const deRight = processRiaa(state.playbackRiaaRight, pickupRight);
        const inverseCutScale = state.controls.cut_scale > 1e-12 ? 1 / state.controls.cut_scale : 0;
        let wetLeft = deLeft * inverseCutScale * state.controls.output_gain;
        let wetRight = deRight * inverseCutScale * state.controls.output_gain;
        if (!Number.isFinite(wetLeft) || !Number.isFinite(wetRight)) {
            reseatStylus(state); wetLeft = 0; wetRight = 0;
        }
        const dryGain = 1 - state.controls.mix;
        data[leftIndex] = dryGain * dryLeft + state.controls.mix * wetLeft;
        if (pairChannels === 2) data[rightIndex] = dryGain * dryRight + state.controls.mix * wetRight;
        updateStatistics(state, centerSignal(state, 0, readSample), centerSignal(state, 1, readSample),
            pickupLeft, pickupRight, meterAlpha);
        advanceDefects(state, inverseSampleRate);
        state.sampleCounter++;
    }

    data.measurements = {
        forceL: state.meterForceLeft,
        forceR: state.meterForceRight,
        pressL: state.meterPressureLeft,
        pressR: state.meterPressureRight,
        tipVelRms: Math.sqrt(state.meterTipVelocitySquared),
        trkSE_L: trackingRatioDb(state.signalPowerLeft, state.errorPowerLeft),
        trkSE_R: trackingRatioDb(state.signalPowerRight, state.errorPowerRight),
        jitterNs: Math.sqrt(state.meterJitterVarianceNs2),
        mistrackCount: state.mistrackCount,
        skipCount: state.skipCount,
        popCount: state.popCount,
        dustHitCount: state.dustHitCount
    };
    return data;
`;

let vinylSimulatorInstanceSerial = 0;
const READING_JITTER_BAR_MAX_NS = 1000;

class VinylSimulatorPlugin extends PluginBase {
    constructor() {
        super('Vinyl Simulator', 'Physical record cutting and stylus playback simulation');

        this.lv = 0;
        this.hf = 16000;
        this.mb = 250;
        this.sm = 70;
        this.rp = '33⅓';
        this.rd = 120;
        this.rg = 13.17;
        this.dr = 2.0;
        this.st = 0.08;
        this.sc = 0;
        this.sh = 'Elliptical';
        this.rs = 18;
        this.rc = 8;
        this.tf = 2.0;
        this.tm = 0.4;
        this.cm = 15;
        this.dz = 0.25;
        this.ql = 'Standard';
        this.og = 0;
        this.mx = 100;
        this.fr = false;

        this.temporalCapability = 'must-process';
        this.selectedTab = 'cutting';
        this.animationFrameId = null;
        this.hudCanvas = null;
        this.hudStatusElement = null;
        this.lastHudStatusMode = null;
        this.hudGraphDispose = null;
        this.hudVisible = true;
        this.hudCreatedAt = performance.now();
        this.lastTelemetryAt = 0;
        this.lastBypassAt = 0;
        this.bypassSince = 0;
        this.lastScalarAt = 0;
        this.lastCounterAt = 0;
        this.lastCounters = null;
        this.eventFlashUntil = 0;
        this.hudValues = {
            forceL: 0, forceR: 0, pressL: 0, pressR: 0,
            tipVelRms: 0, trkSE_L: 0, trkSE_R: 0, jitterNs: 0,
            mistrackRate: 0, skipRate: 0, popRate: 0, dustHitRate: 0
        };

        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspVinylTelemetry = frame => this.handleDspVinylTelemetry(frame);

        this.registerProcessor(VINYL_SIMULATOR_REFERENCE_PROCESSOR);
    }

    getTemporalCapability() {
        return this.enabled !== false && this.mx > 0 ? 'must-process' : 'reset-on-resume';
    }

    setEnabled(enabled) {
        this._applyHudGateChange(() => super.setEnabled(enabled));
    }

    _setSectionEnabled(sectionEnabled) {
        this._applyHudGateChange(() => super._setSectionEnabled(sectionEnabled));
    }

    setPowerUiEnabled(enabled) {
        this._applyHudGateChange(() => super.setPowerUiEnabled(enabled));
    }

    _hudGateMode() {
        if (this.enabled === false) return 'disabled';
        return this.canRunAnimation() ? 'ready' : 'paused';
    }

    _applyHudGateChange(changeGate) {
        const previousMode = this._hudGateMode();
        changeGate();
        const nextMode = this._hudGateMode();
        if (nextMode === previousMode) return;
        this._updateHudStatus(nextMode === 'ready' ? this._hudMode(performance.now()) : nextMode);
        this.drawHud();
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            lv: this.lv, hf: this.hf, mb: this.mb, sm: this.sm,
            rp: this.rp, rd: this.rd, rg: this.rg, dr: this.dr, st: this.st, sc: this.sc,
            sh: this.sh, rs: this.rs, rc: this.rc, tf: this.tf, tm: this.tm, cm: this.cm, dz: this.dz,
            ql: this.ql, og: this.og, mx: this.mx, fr: this.fr,
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
        return super.getWorkletPluginData(runtimeParameters);
    }

    setParameters(p) {
        const setNumber = (key, min, max) => {
            if (p[key] === undefined || p[key] === null) return;
            const value = typeof p[key] === 'number' ? p[key] : parseFloat(p[key]);
            if (Number.isFinite(value)) this[key] = Math.max(min, Math.min(max, value));
        };
        setNumber('lv', -20, 20);
        setNumber('hf', 6000, 24000);
        setNumber('mb', 50, 1000);
        setNumber('sm', 0, 100);
        setNumber('rd', 60, 146);
        setNumber('rg', 0.1, 100);
        setNumber('dr', 0, 10000);
        setNumber('st', 0, 10000);
        setNumber('sc', 0, 1000);
        setNumber('rs', 5, 25);
        setNumber('rc', 2, 25);
        setNumber('tf', 0.5, 5);
        setNumber('tm', 0.1, 1.5);
        setNumber('cm', 5, 35);
        setNumber('dz', 0.05, 1);
        setNumber('og', -24, 24);
        setNumber('mx', 0, 100);

        if (p.rp !== undefined) {
            const speed = String(p.rp);
            this.rp = speed === '45' || speed === '78' ? speed : '33⅓';
        }
        if (p.sh !== undefined) this.sh = p.sh === 'Spherical' ? 'Spherical' : 'Elliptical';
        if (p.ql !== undefined) {
            this.ql = ['Eco', 'High', 'Ultra'].includes(p.ql) ? p.ql : 'Standard';
        }
        if (p.fr !== undefined) this.fr = p.fr === true || p.fr === 1 || p.fr === 'true';
        if (p.enabled !== undefined) this.enabled = p.enabled !== false;

        if (this.sh === 'Spherical') this.rc = this.rs;
        this.updateParameters();
        this._syncScanRadiusControl();
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
        this.ensureDspTelemetrySubscription?.();
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
                VINYL_SIMULATOR_TAP_PHYSICS,
                this._boundDspVinylTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, VINYL_SIMULATOR_TAP_PHYSICS, this._boundDspVinylTelemetry);
                return false;
            }
            this._dspTelemetryHub = hub;
            this._dspTelemetryTapId = tapId;
            this._dspTelemetryUnsubscribe = unsubscribe;
            return true;
        } catch (error) {
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
            // Ignore stale telemetry subscription cleanup failures.
        }
    }

    parseDspVinylTelemetryFrame(frame) {
        if (frame?.frameType !== VINYL_SIMULATOR_TAP_PHYSICS ||
            frame.formatVersion !== VINYL_SIMULATOR_TELEMETRY_VERSION) {
            return null;
        }
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            typeof payload.getUint32 !== 'function' ||
            payload.byteLength !== VINYL_SIMULATOR_TELEMETRY_BYTES) {
            return null;
        }
        const measurements = {
            forceL: payload.getFloat32(0, true),
            forceR: payload.getFloat32(4, true),
            pressL: payload.getFloat32(8, true),
            pressR: payload.getFloat32(12, true),
            tipVelRms: payload.getFloat32(16, true),
            trkSE_L: payload.getFloat32(20, true),
            trkSE_R: payload.getFloat32(24, true),
            jitterNs: payload.getFloat32(28, true),
            mistrackCount: payload.getUint32(32, true),
            skipCount: payload.getUint32(36, true),
            popCount: payload.getUint32(40, true),
            dustHitCount: payload.getUint32(44, true)
        };
        const scalarKeys = ['forceL', 'forceR', 'pressL', 'pressR', 'tipVelRms', 'trkSE_L', 'trkSE_R', 'jitterNs'];
        if (scalarKeys.some(key => !Number.isFinite(measurements[key]))) return null;
        if (measurements.forceL < 0 || measurements.forceR < 0 ||
            measurements.pressL < 0 || measurements.pressR < 0 || measurements.tipVelRms < 0) {
            return null;
        }
        return measurements;
    }

    handleDspVinylTelemetry(frame) {
        const measurements = this.parseDspVinylTelemetryFrame(frame);
        if (measurements) this._applyPhysicsMeasurements(measurements, true);
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message.type !== 'processBuffer' || message.pluginId !== this.id || !message.measurements) return;
        const measurements = message.measurements;
        const now = performance.now();
        if (measurements.bypass === true) {
            if (!this.bypassSince || this.lastTelemetryAt >= this.bypassSince) this.bypassSince = now;
            this.lastBypassAt = now;
            return;
        }
        if (Number.isFinite(measurements.forceL)) this._applyPhysicsMeasurements(measurements, false);
    }

    _applyPhysicsMeasurements(measurements, fromWasm) {
        const now = performance.now();
        const scalarDt = this.lastScalarAt ? Math.min(1, (now - this.lastScalarAt) / 1000) : 1;
        const scalarAlpha = 1 - Math.exp(-scalarDt / 0.1);
        const scalarKeys = ['forceL', 'forceR', 'pressL', 'pressR', 'tipVelRms', 'trkSE_L', 'trkSE_R', 'jitterNs'];
        for (const key of scalarKeys) {
            if (Number.isFinite(measurements[key])) {
                this.hudValues[key] += scalarAlpha * (measurements[key] - this.hudValues[key]);
            }
        }
        this.lastScalarAt = now;

        const counters = {
            mistrackCount: measurements.mistrackCount >>> 0,
            skipCount: measurements.skipCount >>> 0,
            popCount: measurements.popCount >>> 0,
            dustHitCount: measurements.dustHitCount >>> 0
        };
        if (this.lastCounters && this.lastCounterAt) {
            const dt = (now - this.lastCounterAt) / 1000;
            if (dt > 0 && dt < 10) {
                const rateAlpha = 1 - Math.exp(-dt / 3);
                const mappings = [
                    ['mistrackCount', 'mistrackRate'],
                    ['skipCount', 'skipRate'],
                    ['popCount', 'popRate'],
                    ['dustHitCount', 'dustHitRate']
                ];
                let eventCount = 0;
                for (const [counterKey, rateKey] of mappings) {
                    let difference = (counters[counterKey] - this.lastCounters[counterKey]) >>> 0;
                    if (difference > 0x80000000) difference = 0;
                    eventCount += difference;
                    const rate = difference / dt;
                    this.hudValues[rateKey] += rateAlpha * (rate - this.hudValues[rateKey]);
                }
                if (eventCount > 0) this.eventFlashUntil = now + 180;
            }
        }
        this.lastCounters = counters;
        this.lastCounterAt = now;
        if (fromWasm) {
            this.lastTelemetryAt = now;
            this.bypassSince = 0;
        }
    }

    _createZeroAwareLogControl(label, max, value, setter, unit) {
        const row = document.createElement('div');
        row.className = 'parameter-row';
        const slug = label.toLowerCase().replace(/[^a-z0-9]/g, '');
        const sliderId = `${this.id}-${this.name}-${slug}-slider`;
        const valueId = `${this.id}-${this.name}-${slug}-value`;
        const labelEl = document.createElement('label');
        labelEl.textContent = `${label}${unit ? ` (${unit})` : ''}:`;
        labelEl.htmlFor = sliderId;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = 0;
        slider.max = 1000;
        slider.step = 1;
        slider.autocomplete = 'off';

        const number = document.createElement('input');
        number.type = 'number';
        number.id = valueId;
        number.name = valueId;
        number.min = 0;
        number.max = max;
        number.step = 0.01;
        number.autocomplete = 'off';

        const floor = 0.001;
        const toSlider = current => current <= 0 ? 0 : 1 + 999 * Math.log(current / floor) / Math.log(max / floor);
        const fromSlider = position => position <= 0 ? 0 : floor * Math.pow(max / floor, (position - 1) / 999);
        const sync = current => {
            slider.value = Math.max(0, Math.min(1000, toSlider(current)));
            number.value = current === 0 ? '0' : Number(current.toPrecision(4)).toString();
        };
        sync(value);
        slider.addEventListener('input', event => {
            const next = fromSlider(parseFloat(event.target.value));
            setter(next);
            sync(next);
        });
        number.addEventListener('change', event => {
            const parsed = parseFloat(event.target.value);
            const next = Number.isFinite(parsed) ? Math.max(0, Math.min(max, parsed)) : 0;
            setter(next);
            sync(next);
        });

        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(number);
        return row;
    }

    _syncScanRadiusControl() {
        if (!this.scanRadiusRow) return;
        const disabled = this.sh === 'Spherical';
        const slider = this.scanRadiusRow.querySelector('input[type="range"]');
        const number = this.scanRadiusRow.querySelector('input[type="number"]');
        if (slider) {
            slider.disabled = disabled;
            slider.value = this.rc;
            window.uiManager?.refreshRangeFillStyling?.(slider);
        }
        if (number) { number.disabled = disabled; number.value = this.rc; }
        this.scanRadiusRow.classList.toggle('parameter-disabled', disabled);
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        this.stopAnimation();
        this.hudCreatedAt = performance.now();
        this.hudVisible = true;
        this.hudStatusElement = null;
        this.lastHudStatusMode = null;
        this.hudObserver?.disconnect();
        this.hudGraphDispose?.();
        this.hudGraphDispose = null;

        const container = document.createElement('div');
        this.instanceId = `vinyl-simulator-${Date.now()}-${++vinylSimulatorInstanceSerial}`;
        container.className = 'vinyl-simulator-container';
        container.setAttribute('data-instance-id', this.instanceId);

        const panel = document.createElement('div');
        panel.className = 'vinyl-simulator-panel';
        const tabs = document.createElement('div');
        tabs.className = 'vinyl-simulator-tabs';
        tabs.setAttribute('role', 'tablist');
        const contents = document.createElement('div');
        contents.className = 'vinyl-simulator-tab-contents';

        const definitions = [
            {
                id: 'cutting', label: 'Cutting', create: content => {
                    content.appendChild(this.createParameterControl('Cut Level', -20, 20, 0.1, this.lv, v => this.setParameters({ lv: v }), 'dB'));
                    content.appendChild(this.createParameterControl('HF Cutoff', 6000, 24000, 100, this.hf, v => this.setParameters({ hf: v }), 'Hz'));
                    content.appendChild(this.createParameterControl('Bass Mono Below', 50, 1000, 1, this.mb, v => this.setParameters({ mb: v }), 'Hz'));
                    content.appendChild(this.createParameterControl('Side Mix', 0, 100, 1, this.sm, v => this.setParameters({ sm: v }), '%'));
                }
            },
            {
                id: 'record', label: 'Record', create: content => {
                    content.appendChild(this.createRadioGroup('Speed', ['33⅓', '45', '78'], this.rp, v => this.setParameters({ rp: v })));
                    content.appendChild(this.createParameterControl('Radius', 60, 146, 1, this.rd, v => this.setParameters({ rd: v }), 'mm'));
                    content.appendChild(this.createLogarithmicParameterControl('Roughness', 0.1, 100, 0.01, this.rg, v => this.setParameters({ rg: v }), 'nm'));
                    content.appendChild(this._createZeroAwareLogControl('Dust', 10000, this.dr, v => this.setParameters({ dr: v }), '/s'));
                    content.appendChild(this._createZeroAwareLogControl('Static', 10000, this.st, v => this.setParameters({ st: v }), '/s'));
                    content.appendChild(this._createZeroAwareLogControl('Scratch', 1000, this.sc, v => this.setParameters({ sc: v }), '/s'));
                }
            },
            {
                id: 'stylus', label: 'Stylus', create: content => {
                    content.appendChild(this.createRadioGroup('Shape', ['Spherical', 'Elliptical'], this.sh, v => this.setParameters({ sh: v })));
                    content.appendChild(this.createParameterControl('Side Radius', 5, 25, 0.1, this.rs, v => this.setParameters({ rs: v }), 'µm'));
                    this.scanRadiusRow = this.createParameterControl('Scan Radius', 2, 25, 0.1, this.rc, v => this.setParameters({ rc: v }), 'µm');
                    content.appendChild(this.scanRadiusRow);
                    content.appendChild(this.createParameterControl('Tracking Force', 0.5, 5, 0.1, this.tf, v => this.setParameters({ tf: v }), 'g'));
                    content.appendChild(this.createParameterControl('Tip Mass', 0.1, 1.5, 0.01, this.tm, v => this.setParameters({ tm: v }), 'mg'));
                    content.appendChild(this.createParameterControl('Compliance', 5, 35, 0.1, this.cm, v => this.setParameters({ cm: v }), 'cu'));
                    content.appendChild(this.createParameterControl('Damping', 0.05, 1, 0.01, this.dz, v => this.setParameters({ dz: v }), 'ζ'));
                }
            },
            {
                id: 'output', label: 'Output', create: content => {
                    content.appendChild(this.createRadioGroup('Quality', ['Eco', 'Standard', 'High', 'Ultra'], this.ql, v => this.setParameters({ ql: v })));
                    content.appendChild(this.createParameterControl('Output Gain', -24, 24, 0.1, this.og, v => this.setParameters({ og: v }), 'dB'));
                    content.appendChild(this.createParameterControl('Mix', 0, 100, 1, this.mx, v => this.setParameters({ mx: v }), '%'));
                }
            }
        ];

        for (const definition of definitions) {
            const active = definition.id === this.selectedTab;
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = `vinyl-simulator-tab ${active ? 'active' : ''}`;
            tab.textContent = definition.label;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', active ? 'true' : 'false');
            tab.setAttribute('data-tab', definition.id);

            const content = document.createElement('div');
            content.className = `vinyl-simulator-tab-content plugin-parameter-ui ${active ? 'active' : ''}`;
            content.setAttribute('role', 'tabpanel');
            content.setAttribute('data-tab', definition.id);
            definition.create(content);

            tab.addEventListener('click', () => {
                const scope = document.querySelector(`[data-instance-id="${this.instanceId}"]`);
                if (!scope) return;
                scope.querySelectorAll('.vinyl-simulator-tab').forEach(item => {
                    const selected = item === tab;
                    item.classList.toggle('active', selected);
                    item.setAttribute('aria-selected', selected ? 'true' : 'false');
                });
                scope.querySelectorAll('.vinyl-simulator-tab-content').forEach(item => {
                    item.classList.toggle('active', item === content);
                });
                this.selectedTab = definition.id;
                this.drawHud();
            });
            tabs.appendChild(tab);
            contents.appendChild(content);
        }

        panel.appendChild(tabs);
        panel.appendChild(contents);
        container.appendChild(panel);

        const graph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '7 / 1',
            mobileAspectRatio: '3 / 1',
            className: 'vinyl-simulator-hud',
            onResize: () => this.drawHud()
        });
        this.hudGraphDispose = graph.dispose;
        this.hudCanvas = graph.canvas;
        this.hudCanvas.setAttribute('aria-label', 'Vinyl playback physics status');
        container.appendChild(graph.container);
        graph.resize();

        const note = document.createElement('div');
        note.className = 'vinyl-simulator-status-note';
        note.setAttribute('role', 'status');
        note.setAttribute('aria-live', 'polite');
        note.setAttribute('aria-atomic', 'true');
        this.hudStatusElement = note;
        this._updateHudStatus(this._hudMode(performance.now()));
        container.appendChild(note);

        this._syncScanRadiusControl();
        if (typeof IntersectionObserver === 'function') {
            this.hudObserver = new IntersectionObserver(entries => {
                this.hudVisible = entries.some(entry => entry.isIntersecting);
                if (this.hudVisible) this.startAnimation();
                else this.stopAnimation();
            });
            this.hudObserver.observe(this.hudCanvas);
        }
        this.startAnimation();
        return container;
    }

    startAnimation() {
        if (!this.hudVisible || this.animationFrameId) return;
        const animate = () => {
            this.drawHud();
            this.animationFrameId = this.requestPowerAnimationFrame(animate);
        };
        this.animationFrameId = this.requestPowerAnimationFrame(animate);
    }

    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    _hudMode(now) {
        const gateMode = this._hudGateMode();
        if (gateMode !== 'ready') return gateMode;
        if (this.lastTelemetryAt > 0 && now - this.lastTelemetryAt < 1200) return 'active';
        if (now - this.hudCreatedAt < 1500) return 'loading';
        if (now - this.lastBypassAt < 700 && this.bypassSince && now - this.bypassSince >= 350) return 'bypass';
        return 'idle';
    }

    _updateHudStatus(mode) {
        if (!this.hudStatusElement || mode === this.lastHudStatusMode) return;
        const messages = {
            disabled: 'Effect is off.',
            paused: 'The physics display is paused while its section or visual display is inactive.',
            loading: 'Initializing the record simulation. Audio remains unchanged until the WASM engine is ready.',
            idle: 'Waiting for audio. Start playback to view the physical simulation.',
            bypass: 'WASM is required. The effect is bypassed because its simulation engine is unavailable.',
            active: 'WASM is active. The physics display updates while audio is playing.'
        };
        this.hudStatusElement.textContent = messages[mode];
        this.lastHudStatusMode = mode;
    }

    drawHud() {
        const canvas = this.hudCanvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const width = canvas.width;
        const height = canvas.height;
        const rect = canvas.getBoundingClientRect?.();
        const cssWidth = canvas.clientWidth || rect?.width || width || 1;
        const dpr = width / cssWidth;
        const now = performance.now();
        const mode = this._hudMode(now);
        this._updateHudStatus(mode);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#171717';
        ctx.fillRect(0, 0, width, height);

        if (mode !== 'active') {
            const messages = {
                disabled: ['Effect is off', 'Turn it on to resume the physical simulation.'],
                paused: ['Physics display paused', 'Turn the Section and visual display back on to resume.'],
                loading: ['Initializing the record simulation…', 'Audio remains unchanged until the WASM engine is ready.'],
                idle: ['Waiting for audio', 'Start playback to view contact force and tracking.'],
                bypass: ['WASM is required', 'This effect is bypassed because its simulation engine is unavailable.']
            };
            const [title, detail] = messages[mode];
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = mode === 'bypass' ? '#ffbf69' : '#ddd';
            ctx.font = `600 ${Math.round(14 * dpr)}px Arial`;
            ctx.fillText(title, width / 2, height * 0.42);
            ctx.fillStyle = '#999';
            ctx.font = `${Math.round(11 * dpr)}px Arial`;
            ctx.fillText(detail, width / 2, height * 0.65);
            return;
        }

        const values = this.hudValues;
        const narrow = cssWidth < 560;
        const padding = 6 * dpr;
        const gap = 5 * dpr;
        const columns = narrow ? 2 : 4;
        const cardWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
        const rows = narrow ? 3 : 2;
        const cardHeight = (height - padding * 2 - gap * (rows - 1)) / rows;
        const related = {
            cutting: new Set(['tip']),
            record: new Set(['events']),
            stylus: new Set(['force', 'pressure', 'tracking', 'jitter']),
            output: new Set(['tip', 'tracking'])
        }[this.selectedTab] || new Set();

        const clamp01 = value => value < 0 ? 0 : (value > 1 ? 1 : value);
        const jitterMagnitude = values.jitterNs < 0 ? -values.jitterNs : values.jitterNs;
        const cards = [
            { key: 'force', title: 'CONTACT FORCE', value: `${(values.forceL * 1000).toFixed(1)} / ${(values.forceR * 1000).toFixed(1)} mN`, level: Math.max(values.forceL, values.forceR) / 0.03 },
            { key: 'pressure', title: 'CONTACT PRESSURE', value: `${(Math.max(values.pressL, values.pressR) / 1e9).toFixed(2)} GPa`, level: Math.max(values.pressL, values.pressR) / 1e9 },
            { key: 'tip', title: 'TIP VELOCITY', value: `${(values.tipVelRms * 100).toFixed(2)} cm/s  ${(20 * Math.log10(values.tipVelRms / 0.05 + 1e-12)).toFixed(1)} dB`, level: values.tipVelRms / 0.1 },
            { key: 'tracking', title: 'TRACKING S/E', value: `${values.trkSE_L.toFixed(1)} / ${values.trkSE_R.toFixed(1)} dB`, level: (Math.min(values.trkSE_L, values.trkSE_R) - 20) / 60 },
            { key: 'jitter', title: 'READING JITTER', value: `${jitterMagnitude.toFixed(1)} ns`, level: jitterMagnitude / READING_JITTER_BAR_MAX_NS },
            { key: 'events', title: 'EVENTS / SECOND', value: `mistrack ${values.mistrackRate.toFixed(1)}  skip ${values.skipRate.toFixed(1)}  pop ${values.popRate.toFixed(1)}  dust ${values.dustHitRate.toFixed(1)}`, level: Math.max(values.mistrackRate, values.skipRate, values.popRate, values.dustHitRate) / 10 }
        ];
        if (this.selectedTab !== 'stylus') cards.splice(4, 1);

        cards.forEach((card, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const x = padding + column * (cardWidth + gap);
            const y = padding + row * (cardHeight + gap);
            const highlighted = related.has(card.key);
            ctx.fillStyle = highlighted ? '#293844' : '#222';
            ctx.fillRect(x, y, cardWidth, cardHeight);
            ctx.strokeStyle = highlighted ? '#72bce8' : '#3c3c3c';
            ctx.lineWidth = highlighted ? 1.5 * dpr : dpr;
            ctx.strokeRect(x + 0.5 * dpr, y + 0.5 * dpr, cardWidth - dpr, cardHeight - dpr);

            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillStyle = highlighted ? '#bce6ff' : '#999';
            ctx.font = `600 ${Math.round(9 * dpr)}px Arial`;
            ctx.fillText(card.title, x + 6 * dpr, y + 5 * dpr);
            if (index === 0) {
                ctx.textAlign = 'right';
                ctx.fillStyle = '#78c98a';
                ctx.fillText('WASM ACTIVE', x + cardWidth - 6 * dpr, y + 5 * dpr);
                ctx.textAlign = 'left';
            }
            ctx.fillStyle = '#f0f0f0';
            ctx.font = `${Math.round((narrow && card.key === 'events' ? 9 : 11) * dpr)}px Arial`;
            ctx.fillText(card.value, x + 6 * dpr, y + 19 * dpr, cardWidth - 12 * dpr);

            const barX = x + 6 * dpr;
            const barY = y + cardHeight - 9 * dpr;
            const barWidth = cardWidth - 12 * dpr;
            ctx.fillStyle = '#363636';
            ctx.fillRect(barX, barY, barWidth, 4 * dpr);
            ctx.fillStyle = card.key === 'events' && now < this.eventFlashUntil ? '#ffb347' : (highlighted ? '#69c8ff' : '#72b97c');
            ctx.fillRect(barX, barY, barWidth * clamp01(card.level), 4 * dpr);
        });
    }

    cleanup() {
        this.disposeDspTelemetrySubscription();
        this.stopAnimation();
        this.hudObserver?.disconnect();
        this.hudObserver = null;
        this.hudGraphDispose?.();
        this.hudGraphDispose = null;
        this.hudStatusElement = null;
        this.lastHudStatusMode = null;
        this.hudCanvas = null;
        super.cleanup();
    }
}

window.VinylSimulatorPlugin = VinylSimulatorPlugin;
