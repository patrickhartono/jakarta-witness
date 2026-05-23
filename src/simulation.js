/* simulation.js — the BOTTOM section: a p5.js (instance mode) 2D rendering
 * of the AI's reduced mental model of Jakarta. Schematic / blueprint
 * aesthetic on a white field: dark asphalt strips on paper, colored
 * rectangles for vehicles, stepped pixel-aligned movement, no collision
 * resolution (overlap is intentional).
 *
 * This layer does not just abstractly reduce density — it physically
 * BUILDS the LLM's proposed solution. Each intervention tag (derived
 * from the PROPOSED SOLUTION prose in parse.js) maps to a concrete
 * piece of infrastructure drawn on the field: a labelled pedestrian
 * crossing, a dedicated bus lane, a cycle lane, an adaptive signal that
 * holds queues, an access checkpoint that turns vehicles away, an
 * elevated deck, a pedestrian plaza.
 *
 * All canvas colors flow through the THEME palette below — a future
 * dark/light toggle would only swap THEME, not rewrite drawing code.
 *
 * createSimulation(container) -> { updateParams, pause, resume, destroy } */

import p5 from 'p5';
import { DEFAULT_PARAMS, INTERVENTION_LABELS } from './parse.js';

// Vehicle / walker palette — readable on both dark and light fields.
const COLORS = {
  car: '#74c4d4',
  motorbike: '#d4a574',
  bus: '#d474c4',
  pedestrian: '#2a2a2a', // dark dot — must contrast the white field
  cyclist: '#7ad47a',
};

/* Every color the canvas paints. The light theme is tuned to read as a
 * technical drawing on white paper: dark asphalt against the page, mid-
 * gray grid, warm-concrete sidewalks and plaza, dark text. */
const THEME = {
  background: '#ffffff',
  backgroundRGB: [255, 255, 255], // used for the fade overlay (needs alpha)
  grid: '#e4e4e4',

  roadFill: '#2a2a2a',
  roadStroke: '#9a9a9a',
  centerline: '#8a8a8a',
  elevatedStroke: '#6a6a6a',
  elevatedShadow: '#bcbcbc',

  agentOutline: '#0a0a0a',

  sidewalkFill: '#c9c5b9',
  sidewalkCurb: '#7a7a7a',
  sidewalkTicks: '#b0aca2',

  crossingPatch: '#1f1f1f', // sits on the dark asphalt
  zebraStripe: '#f0f0f0',

  plazaGround: '#e8e3d3',
  plazaTile: '#d4cfc0',
  plazaPath: '#dcd6c5',
  plazaBorder: '#a8a39a',
  treeOuter: '#34502d',
  treeInner: '#4f7a44',

  signalRed: '#e0564b',
  signalAmber: '#e0b34b',
  signalGreen: '#5fce6f',
  signalHousing: '#161616',
  signalHousingStroke: '#444444',
  signalUnlit: '#2a2a2a',
  signalStopLine: '#cfcfcf', // on dark asphalt; stays light

  busLaneFill: 'rgba(212, 116, 196, 0.16)',
  busLaneFillRGBA: [212, 116, 196, 40],
  busLaneStrokeRGBA: [212, 116, 196, 160],
  bikeLaneFillRGBA: [122, 212, 122, 48],
  bikeLaneStrokeRGBA: [122, 212, 122, 170],

  checkpointBooth: '#2a2a2a',
  checkpointBarrier: '#d4b24b',
  checkpointHatch: '#0a0a0a',
  rejectedFill: '#3a3a3a',
  rejectedX: '#e0564b',
  elevatedDeckFill: '#181818',

  legendBoxRGBA: [255, 255, 255, 220],
  legendBorder: '#bcbcbc',
  legendTitle: '#6a6a6a',
  legendItem: '#1c1c1c',
  legendFallbackSwatch: '#888888',

  labelText: '#3a3a3a',
  labelShadow: '#ffffff',
};

