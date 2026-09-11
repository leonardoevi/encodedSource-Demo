# Architecting Zero-Transcode Media Ingestion for the Web Platform
## Native Design and Implementation of the WebRTC Encoded Source API in Chromium and libwebrtc

**Graduation Dissertation – Master of Science in Computer Science**  
**Sorbonne University – Faculty of Science and Engineering, Paris**  
**Specialization:** Software Systems, Distributed Networks, and High-Performance Software Engineering  
**Candidate:** Leonardo Evi  
**Academic Year:** 2025–2026  
**Engineering Organization:** Open-Source Chromium & WebRTC Project Teams  
**Industry Mentor & Co-Author:** Guido Urdaneta (Staff Software Engineer)  
**Date of Submission:** September 2026  

---

## Executive Summary

### Abstract
Real-time audiovisual communication on the World Wide Web has historically been constrained by a rigid, monolithic pipeline architecture: user agents could only capture raw audiovisual frames (uncompressed YUV/PCM buffers) from local hardware peripherals and submit them to an internal encoding subsystem managed entirely by the browser engine. As web applications evolved to incorporate complex media topologies—such as client-side peer-to-peer media relaying, in-browser Selective Forwarding Units (SFUs), decentralized conference distribution, cloud-rendered interactive streaming, and custom neural or WebAssembly-based codecs via the WebCodecs API—this architectural rigidity became a primary performance bottleneck. Relaying or injecting pre-encoded media required a computationally disastrous "decode-then-re-encode" cycle. This cycle saturated multi-core CPUs, exacerbated thermal throttling and battery drain on mobile architectures, introduced 50 to 150 milliseconds of glass-to-glass latency, and degraded visual fidelity through cascading generation-loss compression artifacts.

This dissertation presents the design, native implementation, and upstream integration of the **WebRTC Encoded Source API** and its companion **RTCEncodedAudioFrame / RTCEncodedVideoFrame Constructors** into the open-source **Chromium** browser engine and the **libwebrtc** C++ reference library. The resulting platform advancement establishes the first native, zero-transcode media ingestion path in modern web browsers, empowering web applications running in Dedicated Workers to inject externally compressed frames directly into an `RTCRtpSender` transmission pipeline via standard WHATWG Streams (`WritableStream`).

Accomplishing this required resolving profound architectural dilemmas: bypassing internal video and audio encoders without breaking fundamental WebRTC invariants—such as real-time congestion control (GCC/TWCC), RTP packetization pacing, and receiver-driven Picture Loss Indication (PLI) / Full Intra Request (FIR) feedback loops. To resolve this, a dual **Proxy Encoder/Track pattern** was invented in the native C++ layer. Furthermore, a novel type-safe representation using `std::variant` was designed to resolve RFC 3550 RTP timestamp random offset discrepancies without introducing semantic ambiguity. Finally, this work details the intricate software engineering choreography needed to land 13 WebRTC changes and 10 Chromium changes across an asynchronous multi-repository rolling infrastructure, culminating in successful code reviews by principal systems architects (including the WebRTC Root Owner) and formal submission to the W3C WebRTC Working Group.

---

## Table of Contents

