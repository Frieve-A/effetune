# Bluetooth SBC conformance fixture contract

This is an internal development record. Bluetooth SIG package bytes and derived encoded or decoded
fixtures must not be committed to this repository.

## Authority and provenance

- Profile/test revision: Advanced Audio Distribution Profile 1.3.2 SBC conformance material.
- Bluetooth SIG SBC Bitstreams package:
  `https://www.bluetooth.org/DocMan/handlers/DownloadDoc.ashx?doc_id=40795`
  - size: 2,842,548 bytes
  - SHA-256: `74D0CED5E22F371CC56D58639E2907F10F451DADA86166BB773368F1A6E62E69`
- Bluetooth SIG SBC Test Files package:
  `https://www.bluetooth.org/DocMan/handlers/DownloadDoc.ashx?doc_id=41034`
  - size: 4,806,494 bytes
  - SHA-256: `C7443557DCE4012BA55E8624019D768AEE1325D7A83DB4BC78ED0027818829BB`
- Independent implementation cross-check: BlueZ/libsbc tag 1.3, tree
  `5aec47400f0f32234f1fc057380fc7770f8f8b69`, used only as a secondary diagnostic.

The official archives are development inputs, not redistributable project assets. Keep them and all
derived `.sbc`/PCM files under an ignored build directory such as `dsp/build/sbc-conformance`.

## Minimal gate

The gate is intentionally limited to two 48 kHz, 8-subband, Loudness, 16-block frames:

1. Stereo, bitpool 35, generated temporarily with the official v1.5 reference encoder from the
   package's `sbc_enc_test_09.wav`.
2. Joint Stereo, using frame 276 at byte offset 21,804 from official test 24 (bitpool 33, 79 bytes per
   frame). Official
   test 28 (bitpool 51, 115 bytes per frame) is a permitted replacement when only that decoder output
   is available; do not run both merely to expand coverage.

For each frame the native test adapter checks the calculated frame length, reserved highest join bit,
scale factors, exact shared-bitpool allocation, bounded codewords, and production logical decode. The
decoded PCM is compared with the official reference decoder using the Bluetooth SBC conformance
limits: 7-bit RMS accuracy (148 signed-16 LSB after rounding) and 1024 LSB maximum absolute error.

## Acquisition and execution

1. Download both packages from the URLs above and reject any size or SHA-256 mismatch before
   extraction.
2. Use the official v1.5 encoder with
   `-s -l16 -n8 -p -r246000 -oofficial-stereo-bp35.sbc sbc_enc_test_09.wav` to create the 48 kHz,
   8-subband, Loudness, 16-block, bitpool-35 Stereo stream. Its expected complete-stream SHA-256 is
   `0C443DB2B39636506AC66BCDB7478D9B1D74BDC0C5BCD9700350369E25122D22`.
3. Isolate frame 275 at byte offset 22,550 with length 82 as `stereo.sbc` and decode it with the
   official v1.5 decoder using `-ostereo.wav stereo.sbc`.
4. Run the native adapter with `--inspect` on official test 24 and require the exact record
   `frame=276 offset=21804 bytes=79 mode=joint nonzero=yes logical-fnv64=8bc6f83cef93c739`.
   Isolate exactly that frame as `joint.sbc` and reject it unless its SHA-256 is
   `8199D53D39E202207E215067636539FA1EE329055EAED1DB14FABEC2E8A447A2`. Decode it with the
   official v1.5 decoder using `-ojoint.wav joint.sbc`. The adapter and official decoder therefore
   both start from zero state, and the selection is reproducible without depending on inspection
   order or a broad `nonzero` predicate.
5. Run the built `effetune_dsp_bluetooth_sbc_conformance_tests` executable with:

   `--stereo stereo.sbc stereo.wav --joint joint.sbc joint.wav`

6. Hash the temporary isolated inputs and official decoder outputs and compare them with the
   verification result below.

## Production encoder gate

