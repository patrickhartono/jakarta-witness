# Jakarta Witness — Technical Statement

*Patrick Hartono, 2026 — draft (~500 words) for the Lumen Prize*

---

Jakarta Witness is a real-time interactive artwork that runs two neural
networks entirely inside the web browser, with no server, no cloud API
and no data leaving the viewer's device. It is built as a static site in
vanilla JavaScript and deployed on GitHub Pages; the entire intelligence
of the piece is downloaded once and executed locally on the GPU.

**Architecture.** The work is a three-layer vertical composition driven
by a single sequential state machine —
`IDLE → DETECTING → ANALYZING → SIMULATING → COOLDOWN`. One cycle lasts
roughly twelve to seventeen seconds, and the states are strictly ordered:
each phase is awaited before the next begins, so the viewer always sees a
coherent, complete thought rather than overlapping processes.

**Layer one — detection.** Real Jakarta traffic footage is analysed by
YOLOv8s, an object-detection network executed through ONNX Runtime Web on
the WebGPU backend. Each frame is letterboxed to 640×640, run through the
model, and the raw output tensor is decoded and passed through a
JavaScript implementation of non-maximum suppression. Detections are
filtered to five classes — motorbike, car, bus, truck, person — and drawn
as a live overlay of bounding boxes and per-class counts.

**Layer two — language.** The middle band deliberately separates accurate
perception from limited reasoning. The exact detection counts are stated
as a deterministic OBSERVATION; the reasoning is then handed to Qwen 2.5
0.5B Instruct, a language model running through Transformers.js on WebGPU.
The model is downloaded from the Hugging Face Hub at runtime (a quantised
build of roughly 800 MB, cached by the browser thereafter) and executed
in a Web Worker so generation never interrupts the artwork's animation. A
detailed system prompt and eight hand-authored few-shot examples shape
its voice into a "cold machine witness": clinical, data-driven, detached.
Its PROPOSED SOLUTION streams token by token into the middle of the
screen — logical on its own terms, and quietly blind to the lives behind
the numbers.

**Layer three — reduction.** Each language-model response also carries a
hidden, machine-readable JSON block. A robust parser — falling back to
parameters derived from the raw detection counts if the output is
malformed — extracts it and uses it to drive a p5.js simulation: a
deliberately crude, vintage-arcade rendering of Jakarta as colored
rectangles on a grid. This layer is the
conceptual core. It is where the artwork shows, rather than tells, that
the machine's understanding is a reduction.

**Determinism and craft.** The language model uses greedy decoding, which
makes its output fully reproducible — important both for exhibition
stability and for honest screen documentation. Tensors are explicitly
released each cycle; the piece is designed to loop indefinitely without
memory growth.

The technical decision that matters most is the decision to run small,
local, open models rather than large hosted ones. Jakarta Witness is not
a demonstration of how powerful AI has become. It is a study of a modest
intelligence, fully visible, thinking out loud — and of the precise point
at which its reasoning, sound on its own terms, parts company with the
city it is describing.
