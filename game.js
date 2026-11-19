'use strict';
// ===== Turn Factory =====
// The factory (miners, belts, machines) advances one step per turn.
// The player can build, remove and rotate at any time without spending turns.

// ---------- Constants ----------
const TS = 32;                 // base tile size in px
const RW = 12, RH = 10;        // region size in tiles
const RGX = 5, RGY = 5;        // region grid
const W = RW * RGX, H = RH * RGY;
const START_R = { x: 2, y: 2 };
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // right, down, left, up
const ARROWS = ['→', '↓', '←', '↑'];
const SAVE_KEY = 'turnFactorySave_v1';

const ORES = [null, 'iron_ore', 'copper_ore', 'coal'];
const ORE_COLORS = [null, '#6f86a6', '#c2703d', '#3b3b3b'];

const ITEMS = {
  iron_ore:     { n: 'Iron ore',     c: '#8ea0b8' },
  copper_ore:   { n: 'Copper ore',   c: '#d98c5f' },
  coal:         { n: 'Coal',         c: '#4a4a4a' },
  iron_plate:   { n: 'Iron plate',   c: '#e3e9f0' },
  copper_plate: { n: 'Copper plate', c: '#f5a65b' },
  gear:         { n: 'Gear',         c: '#9fb4c8' },
  circuit:      { n: 'Circuit',      c: '#4cc27a' },
};

const SMELT = { iron_ore: 'iron_plate', copper_ore: 'copper_plate' };
const RECIPES = {
  gear:    { in: { iron_plate: 2 }, out: 'gear' },
  circuit: { in: { iron_plate: 1, copper_plate: 1 }, out: 'circuit' },
};
const RECIPE_ORDER = ['gear', 'circuit'];

const BUILDINGS = {
  conveyor:  { n: 'Conveyor',  key: '1', cost: { iron_plate: 1 }, desc: 'Moves 1 item 1 tile per turn' },
  miner:     { n: 'Miner',     key: '2', cost: { iron_plate: 5 }, desc: 'Place on ore. 1 ore per turn' },
  furnace:   { n: 'Furnace',   key: '3', cost: { iron_plate: 6 }, desc: 'Ore → plate in 2 turns' },
  assembler: { n: 'Assembler', key: '4', cost: { iron_plate: 10, copper_plate: 4 }, desc: 'Plates → gear/circuit. Click to change recipe' },
  depot:     { n: 'Depot',     key: '5', cost: { iron_plate: 8 }, desc: 'Delivers items to inventory, like the HQ' },
};
const TOOLS = ['select', 'conveyor', 'miner', 'furnace', 'assembler', 'depot', 'erase'];

// ---------- Seeded RNG ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- State ----------
let S;            // persistent game state
let ore;          // Uint8Array map of ore (derived from seed)
let grid;         // building lookup by tile index
let nextId = 1;

const ui = {
  tool: 'select', rot: 0, hover: null, selRegion: null,
  cam: { x: 0, y: 0, z: 1 },
  auto: false, speed: 800, lastAuto: 0,
  drag: null, pan: null, keys: {}, log: [],
};

function idx(x, y) { return y * W + x; }
function inBounds(x, y) { return x >= 0 && y >= 0 && x < W && y < H; }
function regionOf(x, y) { return { x: Math.floor(x / RW), y: Math.floor(y / RH) }; }
function rKey(rx, ry) { return rx + ',' + ry; }
function isUnlockedTile(x, y) { const r = regionOf(x, y); return S.unlocked.includes(rKey(r.x, r.y)); }
function hqPos() { return { x: START_R.x * RW + Math.floor(RW / 2), y: START_R.y * RH + Math.floor(RH / 2) }; }