After the decoder gate has produced `stereo.wav` and `joint.wav`, use those existing, independently
decoded non-silent PCM inputs to exercise the production encoder calculations. The native adapter
runs the production analysis, joint-stereo selection, scale-factor calculation, bit allocation, and
quantization. Test-only code then packs the logical fields into one SBC frame. The packed frame is
decoded by the official v1.5 decoder before the native adapter compares official PCM with its own
logical-field decode under the same limits as the decoder gate.

Run these commands from the repository root, with the official decoder and temporary files in the
current directory where noted:

```text
effetune_dsp_bluetooth_sbc_conformance_tests.exe --encode-stereo stereo.wav encoded-stereo.sbc --encode-joint joint.wav encoded-joint.sbc
sbc_decoder.exe -oencoded-stereo.wav encoded-stereo.sbc
sbc_decoder.exe -oencoded-joint.wav encoded-joint.sbc
effetune_dsp_bluetooth_sbc_conformance_tests.exe --stereo encoded-stereo.sbc encoded-stereo.wav --joint encoded-joint.sbc encoded-joint.wav
```

This gate checks interoperability and decoded PCM, not byte identity with a different encoder. It
must use temporary official-package inputs and must not add any `.wav` or `.sbc` fixture to the
repository.

## Verification result

The one-time gate passed on 2026-08-02:

| Case | Isolated SBC SHA-256 | Official WAV SHA-256 | PCM payload SHA-256 | Logical-field FNV-1a 64 |
|---|---|---|---|---|
| Stereo | `B7101CF4B266FE5CDC80CD3B3DB87157E8430BBDAA2B823264AB34456D7140D2` | `42990589F026C94A760F115866F8B7C5046A2EAC0E61B27736E295F853A3E844` | `A06244D290D6762BF0948568946B8EC4C176FCD09C5F0EB938A6759EF52857BE` | `807ead05bb846bac` |
| Joint Stereo | `8199D53D39E202207E215067636539FA1EE329055EAED1DB14FABEC2E8A447A2` | `000CFC79BCB68DB4777B236DA5FAAD6A694206D23D16AC9C89AD63B3B5722CF5` | `63A8E1B3DD9F76785467C1587CC3A9E2378AC8B0936A577718F2829AAC27229F` | `8bc6f83cef93c739` |

Both frames passed frame-length, highest-join-bit, scale-factor, exact shared-bitpool allocation,
codeword-bound, and official decoder PCM checks. No fixture bytes are retained by the repository.

The production encoder gate also passed on 2026-08-02:

| Case | Input WAV SHA-256 | Generated SBC SHA-256 | Official WAV SHA-256 | PCM payload SHA-256 | Logical-field FNV-1a 64 |
|---|---|---|---|---|---|
| Stereo | `42990589F026C94A760F115866F8B7C5046A2EAC0E61B27736E295F853A3E844` | `EA9693A510EDBF8BC2186F395342C4D050FE707F4DD33DC2AB79CC698B4F230D` | `55A4400358C92EF7E5A4AEE2373D86883D5E297B310EC80A3EE52D92250A2A0B` | `6487906D1B367AD426005166DE8445AC3C6BF3B07F7FEC3ABF9AFC8C05CF917B` | `44ac5eaa2b890ff4` |
| Joint Stereo | `000CFC79BCB68DB4777B236DA5FAAD6A694206D23D16AC9C89AD63B3B5722CF5` | `769064A97FF38A57633C7122975677443B9EAFD657C18BDDB69FA39DDC45DA22` | `27BAEF8F486C3E40EBDD5AEBA8183074594287AD33F971CE8EAF7EBBEA6057F8` | `F2A64D9E174B10B0706B81423DB5837BEC0F446E290394E685078FA4D6380036` | `78890df71d961793` |

The official decoder output was non-silent in both cases (Stereo: 123 nonzero samples, Joint Stereo:
154 nonzero samples). No encoder-gate fixture bytes are retained by the repository.
