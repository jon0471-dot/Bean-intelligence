Atlas ID: ATLAS-24 · Review date: 2026-11-24 · Status: documented · Parent: README.md

# Technology, Engineering and Computing

This file records the atlas vocabulary for the computing stack, electronics fundamentals, robotics, software engineering practice, databases, the web platform, security, and AI infrastructure. It explains mechanisms conceptually and links to specialist files; it does not claim exhaustive coverage of any engineering field.

## 1. Scope and Method

Engineering knowledge is layered: physical devices, then firmware and operating systems, then networks and software, then application practice. Each layer hides complexity from the layer above, which is why the file is organised as a stack. Mechanisms are described conceptually — enough to reason about behaviour, limits, and failure modes — without reproducing engineering specifics. Cross-links point to the specialist files: materials and electronics foundations are documented in Atlas file 18 (see the coverage map), acoustics in Atlas file 16, and AI model inference in [27-ai-models-inference-and-multimodal-intelligence.md](27-ai-models-inference-and-multimodal-intelligence.md).

## 2. Computing Hardware

The hardware stack builds upward from a switch: transistors are semiconductor devices that switch or amplify electrical signals; arranged into logic gates (AND, OR, NOT, XOR), they implement Boolean logic; gates compose into adders, registers, and arithmetic units; and clocked logic sequences those units into a CPU that fetches, decodes, executes, and writes back instructions. Semiconductor physics behind this layer is grounded in Atlas file 18.

Memory is arranged as a hierarchy optimised for the physics of access: registers and CPU caches are fast and small, main memory (RAM) is slower and larger, and persistent storage is slow, large, and non-volatile. The hierarchy exists because speed and capacity trade off; software performance is largely about respecting it — keeping hot data near the processor and minimising round-trips across layers.

## 3. Firmware and Operating Systems

Firmware is the low-level code that initialises hardware (boot, device bring-up) and hands control to an operating system. The OS kernel multiplexes one machine across many programs: processes and threads provide execution contexts; virtual memory gives each process an isolated address space backed by RAM and storage; a scheduler allocates CPU time; drivers wrap device differences behind uniform interfaces; and filesystems organise persistent storage. The OS is also the trust boundary: permission checks, resource limits, and isolation primitives (separate address spaces, sandboxing) all live here. BEAN's code-execution sandbox, for example, is built directly on OS primitives — resource limits (`rlimit`) and a fresh network namespace — rather than on application-level promises; see [28-agent-planning-tools-verification-and-recovery.md](28-agent-planning-tools-verification-and-recovery.md).

## 4. Networks

Networking is layered so each layer depends only on the one below. The TCP/IP model is used conceptually: the link layer moves frames over a physical medium; the internet layer routes packets between hosts (IP); the transport layer provides host-to-host channels — TCP for ordered, reliable streams, UDP for datagrams; and the application layer carries protocols such as HTTP and DNS. Two application protocols matter everywhere:

- DNS translates names to addresses, a globally distributed lookup system with caching at multiple levels.
- HTTP is the request/response protocol of the web — methods, status codes, headers, and content negotiation are documented in detail by MDN (References).

Latency and bandwidth are the two constants to reason about: round-trips dominate user-perceived performance, and caching is the standard mitigation at every layer (browser, proxy, CDN).

## 5. Electronics Fundamentals

This section expands Atlas file 18 §electronics with the concepts engineering software touches. Voltage, current, and resistance describe electrical behaviour; circuits are analysed with conservation laws rather than memorised patterns. The central distinction is analog versus digital: analog signals vary continuously and carry noise with them, while digital signals quantise values into symbols, tolerating noise up to a threshold at the cost of resolution and sampling limits.

Converting between the two worlds is done by ADCs and DACs. An ADC samples a continuous signal at a fixed rate and quantises each sample; a DAC reconstructs a continuous signal from samples. The sampling rate must exceed twice the highest frequency present to avoid aliasing — a result that explains why audio is sampled at tens of kilohertz and why faster-changing signals need faster converters. Digital signal processing then operates on sampled data: filtering, transforms, and compression are mathematical operations on sequences, which is why audio, image, and video pipelines are software problems once sampling is done.

## 6. Robotics

Robotics integrates sensing, computation, and actuation. Kinematics describes motion geometry: forward kinematics computes where an arm's end effector is from joint angles; inverse kinematics computes the joint angles needed to reach a pose. Denavit-Hartenberg parameters are the conventional notation for chaining joint transforms along a manipulator — recorded here as a standard convention, not derived.

Control closes the loop. The PID controller is the conceptual baseline: output reacts to the error between desired and measured state, using a proportional term (react to present error), an integral term (eliminate persistent offset), and a derivative term (damp overshoot). The perception-action loop is the broader architecture: sense, estimate state, decide, act, and re-sense, run continuously. Failures cluster at perception (noisy sensors), state estimation (wrong world model), and actuation (actuator limits), so robust robotics is about bounding uncertainty at every stage rather than trusting any single stage.

## 7. Software Engineering Practice

Software engineering is the discipline of building software that works, over time, with other people. Its lifecycle conventionally runs requirements → design → implementation → testing → deployment, iterating rather than proceeding linearly. The practices that keep iteration safe:

- Version control: every change is a commit with author, message, and history; branches isolate work; history makes rollback and blame possible.
- Code review: a second reader checks correctness, clarity, and fit before merge; review distributes knowledge and catches defects cheaply.
- CI/CD: automated builds and tests run on every change (continuous integration), and validated changes flow to release (continuous delivery/deployment).
- Testing pyramid: many fast unit tests, fewer integration tests, few end-to-end tests — cheap feedback at the bottom, realistic coverage at the top.
- Technical debt: shortcuts that speed the present and slow the future; debt is acceptable when acknowledged, tracked, and repaid, and corrosive when invisible.

