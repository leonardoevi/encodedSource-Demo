// audio_worker.js
'use strict';

let sinkWriter = null;

// This event is triggered when PC2 sender calls createEncodedSource(audioWorker)
self.onsenderencodedsource = (event) => {
  console.log('Audio Worker: onsenderencodedsource triggered');
  try {
    const encodedSource = event.encodedSource;
    if (!encodedSource || !encodedSource.writable) {
      console.error('Audio Worker: invalid encodedSource or writable');
      return;
    }
    sinkWriter = encodedSource.writable.getWriter();
    console.log('Audio Worker: Obtained writable stream writer for PC2 audio');

    encodedSource.onkeyframerequest = (e) => {
      console.log('Audio Worker: onkeyframerequest event intercepted');
    };
    encodedSource.onbitrateinfochange = (e) => {
      console.log('Audio Worker: onbitrateinfochange event intercepted, allocatedBitrate:', encodedSource.allocatedBitrate, 'availableOutgoingBitrate:', encodedSource.availableOutgoingBitrate);
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
