// audio_worker.js
'use strict';

let sinkWriter = null;

// This event is triggered when PC2 sender calls createEncodedSink(audioWorker)
self.onsenderencodedsink = (event) => {
  console.log('Audio Worker: onsenderencodedsink triggered');
  try {
    const encodedSink = event.encodedSink;
    if (!encodedSink || !encodedSink.writable) {
      console.error('Audio Worker: invalid encodedSink or writable');
      return;
    }
    sinkWriter = encodedSink.writable.getWriter();
    console.log('Audio Worker: Obtained writable stream writer for PC2 audio');

    encodedSink.onkeyframerequest = (e) => {
      console.log('Audio Worker: onkeyframerequest event intercepted');
    };
    encodedSink.onbandwidthestimate = (e) => {
      console.log('Audio Worker: onbandwidthestimate event intercepted, allocatedBitrate:', encodedSink.allocatedBitrate, 'availableOutgoingBitrate:', encodedSink.availableOutgoingBitrate);
    };
    
  } catch (err) {
    console.error('Audio Worker: Error setting up encoded sink writer:', err);
  }
};

// This event is triggered when PC1 sender transform is applied
self.onrtctransform = (event) => {
  console.log('Audio Worker: onrtctransform triggered');
  const transformer = event.transformer;
  const readable = transformer.readable;
  const writable = transformer.writable;

  const transformStream = new TransformStream({
    transform(encodedFrame, controller) {
      // 1. Pass the original frame to PC1 remote receiver
      controller.enqueue(encodedFrame);

      // 2. Clone the frame and write it to PC2 sender's encoded sink
      if (sinkWriter) {
        try {
          const clonedFrame = new RTCEncodedAudioFrame(encodedFrame);
          
          sinkWriter.write(clonedFrame).catch(err => {
            console.error('Audio Worker: Error writing to PC2 sink:', err);
            clonedFrame.close();
          });
        } catch (err) {
          console.error('Audio Worker: Error cloning audio frame:', err);
        }
      }
    }
  });

  readable.pipeThrough(transformStream).pipeTo(writable);
};
