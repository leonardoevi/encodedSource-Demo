# Injecting Externally Encoded Media into WebRTC Peer Connections
## Design and Implementation of the Encoded Source API in Chromium and WebRTC

**Internship report — Master's degree, Sorbonne University, Paris**

**Author:** Leonardo Evi

**Codebases:** 
- WebRTC (`webrtc.googlesource.com/src`)
- Chromium (`chromium.googlesource.com/chromium/src`)


## Table of Contents

1. [Introduction](#1-introduction)
2. [The Web Platform](#2-the-web-platform)
3. [WebRTC](#3-webrtc)
4. [Limitations of the Current Web Platform](#4-limitations-of-the-current-web-platform)
5. [Use Cases](#5-use-cases)
6. [Proposed Solution](#6-proposed-solution)
7. [Conclusion and Future Work](#7-conclusion-and-future-work)
8. [Appendix A — Glossary](#appendix-a--glossary)
9. [Appendix B — List of Submitted Code Changes](#appendix-b--list-of-submitted-code-changes)
10. [Appendix C — References](#appendix-c--references)

---

## 1. Introduction

### 1.1 The problem in one sentence

A modern browser can send live audio and video to another browser, and it is very good at it, but it insists on compressing that media itself: today there is no way for a web application to feed its own already-compressed audio or video into WebRTC's real-time transport while still receiving the signals — key-frame requests and bandwidth updates — that keep such a stream usable, even though the Web Platform already lets applications produce compressed media on their own, through WebCodecs and WebAssembly, and lets them observe (but not originate) frames already inside a connection, through WebRTC Encoded Transform. This internship closed that gap: it contributed, across both of the open-source repositories that implement a browser's real-time stack — WebRTC and Chromium — a way to construct a compressed audio or video frame from scratch and inject it into a live connection while preserving the connection's control signals, validated with a working demonstration web application and documented in a public explainer now before the W3C WebRTC Working Group.

---

## 2. The Web Platform

A web page is fetched from a server as a document, but since the mid-1990s that document may also contain a program, written in JavaScript, which the browser executes on the user's machine. Over three decades this has grown into something much larger: the browser exposes to that program a very extensive library of capabilities — drawing, audio, storage, cryptography, camera and microphone access, GPU access, and several kinds of networking. Compiled languages such as C++ and Rust can also be targeted at the browser through **WebAssembly (WASM)**, a portable binary instruction format that runs at close to native speed inside the same sandbox. The union of these capabilities is what the industry calls the **Web Platform**. Video conferencing, collaborative editing, cloud gaming, remote desktop, and live broadcasting are all built on it: what the platform can and cannot do sets an upper bound on what can be built without asking users to install native software.

Two properties define this platform. First, the code running on it is untrusted: a user visits a URL and the browser immediately runs code written by a stranger, so every capability has to be designed under the assumption that the application in front of it may be hostile. This assumption shapes a number of design decisions described later in this report that would otherwise look like unnecessary indirection. Second, the platform is not owned by any single company. It is specified by independent standards bodies and then implemented separately by several competing browser engines, which must agree closely enough that a page written once works everywhere. Two bodies matter here:

- The **World Wide Web Consortium (W3C)** specifies the programming interfaces that applications see. The relevant group for this report is the WebRTC Working Group.
- The **Internet Engineering Task Force (IETF)** specifies the wire protocols — the actual bytes that travel between two machines. The protocols used by WebRTC are IETF standards.

A new browser capability follows a characteristic life cycle: an *explainer* document motivating the feature and sketching the interface; discussion in the relevant working group; an experimental implementation in at least one browser engine; refinement of the design in light of that implementation; a formal specification; and, eventually, implementation by the other engines. This internship's contribution sits in the middle of that cycle: an experimental implementation, and the design feedback that came from building it.

---

## 3. WebRTC

**WebRTC** is a set of protocols and browser programming interfaces that let two machines exchange audio, video and data directly, in real time, with end-to-end encryption. In the browser, the entry point is the `RTCPeerConnection` object.

Getting two browsers talking involves a few steps, each solved by a different part of the protocol suite. First, the two ends agree on what they will exchange — which media, which compression formats, which network addresses to try — by exchanging a description of themselves through a channel of the application's own choosing; WebRTC deliberately does not standardize this part, so that it fits any application's existing server infrastructure. Second, they find a working network path: most machines sit behind routers that hide their real address, so WebRTC uses a discovery-and-probing protocol called **ICE**, helped by lightweight **STUN** and **TURN** servers, to find a path that actually works, and it re-runs this process automatically if the network changes. Third, everything is encrypted before it is sent, using **DTLS** for the key exchange and **SRTP** to carry the encrypted media itself.

Once a connection exists, media travels as **RTP** packets, each carrying a chunk of compressed audio or video. Running alongside RTP is a parallel control channel, **RTCP**, on which the receiving side continuously reports back to the sender: how much data arrived, how much was lost, and so on. Two of these reports matter a great deal for this report. A receiver whose video has broken beyond recovery can send a **key-frame request** (called PLI or FIR in the protocol), asking the sender for a frame it can decode entirely on its own. This distinction exists because most compressed video frames are coded as the *difference* from the previous frame, to save bandwidth, and are therefore undecodable if that previous frame was ever lost — only an occasional, larger *key frame* can restart a broken stream on its own. Separately, the two ends continuously measure how much bandwidth the network path can currently carry, and the sender uses this estimate to tell its encoder how many bits per second it may spend. Together, a key-frame request and a bandwidth estimate are the feedback loop that turns a raw encoder into something usable for real-time media: without them, a video call cannot recover from packet loss or adapt to a changing network. Handling this feedback loop correctly is central to the rest of this report.

Today, this entire pipeline runs inside the browser: a browser-supplied encoder produces the outgoing frames, and that same internal code is what receives key-frame requests and bandwidth updates directly, with no application involvement. The only existing opening for an application to touch this pipeline is **WebRTC Encoded Transform**, an existing Web API, introduced a few years ago, that lets a script observe and modify compressed frames in either direction as they pass between the browser's encoder and the part of the pipeline that packages them for the network.

---

## 4. Limitations of the Current Web Platform

The Web Platform already gives an application two of the pieces it would need to supply its own compressed media. **WebCodecs** gives direct, low-level access to the browser's own encoders and decoders. **WebAssembly** lets an application ship a custom codec, compiled from C, C++ or Rust, that the browser does not provide natively. Together, these already let a web application produce compressed audio or video entirely on its own.

What it cannot do is send that media over a real-time connection. **Encoded Transform** (Section 3) is the closest existing opening, but it only lets an application *modify* frames that the browser's own encoder already produced — there is no way to *originate* a frame from outside and have it processed by a peer connection. And even where it is used, Transform sits at the wrong point in the pipeline to receive an encoder's control signals: it is a filter placed between the encoder and the packetizer, whereas an application supplying its own compressed media needs to receive the key-frame requests and bandwidth updates that would ordinarily go to an encoder, since it is now effectively the encoder. The only alternative available today is to carry compressed frames over a general-purpose transport (WebTransport or WebSocket) and reimplement packetization, congestion control and loss recovery in WebAssembly — an enormous duplication of logic that WebRTC has spent years getting right, and not a realistic option for production software.

The gap is not a research problem in the usual sense: outside the browser, native applications and server-side relays (Selective Forwarding Units, or SFUs, the components most large conferencing systems are built around) have done exactly this for years, by supplying their own encoder to the underlying WebRTC library directly. What is missing is a way to expose the same capability safely to untrusted web code — a platform-capability gap rather than an unsolved technical question.

---

## 5. Use Cases

Two concrete cases motivated this work.

**Custom codecs.** An application built with WebCodecs and WebAssembly (Section 4) may have an encoder the browser does not: a newer standard codec, one tuned for screen content, a research codec, or a proprietary one. Today, such an encoder has nowhere to send its output; it needs the ability to inject its already-compressed frames directly into a peer connection.

**Enterprise content delivery (eCDN).** This case targets large conferences or broadcasts distributed to many clients sitting on the same local network — a company-wide town hall, for instance, watched by hundreds of employees on the same office network at once. Rather than have every client pull the stream independently over the network's outward-facing internet connection, an eCDN deployment uses *peer-assisted media forwarding*: a small number of clients inside the local network receive the stream once and relay it internally to the rest, over the much cheaper local link, so the shared entry point to the outside network is never overloaded. Building this in the browser requires being able to inject encoded media directly into a peer connection: a relaying client extracts the compressed frames arriving on its inbound connection — using the existing Encoded Transform API, without decoding them — and injects those same frames, unchanged, into each outbound connection to the clients it serves.

---

## 6. Proposed Solution

The solution has two parts, designed and implemented together across both repositories that make up the browser's real-time stack: the WebRTC library, and Chromium's **Blink** layer, which is the component that implements the interfaces JavaScript actually sees.

**Frame construction.** An application first needs to be able to *build* a compressed frame object from a payload and some metadata, rather than only reading one out of an existing connection. I implemented constructors for this — `RTCEncodedAudioFrame` and `RTCEncodedVideoFrame` — so that an application using a WebCodecs encoder, for instance, can take the chunk it produces and turn it into a frame ready for injection.

**The Encoded Source API.** The second part is the injection path itself: a new `createEncodedSource()` method on the sending half of a peer connection returns an object, living in a worker thread, that accepts compressed frames from application code through a writable stream and inserts them into the transport pipeline — placed at the *position* the browser's own encoder used to occupy, rather than after it, which is what distinguishes it from Encoded Transform and lets the two features be used together on the same connection. Two events on that object carry the control signals described in Section 3 back to the application: one fires when the network requests a key frame, the other whenever the allocated bandwidth changes, so that the application's own encoder can adapt exactly as the browser's would have.

The architecture that makes this work safely is a **proxy encoder**. Rather than bypassing the browser's encoding pipeline — which would silently break the bookkeeping, bandwidth accounting and activity checks that assume a real encoder is running — the design installs a stand-in encoder inside the WebRTC library itself. From the pipeline's point of view, this proxy is a completely ordinary encoder: it receives the same key-frame requests and bandwidth allocations any encoder would, and it participates in statistics and bookkeeping like any other. In practice, though, it does no compression: it simply hands over the frame the application already supplied. This gives the mechanism a clean, symmetric shape — compressed frames flow *down*, from the application in Blink, across the browser's internal layer boundary, into the WebRTC library and onto the network, while the two control signals flow in the opposite *direction*, from the network, through WebRTC's proxy encoder, back across that same boundary, up to the application in Blink. Because the proxy behaves exactly like a real encoder to everything around it, the rest of the pipeline needs no special-casing, and an application that does not use the feature sees no change in behaviour at all.

Both the audio and video paths were implemented this way and validated with a working demonstration web application: a WebCodecs encoder running in a browser tab produces compressed video, the constructors above turn it into frame objects, the Encoded Source injects them into a live peer connection, and the page reacts live to both key-frame-request and bandwidth events. The demonstration was verified against an unmodified remote peer, which knows nothing about the feature.

The resulting design is documented in a public explainer, of which I am a co-author, and has received positive feedback in the W3C WebRTC Working Group.

---

## 7. Conclusion and Future Work

The Web Platform has spent two decades absorbing capabilities that were previously the preserve of native applications: real-time communication, low-level access to codecs, near-native compiled execution. What remained missing was the connection between them — an application could compress media itself, and it could communicate in real time, but it could not do both at once. This internship closed that gap: a web application can now construct a compressed audio or video frame from scratch and inject it into a live `RTCPeerConnection`, complete with the key-frame-request and bandwidth-allocation signals that let it behave like any other encoder in the pipeline, using a proxy-encoder architecture that keeps this new path indistinguishable, from the rest of the browser's point of view, from an ordinary one.

The next step is standardization. The explainer that documents this design needs to be carried through the W3C WebRTC Working Group into a full specification, and the implementation adjusted to match that specification wherever the two diverge, before other browser engines can adopt it. If that process succeeds, the contribution is not to one browser but to the Web Platform itself — closing a gap between what a web application can build and what native software and server-side infrastructure have been able to do for years.

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Blink** | The component of Chromium that implements the Web Platform interfaces JavaScript sees |
| **DTLS** | Datagram TLS; the key-exchange protocol used by WebRTC over UDP |
| **eCDN** | Enterprise content delivery network; internal redistribution of a stream to reduce external bandwidth |
| **Encoded Transform** | Existing Web API allowing an application to observe and modify compressed frames in flight |
| **ICE** | Interactive Connectivity Establishment; the NAT-traversal procedure used by WebRTC |
| **IETF** | Internet Engineering Task Force; standardizes the wire protocols |
| **Key frame** | A compressed video frame decodable on its own, as opposed to a delta frame coded as a difference from previous frames |
| **PLI / FIR** | Picture Loss Indication / Full Intra Request; RTCP messages asking the sender for a key frame |
| **RTCP** | The control and feedback channel accompanying RTP |
| **RTP** | Real-time Transport Protocol; carries media packets |
| **SFU** | Selective Forwarding Unit; a server that forwards compressed streams without decoding them |
| **SRTP** | Secure RTP; the encrypted form used by WebRTC |
| **STUN / TURN** | Servers used to discover a public address, and to relay traffic when direct connection fails |
| **W3C** | World Wide Web Consortium; standardizes the Web Platform interfaces |
| **WASM** | WebAssembly; portable binary format allowing compiled code to run in the browser |
| **WebCodecs** | Web API giving direct access to the browser's encoders and decoders |

---

## Appendix B — List of Submitted Code Changes

All changes are public. WebRTC changes are reviewed at `webrtc-review.googlesource.com`, Chromium changes at `chromium-review.googlesource.com`.

List of merged changes for both projects:
- https://webrtc-review.googlesource.com/q/status:merged+author:evil@chromium.org
- https://chromium-review.googlesource.com/q/status:merged+author:evil@chromium.org


### WebRTC

| # | Link |
|---|---|
| 1 | https://webrtc-review.googlesource.com/c/src/+/501580 |
| 2 | https://webrtc-review.googlesource.com/c/src/+/501780 |
| 3 | https://webrtc-review.googlesource.com/c/src/+/498801 |
| 4 | https://webrtc-review.googlesource.com/c/src/+/497100 |
| 5 | https://webrtc-review.googlesource.com/c/src/+/489340 |
| 6 | https://webrtc-review.googlesource.com/c/src/+/498600 |
| 7 | https://webrtc-review.googlesource.com/c/src/+/485761 |
| 8 | https://webrtc-review.googlesource.com/c/src/+/488340 |
| 9 | https://webrtc-review.googlesource.com/c/src/+/492780 |
| 10 | https://webrtc-review.googlesource.com/c/src/+/492400 |
| 11 | https://webrtc-review.googlesource.com/c/src/+/487340 |
| 12 | https://webrtc-review.googlesource.com/c/src/+/487360 |
| 13 | https://webrtc-review.googlesource.com/c/src/+/486860 |
| 14 | https://webrtc-review.googlesource.com/c/src/+/485781 |
| 15 | https://webrtc-review.googlesource.com/c/src/+/482900 |

### Chromium

| # | Link |
|---|---|
| 1 | https://chromium-review.googlesource.com/c/chromium/src/+/8304692 |
| 2 | https://chromium-review.googlesource.com/c/chromium/src/+/8360971 |
| 3 | https://chromium-review.googlesource.com/c/chromium/src/+/8366130 |
| 4 | https://chromium-review.googlesource.com/c/chromium/src/+/8366404 |
| 5 | https://chromium-review.googlesource.com/c/chromium/src/+/8353464 |
| 6 | https://chromium-review.googlesource.com/c/chromium/src/+/8346748 |
| 7 | https://chromium-review.googlesource.com/c/chromium/src/+/8097283 |
| 8 | https://chromium-review.googlesource.com/c/chromium/src/+/8024752 |
| 9 | https://chromium-review.googlesource.com/c/chromium/src/+/8035461 |
| 10 | https://chromium-review.googlesource.com/c/chromium/src/+/8074218 |

---

## Appendix C — References

1. G. Urdaneta and L. Evi, *Explainer: WebRTC Encoded Source API and Encoded Frame constructors.* https://github.com/guidou/webrtc-extensions/blob/main/encoded-source-explainer.md
6. *WebRTC for the Curious.* https://webrtcforthecurious.com/
7. I. Grigorik, *High Performance Browser Networking*, chapter on WebRTC. https://hpbn.co/webrtc/
3. W3C, *WebRTC Encoded Transform.* https://w3c.github.io/webrtc-encoded-transform/
4. W3C, *WebCodecs.* https://w3c.github.io/webcodecs/
8. The Chromium Projects — documentation. https://www.chromium.org/chromium-projects/
9. IETF, RFC 3550, *RTP: A Transport Protocol for Real-Time Applications.* https://www.rfc-editor.org/info/rfc3550/
10. IETF, RFC 8825–8835, the WebRTC protocol suite.
11. IETF, RFC 8298 and related documents on congestion control for real-time media.