// total_density -> number of agents on the field
const DENSITY_COUNT = { sparse: 22, medium: 44, dense: 72, overflow: 105 };
// flow_speed -> base pixels-per-frame travel rate
const SPEED = { blocked: 0.12, slow: 0.5, moderate: 1.15, fast: 2.4 };
// per-class speed multiplier and footprint (length along travel, width across)
const CLASS_SPEC = {
  motorbike: { mul: 1.4, len: 11, wid: 7 },
  car: { mul: 1.0, len: 16, wid: 10 },
  bus: { mul: 0.65, len: 28, wid: 12 },
  pedestrian: { mul: 0.34, len: 5, wid: 5 },
};

const LEGEND_COLOR = {
  pedestrian_crossing: '#5a5a5a',
  bus_lane: '#d474c4',
  bike_lane: '#7ad47a',
  signal: '#5fce6f',
  checkpoint: '#d4b24b',
  elevated: '#6a6a6a',
  pedestrian_plaza: '#a8a39a',
};

const EMPTY_IV = {
  active: [],
  sidewalks: [],
  crossings: [],
  busLane: null,
  bikeLane: null,
  signals: [],
  checkpoint: null,
  elevated: null,
  plaza: null,
};

export function createSimulation(container) {
  let params = structuredClone(DEFAULT_PARAMS);
  let pendingParams = null;
  let roads = [];
  let iv = { ...EMPTY_IV };
  let agents = [];
  let walkers = [];
  let pedShare = 0;
  let signalTick = 0;
  let sceneAlpha = 1; // 1 = fully visible; dips during a transition
  let fadePhase = 'in'; // 'in' | 'out'

  /* ---------- scene construction ---------- */

  function buildRoads(W, H) {
    switch (params.road_config) {
      case 'grid':
        return [
          { x: 0, y: H * 0.2, w: W, h: H * 0.17, axis: 'h' },
          { x: 0, y: H * 0.62, w: W, h: H * 0.17, axis: 'h' },
          { x: W * 0.28, y: 0, w: W * 0.11, h: H, axis: 'v' },
          { x: W * 0.66, y: 0, w: W * 0.11, h: H, axis: 'v' },
        ];
      case 'elevated':
        return [
          { x: 0, y: H * 0.58, w: W, h: H * 0.3, axis: 'h' },
          { x: 0, y: H * 0.12, w: W, h: H * 0.26, axis: 'h', elevated: true },
        ];
      case 'empty':
        return [{ x: 0, y: H * 0.5 - H * 0.08, w: W, h: H * 0.16, axis: 'h' }];
      case 'pedestrian_zone':
        return [];
      case 'single':
      default:
        return [{ x: 0, y: H * 0.5 - H * 0.2, w: W, h: H * 0.4, axis: 'h' }];
    }
  }

  /* Translate the intervention tags into concrete on-field geometry.
   * Each structure here is something the LLM's solution literally
   * proposed — built so the audience can see the plan, not just feel it. */
  function buildInterventions(W, H) {
    const set = new Set(params.interventions || []);
    const hRoads = roads.filter((r) => r.axis === 'h');
    const main = hRoads[0] || null;
    const out = {
      active: [...(params.interventions || [])],
      sidewalks: [],
      crossings: [],
      busLane: null,
      bikeLane: null,
      signals: [],
      checkpoint: null,
      elevated: null,
      plaza: null,
    };

    // PEDESTRIAN CROSSING — kerbed sidewalk bands flanking every road,
    // plus zebra crossings the pedestrians actually walk across.
    if (set.has('pedestrian_crossing')) {
      for (const r of hRoads) {
        const sw = 11;
        out.sidewalks.push({ x: r.x, y: r.y - sw - 2, w: r.w, h: sw, side: 'top' });
        out.sidewalks.push({ x: r.x, y: r.y + r.h + 2, w: r.w, h: sw, side: 'bottom' });
        for (const f of [0.34, 0.7]) {
          const cw = 18;
          out.crossings.push({ x: r.x + r.w * f - cw / 2, y: r.y, w: cw, h: r.h });
        }
      }
    }

    // DEDICATED BUS LANE — the lower band of the main road, reserved.
    if (set.has('bus_lane') && main) {
      const lh = Math.max(13, main.h * 0.4);
      out.busLane = {
        x: main.x, y: main.y + main.h - lh, w: main.w, h: lh,
        roadIdx: roads.indexOf(main),
      };
    }

    // CYCLE LANE — a thin reserved strip on the top edge of the main road.
    if (set.has('bike_lane') && main) {
      out.bikeLane = {
        x: main.x, y: main.y + 2, w: main.w, h: 9,
        roadIdx: roads.indexOf(main),
      };
    }

    // ADAPTIVE SIGNAL — one per horizontal road; holds a queue when red.
    if (set.has('signal')) {
      hRoads.forEach((r, i) => {
        out.signals.push({
          roadIdx: roads.indexOf(r),
          stopAlong: r.w * 0.72,
          roadX: r.x, roadY: r.y, roadH: r.h,
          offset: i * 130,
        });
      });
    }

    // ACCESS CHECKPOINT — a barrier near the entry; turned-away vehicles
    // pile up outside the corridor, marked rejected.
    if (set.has('checkpoint') && main) {
      out.checkpoint = {
        x: main.x + main.w * 0.17,
        roadX: main.x, roadY: main.y, roadH: main.h,
        rejected: Array.from({ length: 4 }, (_, k) => ({
          x: main.x + 10 + k * 22,
          y: main.y - 30 - (k % 2) * 15,
        })),
      };
    }

    // ELEVATED THROUGH-ROUTE — label the elevated road, or draw a deck.
    if (set.has('elevated')) {
      const elevRoad = roads.find((r) => r.elevated);
      out.elevated = elevRoad
        ? { x: elevRoad.x + 6, y: elevRoad.y - 4, deck: null }
        : {
            x: 6, y: H * 0.1 - 4,
            deck: { x: 0, y: H * 0.1, w: W, h: H * 0.13 },
          };
    }

    // PEDESTRIAN PLAZA — an inset paved surface with paths and trees.
    if (set.has('pedestrian_plaza')) {
      const pad = Math.min(W, H) * 0.07;
      out.plaza = {
        x: pad, y: pad, w: W - pad * 2, h: H - pad * 2,
        trees: Array.from({ length: 7 }, () => ({
          x: pad + 14 + Math.random() * (W - pad * 2 - 28),
          y: pad + 14 + Math.random() * (H - pad * 2 - 28),
        })),
      };
    }

    return out;
  }

  function pickVehicleClass(dist) {
    const entries = [
      ['car', dist.car],
      ['motorbike', dist.motorbike],
      ['bus', dist.bus],
    ];
    const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0);
    if (total <= 0) return 'car';
    let r = Math.random() * total;
    for (const [k, w] of entries) {
      r -= Math.max(0, w);
      if (r <= 0) return k;
    }
    return 'car';
  }

  /* Place one vehicle riding a road, respecting any reserved lanes. */
  function onRoadAgent(cls, spec, base, roadIdx) {
    const road = roads[roadIdx];
    const horiz = road.axis === 'h';
    const dir = Math.random() < 0.5 ? 1 : -1;
    const len = horiz ? road.w : road.h;
    const thickness = horiz ? road.h : road.w;
    let laneMin = (horiz ? road.y : road.x) + 4;
    let laneSpan = Math.max(2, thickness - spec.wid - 8);

    if (horiz && iv.busLane && iv.busLane.roadIdx === roadIdx) {
      if (cls === 'bus') {
        laneMin = iv.busLane.y + 2;
        laneSpan = Math.max(2, iv.busLane.h - spec.wid - 4);
      } else {
        laneMin = road.y + 4;
        laneSpan = Math.max(2, iv.busLane.y - road.y - spec.wid - 6);
      }
    }
    if (horiz && iv.bikeLane && iv.bikeLane.roadIdx === roadIdx && cls !== 'bus') {
      const floor = iv.bikeLane.y + iv.bikeLane.h + 2;
      if (laneMin < floor) {
        laneSpan = Math.max(2, laneSpan - (floor - laneMin));
        laneMin = floor;
      }
    }

    return {
      cls,
      color: COLORS[cls],
      onRoad: true,
      horiz,
      dir,
      along: Math.random() * len,
      lane: laneMin + Math.random() * laneSpan,
      roadStart: horiz ? road.x : road.y,
      roadLen: len,
      roadIdx,
      w: horiz ? spec.len : spec.wid,
      h: horiz ? spec.wid : spec.len,
      speed: base * spec.mul,
      acc: Math.random(),
    };
  }

  function looseAgent(cls, spec, base, W, H) {
    return {
      cls,
      color: COLORS[cls],
      onRoad: false,
      x: Math.random() * W,
      y: Math.random() * H,
      w: spec.wid,
      h: spec.wid,
      vx: 0,
      vy: 0,
      speed: base * spec.mul,
      retarget: 0,
    };
  }

  function buildAgents(W, H) {
    const count = DENSITY_COUNT[params.total_density] ?? 26;
    const base = SPEED[params.flow_speed] ?? 1.15;
    const dist = params.vehicle_distribution;
    const distSum = Math.max(
      1,
      dist.car + dist.motorbike + dist.bus + dist.pedestrian,
    );
    pedShare = dist.pedestrian / distSum;
    const vehicleCount = Math.round(count * (1 - pedShare));
    const list = [];

    for (let i = 0; i < vehicleCount; i++) {
      const cls = pickVehicleClass(dist);
      const spec = CLASS_SPEC[cls];
      if (roads.length === 0) {
        list.push(looseAgent(cls, spec, base, W, H));
        continue;
      }
      let roadIdx;
      if (cls === 'bus' && iv.busLane) roadIdx = iv.busLane.roadIdx;
      else roadIdx = (Math.random() * roads.length) | 0;
      list.push(onRoadAgent(cls, spec, base, roadIdx));
    }

    // Cyclists materialise only where a cycle lane was actually built.
    if (iv.bikeLane) {
      const road = roads[iv.bikeLane.roadIdx];
      const n = 5 + ((Math.random() * 4) | 0);
      for (let i = 0; i < n; i++) {
        list.push({
          cls: 'cyclist',
          color: COLORS.cyclist,
          onRoad: true,
          horiz: true,
          dir: Math.random() < 0.5 ? 1 : -1,
          along: Math.random() * road.w,
          lane: iv.bikeLane.y + 1,
          roadStart: road.x,
          roadLen: road.w,
          roadIdx: iv.bikeLane.roadIdx,
          w: 9,
          h: 5,
          speed: base * 1.2,
          acc: Math.random(),
        });
      }
    }
    return list;
  }

  /* Pedestrians become walkers: on plaza ground, along sidewalks, or
   * crossing at a zebra. Without pedestrian infrastructure they loose-
   * wander the field, exactly as before. */
  function buildWalkers(W, H) {
    const count = DENSITY_COUNT[params.total_density] ?? 26;
    let pedCount = Math.round(count * pedShare);
    if (iv.plaza) pedCount = Math.max(pedCount, 48); // a plaza IS its crowd
    const base = SPEED[params.flow_speed] ?? 1.15;
    const pspeed = base * CLASS_SPEC.pedestrian.mul + 0.18;
    const list = [];

    for (let i = 0; i < pedCount; i++) {
      if (iv.plaza) {
        const z = iv.plaza;
        list.push({
          mode: 'plaza',
          x: z.x + Math.random() * z.w,
          y: z.y + Math.random() * z.h,
          vx: 0, vy: 0, speed: pspeed, retarget: 0,
        });
      } else if (iv.crossings.length && Math.random() < 0.36) {
        const c = iv.crossings[(Math.random() * iv.crossings.length) | 0];
        list.push({
          mode: 'crossing',
          x: c.x + 3 + Math.random() * (c.w - 6),
          y: c.y - 12 + Math.random() * (c.h + 24),
          dir: Math.random() < 0.5 ? 1 : -1,
          c,
          speed: pspeed,
        });
      } else if (iv.sidewalks.length) {
        const s = iv.sidewalks[(Math.random() * iv.sidewalks.length) | 0];
        list.push({
          mode: 'sidewalk',
          x: s.x + Math.random() * s.w,
          y: s.y + 2 + Math.random() * (s.h - 4),
          dir: Math.random() < 0.5 ? 1 : -1,
          s,
          speed: pspeed,
        });
      } else {
        list.push({
          mode: 'loose',
          x: Math.random() * W,
          y: Math.random() * H,
          vx: 0, vy: 0, speed: pspeed, retarget: 0,
        });
      }
    }
    return list;
  }

  function rebuild(p) {
    roads = buildRoads(p.width, p.height);
    iv = buildInterventions(p.width, p.height);
    agents = buildAgents(p.width, p.height);
    walkers = buildWalkers(p.width, p.height);
    signalTick = 0;
  }

  /* ---------- signal timing ---------- */

  function signalState(sig) {
    const period = 320;
    const ph = (signalTick + sig.offset) % period;
    if (ph < 130) return 'red';
    if (ph < 156) return 'amber';
    return 'green';
  }

  function signalFor(roadIdx) {
    return iv.signals.find((s) => s.roadIdx === roadIdx) || null;
  }

  /* ---------- per-frame updates ---------- */

  function stepAgents() {
    for (const a of agents) {
      if (a.onRoad) {
        // An adaptive signal holds a queue just behind its stop line.
        let blocked = false;
        const sig = signalFor(a.roadIdx);
        if (sig && signalState(sig) !== 'green') {
          const s = sig.stopAlong;
          if (a.dir === 1 && a.along > s - 30 && a.along <= s) blocked = true;
          if (a.dir === -1 && a.along < s + 30 && a.along >= s) blocked = true;
        }
        if (!blocked) {
          a.acc += a.speed;
          while (a.acc >= 1) {
            a.along += a.dir;
            a.acc -= 1;
          }
          const margin = 40;
          if (a.along > a.roadLen + margin) a.along = -margin;
          if (a.along < -margin) a.along = a.roadLen + margin;
        }
      } else {
        if (a.retarget <= 0) {
          const ang = Math.random() * Math.PI * 2;
          a.vx = Math.cos(ang) * a.speed;
          a.vy = Math.sin(ang) * a.speed;
          a.retarget = 20 + Math.random() * 40;
        }
        a.retarget--;
        a.x += a.vx;
        a.y += a.vy;
        if (a.x < 0) a.x = curW;
        if (a.x > curW) a.x = 0;
        if (a.y < 0) a.y = curH;
        if (a.y > curH) a.y = 0;
      }
    }
  }

  function stepWalkers() {
    for (const w of walkers) {
      if (w.mode === 'sidewalk') {
        w.x += w.dir * w.speed;
        if (w.x > w.s.x + w.s.w) w.x = w.s.x;
        if (w.x < w.s.x) w.x = w.s.x + w.s.w;
      } else if (w.mode === 'crossing') {
        w.y += w.dir * w.speed;
        const top = w.c.y - 12;
        const bot = w.c.y + w.c.h + 12;
        if (w.y > bot) w.y = top;
        if (w.y < top) w.y = bot;
      } else {
        if (w.retarget <= 0) {
          const ang = Math.random() * Math.PI * 2;
          w.vx = Math.cos(ang) * w.speed;
          w.vy = Math.sin(ang) * w.speed;
          w.retarget = 24 + Math.random() * 48;
        }
        w.retarget--;
        w.x += w.vx;
        w.y += w.vy;
        const z = iv.plaza;
        if (z && w.mode === 'plaza') {
          if (w.x < z.x) { w.x = z.x; w.retarget = 0; }
          if (w.x > z.x + z.w) { w.x = z.x + z.w; w.retarget = 0; }
          if (w.y < z.y) { w.y = z.y; w.retarget = 0; }
          if (w.y > z.y + z.h) { w.y = z.y + z.h; w.retarget = 0; }
        } else {
          if (w.x < 0) w.x = curW;
          if (w.x > curW) w.x = 0;
          if (w.y < 0) w.y = curH;
          if (w.y > curH) w.y = 0;
        }
      }
    }
  }

  /* ---------- drawing ---------- */

  let curW = 1;
  let curH = 1;

  function drawGrid(p) {
    p.stroke(THEME.grid);
    p.strokeWeight(1);
    for (let x = 0; x < p.width; x += 24) p.line(x, 0, x, p.height);
    for (let y = 0; y < p.height; y += 24) p.line(0, y, p.width, y);
  }

  function drawPlaza(p) {
    const z = iv.plaza;
    if (!z) return;
    p.noStroke();
    p.fill(THEME.plazaGround);
    p.rect(z.x | 0, z.y | 0, z.w | 0, z.h | 0);
    // paving tiles
    p.stroke(THEME.plazaTile);
    p.strokeWeight(1);
    for (let x = z.x; x < z.x + z.w; x += 22) p.line(x, z.y, x, z.y + z.h);
    for (let y = z.y; y < z.y + z.h; y += 22) p.line(z.x, y, z.x + z.w, y);
    // cross paths
    p.noStroke();
    p.fill(THEME.plazaPath);
    p.rect(z.x, (z.y + z.h / 2 - 8) | 0, z.w, 16);
    p.rect((z.x + z.w / 2 - 8) | 0, z.y, 16, z.h);
    // trees
    for (const t of z.trees) {
      p.fill(THEME.treeOuter);
      p.circle(t.x, t.y, 12);
      p.fill(THEME.treeInner);
      p.circle(t.x - 1, t.y - 1, 6);
    }
    p.noFill();
    p.stroke(THEME.plazaBorder);
    p.strokeWeight(1);
    p.rect(z.x | 0, z.y | 0, z.w | 0, z.h | 0);
  }

  function drawRoads(p) {
    for (const r of roads) {
      p.noStroke();
      p.fill(THEME.roadFill);
      p.rect(r.x | 0, r.y | 0, r.w | 0, r.h | 0);
      p.stroke(r.elevated ? THEME.elevatedStroke : THEME.roadStroke);
      p.strokeWeight(1);
      p.noFill();
      p.rect(r.x | 0, r.y | 0, r.w | 0, r.h | 0);
      // dashed centerline
      p.stroke(THEME.centerline);
      if (r.axis === 'h') {
        const cy = (r.y + r.h / 2) | 0;
        for (let x = 0; x < r.w; x += 22) p.line(x, cy, x + 11, cy);
      } else {
        const cx = (r.x + r.w / 2) | 0;
        for (let y = 0; y < r.h; y += 22) p.line(cx, y, cx, y + 11);
      }
      if (r.elevated) {
        p.stroke(THEME.elevatedShadow);
        p.line(r.x, (r.y + r.h + 6) | 0, r.x + r.w, (r.y + r.h + 6) | 0);
      }
    }
  }

  function drawElevatedDeck(p) {
    const e = iv.elevated;
    if (!e || !e.deck) return;
    const d = e.deck;
    p.noStroke();
    p.fill(THEME.elevatedDeckFill);
    p.rect(d.x | 0, d.y | 0, d.w | 0, d.h | 0);
    p.stroke(THEME.elevatedStroke);
    p.strokeWeight(1);
    p.noFill();
    p.rect(d.x | 0, d.y | 0, d.w | 0, d.h | 0);
    p.stroke(THEME.elevatedShadow);
    p.line(d.x, (d.y + d.h + 6) | 0, d.x + d.w, (d.y + d.h + 6) | 0);
  }

  function drawLaneOverlays(p) {
    const b = iv.busLane;
    if (b) {
      p.noStroke();
      p.fill(...THEME.busLaneFillRGBA);
      p.rect(b.x | 0, b.y | 0, b.w | 0, b.h | 0);
      p.stroke(...THEME.busLaneStrokeRGBA);
      p.strokeWeight(1);
      for (let x = b.x; x < b.x + b.w; x += 16) p.line(x, b.y | 0, x + 8, b.y | 0);
    }
    const k = iv.bikeLane;
    if (k) {
      p.noStroke();
      p.fill(...THEME.bikeLaneFillRGBA);
      p.rect(k.x | 0, k.y | 0, k.w | 0, k.h | 0);
      p.stroke(...THEME.bikeLaneStrokeRGBA);
      p.strokeWeight(1);
      const ey = (k.y + k.h) | 0;
      for (let x = k.x; x < k.x + k.w; x += 16) p.line(x, ey, x + 8, ey);
    }
  }

  function drawSidewalks(p) {
    for (const s of iv.sidewalks) {
      p.noStroke();
      p.fill(THEME.sidewalkFill);
      p.rect(s.x | 0, s.y | 0, s.w | 0, s.h | 0);
      p.stroke(THEME.sidewalkCurb);
      p.strokeWeight(1);
      const cy = (s.side === 'top' ? s.y + s.h : s.y) | 0;
      p.line(s.x, cy, s.x + s.w, cy);
      p.stroke(THEME.sidewalkTicks);
      for (let x = s.x; x < s.x + s.w; x += 10) p.line(x, s.y, x, s.y + s.h);
    }
    for (const c of iv.crossings) {
      p.noStroke();
      p.fill(THEME.crossingPatch);
      p.rect(c.x | 0, c.y | 0, c.w | 0, c.h | 0);
      p.fill(THEME.zebraStripe);
      for (let y = c.y + 3; y < c.y + c.h - 3; y += 8) {
        p.rect((c.x + 2) | 0, y | 0, (c.w - 4) | 0, 4);
      }
    }
  }

  function drawCheckpoint(p) {
    const c = iv.checkpoint;
    if (!c) return;
    const x = c.x | 0;
    p.noStroke();
    p.fill(THEME.checkpointBooth);
    p.rect(x - 7, (c.roadY - 4) | 0, 14, (c.roadH + 8) | 0);
    p.stroke(THEME.checkpointBarrier);
    p.strokeWeight(3);
    p.line(x, c.roadY + 2, x, c.roadY + c.roadH - 2);
    p.stroke(THEME.checkpointHatch);
    p.strokeWeight(1);
    for (let y = c.roadY + 3; y < c.roadY + c.roadH - 3; y += 8) {
      p.line(x - 2, y, x + 2, y);
    }
    for (const r of c.rejected) {
      p.noStroke();
      p.fill(THEME.rejectedFill);
      p.rect(r.x | 0, r.y | 0, 14, 9);
      p.stroke(THEME.rejectedX);
      p.strokeWeight(1.4);
      p.line(r.x, r.y, r.x + 14, r.y + 9);
      p.line(r.x + 14, r.y, r.x, r.y + 9);
    }
  }

  function drawAgents(p) {
    p.strokeWeight(1);
    for (const a of agents) {
      let x;
      let y;
      if (a.onRoad) {
        if (a.horiz) {
          x = (a.roadStart + a.along) | 0;
          y = a.lane | 0;
        } else {
          x = a.lane | 0;
          y = (a.roadStart + a.along) | 0;
        }
      } else {
        x = a.x | 0;
        y = a.y | 0;
      }
      p.fill(a.color);
      p.stroke(THEME.agentOutline);
      p.rect(x, y, a.w, a.h);
    }
  }

  function drawWalkers(p) {
    p.noStroke();
    p.fill(COLORS.pedestrian);
    for (const w of walkers) p.rect(w.x | 0, w.y | 0, 5, 5);
  }

  function drawSignals(p) {
    for (const sig of iv.signals) {
      const st = signalState(sig);
      const sx = (sig.roadX + sig.stopAlong) | 0;
      // stop line
      p.stroke(THEME.signalStopLine);
      p.strokeWeight(2);
      p.line(sx, sig.roadY + 2, sx, sig.roadY + sig.roadH - 2);
      // pole
      const fx = sx - 4;
      const fy = (sig.roadY - 32) | 0;
      p.stroke(THEME.signalHousingStroke);
      p.strokeWeight(1);
      p.line(fx + 4.5, fy + 26, fx + 4.5, sig.roadY);
      // housing
      p.fill(THEME.signalHousing);
      p.stroke(THEME.signalHousingStroke);
      p.rect(fx, fy, 9, 26);
      // lamps
      p.noStroke();
      const lamp = (col, on, i) => {
        p.fill(on ? col : THEME.signalUnlit);
        p.circle(fx + 4.5, fy + 6 + i * 8, on ? 6 : 4.2);
      };
      lamp(THEME.signalRed, st === 'red', 0);
      lamp(THEME.signalAmber, st === 'amber', 1);
      lamp(THEME.signalGreen, st === 'green', 2);
    }
  }

  function label(p, text, x, y, align) {
    p.textSize(8);
    p.textAlign(p.LEFT, align);
    p.noStroke();
    p.fill(THEME.labelShadow);
    p.text(text, x + 1, y + 1);
    p.fill(THEME.labelText);
    p.text(text, x, y);
  }

  function drawLabels(p) {
    if (iv.busLane) {
      label(p, 'BUS LANE', iv.busLane.x + 5, iv.busLane.y + iv.busLane.h - 3, p.BOTTOM);
    }
    if (iv.bikeLane) {
      label(p, 'CYCLE LANE', iv.bikeLane.x + 5, iv.bikeLane.y - 2, p.BOTTOM);
    }
    if (iv.crossings.length) {
      const c = iv.crossings[0];
      label(p, 'PEDESTRIAN CROSSING', c.x - 4, c.y - 16, p.BOTTOM);
    }
    if (iv.checkpoint) {
      label(p, 'ACCESS CHECKPOINT', iv.checkpoint.x - 8,
        iv.checkpoint.roadY + iv.checkpoint.roadH + 14, p.TOP);
    }
    for (const sig of iv.signals) {
      label(p, 'SIGNAL', sig.roadX + sig.stopAlong + 7, sig.roadY - 30, p.TOP);
    }
    if (iv.elevated) {
      label(p, 'ELEVATED THROUGH-ROUTE', iv.elevated.x, iv.elevated.y, p.BOTTOM);
    }
    if (iv.plaza) {
      label(p, 'PEDESTRIAN PLAZA', iv.plaza.x + 5, iv.plaza.y + 11, p.TOP);
    }
  }

  function drawLegend(p) {
    const items = iv.active;
    if (!items.length) return;
    const pad = 7;
    const lh = 13;
    const boxW = 198;
    const boxH = pad * 2 + 13 + items.length * lh;
    p.noStroke();
    p.fill(...THEME.legendBoxRGBA);
    p.rect(6, 6, boxW, boxH);
    p.stroke(THEME.legendBorder);
    p.strokeWeight(1);
    p.noFill();
    p.rect(6, 6, boxW, boxH);
    p.noStroke();
    p.textSize(8.5);
    p.textAlign(p.LEFT, p.TOP);
    p.fill(THEME.legendTitle);
    p.text('SOLUTION BUILT ON FIELD', 6 + pad, 6 + pad);
    items.forEach((t, i) => {
      const y = 6 + pad + 14 + i * lh;
      p.fill(LEGEND_COLOR[t] || THEME.legendFallbackSwatch);
      p.rect(6 + pad, y + 1, 7, 7);
      p.fill(THEME.legendItem);
      p.text(INTERVENTION_LABELS[t] || t, 6 + pad + 13, y);
    });
  }

  /* ---------- p5 instance-mode sketch ---------- */

  const sketch = (p) => {
    p.setup = () => {
      curW = Math.max(1, container.clientWidth);
      curH = Math.max(1, container.clientHeight);
      p.createCanvas(curW, curH);
      p.noSmooth();
      p.pixelDensity(1);
      p.frameRate(30);
      rebuild(p);
    };

    p.draw = () => {
      // transition: fade the field out, swap params at zero, fade back in
      if (fadePhase === 'out') {
        sceneAlpha -= 0.09;
        if (sceneAlpha <= 0) {
          sceneAlpha = 0;
          if (pendingParams) {
            params = pendingParams;
            pendingParams = null;
          }
          rebuild(p);
          fadePhase = 'in';
        }
      } else if (sceneAlpha < 1) {
        sceneAlpha = Math.min(1, sceneAlpha + 0.06);
      }

      p.background(THEME.background);
      drawGrid(p);
      drawPlaza(p);
      drawElevatedDeck(p);
      drawRoads(p);
      drawLaneOverlays(p);
      drawSidewalks(p);
      drawCheckpoint(p);

      signalTick++;
      stepAgents();
      stepWalkers();

      drawAgents(p);
      drawWalkers(p);
      drawSignals(p);
      drawLabels(p);
      drawLegend(p);

      if (sceneAlpha < 1) {
        p.noStroke();
        const [r, g, b] = THEME.backgroundRGB;
        p.fill(r, g, b, (1 - sceneAlpha) * 255);
        p.rect(0, 0, p.width, p.height);
      }
    };

    p.windowResized = () => {
      curW = Math.max(1, container.clientWidth);
      curH = Math.max(1, container.clientHeight);
      p.resizeCanvas(curW, curH);
      rebuild(p);
    };
  };

  const instance = new p5(sketch, container);

  return {
    /** Apply new simulation params with a fade transition. */
    updateParams(next) {
      pendingParams = next;
      fadePhase = 'out';
    },
    /** Stop the draw loop (used when the tab is hidden). */
    pause() {
      instance.noLoop();
    },
    /** Resume the draw loop. */
    resume() {
      instance.loop();
    },
    destroy() {
      instance.remove();
    },
  };
}
