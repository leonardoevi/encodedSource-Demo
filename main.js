// main.js
'use strict';

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const audioBitrate = document.getElementById('audioBitrate');
const videoBitrate = document.getElementById('videoBitrate');
const keyframeNotice = document.getElementById('keyframeNotice');

const startButton = document.getElementById('startButton');
const connectButton = document.getElementById('connectButton');
const hangupButton = document.getElementById('hangupButton');
const requestKeyframeButton = document.getElementById('requestKeyframeButton');

startButton.onclick = start;
connectButton.onclick = connect;
hangupButton.onclick = hangup;
requestKeyframeButton.onclick = requestKeyframe;

let localStream;
let pcLocal, pcRemote;
let videoWorker, audioWorker, audioReceiverWorker, videoReceiverWorker;

// Helper sleep function
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

let keyframeTimeout = null;
function showKeyframeNotice() {
  if (!keyframeNotice) {
    return;
  }
  const timeStr = new Date().toLocaleTimeString();
  keyframeNotice.textContent = `Keyframe requested at ${timeStr}`;
  keyframeNotice.style.transition = 'none';
  keyframeNotice.style.opacity = '1';

  if (keyframeTimeout) {
    clearTimeout(keyframeTimeout);
  }
  keyframeTimeout = setTimeout(() => {
    keyframeNotice.style.transition = 'opacity 2s ease-out';
    keyframeNotice.style.opacity = '0';
  }, 1000);
}

