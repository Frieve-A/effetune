---
layout: dsp
title: "EffeTune DSP effects"
description: "Browse every semantic effect type in the EffeTune DSP binding catalog."
lang: en
permalink: /dsp/effects/
---
# Effects

Browse all 92 semantic types registered in the v1 binding catalog. The list remains readable without JavaScript.

<label for="effect-filter">Filter effects</label>
<input id="effect-filter" type="search" placeholder="Name, type, category, seeded, or asset" data-dsp-effect-filter>
<p role="status" aria-live="polite" data-dsp-effect-count></p>

## Analyzers

- [Level Meter](/dsp/effects/level-meter/) (`LevelMeter`) — Passes audio through while the host-side EffeTune app can display peak and RMS levels. <span data-effect-tags="analyzer  "></span>
- [Oscilloscope](/dsp/effects/oscilloscope/) (`Oscilloscope`) — Passes audio through while the host-side EffeTune app can display its waveform. <span data-effect-tags="analyzer  "></span>
- [Spectrogram](/dsp/effects/spectrogram/) (`Spectrogram`) — Passes audio through while the host-side EffeTune app can display frequency content over time. <span data-effect-tags="analyzer  "></span>
- [Spectrum Analyzer](/dsp/effects/spectrum-analyzer/) (`SpectrumAnalyzer`) — Passes audio through while the host-side EffeTune app can display its frequency spectrum. <span data-effect-tags="analyzer  "></span>
- [Stereo Meter](/dsp/effects/stereo-meter/) (`StereoMeter`) — Passes audio through while the host-side EffeTune app can display stereo level and phase relationships. <span data-effect-tags="analyzer  "></span>

## Basics

- [Channel Divider](/dsp/effects/channel-divider/) (`ChannelDivider`) — Routes an input channel into selected output channels according to its semantic parameters. <span data-effect-tags="basics  "></span>
- [DC Offset](/dsp/effects/dc-offset/) (`DCOffset`) — Adds a controllable constant offset to the signal. <span data-effect-tags="basics  "></span>
- [FIR Crossover](/dsp/effects/fir-crossover/) (`FIRCrossover`) — Applies an externally prepared FIR crossover impulse response. <span data-effect-tags="basics seeded asset"></span>
- [Matrix](/dsp/effects/matrix/) (`Matrix`) — Mixes input channels into output channels using an explicit routing matrix. <span data-effect-tags="basics  "></span>
- [Multi Channel Panel](/dsp/effects/multi-channel-panel/) (`MultiChannelPanel`) — Applies per-channel gain, mute, solo, and delay controls to multichannel audio. <span data-effect-tags="basics  "></span>
- [Mute](/dsp/effects/mute/) (`Mute`) — Silences the selected channels. <span data-effect-tags="basics  "></span>
- [Polarity Inversion](/dsp/effects/polarity-inversion/) (`PolarityInversion`) — Inverts the polarity of the selected channels. <span data-effect-tags="basics  "></span>
- [Stereo Balance](/dsp/effects/stereo-balance/) (`StereoBalance`) — Adjusts the relative level of the left and right channels. <span data-effect-tags="basics  "></span>
- [Volume](/dsp/effects/volume/) (`Volume`) — Applies a precise gain in decibels. <span data-effect-tags="basics  "></span>

## Delay

- [Delay](/dsp/effects/delay/) (`Delay`) — Adds a delayed signal with controllable feedback and mix. <span data-effect-tags="delay  "></span>
- [Time Alignment](/dsp/effects/time-alignment/) (`TimeAlignment`) — Delays selected channels to align arrival times. <span data-effect-tags="delay  "></span>

## Dynamics

