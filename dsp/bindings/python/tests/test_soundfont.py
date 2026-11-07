from __future__ import annotations

import struct
import tempfile
import unittest
from pathlib import Path

import numpy as np

import effetune
from effetune import midi


REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
COMMON = REPOSITORY_ROOT / "dsp" / "bindings" / "common"
SINE_BANK = COMMON / "soundfont-sine-v1.etsf"


def _with_page(bank_bytes: bytes) -> bytes:
    """Append one stereo four-frame page to a page-free ETSF1 bank."""
    magic, version, payload_bytes, _ = struct.unpack_from("<4I", bank_bytes)
    pcm = np.arange(8, dtype="<f4") / 8
    return (
        struct.pack("<4I", magic, version, payload_bytes, 1)
        + bank_bytes[16 : 16 + payload_bytes]
        + struct.pack("<4I", 0, 0, 4, 2)
        + pcm.tobytes()
    )


class SoundFontBankTests(unittest.TestCase):
    def test_loads_a_prepared_bank_from_a_path_or_bytes(self) -> None:
        bank = effetune.SoundFontBank.load(SINE_BANK)
        self.assertEqual(bank.payload[:4], b"ETA1")
        self.assertEqual(bank.pages, ())
        self.assertEqual(effetune.SoundFontBank.load(SINE_BANK.read_bytes()).payload, bank.payload)

    def test_loads_resident_pages(self) -> None:
        bank = effetune.SoundFontBank.load(_with_page(SINE_BANK.read_bytes()))
        self.assertEqual(len(bank.pages), 1)
        page = bank.pages[0]
        self.assertEqual((page.sample, page.page_index, page.frames, page.channels), (0, 0, 4, 2))
        np.testing.assert_array_equal(page.pcm, np.arange(8, dtype=np.float32) / 8)
        # Banks with PCM pages compare and hash by identity.
        self.assertEqual(bank, bank)
        self.assertNotEqual(bank, effetune.SoundFontBank.load(_with_page(SINE_BANK.read_bytes())))
        self.assertEqual(len({bank, page}), 2)

    def test_source_soundfonts_point_to_the_prepare_command(self) -> None:
        for source in (COMMON / "soundfont-tiny.sf2", (COMMON / "soundfont-tiny.sf2").read_bytes()):
            with self.assertRaisesRegex(effetune.AssetError, "effetune-soundfont prepare"):
                effetune.SoundFontBank.load(source)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(effetune.AssetError, "effetune-soundfont prepare"):
                effetune.SoundFontBank.load(Path(directory) / "piano.sfz")

    def test_damaged_banks_raise_asset_errors(self) -> None:
        data = SINE_BANK.read_bytes()
        with self.assertRaisesRegex(effetune.AssetError, "damaged"):
            effetune.SoundFontBank.load(data[:-4])
        with self.assertRaisesRegex(effetune.AssetError, "damaged"):
            effetune.SoundFontBank.load(_with_page(data)[:-1])
        for payload_bytes in (32, 52):
            short = struct.pack(
                "<7I", 0x46535445, 1, payload_bytes, 0, 0x31415445, 1, (payload_bytes - 32) // 4
            ).ljust(16 + payload_bytes, b"\0")
            with self.assertRaisesRegex(effetune.AssetError, "damaged"):
                effetune.SoundFontBank.load(short)
        with self.assertRaisesRegex(effetune.AssetError, "different format version"):
            effetune.SoundFontBank.load(data[:4] + struct.pack("<I", 2) + data[8:])


class MidiHelperTests(unittest.TestCase):
    def test_helpers_build_channel_voice_messages(self) -> None:
        self.assertEqual(midi.note_on(1, 60, 100), [0x91, 60, 100])
        self.assertEqual(midi.note_off(1, 60), [0x81, 60, 0])
        self.assertEqual(midi.control_change(0, 64, 127), [0xB0, 64, 127])
        self.assertEqual(midi.pitch_bend(2, 8192), [0xE2, 0, 64])
        self.assertEqual(midi.program_change(15, 5), [0xCF, 5, 0])
        with self.assertRaises(effetune.ValidationError):
            midi.note_on(16, 60, 100)
        with self.assertRaises(effetune.ValidationError):
            midi.pitch_bend(0, 16384)

    def test_midi_events_require_a_midi_driven_effect(self) -> None:
        silence = np.zeros((1, 64), dtype=np.float32)
        with effetune.Chain([effetune.LevelMeter(id="meter")]).stream(
            48_000, channels=1, block_size=32
        ) as stream:
            for event in (
                {"frame": 0, "effectId": "meter", "midi": midi.note_on(0, 60, 100)},
                {"frame": 0, "effectId": "meter", "midi": [0x90, 60, 100], "parameters": {}},
            ):
                with self.assertRaises(effetune.ValidationError):
                    stream.process(silence, events=[event])


