# Video handoff fixtures

These synthetic 160 × 90, 30 fps VP8 videos make incorrect decoded frames visible in the synchronized-video browser tests. Both last 1.6 seconds. `outgoing.webm` is blue until 1.3 seconds, then yellow; `incoming.webm` is red until 0.2 seconds, then green. No external media is used.

Regenerate from this directory with FFmpeg (not required to run the tests):

```sh
ffmpeg -f lavfi -i color=c=blue:s=160x90:r=30:d=1.6 -vf "drawbox=x=0:y=0:w=iw:h=ih:color=yellow:t=fill:enable='gte(t,1.3)'" -an -c:v libvpx -b:v 100k outgoing.webm
ffmpeg -f lavfi -i color=c=red:s=160x90:r=30:d=1.6 -vf "drawbox=x=0:y=0:w=iw:h=ih:color=lime:t=fill:enable='gte(t,0.2)'" -an -c:v libvpx -b:v 100k incoming.webm
```
