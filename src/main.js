/* main.js — orchestrator + sequential state machine for Jakarta Witness.
 *
 * Boot:  WebGPU check -> load video -> load YOLO -> load LLM -> run.
 * Cycle: IDLE -> DETECTING -> ANALYZING -> SIMULATING -> COOLDOWN -> IDLE.
 * States never overlap: each phase is awaited before the next begins. */

import './styles.css';
import {
  detectWebGPU,
  setLoadingStatus,
  setProgress,
  hideLoadingScreen,
  showArtwork,
  showFallback,
  renderCounters,
  renderThought,
  initStateIndicator,
  setStateIndicator,
} from './ui.js';
import { YoloDetector, drawOverlay } from './yolo.js';
import { LLM } from './llm.js';
import { createSimulation } from './simulation.js';
import {
  parseSimParams,
  paramsFromCounts,
  buildObservation,
  extractSolution,
} from './parse.js';

const VIDEO_SRC = `${import.meta.env.BASE_URL}video/jakarta.mp4`;

// Cycle phase durations (ms). ANALYZING is variable — driven by the LLM.
const TIMING = {
  idleLiveDetect: 3000,
  detectSettle: 700,
  simulating: 2500,
  cooldown: 3000,
};

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- shared runtime state ---------- */

const els = {
  video: document.getElementById('traffic-video'),
  overlay: document.getElementById('overlay-canvas'),
  simContainer: document.getElementById('simulation-container'),
};

const detector = new YoloDetector();
const llm = new LLM();
let simulation = null;

let running = false;
let paused = false;
let resumeWaiters = [];
let lastDetections = [];

/* ---------- pause / resume (Page Visibility API) ---------- */

function waitWhilePaused() {
  return paused
    ? new Promise((resolve) => resumeWaiters.push(resolve))
    : Promise.resolve();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    paused = true;
    els.video.pause();
    simulation?.pause();
  } else {
    paused = false;
    simulation?.resume();
    const waiters = resumeWaiters;
    resumeWaiters = [];
    waiters.forEach((r) => r());
  }
});

/* ---------- boot ---------- */

async function boot() {
  initStateIndicator();

  setLoadingStatus('Detecting hardware capabilities…');
  if (!(await detectWebGPU())) {
    showFallback();
    return;
  }
  setProgress(2);

  // Video — required input. Surface a clear message if absent.
  setLoadingStatus('Loading Jakarta traffic footage…');
  try {
    await loadVideo();
  } catch {
    setLoadingStatus(
      'Jakarta video not found. Add your footage as ' +
        'public/video/jakarta.mp4 and reload.',
    );
    return;
  }
  setProgress(4);

  // YOLO detection model (~12 MB, committed to the repo).
  setLoadingStatus('Loading detection model (YOLOv8n)…');
  try {
    await detector.init();
  } catch (err) {
    console.error(err);
    setLoadingStatus('Failed to initialise the detection model.');
    return;
  }
  setProgress(7);

  // LLM — the large download. progress_callback drives the real bar.
  setLoadingStatus('Downloading language model — Qwen 2.5 1.5B…');
  try {
    await llm.load(onLLMProgress);
  } catch (err) {
    console.error(err);
    setLoadingStatus('Failed to load the language model. See console.');
    return;
  }
  setProgress(100);
  setLoadingStatus('Ready.');

  // Reveal the artwork and start the simulation.
  hideLoadingScreen();
  showArtwork();
  simulation = createSimulation(els.simContainer);
  renderThought('Awaiting first detection cycle.', '', false);

  running = true;
  runCycle();
}

/* Load the video and resolve once a frame is decodable. */
function loadVideo() {
  return new Promise((resolve, reject) => {
    const v = els.video;
    const ok = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error('video load failed'));
    };
    const cleanup = () => {
      v.removeEventListener('loadeddata', ok);
      v.removeEventListener('error', fail);
    };
    v.addEventListener('loadeddata', ok);
    v.addEventListener('error', fail);
    v.src = VIDEO_SRC;
    v.load();
  });
}

/* Aggregate Transformers.js download events into one real progress bar.
 * The 3–97% band is reserved for the model download. */