class SoundFontPlayerStreamTests(unittest.TestCase):
    def setUp(self) -> None:
        bank = effetune.SoundFontBank.load(SINE_BANK)
        self.chain = effetune.Chain(
            [effetune.Effect("SoundFontPlayer", id="piano", assets={"soundFont": "bank"})],
            asset_resolver=lambda reference: bank,
        )
        self.silence = np.zeros((2, 4_800), dtype=np.float32)
        self.events = [
            {"frame": 0, "effectId": "piano", "midi": midi.note_on(0, 83, 100)},
            {"frame": 2_400, "effectId": "piano", "midi": midi.note_off(0, 83)},
        ]

    def test_midi_plays_deterministically_and_reset_restarts(self) -> None:
        with self.chain.stream(48_000, channels=2, block_size=128) as stream:
            first = stream.process(self.silence, events=self.events)
            stream.reset()
            replay = stream.process(self.silence, events=self.events)
        with self.chain.stream(48_000, channels=2, block_size=128) as stream:
            fresh = stream.process(self.silence, events=self.events)
        self.assertGreater(float(np.max(np.abs(first))), 1e-3)
        np.testing.assert_array_equal(first, replay)
        np.testing.assert_array_equal(first, fresh)

    def test_invalid_midi_events_raise_validation_errors(self) -> None:
        with self.chain.stream(48_000, channels=2, block_size=128) as stream:
            for events in (
                [{"frame": 0, "effectId": "piano", "midi": [0x40, 0, 0]}],
                [{"frame": 0, "effectId": "piano", "midi": [0x90, 128, 0]}],
                [{"frame": 0, "effectId": "piano", "midi": b"\x90\x3c"}],
                [{"frame": 0, "effectId": "piano", "midi": "abc"}],
                [
                    {"frame": 10, "effectId": "piano", "midi": midi.note_on(0, 60, 1)},
                    {"frame": 5, "effectId": "piano", "midi": midi.note_off(0, 60)},
                ],
                [{"frame": 0, "effectId": "piano", "midi": midi.note_on(0, 60, 1)}] * 4_097,
            ):
                with self.assertRaises(effetune.ValidationError):
                    stream.process(self.silence, events=events)

    def test_raw_midi_bytes_pass_and_unused_messages_are_ignored(self) -> None:
        raw = (b"\xfe", b"\xf8", bytearray(b"\xc0\x05"), (0xD0, 64), [0xA0, 60, 10], b"\x90\x53\x64")
        with self.chain.stream(48_000, channels=2, block_size=128) as stream:
            output = stream.process(
                self.silence,
                events=[{"frame": 0, "effectId": "piano", "midi": message} for message in raw],
            )
        self.assertGreater(float(np.max(np.abs(output))), 1e-3)

    def test_graph_rejects_soundfont_player_even_when_disabled(self) -> None:
        document = {
            "version": 1,
            "input": {"id": "input"},
            "output": {"id": "output"},
            "nodes": [
                {
                    "id": "piano",
                    "type": "SoundFontPlayer",
                    "enabled": False,
                    "parameters": {},
                    "assets": {"soundFont": "bank"},
                }
            ],
            "edges": [
                {"id": "in", "source": "input", "destination": "piano"},
                {"id": "out", "source": "piano", "destination": "output"},
            ],
        }
        with self.assertRaises(effetune.ValidationError) as caught:
            effetune.Graph(document)
        self.assertEqual(caught.exception.code, "GRAPH_UNSUPPORTED_CAPABILITY")
        self.assertEqual(caught.exception.path, "/nodes/0/type")
        self.assertEqual(caught.exception.node_id, "piano")

    def test_non_bank_assets_are_rejected_plainly(self) -> None:
        with self.assertRaisesRegex(effetune.AssetError, "SoundFontBank"):
            self.chain.stream(
                48_000,
                channels=2,
                block_size=128,
                asset_resolver=lambda reference: {
                    "samples": np.zeros((1, 1), np.float32),
                    "sampleRate": 48_000,
                },
            )


if __name__ == "__main__":
    unittest.main()