- [Auto Leveler](/dsp/effects/auto-leveler/) (`AutoLeveler`) — Adjusts gain gradually toward a configured target level. <span data-effect-tags="dynamics  "></span>
- [Brickwall Limiter](/dsp/effects/brickwall-limiter/) (`BrickwallLimiter`) — Restricts peaks to a configured ceiling with look-ahead limiting. <span data-effect-tags="dynamics  "></span>
- [Compressor](/dsp/effects/compressor/) (`Compressor`) — Reduces dynamic range above a configurable threshold. <span data-effect-tags="dynamics  "></span>
- [Expander](/dsp/effects/expander/) (`Expander`) — Increases dynamic contrast below a configurable threshold. <span data-effect-tags="dynamics  "></span>
- [Gate](/dsp/effects/gate/) (`Gate`) — Attenuates signals below a configurable threshold. <span data-effect-tags="dynamics  "></span>
- [Multiband Compressor](/dsp/effects/multiband-compressor/) (`MultibandCompressor`) — Applies independent compression to multiple frequency bands. <span data-effect-tags="dynamics  "></span>
- [Multiband Expander](/dsp/effects/multiband-expander/) (`MultibandExpander`) — Applies independent expansion to multiple frequency bands. <span data-effect-tags="dynamics  "></span>
- [Multiband Transient](/dsp/effects/multiband-transient/) (`MultibandTransient`) — Shapes transient and sustain energy independently across frequency bands. <span data-effect-tags="dynamics  "></span>
- [Power Amp Sag](/dsp/effects/power-amp-sag/) (`PowerAmpSag`) — Models level-dependent power-supply sag and recovery. <span data-effect-tags="dynamics  "></span>
- [Transient Shaper](/dsp/effects/transient-shaper/) (`TransientShaper`) — Adjusts attack and sustain without using a fixed threshold. <span data-effect-tags="dynamics  "></span>

## Equalizers and filters

- [Band Pass Filter](/dsp/effects/band-pass-filter/) (`BandPassFilter`) — Retains a configurable frequency band while attenuating frequencies outside it. <span data-effect-tags="eq  "></span>
- [Comb Filter](/dsp/effects/comb-filter/) (`CombFilter`) — Creates regularly spaced spectral notches and peaks with a short delay. <span data-effect-tags="eq  "></span>
- [Earphone Cable Sim](/dsp/effects/earphone-cable-sim/) (`EarphoneCableSim`) — Models the frequency response caused by earphone cable impedance. <span data-effect-tags="eq  "></span>
- [15Band GEQ](/dsp/effects/fifteen-band-geq/) (`FifteenBandGEQ`) — Provides fifteen fixed-frequency graphic equalizer bands. <span data-effect-tags="eq  "></span>
- [15Band PEQ](/dsp/effects/fifteen-band-peq/) (`FifteenBandPEQ`) — Provides fifteen configurable parametric equalizer bands. <span data-effect-tags="eq  "></span>
- [5Band Dynamic EQ](/dsp/effects/five-band-dynamic-eq/) (`FiveBandDynamicEQ`) — Applies level-dependent equalization in five configurable bands. <span data-effect-tags="eq  "></span>
- [5Band FIR PEQ](/dsp/effects/five-band-firpeq/) (`FiveBandFIRPEQ`) — Applies an externally prepared FIR response for five-band equalization. <span data-effect-tags="eq seeded asset"></span>
- [5Band PEQ](/dsp/effects/five-band-peq/) (`FiveBandPEQ`) — Provides five configurable parametric equalizer bands. <span data-effect-tags="eq  "></span>
- [Group Delay EQ](/dsp/effects/group-delay-eq/) (`GroupDelayEQ`) — Applies an externally prepared FIR response to adjust group delay. <span data-effect-tags="eq seeded asset"></span>
- [Group Delay PEQ](/dsp/effects/group-delay-peq/) (`GroupDelayPEQ`) — Applies an externally prepared FIR response for five-band parametric group-delay adjustment. <span data-effect-tags="eq seeded asset"></span>
- [Hi Pass Filter](/dsp/effects/hi-pass-filter/) (`HiPassFilter`) — Attenuates frequencies below a configurable cutoff. <span data-effect-tags="eq  "></span>
- [Lo Pass Filter](/dsp/effects/lo-pass-filter/) (`LoPassFilter`) — Attenuates frequencies above a configurable cutoff. <span data-effect-tags="eq  "></span>
- [Loudness Equalizer](/dsp/effects/loudness-equalizer/) (`LoudnessEqualizer`) — Applies level-dependent frequency compensation based on equal-loudness behavior. <span data-effect-tags="eq  "></span>
- [Narrow Range](/dsp/effects/narrow-range/) (`NarrowRange`) — Restricts audio to a configurable frequency range. <span data-effect-tags="eq  "></span>
- [Room EQ](/dsp/effects/room-eq/) (`RoomEQ`) — Applies an externally prepared room-correction impulse response. <span data-effect-tags="eq seeded asset"></span>
- [Tilt EQ](/dsp/effects/tilt-eq/) (`TiltEQ`) — Tilts the tonal balance around a configurable pivot frequency. <span data-effect-tags="eq  "></span>
- [Tone Control](/dsp/effects/tone-control/) (`ToneControl`) — Adjusts bass, midrange, and treble with broad tone-control curves. <span data-effect-tags="eq  "></span>

