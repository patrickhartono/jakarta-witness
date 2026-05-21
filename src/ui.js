/* ui.js — loading screen, WebGPU detection, fallback, counters, thought text.
 * Pure DOM helpers; no inference logic lives here. */

const $ = (id) => document.getElementById(id);

/* ---------- WebGPU detection ---------- */

/**
 * Robust WebGPU feature detection. `navigator.gpu` can exist while
 * `requestAdapter()` still resolves to null (no compatible adapter),
 * so both checks are required.
 * @returns {Promise<boolean>}
 */
export async function detectWebGPU() {
  if (!('gpu' in navigator)) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/* ---------- Loading screen ---------- */

export function setLoadingStatus(text) {
  const el = $('loading-status');
  if (el) el.textContent = text;
}

/** @param {number} pct 0-100 */
export function setProgress(pct) {
  const el = $('progress-bar');
  if (el) el.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
}

export function hideLoadingScreen() {
  const el = $('loading-screen');
  if (el) el.hidden = true;
}

export function showArtwork() {
  const el = $('artwork');
  if (el) el.hidden = false;
}

export function showFallback() {
  $('loading-screen')?.setAttribute('hidden', '');
  $('artwork')?.setAttribute('hidden', '');
  $('fallback-screen')?.removeAttribute('hidden');
}

/* ---------- HTML escaping (issue K: output sanitization) ---------- */

export function escapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------- Counter badges (top-right of Reality section) ---------- */

const COUNTER_ORDER = [
  { key: 'motorbike', label: 'MOTORBIKE', varName: '--motorbike' },
  { key: 'car', label: 'CAR', varName: '--car' },
  { key: 'bus', label: 'BUS', varName: '--bus' },
  { key: 'truck', label: 'TRUCK', varName: '--truck' },
  { key: 'person', label: 'PERSON', varName: '--person' },
];

/** @param {Record<string, number>} counts */
export function renderCounters(counts) {
  const host = $('counter-badges');
  if (!host) return;
  host.innerHTML = COUNTER_ORDER.map(({ key, label, varName }) => {
    const n = counts[key] ?? 0;
    return (
      `<span class="counter-badge">` +
      `<span class="label" style="color:var(${varName})">${label}:</span> ` +
      `<span class="count">${n}</span>` +
      `</span>`
    );
  }).join('');
}

/* ---------- Thought text (middle section) ---------- */

/**
 * Render the middle "thought" section as two styled blocks.
 * @param {string} observation  accurate OBSERVATION text (JS-generated)
 * @param {string} solution     PROPOSED SOLUTION prose (streamed from the LLM)
 * @param {boolean} streaming   show the blinking caret on the solution line
 */
export function renderThought(observation, solution = '', streaming = false) {
  const host = $('thought-text');
  if (!host) return;

  let html = '';
  if (observation) {
    html +=
      `<div class="thought-line thought-observation">` +
      `<span class="thought-key">OBSERVATION:</span> ` +
      `<span class="thought-body">${escapeHTML(observation)}</span></div>`;
  }
  if (solution || streaming) {
    html +=
      `<div class="thought-line thought-solution">` +
      `<span class="thought-key">PROPOSED SOLUTION:</span> ` +
      `<span class="thought-body">${escapeHTML(solution)}` +
      (streaming ? `<span class="thought-caret"></span>` : '') +
      `</span></div>`;
  }
  host.innerHTML = html;
  host.classList.toggle('generating', streaming);
}

export function clearThought() {
  const host = $('thought-text');
  if (host) {
    host.innerHTML = '';
    host.classList.remove('generating');
  }
}

/* ---------- State indicator (tiny, top-left of Reality) ---------- */

export function initStateIndicator() {
  const stage = document.getElementById('section-reality');
  if (!stage || document.getElementById('state-indicator')) return;
  const el = document.createElement('div');
  el.id = 'state-indicator';
  el.className = 'state-indicator';
  el.innerHTML = `<span class="dot"></span><span class="state-label">IDLE</span>`;
  stage.appendChild(el);
}

export function setStateIndicator(stateName, active) {
  const el = document.getElementById('state-indicator');
  if (!el) return;
  el.classList.toggle('active', !!active);
  const label = el.querySelector('.state-label');
  if (label) label.textContent = stateName;
}
