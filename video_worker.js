// video_worker.js
'use strict';

let sinkWriter = null;
let resolveSinkWriter;
const sinkWriterPromise = new Promise(resolve => {
  resolveSinkWriter = resolve;
});

let keyFrameRequested = true;
let videoEncoder = null;
let currentWidth = 0;
let currentHeight = 0;
let currentBitrate = 2_000_000;
let selectedCodec = 'av01.0.04M.08';

// This event is triggered when RTCRtpSender.createEncodedSource(videoWorker) is called
self.onrtcsenderencodedsource = (event) => {
  console.log('Video Worker: onrtcsenderencodedsource triggered');
  const encodedSource = event.encodedSource;
  if (!encodedSource) {
    throw new Error('Video Worker: event.encodedSource is missing');
  }
  if (!encodedSource.writable) {
    throw new Error('Video Worker: encodedSource.writable stream is missing');
  }

  sinkWriter = encodedSource.writable.getWriter();
  resolveSinkWriter(sinkWriter);
  console.log('Video Worker: Obtained writable stream writer for encoded video');

  // Handle key frame requests from receiver (e.g. PLI/FIR RTCP feedback)
  encodedSource.onkeyframerequest = (e) => {
    console.log('Video Worker: onkeyframerequest event intercepted -> requesting key frame');
    keyFrameRequested = true;
    self.postMessage({
      type: 'keyframeRequested',
    });
  };

  // Handle bandwidth / bitrate change notifications
  encodedSource.onbitrateinfochange = (e) => {
    console.log('Video Worker: onbitrateinfochange event intercepted:',
      'allocatedBitrate:', encodedSource.allocatedBitrate,
      'availableOutgoingBitrate:', encodedSource.availableOutgoingBitrate);

    self.postMessage({
      type: 'bitrateInfo',
      allocatedBitrate: encodedSource.allocatedBitrate,
      availableOutgoingBitrate: encodedSource.availableOutgoingBitrate,
    });

    if (encodedSource.allocatedBitrate && videoEncoder && videoEncoder.state === 'configured') {
      currentBitrate = encodedSource.allocatedBitrate;
      try {
        videoEncoder.configure({
          codec: selectedCodec,
          width: currentWidth,
          height: currentHeight,
          bitrate: currentBitrate,
          framerate: 30,
          latencyMode: 'realtime',
        });
        console.log('Video Worker: Reconfigured VideoEncoder with new bitrate:', currentBitrate);
      } catch (err) {
        console.error('Video Worker: Failed to reconfigure encoder bitrate:', err);
      }
    }
  };
};

// Helper to determine best matching WebCodecs video codec string
async function resolveVideoCodec(mimeType, width, height) {
  if (!mimeType) {
    throw new Error('Video Worker: mimeType is required to resolve video codec');
  }
  const mime = mimeType.toLowerCase();
  if (mime.includes('av1')) {
    const candidates = ['av01.0.04M.08', 'av01.0.00M.08'];
    for (const cand of candidates) {
      try {
        const support = await VideoEncoder.isConfigSupported({ codec: cand, width, height });
        if (support.supported) return cand;
      } catch (_) {}
    }
    return 'av01.0.04M.08';
  }
  if (mime.includes('vp8')) {
    return 'vp8';
  }
  if (mime.includes('vp9')) {
    return 'vp09.00.10.08';
  }
  if (mime.includes('h264')) {
    return 'avc1.42001f';
  }
  if (mime.includes('avc')) {
    return 'avc1.42001f';
  }
  throw new Error(`Video Worker: Unsupported video mimeType: ${mimeType}`);
}

