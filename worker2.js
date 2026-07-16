// worker2.js - Sink Worker
'use strict';

let worker1Port = null;
let sinkWriter = null;

let dropNextFrame = false;

let injectOnce = false
let stopInjection = false;

let dropAllFrames = false;

// Handle messages from the main thread
self.onmessage = (event) => {
  if (event.data.type === 'dropNextFrame') {
    dropNextFrame = true;
    console.log('Worker 2: Scheduled to drop the next frame.');
    return;
  }

  if (event.data.dropAllFrames !== undefined) {
    dropAllFrames = event.data.dropAllFrames;
    console.log('Worker 2: dropAllFrames toggled to', dropAllFrames);
    return;
  }

  if (event.data.port) {
    //console.log('Worker 2: Received port for Worker 1');
    worker1Port = event.data.port;

    // Handle frames received from Worker 1
    worker1Port.onmessage = async (e) => {
      const frame = e.data.frame;
      if (!frame) {
        console.warn('Worker 2: Received empty message or missing frame');
        return;
      }

      if (dropAllFrames) {
        if (typeof frame.close === 'function') {
          frame.close();
        }
        return;
      }

      if (dropNextFrame) {
        dropNextFrame = false;
        
        let metadata = {};
        try {
          if (typeof frame.getMetadata === 'function') {
            metadata = frame.getMetadata();
          }
        } catch (err) {
          console.error('Worker 2: Error getting metadata:', err);
        }

        console.log('Worker 2: Dropping frame >:)', {
          timestamp: frame.timestamp,
          type: frame.type,
          byteLength: frame.data ? frame.data.byteLength : 0,
          metadata: metadata
        });

        if (typeof frame.close === 'function') {
          frame.close();
        }
        
        // Let the main thread know we dropped the frame so it can reset the button
        self.postMessage({ type: 'frameDropped' });
        return;
      }

      if (stopInjection) {
          if (typeof frame.close === 'function') {
          frame.close();
        }
        return;
      }

      if (injectOnce) {
        stopInjection = true;
        console.log('Worker 2: Injecting first frame, dropping all subsequent frames. Timestamp: ', frame.timestamp);
        injectOnce = false;
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
        console.warn('Worker 2: Received frame but sinkWriter is not ready yet. Frame lost.');
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

    encodedSink.onbandwidthestimate = (e) => {
      console.log('Worker 2: onbandwidthestimate event intercepted, allocatedBitrate:', encodedSink.allocatedBitrate, 'availableOutgoingBitrate:', encodedSink.availableOutgoingBitrate);
    };
  } catch (e) {
    console.error('Worker 2: Error handling onsenderencodedsink:', e);
  }
};

// Handle the transform (compatibility test)
self.onrtctransform = (event) => {
  console.log('Worker 2: onrtctransform triggered');
  const transformer = event.transformer;
  const readable = transformer.readable;
  const writable = transformer.writable;

  let transformFrameCount = 0;

  const transformStream = new TransformStream({
    transform(encodedFrame, controller) {
      transformFrameCount++;
      if (transformFrameCount % 30 === 0) {
        try {
          const metadata = encodedFrame.getMetadata();
          //console.log(`Worker 2 Transform: Frame #${transformFrameCount}, rtpTimestamp: ${metadata ? metadata.rtpTimestamp : 'unknown'}`);
        } catch (e) {
          console.error('Worker 2 Transform: Failed to get metadata:', e);
        }
      }
      controller.enqueue(encodedFrame);
    }
  });

  readable.pipeThrough(transformStream).pipeTo(writable);
};