function generateOre(seed) {
  const rng = mulberry32(seed);
  const m = new Uint8Array(W * H);
  const hq = hqPos();
  for (let ry = 0; ry < RGY; ry++) for (let rx = 0; rx < RGX; rx++) {
    const d = Math.abs(rx - START_R.x) + Math.abs(ry - START_R.y);
    let types;
    if (d === 0) types = [1, 1, 2, 3];
    else {
      const n = 2 + Math.floor(rng() * 2);
      types = [];
      for (let i = 0; i < n; i++) {
        const r = rng();
        types.push(r < 0.4 ? 1 : r < 0.75 ? 2 : 3);
      }
    }
    for (const t of types) {
      let cx, cy, tries = 0;
      do {
        cx = rx * RW + 2 + Math.floor(rng() * (RW - 4));
        cy = ry * RH + 2 + Math.floor(rng() * (RH - 4));
        tries++;
      } while (d === 0 && Math.abs(cx - hq.x) + Math.abs(cy - hq.y) < 4 && tries < 50);
      const rad = 1.6 + rng() * 1.6 + d * 0.25;
      for (let y = Math.floor(cy - rad - 1); y <= cy + rad + 1; y++)
        for (let x = Math.floor(cx - rad - 1); x <= cx + rad + 1; x++) {
          if (!inBounds(x, y)) continue;
          if (Math.hypot(x - cx, y - cy) + rng() * 1.2 < rad) m[idx(x, y)] = t;
        }
    }
  }
  // keep the HQ tile clear
  m[idx(hq.x, hq.y)] = 0;
  return m;
}

function newGame(seed) {
  seed = seed ?? Math.floor(Math.random() * 1e9);
  S = {
    seed, turn: 0,
    inv: { iron_plate: 60, copper_plate: 10 },
    unlocked: [rKey(START_R.x, START_R.y)],
    blds: [],
  };
  ore = generateOre(seed);
  grid = new Array(W * H).fill(null);
  nextId = 1;
  const hq = hqPos();
  addBuilding({ type: 'hq', x: hq.x, y: hq.y, dir: 0 });
  centerOn(hq.x, hq.y);
  ui.log = [];
  log('Welcome! Build miners on ore, belt it to the HQ, and unlock new regions.');
  save();
}

function addBuilding(b) {
  b.id = nextId++;
  b.out = b.out || [];
  if (b.type === 'conveyor') b.item = b.item ?? null;
  if (b.type === 'furnace') { b.inp = b.inp || []; b.cur = b.cur ?? null; b.prog = b.prog || 0; }
  if (b.type === 'assembler') { b.recipe = b.recipe || 'gear'; b.inp = b.inp || {}; b.working = b.working || false; b.prog = b.prog || 0; }
  S.blds.push(b);
  grid[idx(b.x, b.y)] = b;
  return b;
}

function removeBuilding(b) {
  S.blds.splice(S.blds.indexOf(b), 1);
  grid[idx(b.x, b.y)] = null;
}

// ---------- Inventory helpers ----------
function canAfford(cost) { return Object.entries(cost).every(([k, v]) => (S.inv[k] || 0) >= v); }
function pay(cost) { for (const [k, v] of Object.entries(cost)) S.inv[k] -= v; }
function refund(cost) { for (const [k, v] of Object.entries(cost)) S.inv[k] = (S.inv[k] || 0) + v; }
function addInv(item, n = 1) { S.inv[item] = (S.inv[item] || 0) + n; }

// ---------- Regions ----------
function regionDist(rx, ry) { return Math.abs(rx - START_R.x) + Math.abs(ry - START_R.y); }
function regionCost(rx, ry) {
  const d = regionDist(rx, ry);
  const base = [
    null,
    { iron_plate: 25, coal: 10 },
    { iron_plate: 40, copper_plate: 30 },
    { gear: 20, copper_plate: 40 },
    { circuit: 15, gear: 30 },
  ][Math.min(d, 4)];
  const mult = 1 + 0.08 * (S.unlocked.length - 1);
  const c = {};
  for (const [k, v] of Object.entries(base)) c[k] = Math.round(v * mult);
  return c;
}
function isUnlockable(rx, ry) {
  if (S.unlocked.includes(rKey(rx, ry))) return false;
  return DIRS.some(([dx, dy]) => S.unlocked.includes(rKey(rx + dx, ry + dy)));
}
function unlockRegion(rx, ry) {
  if (!isUnlockable(rx, ry)) return;
  const cost = regionCost(rx, ry);
  if (!canAfford(cost)) return;
  pay(cost);
  S.unlocked.push(rKey(rx, ry));
  const found = new Set();
  for (let y = ry * RH; y < (ry + 1) * RH; y++) for (let x = rx * RW; x < (rx + 1) * RW; x++)
    if (ore[idx(x, y)]) found.add(ITEMS[ORES[ore[idx(x, y)]]].n);
  log(`Region unlocked! ${found.size ? 'Found: ' + [...found].join(', ') : 'No ore here.'}`);
  if (S.unlocked.length === RGX * RGY) log('Every region unlocked. Your factory spans the whole map!');
  ui.selRegion = null;
  save(); refreshUI();
}

