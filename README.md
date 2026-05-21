# Jakarta Witness

**A web-based AI interactive artwork making machine cognition visible.**

Live: <https://patrickhartono.github.io/jakarta-witness>

Jakarta Witness runs two neural networks entirely in your browser — an
object detector and a language model — and stages the gap between what a
machine *measures* and what it *understands*. There is no server. Nothing
leaves your device.

---

## The work

The screen is divided into three horizontal layers, read top to bottom as
a single act of machine cognition:

| Layer | Title | What it shows |
|-------|-------|---------------|
| **Top** | **Reality** | Jakarta traffic footage with a live YOLOv8 detection overlay — bounding boxes, class labels, per-class counts. |
| **Middle** | **Thought** | The system states an exact observation of what was detected, then a language model streams a cold, clinical *proposed solution*. |
| **Bottom** | **Reduction** | A vintage-game 2D simulation — Jakarta abstracted to colored boxes on a grid. The machine's simplified mental model. |

The language model speaks as a "cold machine witness": observational,
data-driven, detached. Its proposed solutions are internally logical but
reveal the blind spots of reasoning purely from numbers — *"ban all
motorbikes during peak hours"* is sound traffic optimisation and ignores
the millions of ojek drivers who depend on those motorbikes to live.

The bottom simulation makes the reduction literal: a city of millions
flattened to rectangles. The imperfection is not a bug. It **is** the
work.

## How it works

A sequential state machine drives one cycle every ~12–17 seconds:

```
IDLE → DETECTING → ANALYZING → SIMULATING → COOLDOWN → IDLE
```

1. **IDLE** — the video plays; YOLOv8 tracks vehicles live.
2. **DETECTING** — the frame is frozen and a detection snapshot is taken.
3. **ANALYZING** — the system states an exact observation of the counts,
   then the language model streams a proposed solution token by token.
4. **SIMULATING** — a hidden JSON block in the model's output drives the
   bottom simulation, which fades to the new reduced state.
5. **COOLDOWN** — everything holds, then the cycle repeats.

## Browser requirements

- **WebGPU is required.** Use a recent **Google Chrome** or
  **Microsoft Edge** on desktop. The artwork detects WebGPU on load and
  shows a message if it is unavailable.
- **First load downloads ≈800 MB** — the Qwen 2.5 0.5B language model,
  fetched from the Hugging Face Hub and cached by the browser afterwards.
  Subsequent loads are fast.
- A discrete or modern integrated GPU is recommended.

## Running locally

```bash
git clone https://github.com/patrickhartono/jakarta-witness.git
cd jakarta-witness
npm install

# Add a Jakarta traffic video at:
#   public/video/jakarta.mp4
# (muted, looping footage; 1080p or 720p recommended)

npm run dev
```

Then open the printed local URL in Chrome or Edge.

To build for production:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

## Project structure

```
jakarta-witness/
├── index.html
├── vite.config.js
├── src/
│   ├── main.js          orchestrator + state machine
│   ├── yolo.js          YOLOv8 inference + detection overlay
│   ├── llm.js           LLM worker wrapper
│   ├── llm.worker.js    Transformers.js pipeline (off-thread)
│   ├── prompt.js        system prompt + 8 few-shot examples
│   ├── parse.js         robust JSON parsing + fallback
│   ├── simulation.js    p5.js reduction simulation
│   ├── ui.js            loading screen, WebGPU detection, counters
│   └── styles.css
└── public/
    ├── models/yolov8s.onnx
    └── video/jakarta.mp4   (supply your own footage)
```

## Technology & attribution

This artwork stands entirely on open models and libraries:

| Component | Project | License |
|-----------|---------|---------|
| Language model — Qwen 2.5 0.5B Instruct | [Qwen](https://github.com/QwenLM/Qwen2.5) (Alibaba) | Apache-2.0 |
| Object detection — YOLOv8s | [Ultralytics](https://github.com/ultralytics/ultralytics) | AGPL-3.0 |
| In-browser ML runtime | [Transformers.js](https://github.com/huggingface/transformers.js) (Hugging Face) | Apache-2.0 |
| ONNX inference | [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (Microsoft) | MIT |
| Creative-coding canvas | [p5.js](https://github.com/processing/p5.js) | LGPL-2.1 |
| Build tool | [Vite](https://github.com/vitejs/vite) | MIT |

The Qwen 2.5 model is downloaded at runtime from the
[Hugging Face Hub](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct)
and is **not** redistributed in this repository.

## License

This project is licensed under the **GNU Affero General Public License
v3.0** — see [`LICENSE`](./LICENSE).

AGPL-3.0 is required: YOLOv8 (Ultralytics) is itself AGPL-3.0, and that
obligation propagates to any work that builds on it. The license is a
feature here, not an inconvenience — Jakarta Witness is a piece about
machine reasoning made transparent, and it is itself fully open.

## Author

**Patrick Hartono** — 2026.

Created for submission to the **Lumen Prize 2026** and **MMU InventX
Creative 2026**. Visual language for the detection overlay continues the
artist's earlier [TDYolo](https://github.com/patrickhartono/TDYolo)
project.
