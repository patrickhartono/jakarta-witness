# Jakarta Witness — Project Brief

A web-based AI interactive artwork for submission to Lumen Prize 2026
(deadline May 23) and MMU InventX Creative 2026 (deadline May 24).
Target: working prototype tested locally within 48 hours, deploy to
GitHub Pages as final step.

> This is the canonical Markdown copy of the brief. The original `.rtf`
> source is gitignored.

## Concept

Three-layer vertical artwork showing AI cognition made visible:

- **TOP** — Reality: Jakarta traffic video + YOLO detection overlay
- **MIDDLE** — Thought: LLM observation + proposed solution streaming text
- **BOTTOM** — Reduction: p5.js 2D simulation — Jakarta abstracted to
  colored boxes on a grid, the AI's simplified mental model

The tension: AI proposes confident solutions, but the 2D simulation
reveals its understanding is reductive. Imperfection is intentional content.

## Stance

AI voice: "cold machine witness" — observational, data-driven,
analytically detached. Solutions are LOGICAL BUT REVEAL THE LIMITS of
pure data-driven reasoning (e.g., "ban all motorbikes during peak hours"
— logical but ignores millions of ojek drivers). Output: English.

## Technical Stack

- Vite for local dev server
- Vanilla JS (no React/Vue/etc)
- Transformers.js v4 for the LLM (Qwen 2.5 1.5B Instruct)
- ONNX Runtime Web for YOLO (YOLOv8n)
- p5.js (instance mode) for the bottom simulation
- HTML5 video (muted) + Canvas 2D for the YOLO overlay
- WebGPU required (fallback message if unavailable)

## Pipeline — Sequential State Machine

`IDLE → DETECTING → ANALYZING → SIMULATING → COOLDOWN → IDLE`

Total per cycle: ~10–15 seconds. No state overlap allowed.

1. **IDLE** — video playing, system waiting
2. **DETECTING (~1s)** — capture frame, run YOLO, update overlay + counters
3. Build internal scene-state JSON (not displayed)
4. **ANALYZING (~3–8s)** — feed JSON + system prompt to LLM, stream output
5. LLM emits prose for display + a hidden JSON block for p5.js params
6. **SIMULATING (~2–3s)** — p5.js sketch fades to the new state
7. **COOLDOWN (~3s)** — everything stays, breathing room
8. Return to IDLE, begin next cycle

## License

Project: **AGPL-3.0** (required by the YOLOv8 license — propagates to
this code).

Attribution:

- Qwen 2.5 (Alibaba) — Apache 2.0
- YOLOv8 (Ultralytics) — AGPL 3.0
- Transformers.js (Hugging Face) — Apache 2.0
- ONNX Runtime Web (Microsoft) — MIT
- p5.js — LGPL 2.1

## Constraints

- No TouchDesigner, cloud APIs, server backends
- No React/Vue/Angular or any framework beyond Vite + vanilla JS + p5.js
- Everything client-side
- WebGPU required, no graceful WASM fallback for the LLM (too slow)
- Repo public, AGPL-3.0 license

See the full original brief (`PROJECT_BRIEF.md.rtf`) for the complete
layout specification, color coding, system-prompt design, pre-identified
issues, and build order.
