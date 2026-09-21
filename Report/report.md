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
3. [Chromium](#3-chromium)
4. [WebRTC](#4-webrtc)
5. [Digital Audio and Video Encoding](#5-digital-audio-and-video-encoding)
6. [Limitations of the Current Web Platform](#6-limitations-of-the-current-web-platform)
7. [Use Cases](#7-use-cases)
8. [Proposed Solution](#8-proposed-solution)
9. [Conclusion and Future Work](#9-conclusion-and-future-work)
10. [Appendix A — Glossary](#appendix-a--glossary)
11. [Appendix B — List of Submitted Code Changes](#appendix-b--list-of-submitted-code-changes)
12. [Appendix C — References](#appendix-c--references)

---

## 1. Introduction

A modern browser can send live audio and video to another browser, and it is very good at it, but it insists on compressing that media itself: today there is no way for a web application to feed its own already-compressed audio or video into WebRTC's real-time transport while still receiving the signals — key-frame requests and bandwidth updates — that keep such a stream usable, even though the Web Platform already lets applications produce compressed media on their own, through WebCodecs and WebAssembly, and lets them observe (but not originate) frames already inside a connection, through WebRTC Encoded Transform. This internship closed that gap: it contributed, across both of the open-source repositories that implement a browser's real-time stack — WebRTC and Chromium — a way to construct a compressed audio or video frame from scratch and inject it into a live connection while preserving the connection's control signals, validated with a working demonstration web application and documented in a public explainer now before the W3C WebRTC Working Group.

---

## 2. The Web Platform

A web page is fetched from a server as a document, but since the mid-1990s that document may also contain a program, written in JavaScript, which the browser executes on the user's machine. Over three decades this has grown into something much larger: the browser exposes to that program a very extensive library of capabilities — drawing, audio, storage, cryptography, camera and microphone access, GPU access, and several kinds of networking. Compiled languages such as C++ and Rust can also be targeted at the browser through **WebAssembly (WASM)**, a portable binary instruction format that runs at close to native speed inside the same sandbox. The union of these capabilities is what the industry calls the **Web Platform**. Video conferencing, collaborative editing, cloud gaming, remote desktop, and live broadcasting are all built on it: what the platform can and cannot do sets an upper bound on what can be built without asking users to install native software.

Two properties define this platform. First, the code running on it is untrusted: a user visits a URL and the browser immediately runs code written by a stranger, so every capability has to be designed under the assumption that the application in front of it may be hostile. This assumption shapes a number of design decisions described later in this report that would otherwise look like unnecessary indirection. Second, the platform is not owned by any single company. It is specified by independent standards bodies and then implemented separately by several competing browser engines, which must agree closely enough that a page written once works everywhere. Two bodies matter here:

The **World Wide Web Consortium (W3C)** specifies the programming interfaces that applications see — the names of the objects and methods a JavaScript program can call, written down in an interface language called **WebIDL**. The relevant group for this report is the WebRTC Working Group, which maintains interfaces such as `RTCPeerConnection`. At this level, the contribution described in this report is a single new method along these lines:

```webidl
partial interface RTCRtpSender {
  Promise<undefined> createEncodedSource(Worker worker);
};
```

Section 8 explains what this method does and why; for now, it is enough to know that naming a method, its arguments and what it returns, like this, is exactly the kind of thing the W3C is responsible for.

The **Internet Engineering Task Force (IETF)** specifies the wire protocols instead — the actual bytes that travel between two machines, independent of any particular browser. The protocols used by WebRTC, introduced in Section 4, are IETF standards. This report's contribution sits entirely on the W3C side: it adds a new interface for an application to use, without changing anything about what travels over the network.

A new browser capability follows a characteristic life cycle: an *explainer* document motivating the feature and sketching the interface; discussion in the relevant working group; an experimental implementation in at least one browser engine; refinement of the design in light of that implementation; a formal specification; and, eventually, implementation by the other engines. This internship's contribution sits in the middle of that cycle: an experimental implementation, and the design feedback that came from building it.

---

## 3. Chromium

Chromium is the open-source browser project that underlies several shipping browsers, including Google Chrome, Microsoft Edge, Opera, and Brave. It is developed in the open at `chromium.googlesource.com` under a permissive open-source license, and while most of its commits come from engineers employed by Google, its review process does not distinguish between them and anyone else: every change is proposed as a patch and reviewed on `chromium-review.googlesource.com` by an owner of the affected area of code, and it is merged once — and only once — that reviewer approves it. This is exactly the process by which the Chromium-side changes listed in Appendix B were merged during this internship.

Two parts of Chromium's internals matter for this report. **Blink** is the layer that implements the Web Platform interfaces introduced in Section 2: the C++ code backing JavaScript objects such as `RTCPeerConnection` is Blink code, and it is the boundary this internship's contribution had to cross to reach the browser's internal media pipeline. **V8** is the JavaScript engine that runs the application's own script; this project did not modify it, but it is worth naming because it is what executes the application code that eventually calls into Blink.

Chromium also has its own process for shipping a new capability, distinct from — but coordinated with — the W3C standardization life cycle described in Section 2: a feature is first proposed internally as an "Intent to Prototype", built behind an experimental flag invisible to ordinary users, and only later, once its design has stabilized, proposed as an "Intent to Ship" — a public announcement inviting the other browser vendors to comment before the feature is turned on by default for everyone. The work described in this report currently sits at the prototype stage: a working, flag-gated implementation, developed in parallel with the explainer under discussion in the W3C WebRTC Working Group.

Finally, Chromium does not implement WebRTC's protocol logic itself: it bundles the WebRTC library discussed in Section 4 as a dependency, kept up to date through an automated process called a **roll**, which periodically pulls the latest WebRTC commit into Chromium's own source tree. Because this internship's contribution touches both repositories, each of its Chromium-side changes had to wait for the corresponding WebRTC-side change to be merged and picked up by one of these rolls before it could, in turn, be merged into Chromium.

---

## 4. WebRTC

**WebRTC** is a set of protocols and browser programming interfaces that let two machines exchange audio, video and data directly, in real time, with end-to-end encryption. In the browser, the entry point is the `RTCPeerConnection` object. *WebRTC for the Curious*, an open community reference on the protocol suite (Appendix C), is a useful companion to the summary that follows.

**Signaling.** Before any media flows, the two ends need to agree on what they are about to exchange: which media kinds, which codecs, in which order of preference, and which network addresses to try. This is done by exchanging a **Session Description Protocol (SDP)** document each way — one side sends an *offer*, the other replies with an *answer*. WebRTC deliberately does not standardize how this exchange itself happens; the application is free to carry these SDP documents over a WebSocket, an HTTP request, or any channel it already has, which is what lets WebRTC fit into any existing server infrastructure.

**Connectivity: ICE.** Most machines do not have a public, directly reachable network address: they sit behind a home router or a corporate firewall performing Network Address Translation (NAT). To find a path that actually works, each side gathers a list of **candidates** — address-and-port pairs it might be reachable on — of three kinds: its own local address (a *host* candidate), the address a STUN server observed it connecting from, which is often the router's public address (a *server-reflexive* candidate), and, as a last resort, the address of a TURN server willing to relay traffic on its behalf (a *relayed* candidate). Both ends exchange their candidate lists and then try pairs of them until one is found that works end to end; this whole process is called **ICE**, and it is re-run automatically if the network changes, for example when a laptop moves from Wi-Fi to a mobile connection.

**Encryption.** Once a candidate pair is selected, the two ends run a **DTLS** handshake directly over it — DTLS is essentially TLS adapted to work over an unreliable, packet-based transport like UDP. Each side authenticates the other not against a certificate authority, but by checking that the certificate presented during the handshake matches a fingerprint carried inside the SDP exchanged earlier, which is why the signaling channel, even though WebRTC does not standardize it, is trusted to deliver that document unmodified. The keys this handshake produces are then used to key **SRTP**, which encrypts and authenticates every media packet that follows.

**Packetization: RTP.** Media itself travels as a sequence of **RTP** packets. Each carries, alongside its encrypted payload, a compact header recording a monotonically increasing *sequence number* (so the receiver can detect loss and reordering), a *timestamp* (so it can play frames back at the right rate and keep audio and video in sync), and an identifier of which encoded stream the packet belongs to. A single compressed video or audio frame produced by an encoder is often too large for one packet and is split across several RTP packets sharing the same timestamp.

**Feedback: RTCP.** Running alongside RTP is a parallel control channel, **RTCP**, on which the receiving side continuously reports back to the sender. This feedback comes in two flavors that matter for this report. The first is *reactive*: if a receiver notices a small number of packets are missing, it can ask for them to be retransmitted (a **NACK**), but once enough loss accumulates that its decoder can no longer make sense of the stream, retransmission stops being useful, and it instead sends a **key-frame request** (called PLI or FIR in the protocol), asking the sender to start over with a frame that does not depend on anything already lost. The second is *proactive*: the two ends continuously exchange timing information that lets the sender estimate how much bandwidth the network path can currently sustain — an algorithm such as Google Congestion Control does this by watching how the delay between consecutive packets grows or shrinks — and the sender turns that estimate into a bitrate budget it hands to its encoder. Together, a key-frame request and a bandwidth estimate are the feedback loop that turns a raw encoder into something usable for real-time media: without them, a video call cannot recover from packet loss or adapt to a changing network. Section 5 looks at why, from the encoder's own point of view, these two particular signals are the ones that matter.

Today, this entire pipeline runs inside the browser: a browser-supplied encoder produces the outgoing frames, and that same internal code is what receives key-frame requests and bandwidth updates directly, with no application involvement. The only existing opening for an application to touch this pipeline is **WebRTC Encoded Transform**, an existing Web API, introduced a few years ago, that lets a script observe and modify compressed frames in either direction as they pass between the browser's encoder and the part of the pipeline that packages them for the network.

---

## 5. Digital Audio and Video Encoding

The two RTCP signals just described — a key-frame request and a bandwidth estimate — are not arbitrary; they are, respectively, the one thing that can go irrecoverably wrong with a compressed video stream, and the one number a live encoder needs to be told to keep functioning. Understanding why requires a brief look at how video compression actually works.

An encoder shrinks a video stream mainly by not re-sending pixels that have not changed. The first frame of a stream, or of any point at which a decoder should be able to join, is coded entirely on its own, as a **key frame** (or *I-frame*): self-contained and decodable without any other information, but comparatively large. Every frame after it is usually coded as a **delta frame** (or *P-frame*) instead: rather than describing the picture from scratch, it describes how it differs from the frame before it, which is far cheaper to encode, at the cost of only making sense together with everything it was built on top of. A stream is therefore a chain: a key frame followed by a run of delta frames each depending on the one before it, until the next key frame restarts the chain. If a single delta frame is lost, every delta frame after it is technically received but effectively meaningless, since each encodes a difference from a reference the decoder never got — the picture degrades and stays degraded until a new key frame arrives. This is why a key-frame request is a distinct signal from ordinary retransmission: retransmitting one lost packet cannot repair a broken chain, and the only way out is for the encoder to produce a new, self-contained frame on demand.

An encoder is also given a target **bitrate** — how many bits per second it is allowed to spend — and continuously trades that budget for quality: a higher target buys sharper, less blocky pictures at the same resolution and frame rate, a lower one forces coarser detail. Because that target reflects the current state of the network rather than the video content, it has to be supplied to the encoder from outside, and it can change from one moment to the next; an encoder that keeps producing more data than the network can currently carry causes the exact queueing and delay that a real-time call cannot tolerate. This is why a continuously updated bandwidth estimate, rather than a value negotiated once at the start of the call, is the second thing a real-time encoder cannot do without.

Audio compression follows the same broad idea — Opus, the codec WebRTC uses by default, compresses each successive 20-millisecond slice of audio and is likewise given a bitrate target — but it does not build the same long, fragile dependency chains that video does, so losing one audio packet degrades a fraction of a second of sound rather than everything that follows it, and audio streams rarely need an explicit key-frame request.

An application that supplies its own already-compressed frames, as described in Section 8, is in exactly the position of an encoder: it is the one entity that can act on a key-frame request by producing a self-contained frame, and the one entity that can act on a bandwidth estimate by changing what it produces next. Any design that lets such an application inject frames into a peer connection has to deliver it these same two signals, or it will behave worse than the encoder it replaced.

---

## 6. Limitations of the Current Web Platform

The Web Platform already gives an application two of the pieces it would need to supply its own compressed media. **WebCodecs** gives direct, low-level access to the browser's own encoders and decoders. **WebAssembly** lets an application ship a custom codec, compiled from C, C++ or Rust, that the browser does not provide natively. Together, these already let a web application produce compressed audio or video entirely on its own.

What it cannot do is send that media over a real-time connection. **Encoded Transform** (Section 4) is the closest existing opening, but it only lets an application *modify* frames that the browser's own encoder already produced — there is no way to *originate* a frame from outside and have it processed by a peer connection. And even where it is used, Transform sits at the wrong point in the pipeline to receive an encoder's control signals: it is a filter placed between the encoder and the packetizer, whereas an application supplying its own compressed media needs to receive the key-frame requests and bandwidth updates that would ordinarily go to an encoder, since it is now effectively the encoder. The only alternative available today is to carry compressed frames over a general-purpose transport (WebTransport or WebSocket) and reimplement packetization, congestion control and loss recovery in WebAssembly — an enormous duplication of logic that WebRTC has spent years getting right, and not a realistic option for production software.

The gap is not a research problem in the usual sense: outside the browser, native applications and server-side relays (Selective Forwarding Units, or SFUs, the components most large conferencing systems are built around) have done exactly this for years, by supplying their own encoder to the underlying WebRTC library directly. What is missing is a way to expose the same capability safely to untrusted web code — a platform-capability gap rather than an unsolved technical question.

---

## 7. Use Cases

Two concrete cases motivated this work.

**Custom codecs.** An application built with WebCodecs and WebAssembly (Section 6) may have an encoder the browser does not: a newer standard codec, one tuned for screen content, a research codec, or a proprietary one. Today, such an encoder has nowhere to send its output; it needs the ability to inject its already-compressed frames directly into a peer connection.

**Enterprise content delivery (eCDN).** This case targets large conferences or broadcasts distributed to many clients sitting on the same local network — a company-wide town hall, for instance, watched by hundreds of employees on the same office network at once. Rather than have every client pull the stream independently over the network's outward-facing internet connection, an eCDN deployment uses *peer-assisted media forwarding*: a small number of clients inside the local network receive the stream once and relay it internally to the rest, over the much cheaper local link, so the shared entry point to the outside network is never overloaded. Building this in the browser requires being able to inject encoded media directly into a peer connection: a relaying client extracts the compressed frames arriving on its inbound connection — using the existing Encoded Transform API, without decoding them — and injects those same frames, unchanged, into each outbound connection to the clients it serves.

---

## 8. Proposed Solution

The solution has two parts, designed and implemented together across both repositories that make up the browser's real-time stack: the WebRTC library, and Chromium's **Blink** layer, which is the component that implements the interfaces JavaScript actually sees.

**Frame construction.** An application first needs to be able to *build* a compressed frame object from a payload and some metadata, rather than only reading one out of an existing connection. I implemented constructors for this — `RTCEncodedAudioFrame` and `RTCEncodedVideoFrame` — so that an application using a WebCodecs encoder, for instance, can take the chunk it produces and turn it into a frame ready for injection.

**The Encoded Source API.** The second part is the injection path itself: a new `createEncodedSource()` method on the sending half of a peer connection returns an object, living in a worker thread, that accepts compressed frames from application code through a writable stream and inserts them into the transport pipeline — placed at the *position* the browser's own encoder used to occupy, rather than after it, which is what distinguishes it from Encoded Transform and lets the two features be used together on the same connection. Two events on that object carry the control signals described in Sections 4 and 5 back to the application: one fires when the network requests a key frame, the other whenever the allocated bandwidth changes, so that the application's own encoder can adapt exactly as the browser's would have.

The architecture that makes this work safely is a **proxy encoder**. Rather than bypassing the browser's encoding pipeline — which would silently break the bookkeeping, bandwidth accounting and activity checks that assume a real encoder is running — the design installs a stand-in encoder inside the WebRTC library itself. From the pipeline's point of view, this proxy is a completely ordinary encoder: it receives the same key-frame requests and bandwidth allocations any encoder would, and it participates in statistics and bookkeeping like any other. In practice, though, it does no compression: it simply hands over the frame the application already supplied. This gives the mechanism a clean, symmetric shape — compressed frames flow *down*, from the application in Blink, across the browser's internal layer boundary, into the WebRTC library and onto the network, while the two control signals flow in the opposite *direction*, from the network, through WebRTC's proxy encoder, back across that same boundary, up to the application in Blink. Because the proxy behaves exactly like a real encoder to everything around it, the rest of the pipeline needs no special-casing, and an application that does not use the feature sees no change in behaviour at all.

Both the audio and video paths were implemented this way and validated with a working demonstration web application: a WebCodecs encoder running in a browser tab produces compressed video, the constructors above turn it into frame objects, the Encoded Source injects them into a live peer connection, and the page reacts live to both key-frame-request and bandwidth events. The demonstration was verified against an unmodified remote peer, which knows nothing about the feature.

The resulting design is documented in a public explainer, of which I am a co-author, and has received positive feedback in the W3C WebRTC Working Group.

---

## 9. Conclusion and Future Work

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
| **GCC** | Google Congestion Control; an algorithm that estimates available bandwidth from packet delay trends |
| **ICE** | Interactive Connectivity Establishment; the NAT-traversal procedure used by WebRTC |
| **IETF** | Internet Engineering Task Force; standardizes the wire protocols |
| **Key frame** | A compressed video frame decodable on its own, as opposed to a delta frame coded as a difference from previous frames |
| **NACK** | Negative Acknowledgement; an RTCP message asking the sender to retransmit specific lost packets |
| **Opus** | The audio codec WebRTC uses by default |
| **PLI / FIR** | Picture Loss Indication / Full Intra Request; RTCP messages asking the sender for a key frame |
| **RTCP** | The control and feedback channel accompanying RTP |
| **RTP** | Real-time Transport Protocol; carries media packets |
| **SDP** | Session Description Protocol; the document format used to negotiate a connection's media and network parameters |
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