const dlFiles = new Map();
function onLLMProgress(e) {
  if (e.status === 'progress' && e.total) {
    dlFiles.set(e.file, { loaded: e.loaded, total: e.total });
  } else if (e.status === 'done' && dlFiles.has(e.file)) {
    const f = dlFiles.get(e.file);
    f.loaded = f.total;
  } else {
    return;
  }
  let loaded = 0;
  let total = 0;
  for (const f of dlFiles.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  if (total <= 0) return;
  const frac = loaded / total;
  setProgress(7 + frac * 90);
  if (frac >= 0.999) {
    setLoadingStatus('Compiling WebGPU shaders…');
  } else {
    setLoadingStatus(
      `Downloading language model — ${fmtMB(loaded)} / ${fmtMB(total)} ` +
        '(cached after first run)',
    );
  }
}

const fmtMB = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;

/* ---------- scene-state construction ---------- */

function buildSceneState(counts) {
  const vehicleTotal =
    counts.car + counts.motorbike + counts.bus + counts.truck;

  let density = 'low';
  if (vehicleTotal >= 45) density = 'very_high';
  else if (vehicleTotal >= 22) density = 'high';
  else if (vehicleTotal >= 8) density = 'medium';

  const dominant = [
    ['car', counts.car],
    ['motorbike', counts.motorbike],
    ['bus', counts.bus],
    ['truck', counts.truck],
  ].sort((a, b) => b[1] - a[1])[0][0];

  return {
    timestamp: new Date().toISOString(),
    vehicle_counts: {
      car: counts.car,
      motorbike: counts.motorbike,
      bus: counts.bus,
      truck: counts.truck,
    },
    person_count: counts.person,
    density_estimate: density,
    dominant_class: dominant,
  };
}

/* ---------- the state machine ---------- */

async function runCycle() {
  while (running) {
    await waitWhilePaused();

    // IDLE — video plays, YOLO tracks live.
    setStateIndicator('IDLE', false);
    try {
      await els.video.play();
    } catch {
      /* autoplay of a muted video should not be blocked; ignore */
    }
    await liveDetect(TIMING.idleLiveDetect);

    // DETECTING — freeze the frame, snapshot the detection.
    setStateIndicator('DETECTING', true);
    els.video.pause();
    const { detections, counts } = await detector.detect(els.video);
    lastDetections = detections;
    drawOverlay(els.overlay, els.video, detections);
    renderCounters(counts);
    const scene = buildSceneState(counts);
    await delay(TIMING.detectSettle);

    // ANALYZING — show the accurate observation immediately, then stream
    // the LLM's proposed solution beneath it.
    setStateIndicator('ANALYZING', true);
    const observation = buildObservation(counts);
    renderThought(observation, '', true);
    let acc = '';
    let full = '';
    try {
      full = await llm.generate(scene, (chunk) => {
        acc += chunk;
        renderThought(observation, extractSolution(acc), true);
      });
    } catch (err) {
      console.error('[cycle] generation failed:', err);
      full = acc;
    }
    const finalText = full || acc;
    renderThought(observation, extractSolution(finalText), false);

    // Parse the LLM's JSON; if missing or malformed, fall back to params
    // derived from the detection counts so the simulation always reacts
    // to the real scene rather than freezing on stale values.
    const { params, ok } = parseSimParams(finalText, paramsFromCounts(counts));
    if (!ok) {
      console.warn('[cycle] LLM JSON unusable — using detection-derived params');
    }

    // SIMULATING — the p5.js field fades to the new reduced state.
    setStateIndicator('SIMULATING', true);
    simulation.updateParams(params);
    await delay(TIMING.simulating);

    // COOLDOWN — everything holds.
    setStateIndicator('COOLDOWN', false);
    await delay(TIMING.cooldown);
  }
}

/* Run detection continuously for `ms` while the video plays. */
async function liveDetect(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end && running && !paused) {
    const { detections, counts } = await detector.detect(els.video);
    lastDetections = detections;
    drawOverlay(els.overlay, els.video, detections);
    renderCounters(counts);
    await delay(0); // yield to the event loop
  }
}

/* Keep the overlay aligned if the viewport changes between detections. */
window.addEventListener('resize', () => {
  if (lastDetections.length || els.video.videoWidth) {
    drawOverlay(els.overlay, els.video, lastDetections);
  }
});

/* ---------- go ---------- */

boot().catch((err) => {
  console.error('[boot] fatal:', err);
  setLoadingStatus('Initialisation failed. See console for details.');
});
