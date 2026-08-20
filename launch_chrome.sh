#!/bin/bash

# Get the directory of this script
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR" || exit 1

# Start custom chrome with fake media stream flags and open the test page
"$DIR/../../chromium/src/out/Default/Chromium.app/Contents/MacOS/Chromium" \
  --user-data-dir="$DIR/chrome_dev_profile" \
  --no-first-run \
  --use-fake-ui-for-media-stream \
  --disable-http-cache \
  --auto-open-devtools-for-tabs \
  --enable-blink-features=RTCEncodedSource \
  http://localhost:8000/

  #--use-fake-device-for-media-stream \
