#!/bin/bash

kill -9 $(lsof -t -i:8000)

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Start HTML server in bg inside the sink_test directory
python3 -m http.server 8000 &
SERVER_PID=$!

# Wait a moment for server to start
sleep 1

# Clean up cache directories while preserving user Preferences (DevTools size/docking)
rm -rf "$DIR/chrome_dev_profile/Default/Cache" "$DIR/chrome_dev_profile/Default/Code Cache" "$DIR/chrome_dev_profile/Default/Storage" "$DIR/chrome_dev_profile/Default/Service Worker"

# Start custom chrome with fake media stream flags and open the test page
"$DIR/../../chromium/src/out/Default/Chromium.app/Contents/MacOS/Chromium" \
  --user-data-dir="$DIR/chrome_dev_profile" \
  --no-first-run \
  --auto-open-devtools-for-tabs \
  --window-size=2400,900 \
  --use-fake-device-for-media-stream \
  --enable-logging=stderr \
  --log-level=0 \
  --disable-http-cache \
  http://localhost:8000/

# When chrome is terminated, kill the server
kill $SERVER_PID
pkill -f "python3 -m http.server 8000"
kill -9 $(lsof -t -i:8000)

echo "Killed http server."
