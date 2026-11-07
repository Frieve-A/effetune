import sys
import wave

import mido
import numpy as np
import effetune as et

SAMPLE_RATE = 48_000
BLOCK_FRAMES = SAMPLE_RATE  # one second per process() call
TAIL_SECONDS = 3  # silence after the last event lets releases and reverb finish
SUPPORTED = ("note_on", "note_off", "control_change", "pitchwheel", "program_change")

song_path, bank_path, wav_path = sys.argv[1:4]

# mido yields every track merged in time order, with message.time in seconds.
events = []
seconds = 0.0
for message in mido.MidiFile(song_path):
    seconds += message.time
    if message.type in SUPPORTED:
        data = message.bytes()
        events.append((round(seconds * SAMPLE_RATE), data + [0] * (3 - len(data))))
total_frames = (events[-1][0] if events else 0) + TAIL_SECONDS * SAMPLE_RATE

bank = et.SoundFontBank.load(bank_path)
chain = et.Chain(
    [et.SoundFontPlayer(id="player", output_gain=-6, assets={"soundFont": "bank"})],
    asset_resolver=lambda _reference: bank,
)
blocks = []
with chain.stream(SAMPLE_RATE, channels=2) as stream:
    index = 0
    for start in range(0, total_frames, BLOCK_FRAMES):
        frames = min(BLOCK_FRAMES, total_frames - start)
        block_events = []
        while index < len(events) and events[index][0] < start + frames:
            frame, data = events[index]
            block_events.append({"frame": frame - start, "effectId": "player", "midi": data})
            index += 1
        silence = np.zeros((2, frames), dtype=np.float32)
        blocks.append(stream.process(silence, events=block_events))
audio = np.concatenate(blocks, axis=1)

pcm = np.round(np.clip(audio, -1, 1) * 32767).astype("<i2")
with wave.open(wav_path, "wb") as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(SAMPLE_RATE)
    output.writeframes(pcm.T.tobytes())