// ---------- Simulation ----------
function front(b) { const [dx, dy] = DIRS[b.dir]; return { x: b.x + dx, y: b.y + dy }; }
function bAt(x, y) { return inBounds(x, y) ? grid[idx(x, y)] : null; }

// Can target building t accept item from source tile src?
function accepts(t, item, src) {
  if (!t) return false;
  switch (t.type) {
    case 'conveyor': {
      if (t.item !== null) return false;
      const f = front(t);
      return !(f.x === src.x && f.y === src.y); // no head-on input
    }
    case 'hq': case 'depot': return true;
    case 'furnace': return !!SMELT[item] && t.inp.length < 4;
    case 'assembler': {
      const need = RECIPES[t.recipe].in[item];
      return !!need && (t.inp[item] || 0) < need * 2;
    }
    default: return false;
  }
}

function give(t, item) {
  switch (t.type) {
    case 'conveyor': t.item = item; t.moved = true; break;
    case 'hq': case 'depot': addInv(item); break;
    case 'furnace': t.inp.push(item); break;
    case 'assembler': t.inp[item] = (t.inp[item] || 0) + 1; break;
  }
}

function tryMove(c) {
  if (c.item === null || c.moved || c.visiting) return;
  c.visiting = true;
  const f = front(c);
  const t = bAt(f.x, f.y);
  if (t && t.type === 'conveyor' && t.item !== null && !t.moved) tryMove(t);
  if (accepts(t, c.item, c)) { const it = c.item; c.item = null; give(t, it); }
  c.visiting = false;
}

function step() {
  S.turn++;
  for (const b of S.blds) { b.moved = false; b.visiting = false; }
  // 1. belts move
  for (const b of S.blds) if (b.type === 'conveyor') tryMove(b);
  // 2. machines push their output to a neighbour
  for (const b of S.blds) {
    if (!b.out || !b.out.length || b.type === 'conveyor') continue;
    for (let k = 0; k < 4; k++) {
      const [dx, dy] = DIRS[(b.dir + k) % 4]; // prefer facing direction
      const t = bAt(b.x + dx, b.y + dy);
      if (t && t.type !== b.type && accepts(t, b.out[0], b)) { give(t, b.out.shift()); break; }
    }
  }
  // 3. machines work
  for (const b of S.blds) {
    if (b.type === 'miner') {
      const o = ore[idx(b.x, b.y)];
      if (o && b.out.length < 3) b.out.push(ORES[o]);
    } else if (b.type === 'furnace') {
      if (b.cur === null && b.inp.length && b.out.length < 3) { b.cur = b.inp.shift(); b.prog = 0; }
      if (b.cur !== null && ++b.prog >= 2) { b.out.push(SMELT[b.cur]); b.cur = null; b.prog = 0; }
    } else if (b.type === 'assembler') {
      const r = RECIPES[b.recipe];
      if (!b.working && b.out.length < 3 && Object.entries(r.in).every(([k, v]) => (b.inp[k] || 0) >= v)) {
        for (const [k, v] of Object.entries(r.in)) b.inp[k] -= v;
        b.working = true; b.prog = 0;
      }
      if (b.working && ++b.prog >= 2) { b.out.push(r.out); b.working = false; b.prog = 0; }
    }
  }
  markDirty();
  refreshUI();
}

// ---------- Building actions (free, never cost a turn) ----------
function canPlace(type, x, y) {
  if (!inBounds(x, y)) return 'Out of bounds';
  if (!isUnlockedTile(x, y)) return 'Region locked';
  const ex = grid[idx(x, y)];
  if (ex && !(ex.type === 'conveyor' && type === 'conveyor')) return 'Occupied';
  if (type === 'miner' && !ore[idx(x, y)]) return 'Needs ore';
  if (!ex && !canAfford(BUILDINGS[type].cost)) return 'Not enough resources';
  return null;
}

function place(type, x, y, dir) {
  if (canPlace(type, x, y)) return false;
  const ex = grid[idx(x, y)];
  if (ex) { ex.dir = dir; markDirty(); return true; } // re-orient existing belt for free
  pay(BUILDINGS[type].cost);
  addBuilding({ type, x, y, dir });
  markDirty();
  refreshUI();
  return true;
}

