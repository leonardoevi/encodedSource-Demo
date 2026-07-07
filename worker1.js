// worker1.js - Interceptor Worker
'use strict';

// Configurable buffer size in number of frames (60 frames = ~3 seconds at 20fps)
const BUFFER_FRAMES = 60;

let worker2Port = null;

// Handle messages from the main thread
self.onmessage = (event) => {
  if (event.data.port) {
    //console.log('Worker 1: Received port for Worker 2');
    worker2Port = event.data.port;
    worker2Port.onmessage = (e) => {
      //console.log('Worker 1: Received message from Worker 2:', e.data);
    };
  }
};

// Handle the transform
self.onrtctransform = (event) => {
  //console.log('Worker 1: onrtctransform triggered');
  const transformer = event.transformer;
  const readable = transformer.readable;
  const writable = transformer.writable;

  const frameQueue = [];

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

        // 2. Pass the ORIGINAL frame through to PC1 immediately
        controller.enqueue(encodedFrame);

        // 3. Buffer the CLONED frame
        frameQueue.push(clonedFrame);

        // 4. If the queue length exceeds BUFFER_FRAMES, send the oldest frame
        if (frameQueue.length > BUFFER_FRAMES) {
          const frameToSend = frameQueue.shift();
          try {
            worker2Port.postMessage({ frame: frameToSend });
          } catch (err) {
            console.error('Worker 1: Failed to send buffered frame:', err);
          } finally {
            if (typeof frameToSend.close === 'function') {
              frameToSend.close();
            }
          }
        }
      } catch (e) {
        console.error('Worker 1: Failed to clone or send frame:', e);
      }
    }
  });

  readable.pipeThrough(transformStream).pipeTo(writable);
};
