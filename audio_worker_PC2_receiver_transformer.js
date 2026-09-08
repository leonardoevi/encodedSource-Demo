// audio_worker_PC2_receiver_transformer.js
'use strict';

self.onrtctransform = (event) => {
  const transformer = event.transformer;
  const readable = transformer.readable;
  const writable = transformer.writable;

  const transformStream = new TransformStream({
    transform(encodedFrame, controller) {
      // Pass the frame through to the decoder
      controller.enqueue(encodedFrame);
    }
  });

  readable.pipeThrough(transformStream).pipeTo(writable);
};
