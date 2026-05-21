/* yolo.js — YOLOv8n object detection via ONNX Runtime Web (WebGPU).
 *
 * Pipeline: video frame -> letterbox 640x640 -> NCHW float32 tensor ->
 * onnxruntime-web session -> decode [1,84,8400] -> per-class NMS ->
 * detections in native video coordinates.
 *
 * The overlay is drawn in display space, replicating the CSS
 * `object-fit: cover` transform so boxes align with the visible video. */

import * as ort from 'onnxruntime-web/webgpu';

// onnxruntime-web's wasm/jsep assets are not bundled by Vite; load the
// version-pinned copies from the CDN so dev and the GitHub Pages build
// behave identically.
ort.env.wasm.wasmPaths =
  'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';

const INPUT_SIZE = 640;
// 0.3, not the brief's 0.4: YOLOv8n's confidence on Jakarta's small,
// densely-packed motorbikes sits just under 0.4 — at 0.4 they vanish.
const CONF_THRESHOLD = 0.3;
const IOU_THRESHOLD = 0.45;

/* COCO class id -> our 5-class config. id 3 ("motorcycle") is relabelled
 * "motorbike" to match the brief's terminology. */
const CLASS_CONFIG = {
  0: { key: 'person', label: 'person', color: '#e8e8e8' },
  2: { key: 'car', label: 'car', color: '#74c4d4' },
  3: { key: 'motorbike', label: 'motorbike', color: '#d4a574' },
  5: { key: 'bus', label: 'bus', color: '#d474c4' },
  7: { key: 'truck', label: 'truck', color: '#a5d474' },
};
const WANTED_IDS = Object.keys(CLASS_CONFIG).map(Number);

const EMPTY_COUNTS = () => ({
  motorbike: 0,
  car: 0,
  bus: 0,
  truck: 0,
  person: 0,
});

export class YoloDetector {
  constructor() {
    this.session = null;
    this.inputName = 'images';
    this.outputName = 'output0';
    // Reusable offscreen canvas for letterboxing.
    this._lb = document.createElement('canvas');
    this._lb.width = INPUT_SIZE;
    this._lb.height = INPUT_SIZE;
    this._lbCtx = this._lb.getContext('2d', { willReadFrequently: true });
    // Reusable input buffer (NCHW float32).
    this._inputBuf = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  }

  async init() {
    this.session = await ort.InferenceSession.create(
      `${import.meta.env.BASE_URL}models/yolov8s.onnx`,
      {
        executionProviders: ['webgpu', 'wasm'],
        graphOptimizationLevel: 'all',
      },
    );
    this.inputName = this.session.inputNames[0];
    this.outputName = this.session.outputNames[0];
    console.info(
      '[yolo] session ready —',
      'inputs:', this.session.inputNames,
      'outputs:', this.session.outputNames,
    );
  }

  /**
   * Run detection on the current video frame.
   * @param {HTMLVideoElement} video
   * @returns {Promise<{detections: object[], counts: object}>}
   */
  async detect(video) {
    if (!this.session || !video.videoWidth) {
      return { detections: [], counts: EMPTY_COUNTS() };
    }

    const { scale, padX, padY } = this._letterbox(video);
    const tensor = new ort.Tensor('float32', this._inputBuf, [
      1, 3, INPUT_SIZE, INPUT_SIZE,
    ]);

    let detections = [];
    try {
      const results = await this.session.run({ [this.inputName]: tensor });
      const output = results[this.outputName];
      const raw = this._decode(output, scale, padX, padY);
      detections = nms(raw, IOU_THRESHOLD);
      // Release ORT output buffers (incl. WebGPU) every cycle — issue G.
      for (const t of Object.values(results)) t.dispose?.();
    } catch (err) {
      console.error('[yolo] inference failed:', err);
      return { detections: [], counts: EMPTY_COUNTS() };
    } finally {
      tensor.dispose?.();
    }

    const counts = EMPTY_COUNTS();
    for (const d of detections) counts[CLASS_CONFIG[d.classId].key]++;

    return { detections, counts };
  }

  /* Draw the video frame into the 640x640 letterbox canvas and fill the
   * reusable NCHW float32 input buffer (RGB, normalized 0-1). */
  _letterbox(video) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(INPUT_SIZE / vw, INPUT_SIZE / vh);
    const newW = Math.round(vw * scale);
    const newH = Math.round(vh * scale);
    const padX = Math.floor((INPUT_SIZE - newW) / 2);
    const padY = Math.floor((INPUT_SIZE - newH) / 2);