function erase(x, y) {
  const b = bAt(x, y);
  if (!b || b.type === 'hq') return;
  refund(BUILDINGS[b.type].cost);
  // return held items to inventory so nothing is lost
  if (b.item) addInv(b.item);
  (b.out || []).forEach(i => addInv(i));
  if (b.type === 'furnace') { b.inp.forEach(i => addInv(i)); if (b.cur) addInv(b.cur); }
  if (b.type === 'assembler') for (const [k, v] of Object.entries(b.inp)) addInv(k, v);
  removeBuilding(b);
  markDirty();
  refreshUI();
}

function cycleRecipe(b) {
  for (const [k, v] of Object.entries(b.inp)) addInv(k, v);
  b.inp = {}; b.working = false; b.prog = 0;
  b.recipe = RECIPE_ORDER[(RECIPE_ORDER.indexOf(b.recipe) + 1) % RECIPE_ORDER.length];
  log(`Assembler now makes ${ITEMS[RECIPES[b.recipe].out].n}.`);
  markDirty();
  refreshUI();
}

// ---------- Save / load ----------
// Saves shortly after every change, and immediately whenever the page is
// hidden, closed or reloaded, so leaving never loses progress.
let saveTimer = null;
function markDirty() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}
function save() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!S) return;
  try {
    const blds = S.blds.map(({ moved, visiting, ...rest }) => rest);
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...S, blds, cam: ui.cam, rot: ui.rot }));
  } catch (e) { /* storage unavailable */ }
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    S = { seed: d.seed, turn: d.turn, inv: d.inv, unlocked: d.unlocked, blds: [] };
    ore = generateOre(S.seed);
    grid = new Array(W * H).fill(null);
    nextId = 1;
    for (const b of d.blds) addBuilding(b);
    if (d.cam) Object.assign(ui.cam, d.cam);
    else { const hq = hqPos(); centerOn(hq.x, hq.y); }
    if (d.rot != null) ui.rot = d.rot;
    log('Save loaded.');
    return true;
  } catch (e) { return false; }
}

// ---------- Rendering ----------
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
let vw = 0, vh = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  // keep the world point at the centre of the view fixed while resizing
  if (vw && vh) {
    ui.cam.x += (vw - canvas.clientWidth) / 2 / ui.cam.z;
    ui.cam.y += (vh - canvas.clientHeight) / 2 / ui.cam.z;
  }
  vw = canvas.clientWidth; vh = canvas.clientHeight;
  canvas.width = vw * dpr; canvas.height = vh * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);

function centerOn(tx, ty) {
  ui.cam.x = (tx + 0.5) * TS - (canvas.clientWidth / 2) / ui.cam.z;
  ui.cam.y = (ty + 0.5) * TS - (canvas.clientHeight / 2) / ui.cam.z;
}
function toScreen(tx, ty) { return { x: (tx * TS - ui.cam.x) * ui.cam.z, y: (ty * TS - ui.cam.y) * ui.cam.z }; }
function toTile(sx, sy) { return { x: Math.floor((sx / ui.cam.z + ui.cam.x) / TS), y: Math.floor((sy / ui.cam.z + ui.cam.y) / TS) }; }

