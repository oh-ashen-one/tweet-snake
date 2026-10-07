// Canvas 2D overlay: names + pfps over heads, score, minimap, kill feed and
// the touch joystick.

import type { LeaderEntry } from "../shared/protocol";
import { WORLD_R, radiusOf } from "../shared/rules";
import type { Joy } from "./input";
import type { CSnake } from "./state";
import { pfpUrl } from "./ui";

interface Feed {
  text: string;
  mine: boolean;
  t0: number;
}

const pfps = new Map<string, HTMLImageElement | null>();

function pfpImage(path: string): HTMLImageElement | null {
  if (!path) return null;
  const hit = pfps.get(path);
  if (hit !== undefined) return hit && hit.complete && hit.naturalWidth ? hit : null;
  const img = new Image();
  img.decoding = "async";
  img.onerror = () => pfps.set(path, null);
  img.src = pfpUrl(path);
  pfps.set(path, img);
  return null;
}

export class Hud {
  private ctx: CanvasRenderingContext2D;
  feed: Feed[] = [];
  top: LeaderEntry[] = [];
  rank = 0;
  count = 0;
  w = 1;
  h = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  addFeed(killer: string, victim: string, mass: number, myName: string): void {
    const text = killer ? `${killer} ate ${victim}` : `${victim} crashed`;
    this.feed.push({ text: mass >= 100 ? `${text} (${mass.toLocaleString()})` : text, mine: killer === myName || victim === myName, t0: performance.now() });
    if (this.feed.length > 4) this.feed.shift();
  }

  draw(o: {
    now: number;
    camX: number;
    camY: number;
    scale: number;
    snakes: Iterable<CSnake>;
    heads: Map<number, [number, number]>;
    me: CSnake | undefined;
    myName: string;
    joy: Joy | null;
    playing: boolean;
    connected: boolean;
  }): void {
    const c = this.ctx;
    const { w, h } = this;
    const u = Math.max(0.78, Math.min(1.25, Math.min(w, h) / 560));
    c.clearRect(0, 0, w, h);

    // Names over heads.
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const s of o.snakes) {
      const hp = o.heads.get(s.id);
      if (!hp) continue;
      const sx = (hp[0] - o.camX) * o.scale + w / 2;
      const sy = (hp[1] - o.camY) * o.scale + h / 2;
      if (sx < -80 || sx > w + 80 || sy < -60 || sy > h + 60) continue;
      const r = radiusOf(s.mass) * o.scale;
      const y = sy - r - 14 * u;
      const fs = Math.round((s === o.me ? 13 : 12) * u);
      c.font = `700 ${fs}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      const img = s.verified ? pfpImage(s.pfp) : null;
      const tw = c.measureText(s.name).width;
      const pr = img ? 8 * u : 0;
      const total = tw + (img ? pr * 2 + 4 : 0);
      const x0 = sx - total / 2;
      if (img) {
        c.save();
        c.beginPath();
        c.arc(x0 + pr, y, pr, 0, Math.PI * 2);
        c.clip();
        c.drawImage(img, x0 + pr - pr, y - pr, pr * 2, pr * 2);
        c.restore();
        c.strokeStyle = "rgba(255,255,255,.85)";
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(x0 + pr, y, pr, 0, Math.PI * 2);
        c.stroke();
      }
      const tx = x0 + (img ? pr * 2 + 4 : 0) + tw / 2;
      c.lineWidth = 3;
      c.strokeStyle = "rgba(0,0,0,.55)";
      c.strokeText(s.name, tx, y);
      c.fillStyle = s === o.me ? "#fff" : s.verified ? "#e8f3ff" : "rgba(255,255,255,.78)";
      c.fillText(s.name, tx, y);
    }

    // Score.
    if (o.me && o.playing) {
      c.textAlign = "left";
      c.textBaseline = "alphabetic";
      const x = 14 * u;
      let y = h - 16 * u;
      c.font = `600 ${Math.round(11 * u)}px ui-rounded, system-ui, sans-serif`;
      c.fillStyle = "rgba(255,255,255,.6)";
      if (this.rank) c.fillText(`rank #${this.rank} of ${this.count}`, x, y);
      y -= 16 * u;
      c.font = `800 ${Math.round(22 * u)}px ui-rounded, system-ui, sans-serif`;
      c.fillStyle = "#fff";
      c.fillText(Math.floor(o.me.mass).toLocaleString(), x, y);
    }

    // Minimap.
    const mr = 40 * u;
    const mx = w - mr - 14 * u;
    const my = h - mr - (o.playing && "ontouchstart" in window ? 92 : 14) * u;
    c.fillStyle = "rgba(10,12,20,.55)";
    c.strokeStyle = "rgba(255,90,110,.6)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(mx, my, mr, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    const k = mr / WORLD_R;
    this.top.slice(0, 5).forEach((e, i) => {
      c.fillStyle = i === 0 ? "#ffd34d" : "rgba(255,255,255,.45)";
      c.beginPath();
      c.arc(mx + e.x * k, my + e.y * k, i === 0 ? 2.6 : 1.8, 0, Math.PI * 2);
      c.fill();
    });
    if (o.me) {
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(mx + o.me.hx * k, my + o.me.hy * k, 3, 0, Math.PI * 2);
      c.fill();
    }

    // Kill feed.
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.font = `600 ${Math.round(11 * u)}px ui-rounded, system-ui, sans-serif`;
    this.feed = this.feed.filter((f) => o.now - f.t0 < 5000);
    let fy = h - (o.me && o.playing ? 70 : 20) * u - (this.feed.length - 1) * 16 * u;
    for (const f of this.feed) {
      const a = Math.min(1, (5000 - (o.now - f.t0)) / 600);
      c.globalAlpha = a;
      c.fillStyle = f.mine ? "#ffd34d" : "rgba(255,255,255,.75)";
      c.fillText(f.text, 14 * u, fy);
      fy += 16 * u;
    }
    c.globalAlpha = 1;

    // Joystick.
    if (o.joy) {
      c.strokeStyle = "rgba(255,255,255,.25)";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(o.joy.ax, o.joy.ay, 46, 0, Math.PI * 2);
      c.stroke();
      const dx = o.joy.x - o.joy.ax, dy = o.joy.y - o.joy.ay;
      const d = Math.min(46, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      c.fillStyle = "rgba(255,255,255,.35)";
      c.beginPath();
      c.arc(o.joy.ax + Math.cos(a) * d, o.joy.ay + Math.sin(a) * d, 18, 0, Math.PI * 2);
      c.fill();
    }

    if (!o.connected) {
      c.textAlign = "center";
      c.font = `700 ${Math.round(14 * u)}px ui-rounded, system-ui, sans-serif`;
      c.fillStyle = "rgba(255,255,255,.8)";
      c.fillText("connecting…", w / 2, h / 2);
    }
  }
}
