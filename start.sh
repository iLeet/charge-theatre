#!/usr/bin/env bash
# Run without Docker. Needs Node 18+ and ffmpeg on the PATH.
cd "$(dirname "$0")"
command -v node >/dev/null   || { echo "Node.js 18+ is required (https://nodejs.org)"; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (brew install ffmpeg / apt install ffmpeg)"; exit 1; }
exec node server.js
