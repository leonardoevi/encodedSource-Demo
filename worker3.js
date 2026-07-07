// worker3.js - Keyframe Requester Worker
'use strict';

let globalTransformer = null;

self.onmessage = (event) => {
  if (event.data.type === 'requestKeyframe') {
    if (globalTransformer && typeof globalTransformer.sendKeyFrameRequest === 'function') {
      console.log('PC2 Receiver: Requesting keyframe triggered by button');
      globalTransformer.sendKeyFrameRequest();
    } else {
      console.warn('PC2 Receiver: transformer.sendKeyFrameRequest is not supported or transformer is not initialized.');
    }
  }
};

self.onrtctransform = (event) => {
  const transformer = event.transformer;
  globalTransformer = transformer;
  const readable = transformer.readable;
  const writable = transformer.writable;

  const transformStream = new TransformStream({
    transform(encodedFrame, controller) {
      // Just pass the frame through
      controller.enqueue(encodedFrame);
    }
  });

  readable.pipeThrough(transformStream).pipeTo(writable);
};
