/* parse.js — extract the hidden simulation-parameter JSON from the LLM
 * output, robustly. Malformed output falls back to the previous params
 * so the simulation never breaks (brief issue B). */

export const DEFAULT_PARAMS = {
  vehicle_distribution: { car: 35, motorbike: 50, bus: 8, pedestrian: 7 },
  road_config: 'single',
  flow_speed: 'moderate',
  total_density: 'medium',
};

const ROAD_CONFIGS = ['single', 'grid', 'elevated', 'empty', 'pedestrian_zone'];
const FLOW_SPEEDS = ['blocked', 'slow', 'moderate', 'fast'];
const DENSITIES = ['sparse', 'medium', 'dense', 'overflow'];

/**
 * The displayable prose is everything before the JSON block. Well-formed
 * output never puts a brace in the prose, so cutting at the first '{' is
 * safe and also works mid-stream while the JSON is still incomplete.
 * @param {string} text
 * @returns {string}
 */
export function displayProse(text) {
  const brace = text.indexOf('{');
  let prose = brace === -1 ? text : text.slice(0, brace);
  // Strip any JSON-block preamble the model emitted before the object
  // (markdown fences, "JSON Object:", "Modeline:" and similar labels).
  let prev;
  do {
    prev = prose;
    prose = prose.replace(
      /[\s\n]*(`{1,3}\s*json|`{1,3}|JSON[\w ]*:?|Modeline:?)\s*$/i,
      '',
    );
  } while (prose !== prev);
  return prose.trim();
}

/* Walk back from the last '}' matching braces to isolate the final
 * complete JSON object. Handles the nested vehicle_distribution object. */
function extractLastJSON(text) {
  const end = text.lastIndexOf('}');
  if (end === -1) return null;
  let depth = 0;
  for (let i = end; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      depth--;
      if (depth === 0) return text.slice(i, end + 1);
    }
  }
  return null;
}

const clampPct = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
};

const oneOf = (v, list, fallback) =>
  typeof v === 'string' && list.includes(v) ? v : fallback;

/**
 * Parse simulation params from LLM text. Any failure or missing field
 * is filled from `fallback` (the previous cycle's params).
 * @param {string} text
 * @param {object} fallback
 * @returns {{params: object, ok: boolean}}
 */
export function parseSimParams(text, fallback = DEFAULT_PARAMS) {
  const raw = extractLastJSON(text);
  if (!raw) return { params: fallback, ok: false };

  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { params: fallback, ok: false };
  }

  const fbDist = fallback.vehicle_distribution || DEFAULT_PARAMS.vehicle_distribution;
  const dist = obj.vehicle_distribution || {};
  const hasDist =
    dist && typeof dist === 'object' &&
    ['car', 'motorbike', 'bus', 'pedestrian'].some((k) => k in dist);

  const params = {
    vehicle_distribution: hasDist
      ? {
          car: clampPct(dist.car),
          motorbike: clampPct(dist.motorbike),
          bus: clampPct(dist.bus),
          pedestrian: clampPct(dist.pedestrian),
        }
      : { ...fbDist },
    road_config: oneOf(obj.road_config, ROAD_CONFIGS, fallback.road_config),
    flow_speed: oneOf(obj.flow_speed, FLOW_SPEEDS, fallback.flow_speed),
    total_density: oneOf(obj.total_density, DENSITIES, fallback.total_density),
  };

  // A distribution summing to zero is meaningless — treat as malformed.
  const sum = Object.values(params.vehicle_distribution).reduce((a, b) => a + b, 0);
  if (sum === 0) params.vehicle_distribution = { ...fbDist };

  return { params, ok: true };
}

/**
 * Derive simulation params straight from detection counts. Used as the
 * fallback when the LLM's JSON is missing or malformed, so the
 * simulation always stays reactive to the real scene rather than
 * freezing on stale params.
 * @param {object} counts {motorbike,car,bus,truck,person}
 * @returns {object} params in the same shape as DEFAULT_PARAMS
 */
export function paramsFromCounts(counts = {}) {
  const car = counts.car || 0;
  const motorbike = counts.motorbike || 0;
  const bus = counts.bus || 0;
  const truck = counts.truck || 0;
  const person = counts.person || 0;
  const vehicles = car + motorbike + bus + truck;
  const grand = vehicles + person || 1;

  let total_density = 'sparse';
  let flow_speed = 'fast';
  if (vehicles >= 45) {
    total_density = 'overflow';
    flow_speed = 'blocked';
  } else if (vehicles >= 22) {
    total_density = 'dense';
    flow_speed = 'slow';
  } else if (vehicles >= 8) {
    total_density = 'medium';
    flow_speed = 'moderate';
  }

  return {
    vehicle_distribution: {
      car: Math.round((car / grand) * 100),
      motorbike: Math.round((motorbike / grand) * 100),
      bus: Math.round(((bus + truck) / grand) * 100), // sim has no truck class
      pedestrian: Math.round((person / grand) * 100),
    },
    road_config: vehicles >= 30 ? 'grid' : 'single',
    flow_speed,
    total_density,
  };
}

/* ---------- machine-witness OBSERVATION (deterministic, accurate) ---------- */

const CLASS_WORDS = {
  motorbike: ['motorbike', 'motorbikes'],
  car: ['car', 'cars'],
  bus: ['bus', 'buses'],
  truck: ['truck', 'trucks'],
  person: ['pedestrian', 'pedestrians'],
};

/**
 * Build the OBSERVATION sentence directly from detection counts, in the
 * cold machine-witness voice. Generated in JS (not by the LLM) so the
 * numbers are always exactly correct.
 * @param {object} counts {motorbike,car,bus,truck,person}
 * @returns {string}
 */
export function buildObservation(counts = {}) {
  const c = {
    motorbike: counts.motorbike || 0,
    car: counts.car || 0,
    bus: counts.bus || 0,
    truck: counts.truck || 0,
    person: counts.person || 0,
  };
  const vehicles = c.motorbike + c.car + c.bus + c.truck;

  if (vehicles + c.person === 0) {
    return 'Detection registers no vehicles and no pedestrians. The corridor is vacant.';
  }

  const items = ['motorbike', 'car', 'bus', 'truck', 'person']
    .filter((k) => c[k] > 0)
    .map((k) => `${c[k]} ${CLASS_WORDS[k][c[k] === 1 ? 0 : 1]}`);
  const list =
    items.length === 1
      ? items[0]
      : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

  let sentence = `Detection registers ${list} in the frame.`;

  if (vehicles > 0) {
    const dom = ['motorbike', 'car', 'bus', 'truck'].reduce((a, b) =>
      c[b] > c[a] ? b : a,
    );
    const density =
      vehicles >= 45
        ? 'very high'
        : vehicles >= 22
          ? 'high'
          : vehicles >= 8
            ? 'moderate'
            : 'low';
    const word = CLASS_WORDS[dom][1];
    sentence +=
      ` ${word[0].toUpperCase()}${word.slice(1)} are the dominant class; ` +
      `measured vehicle density is ${density}.`;
  } else {
    sentence += ' No vehicles are present; pedestrian movement only.';
  }
  return sentence;
}

/**
 * Pull the proposed-solution prose out of the LLM output: drop the
 * trailing JSON block and the "PROPOSED SOLUTION:" label.
 * @param {string} text  raw LLM output
 * @returns {string}
 */
export function extractSolution(text) {
  const prose = displayProse(text);
  const m = prose.match(/PROPOSED SOLUTION:\s*([\s\S]*)$/i);
  return (m ? m[1] : prose).trim();
}
