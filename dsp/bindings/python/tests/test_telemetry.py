from __future__ import annotations

import math
import struct
import unittest

import effetune
from effetune.telemetry import (
    AnalogMeterTelemetryChannel,
    AnalogMeterTelemetryFrame,
    AnalogMeterTelemetryProgram,
    _decode_telemetry_packet,
)


HQ_MIN_FREQUENCY = 20.0
HQ_MAX_FREQUENCY = 40_000.0


def _valid_range(
    frame_type: int, cell_count: int, sample_rate: float
) -> tuple[int, int]:
    first_valid_index = cell_count
    valid_cell_count = 0
    log_step = math.log(HQ_MAX_FREQUENCY / HQ_MIN_FREQUENCY) / (cell_count - 1)
    for index in range(cell_count):
        ascending = index if frame_type == 4 else cell_count - 1 - index
        frequency = (
            HQ_MAX_FREQUENCY
            if ascending == cell_count - 1
            else HQ_MIN_FREQUENCY * math.exp(ascending * log_step)
        )
        if frequency <= sample_rate * 0.5:
            if first_valid_index == cell_count:
                first_valid_index = index
            valid_cell_count += 1
    return (0 if valid_cell_count == 0 else first_valid_index, valid_cell_count)


def _hq_packet(
    *,
    frame_type: int,
    tap_id: int,
    sample_rate: float = 48_000.0,
    points: int = 10,
    cell_count: int | None = None,
    min_frequency: float = HQ_MIN_FREQUENCY,
    max_frequency: float = HQ_MAX_FREQUENCY,
    hop: int | None = None,
    first_valid_index: int | None = None,
    valid_cell_count: int | None = None,
) -> bytearray:
    count = cell_count if cell_count is not None else (2048 if frame_type == 4 else 256)
    first, valid = _valid_range(frame_type, count, sample_rate)
    nominal_hop = (
        max((1 << points) // 2, math.ceil(sample_rate / 30))
        if frame_type == 4
        else (1 << points) // 2
    )
    payload_bytes = 48 + count * (8 if frame_type == 4 else 1)
    frame_bytes = (16 + payload_bytes + 3) & ~3
    packet = bytearray(frame_bytes)
    struct.pack_into("<HHIIH", packet, 0, frame_type, 2, tap_id, 17, payload_bytes)
    struct.pack_into(
        "<fHHIIQIIffII",
        packet,
        16,
        sample_rate,
        points,
        0,
        nominal_hop if hop is None else hop,
        3,
        0x20_0000_0001,
        42,
        count,
        min_frequency,
        max_frequency,
        first if first_valid_index is None else first_valid_index,
        valid if valid_cell_count is None else valid_cell_count,
    )
    return packet


def _rhythm_packet(locked: bool = True, events: int = 1) -> bytearray:
    packet = bytearray(16 + 1344)
    struct.pack_into("<HHIIH", packet, 0, 28, 1, 13, 0, 1344)
    struct.pack_into(
        "<fIIIffII", packet, 16, 48_000.0, 2, 256, 500, 3.5, 0.032, 1, events
    )
    if locked:
        struct.pack_into("<IIffIfI", packet, 48, 1, 3, 2.5, 0.5, 510, 0.25, 7)
    struct.pack_into("<f", packet, 16 + 60, 120.0)
    struct.pack_into("<f", packet, 16 + 64 + 4 * 91, 1.0)
    struct.pack_into("<f", packet, 16 + 64 + 4 * 43, 0.5)
    for index in range(events):
        struct.pack_into(
            "<IfIifffBB",
            packet,
            16 + 832 + index * 32,
            480 + index,
            0.75,
            3 if locked else 0,
            -1 if locked else 0,
            0.875 if locked else 0.0,
            0.5 if locked else 0.0,
            0.8,
            2,
            0 if locked else 1,
        )
    return packet


def _tonal_balance_packet() -> bytearray:
    packet = bytearray(16 + 1564)
    struct.pack_into("<HHIIH", packet, 0, 29, 1, 14, 0, 1564)
    struct.pack_into(
        "<fHHBBHffI", packet, 16, 96_000.0, 41, 128, 0b1111, 2, 0, -18.5, -1.25, 900
    )
    for offset, value in (
        (24, 71.5),
        (188, 0.75),
        (352, 0.5),
        (516, -2.5),
        (680, 3.25),
        (844, 1.5),
    ):
        struct.pack_into("<f", packet, 16 + offset + 4 * 10, value)
    packet[16 + 1008 + 10] = 0b11101
    struct.pack_into("<f", packet, 16 + 1052 + 4 * 127, -3.75)
    return packet


def _pitch_packet(midi: float) -> bytes:
    packet = bytearray(60)
    struct.pack_into("<HHIIH", packet, 0, 26, 1, 9, 0, 44)
    struct.pack_into(
        "<fffIIfffffHH",
        packet,
        16,
        48_000.0,
        1.0,
        0.01,
        99,
        3,
        440.0,
        midi,
        10.0,
        0.9,
        -12.0,
        1,
        0,
    )
    return bytes(packet)


def _note_packet(revision_age: int = 8) -> bytearray:
    packet = bytearray(16 + 5312)
    struct.pack_into("<HHIIH", packet, 0, 24, 4, 2, 17, 5312)
    struct.pack_into(
        "<ffHHfIIII", packet, 16, 48_000.0, 1.0, 440, 21, 0.02, 50, 5, 3, revision_age
    )
    for offset, value in ((32, 0.75), (1788, 0.25), (1792, -12.0), (3548, -240.0)):
        struct.pack_into("<f", packet, 16 + offset, value)
    if revision_age != 0:
        struct.pack_into("<f", packet, 16 + 3552, 0.5)
        struct.pack_into("<f", packet, 16 + 5308, 1.0)
    return packet


def _analog_meter_packet(
    mode: int,
    channels: list[tuple[float, float]],
    flags: int = 0,
    program: tuple[float, ...] | None = None,
) -> bytes:
    values = [value for channel in channels for value in channel] + list(program or ())
    payload_bytes = 4 + len(channels) * 8 + (24 if program else 0)
    packet = bytearray((16 + payload_bytes + 3) & ~3)
    struct.pack_into("<HHIIH", packet, 0, 27, 1, 11, 0, payload_bytes)
    struct.pack_into("<BBH", packet, 16, mode, len(channels), flags)
    struct.pack_into(f"<{len(values)}f", packet, 20, *values)
    return bytes(packet)


class TelemetryDecoderTests(unittest.TestCase):
    def test_note_spectrogram_v4_decodes_owned_revised_confidences(self) -> None:
        packet = _note_packet()
        frames, pending = _decode_telemetry_packet(
            packet, {2: ("NoteSpectrogram", "notes", 0)}, 2
        )
        self.assertEqual(len(frames), 1)
        self.assertEqual(pending, 0)
        frame = frames[0]
        self.assertIsInstance(frame, effetune.NoteSpectrogramTelemetryFrame)
        self.assertEqual((frame.sequence, frame.dropped), (17, 2))
        self.assertEqual((frame.sample_rate, frame.time_seconds, frame.first_midi), (48000, 1, 21))
        self.assertEqual((frame.frame_index, frame.divisions_per_semitone, frame.generation), (50, 5, 3))
        self.assertEqual(frame.revision_age, 8)
        self.assertEqual((len(frame.levels), frame.levels[0], frame.levels[-1]), (440, 0.75, 0.25))
        self.assertEqual((len(frame.volume_db), frame.volume_db[0], frame.volume_db[-1]), (440, -12, -240))
        self.assertEqual((len(frame.revised_levels), frame.revised_levels[0], frame.revised_levels[-1]), (440, 0.5, 1))
        packet[:] = bytes(len(packet))
        self.assertEqual((frame.levels[0], frame.volume_db[0], frame.revised_levels[0]), (0.75, -12, 0.5))

    def test_note_spectrogram_v4_has_no_revision_during_warmup(self) -> None:
        frames, _ = _decode_telemetry_packet(
            _note_packet(0), {2: ("NoteSpectrogram", "notes", 0)}, 0
        )
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].revision_age, 0)
        self.assertIsNone(frames[0].revised_levels)

    def test_note_spectrogram_rejects_invalid_revisions_and_obsolete_frames(self) -> None:
        for format_string, offset, value in (
            ("<I", 44, 7),
            ("<f", 3568, math.nan),
            ("<f", 3568, -0.1),
            ("<f", 5324, 1.1),
            ("<H", 2, 3),
            ("<H", 12, 3548),
        ):
            with self.subTest(offset=offset, value=value):
                packet = _note_packet()
                struct.pack_into(format_string, packet, offset, value)
                frames, pending = _decode_telemetry_packet(
                    packet, {2: ("NoteSpectrogram", "notes", 0)}, 2
                )
                self.assertEqual(frames, [])
                self.assertEqual(pending, 2)

    def test_analog_meter_decodes_needle_and_program_records(self) -> None:
        nodes = {11: ("AnalogMeter", "meter", 0)}

        def decode(packet: bytes) -> list[effetune.telemetry.TelemetryFrame]:
            return _decode_telemetry_packet(packet, nodes, 2)[0]

        (peak,) = decode(_analog_meter_packet(4, [(-6.0, 0.5), (-240.0, -240.0)]))
        self.assertIsInstance(peak, AnalogMeterTelemetryFrame)
        self.assertEqual(peak.kind, "analogMeter")
        self.assertEqual(peak.mode, 4)
        self.assertEqual(peak.channel_count, 2)
        self.assertFalse(peak.integrated_valid)
        self.assertFalse(peak.lra_valid)
        self.assertEqual(
            peak.channels,
            (
                AnalogMeterTelemetryChannel(needle_db=-6.0, max_db=0.5),
                AnalogMeterTelemetryChannel(needle_db=-240.0, max_db=-240.0),
            ),
        )
        self.assertIsNone(peak.program)
        self.assertEqual(peak.dropped, 2)

        (loudness,) = decode(
            _analog_meter_packet(
                5, [(-23.0, -24.0)], 3, (-23.0, -23.5, -23.0, 7.0, -1.5, 12.0)
            )
        )
        self.assertTrue(loudness.integrated_valid)
        self.assertTrue(loudness.lra_valid)
        self.assertEqual(
            loudness.program,
            AnalogMeterTelemetryProgram(
                momentary=-23.0,
                short_term=-23.5,
                integrated=-23.0,
                lra=7.0,
                max_true_peak=-1.5,
                integrated_seconds=12.0,
            ),
        )
        (pending,) = decode(
            _analog_meter_packet(5, [(-23.0, -24.0)], 0, (-23.0, -23.5, 0.0, 0.0, -1.5, 0.25))
        )
        self.assertFalse(pending.integrated_valid)
        self.assertEqual(pending.program.integrated, 0.0)

        program = (-23.0, -23.0, 0.0, 0.0, -1.0, 0.0)
        for name, packet in (
            ("unknown mode", _analog_meter_packet(6, [(-6.0, -6.0)])),
            ("no channels", _analog_meter_packet(0, [])),
            ("17 channels", _analog_meter_packet(0, [(-6.0, -6.0)] * 17)),
            ("loudness flags outside Loudness", _analog_meter_packet(0, [(-6.0, -6.0)], 1)),
            ("unknown flag", _analog_meter_packet(5, [(-6.0, -6.0)], 4, program)),
            ("missing program", _analog_meter_packet(5, [(-6.0, -6.0)])),
            ("program outside Loudness", _analog_meter_packet(0, [(-6.0, -6.0)], 0, program)),
            ("below floor", _analog_meter_packet(0, [(-241.0, -6.0)])),
            ("non-finite", _analog_meter_packet(0, [(math.nan, -6.0)])),
            (
                "invalid integrated not zero",
                _analog_meter_packet(5, [(-6.0, -6.0)], 0, (-23.0, -23.0, -23.0, 0.0, -1.0, 0.0)),
            ),
            (
                "negative LRA",
                _analog_meter_packet(5, [(-6.0, -6.0)], 2, (-23.0, -23.0, 0.0, -1.0, -1.0, 0.0)),
            ),
            (
                "negative duration",
                _analog_meter_packet(5, [(-6.0, -6.0)], 0, (-23.0, -23.0, 0.0, 0.0, -1.0, -1.0)),
            ),
        ):
            with self.subTest(name=name):
                self.assertEqual(decode(packet), [])

    def test_rhythm_analyzer_decodes_tracker_tempogram_and_events(self) -> None:
        nodes = {13: ("RhythmAnalyzer", "rhythm", 0)}

        def decode(packet: bytes) -> list[effetune.TelemetryFrame]:
            return _decode_telemetry_packet(packet, nodes, 0)[0]

        (frame,) = decode(bytes(_rhythm_packet()))
        self.assertIsInstance(frame, effetune.RhythmAnalyzerTelemetryFrame)
        self.assertEqual(frame.kind, "rhythmAnalyzer")
        self.assertEqual(frame.sample_rate, 48_000)
        self.assertEqual(frame.generation, 2)
        self.assertEqual(frame.envelope_hop_samples, 256)
        self.assertEqual(frame.envelope_frame_count, 500)
        self.assertEqual(frame.time_seconds, 3.5)
        self.assertAlmostEqual(frame.latency_seconds, 0.032, places=6)
        self.assertEqual(frame.dropped_events, 1)
        self.assertTrue(frame.locked)
        self.assertEqual(frame.lock_epoch, 3)
        self.assertEqual(frame.confidence, 2.5)
        self.assertEqual(frame.period_seconds, 0.5)
        self.assertEqual(frame.next_beat_frame, 510)
        self.assertEqual(frame.next_beat_fraction, 0.25)
        self.assertEqual(frame.next_beat_index, 7)
        self.assertEqual(frame.comb_best_bpm, 120)
        self.assertEqual(len(frame.tempogram), 192)
        self.assertEqual(frame.tempogram[91], 1)
        self.assertEqual(frame.tempogram[43], 0.5)
        (event,) = frame.events
        self.assertIsInstance(event, effetune.RhythmAnalyzerTelemetryEvent)
        self.assertEqual(
            (event.frame, event.fraction, event.lock_epoch, event.beat_index),
            (480, 0.75, 3, -1),
        )
        self.assertEqual((event.beat_fraction, event.period_seconds), (0.875, 0.5))
        self.assertAlmostEqual(event.strength, 0.8, places=6)
        self.assertEqual((event.band, event.unlocked), (2, False))

        (unlocked,) = decode(bytes(_rhythm_packet(locked=False, events=16)))
        self.assertFalse(unlocked.locked)
        self.assertEqual(len(unlocked.events), 16)
        self.assertTrue(all(event.unlocked for event in unlocked.events))

        for name, offset, fmt, value in (
            ("zero generation", 4, "<I", 0),
            ("zero envelope hop", 8, "<I", 0),
            ("17 events", 28, "<I", 17),
            ("unknown tracker flag", 32, "<I", 3),
            ("locked without period", 44, "<f", 0.0),
            ("tempogram above one", 64, "<f", 1.5),
            ("fraction of one", 836, "<f", 1.0),
            ("unknown band", 860, "<B", 3),
            ("unknown event flag", 861, "<B", 2),
            ("zero strength", 856, "<f", 0.0),
        ):
            with self.subTest(name=name):
                packet = _rhythm_packet()
                struct.pack_into(fmt, packet, 16 + offset, value)
                self.assertEqual(decode(bytes(packet)), [])
        short = _rhythm_packet()
        struct.pack_into("<H", short, 12, 1340)
        self.assertEqual(decode(bytes(short)), [])
        unlocked_with_period = _rhythm_packet(locked=False)
        struct.pack_into("<f", unlocked_with_period, 16 + 44, 0.5)
        self.assertEqual(decode(bytes(unlocked_with_period)), [])

    def test_tonal_balance_decodes_band_statistics_target_and_response(
        self,
    ) -> None:
        nodes = {14: ("TonalBalanceEQ", "tonal", 1)}

        def decode(packet: bytes) -> list[effetune.TelemetryFrame]:
            return _decode_telemetry_packet(packet, nodes, 0)[0]

        (frame,) = decode(bytes(_tonal_balance_packet()))
        self.assertIsInstance(frame, effetune.TonalBalanceEQTelemetryFrame)
        self.assertEqual(frame.kind, "tonalBalance")
        self.assertEqual(frame.sample_rate, 96_000)
        self.assertEqual(frame.target_index, 2)
        self.assertEqual(
            (
                frame.absolute_gate,
                frame.relative_gate,
                frame.loudness_valid,
                frame.target_valid,
            ),
            (True, True, True, True),
        )
        self.assertEqual((frame.loudness_lkfs, frame.makeup_db), (-18.5, -1.25))
        self.assertEqual(frame.gated_hop_count, 900)
        bands = (
            frame.level_db,
            frame.persistence,
            frame.presence,
            frame.command_db,
            frame.target_mu_db,
            frame.target_sigma_db,
            frame.band_flags,
        )
        self.assertEqual({len(values) for values in bands}, {41})
        self.assertEqual(
            tuple(values[10] for values in bands),
            (71.5, 0.75, 0.5, -2.5, 3.25, 1.5, 0b11101),
        )
        self.assertEqual(len(frame.response_db), 128)
        self.assertEqual(frame.response_db[127], -3.75)

        for name, offset, fmt, value in (
            ("band count", 4, "<H", 40),
            ("grid count", 6, "<H", 127),
            ("unknown state flag", 8, "<B", 0b10000),
            ("reserved header", 10, "<H", 1),
            ("loudness without validity", 8, "<B", 0b1011),
            ("non-finite level", 24, "<f", math.nan),
            ("presence above one", 352, "<f", 1.5),
            ("negative sigma", 844, "<f", -1.0),
            ("unknown band flag", 1008, "<B", 0b100000),
            ("reserved band bytes", 1051, "<B", 1),
            ("non-finite response", 1052, "<f", math.inf),
        ):
            with self.subTest(name=name):
                packet = _tonal_balance_packet()
                struct.pack_into(fmt, packet, 16 + offset, value)
                self.assertEqual(decode(bytes(packet)), [])
        short = _tonal_balance_packet()
        struct.pack_into("<H", short, 12, 1560)
        self.assertEqual(decode(bytes(short)), [])

    def test_pitch_preserves_fractional_estimates_within_endpoint_half_rows(
        self,
    ) -> None:
        nodes = {9: ("PitchMeter", "pitch", 0)}
        for midi in (20.9, 108.1):
            with self.subTest(midi=midi):
                frames, pending = _decode_telemetry_packet(
                    _pitch_packet(midi), nodes, 0
                )
                self.assertEqual(pending, 0)
                self.assertEqual(len(frames), 1)
                self.assertAlmostEqual(frames[0].midi, midi, places=4)
        for midi in (20.49, 108.51):
            with self.subTest(midi=midi):
                frames, _ = _decode_telemetry_packet(_pitch_packet(midi), nodes, 0)
                self.assertEqual(frames, [])

    def test_hq_spectrum_accepts_canonical_v2_contract(self) -> None:
        packet = _hq_packet(frame_type=4, tap_id=7)
        for cell in range(2048):
            struct.pack_into("<f", packet, 64 + cell * 4, -10.0 - cell / 2048)
            struct.pack_into(
                "<f", packet, 64 + (2048 + cell) * 4, -5.0 - cell / 2048
            )
        frames, pending = _decode_telemetry_packet(
            bytes(packet), {7: ("SpectrumAnalyzer", "spectrum", 2)}, 5
        )
        self.assertEqual(pending, 0)
        self.assertEqual(len(frames), 1)
        frame = frames[0]
        self.assertIsInstance(frame, effetune.SpectrumHqTelemetryFrame)
        self.assertEqual(frame.kind, "spectrumHq")
        self.assertEqual(frame.capture_end, 0x20_0000_0001)
        self.assertEqual(frame.hop, 1600)
        self.assertEqual(frame.generation, 3)
        self.assertEqual(frame.frame_index, 42)
        self.assertEqual(frame.cell_count, 2048)
        self.assertEqual(frame.min_frequency, HQ_MIN_FREQUENCY)
        self.assertEqual(frame.max_frequency, HQ_MAX_FREQUENCY)
        self.assertEqual(frame.first_valid_index, 0)
        self.assertEqual(frame.valid_cell_count, 1910)
        self.assertEqual(len(frame.current_db), 2048)
        self.assertEqual(len(frame.peak_db), 2048)
        self.assertEqual(frame.current_db[0], -10.0)
        self.assertEqual(frame.peak_db[0], -5.0)

    def test_chroma_spiral_accepts_only_hq_spectrum(self) -> None:
        packet = _hq_packet(frame_type=4, tap_id=7)
        nodes = {7: ("ChromaSpiral", "chroma", 0)}
        frames, _ = _decode_telemetry_packet(bytes(packet), nodes, 0)
        self.assertEqual(len(frames), 1)
        self.assertIsInstance(frames[0], effetune.SpectrumHqTelemetryFrame)
        self.assertEqual(frames[0].kind, "spectrumHq")
        struct.pack_into("<H", packet, 2, 1)
        frames, _ = _decode_telemetry_packet(bytes(packet), nodes, 0)
        self.assertEqual(frames, [])

    def test_hq_spectrogram_accepts_canonical_descending_v2_grid(self) -> None:
        nodes = {8: ("Spectrogram", "spectrogram", 0)}
        packet = _hq_packet(frame_type=5, tap_id=8)
        packet[64:320] = bytes(range(256))
        frames, pending = _decode_telemetry_packet(bytes(packet), nodes, 0)
        self.assertEqual(pending, 0)
        self.assertEqual(len(frames), 1)
        frame = frames[0]
        self.assertIsInstance(frame, effetune.SpectrogramHqTelemetryFrame)
        self.assertEqual(frame.kind, "spectrogramHq")
        self.assertEqual(frame.hop, 512)
        self.assertEqual(frame.cell_count, 256)
        self.assertEqual(frame.first_valid_index, 18)
        self.assertEqual(frame.valid_cell_count, 238)
        self.assertEqual(frame.intensities[0], 0)
        self.assertEqual(frame.intensities[-1], 255)

    def test_hq_rejects_metadata_outside_each_analyzer_v2_contract(self) -> None:
        cases = (
            (4, 7, "SpectrumAnalyzer", 2048),
            (5, 8, "Spectrogram", 256),
        )
        for frame_type, tap_id, effect_type, cell_count in cases:
            first, valid = _valid_range(frame_type, cell_count, 48_000.0)
            nominal_hop = 1600 if frame_type == 4 else 512
            mutations = (
                ("cell count", {"cell_count": cell_count - 1}),
                ("minimum frequency", {"min_frequency": 21.0}),
                ("maximum frequency", {"max_frequency": 39_999.0}),
                ("nominal hop", {"hop": nominal_hop + 1}),
                ("first valid index", {"first_valid_index": first + 1}),
                ("valid cell count", {"valid_cell_count": valid - 1}),
            )
            nodes = {tap_id: (effect_type, None, 0)}
            for name, overrides in mutations:
                with self.subTest(effect_type=effect_type, mutation=name):
                    invalid = _hq_packet(
                        frame_type=frame_type, tap_id=tap_id, **overrides
                    )
                    frames, pending = _decode_telemetry_packet(
                        bytes(invalid), nodes, 4
                    )
                    self.assertEqual(frames, [])
                    self.assertEqual(pending, 4)

    def test_legacy_spectrum_and_spectrogram_v1_remain_accepted(self) -> None:
        spectrum_points = 8
        spectrum_bins = (1 << (spectrum_points - 1)) + 1
        spectrum_payload_bytes = 12 + spectrum_bins * 8
        spectrum = bytearray((16 + spectrum_payload_bytes + 3) & ~3)
        struct.pack_into(
            "<HHIIH", spectrum, 0, 4, 1, 7, 0, spectrum_payload_bytes
        )
        struct.pack_into(
            "<fIHH", spectrum, 16, 48_000.0, spectrum_bins, spectrum_points, 0
        )

        spectrogram = bytearray(16 + 268)
        struct.pack_into("<HHIIH", spectrogram, 0, 5, 1, 8, 0, 268)
        struct.pack_into("<ffHH", spectrogram, 16, 48_000.0, 1.0, 256, 10)

        cases = (
            (7, "SpectrumAnalyzer", "spectrum", spectrum),
            (8, "Spectrogram", "spectrogram", spectrogram),
        )
        for tap_id, effect_type, kind, packet in cases:
            with self.subTest(effect_type=effect_type):
                frames, pending = _decode_telemetry_packet(
                    bytes(packet), {tap_id: (effect_type, None, 0)}, 3
                )
                self.assertEqual(len(frames), 1)
                self.assertEqual(frames[0].kind, kind)
                self.assertEqual(frames[0].dropped, 3)
                self.assertEqual(pending, 0)


if __name__ == "__main__":
    unittest.main()
