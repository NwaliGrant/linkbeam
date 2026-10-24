#!/bin/sh
# Joins the demo frames made by the browser test into docs/media/demo.gif (needs ffmpeg).
# Run:  pnpm exec playwright test stage7-screens.spec.ts -g "demo"  (from tests/e2e), then:  sh scripts/make-demo-gif.sh
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
frames="$root/docs/evidence/stage7/demo-frames"
mkdir -p "$root/docs/media"
cd "$frames"
ffmpeg -y -loglevel error -f concat -safe 0 -i frames.txt \
  -vf "fps=10,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 "$root/docs/media/demo.gif"
ls -l "$root/docs/media/demo.gif"
