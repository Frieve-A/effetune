# Desktop browser integration fixture

`stereo.webm` is a generated twelve-second stereo signal: 713 Hz on the left,
1237 Hz on the right, each with amplitude 0.02 at 48 kHz. It contains no third-party
recording. HTTP media and MSE use the same signal. Regenerate with:

```sh
ffmpeg -f lavfi -i 'aevalsrc=0.02*sin(2*PI*713*t)|0.02*sin(2*PI*1237*t):s=48000:d=12' -c:a libopus -b:a 96k stereo.webm
```

Run `npm run test:desktop-browser` from the repository root. The test starts and
stops its own HTTPS server; do not start a separate server.

`key.pem` and `cert.pem` are public, test-only localhost credentials. The test
harness trusts this exact certificate for the fixture host in its isolated session.
They are never used by the app. No certificate tool or encoder is required to
run the tests. The server and isolated app profiles belong to each test.

The output observer uses system loopback only to measure direct sound leakage;
it never feeds the production input. Physical assertions follow the two fixture
tones, while total RMS is retained for diagnostics. Other sound in those same
frequency bands can still prevent the strict silence check; use a quiet output.