## Lo-fi and simulation

- [AM Radio Simulator](/dsp/effects/am-radio-simulator/) (`AMRadioSimulator`) — Models bandwidth, distortion, interference, and noise associated with AM radio. <span data-effect-tags="lo-fi seeded "></span>
- [Bit Crusher](/dsp/effects/bit-crusher/) (`BitCrusher`) — Reduces amplitude resolution and sample-rate fidelity for digital quantization effects. <span data-effect-tags="lo-fi seeded "></span>
- [SBC Codec Simulator](/dsp/effects/bluetooth-sbc-simulator/) (`BluetoothSBCSimulator`) — Models Bluetooth SBC audio coding with bitpool, channel-mode, and seeded packet-loss behavior. <span data-effect-tags="lo-fi seeded "></span>
- [Cassette Artifacts](/dsp/effects/cassette-artifacts/) (`CassetteArtifacts`) — Models the record and reproduce chain of a compact-cassette deck, including Dolby B/C, saturation, wow and flutter, hiss, dropouts, and azimuth error. <span data-effect-tags="lo-fi seeded "></span>
- [Digital Error Emulator](/dsp/effects/digital-error-emulator/) (`DigitalErrorEmulator`) — Introduces deterministic seeded digital transmission errors at a controlled rate. <span data-effect-tags="lo-fi seeded "></span>
- [DSD64 IMD Simulator](/dsp/effects/dsd64-imd-simulator/) (`DSD64IMDSimulator`) — Models ultrasonic-noise intermodulation artifacts associated with DSD64 playback. <span data-effect-tags="lo-fi  "></span>
- [FM Radio Simulator](/dsp/effects/fm-radio-simulator/) (`FMRadioSimulator`) — Models bandwidth, stereo behavior, distortion, and noise associated with FM radio. <span data-effect-tags="lo-fi seeded "></span>
- [G.726 Simulator](/dsp/effects/g726-adpcm-simulator/) (`G726ADPCMSimulator`) — Models G.726 ADPCM speech coding from 16 to 40 kbit/s with seeded radio bit errors. <span data-effect-tags="lo-fi seeded "></span>
- [GSM-FR Simulator](/dsp/effects/gsm-full-rate-simulator/) (`GSMFullRateSimulator`) — Models GSM full-rate speech coding with repeated transcoding and seeded carrier interference. <span data-effect-tags="lo-fi seeded "></span>
- [Hum Generator](/dsp/effects/hum-generator/) (`HumGenerator`) — Adds power-line hum and harmonics at controlled levels. <span data-effect-tags="lo-fi  "></span>
- [MD Simulator](/dsp/effects/md-simulator/) (`MDSimulator`) — Models MiniDisc ATRAC encode and decode artifacts across the SP, LP2, and LP4 recording modes. <span data-effect-tags="lo-fi  "></span>
- [MP3 Codec Simulator](/dsp/effects/mp3-codec-simulator/) (`MP3CodecSimulator`) — Models MP3 perceptual audio coding artifacts across bitrates, stereo modes, and reservoir use. <span data-effect-tags="lo-fi  "></span>
- [Noise Blender](/dsp/effects/noise-blender/) (`NoiseBlender`) — Adds a configurable blend of generated noise colors. <span data-effect-tags="lo-fi seeded "></span>
- [Simple Jitter](/dsp/effects/simple-jitter/) (`SimpleJitter`) — Applies deterministic seeded sampling-time jitter. <span data-effect-tags="lo-fi seeded "></span>
- [SW Radio Simulator](/dsp/effects/sw-radio-simulator/) (`SWRadioSimulator`) — Models fading, interference, limited bandwidth, and noise associated with shortwave radio. <span data-effect-tags="lo-fi seeded "></span>
- [Tape Artifacts](/dsp/effects/tape-artifacts/) (`TapeArtifacts`) — Models the record and reproduce chain of a reel-to-reel tape machine, including saturation, wow and flutter, hiss, and head response. <span data-effect-tags="lo-fi seeded "></span>
- [Vinyl Artifacts](/dsp/effects/vinyl-artifacts/) (`VinylArtifacts`) — Adds deterministic seeded clicks, crackle, and surface artifacts. <span data-effect-tags="lo-fi seeded "></span>
- [Vinyl Simulator](/dsp/effects/vinyl-simulator/) (`VinylSimulator`) — Combines tonal, mechanical, and surface-noise behavior associated with vinyl playback. <span data-effect-tags="lo-fi seeded "></span>