function formatBitrate(val) {
  if (val === undefined) {
    return '-';
  }
  if (val === null) {
    return '-';
  }
  return `${Number(val).toLocaleString()} bps`;
}

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

  videoWorker.onmessage = (e) => {
    if (e.data.type === 'bitrateInfo') {
      const allocated = formatBitrate(e.data.allocatedBitrate);
      const availableOutgoing = formatBitrate(e.data.availableOutgoingBitrate);
      if (videoBitrate) {
        videoBitrate.innerHTML = `<span style="font-weight: bold;">Video:</span><br>allocatedBitrate: <span style="font-weight: 600; color: #0969da;">${allocated}</span><br>availableOutgoingBitrate: <span style="font-weight: 600; color: #0969da;">${availableOutgoing}</span>`;
      }
    } else if (e.data.type === 'keyframeRequested') {
      showKeyframeNotice();
    }
  };

  audioWorker.onmessage = (e) => {
    if (e.data.type === 'bitrateInfo') {
      const allocated = formatBitrate(e.data.allocatedBitrate);
      const availableOutgoing = formatBitrate(e.data.availableOutgoingBitrate);
      if (audioBitrate) {
        audioBitrate.innerHTML = `<span style="font-weight: bold;">Audio:</span><br>allocatedBitrate: <span style="font-weight: 600; color: #0969da;">${allocated}</span><br>availableOutgoingBitrate: <span style="font-weight: 600; color: #0969da;">${availableOutgoing}</span>`;
      }
    }
  };

  videoReceiverWorker.onmessage = (e) => {
    if (!e.data) {
      return;
    }
    if (e.data.type === 'keyframeRequestSent') {
      if (e.data.success) {
        console.log('Main: Receiver keyframe request sent successfully.');
      } else {
        console.error('Main: Receiver keyframe request failed:', e.data.error);
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
  if (typeof videoSender.createEncodedSource !== 'function') {
    throw new Error('RTCRtpSender.createEncodedSource is not supported on videoSender.');
  }
  if (typeof audioSender.createEncodedSource !== 'function') {
    throw new Error('RTCRtpSender.createEncodedSource is not supported on audioSender.');
  }

  console.log('Registering encoded sources on senders...');
  try {
    await videoSender.createEncodedSource(videoWorker);
    await audioSender.createEncodedSource(audioWorker);
    console.log('createEncodedSource calls succeeded.');
  } catch (err) {
    console.error('createEncodedSource registration failed:', err);
    alert('createEncodedSource failed: ' + err.message);
    throw new Error('createEncodedSource registration failed: ' + err.message);
  }

  // Negotiate PeerConnection connection
  await negotiate(pcLocal, pcRemote);
  console.log('PeerConnection connected.');
  requestKeyframeButton.disabled = false;

  // Extract negotiated codec parameters
  const videoParameters = videoSender.getParameters();
  if (!videoParameters) {
    throw new Error('videoSender.getParameters() returned null or undefined');
  }
  if (!videoParameters.codecs) {
    throw new Error('videoSender parameters missing codecs array');
  }
  if (videoParameters.codecs.length === 0) {
    throw new Error('No negotiated video codecs found on video sender');
  }
  const videoCodecParam = videoParameters.codecs[0];
  if (videoCodecParam.payloadType === undefined) {
    throw new Error('Negotiated video codec is missing payloadType');
  }
  if (!videoCodecParam.mimeType) {
    throw new Error('Negotiated video codec is missing mimeType');
  }
  if (!videoCodecParam.clockRate) {
    throw new Error('Negotiated video codec is missing clockRate');
  }

  const audioParameters = audioSender.getParameters();
  if (!audioParameters) {
    throw new Error('audioSender.getParameters() returned null or undefined');
  }
  if (!audioParameters.codecs) {
    throw new Error('audioSender parameters missing codecs array');
  }
  if (audioParameters.codecs.length === 0) {
    throw new Error('No negotiated audio codecs found on audio sender');
  }
  const audioCodecParam = audioParameters.codecs[0];
  if (audioCodecParam.payloadType === undefined) {
    throw new Error('Negotiated audio codec is missing payloadType');
  }
  if (!audioCodecParam.mimeType) {
    throw new Error('Negotiated audio codec is missing mimeType');
  }
  if (!audioCodecParam.clockRate) {
    throw new Error('Negotiated audio codec is missing clockRate');
  }

  console.log('Negotiated video codec parameters:', videoCodecParam);
  console.log('Negotiated audio codec parameters:', audioCodecParam);

  if (!localStream) {
    throw new Error('localStream is not initialized. Please click "Start Media" first.');
  }

  // Setup MediaStreamTrackProcessor to feed raw frames to WebCodecs encoders in workers
  const videoTracks = localStream.getVideoTracks();
  if (!videoTracks) {
    throw new Error('localStream.getVideoTracks() returned null or undefined');
  }
  if (videoTracks.length === 0) {
    throw new Error('No video track found in localStream');
  }
  const videoTrack = videoTracks[0];

  const audioTracks = localStream.getAudioTracks();
  if (!audioTracks) {
    throw new Error('localStream.getAudioTracks() returned null or undefined');
  }
  if (audioTracks.length === 0) {
    throw new Error('No audio track found in localStream');
  }
  const audioTrack = audioTracks[0];

  if (typeof MediaStreamTrackProcessor !== 'function') {
    throw new Error('MediaStreamTrackProcessor is not supported in this browser.');
  }

  const videoProcessor = new MediaStreamTrackProcessor({ track: videoTrack });
  const audioProcessor = new MediaStreamTrackProcessor({ track: audioTrack });

  if (typeof videoTrack.getSettings !== 'function') {
    throw new Error('videoTrack.getSettings is not a function');
  }
  const videoSettings = videoTrack.getSettings();
  if (!videoSettings) {
    throw new Error('videoTrack.getSettings() returned null or undefined');
  }
  if (!videoSettings.width) {
    throw new Error('videoTrack settings missing width');
  }
  if (!videoSettings.height) {
    throw new Error('videoTrack settings missing height');
  }

  videoWorker.postMessage({
    type: 'startEncoding',
    readable: videoProcessor.readable,
    codecParams: {
      payloadType: videoCodecParam.payloadType,
      mimeType: videoCodecParam.mimeType,
      clockRate: videoCodecParam.clockRate,
      width: videoSettings.width,
      height: videoSettings.height,
    }
  }, [videoProcessor.readable]);

  audioWorker.postMessage({
    type: 'startEncoding',
    readable: audioProcessor.readable,
    codecParams: {
      payloadType: audioCodecParam.payloadType,
      mimeType: audioCodecParam.mimeType,
      clockRate: audioCodecParam.clockRate,
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

  if (audioBitrate) {
    audioBitrate.innerHTML = '<span style="font-weight: bold;">Audio:</span><br>allocatedBitrate: <span style="font-weight: 600; color: #0969da;">-</span><br>availableOutgoingBitrate: <span style="font-weight: 600; color: #0969da;">-</span>';
  }
  if (videoBitrate) {
    videoBitrate.innerHTML = '<span style="font-weight: bold;">Video:</span><br>allocatedBitrate: <span style="font-weight: 600; color: #0969da;">-</span><br>availableOutgoingBitrate: <span style="font-weight: 600; color: #0969da;">-</span>';
  }

  if (keyframeTimeout) {
    clearTimeout(keyframeTimeout);
    keyframeTimeout = null;
  }
  if (keyframeNotice) {
    keyframeNotice.style.transition = 'none';
    keyframeNotice.style.opacity = '0';
    keyframeNotice.textContent = '';
  }

  startButton.disabled = false;
  connectButton.disabled = true;
  hangupButton.disabled = true;
  requestKeyframeButton.disabled = true;
}

function requestKeyframe() {
  if (!videoReceiverWorker) {
    throw new Error('requestKeyframe: videoReceiverWorker is not initialized');
  }
  console.log('Main: Requesting keyframe from receiver worker...');
  videoReceiverWorker.postMessage({ type: 'requestKeyframe' });
}


