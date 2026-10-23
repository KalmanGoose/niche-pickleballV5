#!/bin/sh

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

PORT=8084
URL="http://127.0.0.1:$PORT/tools/coach-goose-studio.html"
python3 -m http.server "$PORT" --bind 127.0.0.1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT HUP INT TERM

sleep 1
open "$URL"
wait "$SERVER_PID"