## Modulation

- [Auto Filter](/dsp/effects/auto-filter/) (`AutoFilter`) — Provides Auto Filter sweeps, Envelope Filter response, and Auto Wah movement with a resonant state-variable filter. <span data-effect-tags="modulation  "></span>
- [Auto Pan](/dsp/effects/auto-pan/) (`AutoPan`) — Creates Auto Pan movement by applying periodic complementary gain changes within each stereo pair. <span data-effect-tags="modulation  "></span>
- [Chorus](/dsp/effects/chorus/) (`Chorus`) — Creates Chorus, Stereo Chorus, Ensemble, Flanger, or Vibrato effects with interpolated moving delay voices. <span data-effect-tags="modulation  "></span>
- [Doppler Distortion](/dsp/effects/doppler-distortion/) (`DopplerDistortion`) — Modulates delay to model pitch movement caused by changing distance. <span data-effect-tags="modulation  "></span>
- [Frequency Shifter](/dsp/effects/frequency-shifter/) (`FrequencyShifter`) — Provides Frequency Shifter, Ring Modulator, or Barber-pole Frequency Shifter processing with analytic-signal translation or direct multiplication. <span data-effect-tags="modulation  "></span>
- [Phaser](/dsp/effects/phaser/) (`Phaser`) — Creates moving peaks and notches as a classic Phaser or Barber-pole Phaser with all-pass sweeps. <span data-effect-tags="modulation  "></span>
- [Pitch Shifter](/dsp/effects/pitch-shifter/) (`PitchShifter`) — Shifts pitch while retaining the input duration. <span data-effect-tags="modulation  "></span>
- [Rotary Speaker](/dsp/effects/rotary-speaker/) (`RotarySpeaker`) — Creates Rotary Speaker motion, commonly known as a Leslie effect, by combining crossover-separated horn and drum amplitude and Doppler movement. <span data-effect-tags="modulation  "></span>
- [Tremolo](/dsp/effects/tremolo/) (`Tremolo`) — Modulates amplitude periodically at a configurable rate and depth. <span data-effect-tags="modulation seeded "></span>
- [Wow Flutter](/dsp/effects/wow-flutter/) (`WowFlutter`) — Applies slow and fast pitch variation associated with imperfect mechanical playback. <span data-effect-tags="modulation seeded "></span>

## Resonators

