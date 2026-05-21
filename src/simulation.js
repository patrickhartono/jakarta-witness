/* simulation.js — the BOTTOM section: a p5.js (instance mode) 2D rendering
 * of the AI's reduced mental model of Jakarta. Vintage-game / schematic
 * aesthetic: black field, faint grid, colored rectangles, stepped
 * pixel-aligned movement, no collision resolution (overlap is intentional).
 *
 * createSimulation(container) -> { updateParams, pause, resume, destroy } */

import p5 from 'p5';
import { DEFAULT_PARAMS } from './parse.js';

const COLORS = {
  car: '#74c4d4',
  motorbike: '#d4a574',
  bus: '#d474c4',
  pedestrian: '#e8e8e8',
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

export function createSimulation(container) {
  let params = structuredClone(DEFAULT_PARAMS);
  let pendingParams = null;
  let roads = [];
  let agents = [];
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

  function pickClass(dist) {
    const entries = [
      ['car', dist.car],
      ['motorbike', dist.motorbike],
      ['bus', dist.bus],
      ['pedestrian', dist.pedestrian],
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

  function buildAgents(W, H) {
    const count = DENSITY_COUNT[params.total_density] ?? 26;
    const base = SPEED[params.flow_speed] ?? 1.15;
    const list = [];

    for (let i = 0; i < count; i++) {
      const cls = pickClass(params.vehicle_distribution);
      const spec = CLASS_SPEC[cls];
      // Vehicles ride a road; pedestrians (and everything in a zone with no
      // roads) free-wander across the field.
      const onRoad = roads.length > 0 && cls !== 'pedestrian';

      if (onRoad) {
        const road = roads[(Math.random() * roads.length) | 0];
        const horiz = road.axis === 'h';
        const dir = Math.random() < 0.5 ? 1 : -1;
        const len = horiz ? road.w : road.h;
        const thickness = horiz ? road.h : road.w;
        const lane =
          (horiz ? road.y : road.x) +
          4 +
          Math.random() * Math.max(2, thickness - spec.wid - 8);
        list.push({
          cls,
          color: COLORS[cls],
          onRoad: true,
          horiz,
          dir,
          along: Math.random() * len,
          lane,
          roadStart: horiz ? road.x : road.y,
          roadLen: len,
          w: horiz ? spec.len : spec.wid,
          h: horiz ? spec.wid : spec.len,
          speed: base * spec.mul,
          acc: Math.random(),
        });
      } else {
        list.push({
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
        });
      }
    }
    return list;
  }

  function rebuild(p) {
    roads = buildRoads(p.width, p.height);
    agents = buildAgents(p.width, p.height);
  }

  /* ---------- per-frame updates ---------- */

  function stepAgents(p) {
    for (const a of agents) {
      if (a.onRoad) {
        a.acc += a.speed;
        while (a.acc >= 1) {
          a.along += a.dir;
          a.acc -= 1;
        }
        // wrap around the road with a margin so vehicles re-enter cleanly
        const margin = 40;
        if (a.along > a.roadLen + margin) a.along = -margin;
        if (a.along < -margin) a.along = a.roadLen + margin;
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
        if (a.x < 0) a.x = p.width;
        if (a.x > p.width) a.x = 0;
        if (a.y < 0) a.y = p.height;
        if (a.y > p.height) a.y = 0;
      }
    }
  }

  /* ---------- drawing ---------- */

  function drawGrid(p) {
    p.stroke('#1a1a1a');
    p.strokeWeight(1);
    for (let x = 0; x < p.width; x += 24) p.line(x, 0, x, p.height);
    for (let y = 0; y < p.height; y += 24) p.line(0, y, p.width, y);
  }

  function drawRoads(p) {
    for (const r of roads) {
      p.noStroke();
      p.fill('#141414');
      p.rect(r.x | 0, r.y | 0, r.w | 0, r.h | 0);
      p.stroke(r.elevated ? '#6a6a6a' : '#444444');
      p.strokeWeight(1);
      p.noFill();
      p.rect(r.x | 0, r.y | 0, r.w | 0, r.h | 0);
      // dashed centerline
      p.stroke('#444444');
      if (r.axis === 'h') {
        const cy = (r.y + r.h / 2) | 0;
        for (let x = 0; x < r.w; x += 22) p.line(x, cy, x + 11, cy);
      } else {
        const cx = (r.x + r.w / 2) | 0;
        for (let y = 0; y < r.h; y += 22) p.line(cx, y, cx, y + 11);
      }
      // an elevated road casts a thin support shadow line below itself
      if (r.elevated) {
        p.stroke('#222222');
        p.line(r.x, (r.y + r.h + 6) | 0, r.x + r.w, (r.y + r.h + 6) | 0);
      }
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
      p.stroke('#0a0a0a');
      p.rect(x, y, a.w, a.h);
    }
  }

  /* ---------- p5 instance-mode sketch ---------- */

  const sketch = (p) => {
    p.setup = () => {
      p.createCanvas(
        Math.max(1, container.clientWidth),
        Math.max(1, container.clientHeight),
      );
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

      p.background('#0a0a0a');
      drawGrid(p);
      drawRoads(p);
      stepAgents(p);
      drawAgents(p);

      if (sceneAlpha < 1) {
        p.noStroke();
        p.fill(10, 10, 10, (1 - sceneAlpha) * 255);
        p.rect(0, 0, p.width, p.height);
      }
    };

    p.windowResized = () => {
      p.resizeCanvas(
        Math.max(1, container.clientWidth),
        Math.max(1, container.clientHeight),
      );
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
