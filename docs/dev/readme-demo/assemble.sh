#!/bin/bash
# Assemble the README demo GIF from the frames + timestamps.json written by record.mjs.
#
#   docs/dev/readme-demo/assemble.sh <frames-dir> <out.gif>
set -euo pipefail
FRAMES_DIR="$(realpath "$1")"
OUT_GIF="$2"
CONCAT="$FRAMES_DIR/concat.txt"

python3 - "$FRAMES_DIR" "$CONCAT" <<'PYEOF'
import json, sys, os
frames_dir, out_path = sys.argv[1], sys.argv[2]
ts = json.load(open(os.path.join(frames_dir, "timestamps.json")))
# The live capture's wall-clock length varies with machine load (kernel round-trip jitter,
# screenshot latency), so the captured pacing is rescaled onto a fixed target length.
TARGET_MS = 8000.0
total = ts[-1]["t"] or 1
scale = TARGET_MS / total
lines = []
for i in range(len(ts)):
    dur = ((ts[i + 1]["t"] - ts[i]["t"]) if i + 1 < len(ts) else 200) * scale / 1000.0
    lines.append(f"file '{os.path.join(frames_dir, ts[i]['file'])}'")
    lines.append(f"duration {max(dur, 0.02):.4f}")
# The concat demuxer drops the last duration unless the final file is listed once more.
lines.append(f"file '{os.path.join(frames_dir, ts[-1]['file'])}'")
open(out_path, "w").write("\n".join(lines) + "\n")
print(f"captured {total / 1000:.2f}s, rescaled x{scale:.3f}; {len(ts)} frames")
PYEOF

ffmpeg -y -loglevel error -f concat -safe 0 -i "$CONCAT" \
  -vf "fps=15,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5" \
  -loop 0 "$OUT_GIF"

ls -la "$OUT_GIF"
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=width,height,nb_read_frames -show_entries format=duration \
  -of default=noprint_wrappers=1 "$OUT_GIF"
