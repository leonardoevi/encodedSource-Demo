// video_worker.js
'use strict';

let sinkWriter = null;

// This event is triggered when PC2 sender calls createEncodedSource(videoWorker)
self.onsenderencodedsource = (event) => {
  console.log('Video Worker: onsenderencodedsource triggered');
  try {
    const encodedSource = event.encodedSource;
    if (!encodedSource || !encodedSource.writable) {
      console.error('Video Worker: invalid encodedSource or writable');
      return;
    }
    sinkWriter = encodedSource.writable.getWriter();
    console.log('Video Worker: Obtained writable stream writer for PC2 video');

    encodedSource.onkeyframerequest = (e) => {
      console.log('Video Worker: onkeyframerequest event intercepted');
    };
    encodedSource.onbitrateinfochange = (e) => {
      console.log('Video Worker: onbitrateinfochange event intercepted, allocatedBitrate:', encodedSource.allocatedBitrate, 'availableOutgoingBitrate:', encodedSource.availableOutgoingBitrate);
    };

  } catch (err) {
    console.error('Video Worker: Error setting up encoded sink writer:', err);
  }
};

// This event is triggered when PC1 sender transform is applied
self.onrtctransform = (event) => {
  console.log('Video Worker: onrtctransform triggered');
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
          const clonedFrame = new RTCEncodedVideoFrame(encodedFrame);
          
          sinkWriter.write(clonedFrame).catch(err => {
            console.error('Video Worker: Error writing to PC2 sink:', err);
            clonedFrame.close();
          });
        } catch (err) {
          console.error('Video Worker: Error cloning video frame:', err);
        }
      }
    }
  });

  readable.pipeThrough(transformStream).pipeTo(writable);
};
