// audio_worker_PC2_receiver_transformer.js
'use strict';

let lastMessageTime = 0;

self.onrtctransform = (event) => {
  const transformer = event.transformer;
  const readable = transformer.readable;
  const writable = transformer.writable;

  const transformStream = new TransformStream({
    transform(encodedFrame, controller) {
      // Pass the frame through to the decoder
      controller.enqueue(encodedFrame);

      // Throttle message postings to at most once every 100ms
      const now = Date.now();
      if (now - lastMessageTime > 100) {
        self.postMessage({ type: 'audioFrameReceived' });
        lastMessageTime = now;
      }
    }
  });

  readable.pipeThrough(transformStream).pipeTo(writable);
};