function drawItem(item, cx, cy, r) {
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = ITEMS[item].c; ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.25); ctx.strokeStyle = '#000b'; ctx.stroke();
  if (item === 'gear' || item === 'circuit') {
    ctx.fillStyle = '#000a';
    ctx.font = `bold ${r * 1.2}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(item === 'gear' ? 'G' : 'C', cx, cy + 0.5);
  }
}

function drawArrow(cx, cy, r, dir, color) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(dir * Math.PI / 2);
  ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.5, -r * 0.7); ctx.lineTo(-r * 0.5, r * 0.7); ctx.closePath();
  ctx.fillStyle = color; ctx.fill(); ctx.restore();
}

function drawBuilding(b, x, y, s, alpha = 1) {
  ctx.globalAlpha = alpha;
  const cx = x + s / 2, cy = y + s / 2, p = s * 0.08;
  const box = (fill, stroke) => {
    ctx.fillStyle = fill; ctx.fillRect(x + p, y + p, s - 2 * p, s - 2 * p);
    ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, s * 0.06); ctx.strokeRect(x + p, y + p, s - 2 * p, s - 2 * p);
  };
  const label = (t, col = '#fff') => {
    ctx.fillStyle = col; ctx.font = `bold ${s * 0.32}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, cx, cy);
  };
  switch (b.type) {
    case 'conveyor':
      ctx.fillStyle = '#3a3f47'; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
      ctx.strokeStyle = '#555c66'; ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        const o = (i + 0.5) * s / 2;
        ctx.beginPath();
        if (b.dir % 2 === 0) { ctx.moveTo(x + o, y + 3); ctx.lineTo(x + o, y + s - 3); }
        else { ctx.moveTo(x + 3, y + o); ctx.lineTo(x + s - 3, y + o); }
        ctx.stroke();
      }
      drawArrow(cx, cy, s * 0.28, b.dir, '#7d8794');
      if (b.item) drawItem(b.item, cx, cy, s * 0.2);
      break;
    case 'miner': {
      const o = ore[idx(b.x, b.y)];
      box('#4b5563', ORE_COLORS[o] || '#888');
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = ORE_COLORS[o] || '#888'; ctx.fill();
      label('M');
      drawArrow(cx + DIRS[b.dir][0] * s * 0.36, cy + DIRS[b.dir][1] * s * 0.36, s * 0.1, b.dir, '#ffd76a');
      break;
    }
    case 'furnace':
      box('#6b3a24', '#c96a33');
      label('F', '#ffcf9a');
      if (b.cur) { ctx.fillStyle = '#ff9d3a'; ctx.fillRect(x + p * 2, y + s - p * 3, (s - p * 4) * (b.prog / 2), p); }
      drawArrow(cx + DIRS[b.dir][0] * s * 0.36, cy + DIRS[b.dir][1] * s * 0.36, s * 0.1, b.dir, '#ffd76a');
      break;
    case 'assembler':
      box('#24426b', '#4a86d9');
      label(b.recipe === 'gear' ? 'A:G' : 'A:C', '#cfe2ff');
      if (b.working) { ctx.fillStyle = '#7fb6ff'; ctx.fillRect(x + p * 2, y + s - p * 3, (s - p * 4) * (b.prog / 2), p); }
      drawArrow(cx + DIRS[b.dir][0] * s * 0.36, cy + DIRS[b.dir][1] * s * 0.36, s * 0.1, b.dir, '#ffd76a');
      break;
    case 'depot':
      box('#1f5c55', '#46c2b0'); label('D', '#c8fff6'); break;
    case 'hq':
      box('#6b5a1f', '#f0c040'); label('HQ', '#fff3c4'); break;
  }
  // output buffer pips
  if (b.out && b.out.length && b.type !== 'conveyor') {
    b.out.forEach((it, i) => drawItem(it, x + s * 0.2 + i * s * 0.2, y + s * 0.2, s * 0.08));
  }
  ctx.globalAlpha = 1;
}

