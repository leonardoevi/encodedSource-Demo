// video_worker_PC2_receiver_transformer.js
'use strict';

let currentTransformer = null;

self.onrtctransform = (event) => {
  const transformer = event.transformer;
  if (!transformer) {
    throw new Error('video_worker_PC2_receiver_transformer: event.transformer is missing');
  }
  currentTransformer = transformer;

  const readable = transformer.readable;
  if (!readable) {
    throw new Error('video_worker_PC2_receiver_transformer: transformer.readable is missing');
  }
  const writable = transformer.writable;
  if (!writable) {
    throw new Error('video_worker_PC2_receiver_transformer: transformer.writable is missing');
  }

  const transformStream = new TransformStream({
    transform(encodedFrame, controller) {
      // Just pass the frame through to the decoder
      controller.enqueue(encodedFrame);
    }
  });

  readable.pipeThrough(transformStream).pipeTo(writable);
};

self.onmessage = async (event) => {
  if (!event.data) {
    return;
  }
  if (event.data.type === 'requestKeyframe') {
    if (!currentTransformer) {
      throw new Error('video_worker_PC2_receiver_transformer: No active RTCRtpScriptTransformer available to request keyframe');
    }
    if (typeof currentTransformer.sendKeyFrameRequest !== 'function') {
      throw new Error('video_worker_PC2_receiver_transformer: sendKeyFrameRequest is not supported on RTCRtpScriptTransformer');
    }
    try {
      console.log('video_worker_PC2_receiver_transformer: Calling transformer.sendKeyFrameRequest()...');
      await currentTransformer.sendKeyFrameRequest();
      console.log('video_worker_PC2_receiver_transformer: sendKeyFrameRequest() resolved successfully');
      self.postMessage({ type: 'keyframeRequestSent', success: true });
    } catch (err) {
      console.error('video_worker_PC2_receiver_transformer: sendKeyFrameRequest() failed:', err);
      self.postMessage({ type: 'keyframeRequestSent', success: false, error: err.message });
      throw new Error('sendKeyFrameRequest failed: ' + err.message);
    }
  }
};
