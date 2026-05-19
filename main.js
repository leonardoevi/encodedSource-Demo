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
let worker1, worker2;
let messageChannel;

async function start() {
  console.log('Requesting local stream');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    localVideo.srcObject = localStream;
    startButton.disabled = true;
    connectButton.disabled = false;
  } catch (e) {
    console.error('getUserMedia() failed:', e);
    alert('Could not acquire camera stream.');
  }
}

async function connect() {
  connectButton.disabled = true;
  hangupButton.disabled = false;

  console.log('Starting workers...');
  worker1 = new Worker('worker1.js');
  worker2 = new Worker('worker2.js');

  console.log('Setting up MessageChannel between workers...');
  messageChannel = new MessageChannel();
  
  // Send port 1 to Worker 1, and port 2 to Worker 2
  worker1.postMessage({ port: messageChannel.port1 }, [messageChannel.port1]);
  worker2.postMessage({ port: messageChannel.port2 }, [messageChannel.port2]);

  const videoTrack = localStream.getVideoTracks()[0];

  // --- Setup PC1 (Usual Connection with Transform) ---
  console.log('Setting up PC1...');
  pc1Local = new RTCPeerConnection();
  pc1Remote = new RTCPeerConnection();

  pc1Remote.ontrack = (e) => {
    console.log('PC1: Received remote track');
    remoteVideo1.srcObject = e.streams[0];
  };

  //startPairMonitoring(pc1Local, pc1Remote, "PC1");

  // Add track to PC1 local
  const sender1 = pc1Local.addTrack(videoTrack, localStream);

  // Apply RTCRtpScriptTransform to PC1 sender
  if (window.RTCRtpScriptTransform) {
    console.log('PC1: Applying RTCRtpScriptTransform');
    sender1.transform = new RTCRtpScriptTransform(worker1);
  } else {
    console.error('RTCRtpScriptTransform is not supported by this browser.');
  }

  // Negotiate PC1
  await negotiate(pc1Local, pc1Remote);
  console.log('PC1 connected.');
  logUsedEncoder(pc1Local, 'PC1');

  // --- Setup PC2 (Sink Connection) ---
  console.log('Setting up PC2...');
  pc2Local = new RTCPeerConnection();
  pc2Remote = new RTCPeerConnection();

  pc2Remote.ontrack = (e) => {
    console.log('PC2: Received remote track');
    remoteVideo2.srcObject = e.streams[0] || new MediaStream([e.track]);
  };

  // Create a transceiver to trigger negotiation and get a sender without capturing raw video again
  const transceiver2 = pc2Local.addTransceiver('video', { direction: 'sendonly' });
  const sender2 = transceiver2.sender;

  // Call the new createEncodedSink API on PC2 sender
  if (typeof sender2.createEncodedSink === 'function') {
    console.log('PC2: Calling createEncodedSink(worker2) on sender');
    try {
      await sender2.createEncodedSink(worker2);
      console.log('PC2: createEncodedSink call succeeded (resolved)');
    } catch (e) {
      console.error('PC2: createEncodedSink call failed:', e);
    }
  } else {
    console.warn('PC2: RTCRtpSender.createEncodedSink is not supported/implemented in this browser.');
  }

  // Negotiate PC2
  await negotiate(pc2Local, pc2Remote);
  console.log('PC2 connected.');
  logUsedEncoder(pc2Local, 'PC2');

  //startPairMonitoring(pc2Local, pc2Remote, "PC2");
}

