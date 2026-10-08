# Rhythm Analyzer numerical tools

These developer tools maintain the frozen T48M export and ordered production
reference. They have no research-directory imports and perform no training or
model selection. Python needs NumPy, Numba, SciPy; checkpoint/table export also
needs PyTorch, native audio evaluation needs SoundFile, and dev scoring needs
mir_eval. Run `python -B tools/rhythm-analyzer/test_reference.py` for the focused
arithmetic checks.

`export.py --checkpoint <trusted-checkpoint> --out <output-directory>
--window-device cuda --clang-format <compatible-clang-format>` regenerates the
266,494-byte model, DSP weight/table header candidates, provenance and reference
tables. The frozen checkpoint is seed 0, step 17500. The binary SHA-256 must be
`98219a84553a0a365dc8a5c6b5325cad3cd2ef2d6cdf80dcaaebc12e97948f5d`.
The deployed tables use PyTorch 2.5.1+cu124 CUDA non-periodic Hann coefficients
and SciPy 1.15.2 FIR coefficients. Formatting precedes header hashing. `--model`
can replace `--checkpoint` when the existing binary is available.

`reference.py --audio <mono-24k-float32.npy> --model <model.bin> --frontend
<frontend.npz> --out <checkpoint.npz>` writes a numerical checkpoint. Alternative
inputs are `--features <float32.npy>` or `--activations <npz>` containing
`activations[ticks,2]` and `tempo[ticks,61]`. `--dp-precision 64` checks the
float32 Viterbi choice against double state. The frontend consumes the
delay-compensated 24 kHz beat grid; host resampling and cold-silence lifecycle
are verified through the native driver separately. A supplied hard mask closes
the gate and resets its two EMAs; it does not apply the native cold reset.

Arithmetic is scalar and ordered: bias, input channel ascending, convolution
tap ascending, with separate float32 multiply and add. Numba fastmath is off.
Every layer writes integer-RNE binary16 inputs, including the current tick;
half subnormals decode to normal float32 values. Residuals and ELU stay float32.
ELU, sigmoid and the double tempo-softmax reduction use the DSP portable math;
tempo probabilities round to float32 then binary16 at the DBN boundary. The
frontend uses float32 window multiplication, the portable double real FFT,
float32 magnitudes and sequential filter sums, and portable log compression.
The DBN uses double tables/posteriors and state-order sums; Viterbi rounds each
log table, observation, prior, add and max subtraction to float32. First-index
ties, 94-tick lag/block, immutable commits and EOF region closure follow the
frozen decoder. Time calculations remain double, with `dt=256/24000` and
`t0=dt-1024/(2*24000)`.

`evaluate.py --manifest <private-dev.json> --model <model.bin> --frontend
<frontend.npz> --out <private-results> --budget-seconds 480` evaluates complete
dev excerpts with resumable per-excerpt results. The JSON manifest contains an
`excerpts` array of `dataset`, `audio_path`, `offset_samples`, `samples`,
`duration`, and excerpt-relative `beats`. PCM is cached mono little-endian
int16 at 24 kHz, divided by 32767. The scorer uses the frozen five-second trim,
F70 and continuity definitions, track means within each dataset and equal
dataset means. A new reference revision requires a fresh output directory.
Evaluation saves scores and beat events only; use `reference.py` for detailed
activation and ring checkpoints.

`run_native.py --driver <rhythm-eval> --lists <private-frozen-lists> --out
<private-run> --sample-rate 48000 --budget-seconds 480` produces `tick`,
`analysis`, and full `forward` outputs for the external frozen scorer. It reads
the source excerpt with SoundFile, averages the first two channels, uses the
same default SciPy `resample_poly` host preprocessing, and feeds one second of
zero flush. The native driver's `stream` command must use the production kernel
descriptor, parameters, 128-sample process calls, denormal noise handling,
silence/reset policy and telemetry/event observer. It must report actual
quantum-end availability, including production FIR/staging once. The external scorer adds only initial
file-to-host preprocessing support. `params.sample_rate` records the host rate;
the internal beat rate is recorded separately. Resume uses the same native
executable hash and input rate; another build needs a fresh directory.

Add `--diagnostics-out <private-gate-results>` to retain gate statistics from
new native runs in a separately guarded directory. `--diagnostics-only` fills
missing diagnostic records without changing beat outputs. Duplicate telemetry
headers with the same generation/tick count as one grid tick. Dropouts and
unlocked share use the frozen annotation span (half the median beat interval
before/after the first/last reference beat), EOF cutoff and `dt` duration;
initial file-to-host resampling support is applied only by the external scorer.
The focused gate-diagnostic test also requires SoundFile.

Keep manifests, audio, detailed numerical checkpoints and all per-excerpt
outputs private and untracked. Public provenance is restricted to dataset
names, aggregate recipes/results and shipped artifact integrity hashes.