function draw() {
  ctx.fillStyle = '#0d0f12'; ctx.fillRect(0, 0, vw, vh);
  const s = TS * ui.cam.z;
  const t0 = toTile(0, 0), t1 = toTile(vw, vh);
  const x0 = Math.max(0, t0.x), y0 = Math.max(0, t0.y), x1 = Math.min(W - 1, t1.x), y1 = Math.min(H - 1, t1.y);

  // ground + ore
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const p = toScreen(x, y);
    if (!isUnlockedTile(x, y)) { ctx.fillStyle = '#16191d'; ctx.fillRect(p.x, p.y, s + 0.5, s + 0.5); continue; }
    ctx.fillStyle = (x + y) % 2 ? '#262b22' : '#292e25';
    ctx.fillRect(p.x, p.y, s + 0.5, s + 0.5);
    const o = ore[idx(x, y)];
    if (o) {
      ctx.fillStyle = ORE_COLORS[o];
      ctx.globalAlpha = 0.75; ctx.fillRect(p.x + 1, p.y + 1, s - 2, s - 2); ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff30';
      ctx.fillRect(p.x + s * 0.2, p.y + s * 0.25, s * 0.15, s * 0.15);
      ctx.fillRect(p.x + s * 0.6, p.y + s * 0.55, s * 0.18, s * 0.18);
    }
  }

  // buildings
  for (const b of S.blds) {
    if (b.x < x0 - 1 || b.x > x1 + 1 || b.y < y0 - 1 || b.y > y1 + 1) continue;
    const p = toScreen(b.x, b.y);
    drawBuilding(b, p.x, p.y, s);
  }

  // region overlays
  for (let ry = 0; ry < RGY; ry++) for (let rx = 0; rx < RGX; rx++) {
    const p = toScreen(rx * RW, ry * RH);
    const w = RW * s, h = RH * s;
    if (p.x > vw || p.y > vh || p.x + w < 0 || p.y + h < 0) continue;
    const unlocked = S.unlocked.includes(rKey(rx, ry));
    const sel = ui.selRegion && ui.selRegion.x === rx && ui.selRegion.y === ry;
    ctx.lineWidth = sel ? 3 : 1;
    if (unlocked) {
      ctx.strokeStyle = '#ffffff14'; ctx.strokeRect(p.x, p.y, w, h);
      continue;
    }
    const can = isUnlockable(rx, ry);
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = sel ? '#f0c040' : can ? '#6fa8ff' : '#333a44';
    ctx.strokeRect(p.x + 2, p.y + 2, w - 4, h - 4);
    ctx.setLineDash([]);
    if (!can) continue;
    const cost = regionCost(rx, ry);
    const affordable = canAfford(cost);
    const fs = Math.max(10, Math.min(18, s * 0.5));
    ctx.font = `bold ${fs}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = affordable ? '#8ae98a' : '#9fb3c8';
    ctx.fillText(affordable ? 'Ready to unlock' : 'Locked region', p.x + w / 2, p.y + h / 2 - fs * 1.2);
    let line = 0;
    for (const [k, v] of Object.entries(cost)) {
      ctx.font = `${fs * 0.85}px sans-serif`;
      ctx.fillStyle = (S.inv[k] || 0) >= v ? '#8ae98a' : '#c9d3de';
      ctx.fillText(`${ITEMS[k].n}: ${Math.min(S.inv[k] || 0, v)}/${v}`, p.x + w / 2, p.y + h / 2 + line * fs * 1.1);
      line++;
    }
  }

  // hover ghost
  const hv = ui.hover;
  if (hv && inBounds(hv.x, hv.y)) {
    const p = toScreen(hv.x, hv.y);
    if (BUILDINGS[ui.tool]) {
      const err = canPlace(ui.tool, hv.x, hv.y);
      drawBuilding({ type: ui.tool, x: hv.x, y: hv.y, dir: ui.rot, out: [], item: null, recipe: 'gear' }, p.x, p.y, s, 0.55);
      ctx.strokeStyle = err ? '#ff5252' : '#8ae98a';
    } else if (ui.tool === 'erase') ctx.strokeStyle = '#ff5252';
    else ctx.strokeStyle = '#ffffffaa';
    ctx.lineWidth = 2; ctx.strokeRect(p.x + 1, p.y + 1, s - 2, s - 2);
  }
}

// ---------- UI ----------
const $ = id => document.getElementById(id);
function itemDot(k) { return `<span class="item" style="background:${ITEMS[k].c}"></span>`; }
function costText(cost) { return Object.entries(cost).map(([k, v]) => `${v} ${ITEMS[k].n.toLowerCase()}`).join(', '); }

function log(msg) {
  ui.log.unshift(`T${S ? S.turn : 0}: ${msg}`);
  ui.log.length = Math.min(ui.log.length, 10);
  const el = $('log'); if (el) el.innerHTML = ui.log.map(l => `<div>${l}</div>`).join('');
}

function buildPalette() {
  const el = $('palette');
  el.innerHTML = '';
  const mk = (tool, title, sub) => {
    const b = document.createElement('button');
    b.dataset.tool = tool;
    b.innerHTML = `${title}<span class="cost">${sub}</span>`;
    b.onclick = () => setTool(tool);
    el.appendChild(b);
  };
  mk('select', '[Q] Select', 'Inspect / configure');
  for (const [k, d] of Object.entries(BUILDINGS)) mk(k, `[${d.key}] ${d.n}`, costText(d.cost));
  mk('erase', '[X] Remove', 'Full refund');
}

function setTool(t) {
  ui.tool = t;
  document.querySelectorAll('#palette button').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  refreshInfo();
}

function refreshUI() {
  $('turn').textContent = S.turn;
  $('regcount').textContent = S.unlocked.length;
  $('rot').textContent = ARROWS[ui.rot];
  const keys = Object.keys(ITEMS).filter(k => (S.inv[k] || 0) > 0);
  $('inv').innerHTML = keys.length ? keys.map(k => `<div><span>${itemDot(k)}${ITEMS[k].n}</span><b>${S.inv[k]}</b></div>`).join('') : '<span class="small">Empty</span>';
  document.querySelectorAll('#palette button').forEach(b => {
    const d = BUILDINGS[b.dataset.tool];
    b.disabled = !!d && !canAfford(d.cost);
  });
  refreshRegion();
  refreshInfo();
}

function refreshRegion() {
  const el = $('region');
  const r = ui.selRegion;
  if (!r) { el.innerHTML = 'Click a locked region (blue dashed border) to see its unlock cost.'; return; }
  if (!isUnlockable(r.x, r.y)) { el.innerHTML = 'This region is not adjacent to your territory yet. Unlock a neighbouring region first.'; return; }
  const cost = regionCost(r.x, r.y);
  const rows = Object.entries(cost).map(([k, v]) => {
    const have = S.inv[k] || 0;
    return `<div>${itemDot(k)}${ITEMS[k].n}: <span class="${have >= v ? 'have' : 'need'}">${have}/${v}</span></div>`;
  }).join('');
  el.innerHTML = `<div>Deliver items to the HQ or a Depot, then spend them here.</div>${rows}
    <div class="row" style="margin-top:6px"><button id="unlockBtn" class="primary" ${canAfford(cost) ? '' : 'disabled'}>Unlock region</button></div>`;
  $('unlockBtn').onclick = () => unlockRegion(r.x, r.y);
}

function refreshInfo() {
  const el = $('info');
  const h = ui.hover;
  let html = '';
  if (BUILDINGS[ui.tool]) html += `<div><b>${BUILDINGS[ui.tool].n}</b>: ${BUILDINGS[ui.tool].desc}</div>`;
  if (h && inBounds(h.x, h.y)) {
    if (!isUnlockedTile(h.x, h.y)) html += '<div>Locked region.</div>';
    else {
      const o = ore[idx(h.x, h.y)];
      html += `<div>Tile (${h.x}, ${h.y})${o ? ' · ' + ITEMS[ORES[o]].n + ' deposit' : ''}</div>`;
      const b = bAt(h.x, h.y);
      if (b) {
        const name = b.type === 'hq' ? 'HQ' : BUILDINGS[b.type].n;
        html += `<div><b>${name}</b> facing ${ARROWS[b.dir]}</div>`;
        if (b.type === 'conveyor') html += `<div>Carrying: ${b.item ? ITEMS[b.item].n : 'nothing'}</div>`;
        if (b.type === 'furnace') html += `<div>Input: ${b.inp.length} · Smelting: ${b.cur ? ITEMS[b.cur].n + ' (' + b.prog + '/2)' : 'idle'}</div>`;
        if (b.type === 'assembler') {
          const r = RECIPES[b.recipe];
          html += `<div>Recipe: ${Object.entries(r.in).map(([k, v]) => v + ' ' + ITEMS[k].n).join(' + ')} → ${ITEMS[r.out].n}</div>`;
          html += `<div>Buffer: ${Object.entries(r.in).map(([k]) => ITEMS[k].n + ' ' + (b.inp[k] || 0)).join(', ')}${b.working ? ' · working ' + b.prog + '/2' : ''}</div>`;
          html += '<div><i>Click with Select tool to change recipe.</i></div>';
        }
        if (b.out && b.out.length && b.type !== 'conveyor') html += `<div>Output waiting: ${b.out.length}</div>`;
        if (b.type === 'hq' || b.type === 'depot') html += '<div>Items delivered here go to your inventory.</div>';
      }
    }
  }
  el.innerHTML = html || 'Hover a tile.';
}

function toggleAuto() {
  ui.auto = !ui.auto;
  ui.lastAuto = performance.now();
  $('auto').textContent = `Auto: ${ui.auto ? 'On' : 'Off'} (P)`;
}

// ---------- Input ----------
function mouseTile(e) {
  const r = canvas.getBoundingClientRect();
  return toTile(e.clientX - r.left, e.clientY - r.top);
}

function primaryAction(t) {
  if (!inBounds(t.x, t.y)) return;
  if (!isUnlockedTile(t.x, t.y)) { ui.selRegion = regionOf(t.x, t.y); refreshRegion(); return; }
  if (ui.tool === 'erase') { erase(t.x, t.y); return; }
  if (ui.tool === 'select') {
    const b = bAt(t.x, t.y);
    if (b && b.type === 'assembler') cycleRecipe(b);
    return;
  }
  const err = canPlace(ui.tool, t.x, t.y);
  if (err) { if (err !== 'Occupied') log(`Can't place: ${err}.`); return; }
  place(ui.tool, t.x, t.y, ui.rot);
}

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  const t = mouseTile(e);
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
    ui.pan = { sx: e.clientX, sy: e.clientY, cx: ui.cam.x, cy: ui.cam.y };
    e.preventDefault(); return;
  }
  if (e.button === 2) { erase(t.x, t.y); ui.drag = { mode: 'erase', last: t }; return; }
  if (e.button === 0) { primaryAction(t); ui.drag = { mode: 'place', last: t }; }
});
window.addEventListener('mouseup', () => { ui.drag = null; ui.pan = null; });
canvas.addEventListener('mouseleave', () => { ui.hover = null; refreshInfo(); });
canvas.addEventListener('mousemove', e => {
  if (ui.pan) {
    ui.cam.x = ui.pan.cx - (e.clientX - ui.pan.sx) / ui.cam.z;
    ui.cam.y = ui.pan.cy - (e.clientY - ui.pan.sy) / ui.cam.z;
    return;
  }
  const t = mouseTile(e);
  if (!ui.hover || ui.hover.x !== t.x || ui.hover.y !== t.y) { ui.hover = t; refreshInfo(); }
  const d = ui.drag;
  if (!d || (d.last.x === t.x && d.last.y === t.y)) return;
  if (d.mode === 'erase') erase(t.x, t.y);
  else if (BUILDINGS[ui.tool] || ui.tool === 'erase') {
    // drag-painting belts: orient them along the drag path
    const dx = t.x - d.last.x, dy = t.y - d.last.y;
    if (ui.tool === 'conveyor' && Math.abs(dx) + Math.abs(dy) === 1) {
      const dir = DIRS.findIndex(([a, b]) => a === dx && b === dy);
      const prev = bAt(d.last.x, d.last.y);
      if (prev && prev.type === 'conveyor') prev.dir = dir;
      ui.rot = dir; $('rot').textContent = ARROWS[ui.rot];
    }
    if (ui.tool === 'erase') erase(t.x, t.y);
    else if (isUnlockedTile(t.x, t.y) || !inBounds(t.x, t.y)) place(ui.tool, t.x, t.y, ui.rot);
  }
  d.last = t;
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  const wx = sx / ui.cam.z + ui.cam.x, wy = sy / ui.cam.z + ui.cam.y;
  ui.cam.z = Math.min(3, Math.max(0.3, ui.cam.z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  ui.cam.x = wx - sx / ui.cam.z; ui.cam.y = wy - sy / ui.cam.z;
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  ui.keys[k] = true;
  if (k === ' ') { e.preventDefault(); step(); }
  else if (k === 'r') { ui.rot = (ui.rot + (e.shiftKey ? 3 : 1)) % 4; $('rot').textContent = ARROWS[ui.rot]; }
  else if (k === 'p') toggleAuto();
  else if (k === 'q' || k === 'escape') setTool('select');
  else if (k === 'x') setTool('erase');
  else if (k === 'h') { const hq = hqPos(); centerOn(hq.x, hq.y); }
  else {
    const t = Object.entries(BUILDINGS).find(([, d]) => d.key === k);
    if (t) setTool(t[0]);
  }
});
window.addEventListener('keyup', e => { ui.keys[e.key.toLowerCase()] = false; });

$('next').onclick = () => step();
$('auto').onclick = () => toggleAuto();
$('speed').onchange = e => { ui.speed = +e.target.value; e.target.blur(); };
$('reset').onclick = () => {
  if (confirm('Start a new game? Your current factory will be lost.')) { newGame(); refreshUI(); }
};
window.addEventListener('beforeunload', save);
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

// ---------- Main loop ----------
let lastFrame = performance.now();
function frame(now) {
  const dt = (now - lastFrame) / 1000; lastFrame = now;
  const panSpeed = 600 / ui.cam.z * dt;
  if (ui.keys['w'] || ui.keys['arrowup']) ui.cam.y -= panSpeed;
  if (ui.keys['s'] || ui.keys['arrowdown']) ui.cam.y += panSpeed;
  if (ui.keys['a'] || ui.keys['arrowleft']) ui.cam.x -= panSpeed;
  if (ui.keys['d'] || ui.keys['arrowright']) ui.cam.x += panSpeed;
  if (ui.auto && now - ui.lastAuto >= ui.speed) { ui.lastAuto = now; step(); }
  draw();
  requestAnimationFrame(frame);
}

// ---------- Boot ----------
resize();
buildPalette();
if (!load()) newGame();
setTool('select');
refreshUI();
requestAnimationFrame(frame);
