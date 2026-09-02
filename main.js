// main.js
'use strict';

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

const startButton = document.getElementById('startButton');
const connectButton = document.getElementById('connectButton');
const hangupButton = document.getElementById('hangupButton');

startButton.onclick = start;
connectButton.onclick = connect;
hangupButton.onclick = hangup;

let localStream;
let pcLocal, pcRemote;
let videoWorker, audioWorker, audioReceiverWorker, videoReceiverWorker;

// Helper sleep function
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function start() {
  console.log('Requesting local media stream (video + audio)');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;

    startButton.disabled = true;
    connectButton.disabled = false;
  } catch (e) {
    console.error('getUserMedia() failed:', e);
    alert('Could not acquire local camera/mic stream.');
  }
}

async function connect() {
  connectButton.disabled = true;
  hangupButton.disabled = false;

  console.log('Starting workers...');
  // Use timestamp query params to completely bypass browser caching for workers
  videoWorker = new Worker('video_worker.js?t=' + Date.now());
  audioWorker = new Worker('audio_worker.js?t=' + Date.now());
  audioReceiverWorker = new Worker('audio_worker_PC2_receiver_transformer.js?t=' + Date.now());
  videoReceiverWorker = new Worker('video_worker_PC2_receiver_transformer.js?t=' + Date.now());

  audioReceiverWorker.onmessage = (e) => {
    if (e.data.type === 'audioFrameReceived') {
      const indicator = document.getElementById('audioIndicator');
      if (indicator) {
        indicator.style.backgroundColor = 'lightgreen';
      }
    }
  };

  // Wait briefly for worker initialization
  await sleep(200);

  // --- Setup PeerConnection (Injected Connection via EncodedSource) ---
  console.log('Setting up PeerConnection pair...');
  pcLocal = new RTCPeerConnection();
  pcRemote = new RTCPeerConnection();

  pcRemote.ontrack = (e) => {
    console.log('Receiver: Received remote track:', e.track.kind);
    if (!remoteVideo.srcObject) {
      remoteVideo.srcObject = new MediaStream();
    }
    remoteVideo.srcObject.addTrack(e.track);

    // Apply RTCRtpScriptTransform to audio receiver
    if (e.track.kind === 'audio' && window.RTCRtpScriptTransform) {
      e.receiver.transform = new RTCRtpScriptTransform(audioReceiverWorker);
    }
    // Apply RTCRtpScriptTransform to video receiver
    if (e.track.kind === 'video' && window.RTCRtpScriptTransform) {
      e.receiver.transform = new RTCRtpScriptTransform(videoReceiverWorker);
    }
  };

  // Create sendonly transceivers on local PC to negotiate sending capabilities
  // without attaching actual hardware camera/mic tracks.
  console.log('Adding transceivers for video and audio (sendonly)...');
  const videoTransceiver = pcLocal.addTransceiver('video', { direction: 'sendonly' });
  const audioTransceiver = pcLocal.addTransceiver('audio', { direction: 'sendonly' });

  const videoSender = videoTransceiver.sender;
  const audioSender = audioTransceiver.sender;

  // Register encoded sources on senders to inject WebCodecs frames
  if (typeof videoSender.createEncodedSource === 'function' &&
      typeof audioSender.createEncodedSource === 'function') {
    console.log('Registering encoded sources on senders...');
    try {
      await videoSender.createEncodedSource(videoWorker);
      await audioSender.createEncodedSource(audioWorker);
      console.log('createEncodedSource calls succeeded.');
    } catch (err) {
      console.error('createEncodedSource registration failed:', err);
      alert('createEncodedSource failed: ' + err.message);
      return;
    }
  } else {
    console.error('RTCRtpSender.createEncodedSource is not supported in this browser.');
    alert('RTCRtpSender.createEncodedSource is not supported in this browser.');
    return;
  }

  // Negotiate PeerConnection connection
  await negotiate(pcLocal, pcRemote);
  console.log('PeerConnection connected.');

  // Extract negotiated codec parameters
  const videoCodecs = videoSender.getParameters().codecs || [];
  const audioCodecs = audioSender.getParameters().codecs || [];

  const videoCodecParam = videoCodecs[0] || { payloadType: 96, mimeType: 'video/AV1', clockRate: 90000 };
  const audioCodecParam = audioCodecs[0] || { payloadType: 111, mimeType: 'audio/opus', clockRate: 48000 };

  console.log('Negotiated video codec parameters:', videoCodecParam);
  console.log('Negotiated audio codec parameters:', audioCodecParam);

  // Setup MediaStreamTrackProcessor to feed raw frames to WebCodecs encoders in workers
  const videoTrack = localStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];

  if (typeof MediaStreamTrackProcessor !== 'function') {
    console.error('MediaStreamTrackProcessor is not supported in this browser.');
    alert('MediaStreamTrackProcessor is not supported.');
    return;
  }

  const videoProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
  const audioProcessor = new MediaStreamTrackProcessor({ track: audioTrack });

  const videoSettings = videoTrack.getSettings ? (videoTrack.getSettings() || {}) : {};

  videoWorker.postMessage({
    type: 'startEncoding',
    readable: videoProcessor.readable,
    codecParams: {
      payloadType: videoCodecParam.payloadType,
      mimeType: videoCodecParam.mimeType,
      clockRate: videoCodecParam.clockRate || 90000,
      width: videoSettings.width || 640,
      height: videoSettings.height || 480,
    }
  }, [videoProcessor.readable]);

  audioWorker.postMessage({
    type: 'startEncoding',
    readable: audioProcessor.readable,
    codecParams: {
      payloadType: audioCodecParam.payloadType,
      mimeType: audioCodecParam.mimeType,
      clockRate: audioCodecParam.clockRate || 48000,
    }
  }, [audioProcessor.readable]);

  console.log('MediaStreamTrackProcessor streams forwarded to WebCodecs encoder workers.');
}

async function negotiate(pcLocal, pcRemote) {
  pcLocal.onicecandidate = (e) => {
    if (e.candidate) {
      pcRemote.addIceCandidate(e.candidate).catch(err => console.error('Error adding ICE candidate:', err));
    }
  };
  pcRemote.onicecandidate = (e) => {
    if (e.candidate) {
      pcLocal.addIceCandidate(e.candidate).catch(err => console.error('Error adding ICE candidate:', err));
    }
  };

  const offer = await pcLocal.createOffer();
  await pcLocal.setLocalDescription(offer);
  await pcRemote.setRemoteDescription(offer);

  const answer = await pcRemote.createAnswer();
  await pcRemote.setLocalDescription(answer);
  await pcLocal.setRemoteDescription(answer);
}

function hangup() {
  console.log('Ending call and cleanup');
  
  if (pcLocal) pcLocal.close();
  if (pcRemote) pcRemote.close();
  pcLocal = pcRemote = null;

  if (videoWorker) videoWorker.terminate();
  if (audioWorker) audioWorker.terminate();
  if (audioReceiverWorker) audioReceiverWorker.terminate();
  if (videoReceiverWorker) videoReceiverWorker.terminate();
  videoWorker = audioWorker = audioReceiverWorker = videoReceiverWorker = null;

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  localVideo.srcObject = null;
  remoteVideo.srcObject = null;

  const indicator = document.getElementById('audioIndicator');
  if (indicator) {
    indicator.style.backgroundColor = 'gray';
  }

  startButton.disabled = false;
  connectButton.disabled = true;
  hangupButton.disabled = true;
}

