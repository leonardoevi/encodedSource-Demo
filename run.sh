#!/bin/bash
echo "DISABLED SCRIPT"
exit 0

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR" || exit 1

# --- CLEANUP FUNCTION ---
# This function triggers automatically whenever the script exits
cleanup() {
  echo "Stopping Python HTTP server..."
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" 2>/dev/null
  fi
  # macOS specific backup kill using network port tracking
  lsof -ti :8000 | xargs kill -9 2>/dev/null
  echo "Cleaned up."
}

# Trap exit signals (Ctrl+C, normal exit, terminal close) and run cleanup
trap cleanup EXIT INT TERM

# Start HTML server in bg inside the sink_test directory
python3 server.py 8000 &
SERVER_PID=$!

# Wait a moment for server to start
sleep 1

# Start custom chrome with fake media stream flags and open the test page
"$DIR/../../chromium/src/out/Default/Chromium.app/Contents/MacOS/Chromium" \
  --user-data-dir="$DIR/chrome_dev_profile" \
  --no-first-run \
  --use-fake-device-for-media-stream \
  --enable-logging=stderr \
  --log-level=0 \
  --disable-http-cache \
  http://localhost:8000/

# --vmodule=*/webrtc/video/*=2,*/webrtc/modules/video_coding/*=2,*/webrtc/modules/rtp_rtcp/*=1 \
#   --auto-open-devtools-for-tabs \