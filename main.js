// main.js
'use strict';

const localVideo = document.getElementById('localVideo');
const remoteVideo1 = document.getElementById('remoteVideo1');
const remoteVideo2 = document.getElementById('remoteVideo2');

const startButton = document.getElementById('startButton');
const connectButton = document.getElementById('connectButton');
const hangupButton = document.getElementById('hangupButton');

startButton.onclick = start;
connectButton.onclick = connect;
hangupButton.onclick = hangup;

let localStream;
let pc1Local, pc1Remote;
let pc2Local, pc2Remote;
let videoWorker, audioWorker;

// Helper sleep function
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function start() {
  console.log('Requesting local media stream (video + audio)');
  try {
    // Request both camera and microphone
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

  // Wait briefly for worker initialization
  await sleep(500);

  // --- Setup PC1 (Normal Connection with Transform) ---
  console.log('Setting up standard PC pair...');
  pc1Local = new RTCPeerConnection();
  pc1Remote = new RTCPeerConnection();

  pc1Remote.ontrack = (e) => {
    remoteVideo1.srcObject = e.streams[0];
  };

  // Add tracks to PC1 local from our localStream
  const videoTrack = localStream.getVideoTracks()[0];
  const audioTrack = localStream.getAudioTracks()[0];

  const pc1VideoSender = pc1Local.addTrack(videoTrack, localStream);
  const pc1AudioSender = pc1Local.addTrack(audioTrack, localStream);

  // Apply RTCRtpScriptTransform to PC1 senders
  if (window.RTCRtpScriptTransform) {
    console.log('PC1: Applying RTCRtpScriptTransform to senders');
    pc1VideoSender.transform = new RTCRtpScriptTransform(videoWorker);
    pc1AudioSender.transform = new RTCRtpScriptTransform(audioWorker);
  } else {
    console.error('RTCRtpScriptTransform is not supported by this browser.');
  }

  // --- Setup PC2 (Injected Connection) ---
  console.log('Setting up PC2 (Injected Pair)...');
  pc2Local = new RTCPeerConnection();
  pc2Remote = new RTCPeerConnection();

  pc2Remote.ontrack = (e) => {
    console.log('PC2: Received remote track');
    // PC2 remote might receive tracks individually, bind them to a MediaStream
    if (!remoteVideo2.srcObject) {
      remoteVideo2.srcObject = new MediaStream();
    }
    remoteVideo2.srcObject.addTrack(e.track);
  };

  // Create sendonly transceivers on PC2 local to negotiate sending capabilities
  // without attaching actual hardware camera/mic tracks.
  console.log('PC2: Adding transceivers for video and audio');
  const pc2VideoTransceiver = pc2Local.addTransceiver('video', { direction: 'sendonly' });
  const pc2AudioTransceiver = pc2Local.addTransceiver('audio', { direction: 'sendonly' });

  const pc2VideoSender = pc2VideoTransceiver.sender;
  const pc2AudioSender = pc2AudioTransceiver.sender;

  // Call the new createEncodedSink API on PC2 senders to receive injected frames
  if (typeof pc2VideoSender.createEncodedSink === 'function' &&
    typeof pc2AudioSender.createEncodedSink === 'function') {
    console.log('PC2: Registering encoded sinks on senders...');
    try {
      await pc2VideoSender.createEncodedSink(videoWorker);
      await pc2AudioSender.createEncodedSink(audioWorker);
      console.log('PC2: createEncodedSink calls succeeded');
    } catch (err) {
      console.error('PC2: createEncodedSink registration failed:', err);
      return;
    }
  } else {
    console.error('PC2: RTCRtpSender.createEncodedSink is not supported in this browser.');
    alert('RTCRtpSender.createEncodedSink is not supported in this browser.');
    return;
  }

  // Negotiate connections for both PeerConnection pairs
  await negotiate(pc1Local, pc1Remote);
  console.log('PC1 connected.');

  await negotiate(pc2Local, pc2Remote);
  console.log('PC2 connected.');
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
  
  if (pc1Local) pc1Local.close();
  if (pc1Remote) pc1Remote.close();
  if (pc2Local) pc2Local.close();
  if (pc2Remote) pc2Remote.close();
  
  pc1Local = pc1Remote = pc2Local = pc2Remote = null;

  if (videoWorker) videoWorker.terminate();
  if (audioWorker) audioWorker.terminate();
  videoWorker = audioWorker = null;

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  localVideo.srcObject = null;
  remoteVideo1.srcObject = null;
  remoteVideo2.srcObject = null;

  startButton.disabled = false;
  connectButton.disabled = true;
  hangupButton.disabled = true;
}
