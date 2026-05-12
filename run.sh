#!/bin/bash

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

# Start HTML server in bg inside the sink_test directory
python3 -m http.server 8000 &
SERVER_PID=$!

# Wait a moment for server to start
sleep 1

# Start custom chrome with fake media stream flags and open the test page
"$DIR/../../chromium/src/out/Default/chrome" \
  --use-fake-device-for-media-stream \
  http://localhost:8000/

# When chrome is terminated, kill the server
kill $SERVER_PID
pkill -f "python3 -m http.server 8000"

echo "Killed http server."