// Receive MediaStreamTrackProcessor readable stream and codec parameters from main thread
self.onmessage = async (e) => {
  const { type, readable, codecParams } = e.data;
  if (type !== 'startEncoding') {
    return;
  }

  console.log('Video Worker: Received startEncoding request with params:', codecParams);

  if (!codecParams) {
    throw new Error('Video Worker: codecParams is missing from startEncoding message');
  }
  if (codecParams.payloadType === undefined) {
    throw new Error('Video Worker: codecParams.payloadType is missing');
  }
  if (!codecParams.mimeType) {
    throw new Error('Video Worker: codecParams.mimeType is missing');
  }
  if (!codecParams.clockRate) {
    throw new Error('Video Worker: codecParams.clockRate is missing');
  }
  if (!codecParams.width) {
    throw new Error('Video Worker: codecParams.width is missing');
  }
  if (!codecParams.height) {
    throw new Error('Video Worker: codecParams.height is missing');
  }
  if (!readable) {
    throw new Error('Video Worker: readable stream is missing from startEncoding message');
  }

  currentWidth = codecParams.width;
  currentHeight = codecParams.height;

  // Wait for encodedSource writable sink to be ready
  await sinkWriterPromise;
  console.log('Video Worker: Sink writer is ready, initializing WebCodecs VideoEncoder...');

  const reader = readable.getReader();
  let frameCount = 0;
  let encoderConfigured = false;

  // Initialize WebCodecs VideoEncoder
  videoEncoder = new VideoEncoder({
    output: (chunk, metadata) => {
      if (!sinkWriter) {
        throw new Error('Video Worker: sinkWriter is not ready, cannot write frame');
      }

      if (metadata && metadata.decoderConfig) {
        if (metadata.decoderConfig.codedWidth) currentWidth = metadata.decoderConfig.codedWidth;
        if (metadata.decoderConfig.codedHeight) currentHeight = metadata.decoderConfig.codedHeight;
      }

      try {
        const buffer = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buffer);

        // WebCodecs chunk.timestamp is in microseconds.
        // WebRTC video RTP timestamp at 90 kHz clock rate = (timestamp * 90000 / 1000000) = (timestamp * 9 / 100)
        const clockRate = codecParams.clockRate;
        const rtpTimestamp = Math.floor((chunk.timestamp * clockRate) / 1000000) >>> 0;

        if (!currentWidth) {
          throw new Error('Video Worker: currentWidth is not set');
        }
        if (!currentHeight) {
          throw new Error('Video Worker: currentHeight is not set');
        }

        const frameInit = {
          type: chunk.type,
          payloadType: codecParams.payloadType,
          rtpTimestampWithoutOffset: rtpTimestamp,
          data: buffer,
          mimeType: codecParams.mimeType,
          timestamp: chunk.timestamp,
          captureTime: performance.now(),
          contributingSources: [],
          width: currentWidth,
          height: currentHeight,
        };

        const rtcFrame = new RTCEncodedVideoFrame(frameInit);

        sinkWriter.write(rtcFrame).catch(err => {
          console.error('Video Worker: Error writing RTCEncodedVideoFrame to sink:', err);
          if (rtcFrame && typeof rtcFrame.close === 'function') {
            rtcFrame.close();
          }
        });
      } catch (err) {
        console.error('Video Worker: Error constructing/injecting RTCEncodedVideoFrame:', err);
        throw err;
      }
    },
    error: (err) => {
      console.error('Video Worker: VideoEncoder error:', err);
    }
  });

  // Read raw VideoFrames from MediaStreamTrackProcessor
  try {
    while (true) {
      const { done, value: videoFrame } = await reader.read();
      if (done) {
        console.log('Video Worker: MediaStreamTrackProcessor stream finished');
        break;
      }

      let frameWidth = videoFrame.displayWidth;
      if (!frameWidth) {
        frameWidth = videoFrame.codedWidth;
      }
      if (!frameWidth) {
        frameWidth = currentWidth;
      }
      if (!frameWidth) {
        throw new Error('Video Worker: Unable to determine video frame width');
      }
      currentWidth = frameWidth;

      let frameHeight = videoFrame.displayHeight;
      if (!frameHeight) {
        frameHeight = videoFrame.codedHeight;
      }
      if (!frameHeight) {
        frameHeight = currentHeight;
      }
      if (!frameHeight) {
        throw new Error('Video Worker: Unable to determine video frame height');
      }
      currentHeight = frameHeight;

      if (!encoderConfigured) {
        selectedCodec = await resolveVideoCodec(codecParams.mimeType, currentWidth, currentHeight);

        videoEncoder.configure({
          codec: selectedCodec,
          width: currentWidth,
          height: currentHeight,
          bitrate: currentBitrate,
          framerate: 30,
          latencyMode: 'realtime',
        });
        encoderConfigured = true;
        console.log(`Video Worker: VideoEncoder configured with ${selectedCodec} (${currentWidth}x${currentHeight})`);
      }

      // Request key frame initially or periodically (every 150 frames ~ 5s) or on PLI
      let forceKey = false;
      if (keyFrameRequested) {
        forceKey = true;
      } else if (frameCount % 150 === 0) {
        forceKey = true;
      }
      keyFrameRequested = false;
      frameCount++;

      videoEncoder.encode(videoFrame, { keyFrame: forceKey });
      videoFrame.close();
    }
  } catch (err) {
    console.error('Video Worker: Error reading video frames from stream:', err);
    throw err;
  }
};