- [Horn Resonator](/dsp/effects/horn-resonator/) (`HornResonator`) — Applies a horn-like resonant response to the input. <span data-effect-tags="resonator  "></span>
- [Horn Resonator Plus](/dsp/effects/horn-resonator-plus/) (`HornResonatorPlus`) — Applies an extended multi-mode horn-like resonant response. <span data-effect-tags="resonator  "></span>
- [Modal Resonator](/dsp/effects/modal-resonator/) (`ModalResonator`) — Excites configurable resonant modes from the input signal. <span data-effect-tags="resonator  "></span>

## Reverb

- [Dattorro Plate Reverb](/dsp/effects/dattorro-plate-reverb/) (`DattorroPlateReverb`) — Creates a plate-style reverberation using a Dattorro-inspired network. <span data-effect-tags="reverb  "></span>
- [FDN Reverb](/dsp/effects/fdn-reverb/) (`FDNReverb`) — Creates reverberation with a feedback delay network. <span data-effect-tags="reverb seeded "></span>
- [IR Reverb](/dsp/effects/ir-reverb/) (`IRReverb`) — Convolves audio with a caller-supplied impulse response. <span data-effect-tags="reverb seeded asset"></span>
- [RS Reverb](/dsp/effects/rs-reverb/) (`RSReverb`) — Creates algorithmic reverberation with configurable room and decay behavior. <span data-effect-tags="reverb seeded "></span>

## Saturation

- [Dynamic Saturation](/dsp/effects/dynamic-saturation/) (`DynamicSaturation`) — Applies saturation whose drive responds to the input level. <span data-effect-tags="saturation  "></span>
- [Exciter](/dsp/effects/exciter/) (`Exciter`) — Generates controlled high-frequency harmonics to emphasize detail. <span data-effect-tags="saturation  "></span>
- [Hard Clipping](/dsp/effects/hard-clipping/) (`HardClipping`) — Limits waveform amplitude abruptly at a configurable threshold. <span data-effect-tags="saturation  "></span>
- [Harmonic Distortion](/dsp/effects/harmonic-distortion/) (`HarmonicDistortion`) — Adds configurable harmonic components derived from the input. <span data-effect-tags="saturation  "></span>
- [Multiband Saturation](/dsp/effects/multiband-saturation/) (`MultibandSaturation`) — Applies independent saturation to multiple frequency bands. <span data-effect-tags="saturation  "></span>
- [Saturation](/dsp/effects/saturation/) (`Saturation`) — Applies smooth nonlinear distortion with controllable drive and mix. <span data-effect-tags="saturation  "></span>
- [Sub Synth](/dsp/effects/sub-synth/) (`SubSynth`) — Derives low-frequency harmonic content from the input signal. <span data-effect-tags="saturation  "></span>
- [Tube Simulator](/dsp/effects/tube-simulator/) (`TubeSimulator`) — Models vacuum-tube preamplifier and power-stage saturation with supply and speaker-load interaction. <span data-effect-tags="saturation  "></span>

## Spatial

- [Crossfeed Filter](/dsp/effects/crossfeed-filter/) (`CrossfeedFilter`) — Feeds a filtered portion of each stereo channel into the opposite channel. <span data-effect-tags="spatial  "></span>
- [MS Matrix](/dsp/effects/ms-matrix/) (`MSMatrix`) — Encodes, decodes, or adjusts mid-side stereo components. <span data-effect-tags="spatial  "></span>
- [Multiband Balance](/dsp/effects/multiband-balance/) (`MultibandBalance`) — Adjusts left-right balance independently across frequency bands. <span data-effect-tags="spatial  "></span>
- [Phase Select EQ](/dsp/effects/phase-select-eq/) (`PhaseSelectEQ`) — Applies gain only where frequency, absolute stereo phase difference, and left/right Balance fall within configured regions. <span data-effect-tags="spatial  "></span>
- [Stereo Blend](/dsp/effects/stereo-blend/) (`StereoBlend`) — Blends stereo channels to adjust width and channel separation. <span data-effect-tags="spatial  "></span>

## Others

- [Oscillator](/dsp/effects/oscillator/) (`Oscillator`) — Generates a periodic test tone without requiring an input signal. <span data-effect-tags="others seeded "></span>