The unifying principle is feedback speed: the shorter the loop between a change and evidence about that change, the lower the risk.

## 8. Databases

Databases persist and query structured data under concurrency, with guarantees (durability, transactions, consistency levels) that application code should not re-implement. The three families the atlas distinguishes by what they optimise:

- Relational: tables with typed schemas and joins; optimised for consistent, complex, multi-entity queries (SQL). The default choice when relationships and integrity matter.
- Document: JSON-like records with flexible fields; optimised for self-contained entities read and written as units, at the cost of weaker cross-record guarantees.
- Vector: embeddings with similarity search; optimised for "nearest in meaning" retrieval, which powers grounding and semantic search (see file 27 §multimodal).

The choice is a workload statement: relational for integrity and ad-hoc queries, document for aggregate-shaped records, vector for similarity retrieval — and real systems legitimately combine them.

## 9. Web Platform

A browser renders a page through a pipeline: parse HTML into a DOM, compute styles, lay out geometry, paint layers, and composite them to the screen. JavaScript runs on an event loop with a single call stack — tasks and microtasks queue and execute one at a time — so long synchronous work blocks interaction; responsiveness comes from yielding and from off-main-thread workers. This mechanism is why compositor-only animation (transform and opacity) is cheap and layout-touching animation is not; [26-professional-software-ui-ux-and-motion-design.md](26-professional-software-ui-ux-and-motion-design.md) turns this mechanism into design rules.

HTTP caching (freshness and revalidation directives) and CDN distribution make repeated fetches cheap. Progressive Web App techniques — installability, offline caching via service workers, app-like shell — are documented by MDN and represent the platform's answer to native-app behaviour without leaving the browser. MDN is the atlas's reference for browser APIs, HTTP semantics, and the event loop (References).

## 10. Security Fundamentals

Security goals are summarised by the CIA triad: confidentiality (only authorised parties read data), integrity (data and code are not tampered with), availability (systems serve when needed). Identity is checked in two distinct steps: authentication (who you are) and authorisation (what you may do) — conflating them is a standard design error.

Recurring vulnerability classes, treated conceptually: injection (untrusted input interpreted as code — SQL, shell, template), cross-site scripting (untrusted content executed in a victim's browser), cross-site request forgery (authenticated requests forged from another origin), broken access control (authorisation assumed rather than checked), and supply-chain risk (dependencies as attack surface). Secrets handling follows from confidentiality: credentials never enter source control or client-visible bundles, are rotated on exposure, and are scoped to the minimum permission needed. BEAN's security layer (credential storage, URL guards, origin checks) implements these classes; the operating principles above are the vocabulary any implementation is judged against.

## 11. AI Infrastructure

AI workloads split into training (fitting model weights to data — expensive, offline, accelerator-bound) and inference (running a fixed model on inputs — cheaper per call, but repeated at scale). Between the two sit the deployment levers: quantisation stores weights at reduced numeric precision (int8 and 4-bit are common practice), trading some accuracy for memory and speed; batching trades latency for throughput; and serving infrastructure manages model loading, scheduling, and GPU memory.

The edge-versus-cloud trade-off frames where inference runs: cloud offers large models and elastic capacity but adds latency, network dependency, and data egress; edge (device) offers privacy, offline operation, and no per-call cost but constrains model size to device memory. Browser runtimes (WebGPU, WebAssembly) extend the edge into the client; BEAN's concrete lanes, device tiers, and honesty rules for claiming what actually runs are documented in [27-ai-models-inference-and-multimodal-intelligence.md](27-ai-models-inference-and-multimodal-intelligence.md).

## 12. Relationships

| Sibling | Relation | Rationale |
| --- | --- | --- |
| [27-ai-models-inference-and-multimodal-intelligence.md](27-ai-models-inference-and-multimodal-intelligence.md) | specialises | AI model inference specialises this file's AI-infrastructure section into concrete lanes and honesty rules |
| [28-agent-planning-tools-verification-and-recovery.md](28-agent-planning-tools-verification-and-recovery.md) | specialises | Agent runtimes build on this file's OS, network and security fundamentals |
| [26-professional-software-ui-ux-and-motion-design.md](26-professional-software-ui-ux-and-motion-design.md) | applies-to | Motion and interaction rules apply this file's rendering-pipeline and event-loop mechanisms |
| [22-human-history-culture-and-society.md](22-human-history-culture-and-society.md) | grounds-in | The science-history arc grounds the technology trajectory detailed here |
| [01-knowledge-schema-and-relationships.md](01-knowledge-schema-and-relationships.md) | grounds-in | Conceptual-only claims and citations follow the schema |
| [00-world-knowledge-coverage-map.md](00-world-knowledge-coverage-map.md) | evidenced-by | The coverage map records this domain's scope and cross-links to Atlas files 16 and 18 |

## 13. References

- MDN Web Docs, HTTP Overview — https://developer.mozilla.org/en-US/docs/Web/HTTP
- MDN Web Docs, JavaScript Event Loop — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Event_loop
- MDN Web Docs, WebGPU API — https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- MDN Web Docs, WebAssembly — https://developer.mozilla.org/en-US/docs/WebAssembly
- MDN Web Docs, Web Security — https://developer.mozilla.org/en-US/docs/Web/Security
- MDN Web Docs, Progressive Web Apps — https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps
- OpenStax, College Physics 2e (semiconductors, circuits, signal basics) — https://openstax.org/details/books/college-physics-2e
