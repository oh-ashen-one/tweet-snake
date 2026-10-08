// Entry point: connects, auto-joins (no menu: open the embed and you're
// playing), and renders interpolated server state every frame.

import { SKINS, SPACING, WORLD_R, foodRadius, lengthOf, radiusOf, viewHalfOf } from "../shared/rules";
import { Hud } from "./hud";
import { Input } from "./input";
import { Net } from "./net";
import { KIND_BODY, KIND_FLAT, KIND_FOOD, KIND_GLOW, Renderer } from "./render";
import { applyTick, resetWorld, state, type CSnake } from "./state";
import { SponsorPanel, parseSponsorConfig } from "./sponsor";
import { UI } from "./ui";

type RGB = [number, number, number];

const body = document.body;
const room = body.dataset.room || "main";
const embed = body.dataset.embed === "1" || window.self !== window.top;

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    // storage blocked
  }
}

// "Full screen" passes the chosen name along in the URL hash.
const hashName = location.hash.match(/(?:^#|&)name=([^&]+)/);
if (hashName) {
  save("snek.name", decodeURIComponent(hashName[1]));
  history.replaceState(null, "", location.pathname + location.search);
}
let myChosenName = load("snek.name") || "";
let guest = load("snek.guest");
if (!guest) {
  guest = String(1000 + Math.floor(Math.random() * 9000));
  save("snek.guest", guest);
}
const savedSkin = Number(load("snek.skin"));
const skin = Number.isInteger(savedSkin) && load("snek.skin") !== null
  ? savedSkin % SKINS.length
  : Math.floor(Math.random() * SKINS.length);

const glc = document.getElementById("gl") as HTMLCanvasElement;
const hudc = document.getElementById("hud") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui") as HTMLElement;

let renderer: Renderer;
try {
  renderer = new Renderer(glc);
} catch {
  const f = document.createElement("div");
  f.className = "fatal";
  f.textContent = "This game needs WebGL2. Try opening it in Chrome or Safari.";
  document.body.append(f);
  throw new Error("no webgl2");
}

const hud = new Hud(hudc);
const input = new Input(glc);
const sponsorCfg = parseSponsorConfig(body.dataset.sponsor);
const ui = new UI(uiRoot, { embed, sponsorOn: !!sponsorCfg, skin, customName: !!myChosenName });
const sponsorPanel = sponsorCfg ? new SponsorPanel(uiRoot, sponsorCfg, room) : null;
ui.onSponsor = () => void sponsorPanel?.show();
ui.shareUrl = `${location.origin}/r/${room}`;

const net = new Net(room);
// #shot: spectate only with no UI, for capturing the preview card image.
const shot = location.hash === "#shot";
if (shot) document.body.classList.add("shot");
let playing = false;
let wantJoin = !shot;
let myName = "";
let W = 1, H = 1, DPR = 1;

function join(): void {
  net.send({ t: "join", name: myChosenName, guest, skin: ui.skin, aspect: W / H });
  wantJoin = false;
}

net.onOpen = () => {
  resetWorld();
  if (wantJoin || playing) {
    playing = false;
    join();
  }
};
net.onClose = () => {
  if (playing) wantJoin = true;
};
net.onTick = (buf) => {
  applyTick(buf, performance.now());
  if (state.myId && !playing) {
    playing = true;
    ui.hideDeath();
  }
};
net.onJson = (m) => {
  switch (m.t) {
    case "hello":
      ui.setSponsors(m.sponsors);
      break;
    case "you":
      myName = m.name;
      ui.setName(m.name);
      break;
    case "lb":
      ui.setBoard(m);
      hud.top = m.top;
      hud.rank = m.rank;
      hud.count = m.count;
      break;
    case "kill":
      hud.addFeed(m.k, m.v, m.m, myName);
      break;
    case "dead":
      playing = false;
      if (input.touched) ui.showDeath(m);
      else setTimeout(join, 1200);
      break;
    case "sponsors":
      ui.setSponsors(m.list);
      break;
    case "full":
      ui.toast("This arena is full, try again in a moment");
      break;
  }
};

ui.onRespawn = () => {
  ui.hideDeath();
  join();
};
ui.onSkin = (s) => save("snek.skin", String(s));
ui.onBoost = (on) => (input.buttonBoost = on);
ui.onName = (name) => {
  myChosenName = name;
  save("snek.name", name);
  net.send({ t: "name", name, guest });
};
ui.onNewTab = () => {
  const hash = myChosenName ? `#name=${encodeURIComponent(myChosenName)}` : "";
  window.open(`${location.origin}/r/${room}${hash}`, "_blank", "noopener");
};

glc.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "mouse") ui.showTouch(true);
});