    const ctx = this._lbCtx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    ctx.drawImage(video, padX, padY, newW, newH);

    const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const buf = this._inputBuf;
    const area = INPUT_SIZE * INPUT_SIZE;
    for (let i = 0; i < area; i++) {
      buf[i] = data[i * 4] / 255; // R
      buf[i + area] = data[i * 4 + 1] / 255; // G
      buf[i + 2 * area] = data[i * 4 + 2] / 255; // B
    }
    return { scale, padX, padY };
  }

  /* Decode YOLOv8 output tensor [1, 84, 8400] -> raw detections in
   * native video coordinates. Layout is channel-major: value for
   * channel c, anchor a is data[c * numAnchors + a]. */
  _decode(output, scale, padX, padY) {
    const data = output.data;
    const [, numChannels, numAnchors] = output.dims;
    const dets = [];

    for (let a = 0; a < numAnchors; a++) {
      let bestId = -1;
      let bestScore = CONF_THRESHOLD;
      for (const id of WANTED_IDS) {
        const score = data[(4 + id) * numAnchors + a];
        if (score > bestScore) {
          bestScore = score;
          bestId = id;
        }
      }
      if (bestId < 0) continue;

      const cx = data[a];
      const cy = data[numAnchors + a];
      const w = data[2 * numAnchors + a];
      const h = data[3 * numAnchors + a];

      // 640-space (letterboxed) -> native video pixels.
      dets.push({
        classId: bestId,
        score: bestScore,
        x1: (cx - w / 2 - padX) / scale,
        y1: (cy - h / 2 - padY) / scale,
        x2: (cx + w / 2 - padX) / scale,
        y2: (cy + h / 2 - padY) / scale,
      });
    }
    // numChannels is 84 for the standard export; kept for clarity/debug.
    void numChannels;
    return dets;
  }
}

/* ---------- Non-Maximum Suppression (per class, IoU-based) ---------- */

function iou(a, b) {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter <= 0) return 0;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter);
}

function nms(dets, iouThr) {
  dets.sort((a, b) => b.score - a.score);
  const removed = new Array(dets.length).fill(false);
  const keep = [];
  for (let i = 0; i < dets.length; i++) {
    if (removed[i]) continue;
    keep.push(dets[i]);
    for (let j = i + 1; j < dets.length; j++) {
      if (removed[j] || dets[j].classId !== dets[i].classId) continue;
      if (iou(dets[i], dets[j]) > iouThr) removed[j] = true;
    }
  }
  return keep;
}

/* ---------- Overlay rendering ---------- */

/**
 * Draw bounding boxes + labels onto the overlay canvas. Detections are
 * in native video coordinates; they are transformed into display space
 * by replicating the `object-fit: cover` crop applied to the <video>.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLVideoElement} video
 * @param {object[]} detections
 */
export function drawOverlay(canvas, video, detections) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch) return;

  // Match the canvas backing store to its display size for crisp output.
  if (canvas.width !== Math.round(cw * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;

  // object-fit: cover — scale by the larger ratio, center the overflow.
  const coverScale = Math.max(cw / vw, ch / vh);
  const offX = (cw - vw * coverScale) / 2;
  const offY = (ch - vh * coverScale) / 2;
  const tx = (x) => x * coverScale + offX;
  const ty = (y) => y * coverScale + offY;

  const lineW = Math.max(1.5, cw * 0.0016);
  const fontPx = Math.max(11, Math.round(cw * 0.012));
  ctx.lineWidth = lineW;
  ctx.font = `600 ${fontPx}px 'JetBrains Mono', monospace`;
  ctx.textBaseline = 'top';

  const labelH = fontPx + 6;

  for (const d of detections) {
    const cfg = CLASS_CONFIG[d.classId];
    const x = tx(d.x1);
    const y = ty(d.y1);
    const w = (d.x2 - d.x1) * coverScale;
    const h = (d.y2 - d.y1) * coverScale;

    // Box: 2px-equivalent stroke, transparent fill.
    ctx.strokeStyle = cfg.color;
    ctx.strokeRect(x, y, w, h);

    // Label: filled background, dark text, top-left of the box.
    const text = `${cfg.label} ${d.score.toFixed(2)}`;
    const tw = ctx.measureText(text).width + 8;
    const labelY = y - labelH >= 0 ? y - labelH : y;
    ctx.fillStyle = cfg.color;
    ctx.fillRect(x - lineW / 2, labelY, tw, labelH);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillText(text, x + 4 - lineW / 2, labelY + 3);
  }
}

export function clearOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
