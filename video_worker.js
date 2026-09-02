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
  try {
    const encodedSource = event.encodedSource;
    if (!encodedSource || !encodedSource.writable) {
      console.error('Video Worker: Invalid encodedSource or writable stream');
      return;
    }

    sinkWriter = encodedSource.writable.getWriter();
    resolveSinkWriter(sinkWriter);
    console.log('Video Worker: Obtained writable stream writer for encoded video');

    // Handle key frame requests from receiver (e.g. PLI/FIR RTCP feedback)
    encodedSource.onkeyframerequest = (e) => {
      console.log('Video Worker: onkeyframerequest event intercepted -> requesting key frame');
      keyFrameRequested = true;
    };

    // Handle bandwidth / bitrate change notifications
    encodedSource.onbitrateinfochange = (e) => {
      console.log('Video Worker: onbitrateinfochange event intercepted:',
        'allocatedBitrate:', encodedSource.allocatedBitrate,
        'availableOutgoingBitrate:', encodedSource.availableOutgoingBitrate);

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

  } catch (err) {
    console.error('Video Worker: Error setting up encoded source writer:', err);
  }
};

// Helper to determine best matching WebCodecs video codec string
async function resolveVideoCodec(mimeType, width, height) {
  const mime = (mimeType || '').toLowerCase();
  if (mime.includes('av1')) {
    const candidates = ['av01.0.04M.08', 'av01.0.00M.08'];
    for (const cand of candidates) {
      try {
        const support = await VideoEncoder.isConfigSupported({ codec: cand, width, height });
        if (support.supported) return cand;
      } catch (_) {}
    }
    return 'av01.0.04M.08';
  } else if (mime.includes('vp8')) {
    return 'vp8';
  } else if (mime.includes('vp9')) {
    return 'vp09.00.10.08';
  } else if (mime.includes('h264') || mime.includes('avc')) {
    return 'avc1.42001f';
  }
  return 'av01.0.04M.08';
}

// Receive MediaStreamTrackProcessor readable stream and codec parameters from main thread
self.onmessage = async (e) => {
  const { type, readable, codecParams } = e.data;
  if (type !== 'startEncoding') {
    return;
  }

  console.log('Video Worker: Received startEncoding request with params:', codecParams);

  if (codecParams && codecParams.width) currentWidth = codecParams.width;
  if (codecParams && codecParams.height) currentHeight = codecParams.height;

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
        console.warn('Video Worker: sinkWriter is not ready, dropping frame');
        return;
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
        const clockRate = (codecParams && codecParams.clockRate) || 90000;
        const rtpTimestamp = Math.floor((chunk.timestamp * clockRate) / 1000000) >>> 0;

        const width = currentWidth || (codecParams && codecParams.width) || 640;
        const height = currentHeight || (codecParams && codecParams.height) || 480;

        // Construct RTCEncodedVideoFrame using the web-exposed constructor:
        // dictionary RTCEncodedVideoFrameInit {
        //     required RTCEncodedVideoFrameType type;
        //     required octet payloadType;
        //     required unsigned long rtpTimestampWithoutOffset;
        //     required ArrayBuffer data;
        //     [RuntimeEnabled=RTCEncodedFrameTimestamps] DOMHighResTimeStamp captureTime;
        //     sequence<unsigned long> contributingSources = [];
        //     required DOMString mimeType;
        //     long long timestamp;    // microseconds
        //     required unsigned short width;
        //     required unsigned short height;
        // };
        const frameInit = {
          type: chunk.type,
          payloadType: (codecParams && codecParams.payloadType) || 96,
          rtpTimestampWithoutOffset: rtpTimestamp,
          data: buffer,
          mimeType: (codecParams && codecParams.mimeType) || 'video/AV1',
          timestamp: chunk.timestamp,
          captureTime: performance.now(),
          contributingSources: [],
          width: width,
          height: height,
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

      currentWidth = videoFrame.displayWidth || videoFrame.codedWidth || currentWidth || 640;
      currentHeight = videoFrame.displayHeight || videoFrame.codedHeight || currentHeight || 480;

      if (!encoderConfigured) {
        selectedCodec = await resolveVideoCodec(codecParams ? codecParams.mimeType : '', currentWidth, currentHeight);

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
      const forceKey = keyFrameRequested || (frameCount % 150 === 0);
      keyFrameRequested = false;
      frameCount++;

      videoEncoder.encode(videoFrame, { keyFrame: forceKey });
      videoFrame.close();
    }
  } catch (err) {
    console.error('Video Worker: Error reading video frames from stream:', err);
  }
};