async function negotiate(pcLocal, pcRemote) {
  pcLocal.onicecandidate = (e) => {
    if (e.candidate) {
      pcRemote.addIceCandidate(e.candidate).catch(err => console.error('Error adding ICE candidate to remote:', err));
    }
  };
  pcRemote.onicecandidate = (e) => {
    if (e.candidate) {
      pcLocal.addIceCandidate(e.candidate).catch(err => console.error('Error adding ICE candidate to local:', err));
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
  console.log('Ending call');
  
  if (pc1Local) pc1Local.close();
  if (pc1Remote) pc1Remote.close();
  if (pc2Local) pc2Local.close();
  if (pc2Remote) pc2Remote.close();
  
  pc1Local = pc1Remote = pc2Local = pc2Remote = null;

  if (worker1) worker1.terminate();
  if (worker2) worker2.terminate();
  worker1 = worker2 = null;

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

function startPairMonitoring(pcLocal, pcRemote, label) {
  let prevStatsLocal = new Map();
  let prevStatsRemote = new Map();

  setInterval(async () => {
    if (pcLocal.signalingState === "closed" || pcRemote.signalingState === "closed") return;

    try {
      const [statsLocal, statsRemote] = await Promise.all([pcLocal.getStats(), pcRemote.getStats()]);

      let txLog = "  [TX] No media stats";
      let rxLog = "  [RX] No media stats";

      const processTx = (report) => {
        const currentBytes = report.bytesSent || 0;
        const currentTimestamp = report.timestamp;
        const prev = prevStatsLocal.get(report.id) || {};
        const timeDiffSec = prev.timestamp ? (currentTimestamp - prev.timestamp) / 1000 : 0;

        if (timeDiffSec > 0 && prev.bytesSent !== undefined) {
          const bytesPerSec = (currentBytes - prev.bytesSent) / timeDiffSec;
          const kbps = (bytesPerSec * 8) / 1000;
          txLog = `  [TX: ${report.type}] Bitrate: ${kbps.toFixed(2)} kbps (${Math.round(bytesPerSec)} B/s) | Total Sent: ${currentBytes}`;
        } else {
          txLog = `  [TX: ${report.type}] Total Sent: ${currentBytes}`;
        }
        prev.bytesSent = currentBytes;
        prev.timestamp = currentTimestamp;
        prevStatsLocal.set(report.id, prev);
      };

      const processRx = (report) => {
        const currentBytes = report.bytesReceived || 0;
        const currentFramesDecoded = report.framesDecoded;
        const currentTimestamp = report.timestamp;
        const prev = prevStatsRemote.get(report.id) || {};
        const timeDiffSec = prev.timestamp ? (currentTimestamp - prev.timestamp) / 1000 : 0;

        if (timeDiffSec > 0 && prev.bytesReceived !== undefined) {
          const bytesPerSec = (currentBytes - prev.bytesReceived) / timeDiffSec;
          const kbps = (bytesPerSec * 8) / 1000;
          let framesStr = currentFramesDecoded !== undefined ? ` | Decoded: ${currentFramesDecoded}` : '';
          if (currentFramesDecoded !== undefined && prev.framesDecoded !== undefined) {
            const fps = Math.round((currentFramesDecoded - prev.framesDecoded) / timeDiffSec);
            framesStr += ` (${fps} fps)`;
          }
          rxLog = `  [RX: ${report.type}] Bitrate: ${kbps.toFixed(2)} kbps (${Math.round(bytesPerSec)} B/s)${framesStr} | Total Recv: ${currentBytes}`;
        } else {
          let framesStr = currentFramesDecoded !== undefined ? ` | Decoded: ${currentFramesDecoded}` : '';
          rxLog = `  [RX: ${report.type}] Total Recv: ${currentBytes}${framesStr}`;
        }
        prev.bytesReceived = currentBytes;
        if (currentFramesDecoded !== undefined) prev.framesDecoded = currentFramesDecoded;
        prev.timestamp = currentTimestamp;
        prevStatsRemote.set(report.id, prev);
      };

      let foundTx = false;
      statsLocal.forEach(report => {
        if (report.type === 'outbound-rtp') {
          foundTx = true;
          processTx(report);
        }
      });
      if (!foundTx) {
        statsLocal.forEach(report => {
          if (report.type === 'transport' && report.bytesSent > 0) {
            processTx(report);
          }
        });
      }

      let foundRx = false;
      statsRemote.forEach(report => {
        if (report.type === 'inbound-rtp') {
          foundRx = true;
          processRx(report);
        }
      });
      if (!foundRx) {
        statsRemote.forEach(report => {
          if (report.type === 'transport' && report.bytesReceived > 0) {
            processRx(report);
          }
        });
      }

      console.log(`\n=== [${label} Stats] State: Local(${pcLocal.connectionState}) / Remote(${pcRemote.connectionState}) ===\n${txLog}\n${rxLog}\n===============================================================`);
    } catch (err) {
      console.error(`[${label}] getStats error:`, err);
    }
  }, 3000); // Check every 3 seconds
}

function logUsedEncoder(pc, label) {
  // Query stats after 2 seconds to ensure encoding has started
  setTimeout(async () => {
    if (!pc || pc.signalingState === 'closed') return;
    try {
      const stats = await pc.getStats();
      let encoderStr = 'unknown';
      let mimeType = 'unknown';

      stats.forEach(report => {
        if (report.type === 'outbound-rtp') {
          if (report.encoderImplementation) encoderStr = report.encoderImplementation;
          if (report.codecId) {
            const codec = stats.get(report.codecId);
            if (codec && codec.mimeType) mimeType = codec.mimeType;
          }
        }
      });
      console.log(`[${label} Codec Info] Codec: ${mimeType}, Encoder Implementation: ${encoderStr}`);
    } catch (err) {
      console.error(`[${label}] Failed to fetch codec stats:`, err);
    }
  }, 2000);
}
