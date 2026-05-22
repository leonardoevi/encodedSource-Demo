// worker2.js - Sink Worker
'use strict';

let worker1Port = null;
let sinkWriter = null;

let dropFirstKeyFrame = false;

let dropDeltaFrames = true;
let deltaFrames = 0;
let droppedDeltaFrameInterval = 350

// Handle messages from the main thread
self.onmessage = (event) => {
  if (event.data.port) {
    console.log('Worker 2: Received port for Worker 1');
    worker1Port = event.data.port;

    // Handle frames received from Worker 1
    worker1Port.onmessage = async (e) => {
      const frame = e.data.frame;
      if (!frame) {
        console.warn('Worker 2: Received empty message or missing frame');
        return;
      }

      // drop first key frame
      if (frame.type === "key" && dropFirstKeyFrame) {
        console.log('Worker 2: Dropping first key frame >:) Timestamp: ', frame.timestamp);
        dropFirstKeyFrame = false;
        if (typeof frame.close === 'function') {
          frame.close();
        }
        return;
      }

      // drop delta frame
      if (dropDeltaFrames && frame.type === "delta") {
        deltaFrames++;
        if (deltaFrames % droppedDeltaFrameInterval === 0) {
          deltaFrames = 0;
          console.log('Worker 2: Dropping delta frame >:) Timestamp: ', frame.timestamp);
          if (typeof frame.close === 'function') {
            frame.close();
          }
          return;
        }
      }


      if (sinkWriter) {
        try {

          if (frame.type === 'key') {
            console.log('Worker 2: Writing key frame to sinkWriter, ts:', frame.timestamp);
          }

          await sinkWriter.write(frame);
        } catch (err) {
          console.error('Worker 2: Failed to write frame to sink:', err);
          if (typeof frame.close === 'function') {
            frame.close();
          }
        }
      } else {
        //console.warn('Worker 2: Received frame but sinkWriter is not ready yet. Frame lost.');
        if (typeof frame.close === 'function') {
          console.log('Worker 2: Discarding frame. Timestamp: ', frame.timestamp);
          frame.close();
        }
      }
    };
  }
};

// Handle the new encoded sink event
self.onsenderencodedsink = (event) => {
  console.log('Worker 2: onsenderencodedsink triggered', event);

  try {
    const encodedSink = event.encodedSink;
    if (!encodedSink) {
      console.error('Worker 2: event.encodedsink is missing');
      return;
    }

    const writable = encodedSink.writable;
    if (!writable) {
      console.error('Worker 2: encodedSink.writable is missing');
      return;
    }

    console.log('Worker 2: Successfully obtained writable stream');
    sinkWriter = writable.getWriter();

    encodedSink.onkeyframerequest = (e) => {
      console.log('Worker 2: onkeyframerequest event intercepted', e);
    };
  } catch (e) {
    console.error('Worker 2: Error handling onsenderencodedsink:', e);
  }
};