function resize(): void {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  glc.width = Math.round(W * DPR);
  glc.height = Math.round(H * DPR);
  renderer.resize(glc.width, glc.height);
  hud.resize(W, H, DPR);
  net.send({ t: "view", aspect: W / H });
}
window.addEventListener("resize", resize);
resize();
net.connect();

function hsv(h: number, s: number, v: number): RGB {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return ([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]] as RGB[])[i % 6];
}

const FOOD_COLORS: RGB[] = Array.from({ length: 256 }, (_, hue) => {
  if (hue >= 200) {
    const c = SKINS[(hue - 200) % SKINS.length][0];
    return [Math.min(1, c[0] * 1.1 + 0.1), Math.min(1, c[1] * 1.1 + 0.1), Math.min(1, c[2] * 1.1 + 0.1)];
  }
  return hsv(hue / 200, 0.72, 1);
});

const STRIPES: RGB[] = SKINS.map(([a, b]) => [a[0] * 0.7 + b[0] * 0.3, a[1] * 0.7 + b[1] * 0.3, a[2] * 0.7 + b[2] * 0.3]);

const heads = new Map<number, [number, number]>();
let camX = 0, camY = 0, scaleCss = 0.6, last = performance.now();

function drawSnake(s: CSnake, alpha: number, isMe: boolean): void {
  const r = radiusOf(s.mass);
  const c1 = SKINS[s.skin % SKINS.length][0];
  const c2 = STRIPES[s.skin % SKINS.length];
  const p = s.pts;
  const n = p.length / 2;
  const [hx, hy] = heads.get(s.id)!;
  const d0 = Math.hypot(s.hx - p[n * 2 - 2], s.hy - p[n * 2 - 1]);
  const s0 = (1 - alpha) * Math.hypot(s.hx - s.px, s.hy - s.py);
  const L = lengthOf(s.mass);
  const stride = r > 16 ? 2 : 1;
  const op = s.shield ? 0.45 + 0.25 * Math.sin(performance.now() * 0.012) : 1;
  if (isMe) renderer.push(hx, hy, r * 4.5, KIND_GLOW, 1, 1, 1, 0.16);

  if (s.boost) {
    for (let i = n - 1; i >= 0; i -= 3) {
      const di = d0 + (n - 1 - i) * SPACING;
      if (di < s0 || di > s0 + L) continue;
      renderer.push(p[i * 2], p[i * 2 + 1], r * 2.6, KIND_GLOW, c1[0], c1[1], c1[2], 0.22);
    }
  }

  for (let i = 0; i < n; i++) {
    if ((s.base + i) % stride) continue;
    const di = d0 + (n - 1 - i) * SPACING;
    if (di < s0 + r * 0.25 || di > s0 + L) continue;
    const t = (di - s0) / L;
    const taper = t > 0.8 ? 1 - ((t - 0.8) / 0.2) * 0.45 : 1;
    const c = Math.floor((s.base + i) / 6) & 1 ? c2 : c1;
    renderer.push(p[i * 2], p[i * 2 + 1], r * taper, KIND_BODY, c[0], c[1], c[2], op);
  }
  renderer.push(hx, hy, r * 1.05, KIND_BODY, c1[0], c1[1], c1[2], op);

  const fx = Math.cos(s.dir), fy = Math.sin(s.dir);
  const look = isMe ? input.angle : s.dir;
  for (const side of [-1, 1]) {
    const ex = hx + fx * r * 0.3 - fy * side * r * 0.45;
    const ey = hy + fy * r * 0.3 + fx * side * r * 0.45;
    renderer.push(ex, ey, r * 0.36, KIND_FLAT, 1, 1, 1, 1);
    renderer.push(ex + Math.cos(look) * r * 0.13, ey + Math.sin(look) * r * 0.13, r * 0.2, KIND_FLAT, 0.07, 0.07, 0.1, 1);
  }
}

let lastError = "";
let menuWasOpen = false;

function frame(): void {
  // Card capture can hold the current frame (shot mode only).
  if (shot && (window as unknown as { __freeze?: boolean }).__freeze) {
    requestAnimationFrame(frame);
    return;
  }
  try {
    draw();
  } catch (e) {
    const msg = String((e as Error)?.stack || e);
    if (msg !== lastError) console.error(msg);
    lastError = msg;
    (window as unknown as { __snekError: string }).__snekError = msg;
  }
  requestAnimationFrame(frame);
}