- [1. Introduction and Problem Statement](#1-introduction-and-problem-statement)
  - [1.1 The Modern Web Platform: From Document Viewer to Universal Application Runtime](#11-the-modern-web-platform-from-document-viewer-to-universal-application-runtime)
  - [1.2 The Governance and Standards Ecosystem: The Symbiosis of W3C and IETF](#12-the-governance-and-standards-ecosystem-the-symbiosis-of-w3c-and-ietf)
  - [1.3 The WebRTC Standard: Principles, Architecture, and Foundational Pillars](#13-the-webrtc-standard-principles-architecture-and-foundational-pillars)
  - [1.4 Real-Time Multimedia Networking: Why UDP, RTP, and RTCP?](#14-real-time-multimedia-networking-why-udp-rtp-and-rtcp)
  - [1.5 The Traditional Ingestion Paradigm and the Re-Encoding Bottleneck](#15-the-traditional-ingestion-paradigm-and-the-re-encoding-bottleneck)
  - [1.6 Emerging Web Topologies and the Missing Architectural Link](#16-emerging-web-topologies-and-the-missing-architectural-link)
  - [1.7 Project Scope and Objectives of the Dissertation](#17-project-scope-and-objectives-of-the-dissertation)
- [2. Technical Background & Architectural Foundations](#2-technical-background--architectural-foundations)
  - [2.1 The Modern Web Platform & Chromium Multi-Process Architecture](#21-the-modern-web-platform--chromium-multi-process-architecture)
  - [2.2 WebRTC Architecture and the libwebrtc Core Engine](#22-webrtc-architecture-and-the-libwebrtc-core-engine)
  - [2.3 Real-Time Media Transport: RTP, RTCP, and Congestion Control](#23-real-time-media-transport-rtp-rtcp-and-congestion-control)
  - [2.4 Digital Audio and Video Encoding Dynamics](#24-digital-audio-and-video-encoding-dynamics)
  - [2.5 The State of the Web Prior to Encoded Source](#25-the-state-of-the-web-prior-to-encoded-source)
- [3. System Design & Architectural Specification](#3-system-design--architectural-specification)
  - [3.1 Web API Ergonomics & Specification](#31-web-api-ergonomics--specification)
  - [3.2 Autonomous Frame Constructors and Metadata Initialization](#32-autonomous-frame-constructors-and-metadata-initialization)
  - [3.3 The Core Architectural Dilemma: Bypassing Encoding while Preserving Pipeline Invariants](#33-the-core-architectural-dilemma-bypassing-encoding-while-preserving-pipeline-invariants)
  - [3.4 The Solution: The Native Dual-Proxy Pattern](#34-the-solution-the-native-dual-proxy-pattern)
  - [3.5 Resolving the RTP Timestamp Semantic Discrepancy](#35-resolving-the-rtp-timestamp-semantic-discrepancy)
  - [3.6 Cross-Process and Cross-Thread Concurrency Architecture](#36-cross-process-and-cross-thread-concurrency-architecture)
- [4. Implementation Journey & Engineering Methodology](#4-implementation-journey--engineering-methodology)
  - [4.1 Chronological Development Overview (22-Week Trajectory)](#41-chronological-development-overview-22-week-trajectory)
  - [4.2 Phase 1: Exploration, Prototype, and the Inactivity Observer Bug](#42-phase-1-exploration-prototype-and-the-inactivity-observer-bug)
  - [4.3 Phase 2: Frame Constructors and the 7-Step Cross-Repository Roll](#43-phase-2-frame-constructors-and-the-7-step-cross-repository-roll)
  - [4.4 Phase 3: Video Ingestion Pipeline and the Proxy Encoder Architecture](#44-phase-3-video-ingestion-pipeline-and-the-proxy-encoder-architecture)
  - [4.5 Phase 4: Audio Ingestion Pipeline and Extended Metadata Delivery](#45-phase-4-audio-ingestion-pipeline-and-extended-metadata-delivery)
  - [4.6 Comprehensive Inventory of Contributions (WebRTC & Chromium CLs)](#46-comprehensive-inventory-of-contributions-webrtc--chromium-cls)
- [5. Verification, Testing, and Empirical Evaluation](#5-verification-testing-and-empirical-evaluation)
  - [5.1 Multi-Tiered Testing Pyramid](#51-multi-tiered-testing-pyramid)
  - [5.2 Concurrency Verification and Flaky Test Remediation](#52-concurrency-verification-and-flaky-test-remediation)
  - [5.3 Testbed Demonstration and Performance Evaluation](#53-testbed-demonstration-and-performance-evaluation)
- [6. Advancements for the Web Platform & Standardization](#6-advancements-for-the-web-platform--standardization)
  - [6.1 Paradigm Shifts in Web Architecture](#61-paradigm-shifts-in-web-architecture)
  - [6.2 Efficiency Gains and Ecological Footprint](#62-efficiency-gains-and-ecological-footprint)
  - [6.3 Standards Engagement: The W3C WebRTC Extensions Working Group](#63-standards-engagement-the-w3c-webrtc-extensions-working-group)
- [7. Conclusion & Personal Reflections](#7-conclusion--personal-reflections)
  - [7.1 Summary of Deliverables](#71-summary-of-deliverables)
  - [7.2 Professional and Engineering Growth](#72-professional-and-engineering-growth)
  - [7.3 Future Perspectives](#73-future-perspectives)
- [8. References & Codebase Catalog](#8-references--codebase-catalog)
  - [8.1 Author Contribution Portals & Gerrit Dashboards](#81-author-contribution-portals--gerrit-dashboards)
  - [8.2 Project Deliverables & Standards Proposals](#82-project-deliverables--standards-proposals)
  - [8.3 IETF RFCs & Internet Protocol Specifications](#83-ietf-rfcs--internet-protocol-specifications)
  - [8.4 W3C Recommendations & Web Platform Specifications](#84-w3c-recommendations--web-platform-specifications)
  - [8.5 Academic Literature, System Architecture Guides & Technical References](#85-academic-literature-system-architecture-guides--technical-references)
  - [8.6 Upstream Code Reviews (Comprehensive Change Lists Catalog)](#86-upstream-code-reviews-comprehensive-change-lists-catalog)

---
## 1. Introduction and Problem Statement

### 1.1 The Modern Web Platform: From Document Viewer to Universal Application Runtime
The World Wide Web has undergone a profound architectural metamorphosis over the past three decades. Conceived initially at CERN as a distributed hypermedia system for sharing static text and linked documents via the Hypertext Transfer Protocol (HTTP), the modern Web Platform has evolved into a universal, ubiquitous application execution environment. Today, web browsers serve as cross-platform virtual operating systems executing untrusted, complex software across billions of heterogeneous devices—spanning smartphones, laptops, high-performance desktop workstations, and embedded devices.

The modern web application stack is built upon three core layers:
1. **Declarative Presentation and Structure (HTML5 & CSS3):** Providing semantic structure, styling, and fluid responsive user interfaces.
2. **High-Performance Execution Engines (JavaScript & WebAssembly):** Powered by modern Just-In-Time (JIT) optimizing virtual machines (such as V8) and the WebAssembly (Wasm) binary instruction format, web engines execute computationally demanding workloads at speeds approaching bare-metal compiled C/C++.
3. **Rich Web Application Programming Interfaces (Web APIs):** Standardized programming interfaces that grant web applications managed, event-driven access to host hardware capabilities—including 2D/3D graphics acceleration (WebGL, WebGPU), device file access, sensors, multi-channel audio synthesis (Web Audio), and multi-threaded background processing (Web Workers).

Crucially, the Web Platform operates under a fundamental security contract: **the browser must execute arbitrary, untrusted remote code downloaded dynamically over the network without compromising the host operating system, user privacy, or device integrity**. To honor this contract, browser engines enforce strict security perimeters:
* **The User-Space Sandbox:** Restricting operating system system calls (e.g., using Linux `seccomp-bpf` filters, macOS Seatbelt profiles, or Windows integrity levels) and disallowing direct access to arbitrary memory, local filesystems, or raw operating system network sockets.
* **The Same-Origin Policy (SOP):** Isolating the execution state, DOM trees, cookies, and storage of distinct web origins.
* **Explicit Permission Gateways:** Enforcing runtime user consent prompts before allowing scripts to access sensitive hardware peripherals, such as webcams, microphones, or geolocation sensors.

This security model creates an inherent engineering tension: **how can web engines provide high-performance, low-latency access to media hardware and network transports without compromising the security and isolation guarantees of the web sandbox?**

### 1.2 The Governance and Standards Ecosystem: The Symbiosis of W3C and IETF
A distinctive and often misunderstood aspect of web networking is that real-time communication on the web is not governed by a single standardization body. Instead, it relies on an intricate, coordinated symbiosis between two major international standards organizations with historically divergent engineering cultures:

```
+---------------------------------------------------------------------------------------+
| World Wide Web Consortium (W3C)                                                       |
|   - Working Groups: WebRTC WG, Media WG                                               |
|   - Core Deliverables: JavaScript Web APIs, WebIDL Interfaces, DOM Lifecycle          |
|   - Conceptual Scope: "How web applications interact with the browser engine"         |
|   - Key Specifications: WebRTC 1.0, WebCodecs, WHATWG Streams, Web Audio               |
+---------------------------------------------------------------------------------------+
                                           |
                                           | Bidirectional Architectural Handshake
                                           v
+---------------------------------------------------------------------------------------+
| Internet Engineering Task Force (IETF)                                                |
|   - Working Groups: RTCWEB, AVTCORE, MMUSIC, TLS                                      |
|   - Core Deliverables: Network Protocols, Wire Formats, Cryptographic State Machines |
|   - Conceptual Scope: "How packets, bits, and encryption travel across IP networks"   |
|   - Key Standards: RFC 3550 (RTP/RTCP), RFC 3711 (SRTP), RFC 5245 (ICE), RFC 8825      |
+---------------------------------------------------------------------------------------+
```

1. **The World Wide Web Consortium (W3C):**
   * **Domain & Focus:** The W3C governs the browser-side application execution model. It specifies developer-facing application programming interfaces using the formal Web Interface Definition Language (WebIDL).
   * **Responsibilities:** Defines JavaScript interfaces (`RTCPeerConnection`, `RTCRtpSender`, `MediaStreamTrack`), browser event loops, DOM integration, garbage collection lifetime semantics, error codes, and thread synchronization models.
   * **Key Question Addressed:** *How do software engineers write portable JavaScript code to express intent within the browser runtime?*
2. **The Internet Engineering Task Force (IETF):**
   * **Domain & Focus:** The IETF governs the underlying wire protocols, packet structures, cryptographic handshakes, and transport mechanics across IP networks.
   * **Responsibilities:** Through dedicated working groups—most notably **RTCWEB (Real-Time Communication in Web-browsers)**, **AVTCORE (Audio/Video Transport Core)**, and **MMUSIC (Multiparty Multimedia Session Control)**—the IETF standardizes the wire protocols that browsers must implement to interoperate securely with each other and with telecommunication gateways.
   * **Key Question Addressed:** *How are data packets structured, encrypted, routed, paced, and recovered across physical network links?*

#### The Architectural Handshake
The W3C and IETF coordinate through a strict architectural handshake. For example:
* When a web application executes the W3C JavaScript method `pc.createOffer()`, the browser engine queries its internal media engine to formulate an IETF-compliant **Session Description Protocol (SDP)** message [RFC 8866].
* When media flows through a W3C `RTCRtpSender`, the browser transmits packets formatted strictly according to the IETF **Real-time Transport Protocol (RTP)** [RFC 3550] and encrypted via the IETF **Secure Real-time Transport Protocol (SRTP)** [RFC 3711].

Understanding this dual-governance model is vital: advancing a feature in WebRTC requires both specifying developer-facing WebIDL interfaces within the W3C and ensuring strict protocol compliance with IETF transport RFCs.

### 1.3 The WebRTC Standard: Principles, Architecture, and Foundational Pillars
Standardized in 2021 as a joint W3C Recommendation and IETF RFC suite [RFC 8825, W3C WebRTC 1.0], **WebRTC (Web Real-Time Communication)** represents the culmination of a decade of standardization. 

#### Historical Motivation
Prior to WebRTC’s advent in 2011, transmitting live audio and video in web browsers was plagued by architectural limitations:
* **The Plugin Era:** Applications relied on proprietary, compiled binary plugins—most notably Adobe Flash Player (via the Real-Time Messaging Protocol / RTMP) or Microsoft Silverlight. These binary blobs bypassed browser security sandboxes, suffered from critical zero-day vulnerabilities, crashed browser processes, lacked mobile battery optimization, and were completely closed-source.
* **HTTP Chunked Streaming:** Standard web streaming protocols (HTTP Live Streaming / HLS, Dynamic Adaptive Streaming over HTTP / DASH) operate on top of TCP and chunked video files (.ts, .m4s). These protocols incur high end-to-end latencies—typically between **5 to 30 seconds**. While acceptable for passive television broadcasts, such latencies are entirely unusable for conversational, interactive communication (where end-to-end latency must remain strictly below **200 milliseconds**).

#### The Three Foundational Pillars of WebRTC
WebRTC unlocked native, plugin-free real-time communication by introducing three core architectural pillars:

```
+---------------------------------------------------------------------------------------+
| The Three Pillars of WebRTC Architecture                                              |
|                                                                                       |
|  [ Pillar 1: Media Capture ]       [ Pillar 2: Peer Connection ]    [ Pillar 3: Data] |
|   - getUserMedia()                  - RTCPeerConnection              - RTCDataChannel |
|   - MediaStreamTrack (Audio/Video)  - ICE (STUN / TURN NAT Traversal)- SCTP over DTLS |
|   - Local Hardware Mediation        - DTLS-SRTP Key Exchange/Crypto  - Low Latency    |
|   - User Permission Enclaves        - SDP Offer/Answer Negotiation   - Arbitrary Byte |
|                                     - Adaptive Jitter Buffers/BWE    |  Transport     |
+---------------------------------------------------------------------------------------+
```

1. **Pillar 1: Media Capture and Local Streams (`MediaStream`, `MediaStreamTrack`):**
   Provides uniform abstraction for accessing local capture peripherals. It encapsulates synchronized tracks of audio or video, managing hardware acquisition, format conversion, and user permission workflows.
2. **Pillar 2: Real-Time Peer-to-Peer Transport (`RTCPeerConnection`):**
   The central coordination engine responsible for establishing, securing, maintaining, and monitoring an interactive multimedia link between two endpoints:
   * **NAT and Firewall Traversal via ICE:** Because most consumer devices lack public IPv4/IPv6 addresses and reside behind Network Address Translation (NAT) routers or corporate firewalls, direct socket connection is impossible. WebRTC incorporates **Interactive Connectivity Establishment (ICE)** [RFC 5245]. Endpoints query **STUN (Session Traversal Utilities for NAT)** servers to discover their reflexive public IP:port bindings, exchange candidate pairs via signaling, and systematically probe connectivity. If direct peer-to-peer transmission is blocked by symmetric NATs, traffic falls back transparently to an encrypted relay using **TURN (Traversal Using Relays around NAT)** servers.
   * **Mandatory Security Architecture:** WebRTC enforces end-to-end encryption by design. Unencrypted communication is forbidden. Connection establishment initiates an asynchronous **Datagram Transport Layer Security (DTLS)** [RFC 6347] handshake over UDP. The endpoints authenticate using self-signed cryptographic certificates and derive symmetric session keys. These keys are used by **SRTP (Secure Real-time Transport Protocol)** [RFC 3711] to encrypt all media payloads with AES-CM (Counter Mode) and authenticate packets with HMAC-SHA1.
   * **The Deliberate Decoupling of Signaling:** WebRTC intentionally standardizes only the media transport, leaving the **signaling channel** (the transport used to exchange initial connection metadata, SDP offers, and ICE candidates) undefined. Developers can transmit signaling messages over WebSockets, Server-Sent Events (SSE), SIP, or RESTful HTTP endpoints, ensuring maximum architectural flexibility.
3. **Pillar 3: Low-Latency Arbitrary Data Channels (`RTCDataChannel`):**
   Extends real-time capabilities beyond audiovisual streams. By layering the **Stream Control Transmission Protocol (SCTP)** [RFC 4960] over encrypted DTLS tunnels, `RTCDataChannel` provides bidirectional, sub-second transport for arbitrary binary or string data, supporting both reliable-ordered (TCP-like) and unreliable-unordered (UDP-like) delivery modes.

### 1.4 Real-Time Multimedia Networking: Why UDP, RTP, and RTCP?
To understand why WebRTC is designed as it is, one must examine the fundamental transport dilemmas of computer networking.

#### The Transport Layer Dilemma: Why TCP is Unusable for Conversational Media
The Internet transport layer provides two foundational transport protocols: the **Transmission Control Protocol (TCP)** and the **User Datagram Protocol (UDP)**.

TCP is the bedrock of the World Wide Web, powering HTTP/1.1, HTTP/2, TLS, SSH, and file transfers. It guarantees **reliable, byte-ordered, lossless delivery** through cumulative acknowledgments, sequence tracking, and retransmission timeouts. However, these very guarantees make TCP fundamentally unsuitable for conversational real-time communication:
1. **Head-of-Line (HoL) Blocking:** In TCP, if a single packet is delayed or dropped on a noisy wireless link, the operating system kernel refuses to deliver any subsequent packets to the receiving application until the lost packet is retransmitted and acknowledged. The entire stream halts. In a live video call, this results in frozen frames and stuttering audio.
2. **The Perceptual Reality of Real-Time Media:** In human conversational speech, media data has a strict temporal expiration window (often less than 150–200 ms). **A late packet is worse than a lost packet**. If an audio packet arrives 400 ms late due to a TCP retransmission, its playback instant has already passed; playing it produces jarring echoes or garbled audio. It is far better to drop the missing packet, extrapolate the missing waveform using packet loss concealment (PLC), and immediately render the fresh incoming frame.
3. **TCP Congestion Backoff:** When TCP detects packet loss, it assumes network buffer overflow and cuts its transmission window (often by half in TCP Reno/Cubic). This sudden throttling causes drastic throughput collapses that disrupt continuous real-time video bitrates.

```
TCP vs. UDP in Real-Time Media Transmission:

TCP Transmission (Head-of-Line Blocking):
Packet 1 [Received] ---> Delivered to Decoder
Packet 2 [DROPPED]  ---> WAITING FOR RETRANSMISSION ... [Stream Halts]
Packet 3 [Received] ---> BUFFERED IN KERNEL (Cannot be delivered)
Packet 4 [Received] ---> BUFFERED IN KERNEL (Cannot be delivered)
                       *Result: Video freezes, latency increases by 300ms+*

UDP / RTP Transmission (Zero Head-of-Line Blocking):
Packet 1 [Received] ---> Delivered to Decoder
Packet 2 [DROPPED]  ---> Skipped! Concealment applied.
Packet 3 [Received] ---> Delivered immediately to Decoder
Packet 4 [Received] ---> Delivered immediately to Decoder
                       *Result: Microscopic artifact, zero latency penalty*
```

#### Why Raw UDP is Insufficient
To circumvent Head-of-Line blocking, real-time media strictly utilizes **UDP**. UDP is connectionless and lightweight; it fires packets into the IP network without retransmission or ordering guarantees. 

However, raw UDP provides none of the facilities that digital audiovisual streams require:
* It has no sequence numbers: the receiver cannot detect packet loss or reorder packets that take divergent network paths.
* It has no timing information: the receiver cannot reconstruct the original sampling clock or compute playback jitter.
* It has no codec payload identification: the receiver cannot determine which decoder should process the datagram.
* It has no congestion control: blasting UDP packets unchecked risks inducing catastrophic network congestion collapses.

#### The Role of RTP (Real-time Transport Protocol, RFC 3550)
To bridge this gap, the IETF developed the **Real-time Transport Protocol (RTP)** [RFC 3550]. RTP is an application-level framing protocol layered directly inside UDP datagrams.

RTP equips every packet with a standard header containing:
* **Sequence Numbers:** A 16-bit monotonically increasing counter. Receivers use sequence numbers to calculate packet loss rates, detect out-of-order deliveries, reorder packets inside a **jitter buffer**, and issue selective retransmission requests (NACKs) if timing permits.
* **Media Timestamps:** A 32-bit timestamp reflecting the precise sampling instant of the media frame. Timestamps advance at high-frequency media clock rates:
  * **Video:** Clocked at **90,000 Hz (90 kHz)**, providing sub-millisecond precision aligned with frame rates (24, 30, 60 fps).
  * **Audio (Opus):** Clocked at **48,000 Hz (48 kHz)**.
  This timestamp allows the receiver's jitter buffer to decouple network transmission arrival jitter from smooth media playback, and synchronizes audio and video tracks (lip-sync).
* **Payload Type (PT):** Dynamically bound via SDP to specific codec bitstream parsers (e.g., PT 96 for VP8, PT 111 for Opus).

#### The Role of RTCP (RTP Control Protocol)
RTP is paired with a continuous out-of-band telemetry protocol: **RTCP (RTP Control Protocol)** [RFC 3550]. Operating over the same transport session, RTCP provides three critical capabilities:
1. **Network Telemetry & Quality of Service (QoS):** Endpoints exchange periodic **Sender Reports (SR)** and **Receiver Reports (RR)**. By correlating packet transmit timestamps with arrival timestamps, endpoints calculate round-trip time (RTT), cumulative packet loss fractions, and interarrival packet jitter.
2. **Reactive Error Resilience:** In real-time video, if a receiver experiences packet loss that corrupts its decoding buffer, it cannot decode subsequent delta frames. The receiver transmits an RTCP feedback message:
   * **Picture Loss Indication (PLI, RFC 4585):** Informs the sender that reference pictures were lost.
   * **Full Intra Request (FIR, RFC 5104):** Commands the sender to generate an independent intra/keyframe immediately.
3. **Dynamic Congestion Control:** Modern WebRTC does not blast media blindly. Senders evaluate delay gradients and loss telemetry (via Google Congestion Control / GCC or Transport-Wide Congestion Control / TWCC [RFC 8888]). When the network exhibits queuing delay, the sender's bandwidth estimator (BWE) throttles the active encoder's bitrate in real time to match the channel's dynamic carrying capacity.

### 1.5 The Traditional Ingestion Paradigm and the Re-Encoding Bottleneck
Having established the foundational architecture of the Web Platform, WebRTC, and RTP, we now arrive at the central problem that motivated this research: **the rigid, monolithic media ingestion pipeline of WebRTC 1.0**.

In traditional WebRTC 1.0:
1. The web application acquires hardware access via `navigator.mediaDevices.getUserMedia()`.
2. The browser captures raw, uncompressed frames—typically planar YUV 4:2:0 pixels for video and 16-bit linear PCM audio samples.
3. The raw stream is encapsulated inside a `MediaStreamTrack` and assigned to an `RTCRtpSender`.
4. The underlying native media engine (`libwebrtc`) manages an internal, monolithic encoding subsystem (`VideoStreamEncoder` or `AudioSendStream`), which compresses the raw frames using an internally negotiated codec (such as VP8, VP9, AV1, H.264, or Opus).
5. The resulting compressed bitstream is packetized into Real-time Transport Protocol (RTP) packets, encrypted via SRTP, paced, and transmitted over UDP.

```
+-----------------------------------------------------------------------+
| Traditional WebRTC 1.0 Media Pipeline                                 |
|                                                                       |
|  [Webcam / Mic]                                                       |
|        |                                                              |
|        v Raw Frames (Uncompressed YUV 4:2:0 / Linear PCM)             |
|  [MediaStreamTrack]                                                   |
|        |                                                              |
|        v                                                              |
|  [RTCRtpSender]                                                       |
|        |                                                              |
|        v                                                              |
|  +-----------------------------------------------------------------+  |
|  | Native libwebrtc Core Engine                                    |  |
|  |   - Internal Codec Engine (VideoStreamEncoder / AudioSendStream)|  |
|  |   - Software / Hardware Codec Driver (VP8/VP9/AV1/H.264/Opus)   |  |
|  +-----------------------------------------------------------------+  |
|        |                                                              |
|        v Compressed Bitstream                                         |
|  +-----------------------------------------------------------------+  |
|  | RTP Packetization, Pacing Queue, and SRTP Encryption Layer      |  |
|  +-----------------------------------------------------------------+  |
|        |                                                              |
|        v SRTP Packets over UDP                                        |
|  [Network Transport]                                                  |
+-----------------------------------------------------------------------+
```

While this monolithic design was well-suited for standard point-to-point video calls, it exhibits catastrophic performance bottlenecks when applied to modern, distributed web media topologies.

Consider a common scenario in distributed conferencing: a web application receives an already-encoded video stream (e.g., from an upstream peer connection, an external media server, a WebTransport endpoint, or a local container file) and seeks to **forward** or **relay** that stream to another peer. Because `RTCRtpSender` strictly required a raw `MediaStreamTrack`, the web application was forced into an involuntary **decode-then-re-encode** cycle:

$$\text{Incoming Encoded Bitstream} \xrightarrow{\text{Decompress / Decode}} \text{Raw YUV Canvas / Track} \xrightarrow{\text{Re-compress / Encode}} \text{Outgoing Bitstream}$$

This architectural detour incurs three severe engineering penalties:
* **Severe Computational Overhead and Thermal Throttling:** Video compression is among the most computationally intensive operations in modern software engineering. Re-encoding an HD (1080p at 60 fps) or 4K video stream fully saturates multiple CPU cores or monopolizes dedicated hardware encoder blocks. On mobile devices, ultrabooks, and embedded systems, this causes immediate thermal throttling, acoustic fan noise, and rapid battery depletion.
* **Compounded Glass-to-Glass Latency:** Decompressing the input bitstream introduces buffering delays (10–30 ms); synchronizing and rendering frames onto a virtual canvas or fake media track introduces thread-scheduling latency (16–33 ms); and the secondary encoder pass incurs motion estimation, rate-control calculation, and macroblock analysis latency (30–80 ms). The cumulative 50–150 ms latency penalty severely degrades interactive real-time experiences, violating human perceptual thresholds for conversational interactivity.
* **Cascading Generation Loss:** Modern video codecs (H.264, VP9, AV1) are lossy compression algorithms. Decompressing a lossy bitstream and re-encoding it causes cumulative quantization errors, high-frequency blurring, and ringing artifacts around edges. Even if the secondary encoder is allocated a substantially higher bitrate than the original stream, the visual quality is strictly inferior to the original stream.

### 1.6 Emerging Web Topologies and the Missing Architectural Link
Over the past five years, the web standards community sought to grant web developers lower-level control over media processing by introducing two complementary standards:
1. **WebRTC Encoded Transform (Insertable Streams):** Standardized by the W3C WebRTC Working Group, this API enables applications to insert a `TransformStream` between the internal encoder and the packetizer, or between the depacketizer and the decoder. While revolutionary for client-side end-to-end encryption (E2EE) in multi-party conferences, Encoded Transform is strictly constrained: it can only manipulate frames *already produced* by WebRTC's internal encoder or received from an active remote connection. It provides no mechanism to inject externally generated frames into an `RTCRtpSender`.
2. **WebCodecs:** Standardized by the W3C Media Working Group, WebCodecs provides low-level, high-performance JavaScript interfaces to the browser's underlying hardware and software video and audio codecs. Applications can feed raw `VideoFrame` objects into a `VideoEncoder` and obtain standalone `EncodedVideoChunk` instances.

Crucially, **there was no architectural bridge linking WebCodecs to WebRTC**. A web developer could encode video using WebCodecs with custom quantization parameters, but had no way to inject those chunks into an `RTCRtpSender` for RTP transmission. Similarly, an application could extract encoded chunks from an incoming peer connection, but could not route them into a sending peer connection without decompressing them first.

```
Existing Capabilities in Modern Browsers (The Structural Gap):
+-------------------------+
| WebCodecs VideoEncoder  | ---> Produces EncodedVideoChunk (Isolated; No route to WebRTC)
+-------------------------+

+-------------------------+
| Incoming RTCRtpReceiver | ---> Encoded Transform extracts frames (Cannot be reinjected)
+-------------------------+

The Architectural Missing Link:
+-------------------------+      +-------------------------------+      +------------------+
| Externally Encoded Media| ===> |  WebRTC Encoded Source API    | ===> |  RTCRtpSender    |
| (WebCodecs / Relays)    |      | (Zero-Transcode Ingestion Path|      |  (RTP/SRTP Wire) |
+-------------------------+      +-------------------------------+      +------------------+
```

### 1.7 Project Scope and Objectives of the Dissertation
The objective of this graduation project was to eliminate this foundational architectural bottleneck by architecting, implementing, verifying, and standardizing a native zero-transcode media ingestion path for the World Wide Web.

The project encompassed five core engineering deliverables:
1. **Specification & API Design:** Design an idiomatic, asynchronous Web API following W3C and WebIDL conventions, allowing web applications to establish an encoded media source in Dedicated Workers via standard WHATWG Streams (`WritableStream`).
2. **Autonomous Frame Constructors:** Specify and implement public JavaScript constructors for `RTCEncodedVideoFrame` and `RTCEncodedAudioFrame` with supporting initialization dictionaries, decoupling frame lifetime from internal engine delegates.
3. **Native Engine Architecture in libwebrtc:** Invent a high-performance C++ subsystem within the native `libwebrtc` reference library capable of ingesting pre-encoded frames while preserving critical real-time transport invariants—specifically RTCP Picture Loss Indication (PLI) requests, Full Intra Request (FIR) signals, packet pacing, and real-time Bandwidth Estimation (BWE) rate control.
4. **Blink Renderer Plumbing & Multi-Repo Upstreaming:** Implement the Blink DOM bindings and renderer plumbing in Chromium, navigating the multi-process security sandbox, Oilpan garbage collection, and the complex multi-repository roll choreography between Chromium and WebRTC.
5. **Standards Advancement:** Co-author the official W3C WebRTC Extensions Explainer and advance the feature through the W3C WebRTC Working Group and the Chromium Intent to Prototype (I2P) process.

---
## 2. Technical Background & Architectural Foundations

Understanding the execution and design of this project requires analyzing the convergence of web browser internals, real-time networking protocols, and modern media compression theory.

### 2.1 The Modern Web Platform & Chromium Multi-Process Architecture
Modern web browsers are among the most complex software systems ever constructed. To ensure robust security, fault isolation, and responsive user interfaces, Chromium employs a **multi-process architecture** [Chromium Docs]. Rather than running all browser tabs and rendering engines within a single address space, execution is partitioned into isolated operating system processes:

```
+-----------------------------------------------------------------------------------+
| Browser Process (Privileged: UI, Disk I/O, Network Sockets, Device Management)   |
+-----------------------------------------------------------------------------------+
       ^                                                 ^
       | Mojo IPC                                        | Mojo IPC
       v                                                 v
+-----------------------------+               +-------------------------------------+
| Renderer Process (Sandboxed)|               | GPU Process (Sandboxed)             |
|  - Blink Rendering Engine   |               |  - Direct Hardware GPU Access       |
|  - V8 JavaScript Engine     |               |  - Hardware Video Codec Acceleration|
|  - Memory: Oilpan C++ GC    |               +-------------------------------------+
|  - Threading:               |
|     * Main Thread (DOM)     |
|     * Dedicated Workers     |
|     * libwebrtc Thread Pool |
+-----------------------------+
```

* **The Browser Process:** Runs with full user privileges. It controls the browser chrome, manages windowing and user input, orchestrates disk storage, and possesses exclusive authority to broker operating system network sockets and camera/microphone hardware.
* **The Renderer Process (Sandboxed):** Executes the **Blink** rendering engine and the **V8** JavaScript virtual machine. Renderers execute inside an unprivileged operating system sandbox (e.g., using Linux seccomp-bpf filters or macOS seatbelt sandboxes). A compromised renderer cannot read arbitrary files from the filesystem or initiate raw network connections; all hardware access and cross-process interactions must pass through strongly typed **Mojo IPC** channels to the Browser process.
* **Thread Partitioning within the Renderer:** Concurrency within Blink is strictly organized:
  * **Main Thread:** Executes DOM parsing, style computation, layout, page rendering, and standard application JavaScript. Performing blocking operations or compute-intensive media processing on the main thread introduces frame drops and UI jank.
  * **Dedicated Worker Threads:** Independent background execution contexts with their own V8 event loops. Modern web media pipelines (such as WebCodecs and WebRTC Encoded Transform) execute inside Dedicated Workers to ensure deterministic, low-latency processing isolated from UI activity.
* **Memory Management via Oilpan:** Blink manages the lifecycle of C++ DOM and Web API objects using **Oilpan**, a tracing garbage collector integrated directly with the V8 JavaScript VM. C++ classes managed by Oilpan inherit from `GarbageCollected<T>` and reference other managed objects using tracing pointers (`Member<T>`, `WeakMember<T>`). Every managed class must implement a `Trace(Visitor* visitor) const` method to allow the collector to traverse the object graph. Crossing thread boundaries requires specialized constructs, such as `CrossThreadHandle<T>` or `CrossThreadWeakHandle<T>`, to prevent multi-threaded race conditions during mark-and-sweep phases.

### 2.2 WebRTC Architecture and the libwebrtc Core Engine
WebRTC is implemented as a dual-layer architecture:
1. **Blink Web API Layer (`third_party/blink/renderer/modules/peerconnection/`):** Exposes WebIDL-compliant JavaScript interfaces (`RTCPeerConnection`, `RTCRtpSender`, `RTCRtpReceiver`, `RTCRtpTransceiver`) to web developers, handling DOM lifecycle, promise resolution, and parameter validation.
2. **Native libwebrtc Core Engine (`third_party/webrtc/`):** An industrial-grade, cross-platform C++ reference implementation. It incorporates jitter buffers, acoustic echo cancellation (AEC3), automatic gain control (AGC), noise suppression, video pacing queues, SRTP encryption, and the Interactive Connectivity Establishment (ICE) state machine.

#### libwebrtc Threading Model
To maintain real-time performance without lock contention, `libwebrtc` implements a dedicated three-thread concurrency architecture:

```
+-------------------+-------------------------------------------------------------------+
| Thread Name       | Architectural Responsibilities                                    |
+-------------------+-------------------------------------------------------------------+
| Signaling Thread  | Coordinates API method invocations from Blink, manages SDP offer/ |
|                   | answer state transitions, and enforces transceiver lifecycle.     |
+-------------------+-------------------------------------------------------------------+
| Worker Thread     | Handles heavy media processing, frame format conversions, native  |
|                   | encoder scheduling, capture device polling, and rate controllers. |
+-------------------+-------------------------------------------------------------------+
| Network Thread    | Manages physical UDP/TCP sockets, executes ICE candidate probing, |
|                   | performs DTLS handshakes, and handles SRTP packet encryption/I/O. |
+-------------------+-------------------------------------------------------------------+
```

#### Lock-Free Task Posting Paradigm
To eliminate deadlock hazards inherent in multi-threaded media pipelines, `libwebrtc` strictly prohibits coarse-grained cross-thread locking. Instead, components communicate via **asynchronous task posting** to thread-bound task queues (`webrtc::TaskQueueBase`). Objects enforce thread affinity at compile-time and runtime using `webrtc::SequenceChecker` annotations:
```cpp
RTC_NO_UNIQUE_ADDRESS SequenceChecker worker_sequence_checker_;
RTC_DCHECK_RUN_ON(&worker_sequence_checker_);
```
If a method annotated with `RTC_DCHECK_RUN_ON` is executed on an incorrect thread, debug builds immediately assert. Data passing between threads must be transferred via moved ownership (`std::unique_ptr`) or ref-counted immutable wrappers.

### 2.3 Real-Time Media Transport: RTP, RTCP, and Congestion Control
Media transmission across the internet is governed by the **Real-time Transport Protocol (RTP)** [RFC 3550] encapsulated within UDP datagrams.

#### The RTP Header Structure
Every media packet transmitted by WebRTC contains a 12-byte fixed RTP header:
```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|V=2|P|X|  CC   |M|     PT      |       Sequence Number         |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                           Timestamp                           |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|           Synchronization Source (SSRC) identifier            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```
* **Payload Type (PT):** A 7-bit field identifying the codec format negotiated via SDP (e.g., dynamic payload types 96–127).
* **Sequence Number:** A 16-bit integer that increments by 1 for each transmitted RTP packet. The receiving jitter buffer uses sequence numbers to detect lost packets, reconstruct transmission order, and request selective retransmissions (NACK).
* **SSRC (Synchronization Source):** A 32-bit identifier randomly generated to uniquely distinguish a media stream within an RTP session.
* **Timestamp:** Reflects the sampling instant of the first octet in the packet. The timestamp clock rate is defined by the codec specification:
  * **Video Streams:** Standardized at **90,000 Hz (90 kHz)** across all codecs (VP8, VP9, AV1, H.264), providing sub-millisecond precision aligned with common video refresh rates (24, 30, 60, 120 fps).
  * **Audio Streams (Opus):** Standardized at **48,000 Hz (48 kHz)**.

#### The RFC 3550 Random Offset Mandate
Section 5.1 of RFC 3550 dictates a critical security requirement:
> *"The initial value of the timestamp MUST be random, similar to the sequence number, to prevent known-plaintext attacks on encryption and to complicate replay attacks."*

Consequently, when `libwebrtc` initializes an RTP sender, it generates a cryptographically secure random 32-bit offset ($Offset_{SSRC}$). When the internal encoder produces a frame sampled at time $t_{sample}$, the transmitted RTP timestamp is computed as:

$$T_{RTP} = (t_{sample} \times \text{ClockRate}) + Offset_{SSRC} \pmod{2^{32}}$$

This security requirement introduces a fundamental architectural discrepancy when integrating user-space encoders (e.g., WebCodecs): user-space applications only have access to monotonic media timestamps starting at zero, with no visibility into the private random offset maintained inside the native network layer.

#### RTCP Feedback Loops & Dynamic Congestion Control
RTP is paired with the **RTP Control Protocol (RTCP)** [RFC 3550, RFC 4585], providing out-of-band monitoring, loss reports, and control messaging:
* **Picture Loss Indication (PLI, RFC 4585) & Full Intra Request (FIR, RFC 5104):** If a receiver experiences severe packet loss that corrupts its decoding reference buffer, it cannot decode subsequent delta frames. The receiver transmits an RTCP PLI or FIR packet over the backward channel. The sender must intercept this signal and command its encoder to produce a self-contained Keyframe immediately.
* **Bandwidth Estimation (BWE) & Congestion Control:** WebRTC implements advanced real-time congestion control algorithms—notably Google Congestion Control (GCC) and Transport-Wide Congestion Control (TWCC) [RFC 8888]. By measuring one-way packet delay gradients and loss rates, the sender continuously computes the available network channel capacity. It dynamically issues rate-allocation updates (`SetRates()`) to the active encoder, adjusting target bitrate, frame rate, and quantization parameters in real time to prevent network congestion collapses.

### 2.4 Digital Audio and Video Encoding Dynamics
Video compression algorithms achieve massive data reductions (often exceeding 100:1) by exploiting spatial and temporal redundancies:
* **Spatial Compression (Intra-Frame):** Compresses individual frames independently using discrete cosine transforms (DCT), intra-prediction, and entropy coding. Frames encoded purely spatially are **Keyframes** (or Intra/IDR frames). Keyframes are completely self-contained and allow decoders to synchronize immediately, but require substantial bit budgets.
* **Temporal Compression (Inter-Frame):** Compresses frames by referencing preceding frames, computing motion vectors, and encoding only the residual prediction error. These are **Delta frames** (P-frames or B-frames). Delta frames are extremely compact, but strictly depend on the integrity of preceding reference frames.

```
Video Inter-Frame Dependency Structure:
+-------------------+        +-------------------+        +-------------------+
|   Keyframe (I)    | <----- |  Delta Frame (P)  | <----- |  Delta Frame (P)  |
|  (Self-Contained) |        |  (Ref: Frame I)   |        |  (Ref: Frame P)   |
+-------------------+        +-------------------+        +-------------------+
```

If a delta frame is dropped or corrupted in transit, all subsequent delta frames become undecodable until a new Keyframe arrives. Therefore, **any zero-transcode ingestion API must propagate RTCP PLI/FIR keyframe requests directly from the network layer to the external frame generator**.

Furthermore, modern codecs support **Scalable Video Coding (SVC)**:
* **Temporal Scalability:** Partitioning frames into hierarchical layers (e.g., Layer 0 at 15 fps, Layer 1 at 30 fps, Layer 2 at 60 fps). Lower layers can be forwarded independently.
* **Spatial Scalability:** Encoding base layers (e.g., 360p) and enhancement layers (e.g., 720p, 1080p) within the same bitstream.

For audio, codecs like **Opus** [RFC 6716] compress audio in 20 ms frames (960 samples at 48 kHz). Opus operates in speech mode (SILK), music mode (CELT), or hybrid mode. Audio frames carry metadata such as **Audio Level** [RFC 6464] (used for visual active-speaker detection) and Contributing Source identifiers (CSRCs).

### 2.5 The State of the Web Prior to Encoded Source
Before this project, the Web Platform suffered from a severe structural limitation:
* `RTCEncodedVideoFrame` and `RTCEncodedAudioFrame` objects had **no public constructors**. They could only be synthesized internally by `libwebrtc` when receiving media or when processing frames produced by the browser's built-in encoder.
* An application utilizing WebCodecs could compress video with fine-grained control, but had no entrypoint to route the resulting `EncodedVideoChunk` into an `RTCRtpSender`.
* Forwarding an encoded stream between peer connections required decoding the stream to raw pixels, piping the canvas into a `MediaStreamTrack`, and forcing WebRTC to re-encode the stream from scratch.

---
## 3. System Design & Architectural Specification

To solve the re-encoding bottleneck, we designed and implemented a comprehensive architecture consisting of two primary pillars:
1. **Autonomous Frame Constructors:** Standardized WebIDL constructors enabling JavaScript to instantiate standards-compliant `RTCEncodedVideoFrame` and `RTCEncodedAudioFrame` objects from raw data buffers and metadata.
2. **The WebRTC Encoded Source API:** An asynchronous ingestion interface binding an `RTCRtpSender` directly to a Dedicated Worker, exposing an `RTCEncodedSource` object equipped with a standard WHATWG `WritableStream` and bidirectional control signaling.

### 3.1 Web API Ergonomics & Specification
The API was designed in strict alignment with modern W3C conventions, enforcing thread isolation, asynchronous execution, and type safety.

```
                                  Window Execution Context
                         +----------------------------------------+
                         | const pc = new RTCPeerConnection();    |
                         | const sender = pc.addTransceiver(...); |
                         +----------------------------------------+
                                             |
                                             | sender.createEncodedSource(worker)
                                             v
                      ================================================
                         Thread Boundary: Cross-Thread Task Dispatch
                      ================================================
                                             |
                                             v
                                  Dedicated Worker Context
                         +----------------------------------------+
                         | self.onrtcsenderencodedsource = (e) => |
                         |   const { encodedSource } = e;         |
                         |   const writer =                       |
                         |     encodedSource.writable.getWriter();|
                         +----------------------------------------+
                                       |            ^
                                       |            | RTCP Feedback Events
                    sinkWriter.write() |            | (PLI -> onkeyframerequest)
            (RTCEncodedVideoFrame)     |            | (BWE -> onbitrateinfochange)
                                       v            |
                         +----------------------------------------+
                         | RTCEncodedVideoUnderlyingSink (Blink)  |
                         +----------------------------------------+
                                             |
                                             v Native Method Call
                         +----------------------------------------+
                         | EncodedVideoFrameInjector (libwebrtc)  |
                         +----------------------------------------+
```

#### Method: `RTCRtpSender.createEncodedSource(Worker worker)`
Exposed on `RTCRtpSender` within the Window execution context:
```webidl
partial interface RTCRtpSender {
  [CallWith=ScriptState, RaisesException]
  Promise<undefined> createEncodedSource(Worker worker);
};
```
* Calling `createEncodedSource(worker)` transitions the sender into an encoded ingestion state.
* The method verifies that no conflicting media track is actively sending and initiates cross-thread registration with the specified Dedicated Worker.
* It returns a JavaScript `Promise<undefined>` that resolves once native plumbing is established.

#### Worker Interface: `RTCEncodedSource` & `self.onrtcsenderencodedsource`
In the Dedicated Worker context, the browser dispatches the `rtcsenderencodedsource` event on `DedicatedWorkerGlobalScope`, delivering an `RTCEncodedSource` instance:
```webidl
[Exposed=DedicatedWorker]
interface RTCEncodedSource : EventTarget {
  readonly attribute WritableStream writable;
  readonly attribute long allocatedBitrate;
  readonly attribute long availableOutgoingBitrate;
  attribute EventHandler onkeyframerequest;
  attribute EventHandler onbitrateinfochange;
};
```

#### End-to-End Application Example:
```javascript
// main.js (Window Context)
const pc = new RTCPeerConnection();
const transceiver = pc.addTransceiver('video', { direction: 'sendonly' });
const worker = new Worker('video_worker.js');
await transceiver.sender.createEncodedSource(worker);

// video_worker.js (Dedicated Worker Context)
self.onrtcsenderencodedsource = (event) => {
  const encodedSource = event.encodedSource;
  const writer = encodedSource.writable.getWriter();

  // Listen for receiver-driven keyframe requests (RTCP PLI / FIR)
  encodedSource.onkeyframerequest = () => {
    console.warn("Receiver requested an immediate Keyframe!");
    externalEncoder.encode(nextFrame, { keyFrame: true });
  };

  // Listen for real-time congestion control bandwidth allocations
  encodedSource.onbitrateinfochange = () => {
    console.log(`BWE Update: Allocated=${encodedSource.allocatedBitrate} bps`);
    externalEncoder.reconfigure({ bitrate: encodedSource.allocatedBitrate });
  };

  // Handle outgoing compressed chunks from WebCodecs
  externalEncoder.onoutput = (chunk, metadata) => {
    const rtcFrame = new RTCEncodedVideoFrame({
      type: chunk.type, // 'key' or 'delta'
      rtpTimestampWithoutOffset: computeRtpTimestamp(chunk.timestamp),
      data: chunk.data,
      mimeType: 'video/AV1',
      payloadType: 96,
      width: 1920,
      height: 1080
    });
    writer.write(rtcFrame);
  };
};
```

### 3.2 Autonomous Frame Constructors and Metadata Initialization
To allow applications to synthesize valid WebRTC frames from external bitstreams (such as WebCodecs chunks, WebSocket feeds, or file containers), we introduced standalone constructors for `RTCEncodedVideoFrame` and `RTCEncodedAudioFrame`.

#### Video Initialization Dictionary: `RTCEncodedVideoFrameInit`
```webidl
dictionary RTCEncodedVideoFrameInit {
  required RTCEncodedVideoFrameType type;
  required unsigned long rtpTimestampWithoutOffset;
  required BufferSource data;
  required DOMString mimeType;
  unsigned long payloadType;
  DOMHighResTimeStamp timestamp;
  DOMHighResTimeStamp captureTime;
  unsigned long width;
  unsigned long height;
};

[Exposed=(Window,DedicatedWorker)]
interface RTCEncodedVideoFrame {
  constructor(RTCEncodedVideoFrameInit init);
  readonly attribute RTCEncodedVideoFrameType type;
  readonly attribute unsigned long rtpTimestamp;
  attribute ArrayBuffer data;
  RTCEncodedVideoFrameMetadata getMetadata();
};
```

#### Audio Initialization Dictionary: `RTCEncodedAudioFrameInit`
```webidl
dictionary RTCEncodedAudioFrameInit {
  required unsigned long rtpTimestampWithoutOffset;
  required BufferSource data;
  required DOMString mimeType;
  unsigned long payloadType;
  DOMHighResTimeStamp timestamp;
  DOMHighResTimeStamp captureTime;
  sequence<unsigned long> contributingSources;
  octet audioLevel;
};

[Exposed=(Window,DedicatedWorker)]
interface RTCEncodedAudioFrame {
  constructor(RTCEncodedAudioFrameInit init);
  readonly attribute unsigned long rtpTimestamp;
  attribute ArrayBuffer data;
  RTCEncodedAudioFrameMetadata getMetadata();
};
```

### 3.3 The Core Architectural Dilemma: Bypassing Encoding while Preserving Pipeline Invariants
During initial development, our exploratory prototype attempted a naive shortcut: when `writer.write(rtcFrame)` was invoked, we extracted the underlying compressed payload and injected it directly into the RTP packetization layer (`RtpSenderVideo` and `ChannelSend`), bypassing `libwebrtc`'s native video encoder pipeline completely.

While this simplistic approach transmitted packets in basic point-to-point lab tests, it catastrophically destabilized the WebRTC media engine under production conditions:
1. **The Inactivity Observer Bug:** `libwebrtc` operates periodic watchdog routines on its worker thread that monitor encoder activity. Because our direct injection bypassed the native encoder, the watchdog detected zero frames passing through the encoder. It deduced that the encoder had crashed or stalled, and **silently purged the sender from the bandwidth estimation observer registry**. Consequently, RTCP bandwidth adaptation broke permanently: the sender stopped responding to network congestion, resulting in massive packet loss and call termination.
2. **Breakdown of Pacing and Keyframe Signaling:** The native `VideoStreamEncoder` does not simply compress pixels; it orchestrates rate control, enforces packet pacing budgets to prevent network bursts, calculates moving-average frame rates, and registers callbacks for RTCP PLI/FIR requests. Bypassing it severed the feedback loop: incoming PLI packets from remote receivers vanished inside the engine without notifying the application.

### 3.4 The Solution: The Native Dual-Proxy Pattern
To resolve this dilemma, we invented the **Dual-Proxy Pattern** in `libwebrtc`. Rather than gutting `libwebrtc`'s intricate media pipeline, we constructed lightweight proxy objects that emulate a standard camera track and encoder, completely satisfying all pipeline invariants while transparently substituting pre-encoded media:

```
+---------------------------------------------------------------------------------------+
| libwebrtc Core Engine Architecture (Dual-Proxy Pattern)                              |
|                                                                                       |
|   +-------------------+        Dummy Frames        +---------------------+            |
|   |  ProxyVideoTrack  | -------------------------> | VideoStreamEncoder  |            |
|   +-------------------+   (Black I420 Buffers)     +---------------------+            |
|            ^                                                  |                       |
|            | Trigger Pacing                                   | Encode(dummy)         |
|            |                                                  v                       |
|   +-------------------------------+                 +--------------------+            |
|   |  EncodedVideoFrameInjector    |                 | ProxyVideoEncoder  |            |
|   +-------------------------------+                 +--------------------+            |
|       |                       ^                        |           ^                  |
|       | InjectFrame(frame)    | RegisterEncoder()      | Discard   | RTCP Feedback    |
|       |                       +------------------------+ Dummy     | (PLI / BWE)      |
|       v                                                | Real Frame|                  |
|   +-------------------------------+                    +-----------+                  |
|   | Injected Frame Buffer (Deque) | ------------------------> |                       |
|   +-------------------------------+                           v                       |
|                                                     +--------------------+            |
|                                                     |  RtpSenderVideo    |            |
|                                                     |  (RTP Packetizer)  |            |
|                                                     +--------------------+            |
+---------------------------------------------------------------------------------------+
```

1. **`ProxyVideoTrack` (and `ProxyAudioTrack`):** Implements `webrtc::VideoTrackInterface`. When an application injects an encoded frame via `InjectFrame()`, `ProxyVideoTrack` injects a minimal, lightweight black `I420Buffer` of identical width and height into the native pipeline on the worker thread. This dummy frame drives the normal pacing and scheduling cadence inside `VideoStreamEncoder`.
2. **`ProxyVideoEncoder` (and `ProxyAudioEncoder`):** Implements `webrtc::VideoEncoder`. Registered into `libwebrtc` using a custom `ProxyVideoEncoderFactory`. When `VideoStreamEncoder` invokes `Encode(frame, frame_types)`:
   * The proxy encoder discards the dummy black frame.
   * It inspects `frame_types`: if a keyframe is requested (`kVideoFrameKey`), it fires the injector's `KeyFrameCallback`, which dispatches the `onkeyframerequest` event to the JavaScript worker!
   * It retrieves the actual pre-encoded frame from the `EncodedVideoFrameInjector` buffer.
   * It passes the real encoded frame to `EncodedImageCallback::OnEncodedImage()`, seamlessly delivering it to the RTP packetizer.
3. **Dynamic Rate Control Interception:** When the congestion controller evaluates network conditions, it calls `ProxyVideoEncoder::SetRates(RateControlParameters)`. The proxy intercepts this call and dispatches the allocated and available outgoing bitrates directly to JavaScript via `BitrateInfoCallback`.

This elegant design maintains 100% of WebRTC's native transport stability, congestion control, and pacing guarantees while achieving complete bypass of the compression compute overhead.

### 3.5 Resolving the RTP Timestamp Semantic Discrepancy
As introduced in Section 2.3, RFC 3550 mandates that transmitted RTP packets contain a random initial offset ($Offset_{SSRC}$). However, an external encoder (e.g., WebCodecs) only possesses a monotonic capture timestamp starting from zero:

$$t_{\text{raw}} = \frac{t_{\text{microseconds}} \times \text{ClockRate}}{1{,}000{,}000}$$

#### The Software Engineering Trap: Boolean Flag Anti-Pattern
An initial implementation attempt proposed adding an internal boolean flag (`has_offset_`) to frame objects and overloading the existing `uint32_t GetTimestamp()` method. 

During architectural review, we recognized that this introduced severe semantic ambiguity: any component calling `frame->GetTimestamp()` could never be certain whether the returned 32-bit integer was ready for transmission or required offset addition. This pattern invited subtle synchronization bugs across the codebase.

#### The Type-Safe Solution via `std::variant`
We overhauled the timestamp representation in `libwebrtc`'s public API (`api/frame_transformer_interface.h`) by introducing strongly typed wrappers encapsulated within a modern C++ `std::variant`:

```cpp
namespace webrtc {

// Explicitly represents an un-offset RTP timestamp supplied by user-space
struct RtpTimestampRaw {
  uint32_t value;
  constexpr explicit RtpTimestampRaw(uint32_t v) : value(v) {}
  constexpr operator uint32_t() const { return value; }
};

// Explicitly represents an RTP timestamp with the SSRC offset already applied
struct RtpTimestampWithOffset {
  uint32_t value;
  constexpr explicit RtpTimestampWithOffset(uint32_t v) : value(v) {}
  constexpr operator uint32_t() const { return value; }
};

// Type-safe variant enforcing compile-time correctness
using RtpTimestamp = std::variant<RtpTimestampRaw, RtpTimestampWithOffset>;

} // namespace webrtc
```

We added `GetRtpTimestampInfo()` to `TransformableFrameInterface`. When an `RTCEncodedVideoFrame` is instantiated from JavaScript, it is tagged as `RtpTimestampRaw`. 

When the frame reaches `RtpSenderVideoFrameTransformerDelegate`, the delegate inspects the variant:
* If `RtpTimestampWithOffset` is present, it is transmitted directly.
* If `RtpTimestampRaw` is present, the sender queries its internal channel state, applies the secret random offset, and forwards the packet:

$$T_{\text{final}} = t_{\text{raw}} + Offset_{SSRC} \pmod{2^{32}}$$

This design guarantees compile-time type safety and eliminates timestamp ambiguity across the entire WebRTC stack.

### 3.6 Cross-Process and Cross-Thread Concurrency Architecture
Traversing from a JavaScript Dedicated Worker in Blink to the network sockets in `libwebrtc` involves multiple thread hops:

```
[Dedicated Worker Thread]
   |  JavaScript: writer.write(rtcFrame)
   |  Blink: RTCEncodedVideoUnderlyingSink::write()
   v
[Cross-Thread Task Posting]
   |  PostTask to Renderer Main Thread / libwebrtc Worker Thread
   v
[libwebrtc Worker Thread]
   |  EncodedVideoFrameInjector::InjectFrame()
   |  ProxyVideoTrack::InjectBlackFrame()
   |  VideoStreamEncoder schedules encode pass
   v
[libwebrtc Encoder Queue]
   |  ProxyVideoEncoder::Encode() intercepts dummy frame
   |  Substitutes real EncodedImage from injector buffer
   |  EncodedImageCallback::OnEncodedImage()
   v
[libwebrtc Network Thread]
   |  RtpSenderVideo packetizes frame
   |  SRTP encryption
   |  UDP socket sendto()
```

To prevent memory leaks and race conditions:
* Blink utilizes `CrossThreadWeakHandle<RTCRtpSender>` to ensure that if a page closes or navigates while a worker is writing frames, tasks posted to the main thread safely abort without accessing deallocated memory.
* In `libwebrtc`, `EncodedVideoFrameInjector` protects its internal FIFO queue using a fine-grained `webrtc::Mutex` with a maximum capacity (`kMaxBufferedFrames = 20`) to absorb minor scheduling jitter between worker frame generation and pacing consumption.

---
## 4. Implementation Journey & Engineering Methodology

Executing this project required contributing directly to two of the largest open-source software codebases in existence: **Chromium** (over 35 million lines of code) and **libwebrtc** (over 1.5 million lines of code). The development trajectory spanned 22 weeks of intensive software engineering.

### 4.1 Chronological Development Overview (22-Week Trajectory)

| Timeline | Engineering Phase | Milestone & Architectural Challenges |
|---|---|---|
| **Weeks 1–3** | Environment & Onboarding | Set up Chromium and WebRTC build toolchains (`gn`, `ninja`), depot_tools, and development VMs. Studied multi-process isolation, Blink threading, and Oilpan GC. |
| **Weeks 4–6** | Proof of Concept & Initial Prototype | Built first functional prototype of `createEncodedSource`. Demonstrated peer-to-peer frame injection in a test webpage. Implemented RTCP PLI/FIR keyframe interception. |
| **Weeks 7–8** | Feedback Debugging & Architecture Pivot | Diagnosed the "Encoder Inactivity Bug" that broke bandwidth estimation. Formulated the Dual-Proxy Pattern (`ProxyVideoTrack`/`ProxyVideoEncoder`) to replace direct bypass. |
| **Weeks 9–12** | Audio Frame Constructor & Multi-Repo Roll | Designed `RTCEncodedAudioFrame` constructor. Implemented `std::variant` timestamp refactoring. Orchestrated the complex 7-CL WebRTC/Chromium integration roll. |
| **Weeks 13–15** | Video Frame Constructor & Audio Ingestion | Implemented `RTCEncodedVideoFrame` constructor. Added SVC spatial/temporal layer metadata. Developed working prototype for audio injection pipeline. |
| **Weeks 16–18** | Deep Refactoring of Video Ingestion | Replaced early transformer hacks with formal `ProxyVideoEncoder` and `ProxyVideoTrack`. Addressed architectural reviews from the WebRTC Root Owner (Principal Engineer / L8). |
| **Weeks 19–20** | Code Owner Reviews & Concurrency Polish | Refactored injector classes to adhere to strict lock-free task-posting guidelines. Converted shared state to thread-affinity checks (`RTC_DCHECK_RUN_ON`). |
| **Weeks 21–22** | Final Stabilization & Delivery | Landed remaining CLs, eliminated flaky test regressions, authored Web Platform Tests (WPT), and prepared the final interactive demonstration. |

### 4.2 Phase 1: Exploration, Prototype, and the Inactivity Observer Bug
Development began in Week 4 by investigating how `RTCRtpSender` could ingest frames from a JavaScript `ReadableStream`. By Week 5, we constructed a functional proof of concept: an exploratory web page established a primary peer connection (PC1), extracted compressed VP8 chunks using `RTCRtpScriptTransform`, buffered them in a queue to simulate network delay, and injected them into a secondary peer connection (PC2) using an early prototype of `createEncodedSource`. PC2 successfully decoded and displayed the reconstructed video.

However, during Week 7, stress testing revealed that the connection froze whenever synthetic packet loss or network throttling was applied. Detailed debugging in `libwebrtc` revealed that because our prototype bypassed `VideoStreamEncoder`, the engine's periodic encoder watchdog detected zero activity. It concluded that the encoder was inactive, and **silently removed the sender from the bandwidth observer list**. This broke RTCP bandwidth estimation permanently.

This discovery led directly to our architectural pivot in Week 8: creating `ProxyVideoTrack` and `ProxyVideoEncoder` to preserve `libwebrtc`'s internal assumptions while achieving zero-transcode pass-through.

### 4.3 Phase 2: Frame Constructors and the 7-Step Cross-Repository Roll
To enable applications to generate frames from scratch (e.g., using WebCodecs), we turned to implementing standalone frame constructors. 

While conceptually simple, landing this change exposed the immense engineering complexity of the **Chromium-WebRTC Roll Infrastructure**. Chromium includes `webrtc` as an external third-party repository (`//third_party/webrtc`). Changes are pulled into Chromium via automated roll bots. If a WebRTC change causes a single Chromium regression test to fail, the roll bot halts, and the offending change is reverted.

When we refactored `TransformableFrameInterface::GetTimestamp()` to return our new type-safe `GetRtpTimestampInfo()`:
1. We landed a WebRTC CL replacing `GetTimestamp()`.
2. The Chromium roll bot immediately failed: unit tests in Chromium utilized a `MockTransformableFrame` that did not implement the new pure virtual `GetRtpTimestampInfo()` method!
3. The roll was blocked, threatening our WebRTC patch with an immediate revert.

To resolve this safely, we executed a **7-CL cross-repository choreography**:

```
Step 1: WebRTC CL   --> Introduce GetRtpTimestampInfo() alongside legacy GetTimestamp().
                            |
Step 2: Roll Fails  --> MockFrame in Chromium lacks overload for new method.
                            |
Step 3: WebRTC CL   --> Temporarily revert clone() call sites to use legacy method.
                            |
Step 4: Roll Bot    --> WebRTC successfully rolls into Chromium master.
                            |
Step 5: Chromium CL --> Expose JS constructor AND update MockFrame to mock BOTH methods.
                            |
Step 6: WebRTC CL   --> Migrate internal clone() methods to new GetRtpTimestampInfo().
                            |
Step 7: WebRTC CL   --> Formally mark legacy GetTimestamp() as deprecated [[deprecated]].
```

This experience was a masterclass in large-scale software engineering: in hyper-scale distributed codebases, breaking changes must be deployed through carefully phased, backward-compatible deprecation cycles.

### 4.4 Phase 3: Video Ingestion Pipeline and the Proxy Encoder Architecture
In Weeks 16–18, we implemented the production-grade `EncodedVideoFrameInjector` in `libwebrtc`. This change (`CL 489340`) was reviewed by the **WebRTC Root Owner (Principal Engineer / L8)**.

The code review placed rigorous demands on concurrency and thread safety:
* **Elimination of Coarse Mutexes:** Initial drafts utilized a mutex protecting the injector's buffer and proxy pointers. The reviewer emphasized that WebRTC avoids mutex contention across media pipelines. We refactored the design so that `ProxyVideoTrack` operations are pinned strictly to the `worker_thread_` task queue, while `ProxyVideoEncoder` executes strictly on the `encoder_queue_`.
* **Safe Pointer Lifecycle Management:** When a peer connection closes, the encoder may be destroyed before the injector. We implemented a clean registration protocol (`RegisterEncoder()` and `UnregisterEncoder()`) where `ProxyVideoEncoder` detaches its raw pointer upon destruction under a minimal mutex, guaranteeing zero dangling pointer dereferences.

### 4.5 Phase 4: Audio Ingestion Pipeline and Extended Metadata Delivery
Following video stabilization, we developed the audio injection pipeline (`CL 497100` and `CL 8304692`). 

Audio presented distinct design characteristics:
* Unlike video, audio frames do not have a keyframe/delta distinction, and audio bandwidth is relatively low (32–64 kbps). Consequently, receivers do not issue PLI requests for audio, and congestion controllers rarely throttle audio bitrates. While `onbitrateinfochange` is exposed on the interface for semantic symmetry, audio injection focuses primarily on packet timing.
* In `CL 498801`, we expanded the audio path to support custom overrides for **`audioLevel`** (Voice Activity Detection), **`absoluteCaptureTimestamp`**, and **`csrcs`** (Contributing Sources). This is critical for audio relay servers, enabling downstream clients to render active-speaker indicators accurately without decoding the audio bitstream.

### 4.6 Comprehensive Inventory of Contributions

The implementation required authoring, reviewing, and landing **23 individual Change Lists (CLs)** across the WebRTC and Chromium Gerrit review systems:

#### WebRTC Subsystem Contributions (13 CLs):
1. [CL 489340](https://webrtc-review.googlesource.com/c/src/+/489340): *Introduce EncodedVideoFrameInjectorInterface.* (Reviewed by WebRTC Root Owner Tomas Gunnarsson). Defines the core video injection interface, `ProxyVideoTrack`, and `ProxyVideoEncoder`.
2. [CL 498801](https://webrtc-review.googlesource.com/c/src/+/498801): *Add audio_level, absolute_capture_timestamp and csrcs overrides to audio injection path.*
3. [CL 497100](https://webrtc-review.googlesource.com/c/src/+/497100): *Introduce EncodedAudioFrameInjectorInterface.* Implements `ProxyAudioEncoder` and audio injection pipeline.
4. [CL 498600](https://webrtc-review.googlesource.com/c/src/+/498600): *Add width and height to CreateOutgoingVideoFrame.*
5. [CL 485761](https://webrtc-review.googlesource.com/c/src/+/485761): *Add CreateOutgoingAudioFrame.* Factory implementation for standalone audio frame construction.
6. [CL 488340](https://webrtc-review.googlesource.com/c/src/+/488340): *Add CreateOutgoingVideoFrame.* Factory implementation for standalone video frame construction.
7. [CL 492780](https://webrtc-review.googlesource.com/c/src/+/492780): *Reland "Add RTPVideoFrameSenderInterface::SendVideoFrame".* Timestamp info migration reland.
8. [CL 492400](https://webrtc-review.googlesource.com/c/src/+/492400): *Add RTPVideoFrameSenderInterface::SendVideoFrame.* Migrates video sender to accept `RtpTimestampInfo`.
9. [CL 487340](https://webrtc-review.googlesource.com/c/src/+/487340): *Deprecate GetTimestamp in TransformableFrameInterface.* Final deprecation marking.
10. [CL 487360](https://webrtc-review.googlesource.com/c/src/+/487360): *Revert "Use GetTimestamp in encoded frame clone functions."* Upstream roll coordination.
11. [CL 486860](https://webrtc-review.googlesource.com/c/src/+/486860): *Use GetTimestamp in encoded frame clone functions.* Roll unblocking patch.
12. [CL 485781](https://webrtc-review.googlesource.com/c/src/+/485781): *Introduce GetRtpTimestampInfo() in TransformableFrameInterface.* Introduced the type-safe `std::variant` timestamp model.
13. [CL 482900](https://webrtc-review.googlesource.com/c/src/+/482900): *Cleanup dead code in frame_transformer_factory.*

#### Chromium Blink Subsystem Contributions (10 CLs):
1. [CL 8304692](https://chromium-review.googlesource.com/c/chromium/src/+/8304692): *[EncodedSource] Add audio support for WebRTC Encoded Source API.*
2. [CL 8360971](https://chromium-review.googlesource.com/c/chromium/src/+/8360971): *Use existing DOMExceptionCode(s) in Encoded Source error handling paths.* Standardized error codes across Blink.
3. [CL 8366130](https://chromium-review.googlesource.com/c/chromium/src/+/8366130): *Replace NOTREACHED with an exception in RTCEncodedVideoFrame constructor for kEmptyFrame.* Security hardening.
4. [CL 8366404](https://chromium-review.googlesource.com/c/chromium/src/+/8366404): *Relax captureTime test tolerance to avoid flakiness.* Resolved microsecond clock jitter in web tests.
5. [CL 8353464](https://chromium-review.googlesource.com/c/chromium/src/+/8353464): *[EncodedTransform] RTCEncodedVideoFrame constructor throws if captureTime is in the future.* Spec-compliance validation.
6. [CL 8346748](https://chromium-review.googlesource.com/c/chromium/src/+/8346748): *Add width and height to RTCEncodedVideoFrameInit.* Extended WebIDL dictionary.
7. [CL 8097283](https://chromium-review.googlesource.com/c/chromium/src/+/8097283): *Introduce WebRTC Encoded Source API (Video).* Main Blink implementation of `createEncodedSource` and `RTCEncodedSource`.
8. [CL 8024752](https://chromium-review.googlesource.com/c/chromium/src/+/8024752): *[EncodedTransform] Add RTCEncodedAudioFrame constructor.* Exposed audio frame constructor to JavaScript.
9. [CL 8035461](https://chromium-review.googlesource.com/c/chromium/src/+/8035461): *[EncodedTransform] Remove mock GetTimestamp method expectations from RTCEncodedFrame tests.* Roll unblocking patch.
10. [CL 8074218](https://chromium-review.googlesource.com/c/chromium/src/+/8074218): *[EncodedTransform] Add RTCEncodedVideoFrame constructor.* Exposed video frame constructor to JavaScript.

---
## 5. Verification, Testing, and Empirical Evaluation

In web browser engineering, software changes must satisfy stringent automated testing requirements to ensure they do not introduce security vulnerabilities, regressions, or test flakiness across diverse hardware architectures.

### 5.1 Multi-Tiered Testing Pyramid
Our testing strategy spanned four rigorous tiers:

```
                  /   Web Platform Tests (WPT)   \          <-- W3C Interoperability (JS)
                 /--------------------------------\
                /     Blink Layout / Web Tests     \        <-- Blink DOM & Worker Tests
               /------------------------------------\
              /       Chromium C++ Unit Tests        \      <-- Oilpan GC, Mojo, Bindings
             /----------------------------------------\
            /       libwebrtc Native Unit Tests        \    <-- Concurrency, RTP, Codecs
           +--------------------------------------------+
```

1. **Native libwebrtc Unit Tests (`pc/rtp_sender_receiver_unittest.cc`):**
   * Validated that `EncodedVideoFrameInjector` and `EncodedAudioFrameInjector` correctly attach to `RtpSenderBase`.
   * Verified that injected frames are properly packaged into `EncodedImage` structures and forwarded to the packetizer.
   * Confirmed that `ProxyVideoEncoder::SetRates` accurately routes bandwidth updates to the registered callbacks.
2. **Chromium Blink C++ Unit Tests (`rtc_rtp_sender_test.cc`, `rtc_encoded_video_frame_test.cc`):**
   * Verified Oilpan garbage collection lifetime semantics: ensured that `RTCRtpSenderEncodedSource` correctly traces its `WritableStream` and `ExecutionContext` members.
   * Validated that attempting to construct an `RTCEncodedVideoFrame` with an empty buffer throws an `InvalidModificationError` rather than crashing the renderer.
3. **Blink Web Tests & Web Platform Tests (WPT):**
   * Authored `RTCRtpSender-createEncodedSource-video.https.html` and `RTCRtpSender-createEncodedSource-audio.https.html`.
   * Tested end-to-end JavaScript execution: instantiating a peer connection, binding an encoded source in a Dedicated Worker, writing frames, and verifying that the remote peer's `ontrack` receiver decodes the video.

### 5.2 Concurrency Verification and Flaky Test Remediation
A major challenge in multi-threaded systems is preventing **test flakiness**—non-deterministic test failures caused by thread-scheduling timing variations on automated CI bots.

During Weeks 16 and 20, we identified and resolved two critical flakiness regressions:
* **`RtpSenderReceiverTest.InjectVideoFrameOnDifferentThread` Race Condition:** In native unit tests, frames injected from a background thread occasionally arrived before `ProxyVideoEncoder` had fully registered its callback pointer with the injector. We resolved this in commit `52badd6ea1` by introducing an explicit thread synchronization rendezvous in the test harness.
* **Microsecond Clock Drift in `captureTime`:** In Blink web tests, comparing JavaScript's `performance.now()` with C++ `base::TimeTicks` produced sub-millisecond discrepancies across different operating systems (macOS vs. Linux bots). In `CL 8366404`, we introduced a calibrated epsilon tolerance window, eliminating test flakiness while strictly asserting that timestamps set in the future throw exceptions (`CL 8353464`).

### 5.3 Testbed Demonstration and Performance Evaluation
To functionally validate the complete end-to-end architecture and demonstrate its operational viability, an interactive testbed web application was developed within this repository (`main.js`, `video_worker.js`, `audio_worker.js`, `index.html`).

```
Demonstration Harness Architecture:
[User Media Camera] ---> [MediaStreamTrackProcessor]
                                | (Raw VideoFrame)
                                v
                    [WebCodecs VideoEncoder]
                                | (EncodedVideoChunk: AV1 / VP8 / H.264)
                                v
                   [RTCEncodedVideoFrame Constructor]
                                | (RTCEncodedVideoFrame)
                                v
                [RTCRtpSender.createEncodedSource Sink]
                                | (Zero-Transcode RTP Packetization)
                                v
                       [RTCPeerConnection 1]
                                |
                         (Network / Loopback)
                                |
                                v
                       [RTCPeerConnection 2] ---> [Remote Video Element]
```

#### Functional Pipeline Verification
The demonstration harness confirms several core technical capabilities across the full web stack:
1. **End-to-End Media Flow:** A live media stream acquired from local media peripherals is processed via `MediaStreamTrackProcessor`, encoded using WebCodecs (`VideoEncoder` and `AudioEncoder`) in Dedicated Workers, converted to `RTCEncodedVideoFrame` / `RTCEncodedAudioFrame` objects, and written directly to the `RTCEncodedSource.writable` stream. The remote peer connection (`RTCPeerConnection 2`) receives, depacketizes, decodes, and renders the video and audio on a standard `<video>` element with seamless audio-video synchronization.
2. **Dynamic Keyframe Signaling (RTCP PLI/FIR):** When an explicit keyframe request is issued on the receiving side (or triggered by network packet loss), the underlying native WebRTC layer fires the `onkeyframerequest` event on the worker's `RTCEncodedSource`. The worker intercepts this event and commands the WebCodecs encoder to emit an immediate keyframe (`videoEncoder.encode(frame, { keyFrame: true })`), successfully refreshing the remote decoder state.
3. **Real-Time Bandwidth Adaptation:** As network conditions fluctuate, rate-control parameters calculated by WebRTC's congestion controller are intercepted by the `ProxyVideoEncoder` and dispatched via the `onbitrateinfochange` event, delivering asynchronous `allocatedBitrate` and `availableOutgoingBitrate` updates that dynamically reconfigure the WebCodecs encoder bitrate.

#### Architectural Efficiency and Structural Gains
From an architectural perspective, the performance and resource efficiency gains delivered by the WebRTC Encoded Source API are structurally expected and conceptually trivial: **by completely bypassing the internal encoding pipeline, the computational overhead and latency penalties of re-encoding are entirely eliminated by design**.

Specifically:
* **Elimination of Transcode CPU Cycles:** Video compression is intrinsically the most computationally demanding phase of any media pipeline. In a traditional re-encoding workaround, every frame must undergo inverse quantization and inverse transform decoding to raw planar YUV pixels, followed by a secondary encoder pass requiring motion estimation, macroblock partitioning, forward discrete cosine transforms (DCT), and entropy coding. By bypassing the second encoder entirely and passing pre-encoded frames directly to packetizers, the CPU is completely spared these intensive mathematical loops.
* **Reduction of Glass-to-Glass Latency:** Decompressing and re-encoding frames introduces inherent pipeline buffering delays: decoder frame buffering, rendering to offscreen canvases or virtual tracks, and encoder rate-distortion lookahead buffers. In the zero-transcode pipeline, frames are packetized and paced onto the network immediately upon arrival from the source, minimizing transmission delay.
* **Preservation of Visual Quality (Zero Generation Loss):** Lossy video compression algorithms introduce cumulative quantization noise with each encoding pass. Decoding a previously compressed bitstream and compressing it a second time inevitably compounds high-frequency blurring and compression artifacts. In the Encoded Source pipeline, the original compressed bitstream is transmitted bit-for-bit without alteration, guaranteeing zero generation loss.

In summary, while specific microsecond latency deltas and milliwatt power savings naturally depend on underlying hardware architectures, the primary performance breakthrough of the WebRTC Encoded Source API is structural: it eliminates an entire redundant computational stage by design.

---
## 6. Advancements for the Web Platform & Standardization

### 6.1 Paradigm Shifts in Web Architecture
The landing of the WebRTC Encoded Source API and standalone frame constructors fundamentally unlocks new categories of web applications that were previously technically unfeasible:

1. **Client-Side Selective Forwarding Units (SFUs) & Mesh Relays:**
   In large video conferences, sending multiple copies of an encoded video stream to numerous participants saturates upstream network bandwidth. With Encoded Source, a web client can receive an encoded stream from Peer A and forward it directly to Peers B, C, and D without decompressing it. This enables decentralized peer-assisted delivery networks and hybrid web-based SFU architectures.
2. **Custom WebCodecs & Machine Learning Pipelines:**
   Developers are no longer bound to the browser's built-in encoder configurations. Applications can deploy custom WebAssembly encoders, neural super-resolution pre-processors, or proprietary codec bitstreams, convert the output into `RTCEncodedVideoFrame` instances, and transmit them over WebRTC's robust, congestion-controlled RTP infrastructure.
3. **Cloud Gaming & Low-Latency Remote Desktop:**
   Client applications rendering interactive 3D graphics in cloud containers or edge servers can stream pre-compressed frames directly into web sessions with minimal glass-to-glass latency, preserving interactive frame rates without client-side recompression penalties.

### 6.2 Efficiency Gains and Ecological Footprint
Video streaming accounts for a substantial proportion of global internet energy consumption. By removing the need for millions of client devices to continuously execute redundant software decoding and re-encoding passes during relayed video sessions, this API directly contributes to lowering device power consumption, reducing carbon footprints, and prolonging battery longevity on portable hardware.

### 6.3 Standards Engagement: The W3C WebRTC Extensions Working Group
To guarantee that this innovation is not confined to a single browser engine, we co-authored the official **W3C WebRTC Extensions Explainer** (`encoded-source-explainer.md`) alongside our industry mentor Guido Urdaneta.

The specification was formally submitted to the **W3C WebRTC Working Group** and presented to the browser developer community via an **Intent to Prototype (I2P)** on `blink-dev` (tracked under Chrome Platform Status Feature #5177374353260544). This collaborative standardization path ensures that other browser vendors can implement the same WebIDL interfaces, solidifying zero-transcode ingestion as a permanent standard of the Open Web Platform.

---
## 7. Conclusion & Personal Reflections

### 7.1 Summary of Deliverables
Over the course of this project, we successfully:
* Specified and implemented the **WebRTC Encoded Source API** in Chromium Blink, exposing `RTCRtpSender.createEncodedSource()` and the `RTCEncodedSource` interface in Dedicated Workers.
* Specified and implemented standalone **`RTCEncodedVideoFrame` and `RTCEncodedAudioFrame` Constructors** with complete WebIDL definitions and metadata bindings.
* Architected and upstreamed the **Dual-Proxy Pattern** (`ProxyVideoTrack`, `ProxyVideoEncoder`, `ProxyAudioTrack`, `ProxyAudioEncoder`) into the native `libwebrtc` C++ engine, preserving real-time congestion control and RTCP PLI/FIR handling.
* Formulated a type-safe `std::variant` timestamp architecture, cleanly resolving the RFC 3550 random offset challenge.
* Successfully landed **23 code reviews (13 WebRTC CLs and 10 Chromium CLs)** through the rigorous code review process of the open-source projects, including approvals from the WebRTC Root Owner.
* Authored full-coverage C++ unit tests and Web Platform Tests, ensuring long-term regression resilience.
* Co-authored the official W3C Explainer and submitted the feature for international web standardization.

### 7.2 Professional and Engineering Growth
Executing this project at the heart of one of the world's largest and most sophisticated software codebases provided profound engineering insights:
* **Large-Scale Systems Architecture:** I developed a deep appreciation for the delicate balance between high-performance real-time networking (RTP/RTCP/UDP) and strict browser security sandboxing.
* **Concurrency and Thread-Safety:** Designing systems governed by lock-free task-posting, sequence checkers, and asynchronous messaging reinforced the necessity of disciplined thread-affinity engineering.
* **The Art of Upstreaming:** Navigating the 7-step roll choreography between WebRTC and Chromium demonstrated that writing functioning code is only half the battle; ensuring backwards compatibility, designing for non-breaking API deprecation, and writing deterministic tests are equally vital to shipping production software.
* **Rigorous Peer Review:** Defending architectural decisions before world-class systems architects (such as WebRTC's Root Owner) dramatically elevated my standards for code clarity, minimal memory allocation, and type safety.

### 7.3 Future Perspectives
While the primary goals of this project have been accomplished and upstreamed, several promising research and engineering horizons remain:
* **Hardware-Accelerated Scalable Video Coding (SVC) Integration:** Further expanding the `RTCEncodedVideoFrameInit` metadata dictionary to expose native multi-layer dependency trees directly to hardware packetizers.
* **WebTransport & MoQ (Media over QUIC) Synergies:** Harmonizing the Encoded Source ingestion model with emerging QUIC-based real-time transport protocols, allowing seamless bridging between RTP and WebTransport pipelines.
* **W3C Candidate Recommendation:** Continuing to shepherd the specification through the W3C consensus process toward formal standardization across all major browser engines.

---

## 8. References & Codebase Catalog

### 8.1 Author Contribution Portals & Gerrit Dashboards
The complete body of open-source software contributions authored, reviewed, and landed by Leonardo Evi (`evil@chromium.org`) across the Chromium and WebRTC projects can be inspected and verified directly through the public Google Gerrit code review portals and Git-on-Borg repositories:

#### 1. Chromium Gerrit Review Portals (`chromium-review.googlesource.com`)
* **All Authored Changes:**  
  [`https://chromium-review.googlesource.com/q/owner:evil%2540chromium.org`](https://chromium-review.googlesource.com/q/owner:evil%2540chromium.org)  
  *Comprehensive query displaying all Gerrit changes authored by `evil@chromium.org` across all Chromium repositories.*
* **Merged / Landed Production Changes:**  
  [`https://chromium-review.googlesource.com/q/owner:evil%2540chromium.org+status:merged`](https://chromium-review.googlesource.com/q/owner:evil%2540chromium.org+status:merged)  
  *Filter isolating all patches successfully validated by Chromium CQ (Commit Queue) and merged into the `main` branch.*
* **Open / Active In-Flight Reviews:**  
  [`https://chromium-review.googlesource.com/q/owner:evil%2540chromium.org+status:open`](https://chromium-review.googlesource.com/q/owner:evil%2540chromium.org+status:open)  
  *Filter showing changes currently traversing peer review, bot verification, and Blink API owner sign-off.*
* **Blink WebRTC Subsystem Contributions:**  
  [`https://chromium-review.googlesource.com/q/owner:evil%2540chromium.org+dir:third_party/blink/renderer/modules/peerconnection`](https://chromium-review.googlesource.com/q/owner:evil%2540chromium.org+dir:third_party/blink/renderer/modules/peerconnection)  
  *Direct query tracking changes specific to Blink's WebRTC peer connection and encoded media pipeline.*
* **Review Participation & Collaboration:**  
  [`https://chromium-review.googlesource.com/q/reviewer:evil%2540chromium.org`](https://chromium-review.googlesource.com/q/reviewer:evil%2540chromium.org)  
  *Query listing peer reviews and collaborative code inspections participated in by the author.*

#### 2. WebRTC Gerrit Review Portals (`webrtc-review.googlesource.com`)
* **All Authored Changes:**  
  [`https://webrtc-review.googlesource.com/q/owner:evil%2540chromium.org`](https://webrtc-review.googlesource.com/q/owner:evil%2540chromium.org)  
  *Comprehensive query displaying all Gerrit changes authored by `evil@chromium.org` in the core `libwebrtc` repository.*
* **Merged / Landed Production Changes:**  
  [`https://webrtc-review.googlesource.com/q/owner:evil%2540chromium.org+status:merged`](https://webrtc-review.googlesource.com/q/owner:evil%2540chromium.org+status:merged)  
  *Filter displaying all native C++ WebRTC patches approved by library owners and landed upstream.*
* **Public API Subsystem Contributions (`api/`):**  
  [`https://webrtc-review.googlesource.com/q/owner:evil%2540chromium.org+dir:api`](https://webrtc-review.googlesource.com/q/owner:evil%2540chromium.org+dir:api)  
  *Query isolating changes to public WebRTC C++ interfaces (`frame_transformer_interface.h`, `rtp_sender_interface.h`).*
* **Media Engine & Injector Subsystems (`audio/` and `video/`):**  
  [`https://webrtc-review.googlesource.com/q/owner:evil%2540chromium.org+(dir:audio+OR+dir:video)`](https://webrtc-review.googlesource.com/q/owner:evil%2540chromium.org+(dir:audio+OR+dir:video))  
  *Query tracking implementations of `ProxyVideoEncoder`, `ProxyVideoTrack`, `ProxyAudioEncoder`, and channel send delegates.*

#### 3. Public Git-on-Borg Version Control Logs
* **Chromium Main Repository Git Log:**  
  [`https://chromium.googlesource.com/chromium/src/+log/main?author=evil%40chromium.org`](https://chromium.googlesource.com/chromium/src/+log/main?author=evil%40chromium.org)  
  *Direct Git commit log filtered by author identity in Chromium's canonical Git repository.*
* **WebRTC Source Repository Git Log:**  
  [`https://webrtc.googlesource.com/src/+log/main?author=evil%40chromium.org`](https://webrtc.googlesource.com/src/+log/main?author=evil%40chromium.org)  
  *Direct Git commit log filtered by author identity in WebRTC's canonical Git repository.*

---

### 8.2 Project Deliverables & Standards Proposals
* **W3C WebRTC Extensions Explainer:**  
  Urdaneta, G., & Evi, L. (2026). *WebRTC Encoded Source API and Encoded Frame Constructors*.  
  Document URL: [`https://github.com/guidou/webrtc-extensions/blob/main/encoded-source-explainer.md`](https://github.com/guidou/webrtc-extensions/blob/main/encoded-source-explainer.md)
* **Chromium Intent to Prototype (I2P):**  
  Evi, L., & Urdaneta, G. (2026). *Intent to Prototype: WebRTC Encoded Source API*. Official public announcement on `blink-dev`:  
  Discussion Thread: [`https://groups.google.com/a/chromium.org/g/blink-dev/c/X5DkgPuDtCA`](https://groups.google.com/a/chromium.org/g/blink-dev/c/X5DkgPuDtCA)  
  Chrome Platform Status Tracking: [`https://chromestatus.com/feature/5177374353260544`](https://chromestatus.com/feature/5177374353260544)
* **Chromium Bug Tracker / Component Tracking:**  
  Chromium Issue Tracking Component: `Blink>WebRTC`  
  Monorail Issue Tracker: [`https://issues.chromium.org/issues?q=customfield1265882:%22Blink%3EWebRTC%22`](https://issues.chromium.org/issues?q=customfield1265882:%22Blink%3EWebRTC%22)
* **W3C WebRTC Working Group Presentation Slides:**  
  Urdaneta, G. (2024–2026). *WebRTC Encoded Source and Custom Insertable Streams Evolution*. W3C WebRTC WG Interim Meeting.  
  Slide Deck: [`https://docs.google.com/presentation/d/1sd5zEnvlXO5Sk3ENQorUUIQiRz65sv0KZKxDMMYHM3I/edit`](https://docs.google.com/presentation/d/1sd5zEnvlXO5Sk3ENQorUUIQiRz65sv0KZKxDMMYHM3I/edit)

---

### 8.3 IETF RFCs & Internet Protocol Specifications

#### A. WebRTC Architecture, Security & Session Establishment
1. **[RFC 8825]** Alvestrand, H. (2021). *Overview: Real-Time Protocols for Browser-Based Applications (RTCWEB Overview)*. Internet Engineering Task Force (IETF).  
   URL: [`https://datatracker.ietf.org/doc/html/rfc8825`](https://datatracker.ietf.org/doc/html/rfc8825)
2. **[RFC 8826]** Rescorla, E. (2021). *Security Considerations for WebRTC*. IETF.  
   URL: [`https://datatracker.ietf.org/doc/html/rfc8826`](https://datatracker.ietf.org/doc/html/rfc8826)
3. **[RFC 8827]** Rescorla, E. (2021). *WebRTC Security Architecture*. IETF.  
   URL: [`https://datatracker.ietf.org/doc/html/rfc8827`](https://datatracker.ietf.org/doc/html/rfc8827)
4. **[RFC 8829]** Uberti, J., Jennings, C., & Rescorla, E. (2021). *JavaScript Session Establishment Protocol (JSEP)*. IETF.  
   URL: [`https://datatracker.ietf.org/doc/html/rfc8829`](https://datatracker.ietf.org/doc/html/rfc8829)
5. **[RFC 8835]** Alvestrand, H. (2021). *Transports for WebRTC*. IETF.  
   URL: [`https://datatracker.ietf.org/doc/html/rfc8835`](https://datatracker.ietf.org/doc/html/rfc8835)
6. **[RFC 8834]** Perkins, C., Westerlund, M., & Ott, J. (2021). *Media Transport and Use of RTP in WebRTC*. IETF.  
   URL: [`https://datatracker.ietf.org/doc/html/rfc8834`](https://datatracker.ietf.org/doc/html/rfc8834)

#### B. Real-Time Transport (RTP/RTCP), Multiplexing & Framing
7. **[RFC 3550]** Schulzrinne, H., Casner, S., Frederick, R., & Jacobson, V. (2003). *RTP: A Transport Protocol for Real-Time Applications*. IETF Standard 64.  
   URL: [`https://datatracker.ietf.org/doc/html/rfc3550`](https://datatracker.ietf.org/doc/html/rfc3550)
8. **[RFC 3551]** Schulzrinne, H., & Casner, S. (2003). *RTP Profile for Audio and Video Conferences with Minimal Control*. IETF Standard 65.  
   URL: [`https://datatracker.ietf.org/doc/html/rfc3551`](https://datatracker.ietf.org/doc/html/rfc3551)
9. **[RFC 3711]** Baugher, M., McGrew, D., Naslund, M., Norrman, E., & Blom, R. (2004). *The Secure Real-time Transport Protocol (SRTP)*. IETF.  
   URL: [`https://datatracker.ietf.org/doc/html/rfc3711`](https://datatracker.ietf.org/doc/html/rfc3711)
10. **[RFC 4585]** Ott, J., Wenger, S., Sato, N., Burmeister, C., & Rey, J. (2006). *Extended RTP Profile for Real-time Transport Control Protocol (RTCP)-Based Feedback (RTP/AVPF)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc4585`](https://datatracker.ietf.org/doc/html/rfc4585)
11. **[RFC 5104]** Wenger, S., Chandra, U., Westerlund, M., & Burman, B. (2008). *Codec Control Messages in the RTP Audio-Visual Profile with Feedback (AVPF)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc5104`](https://datatracker.ietf.org/doc/html/rfc5104)
12. **[RFC 7656]** Lennox, J., Gross, K., Nandakumar, S., Salgueiro, G., & Burman, B. (2015). *A Taxonomy of Semantics and Mechanisms for Real-Time Transport Protocol (RTP) Sources*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc7656`](https://datatracker.ietf.org/doc/html/rfc7656)
13. **[RFC 7983]** Petit-Huguenin, M., & Salgueiro, G. (2016). *Multiplexing Scheme for RTP, RTCP, DTLS, STUN, TURN, and ZRTP on a Single Transport Address*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc7983`](https://datatracker.ietf.org/doc/html/rfc7983)
14. **[RFC 8843]** Holmberg, C., Alvestrand, H., & Jacobson, C. (2021). *Negotiating Media Multiplexing Using the Session Description Protocol (SDP) (BUNDLE)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8843`](https://datatracker.ietf.org/doc/html/rfc8843)
15. **[RFC 8860]** Westerlund, M., & Perkins, C. (2021). *Sending Multiple Types of Media in a Single RTP Session*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8860`](https://datatracker.ietf.org/doc/html/rfc8860)

#### C. Congestion Control & Bandwidth Estimation
16. **[RFC 8888]** Sarker, Z., Perkins, C., Singh, V., & Ramalho, M. (2021). *RTP Control Protocol (RTCP) Feedback for Congestion Control*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8888`](https://datatracker.ietf.org/doc/html/rfc8888)
17. **[IETF Draft GCC]** Holmer, S., Cheng, C., Lundin, H., & Sgroi, D. (2016). *A Google Congestion Control Algorithm for Real-Time Communication*. IETF Internet-Draft `draft-ietf-rmcat-gcc-02`.  
    URL: [`https://datatracker.ietf.org/doc/html/draft-ietf-rmcat-gcc-02`](https://datatracker.ietf.org/doc/html/draft-ietf-rmcat-gcc-02)

#### D. NAT Traversal, Transport Security & Data Channels
18. **[RFC 8445]** Holmberg, C., Hakeborn, R., & Paszkowski, C. (2018). *Interactive Connectivity Establishment (ICE): A Protocol for Network Address Translator (NAT) Traversal*. IETF Standard 89.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8445`](https://datatracker.ietf.org/doc/html/rfc8445)
19. **[RFC 5245]** Rosenberg, J. (2010). *Interactive Connectivity Establishment (ICE): A Protocol for Network Address Translator (NAT) Traversal for Offer/Answer Protocols*. IETF (Obsoleted by RFC 8445).  
    URL: [`https://datatracker.ietf.org/doc/html/rfc5245`](https://datatracker.ietf.org/doc/html/rfc5245)
20. **[RFC 5389]** Rosenberg, J., Mahy, R., Matthews, P., & Wing, D. (2008). *Session Traversal Utilities for NAT (STUN)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc5389`](https://datatracker.ietf.org/doc/html/rfc5389)
21. **[RFC 8656]** Reddy, T., Wing, D., Martinsen, P., Patil, P., & Ovchinnikov, I. (2020). *Traversal Using Relays around NAT (TURN): Relay Extensions to Session Traversal Utilities for NAT (STUN)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8656`](https://datatracker.ietf.org/doc/html/rfc8656)
22. **[RFC 6347]** Rescorla, E., & Modadugu, N. (2012). *Datagram Transport Layer Security Version 1.2 (DTLS 1.2)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc6347`](https://datatracker.ietf.org/doc/html/rfc6347)
23. **[RFC 9147]** Rescorla, E., Tschofenig, H., & Thomson, M. (2022). *Datagram Transport Layer Security Version 1.3 (DTLS 1.3)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc9147`](https://datatracker.ietf.org/doc/html/rfc9147)
24. **[RFC 4960]** Stewart, R. (Ed.). (2007). *Stream Control Transmission Protocol (SCTP)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc4960`](https://datatracker.ietf.org/doc/html/rfc4960)
25. **[RFC 8831]** Jesup, R., Loreto, S., & Tuexen, M. (2021). *WebRTC Data Channels*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8831`](https://datatracker.ietf.org/doc/html/rfc8831)
26. **[RFC 8832]** Jesup, R., Loreto, S., & Tuexen, M. (2021). *WebRTC Data Channel Establishment Protocol (DCEP)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8832`](https://datatracker.ietf.org/doc/html/rfc8832)

#### E. Session Description Protocol (SDP) & Signaling
27. **[RFC 8866]** Begen, A., Kyzivat, P., Perkins, C., & Handley, M. (2021). *SDP: Session Description Protocol*. IETF Standard 97.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8866`](https://datatracker.ietf.org/doc/html/rfc8866)
28. **[RFC 4566]** Handley, M., Jacobson, V., & Perkins, C. (2006). *SDP: Session Description Protocol*. IETF (Obsoleted by RFC 8866).  
    URL: [`https://datatracker.ietf.org/doc/html/rfc4566`](https://datatracker.ietf.org/doc/html/rfc4566)
29. **[RFC 3264]** Rosenberg, J., & Schulzrinne, H. (2002). *An Offer/Answer Model with the Session Description Protocol (SDP)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc3264`](https://datatracker.ietf.org/doc/html/rfc3264)

#### F. RTP Payload Formats & Media Codecs
30. **[RFC 6716]** Valin, J.-M., Vos, K., & Terriberry, T. (2012). *Definition of the Opus Audio Codec*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc6716`](https://datatracker.ietf.org/doc/html/rfc6716)
31. **[RFC 7587]** Spittka, J., Vos, K., & Valin, J.-M. (2015). *RTP Payload Format for the Opus Speech and Audio Codec*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc7587`](https://datatracker.ietf.org/doc/html/rfc7587)
32. **[RFC 7741]** Westin, P., Lundin, H., Glover, M., Uberti, J., & Galligan, F. (2016). *RTP Payload Format for VP8 Video*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc7741`](https://datatracker.ietf.org/doc/html/rfc7741)
33. **[RFC 6184]** Wang, Y.-K., Even, R., Kristensen, T., & Jesup, R. (2011). *RTP Payload Format for H.264 Video*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc6184`](https://datatracker.ietf.org/doc/html/rfc6184)
34. **[RFC 7798]** Wang, Y.-K., Sanchez, Y., Schierl, T., Wenger, S., & Hannuksela, M. (2016). *RTP Payload Format for High Efficiency Video Coding (HEVC)*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc7798`](https://datatracker.ietf.org/doc/html/rfc7798)
35. **[RFC 9004]** Engdegård, K., Förare, B., & Uberti, J. (2021). *RTP Payload Format for AV1 Video*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc9004`](https://datatracker.ietf.org/doc/html/rfc9004)

#### G. RTP Header Extensions
36. **[RFC 8285]** Singer, D., Desineni, H., & Burmeister, C. (2017). *A General Mechanism for RTP Header Extensions*. IETF Standard 79.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8285`](https://datatracker.ietf.org/doc/html/rfc8285)
37. **[RFC 6464]** Camarillo, G., & Flentov, H. (2011). *A Real-time Transport Protocol (RTP) Header Extension for Client-to-Server Audio Level Indication*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc6464`](https://datatracker.ietf.org/doc/html/rfc6464)
38. **[RFC 8852]** Roach, A. B., Nandakumar, S., & Peter, P. (2021). *RTP Stream Identifier Source Description (SDES) and Header Extension*. IETF.  
    URL: [`https://datatracker.ietf.org/doc/html/rfc8852`](https://datatracker.ietf.org/doc/html/rfc8852)

---

### 8.4 W3C Recommendations & Web Platform Specifications
This section details the formal specifications governing all web platform interfaces, WebIDL dictionaries, DOM life-cycles, and object models implemented and referenced throughout this project:

1. **[W3C WebRTC 1.0]** Jennings, C., Boström, H., & Singh, V. (Eds.). (2021). *WebRTC 1.0: Real-Time Communication Between Browsers*. W3C Recommendation.  
   URL: [`https://www.w3.org/TR/webrtc/`](https://www.w3.org/TR/webrtc/)  
   *Defines core peer connection objects: `RTCPeerConnection`, `RTCRtpSender`, `RTCRtpReceiver`, `RTCRtpTransceiver`, `RTCSessionDescription`, and `RTCIceCandidate`.*
2. **[W3C WebRTC Encoded Transform]** Alvestrand, H., & Urdaneta, G. (Eds.). (2023). *WebRTC Encoded Transform*. W3C Working Group Draft.  
   URL: [`https://www.w3.org/TR/webrtc-encoded-transform/`](https://www.w3.org/TR/webrtc-encoded-transform/)  
   *Defines insertable streams and encoded media objects: `RTCEncodedAudioFrame`, `RTCEncodedVideoFrame`, `RTCRtpScriptTransform`, `RTCEncodedVideoFrameMetadata`, and `RTCEncodedAudioFrameMetadata`.*
3. **[W3C WebRTC Extensions]** W3C WebRTC Working Group. *WebRTC Extensions Specification Draft*.  
   URL: [`https://w3c.github.io/webrtc-extensions/`](https://w3c.github.io/webrtc-extensions/)  
   *Defines advanced sender extensions, including `RTCRtpSender.createEncodedSource()`, `RTCEncodedSource`, and codec selection interfaces (`RTCRtpSender.setCodecPreferences`).*
4. **[W3C WebCodecs]** W3C Media Working Group. (2023). *WebCodecs Specification*. W3C Candidate Recommendation Draft.  
   URL: [`https://www.w3.org/TR/webcodecs/`](https://www.w3.org/TR/webcodecs/)  
   *Defines browser hardware/software codec access: `VideoEncoder`, `VideoDecoder`, `AudioEncoder`, `AudioDecoder`, `EncodedVideoChunk`, and `EncodedAudioChunk`.*
5. **[W3C Media Capture and Streams]** Burnett, D. C., Bergkvist, A., O'Callahan, R., & Narayanan, K. (Eds.). (2023). *Media Capture and Streams*. W3C Candidate Recommendation.  
   URL: [`https://www.w3.org/TR/mediacapture-streams/`](https://www.w3.org/TR/mediacapture-streams/)  
   *Defines raw real-time media streams and devices: `MediaStream`, `MediaStreamTrack`, and `navigator.mediaDevices.getUserMedia()`.*
6. **[W3C MediaStreamTrack Transform]** W3C Media Working Group. (2023). *MediaStreamTrack Insertable Media Processing (Breakout Box)*.  
   URL: [`https://w3c.github.io/mediacapture-transform/`](https://w3c.github.io/mediacapture-transform/)  
   *Defines raw frame extraction and generation: `MediaStreamTrackProcessor` and `MediaStreamTrackGenerator`.*
7. **[WHATWG Streams]** WHATWG Community. *Streams Standard: Living Standard*.  
   URL: [`https://streams.spec.whatwg.org/`](https://streams.spec.whatwg.org/)  
   *Defines reactive stream primitives: `ReadableStream`, `WritableStream`, `TransformStream`, and backpressure algorithms.*
8. **[WHATWG HTML Living Standard - Web Workers]** WHATWG Community. *HTML Living Standard: Web Workers*.  
   URL: [`https://html.spec.whatwg.org/multipage/workers.html`](https://html.spec.whatwg.org/multipage/workers.html)  
   *Defines off-main-thread execution: `Worker`, `DedicatedWorkerGlobalScope`, and worker thread event loops.*
9. **[WHATWG HTML Living Standard - Structured Clone & Transferable Objects]** WHATWG Community. *HTML Living Standard: Transferable Objects and Structured Cloning*.  
   URL: [`https://html.spec.whatwg.org/multipage/structured-data.html`](https://html.spec.whatwg.org/multipage/structured-data.html)  
   *Defines zero-copy object transfers across thread boundaries (`Transferable`, `ArrayBuffer`, `MessagePort`, and `RTCEncodedSource`).*
10. **[W3C Web IDL]** McCormack, C., & Chen, F. (Eds.). *Web IDL: Interface Definition Language*. W3C Recommendation.  
    URL: [`https://www.w3.org/TR/WebIDL-1/`](https://www.w3.org/TR/WebIDL-1/)  
    *Defines interface specifications, dictionary structures (`RTCEncodedVideoFrameInit`, `RTCEncodedAudioFrameInit`), exception mapping (`DOMException`), and C++/JS bindings.*
11. **[W3C High Resolution Time Level 3]** W3C Web Performance Working Group. (2023). *High Resolution Time*. W3C Recommendation.  
    URL: [`https://www.w3.org/TR/hr-time-3/`](https://www.w3.org/TR/hr-time-3/)  
    *Defines monotonic microsecond timestamps: `DOMHighResTimeStamp` and `performance.now()`.*
12. **[W3C WebRTC Statistics API]** Alvestrand, H., & Boström, H. (Eds.). (2023). *Identifiers for WebRTC's Statistics, Metrics, and Analytics*. W3C Candidate Recommendation.  
    URL: [`https://www.w3.org/TR/webrtc-stats/`](https://www.w3.org/TR/webrtc-stats/)  
    *Defines telemetry and metrics reporting: `RTCStatsReport`, `RTCOutboundRtpStreamStats`, and `RTCRemoteInboundRtpStreamStats`.*
13. **[W3C WebRTC Priority Control API]** W3C WebRTC Working Group. (2021). *WebRTC Priority Control API*. W3C Working Group Note.  
    URL: [`https://www.w3.org/TR/webrtc-priority/`](https://www.w3.org/TR/webrtc-priority/)  
    *Defines priority scheduling for WebRTC transports: `RTCPriorityType` and `RTCRtpEncodingParameters.priority`.*
14. **[ECMA-262 ECMAScript Specification]** Ecma International. (2023). *ECMAScript 2023 Language Specification*. Standard ECMA-262 14th Edition.  
    URL: [`https://tc39.es/ecma262/`](https://tc39.es/ecma262/)  
    *Defines typed array memory semantics: `ArrayBuffer`, `ArrayBuffer.prototype.transfer()`, `Uint8Array`, `DataView`, and memory detachment.*
15. **[W3C WebAssembly Core Specification]** W3C WebAssembly Working Group. (2022). *WebAssembly Core Specification 2.0*. W3C Recommendation.  
    URL: [`https://www.w3.org/TR/wasm-core-2/`](https://www.w3.org/TR/wasm-core-2/)  
    *Defines the high-performance binary code execution environment utilized for in-browser client-side video codecs.*

---

### 8.5 Academic Literature, System Architecture Guides & Technical References
1. **[Chromium Architecture]** The Chromium Projects. (2024). *Multi-process Architecture Design Documents*.  
   URL: [`https://www.chromium.org/developers/design-documents/multi-process-architecture/`](https://www.chromium.org/developers/design-documents/multi-process-architecture/)  
   *Documents browser process isolation, IPC channels, and security sandboxing.*
2. **[Blink Oilpan]** Blink Platform Team. (2024). *Blink GC API Reference: C++ Garbage Collection with Oilpan*.  
   URL: [`https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/heap/BlinkGCAPIReference.md`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/platform/heap/BlinkGCAPIReference.md)  
   *Documents `GarbageCollected`, `Member<T>`, `WeakMember<T>`, and cycle tracing.*
3. **[WebRTC Native Threading]** WebRTC Project Contributors. (2024). *WebRTC Native Code Threading Model*.  
   URL: [`https://webrtc.googlesource.com/src/+/main/docs/native-code/threading.md`](https://webrtc.googlesource.com/src/+/main/docs/native-code/threading.md)  
   *Documents Signaling, Worker, and Network thread constraints, thread-checker macros (`RTC_DCHECK_RUN_ON`), and task queues.*
4. **[Web Platform Tests (WPT)]** WPT Contributors. (2024). *Web Platform Tests Documentation and Infrastructure*.  
   URL: [`https://web-platform-tests.org/`](https://web-platform-tests.org/)  
   *Cross-browser automated conformance test suite and test harness runner.*
5. **[Carlucci et al. 2016]** Carlucci, G., De Cicco, L., Holmer, S., & Mascolo, S. (2016). *Analysis and Design of the Google Congestion Control for Web Real-Time Communication (WebRTC)*. IEEE/ACM Transactions on Networking, 25(5), 3121–3134.  
   DOI: [`10.1109/TNET.2017.2703615`](https://doi.org/10.1109/TNET.2017.2703615)
6. **[Grigorik 2013]** Grigorik, I. (2013). *High Performance Browser Networking: What every web developer should know about networking and web performance*. O'Reilly Media.  
   URL: [`https://hpbn.co/webrtc/`](https://hpbn.co/webrtc/)
7. **[DuBois et al. 2021]** DuBois, S., et al. (2021). *WebRTC for the Curious: Go beyond the APIs*.  
   URL: [`https://webrtcforthecurious.com/`](https://webrtcforthecurious.com/)
8. **[Banno et al. 2017]** Banno, T., Ohnishi, H., & Sakata, H. (2017). *Performance Evaluation of Scalable Video Coding in WebRTC Video Conferencing*. IEEE International Conference on Communications (ICC).

---

### 8.6 Upstream Code Reviews (Comprehensive Change Lists Catalog)

#### 1. WebRTC Review Catalog (`webrtc-review.googlesource.com`)
* **[CL 489340](https://webrtc-review.googlesource.com/c/src/+/489340):** *Introduce EncodedVideoFrameInjectorInterface.*  
  *Reviewers:* Tomas Gunnarsson (Root Owner of WebRTC Library, Principal Engineer / L8), Guido Urdaneta.  
  *Description:* Introduces the core native video injection interface, `ProxyVideoTrack`, and `ProxyVideoEncoder` to safely bypass encoding pipelines while maintaining pacing loops and RTCP observation.
* **[CL 498801](https://webrtc-review.googlesource.com/c/src/+/498801):** *Add audio_level, absolute_capture_timestamp and csrcs overrides to audio injection path.*  
  *Reviewers:* Jakob Ivarsson, Henrik Boström.  
  *Description:* Integrates RFC 6464 audio levels and NTP-synchronized absolute capture timestamps into the outgoing RTP packetizer.
* **[CL 497100](https://webrtc-review.googlesource.com/c/src/+/497100):** *Introduce EncodedAudioFrameInjectorInterface.*  
  *Reviewers:* Jakob Ivarsson, Ilya Nikolaevskiy, Henrik Boström.  
  *Description:* Establishes the native C++ audio injection pipeline and `ProxyAudioEncoder` delegate.
* **[CL 498600](https://webrtc-review.googlesource.com/c/src/+/498600):** *Add width and height to CreateOutgoingVideoFrame.*  
  *Reviewers:* Guido Urdaneta, Henrik Boström.  
  *Description:* Extends native video frame factory to accept spatial pixel dimensions.
* **[CL 485761](https://webrtc-review.googlesource.com/c/src/+/485761):** *Add CreateOutgoingAudioFrame.*  
  *Reviewers:* Jakob Ivarsson, Harald Alvestrand.  
  *Description:* Factory method for instantiating standalone transformable audio frames uncoupled from underlying senders.
* **[CL 488340](https://webrtc-review.googlesource.com/c/src/+/488340):** *Add CreateOutgoingVideoFrame.*  
  *Reviewers:* Guido Urdaneta, Fredrik Solenberg.  
  *Description:* Factory method for instantiating standalone transformable video frames.
* **[CL 492780](https://webrtc-review.googlesource.com/c/src/+/492780):** *Reland "Add RTPVideoFrameSenderInterface::SendVideoFrame".*  
  *Reviewers:* Guido Urdaneta, Åsa Persson.  
  *Description:* Relands timestamp info migration following upstream test stabilization.
* **[CL 492400](https://webrtc-review.googlesource.com/c/src/+/492400):** *Add RTPVideoFrameSenderInterface::SendVideoFrame.*  
  *Reviewers:* Åsa Persson, Guido Urdaneta.  
  *Description:* Migrates `RTPVideoFrameSenderInterface` to accept type-safe `RtpTimestampInfo`.
* **[CL 487340](https://webrtc-review.googlesource.com/c/src/+/487340):** *Deprecate GetTimestamp in TransformableFrameInterface.*  
  *Reviewers:* Danil Chapovalov, Fredrik Solenberg.  
  *Description:* Applies compiler `[[deprecated]]` attribute to legacy raw timestamp getter.
* **[CL 487360](https://webrtc-review.googlesource.com/c/src/+/487360):** *Revert "Use GetTimestamp in encoded frame clone functions."*  
  *Reviewers:* Guido Urdaneta, Fredrik Solenberg.  
  *Description:* Roll coordination patch reverting clone method to unblock Chromium CI test bot failure.
* **[CL 486860](https://webrtc-review.googlesource.com/c/src/+/486860):** *Use GetTimestamp in encoded frame clone functions.*  
  *Reviewers:* Fredrik Solenberg, Guido Urdaneta.  
  *Description:* Roll synchronization step transitioning clone implementations to transitional getter.
* **[CL 485781](https://webrtc-review.googlesource.com/c/src/+/485781):** *Introduce GetRtpTimestampInfo() in TransformableFrameInterface.*  
  *Reviewers:* Guido Urdaneta, Harald Alvestrand.  
  *Description:* Core architectural change introducing `std::variant<RtpTimestampRaw, RtpTimestampWithOffset>` to eliminate boolean flag ambiguity.
* **[CL 482900](https://webrtc-review.googlesource.com/c/src/+/482900):** *Cleanup dead code in frame_transformer_factory.*  
  *Reviewers:* Harald Alvestrand, Palak Agarwal.  
  *Description:* Removes obsolete transformation routines and legacy interfaces.

#### 2. Chromium Review Catalog (`chromium-review.googlesource.com`)
* **[CL 8304692](https://chromium-review.googlesource.com/c/chromium/src/+/8304692):** *[EncodedSource] Add audio support for WebRTC Encoded Source API.*  
  *Reviewers:* Henrik Boström, Guido Urdaneta.  
  *Description:* Plumbs `createEncodedSource` for audio senders through Blink renderer modules to `ProxyAudioEncoder`.
* **[CL 8360971](https://chromium-review.googlesource.com/c/chromium/src/+/8360971):** *Use existing DOMExceptionCode(s) in Encoded Source error handling paths.*  
  *Reviewers:* Henrik Boström, Guido Urdaneta.  
  *Description:* Aligns exception mapping in constructor and stream writer error paths with standard W3C DOMException specifications.
* **[CL 8366130](https://chromium-review.googlesource.com/c/chromium/src/+/8366130):** *Replace NOTREACHED with an exception in RTCEncodedVideoFrame constructor for kEmptyFrame.*  
  *Reviewers:* Guido Urdaneta, Ilya Nikolaevskiy.  
  *Description:* Hardens frame constructor against renderer crashes by throwing JavaScript exceptions on empty buffer inputs.
* **[CL 8366404](https://chromium-review.googlesource.com/c/chromium/src/+/8366404):** *Relax captureTime test tolerance to avoid flakyeness.*  
  *Reviewers:* Guido Urdaneta, Henrik Boström.  
  *Description:* Adjusts monotonic clock epsilon comparison in web tests to accommodate microsecond timer differences across host operating systems.
* **[CL 8353464](https://chromium-review.googlesource.com/c/chromium/src/+/8353464):** *[EncodedTransform] RTCEncodedVideoFrame constructor throws if captureTime is in the future.*  
  *Reviewers:* Guido Urdaneta, Henrik Boström.  
  *Description:* Enforces specification invariant rejecting timestamp inputs exceeding current monotonic time.
* **[CL 8346748](https://chromium-review.googlesource.com/c/chromium/src/+/8346748):** *Add width and height to RTCEncodedVideoFrameInit.*  
  *Reviewers:* Henrik Boström, Guido Urdaneta.  
  *Description:* Exposes spatial resolution dictionary attributes to WebIDL and Blink bindings.
* **[CL 8097283](https://chromium-review.googlesource.com/c/chromium/src/+/8097283):** *Introduce WebRTC Encoded Source API (Video).*  
  *Reviewers:* Guido Urdaneta, Kent Tamura.  
  *Description:* Core Blink implementation introducing `RTCRtpSender.createEncodedSource()` and the `RTCEncodedSource` object.
* **[CL 8024752](https://chromium-review.googlesource.com/c/chromium/src/+/8024752):** *[EncodedTransform] Add RTCEncodedAudioFrame constructor.*  
  *Reviewers:* Tove Petersson, Guido Urdaneta.  
  *Description:* Implements public JavaScript constructor `new RTCEncodedAudioFrame(init)` in Blink renderer modules.
* **[CL 8035461](https://chromium-review.googlesource.com/c/chromium/src/+/8035461):** *[EncodedTransform] Remove mock GetTimestamp method expectations from RTCEncodedFrame tests.*  
  *Reviewers:* Guido Urdaneta, Ilya Nikolaevskiy.  
  *Description:* Updates Chromium unit test mocks to handle both `GetTimestamp` and `GetRtpTimestampInfo`, resolving roll bot blockages.
* **[CL 8074218](https://chromium-review.googlesource.com/c/chromium/src/+/8074218):** *[EncodedTransform] Add RTCEncodedVideoFrame constructor.*  
  *Reviewers:* Guido Urdaneta, Kent Tamura.  
  *Description:* Implements public JavaScript constructor `new RTCEncodedVideoFrame(init)` with full metadata dictionary support.


