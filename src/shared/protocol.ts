// Binary wire format. Little-endian throughout.
//
// client -> server
//   INPUT  u8 type, u16 angle (0..65535 = 0..2pi), u8 boost
//   text   "ping" | JSON {t:"join",token?,guest?,skin,aspect} | {t:"auth",token}
//          | {t:"view",aspect}
//
// server -> client
//   TICK   u8 type, u32 tick, u16 myId, f32 camX, f32 camY,
//          u16 nLeave  [u16 id, u8 died]
//          u16 nEnter  [u16 id, u8 skin, u8 flags, str name, str pfp, f32 mass,
//                       u16 nPts, (f32 x, f32 y)*nPts, f32 hx, f32 hy]
//          u16 nUpd    [u16 id, f32 hx, f32 hy, f32 mass, u8 flags]
//          u16 nDrop   [u16 cell]
//          u16 nFood   [u32 id, i16 x, i16 y, u8 v, u8 hue]
//          u16 nEaten  [u32 id, u16 eaterId]
//   text   JSON {t:"hello"|"you"|"dead"|"lb"|"kill"|"sponsors"|"full", ...}

export const MSG_INPUT = 1;
export const MSG_TICK = 2;

export const FLAG_BOOST = 1;
export const FLAG_BOT = 2;
export const FLAG_VERIFIED = 4;
export const FLAG_SHIELD = 8;

const TAU = Math.PI * 2;

export function packAngle(a: number): number {
  const n = ((a % TAU) + TAU) % TAU;
  return Math.round((n / TAU) * 65535) & 0xffff;
}

export function unpackAngle(v: number): number {
  return (v / 65535) * TAU;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export class Writer {
  buf: ArrayBuffer;
  dv: DataView;
  u8a: Uint8Array;
  o = 0;

  constructor(size = 4096) {
    this.buf = new ArrayBuffer(size);
    this.dv = new DataView(this.buf);
    this.u8a = new Uint8Array(this.buf);
  }

  reset(): this {
    this.o = 0;
    return this;
  }

  private ensure(n: number): void {
    if (this.o + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.o + n) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.u8a.subarray(0, this.o));
    this.buf = next;
    this.dv = new DataView(next);
    this.u8a = new Uint8Array(next);
  }

  u8(v: number): void {
    this.ensure(1);
    this.dv.setUint8(this.o, v);
    this.o += 1;
  }

  u16(v: number): void {
    this.ensure(2);
    this.dv.setUint16(this.o, v, true);
    this.o += 2;
  }

  i16(v: number): void {
    this.ensure(2);
    this.dv.setInt16(this.o, v, true);
    this.o += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.dv.setUint32(this.o, v >>> 0, true);
    this.o += 4;
  }

  f32(v: number): void {
    this.ensure(4);
    this.dv.setFloat32(this.o, v, true);
    this.o += 4;
  }

  str(s: string): void {
    const b = enc.encode(s).subarray(0, 255);
    this.u8(b.length);
    this.ensure(b.length);
    this.u8a.set(b, this.o);
    this.o += b.length;
  }

  // Reserve a u16 count slot; fill it in later with setU16.
  slot(): number {
    const at = this.o;
    this.u16(0);
    return at;
  }

  setU16(at: number, v: number): void {
    this.dv.setUint16(at, v, true);
  }

  bytes(): ArrayBuffer {
    return this.buf.slice(0, this.o);
  }
}

export class Reader {
  dv: DataView;
  u8a: Uint8Array;
  o = 0;

  constructor(buf: ArrayBuffer) {
    this.dv = new DataView(buf);
    this.u8a = new Uint8Array(buf);
  }

  u8(): number {
    return this.dv.getUint8(this.o++);
  }

  u16(): number {
    const v = this.dv.getUint16(this.o, true);
    this.o += 2;
    return v;
  }

  i16(): number {
    const v = this.dv.getInt16(this.o, true);
    this.o += 2;
    return v;
  }

  u32(): number {
    const v = this.dv.getUint32(this.o, true);
    this.o += 4;
    return v;
  }

  f32(): number {
    const v = this.dv.getFloat32(this.o, true);
    this.o += 4;
    return v;
  }

  str(): string {
    const n = this.u8();
    const s = dec.decode(this.u8a.subarray(this.o, this.o + n));
    this.o += n;
    return s;
  }
}

export interface LeaderEntry {
  id: number;
  n: string;
  p: string;
  s: number;
  m: number;
  x: number;
  y: number;
}

// A paid leaderboard slot. Ordered by amount; the first one gets the top spot.
export interface Sponsor {
  name: string;
  url?: string;
  amount: number;
}

// Identity attached to a player: a verified X account or a guest.
export interface Identity {
  name: string;
  pfp: string;
  verified: boolean;
}

export type ServerJson =
  | { t: "hello"; room: string; humans: number; sponsors: Sponsor[] }
  | { t: "you"; name: string; pfp: string; verified: boolean }
  | { t: "sponsors"; list: Sponsor[] }
  | { t: "dead"; mass: number; kills: number; killer: string | null; best: number; secs: number }
  | { t: "lb"; top: LeaderEntry[]; rank: number; count: number; humans: number }
  | { t: "kill"; k: string; v: string; m: number }
  | { t: "full"; next: string };