function draw(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  input.update(dt);
  // While the name editor or sponsor panel is open, the server autopilots
  // the snake; steering resumes (and takes over) once the menu closes.
  const menuOpen = ui.editing || !!sponsorPanel?.open;
  if (menuOpen && !menuWasOpen && playing) net.send({ t: "auto" });
  menuWasOpen = menuOpen;
  if (playing && input.touched && !menuOpen) net.input(input.angle, input.boost, now);
  ui.showHint(playing && !input.touched && !ui.editing && !sponsorPanel?.open);

  const alpha = state.lastAt ? Math.min(1, (now - state.lastAt) / state.interval) : 1;
  heads.clear();
  for (const s of state.snakes.values()) {
    heads.set(s.id, [s.px + (s.hx - s.px) * alpha, s.py + (s.hy - s.py) * alpha]);
  }

  const me = playing ? state.snakes.get(state.myId) : undefined;
  if (me) {
    [camX, camY] = heads.get(me.id)!;
  } else {
    const k = 1 - Math.exp(-dt * 5);
    camX += (state.camX - camX) * k;
    camY += (state.camY - camY) * k;
  }
  const focusMass = me ? me.mass : shot ? 140 : hud.top[0]?.m ?? 200;
  const targetScale = Math.min(W, H) / 2 / viewHalfOf(focusMass);
  scaleCss += (targetScale - scaleCss) * (1 - Math.exp(-dt * 3));
  const scale = scaleCss * DPR;

  const halfW = W / 2 / scaleCss + 40;
  const halfH = H / 2 / scaleCss + 40;
  renderer.begin();

  const visible = [];
  for (const f of state.food.values()) {
    if (Math.abs(f.x - camX) < halfW && Math.abs(f.y - camY) < halfH) visible.push(f);
  }
  for (const f of visible) {
    const c = FOOD_COLORS[f.hue];
    const fade = Math.min(1, (now - f.born) / 250);
    const pulse = 0.7 + 0.3 * Math.sin(now * 0.004 + f.id);
    renderer.push(f.x, f.y, foodRadius(f.v) * 3.4 * fade, KIND_GLOW, c[0], c[1], c[2], 0.32 * pulse);
  }
  for (const f of visible) {
    const c = FOOD_COLORS[f.hue];
    const fade = Math.min(1, (now - f.born) / 250);
    renderer.push(f.x, f.y, foodRadius(f.v) * fade, KIND_FOOD, c[0], c[1], c[2], 1);
  }
  state.eaten = state.eaten.filter((e) => now - e.t0 < 160);
  for (const e of state.eaten) {
    const t = (now - e.t0) / 160;
    const [tx, ty] = heads.get(e.by) ?? [e.x, e.y];
    const c = FOOD_COLORS[e.hue];
    renderer.push(e.x + (tx - e.x) * t * t, e.y + (ty - e.y) * t * t, foodRadius(e.v) * (1 - t), KIND_FOOD, c[0], c[1], c[2], 1);
  }

  const order = [...state.snakes.values()].sort((a, b) => (a === me ? 1 : b === me ? -1 : a.mass - b.mass));
  for (const s of order) {
    const reach = lengthOf(s.mass) + radiusOf(s.mass);
    if (Math.abs(s.hx - camX) < halfW + reach && Math.abs(s.hy - camY) < halfH + reach) drawSnake(s, alpha, s === me);
  }

  state.bursts = state.bursts.filter((b) => now - b.t0 < 600);
  for (const b of state.bursts) {
    const t = (now - b.t0) / 600;
    const c = SKINS[b.skin % SKINS.length][0];
    renderer.push(b.x, b.y, (40 + b.r * 6) * (0.4 + t), KIND_GLOW, c[0], c[1], c[2], (1 - t) * 0.8);
  }

  renderer.draw(camX, camY, scale, WORLD_R, now / 1000);
  hud.draw({
    now, camX, camY, scale: scaleCss, snakes: state.snakes.values(), heads, me, myName,
    joy: input.joy, playing, connected: net.open,
  });
}
requestAnimationFrame(frame);

// Playtest/debug handle.
(window as unknown as { __snek: object }).__snek = {
  net, state, input, ui,
  view: () => ({ camX, camY, scale: scaleCss, W, H }),
};
