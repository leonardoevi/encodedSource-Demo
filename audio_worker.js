// audio_worker.js
'use strict';

let sinkWriter = null;
let resolveSinkWriter;
const sinkWriterPromise = new Promise(resolve => {
  resolveSinkWriter = resolve;
});

let audioEncoder = null;
let sampleRate = 48000;
let numberOfChannels = 2;
let currentBitrate = 64000;

// This event is triggered when RTCRtpSender.createEncodedSource(audioWorker) is called
self.onrtcsenderencodedsource = (event) => {
  console.log('Audio Worker: onrtcsenderencodedsource triggered');
  try {
    const encodedSource = event.encodedSource;
    if (!encodedSource || !encodedSource.writable) {
      console.error('Audio Worker: Invalid encodedSource or writable stream');
      return;
    }

    sinkWriter = encodedSource.writable.getWriter();
    resolveSinkWriter(sinkWriter);
    console.log('Audio Worker: Obtained writable stream writer for encoded audio');

    encodedSource.onbitrateinfochange = (e) => {
      console.log('Audio Worker: onbitrateinfochange event intercepted:',
        'allocatedBitrate:', encodedSource.allocatedBitrate,
        'availableOutgoingBitrate:', encodedSource.availableOutgoingBitrate);

      if (encodedSource.allocatedBitrate && audioEncoder && audioEncoder.state === 'configured') {
        currentBitrate = encodedSource.allocatedBitrate;
        try {
          audioEncoder.configure({
            codec: 'opus',
            sampleRate: sampleRate,
            numberOfChannels: numberOfChannels,
            bitrate: currentBitrate,
          });
          console.log('Audio Worker: Reconfigured AudioEncoder with new bitrate:', currentBitrate);
        } catch (err) {
          console.error('Audio Worker: Failed to reconfigure audio encoder bitrate:', err);
        }
      }
    };

  } catch (err) {
    console.error('Audio Worker: Error setting up encoded source writer:', err);
  }
};

// Receive MediaStreamTrackProcessor readable stream and codec parameters from main thread
self.onmessage = async (e) => {
  const { type, readable, codecParams } = e.data;
  if (type !== 'startEncoding') {
    return;
  }

  console.log('Audio Worker: Received startEncoding request with params:', codecParams);

  // Wait for encodedSource writable sink to be ready
  await sinkWriterPromise;
  console.log('Audio Worker: Sink writer is ready, initializing WebCodecs AudioEncoder...');

  const reader = readable.getReader();
  let encoderConfigured = false;

  // Initialize WebCodecs AudioEncoder
  audioEncoder = new AudioEncoder({
    output: (chunk, metadata) => {
      if (!sinkWriter) {
        console.warn('Audio Worker: sinkWriter is not ready, dropping frame');
        return;
      }

      try {
        const buffer = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buffer);

        // WebCodecs chunk.timestamp is in microseconds.
        // WebRTC audio RTP timestamp at clock rate (typically 48kHz for Opus) = (timestamp * clockRate / 1000000)
        const clockRate = (codecParams && codecParams.clockRate) || 48000;
        const rtpTimestamp = Math.floor((chunk.timestamp * clockRate) / 1000000) >>> 0;

        // Construct RTCEncodedAudioFrame using the web-exposed constructor:
        // dictionary RTCEncodedAudioFrameInit {
        //     RTCAudioContentType contentType = "speech";
        //     required octet payloadType;
        //     required unsigned long rtpTimestampWithoutOffset;
        //     required ArrayBuffer data;
        //     [RuntimeEnabled=RTCEncodedFrameTimestamps] DOMHighResTimeStamp captureTime;
        //     sequence<unsigned long> contributingSources = [];
        //     DOMString mimeType;
        //     [RuntimeEnabled=RTCEncodedFrameAudioLevel] double audioLevel;
        // };
        const frameInit = {
          contentType: 'speech',
          payloadType: (codecParams && codecParams.payloadType) || 111,
          rtpTimestampWithoutOffset: rtpTimestamp,
          data: buffer,
          mimeType: (codecParams && codecParams.mimeType) || 'audio/opus',
          captureTime: performance.now(),
          contributingSources: [],
        };

        const rtcFrame = new RTCEncodedAudioFrame(frameInit);

        sinkWriter.write(rtcFrame).catch(err => {
          console.error('Audio Worker: Error writing RTCEncodedAudioFrame to sink:', err);
          if (rtcFrame && typeof rtcFrame.close === 'function') {
            rtcFrame.close();
          }
        });
      } catch (err) {
        console.error('Audio Worker: Error constructing/injecting RTCEncodedAudioFrame:', err);
      }
    },
    error: (err) => {
      console.error('Audio Worker: AudioEncoder error:', err);
    }
  });

  // Read raw AudioData from MediaStreamTrackProcessor
  try {
    while (true) {
      const { done, value: audioData } = await reader.read();
      if (done) {
        console.log('Audio Worker: MediaStreamTrackProcessor stream finished');
        break;
      }

      if (!encoderConfigured) {
        sampleRate = audioData.sampleRate || 48000;
        numberOfChannels = audioData.numberOfChannels || 2;

        audioEncoder.configure({
          codec: 'opus',
          sampleRate: sampleRate,
          numberOfChannels: numberOfChannels,
          bitrate: currentBitrate,
        });
        encoderConfigured = true;
        console.log(`Audio Worker: AudioEncoder configured with opus (${sampleRate}Hz, ${numberOfChannels}ch)`);
      }

      audioEncoder.encode(audioData);
      audioData.close();
    }
  } catch (err) {
    console.error('Audio Worker: Error reading audio frames from stream:', err);
  }
};
