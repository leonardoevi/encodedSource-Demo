// worker4.js - Keyframe Requester Worker for PC1
'use strict';

let globalTransformer = null;

self.onmessage = (event) => {
  if (event.data.type === 'requestKeyframe') {
    if (globalTransformer && typeof globalTransformer.sendKeyFrameRequest === 'function') {
      console.log('PC1 Receiver: Requesting keyframe triggered by button');
      globalTransformer.sendKeyFrameRequest();
    } else {
      console.warn('PC1 Receiver: transformer.sendKeyFrameRequest is not supported or transformer is not initialized.');
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
