"""Focused checks for half rounding, ordered inference, FFT and streaming state."""
import unittest

import numpy as np

import export as E
import numeric as N
from decoder import Decoder
from rate import decimate


class ReferenceTests(unittest.TestCase):
    def test_every_finite_half_survives_decode_and_encode(self):
        codes = np.arange(65536, dtype=np.uint16)
        codes = codes[(codes & 0x7c00) != 0x7c00]
        expected = codes.view(np.float16).astype(np.float32)
        actual = N.decode_half(codes)
        np.testing.assert_array_equal(actual.view(np.uint32), expected.view(np.uint32))
        np.testing.assert_array_equal(N.encode_half(actual), codes)
        self.assertEqual(N.half_code(np.float32(2 ** -25)), 0)
        self.assertEqual(N.half_code(np.nextafter(np.float32(2 ** -25), np.float32(1))), 1)

    def test_half_rounds_all_midpoints_to_even(self):
        codes = np.arange(0x7bff, dtype=np.uint16)
        lower = codes.view(np.float16).astype(np.float32)
        upper = (codes + 1).view(np.float16).astype(np.float32)
        midpoints = (lower + upper) / np.float32(2)
        np.testing.assert_array_equal(N.encode_half(midpoints), codes + (codes & 1))
        self.assertEqual(N.half_code(np.float32(65520)), 0x7c00)

    def test_compiled_order_matches_python_and_ring_wrap_is_chunk_invariant(self):
        rng = np.random.default_rng(13)
        tensors = {}
        for name, shape, dtype in N.tensor_layout():
            if name == "mu":
                tensors[name] = np.zeros(shape, np.float32)
            elif name == "sd":
                tensors[name] = np.ones(shape, np.float32)
            else:
                values = rng.uniform(-.01, .01, shape).astype(np.float32)
                tensors[name] = N.encode_half(values).reshape(shape)
        source = rng.uniform(0, 2, (2054, N.INPUTS)).astype(np.float32)
        network = N.Tcn(tensors)
        compiled = network.run(source[:2])
        network.reset()
        python = N.tcn_run.py_func(source[:2], network.mu, network.sd, network.inw, network.inb,
                                   network.convw, network.convb, network.outw, network.outb,
                                   network.ring, network.head)
        for actual, expected in zip(compiled, python):
            np.testing.assert_array_equal(actual.view(np.uint32), expected.view(np.uint32))
        network.reset()
        whole = network.run(source)
        whole_ring = network.ring.copy()
        network.reset()
        first, second = network.run(source[:2053]), network.run(source[2053:])
        for output, left, right in zip(whole, first, second):
            np.testing.assert_array_equal(output, np.concatenate((left, right)))
        np.testing.assert_array_equal(network.ring, whole_ring)
        for llvm in N.tcn_run.inspect_llvm().values():
            self.assertNotIn("llvm.fma.", llvm)
            self.assertNotIn("fmul fast", llvm)

    def test_portable_fft_is_unscaled_and_causal(self):
        rng = np.random.default_rng(19)
        twiddle = N.fft_twiddles()
        weights, tables = [], {}
        for n, bpo in zip((512, 1024, 2048), (6, 12, 24)):
            window = np.hanning(n).astype(np.float32)
            frame = rng.normal(0, .1, n).astype(np.float32)
            result = N.real_magnitudes(frame, window, twiddle)
            expected = np.abs(np.fft.rfft((frame * window).astype(np.float64))).astype(np.float32)
            np.testing.assert_array_equal(result, expected)
            bands = []
            for start, values in E.log_filterbank(n, bpo):
                bands.append((start, len(values), len(weights)))
                weights.extend(values)
                self.assertAlmostEqual(float(values.sum()), 1.0, places=6)
            tables[f"hann{n}"], tables[f"bands{n}"] = window, np.array(bands, np.int64)
        tables["weights"] = np.array(weights, np.float32)
        audio = rng.normal(0, .1, 4096).astype(np.float32)
        full = N.features(audio, tables)
        prefix = N.features(audio[:2048], tables)
        np.testing.assert_array_equal(prefix, full[:len(prefix)])
        self.assertEqual(full.shape, (16, 500))

    def test_decoder_flush_uses_last_completed_tick_and_commits_once(self):
        decoder = Decoder()
        ticks = 303
        activation = np.full(ticks, .01, np.float32)
        activation[20::47] = .9
        tempo = np.full((ticks, 61), np.float32(1 / 61))
        decoder.run(activation, tempo, flush=False)
        committed = decoder.committed_path.copy()
        decoder.flush()
        self.assertEqual(len(decoder.committed_path), ticks)
        self.assertEqual(decoder.committed_path[:len(committed)], committed)
        self.assertTrue(all(0 <= event[1] < ticks for event in decoder.analysis_events))
        events = decoder.analysis_events.copy()
        decoder.flush()
        self.assertEqual(decoder.analysis_events, events)

    def test_fir_grid_delay_and_prefix_availability(self):
        for factor in (2, 4, 8):
            coefficients = E.firwin(32 * factor + 1, .94 / factor, window=("kaiser", 8.6))
            impulse = np.zeros(512, np.float32)
            impulse[0] = 1.0
            half = (len(coefficients) - 1) // 2
            result = decimate(impulse, coefficients, factor)
            expected = np.zeros(len(result), np.float32)
            tail = coefficients[half::factor].astype(np.float32)
            expected[:len(tail)] = tail
            np.testing.assert_array_equal(result, expected)
            self.assertEqual(len(decimate(impulse[:half], coefficients, factor)), 0)
            first = decimate(impulse[:half + 1], coefficients, factor)
            self.assertEqual(len(first), 1)
            np.testing.assert_array_equal(first, result[:1])

    def test_gate_diagnostics_count_grid_ticks_and_ignore_duplicate_headers(self):
        from run_native import gate_diagnostics
        track = {"key": "synthetic", "dataset": "synthetic", "dur": 5 * N.DT,
                 "beats": [0.0, 2 * N.DT]}
        events = [{"kind": "header", "generation": 1, "tick": tick, "shown": value}
                  for tick, value in enumerate((False, True, True, False, True, True, False), 1)]
        events.insert(2, {"kind": "header", "generation": 1, "tick": 3, "shown": False})
        result = gate_diagnostics(track, events)
        self.assertEqual(result["duplicate_header_rows"], 1)
        self.assertEqual(result["span_ticks"], 5)
        self.assertEqual(result["dropout_count"], 1)
        self.assertEqual(result["music_ticks"], 6)
        self.assertEqual(result["unlocked_share"], .4)
        self.assertAlmostEqual(result["dropouts_per_min"], 60 / (5 * N.DT))


if __name__ == "__main__":
    unittest.main()
