// worker1.js - Interceptor Worker
'use strict';

let worker2Port = null;

// Handle messages from the main thread
self.onmessage = (event) => {
  if (event.data.port) {
    console.log('Worker 1: Received port for Worker 2');
    worker2Port = event.data.port;
    worker2Port.onmessage = (e) => {
      console.log('Worker 1: Received message from Worker 2:', e.data);
    };
  }
};

// Handle the transform
self.onrtctransform = (event) => {
  console.log('Worker 1: onrtctransform triggered');
  const transformer = event.transformer;
  const readable = transformer.readable;
  const writable = transformer.writable;

  const transformStream = new TransformStream({
    transform(encodedFrame, controller) {
      if (!worker2Port) {
        console.warn('Worker 1: Message port to Worker 2 not established yet');
        controller.enqueue(encodedFrame);
        return;
      }

      try {
        // 1. Clone the frame for Worker 2
        // @ts-ignore
        const clonedFrame = new RTCEncodedVideoFrame(encodedFrame);
        
        //console.log('Worker 1: clonedFrame.close type is:', typeof clonedFrame.close);

        // 2. Pass the ORIGINAL frame through to PC1
        controller.enqueue(encodedFrame);

        //console.log('Worker 1: Enqueued original, sending clone, ts:', encodedFrame.timestamp);

        // 3. Send the CLONED frame to Worker 2 (without transferring)
        worker2Port.postMessage({ frame: clonedFrame });

        // 4. Safely close the clone in Worker 1 if supported
        if (typeof clonedFrame.close === 'function') {
          clonedFrame.close();
        }
      } catch (e) {
        console.error('Worker 1: Failed to clone or send frame:', e);
      }
    }
  });

  readable.pipeThrough(transformStream).pipeTo(writable);
};
